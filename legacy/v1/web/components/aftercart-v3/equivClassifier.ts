/**
 * Equivalent-substitute change classifier — shared by the production
 * compare screen and the design-sandbox alts.
 *
 * Lives in `components/aftercart-v3/` so production never has to import
 * from `app/v3/compare-alt/`, which is sandbox territory.
 */

export type ChangeKind =
  | 'same_brand'      // exact same brand — rare wins
  | 'store_brand'     // chain's house brand (often cheapest)
  | 'different_brand' // different name brand
  | 'organic'         // organic version of the item
  | 'larger_pack'     // bulk / larger pack required
  | 'smaller_pack'    // smaller size variant
  | 'different_form'  // sliced vs whole, bites, florets, bagged
  | 'fresh_diff'      // air-chilled, grass-fed, etc — process change
  | 'unknown';

/**
 * Best-guess change-kind from the equiv_name string. Used to pick a badge
 * color/label in the new shelf-aware designs. The mock data writes
 * predictable phrasings; keep the rules simple.
 */
export function classifyChange(equivName: string | null, isExact: boolean): ChangeKind {
  if (isExact) return 'same_brand';
  if (!equivName) return 'unknown';
  const s = equivName.toLowerCase();
  if (s.includes('same brand')) return 'same_brand';
  if (s.includes('store brand')) return 'store_brand';
  if (s.includes('organic')) return 'organic';
  if (s.includes('bulk') || s.includes('larger pack') || s.includes('pack only') || s.includes('4×') || s.includes('2-pack') || s.includes('multi-pack') || s.includes('min')) return 'larger_pack';
  if (s.includes('smaller') || s.includes('half size') || s.includes('0.5')) return 'smaller_pack';
  if (s.includes('sliced') || s.includes('bites') || s.includes('bagged') || s.includes('florets') || s.includes('pre-cut')) return 'different_form';
  if (s.includes('air-chilled') || s.includes('grass-fed') || s.includes('aged') || s.includes('process')) return 'fresh_diff';
  if (s.includes('different brand') || s.includes('local brand')) return 'different_brand';
  if (s.includes('only ') && s.includes('oz')) return 'larger_pack';
  return 'unknown';
}

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  same_brand: 'SAME BRAND',
  store_brand: 'STORE BRAND',
  different_brand: 'DIFF BRAND',
  organic: 'ORGANIC',
  larger_pack: 'BULK PACK',
  smaller_pack: 'SMALLER',
  different_form: 'DIFF FORM',
  fresh_diff: 'DIFF GRADE',
  unknown: 'SUBSTITUTE',
};

export const CHANGE_COLORS: Record<ChangeKind, { fg: string; bg: string }> = {
  same_brand:      { fg: '#22c55e', bg: 'rgba(34,197,94,0.16)' },   // green — best case
  store_brand:     { fg: '#3b82f6', bg: 'rgba(59,130,246,0.16)' },  // blue — neutral substitute
  different_brand: { fg: '#f59e0b', bg: 'rgba(245,158,11,0.18)' },  // amber — meaningful change
  organic:         { fg: '#8b5cf6', bg: 'rgba(139,92,246,0.18)' },  // purple
  larger_pack:     { fg: '#06b6d4', bg: 'rgba(6,182,212,0.18)' },   // cyan — pack change
  smaller_pack:    { fg: '#06b6d4', bg: 'rgba(6,182,212,0.18)' },
  different_form:  { fg: '#ec4899', bg: 'rgba(236,72,153,0.18)' },  // pink — form change
  fresh_diff:      { fg: '#14b8a6', bg: 'rgba(20,184,166,0.18)' },  // teal
  unknown:         { fg: '#9ca3af', bg: 'rgba(156,163,175,0.18)' }, // grey
};
