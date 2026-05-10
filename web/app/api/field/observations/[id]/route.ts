/**
 * PATCH /api/field/observations/[id]
 *
 * Edit fields on a pending field_observations row. Body: JSON with any subset
 * of EDITABLE_FIELDS (see promote.mjs). Unknown keys are silently dropped so
 * stray client fields can't poke at internal columns.
 */

import { NextRequest } from 'next/server'

import { editObservation } from '@/lib/field/promote.mjs'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const observationId = Number(id)
  if (!Number.isFinite(observationId) || observationId <= 0) {
    return Response.json({ error: 'Invalid observation id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  try {
    const updated = await editObservation(observationId, body)
    return Response.json({ ok: true, observation: updated })
  } catch (err) {
    return Response.json(
      { error: 'Edit failed', detail: (err as Error).message },
      { status: 400 },
    )
  }
}
