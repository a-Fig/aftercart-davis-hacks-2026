/**
 * POST /api/compare
 *
 * Second half of the two-stage comparison flow. Takes the parsed receipt
 * echoed back from /api/match plus a per-line-item correction map (the user's
 * confirmed picks from the ReviewScreen), and produces the price comparison
 * the user sees on ResultsScreen.
 *
 *   Stage 1: POST /api/match    { image, location?, radius_miles? }
 *   Stage 2: POST /api/compare  { parsed, corrections, location?, radius_miles? }   ←  this route
 *
 * Pipeline:
 *   1. Resolve each correction to a canonical_id:
 *      - { kind: 'in-house', canonical_id } → use canonical_id directly
 *      - { kind: 'off', barcode }           → look up canonical_barcodes
 *                                             (informational-only when no link exists)
 *      - { kind: 'none' }                   → skip (explicit no-match)
 *   2. nearbyPrices() — same as before, just with the corrected canonical IDs.
 *   3. Pull OFF enrichment for each canonical via canonical_barcodes → OFF SQLite
 *      so the modal can render image + Nutri-Score + ingredients + allergens
 *      without a second client round-trip.
 *
 * The response shape mirrors the legacy single-stage shape so the existing
 * adapter (web/lib/api/adapter.ts) and ResultsScreen render identically — the
 * only addition is `item.enrichment` (nullable OffEnrichment).
 */

import { NextRequest } from 'next/server'

import { matchItems, matchOne } from '@/lib/receipts/match.mjs'
import { nearbyPrices } from '@/lib/receipts/compare.mjs'
import { query } from '@/lib/receipts/db.mjs'
import { getSharedOff, getEnrichmentBatch, lookupByBarcode } from '@/lib/off/query.mjs'

// matchItems is in .mjs — typed as unknown by TS. Cast at the call site.
type AutoMatchRow = {
  match: { canonical_id: number; score: number } | null
}

// Default location: central Davis, CA. The team is moving there for the
// hackathon and the seeded stores cluster around the Bay Area + Davis.
const DEFAULT_LOCATION = { lon: -121.7405, lat: 38.5449 }
// Effectively global for dev; drop to ~5 once on-site for the demo.
const DEFAULT_RADIUS_MILES = 10_000

export const runtime = 'nodejs'
export const maxDuration = 60

type InHouseChoice  = { kind: 'in-house'; canonical_id: number }
type OffChoice      = { kind: 'off'; barcode: string }
type NoneChoice     = { kind: 'none' }
type Choice         = InHouseChoice | OffChoice | NoneChoice
// User edits to OCR-parsed values + per-item pack size. Optional —
// undefined means "use whatever the parser produced (or the canonical's
// default pack)." When present, an override fully replaces the OCR / canonical
// value for downstream math (per-unit price, item totals, volume-normalized
// alt comparisons) and any future contribution to price_observations.
type ValueOverrides = {
  price_override?: number
  quantity_override?: number
  unit_override?: string
  pack_size_override?: number
  pack_unit_override?: string
}
type Correction     = ValueOverrides & { line_index: number; choice: Choice }

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
  location?: { lon: number; lat: number }
  radius_miles?: number
  chain_detected?: string | null
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
 * Look up canonical_barcodes for a set of barcodes. Returns the FIRST
 * canonical_id linked to each (in case multiple canonicals share a barcode,
 * which shouldn't happen in practice but is allowed by the schema).
 */
async function resolveBarcodesToCanonicals(barcodes: string[]): Promise<Map<string, number>> {
  if (!barcodes.length) return new Map()
  const rows = await query(
    `SELECT canonical_id, barcode FROM canonical_barcodes WHERE barcode = ANY($1::text[])`,
    [barcodes],
  )
  const out = new Map<string, number>()
  for (const r of rows as Array<{ canonical_id: number; barcode: string }>) {
    if (!out.has(r.barcode)) out.set(r.barcode, r.canonical_id)
  }
  return out
}

/**
 * Forward direction: for a set of canonical_ids, fetch all linked OFF barcodes.
 * Returns Map<canonical_id, barcode[]> (a canonical may have multiple).
 */
async function getCanonicalBarcodes(canonicalIds: number[]): Promise<Map<number, string[]>> {
  if (!canonicalIds.length) return new Map()
  const rows = await query(
    `SELECT canonical_id, barcode FROM canonical_barcodes WHERE canonical_id = ANY($1::int[]) ORDER BY confidence DESC`,
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

/**
 * Look up the canonical_products row by id — used to populate `match` for
 * user-confirmed in-house corrections (we don't re-run matchItems since the
 * user has already chosen).
 */
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
  const location = body.location ?? DEFAULT_LOCATION
  const radiusMiles = body.radius_miles ?? DEFAULT_RADIUS_MILES

  // Step 1: build per-line correction maps. The corrections array may be
  // sparse — any line not present in it is treated as "use whatever the
  // matcher would have picked," which we re-derive by rerunning matchItems
  // (cheap — the catalog is in-memory). This ensures the route is robust to
  // a client that only sends user-edited lines.
  const correctionByIdx = new Map<number, Choice>()
  for (const c of corrections) {
    if (typeof c.line_index === 'number' && c.choice) correctionByIdx.set(c.line_index, c.choice)
  }

  // Resolve OFF barcode picks to canonical_ids (when linked).
  const offBarcodesPicked = corrections
    .filter((c): c is Correction & { choice: OffChoice } => c.choice?.kind === 'off')
    .map((c) => c.choice.barcode)
  const barcodeToCanonical = await resolveBarcodesToCanonicals(offBarcodesPicked)

  // For lines without an explicit correction, use the auto-match. This keeps
  // the API forgiving for clients that haven't wired the review screen yet.
  // Cast through `unknown` because matchItems' JSDoc types describe item_type
  // as `string | undefined` while our ParsedItem permits `null` — the .mjs
  // implementation handles either fine.
  const autoMatches = (await matchItems(parsed.items as unknown as Parameters<typeof matchItems>[0])) as AutoMatchRow[]

  // Build a per-index lookup of the FULL correction (choice + value overrides
  // both live on the same Correction object). This is separate from
  // correctionByIdx (which only stores the choice tag) because we want to
  // pull overrides regardless of the choice variant.
  const fullCorrectionByIdx = new Map<number, Correction>()
  for (const c of corrections) {
    if (typeof c.line_index === 'number') fullCorrectionByIdx.set(c.line_index, c)
  }

  // Apply OCR-value overrides where the user edited them. Returns a NEW
  // ParsedItem object with the override values merged in — leaves the input
  // unchanged so any caller still holding the original ref sees raw OCR.
  function applyOverrides(item: ParsedItem, line_index: number): ParsedItem {
    const c = fullCorrectionByIdx.get(line_index)
    if (!c) return item
    const out = { ...item }
    if (typeof c.price_override === 'number' && Number.isFinite(c.price_override) && c.price_override > 0) {
      // The user confirmed "price I paid" — apply to both shelf and member
      // since most receipts have one number, and the rare two-tier receipts
      // are uncommonly the case where users edit. (If we later need to
      // preserve a shelf/member split through edits, surface two inputs in
      // the editor; until then, the simpler model wins.)
      out.shelf_price = c.price_override
      out.member_price = c.price_override
      // Clear unit_price so deriveUnitPrice recomputes from the new price.
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

  // Final canonical_id per line + provenance flag.
  //
  // `comparison_substitute_score`: when the user picked an OFF entry without a
  // canonical_barcodes link AND we found a comparable canonical via matchOne,
  // this carries the matchOne score (~0.5–1.0). Used downstream to relabel the
  // alt rows as `match_type: 'equivalent'` with the score as `equivalence_strength`
  // so the UI shows a `~similar` chip — never silently substitutes the user's
  // product identity.
  type Resolved = {
    line_index: number
    item: ParsedItem
    canonical_id: number | null
    chosen_off_barcode: string | null
    suggested_match_score: number | null
    comparison_substitute_score: number | null
  }
  const resolved: Resolved[] = (parsed.items ?? []).map((rawItem, line_index) => {
    const item = applyOverrides(rawItem, line_index)
    const correction = correctionByIdx.get(line_index)
    const auto = autoMatches[line_index]?.match ?? null

    if (!correction) {
      return {
        line_index,
        item,
        canonical_id: auto?.canonical_id ?? null,
        chosen_off_barcode: null,
        suggested_match_score: auto?.score ?? null,
        comparison_substitute_score: null,
      }
    }
    if (correction.kind === 'in-house') {
      return { line_index, item, canonical_id: correction.canonical_id, chosen_off_barcode: null, suggested_match_score: auto?.score ?? null, comparison_substitute_score: null }
    }
    if (correction.kind === 'off') {
      // Look up canonical via canonical_barcodes (a static, curated link table).
      // If a link exists, the comparison is exact (same product). If not, we'll
      // try matchOne in step 1b to find a comparable canonical for price lookup
      // — clearly labeled as a substitute, never relabeling the user's pick.
      const linkedCanonical = barcodeToCanonical.get(correction.barcode) ?? null
      return { line_index, item, canonical_id: linkedCanonical, chosen_off_barcode: correction.barcode, suggested_match_score: null, comparison_substitute_score: null }
    }
    // 'none'
    return { line_index, item, canonical_id: null, chosen_off_barcode: null, suggested_match_score: null, comparison_substitute_score: null }
  })

  // Step 1b — find a comparable canonical when the user picked an OFF entry
  // that has no curated canonical_barcodes link.
  //
  // What this is: a SUBSTITUTE search for price-comparison purposes. We are
  // never overwriting what the user bought (the user's pick stays the source
  // of truth for `picked_off_barcode` / `enrichment.product_name`). We're
  // finding "what canonical do we have prices for that's most similar to the
  // user's pick" so the comparison page can show alt-store prices for a
  // comparable product instead of an empty "no data" state.
  //
  // What's different from before: the resulting alts are flagged as
  // `match_type: 'equivalent'` with the matchOne score as `equivalence_strength`,
  // so the UI shows the existing `~similar` chip + caption instead of letting
  // the substitute masquerade as the user's exact product.
  //
  // We DON'T auto-write to canonical_barcodes — those should be deliberate
  // (curated or via enrich-canonicals-from-off.mjs --apply). Heuristic links
  // poison the table for every future scan of the same barcode.
  const offDb = getSharedOff()
  for (const r of resolved) {
    if (r.chosen_off_barcode && r.canonical_id == null) {
      try {
        let productName: string | null = null
        if (offDb) {
          const offProduct = lookupByBarcode(offDb, r.chosen_off_barcode) as { product_name?: string } | null
          productName = offProduct?.product_name ?? null
        }
        const searchText = productName || r.item.description || ''
        if (searchText) {
          const canonMatch = await matchOne(searchText) as { canonical_id: number; name: string; score: number } | null
          if (canonMatch && canonMatch.score >= 0.5) {
            r.canonical_id = canonMatch.canonical_id
            r.comparison_substitute_score = canonMatch.score
          }
        }
      } catch { /* derivation failed — item stays informational-only */ }
    }
  }

  // Step 2: price lookup for resolved canonicals.
  const matchedIds = Array.from(new Set(
    resolved.map((r) => r.canonical_id).filter((id): id is number => typeof id === 'number'),
  ))
  const priceRows = matchedIds.length > 0
    ? await nearbyPrices(matchedIds, location, radiusMiles)
    : []

  const pricesByCanonical = new Map<number, unknown[]>()
  for (const row of priceRows as Array<{ user_canonical_id: number }>) {
    const arr = pricesByCanonical.get(row.user_canonical_id) ?? []
    arr.push(row)
    pricesByCanonical.set(row.user_canonical_id, arr)
  }

  // Step 3: OFF enrichment. Build the barcode set we need:
  //   - Every resolved canonical's first canonical_barcodes entry, and
  //   - Every directly-picked OFF barcode (when the user picked OFF over in-house).
  const canonicalToBarcodes = await getCanonicalBarcodes(matchedIds)
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

  // Hydrate canonicals for the response's `match` shape (keeps adapter happy).
  const canonicalsById = await getCanonicalsByIds(matchedIds)

  const items = resolved.map((r) => {
    const enrichmentBarcode = r.chosen_off_barcode
      ?? (r.canonical_id != null ? canonicalToBarcodes.get(r.canonical_id)?.[0] : null)
      ?? null
    const enrichment = enrichmentBarcode ? (enrichments.get(enrichmentBarcode) ?? null) : null

    const canonical = r.canonical_id != null ? canonicalsById.get(r.canonical_id) ?? null : null

    // User's per-item pack: explicit override wins; otherwise fall back to the
    // matched canonical's default. This is what computeEquivalentTotal() uses
    // to volume-normalize the user's total against alt-store prices when the
    // alt's pack differs.
    const c = fullCorrectionByIdx.get(r.line_index)
    const userPackSize = (typeof c?.pack_size_override === 'number' && Number.isFinite(c.pack_size_override) && c.pack_size_override > 0)
      ? c.pack_size_override
      : (canonical?.package_size != null ? Number(canonical.package_size) : null)
    const userPackUnit = (typeof c?.pack_unit_override === 'string' && c.pack_unit_override)
      ? c.pack_unit_override
      : (typeof canonical?.package_unit === 'string' ? canonical.package_unit : null)

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
        : null,
      alternatives: r.canonical_id != null
        ? (() => {
            const raw = (pricesByCanonical.get(r.canonical_id) ?? []) as Array<Record<string, unknown>>
            // When the canonical was derived via the substitute search (user
            // picked OFF entry that had no canonical_barcodes link), the alts
            // are for a comparable-but-different product. Override the match
            // metadata so the UI shows a `~similar` chip with the matchOne
            // score as the equivalence strength — never letting a substitute
            // masquerade as the user's exact pick.
            if (r.comparison_substitute_score != null) {
              return raw.map((alt) => ({
                ...alt,
                match_type: 'equivalent',
                equivalence_strength: r.comparison_substitute_score,
              }))
            }
            return raw
          })()
        : [],
      enrichment,
      // When user chose 'off' but barcode has no canonical link — flag it so
      // the UI can show "we know this product but have no price data here yet."
      informational_only: !!(r.chosen_off_barcode && r.canonical_id == null),
      // The user's actual OFF pick barcode. Lets the UI display the user's
      // pick name even when the server routed to a different canonical for
      // price comparison.
      picked_off_barcode: r.chosen_off_barcode,
      // Display name that honors the user's actual pick. Source-of-truth for
      // every component that shows "what the user bought" — never the
      // substitute canonical we routed to for prices.
      user_display_name: (() => {
        if (r.chosen_off_barcode && enrichment) {
          const enr = enrichment as { product_name?: string | null; generic_name?: string | null; brands?: string | null }
          if (enr.product_name) return enr.product_name
          if (enr.generic_name) return enr.generic_name
          if (enr.brands) return enr.brands
        }
        if (canonical?.name && typeof canonical.name === 'string') return canonical.name
        return r.item.description || r.item.raw_text || 'Unknown product'
      })(),
      user_pack_size: userPackSize,
      user_pack_unit: userPackUnit,
    }
  })

  const compareItems = items.filter((i) => i.item_type === 'compare')
  const matchedCount = compareItems.filter((i) => i.match).length

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
