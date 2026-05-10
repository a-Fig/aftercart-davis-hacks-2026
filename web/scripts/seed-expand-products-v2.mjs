/**
 * Expansion v2 — comprehensive catalog build-out
 * Adds 200+ canonical products across every major grocery department.
 * Idempotent: every INSERT uses a NOT EXISTS guard.
 *
 *   node web/scripts/seed-expand-products-v2.mjs
 *   node web/scripts/generate-embeddings.mjs   ← run after
 */

import { createClient } from './seed-utils.mjs'

const c = createClient()
await c.connect()

// ─────────────────────────────────────────────────────────────────────────────
// 1. NEW PARENT CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

const NEW_PARENTS = [
  { name: 'Lamb and Game Products',          fdc: 17 },
  { name: 'Deli and Packaged Meats',         fdc: null },
  { name: 'Household Products',              fdc: null },
  { name: 'Personal Care',                   fdc: null },
  { name: 'Pet Supplies',                    fdc: null },
  { name: 'Baby Products',                   fdc: null },
  { name: 'Nuts and Seeds',                  fdc: null },
  { name: 'International and Specialty',     fdc: null },
  { name: 'Prepared and Refrigerated Foods', fdc: null },
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
  // ── Beef ──────────────────────────────────────────────────────────────────
  { name: 'Beef steaks',              parent: 'Beef Products' },
  { name: 'Beef roasts',              parent: 'Beef Products' },
  { name: 'Beef ribs',                parent: 'Beef Products' },
  { name: 'Beef stew meat',           parent: 'Beef Products' },

  // ── Pork ──────────────────────────────────────────────────────────────────
  { name: 'Pork chops',               parent: 'Pork Products' },
  { name: 'Pork loin',                parent: 'Pork Products' },
  { name: 'Pork ribs',                parent: 'Pork Products' },
  { name: 'Pork shoulder',            parent: 'Pork Products' },
  { name: 'Ham',                      parent: 'Pork Products' },
  { name: 'Ground pork',              parent: 'Pork Products' },

  // ── Poultry ───────────────────────────────────────────────────────────────
  { name: 'Whole chicken',            parent: 'Poultry Products' },
  { name: 'Chicken wings',            parent: 'Poultry Products' },
  { name: 'Chicken drumsticks',       parent: 'Poultry Products' },
  { name: 'Ground turkey',            parent: 'Poultry Products' },
  { name: 'Turkey breast',            parent: 'Poultry Products' },

  // ── Deli ──────────────────────────────────────────────────────────────────
  { name: 'Deli turkey',              parent: 'Deli and Packaged Meats' },
  { name: 'Deli ham',                 parent: 'Deli and Packaged Meats' },
  { name: 'Deli roast beef',          parent: 'Deli and Packaged Meats' },
  { name: 'Salami and pepperoni',     parent: 'Deli and Packaged Meats' },
  { name: 'Corned beef and pastrami', parent: 'Deli and Packaged Meats' },

  // ── Lamb ──────────────────────────────────────────────────────────────────
  { name: 'Ground lamb',              parent: 'Lamb and Game Products' },
  { name: 'Lamb chops',               parent: 'Lamb and Game Products' },

  // ── Seafood ───────────────────────────────────────────────────────────────
  { name: 'Shrimp',                   parent: 'Finfish and Shellfish Products' },
  { name: 'Tilapia',                  parent: 'Finfish and Shellfish Products' },
  { name: 'Cod',                      parent: 'Finfish and Shellfish Products' },
  { name: 'Shellfish',                parent: 'Finfish and Shellfish Products' },
  { name: 'Frozen shrimp',            parent: 'Finfish and Shellfish Products' },
  { name: 'Canned salmon',            parent: 'Finfish and Shellfish Products' },
  { name: 'Sardines',                 parent: 'Finfish and Shellfish Products' },

  // ── Dairy (extend) ────────────────────────────────────────────────────────
  { name: 'Heavy cream',              parent: 'Dairy and Egg Products' },
  { name: 'Half-and-half',            parent: 'Dairy and Egg Products' },
  { name: 'Ricotta',                  parent: 'Dairy and Egg Products' },
  { name: 'Whipped cream',            parent: 'Dairy and Egg Products' },
  { name: 'Kefir',                    parent: 'Dairy and Egg Products' },
  { name: 'Ghee',                     parent: 'Dairy and Egg Products' },

  // ── Vegetables (extend) ───────────────────────────────────────────────────
  { name: 'Sweet corn',               parent: 'Vegetables and Vegetable Products' },
  { name: 'Asparagus',                parent: 'Vegetables and Vegetable Products' },
  { name: 'Green beans',              parent: 'Vegetables and Vegetable Products' },
  { name: 'Cauliflower',              parent: 'Vegetables and Vegetable Products' },
  { name: 'Brussels sprouts',         parent: 'Vegetables and Vegetable Products' },
  { name: 'Sweet potatoes',           parent: 'Vegetables and Vegetable Products' },
  { name: 'Ginger',                   parent: 'Vegetables and Vegetable Products' },
  { name: 'Hot peppers',              parent: 'Vegetables and Vegetable Products' },
  { name: 'Cucumber',                 parent: 'Vegetables and Vegetable Products' },
  { name: 'Zucchini',                 parent: 'Vegetables and Vegetable Products' },
  { name: 'Winter squash',            parent: 'Vegetables and Vegetable Products' },
  { name: 'Eggplant',                 parent: 'Vegetables and Vegetable Products' },
  { name: 'Cabbage',                  parent: 'Vegetables and Vegetable Products' },
  { name: 'Kale',                     parent: 'Vegetables and Vegetable Products' },
  { name: 'Bok choy',                 parent: 'Vegetables and Vegetable Products' },
  { name: 'Beets',                    parent: 'Vegetables and Vegetable Products' },
  { name: 'Green onions',             parent: 'Vegetables and Vegetable Products' },
  { name: 'Snap peas',                parent: 'Vegetables and Vegetable Products' },
  { name: 'Tomatillos',               parent: 'Vegetables and Vegetable Products' },
  { name: 'Artichoke',                parent: 'Vegetables and Vegetable Products' },

  // ── Fruits (extend) ───────────────────────────────────────────────────────
  { name: 'Raspberries',              parent: 'Fruits and Fruit Juices' },
  { name: 'Cherries',                 parent: 'Fruits and Fruit Juices' },
  { name: 'Watermelon',               parent: 'Fruits and Fruit Juices' },
  { name: 'Pineapple',                parent: 'Fruits and Fruit Juices' },
  { name: 'Kiwi',                     parent: 'Fruits and Fruit Juices' },
  { name: 'Pears',                    parent: 'Fruits and Fruit Juices' },
  { name: 'Peaches and nectarines',   parent: 'Fruits and Fruit Juices' },
  { name: 'Plums',                    parent: 'Fruits and Fruit Juices' },
  { name: 'Plantains',                parent: 'Fruits and Fruit Juices' },
  { name: 'Clementines',              parent: 'Fruits and Fruit Juices' },
  { name: 'Limes',                    parent: 'Fruits and Fruit Juices' },
  { name: 'Coconut',                  parent: 'Fruits and Fruit Juices' },
  { name: 'Dates',                    parent: 'Fruits and Fruit Juices' },

  // ── Canned (extend) ───────────────────────────────────────────────────────
  { name: 'Canned corn',              parent: 'Vegetables and Vegetable Products' },
  { name: 'Canned fruit',             parent: 'Fruits and Fruit Juices' },
  { name: 'Canned olives',            parent: 'Vegetables and Vegetable Products' },
  { name: 'Canned coconut milk',      parent: 'Beverages' },
  { name: 'Canned chili',             parent: 'Soups, Sauces, and Gravies' },

  // ── Beverages (extend) ────────────────────────────────────────────────────
  { name: 'Coffee creamer',           parent: 'Beverages' },
  { name: 'Sparkling water',          parent: 'Beverages' },
  { name: 'Sports drinks',            parent: 'Beverages' },
  { name: 'Energy drinks',            parent: 'Beverages' },
  { name: 'Coconut water',            parent: 'Beverages' },
  { name: 'Juice',                    parent: 'Beverages' },
  { name: 'Kombucha',                 parent: 'Beverages' },
  { name: 'Iced coffee',              parent: 'Beverages' },
  { name: 'Hot chocolate',            parent: 'Beverages' },

  // ── Frozen (extend) ───────────────────────────────────────────────────────
  { name: 'Frozen meals',             parent: 'Frozen Foods' },
  { name: 'Frozen breakfast',         parent: 'Frozen Foods' },
  { name: 'Frozen poultry',           parent: 'Frozen Foods' },
  { name: 'Frozen seafood',           parent: 'Frozen Foods' },
  { name: 'Frozen fruit',             parent: 'Frozen Foods' },
  { name: 'Frozen burritos',          parent: 'Frozen Foods' },
  { name: 'Frozen dumplings',         parent: 'Frozen Foods' },
  { name: 'Frozen potatoes',          parent: 'Frozen Foods' },
  { name: 'Frozen spinach',           parent: 'Frozen Foods' },
  { name: 'Frozen cauliflower',       parent: 'Frozen Foods' },
  { name: 'Frozen edamame',           parent: 'Frozen Foods' },
  { name: 'Frozen green beans',       parent: 'Frozen Foods' },
  { name: 'Frozen stir fry',          parent: 'Frozen Foods' },

  // ── Baked (extend) ────────────────────────────────────────────────────────
  { name: 'Buns and rolls',           parent: 'Baked Products' },
  { name: 'Flatbreads',               parent: 'Baked Products' },
  { name: 'Baking mixes',             parent: 'Baked Products' },
  { name: 'Crescent rolls',           parent: 'Baked Products' },

  // ── Grains (extend) ───────────────────────────────────────────────────────
  { name: 'Alternative grains',       parent: 'Cereal Grains and Pasta' },
  { name: 'Short pasta shapes',       parent: 'Cereal Grains and Pasta' },
  { name: 'Flat pasta',               parent: 'Cereal Grains and Pasta' },
  { name: 'Asian noodles',            parent: 'Cereal Grains and Pasta' },
  { name: 'Instant oatmeal',          parent: 'Cereal Grains and Pasta' },

  // ── Sauces (extend) ───────────────────────────────────────────────────────
  { name: 'Barbecue sauce',           parent: 'Soups, Sauces, and Gravies' },
  { name: 'Teriyaki and Asian sauces',parent: 'Soups, Sauces, and Gravies' },
  { name: 'Vinegar',                  parent: 'Soups, Sauces, and Gravies' },
  { name: 'Buffalo sauce',            parent: 'Soups, Sauces, and Gravies' },

  // ── Sweets (extend) ───────────────────────────────────────────────────────
  { name: 'Candy',                    parent: 'Sweets' },
  { name: 'Syrups',                   parent: 'Sweets' },
  { name: 'Baking chocolate',         parent: 'Sweets' },
  { name: 'Ice cream bars',           parent: 'Frozen Foods' },

  // ── Spices (extend) ───────────────────────────────────────────────────────
  { name: 'Salt',                     parent: 'Spices and Herbs' },
  { name: 'Seasoning blends',         parent: 'Spices and Herbs' },

  // ── Nuts ──────────────────────────────────────────────────────────────────
  { name: 'Almonds',                  parent: 'Nuts and Seeds' },
  { name: 'Cashews',                  parent: 'Nuts and Seeds' },
  { name: 'Walnuts',                  parent: 'Nuts and Seeds' },
  { name: 'Pecans',                   parent: 'Nuts and Seeds' },
  { name: 'Pistachios',               parent: 'Nuts and Seeds' },
  { name: 'Peanuts',                  parent: 'Nuts and Seeds' },
  { name: 'Mixed nuts',               parent: 'Nuts and Seeds' },
  { name: 'Seeds',                    parent: 'Nuts and Seeds' },

  // ── Snacks (extend) ───────────────────────────────────────────────────────
  { name: 'Popcorn',                  parent: 'Snacks' },
  { name: 'Pretzels',                 parent: 'Snacks' },
  { name: 'Jerky',                    parent: 'Snacks' },
  { name: 'Rice cakes',               parent: 'Snacks' },
  { name: 'Protein bars',             parent: 'Snacks' },
  { name: 'Fruit snacks',             parent: 'Snacks' },

  // ── International ─────────────────────────────────────────────────────────
  { name: 'Japanese pantry',          parent: 'International and Specialty' },
  { name: 'Latin pantry',             parent: 'International and Specialty' },
  { name: 'Indian pantry',            parent: 'International and Specialty' },
  { name: 'Middle Eastern pantry',    parent: 'International and Specialty' },

  // ── Prepared foods ────────────────────────────────────────────────────────
  { name: 'Dips and spreads',         parent: 'Prepared and Refrigerated Foods' },
  { name: 'Tofu',                     parent: 'Prepared and Refrigerated Foods' },
  { name: 'Pizza dough',              parent: 'Prepared and Refrigerated Foods' },

  // ── Household ─────────────────────────────────────────────────────────────
  { name: 'Paper products',           parent: 'Household Products' },
  { name: 'Trash and storage bags',   parent: 'Household Products' },
  { name: 'Foil and wrap',            parent: 'Household Products' },
  { name: 'Dish soap and detergent',  parent: 'Household Products' },
  { name: 'Laundry',                  parent: 'Household Products' },
  { name: 'Cleaning supplies',        parent: 'Household Products' },
  { name: 'Sponges and scrubbers',    parent: 'Household Products' },

  // ── Personal care ─────────────────────────────────────────────────────────
  { name: 'Shampoo and conditioner',  parent: 'Personal Care' },
  { name: 'Body wash and soap',       parent: 'Personal Care' },
  { name: 'Oral care',                parent: 'Personal Care' },
  { name: 'Deodorant',                parent: 'Personal Care' },
  { name: 'Skin care',                parent: 'Personal Care' },
  { name: 'Shaving',                  parent: 'Personal Care' },

  // ── Baby ──────────────────────────────────────────────────────────────────
  { name: 'Diapers',                  parent: 'Baby Products' },
  { name: 'Baby food',                parent: 'Baby Products' },
  { name: 'Baby formula',             parent: 'Baby Products' },

  // ── Pet ───────────────────────────────────────────────────────────────────
  { name: 'Dog food',                 parent: 'Pet Supplies' },
  { name: 'Cat food',                 parent: 'Pet Supplies' },
  { name: 'Cat litter',               parent: 'Pet Supplies' },
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
  // BEEF
  // ══════════════════════════════════════════════════════════════════════════
  P('Ribeye steak',                   'per_lb',   null,  'lb',      'Beef steaks'),
  P('New York strip steak',           'per_lb',   null,  'lb',      'Beef steaks'),
  P('Sirloin steak',                  'per_lb',   null,  'lb',      'Beef steaks'),
  P('Flank steak',                    'per_lb',   null,  'lb',      'Beef steaks'),
  P('T-bone steak',                   'per_lb',   null,  'lb',      'Beef steaks'),
  P('Skirt steak',                    'per_lb',   null,  'lb',      'Beef steaks'),
  P('Chuck roast',                    'per_lb',   null,  'lb',      'Beef roasts'),
  P('Brisket',                        'per_lb',   null,  'lb',      'Beef roasts'),
  P('Beef short ribs',                'per_lb',   null,  'lb',      'Beef ribs'),
  P('Beef back ribs',                 'per_lb',   null,  'lb',      'Beef ribs'),
  P('Beef stew meat',                 'per_lb',   null,  'lb',      'Beef stew meat'),
  P('Ground beef, 90/10',             'per_lb',   null,  'lb',      'Ground beef, raw'),

  // ══════════════════════════════════════════════════════════════════════════
  // PORK
  // ══════════════════════════════════════════════════════════════════════════
  P('Bone-in pork chops',             'per_lb',   null,  'lb',      'Pork chops'),
  P('Boneless pork chops',            'per_lb',   null,  'lb',      'Pork chops'),
  P('Pork tenderloin',                'per_lb',   null,  'lb',      'Pork loin'),
  P('Pork loin roast',                'per_lb',   null,  'lb',      'Pork loin'),
  P('Baby back ribs',                 'per_lb',   null,  'lb',      'Pork ribs'),
  P('Spare ribs',                     'per_lb',   null,  'lb',      'Pork ribs'),
  P('Pork shoulder',                  'per_lb',   null,  'lb',      'Pork shoulder'),
  P('Bone-in ham',                    'per_lb',   null,  'lb',      'Ham'),
  P('Spiral sliced ham',              'per_each',  3,    'lb',      'Ham'),
  P('Ground pork',                    'per_lb',   null,  'lb',      'Ground pork'),
  P('Breakfast sausage links',        'per_each',  12,   'oz',      'Sausage'),
  P('Pork breakfast sausage, bulk',   'per_each',  16,   'oz',      'Sausage'),
  P('Smoked sausage',                 'per_each',  14,   'oz',      'Sausage'),
  P('Kielbasa',                       'per_each',  14,   'oz',      'Sausage'),
  P('Canadian bacon',                 'per_each',   6,   'oz',      'Ham'),
  P('Turkey bacon',                   'per_each',  12,   'oz',      'Bacon'),

  // ══════════════════════════════════════════════════════════════════════════
  // POULTRY (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Whole chicken',                  'per_lb',   null,  'lb',      'Whole chicken'),
  P('Chicken wings',                  'per_lb',   null,  'lb',      'Chicken wings'),
  P('Chicken drumsticks',             'per_lb',   null,  'lb',      'Chicken drumsticks'),
  P('Chicken legs',                   'per_lb',   null,  'lb',      'Chicken drumsticks'),
  P('Ground turkey',                  'per_each',  16,   'oz',      'Ground turkey'),
  P('Turkey breast, whole',           'per_lb',   null,  'lb',      'Turkey breast'),
  P('Chicken tenderloins',            'per_lb',   null,  'lb',      'Chicken, raw'),

  // ══════════════════════════════════════════════════════════════════════════
  // DELI
  // ══════════════════════════════════════════════════════════════════════════
  P('Sliced turkey breast, deli',     'per_each',   9,   'oz',      'Deli turkey'),
  P('Sliced ham, deli',               'per_each',   9,   'oz',      'Deli ham'),
  P('Sliced roast beef, deli',        'per_each',   9,   'oz',      'Deli roast beef'),
  P('Salami',                         'per_each',   7,   'oz',      'Salami and pepperoni'),
  P('Pepperoni',                      'per_each',   7,   'oz',      'Salami and pepperoni'),
  P('Bologna',                        'per_each',  12,   'oz',      'Deli ham'),
  P('Pastrami',                       'per_each',   6,   'oz',      'Corned beef and pastrami'),
  P('Corned beef',                    'per_each',   6,   'oz',      'Corned beef and pastrami'),
  P('Prosciutto',                     'per_each',   3,   'oz',      'Salami and pepperoni'),

  // ══════════════════════════════════════════════════════════════════════════
  // LAMB
  // ══════════════════════════════════════════════════════════════════════════
  P('Ground lamb',                    'per_lb',   null,  'lb',      'Ground lamb'),
  P('Lamb loin chops',                'per_lb',   null,  'lb',      'Lamb chops'),
  P('Rack of lamb',                   'per_lb',   null,  'lb',      'Lamb chops'),

  // ══════════════════════════════════════════════════════════════════════════
  // SEAFOOD
  // ══════════════════════════════════════════════════════════════════════════
  P('Shrimp, raw, large',             'per_lb',   null,  'lb',      'Shrimp'),
  P('Frozen shrimp, medium',          'per_each',  12,   'oz',      'Frozen shrimp'),
  P('Frozen shrimp, jumbo',           'per_each',  16,   'oz',      'Frozen shrimp'),
  P('Tilapia fillets',                'per_lb',   null,  'lb',      'Tilapia'),
  P('Cod fillets',                    'per_lb',   null,  'lb',      'Cod'),
  P('Halibut fillets',                'per_lb',   null,  'lb',      'Cod'),
  P('Mahi-mahi',                      'per_lb',   null,  'lb',      'Cod'),
  P('Catfish fillets',                'per_lb',   null,  'lb',      'Tilapia'),
  P('Frozen tilapia',                 'per_each',  32,   'oz',      'Frozen seafood'),
  P('Frozen salmon fillets',          'per_each',  24,   'oz',      'Frozen seafood'),
  P('Canned salmon',                  'per_each',  14.75,'oz',      'Canned salmon'),
  P('Sardines in olive oil',          'per_each',   3.75,'oz',      'Sardines'),
  P('Sardines in water',              'per_each',   3.75,'oz',      'Sardines'),
  P('Crab legs',                      'per_lb',   null,  'lb',      'Shellfish'),
  P('Scallops',                       'per_lb',   null,  'lb',      'Shellfish'),
  P('Clams, littleneck',              'per_lb',   null,  'lb',      'Shellfish'),
  P('Mussels',                        'per_lb',   null,  'lb',      'Shellfish'),

  // ══════════════════════════════════════════════════════════════════════════
  // DAIRY (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Heavy whipping cream',           'per_each',  16,   'fl_oz',   'Heavy cream'),
  P('Half-and-half',                  'per_each',  32,   'fl_oz',   'Half-and-half'),
  P('Whipped cream, aerosol',         'per_each',   8,   'oz',      'Whipped cream'),
  P('Kefir, plain',                   'per_each',  32,   'fl_oz',   'Kefir'),
  P('Ghee',                           'per_each',  13,   'oz',      'Ghee'),
  P('Unsalted butter',                'per_each',  16,   'oz',      'Butter'),
  P('Lactose-free milk',              'per_each',  128,  'fl_oz',   'Milk'),
  P('Soy milk',                       'per_each',  64,   'fl_oz',   'Plant-based milk'),
  P('Coconut milk beverage',          'per_each',  64,   'fl_oz',   'Plant-based milk'),
  P('Ricotta cheese',                 'per_each',  15,   'oz',      'Ricotta'),
  P('American cheese slices',         'per_each',  16,   'oz',      'Cheese'),
  P('Pepper jack cheese',             'per_each',   8,   'oz',      'Cheese'),
  P('Swiss cheese',                   'per_each',   8,   'oz',      'Cheese'),
  P('Provolone cheese',               'per_each',   8,   'oz',      'Cheese'),
  P('Colby jack cheese',              'per_each',   8,   'oz',      'Cheese'),
  P('Monterey jack cheese',           'per_each',   8,   'oz',      'Cheese'),
  P('Brie',                           'per_each',   8,   'oz',      'Cheese'),
  P('Blue cheese crumbles',           'per_each',   4,   'oz',      'Cheese'),
  P('Gouda',                          'per_each',   7,   'oz',      'Cheese'),
  P('String cheese',                  'per_each',  12,   'count',   'Cheese'),
  P('Feta cheese',                    'per_each',   6,   'oz',      'Cheese'),
  P('Plain yogurt',                   'per_each',  32,   'oz',      'Yogurt'),

  // ══════════════════════════════════════════════════════════════════════════
  // PRODUCE — VEGETABLES (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Corn on the cob',                'per_each',   4,   'count',   'Sweet corn'),
  P('Asparagus',                      'per_lb',   null,  'lb',      'Asparagus'),
  P('Green beans',                    'per_lb',   null,  'lb',      'Green beans'),
  P('Cauliflower',                    'per_each',   1,   'count',   'Cauliflower'),
  P('Brussels sprouts',               'per_each',  12,   'oz',      'Brussels sprouts'),
  P('Sweet potatoes',                 'per_lb',   null,  'lb',      'Sweet potatoes'),
  P('Ginger root',                    'per_lb',   null,  'lb',      'Ginger'),
  P('Jalapeño peppers',               'per_each',   1,   'count',   'Hot peppers'),
  P('Serrano peppers',                'per_lb',   null,  'lb',      'Hot peppers'),
  P('English cucumber',               'per_each',   1,   'count',   'Cucumber'),
  P('Zucchini',                       'per_lb',   null,  'lb',      'Zucchini'),
  P('Yellow squash',                  'per_lb',   null,  'lb',      'Zucchini'),
  P('Butternut squash',               'per_each',   1,   'count',   'Winter squash'),
  P('Eggplant',                       'per_each',   1,   'count',   'Eggplant'),
  P('Green cabbage',                  'per_each',   1,   'count',   'Cabbage'),
  P('Red cabbage',                    'per_each',   1,   'count',   'Cabbage'),
  P('Kale',                           'per_each',   1,   'bunch',   'Kale'),
  P('Baby kale',                      'per_each',   5,   'oz',      'Kale'),
  P('Bok choy',                       'per_lb',   null,  'lb',      'Bok choy'),
  P('Beets',                          'per_each',   1,   'bunch',   'Beets'),
  P('Green onions',                   'per_each',   1,   'bunch',   'Green onions'),
  P('Leeks',                          'per_each',   1,   'bunch',   'Green onions'),
  P('Sugar snap peas',                'per_each',   8,   'oz',      'Snap peas'),
  P('Tomatillos',                     'per_each',  12,   'oz',      'Tomatillos'),
  P('Artichoke',                      'per_each',   1,   'count',   'Artichoke'),
  P('Shallots',                       'per_each',   8,   'oz',      'Onions'),
  P('Radishes',                       'per_each',   1,   'bunch',   'Vegetables and Vegetable Products'),

  // ══════════════════════════════════════════════════════════════════════════
  // PRODUCE — FRUITS (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Raspberries',                    'per_each',   6,   'oz',      'Raspberries'),
  P('Blackberries',                   'per_each',   6,   'oz',      'Raspberries'),
  P('Cherries',                       'per_lb',   null,  'lb',      'Cherries'),
  P('Watermelon, whole',              'per_each',   1,   'count',   'Watermelon'),
  P('Watermelon, seedless, mini',     'per_each',   1,   'count',   'Watermelon'),
  P('Pineapple, whole',               'per_each',   1,   'count',   'Pineapple'),
  P('Pineapple, sliced',              'per_each',  12,   'oz',      'Pineapple'),
  P('Kiwi',                           'per_each',   4,   'count',   'Kiwi'),
  P('Grapefruit',                     'per_each',   1,   'count',   'Citrus'),
  P('Bartlett pears',                 'per_lb',   null,  'lb',      'Pears'),
  P('Bosc pears',                     'per_lb',   null,  'lb',      'Pears'),
  P('Peaches',                        'per_lb',   null,  'lb',      'Peaches and nectarines'),
  P('Nectarines',                     'per_lb',   null,  'lb',      'Peaches and nectarines'),
  P('Plums',                          'per_lb',   null,  'lb',      'Plums'),
  P('Plantains',                      'per_lb',   null,  'lb',      'Plantains'),
  P('Clementines',                    'per_each',   5,   'lb',      'Clementines'),
  P('Limes',                          'per_each',   8,   'count',   'Limes'),
  P('Shredded coconut',               'per_each',   7,   'oz',      'Coconut'),
  P('Dates, Medjool',                 'per_each',  16,   'oz',      'Dates'),

  // ══════════════════════════════════════════════════════════════════════════
  // CANNED GOODS (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Tomato paste',                   'per_each',   6,   'oz',      'Canned tomatoes'),
  P('Crushed tomatoes',               'per_each',  28,   'oz',      'Canned tomatoes'),
  P('Whole peeled tomatoes',          'per_each',  28,   'oz',      'Canned tomatoes'),
  P('Fire-roasted tomatoes',          'per_each',  14.5, 'oz',      'Canned tomatoes'),
  P('Canned corn',                    'per_each',  15.25,'oz',      'Canned corn'),
  P('Canned green beans',             'per_each',  14.5, 'oz',      'Vegetables and Vegetable Products'),
  P('Canned peas',                    'per_each',  15,   'oz',      'Vegetables and Vegetable Products'),
  P('Canned pumpkin',                 'per_each',  15,   'oz',      'Vegetables and Vegetable Products'),
  P('Canned artichoke hearts',        'per_each',  14,   'oz',      'Canned olives'),
  P('Canned olives, black',           'per_each',   6,   'oz',      'Canned olives'),
  P('Canned jalapeños',               'per_each',  12,   'oz',      'Vegetables and Vegetable Products'),
  P('Canned lentils',                 'per_each',  15,   'oz',      'Canned beans'),
  P('Canned peaches',                 'per_each',  15,   'oz',      'Canned fruit'),
  P('Canned pears',                   'per_each',  15,   'oz',      'Canned fruit'),
  P('Canned pineapple chunks',        'per_each',  20,   'oz',      'Canned fruit'),
  P('Canned mandarin oranges',        'per_each',  11,   'oz',      'Canned fruit'),
  P('Canned coconut milk',            'per_each',  13.5, 'fl_oz',   'Canned coconut milk'),
  P('Canned chili, no beans',         'per_each',  15,   'oz',      'Canned chili'),
  P('Canned chili, with beans',       'per_each',  15,   'oz',      'Canned chili'),
  P('Canned chicken breast',          'per_each',  12.5, 'oz',      'Canned tuna'),
  P('Tomato sauce',                   'per_each',   8,   'oz',      'Canned tomatoes'),

  // ══════════════════════════════════════════════════════════════════════════
  // BEVERAGES (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Coffee creamer, liquid',         'per_each',  32,   'fl_oz',   'Coffee creamer'),
  P('Coffee creamer, powdered',       'per_each',  16,   'oz',      'Coffee creamer'),
  P('Sparkling water, plain',         'per_each',  12,   'count',   'Sparkling water'),
  P('Flavored sparkling water',       'per_each',  12,   'count',   'Sparkling water'),
  P('Sports drink',                   'per_each',  32,   'fl_oz',   'Sports drinks'),
  P('Energy drink',                   'per_each',  16,   'fl_oz',   'Energy drinks'),
  P('Coconut water',                  'per_each',  33.8, 'fl_oz',   'Coconut water'),
  P('Cranberry juice',                'per_each',  64,   'fl_oz',   'Juice'),
  P('Grape juice',                    'per_each',  64,   'fl_oz',   'Juice'),
  P('Tomato juice',                   'per_each',  46,   'fl_oz',   'Juice'),
  P('V8 vegetable juice',             'per_each',  46,   'fl_oz',   'Juice'),
  P('Lemonade',                       'per_each',  59,   'fl_oz',   'Juice'),
  P('Kombucha',                       'per_each',  16,   'fl_oz',   'Kombucha'),
  P('Cold brew coffee',               'per_each',  32,   'fl_oz',   'Iced coffee'),
  P('Iced coffee, bottled',           'per_each',  13.7, 'fl_oz',   'Iced coffee'),
  P('Hot chocolate mix',              'per_each',   9.6, 'oz',      'Hot chocolate'),
  P('Green tea bags',                 'per_each',  20,   'count',   'Tea'),

  // ══════════════════════════════════════════════════════════════════════════
  // FROZEN (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Frozen chicken nuggets',         'per_each',  32,   'oz',      'Frozen poultry'),
  P('Frozen chicken tenders',         'per_each',  24,   'oz',      'Frozen poultry'),
  P('Frozen chicken breasts',         'per_each',  48,   'oz',      'Frozen poultry'),
  P('Frozen beef burgers',            'per_each',  32,   'oz',      'Frozen meals'),
  P('Frozen waffles',                 'per_each',  12.3, 'oz',      'Frozen breakfast'),
  P('Frozen pancakes',                'per_each',  16.4, 'oz',      'Frozen breakfast'),
  P('Frozen breakfast burritos',      'per_each',   8,   'count',   'Frozen burritos'),
  P('Frozen bean and cheese burritos','per_each',   8,   'count',   'Frozen burritos'),
  P('Frozen pot pie',                 'per_each',   7,   'oz',      'Frozen meals'),
  P('Frozen macaroni and cheese',     'per_each',  12,   'oz',      'Frozen meals'),
  P('Frozen dumplings, pork',         'per_each',  24,   'oz',      'Frozen dumplings'),
  P('Frozen potstickers',             'per_each',  21,   'oz',      'Frozen dumplings'),
  P('Frozen egg rolls',               'per_each',  17.6, 'oz',      'Frozen dumplings'),
  P('Tater tots',                     'per_each',  32,   'oz',      'Frozen potatoes'),
  P('Frozen hash browns',             'per_each',  32,   'oz',      'Frozen potatoes'),
  P('Frozen french fries',            'per_each',  32,   'oz',      'Frozen potatoes'),
  P('Frozen mango chunks',            'per_each',  16,   'oz',      'Frozen fruit'),
  P('Frozen pineapple chunks',        'per_each',  16,   'oz',      'Frozen fruit'),
  P('Frozen peach slices',            'per_each',  16,   'oz',      'Frozen fruit'),
  P('Frozen spinach',                 'per_each',  10,   'oz',      'Frozen spinach'),
  P('Frozen cauliflower florets',     'per_each',  16,   'oz',      'Frozen cauliflower'),
  P('Frozen edamame, in shell',       'per_each',  16,   'oz',      'Frozen edamame'),
  P('Frozen edamame, shelled',        'per_each',  12,   'oz',      'Frozen edamame'),
  P('Frozen green beans',             'per_each',  12,   'oz',      'Frozen green beans'),
  P('Frozen stir fry vegetables',     'per_each',  16,   'oz',      'Frozen stir fry'),
  P('Chocolate ice cream',            'per_each',  48,   'fl_oz',   'Ice cream'),
  P('Strawberry ice cream',           'per_each',  48,   'fl_oz',   'Ice cream'),
  P('Ice cream sandwiches',           'per_each',  12,   'count',   'Ice cream bars'),
  P('Ice cream bars',                 'per_each',   6,   'count',   'Ice cream bars'),

  // ══════════════════════════════════════════════════════════════════════════
  // BAKERY (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Hamburger buns',                 'per_each',   8,   'count',   'Buns and rolls'),
  P('Hot dog buns',                   'per_each',   8,   'count',   'Buns and rolls'),
  P('Dinner rolls',                   'per_each',  12,   'count',   'Buns and rolls'),
  P('Hawaiian sweet rolls',           'per_each',  12,   'count',   'Buns and rolls'),
  P('Croissants',                     'per_each',   4,   'count',   'Pastry'),
  P('Baguette',                       'per_each',   1,   'count',   'Bread'),
  P('Ciabatta bread',                 'per_each',  16,   'oz',      'Bread'),
  P('Multigrain bread',               'per_each',   1,   'loaf',    'Bread'),
  P('Potato bread',                   'per_each',   1,   'loaf',    'Bread'),
  P('Rye bread',                      'per_each',   1,   'loaf',    'Bread'),
  P('Pita bread',                     'per_each',   6,   'count',   'Flatbreads'),
  P('Naan',                           'per_each',   4,   'count',   'Flatbreads'),
  P('Pita chips',                     'per_each',   8,   'oz',      'Crackers'),
  P('Cinnamon rolls',                 'per_each',   5,   'count',   'Pastry'),
  P('Muffins, assorted',              'per_each',   4,   'count',   'Pastry'),
  P('Donuts, glazed',                 'per_each',  12,   'count',   'Pastry'),
  P('Waffles, fresh',                 'per_each',   2,   'count',   'Pastry'),
  P('Crescent rolls, refrigerated',   'per_each',   8,   'count',   'Crescent rolls'),
  P('Pancake mix',                    'per_each',  32,   'oz',      'Baking mixes'),
  P('Box cake mix',                   'per_each',  15.25,'oz',      'Baking mixes'),
  P('Box brownie mix',                'per_each',  18,   'oz',      'Baking mixes'),

  // ══════════════════════════════════════════════════════════════════════════
  // GRAINS, PASTA, NOODLES (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Elbow macaroni',                 'per_each',  16,   'oz',      'Short pasta shapes'),
  P('Rotini',                         'per_each',  16,   'oz',      'Short pasta shapes'),
  P('Fusilli',                        'per_each',  16,   'oz',      'Short pasta shapes'),
  P('Farfalle (bow-tie pasta)',        'per_each',  16,   'oz',      'Short pasta shapes'),
  P('Rigatoni',                       'per_each',  16,   'oz',      'Short pasta shapes'),
  P('Orzo',                           'per_each',  16,   'oz',      'Short pasta shapes'),
  P('Lasagna sheets',                 'per_each',  16,   'oz',      'Flat pasta'),
  P('Linguine',                       'per_each',  16,   'oz',      'Flat pasta'),
  P('Fettuccine',                     'per_each',  16,   'oz',      'Flat pasta'),
  P('Angel hair pasta',               'per_each',  16,   'oz',      'Flat pasta'),
  P('Udon noodles',                   'per_each',  17.6, 'oz',      'Asian noodles'),
  P('Rice noodles',                   'per_each',  14,   'oz',      'Asian noodles'),
  P('Egg noodles',                    'per_each',  16,   'oz',      'Asian noodles'),
  P('Rice vermicelli',                'per_each',  14,   'oz',      'Asian noodles'),
  P('Instant oatmeal packets',        'per_each',  10,   'count',   'Instant oatmeal'),
  P('Grits',                          'per_each',  24,   'oz',      'Cereal Grains and Pasta'),
  P('Cornmeal',                       'per_each',  32,   'oz',      'Cereal Grains and Pasta'),
  P('Polenta',                        'per_each',  18,   'oz',      'Alternative grains'),
  P('Barley',                         'per_each',  30,   'oz',      'Alternative grains'),
  P('Couscous',                       'per_each',  10,   'oz',      'Alternative grains'),
  P('Farro',                          'per_each',  24,   'oz',      'Alternative grains'),
  P('Wild rice blend',                'per_each',  16,   'oz',      'Rice'),
  P('Jasmine rice',                   'per_each',  80,   'oz',      'Rice'),
  P('Basmati rice',                   'per_each',  32,   'oz',      'Rice'),
  P('Dried lentils',                  'per_each',  16,   'oz',      'Dried beans'),
  P('Dried split peas',               'per_each',  16,   'oz',      'Dried beans'),
  P('Masa harina',                    'per_each',  80,   'oz',      'Baked Products'),

  // ══════════════════════════════════════════════════════════════════════════
  // CONDIMENTS AND SAUCES (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Barbecue sauce',                 'per_each',  18,   'oz',      'Barbecue sauce'),
  P('Smoky barbecue sauce',           'per_each',  20,   'oz',      'Barbecue sauce'),
  P('Teriyaki sauce',                 'per_each',  10,   'fl_oz',   'Teriyaki and Asian sauces'),
  P('Oyster sauce',                   'per_each',  18,   'oz',      'Teriyaki and Asian sauces'),
  P('Fish sauce',                     'per_each',  11.8, 'fl_oz',   'Teriyaki and Asian sauces'),
  P('Hoisin sauce',                   'per_each',   8,   'oz',      'Teriyaki and Asian sauces'),
  P('Sweet chili sauce',              'per_each',  11.75,'fl_oz',   'Teriyaki and Asian sauces'),
  P('Sriracha',                       'per_each',  17,   'oz',      'Hot sauce'),
  P('Worcestershire sauce',           'per_each',  10,   'fl_oz',   'Soups, Sauces, and Gravies'),
  P('Apple cider vinegar',            'per_each',  32,   'fl_oz',   'Vinegar'),
  P('Balsamic vinegar',               'per_each',  16.9, 'fl_oz',   'Vinegar'),
  P('White vinegar',                  'per_each',  32,   'fl_oz',   'Vinegar'),
  P('Rice vinegar',                   'per_each',  12,   'fl_oz',   'Vinegar'),
  P('Dijon mustard',                  'per_each',  12,   'oz',      'Mustard'),
  P('Whole grain mustard',            'per_each',   9,   'oz',      'Mustard'),
  P('Honey mustard',                  'per_each',  12,   'oz',      'Mustard'),
  P('Italian dressing',               'per_each',  16,   'fl_oz',   'Salad dressing'),
  P('Caesar dressing',                'per_each',  12,   'fl_oz',   'Salad dressing'),
  P('Balsamic vinaigrette',           'per_each',  12,   'fl_oz',   'Salad dressing'),
  P('Blue cheese dressing',           'per_each',  12,   'fl_oz',   'Salad dressing'),
  P('Thousand island dressing',       'per_each',  12,   'fl_oz',   'Salad dressing'),
  P('Tartar sauce',                   'per_each',  12,   'oz',      'Soups, Sauces, and Gravies'),
  P('Cocktail sauce',                 'per_each',  12,   'oz',      'Soups, Sauces, and Gravies'),
  P('Buffalo sauce',                  'per_each',  12,   'oz',      'Buffalo sauce'),
  P('Sesame oil',                     'per_each',   9,   'fl_oz',   'Fats and Oils'),
  P('Coconut oil',                    'per_each',  14,   'oz',      'Fats and Oils'),
  P('Cooking spray',                  'per_each',   5,   'oz',      'Fats and Oils'),
  P('Tahini',                         'per_each',  16,   'oz',      'Legumes and Legume Products'),
  P('Coconut aminos',                 'per_each',  16,   'oz',      'Teriyaki and Asian sauces'),

  // ══════════════════════════════════════════════════════════════════════════
  // BAKING (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Bread flour',                    'per_each',  80,   'oz',      'Flour'),
  P('Cake flour',                     'per_each',  32,   'oz',      'Flour'),
  P('Almond flour',                   'per_each',  16,   'oz',      'Flour'),
  P('Cornstarch',                     'per_each',  16,   'oz',      'Flour'),
  P('Chocolate chips, semi-sweet',    'per_each',  12,   'oz',      'Baking chocolate'),
  P('Cocoa powder, unsweetened',      'per_each',   8,   'oz',      'Baking chocolate'),
  P('Baking chocolate, dark',         'per_each',   4,   'oz',      'Baking chocolate'),
  P('Powdered sugar',                 'per_each',  32,   'oz',      'Sugar'),
  P('Brown sugar',                    'per_each',  32,   'oz',      'Sugar'),
  P('Maple syrup',                    'per_each',  12,   'fl_oz',   'Syrups'),
  P('Agave nectar',                   'per_each',  23.5, 'oz',      'Syrups'),
  P('Molasses',                       'per_each',  12,   'oz',      'Syrups'),
  P('Corn syrup',                     'per_each',  16,   'oz',      'Syrups'),
  P('Active dry yeast',               'per_each',   4,   'oz',      'Baked Products'),
  P('Baking powder',                  'per_each',  10,   'oz',      'Baked Products'),
  P('Baking soda',                    'per_each',  16,   'oz',      'Baked Products'),
  P('Vanilla extract',                'per_each',   2,   'fl_oz',   'Baked Products'),
  P('Sweetened condensed milk',       'per_each',  14,   'oz',      'Dairy and Egg Products'),
  P('Evaporated milk',                'per_each',  12,   'oz',      'Dairy and Egg Products'),
  P('Bread crumbs',                   'per_each',  15,   'oz',      'Baked Products'),
  P('Panko bread crumbs',             'per_each',  8,    'oz',      'Baked Products'),
  P('Caramel sauce',                  'per_each',  12,   'oz',      'Syrups'),
  P('Chocolate fudge sauce',          'per_each',  11.75,'oz',      'Syrups'),

  // ══════════════════════════════════════════════════════════════════════════
  // SPICES (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Table salt',                     'per_each',  26,   'oz',      'Salt'),
  P('Sea salt',                       'per_each',  26,   'oz',      'Salt'),
  P('Garlic powder',                  'per_each',   3.12,'oz',      'Ground spices'),
  P('Onion powder',                   'per_each',   2.62,'oz',      'Ground spices'),
  P('Ground cumin',                   'per_each',   2,   'oz',      'Ground spices'),
  P('Chili powder',                   'per_each',   2.5, 'oz',      'Ground spices'),
  P('Paprika',                        'per_each',   2,   'oz',      'Ground spices'),
  P('Ground turmeric',                'per_each',   1.75,'oz',      'Ground spices'),
  P('Cayenne pepper',                 'per_each',   1.5, 'oz',      'Ground spices'),
  P('Italian seasoning',              'per_each',   0.75,'oz',      'Seasoning blends'),
  P('Taco seasoning',                 'per_each',   1,   'oz',      'Seasoning blends'),
  P('Garlic salt',                    'per_each',   3.75,'oz',      'Seasoning blends'),
  P('Dried thyme',                    'per_each',   0.65,'oz',      'Dried herbs'),
  P('Dried rosemary',                 'per_each',   0.65,'oz',      'Dried herbs'),
  P('Dried parsley',                  'per_each',   0.5, 'oz',      'Dried herbs'),
  P('Bay leaves',                     'per_each',   0.18,'oz',      'Dried herbs'),
  P('Red pepper flakes',              'per_each',   1.5, 'oz',      'Ground spices'),

  // ══════════════════════════════════════════════════════════════════════════
  // NUTS AND SEEDS
  // ══════════════════════════════════════════════════════════════════════════
  P('Raw almonds',                    'per_each',  16,   'oz',      'Almonds'),
  P('Roasted almonds',                'per_each',  16,   'oz',      'Almonds'),
  P('Cashews, roasted',               'per_each',  16,   'oz',      'Cashews'),
  P('Walnut halves',                  'per_each',  16,   'oz',      'Walnuts'),
  P('Pecan halves',                   'per_each',  12,   'oz',      'Pecans'),
  P('Pistachios, roasted',            'per_each',  16,   'oz',      'Pistachios'),
  P('Dry roasted peanuts',            'per_each',  16,   'oz',      'Peanuts'),
  P('Mixed nuts',                     'per_each',  16,   'oz',      'Mixed nuts'),
  P('Sunflower seeds',                'per_each',  16,   'oz',      'Seeds'),
  P('Pumpkin seeds (pepitas)',         'per_each',  16,   'oz',      'Seeds'),
  P('Flaxseeds',                      'per_each',  16,   'oz',      'Seeds'),
  P('Chia seeds',                     'per_each',  12,   'oz',      'Seeds'),
  P('Sesame seeds',                   'per_each',  12,   'oz',      'Seeds'),

  // ══════════════════════════════════════════════════════════════════════════
  // SNACKS (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Microwave popcorn',              'per_each',   3,   'count',   'Popcorn'),
  P('Popcorn, ready-to-eat',          'per_each',   7,   'oz',      'Popcorn'),
  P('Pretzels',                       'per_each',  16,   'oz',      'Pretzels'),
  P('Pretzel sticks',                 'per_each',  16,   'oz',      'Pretzels'),
  P('Beef jerky',                     'per_each',  10,   'oz',      'Jerky'),
  P('Turkey jerky',                   'per_each',   7,   'oz',      'Jerky'),
  P('Rice cakes, plain',              'per_each',   4.5, 'oz',      'Rice cakes'),
  P('Rice cakes, flavored',           'per_each',   4.5, 'oz',      'Rice cakes'),
  P('Protein bars',                   'per_each',   6,   'count',   'Protein bars'),
  P('Granola',                        'per_each',  16,   'oz',      'Granola bars'),
  P('Trail mix',                      'per_each',  16,   'oz',      'Mixed nuts'),
  P('Fruit snacks pouches',           'per_each',  10,   'count',   'Fruit snacks'),
  P('Applesauce cups',                'per_each',   4,   'count',   'Fruit snacks'),
  P('Graham crackers',                'per_each',  14.4, 'oz',      'Crackers'),
  P('Ritz crackers',                  'per_each',  13.7, 'oz',      'Crackers'),
  P('Triscuit crackers',              'per_each',   9,   'oz',      'Crackers'),
  P('Animal crackers',                'per_each',  16,   'oz',      'Crackers'),
  P('Rice crackers',                  'per_each',   3.5, 'oz',      'Crackers'),

  // ══════════════════════════════════════════════════════════════════════════
  // SWEETS / CANDY (extend)
  // ══════════════════════════════════════════════════════════════════════════
  P('Milk chocolate bar',             'per_each',   3.5, 'oz',      'Chocolate'),
  P('Gummy bears',                    'per_each',   5,   'oz',      'Candy'),
  P('Sour candy',                     'per_each',   5,   'oz',      'Candy'),
  P('Lollipops',                      'per_each',  10,   'count',   'Candy'),
  P('Pudding cups',                   'per_each',   4,   'count',   'Sweets'),
  P('Jell-O cups',                    'per_each',   4,   'count',   'Sweets'),
  P('Dried cranberries',              'per_each',   6,   'oz',      'Dried fruit'),
  P('Raisins',                        'per_each',  12,   'oz',      'Dried fruit'),
  P('Dried mango',                    'per_each',   6,   'oz',      'Dried fruit'),
  P('Dried apricots',                 'per_each',   6,   'oz',      'Dried fruit'),
  P('Brownie mix cookies',            'per_each',  16,   'oz',      'Cookies'),
  P('Oatmeal raisin cookies',         'per_each',  13,   'oz',      'Cookies'),
  P('Oreo cookies',                   'per_each',  14.3, 'oz',      'Cookies'),
  P('Vanilla wafers',                 'per_each',  11,   'oz',      'Cookies'),

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL AND SPECIALTY
  // ══════════════════════════════════════════════════════════════════════════
  P('Miso paste, white',              'per_each',  17.6, 'oz',      'Japanese pantry'),
  P('Nori sheets',                    'per_each',  10,   'count',   'Japanese pantry'),
  P('Dashi stock',                    'per_each',  14.1, 'oz',      'Japanese pantry'),
  P('Ponzu sauce',                    'per_each',  10,   'fl_oz',   'Japanese pantry'),
  P('Chipotle peppers in adobo',      'per_each',   7,   'oz',      'Latin pantry'),
  P('Dried ancho chiles',             'per_each',   2,   'oz',      'Latin pantry'),
  P('Coconut milk, light canned',     'per_each',  13.5, 'fl_oz',   'Indian pantry'),
  P('Curry powder',                   'per_each',   2,   'oz',      'Indian pantry'),
  P('Garam masala',                   'per_each',   2,   'oz',      'Indian pantry'),
  P('Tahini',                         'per_each',  16,   'oz',      'Middle Eastern pantry'),
  P('Za\'atar seasoning',             'per_each',   2,   'oz',      'Middle Eastern pantry'),
  P('Harissa paste',                  'per_each',   4.6, 'oz',      'Middle Eastern pantry'),

  // ══════════════════════════════════════════════════════════════════════════
  // PREPARED & REFRIGERATED
  // ══════════════════════════════════════════════════════════════════════════
  P('Spinach and artichoke dip',      'per_each',  10,   'oz',      'Dips and spreads'),
  P('French onion dip',               'per_each',  16,   'oz',      'Dips and spreads'),
  P('Guacamole',                      'per_each',  12,   'oz',      'Dips and spreads'),
  P('Firm tofu',                      'per_each',  14,   'oz',      'Tofu'),
  P('Silken tofu',                    'per_each',  12,   'oz',      'Tofu'),
  P('Refrigerated pizza dough',       'per_each',  13.8, 'oz',      'Pizza dough'),
  P('Refrigerated pie dough',         'per_each',  14.1, 'oz',      'Crescent rolls'),
  P('Mac and cheese, boxed',          'per_each',   7.25,'oz',      'Cereal Grains and Pasta'),

  // ══════════════════════════════════════════════════════════════════════════
  // HOUSEHOLD PRODUCTS
  // ══════════════════════════════════════════════════════════════════════════
  P('Paper towels',                   'per_each',   6,   'count',   'Paper products'),
  P('Toilet paper',                   'per_each',  12,   'count',   'Paper products'),
  P('Paper napkins',                  'per_each', 100,   'count',   'Paper products'),
  P('Facial tissues',                 'per_each',   2,   'count',   'Paper products'),
  P('Trash bags, 13-gallon',          'per_each',  45,   'count',   'Trash and storage bags'),
  P('Trash bags, 30-gallon',          'per_each',  30,   'count',   'Trash and storage bags'),
  P('Zip-lock bags, gallon',          'per_each',  19,   'count',   'Trash and storage bags'),
  P('Zip-lock bags, quart',           'per_each',  24,   'count',   'Trash and storage bags'),
  P('Plastic wrap',                   'per_each', 200,   'sq_ft',   'Foil and wrap'),
  P('Aluminum foil',                  'per_each',  75,   'sq_ft',   'Foil and wrap'),
  P('Parchment paper',                'per_each',  45,   'sq_ft',   'Foil and wrap'),
  P('Dish soap, liquid',              'per_each',  22,   'fl_oz',   'Dish soap and detergent'),
  P('Dishwasher pods',                'per_each',  26,   'count',   'Dish soap and detergent'),
  P('Laundry detergent, liquid',      'per_each',  96,   'fl_oz',   'Laundry'),
  P('Laundry pods',                   'per_each',  42,   'count',   'Laundry'),
  P('Fabric softener',                'per_each',  48,   'fl_oz',   'Laundry'),
  P('Dryer sheets',                   'per_each', 105,   'count',   'Laundry'),
  P('All-purpose cleaner',            'per_each',  32,   'fl_oz',   'Cleaning supplies'),
  P('Disinfecting wipes',             'per_each',  75,   'count',   'Cleaning supplies'),
  P('Glass cleaner',                  'per_each',  23,   'fl_oz',   'Cleaning supplies'),
  P('Bathroom cleaner',               'per_each',  32,   'fl_oz',   'Cleaning supplies'),
  P('Dish sponges',                   'per_each',   3,   'count',   'Sponges and scrubbers'),

  // ══════════════════════════════════════════════════════════════════════════
  // PERSONAL CARE
  // ══════════════════════════════════════════════════════════════════════════
  P('Shampoo',                        'per_each',  12,   'fl_oz',   'Shampoo and conditioner'),
  P('Conditioner',                    'per_each',  12,   'fl_oz',   'Shampoo and conditioner'),
  P('2-in-1 shampoo and conditioner', 'per_each',  12,   'fl_oz',   'Shampoo and conditioner'),
  P('Body wash',                      'per_each',  18,   'fl_oz',   'Body wash and soap'),
  P('Bar soap',                       'per_each',   4,   'count',   'Body wash and soap'),
  P('Hand soap, liquid',              'per_each',  11.25,'fl_oz',   'Body wash and soap'),
  P('Toothpaste',                     'per_each',   4,   'oz',      'Oral care'),
  P('Toothbrush',                     'per_each',   2,   'count',   'Oral care'),
  P('Dental floss',                   'per_each',  40,   'count',   'Oral care'),
  P('Mouthwash',                      'per_each',  16.9, 'fl_oz',   'Oral care'),
  P('Deodorant, stick',               'per_each',   2.6, 'oz',      'Deodorant'),
  P('Lotion, body',                   'per_each',  13.5, 'fl_oz',   'Skin care'),
  P('Sunscreen SPF 50',               'per_each',   3,   'fl_oz',   'Skin care'),
  P('Lip balm',                       'per_each',   2,   'count',   'Skin care'),
  P('Shaving cream',                  'per_each',  11,   'oz',      'Shaving'),
  P('Razors, disposable',             'per_each',   5,   'count',   'Shaving'),

  // ══════════════════════════════════════════════════════════════════════════
  // BABY PRODUCTS
  // ══════════════════════════════════════════════════════════════════════════
  P('Diapers, size 1',                'per_each',  40,   'count',   'Diapers'),
  P('Diapers, size 2',                'per_each',  37,   'count',   'Diapers'),
  P('Diapers, size 3',                'per_each',  34,   'count',   'Diapers'),
  P('Diapers, size 4',                'per_each',  27,   'count',   'Diapers'),
  P('Baby wipes',                     'per_each', 216,   'count',   'Diapers'),
  P('Baby food pouches',              'per_each',   4,   'count',   'Baby food'),
  P('Baby food puree, jars',          'per_each',   4,   'count',   'Baby food'),
  P('Baby formula, powder',           'per_each',  12.5, 'oz',      'Baby formula'),

  // ══════════════════════════════════════════════════════════════════════════
  // PET SUPPLIES
  // ══════════════════════════════════════════════════════════════════════════
  P('Dry dog food',                   'per_each',  30,   'lb',      'Dog food'),
  P('Wet dog food, canned',           'per_each',  12,   'count',   'Dog food'),
  P('Dog treats',                     'per_each',  16,   'oz',      'Dog food'),
  P('Dry cat food',                   'per_each',  16,   'lb',      'Cat food'),
  P('Wet cat food, canned',           'per_each',  12,   'count',   'Cat food'),
  P('Cat treats',                     'per_each',   2.1, 'oz',      'Cat food'),
  P('Clumping cat litter',            'per_each',  28,   'lb',      'Cat litter'),
  P('Non-clumping cat litter',        'per_each',  30,   'lb',      'Cat litter'),
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
