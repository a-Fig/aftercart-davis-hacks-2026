/**
 * Convert /api/compare response into the UI's Receipt shape.
 *
 * The mock data structure is richer than the API output today (categories,
 * per-store comparisons, equivalence notes, freshness). We map what the API
 * does have, drop into a single "Items" category for now, and surface
 * unmatched items in a separate group per the product spec ("Items with no
 * confident match are listed separately... never silently omitted").
 *
 * When alternatives is empty (cold-start state, before fieldwork lands),
 * `comparisons` ends up as {} and ResultsScreen shows the no-data path.
 */

import type {
  CompareResponse,
  ApiItem,
  ApiAlternative,
} from './compare'
import type {
  Receipt,
  ReceiptItem,
  Category,
  StorePrice,
  StoreComparison,
  Freshness,
  MatchType,
} from '@/components/aftercart/data'

// ── small helpers ─────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  // Parse "YYYY-MM-DD" without timezone surprises and format "Apr 15, 2026".
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function detailLine(item: ApiItem): string {
  const parts: string[] = []
  if (item.quantity != null && item.unit) {
    parts.push(`${item.quantity} ${item.unit}`)
  } else if (item.quantity != null) {
    parts.push(`qty ${item.quantity}`)
  }
  // member_price is what they actually paid; shelf_price is the pre-discount.
  // When the two differ (loyalty discount), surface the savings inline.
  if (item.shelf_price !== item.member_price) {
    parts.push(`shelf ${money(item.shelf_price)} → paid ${money(item.member_price)}`)
  } else {
    parts.push(money(item.member_price))
  }
  return parts.join(' · ')
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

function itemId(item: ApiItem, idx: number): string {
  // canonical_id when matched is stable; otherwise fall back to a per-receipt
  // index so React keys still work and ItemDetailModal lookups don't collide.
  return item.match ? `c${item.match.canonical_id}-${idx}` : `u${idx}`
}

// ── alternative → StorePrice ───────────────────────────────────────────────

function altToStorePrice(
  alt: ApiAlternative,
  paidPrice: number,
  matchScore: number,
  matchName: string | null,
  matchPackageSize: number | null,
  matchPackageUnit: string | null,
  userQuantity: number | null,
  userUnit: string | null,
): StorePrice {
  const price = Number(alt.weighted_price)
  const matchType: MatchType = alt.match_type === 'equivalent' ? 'equivalent' : 'exact'
  const distance = Number(alt.distance_miles)
  const equivStrength = Number(alt.equivalence_strength)
  // For exact matches the equiv_pack_* fields point at the user's canonical
  // (the row joins canonical_products on cp.canonical_id). For equivalents
  // they point at the peer canonical.
  const equivPackSize = alt.equiv_pack_size != null ? Number(alt.equiv_pack_size) : null
  const equivPackUnit = alt.equiv_pack_unit ?? null

  // Per-unit price the alt would charge for the user's volume — anchors
  // honest comparison ("$0.56/oz at Safeway vs $0.56/oz you paid") and is
  // independent of pack size, so it works for both exact and equivalent
  // matches.
  const userUnitPriceLabel = computeAltUnitPriceLabel(
    price,
    alt.price_unit,
    equivPackSize,
    equivPackUnit,
  )

  // Volume-normalized total: what the user would have paid at this alt
  // for their actual purchase. For exact same-pack matches this equals
  // alt's price (× user's quantity if >1). For size-variant equivalents
  // this scales by the pack ratio so 1 lb of chocolate at $0.56/oz reads
  // as $8.96 even when the alt sells 3.5-oz packs at $1.96 each.
  const equivalentTotal = computeEquivalentTotal(
    price,
    alt.price_unit,
    equivPackSize,
    equivPackUnit,
    matchPackageSize,
    matchPackageUnit,
    userQuantity,
    userUnit,
    matchType,
  )

  const comparisonUnavailable = equivalentTotal == null
  const perUnitSavingsLabel = comparisonUnavailable
    ? computePerUnitSavingsLabel(paidPrice, userUnit, userQuantity, price, alt.price_unit)
    : undefined

  return {
    store: alt.chain_name,
    price,
    equivalent_total: equivalentTotal ?? undefined,
    per: userUnitPriceLabel ?? priceUnitLabel(price, alt.price_unit),
    price_unit: alt.price_unit,
    dist: distance < 0.1 ? 'nearby' : `${distance.toFixed(1)} mi`,
    match_type: matchType,
    freshness: alt.freshness,
    observations: Number(alt.observation_count),
    product_name:
      alt.display_name ??
      canonicalDisplay(
        alt.equiv_name ?? matchName,
        equivPackSize ?? matchPackageSize,
        equivPackUnit ?? matchPackageUnit,
      ),
    equiv_note: composeEquivNote(alt),
    warn_stale: alt.freshness === 'red',
    equivalence_strength: matchType === 'equivalent' ? equivStrength : undefined,
    comparison_unavailable: comparisonUnavailable || undefined,
    per_unit_savings_label: perUnitSavingsLabel ?? undefined,
  }
}

// Compose the small italic caption under the product name. Kept terse —
// the headline equivalent_total + the per-unit price already explain the
// price comparison; this caption only flags qualitative differences.
function composeEquivNote(alt: ApiAlternative): string | undefined {
  if (alt.match_type === 'equivalent') {
    // Size variants need no extra caption — pack info is in product_name and
    // the headline equivalent_total tells the cost story. Cross-brand
    // substitutes (different equiv_name) are qualitatively different so we
    // tag them as substitutes.
    if (alt.equiv_name && !looksLikeSizeVariant(alt.equiv_name)) {
      return `Substitute — ${alt.equiv_name}`
    }
    return undefined
  }
  if (alt.pricing_tier === 'member') return 'Member price'
  return undefined
}

// Heuristic: equivalents whose equiv_name doesn't include a size suffix are
// substitutes (different brand/style). Size variants in our seed always
// have either no size in the name (e.g. "Dark chocolate bar") or a size
// embedded — both are size variants. Used to decide whether to show the
// "Substitute" caption.
function looksLikeSizeVariant(_equivName: string): boolean {
  // For now, treat all equivalents the same — the equivalence_strength chip
  // already differentiates 1.00 (size variant) from 0.85 (substitute) in
  // the UI. If we want a separate label, we can split these later.
  return true
}

// Loose dimension check so "lb" + "oz" group together (both weight) and
// "fl_oz" + "gal" group (both volume).
function sameDimension(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const da = unitDim(a)
  const db = unitDim(b)
  return da !== null && da === db
}

function unitDim(u: string): 'weight' | 'volume' | 'count' | null {
  const s = u.toLowerCase()
  if (['oz', 'lb', 'lbs', 'g', 'kg', 'pound', 'pounds', 'ounce', 'ounces'].includes(s)) return 'weight'
  if (['fl_oz', 'floz', 'gal', 'gallon', 'gallons', 'quart', 'qt', 'pint', 'pt', 'cup', 'cups', 'ml', 'l', 'liter', 'liters'].includes(s)) return 'volume'
  if (['count', 'ct', 'each', 'pack', 'pk', 'dozen', 'doz'].includes(s)) return 'count'
  return null
}

// Convert (value, unit) to a canonical scalar within its dimension:
// weight → grams, volume → ml, count → count. Returns null when unit
// isn't recognized.
function toCanonical(value: number, unit: string): { dim: 'weight' | 'volume' | 'count', val: number } | null {
  const u = unit.toLowerCase()
  // weight → grams
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return { dim: 'weight', val: value * 453.592 }
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return { dim: 'weight', val: value * 28.3495 }
  if (u === 'kg') return { dim: 'weight', val: value * 1000 }
  if (u === 'g') return { dim: 'weight', val: value }
  // volume → ml
  if (u === 'fl_oz' || u === 'floz') return { dim: 'volume', val: value * 29.5735 }
  if (u === 'gal' || u === 'gallon' || u === 'gallons') return { dim: 'volume', val: value * 3785.41 }
  if (u === 'quart' || u === 'qt') return { dim: 'volume', val: value * 946.353 }
  if (u === 'pint' || u === 'pt') return { dim: 'volume', val: value * 473.176 }
  if (u === 'cup' || u === 'cups') return { dim: 'volume', val: value * 240 }
  if (u === 'ml') return { dim: 'volume', val: value }
  if (u === 'l' || u === 'liter' || u === 'liters') return { dim: 'volume', val: value * 1000 }
  // count
  if (u === 'count' || u === 'ct' || u === 'each' || u === 'pack' || u === 'pk') return { dim: 'count', val: value }
  if (u === 'dozen' || u === 'doz') return { dim: 'count', val: value * 12 }
  return null
}

// Format a per-unit price like "$0.56/oz" using the most natural unit for
// the dimension (weight → /oz, volume → /fl oz, count → /each). Returns
// null when alt's unit info isn't enough to compute it.
//
// Strategy:
//   - Per-each / per-pack pricing: derive per-unit from pack price ÷ pack size
//   - Per-lb / per-oz / per-fl_oz pricing: that IS the per-unit price already
function computeAltUnitPriceLabel(
  altPrice: number,
  altPriceUnit: string,
  altPackSize: number | null,
  altPackUnit: string | null,
): string | null {
  const pu = altPriceUnit.toLowerCase()
  if (pu === 'per_lb' || pu === 'per_oz' || pu === 'per_fl_oz' || pu === 'per_g' || pu === 'per_ml') {
    return `${money(altPrice)}/${pu.replace(/^per_/, '')}`
  }
  if (pu === 'per_each' || pu === 'per_pack') {
    if (altPackSize == null || !altPackUnit) return null
    const dim = unitDim(altPackUnit)
    if (!dim || dim === 'count') return null  // per-each-of-count gives no useful $/unit
    const display = preferredUnitForDim(dim)
    const altCanonical = toCanonical(altPackSize, altPackUnit)
    const oneDisplay = toCanonical(1, display)
    if (!altCanonical || !oneDisplay) return null
    const perDisplay = altPrice * (oneDisplay.val / altCanonical.val)
    return `${money(perDisplay)}/${display}`
  }
  return null
}

function preferredUnitForDim(dim: 'weight' | 'volume' | 'count'): string {
  if (dim === 'weight') return 'oz'
  if (dim === 'volume') return 'fl_oz'
  return 'each'
}

// When the total comparison is unavailable, derive a per-unit savings label
// so the user still gets actionable info (e.g. "saves $0.48/lb").
function computePerUnitSavingsLabel(
  paidTotal: number,
  userUnit: string | null,
  userQuantity: number | null,
  altPerUnit: number,
  altPriceUnit: string,
): string | null {
  const pu = altPriceUnit.toLowerCase()
  // Only meaningful for per-weight/volume pricing where we can derive both sides.
  if (pu !== 'per_lb' && pu !== 'per_oz' && pu !== 'per_fl_oz' && pu !== 'per_g' && pu !== 'per_ml') return null
  const altUnit = pu.replace(/^per_/, '')
  if (!userUnit || userUnit === 'each' || userUnit === 'count') return null
  if (typeof userQuantity !== 'number' || userQuantity <= 0) return null
  // Check dimensions match
  const userC = toCanonical(userQuantity, userUnit)
  const altC = toCanonical(1, altUnit)
  if (!userC || !altC || userC.dim !== altC.dim) return null
  const userPerUnit = paidTotal / (userC.val / altC.val)
  const diff = userPerUnit - altPerUnit
  if (Math.abs(diff) < 0.005) return null
  if (diff > 0) return `saves ${money(diff)}/${altUnit}`
  return `${money(-diff)}/${altUnit} more`
}

// Compute the volume-normalized total: what the user would have paid at
// the alternative for their own purchase (their match's pack size × their
// receipt quantity), priced at this alternative's price.
//
// Returns null when the math isn't meaningful — e.g., units don't share a
// dimension, or no pack info on either side.
export function computeEquivalentTotal(
  altPrice: number,
  altPriceUnit: string,
  altPackSize: number | null,
  altPackUnit: string | null,
  userPackSize: number | null,
  userPackUnit: string | null,
  userQuantity: number | null,
  userUnit: string | null,
  matchType: 'exact' | 'equivalent' = 'exact',
): number | null {
  const qty = typeof userQuantity === 'number' && Number.isFinite(userQuantity) && userQuantity > 0 ? userQuantity : 1
  const pu = altPriceUnit.toLowerCase()

  // Per-weight / per-volume pricing: alt charges $X per unit of measure.
  // The user's purchase volume = quantity (if unit is the measure) or
  // quantity × pack_size (if quantity is in 'each'). Multiply by alt's
  // per-unit price.
  if (pu === 'per_lb' || pu === 'per_oz' || pu === 'per_fl_oz' || pu === 'per_g' || pu === 'per_ml') {
    const altMeasureUnit = pu.replace(/^per_/, '')
    let userTotalInAltMeasure: number | null = null
    if (userUnit && userUnit !== 'each' && userUnit !== 'count') {
      // User bought by weight/volume directly (e.g., 0.29 lb habanero).
      const userCanonical = toCanonical(qty, userUnit)
      const altCanonical = toCanonical(1, altMeasureUnit)
      if (!userCanonical || !altCanonical || userCanonical.dim !== altCanonical.dim) return null
      userTotalInAltMeasure = userCanonical.val / altCanonical.val
    } else if (userPackSize != null && userPackUnit) {
      // User bought packs; expand to total measure.
      const packCanonical = toCanonical(userPackSize * qty, userPackUnit)
      const altCanonical = toCanonical(1, altMeasureUnit)
      if (!packCanonical || !altCanonical || packCanonical.dim !== altCanonical.dim) return null
      userTotalInAltMeasure = packCanonical.val / altCanonical.val
    }
    if (userTotalInAltMeasure == null) return null
    return Number((altPrice * userTotalInAltMeasure).toFixed(2))
  }

  // Per-each / per-pack pricing: alt charges $X per pack. Find how many
  // alt-packs match the user's volume, then multiply.
  if (pu === 'per_each' || pu === 'per_pack') {
    if (altPackSize == null || !altPackUnit) {
      // No pack-size info. Safe for exact matches (same canonical = same
      // pack), but wrong for equivalents (different pack sizes unknown).
      if (matchType === 'exact') return Number((altPrice * qty).toFixed(2))
      return null
    }
    const altCanonical = toCanonical(altPackSize, altPackUnit)
    if (!altCanonical) return null

    // User's total volume in canonical units.
    let userCanonicalVal: number | null = null
    if (userUnit && userUnit !== 'each' && userUnit !== 'count') {
      const c = toCanonical(qty, userUnit)
      if (c && c.dim === altCanonical.dim) userCanonicalVal = c.val
    }
    if (userCanonicalVal == null && userPackSize != null && userPackUnit) {
      const c = toCanonical(userPackSize * qty, userPackUnit)
      if (c && c.dim === altCanonical.dim) userCanonicalVal = c.val
    }
    if (userCanonicalVal == null) {
      // Dimensions don't match or no user pack info. Safe for exact
      // matches (same canonical = same pack); wrong for equivalents.
      if (matchType === 'exact') return Number((altPrice * qty).toFixed(2))
      return null
    }

    const ratio = userCanonicalVal / altCanonical.val
    return Number((altPrice * ratio).toFixed(2))
  }

  return null
}

// Build the fallback product display when no chain-specific display_name is
// available. Always embeds the canonical's pack size so 3.5 oz vs 1 lb reads
// honestly even when only the canonical name is known.
function canonicalDisplay(
  name: string | null,
  size: number | null,
  unit: string | null,
): string {
  if (!name) return 'Price observation'
  if (size != null && unit) return `${name}, ${size} ${unit}`
  return name
}

function priceUnitLabel(price: number, unit: string): string {
  // price_unit on the materialized view is values like 'per_lb', 'per_each'.
  if (!unit || unit === 'per_each') return money(price)
  const stripped = unit.replace(/^per_/, '/')
  return `${money(price)}${stripped}`
}

// Format the receipt-side per-unit price ($0.70/oz) for cross-pack-size
// comparison. Returns undefined for non-weight/volume lines (single each
// with no unit) so the modal can omit the line entirely. parse.mjs sets
// unit_price = member_price / quantity for weight/volume lines.
function receiptUnitPriceLabel(item: ApiItem): string | undefined {
  const u = item.unit
  const v = item.unit_price
  if (v == null || !Number.isFinite(v) || v <= 0) return undefined
  if (!u || u === 'each' || u === 'count') return undefined
  return `$${v.toFixed(v < 1 ? 2 : 2)}/${u}`
}

// ── main entry ─────────────────────────────────────────────────────────────

/**
 * Convert the API response into the rich Receipt shape the UI expects.
 * Returns a Receipt with all groups present, even when comparisons are empty.
 */
export function toReceipt(api: CompareResponse): Receipt {
  const matchedItems: ReceiptItem[] = []
  const unmatchedItems: ReceiptItem[] = []
  // Per-chain accumulator. `total` = sum of THIS chain's prices for items it
  // actually has, `paid` = sum of user-paid prices for THE SAME subset. The
  // savings number is paid-total over that subset, not over the whole basket
  // — otherwise a chain that prices 4 of 19 items looks artificially cheap.
  const perStoreTotals = new Map<string, {
    total: number
    paid: number
    dist: number
    matched_count: number
  }>()

  api.items.forEach((apiItem, idx) => {
    if (apiItem.item_type === 'skip') return

    const id = itemId(apiItem, idx)
    const paid = apiItem.member_price
    const detail = detailLine(apiItem)
    // The route pre-computes user_display_name with the right fallback chain
    // (OFF pick name when user picked OFF, canonical name for in-house, OCR
    // description as last resort). Prefer that over local re-derivation.
    const displayName = apiItem.user_display_name ?? apiItem.match?.name ?? apiItem.description

    // Build per-store price map from alternatives. The API returns up to two
    // rows per (canonical, store): one shelf-tier, one member-tier. Group
    // them so a single StorePrice carries both (the modal shows shelf+member
    // side-by-side when they differ).
    const byStoreId = new Map<number, { shelf?: typeof apiItem.alternatives[number]; member?: typeof apiItem.alternatives[number] }>()
    for (const alt of apiItem.alternatives ?? []) {
      const entry = byStoreId.get(alt.store_id) ?? {}
      if (alt.pricing_tier === 'member') entry.member = alt
      else entry.shelf = alt
      byStoreId.set(alt.store_id, entry)
    }

    const prices: Record<string, StorePrice> = {}
    for (const { shelf, member } of byStoreId.values()) {
      // Prefer the shelf row as the public-facing price; fall back to member
      // if the seed only ever supplied a member-tier observation. (Rare —
      // most chains write shelf even when member is present.)
      const primary = shelf ?? member
      if (!primary) continue
      const chainName = primary.chain_name
      const distance = Number(primary.distance_miles)

      // If the same chain has multiple stores priced, prefer the closer one
      // so the comparison row points at the store the user can actually go to.
      const existing = prices[chainName]
      if (!existing || distance < parseDistMiles(existing.dist)) {
        // Prefer the user's per-item pack (override or matched candidate)
        // over the canonical's default — this is what makes "I bought 3 ×
        // 32oz pizzas" volume-normalize correctly against an alt store
        // selling 16oz packs.
        const userPackSize = apiItem.user_pack_size ?? apiItem.match?.package_size ?? null
        const userPackUnit = apiItem.user_pack_unit ?? apiItem.match?.package_unit ?? null
        prices[chainName] = altToStorePrice(
          primary,
          paid,
          apiItem.match?.score ?? 0,
          apiItem.match?.name ?? null,
          userPackSize,
          userPackUnit,
          apiItem.quantity,
          apiItem.unit,
        )
        // Attach member_price when there's a real discount vs shelf.
        if (member && shelf && Number(member.weighted_price) < Number(shelf.weighted_price) - 0.01) {
          prices[chainName].member_price = Number(member.weighted_price)
        }
      }
    }

    // Per-store totals are accumulated below from item.prices, NOT from raw
    // alternatives, so the basket math only counts items the chosen-per-chain
    // store actually carries. This is what makes the savings number honest.
    // Skip items where equivalent_total is unavailable — adding the raw
    // per-unit price (e.g. $2.99/lb) against the user's total ($7.39 for
    // 2.13 lb) would produce phantom savings.
    for (const [chainName, sp] of Object.entries(prices)) {
      if (sp.comparison_unavailable) continue
      const altTotal = sp.equivalent_total ?? sp.price
      const dist = parseDistMiles(sp.dist)
      const tot = perStoreTotals.get(chainName) ?? {
        total: 0,
        paid: 0,
        dist: Number.POSITIVE_INFINITY,
        matched_count: 0,
      }
      tot.total += altTotal
      tot.paid += paid
      tot.dist = Math.min(tot.dist, dist)
      tot.matched_count += 1
      perStoreTotals.set(chainName, tot)
    }

    const receiptItem: ReceiptItem = {
      id,
      name: displayName,
      detail,
      paid,
      quantity: apiItem.quantity,
      unit: apiItem.unit,
      match_confidence: apiItem.match?.score ?? 0,
      prices,
      reason: apiItem.informational_only
        ? "We know this product but don't have nearby price data yet"
        : !apiItem.match
          ? "Not in our catalog yet — couldn't compare to nearby stores"
          : Object.keys(prices).length === 0
            ? 'No nearby store has reported this price yet'
            : undefined,
      unit_price_label: receiptUnitPriceLabel(apiItem),
      // OFF enrichment baked into /api/compare's response — image, Nutri-Score,
      // NOVA group, ingredients, allergens, nutriments. Null when no link.
      enrichment: apiItem.enrichment,
      informational_only: apiItem.informational_only,
    }

    if (apiItem.match) {
      matchedItems.push(receiptItem)
    } else if (apiItem.item_type === 'compare') {
      unmatchedItems.push(receiptItem)
    } else {
      // 'contribute' items go in the matched bucket if we have a match
      // (rare — household items aren't usually in canonical_products yet),
      // otherwise unmatched.
      unmatchedItems.push(receiptItem)
    }
  })

  const categories: Category[] = []
  if (matchedItems.length > 0) {
    categories.push({
      id: 'items',
      label: 'Items compared',
      icon: '🧾',
      items: matchedItems,
    })
  }
  if (unmatchedItems.length > 0) {
    categories.push({
      id: 'unmatched',
      label: 'No Comparison Found',
      icon: null,
      isUnmatched: true,
      items: unmatchedItems,
    })
  }

  // Build per-store comparisons. The savings is computed against the SAME
  // subset of items that this store has prices for — not the whole basket.
  // A store that prices 4 of 19 items used to look artificially cheap because
  // we were dividing its 4-item total by the 19-item paid total.
  const totalCompared = matchedItems.length
  const comparisons: Record<string, StoreComparison> = {}
  for (const [storeName, { total, paid, dist, matched_count }] of perStoreTotals.entries()) {
    const saves = paid - total
    const pct = paid > 0 ? Math.round((saves / paid) * 100) : 0
    comparisons[storeName] = {
      dist: dist < 0.1 ? 'nearby' : `${dist.toFixed(1)} mi`,
      total,
      paid,
      saves,
      pct,
      matched_count,
      total_compared: totalCompared,
    }
  }

  return {
    store: api.receipt.store_name || 'Receipt',
    address: api.receipt.store_address ?? '',
    date: fmtDate(api.receipt.receipt_date),
    total: api.receipt.receipt_total ?? matchedItems.reduce((s, i) => s + i.paid, 0),
    items_count: api.summary.total_items,
    compared_count: api.summary.matched,
    categories,
    comparisons,
  }
}

// ── tiny utility ───────────────────────────────────────────────────────────

function parseDistMiles(dist: string): number {
  if (dist === 'nearby') return 0
  const m = /([0-9.]+)\s*mi/.exec(dist)
  return m ? Number(m[1]) : Infinity
}

// ── re-export so consumers don't need a second import ─────────────────────

export type { Freshness } from '@/components/aftercart/data'
