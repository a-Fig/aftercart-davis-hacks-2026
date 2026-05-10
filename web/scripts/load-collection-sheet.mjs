/**
 * Load manually-collected prices from db/seed/collection-sheet.csv into
 * price_observations. This is the bridge from "I wrote prices on my phone
 * at Nugget" to "the comparison hero card shows real numbers."
 *
 * What it does, per CSV row with a non-empty shelf_price:
 *   1. Look up store_id by (chain_name, external_id stored as store_name col)
 *   2. Look up canonical_id by canonical_product name
 *   3. Find-or-create a chain-wide store_sku (store_id NULL, status='verified')
 *      that links chain_id → canonical_id. We reuse one store_sku per
 *      (chain_id, canonical_id) so multiple stores in the same chain share it.
 *   4. Insert a price_observations row with source='manual', pricing_tier='shelf'.
 *
 * Idempotent: skips a row if a price_observations entry already exists for
 * (store_id, canonical_id, observed_at, source='manual'). Re-running the
 * loader with the same CSV is a no-op once everything is loaded.
 *
 * Run from repo root:
 *   node web/scripts/load-collection-sheet.mjs                     # default csv
 *   node web/scripts/load-collection-sheet.mjs path/to/sheet.csv   # custom
 *   node web/scripts/load-collection-sheet.mjs --replace           # wipe manual obs first
 *   node web/scripts/load-collection-sheet.mjs --dry-run           # parse + validate, no DB writes
 *
 * After running, the current_prices materialized view is refreshed so the
 * API picks up the new prices on the next request.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from './seed-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const DEFAULT_CSV = resolve(ROOT, 'db', 'seed', 'collection-sheet.csv')

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const REPLACE = args.includes('--replace')
const DRY_RUN = args.includes('--dry-run')
const csvArg = args.find((a) => !a.startsWith('--'))
const csvPath = csvArg ? resolve(csvArg) : DEFAULT_CSV

if (!existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`)
  console.error(`Expected at ${DEFAULT_CSV} or pass a path as the first argument.`)
  process.exit(1)
}

// ── CSV parsing ──────────────────────────────────────────────────────────────
// Minimal RFC 4180-ish parser: handles quoted fields, escaped double-quotes
// ("" inside a "..."), and embedded commas. Good enough for the collection
// sheet, which only quotes fields that may contain commas or apostrophes.

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') {
      row.push(field); rows.push(row)
      row = []; field = ''; i++; continue
    }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field); rows.push(row)
  }
  return rows
}

// ── Read + parse ─────────────────────────────────────────────────────────────

console.log(`Reading ${csvPath}...`)
const raw = readFileSync(csvPath, 'utf8')
const rows = parseCsv(raw)
const header = rows.shift()

// Index columns by header name so a column reorder in the CSV doesn't break us.
const col = Object.fromEntries(header.map((name, idx) => [name.trim(), idx]))
const required = [
  'store_name', 'chain_name', 'canonical_product',
  'pricing_unit', 'shelf_price',
]
for (const r of required) {
  if (col[r] === undefined) {
    console.error(`CSV is missing required column: ${r}`)
    console.error(`Header found: ${header.join(', ')}`)
    process.exit(1)
  }
}

// ── Connect ──────────────────────────────────────────────────────────────────

const client = createClient()
await client.connect()

// Optional pre-wipe of manual observations. Use when the CSV is the
// authoritative source and you want to reload from scratch.
if (REPLACE && !DRY_RUN) {
  const { rowCount } = await client.query(`DELETE FROM price_observations WHERE source = 'manual'`)
  console.log(`✓ Removed ${rowCount} existing manual observations`)
}

// Pre-fetch lookup tables so the per-row loop doesn't hammer the DB.
const { rows: chains } = await client.query(`SELECT chain_id, name FROM chains`)
const chainByName = new Map(chains.map((r) => [r.name.toLowerCase(), r.chain_id]))

const { rows: stores } = await client.query(`SELECT store_id, chain_id, external_id FROM stores`)
const storeByKey = new Map(
  stores.map((r) => [storeKey(r.chain_id, r.external_id), r.store_id]),
)

const { rows: products } = await client.query(
  `SELECT canonical_id, name, package_size, package_unit, pricing_unit FROM canonical_products`,
)
const productByName = new Map(products.map((r) => [r.name.toLowerCase(), r]))

function storeKey(chainId, externalId) {
  return `${chainId}::${(externalId ?? '').trim()}`
}

// ── Per-row loop ─────────────────────────────────────────────────────────────

const stats = {
  total: 0,
  skipped_no_price: 0,
  skipped_bad_price: 0,
  skipped_unknown_chain: 0,
  skipped_unknown_store: 0,
  skipped_unknown_product: 0,
  skipped_already_loaded: 0,
  inserted: 0,
}
const warnings = []

for (let lineNo = 0; lineNo < rows.length; lineNo++) {
  const r = rows[lineNo]
  if (r.length < required.length) continue
  stats.total++

  const rawPrice = (r[col.shelf_price] ?? '').trim()
  if (!rawPrice) { stats.skipped_no_price++; continue }

  // Strip a leading $ and any whitespace; reject anything that doesn't parse
  // cleanly as a positive number. Field collectors sometimes write "$3.49"
  // even when the column header doesn't ask for the dollar sign.
  const price = Number(rawPrice.replace(/^\$/, '').replace(/,/g, ''))
  if (!Number.isFinite(price) || price <= 0) {
    stats.skipped_bad_price++
    warnings.push(`row ${lineNo + 2}: bad shelf_price "${rawPrice}"`)
    continue
  }

  const chainName = (r[col.chain_name] ?? '').trim()
  const storeExternal = (r[col.store_name] ?? '').trim()
  const productName = (r[col.canonical_product] ?? '').trim()
  const dateStr = (r[col.date_collected] ?? '').trim()
  const csvPricingUnit = (r[col.pricing_unit] ?? '').trim()

  const chainId = chainByName.get(chainName.toLowerCase())
  if (!chainId) {
    stats.skipped_unknown_chain++
    warnings.push(`row ${lineNo + 2}: unknown chain "${chainName}"`)
    continue
  }
  const storeId = storeByKey.get(storeKey(chainId, storeExternal))
  if (!storeId) {
    stats.skipped_unknown_store++
    warnings.push(`row ${lineNo + 2}: unknown store "${chainName}" / "${storeExternal}"`)
    continue
  }
  const product = productByName.get(productName.toLowerCase())
  if (!product) {
    stats.skipped_unknown_product++
    warnings.push(`row ${lineNo + 2}: unknown canonical_product "${productName}"`)
    continue
  }

  // observed_at: prefer the date the collector wrote down; fall back to now.
  // Accept "YYYY-MM-DD" and let Postgres do the cast.
  const observedAt = dateStr || 'now()'

  // The CSV's pricing_unit column is just informational (it was generated
  // from the canonical row). The DB authoritative value is on
  // canonical_products. If they disagree, log it but use the canonical's.
  if (csvPricingUnit && csvPricingUnit !== product.pricing_unit) {
    warnings.push(
      `row ${lineNo + 2}: pricing_unit mismatch ` +
      `(csv "${csvPricingUnit}" vs canonical "${product.pricing_unit}") — using canonical`,
    )
  }

  if (DRY_RUN) {
    stats.inserted++
    continue
  }

  // Idempotency check before any writes — avoid creating a duplicate
  // store_sku or observation if we've loaded this row before.
  const dupCheck = await client.query(
    `SELECT 1 FROM price_observations po
     WHERE po.store_id = $1 AND po.canonical_id = $2
       AND po.observed_at::date = ${dateStr ? '$3::date' : 'CURRENT_DATE'}
       AND po.source = 'manual'
     LIMIT 1`,
    dateStr ? [storeId, product.canonical_id, dateStr] : [storeId, product.canonical_id],
  )
  if (dupCheck.rowCount > 0) {
    stats.skipped_already_loaded++
    continue
  }

  // Derive pack_size/pack_unit: CSV columns override canonical defaults.
  const csvPackSize = col.pack_size !== undefined ? Number((r[col.pack_size] ?? '').trim()) : NaN
  const csvPackUnit = col.pack_unit !== undefined ? (r[col.pack_unit] ?? '').trim() : ''
  const packSize = Number.isFinite(csvPackSize) && csvPackSize > 0 ? csvPackSize : (product.package_size ?? null)
  const packUnit = csvPackUnit || (product.package_unit ?? null)

  // Find-or-create a chain-wide store_sku for this canonical. The unique
  // index on (chain_id, receipt_text_canonical) protects us from races; we
  // use the canonical name as the receipt_text_canonical for manual seeds.
  const skuRes = await client.query(
    `WITH ins AS (
       INSERT INTO store_skus
         (chain_id, store_id, canonical_id, receipt_text_canonical, display_name,
          pack_size, pack_unit,
          status, confidence, verified_at, verified_by)
       VALUES ($1, NULL, $2, $3, $3, $4, $5, 'verified', 1.00, NOW(), 'manual_seed')
       ON CONFLICT (chain_id, receipt_text_canonical) DO NOTHING
       RETURNING store_sku_id
     )
     SELECT store_sku_id FROM ins
     UNION ALL
     SELECT store_sku_id FROM store_skus
     WHERE chain_id = $1 AND receipt_text_canonical = $3
     LIMIT 1`,
    [chainId, product.canonical_id, product.name, packSize, packUnit],
  )
  const storeSkuId = skuRes.rows[0]?.store_sku_id
  if (!storeSkuId) {
    warnings.push(`row ${lineNo + 2}: failed to resolve store_sku — skipping`)
    continue
  }

  // Backfill pack_size/pack_unit on existing SKUs that lack them.
  if (packSize != null || packUnit != null) {
    await client.query(
      `UPDATE store_skus
       SET pack_size = COALESCE(store_skus.pack_size, $2),
           pack_unit = COALESCE(store_skus.pack_unit, $3)
       WHERE store_sku_id = $1`,
      [storeSkuId, packSize, packUnit],
    )
  }

  await client.query(
    `INSERT INTO price_observations
       (store_sku_id, canonical_id, store_id, chain_id,
        price_total, quantity, quantity_unit,
        price_per_unit, price_unit,
        observed_at, source, pricing_tier, confidence)
     VALUES
       ($1, $2, $3, $4,
        $5, 1, $6,
        $5, $7,
        ${dateStr ? '$8::date' : 'NOW()'}, 'manual', 'shelf', 0.95)`,
    dateStr
      ? [storeSkuId, product.canonical_id, storeId, chainId,
         price, product.package_unit, product.pricing_unit, dateStr]
      : [storeSkuId, product.canonical_id, storeId, chainId,
         price, product.package_unit, product.pricing_unit],
  )
  stats.inserted++
}

// ── Refresh the materialized view so the API sees new data immediately ────

if (!DRY_RUN && stats.inserted > 0) {
  console.log('Refreshing current_prices materialized view...')
  // CONCURRENTLY needs an existing populated view; first run might be empty
  // so try concurrent first, fall back to plain.
  try {
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices`)
  } catch {
    await client.query(`REFRESH MATERIALIZED VIEW current_prices`)
  }
  console.log('✓ Refreshed.')
}

await client.end()

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\nSummary:')
console.log(`  Total CSV rows scanned:    ${stats.total}`)
console.log(`  Skipped (no price):        ${stats.skipped_no_price}`)
console.log(`  Skipped (bad price):       ${stats.skipped_bad_price}`)
console.log(`  Skipped (unknown chain):   ${stats.skipped_unknown_chain}`)
console.log(`  Skipped (unknown store):   ${stats.skipped_unknown_store}`)
console.log(`  Skipped (unknown product): ${stats.skipped_unknown_product}`)
console.log(`  Skipped (already loaded):  ${stats.skipped_already_loaded}`)
console.log(`  ${DRY_RUN ? 'Would insert' : 'Inserted'}:                  ${stats.inserted}`)

if (warnings.length > 0) {
  console.log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`)
  for (const w of warnings.slice(0, 30)) console.log(`  • ${w}`)
  if (warnings.length > 30) console.log(`  ... ${warnings.length - 30} more`)
}

if (DRY_RUN) console.log('\n(dry-run: no DB writes performed)')
