/**
 * Batch-import receipt photos into the price_observations database.
 *
 * Reuses the same parse + match libraries as the live /api/compare route,
 * but persists to the DB instead of returning JSON. This is the "easier
 * than filling in a CSV" seeding path: take photos, dump them in a folder,
 * run this, walk away.
 *
 * Pipeline per image:
 *   1. SHA-256 hash the bytes; skip if already in receipts.image_hash.
 *   2. Vision OCR + parse.mjs heuristic → chain hint (free, fast).
 *   3. processReceipt() — GPT vision parse against the strict schema.
 *   4. identifyStore() — resolve store_name + address → (chain_id, store_id).
 *   5. matchItems() — pg_trgm + HNSW vector match per item.
 *   6. INSERT receipts, receipt_line_items.
 *   7. INSERT price_observations for matched compare-items with prices.
 *      One row at pricing_tier='shelf'; if member_price differs, a second
 *      at 'member'.
 *   8. After the batch, REFRESH MATERIALIZED VIEW current_prices.
 *
 * Idempotency:
 *   - The image_hash unique check skips re-imports of the same photo.
 *   - The GPT cache hits, so re-runs on a fresh DB don't re-bill the API.
 *
 * Usage (from repo root):
 *   node web/scripts/import-receipts.mjs receipts/folder/
 *   node web/scripts/import-receipts.mjs path/to/single.jpg
 *   node web/scripts/import-receipts.mjs receipts/folder/ --dry-run
 *   node web/scripts/import-receipts.mjs receipts/folder/ --replace
 *
 * Flags:
 *   --dry-run   Parse + match + report, but write nothing to the DB.
 *   --replace   Delete existing source='receipt' observations and re-import
 *               all images (including ones whose hash is in receipts table).
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, join, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// Match Next.js's auto-loading of web/.env.local so process.env has the keys
// the lib modules need (OPENROUTER_KEY, GOOGLE_VISION_API_KEY, SUPABASE_*).
dotenv.config({ path: resolve(ROOT, 'web', '.env.local') })

const { parseReceipt }    = await import('../lib/receipts/parse.mjs')
const { processReceipt }  = await import('../lib/receipts/gpt-parser.mjs')
const { visionAnnotate, extractText } = await import('../lib/receipts/vision.mjs')
const { matchItems, getCatalogForReview, addProposedCanonical } = await import('../lib/receipts/match.mjs')
const { identifyStore }   = await import('../lib/receipts/identify-store.mjs')
const { reviewReceipt }   = await import('../lib/receipts/llm-reviewer.mjs')
const { createClient }    = await import('./seed-utils.mjs')

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const REPLACE = args.includes('--replace')
// LLM review is on by default — the matcher gets fooled too often without it.
// --no-llm-review skips the LLM step (faster, cheaper, less accurate; useful
// when iterating on the matcher itself).
const NO_LLM_REVIEW = args.includes('--no-llm-review')
const TOPK = 5
const pathArg = args.find((a) => !a.startsWith('--'))

if (!pathArg) {
  console.error('Usage: node web/scripts/import-receipts.mjs <folder-or-image>')
  process.exit(1)
}

const target = resolve(pathArg)
if (!existsSync(target)) {
  console.error(`Path not found: ${target}`)
  process.exit(1)
}

const visionKey = process.env.GOOGLE_VISION_API_KEY
const openrouterKey = process.env.OPENROUTER_KEY
if (!visionKey || !openrouterKey) {
  console.error('Missing GOOGLE_VISION_API_KEY or OPENROUTER_KEY in web/.env.local')
  process.exit(1)
}

// ── Image discovery ──────────────────────────────────────────────────────────

function listImages(p) {
  if (statSync(p).isFile()) return [p]
  return readdirSync(p)
    .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f))
    .map((f) => join(p, f))
    .sort()
}

const images = listImages(target)
console.log(`Found ${images.length} image(s) under ${target}`)
if (DRY_RUN) console.log('Mode: DRY-RUN (no DB writes)')
if (REPLACE) console.log('Mode: REPLACE (will wipe existing receipt observations)')
console.log()

// ── DB ───────────────────────────────────────────────────────────────────────

const db = createClient()
await db.connect()

if (REPLACE && !DRY_RUN) {
  // Wipe both the price observations and the receipts they came from. The
  // ON DELETE CASCADE on receipt_line_items handles the items table.
  const { rowCount: obsDel } = await db.query(
    `DELETE FROM price_observations WHERE source = 'receipt'`,
  )
  const { rowCount: rcptDel } = await db.query(
    `DELETE FROM receipts WHERE ocr_engine = 'google_vision'`,
  )
  console.log(`✓ Removed ${obsDel} receipt observations + ${rcptDel} receipt rows\n`)
}

// ── Per-image pipeline ───────────────────────────────────────────────────────

const stats = {
  total: 0,
  skipped_already: 0,
  parse_failed: 0,
  store_unresolved: 0,
  imported_partial: 0,   // receipt + line items saved, no price observations
  imported_full: 0,      // receipt + line items + at least one price obs
  observations_inserted: 0,
  llm_confirms: 0,
  llm_switches: 0,
  llm_rejects: 0,
  llm_hallucinated: 0,
  llm_failures: 0,
  heuristic_fallbacks: 0,
}
const rowsForReport = []

// In-memory proposal queue. Keyed by lowercased proposed-name so two receipts
// that reject onto "Orange soda" share one synthetic canonical id and the
// matcher's hot-swapped catalog entry. No DB writes — surfaced in the report
// for the user to review/commit later.
const proposalQueue = new Map()
// Cache for category_hint → category_id resolution. Empty until the first
// reject decision triggers a lookup; thereafter every proposal is in-memory.
// Also reused by getCategoriesForReview() to feed the LLM the existing
// taxonomy so it stops inventing categories that don't exist in the DB.
let categoryLookupCache = null
let categoryFullList = null

async function ensureCategoryCache(db) {
  if (categoryLookupCache && categoryFullList) return
  const { rows } = await db.query(`SELECT category_id, name FROM product_categories`)
  categoryLookupCache = rows.map((r) => ({ id: r.category_id, name: String(r.name).toLowerCase() }))
  categoryFullList = rows.map((r) => ({ category_id: r.category_id, name: String(r.name) }))
}

async function resolveCategoryId(hint) {
  if (!hint || typeof hint !== 'string') return null
  await ensureCategoryCache(db)
  const h = hint.toLowerCase().trim()
  // Prefer exact match → starts-with → contains.
  const exact = categoryLookupCache.find((c) => c.name === h)
  if (exact) return exact.id
  const starts = categoryLookupCache.find((c) => c.name.startsWith(h) || h.startsWith(c.name))
  if (starts) return starts.id
  const contains = categoryLookupCache.find((c) => c.name.includes(h) || h.includes(c.name))
  if (contains) return contains.id
  return null
}

// Returns the full category list in the shape the LLM reviewer expects.
async function getCategoriesForReview(db) {
  await ensureCategoryCache(db)
  return categoryFullList
}

for (const imgPath of images) {
  stats.total++
  const fname = basename(imgPath)
  const bytes = readFileSync(imgPath)
  const hash = createHash('sha256').update(bytes).digest('hex')

  // Skip if we've already imported this exact image.
  if (!REPLACE) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM receipts WHERE image_hash = $1 LIMIT 1`,
      [hash],
    )
    if (rowCount > 0) {
      stats.skipped_already++
      rowsForReport.push({ file: fname, status: 'skipped (already imported)' })
      console.log(`  ⊘ ${fname}  already imported (hash ${hash.slice(0, 8)}…)`)
      continue
    }
  }

  // Parse: Vision → chain hint → GPT. Keep the heuristic parse around for
  // fallback when GPT silently returns 0 items on long receipts (the
  // heuristic was 100% accurate on the original 8-receipt test set).
  let parsed, chain, warnings
  let chainHint = null
  let heuristicParsed = null
  let heuristicFallback = false
  try {
    try {
      const visionResp = await visionAnnotate(bytes.toString('base64'), visionKey)
      const text = extractText(visionResp)
      heuristicParsed = parseReceipt(text)
      chainHint = heuristicParsed?.store_name ?? null
    } catch {
      // Vision-side failure is non-fatal; processReceipt falls back to GPT detect.
    }

    const result = await processReceipt(
      bytes.toString('base64'),
      openrouterKey,
      { chainHint },
    )
    parsed = result.parsed
    chain = result.chain
    warnings = result.warnings

    // GPT silent-failure fallback: when GPT returns 0 items but the receipt
    // total is non-zero AND the heuristic parsed any items, use heuristic
    // items + chain detection. Common on multi-page Costco/Safeway receipts
    // where GPT bails at the first column-marker line.
    const gptItemCount = parsed?.items?.length ?? 0
    const receiptTotal = Number(parsed?.receipt_total ?? 0)
    const heuristicItemCount = heuristicParsed?.items?.length ?? 0
    if (gptItemCount === 0 && receiptTotal > 0 && heuristicItemCount > 0) {
      heuristicFallback = true
      stats.heuristic_fallbacks++
      parsed = {
        ...parsed,
        store_name: parsed.store_name ?? heuristicParsed.store_name,
        store_address: parsed.store_address ?? heuristicParsed.store_address,
        receipt_date: parsed.receipt_date ?? heuristicParsed.receipt_date,
        receipt_total: parsed.receipt_total ?? heuristicParsed.receipt_total,
        items: heuristicParsed.items,
      }
      console.log(`    ⤷ ${fname}: GPT returned 0 items, fell back to heuristic parser (${heuristicItemCount} items)`)
    }
  } catch (err) {
    stats.parse_failed++
    rowsForReport.push({ file: fname, status: 'parse failed', error: err.message })
    console.log(`  ✗ ${fname}  parse failed: ${err.message}`)
    continue
  }

  // Resolve the store. If we can't identify it confidently, we still save
  // the receipt + line items (audit trail) but skip price observations.
  const storeMatch = await identifyStore(db, parsed.store_name, parsed.store_address)
  if (!storeMatch.store_id) {
    stats.store_unresolved++
  }

  // Match items with topK candidates so the LLM reviewer can see alternatives,
  // not just the matcher's top-1 guess.
  const matches = await matchItems(parsed.items ?? [], { topK: TOPK })

  // ── LLM review ────────────────────────────────────────────────────────────
  // Replaces or stamps each compare-item's match with the LLM's decision.
  // confirm  → keep matcher's top-1, mark as LLM-confirmed
  // switch   → swap to a different canonical (any in catalog)
  // reject   → propose new canonical, queue it (no DB write), hot-swap into
  //            in-memory catalog so later receipts can dedupe against it
  let reviewSummary = { confirm: 0, switch: 0, reject: 0, hallucinated: 0, failed: false, errMsg: null, cached: false }
  if (!NO_LLM_REVIEW) {
    const reviewItems = matches
      .map((m, i) => ({
        idx: i + 1,
        raw_text: m.item.raw_text,
        description: m.item.description,
        quantity: m.item.quantity,
        unit: m.item.unit,
        shelf_price: m.item.shelf_price,
        member_price: m.item.member_price,
        candidates: (m.candidates ?? []).map((c) => ({
          canonical_id: c.canonical_id,
          name: c.name,
          package_size: c.package_size,
          package_unit: c.package_unit,
          pricing_unit: c.pricing_unit,
          score: c.score,
        })),
        _i: i,
      }))
      .filter((r) => matches[r._i].item.item_type === 'compare')
      .map(({ _i, ...rest }) => rest)

    if (reviewItems.length > 0) {
      try {
        const catalog = await getCatalogForReview()
        const catalogById = new Map(catalog.map((c) => [c.canonical_id, c]))
        const categories = await getCategoriesForReview(db)
        const reviewResult = await reviewReceipt({
          chain_name: storeMatch.chain_name ?? parsed.store_name ?? null,
          items: reviewItems,
          catalog,
          categories,
        })
        reviewSummary.cached = !!reviewResult.cached

        for (const d of reviewResult.decisions) {
          const targetIdx = (Number(d.idx) || 0) - 1
          if (targetIdx < 0 || targetIdx >= matches.length) continue
          const target = matches[targetIdx]
          if (!target || target.item.item_type !== 'compare') continue

          if (d.hallucinated) reviewSummary.hallucinated++

          if (d.decision === 'confirm') {
            if (target.match) {
              target.match = {
                ...target.match,
                match_type: d.match_type ?? 'exact',
                review_decision: 'confirm',
                llm_reason: d.reason,
              }
            }
            reviewSummary.confirm++
            stats.llm_confirms++
          } else if (d.decision === 'switch') {
            if (d.canonical_id == null) continue  // hallucinated; keep matcher
            const cat = catalogById.get(d.canonical_id)
            if (!cat) continue
            target.match = {
              canonical_id: cat.canonical_id,
              name: cat.name,
              brand: cat.brand,
              package_size: cat.package_size,
              package_unit: cat.package_unit,
              pricing_unit: cat.pricing_unit,
              score: 0.95,
              match_type: d.match_type ?? 'exact',
              review_decision: 'switch',
              llm_reason: d.reason,
              is_proposed: cat.is_proposed === true,
            }
            reviewSummary.switch++
            stats.llm_switches++
          } else if (d.decision === 'reject') {
            const proposal = d.new_canonical
            if (!proposal || !proposal.name) {
              target.match = null
              continue
            }
            const key = proposal.name.toLowerCase().trim()
            let queueEntry = proposalQueue.get(key)
            if (!queueEntry) {
              const categoryId = await resolveCategoryId(proposal.category_hint)
              const syntheticId = await addProposedCanonical({
                name: proposal.name,
                brand: proposal.brand,
                package_size: proposal.package_size,
                package_unit: proposal.package_unit,
                pricing_unit: proposal.pricing_unit,
                category_id: categoryId,
              })
              queueEntry = {
                synthetic_id: syntheticId,
                proposal,
                category_id: categoryId,
                wanted_by: [],
              }
              proposalQueue.set(key, queueEntry)
            }
            queueEntry.wanted_by.push({
              file: fname,
              idx: d.idx,
              raw_text: target.item.raw_text,
              description: target.item.description,
            })
            target.match = {
              canonical_id: queueEntry.synthetic_id,
              name: proposal.name,
              brand: proposal.brand ?? null,
              package_size: proposal.package_size,
              package_unit: proposal.package_unit,
              pricing_unit: proposal.pricing_unit,
              score: 0.95,
              match_type: 'exact',
              review_decision: 'reject',
              llm_reason: d.reason,
              is_proposed: true,
            }
            reviewSummary.reject++
            stats.llm_rejects++
          }
        }
        if (reviewSummary.hallucinated > 0) stats.llm_hallucinated += reviewSummary.hallucinated
      } catch (err) {
        reviewSummary.failed = true
        reviewSummary.errMsg = err.message
        stats.llm_failures++
        console.log(`    ⚠ LLM review failed: ${err.message} — falling back to matcher only`)
      }
    }
  }

  // Build per-receipt summary line for the console.
  const items = matches.length
  const matched = matches.filter((m) => m.match).length
  const willPriceObs = storeMatch.store_id && storeMatch.chain_id

  if (DRY_RUN) {
    // Collect rich per-item detail for the markdown review file. The console
    // line stays terse — full detail goes to tmp/import-dry-run-<ts>.md.
    const compareItems = matches.filter((m) => m.item.item_type === 'compare')
    const skipItems = matches.filter((m) => m.item.item_type === 'skip')
    const itemSum = matches
      .filter((m) => m.item.item_type !== 'skip')
      .reduce((s, m) => s + Number(m.item.member_price ?? m.item.shelf_price ?? 0), 0)
    let expectedObs = 0
    if (willPriceObs) {
      for (const m of compareItems) {
        // Proposed canonicals (synthetic negative ids) have no DB row yet, so
        // a real run wouldn't insert an observation for them. Don't count.
        if (!m.match || m.match.is_proposed) continue
        if (!(Number(m.item.shelf_price) > 0)) continue
        expectedObs++
        if (
          Number(m.item.member_price) > 0 &&
          Number(m.item.member_price) < Number(m.item.shelf_price)
        ) expectedObs++
      }
    }
    rowsForReport.push({
      file: fname,
      status: willPriceObs ? 'would import' : 'would import (partial — no store)',
      parsedStore: parsed.store_name ?? null,
      parsedAddress: parsed.store_address ?? null,
      receiptDate: parsed.receipt_date ?? null,
      receiptTotal: parsed.receipt_total ?? null,
      itemSum: Number(itemSum.toFixed(2)),
      storeOk: !!willPriceObs,
      chainName: storeMatch.chain_name ?? null,
      chainId: storeMatch.chain_id ?? null,
      storeId: storeMatch.store_id ?? null,
      storeAddress: storeMatch.address ?? null,
      storeReason: storeMatch.reason ?? null,
      itemCount: items,
      compareCount: compareItems.length,
      skipCount: skipItems.length,
      matchedCount: matched,
      expectedObs,
      heuristicFallback,
      warnings: warnings ?? [],
      items: matches.map((m, i) => ({
        idx: i + 1,
        raw_text: m.item.raw_text ?? null,
        description: m.item.description ?? null,
        quantity: m.item.quantity ?? null,
        unit: m.item.unit ?? null,
        unit_price: m.item.unit_price ?? null,
        shelf_price: m.item.shelf_price ?? null,
        member_price: m.item.member_price ?? null,
        item_type: m.item.item_type,
        is_store_brand: !!m.item.is_store_brand,
        match: m.match ? {
          canonical_id: m.match.canonical_id,
          name: m.match.name,
          package_size: m.match.package_size,
          package_unit: m.match.package_unit,
          pricing_unit: m.match.pricing_unit,
          score: Number((m.match.score ?? 0).toFixed(3)),
          match_type: m.match.match_type ?? null,
          review_decision: m.match.review_decision ?? null,
          llm_reason: m.match.llm_reason ?? null,
          is_proposed: m.match.is_proposed === true,
        } : null,
        // Top-K candidates the matcher offered (regardless of whether any
        // passed threshold). Useful for spotting "matcher gave only trash"
        // cases where the LLM had nothing good to pick from.
        candidates: (m.candidates ?? []).slice(0, TOPK).map((c) => ({
          canonical_id: c.canonical_id,
          name: c.name,
          package_size: c.package_size,
          package_unit: c.package_unit,
          score: Number((c.score ?? 0).toFixed(3)),
        })),
      })),
      reviewSummary,
    })
    console.log(
      `  ◌ ${fname}  ${parsed.store_name} — ${matched}/${items} matched` +
      `  ${willPriceObs ? '→ store ok' : `→ ${storeMatch.reason}`}`,
    )
    continue
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  // We do this in one transaction per receipt so a partial DB error doesn't
  // leave half-inserted rows behind.
  await db.query('BEGIN')
  try {
    const receiptRes = await db.query(
      `INSERT INTO receipts
         (image_hash, store_id, inferred_chain_id, receipt_dated_at,
          ocr_engine, receipt_total, line_count, processing_status)
       VALUES ($1, $2, $3, $4, 'google_vision', $5, $6, $7)
       RETURNING receipt_id`,
      [
        hash,
        storeMatch.store_id,
        storeMatch.chain_id,
        parsed.receipt_date || null,
        parsed.receipt_total ?? null,
        parsed.items?.length ?? 0,
        willPriceObs ? 'processed' : 'partial',
      ],
    )
    const receiptId = receiptRes.rows[0].receipt_id

    let obsCount = 0
    for (let i = 0; i < matches.length; i++) {
      const { item, match } = matches[i]

      // Proposed canonicals (synthetic negative ids from the LLM reviewer) are
      // queue-only — no DB row exists yet, so we can't write a store_sku that
      // FK-references them. The line item is still recorded (with no store_sku)
      // so we have an audit trail; the user reviews the queue separately.
      const isProposed = match?.is_proposed === true || (typeof match?.canonical_id === 'number' && match.canonical_id < 0)

      // Save the line item regardless of match status — gives us a record
      // of what was on the receipt for later disambiguation / catalog growth.
      let storeSkuId = null
      if (match && !isProposed && willPriceObs) {
        const skuRes = await db.query(
          `WITH ins AS (
             INSERT INTO store_skus
               (chain_id, store_id, canonical_id, receipt_text_canonical,
                display_name, status, confidence, verified_at, verified_by)
             VALUES ($1, NULL, $2, $3, $3, 'verified', $4, NOW(), 'receipt_import')
             ON CONFLICT (chain_id, receipt_text_canonical) DO NOTHING
             RETURNING store_sku_id
           )
           SELECT store_sku_id FROM ins
           UNION ALL
           SELECT store_sku_id FROM store_skus
           WHERE chain_id = $1 AND receipt_text_canonical = $3
           LIMIT 1`,
          [storeMatch.chain_id, match.canonical_id, match.name, Math.min(0.99, match.score)],
        )
        storeSkuId = skuRes.rows[0]?.store_sku_id ?? null

        // Backfill pack_size/pack_unit from the canonical if the SKU lacks them.
        if (storeSkuId && match.package_size != null) {
          await db.query(
            `UPDATE store_skus
             SET pack_size = COALESCE(store_skus.pack_size, $2),
                 pack_unit = COALESCE(store_skus.pack_unit, $3)
             WHERE store_sku_id = $1`,
            [storeSkuId, match.package_size, match.package_unit],
          )
        }
      }

      await db.query(
        `INSERT INTO receipt_line_items
           (receipt_id, line_number, raw_text, parsed_quantity, parsed_unit,
            parsed_price_total, matched_store_sku_id, match_confidence, needs_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          receiptId,
          i + 1,
          item.raw_text || item.description,
          item.quantity ?? null,
          item.unit ?? null,
          item.member_price ?? item.shelf_price ?? null,
          storeSkuId,
          match?.score ?? null,
          !match || (match?.score ?? 0) < 0.50,
        ],
      )

      // Price observations only for "compare" items with a store + a match.
      if (
        item.item_type === 'compare' &&
        match &&
        willPriceObs &&
        storeSkuId &&
        Number(item.shelf_price) > 0
      ) {
        // The product's pricing_unit (per_lb / per_each) drives the price_unit
        // and the quantity_unit on the observation.
        const productInfo = await db.query(
          `SELECT package_unit, pricing_unit FROM canonical_products WHERE canonical_id = $1`,
          [match.canonical_id],
        )
        const { package_unit, pricing_unit } = productInfo.rows[0] ?? {}

        const observedAt = parsed.receipt_date
          ? `'${parsed.receipt_date}'::date`
          : 'NOW()'

        // Normalize price_total → price_per_unit. The receipt prints a line
        // total ("2.13 lb chicken thighs $7.39") but current_prices aggregates
        // on price_per_unit ("$3.47/lb"). Without dividing, comparisons of
        // weight-priced or multi-quantity items inflate by a factor of qty.
        // For per_each / per_pack canonicals, dividing converts a multi-pack
        // total to per-pack price (3 packs at $7.99 → $2.66/pack).
        const obsQty = Number(item.quantity ?? 1) || 1
        const shelfPerUnit = obsQty > 0 ? Number(item.shelf_price) / obsQty : Number(item.shelf_price)

        // Shelf price observation.
        await db.query(
          `INSERT INTO price_observations
             (store_sku_id, canonical_id, store_id, chain_id,
              price_total, quantity, quantity_unit,
              price_per_unit, price_unit,
              observed_at, source, pricing_tier, confidence,
              source_receipt_id)
           VALUES
             ($1, $2, $3, $4,
              $5, $6, $7,
              $8, $9,
              ${observedAt}, 'receipt', 'shelf', $10,
              $11)`,
          [
            storeSkuId,
            match.canonical_id,
            storeMatch.store_id,
            storeMatch.chain_id,
            item.shelf_price,
            obsQty,
            item.unit ?? package_unit ?? null,
            shelfPerUnit,
            pricing_unit ?? 'per_each',
            // Confidence blends the canonical match score with a fixed bias.
            // 0.85 floor reflects "real receipt > seed but < manual audit."
            Math.min(0.95, 0.5 + (match.score ?? 0) * 0.5),
            receiptId,
          ],
        )
        obsCount++

        // Member-tier observation when loyalty discount applied.
        if (
          Number(item.member_price) > 0 &&
          Number(item.member_price) < Number(item.shelf_price)
        ) {
          const memberPerUnit = obsQty > 0 ? Number(item.member_price) / obsQty : Number(item.member_price)
          await db.query(
            `INSERT INTO price_observations
               (store_sku_id, canonical_id, store_id, chain_id,
                price_total, quantity, quantity_unit,
                price_per_unit, price_unit,
                observed_at, source, pricing_tier, confidence,
                source_receipt_id)
             VALUES
               ($1, $2, $3, $4,
                $5, $6, $7,
                $8, $9,
                ${observedAt}, 'receipt', 'member', $10,
                $11)`,
            [
              storeSkuId,
              match.canonical_id,
              storeMatch.store_id,
              storeMatch.chain_id,
              item.member_price,
              obsQty,
              item.unit ?? package_unit ?? null,
              memberPerUnit,
              pricing_unit ?? 'per_each',
              Math.min(0.95, 0.5 + (match.score ?? 0) * 0.5),
              receiptId,
            ],
          )
          obsCount++
        }
      }
    }

    await db.query('COMMIT')

    if (willPriceObs) stats.imported_full++
    else stats.imported_partial++
    stats.observations_inserted += obsCount

    rowsForReport.push({
      file: fname,
      status: willPriceObs ? 'imported' : 'imported (partial — no store)',
      store: storeMatch.chain_name ?? '?',
      address: storeMatch.address ?? '?',
      items,
      matched,
      observations: obsCount,
      schema_warnings: warnings.length,
    })
    console.log(
      `  ✓ ${fname}  ${parsed.store_name} — ${matched}/${items} matched, ${obsCount} obs` +
      `  ${willPriceObs ? '' : `(${storeMatch.reason})`}`,
    )
  } catch (err) {
    await db.query('ROLLBACK')
    stats.parse_failed++
    rowsForReport.push({ file: fname, status: 'db error', error: err.message })
    console.log(`  ✗ ${fname}  DB error: ${err.message}`)
  }
}

// ── Refresh + report ─────────────────────────────────────────────────────────

if (!DRY_RUN && stats.observations_inserted > 0) {
  console.log('\nRefreshing current_prices materialized view...')
  try {
    await db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices`)
  } catch {
    await db.query(`REFRESH MATERIALIZED VIEW current_prices`)
  }
  console.log('✓ Refreshed.')
}

await db.end()

console.log('\nSummary:')
console.log(`  Total images:                ${stats.total}`)
console.log(`  Skipped (already imported):  ${stats.skipped_already}`)
console.log(`  Parse failed:                ${stats.parse_failed}`)
console.log(`  Imported (full):             ${stats.imported_full}`)
console.log(`  Imported (partial — no store): ${stats.imported_partial}`)
console.log(`  Store unresolved:            ${stats.store_unresolved}`)
console.log(`  Price observations created:  ${stats.observations_inserted}`)

// Write a JSON report so the team can dig into individual receipt outcomes.
{
  const tmp = resolve(ROOT, 'tmp')
  mkdirSync(tmp, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')

  if (!DRY_RUN) {
    const jsonOut = join(tmp, `import-report-${ts}.json`)
    writeFileSync(jsonOut, JSON.stringify({ stats, rows: rowsForReport }, null, 2))
    console.log(`\n  JSON report: ${jsonOut}`)
  }

  if (DRY_RUN) {
    const queue = [...proposalQueue.values()]
    const mdOut = join(tmp, `import-dry-run-${ts}.md`)
    writeFileSync(mdOut, buildDryRunReport({ stats, rows: rowsForReport, target, ts, queue }))
    const jsonOut = join(tmp, `import-dry-run-${ts}.json`)
    writeFileSync(jsonOut, JSON.stringify({ stats, rows: rowsForReport, proposalQueue: queue }, null, 2))
    console.log(`\n  Review file:  ${mdOut}`)
    console.log(`  JSON dump:    ${jsonOut}`)
  }
}

// ── Markdown report builder ─────────────────────────────────────────────────
//
// Designed for fast skim-review: red flags surfaced first with anchor links
// to per-receipt sections, full per-item table per receipt so wrong matches
// are obvious at a glance, raw_text included so the user can verify the
// parser saw what they expected.

function buildDryRunReport({ stats, rows, target, ts, queue = [] }) {
  const out = []
  out.push(`# Receipt import dry-run review`)
  out.push(``)
  out.push(`- **Run:** ${ts}`)
  out.push(`- **Target:** \`${target}\``)
  out.push(`- **Mode:** dry-run (no DB writes)`)
  out.push(``)

  // Aggregate stats
  out.push(`## Aggregate`)
  out.push(``)
  const totalLineItems = rows.reduce((s, r) => s + (r.itemCount ?? 0), 0)
  const totalCompare = rows.reduce((s, r) => s + (r.compareCount ?? 0), 0)
  const totalMatched = rows.reduce((s, r) => s + (r.matchedCount ?? 0), 0)
  const totalExpectedObs = rows.reduce((s, r) => s + (r.expectedObs ?? 0), 0)
  out.push(`| Metric | Count |`)
  out.push(`|---|---|`)
  out.push(`| Receipts processed | ${stats.total} |`)
  out.push(`| Skipped (already imported) | ${stats.skipped_already} |`)
  out.push(`| Parse failures | ${stats.parse_failed} |`)
  out.push(`| Stores resolved | ${rows.filter((r) => r.storeOk).length} |`)
  out.push(`| Stores unresolved | ${rows.filter((r) => r.storeOk === false).length} |`)
  out.push(`| Total line items | ${totalLineItems} |`)
  out.push(`| Compare-eligible items | ${totalCompare} |`)
  out.push(`| Items matched to canonical | ${totalMatched} |`)
  out.push(`| Items unmatched | ${totalCompare - totalMatched} |`)
  out.push(`| Would create price observations | ${totalExpectedObs} |`)
  out.push(`| LLM confirmed matcher | ${stats.llm_confirms ?? 0} |`)
  out.push(`| LLM switched canonical | ${stats.llm_switches ?? 0} |`)
  out.push(`| LLM rejected → queued new canonical | ${stats.llm_rejects ?? 0} |`)
  out.push(`| LLM hallucinated id (fell back) | ${stats.llm_hallucinated ?? 0} |`)
  out.push(`| LLM call failures | ${stats.llm_failures ?? 0} |`)
  out.push(`| Heuristic-parser fallbacks (GPT returned 0 items) | ${stats.heuristic_fallbacks ?? 0} |`)
  out.push(`| Distinct queued canonicals | ${queue.length} |`)
  out.push(``)

  // Queued new canonicals — front-loaded because they're the highest-leverage
  // thing for the user to review (the LLM proposed them; user approves/edits/rejects).
  if (queue.length > 0) {
    out.push(`## Queued new canonicals (${queue.length})`)
    out.push(``)
    out.push(`The LLM rejected matcher candidates for these items and proposed new canonical_products. **Nothing has been written to the DB.** Review each entry; the items wanting it are listed below. To commit them, see the next-steps note at the bottom of this file.`)
    out.push(``)
    for (const q of queue) {
      const p = q.proposal
      const sz = p.package_size != null && p.package_unit ? `${p.package_size} ${p.package_unit}` : '(no pack)'
      const cat = q.category_id != null ? `category_id=${q.category_id}` : `category_hint="${p.category_hint}" (no DB match)`
      out.push(`### \`${p.name}\``)
      out.push(`- Brand: ${p.brand ?? '(generic)'} · Pack: ${sz} · Pricing: ${p.pricing_unit} · ${cat}`)
      out.push(`- Synthetic id during this run: \`${q.synthetic_id}\` (negative ⇒ in-memory only)`)
      out.push(`- Wanted by ${q.wanted_by.length} receipt item${q.wanted_by.length === 1 ? '' : 's'}:`)
      for (const w of q.wanted_by) {
        out.push(`  - [${w.file}](#${anchor(w.file)}) item ${w.idx}: \`${cell(w.raw_text)}\``)
      }
      out.push(``)
    }
  }

  // Red flags — sorted by severity
  const flags = collectRedFlags(rows)
  if (flags.length > 0) {
    out.push(`## Things to verify (${flags.length})`)
    out.push(``)
    out.push(`Skim this list first. Each entry links to the per-receipt section below.`)
    out.push(``)
    for (const f of flags) {
      out.push(`- **[${f.severity}]** [${f.file}](#${anchor(f.file)}) — ${f.message}`)
    }
    out.push(``)
  } else {
    out.push(`## Things to verify`)
    out.push(``)
    out.push(`No automated red flags. Spot-check the per-receipt detail anyway — match scores in the 0.50–0.65 range are within threshold but worth a glance.`)
    out.push(``)
  }

  // Schema warnings (separate section so they don't drown the red-flag list)
  const warnRows = rows.filter((r) => (r.warnings ?? []).length > 0)
  if (warnRows.length > 0) {
    out.push(`## Schema warnings from GPT parser`)
    out.push(``)
    out.push(`These are warnings the strict-schema validator emitted while parsing. Most are minor (missing optional fields) but a few flag real data issues.`)
    out.push(``)
    for (const r of warnRows) {
      out.push(`- **[${r.file}](#${anchor(r.file)}):**`)
      for (const w of r.warnings) out.push(`  - ${w}`)
    }
    out.push(``)
  }

  // Per-receipt detail
  out.push(`## Per-receipt detail`)
  out.push(``)
  for (const r of rows) {
    out.push(`### ${r.file}`)
    out.push(``)
    if (r.error) {
      out.push(`**Status:** ${r.status}`)
      out.push(``)
      out.push('```')
      out.push(r.error)
      out.push('```')
      out.push(``)
      continue
    }
    if (r.status?.startsWith('skipped')) {
      out.push(`**Status:** ${r.status}`)
      out.push(``)
      continue
    }

    // Receipt-level metadata
    out.push(`**Parsed store:** ${r.parsedStore ?? '(none)'}${r.parsedAddress ? ` · ${r.parsedAddress}` : ''}  `)
    if (r.storeOk) {
      out.push(`**DB resolution:** [OK] ${r.chainName} (chain_id ${r.chainId}, store_id ${r.storeId})${r.storeAddress ? ` — ${r.storeAddress}` : ''}  `)
    } else {
      out.push(`**DB resolution:** [UNRESOLVED] reason: ${r.storeReason ?? 'unknown'}  `)
    }
    out.push(`**Receipt date:** ${r.receiptDate ?? '(none)'} · **Total:** ${money(r.receiptTotal)}  `)

    if (r.itemSum != null && r.receiptTotal != null) {
      const diff = r.receiptTotal - r.itemSum
      const flag = Math.abs(diff) > 0.05 ? ` [WARN] Δ ${money(diff)}` : ` [OK] match`
      out.push(`**Item sum:** ${money(r.itemSum)}${flag}  `)
    } else if (r.itemSum != null) {
      out.push(`**Item sum:** ${money(r.itemSum)} (no parsed receipt total)  `)
    }
    out.push(`**Items:** ${r.compareCount} compare · ${r.skipCount} skip · ${r.matchedCount}/${r.compareCount} matched${r.heuristicFallback ? ' · [HEURISTIC-FALLBACK fired]' : ''}  `)
    out.push(`**Would write:** ${r.storeOk
      ? `receipt + ${r.itemCount} line items + ${r.expectedObs} price observations`
      : `receipt + line items only — no observations (store unresolved)`
    }`)
    out.push(``)

    // Item table — LLM column shows what the reviewer did:
    //   CONFIRM      = matcher's top-1 was right (no change)
    //   SWITCH→<id>  = LLM picked a different canonical from the catalog
    //   REJECT→Q     = LLM proposed a new canonical, queued for review
    //   —            = item wasn't reviewed (skip type, or LLM disabled)
    out.push(`| # | Type | Raw text | Desc | Qty | Unit | Shelf | Member | Match | Score | LLM | Reason |`)
    out.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`)
    for (const it of r.items) {
      const m = it.match
      const matchStr = m
        ? `${m.name} (id ${m.canonical_id}${m.package_size != null && m.package_unit ? `, ${m.package_size} ${m.package_unit}` : ''}${m.is_proposed ? ' [PROPOSED]' : ''})`
        : '(no match)'
      const score = m ? scoreFlag(m.score) : '—'
      const llm = m?.review_decision
        ? (m.review_decision === 'confirm' ? 'CONFIRM'
          : m.review_decision === 'switch' ? `SWITCH→${m.canonical_id}`
          : m.review_decision === 'reject' ? 'REJECT→Q' : '—')
        : '—'
      const reason = m?.llm_reason ? cell(m.llm_reason) : ''
      out.push(
        `| ${it.idx} | ${it.item_type} ` +
        `| ${cell(it.raw_text)} ` +
        `| ${cell(it.description)} ` +
        `| ${it.quantity ?? ''} ` +
        `| ${it.unit ?? ''} ` +
        `| ${money(it.shelf_price)} ` +
        `| ${money(it.member_price)} ` +
        `| ${cell(matchStr)} ` +
        `| ${score} ` +
        `| ${llm} ` +
        `| ${reason} |`
      )
    }

    // Show top-K candidates the matcher offered for items where the LLM
    // switched or rejected — this is where the user spots "matcher gave only
    // trash" cases that warrant tuning the matcher itself.
    const interesting = r.items.filter((it) =>
      it.match?.review_decision === 'switch' || it.match?.review_decision === 'reject'
    )
    if (interesting.length > 0) {
      out.push(``)
      out.push(`<details><summary>Matcher's top-${(interesting[0].candidates ?? []).length || 5} candidates for switched/rejected items</summary>`)
      out.push(``)
      for (const it of interesting) {
        out.push(`**Item ${it.idx} \`${cell(it.description ?? it.raw_text)}\`** — LLM ${it.match.review_decision}ed`)
        for (const c of it.candidates ?? []) {
          const sz = c.package_size != null && c.package_unit ? `${c.package_size} ${c.package_unit}` : 'no pack'
          out.push(`- id=${c.canonical_id} "${c.name}" (${sz}) score=${(c.score ?? 0).toFixed(2)}`)
        }
        out.push(``)
      }
      out.push(`</details>`)
    }
    out.push(``)
  }

  // Trailing note about how to commit the queue.
  if (queue.length > 0) {
    out.push(`---`)
    out.push(``)
    out.push(`## Next steps for the queue`)
    out.push(``)
    out.push(`The proposed canonicals above are in-memory only. To commit them you can either:`)
    out.push(`1. Hand-edit the JSON dump (\`tmp/import-dry-run-<ts>.json\` → \`proposalQueue\`) to keep only what you want, then we can wire a \`--commit-queued\` flag to insert them.`)
    out.push(`2. Write a quick SQL migration that inserts the approved subset into \`canonical_products\`, then re-run \`generate-embeddings.mjs\` followed by a non-dry import.`)
    out.push(``)
  }

  return out.join('\n')
}

function collectRedFlags(rows) {
  const flags = []
  for (const r of rows) {
    if (r.error || r.status === 'parse failed') {
      flags.push({ severity: 'ERROR', file: r.file, message: `parse failed: ${r.error ?? 'unknown'}` })
      continue
    }
    if (r.status?.startsWith('skipped')) continue

    if (r.storeOk === false) {
      flags.push({ severity: 'ERROR', file: r.file, message: `store unresolved (${r.storeReason ?? 'no reason'}) — would import without price observations` })
    }
    if (r.itemSum != null && r.receiptTotal != null) {
      const diff = r.receiptTotal - r.itemSum
      if (Math.abs(diff) > 0.05) {
        flags.push({ severity: 'WARN', file: r.file, message: `receipt total ${money(r.receiptTotal)} vs item sum ${money(r.itemSum)} (Δ ${money(diff)})` })
      }
    }
    if (r.itemCount === 0) {
      flags.push({ severity: 'WARN', file: r.file, message: `0 items parsed — GPT failed silently AND heuristic fallback didn't recover any items either; receipt is unusable for observations` })
    }
    if (r.heuristicFallback) {
      flags.push({ severity: 'INFO', file: r.file, message: `heuristic-parser fallback fired (GPT returned 0 items; recovered ${r.itemCount} via Vision OCR + parse.mjs)` })
    }
    const unmatched = (r.compareCount ?? 0) - (r.matchedCount ?? 0)
    if (unmatched > 0) {
      flags.push({ severity: 'INFO', file: r.file, message: `${unmatched} unmatched compare item(s) — would import as line_items only, no observations` })
    }
    for (const it of r.items ?? []) {
      if (it.match && it.match.score < 0.50 && !it.match.review_decision) {
        flags.push({ severity: 'WARN', file: r.file, message: `low-confidence match (${it.match.score.toFixed(2)}): "${it.description}" → ${it.match.name}` })
      }
      if (it.match?.review_decision === 'switch') {
        // LLM overrode the matcher — surface so user can verify the matcher
        // wasn't right after all (or the LLM made things worse).
        flags.push({ severity: 'INFO', file: r.file, message: `LLM switched item ${it.idx} "${it.description}" → ${it.match.name} (matcher's top-1 was different) — ${it.match.llm_reason ?? 'no reason given'}` })
      }
      if (it.match?.review_decision === 'reject') {
        flags.push({ severity: 'INFO', file: r.file, message: `LLM rejected matcher candidates for item ${it.idx} "${it.description}" → proposed new canonical "${it.match.name}"` })
      }
      if (it.item_type === 'compare') {
        const s = Number(it.shelf_price)
        const m = Number(it.member_price)
        if (!Number.isFinite(s) || s <= 0) {
          flags.push({ severity: 'WARN', file: r.file, message: `item ${it.idx} "${it.description}" has shelf_price=${it.shelf_price}` })
        }
        if (Number.isFinite(s) && Number.isFinite(m) && m > s + 0.01) {
          flags.push({ severity: 'WARN', file: r.file, message: `item ${it.idx} "${it.description}" — member ${money(m)} > shelf ${money(s)} (parser likely confused tiers)` })
        }
      }
    }
    if (r.reviewSummary?.failed) {
      flags.push({ severity: 'WARN', file: r.file, message: `LLM review call failed (${r.reviewSummary.errMsg ?? 'unknown'}); fell back to matcher-only — items in this receipt may carry the original mistakes` })
    }
    if ((r.reviewSummary?.hallucinated ?? 0) > 0) {
      flags.push({ severity: 'WARN', file: r.file, message: `LLM returned ${r.reviewSummary.hallucinated} canonical_id(s) not in the catalog — those items kept matcher's top-1 instead` })
    }
  }
  // Order: ERROR > WARN > INFO; within same severity, alphabetical by file
  const sev = { ERROR: 0, WARN: 1, INFO: 2 }
  return flags.sort((a, b) => sev[a.severity] - sev[b.severity] || a.file.localeCompare(b.file))
}

function anchor(filename) {
  return filename.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '')
}

function cell(s) {
  if (s == null) return ''
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 80)
}

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`
}

function scoreFlag(score) {
  const s = score.toFixed(2)
  if (score < 0.50) return `${s} [LOW]`
  if (score < 0.65) return `${s} [MED]`
  return s
}
