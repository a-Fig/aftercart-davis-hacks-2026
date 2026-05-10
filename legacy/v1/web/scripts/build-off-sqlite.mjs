#!/usr/bin/env node
/**
 * Builds a SQLite database from the filtered Open Food Facts JSONL.
 *
 * Input:  data/open-food-facts/us-products.jsonl  (from download-off.mjs)
 * Output: data/open-food-facts/us-products.sqlite
 *
 * Run from workspace root:
 *   node web/scripts/build-off-sqlite.mjs              # full build
 *   node web/scripts/build-off-sqlite.mjs --sample     # build from us-products-sample.jsonl
 *
 * Build is a single transaction over the JSONL plus a one-shot FTS5 index rebuild.
 * Expect 2-4 minutes for the full file, output ~250-350 MB.
 */

import Database from 'better-sqlite3';
import { createReadStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data', 'open-food-facts');

const args = process.argv.slice(2);
const SAMPLE_MODE = args.includes('--sample');
const IN_FILE = join(DATA_DIR, SAMPLE_MODE ? 'us-products-sample.jsonl' : 'us-products.jsonl');
const OUT_FILE = join(DATA_DIR, SAMPLE_MODE ? 'us-products-sample.sqlite' : 'us-products.sqlite');

// ── Quantity parser ──────────────────────────────────────────
// OFF stores quantity as freeform text: "32 oz", "1 lb", "1.5 g", "500 mL", "12 ct".
// Extract a numeric value + normalized unit; leave both null on parse failure.
const UNIT_MAP = new Map([
  ['oz', 'oz'], ['ounce', 'oz'], ['ounces', 'oz'],
  ['lb', 'lb'], ['lbs', 'lb'], ['pound', 'lb'], ['pounds', 'lb'], ['#', 'lb'],
  ['g', 'g'], ['gr', 'g'], ['gram', 'g'], ['grams', 'g'],
  ['kg', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['ml', 'ml'], ['milliliter', 'ml'], ['millilitre', 'ml'],
  ['l', 'l'], ['liter', 'l'], ['litre', 'l'],
  ['ct', 'each'], ['count', 'each'], ['ea', 'each'], ['each', 'each'],
  ['pk', 'each'], ['pack', 'each'], ['pcs', 'each'], ['piece', 'each'], ['pieces', 'each'],
  ['gal', 'gal'], ['gallon', 'gal'], ['gallons', 'gal'],
  ['fl oz', 'fl_oz'], ['floz', 'fl_oz'], ['fluid ounce', 'fl_oz'], ['fluid ounces', 'fl_oz'],
  ['pt', 'pt'], ['pint', 'pt'], ['pints', 'pt'],
  ['qt', 'qt'], ['quart', 'qt'], ['quarts', 'qt'],
]);

function parseQuantity(raw) {
  if (!raw || typeof raw !== 'string') return [null, null];
  const cleaned = raw.toLowerCase().trim();
  // Match leading number (allow decimals + commas) followed by optional space + unit token
  const m = cleaned.match(/^([\d]+(?:[.,]\d+)?)\s*([a-z#]+(?:\s+[a-z]+)?)?/);
  if (!m) return [null, null];
  const value = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(value)) return [null, null];
  if (!m[2]) return [value, null];
  const unitRaw = m[2].trim();
  const unit = UNIT_MAP.get(unitRaw) || UNIT_MAP.get(unitRaw.replace(/\s+/g, '')) || null;
  return [value, unit];
}

// ── DB schema ────────────────────────────────────────────────
//
// Layout matches the OFF JSONL field set (download-off.mjs's KEEP_FIELDS) plus
// extracted nutriment columns for the standard 8 macros so they're queryable
// without parsing JSON. Full nutriments object kept as `nutriments_json` for
// anything outside the big-8 (vitamins, minerals, etc.).
//
// Allergens / traces / additives live in child tables, mirroring the existing
// categories / stores / labels pattern.
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;  -- 64 MB page cache during build

CREATE TABLE products (
  rowid              INTEGER PRIMARY KEY,
  barcode            TEXT NOT NULL UNIQUE,
  product_name       TEXT,
  generic_name       TEXT,
  brands             TEXT,
  quantity_raw       TEXT,
  package_size       REAL,
  package_unit       TEXT,
  serving_size       TEXT,
  image_url          TEXT,

  -- Health scoring
  nutriscore_grade   TEXT,    -- 'a' | 'b' | 'c' | 'd' | 'e'
  nova_group         INTEGER, -- 1..4
  ecoscore_grade     TEXT,    -- 'a' | 'b' | 'c' | 'd' | 'e'

  -- Composition
  ingredients_text   TEXT,
  allergens_raw      TEXT,    -- raw 'allergens' string (may be empty when allergens_tags is set)

  -- Nutrition — standard 8 macros extracted for indexability
  energy_kcal_100g   REAL,
  sugars_100g        REAL,
  sodium_100g        REAL,
  fat_100g           REAL,
  saturated_fat_100g REAL,
  proteins_100g      REAL,
  fiber_100g         REAL,
  salt_100g          REAL,

  -- Full nutriments object as JSON for everything else (vitamins, minerals, etc.)
  nutriments_json    TEXT,

  -- Catch-all for any KEEP_FIELDS we didn't extract explicitly
  raw_json           TEXT
);

CREATE TABLE product_categories (
  barcode  TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY (barcode, category)
);

CREATE TABLE product_stores (
  barcode TEXT NOT NULL,
  store   TEXT NOT NULL,
  PRIMARY KEY (barcode, store)
);

CREATE TABLE product_labels (
  barcode TEXT NOT NULL,
  label   TEXT NOT NULL,
  PRIMARY KEY (barcode, label)
);

CREATE TABLE product_allergens (
  barcode  TEXT NOT NULL,
  allergen TEXT NOT NULL,
  PRIMARY KEY (barcode, allergen)
);

CREATE TABLE product_traces (
  barcode TEXT NOT NULL,
  trace   TEXT NOT NULL,
  PRIMARY KEY (barcode, trace)
);

CREATE TABLE product_additives (
  barcode  TEXT NOT NULL,
  additive TEXT NOT NULL,
  PRIMARY KEY (barcode, additive)
);

CREATE INDEX idx_categories_cat   ON product_categories(category);
CREATE INDEX idx_stores_store     ON product_stores(store);
CREATE INDEX idx_labels_label     ON product_labels(label);
CREATE INDEX idx_allergens_tag    ON product_allergens(allergen);
CREATE INDEX idx_traces_tag       ON product_traces(trace);
CREATE INDEX idx_additives_tag    ON product_additives(additive);
CREATE INDEX idx_products_brand   ON products(brands);
CREATE INDEX idx_products_nutri   ON products(nutriscore_grade) WHERE nutriscore_grade IS NOT NULL;
CREATE INDEX idx_products_nova    ON products(nova_group)       WHERE nova_group IS NOT NULL;

CREATE VIRTUAL TABLE products_fts USING fts5(
  product_name,
  brands,
  generic_name,
  content='products',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
`;

function fmtBytes(n) {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function main() {
  if (!existsSync(IN_FILE)) {
    console.error(`Input not found: ${IN_FILE}`);
    console.error(SAMPLE_MODE
      ? 'Run `node web/scripts/download-off.mjs --sample` first.'
      : 'Run `node web/scripts/download-off.mjs` first (or use --sample).');
    process.exit(1);
  }

  if (existsSync(OUT_FILE)) {
    console.log(`Removing existing ${OUT_FILE}`);
    unlinkSync(OUT_FILE);
  }

  const inSize = statSync(IN_FILE).size;
  console.log(`Input:  ${IN_FILE} (${fmtBytes(inSize)})`);
  console.log(`Output: ${OUT_FILE}\n`);

  const db = new Database(OUT_FILE);
  db.exec(SCHEMA);

  const insertProduct = db.prepare(`
    INSERT INTO products (
      barcode, product_name, generic_name, brands, quantity_raw, package_size, package_unit, serving_size, image_url,
      nutriscore_grade, nova_group, ecoscore_grade,
      ingredients_text, allergens_raw,
      energy_kcal_100g, sugars_100g, sodium_100g, fat_100g, saturated_fat_100g, proteins_100g, fiber_100g, salt_100g,
      nutriments_json, raw_json
    )
    VALUES (
      @barcode, @product_name, @generic_name, @brands, @quantity_raw, @package_size, @package_unit, @serving_size, @image_url,
      @nutriscore_grade, @nova_group, @ecoscore_grade,
      @ingredients_text, @allergens_raw,
      @energy_kcal_100g, @sugars_100g, @sodium_100g, @fat_100g, @saturated_fat_100g, @proteins_100g, @fiber_100g, @salt_100g,
      @nutriments_json, @raw_json
    )
    ON CONFLICT(barcode) DO UPDATE SET
      product_name        = excluded.product_name,
      generic_name        = excluded.generic_name,
      brands              = excluded.brands,
      quantity_raw        = excluded.quantity_raw,
      package_size        = excluded.package_size,
      package_unit        = excluded.package_unit,
      serving_size        = excluded.serving_size,
      image_url           = excluded.image_url,
      nutriscore_grade    = excluded.nutriscore_grade,
      nova_group          = excluded.nova_group,
      ecoscore_grade      = excluded.ecoscore_grade,
      ingredients_text    = excluded.ingredients_text,
      allergens_raw       = excluded.allergens_raw,
      energy_kcal_100g    = excluded.energy_kcal_100g,
      sugars_100g         = excluded.sugars_100g,
      sodium_100g         = excluded.sodium_100g,
      fat_100g            = excluded.fat_100g,
      saturated_fat_100g  = excluded.saturated_fat_100g,
      proteins_100g       = excluded.proteins_100g,
      fiber_100g          = excluded.fiber_100g,
      salt_100g           = excluded.salt_100g,
      nutriments_json     = excluded.nutriments_json,
      raw_json            = excluded.raw_json
  `);
  const insertCategory = db.prepare(`INSERT OR IGNORE INTO product_categories (barcode, category) VALUES (?, ?)`);
  const insertStore    = db.prepare(`INSERT OR IGNORE INTO product_stores     (barcode, store)    VALUES (?, ?)`);
  const insertLabel    = db.prepare(`INSERT OR IGNORE INTO product_labels     (barcode, label)    VALUES (?, ?)`);
  const insertAllergen = db.prepare(`INSERT OR IGNORE INTO product_allergens  (barcode, allergen) VALUES (?, ?)`);
  const insertTrace    = db.prepare(`INSERT OR IGNORE INTO product_traces     (barcode, trace)    VALUES (?, ?)`);
  const insertAdditive = db.prepare(`INSERT OR IGNORE INTO product_additives  (barcode, additive) VALUES (?, ?)`);

  let lines = 0;
  let inserted = 0;
  let skippedNoBarcode = 0;
  let skippedBadJson = 0;
  let lastLog = Date.now();

  // KEEP_FIELDS in download-off.mjs is the source of truth. Anything NOT listed
  // here gets stuffed into raw_json so we don't lose data we did pay to download.
  const KEEP_RAW_FIELDS = [
    'code', 'product_name', 'generic_name', 'brands', 'brands_tags',
    'categories_tags', 'quantity', 'serving_size', 'countries_tags',
    'labels_tags', 'stores_tags', 'image_front_url',
    'nutriscore_grade', 'nova_group', 'ecoscore_grade',
    'ingredients_text', 'allergens', 'allergens_tags', 'traces_tags', 'additives_tags',
    'nutriments',
  ];

  // Pull a numeric nutriment value out of OFF's nutriments object. OFF stores
  // these with multiple naming conventions; the _100g suffix is the per-100g
  // value that's comparable across products.
  function nutriment(n, key) {
    if (!n || typeof n !== 'object') return null;
    const v = n[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const parsed = parseFloat(v);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  // Coerce `nova_group`. OFF stores it as either a number or a string; we want INTEGER.
  function novaGroup(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    if (typeof v === 'string') {
      const parsed = parseInt(v, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  const tx = db.transaction((batch) => {
    for (const product of batch) {
      const barcode = String(product.code || '').trim();
      if (!barcode) { skippedNoBarcode++; continue; }

      const [size, unit] = parseQuantity(product.quantity);
      const n = product.nutriments;

      // raw_json keeps anything outside KEEP_RAW_FIELDS — futureproofs against
      // download-off.mjs adding new fields without immediate matching schema work.
      const rawExtras = {};
      for (const k of Object.keys(product)) {
        if (!KEEP_RAW_FIELDS.includes(k)) rawExtras[k] = product[k];
      }

      insertProduct.run({
        barcode,
        product_name:        product.product_name || null,
        generic_name:        product.generic_name || null,
        brands:              product.brands || null,
        quantity_raw:        product.quantity || null,
        package_size:        size,
        package_unit:        unit,
        serving_size:        product.serving_size || null,
        image_url:           product.image_front_url || null,
        nutriscore_grade:    typeof product.nutriscore_grade === 'string' ? product.nutriscore_grade.toLowerCase() : null,
        nova_group:          novaGroup(product.nova_group),
        ecoscore_grade:      typeof product.ecoscore_grade === 'string' ? product.ecoscore_grade.toLowerCase() : null,
        ingredients_text:    product.ingredients_text || null,
        allergens_raw:       product.allergens || null,
        energy_kcal_100g:    nutriment(n, 'energy-kcal_100g'),
        sugars_100g:         nutriment(n, 'sugars_100g'),
        sodium_100g:         nutriment(n, 'sodium_100g'),
        fat_100g:            nutriment(n, 'fat_100g'),
        saturated_fat_100g:  nutriment(n, 'saturated-fat_100g'),
        proteins_100g:       nutriment(n, 'proteins_100g'),
        fiber_100g:          nutriment(n, 'fiber_100g'),
        salt_100g:           nutriment(n, 'salt_100g'),
        nutriments_json:     n && typeof n === 'object' ? JSON.stringify(n) : null,
        raw_json:            Object.keys(rawExtras).length ? JSON.stringify(rawExtras) : null,
      });

      if (Array.isArray(product.categories_tags)) {
        for (const c of product.categories_tags) if (c) insertCategory.run(barcode, c);
      }
      if (Array.isArray(product.stores_tags)) {
        for (const s of product.stores_tags) if (s) insertStore.run(barcode, s);
      }
      if (Array.isArray(product.labels_tags)) {
        for (const l of product.labels_tags) if (l) insertLabel.run(barcode, l);
      }
      if (Array.isArray(product.allergens_tags)) {
        for (const a of product.allergens_tags) if (a) insertAllergen.run(barcode, a);
      }
      if (Array.isArray(product.traces_tags)) {
        for (const t of product.traces_tags) if (t) insertTrace.run(barcode, t);
      }
      if (Array.isArray(product.additives_tags)) {
        for (const a of product.additives_tags) if (a) insertAdditive.run(barcode, a);
      }

      inserted++;
    }
  });

  // Stream JSONL → batch → transaction
  const BATCH_SIZE = 5000;
  let batch = [];

  const rl = createInterface({ input: createReadStream(IN_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    try {
      batch.push(JSON.parse(line));
    } catch {
      skippedBadJson++;
      continue;
    }
    if (batch.length >= BATCH_SIZE) {
      tx(batch);
      batch = [];
      const now = Date.now();
      if (now - lastLog > 3000) {
        process.stdout.write(`\r  Inserted: ${inserted.toLocaleString()} / scanned: ${lines.toLocaleString()}      `);
        lastLog = now;
      }
    }
  }
  if (batch.length) tx(batch);

  console.log(`\r  Inserted: ${inserted.toLocaleString()} / scanned: ${lines.toLocaleString()}      `);
  console.log(`\nBuilding FTS5 index (this takes 30-90 seconds)...`);
  db.exec(`INSERT INTO products_fts(products_fts) VALUES('rebuild')`);

  console.log(`Optimizing...`);
  db.exec(`PRAGMA optimize`);
  db.exec(`VACUUM`);

  // Stats
  const stats = {
    products:    db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
    categories:  db.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n,
    stores:      db.prepare('SELECT COUNT(*) AS n FROM product_stores').get().n,
    labels:      db.prepare('SELECT COUNT(*) AS n FROM product_labels').get().n,
    allergens:   db.prepare('SELECT COUNT(*) AS n FROM product_allergens').get().n,
    traces:      db.prepare('SELECT COUNT(*) AS n FROM product_traces').get().n,
    additives:   db.prepare('SELECT COUNT(*) AS n FROM product_additives').get().n,
    fts:         db.prepare('SELECT COUNT(*) AS n FROM products_fts').get().n,
    withNutri:   db.prepare("SELECT COUNT(*) AS n FROM products WHERE nutriscore_grade IS NOT NULL").get().n,
    withNova:    db.prepare("SELECT COUNT(*) AS n FROM products WHERE nova_group IS NOT NULL").get().n,
    withImage:   db.prepare("SELECT COUNT(*) AS n FROM products WHERE image_url IS NOT NULL").get().n,
    withIngred:  db.prepare("SELECT COUNT(*) AS n FROM products WHERE ingredients_text IS NOT NULL").get().n,
  };

  db.close();

  const outSize = statSync(OUT_FILE).size;
  console.log(`\nDone.`);
  console.log(`  Lines scanned:       ${lines.toLocaleString()}`);
  console.log(`  Products inserted:   ${stats.products.toLocaleString()}`);
  console.log(`  Category rows:       ${stats.categories.toLocaleString()}`);
  console.log(`  Store rows:          ${stats.stores.toLocaleString()}`);
  console.log(`  Label rows:          ${stats.labels.toLocaleString()}`);
  console.log(`  Allergen rows:       ${stats.allergens.toLocaleString()}`);
  console.log(`  Trace rows:          ${stats.traces.toLocaleString()}`);
  console.log(`  Additive rows:       ${stats.additives.toLocaleString()}`);
  console.log(`  FTS5 rows:           ${stats.fts.toLocaleString()}`);
  console.log(`  With Nutri-Score:    ${stats.withNutri.toLocaleString()}`);
  console.log(`  With NOVA group:     ${stats.withNova.toLocaleString()}`);
  console.log(`  With image_url:      ${stats.withImage.toLocaleString()}`);
  console.log(`  With ingredients:    ${stats.withIngred.toLocaleString()}`);
  if (skippedNoBarcode) console.log(`  Skipped (no code):   ${skippedNoBarcode.toLocaleString()}`);
  if (skippedBadJson)   console.log(`  Skipped (bad JSON):  ${skippedBadJson.toLocaleString()}`);
  console.log(`  Output size:         ${fmtBytes(outSize)}`);
  console.log(`\nNext: try \`node web/scripts/test-off-query.mjs\` to smoke-test queries.`);
}

main().catch(err => {
  console.error('\nFailed:', err);
  process.exit(1);
});
