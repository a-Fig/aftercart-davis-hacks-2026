/**
 * POST /api/field/observations/[id]/accept
 *
 * Promote a pending observation into the live price tables.
 * Body (optional JSON):
 *   { edits?: { field: value, ... }, reviewer?: string }
 *
 * Returns: { ok, row, price_ids[], obs_id }
 */

import { NextRequest } from 'next/server'

import { acceptObservation } from '@/lib/field/promote.mjs'
import { query } from '@/lib/receipts/db.mjs'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const observationId = Number(id)
  if (!Number.isFinite(observationId) || observationId <= 0) {
    return Response.json({ error: 'Invalid observation id' }, { status: 400 })
  }

  // Body is optional — accept with no edits is the default flow.
  let body: { edits?: Record<string, unknown>; reviewer?: string } = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as typeof body
  } catch {
    // empty body / invalid JSON → use defaults
  }

  let result
  try {
    result = await acceptObservation(observationId, {
      edits: body.edits,
      reviewer: body.reviewer ?? null,
    })
  } catch (err) {
    return Response.json(
      { error: 'Accept failed', detail: (err as Error).message },
      { status: 400 },
    )
  }

  // Refresh current_prices so the new observations show up in /api/compare.
  // Concurrently first; fall back to blocking refresh on error (e.g. unique
  // index missing). Errors here are logged but non-fatal — the row is
  // already in `prices` / `unbarcoded_observations`; the matview will catch
  // up on the next scheduled refresh.
  if (result.price_ids.length > 0 || result.obs_id != null) {
    try {
      if (result.price_ids.length > 0) {
        await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices`)
      }
      if (result.obs_id != null) {
        await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY unbarcoded_current_prices`)
      }
    } catch (err) {
      console.warn('[api/field/accept] matview refresh failed:', (err as Error).message)
    }
  }

  return Response.json({
    ok: true,
    row: result.row,
    price_ids: result.price_ids,
    obs_id: result.obs_id,
  })
}
