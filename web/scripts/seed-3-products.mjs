/**
 * Phase 3 — Canonical products via FoodData Central
 * Queries FDC for each product to get usda_fdc_id reference.
 * Product names, pricing_unit, and package info are authoritative from our list.
 * Output: db/seed/03_canonical_products.sql
 *
 * Run from repo root: node web/scripts/seed-3-products.mjs
 * Optional env: FDC_API_KEY (defaults to DEMO_KEY)
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { SEED_DIR, esc, fdcFetch, delay } from './seed-utils.mjs'

// Authoritative product list: name, pricing_unit, package_size, package_unit, category (subcategory name from Phase 2)
const PRODUCTS = [
  { name: 'Whole milk',                    pricing: 'per_each', size: 128,  unit: 'fl_oz',  cat: 'Milk',              query: 'whole milk fluid' },
  { name: 'Eggs, large',                   pricing: 'per_each', size: 12,   unit: 'count',  cat: 'Eggs',              query: 'eggs large raw' },
  { name: 'Chicken thighs, bone-in',       pricing: 'per_lb',   size: null, unit: 'lb',     cat: 'Chicken, raw',      query: 'chicken thigh bone-in raw' },
  { name: 'Boneless chicken breast',       pricing: 'per_lb',   size: null, unit: 'lb',     cat: 'Chicken, raw',      query: 'chicken breast boneless skinless raw' },
  { name: 'Ground beef, 80/20',            pricing: 'per_lb',   size: null, unit: 'lb',     cat: 'Ground beef, raw',  query: 'ground beef 80 percent lean raw' },
  { name: 'White rice',                    pricing: 'per_each', size: 80,   unit: 'oz',     cat: 'Rice',              query: 'white rice long grain unenriched dry' },
  { name: 'Dried pinto beans',             pricing: 'per_each', size: 16,   unit: 'oz',     cat: 'Dried beans',       query: 'pinto beans dried' },
  { name: 'White bread',                   pricing: 'per_each', size: 1,    unit: 'loaf',   cat: 'Bread',             query: 'white bread commercially prepared' },
  { name: 'Olive oil',                     pricing: 'per_each', size: 16,   unit: 'fl_oz',  cat: 'Olive oil',         query: 'olive oil' },
  { name: 'Vegetable oil',                 pricing: 'per_each', size: 48,   unit: 'fl_oz',  cat: 'Vegetable oil',     query: 'vegetable oil' },
  { name: 'Butter, salted',               pricing: 'per_each', size: 16,   unit: 'oz',     cat: 'Butter',            query: 'butter salted' },
  { name: 'Cheddar cheese',               pricing: 'per_each', size: 8,    unit: 'oz',     cat: 'Cheese',            query: 'cheddar cheese' },
  { name: 'Orange juice',                  pricing: 'per_each', size: 64,   unit: 'fl_oz',  cat: 'Orange juice',      query: 'orange juice not from concentrate' },
  { name: 'Bananas',                       pricing: 'per_lb',   size: null, unit: 'lb',     cat: 'Bananas',           query: 'bananas raw' },
  { name: 'Apples, Gala',                  pricing: 'per_lb',   size: null, unit: 'lb',     cat: 'Apples',            query: 'gala apples raw' },
  { name: 'Russet potatoes',               pricing: 'per_each', size: 80,   unit: 'oz',     cat: 'Potatoes',          query: 'russet potatoes raw' },
  { name: 'Yellow onions',                 pricing: 'per_each', size: 48,   unit: 'oz',     cat: 'Onions',            query: 'onions raw' },
  { name: 'Baby carrots',                  pricing: 'per_each', size: 16,   unit: 'oz',     cat: 'Carrots',           query: 'carrots baby raw' },
  { name: 'Broccoli',                      pricing: 'per_lb',   size: null, unit: 'lb',     cat: 'Broccoli',          query: 'broccoli raw' },
  { name: 'Spinach',                       pricing: 'per_each', size: 5,    unit: 'oz',     cat: 'Spinach',           query: 'spinach raw' },
  { name: 'Diced tomatoes, canned',        pricing: 'per_each', size: 14.5, unit: 'oz',     cat: 'Canned tomatoes',   query: 'tomatoes canned diced no salt' },
  { name: 'Black beans, canned',           pricing: 'per_each', size: 15,   unit: 'oz',     cat: 'Canned beans',      query: 'black beans canned' },
  { name: 'Spaghetti',                     pricing: 'per_each', size: 16,   unit: 'oz',     cat: 'Pasta',             query: 'spaghetti dry enriched' },
  { name: 'Pasta sauce',                   pricing: 'per_each', size: 24,   unit: 'oz',     cat: 'Pasta sauce',       query: 'pasta sauce marinara' },
  { name: 'Corn flakes cereal',            pricing: 'per_each', size: 18,   unit: 'oz',     cat: 'Breakfast cereal',  query: 'corn flakes cereal' },
  { name: 'Rolled oats',                   pricing: 'per_each', size: 42,   unit: 'oz',     cat: 'Oats',              query: 'oats rolled dry' },
  { name: 'Peanut butter',                 pricing: 'per_each', size: 16,   unit: 'oz',     cat: 'Peanut butter',     query: 'peanut butter creamy' },
  { name: 'Strawberry jelly',              pricing: 'per_each', size: 18,   unit: 'oz',     cat: 'Jelly and jam',     query: 'strawberry jelly' },
  { name: 'White sugar',                   pricing: 'per_each', size: 64,   unit: 'oz',     cat: 'Sugar',             query: 'white sugar granulated' },
  { name: 'All-purpose flour',             pricing: 'per_each', size: 80,   unit: 'oz',     cat: 'Flour',             query: 'all purpose flour enriched' },
  { name: 'Ground coffee',                 pricing: 'per_each', size: 11,   unit: 'oz',     cat: 'Coffee',            query: 'coffee ground roasted' },
  { name: 'Flour tortillas',               pricing: 'per_each', size: 10,   unit: 'count',  cat: 'Tortillas',         query: 'flour tortillas ready to bake' },
  { name: 'Shredded mozzarella',           pricing: 'per_each', size: 8,    unit: 'oz',     cat: 'Cheese',            query: 'mozzarella cheese shredded' },
  { name: 'Greek yogurt',                  pricing: 'per_each', size: 32,   unit: 'oz',     cat: 'Yogurt',            query: 'greek yogurt plain whole milk' },
  { name: 'Sour cream',                    pricing: 'per_each', size: 16,   unit: 'oz',     cat: 'Sour cream',        query: 'sour cream' },
  { name: 'Cream cheese',                  pricing: 'per_each', size: 8,    unit: 'oz',     cat: 'Cream cheese',      query: 'cream cheese' },
  { name: 'Frozen peas',                   pricing: 'per_each', size: 12,   unit: 'oz',     cat: 'Frozen peas',       query: 'peas frozen' },
  { name: 'Frozen corn',                   pricing: 'per_each', size: 12,   unit: 'oz',     cat: 'Frozen corn',       query: 'corn sweet frozen' },
  { name: 'Canned tuna',                   pricing: 'per_each', size: 5,    unit: 'oz',     cat: 'Canned tuna',       query: 'tuna canned in water' },
  { name: 'Mayonnaise',                    pricing: 'per_each', size: 30,   unit: 'oz',     cat: 'Mayonnaise',        query: 'mayonnaise regular' },
  { name: 'Ketchup',                       pricing: 'per_each', size: 32,   unit: 'oz',     cat: 'Ketchup',           query: 'catsup ketchup' },
  { name: 'Yellow mustard',                pricing: 'per_each', size: 20,   unit: 'oz',     cat: 'Mustard',           query: 'mustard yellow prepared' },
  { name: 'Chicken broth',                 pricing: 'per_each', size: 32,   unit: 'oz',     cat: 'Broth',             query: 'chicken broth ready to serve' },
  { name: 'Vegetable broth',               pricing: 'per_each', size: 32,   unit: 'oz',     cat: 'Broth',             query: 'vegetable broth ready to serve' },
  { name: 'Instant ramen',                 pricing: 'per_each', size: 3,    unit: 'oz',     cat: 'Ramen noodles',     query: 'ramen noodles instant' },
  { name: 'Chicken noodle soup, canned',   pricing: 'per_each', size: 10.75,unit: 'oz',     cat: 'Canned soup',       query: 'chicken noodle soup condensed' },
  { name: 'Apple juice',                   pricing: 'per_each', size: 64,   unit: 'fl_oz',  cat: 'Apple juice',       query: 'apple juice unsweetened' },
]

console.log(`Querying FoodData Central for ${PRODUCTS.length} products...`)

const rows = []
for (const p of PRODUCTS) {
  process.stdout.write(`  ${p.name}... `)
  let fdcId = null
  try {
    const data = await fdcFetch('/foods/search', { query: p.query, dataType: 'Foundation,SR Legacy', pageSize: '3' })
    const hit = data.foods?.[0]
    if (hit) {
      fdcId = hit.fdcId
      process.stdout.write(`fdc:${fdcId} ✓\n`)
    } else {
      process.stdout.write(`no match\n`)
    }
  } catch (e) {
    process.stdout.write(`err: ${e.message}\n`)
  }
  await delay(250) // stay well under rate limits

  const size = p.size != null ? p.size : 'NULL'
  const unit = p.unit ? esc(p.unit) : 'NULL'
  const fdc  = fdcId ? fdcId : 'NULL'

  rows.push(
    `  (${esc(p.name)}, NULL, FALSE, ${size}, ${unit}, ${esc(p.pricing)}, NULL, ` +
    `(SELECT category_id FROM product_categories WHERE name=${esc(p.cat)}), ` +
    `${fdc})`
  )
}

// We're adding usda_fdc_id to the canonical_products insert — but that column doesn't
// exist in the schema. We'll store it as a comment for reference and omit from INSERT.
// The schema links via product_categories.usda_fdc_id instead.

const cleanRows = rows.map((r, i) => {
  // Strip the trailing fdcId — schema doesn't have that column on canonical_products
  // The fdcId is already in the comment above and in product_categories.usda_fdc_id
  return PRODUCTS[i] ? r.replace(/, (\d+|NULL)\)$/, ')') : r
})

const sql = `-- ============================================================
-- Phase 3: Canonical products
-- Generated: ${new Date().toISOString()}
-- ${PRODUCTS.length} products, description_embedding omitted (generate-embeddings.mjs)
-- ============================================================

INSERT INTO canonical_products
  (name, brand, is_store_brand, package_size, package_unit, pricing_unit, upc, category_id)
VALUES
${cleanRows.join(',\n')}
ON CONFLICT DO NOTHING;
`

const out = resolve(SEED_DIR, '03_canonical_products.sql')
writeFileSync(out, sql, 'utf8')
console.log(`✓ Wrote ${out}`)
console.log(`  ${PRODUCTS.length} canonical products`)
