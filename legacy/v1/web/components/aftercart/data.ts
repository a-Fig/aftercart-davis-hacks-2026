// ── Types ─────────────────────────────────────────────────────

export type Freshness = 'green' | 'yellow' | 'red';
export type MatchType = 'exact' | 'equivalent';

// ── Open Food Facts enrichment ─────────────────────────────────
// Mirrors web/lib/api/compare.ts OffEnrichment exactly. Duplicated here
// because data.ts is consumed by components that shouldn't depend on the
// API client module — this matches the existing pattern (StorePrice/etc.
// are typed locally, not imported from the API module).

export interface OffNutriments {
  energy_kcal_100g?: number | null;
  sugars_100g?: number | null;
  sodium_100g?: number | null;
  fat_100g?: number | null;
  saturated_fat_100g?: number | null;
  proteins_100g?: number | null;
  fiber_100g?: number | null;
  salt_100g?: number | null;
  [extra: string]: number | string | null | undefined;
}

export interface OffEnrichment {
  barcode: string;
  product_name: string | null;
  generic_name: string | null;
  brands: string | null;
  image_url: string | null;
  serving_size: string | null;
  quantity_raw: string | null;
  package_size: number | null;
  package_unit: string | null;
  nutriscore_grade: 'a' | 'b' | 'c' | 'd' | 'e' | null;
  nova_group: 1 | 2 | 3 | 4 | null;
  ecoscore_grade: 'a' | 'b' | 'c' | 'd' | 'e' | null;
  ingredients_text: string | null;
  allergens: string[];
  traces: string[];
  additives: string[];
  nutriments: OffNutriments;
}

// ── Match-review candidates ────────────────────────────────────
// What the ReviewScreen renders. Discriminated by `source` so the UI can show
// an "in-house" or "OFF" pill + thread the right id forward when the user
// confirms a pick.

export interface InHouseCandidate {
  source: 'in-house';
  canonical_id: number;
  name: string;
  brand: string | null;
  package_size: number | null;
  package_unit: string | null;
  pricing_unit: string;
  score: number;
  image_url: string | null;
}

export interface OffCandidate {
  source: 'off';
  barcode: string;
  name: string | null;
  brand: string | null;
  quantity_raw: string | null;
  package_size: number | null;
  package_unit: string | null;
  image_url: string | null;
  score?: number | null;
  enrichment?: OffEnrichment | null;
  llm_reason?: string | null;
}

export type MatchCandidate = InHouseCandidate | OffCandidate;

// Optional per-row corrections to the OCR-parsed price / quantity / unit.
// Sent only when the user edited values in the review screen — undefined
// means "trust what the parser gave us."
//
// Anchoring intent: these are *corrections to OCR misreads*, not "what I
// would have paid with a coupon." The review screen's UX copy reinforces
// that framing. Server-side, an override fully replaces the OCR value for
// downstream math (per-unit price) and any future contribution to
// price_observations.
export interface ReceiptValueOverrides {
  price_override?: number;     // replaces both shelf_price and member_price
  quantity_override?: number;
  unit_override?: string;
}

// What the user echoes back per line item to /api/compare. Kept as a
// discriminated union so the route can resolve picks unambiguously, with
// a shared overrides slot orthogonal to the choice tag.
export type Correction = ReceiptValueOverrides & (
  | { line_index: number; choice: { kind: 'in-house'; canonical_id: number } }
  | { line_index: number; choice: { kind: 'off'; barcode: string } }
  | { line_index: number; choice: { kind: 'none' } }
);


export interface StorePrice {
  store?: string;
  price: number;                // shelf price (the publicly-posted tag for the alt's own pack)
  member_price?: number;        // loyalty-card price when present and lower than shelf
  // What the user would have paid at this alternative for their own purchase
  // volume — shelf price * (their volume / alt pack volume), normalized in
  // common units. Same as `price` for exact same-pack matches; differs for
  // size-variant equivalents and weight-priced items. Adapter sets this
  // whenever a cross-pack-size comparison is meaningful.
  equivalent_total?: number;
  per: string;                  // "$0.56/oz" — the unit-price comparison anchor
  price_unit?: string;          // raw price_unit from the DB (per_lb, per_each, etc.)
  dist: string;
  current?: boolean;
  match_type: MatchType;
  equivalence_strength?: number;
  freshness: Freshness;
  observations: number;
  product_name: string;
  equiv_note?: string;
  warn_stale?: boolean;
  // True when a price exists but the volume-normalized total couldn't be
  // computed (e.g. by-weight item where the receipt didn't carry weight).
  // The UI should show per-unit pricing rather than a misleading total.
  comparison_unavailable?: boolean;
  per_unit_savings_label?: string;
}

export interface ReceiptItem {
  id: string;
  name: string;
  detail: string;
  paid: number;
  quantity?: number | null;
  unit?: string | null;
  match_confidence: number;
  prices: Record<string, StorePrice>;
  reason?: string;
  // Effective per-unit price the user paid (e.g. "$0.70/oz"). Surfaced in
  // ItemDetailModal so cross-pack-size comparisons are honest. Null when the
  // receipt line has no weight/volume signal (a single each with no unit).
  unit_price_label?: string;
  // Open Food Facts enrichment for this item — image, Nutri-Score, NOVA,
  // ingredients, allergens, nutriments. Null when there's no canonical_barcodes
  // link or the user picked "no match" in the review screen.
  enrichment?: OffEnrichment | null;
  // True when the user picked an OFF entry that has no canonical link — we
  // can show product info but can't compare prices for it. The modal renders
  // a soft "no comparison" state in this case.
  informational_only?: boolean;
}

export interface Category {
  id: string;
  label: string;
  icon: string | null;
  isUnmatched?: boolean;
  items: ReceiptItem[];
}

export interface StoreComparison {
  dist: string;
  total: number;        // sum of THIS store's prices for items it actually carries
  paid: number;         // sum of user-paid prices for the SAME subset of items (so total vs paid is apples-to-apples)
  saves: number;        // paid - total (always positive when this store is cheaper on the covered subset)
  pct: number;
  matched_count: number;     // how many items this store has prices for
  total_compared: number;    // total items in the matched bucket — for "X of Y items at this store"
}

export interface Receipt {
  store: string;
  address: string;
  date: string;
  total: number;
  items_count: number;
  compared_count: number;
  categories: Category[];
  comparisons: Record<string, StoreComparison>;
}

export interface Theme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  inkDark: string;
  inkMid: string;
  inkLight: string;
  inkFaint: string;
  accent: string;
  accentBg: string;
  cta: string;
  save: string;
  saveBg: string;
  pos: string;
  posBg: string;
  saved: string;
  savedBg: string;
  navBg: string;
  navFg: string;
  chip: string;
  chipFg: string;
  scanAccent: string;
}

// ── Themes ────────────────────────────────────────────────────

export const THEMES: Record<string, Theme> = {
  forest: {
    bg: '#f4f8f5', surface: '#ffffff', surfaceAlt: '#eef5f0', border: '#d0e4d8',
    inkDark: '#0d1f18', inkMid: '#2d4a3e', inkLight: '#5a7a6e', inkFaint: '#90b0a4',
    accent: '#1e5c40', accentBg: '#d4ede0',
    cta: '#1e5c40',
    save: '#c8601a', saveBg: '#fdf0e4',
    pos: '#2d7a55', posBg: '#e6f4ec',
    saved: '#1a55a8', savedBg: '#e6eef9',
    navBg: '#0d1f18', navFg: '#f4f8f5',
    chip: '#e0ede5', chipFg: '#1e4433',
    scanAccent: '#4ade80',
  },
};

// ── Constants ─────────────────────────────────────────────────

export const STORES = ["Grocery Outlet", "Trader Joe's"];

export const FRESH_COLORS: Record<Freshness, string> = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
};

export const FRESH_LABELS: Record<Freshness, string> = {
  green: '<7 days',
  yellow: '7–30 days',
  red: '>30 days',
};

// ── Demo receipt data ──────────────────────────────────────────

export const RECEIPT: Receipt = {
  store: 'Safeway', address: '1450 Veterans Blvd, Redwood City', date: 'Apr 26, 2026',
  total: 54.67, items_count: 9, compared_count: 8,
  categories: [
    {
      id: 'meat', label: 'Meat & Seafood', icon: '🥩', items: [
        {
          id: 'chicken', name: 'Chicken Thighs', detail: '2.13 lb · $3.47/lb', paid: 7.39, match_confidence: 0.97,
          prices: {
            'Safeway': { price: 7.39, per: '$3.47/lb', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 14, product_name: 'Safeway Boneless Skinless Chicken Thighs' },
            'Grocery Outlet': { price: 4.26, per: '$2.00/lb', dist: '0.8 mi', match_type: 'exact', freshness: 'green', observations: 8, product_name: 'Foster Farms Chicken Thighs Boneless Skinless' },
            "Trader Joe's": { price: 5.96, per: '$2.80/lb', dist: '1.2 mi', match_type: 'equivalent', equivalence_strength: 0.88, freshness: 'yellow', observations: 5, product_name: "Trader Joe's Chicken Thighs (air-chilled)", equiv_note: 'Air-chilled, comparable cut' },
          },
        },
        {
          id: 'beef', name: 'Ground Beef 80/20', detail: '1 lb · $6.49/lb', paid: 6.49, match_confidence: 0.99,
          prices: {
            'Safeway': { price: 6.49, per: '$6.49/lb', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 19, product_name: 'Safeway Ground Beef 80% Lean 1lb' },
            'Grocery Outlet': { price: 5.16, per: '$5.16/lb', dist: '0.8 mi', match_type: 'exact', freshness: 'green', observations: 11, product_name: 'Ground Beef 80/20 1lb' },
            "Trader Joe's": { price: 5.99, per: '$5.99/lb', dist: '1.2 mi', match_type: 'exact', freshness: 'green', observations: 9, product_name: "Trader Joe's Ground Beef 80/20 1lb" },
          },
        },
      ],
    },
    {
      id: 'dairy', label: 'Dairy', icon: '🥛', items: [
        {
          id: 'milk', name: 'Whole Milk', detail: '1 gal', paid: 5.29, match_confidence: 0.99,
          prices: {
            'Safeway': { price: 5.29, per: '$5.29/gal', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 22, product_name: 'Lucerne Whole Milk 1 gal' },
            'Grocery Outlet': { price: 4.99, per: '$4.99/gal', dist: '0.8 mi', match_type: 'equivalent', equivalence_strength: 0.95, freshness: 'yellow', observations: 6, product_name: 'Alta Dena Whole Milk 1 gal', equiv_note: 'Same fat content, different brand' },
            "Trader Joe's": { price: 3.99, per: '$3.99/gal', dist: '1.2 mi', match_type: 'equivalent', equivalence_strength: 0.95, freshness: 'green', observations: 17, product_name: "Trader Joe's Whole Milk 1 gal", equiv_note: 'Same fat content, different brand' },
          },
        },
        {
          id: 'yogurt', name: 'Greek Yogurt, Plain', detail: '32 oz · Chobani', paid: 4.99, match_confidence: 0.95,
          prices: {
            'Safeway': { price: 4.99, per: '$4.99', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 11, product_name: 'Chobani Plain Greek Yogurt 32oz' },
            'Grocery Outlet': { price: 3.49, per: '$3.49', dist: '0.8 mi', match_type: 'equivalent', equivalence_strength: 0.82, freshness: 'yellow', observations: 4, product_name: 'Fage Total 0% Greek Yogurt 32oz', equiv_note: 'Different brand, similar nutrition' },
            "Trader Joe's": { price: 3.99, per: '$3.99', dist: '1.2 mi', match_type: 'equivalent', equivalence_strength: 0.90, freshness: 'green', observations: 13, product_name: "Trader Joe's Greek Yogurt Plain 32oz", equiv_note: 'Similar cultured whole milk yogurt' },
          },
        },
        {
          id: 'cheese', name: 'Sharp Cheddar', detail: '8 oz block', paid: 3.79, match_confidence: 0.98,
          prices: {
            'Safeway': { price: 3.79, per: '$3.79', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 16, product_name: 'Tillamook Sharp Cheddar 8oz' },
            'Grocery Outlet': { price: 2.99, per: '$2.99', dist: '0.8 mi', match_type: 'equivalent', equivalence_strength: 0.78, freshness: 'green', observations: 7, product_name: 'Crystal Farms Sharp Cheddar 8oz', equiv_note: 'Different brand, comparable sharpness' },
            "Trader Joe's": { price: 2.79, per: '$2.79', dist: '1.2 mi', match_type: 'equivalent', equivalence_strength: 0.85, freshness: 'green', observations: 14, product_name: "Trader Joe's Sharp Cheddar 8oz", equiv_note: 'Similar aged sharp cheddar' },
          },
        },
      ],
    },
    {
      id: 'produce', label: 'Produce', icon: '🥦', items: [
        {
          id: 'broccoli', name: 'Broccoli Crowns', detail: '1.2 lb · $2.41/lb', paid: 2.89, match_confidence: 0.99,
          prices: {
            'Safeway': { price: 2.89, per: '$2.41/lb', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 9, product_name: 'Broccoli Crowns (by weight)' },
            'Grocery Outlet': { price: 1.79, per: '$1.49/lb', dist: '0.8 mi', match_type: 'exact', freshness: 'green', observations: 6, product_name: 'Broccoli Crowns (by weight)' },
            "Trader Joe's": { price: 1.99, per: '$1.66/lb', dist: '1.2 mi', match_type: 'exact', freshness: 'yellow', observations: 3, product_name: 'Broccoli Crowns (by weight)' },
          },
        },
        {
          id: 'bananas', name: 'Bananas', detail: '2.1 lb · $0.70/lb', paid: 1.47, match_confidence: 0.99,
          prices: {
            'Safeway': { price: 1.47, per: '$0.70/lb', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 31, product_name: 'Bananas (by weight)' },
            'Grocery Outlet': { price: 0.99, per: '$0.47/lb', dist: '0.8 mi', match_type: 'exact', freshness: 'yellow', observations: 5, product_name: 'Bananas (by weight)' },
            "Trader Joe's": { price: 0.99, per: '~$0.47/lb', dist: '1.2 mi', match_type: 'exact', freshness: 'green', observations: 18, product_name: 'Bananas (sold per bunch)' },
          },
        },
      ],
    },
    {
      id: 'bakery', label: 'Bread & Bakery', icon: '🍞', items: [
        {
          id: 'bread', name: 'Sourdough Loaf', detail: '24 oz', paid: 4.99, match_confidence: 0.91,
          prices: {
            'Safeway': { price: 4.99, per: '$4.99', dist: '0.2 mi', current: true, match_type: 'exact', freshness: 'green', observations: 8, product_name: 'Boudin Sourdough Round Loaf 24oz' },
            'Grocery Outlet': { price: 3.99, per: '$3.99', dist: '0.8 mi', match_type: 'equivalent', equivalence_strength: 0.75, freshness: 'red', observations: 2, product_name: 'Stonemill Sourdough Bread 24oz', equiv_note: 'Sliced loaf, not round', warn_stale: true },
            "Trader Joe's": { price: 3.49, per: '$3.49', dist: '1.2 mi', match_type: 'equivalent', equivalence_strength: 0.88, freshness: 'green', observations: 11, product_name: "Trader Joe's SF-Style Sourdough", equiv_note: 'Similar sourdough, slightly smaller' },
          },
        },
      ],
    },
    {
      id: 'unmatched', label: 'No Comparison Found', icon: null, isUnmatched: true, items: [
        {
          id: 'vitamins', name: 'Centrum Adults Multivitamin', detail: '200 ct', paid: 17.49, match_confidence: 0.44,
          prices: {},
          reason: 'Store-specific promotion — no nearby price data',
        },
      ],
    },
  ],
  comparisons: {
    'Grocery Outlet': { dist: '0.8 mi', total: 41.15, paid: 52.18, saves: 11.03, pct: 21, matched_count: 8, total_compared: 8 },
    "Trader Joe's":   { dist: '1.2 mi', total: 44.21, paid: 52.18, saves: 7.97,  pct: 15, matched_count: 8, total_compared: 8 },
  },
};

// ── Utilities ─────────────────────────────────────────────────

export const fmt = (n: number) => `$${n.toFixed(2)}`;

export function catSavings(cat: Category, storeName: string): { save: number; hasEquiv: boolean } {
  if (cat.isUnmatched) return { save: 0, hasEquiv: false };
  let save = 0;
  let hasEquiv = false;
  cat.items.forEach(item => {
    const p = item.prices[storeName];
    if (p && !p.comparison_unavailable) {
      const altTotal = p.equivalent_total ?? p.price;
      save += item.paid - altTotal;
      if (p.match_type === 'equivalent') hasEquiv = true;
    }
  });
  return { save, hasEquiv };
}

export function allComparableItems(receipt: Receipt = RECEIPT): ReceiptItem[] {
  return receipt.categories.flatMap(c => c.isUnmatched ? [] : c.items);
}
