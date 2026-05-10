/**
 * One-shot migration: add pricing_tier to price_observations and rebuild the
 * current_prices materialized view to include it. Required by /api/compare
 * (compare.mjs SELECTs cp.pricing_tier).
 *
 * Safe to run while price_observations has 0 rows. If the table grows real
 * data later, make this a proper migration with a default-then-backfill
 * pattern instead.
 *
 *   node web/scripts/migrate-pricing-tier.mjs
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

async function viewHasColumn(view, column) {
  const { rows } = await c.query(
    `SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relname = $1 AND a.attname = $2 AND a.attnum > 0 AND NOT a.attisdropped`,
    [view, column],
  )
  return rows.length > 0
}

if (await hasColumn('price_observations', 'pricing_tier')) {
  console.log('• price_observations.pricing_tier already exists')
} else {
  console.log('• Adding pricing_tier column to price_observations...')
  await c.query(`
    ALTER TABLE price_observations
      ADD COLUMN pricing_tier TEXT NOT NULL DEFAULT 'shelf'
      CHECK (pricing_tier IN ('shelf', 'member', 'sale'))
  `)
  console.log('  ✓ added')
}

if (await viewHasColumn('current_prices', 'pricing_tier')) {
  console.log('• current_prices.pricing_tier already exists')
} else {
  console.log('• Rebuilding current_prices materialized view...')
  await c.query(`DROP MATERIALIZED VIEW IF EXISTS current_prices`)
  await c.query(`
    CREATE MATERIALIZED VIEW current_prices AS
    WITH recent_observations AS (
        SELECT
            canonical_id,
            store_id,
            chain_id,
            price_per_unit,
            price_unit,
            pricing_tier,
            observed_at,
            confidence,
            EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - observed_at)) / (14 * 86400)) AS recency_weight
        FROM price_observations
        WHERE
            canonical_id IS NOT NULL
            AND observed_at > NOW() - INTERVAL '90 days'
    )
    SELECT
        canonical_id,
        store_id,
        chain_id,
        price_unit,
        pricing_tier,
        SUM(price_per_unit * recency_weight * confidence)
            / NULLIF(SUM(recency_weight * confidence), 0) AS weighted_price,
        COUNT(*) AS observation_count,
        MAX(observed_at) AS most_recent_observation,
        CASE
            WHEN MAX(observed_at) > NOW() - INTERVAL '7 days' THEN 'green'
            WHEN MAX(observed_at) > NOW() - INTERVAL '30 days' THEN 'yellow'
            ELSE 'red'
        END AS freshness
    FROM recent_observations
    GROUP BY canonical_id, store_id, chain_id, price_unit, pricing_tier
  `)
  await c.query(`
    CREATE UNIQUE INDEX current_prices_pk
      ON current_prices(canonical_id, store_id, price_unit, pricing_tier)
  `)
  await c.query(`CREATE INDEX current_prices_store_idx ON current_prices(store_id)`)
  console.log('  ✓ rebuilt with pricing_tier')
}

await c.end()
console.log('\nMigration complete.')
