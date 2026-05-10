/**
 * PATCH /api/field/stores/[id]/star
 *
 * Toggle the is_field_starred flag on a store. Body: { starred: boolean }
 * (or just an empty body to flip the current value).
 */

import { NextRequest } from 'next/server'

import { query } from '@/lib/receipts/db.mjs'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const storeId = Number(id)
  if (!Number.isFinite(storeId) || storeId <= 0) {
    return Response.json({ error: 'Invalid store id' }, { status: 400 })
  }

  let body: { starred?: boolean } = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as typeof body
  } catch {
    // empty body → toggle current value
  }

  let rows
  if (typeof body.starred === 'boolean') {
    rows = (await query(
      `UPDATE stores SET is_field_starred = $1
        WHERE store_id = $2
        RETURNING store_id, is_field_starred`,
      [body.starred, storeId],
    )) as Array<{ store_id: number; is_field_starred: boolean }>
  } else {
    rows = (await query(
      `UPDATE stores SET is_field_starred = NOT is_field_starred
        WHERE store_id = $1
        RETURNING store_id, is_field_starred`,
      [storeId],
    )) as Array<{ store_id: number; is_field_starred: boolean }>
  }

  if (rows.length === 0) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }
  return Response.json({ ok: true, store: rows[0] })
}
