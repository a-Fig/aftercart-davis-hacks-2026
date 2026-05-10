/**
 * Enrich the 939 curated canonicals with Open Food Facts UPCs by cross-
 * referencing names/brands/sizes against the local OFF SQLite. Populates the
 * `canonical_barcodes` table so /api/compare can attach OFF enrichment
 * (image, ingredients, allergens, Nutri-Score, NOVA, nutriments) to comparison
 * responses.
 *
 *   node web/scripts/enrich-canonicals-from-off.mjs                 # dry-run report
 *   node web/scripts/enrich-canonicals-from-off.mjs --apply         # write to canonical_barcodes
 *   node web/scripts/enrich-canonicals-from-off.mjs --priced-only   # restrict candidates to barcodes
 *                                                                    that have ≥1 row in `prices`.
 *                                                                    Critical for the bc variant — without
 *                                                                    this, the bridge points at OFF
 *                                                                    products that have zero price data.
 *   node web/scripts/enrich-canonicals-from-off.mjs --limit 50      # only process N canonicals
 *
 * Strategy:
 *   1. For each canonical, build an FTS query from name + brand
 *   2. Pull top-N OFF candidates via FTS5 BM25 (25 default, 250 in --priced-only mode
 *      since most FTS hits will get filtered out by the priced-set intersection)
 *   3. (--priced-only) drop candidates whose barcode isn't in the priced set
 *   4. Score remaining candidates on:
 *      - Trigram similarity vs canonical name      (40%)
 *      - Brand match (exact / contains / none)     (25%)
 *      - Pack size dimensional match               (20%)
 *      - Pack size numeric match (within tolerance)(15%)
 *   5. Accept candidates scoring ≥ threshold — top 3 per canonical
 *      Threshold: 0.65 default, 0.55 in --priced-only mode (the candidate
 *      pool is already pre-filtered to actually-priced barcodes, so a
 *      lower bar still yields reasonable identity matches).
 *
 * Idempotent: ON CONFLICT DO NOTHING. Re-runs add only new (canonical, barcode)
 * pairs. To wipe and rebuild against priced barcodes, run:
 *   node web/scripts/bc-via-proxy.mjs query "TRUNCATE canonical_barcodes"
 *   node web/scripts/enrich-canonicals-from-off.mjs --priced-only --apply
 */

import { createClient } from './seed-utils.mjs'
import { openOff, searchOff } from '../lib/off/query.mjs'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const PRICED_ONLY = args.includes('--priced-only')
const limitFlagIdx = args.indexOf('--limit')
const LIMIT = limitFlagIdx >= 0 ? parseInt(args[limitFlagIdx + 1], 10) : null

const ACCEPT_THRESHOLD = PRICED_ONLY ? 0.55 : 0.65
const TOP_PER_CANONICAL = 3
const FTS_CANDIDATES = PRICED_ONLY ? 250 : 25

// ── scoring helpers ───────────────────────────────────────────────────────

// Normalize a string for trigram comparison: lowercase, strip non-alphanumeric.
function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function trigramSet(s) {
  const padded = `  ${normalize(s)}  `
  const set = new Set()
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3))
  return set
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function trigramSimilarity(a, b) {
  return jaccard(trigramSet(a), trigramSet(b))
}

function brandMatch(canonicalBrand, offBrands) {
  if (!canonicalBrand) return 0.5  // no brand expected — neutral
  if (!offBrands) return 0.0
  const cb = normalize(canonicalBrand)
  const ob = normalize(offBrands)
  if (!cb || !ob) return 0.0
  if (ob.includes(cb)) return 1.0
  if (cb.includes(ob)) return 0.85  // canonical brand is more specific
  // Token overlap as a softer match
  const cbTokens = new Set(cb.split(/\s+/))
  const obTokens = ob.split(/\s+/)
  const hits = obTokens.filter((t) => cbTokens.has(t)).length
  if (hits) return 0.5
  return 0.0
}

// Convert (value, unit) to a canonical scalar for cross-unit comparison.
function toCanonical(value, unit) {
  if (value == null || !unit) return null
  const u = String(unit).toLowerCase()
  // weight → grams
  if (['lb', 'lbs', 'pound', 'pounds'].includes(u)) return { dim: 'weight', val: value * 453.592 }
  if (['oz', 'ounce', 'ounces'].includes(u)) return { dim: 'weight', val: value * 28.3495 }
  if (u === 'kg') return { dim: 'weight', val: value * 1000 }
  if (u === 'g') return { dim: 'weight', val: value }
  // volume → ml
  if (['fl_oz', 'floz', 'fl oz'].includes(u)) return { dim: 'volume', val: value * 29.5735 }
  if (['gal', 'gallon', 'gallons'].includes(u)) return { dim: 'volume', val: value * 3785.41 }
  if (['quart', 'qt'].includes(u)) return { dim: 'volume', val: value * 946.353 }
  if (['pint', 'pt'].includes(u)) return { dim: 'volume', val: value * 473.176 }
  if (u === 'ml') return { dim: 'volume', val: value }
  if (['l', 'liter', 'liters'].includes(u)) return { dim: 'volume', val: value * 1000 }
  // count
  if (['count', 'ct', 'each', 'pack', 'pk'].includes(u)) return { dim: 'count', val: value }
  return null
}

// Returns 0..1 size match score. Same dimension and within 1.3× scores 1.0;
// 2× scores 0.6; 5× scores 0.2; different dimensions score 0.
function sizeMatch(canonicalSize, canonicalUnit, offSize, offUnit) {
  if (canonicalSize == null) return 0.5  // no size expected — neutral
  if (offSize == null) return 0.3
  const a = toCanonical(canonicalSize, canonicalUnit)
  const b = toCanonical(offSize, offUnit)
  if (!a || !b || a.dim !== b.dim) return 0
  const ratio = Math.max(a.val, b.val) / Math.max(0.0001, Math.min(a.val, b.val))
  if (ratio <= 1.3) return 1.0
  if (ratio <= 2.0) return 0.6
  if (ratio <= 5.0) return 0.2
  return 0
}

function blendedScore({ trigramSim, brand, size }) {
  return trigramSim * 0.40 + brand * 0.25 + size * 0.35
}

// ── main ──────────────────────────────────────────────────────────────────

const c = createClient()
await c.connect()

let offDb
try {
  offDb = openOff()
} catch (err) {
  console.error('OFF SQLite not available:', err.message)
  console.error('Run `node web/scripts/build-off-sqlite.mjs` first.')
  await c.end()
  process.exit(1)
}

console.log(`Loading canonical catalog from Postgres...`)
let canonicalsQuery = `
  SELECT canonical_id, name, brand, package_size, package_unit
  FROM canonical_products
  ORDER BY canonical_id
`
if (LIMIT) canonicalsQuery += ` LIMIT ${LIMIT}`
const { rows: canonicals } = await c.query(canonicalsQuery)
console.log(`  ${canonicals.length} canonicals loaded`)

// Load priced-barcode set when --priced-only is on. Includes leading-zero
// variants so OFF's "0078742370156" matches a priced "78742370156" (and vice
// versa) — OFF is inconsistent about leading zeros and we want maximum hits.
let pricedBarcodeSet = null
if (PRICED_ONLY) {
  console.log(`Loading priced barcodes from Postgres (--priced-only mode)...`)
  const { rows: pricedRows } = await c.query(`SELECT DISTINCT barcode FROM prices`)
  pricedBarcodeSet = new Set()
  for (const r of pricedRows) {
    const bc = String(r.barcode || '').trim()
    if (!bc) continue
    pricedBarcodeSet.add(bc)
    pricedBarcodeSet.add(bc.replace(/^0+/, ''))
    pricedBarcodeSet.add('0' + bc)
  }
  console.log(`  ${pricedRows.length} unique priced barcodes (${pricedBarcodeSet.size} with leading-zero variants)`)
}

// Skip canonicals that already have at least one barcode link (idempotency
// boost — re-running on the same dataset costs almost nothing).
const { rows: existingLinks } = await c.query(
  `SELECT canonical_id, COUNT(*)::int AS n FROM canonical_barcodes GROUP BY canonical_id`,
)
const alreadyLinked = new Map(existingLinks.map((r) => [r.canonical_id, r.n]))

const insertStmt = `
  INSERT INTO canonical_barcodes (canonical_id, barcode, source, confidence)
  VALUES ($1, $2, 'off_curated', $3)
  ON CONFLICT (canonical_id, barcode) DO NOTHING
`

let totalAccepted = 0
let totalCanonicalsWithLinks = 0
let totalSkipped = 0
const acceptanceLog = []

for (let i = 0; i < canonicals.length; i++) {
  const canon = canonicals[i]
  if (alreadyLinked.has(canon.canonical_id)) {
    totalSkipped++
    continue
  }

  // Build a search query — the FTS5 sanitizer in query.mjs expects free text.
  const queryText = [canon.name, canon.brand].filter(Boolean).join(' ')
  if (!queryText.trim()) continue

  let hits
  try {
    hits = searchOff(offDb, queryText, FTS_CANDIDATES)
  } catch (err) {
    console.warn(`  [${canon.canonical_id}] FTS failed: ${err.message}`)
    continue
  }

  // --priced-only: drop candidates whose barcode isn't in the priced set.
  // Whatever survives is guaranteed to yield a price hit downstream when
  // /api/compare bridges canonical → barcode → current_prices.
  if (pricedBarcodeSet) {
    hits = hits.filter(h => pricedBarcodeSet.has(String(h.barcode || '').trim()))
  }

  // Score and rank candidates.
  const scored = []
  for (const h of hits) {
    const trigramSim = Math.max(
      trigramSimilarity(canon.name, h.product_name || ''),
      trigramSimilarity(canon.name, h.generic_name || ''),
    )
    const brand = brandMatch(canon.brand, h.brands)
    const size  = sizeMatch(canon.package_size, canon.package_unit, h.package_size, h.package_unit)
    const score = blendedScore({ trigramSim, brand, size })
    scored.push({ ...h, _trigramSim: trigramSim, _brand: brand, _size: size, _score: score })
  }
  scored.sort((a, b) => b._score - a._score)

  const accepted = scored.filter((s) => s._score >= ACCEPT_THRESHOLD).slice(0, TOP_PER_CANONICAL)
  if (!accepted.length) continue

  totalCanonicalsWithLinks++
  totalAccepted += accepted.length
  acceptanceLog.push({
    canonical: { id: canon.canonical_id, name: canon.name, brand: canon.brand, size: canon.package_size, unit: canon.package_unit },
    accepted: accepted.map((a) => ({
      barcode: a.barcode,
      name: a.product_name,
      brand: a.brands,
      size: a.package_size,
      unit: a.package_unit,
      trigram: Number(a._trigramSim.toFixed(3)),
      brandS: Number(a._brand.toFixed(3)),
      sizeS: Number(a._size.toFixed(3)),
      score: Number(a._score.toFixed(3)),
    })),
  })

  if (APPLY) {
    for (const a of accepted) {
      await c.query(insertStmt, [canon.canonical_id, a.barcode, Number(a._score.toFixed(2))])
    }
  }

  // Progress log every 50 canonicals
  if ((i + 1) % 50 === 0) {
    process.stdout.write(`\r  Processed ${i + 1}/${canonicals.length} — ${totalCanonicalsWithLinks} matched, ${totalAccepted} barcodes      `)
  }
}
process.stdout.write('\r' + ' '.repeat(72) + '\r')

console.log(`\nProcessed ${canonicals.length} canonicals`)
console.log(`  Matched (≥ ${ACCEPT_THRESHOLD}): ${totalCanonicalsWithLinks}`)
console.log(`  Skipped (already linked):  ${totalSkipped}`)
console.log(`  Total barcodes ${APPLY ? 'inserted' : 'would-insert'}: ${totalAccepted}`)

// Sample report
console.log(`\nSample (first 8 matches):`)
for (const entry of acceptanceLog.slice(0, 8)) {
  console.log(`\n  Canonical #${entry.canonical.id}: ${entry.canonical.name}${entry.canonical.brand ? ` (${entry.canonical.brand})` : ''}${entry.canonical.size ? ` — ${entry.canonical.size} ${entry.canonical.unit}` : ''}`)
  for (const a of entry.accepted) {
    console.log(`    [${a.score}] ${a.barcode} — ${a.name || '(no name)'} (${a.brand || '—'})${a.size ? ` ${a.size} ${a.unit}` : ''}`)
    console.log(`           trigram=${a.trigram}  brand=${a.brandS}  size=${a.sizeS}`)
  }
}

if (!APPLY) {
  console.log(`\nDry run — pass --apply to write these to canonical_barcodes.`)
}

offDb.close()
await c.end()
