#!/usr/bin/env node
/**
 * Downloads the Open Food Facts product database and filters to US products.
 * Streams through gunzip in one pass — never writes the full uncompressed file.
 *
 * Output: data/open-food-facts/us-products.jsonl  (~400-600 MB uncompressed)
 *
 * Run from workspace root:
 *   node web/scripts/download-off.mjs             # full download (~11 GB compressed, 45-90 min)
 *   node web/scripts/download-off.mjs --sample    # first 100k lines only, ~2 min (quick test)
 *
 * Fields kept per product:
 *   Identification: code, product_name, generic_name, brands, brands_tags
 *   Categorization: categories_tags, countries_tags, labels_tags, stores_tags
 *   Pack:           quantity, serving_size
 *   Imagery:        image_front_url
 *   Health/scoring: nutriscore_grade, nova_group, ecoscore_grade
 *   Composition:    ingredients_text, allergens, allergens_tags, traces_tags, additives_tags
 *   Nutrition:      nutriments (full object — energy, sugars, sodium, fat, etc. per 100g + serving)
 *
 * The expanded set roughly doubles the JSONL size (~350-500 MB for the US subset).
 */

import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'data', 'open-food-facts');

const args = process.argv.slice(2);
const SAMPLE_MODE = args.includes('--sample');
const SAMPLE_LIMIT = 100_000;
const OUT_FILE = join(OUT_DIR, SAMPLE_MODE ? 'us-products-sample.jsonl' : 'us-products.jsonl');

const OFF_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';

const KEEP_FIELDS = new Set([
  // Identification
  'code',              // UPC/EAN barcode
  'product_name',      // full product name as labeled
  'generic_name',      // generic/common name
  'brands',            // brand name(s), comma-separated string
  'brands_tags',       // normalized brand tags

  // Categorization
  'categories_tags',   // standardized category hierarchy (en:chicken-thighs, en:meats, ...)
  'countries_tags',    // countries where sold
  'labels_tags',       // organic, non-gmo, fair-trade, etc.
  'stores_tags',       // which chains carry it

  // Pack
  'quantity',          // package size string as printed (e.g. "32 oz", "2 lb")
  'serving_size',      // serving size string (e.g. "240 ml", "1 cookie (28g)")

  // Imagery
  'image_front_url',   // product image, used by the review screen + ItemDetailModal

  // Health scoring (factual + judgmental — surfaced per the v1.2 product spec)
  'nutriscore_grade',  // 'a' | 'b' | 'c' | 'd' | 'e'
  'nova_group',        // 1 (unprocessed) ... 4 (ultra-processed)
  'ecoscore_grade',    // sustainability grade — bonus signal

  // Composition (for allergen + ingredient awareness)
  'ingredients_text',  // human-readable ingredients string
  'allergens',         // raw allergens text
  'allergens_tags',    // normalized allergen tags (en:milk, en:eggs, ...)
  'traces_tags',       // "may contain" tags
  'additives_tags',    // E-numbers (en:e102, en:e211, ...)

  // Nutrition (per 100g + serving — the big object)
  'nutriments',        // dict of energy_kcal_100g, sugars_100g, sodium_100g, fat_100g, ...
]);

function isUS(product) {
  const tags = product.countries_tags;
  if (Array.isArray(tags)) return tags.includes('en:united-states');
  if (typeof tags === 'string') return tags.includes('en:united-states');
  // Fallback: 12-digit UPC starting with 0–9 is a North American barcode
  const code = String(product.code || '');
  return !tags && code.length === 12 && /^\d+$/.test(code);
}

function pickFields(product) {
  const out = {};
  for (const key of KEEP_FIELDS) {
    const val = product[key];
    if (val !== undefined && val !== null && val !== '') {
      out[key] = val;
    }
  }
  return out;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (existsSync(OUT_FILE) && !SAMPLE_MODE) {
    console.log(`Output already exists at ${OUT_FILE}`);
    console.log('Delete it and re-run to refresh, or use --sample for a quick test.');
    process.exit(0);
  }

  console.log(SAMPLE_MODE
    ? `Sample mode: first ${SAMPLE_LIMIT.toLocaleString()} lines only`
    : 'Full download mode — compressed file is ~11 GB, expect 45-90 minutes depending on connection');
  console.log(`Source: ${OFF_URL}`);
  console.log(`Output: ${OUT_FILE}\n`);

  let downloaded = 0;
  let totalBytes = 0;
  let linesSeen = 0;
  let usProducts = 0;
  let lastLog = Date.now();
  let done = false;

  const outStream = createWriteStream(OUT_FILE);

  function fetchWithRedirects(url, maxRedirects, cb) {
    const getter = url.startsWith('https') ? httpsGet : httpGet;
    getter(url, { headers: { 'User-Agent': 'AfterCart/1.0 (aftercart-hackathon@example.com)' } }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        if (maxRedirects <= 0) { cb(new Error('Too many redirects')); return; }
        res.resume();
        console.log(`  Redirect → ${res.headers.location}`);
        fetchWithRedirects(res.headers.location, maxRedirects - 1, cb);
        return;
      }
      cb(null, res);
    }).on('error', cb);
  }

  await new Promise((resolve, reject) => {
    fetchWithRedirects(OFF_URL, 5, (err, res) => {
      if (err) { reject(err); return; }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from OFF`));
        return;
      }

      totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      console.log(totalBytes ? `Download size: ${fmtBytes(totalBytes)} compressed\n` : 'Download size: unknown\n');

      res.on('data', chunk => {
        downloaded += chunk.length;
        const now = Date.now();
        if (now - lastLog > 10_000 && !done) {
          const pct = totalBytes ? ` (${(downloaded / totalBytes * 100).toFixed(1)}%)` : '';
          process.stdout.write(
            `\r  Downloaded: ${fmtBytes(downloaded)}${pct} | Lines: ${linesSeen.toLocaleString()} | US: ${usProducts.toLocaleString()}    `
          );
          lastLog = now;
        }
      });

      const gunzip = createGunzip();
      const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

      res.pipe(gunzip);

      rl.on('line', line => {
        if (done || !line.trim()) return;
        linesSeen++;

        if (SAMPLE_MODE && linesSeen > SAMPLE_LIMIT) {
          done = true;
          rl.close();
          res.destroy();
          return;
        }

        try {
          const product = JSON.parse(line);
          if (isUS(product)) {
            const slim = pickFields(product);
            if (slim.code || slim.product_name) {
              outStream.write(JSON.stringify(slim) + '\n');
              usProducts++;
            }
          }
        } catch {
          // malformed JSON line — skip silently
        }
      });

      rl.on('close', () => {
        outStream.end(() => resolve());
      });

      rl.on('error', reject);
      gunzip.on('error', reject);
      res.on('error', err => {
        // ECONNRESET after rl.close() is expected in sample mode
        if (done && err.code === 'ECONNRESET') return;
        reject(err);
      });
    });
  });

  console.log(`\n\nDone.`);
  console.log(`  Lines scanned:   ${linesSeen.toLocaleString()}`);
  console.log(`  US products:     ${usProducts.toLocaleString()}`);
  console.log(`  Output:          ${OUT_FILE}`);
  console.log(`\nNext: use this file as a reference catalog for product matching and catalog expansion.`);
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
