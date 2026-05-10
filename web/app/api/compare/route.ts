/**
 * POST /api/compare  (AfterCart-BC variant — semantic comparison engine)
 *
 * Second half of the two-stage flow. The user's confirmed picks are turned
 * into a per-pick semantic search against the local OFF SQLite, restricted
 * to barcodes priced at chains within radius. An LLM precision rerank prunes
 * the candidates to genuinely comparable products. We then look up the
 * priced observations for the kept (chain, barcode) pairs.
 *
 *   Stage 1: POST /api/match    { image, location?, radius_miles? }
 *   Stage 2: POST /api/compare  { parsed, corrections, interpretations?, location?, radius_miles? }   ← this route
 *
 * Differences vs the legacy tier-based architecture:
 *   • No canonical_barcodes bridge for prices (canonical_barcodes is only
 *     used to find an OFF barcode for ENRICHMENT lookup when the user picked
 *     in-house). Prices are found via semantic search, not bridge traversal.
 *   • No equivalence_groups graph traversal.
 *   • No live OFF-category peer lookup as a separate tier — semantic recall
 *     subsumes both static and live equivalence.
 *   • LLM rerank is part of the comparison generation, not a post-filter.
 *
 * Response shape preserved so the existing adapter renders unchanged.
 */

import { NextRequest } from 'next/server'

import { matchItems } from '@/lib/receipts/match.mjs'
import { semanticAlternatives } from '@/lib/receipts/semantic-compare.mjs'
import { getPricedBarcodeIndex } from '@/lib/receipts/priced-barcode-index.mjs'
import { query } from '@/lib/receipts/db.mjs'
import {
  getSharedOff,
  getEnrichmentBatch,
  lookupByBarcode,
  getProductPack,
} from '@/lib/off/query.mjs'

type AutoMatchRow = {
  match: { canonical_id: number; score: number } | null
}

const DEFAULT_LOCATION = { lon: -121.7617, lat: 38.5382 } // UC Davis campus
const DEFAULT_RADIUS_MILES = 15

export const runtime = 'nodejs'
export const maxDuration = 60

type InHouseChoice  = { kind: 'in-house'; canonical_id: number }
type OffChoice      = { kind: 'off'; barcode: string }
type NoneChoice     = { kind: 'none' }
type Choice         = InHouseChoice | OffChoice | NoneChoice

type ValueOverrides = {
  price_override?: number
  quantity_override?: number
  unit_override?: string
  pack_size_override?: number
  pack_unit_override?: string
}
type Correction     = ValueOverrides & { line_index: number; choice: Choice }

type LlmInterpretationLite = {
  line_index: number
  product_name: string | null
  brand_guess: string | null
  size_guess: string | null
  is_produce_or_generic?: boolean | null
}

type ParsedItem = {
  raw_text: string
  description: string
  code?: string | null
  quantity?: number | null
  unit?: string | null
  unit_price?: number | null
  shelf_price?: number | null
  member_price?: number | null
  is_store_brand?: boolean | null
  item_type?: 'compare' | 'contribute' | 'skip' | null
}

type ParsedReceipt = {
  store_name?: string | null
  store_address?: string | null
  receipt_date?: string | null
  receipt_total?: number | null
  item_count?: number | null
  items?: ParsedItem[]
}

type RequestBody = {
  parsed?: ParsedReceipt
  corrections?: Correction[]
  interpretations?: LlmInterpretationLite[]
  location?: { lon: number; lat: number }
  radius_miles?: number
  chain_detected?: string | null
}

// PriceRow shape returned by semanticAlternatives() (unchanged from the
// legacy nearbyPrices() contract so the existing rendering code keeps working).
type PriceRow = {
  user_kind: 'barcode' | 'canonical'
  user_line_index: number
  user_barcode: string | null
  user_canonical_id: number | null
  result_barcode: string | null
  result_canonical_id: number | null
  weighted_price: string | number
  weighted_price_per: string | number | null
  price_unit: string | null
  pricing_tier: 'shelf' | 'member' | 'sale'
  observation_count: string | number
  most_recent_observation: string
  freshness: 'green' | 'yellow' | 'red'
  store_id: number
  osm_id: string | number | null
  display_name: string
  address_full: string | null
  snap_authorized: boolean
  distance_miles: string | number
  chain_id: number
  chain_name: string
  match_type: 'barcode_exact' | 'equivalent' | 'canonical_exact'
  equivalence_strength: string | number
  equivalence_reason?: string | null
}

function deriveUnitPrice(item: ParsedItem): number | null {
  if (typeof item.unit_price === 'number' && Number.isFinite(item.unit_price) && item.unit_price > 0) {
    return Number(item.unit_price.toFixed(4))
  }
  const u = item.unit
  const q = item.quantity
  const p = item.member_price
  if (!u || u === 'each' || u === 'count') return null
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0) return null
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return null
  return Number((p / q).toFixed(4))
}

/**
 * canonical_barcodes forward (canonical → barcodes[]). Used ONLY for
 * enrichment hydration now — we look up the canonical's first linked OFF
 * barcode to fetch its image / nutrition data. Prices come from the
 * semantic engine, which doesn't need this bridge.
 */
async function getCanonicalBarcodes(canonicalIds: number[]): Promise<Map<number, string[]>> {
  if (!canonicalIds.length) return new Map()
  const rows = await query(
    `SELECT canonical_id, barcode FROM canonical_barcodes
     WHERE canonical_id = ANY($1::int[]) ORDER BY confidence DESC`,
    [canonicalIds],
  )
  const out = new Map<number, string[]>()
  for (const r of rows as Array<{ canonical_id: number; barcode: string }>) {
    const arr = out.get(r.canonical_id) ?? []
    arr.push(r.barcode)
    out.set(r.canonical_id, arr)
  }
  return out
}

async function getCanonicalsByIds(canonicalIds: number[]): Promise<Map<number, Record<string, unknown>>> {
  if (!canonicalIds.length) return new Map()
  const rows = await query(
    `SELECT canonical_id, name, brand, package_size, package_unit, pricing_unit, category_id
     FROM canonical_products WHERE canonical_id = ANY($1::int[])`,
    [canonicalIds],
  )
  const out = new Map<number, Record<string, unknown>>()
  for (const r of rows as Array<{ canonical_id: number } & Record<string, unknown>>) {
    out.set(r.canonical_id, r)
  }
  return out
}

export async function POST(req: NextRequest) {
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = body.parsed
  if (!parsed || !Array.isArray(parsed.items)) {
    return Response.json(
      { error: 'Body must include "parsed" (the receipt parsed by /api/match)' },
      { status: 400 },
    )
  }
  const corrections = Array.isArray(body.corrections) ? body.corrections : []
  const interpretations = Array.isArray(body.interpretations) ? body.interpretations : []
  const location = body.location ?? DEFAULT_LOCATION
  const radiusMiles = body.radius_miles ?? DEFAULT_RADIUS_MILES

  // Index interpretations by line_index for quick lookup.
  const interpByIdx = new Map<number, LlmInterpretationLite>()
  for (const it of interpretations) {
    if (typeof it.line_index === 'number') interpByIdx.set(it.line_index, it)
  }

  // ── Step 1: collect corrections by line_index ──────────────────────────
  const correctionByIdx = new Map<number, Choice>()
  const fullCorrectionByIdx = new Map<number, Correction>()
  for (const c of corrections) {
    if (typeof c.line_index === 'number' && c.choice) correctionByIdx.set(c.line_index, c.choice)
    if (typeof c.line_index === 'number') fullCorrectionByIdx.set(c.line_index, c)
  }

  // Auto-match unedited lines (the matcher still returns canonical_ids only —
  // this is the cheap in-memory matcher, just to populate canonical_id when
  // the user didn't explicitly correct).
  const autoMatches = (await matchItems(parsed.items as unknown as Parameters<typeof matchItems>[0])) as AutoMatchRow[]

  function applyOverrides(item: ParsedItem, line_index: number): ParsedItem {
    const c = fullCorrectionByIdx.get(line_index)
    if (!c) return item
    const out = { ...item }
    if (typeof c.price_override === 'number' && Number.isFinite(c.price_override) && c.price_override > 0) {
      out.shelf_price = c.price_override
      out.member_price = c.price_override
      out.unit_price = null
    }
    if (typeof c.quantity_override === 'number' && Number.isFinite(c.quantity_override) && c.quantity_override > 0) {
      out.quantity = c.quantity_override
      out.unit_price = null
    }
    if (typeof c.unit_override === 'string' && c.unit_override) {
      out.unit = c.unit_override
      out.unit_price = null
    }
    return out
  }

  // ── Step 2: resolve each line into the user's picked identity. ─────────
  type Resolved = {
    line_index: number
    item: ParsedItem
    chosen_off_barcode: string | null
    canonical_id: number | null
    suggested_match_score: number | null
  }
  const resolved: Resolved[] = (parsed.items ?? []).map((rawItem, line_index) => {
    const item = applyOverrides(rawItem, line_index)
    const correction = correctionByIdx.get(line_index)
    const auto = autoMatches[line_index]?.match ?? null

    if (!correction) {
      return {
        line_index,
        item,
        chosen_off_barcode: null,
        canonical_id: auto?.canonical_id ?? null,
        suggested_match_score: auto?.score ?? null,
      }
    }
    if (correction.kind === 'in-house') {
      return {
        line_index,
        item,
        chosen_off_barcode: null,
        canonical_id: correction.canonical_id,
        suggested_match_score: auto?.score ?? null,
      }
    }
    if (correction.kind === 'off') {
      return {
        line_index,
        item,
        chosen_off_barcode: correction.barcode,
        canonical_id: null,
        suggested_match_score: null,
      }
    }
    return {
      line_index,
      item,
      chosen_off_barcode: null,
      canonical_id: null,
      suggested_match_score: null,
    }
  })

  // ── Step 3: hydrate enrichment + canonical metadata BEFORE semantic call,
  //          since the semantic pick descriptors need display_name + pack info.
  const offDb = getSharedOff()

  const canonicalIdsForBridge = Array.from(new Set(
    resolved.map(r => r.canonical_id).filter((id): id is number => typeof id === 'number'),
  ))
  const canonicalToBarcodes = await getCanonicalBarcodes(canonicalIdsForBridge)
  const canonicalsById = await getCanonicalsByIds(canonicalIdsForBridge)

  // Build enrichment lookup set: every chosen OFF barcode + every canonical's
  // first linked OFF barcode (for enrichment fallback when user picked in-house).
  const enrichmentLookupBarcodes: string[] = []
  for (const r of resolved) {
    if (r.chosen_off_barcode) {
      enrichmentLookupBarcodes.push(r.chosen_off_barcode)
    } else if (r.canonical_id != null) {
      const linked = canonicalToBarcodes.get(r.canonical_id)
      if (linked && linked.length) enrichmentLookupBarcodes.push(linked[0])
    }
  }
  const enrichments = offDb && enrichmentLookupBarcodes.length
    ? getEnrichmentBatch(offDb, enrichmentLookupBarcodes)
    : new Map()

  // Pre-fetch user-pick OFF pack info (used for the semantic descriptor's
  // pack field AND for the per-row unit pricing in the adapter).
  const userPickPackByBarcode = new Map<string, { package_size: number | null; package_unit: string | null; product_name: string | null }>()
  if (offDb) {
    for (const r of resolved) {
      if (r.chosen_off_barcode && !userPickPackByBarcode.has(r.chosen_off_barcode)) {
        try {
          const pack = getProductPack(offDb, r.chosen_off_barcode)
          if (pack) userPickPackByBarcode.set(r.chosen_off_barcode, pack)
        } catch { /* ignore */ }
      }
    }
  }

  // ── Step 4: build SemanticPick[] for the comparison engine. ────────────
  // For each resolved entry that has SOMETHING to search on (a barcode pick
  // OR a canonical_id with a name), compose a descriptor.
  type SemanticPick = {
    line_index: number
    display_name: string
    brand: string | null
    pack_size: number | null
    pack_unit: string | null
    chosen_off_barcode: string | null
    canonical_id: number | null
    interpretation_name: string | null
    receipt_text: string | null
    is_canonical: boolean
  }
  const semanticPicks: SemanticPick[] = []
  for (const r of resolved) {
    const interp = interpByIdx.get(r.line_index) ?? null
    const canonical = r.canonical_id != null ? canonicalsById.get(r.canonical_id) ?? null : null
    const userOffPack = r.chosen_off_barcode ? userPickPackByBarcode.get(r.chosen_off_barcode) : null
    const userEnr = r.chosen_off_barcode
      ? (enrichments.get(r.chosen_off_barcode) as { product_name?: string | null; brands?: string | null } | undefined) ?? null
      : null

    // Display name preference: user enrichment > OFF pack > canonical > interpretation > receipt text
    const display_name =
      userEnr?.product_name
      ?? userOffPack?.product_name
      ?? (canonical?.name as string | null)
      ?? interp?.product_name
      ?? r.item.description
      ?? r.item.raw_text
      ?? ''

    const brand =
      userEnr?.brands
      ?? (canonical?.brand as string | null)
      ?? interp?.brand_guess
      ?? null

    // Pack size resolution: explicit override > canonical default > OFF pack
    const c = fullCorrectionByIdx.get(r.line_index)
    const pack_size = (typeof c?.pack_size_override === 'number' && Number.isFinite(c.pack_size_override) && c.pack_size_override > 0)
      ? c.pack_size_override
      : (canonical?.package_size != null ? Number(canonical.package_size)
         : (userOffPack?.package_size ?? null))
    const pack_unit = (typeof c?.pack_unit_override === 'string' && c.pack_unit_override)
      ? c.pack_unit_override
      : (typeof canonical?.package_unit === 'string' ? canonical.package_unit
         : (userOffPack?.package_unit ?? null))

    // Skip lines with no signal whatsoever (no barcode, no canonical, no
    // interpretation, no description). Semantic search would return nothing
    // useful and the LLM would be wasted.
    if (!display_name && !r.chosen_off_barcode && r.canonical_id == null) continue

    semanticPicks.push({
      line_index: r.line_index,
      display_name: String(display_name).trim(),
      brand,
      pack_size,
      pack_unit,
      chosen_off_barcode: r.chosen_off_barcode,
      canonical_id: r.canonical_id,
      interpretation_name: interp?.product_name ?? null,
      receipt_text: r.item.description || r.item.raw_text || null,
      is_canonical: !!r.canonical_id && !r.chosen_off_barcode,
    })
  }

  // ── Step 5: load the priced-barcode index for this location/radius ──────
  const chainsIndex = await getPricedBarcodeIndex({ location, radiusMiles })

  // ── Step 6: run the semantic comparison engine ─────────────────────────
  const priceRows: PriceRow[] = (offDb && chainsIndex.size > 0 && semanticPicks.length > 0)
    ? (await semanticAlternatives({
        picks: semanticPicks,
        chainsIndex,
        offDb,
        receiptChainName: body.chain_detected ?? parsed.store_name ?? null,
        location,
        radiusMiles,
      })) as PriceRow[]
    : []

  // ── Step 7: group price rows by line_index for the response shape. ─────
  const pricesByLineIndex = new Map<number, PriceRow[]>()
  for (const row of priceRows) {
    const arr = pricesByLineIndex.get(row.user_line_index) ?? []
    arr.push(row)
    pricesByLineIndex.set(row.user_line_index, arr)
  }

  // ── Step 8: hydrate result-side OFF pack info. ─────────────────────────
  // Need pack data for every result_barcode so the alt cards can show
  // "Lucerne French Bread, 24 oz" instead of just the store's display name.
  const productPackBarcodes = new Set<string>(enrichmentLookupBarcodes)
  for (const row of priceRows) {
    if (row.result_barcode) productPackBarcodes.add(row.result_barcode)
  }
  const offPackByBarcode = new Map<string, { package_size: number | null; package_unit: string | null; product_name: string | null }>()
  if (offDb) {
    for (const bc of productPackBarcodes) {
      try {
        const pack = getProductPack(offDb, bc)
        if (pack) offPackByBarcode.set(bc, pack)
      } catch { /* ignore */ }
    }
  }

  // ── Step 9: render items. ──────────────────────────────────────────────
  const items = resolved.map((r) => {
    const enrichmentBarcode = r.chosen_off_barcode
      ?? (r.canonical_id != null ? canonicalToBarcodes.get(r.canonical_id)?.[0] : null)
      ?? null
    const enrichment = enrichmentBarcode ? (enrichments.get(enrichmentBarcode) ?? null) : null
    const canonical = r.canonical_id != null ? canonicalsById.get(r.canonical_id) ?? null : null

    const c = fullCorrectionByIdx.get(r.line_index)
    const offPack = r.chosen_off_barcode ? offPackByBarcode.get(r.chosen_off_barcode) : null
    const userPackSize = (typeof c?.pack_size_override === 'number' && Number.isFinite(c.pack_size_override) && c.pack_size_override > 0)
      ? c.pack_size_override
      : (canonical?.package_size != null ? Number(canonical.package_size)
         : (offPack?.package_size ?? null))
    const userPackUnit = (typeof c?.pack_unit_override === 'string' && c.pack_unit_override)
      ? c.pack_unit_override
      : (typeof canonical?.package_unit === 'string' ? canonical.package_unit
         : (offPack?.package_unit ?? null))

    const rawAlts = (pricesByLineIndex.get(r.line_index) ?? []) as PriceRow[]

    // Dedupe per store: keep the strongest LLM rating; tie-break by lower
    // weighted_price. (Was: tier rank then price; semantic-only flow no
    // longer needs tier rank.)
    const altsByStore = new Map<number, PriceRow>()
    for (const a of rawAlts) {
      const existing = altsByStore.get(a.store_id)
      if (!existing) { altsByStore.set(a.store_id, a); continue }
      const sa = Number(a.equivalence_strength) || 0
      const se = Number(existing.equivalence_strength) || 0
      if (sa > se) altsByStore.set(a.store_id, a)
      else if (sa === se && Number(a.weighted_price) < Number(existing.weighted_price)) {
        altsByStore.set(a.store_id, a)
      }
    }

    const alternatives = Array.from(altsByStore.values()).map(a => {
      const altOffPack = a.result_barcode ? offPackByBarcode.get(a.result_barcode) : null
      const productLabel = altOffPack?.product_name
        ?? (a.result_canonical_id != null
              ? (canonicalsById.get(a.result_canonical_id)?.name as string | null) ?? null
              : null)
        ?? null
      return {
        // Legacy fields (adapter consumes these as-is)
        user_canonical_id: a.user_canonical_id ?? r.canonical_id ?? 0,
        canonical_id:      a.result_canonical_id ?? 0,
        weighted_price:    a.weighted_price,
        price_unit:        a.price_unit ?? guessPriceUnit(),
        pricing_tier:      a.pricing_tier,
        observation_count: a.observation_count,
        most_recent_observation: a.most_recent_observation,
        freshness:         a.freshness,
        store_id:          a.store_id,
        address:           a.address_full ?? a.display_name,
        distance_miles:    a.distance_miles,
        chain_id:          a.chain_id,
        chain_name:        a.chain_name,
        display_name:      productLabel ?? a.display_name,
        match_type:        'equivalent' as const,
        equivalence_strength: a.equivalence_strength,
        equiv_name:        productLabel,
        equiv_pack_size:   altOffPack?.package_size ?? null,
        equiv_pack_unit:   altOffPack?.package_unit ?? null,
        // Additive: barcode-first metadata
        user_barcode:        a.user_barcode,
        result_barcode:      a.result_barcode,
        user_kind:           a.user_kind,
        bc_match_type:       'equivalent' as const,
        osm_id:              a.osm_id != null ? String(a.osm_id) : null,
        snap_authorized:     a.snap_authorized,
        weighted_price_per:  a.weighted_price_per,
        equivalence_reason:  a.equivalence_reason ?? null,
      }
    })

    return {
      raw_text: r.item.raw_text,
      description: r.item.description,
      code: r.item.code,
      quantity: r.item.quantity,
      unit: r.item.unit,
      unit_price: deriveUnitPrice(r.item),
      shelf_price: r.item.shelf_price,
      member_price: r.item.member_price,
      is_store_brand: r.item.is_store_brand,
      item_type: r.item.item_type,
      // `match` represents what we identified the user's item as. For
      // canonical picks, the canonical row. For OFF picks (no canonical),
      // synthesize from OFF Products so the UI's `!item.match` "unmatched"
      // check correctly treats the item as identified.
      match: canonical
        ? {
            canonical_id: canonical.canonical_id,
            name: canonical.name,
            brand: canonical.brand,
            package_size: canonical.package_size,
            package_unit: canonical.package_unit,
            pricing_unit: canonical.pricing_unit,
            score: r.suggested_match_score,
          }
        : (r.chosen_off_barcode
          ? (() => {
              const enr = enrichment as { product_name?: string | null; generic_name?: string | null; brands?: string | null } | null
              const directOff = offDb ? lookupByBarcode(offDb, r.chosen_off_barcode) as { product_name?: string | null; brands?: string | null } | null : null
              const name = enr?.product_name ?? enr?.generic_name ?? directOff?.product_name ?? r.item.description ?? 'Unknown product'
              const brand = enr?.brands ?? directOff?.brands ?? null
              return {
                canonical_id: 0,  // sentinel — no canonical row exists for this OFF-only pick
                name,
                brand,
                package_size: offPack?.package_size ?? null,
                package_unit: offPack?.package_unit ?? null,
                pricing_unit: 'per_each',
                score: 1.0,
              }
            })()
          : null),
      alternatives,
      enrichment,
      // Informational-only when the user has an identified item AND we got
      // zero alternatives — we know the product but have no nearby data
      // (and no semantic peer either). Keeps the UI's graceful cold-start.
      informational_only: !!((r.chosen_off_barcode || r.canonical_id != null) && alternatives.length === 0),
      picked_off_barcode: r.chosen_off_barcode,
      user_display_name: (() => {
        if (r.chosen_off_barcode && enrichment) {
          const enr = enrichment as { product_name?: string | null; generic_name?: string | null; brands?: string | null }
          if (enr.product_name) return enr.product_name
          if (enr.generic_name) return enr.generic_name
          if (enr.brands) return enr.brands
        }
        if (r.chosen_off_barcode) {
          const offDirect = offDb ? lookupByBarcode(offDb, r.chosen_off_barcode) as { product_name?: string | null } | null : null
          if (offDirect?.product_name) return offDirect.product_name
        }
        if (canonical?.name && typeof canonical.name === 'string') return canonical.name
        return r.item.description || r.item.raw_text || 'Unknown product'
      })(),
      user_pack_size: userPackSize,
      user_pack_unit: userPackUnit,
    }
  })

  const compareItems = items.filter((i) => i.item_type === 'compare')
  const matchedCount = compareItems.filter((i) => i.alternatives.length > 0 || i.match).length

  return Response.json({
    receipt: {
      store_name: parsed.store_name,
      store_address: parsed.store_address,
      receipt_date: parsed.receipt_date,
      receipt_total: parsed.receipt_total,
      item_count: parsed.item_count,
    },
    chain_detected: body.chain_detected ?? null,
    items,
    summary: {
      total_items: items.length,
      compare_items: compareItems.length,
      matched: matchedCount,
      unmatched: compareItems.length - matchedCount,
    },
    schema_warnings: [],
  })
}

/**
 * In the semantic-only flow, every alternative is barcode-keyed and the
 * stored `prices.price` is the TOTAL paid for one pack. The basis is always
 * `per_each`. The pack's physical unit (oz, lb) describes what's INSIDE the
 * pack — that's separate metadata carried via equiv_pack_size/equiv_pack_unit
 * and used by the adapter for volume-normalized comparisons.
 */
function guessPriceUnit(): string {
  return 'per_each'
}
