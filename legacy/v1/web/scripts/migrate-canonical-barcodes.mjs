/**
 * One-shot migration: add the canonical_barcodes link table that joins our
 * canonical_products to Open Food Facts UPCs. Used by /api/compare to attach
 * OFF enrichment (image, ingredients, allergens, Nutri-Score, NOVA, nutriments)
 * to a comparison response.
 *
 * Idempotent — checks for table existence before creating. Safe to run multiple
 * times.
 *
 *   node web/scripts/migrate-canonical-barcodes.mjs
 *
 * After this runs, populate the table via:
 *   node web/scripts/enrich-canonicals-from-off.mjs --dry-run
 *   node web/scripts/enrich-canonicals-from-off.mjs --apply
 */

import { createClient } from './seed-utils.mjs'

const c = createClient()
await c.connect()

async function tableExists(name) {
  const { rows } = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [name],
  )
  return rows.length > 0
}

if (await tableExists('canonical_barcodes')) {
  console.log('• canonical_barcodes already exists — nothing to do')
} else {
  console.log('• Creating canonical_barcodes table...')
  await c.query(`
    CREATE TABLE canonical_barcodes (
      canonical_id INTEGER NOT NULL REFERENCES canonical_products(canonical_id) ON DELETE CASCADE,
      barcode      TEXT    NOT NULL,
      source       TEXT    NOT NULL DEFAULT 'off_curated'
                          CHECK (source IN ('off_curated', 'receipt', 'manual')),
      confidence   NUMERIC(3,2) NOT NULL DEFAULT 0.80,
      added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (canonical_id, barcode)
    )
  `)
  await c.query(`CREATE INDEX canonical_barcodes_barcode_idx ON canonical_barcodes(barcode)`)
  console.log('  ✓ created with primary key (canonical_id, barcode) + barcode index')
}

await c.end()
console.log('\nMigration complete.')
