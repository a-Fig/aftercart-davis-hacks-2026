-- ============================================================
-- Phase 3: Canonical products
-- Generated: 2026-04-26T22:01:32.256Z
-- 47 products, description_embedding omitted (generate-embeddings.mjs)
-- ============================================================

INSERT INTO canonical_products
  (name, brand, is_store_brand, package_size, package_unit, pricing_unit, upc, category_id)
VALUES
  ('Whole milk', NULL, FALSE, 128, 'fl_oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Milk')),
  ('Eggs, large', NULL, FALSE, 12, 'count', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Eggs')),
  ('Chicken thighs, bone-in', NULL, FALSE, NULL, 'lb', 'per_lb', NULL, (SELECT category_id FROM product_categories WHERE name='Chicken, raw')),
  ('Boneless chicken breast', NULL, FALSE, NULL, 'lb', 'per_lb', NULL, (SELECT category_id FROM product_categories WHERE name='Chicken, raw')),
  ('Ground beef, 80/20', NULL, FALSE, NULL, 'lb', 'per_lb', NULL, (SELECT category_id FROM product_categories WHERE name='Ground beef, raw')),
  ('White rice', NULL, FALSE, 80, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Rice')),
  ('Dried pinto beans', NULL, FALSE, 16, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Dried beans')),
  ('White bread', NULL, FALSE, 1, 'loaf', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Bread')),
  ('Olive oil', NULL, FALSE, 16, 'fl_oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Olive oil')),
  ('Vegetable oil', NULL, FALSE, 48, 'fl_oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Vegetable oil')),
  ('Butter, salted', NULL, FALSE, 16, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Butter')),
  ('Cheddar cheese', NULL, FALSE, 8, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Cheese')),
  ('Orange juice', NULL, FALSE, 64, 'fl_oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Orange juice')),
  ('Bananas', NULL, FALSE, NULL, 'lb', 'per_lb', NULL, (SELECT category_id FROM product_categories WHERE name='Bananas')),
  ('Apples, Gala', NULL, FALSE, NULL, 'lb', 'per_lb', NULL, (SELECT category_id FROM product_categories WHERE name='Apples')),
  ('Russet potatoes', NULL, FALSE, 80, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Potatoes')),
  ('Yellow onions', NULL, FALSE, 48, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Onions')),
  ('Baby carrots', NULL, FALSE, 16, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Carrots')),
  ('Broccoli', NULL, FALSE, NULL, 'lb', 'per_lb', NULL, (SELECT category_id FROM product_categories WHERE name='Broccoli')),
  ('Spinach', NULL, FALSE, 5, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Spinach')),
  ('Diced tomatoes, canned', NULL, FALSE, 14.5, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Canned tomatoes')),
  ('Black beans, canned', NULL, FALSE, 15, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Canned beans')),
  ('Spaghetti', NULL, FALSE, 16, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Pasta')),
  ('Pasta sauce', NULL, FALSE, 24, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Pasta sauce')),
  ('Corn flakes cereal', NULL, FALSE, 18, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Breakfast cereal')),
  ('Rolled oats', NULL, FALSE, 42, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Oats')),
  ('Peanut butter', NULL, FALSE, 16, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Peanut butter')),
  ('Strawberry jelly', NULL, FALSE, 18, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Jelly and jam')),
  ('White sugar', NULL, FALSE, 64, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Sugar')),
  ('All-purpose flour', NULL, FALSE, 80, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Flour')),
  ('Ground coffee', NULL, FALSE, 11, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Coffee')),
  ('Flour tortillas', NULL, FALSE, 10, 'count', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Tortillas')),
  ('Shredded mozzarella', NULL, FALSE, 8, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Cheese')),
  ('Greek yogurt', NULL, FALSE, 32, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Yogurt')),
  ('Sour cream', NULL, FALSE, 16, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Sour cream')),
  ('Cream cheese', NULL, FALSE, 8, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Cream cheese')),
  ('Frozen peas', NULL, FALSE, 12, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Frozen peas')),
  ('Frozen corn', NULL, FALSE, 12, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Frozen corn')),
  ('Canned tuna', NULL, FALSE, 5, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Canned tuna')),
  ('Mayonnaise', NULL, FALSE, 30, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Mayonnaise')),
  ('Ketchup', NULL, FALSE, 32, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Ketchup')),
  ('Yellow mustard', NULL, FALSE, 20, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Mustard')),
  ('Chicken broth', NULL, FALSE, 32, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Broth')),
  ('Vegetable broth', NULL, FALSE, 32, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Broth')),
  ('Instant ramen', NULL, FALSE, 3, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Ramen noodles')),
  ('Chicken noodle soup, canned', NULL, FALSE, 10.75, 'oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Canned soup')),
  ('Apple juice', NULL, FALSE, 64, 'fl_oz', 'per_each', NULL, (SELECT category_id FROM product_categories WHERE name='Apple juice'))
ON CONFLICT DO NOTHING;
