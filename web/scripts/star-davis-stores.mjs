#!/usr/bin/env node
/**
 * Star 3 Davis-area stores so they show up on the /field portal home as
 * one-tap shortcut cards.
 *
 * Strategy:
 *   1. Look for stores within 3 miles of Davis center (38.5449, -121.7405)
 *      that belong to chains in our priority list (Safeway, Trader Joe's,
 *      Nugget Markets). Pick one per chain.
 *   2. If fewer than 3 priority chains have a Davis store, top up by
 *      taking the closest stores of any chain.
 *   3. Set is_field_starred = TRUE on the chosen rows.
 *
 * Idempotent: only stars; doesn't unstar already-starred rows.
 *
 * Run from repo root:
 *   set -a; source web/.env.local; set +a
 *   node web/scripts/star-davis-stores.mjs
 */

import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

import { readEnv, toDirectParams } from './seed-utils.mjs'

const DAVIS_LAT = 38.5449
const DAVIS_LON = -121.7405
const RADIUS_MILES = 3
const PRIORITY_CHAIN_NAMES = [
  'safeway',
  "trader joe's",
  'trader joes',
  'nugget markets',
  'nugget',
]
const TARGET_COUNT = 3

async function main() {
  // readEnv is just for legacy fallback paths; toDirectParams reads
  // process.env first, so this script works equally well via direct PG* env.
  const env = (() => {
    try {
      return readEnv()
    } catch {
      return {}
    }
  })()
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] == null) process.env[k] = v
  }
  const params = toDirectParams(env)

  const client = new pg.Client(params)
  await client.connect()

  try {
    // Diagnostic: how many starred today?
    const before = await client.query(
      `SELECT COUNT(*)::int AS n FROM stores WHERE is_field_starred = TRUE`,
    )
    console.log(`Currently starred: ${before.rows[0].n}`)

    // Find the closest store per priority chain within 3 miles of Davis.
    const priorityRows = await client.query(
      `
      WITH ranked AS (
        SELECT
          s.store_id,
          s.display_name,
          s.address_full,
          s.city,
          c.chain_id,
          c.name AS chain_name,
          LOWER(c.name) AS chain_lower,
          ST_Distance(s.location, ST_MakePoint($1, $2)::geography) / 1609.344 AS distance_miles,
          ROW_NUMBER() OVER (
            PARTITION BY c.chain_id
            ORDER BY ST_Distance(s.location, ST_MakePoint($1, $2)::geography)
          ) AS rk
        FROM stores s
        JOIN chains c ON c.chain_id = s.chain_id
        WHERE LOWER(c.name) = ANY($3::text[])
          AND ST_DWithin(s.location, ST_MakePoint($1, $2)::geography, $4)
          AND (s.closed_at IS NULL OR s.closed_at > NOW())
      )
      SELECT * FROM ranked WHERE rk = 1
      ORDER BY distance_miles
      `,
      [DAVIS_LON, DAVIS_LAT, PRIORITY_CHAIN_NAMES, RADIUS_MILES * 1609.344],
    )

    const picked = new Map() // store_id -> row
    for (const row of priorityRows.rows) {
      if (picked.size >= TARGET_COUNT) break
      picked.set(row.store_id, row)
    }

    // Top up with closest non-priority stores if we're under quota.
    if (picked.size < TARGET_COUNT) {
      const need = TARGET_COUNT - picked.size
      const exclude = [...picked.keys()]
      const fallback = await client.query(
        `
        SELECT
          s.store_id, s.display_name, s.address_full, s.city,
          c.chain_id, c.name AS chain_name,
          ST_Distance(s.location, ST_MakePoint($1, $2)::geography) / 1609.344 AS distance_miles
        FROM stores s
        LEFT JOIN chains c ON c.chain_id = s.chain_id
        WHERE ST_DWithin(s.location, ST_MakePoint($1, $2)::geography, $3)
          AND (s.closed_at IS NULL OR s.closed_at > NOW())
          AND NOT (s.store_id = ANY($4::bigint[]))
        ORDER BY ST_Distance(s.location, ST_MakePoint($1, $2)::geography)
        LIMIT $5
        `,
        [
          DAVIS_LON,
          DAVIS_LAT,
          RADIUS_MILES * 1609.344,
          exclude.length > 0 ? exclude : [-1],
          need,
        ],
      )
      for (const row of fallback.rows) {
        picked.set(row.store_id, row)
      }
    }

    if (picked.size === 0) {
      console.warn(
        `No stores found within ${RADIUS_MILES} miles of Davis. Either the stores table is empty or the seed data uses a different geography. Skipping.`,
      )
      return
    }

    // Apply the stars.
    const ids = [...picked.keys()]
    const upd = await client.query(
      `UPDATE stores SET is_field_starred = TRUE
        WHERE store_id = ANY($1::bigint[]) AND is_field_starred = FALSE
        RETURNING store_id`,
      [ids],
    )

    console.log(`Starred ${upd.rowCount} new stores (idempotent skip on already-starred):`)
    for (const row of picked.values()) {
      console.log(
        `  • [${row.chain_name ?? 'Independent'}] ${row.display_name}  ` +
          `(${row.distance_miles?.toFixed?.(2) ?? '?'} mi, store_id=${row.store_id})`,
      )
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
