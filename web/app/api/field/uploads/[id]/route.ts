/**
 * GET /api/field/uploads/[id]
 *
 * Fetch a field upload + its observations + the parent store's display info.
 * Used by /field/upload/[id] (post-upload review screen) and /field/review
 * (global pending queue) to render the editable observation cards.
 */

import { NextRequest } from 'next/server'

import { query } from '@/lib/receipts/db.mjs'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const uploadId = Number(id)
  if (!Number.isFinite(uploadId) || uploadId <= 0) {
    return Response.json({ error: 'Invalid upload id' }, { status: 400 })
  }

  const uploads = (await query(
    `SELECT
       fu.upload_id, fu.store_id, fu.photo_url, fu.photo_sha256, fu.mode,
       fu.contributor_handle, fu.llm_model, fu.notes, fu.uploaded_at,
       s.display_name AS store_display_name,
       s.address_full AS store_address,
       s.city AS store_city,
       s.state AS store_state,
       c.chain_id, c.name AS chain_name
     FROM field_uploads fu
     JOIN stores s ON s.store_id = fu.store_id
     LEFT JOIN chains c ON c.chain_id = s.chain_id
     WHERE fu.upload_id = $1`,
    [uploadId],
  )) as Array<Record<string, unknown>>
  if (uploads.length === 0) {
    return Response.json({ error: 'Upload not found' }, { status: 404 })
  }

  const observations = (await query(
    `SELECT
       fo.observation_id, fo.upload_id, fo.store_id,
       fo.barcode, fo.product_name_raw, fo.brand, fo.canonical_id,
       fo.price, fo.member_price, fo.pack_size, fo.pack_unit, fo.pricing_tier,
       fo.quantity, fo.quantity_unit, fo.price_per_unit, fo.price_unit,
       fo.llm_confidence, fo.llm_reasoning, fo.position_note,
       fo.status, fo.rejected_reason,
       fo.promoted_price_id, fo.promoted_obs_id,
       fo.observed_at, fo.created_at, fo.reviewed_at, fo.reviewed_by,
       cp.name AS canonical_name,
       cp.brand AS canonical_brand,
       cp.package_size AS canonical_pack_size,
       cp.package_unit AS canonical_pack_unit
     FROM field_observations fo
     LEFT JOIN canonical_products cp ON cp.canonical_id = fo.canonical_id
     WHERE fo.upload_id = $1
     ORDER BY fo.observation_id`,
    [uploadId],
  )) as Array<Record<string, unknown>>

  return Response.json({
    upload: uploads[0],
    observations,
    image_url: `/api/field/photo/${uploadId}/image`,
  })
}
