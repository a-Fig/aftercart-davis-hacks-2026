/**
 * POST /api/field/observations/[id]/reject
 *
 * Mark a field observation rejected. Idempotent.
 * Body (optional JSON): { reason?: string, reviewer?: string }
 */

import { NextRequest } from 'next/server'

import { rejectObservation } from '@/lib/field/promote.mjs'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const observationId = Number(id)
  if (!Number.isFinite(observationId) || observationId <= 0) {
    return Response.json({ error: 'Invalid observation id' }, { status: 400 })
  }

  let body: { reason?: string; reviewer?: string } = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as typeof body
  } catch {
    // ignore
  }

  try {
    const row = await rejectObservation(
      observationId,
      body.reason ?? null,
      body.reviewer ?? null,
    )
    return Response.json({ ok: true, observation: row })
  } catch (err) {
    return Response.json(
      { error: 'Reject failed', detail: (err as Error).message },
      { status: 400 },
    )
  }
}
