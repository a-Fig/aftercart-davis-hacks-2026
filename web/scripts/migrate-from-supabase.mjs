/**
 * Migrates production data from Supabase Postgres to Cloud SQL Postgres.
 * Pure Node — no pg_dump / pg_restore dependency. Streams table by table
 * in dependency order, handles PostGIS GEOGRAPHY and pgvector serialization.
 *
 * Idempotent: TRUNCATE … RESTART IDENTITY CASCADE on the target before insert.
 *
 * Required env (web/.env.local or process.env):
 *   Source  — NEXT_PUBLIC_SUPABASE_URL, SUPABASE_DB_URL (for password)
 *   Target  — PGHOST, PGUSER, PGPASSWORD, PGDATABASE, optional PGPORT
 *
 * Usage (from repo root):
 *   node web/scripts/migrate-from-supabase.mjs
 *   node web/scripts/migrate-from-supabase.mjs --dry-run   # counts only
 *
 * After it finishes:
 *   The materialized view current_prices is empty until refreshed. The script
 *   runs `REFRESH MATERIALIZED VIEW current_prices` at the end.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvFile() {
  const envPath = resolve(__dirname, '..', '.env.local')
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      if (process.env[key]) continue
      process.env[key] = t.slice(eq + 1).trim()
    }
  } catch {}
}
loadEnvFile()

const DRY_RUN = process.argv.includes('--dry-run')

// ── Source: Supabase ───────────────────────────────────────────────────────

function parsePgUrl(url) {
  const noProto = url.replace(/^postgresql:\/\//, '')
  const lastAt = noProto.lastIndexOf('@')
  const credentials = noProto.slice(0, lastAt)
  const hostPart = noProto.slice(lastAt + 1)
  const colonIdx = credentials.indexOf(':')
  const user = credentials.slice(0, colonIdx)
  const password = credentials.slice(colonIdx + 1)
  const [hostPort, database] = hostPart.split('/')
  const [host, port] = hostPort.split(':')
  return { user, password, host, port: parseInt(port, 10), database }
}

function supabaseClient() {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const refMatch = projectUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
  if (!refMatch) throw new Error('Cannot derive Supabase project ref')
  const ref = refMatch[1]
  const pooler = parsePgUrl(process.env.SUPABASE_DB_URL)
  return new Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: pooler.password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
}

// ── Target: Cloud SQL ───────────────────────────────────────────────────────

function cloudSqlClient() {
  const host = process.env.PGHOST
  if (!host) throw new Error('PGHOST not set')
  const isUnixSocket = host.startsWith('/')
  if (isUnixSocket) {
    return new Client({
      host,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    })
  }
  return new Client({
    host,
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: { rejectUnauthorized: false },
  })
}

// ── Migration plan ──────────────────────────────────────────────────────────
//
// Tables in dependency order. For each:
//   - selectSql: how to read from Supabase. Use ST_AsText() for geography,
//     vector cast to text for embeddings.
//   - columns: target column names (in order).
//   - paramExpr: per-column SQL expression for INSERT (e.g. ST_GeographyFromText($N)
//     for geography, $N::vector for embeddings, plain $N otherwise).
//   - resetSerial: optional sequence to reset to MAX(id)+1 after load.

const TABLES = [
  {
    name: 'chains',
    selectSql: `SELECT chain_id, name, parent_company, snap_authorized, pricing_model, notes FROM chains ORDER BY chain_id`,
    columns: ['chain_id', 'name', 'parent_company', 'snap_authorized', 'pricing_model', 'notes'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
    resetSerial: { seq: 'chains_chain_id_seq', table: 'chains', col: 'chain_id' },
  },
  {
    name: 'product_categories',
    selectSql: `SELECT category_id, name, parent_category_id, usda_fdc_id FROM product_categories ORDER BY category_id`,
    columns: ['category_id', 'name', 'parent_category_id', 'usda_fdc_id'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
    resetSerial: { seq: 'product_categories_category_id_seq', table: 'product_categories', col: 'category_id' },
  },
  {
    name: 'stores',
    selectSql: `SELECT store_id, chain_id, external_id, address, ST_AsText(location) AS location, snap_authorized, usda_retailer_id, opened_at, closed_at FROM stores ORDER BY store_id`,
    columns: ['store_id', 'chain_id', 'external_id', 'address', 'location', 'snap_authorized', 'usda_retailer_id', 'opened_at', 'closed_at'],
    placeholders: (n) => {
      // location is at index 4 (0-based) → param index 5; wrap with ST_GeographyFromText
      const parts = []
      for (let i = 0; i < n; i++) {
        if (i === 4) parts.push(`ST_GeographyFromText($${i + 1})`)
        else parts.push(`$${i + 1}`)
      }
      return parts.join(', ')
    },
    resetSerial: { seq: 'stores_store_id_seq', table: 'stores', col: 'store_id' },
  },
  {
    name: 'canonical_products',
    selectSql: `SELECT canonical_id, name, brand, is_store_brand, store_brand_chain_id, package_size, package_unit, pricing_unit, upc, category_id, description_embedding::text AS description_embedding, created_at FROM canonical_products ORDER BY canonical_id`,
    columns: ['canonical_id', 'name', 'brand', 'is_store_brand', 'store_brand_chain_id', 'package_size', 'package_unit', 'pricing_unit', 'upc', 'category_id', 'description_embedding', 'created_at'],
    placeholders: (n) => {
      // description_embedding is at index 10 (0-based) → param 11; cast to vector
      const parts = []
      for (let i = 0; i < n; i++) {
        if (i === 10) parts.push(`$${i + 1}::vector`)
        else parts.push(`$${i + 1}`)
      }
      return parts.join(', ')
    },
    resetSerial: { seq: 'canonical_products_canonical_id_seq', table: 'canonical_products', col: 'canonical_id' },
  },
  {
    name: 'canonical_barcodes',
    selectSql: `SELECT canonical_id, barcode, source, confidence, added_at FROM canonical_barcodes ORDER BY canonical_id, barcode`,
    columns: ['canonical_id', 'barcode', 'source', 'confidence', 'added_at'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
  },
  {
    name: 'store_skus',
    selectSql: `SELECT store_sku_id, chain_id, store_id, canonical_id, receipt_text_canonical, display_name, upc, receipt_text_embedding::text AS receipt_text_embedding, status, confidence, first_seen_at, verified_at, verified_by FROM store_skus ORDER BY store_sku_id`,
    columns: ['store_sku_id', 'chain_id', 'store_id', 'canonical_id', 'receipt_text_canonical', 'display_name', 'upc', 'receipt_text_embedding', 'status', 'confidence', 'first_seen_at', 'verified_at', 'verified_by'],
    placeholders: (n) => {
      // receipt_text_embedding is at index 7 (0-based) → param 8
      const parts = []
      for (let i = 0; i < n; i++) {
        if (i === 7) parts.push(`$${i + 1}::vector`)
        else parts.push(`$${i + 1}`)
      }
      return parts.join(', ')
    },
    resetSerial: { seq: 'store_skus_store_sku_id_seq', table: 'store_skus', col: 'store_sku_id' },
  },
  {
    name: 'equivalence_groups',
    selectSql: `SELECT group_id, name, description FROM equivalence_groups ORDER BY group_id`,
    columns: ['group_id', 'name', 'description'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
    resetSerial: { seq: 'equivalence_groups_group_id_seq', table: 'equivalence_groups', col: 'group_id' },
  },
  {
    name: 'equivalence_group_members',
    selectSql: `SELECT group_id, canonical_id, equivalence_strength FROM equivalence_group_members`,
    columns: ['group_id', 'canonical_id', 'equivalence_strength'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
  },
  {
    name: 'receipts',
    selectSql: `SELECT receipt_id, user_id, store_id, inferred_chain_id, receipt_dated_at, uploaded_at, image_hash, ocr_engine, ocr_confidence_avg, receipt_total, line_count, processing_status FROM receipts ORDER BY uploaded_at`,
    columns: ['receipt_id', 'user_id', 'store_id', 'inferred_chain_id', 'receipt_dated_at', 'uploaded_at', 'image_hash', 'ocr_engine', 'ocr_confidence_avg', 'receipt_total', 'line_count', 'processing_status'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
  },
  {
    name: 'receipt_line_items',
    selectSql: `SELECT line_item_id, receipt_id, line_number, raw_text, parsed_quantity, parsed_unit, parsed_price_total, matched_store_sku_id, match_confidence, needs_review FROM receipt_line_items ORDER BY line_item_id`,
    columns: ['line_item_id', 'receipt_id', 'line_number', 'raw_text', 'parsed_quantity', 'parsed_unit', 'parsed_price_total', 'matched_store_sku_id', 'match_confidence', 'needs_review'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
    resetSerial: { seq: 'receipt_line_items_line_item_id_seq', table: 'receipt_line_items', col: 'line_item_id' },
  },
  {
    name: 'price_observations',
    selectSql: `SELECT observation_id, store_sku_id, canonical_id, store_id, chain_id, price_total, quantity, quantity_unit, price_per_unit, price_unit, observed_at, ingested_at, source, pricing_tier, source_receipt_id, confidence FROM price_observations ORDER BY observation_id`,
    columns: ['observation_id', 'store_sku_id', 'canonical_id', 'store_id', 'chain_id', 'price_total', 'quantity', 'quantity_unit', 'price_per_unit', 'price_unit', 'observed_at', 'ingested_at', 'source', 'pricing_tier', 'source_receipt_id', 'confidence'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
    resetSerial: { seq: 'price_observations_observation_id_seq', table: 'price_observations', col: 'observation_id' },
  },
  {
    name: 'users',
    selectSql: `SELECT user_id, created_at, ST_AsText(home_location) AS home_location, radius_miles FROM users`,
    columns: ['user_id', 'created_at', 'home_location', 'radius_miles'],
    placeholders: (n) => {
      const parts = []
      for (let i = 0; i < n; i++) {
        if (i === 2) parts.push(`CASE WHEN $${i + 1}::text IS NULL THEN NULL ELSE ST_GeographyFromText($${i + 1}) END`)
        else parts.push(`$${i + 1}`)
      }
      return parts.join(', ')
    },
  },
  {
    name: 'user_baskets',
    selectSql: `SELECT basket_id, user_id, receipt_id, created_at FROM user_baskets`,
    columns: ['basket_id', 'user_id', 'receipt_id', 'created_at'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
  },
  {
    name: 'user_alerts',
    selectSql: `SELECT alert_id, user_id, canonical_id, threshold_price, threshold_unit, radius_miles, active, created_at FROM user_alerts`,
    columns: ['alert_id', 'user_id', 'canonical_id', 'threshold_price', 'threshold_unit', 'radius_miles', 'active', 'created_at'],
    placeholders: (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', '),
  },
]

// ── Execute ─────────────────────────────────────────────────────────────────

const src = supabaseClient()
const tgt = cloudSqlClient()
await Promise.all([src.connect(), tgt.connect()])
console.log('Connected to both databases.\n')

if (DRY_RUN) {
  console.log('DRY RUN — counts only, no writes.\n')
  console.log('Table'.padEnd(30) + 'Supabase'.padStart(12) + 'CloudSQL'.padStart(12))
  console.log('-'.repeat(54))
  for (const t of TABLES) {
    const sCount = await src.query(`SELECT COUNT(*)::int FROM ${t.name}`).catch(() => ({ rows: [{ count: 'ERROR' }] }))
    const tCount = await tgt.query(`SELECT COUNT(*)::int FROM ${t.name}`).catch(() => ({ rows: [{ count: 'ERROR' }] }))
    console.log(t.name.padEnd(30) + String(sCount.rows[0].count).padStart(12) + String(tCount.rows[0].count).padStart(12))
  }
  await Promise.all([src.end(), tgt.end()])
  process.exit(0)
}

// Real migration: TRUNCATE in reverse order, INSERT in forward order
console.log('Truncating target tables (reverse order)...')
const reversed = [...TABLES].reverse()
for (const t of reversed) {
  await tgt.query(`TRUNCATE ${t.name} RESTART IDENTITY CASCADE`)
}
console.log('  ✓ truncated\n')

const summary = []
for (const t of TABLES) {
  process.stdout.write(`Migrating ${t.name}... `)
  const { rows } = await src.query(t.selectSql)
  const colList = t.columns.join(', ')

  // Insert in chunks to keep param count under Postgres' 65535 limit
  const cols = t.columns.length
  const maxParams = 60000
  const batchSize = Math.max(1, Math.floor(maxParams / cols))

  let inserted = 0
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize)
    if (batch.length === 0) break

    const valuesSql = batch
      .map((_, i) => `(${t.placeholders(cols).replace(/\$(\d+)/g, (_, n) => '$' + (i * cols + parseInt(n, 10)))})`)
      .join(', ')

    const params = batch.flatMap((row) => t.columns.map((c) => row[c]))

    await tgt.query(`INSERT INTO ${t.name} (${colList}) VALUES ${valuesSql}`, params)
    inserted += batch.length
  }

  if (t.resetSerial && inserted > 0) {
    await tgt.query(
      `SELECT setval('${t.resetSerial.seq}', (SELECT COALESCE(MAX(${t.resetSerial.col}), 0) + 1 FROM ${t.resetSerial.table}), false)`,
    )
  }

  console.log(`${inserted} rows`)
  summary.push({ table: t.name, rows: inserted })
}

console.log('\nRefreshing materialized view current_prices...')
await tgt.query(`REFRESH MATERIALIZED VIEW current_prices`)
console.log('  ✓ refreshed')

console.log('\nMigration summary:')
for (const s of summary) console.log(`  ${s.table.padEnd(30)} ${String(s.rows).padStart(8)} rows`)

await Promise.all([src.end(), tgt.end()])
console.log('\n✓ Done.')
