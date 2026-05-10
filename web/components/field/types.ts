/**
 * Shared TypeScript types for the field collection portal UI.
 * These mirror what the /api/field/* routes return so each component can
 * import a single contract instead of redefining shapes inline.
 */

export type FieldStore = {
  store_id: number
  chain_id: number | null
  chain_name: string | null
  display_name: string
  address_full: string | null
  city: string | null
  state: string | null
  is_field_starred: boolean
  pending_count: number
  lat: number | null
  lon: number | null
}

export type FieldUpload = {
  upload_id: number
  store_id: number
  photo_url: string
  photo_sha256: string
  mode: 'shelf_tag' | 'wide_shot' | 'online_pdf'
  contributor_handle: string | null
  llm_model: string
  notes: string | null
  uploaded_at: string
  store_display_name?: string
  store_address?: string | null
  store_city?: string | null
  store_state?: string | null
  chain_id?: number | null
  chain_name?: string | null
}

export type FieldObservation = {
  observation_id: number
  upload_id: number
  store_id: number
  barcode: string | null
  product_name_raw: string | null
  brand: string | null
  canonical_id: number | null
  price: number | null
  member_price: number | null
  pack_size: number | null
  pack_unit: string | null
  pricing_tier: 'shelf' | 'member' | 'sale'
  quantity: number | null
  quantity_unit: string | null
  price_per_unit: number | null
  price_unit: string | null
  llm_confidence: number | null
  llm_reasoning: string | null
  position_note: string | null
  status: 'pending' | 'accepted' | 'rejected'
  rejected_reason: string | null
  promoted_price_id: number | null
  promoted_obs_id: number | null
  observed_at: string
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  canonical_name?: string | null
  canonical_brand?: string | null
  canonical_pack_size?: number | null
  canonical_pack_unit?: string | null
}

export type CanonicalHit = {
  canonical_id: number
  name: string
  brand: string | null
  package_size: number | null
  package_unit: string | null
  pricing_unit: string
  score: number
}

export type PendingRow = FieldObservation & {
  upload_mode: 'shelf_tag' | 'wide_shot' | 'online_pdf'
  uploaded_at: string
  store_display_name: string
  chain_name: string | null
  image_url: string
}
