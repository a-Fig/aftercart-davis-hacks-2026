/**
 * POST /contribute/api/upload
 *
 * Web equivalent of `web/scripts/import-receipts.mjs` — accepts a single
 * receipt photo via multipart/form-data, runs the same OCR + parse + match +
 * (optional) LLM-review pipeline, persists to GCS + the price-observations
 * graph, and returns a structured per-item summary the UI can render.
 *
 * Auth gate: `inspector_session` cookie must equal INSPECTOR_PASSWORD.
 * inspectorGuard() can't be reused here because it issues a redirect, which
 * is wrong for an API route — we want a 401 JSON response. The cookie value
 * compare is identical to lib/inspector/auth.ts.
 *
 * Pipeline (mirrors scripts/import-receipts.mjs — keep them in sync):
 *   1. Auth check
 *   2. multipart parse, content-type/size validation
 *   3. SHA-256 of bytes; dedup against receipts.image_hash
 *   4. Upload to GCS (<bucket>/<sha256>.<ext>)
 *   5. Vision OCR + heuristic parse → chain hint
 *   6. processReceipt() (Vertex AI Gemini, cached by image hash)
 *   7. identifyStore() — chain + store fuzzy match
 *   8. matchItems(parsed.items, { topK: 5 })
 *   9. (opt-in via ?review=true) reviewReceipt() — Gemini-backed review pass
 *  10. Transactional INSERT into receipts + receipt_line_items + (when store
 *      resolved + match present) store_skus + price_observations
 *  11. REFRESH MATERIALIZED VIEW current_prices when any obs got inserted
 *
 * Response shape — kept verbose on purpose so the UI can render rich per-item
 * detail without a second round-trip.
 */

import { NextRequest } from 'next/server'
import { createHash } from 'crypto'

import { getPool, query } from '@/lib/receipts/db.mjs'
import { parseReceipt } from '@/lib/receipts/parse.mjs'
import { processReceipt } from '@/lib/receipts/gpt-parser.mjs'
import { visionAnnotate, extractText } from '@/lib/receipts/vision.mjs'
import { matchItems } from '@/lib/receipts/match.mjs'
import { identifyStore } from '@/lib/receipts/identify-store.mjs'
import { reviewReceipt } from '@/lib/receipts/llm-reviewer.mjs'
import { uploadReceiptImage } from '@/lib/storage/receipts.mjs'
import { INSPECTOR_COOKIE } from '@/lib/inspector/auth'

export const runtime = 'nodejs'
export const maxDuration = 60

// .mjs imports are typed `unknown`/`object` in strict mode — narrow at the
// call sites with these locally-defined shapes so we don't scatter `as any`.
type ParsedItem = {
  raw_text?: string
  description?: string
  code?: string | null
  quantity?: number | null
  unit?: string | null
  shelf_price?: number | null
  member_price?: number | null
  is_store_brand?: boolean | null
  item_type?: 'compare' | 'contribute' | 'skip'
}
type Match = {
  canonical_id: number
  name: string
  brand: string | null
  package_size: number | null
  package_unit: string | null
  pricing_unit: string
  score: number
  match_type?: string | null
  review_decision?: string | null
  llm_reason?: string | null
  is_proposed?: boolean
}
type MatchedRow = {
  item: ParsedItem
  match: Match | null
  candidates: Array<Match>
}
type StoreMatch = {
  chain_id: number | null
  store_id: number | null
  chain_name: string | null
  address: string | null
  reason: string | null
}

// ── Inline auth (no redirect — JSON 401 instead) ────────────────────────────

async function isAuthed(req: NextRequest): Promise<boolean> {
  const expected = process.env.INSPECTOR_PASSWORD
  if (!expected) return false
  const got = req.cookies.get(INSPECTOR_COOKIE)?.value
  return typeof got === 'string' && got === expected
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Vision is required; the LLM reviewer doesn't need a key under Vertex
  // (ADC), so we don't gate on OPENROUTER_KEY anymore.
  const visionKey = process.env.GOOGLE_VISION_API_KEY
  if (!visionKey) {
    return Response.json(
      { error: 'Server missing GOOGLE_VISION_API_KEY' },
      { status: 500 },
    )
  }

  // Multipart parse.
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    return Response.json(
      { error: `Invalid multipart body: ${(err as Error).message}` },
      { status: 400 },
    )
  }

  const file = formData.get('image')
  if (!(file instanceof File)) {
    return Response.json(
      { error: 'Form field "image" must be a file' },
      { status: 400 },
    )
  }
  if (!file.type || !file.type.startsWith('image/')) {
    return Response.json(
      { error: `Unexpected content-type "${file.type || 'unknown'}" — expected image/*` },
      { status: 400 },
    )
  }

  // Decide whether to invoke the LLM review pass. Default OFF to keep latency
  // tight for the first contribution; users can opt in when accuracy matters.
  const url = new URL(req.url)
  const review = url.searchParams.get('review') === 'true'

  const bytes = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(bytes).digest('hex')

  // Dedup: same image hash → return existing receipt, skip the rest. This
  // mirrors the import-receipts.mjs short-circuit. We still upload the bytes
  // (idempotent — the storage helper no-ops when the object already exists)
  // so the canonical bucket layout stays in sync even when somebody manually
  // deleted a row from `receipts` but left the GCS object.
  const dupRows = (await query(
    `SELECT receipt_id, store_id, inferred_chain_id, line_count
       FROM receipts WHERE image_hash = $1 LIMIT 1`,
    [hash],
  )) as Array<{
    receipt_id: string
    store_id: number | null
    inferred_chain_id: number | null
    line_count: number | null
  }>
  if (dupRows.length > 0) {
    let gsUri: string | null = null
    try {
      const upload = await uploadReceiptImage(bytes, file.type, hash)
      gsUri = upload.gsUri
    } catch (err) {
      // Storage errors during a dedup re-upload are non-fatal — we already
      // know the receipt exists; surface as a warning in the response.
      console.warn('[contribute/upload] dedup re-upload failed:', (err as Error).message)
    }
    return Response.json({
      ok: true,
      duplicate: true,
      already_processed: true,
      receipt_id: dupRows[0].receipt_id,
      image: { gs_uri: gsUri, sha256: hash, bytes: bytes.length },
    })
  }

  // ── Storage upload ────────────────────────────────────────────────────────
  let gsUri: string
  try {
    const upload = await uploadReceiptImage(bytes, file.type, hash)
    gsUri = upload.gsUri
  } catch (err) {
    return Response.json(
      { error: `GCS upload failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }

  // ── OCR + parse ───────────────────────────────────────────────────────────
  // Run Vision first so we get a chain hint via the heuristic parser; that
  // hint short-circuits processReceipt's chain-detect call and routes to the
  // right store-specific GPT prompt.
  const base64 = bytes.toString('base64')
  let chainHint: string | null = null
  try {
    const visionResp = await visionAnnotate(base64, visionKey)
    const ocrText = extractText(visionResp)
    chainHint = parseReceipt(ocrText)?.store_name ?? null
  } catch (err) {
    console.warn('[contribute/upload] Vision/heuristic failed:', (err as Error).message)
  }

  type ParsedReceipt = {
    store_name?: string | null
    store_address?: string | null
    receipt_date?: string | null
    receipt_total?: number | null
    items?: ParsedItem[]
  }
  let parsed: ParsedReceipt
  try {
    const result = (await processReceipt(base64, undefined, { chainHint })) as {
      parsed: ParsedReceipt
    }
    parsed = result.parsed
  } catch (err) {
    return Response.json(
      { error: 'Receipt parse failed', detail: (err as Error).message },
      { status: 502 },
    )
  }

  // ── Store identification ──────────────────────────────────────────────────
  const pool = getPool()
  // identifyStore takes (db, storeName, storeAddress|null). The parsed shape
  // permits null/undefined for both; coerce to satisfy the .mjs signature.
  const storeMatch = (await identifyStore(
    pool,
    parsed.store_name ?? '',
    parsed.store_address ?? null,
  )) as StoreMatch
  const willPriceObs = !!(storeMatch.chain_id && storeMatch.store_id)

  // ── Match items ───────────────────────────────────────────────────────────
  const matches = (await matchItems(parsed.items ?? [], { topK: 5 })) as MatchedRow[]

  // ── Optional LLM review ───────────────────────────────────────────────────
  // Mirrors import-receipts.mjs's review pass with two simplifications:
  //   - We don't inject queued canonicals into the in-memory catalog (no
  //     downstream receipts in this single-image flow to share them with).
  //   - Rejected items just get their match cleared rather than seeded with
  //     a synthetic-id proposal, since we can't FK-reference an unwritten
  //     canonical from store_skus / price_observations.
  let reviewError: string | null = null
  if (review) {
    try {
      const { getCatalogForReview } = await import('@/lib/receipts/match.mjs')
      const catalog = (await getCatalogForReview()) as Array<{
        canonical_id: number
        name: string
        brand: string | null
        package_size: number | null
        package_unit: string | null
        pricing_unit: string
        category_name: string | null
        is_proposed: boolean
      }>
      const catalogById = new Map(catalog.map((c) => [c.canonical_id, c]))
      const categories = (await query(
        `SELECT category_id, name FROM product_categories`,
      )) as Array<{ category_id: number; name: string }>

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
        const reviewResult = (await reviewReceipt({
          chain_name: storeMatch.chain_name ?? parsed.store_name ?? '',
          items: reviewItems,
          catalog,
          categories,
        })) as {
          decisions: Array<{
            idx: number
            decision: 'confirm' | 'switch' | 'reject'
            canonical_id: number | null
            match_type: 'exact' | 'equivalent' | null
            reason: string
            new_canonical: unknown
            hallucinated: boolean
          }>
        }
        for (const d of reviewResult.decisions) {
          const targetIdx = (Number(d.idx) || 0) - 1
          if (targetIdx < 0 || targetIdx >= matches.length) continue
          const target = matches[targetIdx]
          if (!target || target.item.item_type !== 'compare') continue

          if (d.decision === 'confirm') {
            if (target.match) {
              target.match = {
                ...target.match,
                match_type: d.match_type ?? 'exact',
                review_decision: 'confirm',
                llm_reason: d.reason,
              }
            }
          } else if (d.decision === 'switch' && d.canonical_id != null) {
            const cat = catalogById.get(d.canonical_id)
            if (cat) {
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
            }
          } else if (d.decision === 'reject') {
            // Without a synthetic-canonical injection path, the safest move
            // is to drop the match — the line item still gets persisted as
            // an unmatched compare row for later disambiguation.
            target.match = null
          }
        }
      }
    } catch (err) {
      reviewError = (err as Error).message
      console.warn('[contribute/upload] LLM review failed:', reviewError)
    }
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  // One transaction per receipt — partial DB errors don't leave half-inserted
  // rows behind. We grab a dedicated client off the pool so BEGIN/COMMIT
  // doesn't fight other concurrent queries on the same pooled connection.
  const client = await pool.connect()
  let receiptId: string
  let observationsInserted = 0
  let totalExtracted = 0
  try {
    await client.query('BEGIN')

    const receiptRes = (await client.query(
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
    )) as { rows: Array<{ receipt_id: string }> }
    receiptId = receiptRes.rows[0].receipt_id

    for (let i = 0; i < matches.length; i++) {
      const { item, match } = matches[i]
      const isProposed =
        match?.is_proposed === true ||
        (typeof match?.canonical_id === 'number' && match.canonical_id < 0)

      // store_sku resolve / insert (chain-wide; one per chain × canonical pair)
      let storeSkuId: number | null = null
      if (match && !isProposed && willPriceObs) {
        const skuRes = (await client.query(
          `WITH ins AS (
             INSERT INTO store_skus
               (chain_id, store_id, canonical_id, receipt_text_canonical,
                display_name, status, confidence, verified_at, verified_by)
             VALUES ($1, NULL, $2, $3, $3, 'verified', $4, NOW(), 'contribute_web')
             ON CONFLICT (chain_id, receipt_text_canonical) DO NOTHING
             RETURNING store_sku_id
           )
           SELECT store_sku_id FROM ins
           UNION ALL
           SELECT store_sku_id FROM store_skus
           WHERE chain_id = $1 AND receipt_text_canonical = $3
           LIMIT 1`,
          [
            storeMatch.chain_id,
            match.canonical_id,
            match.name,
            Math.min(0.99, match.score),
          ],
        )) as { rows: Array<{ store_sku_id: number }> }
        storeSkuId = skuRes.rows[0]?.store_sku_id ?? null
      }

      // Always persist the line item — gives us a record for later
      // disambiguation even when the match failed.
      await client.query(
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
          !match || (match?.score ?? 0) < 0.5,
        ],
      )

      // Skip-type lines (bag fees / bottle deposits) don't go to extracted total.
      if (item.item_type !== 'skip') {
        totalExtracted += Number(item.member_price ?? item.shelf_price ?? 0) || 0
      }

      // Price observations — same logic as import-receipts.mjs.
      if (
        item.item_type === 'compare' &&
        match &&
        willPriceObs &&
        storeSkuId &&
        Number(item.shelf_price) > 0
      ) {
        const productInfo = (await client.query(
          `SELECT package_unit, pricing_unit FROM canonical_products WHERE canonical_id = $1`,
          [match.canonical_id],
        )) as { rows: Array<{ package_unit: string | null; pricing_unit: string | null }> }
        const { package_unit, pricing_unit } = productInfo.rows[0] ?? {
          package_unit: null,
          pricing_unit: null,
        }

        const observedAtSql = parsed.receipt_date
          ? `'${parsed.receipt_date}'::date`
          : 'NOW()'

        const obsQty = Number(item.quantity ?? 1) || 1
        const shelfPerUnit =
          obsQty > 0 ? Number(item.shelf_price) / obsQty : Number(item.shelf_price)

        await client.query(
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
              ${observedAtSql}, 'receipt', 'shelf', $10,
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
            Math.min(0.95, 0.5 + (match.score ?? 0) * 0.5),
            receiptId,
          ],
        )
        observationsInserted++

        if (
          Number(item.member_price) > 0 &&
          Number(item.member_price) < Number(item.shelf_price)
        ) {
          const memberPerUnit =
            obsQty > 0 ? Number(item.member_price) / obsQty : Number(item.member_price)
          await client.query(
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
                ${observedAtSql}, 'receipt', 'member', $10,
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
          observationsInserted++
        }
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore double-fault
    }
    return Response.json(
      { error: 'DB write failed', detail: (err as Error).message },
      { status: 500 },
    )
  } finally {
    client.release()
  }

  // Refresh current_prices materialized view so the new observations show up
  // in /api/compare without waiting for the scheduler. CONCURRENTLY first,
  // fall back to a blocking refresh if the unique index isn't in place yet.
  if (observationsInserted > 0) {
    try {
      await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices`)
    } catch {
      try {
        await query(`REFRESH MATERIALIZED VIEW current_prices`)
      } catch (err) {
        console.warn('[contribute/upload] matview refresh failed:', (err as Error).message)
      }
    }
  }

  // ── Compose response ─────────────────────────────────────────────────────
  const compareCount = matches.filter((m) => m.item.item_type === 'compare').length
  const matchedCount = matches.filter(
    (m) => m.item.item_type === 'compare' && m.match,
  ).length

  return Response.json({
    ok: true,
    duplicate: false,
    receipt_id: receiptId,
    image: {
      gs_uri: gsUri,
      sha256: hash,
      bytes: bytes.length,
    },
    store: storeMatch.chain_id
      ? {
          chain_id: storeMatch.chain_id,
          chain_name: storeMatch.chain_name,
          store_id: storeMatch.store_id,
          store_address: storeMatch.address,
          reason: storeMatch.reason,
        }
      : null,
    summary: {
      items_total: matches.length,
      items_compared: compareCount,
      items_matched: matchedCount,
      items_unmatched: compareCount - matchedCount,
      observations_inserted: observationsInserted,
      total_extracted: Number(totalExtracted.toFixed(2)),
    },
    items: matches.map((m, idx) => ({
      idx: idx + 1,
      raw_text: m.item.raw_text ?? null,
      description: m.item.description ?? null,
      item_type: m.item.item_type ?? null,
      parsed_quantity: m.item.quantity ?? null,
      parsed_unit: m.item.unit ?? null,
      parsed_price_total: m.item.member_price ?? m.item.shelf_price ?? null,
      shelf_price: m.item.shelf_price ?? null,
      member_price: m.item.member_price ?? null,
      match: m.match
        ? {
            canonical_id: m.match.canonical_id,
            name: m.match.name,
            score: Number((m.match.score ?? 0).toFixed(3)),
            review_decision: m.match.review_decision ?? null,
            llm_reason: m.match.llm_reason ?? null,
          }
        : null,
    })),
    review: review
      ? { ran: true, error: reviewError }
      : { ran: false, error: null },
  })
}
