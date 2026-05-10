/**
 * Expansion v3 — second wave, filling every remaining gap
 * Adds 250+ more canonical products: fresh herbs, more produce, soda,
 * plant-based proteins, canned soups, OTC health, more household,
 * cooking wines, specialty grains, fresh pasta, more snack varieties.
 *
 *   node web/scripts/seed-expand-products-v3.mjs
 *   node web/scripts/generate-embeddings.mjs   ← run after
 */

import { createClient } from './seed-utils.mjs'

const c = createClient()
await c.connect()

// ─────────────────────────────────────────────────────────────────────────────
// 1. NEW PARENT CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

const NEW_PARENTS = [
  { name: 'Soft Drinks and Soda',          fdc: null },
  { name: 'Alcoholic and Cooking Wines',    fdc: null },
  { name: 'Plant-Based Proteins',           fdc: null },
  { name: 'Health and Pharmacy',            fdc: null },
  { name: 'Vitamins and Supplements',       fdc: null },
  { name: 'Paper and Plastic Tableware',    fdc: null },
]

for (const p of NEW_PARENTS) {
  const { rowCount } = await c.query(
    `INSERT INTO product_categories (name, parent_category_id, usda_fdc_id)
     SELECT $1, NULL, $2
     WHERE NOT EXISTS (
       SELECT 1 FROM product_categories WHERE name = $1 AND parent_category_id IS NULL
     )`,
    [p.name, p.fdc],
  )
  if (rowCount > 0) console.log(`✓ +parent "${p.name}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. NEW SUBCATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

const NEW_SUBS = [
  // Fresh herbs
  { name: 'Fresh herbs',              parent: 'Vegetables and Vegetable Products' },
  // More produce
  { name: 'Fennel',                   parent: 'Vegetables and Vegetable Products' },
  { name: 'Sprouts',                  parent: 'Vegetables and Vegetable Products' },
  { name: 'Corn tortillas',           parent: 'Baked Products' },
  // Mushroom types
  { name: 'Specialty mushrooms',      parent: 'Vegetables and Vegetable Products' },
  // More nuts
  { name: 'Macadamia nuts',           parent: 'Nuts and Seeds' },
  { name: 'Hazelnuts',                parent: 'Nuts and Seeds' },
  { name: 'Pine nuts',                parent: 'Nuts and Seeds' },
  // Soda
  { name: 'Cola',                     parent: 'Soft Drinks and Soda' },
  { name: 'Lemon-lime soda',          parent: 'Soft Drinks and Soda' },
  { name: 'Root beer',                parent: 'Soft Drinks and Soda' },
  { name: 'Ginger ale',               parent: 'Soft Drinks and Soda' },
  { name: 'Orange soda',              parent: 'Soft Drinks and Soda' },
  { name: 'Sparkling cider',          parent: 'Soft Drinks and Soda' },
  // Cooking wines
  { name: 'Cooking wine',             parent: 'Alcoholic and Cooking Wines' },
  { name: 'Beer',                     parent: 'Alcoholic and Cooking Wines' },
  { name: 'Mirin and sake',           parent: 'Alcoholic and Cooking Wines' },
  // Plant-based
  { name: 'Veggie burgers',           parent: 'Plant-Based Proteins' },
  { name: 'Plant-based ground',       parent: 'Plant-Based Proteins' },
  { name: 'Tempeh',                   parent: 'Plant-Based Proteins' },
  { name: 'Seitan',                   parent: 'Plant-Based Proteins' },
  // Dairy extend
  { name: 'Buttermilk',               parent: 'Dairy and Egg Products' },
  { name: 'Margarine',                parent: 'Dairy and Egg Products' },
  { name: 'Sour cream dip',           parent: 'Dairy and Egg Products' },
  // More frozen
  { name: 'Frozen pizza rolls',       parent: 'Frozen Foods' },
  { name: 'Frozen tamales',           parent: 'Frozen Foods' },
  { name: 'Frozen Indian meals',      parent: 'Frozen Foods' },
  { name: 'Frozen soups',             parent: 'Frozen Foods' },
  { name: 'Frozen rice',              parent: 'Frozen Foods' },
  { name: 'Frozen ravioli',           parent: 'Frozen Foods' },
  { name: 'Frozen onion rings',       parent: 'Frozen Foods' },
  // More canned soups
  { name: 'Cream soups',              parent: 'Soups, Sauces, and Gravies' },
  { name: 'Tomato soup',              parent: 'Soups, Sauces, and Gravies' },
  { name: 'Beef soup',                parent: 'Soups, Sauces, and Gravies' },
  { name: 'Clam chowder',             parent: 'Soups, Sauces, and Gravies' },
  { name: 'Gravy',                    parent: 'Soups, Sauces, and Gravies' },
  { name: 'Alfredo sauce',            parent: 'Soups, Sauces, and Gravies' },
  // Specialty pantry
  { name: 'Nutritional yeast',        parent: 'Legumes and Legume Products' },
  { name: 'Specialty rice',           parent: 'Cereal Grains and Pasta' },
  { name: 'Fresh pasta',              parent: 'Cereal Grains and Pasta' },
  { name: 'Cooking starch',           parent: 'Cereal Grains and Pasta' },
  // More beverages
  { name: 'Protein shake',            parent: 'Beverages' },
  { name: 'Meal replacement',         parent: 'Beverages' },
  { name: 'Electrolyte drink',        parent: 'Beverages' },
  { name: 'Smoothie',                 parent: 'Beverages' },
  { name: 'Milk alternatives, other', parent: 'Beverages' },
  // More snacks
  { name: 'Corn chips',               parent: 'Snacks' },
  { name: 'Pork rinds',               parent: 'Snacks' },
  { name: 'Kettle chips',             parent: 'Snacks' },
  { name: 'Veggie straws',            parent: 'Snacks' },
  { name: 'Cheese puffs',             parent: 'Snacks' },
  { name: 'Breakfast bars',           parent: 'Snacks' },
  // More sweets
  { name: 'Candy bars',               parent: 'Sweets' },
  { name: 'Marshmallows',             parent: 'Sweets' },
  { name: 'Gum',                      parent: 'Sweets' },
  { name: 'Mints',                    parent: 'Sweets' },
  { name: 'Pudding mix',              parent: 'Sweets' },
  { name: 'Gelatin mix',              parent: 'Sweets' },
  // More specialty
  { name: 'Korean pantry',            parent: 'International and Specialty' },
  { name: 'Thai pantry',              parent: 'International and Specialty' },
  { name: 'Mediterranean pantry',     parent: 'International and Specialty' },
  // Health
  { name: 'Pain relief',              parent: 'Health and Pharmacy' },
  { name: 'Allergy and sinus',        parent: 'Health and Pharmacy' },
  { name: 'Cold and flu',             parent: 'Health and Pharmacy' },
  { name: 'Antacids and digestive',   parent: 'Health and Pharmacy' },
  { name: 'Bandages and first aid',   parent: 'Health and Pharmacy' },
  { name: 'Feminine hygiene',         parent: 'Personal Care' },
  { name: 'Contact lens care',        parent: 'Personal Care' },
  { name: 'Hair styling',             parent: 'Personal Care' },
  // Vitamins
  { name: 'Multivitamins',            parent: 'Vitamins and Supplements' },
  { name: 'Vitamin C',                parent: 'Vitamins and Supplements' },
  { name: 'Vitamin D',                parent: 'Vitamins and Supplements' },
  { name: 'Fish oil',                 parent: 'Vitamins and Supplements' },
  { name: 'Protein powder',           parent: 'Vitamins and Supplements' },
  // Tableware
  { name: 'Paper plates',             parent: 'Paper and Plastic Tableware' },
  { name: 'Paper cups',               parent: 'Paper and Plastic Tableware' },
  { name: 'Plastic utensils',         parent: 'Paper and Plastic Tableware' },
  { name: 'Foam bowls',               parent: 'Paper and Plastic Tableware' },
  // More household
  { name: 'Light bulbs',              parent: 'Household Products' },
  { name: 'Batteries',                parent: 'Household Products' },
  { name: 'Bleach',                   parent: 'Household Products' },
  { name: 'Air freshener',            parent: 'Household Products' },
  { name: 'Bug spray',                parent: 'Household Products' },
  { name: 'Candles',                  parent: 'Household Products' },
]

for (const s of NEW_SUBS) {
  const { rowCount } = await c.query(
    `INSERT INTO product_categories (name, parent_category_id, usda_fdc_id)
     SELECT $1,
            (SELECT category_id FROM product_categories
             WHERE name = $2 AND parent_category_id IS NULL),
            NULL
     WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE name = $1)`,
    [s.name, s.parent],
  )
  if (rowCount > 0) console.log(`  ✓ +sub "${s.name}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CANONICAL PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

const P = (name, pricing, size, unit, cat) => ({ name, pricing, size, unit, cat })

const NEW_PRODUCTS = [
  // ══════════════════════════════════════════════════════════════════════════
  // FRESH HERBS (huge match-rate boost for receipt lines like "CILANTRO")
  // ══════════════════════════════════════════════════════════════════════════
  P('Fresh cilantro',                 'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh basil',                    'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh parsley, flat-leaf',       'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh parsley, curly',           'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh mint',                     'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh dill',                     'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh thyme',                    'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh rosemary',                 'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh chives',                   'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh oregano',                  'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh sage',                     'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh tarragon',                 'per_each',   1, 'bunch',  'Fresh herbs'),
  P('Fresh ginger, sliced',           'per_each',  16, 'oz',     'Fresh herbs'),
  P('Herb blend, poultry',            'per_each', 0.7, 'oz',     'Seasoning blends'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE MUSHROOMS
  // ══════════════════════════════════════════════════════════════════════════
  P('Portobello mushrooms',           'per_each',   6, 'oz',     'Specialty mushrooms'),
  P('Cremini mushrooms',              'per_each',  16, 'oz',     'Specialty mushrooms'),
  P('Shiitake mushrooms',             'per_each',   3.5,'oz',    'Specialty mushrooms'),
  P('Oyster mushrooms',               'per_each',   3.5,'oz',    'Specialty mushrooms'),
  P('Mixed mushrooms',                'per_each',   8, 'oz',     'Specialty mushrooms'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE PRODUCE — VEGETABLES
  // ══════════════════════════════════════════════════════════════════════════
  P('Fennel bulb',                    'per_each',   1, 'count',  'Fennel'),
  P('Bean sprouts',                   'per_each',  12, 'oz',     'Sprouts'),
  P('Alfalfa sprouts',                'per_each',   4, 'oz',     'Sprouts'),
  P('Microgreens',                    'per_each',   3, 'oz',     'Sprouts'),
  P('Watercress',                     'per_each',   4, 'oz',     'Lettuce'),
  P('Endive',                         'per_each',   1, 'count',  'Lettuce'),
  P('Radicchio',                      'per_each',   1, 'count',  'Cabbage'),
  P('Swiss chard',                    'per_each',   1, 'bunch',  'Kale'),
  P('Arugula',                        'per_each',   5, 'oz',     'Lettuce'),
  P('Mixed greens',                   'per_each',   5, 'oz',     'Lettuce'),
  P('Collard greens',                 'per_each',   1, 'bunch',  'Kale'),
  P('Turnips',                        'per_lb',  null, 'lb',     'Beets'),
  P('Parsnips',                       'per_lb',  null, 'lb',     'Beets'),
  P('Jicama',                         'per_lb',  null, 'lb',     'Vegetables and Vegetable Products'),
  P('Chayote squash',                 'per_lb',  null, 'lb',     'Zucchini'),
  P('Pumpkin, fresh',                 'per_each',   1, 'count',  'Winter squash'),
  P('Acorn squash',                   'per_each',   1, 'count',  'Winter squash'),
  P('Delicata squash',                'per_each',   1, 'count',  'Winter squash'),
  P('Snow peas',                      'per_each',   8, 'oz',     'Snap peas'),
  P('Edamame, fresh in shell',        'per_each',  12, 'oz',     'Snap peas'),
  P('Corn tortillas',                 'per_each',  30, 'count',  'Corn tortillas'),
  P('Poblano peppers',                'per_lb',  null, 'lb',     'Hot peppers'),
  P('Habanero peppers',               'per_each',   4, 'oz',     'Hot peppers'),
  P('Anaheim peppers',                'per_lb',  null, 'lb',     'Hot peppers'),
  P('Ghost peppers',                  'per_each',   2, 'oz',     'Hot peppers'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE PRODUCE — FRUITS
  // ══════════════════════════════════════════════════════════════════════════
  P('Cantaloupe',                     'per_each',   1, 'count',  'Watermelon'),
  P('Honeydew melon',                 'per_each',   1, 'count',  'Watermelon'),
  P('Apricots',                       'per_lb',  null, 'lb',     'Peaches and nectarines'),
  P('Figs',                           'per_each',  10, 'oz',     'Dates'),
  P('Pomelo',                         'per_each',   1, 'count',  'Citrus'),
  P('Blood oranges',                  'per_each',   3, 'count',  'Citrus'),
  P('Cara Cara oranges',              'per_lb',  null, 'lb',     'Citrus'),
  P('Passion fruit',                  'per_each',   4, 'count',  'Mango'),
  P('Dragon fruit',                   'per_each',   1, 'count',  'Mango'),
  P('Guava',                          'per_lb',  null, 'lb',     'Mango'),
  P('Star fruit',                     'per_each',   2, 'count',  'Mango'),
  P('Lychee',                         'per_lb',  null, 'lb',     'Mango'),
  P('Jackfruit, fresh',               'per_lb',  null, 'lb',     'Mango'),
  P('Kumquats',                       'per_each',   8, 'oz',     'Citrus'),
  P('Dried plums (prunes)',            'per_each',  18, 'oz',     'Dried fruit'),
  P('Freeze-dried strawberries',      'per_each',   1, 'oz',     'Dried fruit'),

  // ══════════════════════════════════════════════════════════════════════════
  // SOFT DRINKS AND SODA
  // ══════════════════════════════════════════════════════════════════════════
  P('Cola, 12-pack cans',             'per_each',  12, 'count',  'Cola'),
  P('Cola, 2-liter',                  'per_each',   2, 'liter',  'Cola'),
  P('Diet cola, 12-pack cans',        'per_each',  12, 'count',  'Cola'),
  P('Lemon-lime soda, 12-pack',       'per_each',  12, 'count',  'Lemon-lime soda'),
  P('Lemon-lime soda, 2-liter',       'per_each',   2, 'liter',  'Lemon-lime soda'),
  P('Root beer, 12-pack',             'per_each',  12, 'count',  'Root beer'),
  P('Ginger ale, 12-pack',            'per_each',  12, 'count',  'Ginger ale'),
  P('Orange soda, 2-liter',           'per_each',   2, 'liter',  'Orange soda'),
  P('Sparkling apple cider',          'per_each',  25, 'fl_oz',  'Sparkling cider'),
  P('Club soda',                      'per_each',   1, 'liter',  'Sparkling water'),
  P('Tonic water',                    'per_each',   1, 'liter',  'Sparkling water'),
  P('Seltzer, flavored, 12-pack',     'per_each',  12, 'count',  'Sparkling water'),

  // ══════════════════════════════════════════════════════════════════════════
  // COOKING WINES AND MIRIN
  // ══════════════════════════════════════════════════════════════════════════
  P('Dry white cooking wine',         'per_each',  16, 'fl_oz',  'Cooking wine'),
  P('Dry red cooking wine',           'per_each',  16, 'fl_oz',  'Cooking wine'),
  P('Sherry, dry',                    'per_each',  16, 'fl_oz',  'Cooking wine'),
  P('Mirin (sweet rice wine)',        'per_each',  13, 'fl_oz',  'Mirin and sake'),
  P('Sake, cooking',                  'per_each',  16, 'fl_oz',  'Mirin and sake'),
  P('Beer, 6-pack cans',              'per_each',   6, 'count',  'Beer'),
  P('Beer, 12-pack cans',             'per_each',  12, 'count',  'Beer'),

  // ══════════════════════════════════════════════════════════════════════════
  // PLANT-BASED PROTEINS
  // ══════════════════════════════════════════════════════════════════════════
  P('Veggie burger patties',          'per_each',   4, 'count',  'Veggie burgers'),
  P('Plant-based chicken nuggets',    'per_each',  10, 'oz',     'Veggie burgers'),
  P('Plant-based ground beef',        'per_each',  16, 'oz',     'Plant-based ground'),
  P('Plant-based sausage links',      'per_each',  12, 'oz',     'Plant-based ground'),
  P('Tempeh, original',               'per_each',   8, 'oz',     'Tempeh'),
  P('Tempeh, flax',                   'per_each',   8, 'oz',     'Tempeh'),
  P('Seitan strips',                  'per_each',   8, 'oz',     'Seitan'),
  P('Jackfruit, canned in brine',     'per_each',  20, 'oz',     'Plant-Based Proteins'),
  P('Lentil patties',                 'per_each',  10, 'oz',     'Veggie burgers'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE DAIRY
  // ══════════════════════════════════════════════════════════════════════════
  P('Buttermilk',                     'per_each',  32, 'fl_oz',  'Buttermilk'),
  P('Margarine, stick',               'per_each',  16, 'oz',     'Margarine'),
  P('Margarine, tub',                 'per_each',  15, 'oz',     'Margarine'),
  P('Vegan butter',                   'per_each',  16, 'oz',     'Margarine'),
  P('Mascarpone',                     'per_each',   8, 'oz',     'Ricotta'),
  P('Cottage cheese, small curd',     'per_each',  24, 'oz',     'Cheese'),
  P('Brown eggs, large',              'per_each',  12, 'count',  'Eggs'),
  P('Organic eggs, large',            'per_each',  12, 'count',  'Eggs'),
  P('Jumbo eggs',                     'per_each',  12, 'count',  'Eggs'),
  P('Free-range eggs',                'per_each',  12, 'count',  'Eggs'),
  P('Quiche, refrigerated',           'per_each',  23, 'oz',     'Prepared and Refrigerated Foods'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE FROZEN
  // ══════════════════════════════════════════════════════════════════════════
  P('Frozen pizza rolls',             'per_each',  40, 'count',  'Frozen pizza rolls'),
  P('Frozen taquitos',                'per_each',  20, 'count',  'Frozen burritos'),
  P('Frozen tamales',                 'per_each',  21, 'oz',     'Frozen tamales'),
  P('Frozen lasagna',                 'per_each',  32, 'oz',     'Frozen meals'),
  P('Frozen chicken pot pie',         'per_each',   7, 'oz',     'Frozen meals'),
  P('Frozen fish tacos',              'per_each',  10, 'oz',     'Frozen meals'),
  P('Frozen beef and broccoli',       'per_each',  22, 'oz',     'Frozen meals'),
  P('Frozen tikka masala',            'per_each',  10, 'oz',     'Frozen Indian meals'),
  P('Frozen palak paneer',            'per_each',  10, 'oz',     'Frozen Indian meals'),
  P('Frozen soup broth',              'per_each',  32, 'oz',     'Frozen soups'),
  P('Frozen rice, white',             'per_each',   3, 'count',  'Frozen rice'),
  P('Frozen brown rice',              'per_each',   3, 'count',  'Frozen rice'),
  P('Frozen cauliflower rice',        'per_each',  12, 'oz',     'Frozen cauliflower'),
  P('Frozen cheese ravioli',          'per_each',  25, 'oz',     'Frozen ravioli'),
  P('Frozen meat ravioli',            'per_each',  25, 'oz',     'Frozen ravioli'),
  P('Frozen onion rings',             'per_each',  16, 'oz',     'Frozen onion rings'),
  P('Frozen bagel bites',             'per_each',  20, 'count',  'Frozen pizza'),
  P('Frozen flatbread pizza',         'per_each',  16, 'oz',     'Frozen pizza'),
  P('Frozen cheese blintz',           'per_each',  13, 'oz',     'Frozen breakfast'),
  P('Frozen French toast sticks',     'per_each',  12, 'oz',     'Frozen breakfast'),
  P('Frozen breakfast sausage',       'per_each',   9.6,'oz',    'Frozen breakfast'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE CANNED SOUPS
  // ══════════════════════════════════════════════════════════════════════════
  P('Tomato soup, condensed',         'per_each',  10.75,'oz',   'Tomato soup'),
  P('Tomato basil soup',              'per_each',  32, 'oz',     'Tomato soup'),
  P('Cream of mushroom soup',         'per_each',  10.5,'oz',    'Cream soups'),
  P('Cream of chicken soup',          'per_each',  10.5,'oz',    'Cream soups'),
  P('Beef vegetable soup',            'per_each',  19, 'oz',     'Beef soup'),
  P('Minestrone soup',                'per_each',  19, 'oz',     'Beef soup'),
  P('Split pea soup',                 'per_each',  19, 'oz',     'Beef soup'),
  P('Lentil soup',                    'per_each',  19, 'oz',     'Beef soup'),
  P('New England clam chowder',       'per_each',  18.5,'oz',    'Clam chowder'),
  P('Manhattan clam chowder',         'per_each',  18.5,'oz',    'Clam chowder'),
  P('French onion soup',              'per_each',  10.5,'oz',    'Beef soup'),
  P('Beef broth',                     'per_each',  32, 'oz',     'Broth'),
  P('Mushroom broth',                 'per_each',  32, 'oz',     'Broth'),
  P('Bone broth, chicken',            'per_each',  32, 'oz',     'Broth'),
  P('Brown gravy mix',                'per_each',   0.87,'oz',   'Gravy'),
  P('Turkey gravy, canned',           'per_each',  12, 'oz',     'Gravy'),
  P('Alfredo sauce',                  'per_each',  15, 'oz',     'Alfredo sauce'),
  P('Vodka pasta sauce',              'per_each',  24, 'oz',     'Pasta sauce'),
  P('Arrabbiata sauce',               'per_each',  24, 'oz',     'Pasta sauce'),
  P('Marinara sauce',                 'per_each',  24, 'oz',     'Pasta sauce'),

  // ══════════════════════════════════════════════════════════════════════════
  // SPECIALTY RICE AND GRAINS
  // ══════════════════════════════════════════════════════════════════════════
  P('Sushi rice',                     'per_each',  80, 'oz',     'Specialty rice'),
  P('Arborio rice',                   'per_each',  32, 'oz',     'Specialty rice'),
  P('Sticky rice',                    'per_each',  16, 'oz',     'Specialty rice'),
  P('Millet',                         'per_each',  16, 'oz',     'Alternative grains'),
  P('Amaranth',                       'per_each',  14, 'oz',     'Alternative grains'),
  P('Buckwheat groats',               'per_each',  16, 'oz',     'Alternative grains'),
  P('Wheat berries',                  'per_each',  16, 'oz',     'Alternative grains'),
  P('Cream of wheat',                 'per_each',  28, 'oz',     'Instant oatmeal'),
  P('Grits, stone-ground',            'per_each',  24, 'oz',     'Alternative grains'),

  // ══════════════════════════════════════════════════════════════════════════
  // FRESH AND REFRIGERATED PASTA
  // ══════════════════════════════════════════════════════════════════════════
  P('Fresh fettuccine',               'per_each',   9, 'oz',     'Fresh pasta'),
  P('Fresh tortellini, cheese',       'per_each',  20, 'oz',     'Fresh pasta'),
  P('Fresh tortellini, spinach',      'per_each',  20, 'oz',     'Fresh pasta'),
  P('Fresh ravioli, cheese',          'per_each',  20, 'oz',     'Fresh pasta'),
  P('Refrigerated gnocchi',           'per_each',  16, 'oz',     'Fresh pasta'),
  P('Refrigerated cannelloni',        'per_each',   9, 'oz',     'Fresh pasta'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE BEVERAGES
  // ══════════════════════════════════════════════════════════════════════════
  P('Protein shake, chocolate',       'per_each',  11, 'fl_oz',  'Protein shake'),
  P('Protein shake, vanilla',         'per_each',  11, 'fl_oz',  'Protein shake'),
  P('Meal replacement shake',         'per_each',  11, 'fl_oz',  'Meal replacement'),
  P('Electrolyte drink mix',          'per_each',  16, 'count',  'Electrolyte drink'),
  P('Liquid IV packets',              'per_each',  16, 'count',  'Electrolyte drink'),
  P('Smoothie, mango',                'per_each',  11, 'fl_oz',  'Smoothie'),
  P('Smoothie, green',                'per_each',  11, 'fl_oz',  'Smoothie'),
  P('Rice milk',                      'per_each',  64, 'fl_oz',  'Milk alternatives, other'),
  P('Hemp milk',                      'per_each',  32, 'fl_oz',  'Milk alternatives, other'),
  P('Pea milk',                       'per_each',  48, 'fl_oz',  'Milk alternatives, other'),
  P('Apple cider, fresh',             'per_each',  64, 'fl_oz',  'Juice'),
  P('Pomegranate juice',              'per_each',  16, 'fl_oz',  'Juice'),
  P('Acai juice blend',               'per_each',  33.8,'fl_oz', 'Juice'),
  P('Canned coffee drink',            'per_each',  11, 'fl_oz',  'Iced coffee'),
  P('Matcha latte mix',               'per_each',  5.3,'oz',     'Tea'),
  P('Herbal tea bags',                'per_each',  20, 'count',  'Tea'),
  P('Chai tea bags',                  'per_each',  20, 'count',  'Tea'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE SNACKS
  // ══════════════════════════════════════════════════════════════════════════
  P('Corn chips',                     'per_each',  10, 'oz',     'Corn chips'),
  P('Pork rinds',                     'per_each',   3, 'oz',     'Pork rinds'),
  P('Kettle chips',                   'per_each',   8, 'oz',     'Kettle chips'),
  P('Veggie straws',                  'per_each',   7, 'oz',     'Veggie straws'),
  P('Cheese puffs',                   'per_each',   8, 'oz',     'Cheese puffs'),
  P('Puffed corn, cheese flavored',   'per_each',   8, 'oz',     'Cheese puffs'),
  P('Breakfast bar, oat',             'per_each',   6, 'count',  'Breakfast bars'),
  P('Breakfast bar, fruit',           'per_each',   6, 'count',  'Breakfast bars'),
  P('Nut butter squeeze pack',        'per_each',  10, 'count',  'Granola bars'),
  P('Dried mango strips',             'per_each',   3, 'oz',     'Dried fruit'),
  P('Roasted seaweed snack',          'per_each',   0.5,'oz',    'Snacks'),
  P('Dark chocolate almonds',         'per_each',   6, 'oz',     'Chocolate'),
  P('Yogurt-covered raisins',         'per_each',   6, 'oz',     'Dried fruit'),
  P('Peanut butter crackers',         'per_each',   8, 'count',  'Crackers'),
  P('Cheese and crackers snack pack', 'per_each',   6, 'count',  'Crackers'),
  P('Fruit leather',                  'per_each',   5, 'count',  'Fruit snacks'),
  P('Freeze-dried fruit snack',       'per_each',   1, 'oz',     'Fruit snacks'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE SWEETS AND CANDY
  // ══════════════════════════════════════════════════════════════════════════
  P('Chocolate candy bar',            'per_each',   1.5,'oz',    'Candy bars'),
  P('Peanut butter candy bar',        'per_each',   1.5,'oz',    'Candy bars'),
  P('Caramel candy',                  'per_each',  11, 'oz',     'Candy'),
  P('Marshmallows',                   'per_each',  10, 'oz',     'Marshmallows'),
  P('Mini marshmallows',              'per_each',  10, 'oz',     'Marshmallows'),
  P('Chewing gum',                    'per_each',   2, 'count',  'Gum'),
  P('Breath mints',                   'per_each',   1, 'count',  'Mints'),
  P('Chocolate-covered pretzels',     'per_each',   8, 'oz',     'Chocolate'),
  P('Instant pudding mix, vanilla',   'per_each',   3.4,'oz',    'Pudding mix'),
  P('Instant pudding mix, chocolate', 'per_each',   3.9,'oz',    'Pudding mix'),
  P('Gelatin mix, strawberry',        'per_each',   3, 'oz',     'Gelatin mix'),
  P('Gelatin mix, cherry',            'per_each',   3, 'oz',     'Gelatin mix'),
  P('S\'mores kit',                   'per_each',  12, 'oz',     'Sweets'),
  P('Caramel popcorn',                'per_each',   7, 'oz',     'Popcorn'),
  P('Kettle corn',                    'per_each',   7, 'oz',     'Popcorn'),

  // ══════════════════════════════════════════════════════════════════════════
  // NUTS (more varieties)
  // ══════════════════════════════════════════════════════════════════════════
  P('Macadamia nuts',                 'per_each',   6, 'oz',     'Macadamia nuts'),
  P('Hazelnuts',                      'per_each',  12, 'oz',     'Hazelnuts'),
  P('Pine nuts',                      'per_each',   4, 'oz',     'Pine nuts'),
  P('Brazil nuts',                    'per_each',   8, 'oz',     'Mixed nuts'),
  P('Nut mix, salted',                'per_each',  16, 'oz',     'Mixed nuts'),
  P('Honey roasted peanuts',          'per_each',  16, 'oz',     'Peanuts'),
  P('Almond butter',                  'per_each',  16, 'oz',     'Almonds'),
  P('Cashew butter',                  'per_each',  16, 'oz',     'Cashews'),
  P('Sunflower butter',               'per_each',  16, 'oz',     'Seeds'),

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — KOREAN AND THAI
  // ══════════════════════════════════════════════════════════════════════════
  P('Gochujang paste',                'per_each',  17.6,'oz',    'Korean pantry'),
  P('Doenjang soybean paste',         'per_each',  17.6,'oz',    'Korean pantry'),
  P('Sesame oil, Korean',             'per_each',   9.9,'fl_oz', 'Korean pantry'),
  P('Kimchi, napa cabbage',           'per_each',  28, 'oz',     'Korean pantry'),
  P('Korean ramen noodles',           'per_each',   5, 'count',  'Ramen noodles'),
  P('Thai red curry paste',           'per_each',   4, 'oz',     'Thai pantry'),
  P('Thai green curry paste',         'per_each',   4, 'oz',     'Thai pantry'),
  P('Coconut cream',                  'per_each',  13.5,'fl_oz', 'Thai pantry'),
  P('Pad Thai noodles',               'per_each',   6, 'oz',     'Asian noodles'),
  P('Peanut sauce',                   'per_each',  16, 'oz',     'Thai pantry'),
  P('Lemongrass paste',               'per_each',   4, 'oz',     'Thai pantry'),

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — MEDITERRANEAN
  // ══════════════════════════════════════════════════════════════════════════
  P('Kalamata olives',                'per_each',   6, 'oz',     'Mediterranean pantry'),
  P('Sun-dried tomatoes in oil',      'per_each',   8.5,'oz',    'Mediterranean pantry'),
  P('Roasted red peppers, jarred',    'per_each',  12, 'oz',     'Mediterranean pantry'),
  P('Capers',                         'per_each',   3.5,'oz',    'Mediterranean pantry'),
  P('Artichoke hearts, marinated',    'per_each',  12, 'oz',     'Mediterranean pantry'),
  P('Pita chips, sea salt',           'per_each',   8, 'oz',     'Mediterranean pantry'),
  P('Labneh',                         'per_each',  16, 'oz',     'Middle Eastern pantry'),
  P('Falafel mix',                    'per_each',   8, 'oz',     'Middle Eastern pantry'),

  // ══════════════════════════════════════════════════════════════════════════
  // SPECIALTY PANTRY
  // ══════════════════════════════════════════════════════════════════════════
  P('Nutritional yeast',              'per_each',   8, 'oz',     'Nutritional yeast'),
  P('Wheat germ',                     'per_each',  12, 'oz',     'Alternative grains'),
  P('Flaxseed meal',                  'per_each',  16, 'oz',     'Seeds'),
  P('Hemp seeds',                     'per_each',   8, 'oz',     'Seeds'),
  P('Psyllium husk',                  'per_each',  12, 'oz',     'Seeds'),
  P('Matcha powder',                  'per_each',   1, 'oz',     'Tea'),
  P('Spirulina powder',               'per_each',   8, 'oz',     'Vitamins and Supplements'),
  P('Tapioca pearls',                 'per_each',   6, 'oz',     'Cooking starch'),
  P('Arrowroot powder',               'per_each',   8, 'oz',     'Cooking starch'),
  P('Xanthan gum',                    'per_each',   8, 'oz',     'Cooking starch'),
  P('Apple cider vinegar, raw',       'per_each',  32, 'fl_oz',  'Vinegar'),
  P('White wine vinegar',             'per_each',  16, 'fl_oz',  'Vinegar'),
  P('Canned chipotle chicken',        'per_each',  12.5,'oz',    'Canned tuna'),
  P('Refried beans, canned',          'per_each',  16, 'oz',     'Canned beans'),
  P('Refried beans, vegetarian',      'per_each',  16, 'oz',     'Canned beans'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE CONDIMENTS
  // ══════════════════════════════════════════════════════════════════════════
  P('Yellow mustard, large',          'per_each',  30, 'oz',     'Mustard'),
  P('Spicy brown mustard',            'per_each',  12, 'oz',     'Mustard'),
  P('Chipotle mayo',                  'per_each',  12, 'oz',     'Mayonnaise'),
  P('Vegan mayo',                     'per_each',  15, 'oz',     'Mayonnaise'),
  P('Relish, sweet pickle',           'per_each',  24, 'oz',     'Soups, Sauces, and Gravies'),
  P('Pickle spears',                  'per_each',  46, 'fl_oz',  'Soups, Sauces, and Gravies'),
  P('Dill pickles, sliced',           'per_each',  32, 'fl_oz',  'Soups, Sauces, and Gravies'),
  P('Pickle relish, dill',            'per_each',  10, 'oz',     'Soups, Sauces, and Gravies'),
  P('Giardiniera',                    'per_each',  16, 'oz',     'Mediterranean pantry'),
  P('Tahini dressing',                'per_each',  16, 'fl_oz',  'Salad dressing'),
  P('Green goddess dressing',         'per_each',  12, 'fl_oz',  'Salad dressing'),
  P('Asian sesame dressing',          'per_each',  12, 'fl_oz',  'Salad dressing'),
  P('Honey vinaigrette',              'per_each',  12, 'fl_oz',  'Salad dressing'),
  P('Enchilada sauce, red',           'per_each',  28, 'oz',     'Soups, Sauces, and Gravies'),
  P('Enchilada sauce, green',         'per_each',  28, 'oz',     'Soups, Sauces, and Gravies'),
  P('Mole sauce',                     'per_each',   8.25,'oz',   'Latin pantry'),
  P('Chipotle sauce',                 'per_each',   9, 'oz',     'Hot sauce'),
  P('Ghost pepper hot sauce',         'per_each',   5, 'fl_oz',  'Hot sauce'),
  P('Green hot sauce',                'per_each',   6, 'fl_oz',  'Hot sauce'),
  P('Tabasco sauce',                  'per_each',   2, 'fl_oz',  'Hot sauce'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE BAKING
  // ══════════════════════════════════════════════════════════════════════════
  P('Cream cheese frosting',          'per_each',  16, 'oz',     'Syrups'),
  P('Chocolate frosting',             'per_each',  16, 'oz',     'Syrups'),
  P('Vanilla frosting',               'per_each',  16, 'oz',     'Syrups'),
  P('Almond extract',                 'per_each',   2, 'fl_oz',  'Baked Products'),
  P('Peppermint extract',             'per_each',   2, 'fl_oz',  'Baked Products'),
  P('Cream of tartar',                'per_each',   3.5,'oz',    'Baked Products'),
  P('Dry milk powder',                'per_each',  14, 'oz',     'Dairy and Egg Products'),
  P('White chocolate chips',          'per_each',  12, 'oz',     'Baking chocolate'),
  P('Butterscotch chips',             'per_each',  11, 'oz',     'Baking chocolate'),
  P('Food coloring set',              'per_each',   1, 'count',  'Baked Products'),
  P('Sprinkles',                      'per_each',   3, 'oz',     'Baked Products'),
  P('Cookie mix, chocolate chip',     'per_each',  17.5,'oz',    'Baking mixes'),
  P('Muffin mix, blueberry',          'per_each',  17.5,'oz',    'Baking mixes'),
  P('Biscuit mix',                    'per_each',  40, 'oz',     'Baking mixes'),
  P('Corn bread mix',                 'per_each',   8.5,'oz',    'Baking mixes'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE COFFEE
  // ══════════════════════════════════════════════════════════════════════════
  P('Whole bean coffee',              'per_each',  12, 'oz',     'Coffee'),
  P('Dark roast coffee',              'per_each',  12, 'oz',     'Coffee'),
  P('Instant coffee',                 'per_each',   8, 'oz',     'Coffee'),
  P('K-cups, coffee',                 'per_each',  24, 'count',  'Coffee'),
  P('Espresso pods',                  'per_each',  10, 'count',  'Coffee'),

  // ══════════════════════════════════════════════════════════════════════════
  // HEALTH AND PHARMACY
  // ══════════════════════════════════════════════════════════════════════════
  P('Ibuprofen 200mg',                'per_each', 100, 'count',  'Pain relief'),
  P('Acetaminophen 500mg',            'per_each', 100, 'count',  'Pain relief'),
  P('Aspirin 325mg',                  'per_each', 100, 'count',  'Pain relief'),
  P('Naproxen 220mg',                 'per_each',  24, 'count',  'Pain relief'),
  P('Antihistamine, 24-hour',         'per_each',  45, 'count',  'Allergy and sinus'),
  P('Nasal decongestant',             'per_each',  24, 'count',  'Allergy and sinus'),
  P('Nasal spray saline',             'per_each',   1, 'count',  'Allergy and sinus'),
  P('Cold medicine, daytime',         'per_each',  20, 'count',  'Cold and flu'),
  P('Cold medicine, nighttime',       'per_each',   8, 'fl_oz',  'Cold and flu'),
  P('Cough drops',                    'per_each',  30, 'count',  'Cold and flu'),
  P('Cough syrup',                    'per_each',   4, 'fl_oz',  'Cold and flu'),
  P('Antacid tablets',                'per_each', 100, 'count',  'Antacids and digestive'),
  P('Pepto-Bismol',                   'per_each',   4, 'fl_oz',  'Antacids and digestive'),
  P('Laxative tablets',               'per_each',  50, 'count',  'Antacids and digestive'),
  P('Probiotic supplement',           'per_each',  30, 'count',  'Antacids and digestive'),
  P('Bandage strips, assorted',       'per_each',  30, 'count',  'Bandages and first aid'),
  P('Hydrogen peroxide',              'per_each',  16, 'fl_oz',  'Bandages and first aid'),
  P('Rubbing alcohol 70%',            'per_each',  16, 'fl_oz',  'Bandages and first aid'),
  P('Neosporin antibiotic ointment',  'per_each',   1, 'oz',     'Bandages and first aid'),
  P('Gauze pads',                     'per_each',  25, 'count',  'Bandages and first aid'),
  P('Medical tape',                   'per_each',   1, 'count',  'Bandages and first aid'),

  // ══════════════════════════════════════════════════════════════════════════
  // VITAMINS AND SUPPLEMENTS
  // ══════════════════════════════════════════════════════════════════════════
  P('Multivitamin, adult',            'per_each', 100, 'count',  'Multivitamins'),
  P('Multivitamin, women\'s',         'per_each',  90, 'count',  'Multivitamins'),
  P('Multivitamin, gummy',            'per_each',  70, 'count',  'Multivitamins'),
  P('Vitamin C 1000mg',               'per_each',  60, 'count',  'Vitamin C'),
  P('Vitamin D3 2000IU',              'per_each',  90, 'count',  'Vitamin D'),
  P('Omega-3 fish oil',               'per_each', 120, 'count',  'Fish oil'),
  P('Protein powder, whey chocolate', 'per_each',   2, 'lb',     'Protein powder'),
  P('Protein powder, plant-based',    'per_each',   2, 'lb',     'Protein powder'),
  P('Collagen peptides',              'per_each',  13, 'oz',     'Protein powder'),
  P('Magnesium supplement',           'per_each', 100, 'count',  'Vitamins and Supplements'),
  P('Zinc supplement',                'per_each',  60, 'count',  'Vitamins and Supplements'),
  P('B-complex vitamin',              'per_each', 100, 'count',  'Vitamins and Supplements'),
  P('Melatonin 5mg',                  'per_each',  90, 'count',  'Vitamins and Supplements'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE PERSONAL CARE
  // ══════════════════════════════════════════════════════════════════════════
  P('Feminine pads',                  'per_each',  36, 'count',  'Feminine hygiene'),
  P('Tampons',                        'per_each',  36, 'count',  'Feminine hygiene'),
  P('Panty liners',                   'per_each',  60, 'count',  'Feminine hygiene'),
  P('Contact lens solution',          'per_each',  12, 'fl_oz',  'Contact lens care'),
  P('Contact lens case',              'per_each',   2, 'count',  'Contact lens care'),
  P('Hair gel',                       'per_each',   7, 'oz',     'Hair styling'),
  P('Hairspray',                      'per_each',   8, 'oz',     'Hair styling'),
  P('Hair mousse',                    'per_each',   7, 'oz',     'Hair styling'),
  P('Face wash',                      'per_each',   5.1,'fl_oz', 'Skin care'),
  P('Face moisturizer',               'per_each',   1.7,'oz',    'Skin care'),
  P('Acne spot treatment',            'per_each',   1, 'oz',     'Skin care'),
  P('Cotton swabs',                   'per_each', 500, 'count',  'Personal Care'),
  P('Cotton balls',                   'per_each', 200, 'count',  'Personal Care'),
  P('Nail clippers',                  'per_each',   1, 'count',  'Personal Care'),

  // ══════════════════════════════════════════════════════════════════════════
  // PAPER AND PLASTIC TABLEWARE
  // ══════════════════════════════════════════════════════════════════════════
  P('Paper plates, 9-inch',           'per_each', 100, 'count',  'Paper plates'),
  P('Heavy-duty paper plates',        'per_each',  50, 'count',  'Paper plates'),
  P('Paper bowls',                    'per_each',  45, 'count',  'Foam bowls'),
  P('Foam plates',                    'per_each',  50, 'count',  'Foam bowls'),
  P('Plastic cups, 16oz',             'per_each',  50, 'count',  'Paper cups'),
  P('Paper cups, 8oz',                'per_each',  50, 'count',  'Paper cups'),
  P('Plastic forks',                  'per_each', 100, 'count',  'Plastic utensils'),
  P('Plastic spoons',                 'per_each', 100, 'count',  'Plastic utensils'),
  P('Plastic knives',                 'per_each', 100, 'count',  'Plastic utensils'),
  P('Disposable utensil set',         'per_each',  24, 'count',  'Plastic utensils'),
  P('Wooden skewers',                 'per_each', 100, 'count',  'Plastic utensils'),
  P('Toothpicks',                     'per_each', 250, 'count',  'Plastic utensils'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE HOUSEHOLD
  // ══════════════════════════════════════════════════════════════════════════
  P('LED light bulbs, 60W eq.',       'per_each',   4, 'count',  'Light bulbs'),
  P('LED light bulbs, 100W eq.',      'per_each',   4, 'count',  'Light bulbs'),
  P('Batteries AA, 8-pack',           'per_each',   8, 'count',  'Batteries'),
  P('Batteries AAA, 8-pack',          'per_each',   8, 'count',  'Batteries'),
  P('Batteries 9V, 2-pack',           'per_each',   2, 'count',  'Batteries'),
  P('Bleach, regular',                'per_each', 121, 'fl_oz',  'Bleach'),
  P('Bleach, splash-free',            'per_each',  77, 'fl_oz',  'Bleach'),
  P('Air freshener spray',            'per_each',   8.8,'oz',    'Air freshener'),
  P('Air freshener plug-in',          'per_each',   2, 'count',  'Air freshener'),
  P('Scented candle',                 'per_each',   8, 'oz',     'Candles'),
  P('Pillar candle',                  'per_each',   1, 'count',  'Candles'),
  P('Insect repellent spray',         'per_each',   6, 'oz',     'Bug spray'),
  P('Toilet bowl cleaner',            'per_each',  24, 'fl_oz',  'Cleaning supplies'),
  P('Drain cleaner',                  'per_each',  16, 'fl_oz',  'Cleaning supplies'),
  P('Mop refill',                     'per_each',   1, 'count',  'Sponges and scrubbers'),
  P('Scrub brush',                    'per_each',   1, 'count',  'Sponges and scrubbers'),
  P('Rubber gloves',                  'per_each',   1, 'pair',   'Cleaning supplies'),
  P('Steel wool pads',                'per_each',   8, 'count',  'Sponges and scrubbers'),
  P('Laundry stain remover',          'per_each',  22, 'fl_oz',  'Laundry'),
  P('Dryer balls',                    'per_each',   6, 'count',  'Laundry'),
  P('Beeswax wrap',                   'per_each',   3, 'count',  'Foil and wrap'),
  P('Produce bags, mesh',             'per_each',  10, 'count',  'Trash and storage bags'),
  P('Food storage containers, set',   'per_each',   5, 'count',  'Trash and storage bags'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE PET
  // ══════════════════════════════════════════════════════════════════════════
  P('Dog food, large breed',          'per_each',  40, 'lb',     'Dog food'),
  P('Dog food, small breed',          'per_each',  15, 'lb',     'Dog food'),
  P('Dog food, senior',               'per_each',  30, 'lb',     'Dog food'),
  P('Puppy food, dry',                'per_each',  30, 'lb',     'Dog food'),
  P('Grain-free dog food',            'per_each',  24, 'lb',     'Dog food'),
  P('Cat food, indoor formula',       'per_each',  16, 'lb',     'Cat food'),
  P('Cat food, hairball control',     'per_each',  16, 'lb',     'Cat food'),
  P('Kitten food, dry',               'per_each',   7, 'lb',     'Cat food'),
  P('Flea and tick collar',           'per_each',   1, 'count',  'Pet Supplies'),
  P('Pet shampoo',                    'per_each',  16, 'fl_oz',  'Pet Supplies'),
  P('Bird seed',                      'per_each',  10, 'lb',     'Pet Supplies'),
  P('Fish food, flake',               'per_each',   2.5,'oz',    'Pet Supplies'),

  // ══════════════════════════════════════════════════════════════════════════
  // MORE BABY
  // ══════════════════════════════════════════════════════════════════════════
  P('Baby cereal, oatmeal',           'per_each',  8, 'oz',      'Baby food'),
  P('Baby cereal, rice',              'per_each',  8, 'oz',      'Baby food'),
  P('Baby snacks, puffs',             'per_each',  2.1,'oz',     'Baby food'),
  P('Baby snacks, teething crackers', 'per_each',  5.1,'oz',     'Baby food'),
  P('Toddler formula',                'per_each',  22, 'oz',     'Baby formula'),
  P('Baby lotion',                    'per_each',  13, 'fl_oz',  'Baby Products'),
  P('Baby shampoo',                   'per_each',  13.6,'fl_oz', 'Baby Products'),
  P('Diaper rash cream',              'per_each',   4, 'oz',     'Baby Products'),
]

let inserted = 0
let skipped = 0

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
  else skipped++
}

const { rows: totals } = await c.query(`SELECT COUNT(*) AS n FROM canonical_products`)
const { rows: catTotals } = await c.query(`SELECT COUNT(*) AS n FROM product_categories`)

console.log(`\n✓ Inserted ${inserted} new canonical products (${skipped} already existed)`)
console.log(`  Total canonical products: ${totals[0].n}`)
console.log(`  Total product categories: ${catTotals[0].n}`)
console.log('\nNext: node web/scripts/generate-embeddings.mjs')

await c.end()
