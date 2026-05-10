/**
 * OFF SQLite queries for the /inspect dashboard.
 *
 * Wraps the SQLite handle from web/lib/off/query.mjs (`getSharedOff()` returns
 * null when the file is missing — we propagate that null upward so callers
 * can render a graceful "OFF data unavailable" panel instead of a 500).
 *
 * Schema reference (from web/scripts/build-off-sqlite.mjs):
 *   products(barcode, product_name, generic_name, brands, quantity_raw,
 *            package_size, package_unit, serving_size, image_url,
 *            nutriscore_grade, nova_group, ecoscore_grade,
 *            ingredients_text, allergens_raw,
 *            energy_kcal_100g, sugars_100g, sodium_100g, fat_100g,
 *            saturated_fat_100g, proteins_100g, fiber_100g, salt_100g,
 *            nutriments_json, raw_json)
 *   product_categories(barcode, category)
 *   product_stores(barcode, store)
 *   product_labels(barcode, label)
 *   product_allergens(barcode, allergen)
 *   product_traces(barcode, trace)
 *   product_additives(barcode, additive)
 *   products_fts (FTS5 over product_name + brands + generic_name)
 */

import { getSharedOff, getEnrichment, getEnrichmentBatch, searchOff } from '../off/query.mjs'

/**
 * High-level OFF coverage stats for the overview page.
 *
 * Returns the shape:
 *   {
 *     available: boolean,                // false if SQLite handle missing
 *     products_total, with_nutriscore, with_nova, with_ecoscore,
 *     with_image, with_ingredients, with_allergens,
 *     with_any_nutriment,                // any of the big-8 macros populated
 *   }
 *
 * Each query is a single COUNT — sub-second on the ~896k product table.
 */
export function getOffCoverage() {
  const db = getSharedOff()
  if (!db) {
    return {
      available: false,
      products_total: 0,
      with_nutriscore: 0,
      with_nova: 0,
      with_ecoscore: 0,
      with_image: 0,
      with_ingredients: 0,
      with_allergens: 0,
      with_any_nutriment: 0,
    }
  }
  const one = (sql) => db.prepare(sql).get().n
  return {
    available: true,
    products_total:     one('SELECT COUNT(*) AS n FROM products'),
    with_nutriscore:    one("SELECT COUNT(*) AS n FROM products WHERE nutriscore_grade IS NOT NULL"),
    with_nova:          one("SELECT COUNT(*) AS n FROM products WHERE nova_group IS NOT NULL"),
    with_ecoscore:      one("SELECT COUNT(*) AS n FROM products WHERE ecoscore_grade IS NOT NULL"),
    with_image:         one("SELECT COUNT(*) AS n FROM products WHERE image_url IS NOT NULL"),
    with_ingredients:   one("SELECT COUNT(*) AS n FROM products WHERE ingredients_text IS NOT NULL"),
    with_allergens:     one("SELECT COUNT(DISTINCT barcode) AS n FROM product_allergens"),
    with_any_nutriment: one(`
      SELECT COUNT(*) AS n FROM products
      WHERE energy_kcal_100g IS NOT NULL
         OR fat_100g          IS NOT NULL
         OR saturated_fat_100g IS NOT NULL
         OR sugars_100g       IS NOT NULL
         OR fiber_100g        IS NOT NULL
         OR proteins_100g     IS NOT NULL
         OR sodium_100g       IS NOT NULL
         OR salt_100g         IS NOT NULL
    `),
  }
}

/**
 * Pull enrichment for a single barcode. Thin wrapper that returns null when
 * either the handle or the row is missing, so server components can branch
 * on a single null check.
 */
export function lookupEnrichment(barcode) {
  const db = getSharedOff()
  if (!db) return null
  return getEnrichment(db, barcode)
}

/**
 * Batch enrichment lookup. Returns an empty Map when the OFF handle is
 * missing so iteration code (`for (const e of map.values())`) is always
 * safe. The returned Map keys are the barcodes the caller passed in.
 *
 * @param {string[]} barcodes
 */
export function lookupEnrichmentBatch(barcodes) {
  const db = getSharedOff()
  if (!db) return new Map()
  if (!barcodes || barcodes.length === 0) return new Map()
  return getEnrichmentBatch(db, barcodes)
}

/**
 * Free-text FTS5 search via web/lib/off/query.mjs's searchOff(). Returns
 * empty array when handle is missing or query produces no candidates.
 *
 * Each row carries: barcode, product_name, brands, generic_name,
 * quantity_raw, package_size, package_unit, image_url, nutriscore_grade,
 * nova_group, score (FTS5 BM25; lower = more relevant).
 */
export function searchOffProducts(q, limit = 25) {
  const db = getSharedOff()
  if (!db) return []
  return searchOff(db, q, limit)
}

/**
 * Surface whether a barcode shows up in OFF at all — used by /inspect/off/[barcode]
 * before deciding to render the full enrichment panel vs a "not found" notice.
 */
export function offHasBarcode(barcode) {
  const db = getSharedOff()
  if (!db) return false
  const code = String(barcode || '').trim()
  if (!code) return false
  const row = db.prepare(
    `SELECT 1 AS x FROM products WHERE barcode = ? OR barcode = ? OR barcode = ? LIMIT 1`,
  ).get(code, code.replace(/^0+/, ''), '0' + code)
  return !!row
}

/** Categories tagged on a single OFF product. */
export function categoriesFor(barcode) {
  const db = getSharedOff()
  if (!db) return []
  return db.prepare(
    `SELECT category FROM product_categories WHERE barcode = ? OR barcode = ? OR barcode = ? ORDER BY category`,
  ).all(barcode, String(barcode).replace(/^0+/, ''), '0' + String(barcode)).map(r => r.category)
}

/** Stores tagged on a single OFF product (OFF community-curated). */
export function storesFor(barcode) {
  const db = getSharedOff()
  if (!db) return []
  return db.prepare(
    `SELECT store FROM product_stores WHERE barcode = ? OR barcode = ? OR barcode = ? ORDER BY store`,
  ).all(barcode, String(barcode).replace(/^0+/, ''), '0' + String(barcode)).map(r => r.store)
}

/** Labels tagged on a single OFF product. */
export function labelsFor(barcode) {
  const db = getSharedOff()
  if (!db) return []
  return db.prepare(
    `SELECT label FROM product_labels WHERE barcode = ? OR barcode = ? OR barcode = ? ORDER BY label`,
  ).all(barcode, String(barcode).replace(/^0+/, ''), '0' + String(barcode)).map(r => r.label)
}

/** Re-export used in pages that want to know "is OFF up at all?" */
export function offAvailable() {
  return getSharedOff() != null
}
