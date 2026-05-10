/**
 * Wipe everything that generate-fake-prices.mjs created.
 *
 * Two markers, removed in this order:
 *   1. price_observations.source = 'fake'
 *   2. store_skus.verified_by   = 'fake_seed'   (only rows not referenced
 *      by any remaining observation — a real receipt that landed on a
 *      fake-seeded SKU must keep that SKU around)
 *
 * Then refreshes current_prices so the API/UI no longer surfaces fake
 * prices on the next request.
 *
 * Usage (from repo root):
 *   node web/scripts/purge-fake-data.mjs
 *   node web/scripts/purge-fake-data.mjs --dry-run    # show counts, write nothing
 */

import { createClient } from './seed-utils.mjs'

const DRY_RUN = process.argv.includes('--dry-run')

const db = createClient()
await db.connect()

// Audit before doing anything.
const { rows: before } = await db.query(`
  SELECT
    (SELECT COUNT(*) FROM price_observations WHERE source = 'fake') AS fake_obs,
    (SELECT COUNT(*) FROM store_skus WHERE verified_by = 'fake_seed') AS fake_skus
`)
console.log(`Before:`)
console.log(`  Fake price_observations:    ${before[0].fake_obs}`)
console.log(`  Fake store_skus (any ref):  ${before[0].fake_skus}`)

if (DRY_RUN) {
  console.log('\n--dry-run: no changes made.')
  await db.end()
  process.exit(0)
}

// 1. Remove fake observations first. (No FK constraint requires this order,
// but doing observations first means the SKU prune below can't accidentally
// delete a SKU that still has an observation pointing to it.)
const { rowCount: obsDel } = await db.query(
  `DELETE FROM price_observations WHERE source = 'fake'`,
)

// 2. Remove fake SKUs that are no longer referenced. If a real receipt
// happened to write its first observation against a fake-seeded SKU, that
// row stays — it's now legitimate adapter data.
const { rowCount: skuDel } = await db.query(
  `DELETE FROM store_skus
   WHERE verified_by = 'fake_seed'
     AND store_sku_id NOT IN (
       SELECT store_sku_id FROM price_observations
       WHERE store_sku_id IS NOT NULL
     )`,
)

// Refresh the materialized view so consumers stop seeing the fake rows.
try { await db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices`) }
catch { await db.query(`REFRESH MATERIALIZED VIEW current_prices`) }

const { rows: after } = await db.query(`
  SELECT
    (SELECT COUNT(*) FROM price_observations WHERE source = 'fake') AS fake_obs,
    (SELECT COUNT(*) FROM store_skus WHERE verified_by = 'fake_seed') AS fake_skus,
    (SELECT COUNT(*) FROM price_observations) AS total_obs
`)

await db.end()

console.log(`\nDeleted:`)
console.log(`  price_observations rows: ${obsDel}`)
console.log(`  store_skus rows:         ${skuDel}`)
console.log(`\nAfter:`)
console.log(`  Fake price_observations: ${after[0].fake_obs}`)
console.log(`  Fake store_skus (any):   ${after[0].fake_skus}  (kept = referenced by a real observation)`)
console.log(`  Total price_observations: ${after[0].total_obs}`)
console.log('\n✓ current_prices refreshed.')
