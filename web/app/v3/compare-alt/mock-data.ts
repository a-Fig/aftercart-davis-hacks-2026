/**
 * Shared mock CompareResponse + MatchResponse for the compare-page design
 * sandbox. Drives /v3/compare-alt/{current,a,b,c,d,e,f,g}.
 *
 * Realistic 9-item Safeway receipt with three nearby chains. Each item has
 * MULTIPLE alternatives at each chain — a real grocery shelf, not just the
 * single cheapest substitute. Some chains genuinely don't stock a product
 * (Costco doesn't carry 8 oz cheddar or 24 oz sourdough); those cases are
 * present as omissions so the "not stocked" state is testable.
 */

import type {
  ApiAlternative,
  ApiItem,
  CompareResponse,
  MatchResponse,
} from '@/lib/api/compare';

// ── Chain registry ──────────────────────────────────────────────────────────

const SAFEWAY = { chain_id: 1, chain_name: 'Safeway', store_id: 100, address: '1450 Veterans Blvd, Redwood City', distance_miles: 0.2 };
const GROCERY_OUTLET = { chain_id: 2, chain_name: 'Grocery Outlet', store_id: 200, address: '2580 El Camino Real, Redwood City', distance_miles: 0.8 };
const TRADER_JOES = { chain_id: 3, chain_name: "Trader Joe's", store_id: 300, address: '180 El Camino Real, Menlo Park', distance_miles: 1.2 };
const COSTCO = { chain_id: 4, chain_name: 'Costco', store_id: 400, address: '1600 El Camino Real, Redwood City', distance_miles: 3.4 };

interface ChainSpec { chain_id: number; chain_name: string; store_id: number; address: string; distance_miles: number }

interface AltSpec {
  canonical_id: number;
  user_canonical_id: number;
  weighted_price: number;
  chain: ChainSpec;
  display_name: string;
  price_unit?: string;
  freshness?: 'green' | 'yellow' | 'red';
  observations?: number;
  match_type?: 'exact' | 'equivalent';
  equivalence_strength?: number;
  equiv_name?: string | null;
  equiv_pack_size?: number | null;
  equiv_pack_unit?: string | null;
  pricing_tier?: 'shelf' | 'member';
  most_recent?: string;
}

function mkAlt(spec: AltSpec): ApiAlternative {
  return {
    user_canonical_id: spec.user_canonical_id,
    canonical_id: spec.canonical_id,
    weighted_price: spec.weighted_price,
    price_unit: spec.price_unit ?? 'per_each',
    pricing_tier: spec.pricing_tier ?? 'shelf',
    observation_count: spec.observations ?? 8,
    most_recent_observation: spec.most_recent ?? '2026-05-01T12:00:00Z',
    freshness: spec.freshness ?? 'green',
    store_id: spec.chain.store_id,
    address: spec.chain.address,
    distance_miles: spec.chain.distance_miles,
    chain_id: spec.chain.chain_id,
    chain_name: spec.chain.chain_name,
    display_name: spec.display_name,
    match_type: spec.match_type ?? 'equivalent',
    equivalence_strength: spec.equivalence_strength ?? 0.85,
    equiv_name: spec.equiv_name ?? null,
    equiv_pack_size: spec.equiv_pack_size ?? null,
    equiv_pack_unit: spec.equiv_pack_unit ?? null,
  };
}

// ── Items ───────────────────────────────────────────────────────────────────

const items: ApiItem[] = [
  // 1 — Chicken Thighs (per_lb) — many brands available everywhere
  {
    raw_text: 'SAFWY BFLS CKNG THGH 2.13LB',
    description: 'boneless skinless chicken thighs 2.13 lb',
    code: '202113',
    quantity: 2.13,
    unit: 'lb',
    unit_price: 3.47,
    shelf_price: 7.39,
    member_price: 7.39,
    is_store_brand: true,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Boneless Skinless Chicken Thighs',
    user_pack_size: null,
    user_pack_unit: null,
    match: { canonical_id: 17, name: 'Boneless Skinless Chicken Thighs', brand: 'Safeway Brand', package_size: null, package_unit: null, pricing_unit: 'per_lb', score: 0.97 },
    alternatives: [
      // Grocery Outlet — 3 brand options
      mkAlt({ canonical_id: 1701, user_canonical_id: 17, weighted_price: 2.00, price_unit: 'per_lb', chain: GROCERY_OUTLET, display_name: 'Foster Farms BFLS Chicken Thighs', equiv_name: 'Different brand', observations: 8, freshness: 'green', equivalence_strength: 0.94 }),
      mkAlt({ canonical_id: 1702, user_canonical_id: 17, weighted_price: 2.49, price_unit: 'per_lb', chain: GROCERY_OUTLET, display_name: 'Foothills BFLS Chicken Thighs', equiv_name: 'Local brand', observations: 4, freshness: 'yellow', equivalence_strength: 0.88 }),
      mkAlt({ canonical_id: 1703, user_canonical_id: 17, weighted_price: 2.79, price_unit: 'per_lb', chain: GROCERY_OUTLET, display_name: 'Smart Chicken Organic BFLS Thighs', equiv_name: 'Organic, different brand', observations: 5, freshness: 'green', equivalence_strength: 0.90 }),
      // Trader Joe's — 2 options
      mkAlt({ canonical_id: 1704, user_canonical_id: 17, weighted_price: 2.80, price_unit: 'per_lb', chain: TRADER_JOES, display_name: "Trader Joe's Air-Chilled Chicken Thighs", equiv_name: 'Air-chilled, different process', observations: 9, freshness: 'green', equivalence_strength: 0.88 }),
      mkAlt({ canonical_id: 1705, user_canonical_id: 17, weighted_price: 4.99, price_unit: 'per_lb', chain: TRADER_JOES, display_name: "Trader Joe's Organic BFLS Thighs", equiv_name: 'Organic, store brand', observations: 6, freshness: 'green', equivalence_strength: 0.90 }),
      // Costco — 2 options, both bulk pack
      mkAlt({ canonical_id: 1706, user_canonical_id: 17, weighted_price: 2.49, price_unit: 'per_lb', chain: COSTCO, display_name: 'Kirkland Signature BFLS Chicken Thighs', equiv_name: 'Bulk 5 lb pack required', equiv_pack_size: 5, equiv_pack_unit: 'lb', observations: 12, freshness: 'green', equivalence_strength: 0.95 }),
      mkAlt({ canonical_id: 1707, user_canonical_id: 17, weighted_price: 2.39, price_unit: 'per_lb', chain: COSTCO, display_name: 'Foster Farms BFLS Thighs (4 lb pack)', equiv_name: 'Bulk pack, different brand', equiv_pack_size: 4, equiv_pack_unit: 'lb', observations: 7, freshness: 'green', equivalence_strength: 0.92 }),
    ],
    enrichment: null,
    informational_only: false,
  },

  // 2 — Ground Beef 80/20 (per_each, 1 lb)
  {
    raw_text: 'GRND BEEF 80/20 1LB',
    description: 'ground beef 80/20 1 lb',
    code: '202055',
    quantity: 1,
    unit: 'each',
    unit_price: null,
    shelf_price: 6.49,
    member_price: 6.49,
    is_store_brand: true,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Ground Beef 80/20',
    user_pack_size: 1,
    user_pack_unit: 'lb',
    match: { canonical_id: 18, name: 'Ground Beef 80/20', brand: 'Safeway Brand', package_size: 1, package_unit: 'lb', pricing_unit: 'per_each', score: 0.99 },
    alternatives: [
      // GO — 3 options
      mkAlt({ canonical_id: 1801, user_canonical_id: 18, weighted_price: 5.16, chain: GROCERY_OUTLET, display_name: 'Foster Farms Ground Beef 80/20, 1 lb', equiv_pack_size: 1, equiv_pack_unit: 'lb', equiv_name: 'Different brand', observations: 11, freshness: 'green', equivalence_strength: 0.95 }),
      mkAlt({ canonical_id: 1802, user_canonical_id: 18, weighted_price: 7.99, chain: GROCERY_OUTLET, display_name: 'Open Nature Grass-Fed 80/20, 1 lb', equiv_pack_size: 1, equiv_pack_unit: 'lb', equiv_name: 'Grass-fed, premium', observations: 4, freshness: 'green', equivalence_strength: 0.88 }),
      mkAlt({ canonical_id: 1803, user_canonical_id: 18, weighted_price: 9.49, chain: GROCERY_OUTLET, display_name: 'Bulk 80/20, 2 lb pack', equiv_pack_size: 2, equiv_pack_unit: 'lb', equiv_name: 'Larger pack', observations: 6, freshness: 'yellow', equivalence_strength: 0.96 }),
      // TJ — 2 options
      mkAlt({ canonical_id: 1804, user_canonical_id: 18, weighted_price: 5.99, chain: TRADER_JOES, display_name: "Trader Joe's Ground Beef 80/20, 1 lb", equiv_pack_size: 1, equiv_pack_unit: 'lb', equiv_name: 'Store brand', observations: 9, freshness: 'green', equivalence_strength: 0.94 }),
      mkAlt({ canonical_id: 1805, user_canonical_id: 18, weighted_price: 7.99, chain: TRADER_JOES, display_name: "Trader Joe's Organic 80/20, 1 lb", equiv_pack_size: 1, equiv_pack_unit: 'lb', equiv_name: 'Organic version', observations: 5, freshness: 'green', equivalence_strength: 0.88 }),
      // Costco — 2 bulk options
      mkAlt({ canonical_id: 1806, user_canonical_id: 18, weighted_price: 17.96, chain: COSTCO, display_name: 'Kirkland Ground Beef 80/20, 4 lb', equiv_pack_size: 4, equiv_pack_unit: 'lb', equiv_name: 'Bulk 4 lb pack', observations: 7, freshness: 'green', equivalence_strength: 0.95 }),
      mkAlt({ canonical_id: 1807, user_canonical_id: 18, weighted_price: 19.99, chain: COSTCO, display_name: 'Kirkland Organic 80/20, 3 lb', equiv_pack_size: 3, equiv_pack_unit: 'lb', equiv_name: 'Organic, bulk', observations: 5, freshness: 'green', equivalence_strength: 0.86 }),
    ],
    enrichment: null,
    informational_only: false,
  },

  // 3 — Whole Milk (per_each, 1 gal)
  {
    raw_text: 'LUCERNE WHL MLK 1G',
    description: 'whole milk 1 gallon',
    code: '041190001234',
    quantity: 1,
    unit: 'each',
    unit_price: null,
    shelf_price: 5.29,
    member_price: 5.29,
    is_store_brand: true,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Lucerne Whole Milk, 1 gal',
    user_pack_size: 1,
    user_pack_unit: 'gal',
    match: { canonical_id: 12, name: 'Whole Milk', brand: 'Lucerne', package_size: 1, package_unit: 'gal', pricing_unit: 'per_each', score: 0.99 },
    alternatives: [
      // GO — 3 options including a smaller-size one
      mkAlt({ canonical_id: 1201, user_canonical_id: 12, weighted_price: 4.99, chain: GROCERY_OUTLET, display_name: 'Alta Dena Whole Milk, 1 gal', equiv_pack_size: 1, equiv_pack_unit: 'gal', equiv_name: 'Different brand', observations: 6, freshness: 'yellow', equivalence_strength: 0.95 }),
      mkAlt({ canonical_id: 1202, user_canonical_id: 12, weighted_price: 2.79, chain: GROCERY_OUTLET, display_name: 'Lucerne Whole Milk, 0.5 gal', equiv_pack_size: 0.5, equiv_pack_unit: 'gal', equiv_name: 'Same brand, half size', observations: 8, freshness: 'green', equivalence_strength: 1.0 }),
      mkAlt({ canonical_id: 1203, user_canonical_id: 12, weighted_price: 6.49, chain: GROCERY_OUTLET, display_name: 'Organic Valley Whole Milk, 1 gal', equiv_pack_size: 1, equiv_pack_unit: 'gal', equiv_name: 'Organic version', observations: 5, freshness: 'green', equivalence_strength: 0.85 }),
      // TJ — 2 options
      mkAlt({ canonical_id: 1204, user_canonical_id: 12, weighted_price: 3.99, chain: TRADER_JOES, display_name: "Trader Joe's Whole Milk, 1 gal", equiv_pack_size: 1, equiv_pack_unit: 'gal', equiv_name: 'Store brand', observations: 17, freshness: 'green', equivalence_strength: 0.95 }),
      mkAlt({ canonical_id: 1205, user_canonical_id: 12, weighted_price: 4.99, chain: TRADER_JOES, display_name: "Trader Joe's Organic Whole Milk, 1 gal", equiv_pack_size: 1, equiv_pack_unit: 'gal', equiv_name: 'Organic, store brand', observations: 9, freshness: 'green', equivalence_strength: 0.88 }),
      // Costco — bulk pack only
      mkAlt({ canonical_id: 1206, user_canonical_id: 12, weighted_price: 5.99, chain: COSTCO, display_name: 'Kirkland Whole Milk, 2-pack of 1 gal', equiv_pack_size: 2, equiv_pack_unit: 'gal', equiv_name: 'Bulk 2-pack only', observations: 11, freshness: 'green', equivalence_strength: 0.95 }),
      mkAlt({ canonical_id: 1207, user_canonical_id: 12, weighted_price: 7.49, chain: COSTCO, display_name: 'Horizon Organic Whole Milk, 1 gal', equiv_pack_size: 1, equiv_pack_unit: 'gal', equiv_name: 'Organic, different brand', observations: 6, freshness: 'green', equivalence_strength: 0.85 }),
    ],
    enrichment: null,
    informational_only: false,
  },

  // 4 — Greek Yogurt 32 oz Chobani — Costco doesn't stock 32 oz
  {
    raw_text: 'CHOBANI PLAIN GRK 32OZ',
    description: 'greek yogurt plain 32 oz',
    code: '894700010014',
    quantity: 1,
    unit: 'each',
    unit_price: null,
    shelf_price: 4.99,
    member_price: 4.99,
    is_store_brand: false,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Chobani Plain Greek Yogurt, 32 oz',
    user_pack_size: 32,
    user_pack_unit: 'oz',
    match: { canonical_id: 53, name: 'Greek Yogurt, Plain', brand: 'Chobani', package_size: 32, package_unit: 'oz', pricing_unit: 'per_each', score: 0.95 },
    alternatives: [
      // GO — 3 options
      mkAlt({ canonical_id: 5301, user_canonical_id: 53, weighted_price: 3.49, chain: GROCERY_OUTLET, display_name: 'Fage Total 0% Greek Yogurt, 32 oz', equiv_pack_size: 32, equiv_pack_unit: 'oz', equiv_name: 'Different brand, nonfat', observations: 4, freshness: 'yellow', equivalence_strength: 0.82 }),
      mkAlt({ canonical_id: 5302, user_canonical_id: 53, weighted_price: 4.49, chain: GROCERY_OUTLET, display_name: 'Stonyfield Whole Milk Greek, 32 oz', equiv_pack_size: 32, equiv_pack_unit: 'oz', equiv_name: 'Different brand, organic', observations: 3, freshness: 'green', equivalence_strength: 0.88 }),
      mkAlt({ canonical_id: 5303, user_canonical_id: 53, weighted_price: 2.99, chain: GROCERY_OUTLET, display_name: 'Crystal Farms Greek Plain, 24 oz', equiv_pack_size: 24, equiv_pack_unit: 'oz', equiv_name: 'Smaller size, different brand', observations: 5, freshness: 'green', equivalence_strength: 0.78 }),
      // TJ — 2 options
      mkAlt({ canonical_id: 5304, user_canonical_id: 53, weighted_price: 3.99, chain: TRADER_JOES, display_name: "Trader Joe's Plain Greek Yogurt, 32 oz", equiv_pack_size: 32, equiv_pack_unit: 'oz', equiv_name: 'Store brand', observations: 13, freshness: 'green', equivalence_strength: 0.90 }),
      mkAlt({ canonical_id: 5305, user_canonical_id: 53, weighted_price: 4.99, chain: TRADER_JOES, display_name: "Trader Joe's Organic Greek Yogurt, 32 oz", equiv_pack_size: 32, equiv_pack_unit: 'oz', equiv_name: 'Organic, store brand', observations: 7, freshness: 'green', equivalence_strength: 0.87 }),
      // Costco — only 64 oz available; we surface this so user knows the size mismatch
      mkAlt({ canonical_id: 5306, user_canonical_id: 53, weighted_price: 7.99, chain: COSTCO, display_name: 'Kirkland Plain Greek Yogurt, 64 oz', equiv_pack_size: 64, equiv_pack_unit: 'oz', equiv_name: 'Only 64 oz tub at Costco', observations: 9, freshness: 'green', equivalence_strength: 0.80 }),
    ],
    enrichment: null,
    informational_only: false,
  },

  // 5 — Sharp Cheddar 8 oz Tillamook — rare exact-brand match at GO
  {
    raw_text: 'TILLAMOOK SHARP CHED 8OZ',
    description: 'sharp cheddar cheese 8 oz',
    code: '021000061121',
    quantity: 1,
    unit: 'each',
    unit_price: null,
    shelf_price: 3.79,
    member_price: 3.79,
    is_store_brand: false,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Tillamook Sharp Cheddar, 8 oz',
    user_pack_size: 8,
    user_pack_unit: 'oz',
    match: { canonical_id: 64, name: 'Sharp Cheddar', brand: 'Tillamook', package_size: 8, package_unit: 'oz', pricing_unit: 'per_each', score: 0.98 },
    alternatives: [
      // GO — 3 options including SAME BRAND match (rare wins!)
      mkAlt({ canonical_id: 6401, user_canonical_id: 64, weighted_price: 3.49, chain: GROCERY_OUTLET, display_name: 'Tillamook Sharp Cheddar, 8 oz', equiv_pack_size: 8, equiv_pack_unit: 'oz', equiv_name: 'Same brand!', observations: 8, freshness: 'green', match_type: 'exact', equivalence_strength: 1.0 }),
      mkAlt({ canonical_id: 6402, user_canonical_id: 64, weighted_price: 2.99, chain: GROCERY_OUTLET, display_name: 'Crystal Farms Sharp Cheddar, 8 oz', equiv_pack_size: 8, equiv_pack_unit: 'oz', equiv_name: 'Different brand', observations: 7, freshness: 'green', equivalence_strength: 0.78 }),
      mkAlt({ canonical_id: 6403, user_canonical_id: 64, weighted_price: 3.79, chain: GROCERY_OUTLET, display_name: 'Cabot Sharp Cheddar, 8 oz', equiv_pack_size: 8, equiv_pack_unit: 'oz', equiv_name: 'Different brand, same price', observations: 6, freshness: 'green', equivalence_strength: 0.85 }),
      // TJ — 2 options, neither is Tillamook
      mkAlt({ canonical_id: 6404, user_canonical_id: 64, weighted_price: 2.79, chain: TRADER_JOES, display_name: "Trader Joe's Sharp Cheddar, 8 oz", equiv_pack_size: 8, equiv_pack_unit: 'oz', equiv_name: 'Store brand', observations: 14, freshness: 'green', equivalence_strength: 0.85 }),
      mkAlt({ canonical_id: 6405, user_canonical_id: 64, weighted_price: 3.99, chain: TRADER_JOES, display_name: "Trader Joe's Aged Cheddar, 7 oz", equiv_pack_size: 7, equiv_pack_unit: 'oz', equiv_name: 'Aged variant, slightly smaller', observations: 8, freshness: 'green', equivalence_strength: 0.78 }),
      // Costco — bulk only, same brand
      mkAlt({ canonical_id: 6406, user_canonical_id: 64, weighted_price: 9.99, chain: COSTCO, display_name: 'Tillamook Sharp Cheddar, 32 oz block', equiv_pack_size: 32, equiv_pack_unit: 'oz', equiv_name: 'Same brand, 4× pack', observations: 10, freshness: 'green', match_type: 'equivalent', equivalence_strength: 0.94 }),
    ],
    enrichment: null,
    informational_only: false,
  },

  // 6 — Broccoli Crowns (per_lb)
  {
    raw_text: 'BROCCOLI CRN 1.20LB',
    description: 'broccoli crowns 1.2 lb',
    code: '4060',
    quantity: 1.2,
    unit: 'lb',
    unit_price: 2.41,
    shelf_price: 2.89,
    member_price: 2.89,
    is_store_brand: false,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Broccoli Crowns',
    user_pack_size: null,
    user_pack_unit: null,
    match: { canonical_id: 91, name: 'Broccoli Crowns', brand: null, package_size: null, package_unit: null, pricing_unit: 'per_lb', score: 0.99 },
    alternatives: [
      mkAlt({ canonical_id: 9101, user_canonical_id: 91, weighted_price: 1.49, price_unit: 'per_lb', chain: GROCERY_OUTLET, display_name: 'Broccoli Crowns (by weight)', equiv_name: 'Loose by weight', match_type: 'exact', observations: 6, freshness: 'green', equivalence_strength: 1.0 }),
      mkAlt({ canonical_id: 9102, user_canonical_id: 91, weighted_price: 2.49, price_unit: 'per_lb', chain: GROCERY_OUTLET, display_name: 'Organic Broccoli Crowns', equiv_name: 'Organic version', observations: 4, freshness: 'green', equivalence_strength: 0.90 }),
      mkAlt({ canonical_id: 9103, user_canonical_id: 91, weighted_price: 1.66, price_unit: 'per_lb', chain: TRADER_JOES, display_name: 'Broccoli Crowns (by weight)', equiv_name: 'Loose by weight', match_type: 'exact', observations: 3, freshness: 'yellow', equivalence_strength: 1.0 }),
      mkAlt({ canonical_id: 9104, user_canonical_id: 91, weighted_price: 2.99, chain: TRADER_JOES, display_name: 'Broccoli Florets, 12 oz bag', equiv_pack_size: 12, equiv_pack_unit: 'oz', equiv_name: 'Pre-cut florets, bagged', observations: 7, freshness: 'green', equivalence_strength: 0.80 }),
      mkAlt({ canonical_id: 9105, user_canonical_id: 91, weighted_price: 4.99, chain: COSTCO, display_name: 'Kirkland Broccoli Florets, 4 lb bag', equiv_pack_size: 4, equiv_pack_unit: 'lb', equiv_name: 'Bagged florets, large pack', observations: 8, freshness: 'green', equivalence_strength: 0.78 }),
    ],
    enrichment: null,
    informational_only: false,
  },

  // 7 — Bananas (per_lb)
  {
    raw_text: 'BANANAS 2.10LB',
    description: 'bananas 2.10 lb',
    code: '4011',
    quantity: 2.1,
    unit: 'lb',
    unit_price: 0.70,
    shelf_price: 1.47,
    member_price: 1.47,
    is_store_brand: false,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Bananas',
    user_pack_size: null,
    user_pack_unit: null,
    match: { canonical_id: 42, name: 'Bananas', brand: null, package_size: null, package_unit: null, pricing_unit: 'per_lb', score: 0.99 },
    alternatives: [
      mkAlt({ canonical_id: 4201, user_canonical_id: 42, weighted_price: 0.47, price_unit: 'per_lb', chain: GROCERY_OUTLET, display_name: 'Bananas (by weight)', equiv_name: 'Conventional', match_type: 'exact', observations: 5, freshness: 'yellow', equivalence_strength: 1.0 }),
      mkAlt({ canonical_id: 4202, user_canonical_id: 42, weighted_price: 0.79, price_unit: 'per_lb', chain: GROCERY_OUTLET, display_name: 'Organic Bananas', equiv_name: 'Organic version', observations: 3, freshness: 'green', equivalence_strength: 0.92 }),
      mkAlt({ canonical_id: 4203, user_canonical_id: 42, weighted_price: 0.47, price_unit: 'per_lb', chain: TRADER_JOES, display_name: 'Bananas (sold per banana, $0.19/each)', equiv_name: 'Priced per-banana, not per-lb', match_type: 'exact', observations: 18, freshness: 'green', equivalence_strength: 1.0 }),
      mkAlt({ canonical_id: 4204, user_canonical_id: 42, weighted_price: 0.79, price_unit: 'per_lb', chain: TRADER_JOES, display_name: 'Organic Bananas', equiv_name: 'Organic, per-banana pricing', observations: 9, freshness: 'green', equivalence_strength: 0.92 }),
      mkAlt({ canonical_id: 4205, user_canonical_id: 42, weighted_price: 0.55, price_unit: 'per_lb', chain: COSTCO, display_name: 'Kirkland Banana Bunch (3 lb min)', equiv_pack_size: 3, equiv_pack_unit: 'lb', equiv_name: 'Bunch only, 3 lb min', observations: 8, freshness: 'green', equivalence_strength: 0.92 }),
    ],
    enrichment: null,
    informational_only: false,
  },

  // 8 — Sourdough Loaf 24 oz Boudin — Costco doesn't stock anything similar
  {
    raw_text: 'BOUDIN SOURDOUGH 24OZ',
    description: 'sourdough loaf 24 oz',
    code: null,
    quantity: 1,
    unit: 'each',
    unit_price: null,
    shelf_price: 4.99,
    member_price: 4.99,
    is_store_brand: false,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Boudin Sourdough Loaf, 24 oz',
    user_pack_size: 24,
    user_pack_unit: 'oz',
    match: { canonical_id: 73, name: 'Sourdough Loaf', brand: 'Boudin', package_size: 24, package_unit: 'oz', pricing_unit: 'per_each', score: 0.91 },
    alternatives: [
      mkAlt({ canonical_id: 7301, user_canonical_id: 73, weighted_price: 3.99, chain: GROCERY_OUTLET, display_name: 'Stonemill Sourdough, 24 oz (sliced)', equiv_pack_size: 24, equiv_pack_unit: 'oz', equiv_name: 'Sliced loaf, not round', observations: 2, freshness: 'red', equivalence_strength: 0.75, most_recent: '2026-04-02T12:00:00Z' }),
      mkAlt({ canonical_id: 7302, user_canonical_id: 73, weighted_price: 4.49, chain: GROCERY_OUTLET, display_name: 'La Brea Sourdough, 16 oz round', equiv_pack_size: 16, equiv_pack_unit: 'oz', equiv_name: 'Round but smaller', observations: 4, freshness: 'green', equivalence_strength: 0.85 }),
      mkAlt({ canonical_id: 7303, user_canonical_id: 73, weighted_price: 3.49, chain: TRADER_JOES, display_name: "Trader Joe's SF-Style Sourdough, 20 oz", equiv_pack_size: 20, equiv_pack_unit: 'oz', equiv_name: 'Round, slightly smaller', observations: 11, freshness: 'green', equivalence_strength: 0.88 }),
      mkAlt({ canonical_id: 7304, user_canonical_id: 73, weighted_price: 4.99, chain: TRADER_JOES, display_name: "Trader Joe's Sourdough Bites, 20 oz", equiv_pack_size: 20, equiv_pack_unit: 'oz', equiv_name: 'Bites, not loaf', observations: 6, freshness: 'green', equivalence_strength: 0.65 }),
      // No Costco entry — sourdough loaf simply not stocked
    ],
    enrichment: null,
    informational_only: false,
  },

  // 9 — Centrum Multivitamin (UNMATCHED)
  {
    raw_text: 'CENTRUM ADULTS 200CT',
    description: 'centrum adults multivitamin 200 ct',
    code: null,
    quantity: 1,
    unit: 'each',
    unit_price: null,
    shelf_price: 17.49,
    member_price: 17.49,
    is_store_brand: false,
    item_type: 'compare',
    picked_off_barcode: null,
    user_display_name: 'Centrum Adults Multivitamin, 200 ct',
    user_pack_size: 200,
    user_pack_unit: 'ct',
    match: null,
    alternatives: [],
    enrichment: null,
    informational_only: false,
  },
];

export const compareResp: CompareResponse = {
  receipt: {
    store_name: 'Safeway',
    store_address: '1450 Veterans Blvd, Redwood City',
    receipt_date: 'Apr 26, 2026',
    receipt_total: 54.78,
    item_count: 9,
  },
  chain_detected: 'safeway',
  items,
  summary: { total_items: 9, compare_items: 9, matched: 8, unmatched: 1 },
  schema_warnings: [],
};

export const matchResult: MatchResponse = {
  receipt: compareResp.receipt,
  chain_detected: 'safeway',
  parse_source: 'heuristic',
  parsed: { items: [] },
  items: [],
  summary: compareResp.summary,
  schema_warnings: [],
  location_default: null,
  radius_miles_default: null,
};

// ── Shared helpers for the new shelf-aware designs ─────────────────────────
// Re-exported from `components/aftercart-v3/equivClassifier.ts` so production
// (CompareAltS) doesn't have to reach into this sandbox module for them.

export {
  type ChangeKind,
  classifyChange,
  CHANGE_LABELS,
  CHANGE_COLORS,
} from '@/components/aftercart-v3/equivClassifier';
