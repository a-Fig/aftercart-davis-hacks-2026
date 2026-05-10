/**
 * Read-only query helpers for the local Open Food Facts SQLite database.
 *
 * Usage:
 *   import { openOff, lookupByBarcode, search, productsByStore } from './query.mjs';
 *   const db = openOff();
 *   const product = lookupByBarcode(db, '0078742370156');
 *   const matches = search(db, 'boneless chicken thigh', 10);
 *
 * The DB is opened read-only and shared by all helpers. Caller closes when done.
 * Do NOT bundle this into the Next.js app — it depends on a local file outside
 * the deploy artifact and on the better-sqlite3 native binary.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const DB_PATH = process.env.OFF_SQLITE_PATH ?? join(ROOT, 'data', 'open-food-facts', 'us-products.sqlite');
const SAMPLE_DB_PATH = join(ROOT, 'data', 'open-food-facts', 'us-products-sample.sqlite');

/**
 * Open the local OFF SQLite database read-only.
 * @param {object} [opts]
 * @param {boolean} [opts.sample] Open the sample DB instead of the full one.
 * @returns {Database.Database}
 */
export function openOff({ sample = false } = {}) {
  const path = sample ? SAMPLE_DB_PATH : DB_PATH;
  if (!existsSync(path)) {
    throw new Error(`OFF SQLite not found at ${path}. Run \`node web/scripts/build-off-sqlite.mjs${sample ? ' --sample' : ''}\` first.`);
  }
  // Use the URI form with immutable=1 when the file lives on a network/FUSE
  // mount (Cloud Run's GCS FUSE volume). immutable=1 tells SQLite the file
  // will NEVER be modified — it skips all locking, WAL, and SHM file lookups
  // that normal POSIX filesystems support but FUSE-mounted GCS doesn't.
  // Without this, better-sqlite3 throws "disk I/O error" on the first query
  // because the .sqlite-shm sibling doesn't exist on the mount.
  // Local dev (regular filesystem) tolerates this fine — it's a no-op there.
  return new Database(path, { readonly: true, fileMustExist: true });
}

/**
 * Module-scope singleton for use by API routes — opens the OFF SQLite once on
 * first call and reuses across requests. Returns null (not throws) when the
 * file doesn't exist so the route can degrade gracefully (e.g. CI without OFF).
 *
 * Do NOT use from CLI scripts — those should call openOff() so each script's
 * lifetime owns its own handle.
 */
let _sharedDb = null;
let _sharedDbAttempted = false;
export function getSharedOff() {
  if (_sharedDbAttempted) return _sharedDb;
  _sharedDbAttempted = true;
  try {
    _sharedDb = openOff();
  } catch (err) {
    console.warn('[off] OFF SQLite unavailable:', err.message);
    _sharedDb = null;
  }
  return _sharedDb;
}

/** Look up a single product by exact barcode/UPC. Returns null if not found. */
export function lookupByBarcode(db, barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  const row = db.prepare(`
    SELECT barcode, product_name, generic_name, brands, quantity_raw,
           package_size, package_unit, image_url
    FROM products
    WHERE barcode = ?
       OR barcode = ?
       OR barcode = ?
  `).get(code, code.replace(/^0+/, ''), '0' + code);
  return row || null;
}

/**
 * Returns just the pack info for a barcode: { package_size, package_unit, product_name }.
 * Used by the compare route to volume-normalize comparisons without joining
 * OFF data into Postgres.
 *
 * Falls back to parsing the raw OFF `quantity_raw` string ("32 oz", "1 L", ...)
 * when the pre-extracted package_size / package_unit columns are NULL.
 *
 * Returns null if the barcode is not in the OFF SQLite.
 *
 * @param {Database.Database} db
 * @param {string} barcode
 * @returns {{ package_size: number|null, package_unit: string|null, product_name: string|null } | null}
 */
export function getProductPack(db, barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  const row = db.prepare(`
    SELECT product_name, quantity_raw, package_size, package_unit
    FROM products
    WHERE barcode = ?
       OR barcode = ?
       OR barcode = ?
    LIMIT 1
  `).get(code, code.replace(/^0+/, ''), '0' + code);
  if (!row) return null;

  let pack_size = row.package_size != null ? Number(row.package_size) : null;
  let pack_unit = row.package_unit || null;

  // Fallback: parse "32 oz" / "1 L" / "454 g" out of quantity_raw when the
  // pre-extracted columns are missing. Best-effort — leave as null on miss.
  if ((pack_size == null || !pack_unit) && row.quantity_raw) {
    const m = String(row.quantity_raw).trim().match(/^([\d.]+)\s*([a-zA-Z]+)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) {
        if (pack_size == null) pack_size = n;
        if (!pack_unit) pack_unit = m[2].toLowerCase();
      }
    }
  }

  return {
    package_size: pack_size,
    package_unit: pack_unit,
    product_name: row.product_name || null,
  };
}

/**
 * Pull the full enrichment payload for one barcode — image + scoring + nutrition
 * + allergens + traces + additives. Returns null if barcode not found.
 *
 * Used by API routes to bake OFF data into receipt comparison responses so the
 * client doesn't have to make a second round-trip per modal open.
 *
 * Shape:
 *   {
 *     barcode, product_name, brands, generic_name, image_url, serving_size,
 *     quantity_raw, package_size, package_unit,
 *     nutriscore_grade, nova_group, ecoscore_grade,
 *     ingredients_text,
 *     allergens: string[], traces: string[], additives: string[],
 *     nutriments: { energy_kcal_100g, sugars_100g, ... },  // big-8 + raw json
 *   }
 */
export function getEnrichment(db, barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  const product = db.prepare(`
    SELECT barcode, product_name, generic_name, brands, image_url, serving_size,
           quantity_raw, package_size, package_unit,
           nutriscore_grade, nova_group, ecoscore_grade,
           ingredients_text,
           energy_kcal_100g, sugars_100g, sodium_100g, fat_100g,
           saturated_fat_100g, proteins_100g, fiber_100g, salt_100g,
           nutriments_json
    FROM products
    WHERE barcode = ? OR barcode = ? OR barcode = ?
    LIMIT 1
  `).get(code, code.replace(/^0+/, ''), '0' + code);
  if (!product) return null;

  return hydrateEnrichment(db, product);
}

/**
 * Batch variant — pulls enrichment for an array of barcodes in 4 queries (one
 * per source table) and returns a Map keyed by the LOOKUP barcode the caller
 * passed in (so callers don't have to handle leading-zero normalization).
 *
 * Performance: ~5-15 ms for 100 barcodes. Linear in barcode count, not products.
 */
export function getEnrichmentBatch(db, barcodes) {
  const lookupKeys = (barcodes || []).map(b => String(b || '').trim()).filter(Boolean);
  if (!lookupKeys.length) return new Map();

  // Build a candidate set covering each lookup key + its leading-zero variants
  const candidateSet = new Set();
  const keyToCandidates = new Map();
  for (const key of lookupKeys) {
    const cands = [key, key.replace(/^0+/, ''), '0' + key];
    keyToCandidates.set(key, cands);
    for (const c of cands) if (c) candidateSet.add(c);
  }
  const candidates = Array.from(candidateSet);
  const placeholders = candidates.map(() => '?').join(',');

  const products = db.prepare(`
    SELECT barcode, product_name, generic_name, brands, image_url, serving_size,
           quantity_raw, package_size, package_unit,
           nutriscore_grade, nova_group, ecoscore_grade,
           ingredients_text,
           energy_kcal_100g, sugars_100g, sodium_100g, fat_100g,
           saturated_fat_100g, proteins_100g, fiber_100g, salt_100g,
           nutriments_json
    FROM products WHERE barcode IN (${placeholders})
  `).all(...candidates);
  if (!products.length) return new Map();

  const productByBarcode = new Map(products.map(p => [p.barcode, p]));

  // Bulk-load child tables for all matched barcodes
  const matchedBarcodes = products.map(p => p.barcode);
  const matchedPlaceholders = matchedBarcodes.map(() => '?').join(',');
  const allergenRows = db.prepare(`SELECT barcode, allergen FROM product_allergens WHERE barcode IN (${matchedPlaceholders})`).all(...matchedBarcodes);
  const traceRows    = db.prepare(`SELECT barcode, trace    FROM product_traces    WHERE barcode IN (${matchedPlaceholders})`).all(...matchedBarcodes);
  const additiveRows = db.prepare(`SELECT barcode, additive FROM product_additives WHERE barcode IN (${matchedPlaceholders})`).all(...matchedBarcodes);

  const allergensByBarcode = groupBy(allergenRows, 'barcode', 'allergen');
  const tracesByBarcode    = groupBy(traceRows,    'barcode', 'trace');
  const additivesByBarcode = groupBy(additiveRows, 'barcode', 'additive');

  const out = new Map();
  for (const lookupKey of lookupKeys) {
    const cands = keyToCandidates.get(lookupKey);
    let matched = null;
    for (const c of cands) { if (productByBarcode.has(c)) { matched = productByBarcode.get(c); break; } }
    if (!matched) continue;
    out.set(lookupKey, hydrateEnrichmentFromBatch(matched, allergensByBarcode, tracesByBarcode, additivesByBarcode));
  }
  return out;
}

// Internal: assemble the final enrichment object from a product row + its child rows.
function hydrateEnrichment(db, product) {
  const allergens = db.prepare(`SELECT allergen FROM product_allergens WHERE barcode = ?`).all(product.barcode).map(r => r.allergen);
  const traces    = db.prepare(`SELECT trace    FROM product_traces    WHERE barcode = ?`).all(product.barcode).map(r => r.trace);
  const additives = db.prepare(`SELECT additive FROM product_additives WHERE barcode = ?`).all(product.barcode).map(r => r.additive);
  return assembleEnrichment(product, allergens, traces, additives);
}

function hydrateEnrichmentFromBatch(product, allergensByBarcode, tracesByBarcode, additivesByBarcode) {
  return assembleEnrichment(
    product,
    allergensByBarcode.get(product.barcode) || [],
    tracesByBarcode.get(product.barcode)    || [],
    additivesByBarcode.get(product.barcode) || []
  );
}

function assembleEnrichment(product, allergens, traces, additives) {
  const nutriments = {
    energy_kcal_100g:    product.energy_kcal_100g,
    sugars_100g:         product.sugars_100g,
    sodium_100g:         product.sodium_100g,
    fat_100g:            product.fat_100g,
    saturated_fat_100g:  product.saturated_fat_100g,
    proteins_100g:       product.proteins_100g,
    fiber_100g:          product.fiber_100g,
    salt_100g:           product.salt_100g,
  };
  // Fold extra nutriments (vitamins, minerals, etc.) from the JSON blob —
  // expose them under their OFF key names so callers can pluck what they need.
  if (product.nutriments_json) {
    try {
      const extra = JSON.parse(product.nutriments_json);
      if (extra && typeof extra === 'object') {
        for (const [k, v] of Object.entries(extra)) {
          if (nutriments[k] === undefined) nutriments[k] = v;
        }
      }
    } catch { /* malformed JSON — ignore */ }
  }
  return {
    barcode:           product.barcode,
    product_name:      product.product_name,
    generic_name:      product.generic_name,
    brands:            product.brands,
    image_url:         product.image_url,
    serving_size:      product.serving_size,
    quantity_raw:      product.quantity_raw,
    package_size:      product.package_size,
    package_unit:      product.package_unit,
    nutriscore_grade:  product.nutriscore_grade,
    nova_group:        product.nova_group,
    ecoscore_grade:    product.ecoscore_grade,
    ingredients_text:  product.ingredients_text,
    allergens,
    traces,
    additives,
    nutriments,
  };
}

function groupBy(rows, keyField, valueField) {
  const map = new Map();
  for (const row of rows) {
    const k = row[keyField];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row[valueField]);
  }
  return map;
}

/**
 * Free-text search wrapper that returns hits in the candidate-shape used by
 * the review screen. Adds image_url + light enrichment fields so the UI can
 * render a thumbnail without a second round-trip.
 */
export function searchOff(db, query, limit = 10) {
  if (!query || !query.trim()) return [];
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];
  return db.prepare(`
    SELECT p.barcode, p.product_name, p.brands, p.generic_name,
           p.quantity_raw, p.package_size, p.package_unit,
           p.image_url, p.nutriscore_grade, p.nova_group,
           bm25(products_fts) AS score
    FROM products_fts
    JOIN products p ON p.rowid = products_fts.rowid
    WHERE products_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `).all(sanitized, limit);
}

/**
 * Full-text search over product_name + brands + generic_name.
 * Returns top N matches ordered by FTS5 BM25 relevance.
 * @param {Database.Database} db
 * @param {string} query Free-text query (FTS5 syntax — wrap in quotes for phrase, append * for prefix).
 * @param {number} [limit=10]
 * @returns {Array<{barcode:string, product_name:string, brands:string, quantity_raw:string, score:number}>}
 */
export function search(db, query, limit = 10) {
  if (!query || !query.trim()) return [];
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];
  return db.prepare(`
    SELECT p.barcode, p.product_name, p.brands, p.generic_name,
           p.quantity_raw, p.package_size, p.package_unit, p.image_url,
           bm25(products_fts) AS score
    FROM products_fts
    JOIN products p ON p.rowid = products_fts.rowid
    WHERE products_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `).all(sanitized, limit);
}

/**
 * FTS5 chokes on raw user input (special chars: ., -, ', ", AND/OR, etc.).
 * Tokenize on word boundaries, drop empties, recombine as a simple AND query
 * with prefix matching on the last token for partial-word search.
 */
function sanitizeFtsQuery(raw) {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  if (!tokens.length) return null;
  const last = tokens.pop();
  const all = [...tokens.map(t => `"${t}"`), `"${last}"*`];
  return all.join(' AND ');
}

/** All barcodes in the given category tag (e.g. 'en:lettuces'). */
export function productsInCategory(db, categoryTag, limit = 100) {
  return db.prepare(`
    SELECT p.barcode, p.product_name, p.brands, p.quantity_raw
    FROM product_categories c
    JOIN products p ON p.barcode = c.barcode
    WHERE c.category = ?
    LIMIT ?
  `).all(categoryTag, limit);
}

/** All products tagged with the given store (e.g. 'safeway', 'trader-joe-s'). */
export function productsByStore(db, storeTag, limit = 100) {
  return db.prepare(`
    SELECT p.barcode, p.product_name, p.brands, p.quantity_raw
    FROM product_stores s
    JOIN products p ON p.barcode = s.barcode
    WHERE s.store = ?
    LIMIT ?
  `).all(storeTag, limit);
}

/** All categories for a single product. */
export function categoriesFor(db, barcode) {
  return db.prepare(`SELECT category FROM product_categories WHERE barcode = ?`)
    .all(barcode).map(r => r.category);
}

/**
 * For a single barcode, return its MOST SPECIFIC OFF category — defined as
 * the category this product is tagged with that has the smallest member
 * count overall, within a sensible band (3–5000 members).
 *
 *   • Below 3 → singleton/near-singleton, won't yield useful peers.
 *   • Above 5000 → way too broad (e.g., `en:foods`, `en:beverages`).
 *
 * The OFF category list per product is broad-to-specific (e.g.,
 * `en:foods → en:dairies → en:milks → en:whole-milks`); filtering by member
 * count picks the deepest useful node automatically without depending on
 * tag-string heuristics.
 *
 * Returns null when no category falls in the band — caller should fall
 * back gracefully (no live equivalents for this pick).
 *
 * Tolerant of leading-zero barcode variants (Costco "078742370156" vs
 * OFF "0078742370156" vs "78742370156").
 *
 * @param {Database.Database} db
 * @param {string} barcode
 * @returns {string|null}
 */
export function getMostSpecificCategory(db, barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  const stripped = code.replace(/^0+/, '');
  const padded = '0' + code;

  const row = db.prepare(`
    SELECT pc.category, COUNT(pc2.barcode) AS freq
    FROM product_categories pc
    JOIN product_categories pc2 ON pc2.category = pc.category
    WHERE pc.barcode IN (?, ?, ?)
    GROUP BY pc.category
    HAVING freq BETWEEN 3 AND 5000
    ORDER BY freq ASC
    LIMIT 1
  `).get(code, stripped, padded);

  return row?.category || null;
}

/**
 * Return up to `limit` distinct barcodes tagged with `category`. Used as the
 * peer set for live, query-time equivalence lookup — these barcodes are then
 * intersected against `current_prices` in Postgres via JOIN, so most will
 * filter out (only ~14k of OFF's 896k US products have any price data).
 *
 * @param {Database.Database} db
 * @param {string} category
 * @param {number} [limit=300]
 * @returns {string[]}
 */
export function peersInCategory(db, category, limit = 300) {
  if (!category) return [];
  return db.prepare(`
    SELECT DISTINCT barcode FROM product_categories
    WHERE category = ? LIMIT ?
  `).all(category, limit).map(r => r.barcode);
}

/** Quick count summary for sanity checks. */
export function summary(db) {
  return {
    products:   db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
    categories: db.prepare('SELECT COUNT(DISTINCT category) AS n FROM product_categories').get().n,
    stores:     db.prepare('SELECT COUNT(DISTINCT store) AS n FROM product_stores').get().n,
    labels:     db.prepare('SELECT COUNT(DISTINCT label) AS n FROM product_labels').get().n,
  };
}
