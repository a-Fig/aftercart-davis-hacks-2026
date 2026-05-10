/**
 * POST /api/off-search
 *
 * Free-text search across the local Open Food Facts SQLite. Used by
 * ReviewScreen's "Search for product…" input when the user can't find their
 * item among the auto-suggested in-house and OFF candidates.
 *
 * Request body:  { query: string, limit?: number }
 * Response:      { hits: OffCandidate[] }
 *
 * Latency: ~5-20 ms typical for a hot SQLite cache. Safe to call on every
 * keystroke from a debounced input.
 */

import { NextRequest } from 'next/server'

import { getSharedOff, searchOff, getEnrichmentBatch } from '@/lib/off/query.mjs'

export const runtime = 'nodejs'
export const maxDuration = 10

const MAX_LIMIT = 25
const DEFAULT_LIMIT = 10

type RequestBody = { query?: string; limit?: number }

export async function POST(req: NextRequest) {
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const query = (body.query ?? '').trim()
  const limit = Math.max(1, Math.min(MAX_LIMIT, body.limit ?? DEFAULT_LIMIT))

  if (!query) {
    return Response.json({ hits: [] })
  }

  const db = getSharedOff()
  if (!db) {
    return Response.json(
      { error: 'OFF SQLite not built — run `node web/scripts/build-off-sqlite.mjs` first' },
      { status: 503 },
    )
  }

  let hits: Array<{
    barcode: string
    product_name: string | null
    brands: string | null
    quantity_raw: string | null
    package_size: number | null
    package_unit: string | null
    image_url: string | null
    nutriscore_grade: string | null
    nova_group: number | null
    score: number
  }> = []
  try {
    hits = searchOff(db, query, limit)
  } catch (err) {
    return Response.json(
      { error: 'Search failed', detail: (err as Error).message },
      { status: 500 },
    )
  }

  if (!hits.length) return Response.json({ hits: [] })

  const enrichments = getEnrichmentBatch(db, hits.map((h) => h.barcode))

  return Response.json({
    hits: hits.map((h) => ({
      source: 'off' as const,
      barcode: h.barcode,
      name: h.product_name,
      brand: h.brands,
      quantity_raw: h.quantity_raw,
      package_size: h.package_size,
      package_unit: h.package_unit,
      image_url: h.image_url,
      nutriscore_grade: h.nutriscore_grade,
      nova_group: h.nova_group,
      enrichment: enrichments.get(h.barcode) ?? null,
    })),
  })
}
