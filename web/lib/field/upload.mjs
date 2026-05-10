/**
 * Field photo orchestration: photo bytes → GCS → Gemini → enrichment → DB.
 *
 * The single entry point ingestPhoto() handles:
 *   1. SHA-256 dedup (returns existing upload + observations on re-upload)
 *   2. GCS upload
 *   3. Gemini extraction (shelf_tag → 1 candidate, wide_shot → N candidates)
 *   4. Per-extraction enrichment:
 *        - barcode present → OFF lookup to backfill pack_size/pack_unit/name
 *        - else → matchOne() → canonical_id when blended score ≥ 0.35
 *   5. Transactional INSERT of field_uploads + N field_observations rows
 *
 * pricing_tier is derived from the extraction:
 *   - regular_price set → primary `price` is regular, tier='shelf'
 *   - only member_price set → primary `price` is member_price, tier='member'
 *   - both set → tier='shelf', member_price column also populated; the
 *     promotion path will write 2 `prices` rows on accept.
 */

import { createHash } from 'crypto'

import { getPool } from '../receipts/db.mjs'
import { matchOne } from '../receipts/match.mjs'
import { getSharedOff, getProductPack } from '../off/query.mjs'

import { extractShelfTag, extractWideShot, extractOnlinePdf } from './gemini-extract.mjs'
import { uploadFieldPhoto } from './gcs.mjs'

const MIN_MATCH_SCORE = 0.35

// PDF mode is stricter — online inventory text is clean enough that anything
// short of a near-identical name is a category collision waiting to happen
// ("Strawberry Yogurt" → "Strawberry jelly", "Sweet Cream Creamer" → "Vanilla
// ice cream"). 0.85 only matches when the text really is the same product.
const PDF_MIN_MATCH_SCORE = 0.85

// Even when matchOne returns a high-scoring candidate, reject it if the
// candidate's pack differs from the incoming pack by more than this ratio.
// 5.3oz Greek yogurt and 32oz Greek yogurt MUST be separate canonicals so the
// matview's GROUP BY (canonical_id, store_id, price_unit, pricing_tier) keeps
// their per-oz prices honest instead of averaging them.
const PACK_SIZE_TOLERANCE = 1.3

// Brand → chain mapping for store-brand detection on auto-created canonicals.
// Lowercase keys; matched as substring. Mirrors CHAIN_HOUSE_BRANDS in
// semantic-compare.mjs.
const STORE_BRAND_CHAINS = [
  { brand: 'kirkland', chain: 'costco' },
  { brand: 'trader joe', chain: "trader joe's" },
  { brand: 'great value', chain: 'walmart' },
  { brand: 'good & gather', chain: 'target' },
  { brand: '365', chain: 'whole foods' },
  { brand: 'lucerne', chain: 'safeway' },
  { brand: 'o organics', chain: 'safeway' },
  { brand: 'signature', chain: 'safeway' }, // "Signature Select", "Signature Farms"
]

/**
 * @param {Object} args
 * @param {Buffer} args.buffer
 * @param {string} args.contentType
 * @param {number} args.storeId
 * @param {'shelf_tag'|'wide_shot'|'online_pdf'} args.mode
 * @param {string|null} [args.contributorHandle]
 * @param {string|null} [args.notes]
 * @returns {Promise<{ upload: object, observations: object[], duplicate: boolean }>}
 */
export async function ingestPhoto({
  buffer,
  contentType,
  storeId,
  mode,
  contributorHandle = null,
  notes = null,
}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('ingestPhoto: buffer must be a Buffer')
  }
  if (mode !== 'shelf_tag' && mode !== 'wide_shot' && mode !== 'online_pdf') {
    throw new Error(
      `ingestPhoto: mode must be 'shelf_tag' | 'wide_shot' | 'online_pdf', got ${mode}`,
    )
  }
  const storeIdNum = Number(storeId)
  if (!Number.isFinite(storeIdNum) || storeIdNum <= 0) {
    throw new Error(`ingestPhoto: storeId must be a positive integer, got ${storeId}`)
  }

  const hash = createHash('sha256').update(buffer).digest('hex')
  const pool = getPool()

  // ── Dedup check ──────────────────────────────────────────────────────────
  const existing = await pool.query(
    `SELECT upload_id FROM field_uploads
       WHERE photo_sha256 = $1 AND store_id = $2 LIMIT 1`,
    [hash, storeIdNum],
  )
  if (existing.rows.length > 0) {
    const uploadId = existing.rows[0].upload_id
    const upload = await fetchUpload(pool, uploadId)
    const observations = await fetchObservations(pool, uploadId)
    return { upload, observations, duplicate: true }
  }

  // ── GCS upload ───────────────────────────────────────────────────────────
  const { gsUri } = await uploadFieldPhoto(buffer, contentType, hash, storeIdNum)

  // ── Gemini extraction ────────────────────────────────────────────────────
  const base64 = buffer.toString('base64')
  let extractions = []
  let raw = null
  let model = ''
  if (mode === 'shelf_tag') {
    const result = await extractShelfTag(base64)
    raw = result.raw
    model = result.model
    if (result.extraction && hasAnyData(result.extraction)) {
      extractions.push(result.extraction)
    }
  } else if (mode === 'wide_shot') {
    const result = await extractWideShot(base64)
    raw = result.raw
    model = result.model
    extractions = (result.extractions ?? []).filter(hasAnyData)
  } else {
    // online_pdf — pull chain_name so the prompt can hint loyalty pricing.
    const chainRow = await pool.query(
      `SELECT c.name AS chain_name FROM stores s
        LEFT JOIN chains c ON c.chain_id = s.chain_id
        WHERE s.store_id = $1`,
      [storeIdNum],
    )
    const chainName = chainRow.rows[0]?.chain_name ?? null
    const result = await extractOnlinePdf(base64, { chainName })
    raw = result.raw
    model = result.model
    extractions = (result.extractions ?? []).filter(hasAnyData)
  }

  // ── Transactional INSERT (canonical auto-creation runs inside the txn) ──
  const offDb = getSharedOff()
  const client = await pool.connect()
  let uploadId
  let observationIds = []
  try {
    await client.query('BEGIN')

    const upRes = await client.query(
      `INSERT INTO field_uploads
         (store_id, photo_url, photo_sha256, mode, contributor_handle,
          raw_llm_response, llm_model, notes)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING upload_id`,
      [
        storeIdNum,
        gsUri,
        hash,
        mode,
        contributorHandle ?? null,
        JSON.stringify(raw ?? {}),
        model,
        notes ?? null,
      ],
    )
    uploadId = upRes.rows[0].upload_id

    for (const ex of extractions) {
      const row = await enrichExtraction({ ex, offDb, mode, client })
      const obsRes = await client.query(
        `INSERT INTO field_observations
           (upload_id, store_id,
            barcode, product_name_raw, brand, canonical_id,
            price, member_price, pack_size, pack_unit, pricing_tier,
            quantity, quantity_unit, price_per_unit, price_unit,
            llm_confidence, llm_reasoning, position_note)
         VALUES ($1, $2,
                 $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, $13, $14, $15,
                 $16, $17, $18)
         RETURNING observation_id`,
        [
          uploadId,
          storeIdNum,
          row.barcode,
          row.product_name_raw,
          row.brand,
          row.canonical_id,
          row.price,
          row.member_price,
          row.pack_size,
          row.pack_unit,
          row.pricing_tier,
          row.quantity,
          row.quantity_unit,
          row.price_per_unit,
          row.price_unit,
          row.llm_confidence,
          row.llm_reasoning,
          row.position_note,
        ],
      )
      observationIds.push(obsRes.rows[0].observation_id)
    }

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

  const upload = await fetchUpload(pool, uploadId)
  const observations = await fetchObservations(pool, uploadId)
  return { upload, observations, duplicate: false }
}

/**
 * Build a field_observations-shaped row from a Gemini extraction.
 * - Barcoded items: query OFF for authoritative pack data + product name fallback.
 * - Otherwise: matchOne(product_name) to populate canonical_id when confident.
 *
 * For online_pdf mode: when matchOne returns a weak match (score < 0.55),
 * we auto-create a new `canonical_products` row using the extracted name +
 * brand + pack instead of forcing a wrong bucket. The new canonical's
 * description_embedding stays NULL — `web/scripts/generate-embeddings.mjs`
 * backfills it on the next run so future matchOne() calls can find it.
 *
 * @param {{ex: object, offDb: any, mode: string, client: any}} args
 */
async function enrichExtraction({ ex, offDb, mode, client }) {
  // Resolve pricing_tier + primary price from extraction's regular vs member.
  let price = null
  let memberPrice = null
  let pricingTier = 'shelf'
  if (ex.regular_price != null) {
    price = ex.regular_price
    if (ex.member_price != null && ex.member_price !== ex.regular_price) {
      memberPrice = ex.member_price
    }
    pricingTier = 'shelf'
  } else if (ex.member_price != null) {
    // Member-only tag: no shelf price shown.
    price = ex.member_price
    pricingTier = 'member'
  }

  // OFF pack backfill when barcode resolves cleanly.
  let packSize = ex.pack_size
  let packUnit = ex.pack_unit
  let productNameRaw = ex.product_name
  if (ex.barcode && offDb) {
    try {
      const pack = getProductPack(offDb, ex.barcode)
      if (pack) {
        if (packSize == null && pack.package_size != null) packSize = Number(pack.package_size)
        if (!packUnit && pack.package_unit) packUnit = String(pack.package_unit).toLowerCase()
        if (!productNameRaw && pack.product_name) productNameRaw = pack.product_name
      }
    } catch {
      // OFF lookup failure is non-fatal; reviewer can fix during review.
    }
  }

  // Canonical resolution. Threshold + auto-create policy depends on mode:
  //   - online_pdf: strict 0.55, auto-create on miss (the source data is clean
  //     and specific; coercing to a wrong bucket loses information).
  //   - shelf_tag / wide_shot: lenient 0.35, no auto-create (OCR'd in-store
  //     captures are noisier; the reviewer can pick a canonical manually if
  //     auto-match was wrong).
  let canonicalId = null
  if (productNameRaw) {
    const threshold = mode === 'online_pdf' ? PDF_MIN_MATCH_SCORE : MIN_MATCH_SCORE
    let matched = null
    try {
      const m = await matchOne(productNameRaw)
      if (m && (m.score ?? 0) >= threshold) {
        matched = m
      }
    } catch {
      // matcher errors are non-fatal.
    }
    // Pack-size discriminator: even a high-scoring name match is wrong if the
    // pack sizes don't align — they'd collapse in the matview's GROUP BY.
    if (
      matched &&
      mode === 'online_pdf' &&
      packSize != null &&
      matched.package_size != null &&
      packUnit &&
      matched.package_unit &&
      String(matched.package_unit).toLowerCase() === String(packUnit).toLowerCase()
    ) {
      const ratio = Number(matched.package_size) / Number(packSize)
      if (ratio > PACK_SIZE_TOLERANCE || ratio < 1 / PACK_SIZE_TOLERANCE) {
        matched = null
      }
    } else if (
      matched &&
      mode === 'online_pdf' &&
      packUnit &&
      matched.package_unit &&
      String(matched.package_unit).toLowerCase() !== String(packUnit).toLowerCase()
    ) {
      // Different pack-unit dimensions (oz vs lb, ct vs oz) → never the same product.
      matched = null
    }
    if (matched) {
      canonicalId = matched.canonical_id
    } else if (mode === 'online_pdf' && client) {
      try {
        canonicalId = await findOrCreateCanonical(client, {
          name: productNameRaw,
          brand: ex.brand ?? null,
          packSize,
          packUnit,
        })
      } catch (err) {
        // Auto-create failure is non-fatal — leave canonical_id null and
        // let the reviewer pick one in the UI.
        console.warn(
          '[field/upload] auto-create canonical failed for',
          productNameRaw,
          (err && err.message) || err,
        )
      }
    }
  }

  // Weighted-item heuristic. If the tag was "$3.99/lb" the model returns
  // price_per_unit as a string; we don't insert into the unbarcoded numeric
  // columns from the extraction itself — those get populated during review
  // when the user supplies the actual purchased quantity.
  return {
    barcode: ex.barcode ?? null,
    product_name_raw: productNameRaw ?? null,
    brand: ex.brand ?? null,
    canonical_id: canonicalId,
    price,
    member_price: memberPrice,
    pack_size: packSize,
    pack_unit: packUnit,
    pricing_tier: pricingTier,
    quantity: null,
    quantity_unit: ex.quantity_unit ?? null,
    price_per_unit: null,
    price_unit: null,
    llm_confidence: ex.confidence ?? null,
    llm_reasoning: ex.notes ?? null,
    position_note: ex.position_note ?? null,
  }
}

/**
 * Find an existing canonical_products row matching (name, brand) case-insensitively,
 * or INSERT a new one. The new row's description_embedding stays NULL —
 * web/scripts/generate-embeddings.mjs fills it in on the next run, which makes
 * future matchOne() calls discover it.
 *
 * Returns the canonical_id (existing or new).
 */
async function findOrCreateCanonical(client, { name, brand, packSize, packUnit }) {
  const trimmedName = String(name ?? '').trim()
  if (!trimmedName) throw new Error('findOrCreateCanonical: name is required')
  const trimmedBrand = brand ? String(brand).trim() : null

  // De-dup against existing canonical_products by (name, brand, pack_size,
  // pack_unit). Lowercased comparison + numeric pack size match so successive
  // PDFs for the same product reuse one canonical, but distinct pack sizes of
  // the same product (5.3oz vs 32oz Greek yogurt) get distinct canonicals so
  // the matview's GROUP BY keeps their per-unit prices honest.
  const existing = await client.query(
    `SELECT canonical_id FROM canonical_products
      WHERE LOWER(name) = LOWER($1)
        AND COALESCE(LOWER(brand), '') = COALESCE(LOWER($2), '')
        AND COALESCE(package_size::text, '') = COALESCE($3::text, '')
        AND COALESCE(LOWER(package_unit), '') = COALESCE(LOWER($4), '')
      LIMIT 1`,
    [trimmedName, trimmedBrand, packSize ?? null, packUnit ?? null],
  )
  if (existing.rows.length > 0) {
    return Number(existing.rows[0].canonical_id)
  }

  // Detect store-brand membership so the comparison engine can route
  // chain-specific products correctly (e.g. "Lucerne" → Safeway-only).
  let isStoreBrand = false
  let storeBrandChainId = null
  if (trimmedBrand) {
    const blower = trimmedBrand.toLowerCase()
    for (const { brand: marker, chain } of STORE_BRAND_CHAINS) {
      if (blower.includes(marker)) {
        const cidRow = await client.query(
          `SELECT chain_id FROM chains WHERE LOWER(name) LIKE $1 LIMIT 1`,
          [`%${chain}%`],
        )
        if (cidRow.rows.length > 0) {
          isStoreBrand = true
          storeBrandChainId = Number(cidRow.rows[0].chain_id)
        }
        break
      }
    }
  }

  // Derive pricing_unit from pack_unit when possible. canonical_products
  // requires pricing_unit NOT NULL.
  const pricingUnit = derivePricingUnit(packUnit)

  const inserted = await client.query(
    `INSERT INTO canonical_products
       (name, brand, is_store_brand, store_brand_chain_id,
        package_size, package_unit, pricing_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING canonical_id`,
    [
      trimmedName,
      trimmedBrand,
      isStoreBrand,
      storeBrandChainId,
      packSize ?? null,
      packUnit ?? null,
      pricingUnit,
    ],
  )
  return Number(inserted.rows[0].canonical_id)
}

function derivePricingUnit(packUnit) {
  const u = (packUnit ?? '').toLowerCase()
  if (u === 'lb' || u === 'pound' || u === 'pounds') return 'per_lb'
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return 'per_oz'
  if (u === 'fl_oz' || u === 'fl oz' || u === 'fluid ounce') return 'per_oz'
  if (u === 'g' || u === 'kg' || u === 'ml' || u === 'l') return 'per_oz'
  if (u === 'gal' || u === 'gallon') return 'per_oz'
  if (u === 'count' || u === 'ct' || u === 'each' || u === 'doz' || u === 'dozen') {
    return 'per_each'
  }
  return 'per_each'
}

function hasAnyData(ex) {
  if (!ex) return false
  return (
    ex.product_name != null ||
    ex.regular_price != null ||
    ex.member_price != null ||
    ex.barcode != null
  )
}

async function fetchUpload(pool, uploadId) {
  const r = await pool.query(
    `SELECT upload_id, store_id, photo_url, photo_sha256, mode,
            contributor_handle, llm_model, notes, uploaded_at
       FROM field_uploads WHERE upload_id = $1`,
    [uploadId],
  )
  return r.rows[0] ?? null
}

async function fetchObservations(pool, uploadId) {
  const r = await pool.query(
    `SELECT
       fo.observation_id, fo.upload_id, fo.store_id,
       fo.barcode, fo.product_name_raw, fo.brand, fo.canonical_id,
       fo.price, fo.member_price, fo.pack_size, fo.pack_unit, fo.pricing_tier,
       fo.quantity, fo.quantity_unit, fo.price_per_unit, fo.price_unit,
       fo.llm_confidence, fo.llm_reasoning, fo.position_note,
       fo.status, fo.rejected_reason,
       fo.promoted_price_id, fo.promoted_obs_id,
       fo.observed_at, fo.created_at, fo.reviewed_at, fo.reviewed_by,
       cp.name AS canonical_name,
       cp.brand AS canonical_brand,
       cp.package_size AS canonical_pack_size,
       cp.package_unit AS canonical_pack_unit
     FROM field_observations fo
     LEFT JOIN canonical_products cp ON cp.canonical_id = fo.canonical_id
     WHERE fo.upload_id = $1
     ORDER BY fo.observation_id`,
    [uploadId],
  )
  return r.rows
}
