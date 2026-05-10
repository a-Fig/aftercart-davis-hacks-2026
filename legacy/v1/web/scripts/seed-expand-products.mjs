/**
 * Expand canonical_products with a strategic batch focused on:
 *   1. Items that appeared in our test receipts but had no canonical match
 *      (sourdough, frozen pizza, frozen blueberries, plantain chips, pesto,
 *      egg whites, bell peppers, celery, cookies, dark chocolate, fish
 *      sticks, mango, pomegranate, papaya, banana chips, dried herbs).
 *   2. Common SNAP basket items in thin categories (more milks, breads,
 *      meats, fresh produce, frozen, snacks, condiments).
 *
 * Idempotent: every INSERT uses a NOT EXISTS guard, so re-running this
 * script is a no-op once everything is in. Run generate-embeddings.mjs
 * after this to populate description_embedding for the new rows.
 *
 *   node web/scripts/seed-expand-products.mjs
 */

import { createClient } from './seed-utils.mjs'

const c = createClient()
await c.connect()

// ── 1. Rename "Frozen Vegetables" parent to "Frozen Foods" ─────────────────
// We're adding pizza/berries/ice cream/fish under it; the old name no longer
// reflects the contents. Idempotent: only renames if the old name is present.
const renamed = await c.query(
  `UPDATE product_categories SET name = 'Frozen Foods'
   WHERE name = 'Frozen Vegetables' AND parent_category_id IS NULL
   RETURNING category_id`,
)
if (renamed.rowCount > 0) console.log(`✓ Renamed Frozen Vegetables → Frozen Foods`)

// ── 2. New parent categories ───────────────────────────────────────────────

const NEW_PARENTS = [
  { name: 'Pork Products',     fdc: 10 },
  { name: 'Snacks',            fdc: null },
  { name: 'Spices and Herbs',  fdc: 2 },
]

for (const p of NEW_PARENTS) {
  const { rowCount } = await c.query(
    `INSERT INTO product_categories (name, parent_category_id, usda_fdc_id)
     SELECT $1, NULL, $2
     WHERE NOT EXISTS (
       SELECT 1 FROM product_categories
       WHERE name = $1 AND parent_category_id IS NULL
     )`,
    [p.name, p.fdc],
  )
  if (rowCount > 0) console.log(`✓ +parent "${p.name}"`)
}

// ── 3. New sub-categories (with their parents named) ──────────────────────
// Subs that map to existing parents extend coverage without adding tree depth.

const NEW_SUBS = [
  // Vegetables (fresh)
  { name: 'Bell peppers',       parent: 'Vegetables and Vegetable Products' },
  { name: 'Tomatoes (fresh)',   parent: 'Vegetables and Vegetable Products' },
  { name: 'Celery',             parent: 'Vegetables and Vegetable Products' },
  { name: 'Lettuce',            parent: 'Vegetables and Vegetable Products' },
  { name: 'Avocado',            parent: 'Vegetables and Vegetable Products' },
  { name: 'Mushrooms',          parent: 'Vegetables and Vegetable Products' },
  { name: 'Garlic',             parent: 'Vegetables and Vegetable Products' },
  // Fruits (fresh)
  { name: 'Berries',            parent: 'Fruits and Fruit Juices' },
  { name: 'Citrus',             parent: 'Fruits and Fruit Juices' },
  { name: 'Mango',              parent: 'Fruits and Fruit Juices' },
  { name: 'Pomegranate',        parent: 'Fruits and Fruit Juices' },
  { name: 'Papaya',             parent: 'Fruits and Fruit Juices' },
  { name: 'Grapes',             parent: 'Fruits and Fruit Juices' },
  // Pork
  { name: 'Bacon',              parent: 'Pork Products' },
  { name: 'Hot dogs',           parent: 'Pork Products' },
  { name: 'Sausage',            parent: 'Pork Products' },
  // Seafood
  { name: 'Salmon',             parent: 'Finfish and Shellfish Products' },
  { name: 'Frozen fish',        parent: 'Finfish and Shellfish Products' },
  // Frozen
  { name: 'Frozen pizza',       parent: 'Frozen Foods' },
  { name: 'Frozen berries',     parent: 'Frozen Foods' },
  { name: 'Frozen broccoli',    parent: 'Frozen Foods' },
  { name: 'Frozen mixed vegetables', parent: 'Frozen Foods' },
  { name: 'Ice cream',          parent: 'Frozen Foods' },
  // Baked
  { name: 'Pastry',             parent: 'Baked Products' },
  // Sauces and condiments
  { name: 'Pesto',              parent: 'Soups, Sauces, and Gravies' },
  { name: 'Salsa',              parent: 'Soups, Sauces, and Gravies' },
  { name: 'Salad dressing',     parent: 'Soups, Sauces, and Gravies' },
  { name: 'Hot sauce',          parent: 'Soups, Sauces, and Gravies' },
  { name: 'Soy sauce',          parent: 'Soups, Sauces, and Gravies' },
  // Sweets
  { name: 'Cookies',            parent: 'Sweets' },
  { name: 'Chocolate',          parent: 'Sweets' },
  { name: 'Honey',              parent: 'Sweets' },
  // Snacks
  { name: 'Chips',              parent: 'Snacks' },
  { name: 'Crackers',           parent: 'Snacks' },
  { name: 'Granola bars',       parent: 'Snacks' },
  { name: 'Dried fruit',        parent: 'Snacks' },
  // Spices and Herbs
  { name: 'Dried herbs',        parent: 'Spices and Herbs' },
  { name: 'Ground spices',      parent: 'Spices and Herbs' },
  // Dairy (extend)
  { name: 'Plant-based milk',   parent: 'Dairy and Egg Products' },
  // Cereal Grains
  { name: 'Quinoa',             parent: 'Cereal Grains and Pasta' },
  // Beverages
  { name: 'Tea',                parent: 'Beverages' },
  { name: 'Bottled water',      parent: 'Beverages' },
  // Legumes (for hummus)
  { name: 'Hummus',             parent: 'Legumes and Legume Products' },
]

for (const s of NEW_SUBS) {
  const { rowCount } = await c.query(
    `INSERT INTO product_categories (name, parent_category_id, usda_fdc_id)
     SELECT $1,
            (SELECT category_id FROM product_categories
             WHERE name = $2 AND parent_category_id IS NULL),
            NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM product_categories WHERE name = $1
     )`,
    [s.name, s.parent],
  )
  if (rowCount > 0) console.log(`✓ +sub "${s.name}"`)
}

// ── 4. New canonical products ─────────────────────────────────────────────
// Schema: (name, brand, is_store_brand, package_size, package_unit,
//          pricing_unit, upc, category_id [, description_embedding])
// We leave description_embedding NULL for now — generate-embeddings.mjs picks
// up everything that's missing one.

const NEW_PRODUCTS = [
  // ── Bread (extend) ─────────────
  { name: 'Sourdough bread',           pricing: 'per_each', size: 24,  unit: 'oz',     cat: 'Bread' },
  { name: 'Whole wheat bread',         pricing: 'per_each', size: 1,   unit: 'loaf',   cat: 'Bread' },
  { name: 'Rustic Italian bread',      pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Bread' },
  { name: 'Bagels',                    pricing: 'per_each', size: 6,   unit: 'count',  cat: 'Bread' },
  { name: 'English muffins',           pricing: 'per_each', size: 6,   unit: 'count',  cat: 'Bread' },

  // ── Pastry ─────────────────────
  { name: 'Pie crusts',                pricing: 'per_each', size: 2,   unit: 'count',  cat: 'Pastry' },

  // ── Dairy (extend) ─────────────
  { name: '2% milk',                   pricing: 'per_each', size: 128, unit: 'fl_oz',  cat: 'Milk' },
  { name: 'Skim milk',                 pricing: 'per_each', size: 128, unit: 'fl_oz',  cat: 'Milk' },
  { name: 'Almond milk, unsweetened',  pricing: 'per_each', size: 64,  unit: 'fl_oz',  cat: 'Plant-based milk' },
  { name: 'Oat milk',                  pricing: 'per_each', size: 64,  unit: 'fl_oz',  cat: 'Plant-based milk' },
  { name: 'Egg whites',                pricing: 'per_each', size: 16,  unit: 'fl_oz',  cat: 'Eggs' },
  { name: 'Parmesan cheese',           pricing: 'per_each', size: 8,   unit: 'oz',     cat: 'Cheese' },
  { name: 'Cottage cheese',            pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Cheese' },
  { name: 'Vanilla yogurt',            pricing: 'per_each', size: 32,  unit: 'oz',     cat: 'Yogurt' },

  // ── Pork (new) ─────────────────
  { name: 'Bacon',                     pricing: 'per_each', size: 12,  unit: 'oz',     cat: 'Bacon' },
  { name: 'Hot dogs',                  pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Hot dogs' },
  { name: 'Italian sausage',           pricing: 'per_lb',   size: null,unit: 'lb',     cat: 'Sausage' },

  // ── Seafood (extend) ───────────
  { name: 'Atlantic salmon',           pricing: 'per_lb',   size: null,unit: 'lb',     cat: 'Salmon' },
  { name: 'Frozen fish sticks',        pricing: 'per_each', size: 24,  unit: 'oz',     cat: 'Frozen fish' },

  // ── Fresh fruit ────────────────
  { name: 'Strawberries',              pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Berries' },
  { name: 'Blueberries',               pricing: 'per_each', size: 6,   unit: 'oz',     cat: 'Berries' },
  { name: 'Lemons',                    pricing: 'per_each', size: 1,   unit: 'count',  cat: 'Citrus' },
  { name: 'Oranges',                   pricing: 'per_lb',   size: null,unit: 'lb',     cat: 'Citrus' },
  { name: 'Mango',                     pricing: 'per_each', size: 1,   unit: 'count',  cat: 'Mango' },
  { name: 'Pomegranate',               pricing: 'per_each', size: 1,   unit: 'count',  cat: 'Pomegranate' },
  { name: 'Papaya',                    pricing: 'per_lb',   size: null,unit: 'lb',     cat: 'Papaya' },
  { name: 'Grapes',                    pricing: 'per_lb',   size: null,unit: 'lb',     cat: 'Grapes' },

  // ── Fresh vegetables ───────────
  { name: 'Bell peppers',              pricing: 'per_each', size: 1,   unit: 'count',  cat: 'Bell peppers' },
  { name: 'Roma tomatoes',             pricing: 'per_lb',   size: null,unit: 'lb',     cat: 'Tomatoes (fresh)' },
  { name: 'Cherry tomatoes',           pricing: 'per_each', size: 10,  unit: 'oz',     cat: 'Tomatoes (fresh)' },
  { name: 'Celery',                    pricing: 'per_each', size: 1,   unit: 'bunch',  cat: 'Celery' },
  { name: 'Romaine lettuce',           pricing: 'per_each', size: 1,   unit: 'count',  cat: 'Lettuce' },
  { name: 'Avocado',                   pricing: 'per_each', size: 1,   unit: 'count',  cat: 'Avocado' },
  { name: 'White button mushrooms',    pricing: 'per_each', size: 8,   unit: 'oz',     cat: 'Mushrooms' },
  { name: 'Garlic',                    pricing: 'per_each', size: 1,   unit: 'bulb',   cat: 'Garlic' },

  // ── Canned (extend Canned beans) ─
  { name: 'Garbanzo beans, canned',    pricing: 'per_each', size: 15,  unit: 'oz',     cat: 'Canned beans' },
  { name: 'Kidney beans, canned',      pricing: 'per_each', size: 15,  unit: 'oz',     cat: 'Canned beans' },

  // ── Sauces and condiments ──────
  { name: 'Basil pesto',               pricing: 'per_each', size: 7,   unit: 'oz',     cat: 'Pesto' },
  { name: 'Salsa',                     pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Salsa' },
  { name: 'Ranch dressing',            pricing: 'per_each', size: 16,  unit: 'fl_oz',  cat: 'Salad dressing' },
  { name: 'Hot sauce',                 pricing: 'per_each', size: 5,   unit: 'fl_oz',  cat: 'Hot sauce' },
  { name: 'Soy sauce',                 pricing: 'per_each', size: 10,  unit: 'fl_oz',  cat: 'Soy sauce' },

  // ── Sweets and snacks ──────────
  { name: 'Honey',                     pricing: 'per_each', size: 12,  unit: 'oz',     cat: 'Honey' },
  { name: 'Chocolate chip cookies',    pricing: 'per_each', size: 14,  unit: 'oz',     cat: 'Cookies' },
  { name: 'Dark chocolate bar',        pricing: 'per_each', size: 3.5, unit: 'oz',     cat: 'Chocolate' },
  { name: 'Potato chips',              pricing: 'per_each', size: 8,   unit: 'oz',     cat: 'Chips' },
  { name: 'Tortilla chips',            pricing: 'per_each', size: 13,  unit: 'oz',     cat: 'Chips' },
  { name: 'Plantain chips',            pricing: 'per_each', size: 5,   unit: 'oz',     cat: 'Chips' },
  { name: 'Banana chips',              pricing: 'per_each', size: 6,   unit: 'oz',     cat: 'Dried fruit' },
  { name: 'Crackers',                  pricing: 'per_each', size: 13.7,unit: 'oz',     cat: 'Crackers' },
  { name: 'Granola bars',              pricing: 'per_each', size: 8,   unit: 'count',  cat: 'Granola bars' },

  // ── Frozen ─────────────────────
  { name: 'Frozen pepperoni pizza',    pricing: 'per_each', size: 28,  unit: 'oz',     cat: 'Frozen pizza' },
  { name: 'Frozen cheese pizza',       pricing: 'per_each', size: 25,  unit: 'oz',     cat: 'Frozen pizza' },
  { name: 'Frozen blueberries',        pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Frozen berries' },
  { name: 'Frozen strawberries',       pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Frozen berries' },
  { name: 'Frozen broccoli florets',   pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Frozen broccoli' },
  { name: 'Frozen mixed vegetables',   pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Frozen mixed vegetables' },
  { name: 'Vanilla ice cream',         pricing: 'per_each', size: 48,  unit: 'fl_oz',  cat: 'Ice cream' },

  // ── Spices ─────────────────────
  { name: 'Dried oregano',             pricing: 'per_each', size: 0.75,unit: 'oz',     cat: 'Dried herbs' },
  { name: 'Dried basil',               pricing: 'per_each', size: 0.75,unit: 'oz',     cat: 'Dried herbs' },
  { name: 'Black pepper',              pricing: 'per_each', size: 4,   unit: 'oz',     cat: 'Ground spices' },
  { name: 'Ground cinnamon',           pricing: 'per_each', size: 2.5, unit: 'oz',     cat: 'Ground spices' },

  // ── Other ──────────────────────
  { name: 'Brown rice',                pricing: 'per_each', size: 32,  unit: 'oz',     cat: 'Rice' },
  { name: 'Quinoa',                    pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Quinoa' },
  { name: 'Penne pasta',               pricing: 'per_each', size: 16,  unit: 'oz',     cat: 'Pasta' },
  { name: 'Hummus',                    pricing: 'per_each', size: 10,  unit: 'oz',     cat: 'Hummus' },
  { name: 'Bottled water',             pricing: 'per_each', size: 24,  unit: 'count',  cat: 'Bottled water' },
  { name: 'Black tea bags',            pricing: 'per_each', size: 100, unit: 'count',  cat: 'Tea' },
]

let inserted = 0
for (const p of NEW_PRODUCTS) {
  const { rowCount } = await c.query(
    `INSERT INTO canonical_products
       (name, brand, is_store_brand, package_size, package_unit, pricing_unit, upc, category_id)
     SELECT $1, NULL, FALSE, $2, $3, $4, NULL,
            (SELECT category_id FROM product_categories WHERE name = $5 LIMIT 1)
     WHERE NOT EXISTS (
       SELECT 1 FROM canonical_products WHERE name = $1
     )`,
    [p.name, p.size, p.unit, p.pricing, p.cat],
  )
  if (rowCount > 0) inserted++
}

const { rows: totals } = await c.query(`SELECT COUNT(*) AS n FROM canonical_products`)
console.log(`\n✓ Inserted ${inserted} new canonical products`)
console.log(`  Total now: ${totals[0].n}`)
console.log('\nNext: node web/scripts/generate-embeddings.mjs')

await c.end()
