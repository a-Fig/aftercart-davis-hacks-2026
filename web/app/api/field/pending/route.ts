/**
 * GET /api/field/pending
 *
 * Global review queue: every field_observations row with status='pending',
 * joined to its store + chain + photo URL for thumbnail rendering.
 *
 * Query params:
 *   ?store_id=N — filter to one store
 *   ?mode=shelf_tag|wide_shot — filter by upload mode
 *   ?limit=N (default 100, max 500)
 */

import { NextRequest } from 'next/server'

import { query } from '@/lib/receipts/db.mjs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const storeIdParam = sp.get('store_id')
  const modeParam = sp.get('mode')
  const limitParam = Number(sp.get('limit') ?? '100')
  const limit = Number.isFinite(limitParam)
    ? Math.min(500, Math.max(1, Math.trunc(limitParam)))
    : 100

  const wheres: string[] = ["fo.status = 'pending'"]
  const params: unknown[] = []
  let i = 1

  if (storeIdParam) {
    const storeId = Number(storeIdParam)
    if (Number.isFinite(storeId) && storeId > 0) {
      wheres.push(`fo.store_id = $${i++}`)
      params.push(storeId)
    }
  }
  if (modeParam === 'shelf_tag' || modeParam === 'wide_shot') {
    wheres.push(`fu.mode = $${i++}`)
    params.push(modeParam)
  }
  params.push(limit)

  const rows = (await query(
    `
    SELECT
      fo.observation_id, fo.upload_id, fo.store_id,
      fo.barcode, fo.product_name_raw, fo.brand, fo.canonical_id,
      fo.price, fo.member_price, fo.pack_size, fo.pack_unit, fo.pricing_tier,
      fo.llm_confidence, fo.llm_reasoning, fo.position_note,
      fo.observed_at, fo.created_at,
      cp.name AS canonical_name,
      fu.mode AS upload_mode, fu.uploaded_at,
      s.display_name AS store_display_name,
      c.name AS chain_name,
      '/api/field/photo/' || fo.upload_id || '/image' AS image_url
    FROM field_observations fo
    JOIN field_uploads fu ON fu.upload_id = fo.upload_id
    JOIN stores s ON s.store_id = fo.store_id
    LEFT JOIN chains c ON c.chain_id = s.chain_id
    LEFT JOIN canonical_products cp ON cp.canonical_id = fo.canonical_id
    WHERE ${wheres.join(' AND ')}
    ORDER BY fo.created_at DESC
    LIMIT $${i}
  `,
    params,
  )) as Array<Record<string, unknown>>

  return Response.json({ pending: rows })
}
