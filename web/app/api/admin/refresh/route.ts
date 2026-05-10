/**
 * POST /api/admin/refresh
 *
 * Refreshes the `current_prices` materialized view. Without periodic refresh
 * the view's recency-weight math freezes — freshness dots stay green forever
 * and new price observations don't show in comparisons.
 *
 * Triggered by Cloud Scheduler every 15 minutes (see Phase 7.2 of the GCP
 * migration plan). Authorization: shared bearer token in `REFRESH_TOKEN`
 * env var, set via Secret Manager binding on Cloud Run.
 *
 * `CONCURRENTLY` requires the unique index `current_prices_pk` (already in
 * the schema) — without it the refresh blocks readers.
 */

import { query } from '@/lib/receipts/db.mjs'

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.REFRESH_TOKEN
  if (!expected) {
    return Response.json(
      { ok: false, error: 'REFRESH_TOKEN not configured' },
      { status: 500 }
    )
  }

  const auth = req.headers.get('authorization') || ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (presented !== expected) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices')
    return Response.json({
      ok: true,
      refreshed_at: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[admin/refresh] matview refresh failed:', message)
    return Response.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
