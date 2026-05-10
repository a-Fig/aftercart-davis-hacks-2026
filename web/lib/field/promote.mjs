/**
 * Promotion + edit + reject helpers for field_observations.
 *
 * Routing:
 *   - Row with `barcode` set    → INSERT INTO prices
 *   - Else, row with `canonical_id` set → INSERT INTO unbarcoded_observations
 *   - Else → 400 (the API should refuse to accept)
 *
 * Idempotency:
 *   - Re-accepting a row that's already accepted is a no-op (returns existing IDs).
 *   - Re-rejecting is also a no-op.
 *
 * Member-tier handling:
 *   - When `member_price` is set on the observation, two `prices` rows get written
 *     (one shelf, one member). Both share the same source_external_id prefix
 *     'field_obs:{id}' but with ':shelf' / ':member' suffixes so the
 *     UNIQUE(source, source_external_id) constraint stays clean.
 */

import { getPool } from '../receipts/db.mjs'

/** Allowed editable fields on a field_observations row. */
const EDITABLE_FIELDS = new Set([
  'barcode',
  'product_name_raw',
  'brand',
  'canonical_id',
  'price',
  'member_price',
  'pack_size',
  'pack_unit',
  'pricing_tier',
  'quantity',
  'quantity_unit',
  'price_per_unit',
  'price_unit',
  'observed_at',
  'position_note',
])

/**
 * Apply user edits to a pending field_observations row.
 * Silently ignores keys not in EDITABLE_FIELDS so a stray client field can't
 * stomp on internal columns (status, promoted_*_id, etc.).
 *
 * @param {number|bigint} observationId
 * @param {Record<string, any>} edits
 * @returns {Promise<object>} the updated row
 */
export async function editObservation(observationId, edits) {
  const sets = []
  const params = []
  let i = 1
  for (const [key, val] of Object.entries(edits ?? {})) {
    if (!EDITABLE_FIELDS.has(key)) continue
    sets.push(`${key} = $${i}`)
    params.push(val)
    i++
  }
  if (sets.length === 0) return getObservation(observationId)
  params.push(observationId)
  const sql = `
    UPDATE field_observations SET ${sets.join(', ')}
     WHERE observation_id = $${i}
       AND status = 'pending'
     RETURNING *`
  const r = await getPool().query(sql, params)
  if (r.rows.length === 0) {
    throw new Error(
      `editObservation: observation ${observationId} not found or no longer pending`,
    )
  }
  return r.rows[0]
}

/**
 * Mark an observation rejected. Idempotent — re-rejecting overwrites
 * the previous reason if a new one is supplied.
 *
 * @param {number|bigint} observationId
 * @param {string|null} [reason]
 * @param {string|null} [reviewer]
 * @returns {Promise<object>}
 */
export async function rejectObservation(observationId, reason = null, reviewer = null) {
  const r = await getPool().query(
    `UPDATE field_observations
        SET status = 'rejected',
            rejected_reason = $1,
            reviewed_at = NOW(),
            reviewed_by = $2
      WHERE observation_id = $3
      RETURNING *`,
    [reason, reviewer, observationId],
  )
  if (r.rows.length === 0) {
    throw new Error(`rejectObservation: observation ${observationId} not found`)
  }
  return r.rows[0]
}

/**
 * Accept (and promote) an observation into the live price tables.
 *
 * @param {number|bigint} observationId
 * @param {Object} [opts]
 * @param {Record<string, any>} [opts.edits] - field updates to apply before promotion
 * @param {string|null} [opts.reviewer] - reviewer handle for audit trail
 * @returns {Promise<{ row: object, price_ids: number[], obs_id: number|null }>}
 */
export async function acceptObservation(observationId, opts = {}) {
  const pool = getPool()
  // Apply edits (no-op if none).
  if (opts.edits && Object.keys(opts.edits).length > 0) {
    await editObservation(observationId, opts.edits)
  }

  // Reload the canonical state.
  const row = await getObservation(observationId)
  if (!row) {
    throw new Error(`acceptObservation: observation ${observationId} not found`)
  }

  // Idempotent re-accept: already promoted → return existing IDs.
  if (row.status === 'accepted') {
    return {
      row,
      price_ids: row.promoted_price_id != null ? [Number(row.promoted_price_id)] : [],
      obs_id: row.promoted_obs_id != null ? Number(row.promoted_obs_id) : null,
    }
  }
  if (row.status === 'rejected') {
    throw new Error(`acceptObservation: observation ${observationId} was rejected`)
  }

  if (row.price == null || Number(row.price) <= 0) {
    throw new Error(
      `acceptObservation: observation ${observationId} has no usable price`,
    )
  }
  if (!row.barcode && row.canonical_id == null) {
    throw new Error(
      `acceptObservation: observation ${observationId} needs a barcode or canonical_id before it can be accepted`,
    )
  }

  // Look up the photo proof URL for the prices.proof_image_url column.
  const upRes = await pool.query(
    `SELECT photo_url, upload_id FROM field_uploads WHERE upload_id = $1`,
    [row.upload_id],
  )
  const upload = upRes.rows[0] ?? null
  const proofPath = upload ? `/api/field/photo/${upload.upload_id}/image` : null

  // Look up chain_id (denorm needed by both target tables).
  const stRes = await pool.query(
    `SELECT chain_id FROM stores WHERE store_id = $1`,
    [row.store_id],
  )
  const chainId = stRes.rows[0]?.chain_id ?? null

  const client = await pool.connect()
  let priceIds = []
  let obsId = null
  try {
    await client.query('BEGIN')

    if (row.barcode) {
      // Barcoded path → write to `prices`.
      // Confidence floor: 0.7 minimum on accept (the human reviewer is
      // confirming this is right). Float higher with LLM confidence.
      const confidence = clamp(0.7, Number(row.llm_confidence ?? 0.7), 0.99)
      // Shelf tier always written.
      const shelfRes = await client.query(
        `INSERT INTO prices
           (barcode, store_id, chain_id, price, currency,
            pricing_tier, observed_at, source, source_external_id,
            proof_image_url, owner_handle, confidence)
         VALUES ($1, $2, $3, $4, 'USD',
                 $5, $6, 'field', $7,
                 $8, $9, $10)
         ON CONFLICT (source, source_external_id) DO NOTHING
         RETURNING price_id`,
        [
          row.barcode,
          row.store_id,
          chainId,
          row.price,
          row.pricing_tier ?? 'shelf',
          row.observed_at,
          `field_obs:${row.observation_id}:${row.pricing_tier ?? 'shelf'}`,
          proofPath,
          row.reviewed_by ?? null,
          confidence,
        ],
      )
      if (shelfRes.rows[0]?.price_id) priceIds.push(Number(shelfRes.rows[0].price_id))

      // Member tier — only when the row carries a separate member_price
      // alongside a shelf price (the standard "regular | with card" tag).
      if (
        row.pricing_tier === 'shelf' &&
        row.member_price != null &&
        Number(row.member_price) > 0 &&
        Number(row.member_price) !== Number(row.price)
      ) {
        const memberRes = await client.query(
          `INSERT INTO prices
             (barcode, store_id, chain_id, price, currency,
              pricing_tier, observed_at, source, source_external_id,
              proof_image_url, owner_handle, confidence)
           VALUES ($1, $2, $3, $4, 'USD',
                   'member', $5, 'field', $6,
                   $7, $8, $9)
           ON CONFLICT (source, source_external_id) DO NOTHING
           RETURNING price_id`,
          [
            row.barcode,
            row.store_id,
            chainId,
            row.member_price,
            row.observed_at,
            `field_obs:${row.observation_id}:member`,
            proofPath,
            row.reviewed_by ?? null,
            confidence,
          ],
        )
        if (memberRes.rows[0]?.price_id) priceIds.push(Number(memberRes.rows[0].price_id))
      }
    } else {
      // Unbarcoded path → write to `unbarcoded_observations`.
      // Derive missing per-unit fields from canonical's pricing_unit.
      const cpRes = await client.query(
        `SELECT pricing_unit, package_unit FROM canonical_products
          WHERE canonical_id = $1`,
        [row.canonical_id],
      )
      const cp = cpRes.rows[0] ?? { pricing_unit: 'per_each', package_unit: 'each' }

      const quantity = row.quantity != null ? Number(row.quantity) : 1
      const pricePerUnit =
        row.price_per_unit != null
          ? Number(row.price_per_unit)
          : quantity > 0
          ? Number(row.price) / quantity
          : Number(row.price)
      const priceUnit = row.price_unit ?? cp.pricing_unit ?? 'per_each'
      const quantityUnit = row.quantity_unit ?? row.pack_unit ?? cp.package_unit ?? 'each'
      const confidence = clamp(0.7, Number(row.llm_confidence ?? 0.7), 0.99)

      const obsRes = await client.query(
        `INSERT INTO unbarcoded_observations
           (canonical_id, store_id, chain_id,
            price_total, quantity, quantity_unit,
            price_per_unit, price_unit,
            pricing_tier, observed_at, source, confidence)
         VALUES ($1, $2, $3,
                 $4, $5, $6,
                 $7, $8,
                 $9, $10, 'field', $11)
         RETURNING obs_id`,
        [
          row.canonical_id,
          row.store_id,
          chainId,
          row.price,
          quantity,
          quantityUnit,
          pricePerUnit,
          priceUnit,
          row.pricing_tier ?? 'shelf',
          row.observed_at,
          confidence,
        ],
      )
      obsId = Number(obsRes.rows[0].obs_id)
    }

    // Mark accepted + record promoted IDs (the first one if multiple, since
    // the column is single-valued; the audit trail still ties them together
    // through source_external_id='field_obs:{id}:*').
    await client.query(
      `UPDATE field_observations
          SET status = 'accepted',
              reviewed_at = NOW(),
              reviewed_by = $1,
              promoted_price_id = $2,
              promoted_obs_id = $3
        WHERE observation_id = $4`,
      [opts.reviewer ?? null, priceIds[0] ?? null, obsId, observationId],
    )

    await client.query('COMMIT')
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore
    }
    throw err
  } finally {
    client.release()
  }

  const finalRow = await getObservation(observationId)
  return { row: finalRow, price_ids: priceIds, obs_id: obsId }
}

/**
 * Fetch a single observation joined to its canonical metadata + the upload's
 * photo URL. Shape matches what the API + UI expect.
 */
export async function getObservation(observationId) {
  const r = await getPool().query(
    `SELECT
       fo.*,
       cp.name AS canonical_name,
       cp.brand AS canonical_brand,
       cp.package_size AS canonical_pack_size,
       cp.package_unit AS canonical_pack_unit,
       fu.photo_url, fu.mode AS upload_mode
     FROM field_observations fo
     LEFT JOIN canonical_products cp ON cp.canonical_id = fo.canonical_id
     LEFT JOIN field_uploads fu ON fu.upload_id = fo.upload_id
     WHERE fo.observation_id = $1`,
    [observationId],
  )
  return r.rows[0] ?? null
}

function clamp(min, n, max) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}
