/**
 * One-shot migration: add pack_size and pack_unit to store_skus.
 * These columns store the chain-specific product size (e.g. Costco
 * sells 48oz peanut butter while Safeway sells 12oz).
 *
 * Idempotent — safe to run multiple times.
 *
 *   node web/scripts/migrate-store-skus-pack-size.mjs
 */

import { createClient } from './seed-utils.mjs'

const c = createClient()
await c.connect()

async function hasColumn(table, column) {
  const { rows } = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  )
  return rows.length > 0
}

if (await hasColumn('store_skus', 'pack_size')) {
  console.log('• store_skus.pack_size already exists')
} else {
  console.log('• Adding pack_size column to store_skus...')
  await c.query(`ALTER TABLE store_skus ADD COLUMN pack_size NUMERIC`)
  console.log('  done')
}

if (await hasColumn('store_skus', 'pack_unit')) {
  console.log('• store_skus.pack_unit already exists')
} else {
  console.log('• Adding pack_unit column to store_skus...')
  await c.query(`ALTER TABLE store_skus ADD COLUMN pack_unit TEXT`)
  console.log('  done')
}

// Backfill from canonical_products where store_skus.pack_size is still NULL
console.log('• Backfilling pack_size/pack_unit from canonical_products where missing...')
const { rowCount } = await c.query(`
  UPDATE store_skus ss
  SET pack_size = cp.package_size,
      pack_unit = cp.package_unit
  FROM canonical_products cp
  WHERE ss.canonical_id = cp.canonical_id
    AND ss.pack_size IS NULL
    AND cp.package_size IS NOT NULL
`)
console.log(`  backfilled ${rowCount} rows`)

await c.end()
console.log('✓ Migration complete')
