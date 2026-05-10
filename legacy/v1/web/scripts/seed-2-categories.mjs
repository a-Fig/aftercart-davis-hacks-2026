/**
 * Phase 2 — Product category tree
 * Hardcoded from USDA FoodData Central taxonomy, pruned to our 47-item list.
 * Output: db/seed/02_product_categories.sql
 *
 * Run from repo root: node web/scripts/seed-2-categories.mjs
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { SEED_DIR, esc } from './seed-utils.mjs'

// Two-level tree. usda_fdc_id matches FoodData Central foodCategory IDs where available.
const PARENTS = [
  { name: 'Poultry Products',              usda_fdc_id: 5  },
  { name: 'Beef Products',                 usda_fdc_id: 13 },
  { name: 'Dairy and Egg Products',        usda_fdc_id: 1  },
  { name: 'Vegetables and Vegetable Products', usda_fdc_id: 11 },
  { name: 'Fruits and Fruit Juices',       usda_fdc_id: 9  },
  { name: 'Cereal Grains and Pasta',       usda_fdc_id: 20 },
  { name: 'Legumes and Legume Products',   usda_fdc_id: 16 },
  { name: 'Baked Products',                usda_fdc_id: 18 },
  { name: 'Fats and Oils',                 usda_fdc_id: 4  },
  { name: 'Soups, Sauces, and Gravies',    usda_fdc_id: 6  },
  { name: 'Sweets',                        usda_fdc_id: 19 },
  { name: 'Beverages',                     usda_fdc_id: 14 },
  { name: 'Finfish and Shellfish Products',usda_fdc_id: 15 },
  { name: 'Frozen Vegetables',             usda_fdc_id: null },
]

const CHILDREN = [
  { name: 'Chicken, raw',        parent: 'Poultry Products',           usda_fdc_id: null },
  { name: 'Ground beef, raw',    parent: 'Beef Products',              usda_fdc_id: null },
  { name: 'Milk',                parent: 'Dairy and Egg Products',     usda_fdc_id: null },
  { name: 'Eggs',                parent: 'Dairy and Egg Products',     usda_fdc_id: null },
  { name: 'Butter',              parent: 'Dairy and Egg Products',     usda_fdc_id: null },
  { name: 'Cheese',              parent: 'Dairy and Egg Products',     usda_fdc_id: null },
  { name: 'Yogurt',              parent: 'Dairy and Egg Products',     usda_fdc_id: null },
  { name: 'Sour cream',          parent: 'Dairy and Egg Products',     usda_fdc_id: null },
  { name: 'Cream cheese',        parent: 'Dairy and Egg Products',     usda_fdc_id: null },
  { name: 'Potatoes',            parent: 'Vegetables and Vegetable Products', usda_fdc_id: null },
  { name: 'Onions',              parent: 'Vegetables and Vegetable Products', usda_fdc_id: null },
  { name: 'Carrots',             parent: 'Vegetables and Vegetable Products', usda_fdc_id: null },
  { name: 'Broccoli',            parent: 'Vegetables and Vegetable Products', usda_fdc_id: null },
  { name: 'Spinach',             parent: 'Vegetables and Vegetable Products', usda_fdc_id: null },
  { name: 'Canned tomatoes',     parent: 'Vegetables and Vegetable Products', usda_fdc_id: null },
  { name: 'Canned beans',        parent: 'Legumes and Legume Products', usda_fdc_id: null },
  { name: 'Dried beans',         parent: 'Legumes and Legume Products', usda_fdc_id: null },
  { name: 'Bananas',             parent: 'Fruits and Fruit Juices',    usda_fdc_id: null },
  { name: 'Apples',              parent: 'Fruits and Fruit Juices',    usda_fdc_id: null },
  { name: 'Orange juice',        parent: 'Fruits and Fruit Juices',    usda_fdc_id: null },
  { name: 'Apple juice',         parent: 'Fruits and Fruit Juices',    usda_fdc_id: null },
  { name: 'Rice',                parent: 'Cereal Grains and Pasta',    usda_fdc_id: null },
  { name: 'Pasta',               parent: 'Cereal Grains and Pasta',    usda_fdc_id: null },
  { name: 'Oats',                parent: 'Cereal Grains and Pasta',    usda_fdc_id: null },
  { name: 'Breakfast cereal',    parent: 'Cereal Grains and Pasta',    usda_fdc_id: null },
  { name: 'Ramen noodles',       parent: 'Cereal Grains and Pasta',    usda_fdc_id: null },
  { name: 'Bread',               parent: 'Baked Products',             usda_fdc_id: null },
  { name: 'Tortillas',           parent: 'Baked Products',             usda_fdc_id: null },
  { name: 'Flour',               parent: 'Baked Products',             usda_fdc_id: null },
  { name: 'Olive oil',           parent: 'Fats and Oils',              usda_fdc_id: null },
  { name: 'Vegetable oil',       parent: 'Fats and Oils',              usda_fdc_id: null },
  { name: 'Pasta sauce',         parent: 'Soups, Sauces, and Gravies', usda_fdc_id: null },
  { name: 'Broth',               parent: 'Soups, Sauces, and Gravies', usda_fdc_id: null },
  { name: 'Canned soup',         parent: 'Soups, Sauces, and Gravies', usda_fdc_id: null },
  { name: 'Peanut butter',       parent: 'Legumes and Legume Products', usda_fdc_id: null },
  { name: 'Jelly and jam',       parent: 'Sweets',                     usda_fdc_id: null },
  { name: 'Sugar',               parent: 'Sweets',                     usda_fdc_id: null },
  { name: 'Coffee',              parent: 'Beverages',                  usda_fdc_id: null },
  { name: 'Canned tuna',         parent: 'Finfish and Shellfish Products', usda_fdc_id: null },
  { name: 'Mayonnaise',          parent: 'Soups, Sauces, and Gravies', usda_fdc_id: null },
  { name: 'Ketchup',             parent: 'Soups, Sauces, and Gravies', usda_fdc_id: null },
  { name: 'Mustard',             parent: 'Soups, Sauces, and Gravies', usda_fdc_id: null },
  { name: 'Frozen peas',         parent: 'Frozen Vegetables',          usda_fdc_id: null },
  { name: 'Frozen corn',         parent: 'Frozen Vegetables',          usda_fdc_id: null },
]

const parentRows = PARENTS.map(p =>
  `  (${esc(p.name)}, NULL, ${p.usda_fdc_id ?? 'NULL'})`
).join(',\n')

const childRows = CHILDREN.map(c => {
  const fdcId = c.usda_fdc_id ?? 'NULL'
  return `  (${esc(c.name)}, (SELECT category_id FROM product_categories WHERE name=${esc(c.parent)}), ${fdcId})`
}).join(',\n')

const sql = `-- ============================================================
-- Phase 2: Product category tree
-- Generated: ${new Date().toISOString()}
-- ============================================================

INSERT INTO product_categories (name, parent_category_id, usda_fdc_id) VALUES
${parentRows};

INSERT INTO product_categories (name, parent_category_id, usda_fdc_id) VALUES
${childRows};
`

const out = resolve(SEED_DIR, '02_product_categories.sql')
writeFileSync(out, sql, 'utf8')
console.log(`✓ Wrote ${out}`)
console.log(`  ${PARENTS.length} parent categories, ${CHILDREN.length} subcategories`)
