/**
 * Ingest a Trader Joe's price-list CSV into the bc variant's pricing data.
 *
 * Two writes per row:
 *   1. OFF SQLite (`data/open-food-facts/us-products.sqlite`) — INSERTs the
 *      product into `products` + `products_fts` so the semantic comparison
 *      engine's FTS recall can find these items by name. Uses "TJ-<sku>" as
 *      the barcode (TJ's internal SKUs are not real UPCs; prefixing keeps
 *      them unambiguous).
 *   2. Postgres `prices` — one priced observation per row, keyed
 *      (chain_id, store_id, barcode, observed_at).
 *
 * Idempotent: ON CONFLICT (source, source_external_id) DO NOTHING. Re-running
 * the same CSV produces no duplicates. Re-running with a fresher CSV (later
 * scraped_date) inserts a new row per item.
 *
 * Source values:
 *   • Postgres `prices.source` = 'trader_joes_csv'
 *   • Postgres `prices.source_external_id` = '<sku>-<scraped_date>'
 *   • OFF SQLite barcode = 'TJ-<sku>'
 *
 * Usage:
 *   node web/scripts/ingest-trader-joes-csv.mjs <path.csv> [--store-id N]
 *
 * Defaults: store_id=246 (Trader Joe's Davis, 885 Russell Blvd), chain_id=10.
 *
 * Env: standard libpq (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE).
 * Use the cloud-sql-proxy via `bc-via-proxy.mjs` style config if running
 * locally against the Cloud SQL instance.
 */

import { readFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'
import pg from 'pg'

// ── args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const csvPath = args.find(a => !a.startsWith('--'))
if (!csvPath) {
  console.error('Usage: node ingest-trader-joes-csv.mjs <path.csv> [--store-id N]')
  process.exit(1)
}
const storeIdFlag = args.indexOf('--store-id')
const STORE_ID = storeIdFlag >= 0 ? parseInt(args[storeIdFlag + 1], 10) : 246
const CHAIN_ID = 10  // Trader Joe's
const SOURCE   = 'trader_joes_csv'
const CONFIDENCE = 0.95

// ── paths ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const OFF_SQLITE = resolve(ROOT, 'data', 'open-food-facts', 'us-products.sqlite')

// ── csv parser (verbatim from load-collection-sheet.mjs) ───────────────────

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

// ── unit normalization ─────────────────────────────────────────────────────

function normalizeUnit(uom) {
  if (!uom) return null
  const s = String(uom).toLowerCase().trim()
  if (s === 'lb' || s === 'lbs' || s === 'pound' || s === 'pounds') return 'lb'
  if (s === 'oz' || s === 'ounce' || s === 'ounces') return 'oz'
  if (s === 'fl oz' || s === 'fl_oz' || s === 'floz') return 'fl_oz'
  if (s === 'g' || s === 'gram' || s === 'grams') return 'g'
  if (s === 'kg') return 'kg'
  if (s === 'ml' || s === 'milliliter') return 'ml'
  if (s === 'l' || s === 'liter' || s === 'litre') return 'l'
  if (s === 'doz' || s === 'dozen') return 'count'  // 12 ct
  if (s === 'ct' || s === 'count' || s === 'each' || s === 'pk' || s === 'pack') return 'count'
  return s.replace(/\s+/g, '_')
}

// ── parse CSV ──────────────────────────────────────────────────────────────

console.log(`Reading ${csvPath}...`)
const raw = readFileSync(csvPath, 'utf8')
const rows = parseCsv(raw)
const header = rows.shift()
const col = Object.fromEntries(header.map((name, idx) => [name.trim(), idx]))
for (const r of ['sku', 'item_title', 'retail_price', 'sales_size', 'sales_uom_description', 'scraped_date']) {
  if (col[r] === undefined) {
    console.error(`CSV missing required column: ${r}`)
    process.exit(1)
  }
}

const items = []
for (const r of rows) {
  if (!r || r.length === 0) continue
  const sku = (r[col.sku] || '').trim()
  const title = (r[col.item_title] || '').trim()
  const priceStr = (r[col.retail_price] || '').trim()
  const sizeStr = (r[col.sales_size] || '').trim()
  const uomStr = (r[col.sales_uom_description] || '').trim()
  const scrapedDate = (r[col.scraped_date] || '').trim()
  if (!sku || !title || !priceStr || !scrapedDate) continue
  const price = Number(priceStr)
  if (!Number.isFinite(price) || price <= 0) continue
  const size = Number(sizeStr)
  const unit = normalizeUnit(uomStr)
  const characteristics = (r[col.item_characteristics] || '').trim()
  const isOrganic = /organic/i.test(characteristics) || /\borganic\b/i.test(title)
  items.push({
    sku,
    title,
    price,
    pack_size: Number.isFinite(size) && size > 0 ? size : null,
    pack_unit: unit,
    quantity_raw: (Number.isFinite(size) && unit) ? `${size} ${uomStr}`.trim() : null,
    scraped_date: scrapedDate,
    is_organic: isOrganic,
  })
}
console.log(`  Parsed ${items.length} priced items from ${rows.length} CSV rows`)

if (items.length === 0) {
  console.error('No items to ingest. Exiting.')
  process.exit(1)
}

// ── OFF SQLite write ───────────────────────────────────────────────────────
// Open read-write. WAL mode (already set on the DB) lets us write while
// the dev server holds a read-only handle.

console.log(`\nOpening OFF SQLite (RW): ${OFF_SQLITE}`)
const offDb = new Database(OFF_SQLITE, { fileMustExist: true })
offDb.pragma('journal_mode = WAL')

const insertProductStmt = offDb.prepare(`
  INSERT INTO products (
    barcode, product_name, generic_name, brands,
    quantity_raw, package_size, package_unit, image_url
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT (barcode) DO UPDATE SET
    product_name = excluded.product_name,
    generic_name = excluded.generic_name,
    brands = excluded.brands,
    quantity_raw = excluded.quantity_raw,
    package_size = excluded.package_size,
    package_unit = excluded.package_unit
`)

// External-content FTS5: we have to manage the FTS index manually since
// there's no trigger. Rebuilding the entire FTS would be slow (898k rows);
// just upsert the FTS rows for the products we touch by deleting+inserting.
const deleteFtsStmt = offDb.prepare(`
  INSERT INTO products_fts(products_fts, rowid, product_name, brands, generic_name)
  SELECT 'delete', rowid, product_name, brands, generic_name FROM products WHERE barcode = ?
`)
const insertFtsStmt = offDb.prepare(`
  INSERT INTO products_fts(rowid, product_name, brands, generic_name)
  SELECT rowid, product_name, brands, generic_name FROM products WHERE barcode = ?
`)
const checkBarcodeStmt = offDb.prepare(`SELECT 1 FROM products WHERE barcode = ?`)

const tx = offDb.transaction((items) => {
  let inserted = 0, updated = 0
  for (const it of items) {
    const barcode = `TJ-${it.sku}`
    const existed = checkBarcodeStmt.get(barcode)
    insertProductStmt.run(
      barcode,
      it.title,
      null,
      "Trader Joe's",
      it.quantity_raw,
      it.pack_size,
      it.pack_unit,
    )
    // Drop old FTS row (if existed) and re-insert with current values
    try { deleteFtsStmt.run(barcode) } catch { /* if not in FTS yet, fine */ }
    insertFtsStmt.run(barcode)
    if (existed) updated++
    else inserted++
  }
  return { inserted, updated }
})

console.log(`Writing ${items.length} products to OFF SQLite + FTS...`)
const offResult = tx(items)
console.log(`  inserted=${offResult.inserted} updated=${offResult.updated}`)
offDb.close()

// ── Postgres write ─────────────────────────────────────────────────────────

console.log(`\nConnecting to Postgres (${process.env.PGHOST}:${process.env.PGPORT})...`)
const pgClient = new pg.Client({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: (process.env.PGSSLMODE || '').toLowerCase() === 'disable'
    ? false
    : { rejectUnauthorized: false },
})
await pgClient.connect()

// Verify the store_id resolves to the expected chain
const storeCheck = await pgClient.query(
  `SELECT store_id, chain_id, display_name FROM stores WHERE store_id = $1`,
  [STORE_ID],
)
if (storeCheck.rows.length === 0) {
  console.error(`store_id=${STORE_ID} not found`)
  process.exit(1)
}
const store = storeCheck.rows[0]
if (store.chain_id !== CHAIN_ID) {
  console.error(`store_id=${STORE_ID} belongs to chain_id=${store.chain_id}, not Trader Joe's (${CHAIN_ID})`)
  process.exit(1)
}
console.log(`  Store: ${store.display_name} (chain=${CHAIN_ID})`)

// Bulk INSERT via VALUES with explicit casts. ON CONFLICT (source,
// source_external_id) DO NOTHING for idempotency.
console.log(`Inserting ${items.length} priced rows into prices...`)
const BATCH = 500
let totalInserted = 0
for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH)
  const values = []
  const params = []
  let p = 1
  for (const it of batch) {
    const barcode = `TJ-${it.sku}`
    // For per-lb items (sales_size=1, uom=Lb): price is per-pack ($X/lb sold by weight)
    // For packed items: price is the pack total
    // Either way, prices.price = the listed price (semantics handled downstream).
    const pricePer = (it.pack_size && it.pack_size > 0)
      ? Number((it.price / it.pack_size).toFixed(4))
      : null
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`)
    params.push(
      barcode,             // barcode
      STORE_ID,            // store_id
      CHAIN_ID,            // chain_id
      it.price,            // price
      pricePer,            // price_per
      it.scraped_date,     // observed_at
      SOURCE,              // source
      `${it.sku}-${it.scraped_date}`, // source_external_id (idempotent key)
      CONFIDENCE,          // confidence
      'shelf',             // pricing_tier
    )
  }
  const sql = `
    INSERT INTO prices (
      barcode, store_id, chain_id, price, price_per,
      observed_at, source, source_external_id, confidence, pricing_tier
    ) VALUES ${values.join(',')}
    ON CONFLICT (source, source_external_id) DO NOTHING
  `
  const res = await pgClient.query(sql, params)
  totalInserted += res.rowCount
  process.stdout.write(`\r  ${Math.min(i + BATCH, items.length)}/${items.length}   inserted=${totalInserted}    `)
}
process.stdout.write('\n')
console.log(`  Total inserted: ${totalInserted} (others were idempotent dupes)`)

// Refresh matview so the new prices show up in semantic search immediately.
console.log(`Refreshing current_prices matview...`)
await pgClient.query(`REFRESH MATERIALIZED VIEW current_prices`)
const cpCount = await pgClient.query(`SELECT COUNT(*) FROM current_prices WHERE chain_id = $1`, [CHAIN_ID])
console.log(`  current_prices for chain ${CHAIN_ID}: ${cpCount.rows[0].count} rows`)

await pgClient.end()
console.log('\nDone.')
