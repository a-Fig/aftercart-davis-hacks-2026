/**
 * Derive equivalence groups from Open Food Facts metadata for barcodes that
 * have at least one observation in the `prices` table.
 *
 * The job: bucket priced barcodes into equivalence groups so /api/compare can
 * fall back to "same-category" hits when the user's exact barcode isn't priced
 * nearby. Per-unit pricing makes pack-size constraints unnecessary — a 3.5 oz
 * bar at $0.62/oz vs a 1 lb bar at $1.43/oz is a meaningful comparison; the
 * UI shows $/oz and the user decides if the larger pack is worth the trip.
 *
 * Three derivation rules:
 *
 *   1. Same primary category, different brand
 *      strength 0.85 — confident cross-brand swap within the same product type
 *      (e.g., Lucerne whole milk ↔ 365 whole milk; Kirkland peanut butter ↔
 *      Skippy peanut butter)
 *
 *   2. Same primary category, same brand
 *      strength 1.0 — same product line; only difference is pack size
 *      (e.g., Kirkland PB 28oz ↔ Kirkland PB 48oz). UI normalizes per-unit.
 *
 *   3. Same top-3 category levels, different brand (broader bucket)
 *      strength 0.70 — looser cross-category claim for cases where the OFF
 *      taxonomy has the user's exact category undersampled. Surfaced with
 *      lower confidence in the UI.
 *
 * Only barcodes that appear in `prices` are eligible — there's no point
 * grouping barcodes nobody has observed, since they'll never be the fallback
 * for anything.
 *
 * NOTE: pack-size constraints have been removed (changed 2026-05-09). The UI
 * surfaces $/oz savings on every row; users decide if a larger pack is worth
 * it. Larger groups result; cap is per-rule.
 *
 * Usage:
 *   node web/scripts/derive-equivalences.mjs                  # full pass
 *   node web/scripts/derive-equivalences.mjs --dry-run        # report only
 *   node web/scripts/derive-equivalences.mjs --replace        # delete derived groups first
 *   node web/scripts/derive-equivalences.mjs --limit 50       # process first N priced barcodes (testing)
 *
 * Idempotent: emitted rows use ON CONFLICT DO NOTHING against the partial
 * unique index on equivalence_group_members. With --replace, existing
 * source='derived' groups are wiped first so the run is fully reproducible.
 */

import { createClient } from './seed-utils.mjs'
import { openOff } from '../lib/off/query.mjs'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const REPLACE = args.includes('--replace')
const limitFlagIdx = args.indexOf('--limit')
const LIMIT = limitFlagIdx >= 0 ? parseInt(args[limitFlagIdx + 1], 10) : null

// Per-rule member caps. Without pack-size narrowing, primary-category
// buckets can be large ("snack bars" -> dozens of barcodes); we cap to keep
// the equivalence_group_members table from exploding. The query layer
// further narrows to "in radius" + "cheapest per chain", so a cap of 50-100
// is plenty to surface the relevant peers per user pick.
const RULE1_CAP = 50  // cross-brand same primary category
const RULE2_CAP = 30  // same brand pack variants (typically smaller)
const RULE3_CAP = 80  // looser top-3 fallback

// ── brand normalization ───────────────────────────────────────────────────
// OFF's `brands` is freeform comma-separated; collapse to a stable token set.
function normalizeBrand(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function primaryBrand(brandsRaw) {
  const s = normalizeBrand(brandsRaw)
  if (!s) return null
  return s.split(',')[0].trim() || null
}

// ── category helpers ──────────────────────────────────────────────────────
// OFF categories come back as ordered tags ('en:beverages', 'en:dairies', ...).
// "Primary category" = the most specific tag (last in the list); "first 3
// levels" gives a coarser bucket so we don't miss obvious neighbors.

function primaryCategoryOf(tags) {
  if (!tags || !tags.length) return null
  return tags[tags.length - 1]
}
function topLevelsOf(tags, n = 3) {
  if (!tags || !tags.length) return []
  return tags.slice(0, n)
}
function topLevelsKey(tags, n = 3) {
  return topLevelsOf(tags, n).join('|')
}

// ── main ──────────────────────────────────────────────────────────────────

const c = createClient()
await c.connect()

const off = openOff()

let groupsCreated = 0
let membersInserted = 0
let barcodesProcessed = 0
let barcodesSkippedNoCategories = 0
let barcodesSkippedNoOff = 0

await main()

async function main() {
  try {
    // ── 1. Pull priced barcodes ───────────────────────────────────────────
    console.log('Fetching priced barcodes from prices table…')
    const pricedRes = await c.query(
      `SELECT DISTINCT barcode FROM prices WHERE barcode IS NOT NULL ORDER BY barcode${LIMIT ? ` LIMIT ${LIMIT}` : ''}`
    )
    const pricedBarcodes = pricedRes.rows.map(r => r.barcode)
    console.log(`  ${pricedBarcodes.length} distinct barcodes have observations.`)

    if (!pricedBarcodes.length) {
      console.log('Nothing to do — no priced barcodes.')
      return
    }

    // ── 2. Bulk-load OFF metadata for those barcodes ──────────────────────
    console.log('Loading OFF product metadata…')
    const productByBarcode = new Map()  // canonical OFF barcode → product row
    const offLookup = new Map()         // priced barcode → OFF barcode

    // OFF stores canonical 13-digit codes; receipts/scrapers may strip a leading
    // zero. Try the priced barcode plus its ±-leading-zero variants.
    const stmtProduct = off.prepare(`
      SELECT barcode, product_name, brands
      FROM products WHERE barcode = ? LIMIT 1
    `)
    for (const bc of pricedBarcodes) {
      const cands = [bc, bc.replace(/^0+/, ''), '0' + bc]
      let found = null
      for (const cand of cands) {
        if (!cand) continue
        found = stmtProduct.get(cand)
        if (found) break
      }
      if (!found) { barcodesSkippedNoOff++; continue }
      productByBarcode.set(found.barcode, found)
      offLookup.set(bc, found.barcode)
    }
    console.log(`  Found OFF metadata for ${productByBarcode.size} of ${pricedBarcodes.length} priced barcodes.`)

    // Bulk-load category tags for those products
    const offBarcodes = Array.from(productByBarcode.keys())
    const categoryByBarcode = new Map()
    if (offBarcodes.length) {
      // SQLite parameter limit is typically ~999; chunk if needed.
      const CHUNK = 500
      for (let i = 0; i < offBarcodes.length; i += CHUNK) {
        const slice = offBarcodes.slice(i, i + CHUNK)
        const placeholders = slice.map(() => '?').join(',')
        const catRows = off.prepare(
          `SELECT barcode, category FROM product_categories WHERE barcode IN (${placeholders})`
        ).all(...slice)
        for (const r of catRows) {
          if (!categoryByBarcode.has(r.barcode)) categoryByBarcode.set(r.barcode, [])
          categoryByBarcode.get(r.barcode).push(r.category)
        }
      }
    }

    // ── 3. Build per-barcode signal record ────────────────────────────────
    const records = []
    for (const pricedBc of pricedBarcodes) {
      const offBc = offLookup.get(pricedBc)
      if (!offBc) continue
      const product = productByBarcode.get(offBc)
      barcodesProcessed++

      const tags = categoryByBarcode.get(offBc) || []
      if (!tags.length) { barcodesSkippedNoCategories++; continue }

      records.push({
        barcode: pricedBc,
        offBarcode: offBc,
        name: product.product_name || '',
        brand: primaryBrand(product.brands),
        primaryCat: primaryCategoryOf(tags),
        top3Key: topLevelsKey(tags, 3),
        tags,
      })
      if (barcodesProcessed % 1000 === 0) {
        console.log(`  …processed ${barcodesProcessed} priced barcodes`)
      }
    }
    console.log(`Usable records after filtering: ${records.length}`)

    // ── 4. Bucket records and emit groups for each derivation rule ────────
    const emittedGroups = []

    // Bucket by primary category (drives rules 1 + 2).
    const byPrimary = new Map()
    for (const r of records) {
      if (!byPrimary.has(r.primaryCat)) byPrimary.set(r.primaryCat, [])
      byPrimary.get(r.primaryCat).push(r)
    }

    // Rule 1 — same primary category, different brand. Cap RULE1_CAP.
    for (const [primaryCat, recs] of byPrimary) {
      if (recs.length < 2) continue

      // Need at least 2 distinct brand tokens (treating unknown as its own).
      const brandTokens = new Set()
      for (const r of recs) brandTokens.add(r.brand || '__unknown__')
      if (brandTokens.size < 2) continue

      const cap = recs.slice(0, RULE1_CAP)
      const repName = (cap[0].name || primaryCat || 'equivalence group').trim()
      emittedGroups.push({
        name: `${truncate(repName, 60)} (cross-brand)`,
        description: `Derived rule 1: same primary category (${primaryCat}); brand differs.`,
        strength: 0.85,
        members: dedupe(cap.map(r => r.barcode)),
      })
    }

    // Rule 2 — same brand within a primary category. Sub-bucket each primary
    // category by brand and emit a per-brand group when it has ≥2 members.
    for (const [primaryCat, recs] of byPrimary) {
      const byBrand = new Map()
      for (const r of recs) {
        if (!r.brand) continue
        if (!byBrand.has(r.brand)) byBrand.set(r.brand, [])
        byBrand.get(r.brand).push(r)
      }
      for (const [brand, brandRecs] of byBrand) {
        if (brandRecs.length < 2) continue
        const cap = brandRecs.slice(0, RULE2_CAP)
        const repName = (cap[0].name || `${brand} ${primaryCat}` || 'brand group').trim()
        emittedGroups.push({
          name: `${truncate(repName, 60)} (same brand variants)`,
          description: `Derived rule 2: same brand "${brand}" + same primary category (${primaryCat}).`,
          strength: 1.0,
          members: dedupe(cap.map(r => r.barcode)),
        })
      }
    }

    // Rule 3 — broader top-3 category bucket, different brand.
    // Catches cases where the OFF taxonomy has many narrow primary categories
    // that should be considered together (e.g. "en:dark-chocolate-bars-with-nuts"
    // and "en:dark-chocolate-bars-with-fruit" both roll up to "en:dark-chocolate-bars").
    const byTop3 = new Map()
    for (const r of records) {
      if (!byTop3.has(r.top3Key)) byTop3.set(r.top3Key, [])
      byTop3.get(r.top3Key).push(r)
    }
    for (const [top3Key, recs] of byTop3) {
      if (recs.length < 2) continue
      const brandTokens = new Set()
      for (const r of recs) brandTokens.add(r.brand || '__unknown__')
      if (brandTokens.size < 2) continue

      const cap = recs.slice(0, RULE3_CAP)
      const repName = (cap[0].name || top3Key || 'equivalence group').trim()
      emittedGroups.push({
        name: `${truncate(repName, 60)} (broader category)`,
        description: `Derived rule 3: same top-3 category levels (${top3Key}); brand differs.`,
        strength: 0.70,
        members: dedupe(cap.map(r => r.barcode)),
      })
    }

    console.log(`\nEmitted groups (pre-write):`)
    console.log(`  Rule 1 (same primary cat, different brand):  ${emittedGroups.filter(g => g.strength === 0.85).length}`)
    console.log(`  Rule 2 (same brand variants):               ${emittedGroups.filter(g => g.strength === 1.0).length}`)
    console.log(`  Rule 3 (top-3 cat, different brand):        ${emittedGroups.filter(g => g.strength === 0.70).length}`)
    console.log(`  Total groups: ${emittedGroups.length}`)
    console.log(`  Total members across groups: ${emittedGroups.reduce((s, g) => s + g.members.length, 0)}`)

    if (DRY_RUN) {
      console.log('\n--dry-run set; no writes.')
      return
    }

    // ── 5. Write to Postgres in one transaction ─────────────────────────────
    console.log('\nWriting to Postgres…')
    await c.query('BEGIN')

    if (REPLACE) {
      console.log('  --replace: deleting existing source=\'derived\' groups…')
      const del = await c.query(
        `DELETE FROM equivalence_groups WHERE source = 'derived' RETURNING group_id`
      )
      console.log(`    removed ${del.rowCount} derived groups (members cascade).`)
    }

    const insertGroupSql = `
      INSERT INTO equivalence_groups (name, description, source)
      VALUES ($1, $2, 'derived')
      RETURNING group_id
    `
    const insertMemberSql = `
      INSERT INTO equivalence_group_members
        (group_id, member_kind, barcode, equivalence_strength, notes)
      VALUES ($1, 'barcode', $2, $3, $4)
      ON CONFLICT (group_id, barcode) WHERE member_kind = 'barcode'
      DO NOTHING
      RETURNING member_id
    `

    for (const g of emittedGroups) {
      const grp = await c.query(insertGroupSql, [g.name, g.description])
      const groupId = grp.rows[0].group_id
      groupsCreated++
      for (const bc of g.members) {
        const m = await c.query(insertMemberSql, [groupId, bc, g.strength, g.description])
        if (m.rowCount > 0) membersInserted++
      }
    }

    await c.query('COMMIT')
    console.log('  COMMIT ok.')
  } catch (err) {
    try { await c.query('ROLLBACK') } catch { /* ignore */ }
    console.error('FAILED:', err)
    throw err
  } finally {
    off.close()
    await c.end()
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────────────────')
console.log('Summary')
console.log('────────────────────────────────────────────────────')
console.log(`  Barcodes processed:                ${barcodesProcessed}`)
console.log(`  Barcodes skipped (no OFF metadata): ${barcodesSkippedNoOff}`)
console.log(`  Barcodes skipped (no categories):  ${barcodesSkippedNoCategories}`)
if (!DRY_RUN) {
  console.log(`  Groups created:                    ${groupsCreated}`)
  console.log(`  Members inserted:                  ${membersInserted}`)
} else {
  console.log('  (dry-run — no rows written)')
}

// ── Helpers ───────────────────────────────────────────────────────────────
function truncate(s, n) {
  const t = String(s || '').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
function dedupe(arr) {
  return Array.from(new Set(arr))
}
