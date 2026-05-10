/**
 * GET /api/field/canonical-search?q=...&limit=N
 *
 * Trigram-similarity search against canonical_products.name + brand. Powers
 * the inline CanonicalPicker on the review screen for observations with no
 * auto-matched canonical.
 *
 * Returns up to `limit` (default 10, max 25) hits ordered by similarity.
 */

import { NextRequest } from 'next/server'

import { query } from '@/lib/receipts/db.mjs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) {
    return Response.json({ canonicals: [] })
  }

  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? '10')
  const limit = Number.isFinite(limitParam)
    ? Math.min(25, Math.max(1, Math.trunc(limitParam)))
    : 10

  const rows = (await query(
    `SELECT canonical_id, name, brand, package_size, package_unit, pricing_unit,
            GREATEST(
              similarity(name, $1),
              COALESCE(similarity(brand, $1), 0)
            ) AS score
       FROM canonical_products
      WHERE name % $1 OR (brand IS NOT NULL AND brand % $1)
      ORDER BY score DESC, name
      LIMIT $2`,
    [q, limit],
  )) as Array<Record<string, unknown>>

  return Response.json({ canonicals: rows })
}
