/**
 * GET  /api/field/stores
 * POST /api/field/stores
 *
 * GET — list stores with their starred flag and pending observation count.
 *       Query params: ?starred=1 to filter to just starred stores.
 *
 * POST — add a new store. Body:
 *   { display_name: string, address: string, lat: number, lon: number,
 *     chain_id?: number, chain_name?: string, city?, state?, postal_code? }
 *   Either chain_id (preferred) or chain_name (creates new chain on miss) is required.
 *   lat/lon must be supplied; we don't geocode server-side in v1.
 */

import { NextRequest } from 'next/server'

import { getPool, query } from '@/lib/receipts/db.mjs'

export const runtime = 'nodejs'

type StoreRow = {
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

export async function GET(req: NextRequest) {
  const starredOnly = req.nextUrl.searchParams.get('starred') === '1'

  const sql = `
    SELECT
      s.store_id,
      s.chain_id,
      c.name AS chain_name,
      s.display_name,
      s.address_full,
      s.city,
      s.state,
      s.is_field_starred,
      ST_Y(s.location::geometry) AS lat,
      ST_X(s.location::geometry) AS lon,
      COALESCE(p.pending_count, 0) AS pending_count
    FROM stores s
    LEFT JOIN chains c ON c.chain_id = s.chain_id
    LEFT JOIN (
      SELECT store_id, COUNT(*) AS pending_count
        FROM field_observations
       WHERE status = 'pending'
       GROUP BY store_id
    ) p ON p.store_id = s.store_id
    ${starredOnly ? 'WHERE s.is_field_starred' : ''}
    ORDER BY s.is_field_starred DESC, c.name NULLS LAST, s.display_name
    LIMIT 500`
  const rows = (await query(sql, [])) as StoreRow[]
  return Response.json({ stores: rows })
}

export async function POST(req: NextRequest) {
  let body: {
    display_name?: string
    address?: string
    city?: string
    state?: string
    postal_code?: string
    lat?: number | string
    lon?: number | string
    chain_id?: number | string
    chain_name?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const displayName = String(body.display_name ?? '').trim()
  if (!displayName) {
    return Response.json({ error: '"display_name" is required' }, { status: 400 })
  }
  const address = String(body.address ?? '').trim()
  // address is optional but heavily encouraged — we'll allow blank for now.

  const lat = Number(body.lat)
  const lon = Number(body.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json(
      { error: '"lat" and "lon" must be numbers (decimal degrees)' },
      { status: 400 },
    )
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: 'lat/lon out of valid range' }, { status: 400 })
  }

  // Resolve chain_id, creating a new chain row if chain_name is supplied
  // and doesn't match an existing chain.
  let chainId: number | null = null
  if (body.chain_id != null) {
    const cid = Number(body.chain_id)
    if (Number.isFinite(cid)) chainId = cid
  }
  const pool = getPool()
  if (chainId == null && body.chain_name) {
    const cname = String(body.chain_name).trim()
    if (cname) {
      const existing = await pool.query(
        `SELECT chain_id FROM chains WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [cname],
      )
      if (existing.rows.length > 0) {
        chainId = Number(existing.rows[0].chain_id)
      } else {
        const inserted = await pool.query(
          `INSERT INTO chains (name) VALUES ($1) RETURNING chain_id`,
          [cname],
        )
        chainId = Number(inserted.rows[0].chain_id)
      }
    }
  }
  // chain_id can be null per schema — independent stores allowed.

  let inserted
  try {
    inserted = await pool.query(
      `INSERT INTO stores
         (chain_id, display_name, location, address_full, city, state, postal_code,
          country_code, source)
       VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5, $6, $7, $8, 'US', 'usda_only')
       RETURNING store_id`,
      [
        chainId,
        displayName,
        lon,
        lat,
        address || null,
        body.city ?? null,
        body.state ?? null,
        body.postal_code ?? null,
      ],
    )
  } catch (err) {
    const msg = (err as Error).message
    if (/duplicate key|unique/i.test(msg)) {
      return Response.json(
        { error: 'A store with this OSM ID already exists', detail: msg },
        { status: 409 },
      )
    }
    return Response.json(
      { error: 'Failed to insert store', detail: msg },
      { status: 500 },
    )
  }

  return Response.json(
    { ok: true, store_id: Number(inserted.rows[0].store_id), chain_id: chainId },
    { status: 201 },
  )
}
