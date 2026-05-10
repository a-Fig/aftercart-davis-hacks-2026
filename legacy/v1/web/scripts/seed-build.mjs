/**
 * Assembles seed.sql from the three phase files, applies it to the database,
 * and generates collection-sheet.csv from the resulting DB state.
 *
 * Run after phases 1–3 are complete:
 *   node web/scripts/seed-build.mjs
 *
 * Flags:
 *   --dry-run   Write seed.sql but do not apply to DB or generate collection sheet
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { SEED_DIR, ROOT, createClient } from './seed-utils.mjs'

const DRY_RUN = process.argv.includes('--dry-run')

// ── Assemble seed.sql ────────────────────────────────────────────────────────

const phases = ['01_chains_stores.sql', '02_product_categories.sql', '03_canonical_products.sql']
const parts = phases.map(f => {
  const path = resolve(SEED_DIR, f)
  const content = readFileSync(path, 'utf8')
  return `-- ================================================================\n-- ${f}\n-- ================================================================\n\n${content}`
})

const seed = `-- AfterCart seed data\n-- Generated: ${new Date().toISOString()}\n-- Apply with: node web/scripts/seed-build.mjs\n\n` + parts.join('\n')
const seedPath = resolve(SEED_DIR, 'seed.sql')
writeFileSync(seedPath, seed, 'utf8')
console.log(`✓ Assembled ${seedPath}`)

if (DRY_RUN) {
  console.log('--dry-run: skipping DB apply and collection sheet.')
  process.exit(0)
}

// ── Apply to DB ───────────────────────────────────────────────────────────────

const client = createClient()
await client.connect()
console.log(`Connected. Applying seed.sql...`)

try {
  await client.query(seed)
  console.log('✓ Seed applied.')
} catch (err) {
  console.error('Failed to apply seed:', err.message)
  await client.end()
  process.exit(1)
}

// ── Validation summary ────────────────────────────────────────────────────────

const counts = await client.query(`
  SELECT
    (SELECT count(*) FROM chains)             AS chains,
    (SELECT count(*) FROM stores)             AS stores,
    (SELECT count(*) FROM product_categories) AS categories,
    (SELECT count(*) FROM canonical_products) AS products,
    (SELECT count(*) FROM price_observations) AS price_obs
`)
const c = counts.rows[0]
console.log('\nDatabase summary:')
console.log(`  chains:             ${c.chains}`)
console.log(`  stores:             ${c.stores}`)
console.log(`  product_categories: ${c.categories}`)
console.log(`  canonical_products: ${c.products}`)
console.log(`  price_observations: ${c.price_obs}  ← 0 until fieldwork is loaded`)

// ── Collection sheet ──────────────────────────────────────────────────────────

const storesRes = await client.query(`
  SELECT s.store_id, c.name AS chain_name, s.external_id AS store_name, s.address
  FROM stores s JOIN chains c USING (chain_id)
  ORDER BY c.name, s.address
`)
const productsRes = await client.query(`
  SELECT canonical_id, name, package_size, package_unit, pricing_unit
  FROM canonical_products
  ORDER BY name
`)

await client.end()

const storeList = storesRes.rows
const productList = productsRes.rows

const csvLines = ['store_name,chain_name,address,canonical_product,package_size,package_unit,pricing_unit,shelf_price,date_collected,notes']

for (const store of storeList) {
  for (const product of productList) {
    const row = [
      `"${store.store_name.replace(/"/g, '""')}"`,
      `"${store.chain_name}"`,
      `"${store.address.replace(/"/g, '""')}"`,
      `"${product.name.replace(/"/g, '""')}"`,
      product.package_size ?? '',
      product.package_unit ?? '',
      product.pricing_unit,
      '',  // shelf_price — fill in field
      '',  // date_collected
      '',  // notes
    ].join(',')
    csvLines.push(row)
  }
}

const csvPath = resolve(SEED_DIR, 'collection-sheet.csv')
writeFileSync(csvPath, csvLines.join('\n'), 'utf8')
console.log(`\n✓ Collection sheet: ${csvPath}`)
console.log(`  ${storeList.length} stores × ${productList.length} products = ${storeList.length * productList.length} rows to fill in`)
console.log('\nNext step: node web/scripts/generate-embeddings.mjs')
