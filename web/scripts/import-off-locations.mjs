#!/usr/bin/env node
/**
 * Optional safety-net importer: backfills any US OFF Locations into `stores`
 * that weren't already populated by import-off-prices.mjs. A location will be
 * missing from the prices ingest only if it has zero prices in the OFF
 * dataset (rare for US — most locations come in via the price-record join).
 *
 * Reads:  data/off-prices/us-locations.jsonl   (~5,889 rows globally; filters to US)
 * Writes: stores  (only INSERTs new osm_ids; never updates existing rows)
 *
 * Run from repo root:
 *   node web/scripts/import-off-locations.mjs              # full pass
 *   node web/scripts/import-off-locations.mjs --dry-run
 *
 * Idempotent. Safe to re-run.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './seed-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const LOCATIONS_FILE = join(ROOT, 'data', 'off-prices', 'us-locations.jsonl');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

async function main() {
  console.log('AfterCart-BC: import OFF Locations (safety net)');
  console.log(`File: ${LOCATIONS_FILE}`);
  if (DRY_RUN) console.log('DRY-RUN — no DB writes');

  const client = createClient();
  await client.connect();

  // Cache existing osm_ids so we don't re-query for each location.
  const existing = await client.query('SELECT osm_id FROM stores WHERE osm_id IS NOT NULL');
  const haveOsmIds = new Set(existing.rows.map(r => Number(r.osm_id)));
  console.log(`Stores already by osm_id: ${haveOsmIds.size}`);

  // Cache chain lookup by lower(osm_brand) | lower(name).
  const chainsRes = await client.query('SELECT chain_id, name, osm_brand FROM chains');
  const chainByKey = new Map();
  for (const c of chainsRes.rows) {
    if (c.osm_brand) chainByKey.set(c.osm_brand.toLowerCase(), c.chain_id);
    if (c.name)      chainByKey.set(c.name.toLowerCase(), c.chain_id);
  }

  const rl = createInterface({
    input: createReadStream(LOCATIONS_FILE, 'utf8'),
    crlfDelay: Infinity,
  });

  let total = 0;
  let nonUS = 0;
  let already = 0;
  let inserted = 0;
  let skippedNoCoords = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    total++;

    if (r.osm_address_country_code !== 'US') { nonUS++; continue; }
    if (r.osm_lat == null || r.osm_lon == null) { skippedNoCoords++; continue; }
    if (haveOsmIds.has(Number(r.osm_id))) { already++; continue; }

    const brandRaw = r.osm_brand || r.osm_name || `Store ${r.osm_id}`;
    const brandKey = brandRaw.toLowerCase();
    let chainId = chainByKey.get(brandKey) || null;

    if (!chainId && !DRY_RUN) {
      const ins = await client.query(
        `INSERT INTO chains (name, osm_brand, pricing_model)
         VALUES ($1, $2, 'per_store')
         ON CONFLICT (name) DO UPDATE SET osm_brand = COALESCE(chains.osm_brand, EXCLUDED.osm_brand)
         RETURNING chain_id`,
        [brandRaw, r.osm_brand]
      );
      chainId = ins.rows[0].chain_id;
      chainByKey.set(brandKey, chainId);
    }

    if (DRY_RUN) { inserted++; continue; }

    await client.query(
      `INSERT INTO stores (
         osm_id, osm_type, osm_brand, chain_id, display_name, location,
         address_full, city, postal_code, country_code, source
       ) VALUES (
         $1, $2, $3, $4, $5,
         ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
         $8, $9, $10, $11, 'off'
       )
       ON CONFLICT (osm_id) DO NOTHING`,
      [
        r.osm_id, r.osm_type, r.osm_brand, chainId,
        r.osm_name || brandRaw,
        r.osm_lon, r.osm_lat,
        r.osm_display_name || null,
        r.osm_address_city || null,
        r.osm_address_postcode || null,
        r.osm_address_country_code || 'US',
      ]
    );
    haveOsmIds.add(Number(r.osm_id));
    inserted++;
  }

  console.log('\n=== Summary ===');
  console.log(`Total records:   ${total}`);
  console.log(`Non-US skipped:  ${nonUS}`);
  console.log(`No-coords:       ${skippedNoCoords}`);
  console.log(`Already in DB:   ${already}`);
  console.log(`${DRY_RUN ? 'Would insert' : 'Inserted'}: ${inserted}`);

  await client.end();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
