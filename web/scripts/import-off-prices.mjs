#!/usr/bin/env node
/**
 * Imports the downloaded Open Food Facts Prices JSONL into Postgres.
 *
 * Reads:  data/off-prices/us-prices.jsonl     (~26,736 records)
 *
 * Writes: stores       (upsert by osm_id; new chains created as needed)
 *         chains       (upsert by osm_brand → name)
 *         prices       (insert with ON CONFLICT DO NOTHING via UNIQUE(source, source_external_id))
 *
 * Run from repo root:
 *   node web/scripts/import-off-prices.mjs                 # full ingest
 *   node web/scripts/import-off-prices.mjs --dry-run       # report what would be inserted
 *   node web/scripts/import-off-prices.mjs --limit 1000    # ingest first N rows (testing)
 *   node web/scripts/import-off-prices.mjs --refresh-views # also refresh matviews after ingest
 *
 * Idempotent. Safe to re-run; uses ON CONFLICT to skip already-imported rows.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './seed-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PRICES_FILE = join(ROOT, 'data', 'off-prices', 'us-prices.jsonl');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const REFRESH_VIEWS = args.includes('--refresh-views');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const PROOF_BASE_URL = 'https://prices.openfoodfacts.org/img/proofs';
const OFF_CONFIDENCE = 0.85;  // real receipt-verified, but not first-party

// ----------------------------------------------------------------------------
// Pass 1: stream the JSONL, accumulate unique chains + locations, then
//         keep all the rows in memory (~73 MB) for pass 2 inserts.
// ----------------------------------------------------------------------------

async function readAll() {
  const rl = createInterface({
    input: createReadStream(PRICES_FILE, 'utf8'),
    crlfDelay: Infinity,
  });

  const rows = [];
  const chainsByBrand = new Map();    // lower(osm_brand) → { name, osm_brand }
  const locationsByOsmId = new Map(); // osm_id → location summary
  let nonUS = 0;
  let missingLocation = 0;
  let processed = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (rows.length >= LIMIT) break;

    let r;
    try { r = JSON.parse(line); } catch { continue; }
    processed++;

    const loc = r.location;
    if (!loc || !loc.osm_id || loc.osm_lat == null || loc.osm_lon == null) {
      missingLocation++;
      continue;
    }
    if (loc.osm_address_country_code !== 'US') {
      nonUS++;
      continue;
    }

    // Track unique chains. osm_brand is the strongest signal; fall back to
    // osm_name when brand is missing (rare but happens for independents).
    const brandRaw = loc.osm_brand || loc.osm_name || '(unknown)';
    const brandKey = brandRaw.toLowerCase();
    if (!chainsByBrand.has(brandKey)) {
      chainsByBrand.set(brandKey, {
        name: brandRaw,
        osm_brand: loc.osm_brand || null,
      });
    }

    // Track unique locations by osm_id.
    if (!locationsByOsmId.has(loc.osm_id)) {
      locationsByOsmId.set(loc.osm_id, {
        osm_id:    loc.osm_id,
        osm_type:  null, // not always present in the nested object; set below from the prices file
        osm_brand: loc.osm_brand || null,
        osm_name:  loc.osm_name || loc.osm_brand || `Store ${loc.osm_id}`,
        osm_lat:   loc.osm_lat,
        osm_lon:   loc.osm_lon,
        city:      loc.osm_address_city || null,
        country_code: loc.osm_address_country_code || 'US',
        chain_brand_key: brandKey,
      });
    }

    rows.push({
      id: r.id,
      product_code: r.product_code,
      price: r.price,
      currency: r.currency || 'USD',
      date: r.date,
      price_per: r.price_per,
      price_is_discounted: !!r.price_is_discounted,
      price_without_discount: r.price_without_discount,
      discount_type: r.discount_type,
      receipt_quantity: r.receipt_quantity,
      pricing_tier: r.price_is_discounted ? 'sale' : 'shelf',
      proof_id: r.proof_id != null ? String(r.proof_id) : null,
      proof_file_path: r.proof?.file_path || null,
      owner: r.owner || null,
      osm_id: loc.osm_id,
      brand_key: brandKey,
    });
  }

  console.log(`Read ${processed} records, kept ${rows.length} US rows.`);
  console.log(`  Skipped: ${nonUS} non-US, ${missingLocation} missing location`);
  console.log(`  Unique chains: ${chainsByBrand.size}`);
  console.log(`  Unique locations: ${locationsByOsmId.size}`);

  return { rows, chainsByBrand, locationsByOsmId };
}

// ----------------------------------------------------------------------------
// Pass 2: upsert chains, stores, then bulk-insert prices.
// ----------------------------------------------------------------------------

async function upsertChains(client, chainsByBrand) {
  const brandKeyToChainId = new Map();
  for (const [brandKey, info] of chainsByBrand.entries()) {
    // Try matching by lower(osm_brand) first (most reliable), then by lower(name).
    const match = await client.query(
      `SELECT chain_id FROM chains
       WHERE LOWER(osm_brand) = $1 OR LOWER(name) = $1
       LIMIT 1`,
      [brandKey]
    );
    if (match.rows.length > 0) {
      brandKeyToChainId.set(brandKey, match.rows[0].chain_id);
      continue;
    }
    if (DRY_RUN) {
      brandKeyToChainId.set(brandKey, -1); // sentinel
      continue;
    }
    const ins = await client.query(
      `INSERT INTO chains (name, osm_brand, pricing_model)
       VALUES ($1, $2, 'per_store')
       ON CONFLICT (name) DO UPDATE SET osm_brand = COALESCE(chains.osm_brand, EXCLUDED.osm_brand)
       RETURNING chain_id`,
      [info.name, info.osm_brand]
    );
    brandKeyToChainId.set(brandKey, ins.rows[0].chain_id);
  }
  console.log(`Chains resolved: ${brandKeyToChainId.size}`);
  return brandKeyToChainId;
}

async function upsertStores(client, locationsByOsmId, brandKeyToChainId) {
  const osmIdToStoreId = new Map();
  let inserted = 0;
  let merged = 0;

  for (const loc of locationsByOsmId.values()) {
    const chainId = brandKeyToChainId.get(loc.chain_brand_key);
    if (DRY_RUN) {
      osmIdToStoreId.set(loc.osm_id, -1);
      continue;
    }

    // Already in stores by osm_id?
    const exists = await client.query(
      `SELECT store_id FROM stores WHERE osm_id = $1`,
      [loc.osm_id]
    );
    if (exists.rows.length > 0) {
      osmIdToStoreId.set(loc.osm_id, exists.rows[0].store_id);
      continue;
    }

    // Proximity merge with USDA-only stores within 50m + same chain.
    const nearby = chainId == null ? { rows: [] } : await client.query(
      `SELECT store_id FROM stores
       WHERE chain_id = $1
         AND source = 'usda_only'
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 50)
       LIMIT 1`,
      [chainId, loc.osm_lon, loc.osm_lat]
    );

    if (nearby.rows.length > 0) {
      const storeId = nearby.rows[0].store_id;
      await client.query(
        `UPDATE stores SET
          osm_id    = $1,
          osm_brand = COALESCE(osm_brand, $2),
          source    = 'merged',
          display_name = COALESCE(display_name, $3),
          city      = COALESCE(city, $4)
         WHERE store_id = $5`,
        [loc.osm_id, loc.osm_brand, loc.osm_name, loc.city, storeId]
      );
      osmIdToStoreId.set(loc.osm_id, storeId);
      merged++;
      continue;
    }

    const ins = await client.query(
      `INSERT INTO stores (
         osm_id, osm_brand, chain_id, display_name, location,
         city, country_code, source
       ) VALUES (
         $1, $2, $3, $4,
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         $7, $8, 'off'
       )
       RETURNING store_id`,
      [loc.osm_id, loc.osm_brand, chainId, loc.osm_name,
       loc.osm_lon, loc.osm_lat, loc.city, loc.country_code]
    );
    osmIdToStoreId.set(loc.osm_id, ins.rows[0].store_id);
    inserted++;
  }
  console.log(`Stores: ${inserted} inserted, ${merged} merged with existing USDA rows`);
  return osmIdToStoreId;
}

async function insertPrices(client, rows, osmIdToStoreId, brandKeyToChainId) {
  if (DRY_RUN) {
    console.log(`[dry-run] Would insert ${rows.length} prices.`);
    return;
  }

  const BATCH = 500;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let p = 1;

    for (const row of slice) {
      const storeId = osmIdToStoreId.get(row.osm_id);
      const chainId = brandKeyToChainId.get(row.brand_key);
      if (!storeId || !row.product_code || row.price == null) {
        skipped++;
        continue;
      }
      const proofUrl = row.proof_file_path
        ? `${PROOF_BASE_URL}/${row.proof_file_path}`
        : null;
      values.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
      );
      params.push(
        row.product_code,
        storeId,
        chainId,
        row.price,
        row.currency,
        row.price_per,
        row.receipt_quantity,
        row.pricing_tier,
        row.price_is_discounted,
        row.price_without_discount,
        row.discount_type,
        row.date,
        'off_prices',
        row.proof_id,
        proofUrl,
        String(row.id),
        row.owner
      );
    }

    if (values.length === 0) continue;

    const sql = `
      INSERT INTO prices (
        barcode, store_id, chain_id, price, currency,
        price_per, receipt_quantity, pricing_tier,
        price_is_discounted, price_without_discount, discount_type,
        observed_at, source, proof_id, proof_image_url,
        source_external_id, owner_handle, confidence
      )
      SELECT
        v.barcode::text, v.store_id::bigint, v.chain_id::int, v.price::numeric, v.currency::char(3),
        v.price_per::numeric, v.receipt_quantity::numeric, v.pricing_tier::text,
        v.price_is_discounted::boolean, v.price_without_discount::numeric, v.discount_type::text,
        v.observed_at::date, v.source::text, v.proof_id::text, v.proof_image_url::text,
        v.source_external_id::text, v.owner_handle::text,
        ${OFF_CONFIDENCE}::numeric
      FROM (VALUES ${values.join(',')}) AS v(
        barcode, store_id, chain_id, price, currency,
        price_per, receipt_quantity, pricing_tier,
        price_is_discounted, price_without_discount, discount_type,
        observed_at, source, proof_id, proof_image_url,
        source_external_id, owner_handle
      )
      ON CONFLICT (source, source_external_id) DO NOTHING
    `;
    const res = await client.query(sql, params);
    inserted += res.rowCount;
    if ((i / BATCH) % 10 === 0) {
      console.log(`  ...inserted ${inserted} so far (${i + slice.length}/${rows.length} processed)`);
    }
  }
  console.log(`Prices: ${inserted} inserted, ${skipped} skipped (missing store/code/price)`);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log('AfterCart-BC: import OFF Prices');
  console.log(`File: ${PRICES_FILE}`);
  if (DRY_RUN) console.log('DRY-RUN — no DB writes will be made');
  if (LIMIT < Infinity) console.log(`Limit: ${LIMIT} rows`);

  const { rows, chainsByBrand, locationsByOsmId } = await readAll();

  const client = createClient();
  await client.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    const brandKeyToChainId = await upsertChains(client, chainsByBrand);
    const osmIdToStoreId    = await upsertStores(client, locationsByOsmId, brandKeyToChainId);

    if (!DRY_RUN) {
      await client.query('COMMIT');
      await client.query('BEGIN');
    }

    await insertPrices(client, rows, osmIdToStoreId, brandKeyToChainId);

    if (!DRY_RUN) await client.query('COMMIT');

    if (REFRESH_VIEWS && !DRY_RUN) {
      console.log('\nRefreshing materialized views...');
      await client.query('REFRESH MATERIALIZED VIEW current_prices');
      await client.query('REFRESH MATERIALIZED VIEW unbarcoded_current_prices');
      console.log('Done.');
    }

    // Summary
    if (!DRY_RUN) {
      const counts = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM prices WHERE source='off_prices') AS prices,
          (SELECT COUNT(*) FROM stores WHERE source IN ('off','merged')) AS stores,
          (SELECT COUNT(*) FROM chains) AS chains
      `);
      console.log('\n=== Final counts ===');
      console.log(JSON.stringify(counts.rows[0], null, 2));
    }
  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
