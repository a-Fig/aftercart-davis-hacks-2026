/**
 * Postgres queries for the internal /inspect dashboard.
 *
 * Server-side only — every consumer is a /inspect/* server component or its
 * route handler. All queries go through `query()` from web/lib/receipts/db.mjs
 * (which Agent B is rewriting to a pg.Pool against Cloud SQL — same export
 * signature `query(text, params) → rows`).
 *
 * Conventions:
 *   - Pure data access. No HTML, no formatting. Components handle render.
 *   - Returns shapes are documented inline; consumers are TypeScript and
 *     destructure-tolerant of extra fields.
 *   - Empty result is fine and explicitly handled — fresh DBs have no
 *     observations and no current_prices rows.
 *   - All geographic functions emit lon/lat in that order (PostGIS GEOGRAPHY
 *     uses lon-first via ST_MakePoint(lon, lat)).
 */

import { query } from '../receipts/db.mjs'

const METERS_PER_MILE = 1609.344

// ── Overview ────────────────────────────────────────────────────────────────

/**
 * Single-row catalog count snapshot for the inspector home.
 *
 * Returns:
 *   { chains, stores, canonicals, embedded,
 *     canonicals_with_off_link, barcode_links_total,
 *     observations, coverage_pairs }
 *
 * Counts use COUNT(*) — fine on the current scale (939 canonicals,
 * ~4k observations). Switch to a cached snapshot if observations grows
 * past ~1M.
 */
export async function getOverviewCounts() {
  const rows = await query(
    `
    SELECT
      (SELECT COUNT(*) FROM chains)                                            AS chains,
      (SELECT COUNT(*) FROM stores)                                            AS stores,
      (SELECT COUNT(*) FROM canonical_products)                                AS canonicals,
      (SELECT COUNT(*) FROM canonical_products
        WHERE description_embedding IS NOT NULL)                               AS embedded,
      (SELECT COUNT(DISTINCT canonical_id) FROM canonical_barcodes)            AS canonicals_with_off_link,
      (SELECT COUNT(*) FROM canonical_barcodes)                                AS barcode_links_total,
      (SELECT COUNT(*) FROM price_observations)                                AS observations,
      (SELECT COUNT(*) FROM (
         SELECT DISTINCT canonical_id, store_id FROM current_prices
       ) AS pairs)                                                             AS coverage_pairs
    `,
    [],
  )
  return rows[0] || {
    chains: 0, stores: 0, canonicals: 0, embedded: 0,
    canonicals_with_off_link: 0, barcode_links_total: 0,
    observations: 0, coverage_pairs: 0,
  }
}

/** Top-N stores by observation count, with chain name. */
export async function getTopStores(limit = 10) {
  return query(
    `
    SELECT
      s.store_id,
      s.address,
      c.name                            AS chain_name,
      COUNT(po.observation_id)          AS obs_count,
      MAX(po.observed_at)               AS last_observed
    FROM stores s
    JOIN chains c USING (chain_id)
    LEFT JOIN price_observations po USING (store_id)
    GROUP BY s.store_id, c.name
    ORDER BY obs_count DESC NULLS LAST, s.store_id ASC
    LIMIT $1
    `,
    [limit],
  )
}

/** Top-N canonicals by store coverage (number of distinct stores with a current price). */
export async function getTopProducts(limit = 10) {
  return query(
    `
    SELECT
      cp.canonical_id,
      cp.name,
      cp.brand,
      cp.package_size,
      cp.package_unit,
      cp.pricing_unit,
      COUNT(DISTINCT curp.store_id)     AS store_coverage,
      COUNT(po.observation_id)          AS obs_count
    FROM canonical_products cp
    LEFT JOIN current_prices curp USING (canonical_id)
    LEFT JOIN price_observations po USING (canonical_id)
    GROUP BY cp.canonical_id
    ORDER BY store_coverage DESC NULLS LAST, obs_count DESC NULLS LAST
    LIMIT $1
    `,
    [limit],
  )
}

// ── Stores ──────────────────────────────────────────────────────────────────

/**
 * All stores with chain name, lat/lon, and observation aggregates — plus
 * a per-source breakdown so the stores list can show a fake/real ratio.
 */
export async function listStores() {
  return query(
    `
    SELECT
      s.store_id,
      s.chain_id,
      c.name                                                              AS chain_name,
      s.address,
      s.external_id,
      s.snap_authorized,
      ST_X(s.location::geometry)                                          AS lon,
      ST_Y(s.location::geometry)                                          AS lat,
      COUNT(po.observation_id)                                            AS obs_count,
      COUNT(po.observation_id) FILTER (WHERE po.source = 'fake')          AS obs_fake,
      COUNT(po.observation_id) FILTER (WHERE po.source = 'receipt')       AS obs_receipt,
      COUNT(po.observation_id) FILTER (WHERE po.source = 'manual')        AS obs_manual,
      COUNT(po.observation_id) FILTER (WHERE po.source NOT IN ('fake','receipt','manual'))
                                                                          AS obs_other,
      MAX(po.observed_at)                                                 AS last_observed
    FROM stores s
    JOIN chains c USING (chain_id)
    LEFT JOIN price_observations po USING (store_id)
    GROUP BY s.store_id, c.name
    ORDER BY obs_count DESC NULLS LAST, c.name ASC, s.address ASC
    `,
    [],
  )
}

/** All chains, for the "filter by chain" picker on the stores list. */
export async function listChains() {
  return query(
    `
    SELECT
      c.chain_id,
      c.name,
      c.parent_company,
      c.snap_authorized,
      c.pricing_model,
      COUNT(DISTINCT s.store_id) AS store_count
    FROM chains c
    LEFT JOIN stores s USING (chain_id)
    GROUP BY c.chain_id
    ORDER BY c.name ASC
    `,
    [],
  )
}

/** One store row with chain context. Returns null when not found. */
export async function getStore(storeId) {
  const rows = await query(
    `
    SELECT
      s.store_id,
      s.chain_id,
      c.name                            AS chain_name,
      c.parent_company,
      s.address,
      s.external_id,
      s.usda_retailer_id,
      s.snap_authorized,
      ST_X(s.location::geometry)        AS lon,
      ST_Y(s.location::geometry)        AS lat,
      s.opened_at,
      s.closed_at,
      COUNT(po.observation_id)          AS obs_count,
      MAX(po.observed_at)               AS last_observed
    FROM stores s
    JOIN chains c USING (chain_id)
    LEFT JOIN price_observations po USING (store_id)
    WHERE s.store_id = $1
    GROUP BY s.store_id, c.chain_id, c.name
    `,
    [storeId],
  )
  return rows[0] || null
}

/**
 * Every canonical priced at a single store via current_prices, with the
 * shelf and member tier folded into one row, plus an OFF coverage chip
 * (link count + best Nutri-Score letter when available).
 *
 * Returns rows sorted by category name then product name.
 */
export async function getStoreProducts(storeId) {
  return query(
    `
    WITH per_pair AS (
      -- Collapse shelf/member rows into one record per (canonical, store_id, price_unit)
      SELECT
        cp.canonical_id,
        cp.store_id,
        cp.price_unit,
        MAX(cp.weighted_price)  FILTER (WHERE cp.pricing_tier = 'shelf')  AS shelf_price,
        MAX(cp.weighted_price)  FILTER (WHERE cp.pricing_tier = 'member') AS member_price,
        MAX(cp.weighted_price)  FILTER (WHERE cp.pricing_tier = 'sale')   AS sale_price,
        SUM(cp.observation_count)                                          AS obs_count,
        MAX(cp.most_recent_observation)                                    AS most_recent_observation,
        -- Take the freshest tier's freshness label (green > yellow > red).
        MIN(CASE cp.freshness
              WHEN 'green'  THEN 1
              WHEN 'yellow' THEN 2
              ELSE 3
            END)                                                            AS freshness_rank
      FROM current_prices cp
      WHERE cp.store_id = $1
      GROUP BY cp.canonical_id, cp.store_id, cp.price_unit
    )
    SELECT
      pp.canonical_id,
      pr.name,
      pr.brand,
      pr.package_size,
      pr.package_unit,
      pr.pricing_unit,
      cat.name                                AS category_name,
      ss.display_name                         AS chain_display_name,
      pp.price_unit,
      pp.shelf_price,
      pp.member_price,
      pp.sale_price,
      pp.obs_count,
      pp.most_recent_observation,
      CASE pp.freshness_rank
        WHEN 1 THEN 'green'
        WHEN 2 THEN 'yellow'
        ELSE 'red'
      END                                    AS freshness,
      COALESCE(off_links.link_count, 0)      AS off_link_count,
      off_links.barcodes                      AS off_barcodes
    FROM per_pair pp
    JOIN canonical_products pr ON pr.canonical_id = pp.canonical_id
    LEFT JOIN product_categories cat ON cat.category_id = pr.category_id
    LEFT JOIN store_skus ss
      ON ss.canonical_id = pp.canonical_id
     AND ss.store_id IS NULL
     AND ss.chain_id = (SELECT chain_id FROM stores WHERE store_id = $1)
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)                                                       AS link_count,
        ARRAY_AGG(barcode ORDER BY confidence DESC)                    AS barcodes
      FROM canonical_barcodes
      WHERE canonical_id = pp.canonical_id
    ) AS off_links ON TRUE
    ORDER BY cat.name NULLS LAST, pr.name ASC
    `,
    [storeId],
  )
}

// ── Products / canonicals ───────────────────────────────────────────────────

/**
 * All canonicals, with category, store-coverage count, observation count,
 * median price (across stores), and OFF-link aggregates.
 *
 * `median_price` uses percentile_cont over current_prices.weighted_price for
 * the shelf tier — a single number per product to gauge "what does this thing
 * roughly cost." Prefer this over avg() because of long-tail outliers in
 * synthetic seed data.
 */
export async function listProducts() {
  return query(
    `
    WITH price_stats AS (
      SELECT
        canonical_id,
        COUNT(DISTINCT store_id)                                    AS store_coverage,
        SUM(observation_count)                                       AS obs_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY weighted_price)
          FILTER (WHERE pricing_tier = 'shelf')                      AS median_shelf_price,
        MAX(price_unit) FILTER (WHERE pricing_tier = 'shelf')        AS shelf_price_unit
      FROM current_prices
      GROUP BY canonical_id
    ),
    src_stats AS (
      -- Source breakdown of raw observations (not the materialized view) so
      -- a canonical priced exclusively from synthetic seed shows up clearly.
      SELECT
        canonical_id,
        COUNT(*) FILTER (WHERE source = 'fake')        AS obs_fake,
        COUNT(*) FILTER (WHERE source = 'receipt')     AS obs_receipt,
        COUNT(*) FILTER (WHERE source = 'manual')      AS obs_manual,
        COUNT(*) FILTER (WHERE source NOT IN ('fake','receipt','manual')) AS obs_other
      FROM price_observations
      WHERE canonical_id IS NOT NULL
      GROUP BY canonical_id
    ),
    off_stats AS (
      SELECT
        canonical_id,
        COUNT(*)                          AS off_link_count,
        AVG(confidence)                   AS off_mean_confidence
      FROM canonical_barcodes
      GROUP BY canonical_id
    )
    SELECT
      cp.canonical_id,
      cp.name,
      cp.brand,
      cp.is_store_brand,
      cp.package_size,
      cp.package_unit,
      cp.pricing_unit,
      cp.upc,
      cat.name                                                       AS category_name,
      (cp.description_embedding IS NOT NULL)                         AS has_embedding,
      COALESCE(ps.store_coverage, 0)                                 AS store_coverage,
      COALESCE(ps.obs_count, 0)                                      AS obs_count,
      ps.median_shelf_price,
      ps.shelf_price_unit,
      COALESCE(os.off_link_count, 0)                                 AS off_link_count,
      os.off_mean_confidence,
      COALESCE(ss.obs_fake, 0)::int                                  AS obs_fake,
      COALESCE(ss.obs_receipt, 0)::int                               AS obs_receipt,
      COALESCE(ss.obs_manual, 0)::int                                AS obs_manual,
      COALESCE(ss.obs_other, 0)::int                                 AS obs_other
    FROM canonical_products cp
    LEFT JOIN product_categories cat ON cat.category_id = cp.category_id
    LEFT JOIN price_stats ps ON ps.canonical_id = cp.canonical_id
    LEFT JOIN off_stats   os ON os.canonical_id = cp.canonical_id
    LEFT JOIN src_stats   ss ON ss.canonical_id = cp.canonical_id
    ORDER BY cp.name ASC
    `,
    [],
  )
}

/** Identity + full-row lookup for a single canonical. Returns null when missing. */
export async function getProduct(canonicalId) {
  const rows = await query(
    `
    SELECT
      cp.canonical_id,
      cp.name,
      cp.brand,
      cp.is_store_brand,
      cp.store_brand_chain_id,
      cb_chain.name                                                  AS store_brand_chain_name,
      cp.package_size,
      cp.package_unit,
      cp.pricing_unit,
      cp.upc,
      cp.category_id,
      cat.name                                                       AS category_name,
      cat.parent_category_id,
      parent_cat.name                                                AS parent_category_name,
      cp.created_at,
      (cp.description_embedding IS NOT NULL)                         AS has_embedding,
      -- First 8 dims of the embedding for the "embedding present" preview.
      -- The full vector is ~1.5 KB; we don't need it on the page.
      CASE WHEN cp.description_embedding IS NOT NULL
           THEN (cp.description_embedding::text)
           ELSE NULL
      END                                                            AS embedding_text
    FROM canonical_products cp
    LEFT JOIN product_categories cat        ON cat.category_id        = cp.category_id
    LEFT JOIN product_categories parent_cat ON parent_cat.category_id = cat.parent_category_id
    LEFT JOIN chains              cb_chain  ON cb_chain.chain_id      = cp.store_brand_chain_id
    WHERE cp.canonical_id = $1
    `,
    [canonicalId],
  )
  return rows[0] || null
}

/**
 * Every barcode linked to a canonical via canonical_barcodes, with link
 * confidence + source. The route handler then calls getEnrichmentBatch()
 * against OFF SQLite for each barcode to render the enrichment panel.
 */
export async function getProductBarcodes(canonicalId) {
  return query(
    `
    SELECT barcode, source, confidence, added_at
    FROM canonical_barcodes
    WHERE canonical_id = $1
    ORDER BY confidence DESC, added_at ASC
    `,
    [canonicalId],
  )
}

/**
 * Variant of nearbyPrices that drops the ST_DWithin filter — returns every
 * store that has a current_price for the given canonical(s), regardless of
 * distance. Used by the inspector's product detail page where "alternatives"
 * means "every store with this product priced," not "stores near a user."
 *
 * Same row shape as compare.mjs's nearbyPrices() so the adapter logic in
 * the page can be the simpler one.
 *
 * @param {number[]} canonicalIds
 */
export async function nearbyPricesGlobal(canonicalIds) {
  if (!canonicalIds || canonicalIds.length === 0) return []
  return query(
    `
    WITH exact_rows AS (
      SELECT
        cp.canonical_id          AS user_canonical_id,
        cp.canonical_id          AS canonical_id,
        cp.weighted_price,
        cp.price_unit,
        cp.pricing_tier,
        cp.observation_count,
        cp.most_recent_observation,
        cp.freshness,
        s.store_id,
        s.address,
        ST_X(s.location::geometry) AS lon,
        ST_Y(s.location::geometry) AS lat,
        c.chain_id,
        c.name AS chain_name,
        ss.display_name,
        'exact'::text             AS match_type,
        1.0::numeric              AS equivalence_strength,
        cp_self.name              AS equiv_name,
        cp_self.package_size      AS equiv_pack_size,
        cp_self.package_unit      AS equiv_pack_unit
      FROM current_prices cp
      JOIN stores s            ON s.store_id = cp.store_id
      JOIN chains c            ON c.chain_id = cp.chain_id
      JOIN canonical_products cp_self ON cp_self.canonical_id = cp.canonical_id
      LEFT JOIN store_skus ss
        ON ss.chain_id = cp.chain_id
       AND ss.canonical_id = cp.canonical_id
       AND ss.store_id IS NULL
      WHERE cp.canonical_id = ANY($1::int[])
    ),
    equivalents AS (
      SELECT
        egm_user.canonical_id  AS user_canonical_id,
        egm_peer.canonical_id  AS equiv_canonical_id,
        MIN(LEAST(egm_user.equivalence_strength, egm_peer.equivalence_strength))
                               AS equivalence_strength
      FROM equivalence_group_members egm_user
      JOIN equivalence_group_members egm_peer
        ON egm_peer.group_id = egm_user.group_id
       AND egm_peer.canonical_id <> egm_user.canonical_id
      WHERE egm_user.canonical_id = ANY($1::int[])
      GROUP BY egm_user.canonical_id, egm_peer.canonical_id
    ),
    equivalent_rows AS (
      SELECT
        eq.user_canonical_id,
        cp.canonical_id,
        cp.weighted_price,
        cp.price_unit,
        cp.pricing_tier,
        cp.observation_count,
        cp.most_recent_observation,
        cp.freshness,
        s.store_id,
        s.address,
        ST_X(s.location::geometry) AS lon,
        ST_Y(s.location::geometry) AS lat,
        c.chain_id,
        c.name AS chain_name,
        ss.display_name,
        'equivalent'::text       AS match_type,
        eq.equivalence_strength,
        cp_peer.name             AS equiv_name,
        cp_peer.package_size     AS equiv_pack_size,
        cp_peer.package_unit     AS equiv_pack_unit
      FROM equivalents eq
      JOIN current_prices cp   ON cp.canonical_id = eq.equiv_canonical_id
      JOIN stores s            ON s.store_id = cp.store_id
      JOIN chains c            ON c.chain_id = cp.chain_id
      JOIN canonical_products cp_peer ON cp_peer.canonical_id = eq.equiv_canonical_id
      LEFT JOIN store_skus ss
        ON ss.chain_id = cp.chain_id
       AND ss.canonical_id = cp.canonical_id
       AND ss.store_id IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM current_prices cp_x
        WHERE cp_x.canonical_id = eq.user_canonical_id
          AND cp_x.store_id = cp.store_id
      )
    )
    SELECT * FROM exact_rows
    UNION ALL
    SELECT * FROM equivalent_rows
    ORDER BY user_canonical_id, match_type ASC, weighted_price ASC
    `,
    [canonicalIds],
  )
}

/**
 * Equivalence-group peers for a single canonical — surfaced as the
 * "alternatives" section even when no current_prices exist yet, so the page
 * can distinguish "no prices" from "no equivalence relations defined."
 *
 * Returns rows of peer canonicals (one per peer) with the equivalence group's
 * name + the strongest equivalence_strength tying them.
 */
export async function getEquivalencePeers(canonicalId) {
  return query(
    `
    SELECT
      eg.group_id,
      eg.name                                                        AS group_name,
      peer.canonical_id                                              AS peer_canonical_id,
      peer.name                                                      AS peer_name,
      peer.brand                                                     AS peer_brand,
      peer.package_size                                              AS peer_package_size,
      peer.package_unit                                              AS peer_package_unit,
      MIN(LEAST(egm_user.equivalence_strength, egm_peer.equivalence_strength))
                                                                     AS equivalence_strength
    FROM equivalence_group_members egm_user
    JOIN equivalence_group_members egm_peer
      ON egm_peer.group_id = egm_user.group_id
     AND egm_peer.canonical_id <> egm_user.canonical_id
    JOIN equivalence_groups eg ON eg.group_id = egm_user.group_id
    JOIN canonical_products peer ON peer.canonical_id = egm_peer.canonical_id
    WHERE egm_user.canonical_id = $1
    GROUP BY eg.group_id, eg.name, peer.canonical_id
    ORDER BY equivalence_strength DESC, peer.name ASC
    `,
    [canonicalId],
  )
}

// ── Search (overview quick search) ──────────────────────────────────────────

/**
 * Lightweight typeahead — returns the first few canonical products and stores
 * matching `q`. Empty `q` returns []. Capped at 10 each.
 */
export async function quickSearch(q, limit = 10) {
  const term = (q || '').trim()
  if (!term) return { products: [], stores: [] }
  const like = `%${term}%`
  const products = await query(
    `
    SELECT canonical_id, name, brand, package_size, package_unit
    FROM canonical_products
    WHERE name ILIKE $1 OR brand ILIKE $1
    ORDER BY name
    LIMIT $2
    `,
    [like, limit],
  )
  const stores = await query(
    `
    SELECT s.store_id, s.address, c.name AS chain_name
    FROM stores s
    JOIN chains c USING (chain_id)
    WHERE s.address ILIKE $1 OR c.name ILIKE $1
    ORDER BY c.name, s.address
    LIMIT $2
    `,
    [like, limit],
  )
  return { products, stores }
}

/**
 * For a list of barcodes, return any (canonical_id, barcode) link rows.
 * Used by the OFF browser to overlay "linked to canonical" badges on
 * search-result rows without one query per row.
 *
 * @param {string[]} barcodes
 */
export async function getCanonicalLinksForBarcodes(barcodes) {
  if (!barcodes || barcodes.length === 0) return []
  return query(
    `
    SELECT cb.barcode, cb.canonical_id, cb.source, cb.confidence, cp.name
    FROM canonical_barcodes cb
    JOIN canonical_products cp USING (canonical_id)
    WHERE cb.barcode = ANY($1::text[])
    `,
    [barcodes],
  )
}

// ── Source attribution & data-lineage queries ──────────────────────────────
//
// Everything in this section answers the user's "what's fake vs real, and
// where does this data come from?" question. The schema tracks source in
// three places:
//   - price_observations.source     ('fake'|'receipt'|'manual'|'usda_seed'|'scrape')
//   - canonical_barcodes.source     ('off_curated'|'receipt'|'manual')
//   - store_skus.verified_by        ('auto'|'manual'|'fake_seed'|user_id)

/**
 * Global breakdown of price_observations by source. Used on the overview
 * page's "Data health" hero so the team can see at a glance what fraction
 * of the price graph is synthetic.
 *
 * Returns: [{source, count}] — empty array on a fresh DB.
 */
export async function getObservationSourceBreakdown() {
  return query(
    `
    SELECT source, COUNT(*)::int AS count
    FROM price_observations
    GROUP BY source
    ORDER BY count DESC
    `,
    [],
  )
}

/** Same idea but for store_skus.verified_by. */
export async function getSkuVerifiedByBreakdown() {
  return query(
    `
    SELECT COALESCE(verified_by, 'unknown') AS source, COUNT(*)::int AS count
    FROM store_skus
    GROUP BY COALESCE(verified_by, 'unknown')
    ORDER BY count DESC
    `,
    [],
  )
}

/** Same idea but for canonical_barcodes.source. */
export async function getBarcodeSourceBreakdown() {
  return query(
    `
    SELECT source, COUNT(*)::int AS count
    FROM canonical_barcodes
    GROUP BY source
    ORDER BY count DESC
    `,
    [],
  )
}

/**
 * Per-store source breakdown of price observations. Used on the store
 * detail + stores list to flag stores whose data is entirely synthetic.
 */
export async function getStoreSourceBreakdown(storeId) {
  return query(
    `
    SELECT source, COUNT(*)::int AS count
    FROM price_observations
    WHERE store_id = $1
    GROUP BY source
    ORDER BY count DESC
    `,
    [storeId],
  )
}

/** Per-canonical source breakdown of price observations. */
export async function getProductSourceBreakdown(canonicalId) {
  return query(
    `
    SELECT source, COUNT(*)::int AS count
    FROM price_observations
    WHERE canonical_id = $1
    GROUP BY source
    ORDER BY count DESC
    `,
    [canonicalId],
  )
}

/**
 * Counts of receipts in the system, broken down by status. The receipts
 * table is empty when the only seeding path used is generate-fake-prices
 * (which writes price_observations directly with no parent receipt row).
 */
export async function getReceiptCounts() {
  const rows = await query(
    `
    SELECT
      COUNT(*)::int                                                          AS total,
      COUNT(*) FILTER (WHERE processing_status = 'processed')::int           AS processed,
      COUNT(*) FILTER (WHERE processing_status = 'pending')::int             AS pending,
      COUNT(*) FILTER (WHERE processing_status = 'partial')::int             AS partial,
      COUNT(*) FILTER (WHERE processing_status = 'failed')::int              AS failed,
      MAX(uploaded_at)                                                        AS most_recent_upload
    FROM receipts
    `,
    [],
  )
  return rows[0] || { total: 0, processed: 0, pending: 0, partial: 0, failed: 0, most_recent_upload: null }
}

/**
 * Recent receipts for the receipts list page. Empty array on a fresh DB.
 *
 * Returns rows with chain + store context, line-item count, match-success
 * count, and the receipt total (for cross-checking against the parsed sum).
 */
export async function listReceipts(limit = 100) {
  return query(
    `
    SELECT
      r.receipt_id,
      r.uploaded_at,
      r.receipt_dated_at,
      r.processing_status,
      r.ocr_engine,
      r.ocr_confidence_avg,
      r.receipt_total,
      r.line_count,
      r.image_hash,
      r.store_id,
      s.address                                              AS store_address,
      c.chain_id,
      c.name                                                 AS chain_name,
      ic.chain_id                                            AS inferred_chain_id,
      ic.name                                                AS inferred_chain_name,
      (SELECT COUNT(*) FROM receipt_line_items rli
        WHERE rli.receipt_id = r.receipt_id)::int            AS rli_count,
      (SELECT COUNT(*) FROM receipt_line_items rli
        WHERE rli.receipt_id = r.receipt_id
          AND rli.matched_store_sku_id IS NOT NULL)::int     AS rli_matched_count,
      (SELECT COUNT(*) FROM price_observations po
        WHERE po.source_receipt_id = r.receipt_id)::int      AS observations_written
    FROM receipts r
    LEFT JOIN stores s   ON s.store_id = r.store_id
    LEFT JOIN chains c   ON c.chain_id = s.chain_id
    LEFT JOIN chains ic  ON ic.chain_id = r.inferred_chain_id
    ORDER BY r.uploaded_at DESC
    LIMIT $1
    `,
    [limit],
  )
}

/** One receipt row with full detail. Returns null when not found. */
export async function getReceipt(receiptId) {
  const rows = await query(
    `
    SELECT
      r.*,
      s.address                                  AS store_address,
      ST_X(s.location::geometry)                 AS store_lon,
      ST_Y(s.location::geometry)                 AS store_lat,
      c.chain_id                                 AS resolved_chain_id,
      c.name                                     AS chain_name,
      ic.name                                    AS inferred_chain_name
    FROM receipts r
    LEFT JOIN stores s   ON s.store_id = r.store_id
    LEFT JOIN chains c   ON c.chain_id = s.chain_id
    LEFT JOIN chains ic  ON ic.chain_id = r.inferred_chain_id
    WHERE r.receipt_id = $1
    `,
    [receiptId],
  )
  return rows[0] || null
}

/**
 * Every line item on a receipt with the matched SKU + canonical info, plus
 * the price observations the line wrote (if any). One row per line.
 */
export async function getReceiptLineItems(receiptId) {
  return query(
    `
    SELECT
      rli.line_item_id,
      rli.line_number,
      rli.raw_text,
      rli.parsed_quantity,
      rli.parsed_unit,
      rli.parsed_price_total,
      rli.match_confidence,
      rli.needs_review,
      rli.matched_store_sku_id,
      ss.canonical_id                                 AS sku_canonical_id,
      ss.receipt_text_canonical                       AS sku_receipt_text,
      ss.display_name                                 AS sku_display_name,
      ss.status                                       AS sku_status,
      ss.verified_by                                  AS sku_verified_by,
      cp.name                                         AS canonical_name,
      cp.brand                                        AS canonical_brand,
      cp.package_size                                 AS canonical_package_size,
      cp.package_unit                                 AS canonical_package_unit,
      (SELECT COUNT(*) FROM price_observations po
        WHERE po.source_receipt_id = rli.receipt_id
          AND po.store_sku_id      = rli.matched_store_sku_id)::int  AS observations_written
    FROM receipt_line_items rli
    LEFT JOIN store_skus ss          ON ss.store_sku_id = rli.matched_store_sku_id
    LEFT JOIN canonical_products cp  ON cp.canonical_id = ss.canonical_id
    WHERE rli.receipt_id = $1
    ORDER BY rli.line_number ASC
    `,
    [receiptId],
  )
}

/**
 * Recent price observations as a stream — used on the overview's "latest
 * activity" panel so we can see whether new data is coming in.
 */
export async function listRecentObservations(limit = 20) {
  return query(
    `
    SELECT
      po.observation_id,
      po.source,
      po.pricing_tier,
      po.price_total,
      po.price_per_unit,
      po.price_unit,
      po.observed_at,
      po.ingested_at,
      po.confidence,
      po.canonical_id,
      cp.name                            AS canonical_name,
      po.store_id,
      s.address                          AS store_address,
      c.name                             AS chain_name
    FROM price_observations po
    LEFT JOIN canonical_products cp ON cp.canonical_id = po.canonical_id
    JOIN stores s   ON s.store_id = po.store_id
    JOIN chains c   ON c.chain_id = po.chain_id
    ORDER BY po.ingested_at DESC, po.observation_id DESC
    LIMIT $1
    `,
    [limit],
  )
}

/**
 * Header counts grouped at the level of "what is real demo-ready data
 * vs what is synthetic seed." Returns:
 *   {
 *     observations: {total, fake, real},
 *     skus:         {total, fake, real},
 *     barcodes:     {total, off, receipt, manual},
 *     receipts:     {total},
 *     stores_with_real, stores_with_only_fake, stores_with_no_data,
 *   }
 */
export async function getDataHealth() {
  const rows = await query(
    `
    WITH obs AS (
      SELECT
        COUNT(*)                                                 AS total,
        COUNT(*) FILTER (WHERE source = 'fake')                  AS fake,
        COUNT(*) FILTER (WHERE source <> 'fake')                 AS real
      FROM price_observations
    ),
    skus AS (
      SELECT
        COUNT(*)                                                 AS total,
        COUNT(*) FILTER (WHERE verified_by = 'fake_seed')        AS fake,
        COUNT(*) FILTER (WHERE verified_by IS DISTINCT FROM 'fake_seed') AS real
      FROM store_skus
    ),
    bc AS (
      SELECT
        COUNT(*)                                                 AS total,
        COUNT(*) FILTER (WHERE source = 'off_curated')           AS off,
        COUNT(*) FILTER (WHERE source = 'receipt')               AS receipt,
        COUNT(*) FILTER (WHERE source = 'manual')                AS manual
      FROM canonical_barcodes
    ),
    receipt_count AS (
      SELECT COUNT(*) AS total FROM receipts
    ),
    store_breakdown AS (
      SELECT
        COUNT(DISTINCT s.store_id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM price_observations po
            WHERE po.store_id = s.store_id AND po.source <> 'fake'
          )
        )                                                         AS with_real,
        COUNT(DISTINCT s.store_id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM price_observations po WHERE po.store_id = s.store_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM price_observations po
            WHERE po.store_id = s.store_id AND po.source <> 'fake'
          )
        )                                                         AS with_only_fake,
        COUNT(DISTINCT s.store_id) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM price_observations po WHERE po.store_id = s.store_id
          )
        )                                                         AS with_no_data
      FROM stores s
    )
    SELECT
      obs.total::int                AS obs_total,
      obs.fake::int                 AS obs_fake,
      obs.real::int                 AS obs_real,
      skus.total::int               AS skus_total,
      skus.fake::int                AS skus_fake,
      skus.real::int                AS skus_real,
      bc.total::int                 AS bc_total,
      bc.off::int                   AS bc_off,
      bc.receipt::int               AS bc_receipt,
      bc.manual::int                AS bc_manual,
      receipt_count.total::int      AS receipts_total,
      store_breakdown.with_real::int     AS stores_with_real,
      store_breakdown.with_only_fake::int AS stores_with_only_fake,
      store_breakdown.with_no_data::int  AS stores_with_no_data
    FROM obs, skus, bc, receipt_count, store_breakdown
    `,
    [],
  )
  return rows[0] || {
    obs_total: 0, obs_fake: 0, obs_real: 0,
    skus_total: 0, skus_fake: 0, skus_real: 0,
    bc_total: 0, bc_off: 0, bc_receipt: 0, bc_manual: 0,
    receipts_total: 0,
    stores_with_real: 0, stores_with_only_fake: 0, stores_with_no_data: 0,
  }
}

// Exported for any consumer that wants to convert miles to meters with
// the same constant the comparison route uses.
export { METERS_PER_MILE }
