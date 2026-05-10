-- ============================================================================
-- AfterCart-BC (Barcode-keyed) Database Schema
-- PostgreSQL 15+ with PostGIS and pgvector extensions
-- ============================================================================
-- Design principles:
--   1. Barcode (UPC) is the primary identifier for price observations.
--      OFF Prices gives us 26k real receipt-verified observations keyed on
--      (product_code, location). The schema mirrors that structure directly
--      so we don't lose specificity through a curated-canonical middleman.
--   2. Canonical products survive ONLY for produce / bulk / no-UPC items
--      (Honeycrisp at Safeway, bulk bins). Roughly 200 rows after pruning.
--   3. OFF locations are authoritative for stores. USDA SNAP data is demoted
--      to a flag (snap_authorized) — useful for the SNAP-recipient primary
--      user but not the row identity.
--   4. Equivalence is derived from OFF categories_tags + brands + pack_size,
--      not hand-curated. Members can be either barcodes or canonical_ids.
--   5. price_observations / store_skus from the v1 schema are dropped.
--      Real OFF Prices data flows directly into `prices`. Receipt uploads
--      with a barcoded user-pick also write to `prices`. Produce / no-UPC
--      observations go to `unbarcoded_observations`.
--   6. Geographic queries via PostGIS; SKU normalization via pgvector.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- for fuzzy text matching on receipt strings

-- ----------------------------------------------------------------------------
-- LAYER 1: Reference data (slow-changing)
-- ----------------------------------------------------------------------------

CREATE TABLE chains (
    chain_id           SERIAL PRIMARY KEY,
    name               TEXT NOT NULL UNIQUE,        -- "Trader Joe's", "Costco", "Whole Foods Market"
    osm_brand          TEXT UNIQUE,                 -- value of OSM `brand` tag, used to map OFF locations
    parent_company     TEXT,                        -- "Albertsons" for Safeway
    pricing_model      TEXT,                        -- 'chain_uniform' | 'regional' | 'per_store'
    notes              TEXT
);
CREATE INDEX chains_osm_brand_idx ON chains(LOWER(osm_brand));

-- Stores: OFF locations are authoritative. USDA SNAP entries get merged in
-- via PostGIS proximity dedup (50m, same chain) on ingest. SNAP-only stores
-- without an OFF match remain as `source='usda_only'`.
CREATE TABLE stores (
    store_id           BIGSERIAL PRIMARY KEY,
    osm_id             BIGINT UNIQUE,               -- OFF Locations key; nullable for usda_only rows
    osm_type           TEXT,                        -- 'NODE' | 'WAY' | 'RELATION'
    osm_brand          TEXT,                        -- "Costco", "Safeway", ... — pre-mapped to chains.osm_brand
    chain_id           INTEGER REFERENCES chains(chain_id),
    display_name       TEXT NOT NULL,               -- the customer-facing name
    location           GEOGRAPHY(POINT, 4326) NOT NULL,
    address_full       TEXT,
    city               TEXT,
    state              TEXT,
    postal_code        TEXT,
    country_code       CHAR(2) NOT NULL DEFAULT 'US',
    snap_authorized    BOOLEAN NOT NULL DEFAULT FALSE,
    usda_retailer_id   TEXT,                        -- nullable; from USDA SNAP retailer registry
    source             TEXT NOT NULL                -- 'off' | 'usda_only' | 'merged'
                       CHECK (source IN ('off', 'usda_only', 'merged')),
    opened_at          DATE,
    closed_at          DATE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX stores_location_gix ON stores USING GIST (location);
CREATE INDEX stores_chain_idx ON stores(chain_id);
CREATE INDEX stores_source_idx ON stores(source);

CREATE TABLE product_categories (
    category_id              SERIAL PRIMARY KEY,
    name                     TEXT NOT NULL,
    parent_category_id       INTEGER REFERENCES product_categories(category_id),
    usda_fdc_id              INTEGER
);

-- ----------------------------------------------------------------------------
-- LAYER 2: Canonical products (DEMOTED — produce / no-UPC only)
-- ----------------------------------------------------------------------------
-- A canonical_product is the comparison anchor for items WITHOUT a stable
-- universal barcode: produce sold by weight, bulk-bin items, store-internal
-- SKUs (Costco's 6-digit numbers). Packaged-goods canonicals from v1 are
-- removed — those products live natively in the OFF SQLite catalog and the
-- comparison joins on barcode directly.

CREATE TABLE canonical_products (
    canonical_id            SERIAL PRIMARY KEY,
    name                    TEXT NOT NULL,           -- "Honeycrisp Apple", "Bulk Quinoa"
    brand                   TEXT,                    -- typically NULL for produce
    is_store_brand          BOOLEAN NOT NULL DEFAULT FALSE,
    store_brand_chain_id    INTEGER REFERENCES chains(chain_id),
    package_size            NUMERIC,                 -- nullable for sold-by-weight
    package_unit            TEXT,                    -- 'lb' | 'oz' | 'each'
    pricing_unit            TEXT NOT NULL,           -- 'per_lb' | 'per_each' | 'per_oz'
    category_id             INTEGER REFERENCES product_categories(category_id),
    description_embedding   VECTOR(384),             -- for matcher.mjs in-memory matching
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX canonical_products_category_idx ON canonical_products(category_id);
CREATE INDEX canonical_products_embedding_idx ON canonical_products
    USING hnsw (description_embedding vector_cosine_ops);

-- Bridge: canonical → OFF barcodes for enrichment fallback.
-- Kept from v1 (its purpose is unchanged: when a no-UPC produce match has
-- a known equivalent OFF entry, the modal renders the OFF enrichment).
CREATE TABLE canonical_barcodes (
    canonical_id INTEGER NOT NULL REFERENCES canonical_products(canonical_id) ON DELETE CASCADE,
    barcode      TEXT    NOT NULL,
    source       TEXT    NOT NULL DEFAULT 'off_curated'
                        CHECK (source IN ('off_curated', 'receipt', 'manual')),
    confidence   NUMERIC(3,2) NOT NULL DEFAULT 0.80,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (canonical_id, barcode)
);
CREATE INDEX canonical_barcodes_barcode_idx ON canonical_barcodes(barcode);

-- ----------------------------------------------------------------------------
-- LAYER 3: Equivalence (heterogeneous: barcode OR canonical members)
-- ----------------------------------------------------------------------------
-- Cross-brand same-category groupings (Lucerne 1gal whole milk ↔ 365 1gal
-- whole milk), cross-pack-size same-brand groupings (Kirkland PB 48oz ↔
-- Kirkland PB 28oz), house-brand cross-walks (Kirkland whole milk ↔
-- Lucerne whole milk).
--
-- Populated by `web/scripts/derive-equivalences.mjs` — reads OFF
-- `categories_tags` + `brands` + `product_quantity` and emits groupings.
-- Manually-curated overrides allowed via source='manual'.

CREATE TABLE equivalence_groups (
    group_id     SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,                    -- "Whole milk, 1 gal"
    description  TEXT,
    source       TEXT NOT NULL DEFAULT 'derived'
                CHECK (source IN ('derived', 'manual')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE equivalence_group_members (
    member_id            BIGSERIAL PRIMARY KEY,
    group_id             INTEGER NOT NULL REFERENCES equivalence_groups(group_id) ON DELETE CASCADE,
    member_kind          TEXT NOT NULL CHECK (member_kind IN ('barcode', 'canonical')),
    barcode              TEXT,                      -- set when member_kind='barcode'
    canonical_id         INTEGER REFERENCES canonical_products(canonical_id),
                                                    -- set when member_kind='canonical'
    equivalence_strength NUMERIC(3,2) NOT NULL,
    notes                TEXT,
    CHECK (
      (member_kind = 'barcode'   AND barcode IS NOT NULL AND canonical_id IS NULL) OR
      (member_kind = 'canonical' AND canonical_id IS NOT NULL AND barcode IS NULL)
    ),
    CHECK (equivalence_strength > 0 AND equivalence_strength <= 1.0)
);
CREATE UNIQUE INDEX eqgm_group_barcode_idx ON equivalence_group_members(group_id, barcode)
    WHERE member_kind = 'barcode';
CREATE UNIQUE INDEX eqgm_group_canonical_idx ON equivalence_group_members(group_id, canonical_id)
    WHERE member_kind = 'canonical';
CREATE INDEX eqgm_barcode_idx ON equivalence_group_members(barcode) WHERE member_kind = 'barcode';
CREATE INDEX eqgm_canonical_idx ON equivalence_group_members(canonical_id) WHERE member_kind = 'canonical';

-- ----------------------------------------------------------------------------
-- LAYER 4: Receipt domain (raw upload data, preserved forever)
-- ----------------------------------------------------------------------------

CREATE TABLE receipts (
    receipt_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID,                       -- nullable for anonymous uploads
    store_id              BIGINT REFERENCES stores(store_id),
    inferred_chain_id     INTEGER REFERENCES chains(chain_id),
    receipt_dated_at      TIMESTAMPTZ,
    uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    image_hash            TEXT,                       -- SHA-256 for dedup; image bytes not stored
    ocr_engine            TEXT,
    ocr_confidence_avg    NUMERIC(3,2),
    receipt_total         NUMERIC(10,2),
    line_count            INTEGER,
    processing_status     TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX receipts_user_idx ON receipts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX receipts_store_idx ON receipts(store_id);
CREATE INDEX receipts_uploaded_idx ON receipts(uploaded_at DESC);

CREATE TABLE receipt_line_items (
    line_item_id          BIGSERIAL PRIMARY KEY,
    receipt_id            UUID NOT NULL REFERENCES receipts(receipt_id) ON DELETE CASCADE,
    line_number           INTEGER NOT NULL,
    raw_text              TEXT NOT NULL,
    parsed_quantity       NUMERIC,
    parsed_unit           TEXT,
    parsed_price_total    NUMERIC(10,2),
    parsed_code           TEXT,                       -- UPC printed on the receipt line, if any
    matched_barcode       TEXT,                       -- user-confirmed barcode pick (priority)
    matched_canonical_id  INTEGER REFERENCES canonical_products(canonical_id),
                                                      -- user-confirmed canonical pick (produce path)
    match_confidence      NUMERIC(3,2),
    needs_review          BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (receipt_id, line_number),
    CHECK (
      matched_barcode IS NULL OR matched_canonical_id IS NULL
    )  -- a line resolves to AT MOST one of barcode or canonical
);
CREATE INDEX rli_review_idx ON receipt_line_items(needs_review) WHERE needs_review = TRUE;
CREATE INDEX rli_barcode_idx ON receipt_line_items(matched_barcode) WHERE matched_barcode IS NOT NULL;
CREATE INDEX rli_canonical_idx ON receipt_line_items(matched_canonical_id)
    WHERE matched_canonical_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- LAYER 5: Price observations
-- ----------------------------------------------------------------------------
-- Two append-only tables. `prices` is the primary path (barcode-keyed);
-- `unbarcoded_observations` is the produce/no-UPC fallback (canonical-keyed).
-- OFF Prices ingest writes only to `prices` (OFF doesn't store unbarcoded
-- prices). Receipt uploads write to whichever table corresponds to the
-- user's confirmed pick.

CREATE TABLE prices (
    price_id                BIGSERIAL PRIMARY KEY,
    barcode                 TEXT      NOT NULL,
    store_id                BIGINT    NOT NULL REFERENCES stores(store_id),
    chain_id                INTEGER   REFERENCES chains(chain_id),  -- denorm
    price                   NUMERIC(10,2) NOT NULL,                  -- total paid
    currency                CHAR(3)   NOT NULL DEFAULT 'USD',
    price_per               NUMERIC(10,4),                           -- OFF's price_per (per-unit); nullable
    receipt_quantity        NUMERIC,                                 -- units purchased on the receipt
    pricing_tier            TEXT      NOT NULL DEFAULT 'shelf'
                                      CHECK (pricing_tier IN ('shelf','member','sale')),
    price_is_discounted     BOOLEAN   NOT NULL DEFAULT FALSE,
    price_without_discount  NUMERIC(10,2),                           -- pre-discount price when applicable
    discount_type           TEXT,                                    -- OFF discount taxonomy
    observed_at             DATE      NOT NULL,
    source                  TEXT      NOT NULL,                     -- 'off_prices' | 'receipt' | 'manual'
    proof_id                TEXT,                                    -- OFF proof UUID (for receipt photo)
    proof_image_url         TEXT,                                    -- direct link to OFF proof image
    source_external_id      TEXT,                                    -- OFF Prices price.id, when source='off_prices'
    source_receipt_id       UUID REFERENCES receipts(receipt_id),    -- our internal receipt
    owner_handle            TEXT,                                    -- OFF contributor handle (anon)
    confidence              NUMERIC(3,2) NOT NULL,
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, source_external_id)  -- prevents double-importing the same OFF record
);
CREATE INDEX prices_barcode_store_time ON prices (barcode, store_id, observed_at DESC);
CREATE INDEX prices_store_recent       ON prices (store_id, observed_at DESC);
CREATE INDEX prices_chain_barcode      ON prices (chain_id, barcode);
CREATE INDEX prices_observed_at_idx    ON prices (observed_at DESC);

-- Canonical-keyed fallback for produce / bulk / no-UPC items.
CREATE TABLE unbarcoded_observations (
    obs_id                  BIGSERIAL PRIMARY KEY,
    canonical_id            INTEGER   NOT NULL REFERENCES canonical_products(canonical_id),
    store_id                BIGINT    NOT NULL REFERENCES stores(store_id),
    chain_id                INTEGER   REFERENCES chains(chain_id),
    price_total             NUMERIC(10,2) NOT NULL,
    quantity                NUMERIC NOT NULL,
    quantity_unit           TEXT,
    price_per_unit          NUMERIC(10,4) NOT NULL,
    price_unit              TEXT NOT NULL,         -- 'per_lb' | 'per_oz' | 'per_each'
    pricing_tier            TEXT NOT NULL DEFAULT 'shelf'
                                CHECK (pricing_tier IN ('shelf','member','sale')),
    observed_at             DATE NOT NULL,
    source                  TEXT NOT NULL,         -- 'receipt' | 'manual'
    source_receipt_id       UUID REFERENCES receipts(receipt_id),
    confidence              NUMERIC(3,2) NOT NULL,
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX unbarc_canonical_store_time ON unbarcoded_observations
    (canonical_id, store_id, observed_at DESC);
CREATE INDEX unbarc_store_recent ON unbarcoded_observations(store_id, observed_at DESC);

-- ----------------------------------------------------------------------------
-- LAYER 6: Materialized views — what comparison queries hit
-- ----------------------------------------------------------------------------
-- No averaging — DISTINCT ON pick of the latest observation per group.
-- Averaging WITHIN a (barcode/canonical, store) group is only meaningful when
-- every observation is the same product over time; the moment two distinct
-- products share a canonical, the average is fiction. The matview's job is
-- to surface "the most recent reliable price" — the latest observation IS
-- that. observation_count is preserved for the UI's trust signal; freshness
-- comes from the latest observed_at; column names stay the same so consumer
-- code (route.ts, semantic-compare.mjs, adapter.ts) doesn't churn.

CREATE MATERIALIZED VIEW current_prices AS
WITH counts AS (
    SELECT barcode, store_id, chain_id, pricing_tier, COUNT(*)::int AS n
    FROM prices
    GROUP BY barcode, store_id, chain_id, pricing_tier
),
latest AS (
    SELECT DISTINCT ON (barcode, store_id, chain_id, pricing_tier)
        barcode, store_id, chain_id, pricing_tier,
        price, price_per, observed_at
    FROM prices
    ORDER BY barcode, store_id, chain_id, pricing_tier,
             observed_at DESC, ingested_at DESC
)
SELECT
    l.barcode,
    l.store_id,
    l.chain_id,
    l.pricing_tier,
    l.price                         AS weighted_price,
    l.price_per                     AS weighted_price_per,
    c.n                             AS observation_count,
    l.observed_at                   AS most_recent_observation,
    CASE
        WHEN l.observed_at > (NOW() - INTERVAL '7 days')::date  THEN 'green'
        WHEN l.observed_at > (NOW() - INTERVAL '30 days')::date THEN 'yellow'
        ELSE 'red'
    END                             AS freshness
FROM latest l
JOIN counts c
    ON c.barcode = l.barcode
   AND c.store_id = l.store_id
   AND c.chain_id IS NOT DISTINCT FROM l.chain_id
   AND c.pricing_tier = l.pricing_tier;

CREATE UNIQUE INDEX current_prices_pk ON current_prices(barcode, store_id, pricing_tier);
CREATE INDEX current_prices_store_idx ON current_prices(store_id);
CREATE INDEX current_prices_barcode_idx ON current_prices(barcode);

-- Mirror matview for the produce / no-UPC path (same no-averaging behavior).
CREATE MATERIALIZED VIEW unbarcoded_current_prices AS
WITH counts AS (
    SELECT canonical_id, store_id, chain_id, price_unit, pricing_tier, COUNT(*)::int AS n
    FROM unbarcoded_observations
    GROUP BY canonical_id, store_id, chain_id, price_unit, pricing_tier
),
latest AS (
    SELECT DISTINCT ON (canonical_id, store_id, chain_id, price_unit, pricing_tier)
        canonical_id, store_id, chain_id, price_unit, pricing_tier,
        price_per_unit, observed_at
    FROM unbarcoded_observations
    ORDER BY canonical_id, store_id, chain_id, price_unit, pricing_tier,
             observed_at DESC, ingested_at DESC
)
SELECT
    l.canonical_id,
    l.store_id,
    l.chain_id,
    l.price_unit,
    l.pricing_tier,
    l.price_per_unit                AS weighted_price,
    c.n                             AS observation_count,
    l.observed_at                   AS most_recent_observation,
    CASE
        WHEN l.observed_at > (NOW() - INTERVAL '7 days')::date  THEN 'green'
        WHEN l.observed_at > (NOW() - INTERVAL '30 days')::date THEN 'yellow'
        ELSE 'red'
    END                             AS freshness
FROM latest l
JOIN counts c
    ON c.canonical_id = l.canonical_id
   AND c.store_id = l.store_id
   AND c.chain_id IS NOT DISTINCT FROM l.chain_id
   AND c.price_unit = l.price_unit
   AND c.pricing_tier = l.pricing_tier;

CREATE UNIQUE INDEX unbarcoded_current_prices_pk
    ON unbarcoded_current_prices(canonical_id, store_id, price_unit, pricing_tier);
CREATE INDEX unbarcoded_current_prices_store_idx
    ON unbarcoded_current_prices(store_id);

-- Refresh:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY unbarcoded_current_prices;

-- ----------------------------------------------------------------------------
-- USER DOMAIN (separate from price data; never joined in API responses)
-- ----------------------------------------------------------------------------

CREATE TABLE users (
    user_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    home_location         GEOGRAPHY(POINT, 4326),
    radius_miles          INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE user_baskets (
    basket_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    receipt_id            UUID NOT NULL REFERENCES receipts(receipt_id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alerts can fire on either a barcode (specific product) or a canonical
-- (the produce path). UI presents these uniformly.
CREATE TABLE user_alerts (
    alert_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    alert_kind            TEXT NOT NULL CHECK (alert_kind IN ('barcode','canonical')),
    barcode               TEXT,
    canonical_id          INTEGER REFERENCES canonical_products(canonical_id),
    threshold_price       NUMERIC(10,4) NOT NULL,
    threshold_unit        TEXT NOT NULL,
    radius_miles          INTEGER NOT NULL DEFAULT 5,
    active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
      (alert_kind='barcode'   AND barcode IS NOT NULL AND canonical_id IS NULL) OR
      (alert_kind='canonical' AND canonical_id IS NOT NULL AND barcode IS NULL)
    )
);

-- ----------------------------------------------------------------------------
-- LAYER 7: Field collection portal (staging tables)
-- ----------------------------------------------------------------------------
-- Photos captured via /field/* are sent to Gemini for shelf-tag transcription.
-- Extracted observations land in `field_observations` with status='pending',
-- then are reviewed one-by-one and promoted into `prices` (barcoded) or
-- `unbarcoded_observations` (canonical-keyed) on accept.

CREATE TABLE field_uploads (
    upload_id           BIGSERIAL PRIMARY KEY,
    store_id            BIGINT      NOT NULL REFERENCES stores(store_id),
    photo_url           TEXT        NOT NULL,
    photo_sha256        TEXT        NOT NULL,
    mode                TEXT        NOT NULL
                                    CHECK (mode IN ('shelf_tag','wide_shot','online_pdf')),
    contributor_handle  TEXT,
    raw_llm_response    JSONB,
    llm_model           TEXT        NOT NULL,
    notes               TEXT,
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (photo_sha256, store_id)
);
CREATE INDEX field_uploads_store_idx ON field_uploads(store_id);
CREATE INDEX field_uploads_uploaded_at_idx ON field_uploads(uploaded_at DESC);

CREATE TABLE field_observations (
    observation_id      BIGSERIAL PRIMARY KEY,
    upload_id           BIGINT      NOT NULL REFERENCES field_uploads(upload_id) ON DELETE CASCADE,
    store_id            BIGINT      NOT NULL REFERENCES stores(store_id),

    barcode             TEXT,
    product_name_raw    TEXT,
    brand               TEXT,
    canonical_id        INTEGER REFERENCES canonical_products(canonical_id),
    price               NUMERIC(10,2),
    member_price        NUMERIC(10,2),
    pack_size           NUMERIC,
    pack_unit           TEXT,
    pricing_tier        TEXT NOT NULL DEFAULT 'shelf'
                            CHECK (pricing_tier IN ('shelf','member','sale')),

    quantity            NUMERIC,
    quantity_unit       TEXT,
    price_per_unit      NUMERIC(10,4),
    price_unit          TEXT,

    llm_confidence      NUMERIC(3,2),
    llm_reasoning       TEXT,
    position_note       TEXT,

    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','accepted','rejected')),
    rejected_reason     TEXT,
    promoted_price_id   BIGINT REFERENCES prices(price_id),
    promoted_obs_id     BIGINT REFERENCES unbarcoded_observations(obs_id),

    observed_at         DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ,
    reviewed_by         TEXT,

    CHECK ((promoted_price_id IS NULL) OR (promoted_obs_id IS NULL))
);
CREATE INDEX field_obs_status_idx  ON field_observations(status);
CREATE INDEX field_obs_store_idx   ON field_observations(store_id);
CREATE INDEX field_obs_upload_idx  ON field_observations(upload_id);
CREATE INDEX field_obs_pending_idx ON field_observations(status, created_at DESC)
    WHERE status = 'pending';

-- "Starred" stores show up at the top of the field portal home as a
-- shortcut list. Doesn't affect any other queries.
ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS is_field_starred BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS stores_field_starred_idx
    ON stores(is_field_starred) WHERE is_field_starred;

-- ============================================================================
-- KEY QUERY PATTERNS
-- ============================================================================
--
-- 1. Barcode-keyed comparison (Tier 1):
--   SELECT
--     cp.barcode, cp.weighted_price, cp.observation_count, cp.most_recent_observation, cp.freshness,
--     s.store_id, s.osm_id, s.display_name, s.snap_authorized,
--     ST_Distance(s.location, $loc::geography)/1609.344 AS distance_miles,
--     c.chain_id, c.name AS chain_name
--   FROM current_prices cp
--   JOIN stores s ON s.store_id = cp.store_id
--   JOIN chains c ON c.chain_id = s.chain_id
--   WHERE cp.barcode = ANY($barcodes::text[])
--     AND ST_DWithin(s.location, $loc::geography, $radius_miles * 1609.344);
--
-- 2. Equivalent-barcode comparison (Tier 2 — for items with no Tier 1 hit):
--   ... join through equivalence_group_members ...
--
-- 3. Canonical (produce) comparison (Tier 3):
--   SELECT … FROM unbarcoded_current_prices ucp
--   JOIN stores s ON s.store_id = ucp.store_id
--   WHERE ucp.canonical_id = ANY($canonical_ids::int[])
--     AND ST_DWithin(s.location, $loc::geography, $radius_miles * 1609.344);
