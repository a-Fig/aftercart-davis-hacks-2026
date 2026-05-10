/**
 * Per-chain projection logic for the side-by-side compare views.
 *
 * Extracted out of V3Compare so V3M (mobile) can reuse the same math without
 * a copy/paste. The desktop and mobile compare screens differ only in layout
 * — totals, chain ordering, equivalent-total math, and the data model are
 * identical.
 */

import { computeEquivalentTotal } from '@/lib/api/adapter';
import type {
  ApiAlternative,
  ApiItem,
  CompareResponse,
} from '@/lib/api/compare';

// One purchasable option at a chain for a given user-line. Multiple options
// per (chain, line) are possible — exact + equivalent canonicals, plus tier
// variants when present.
export interface ChainOption {
  canonical_id: number;
  store_id: number;
  match_type: 'exact' | 'equivalent';
  equivalence_strength: number;
  display_name: string;
  equiv_note: string | null;
  shelf: number;
  member: number | null;
  // Volume-normalized totals — what the user would actually pay at this
  // option for THEIR purchase volume (handles size-variant equivalents and
  // weight-priced items honestly). Null when the math can't be computed
  // (e.g. by-weight item where the receipt didn't carry the weight).
  shelf_total: number | null;
  member_total: number | null;
  price_unit: string;
  freshness: 'green' | 'yellow' | 'red';
  observations: number;
  distance_miles: number;
  pack_size: number | null;
  pack_unit: string | null;
}

export interface ChainProjection {
  chain_id: number;
  chain_name: string;
  store_label: string;
  distance_miles: number;
  has_member_pricing: boolean;
  options_by_line: Map<number, ChainOption[]>;
}

export function effectiveTotal(opt: ChainOption, useMember: boolean): number | null {
  if (useMember && opt.member_total != null) return opt.member_total;
  return opt.shelf_total;
}

export function effectivePrice(opt: ChainOption, useMember: boolean): number {
  if (useMember && opt.member != null) return opt.member;
  return opt.shelf;
}

export function totalSavingsForChain(chain: ChainProjection, api: CompareResponse): number {
  let saves = 0;
  api.items.forEach((item, row_idx) => {
    if (item.item_type === 'skip') return;
    const opts = chain.options_by_line.get(row_idx);
    if (!opts || opts.length === 0) return;
    const cheapest = opts[0];
    const total = effectiveTotal(cheapest, false);
    if (total == null) return;
    saves += item.member_price - total;
  });
  return saves;
}

// price × qty is safe for per-each/per-pack (the unit IS the pack), but
// wrong for per-weight/per-volume (the unit is a rate, qty may be a count).
function safeFallbackTotal(
  unitPrice: number,
  item: ApiItem,
  priceUnit: string,
): number | null {
  const pu = priceUnit.toLowerCase();
  if (pu === 'per_each' || pu === 'per_pack') {
    return Number((unitPrice * (item.quantity ?? 1)).toFixed(2));
  }
  return null;
}

function computeOption(
  pair: { shelf?: ApiAlternative; member?: ApiAlternative },
  item: ApiItem,
): ChainOption | null {
  const primary = pair.shelf ?? pair.member;
  if (!primary) return null;
  const userMatchSize = item.match?.package_size ?? null;
  const userMatchUnit = item.match?.package_unit ?? null;
  const equivPackSize = primary.equiv_pack_size != null ? Number(primary.equiv_pack_size) : null;
  const equivPackUnit = primary.equiv_pack_unit ?? null;

  const shelfPrice = pair.shelf ? Number(pair.shelf.weighted_price) : Number(primary.weighted_price);
  const memberPriceRaw = pair.member ? Number(pair.member.weighted_price) : null;
  const memberPrice = memberPriceRaw != null && memberPriceRaw < shelfPrice - 0.01 ? memberPriceRaw : null;

  const mt = primary.match_type === 'equivalent' ? 'equivalent' as const : 'exact' as const;
  const shelfTotal = computeEquivalentTotal(
    shelfPrice,
    primary.price_unit,
    equivPackSize,
    equivPackUnit,
    userMatchSize,
    userMatchUnit,
    item.quantity,
    item.unit,
    mt,
  );
  const memberTotal = memberPrice != null ? computeEquivalentTotal(
    memberPrice,
    primary.price_unit,
    equivPackSize,
    equivPackUnit,
    userMatchSize,
    userMatchUnit,
    item.quantity,
    item.unit,
    mt,
  ) : null;

  const display = primary.display_name
    ?? (primary.equiv_name
      ? equivPackSize && equivPackUnit
        ? `${primary.equiv_name}, ${equivPackSize} ${equivPackUnit}`
        : primary.equiv_name
      : 'Price observation');

  const equivNote = primary.match_type === 'equivalent'
    ? (primary.equiv_name ? `Substitute · ${primary.equiv_name}` : null)
    : null;

  return {
    canonical_id: primary.canonical_id,
    store_id: primary.store_id,
    match_type: primary.match_type === 'equivalent' ? 'equivalent' : 'exact',
    equivalence_strength: Number(primary.equivalence_strength),
    display_name: display,
    equiv_note: equivNote,
    shelf: shelfPrice,
    member: memberPrice,
    shelf_total: shelfTotal ?? safeFallbackTotal(shelfPrice, item, primary.price_unit),
    member_total: memberTotal ?? (memberPrice != null ? safeFallbackTotal(memberPrice, item, primary.price_unit) : null),
    price_unit: primary.price_unit,
    freshness: primary.freshness,
    observations: Number(primary.observation_count),
    distance_miles: Number(primary.distance_miles),
    pack_size: equivPackSize,
    pack_unit: equivPackUnit,
  };
}

/**
 * Project the CompareResponse into per-chain tables. Each chain gets a list
 * of options per user-row. Multiple stores within a chain collapse to the
 * closest one. Sorted by total-savings desc.
 *
 * Row identity is the array index in `compareResp.items` — ApiItem doesn't
 * carry line_index but the items array order matches the parsed receipt.
 */
export function projectByChain(api: CompareResponse): ChainProjection[] {
  const byChain = new Map<number, {
    chain_name: string;
    closest_store_id: number;
    closest_distance: number;
    closest_address: string;
    grouped: Map<number, Map<number, { shelf?: ApiAlternative; member?: ApiAlternative }>>;
  }>();

  api.items.forEach((item, row_idx) => {
    if (item.item_type === 'skip') return;
    for (const alt of item.alternatives ?? []) {
      const dist = Number(alt.distance_miles);
      const cid = alt.chain_id;
      let entry = byChain.get(cid);
      if (!entry) {
        entry = {
          chain_name: alt.chain_name,
          closest_store_id: alt.store_id,
          closest_distance: dist,
          closest_address: alt.address,
          grouped: new Map(),
        };
        byChain.set(cid, entry);
      }
      if (dist < entry.closest_distance) {
        entry.closest_distance = dist;
        entry.closest_store_id = alt.store_id;
        entry.closest_address = alt.address;
      }
      let perLine = entry.grouped.get(row_idx);
      if (!perLine) { perLine = new Map(); entry.grouped.set(row_idx, perLine); }
      let pair = perLine.get(alt.canonical_id);
      if (!pair) { pair = {}; perLine.set(alt.canonical_id, pair); }
      if (alt.pricing_tier === 'member') pair.member = alt;
      else pair.shelf = alt;
    }
  });

  const result: ChainProjection[] = [];
  for (const [chain_id, entry] of byChain.entries()) {
    const options_by_line = new Map<number, ChainOption[]>();
    let has_member_pricing = false;

    for (const [row_idx, perLine] of entry.grouped.entries()) {
      const item = api.items[row_idx];
      if (!item) continue;
      const opts: ChainOption[] = [];
      for (const pair of perLine.values()) {
        const opt = computeOption(pair, item);
        if (!opt) continue;
        if (opt.member_total != null && opt.shelf_total != null && opt.member_total < opt.shelf_total - 0.01) {
          has_member_pricing = true;
        }
        opts.push(opt);
      }
      opts.sort((a, b) => (effectiveTotal(a, false) ?? Infinity) - (effectiveTotal(b, false) ?? Infinity));
      options_by_line.set(row_idx, opts);
    }

    result.push({
      chain_id,
      chain_name: entry.chain_name,
      store_label: entry.closest_address || entry.chain_name,
      distance_miles: entry.closest_distance,
      has_member_pricing,
      options_by_line,
    });
  }

  result.sort((a, b) => totalSavingsForChain(b, api) - totalSavingsForChain(a, api));
  return result;
}
