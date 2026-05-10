/**
 * Browser-side client for the two-stage receipt-comparison flow.
 *
 *   1. matchReceipt(file)       → POST /api/match     — returns parsed receipt + candidates
 *   2. compareReceipt(...)      → POST /api/compare   — returns price comparison given user picks
 *   3. searchOff(query)         → POST /api/off-search — free-text OFF lookup (review screen)
 *
 * Types here MUST mirror the route handlers' response shapes. If a server
 * response shape changes, update both sides in the same PR.
 */

// ── Shared types ────────────────────────────────────────────────────────────

export interface ApiReceipt {
  store_name: string
  store_address: string | null
  receipt_date: string | null
  receipt_total: number | null
  item_count: number | null
}

export interface ApiSummary {
  total_items: number
  compare_items: number
  matched: number
  unmatched: number
}

/**
 * A single nutriment value per 100g. The standard 8 macros are extracted as
 * top-level keys; everything else (vitamins, minerals, etc.) is folded in as
 * additional keys with whatever name OFF used.
 */
export interface OffNutriments {
  energy_kcal_100g?: number | null
  sugars_100g?: number | null
  sodium_100g?: number | null
  fat_100g?: number | null
  saturated_fat_100g?: number | null
  proteins_100g?: number | null
  fiber_100g?: number | null
  salt_100g?: number | null
  [extra: string]: number | string | null | undefined
}

/**
 * The Open Food Facts enrichment payload baked into a comparison response so
 * the modal can render image + Nutri-Score + ingredients + allergens without
 * a second client round-trip.
 */
export interface OffEnrichment {
  barcode: string
  product_name: string | null
  generic_name: string | null
  brands: string | null
  image_url: string | null
  serving_size: string | null
  quantity_raw: string | null
  package_size: number | null
  package_unit: string | null
  nutriscore_grade: 'a' | 'b' | 'c' | 'd' | 'e' | null
  nova_group: 1 | 2 | 3 | 4 | null
  ecoscore_grade: 'a' | 'b' | 'c' | 'd' | 'e' | null
  ingredients_text: string | null
  allergens: string[]
  traces: string[]
  additives: string[]
  nutriments: OffNutriments
}

// ── Normalization annotations ──────────────────────────────────────────────

export interface NormAnnotation {
  field: 'description' | 'brand' | 'size' | 'organic'
  original: string
  interpreted: string
  method: 'abbreviation_dict' | 'brand_prefix' | 'size_regex' | 'organic_flag'
}

// ── LLM interpretation ────────────────────────────────────────────────────

export interface LlmInterpretation {
  product_name: string
  brand_guess: string | null
  size_guess: string | null
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  is_produce_or_generic: boolean
}

// ── /api/match types ───────────────────────────────────────────────────────

/** A candidate the in-house matcher produced — points at a canonical_product. */
export interface InHouseCandidate {
  source: 'in-house'
  canonical_id: number
  name: string
  brand: string | null
  package_size: number | null
  package_unit: string | null
  pricing_unit: string
  score: number
  image_url: string | null
}

/** A candidate from the local OFF SQLite — points at a barcode + (optionally) a canonical via canonical_barcodes. */
export interface OffCandidate {
  source: 'off'
  barcode: string
  name: string | null
  brand: string | null
  quantity_raw: string | null
  package_size: number | null
  package_unit: string | null
  image_url: string | null
  score?: number | null
  enrichment?: OffEnrichment | null
  llm_reason?: string | null
}

export type MatchCandidate = InHouseCandidate | OffCandidate

export interface SuggestedMatch {
  source: 'in-house' | 'off' | 'canonical'
  canonical_id?: number | null
  barcode?: string | null
  name: string
  brand?: string | null
  package_size?: number | null
  package_unit?: string | null
  pricing_unit?: string
  score?: number | null
  reason?: string
  match_confidence?: 'high' | 'medium' | 'low'
  enrichment?: OffEnrichment | null
}

export interface MatchItem {
  line_index: number
  raw_text: string
  description: string
  description_raw?: string
  code: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  shelf_price: number | null
  member_price: number | null
  is_store_brand: boolean | null
  item_type: 'compare' | 'contribute' | 'skip'
  annotations?: NormAnnotation[]
  llm_interpretation?: LlmInterpretation | null
  suggested_match: SuggestedMatch | null
  candidates: MatchCandidate[]
  match_method?: 'llm' | 'canonical_fallback'
}

/**
 * The verbatim parsed receipt from gpt-parser.mjs / parse.mjs. The client
 * echoes this object back unchanged to /api/compare so we don't re-OCR.
 *
 * We type the items loosely because the heuristic and GPT pipelines emit
 * slight shape variations and the route normalizes downstream.
 */
export interface ParsedReceipt {
  store_name?: string | null
  store_address?: string | null
  receipt_date?: string | null
  receipt_total?: number | null
  item_count?: number | null
  items: Array<Record<string, unknown>>
}

export interface MatchResponse {
  receipt: ApiReceipt
  chain_detected: string | null
  parse_source?: 'heuristic' | 'gpt'
  /** @deprecated Use parse_source instead */
  chain_hint_source?: 'heuristic' | 'gpt'
  parsed: ParsedReceipt
  items: MatchItem[]
  summary: ApiSummary
  schema_warnings: string[]
  location_default: { lon: number; lat: number } | null
  radius_miles_default: number | null
}

// ── Correction payload (sent back to /api/compare) ─────────────────────────

// Per-row corrections to OCR-parsed price / quantity / unit + per-item pack
// size. Sent only when the user edited values in the review screen. The pack
// fields describe "what's in each item the user bought" (e.g., 32 oz per
// pizza when they bought 3 pizzas) — distinct from the receipt's quantity
// and from the canonical's default package_size.
export interface ReceiptValueOverrides {
  price_override?: number
  quantity_override?: number
  unit_override?: string
  pack_size_override?: number
  pack_unit_override?: string
}

export type Correction = ReceiptValueOverrides & (
  | { line_index: number; choice: { kind: 'in-house'; canonical_id: number } }
  | { line_index: number; choice: { kind: 'off'; barcode: string } }
  | { line_index: number; choice: { kind: 'none' } }
)

// ── /api/compare types ─────────────────────────────────────────────────────

export interface ApiMatch {
  canonical_id: number
  name: string
  brand: string | null
  package_size: number | null
  package_unit: string | null
  pricing_unit: string
  score: number | null
}

export interface ApiAlternative {
  // Legacy keys kept for adapter compatibility.
  user_canonical_id: number
  canonical_id: number
  weighted_price: string | number
  price_unit: string
  pricing_tier: 'shelf' | 'member' | 'sale'
  observation_count: number | string
  most_recent_observation: string
  freshness: 'green' | 'yellow' | 'red'
  store_id: number
  address: string | null
  distance_miles: number | string
  chain_id: number
  chain_name: string
  display_name: string | null
  match_type: 'exact' | 'equivalent'
  equivalence_strength: number | string
  equiv_name: string | null
  equiv_pack_size: number | string | null
  equiv_pack_unit: string | null

  // ── Barcode-first additive fields (AfterCart-BC variant) ──
  // The user's pick identity. `user_barcode` set when user_kind='barcode';
  // `user_canonical_id` (above) set when user_kind='canonical'.
  user_kind?: 'barcode' | 'canonical'
  user_barcode?: string | null
  // The result's price-side identity (the barcode this row came from in
  // current_prices, or the canonical it came from in unbarcoded_current_prices).
  result_barcode?: string | null
  // Pre-flattening 3-tier label so the UI can distinguish exact-barcode
  // from canonical-exact (both show as `match_type='exact'` after flattening).
  bc_match_type?: 'barcode_exact' | 'equivalent' | 'canonical_exact'
  // OFF Locations identity for the store. Lets the UI link out to the
  // OFF location page or render the OSM tag.
  osm_id?: string | null
  // SNAP authorization status — surfaced in the trust-signal row for the
  // SNAP-recipient primary user.
  snap_authorized?: boolean
  // OFF's `price_per` (their per-unit reading at observation time). When
  // present, gives a more reliable per-unit comparison than re-deriving
  // from `weighted_price` and pack data.
  weighted_price_per?: string | number | null
  // LLM-supplied human reason for equivalent-tier rows ("same brand, larger
  // pack" / "different brand, same loaf type"). Surfaced in the substitute
  // chip caption.
  equivalence_reason?: string | null
}

export interface ApiItem {
  raw_text: string
  description: string
  code: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  shelf_price: number
  member_price: number
  is_store_brand: boolean
  item_type: 'compare' | 'contribute' | 'skip'
  match: ApiMatch | null
  alternatives: ApiAlternative[]
  // Open Food Facts enrichment for this item — image, Nutri-Score, NOVA,
  // ingredients, allergens, nutriments. Null when no canonical_barcodes link
  // exists or the user picked "no match".
  enrichment: OffEnrichment | null
  // True when the user picked an OFF entry that has no canonical link in
  // canonical_barcodes — we know what the product is, but we can't compare
  // prices for it. UI surfaces this with a soft "no comparison" state.
  informational_only: boolean
  // The OFF barcode the user explicitly picked in the review screen, if any.
  // Lets the UI prefer the user's actual pick name over the canonical the
  // server routed it to for price-comparison purposes (e.g., user picks "TJ
  // Sea Salt Cookies", server maps to "Oreos" canonical for prices, UI still
  // displays "TJ Sea Salt Cookies"). Null when user picked in-house or no-match.
  picked_off_barcode: string | null
  // The pre-computed display name to show the user for THIS item. Honors:
  //   1. User's OFF pick (from enrichment.product_name) when picked_off_barcode set
  //   2. The matched canonical's name when in-house pick or substitute found
  //   3. Receipt OCR description as final fallback
  // Components should prefer this over `match?.name ?? description` so the
  // user always sees what they bought, never the substitute we routed to for
  // price-comparison purposes.
  user_display_name: string
  // User's per-item pack size (only set when the user typed an override OR
  // the matched candidate carries a pack size). Wins over the canonical's
  // default `match.package_size` for volume-normalized comparison math.
  user_pack_size: number | null
  user_pack_unit: string | null
}

export interface CompareResponse {
  receipt: ApiReceipt
  chain_detected: string | null
  items: ApiItem[]
  summary: ApiSummary
  schema_warnings: string[]
}

// ── Client functions ───────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'))
    fr.readAsDataURL(file)
  })
}

export interface RequestOptions {
  location?: { lon: number; lat: number }
  radius_miles?: number
  signal?: AbortSignal
}

async function readApiError(res: Response): Promise<string> {
  let message = `API ${res.status}`
  try {
    const err = await res.json()
    if (err.error) message = err.detail ? `${err.error}: ${err.detail}` : err.error
  } catch { /* empty body — keep status-code-only */ }
  return message
}

/**
 * Stage 1: POST a receipt image to /api/match and return the parsed receipt
 * plus per-item candidates. The result is consumed by the ReviewScreen.
 */
export async function matchReceipt(
  file: File,
  options: RequestOptions = {},
): Promise<MatchResponse> {
  const dataUrl = await fileToDataUrl(file)
  const res = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: dataUrl,
      location: options.location,
      radius_miles: options.radius_miles,
    }),
    signal: options.signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json()
}

/**
 * Stage 2: POST the parsed receipt + the user's corrections to /api/compare
 * and return the priced comparison.
 *
 * `matchResult` is what came back from matchReceipt(); we hand its `parsed`
 * field back unchanged so the server doesn't re-OCR.
 */
export async function compareReceipt(
  matchResult: MatchResponse,
  corrections: Correction[],
  options: RequestOptions = {},
): Promise<CompareResponse> {
  // Forward the LLM interpretations from /api/match so the comparison engine
  // can use the brand-stripped product names (much higher OFF FTS recall than
  // raw receipt text). Drop nulls/missing items — the route handles gaps.
  const interpretations = matchResult.items
    .filter(it => it.llm_interpretation)
    .map(it => ({
      line_index: it.line_index,
      product_name: it.llm_interpretation!.product_name,
      brand_guess: it.llm_interpretation!.brand_guess,
      size_guess: it.llm_interpretation!.size_guess,
      is_produce_or_generic: it.llm_interpretation!.is_produce_or_generic,
    }))
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parsed: matchResult.parsed,
      chain_detected: matchResult.chain_detected,
      corrections,
      interpretations,
      location: options.location ?? matchResult.location_default ?? undefined,
      radius_miles: options.radius_miles ?? matchResult.radius_miles_default ?? undefined,
    }),
    signal: options.signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json()
}

// ── /api/off-search ────────────────────────────────────────────────────────

export interface OffSearchHit {
  source: 'off'
  barcode: string
  name: string | null
  brand: string | null
  quantity_raw: string | null
  package_size: number | null
  package_unit: string | null
  image_url: string | null
  nutriscore_grade: string | null
  nova_group: number | null
  enrichment: OffEnrichment | null
}

export interface OffSearchResponse {
  hits: OffSearchHit[]
}

/**
 * Free-text search over the local OFF SQLite. Used by the ReviewScreen's
 * search-for-product input when auto-suggested candidates miss.
 */
export async function searchOffProducts(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<OffSearchResponse> {
  const res = await fetch('/api/off-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json()
}
