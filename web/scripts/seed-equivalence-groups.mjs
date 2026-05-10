/**
 * Seed equivalence_groups + equivalence_group_members.
 *
 * Two kinds of groups:
 *   1. Size variants — same product, different pack size. equivalence_strength
 *      = 1.0 because the contents are identical; only the pack differs. The
 *      modal shows "1 lb pack — yours was 3.5 oz" so the user sees what
 *      they'd commit to.
 *   2. Reasonable substitutes — cross-brand or cross-style products that
 *      can stand in for each other when the user's exact match isn't priced
 *      nearby. equivalence_strength 0.70–0.95 reflects how close.
 *
 * For size-variant groups the partner canonical is often missing from the
 * catalog. We CREATE it here using a name that embeds the new pack size
 * (e.g., "Dark chocolate bar, 1 lb"). After this script:
 *   node web/scripts/generate-embeddings.mjs
 * to embed the new rows so the matcher can see them.
 *
 * Idempotent: equivalence_groups checked by name; equivalence_group_members
 * by (group_id, canonical_id) PK; new canonicals by name.
 *
 *   node web/scripts/seed-equivalence-groups.mjs
 */

import { createClient } from './seed-utils.mjs'

const c = createClient()
await c.connect()

let canonicalsAdded = 0
let groupsAdded = 0
let membersAdded = 0

// ── Helpers ──────────────────────────────────────────────────────────────

async function ensureCanonical({ name, package_size, package_unit, pricing_unit, category_name }) {
  const sel = await c.query(`SELECT canonical_id FROM canonical_products WHERE name = $1 LIMIT 1`, [name])
  if (sel.rows[0]) return sel.rows[0].canonical_id

  // Look up category_id from name; null is OK if not found.
  let category_id = null
  if (category_name) {
    const cat = await c.query(
      `SELECT category_id FROM product_categories WHERE name = $1 LIMIT 1`,
      [category_name],
    )
    category_id = cat.rows[0]?.category_id ?? null
  }
  const ins = await c.query(
    `INSERT INTO canonical_products
       (name, brand, is_store_brand, package_size, package_unit, pricing_unit, upc, category_id)
     VALUES ($1, NULL, FALSE, $2, $3, $4, NULL, $5)
     RETURNING canonical_id`,
    [name, package_size, package_unit, pricing_unit, category_id],
  )
  canonicalsAdded++
  console.log(`  + canonical ${ins.rows[0].canonical_id}: ${name}`)
  return ins.rows[0].canonical_id
}

async function findCanonical(name) {
  const r = await c.query(`SELECT canonical_id FROM canonical_products WHERE name = $1 LIMIT 1`, [name])
  return r.rows[0]?.canonical_id ?? null
}

async function ensureGroup({ name, description }) {
  const sel = await c.query(`SELECT group_id FROM equivalence_groups WHERE name = $1 LIMIT 1`, [name])
  if (sel.rows[0]) return sel.rows[0].group_id
  const ins = await c.query(
    `INSERT INTO equivalence_groups (name, description) VALUES ($1, $2) RETURNING group_id`,
    [name, description ?? null],
  )
  groupsAdded++
  console.log(`✓ group ${ins.rows[0].group_id}: ${name}`)
  return ins.rows[0].group_id
}

async function ensureMember(group_id, canonical_id, strength) {
  if (canonical_id == null) return
  const ins = await c.query(
    `INSERT INTO equivalence_group_members (group_id, canonical_id, equivalence_strength)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id, canonical_id) DO NOTHING
     RETURNING canonical_id`,
    [group_id, canonical_id, strength],
  )
  if (ins.rowCount > 0) membersAdded++
}

// ── 1. Size-variant groups (strength 1.0) ─────────────────────────────────
// For each, ensure both canonicals exist (creating the larger/smaller pack
// when missing), then bind into a strength-1.0 group.

console.log('\n── Size-variant groups (strength 1.0) ────────────────')

// Dark chocolate bar: existing 3.5 oz (id 92) + new 1 lb pack
{
  const small = await findCanonical('Dark chocolate bar')
  const large = await ensureCanonical({
    name: 'Dark chocolate bar, 1 lb',
    package_size: 1,
    package_unit: 'lb',
    pricing_unit: 'per_each',
    category_name: 'Chocolate',
  })
  const g = await ensureGroup({
    name: 'Dark chocolate bar (size variants)',
    description: 'Same dark chocolate bar in different pack sizes.',
  })
  await ensureMember(g, small, 1.0)
  await ensureMember(g, large, 1.0)
}

// Whole milk: existing 128 fl_oz / 1 gal (id 1) + new ½ gal (64 fl_oz)
{
  const gal = await findCanonical('Whole milk')
  const halfGal = await ensureCanonical({
    name: 'Whole milk, half gallon',
    package_size: 64,
    package_unit: 'fl_oz',
    pricing_unit: 'per_each',
    category_name: 'Milk',
  })
  const g = await ensureGroup({
    name: 'Whole milk (size variants)',
    description: 'Same whole milk in different pack sizes.',
  })
  await ensureMember(g, gal, 1.0)
  await ensureMember(g, halfGal, 1.0)
}

// Large eggs: existing 12 count (id 2) + new 18 count
{
  const dozen = await findCanonical('Eggs, large')
  const eighteen = await ensureCanonical({
    name: 'Eggs, large, 18 count',
    package_size: 18,
    package_unit: 'count',
    pricing_unit: 'per_each',
    category_name: 'Eggs',
  })
  const g = await ensureGroup({
    name: 'Large eggs (size variants)',
    description: 'Same large eggs in different pack sizes.',
  })
  await ensureMember(g, dozen, 1.0)
  await ensureMember(g, eighteen, 1.0)
}

// Olive oil: existing 16 fl_oz (id 9) + new 32 fl_oz
{
  const small = await findCanonical('Olive oil')
  const large = await ensureCanonical({
    name: 'Olive oil, 32 fl oz',
    package_size: 32,
    package_unit: 'fl_oz',
    pricing_unit: 'per_each',
    category_name: 'Olive oil',
  })
  const g = await ensureGroup({
    name: 'Olive oil (size variants)',
    description: 'Same olive oil in different pack sizes.',
  })
  await ensureMember(g, small, 1.0)
  await ensureMember(g, large, 1.0)
}

// ── 2. Reasonable-substitute groups (strength 0.70–0.95) ──────────────────

console.log('\n── Reasonable substitutes (strength 0.70–0.95) ───────')

// Plant-based milks
{
  const almond = await findCanonical('Almond milk, unsweetened')
  const oat = await findCanonical('Oat milk')
  const g = await ensureGroup({
    name: 'Plant-based milk substitutes',
    description: 'Almond and oat milk are common substitutes for each other in cooking and cereal use.',
  })
  await ensureMember(g, almond, 0.80)
  await ensureMember(g, oat, 0.80)
}

// White rice ↔ jasmine rice
{
  const white = await findCanonical('White rice')
  const jasmine = await findCanonical('Jasmine rice')
  const g = await ensureGroup({
    name: 'Long-grain rice substitutes',
    description: 'White rice and jasmine rice are interchangeable for most uses.',
  })
  await ensureMember(g, white, 0.85)
  await ensureMember(g, jasmine, 0.85)
}

// Large eggs across brand variants (different from size variants above)
{
  const plain = await findCanonical('Eggs, large')
  const brown = await findCanonical('Brown eggs, large')
  const organic = await findCanonical('Organic eggs, large')
  const freeRange = await findCanonical('Free-range eggs')
  const g = await ensureGroup({
    name: 'Large eggs (brand/style substitutes)',
    description: 'Plain, brown, organic, and free-range large eggs differ in production method but are nutritionally similar.',
  })
  await ensureMember(g, plain, 0.90)
  await ensureMember(g, brown, 0.90)
  await ensureMember(g, organic, 0.90)
  await ensureMember(g, freeRange, 0.90)
}

// Pasta sauce variants
{
  const plain = await findCanonical('Pasta sauce')
  const vodka = await findCanonical('Vodka pasta sauce')
  const g = await ensureGroup({
    name: 'Pasta sauce substitutes',
    description: 'Tomato-based pasta sauces, different styles.',
  })
  await ensureMember(g, plain, 0.85)
  await ensureMember(g, vodka, 0.80)
}

await c.end()

console.log('\nSummary:')
console.log(`  New canonicals:            ${canonicalsAdded}`)
console.log(`  New equivalence groups:    ${groupsAdded}`)
console.log(`  New group members:         ${membersAdded}`)
if (canonicalsAdded > 0) {
  console.log(`\nNext: node web/scripts/generate-embeddings.mjs   # embed the new canonicals`)
}
