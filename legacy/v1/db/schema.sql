-- ============================================================================
-- AfterCart Database Schema
-- PostgreSQL 15+ with PostGIS and pgvector extensions
-- ============================================================================
-- Design principles:
--   1. Canonical products are the comparison unit, not store SKUs
--   2. Raw receipt text is preserved forever (never overwritten)
--   3. price_observations is append-only; current price is a materialized view
--   4. Equivalence is a weighted graph, not a hierarchy
--   5. Geographic queries via PostGIS; SKU normalization via pgvector
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- for fuzzy text matching on receipt strings

-- ----------------------------------------------------------------------------
-- LAYER 1: Reference data (slow-changing)
-- ----------------------------------------------------------------------------

CREATE TABLE chains (
    chain_id           SERIAL PRIMARY KEY,
    name               TEXT NOT NULL UNIQUE,        -- "Trader Joe's", "Safeway"
    parent_company     TEXT,                        -- "Albertsons" for Safeway
    snap_authorized    BOOLEAN NOT NULL DEFAULT TRUE,
    pricing_model      TEXT,                        -- 'chain_uniform' | 'regional' | 'per_store'
    notes              TEXT
);

CREATE TABLE stores (
    store_id           SERIAL PRIMARY KEY,
    chain_id           INTEGER NOT NULL REFERENCES chains(chain_id),
    external_id        TEXT,                        -- store number from chain (e.g., "Safeway #1234")
    address            TEXT NOT NULL,
    location           GEOGRAPHY(POINT, 4326) NOT NULL,
    snap_authorized    BOOLEAN NOT NULL DEFAULT TRUE,
    usda_retailer_id   TEXT,                        -- link to USDA SNAP retailer registry
    opened_at          DATE,
    closed_at          DATE,                        -- nullable; for closed locations
    UNIQUE (chain_id, external_id)
);
CREATE INDEX stores_location_gix ON stores USING GIST (location);
CREATE INDEX stores_chain_idx ON stores(chain_id);

CREATE TABLE product_categories (
    category_id              SERIAL PRIMARY KEY,
    name                     TEXT NOT NULL,
    parent_category_id       INTEGER REFERENCES product_categories(category_id),
    usda_fdc_id              INTEGER                 -- USDA FoodData Central ID
);

-- ----------------------------------------------------------------------------
-- LAYER 2: Canonical products (the comparison anchor)
-- ----------------------------------------------------------------------------
-- A canonical_product is what users actually compare across stores.
-- Not store-specific. UPC is nullable because produce/bulk/store-brand often
-- lack a usable universal identifier.

CREATE TABLE canonical_products (
    canonical_id            SERIAL PRIMARY KEY,
    name                    TEXT NOT NULL,           -- "Boneless skinless chicken thighs"
    brand                   TEXT,                    -- nullable for generic produce/bulk
    is_store_brand          BOOLEAN NOT NULL DEFAULT FALSE,
    store_brand_chain_id    INTEGER REFERENCES chains(chain_id),  -- "Kirkland" -> Costco
    package_size            NUMERIC,                 -- nullable for sold-by-weight items
    package_unit            TEXT,                    -- 'oz' | 'lb' | 'g' | 'ml' | 'count' | 'each'
    pricing_unit            TEXT NOT NULL,           -- 'per_lb' | 'per_oz' | 'per_each' | 'per_pack'
    upc                     TEXT,                    -- nullable; not all products have one
    category_id             INTEGER REFERENCES product_categories(category_id),
    description_embedding   VECTOR(384),             -- for semantic SKU matching
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (upc) -- when present, UPC is unique
);
CREATE INDEX canonical_products_category_idx ON canonical_products(category_id);
CREATE INDEX canonical_products_embedding_idx ON canonical_products
    USING hnsw (description_embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- LAYER 3: Store SKUs (the adapter layer)
-- ----------------------------------------------------------------------------
-- This is where the messy receipt text lives. A store_sku is the chain's
-- (or store's) representation of a canonical product. canonical_id is nullable
-- while normalization is pending.

CREATE TABLE store_skus (
    store_sku_id            SERIAL PRIMARY KEY,
    chain_id                INTEGER NOT NULL REFERENCES chains(chain_id),
    store_id                INTEGER REFERENCES stores(store_id),  -- nullable; some SKUs are chain-wide
    canonical_id            INTEGER REFERENCES canonical_products(canonical_id),
    receipt_text_canonical  TEXT NOT NULL,           -- "BFLS CKNG THGH" — the cleaned receipt token
    display_name            TEXT,                    -- "Boneless Chicken Thighs" — human-readable
    upc                     TEXT,                    -- store-specific UPC if known
    pack_size               NUMERIC,                 -- chain-specific product size (e.g. 3.5 for 3.5oz bar)
    pack_unit               TEXT,                    -- 'oz', 'lb', 'fl_oz', 'gal', 'count', 'each'
    receipt_text_embedding  VECTOR(384),             -- for fuzzy matching new receipt strings
    status                  TEXT NOT NULL DEFAULT 'pending',
                            -- 'verified' | 'pending' | 'ambiguous' | 'rejected'
    confidence              NUMERIC(3,2),            -- 0.00 - 1.00 in normalization
    first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at             TIMESTAMPTZ,
    verified_by             TEXT,                    -- 'auto' | 'manual' | user_id
    UNIQUE (chain_id, receipt_text_canonical)
);
CREATE INDEX store_skus_chain_idx ON store_skus(chain_id);
CREATE INDEX store_skus_canonical_idx ON store_skus(canonical_id);
CREATE INDEX store_skus_status_idx ON store_skus(status) WHERE status = 'pending';
CREATE INDEX store_skus_text_trgm_idx ON store_skus USING GIN (receipt_text_canonical gin_trgm_ops);
CREATE INDEX store_skus_embedding_idx ON store_skus
    USING hnsw (receipt_text_embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- LAYER 3.5: Canonical → Open Food Facts barcodes (enrichment link)
-- ----------------------------------------------------------------------------
-- Joins our 939 curated canonicals to OFF UPCs so the API can attach OFF
-- enrichment (image, ingredients, allergens, Nutri-Score, NOVA, nutriments)
-- to comparison responses. Many-to-many — a single canonical can map to
-- several OFF entries (different brand variants, regional packs).

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
-- LAYER 4: Equivalence groups (substitution)
-- ----------------------------------------------------------------------------
-- For comparisons that aren't 1:1. TJ's organic peanut butter vs Whole Foods
-- 365 organic peanut butter. Weighted edges, not hierarchical.

CREATE TABLE equivalence_groups (
    group_id        SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,                   -- "16oz organic creamy peanut butter"
    description     TEXT
);

CREATE TABLE equivalence_group_members (
    group_id              INTEGER NOT NULL REFERENCES equivalence_groups(group_id),
    canonical_id          INTEGER NOT NULL REFERENCES canonical_products(canonical_id),
    equivalence_strength  NUMERIC(3,2) NOT NULL,     -- 1.00 = identical, 0.70 = reasonable substitute
    PRIMARY KEY (group_id, canonical_id),
    CHECK (equivalence_strength > 0 AND equivalence_strength <= 1.0)
);
CREATE INDEX equivalence_group_members_canonical_idx
    ON equivalence_group_members(canonical_id);

-- ----------------------------------------------------------------------------
-- LAYER 5: Receipt domain (raw data, preserved forever)
-- ----------------------------------------------------------------------------

CREATE TABLE receipts (
    receipt_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID,                       -- nullable for fully anonymous uploads
    store_id              INTEGER REFERENCES stores(store_id),
    inferred_chain_id     INTEGER REFERENCES chains(chain_id),  -- when store match is uncertain
    receipt_dated_at      TIMESTAMPTZ,                -- date printed on the receipt
    uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    image_hash            TEXT,                       -- for deduplication; image not stored
    ocr_engine            TEXT,                       -- 'google_vision' | 'tesseract'
    ocr_confidence_avg    NUMERIC(3,2),
    receipt_total         NUMERIC(10,2),              -- the printed total, for validation
    line_count            INTEGER,
    processing_status     TEXT NOT NULL DEFAULT 'pending'
                          -- 'pending' | 'processed' | 'partial' | 'failed'
);
CREATE INDEX receipts_user_idx ON receipts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX receipts_store_idx ON receipts(store_id);
CREATE INDEX receipts_uploaded_idx ON receipts(uploaded_at DESC);

CREATE TABLE receipt_line_items (
    line_item_id          BIGSERIAL PRIMARY KEY,
    receipt_id            UUID NOT NULL REFERENCES receipts(receipt_id) ON DELETE CASCADE,
    line_number           INTEGER NOT NULL,
    raw_text              TEXT NOT NULL,              -- "SAFWY BFLS CKNG THGH 2.13LB $7.39"
    parsed_quantity       NUMERIC,
    parsed_unit           TEXT,
    parsed_price_total    NUMERIC(10,2),
    matched_store_sku_id  INTEGER REFERENCES store_skus(store_sku_id),
    match_confidence      NUMERIC(3,2),
    needs_review          BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (receipt_id, line_number)
);
CREATE INDEX receipt_line_items_review_idx
    ON receipt_line_items(needs_review) WHERE needs_review = TRUE;
CREATE INDEX receipt_line_items_store_sku_idx ON receipt_line_items(matched_store_sku_id);

-- ----------------------------------------------------------------------------
-- LAYER 6: Price observations (the time series, append-only)
-- ----------------------------------------------------------------------------
-- This is the heart of the comparison engine. Never updated, never deleted.
-- Aggregations to "current price" happen in materialized views.

CREATE TABLE price_observations (
    observation_id        BIGSERIAL PRIMARY KEY,
    store_sku_id          INTEGER NOT NULL REFERENCES store_skus(store_sku_id),
    canonical_id          INTEGER REFERENCES canonical_products(canonical_id),
                          -- denormalized for query speed; nullable until SKU is matched
    store_id              INTEGER NOT NULL REFERENCES stores(store_id),
    chain_id              INTEGER NOT NULL REFERENCES chains(chain_id),
                          -- denormalized for chain-level analysis without joins
    price_total           NUMERIC(10,2) NOT NULL,
    quantity              NUMERIC NOT NULL,
    quantity_unit         TEXT,                       -- as observed
    price_per_unit        NUMERIC(10,4) NOT NULL,
    price_unit            TEXT NOT NULL,              -- normalized: 'per_lb' | 'per_oz' | 'per_each'
    observed_at           TIMESTAMPTZ NOT NULL,       -- when the price was paid (receipt date)
    ingested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source                TEXT NOT NULL,              -- 'receipt' | 'manual' | 'usda_seed' | 'scrape'
    pricing_tier          TEXT NOT NULL DEFAULT 'shelf'
                          CHECK (pricing_tier IN ('shelf', 'member', 'sale')),
    source_receipt_id     UUID REFERENCES receipts(receipt_id),
    confidence            NUMERIC(3,2) NOT NULL
);
CREATE INDEX price_obs_canonical_store_time_idx
    ON price_observations(canonical_id, store_id, observed_at DESC);
CREATE INDEX price_obs_chain_time_idx
    ON price_observations(chain_id, observed_at DESC);
CREATE INDEX price_obs_store_sku_time_idx
    ON price_observations(store_sku_id, observed_at DESC);

-- Optional: convert to TimescaleDB hypertable when scale demands
-- SELECT create_hypertable('price_observations', 'observed_at');

-- ----------------------------------------------------------------------------
-- DERIVED: Current price materialized view
-- ----------------------------------------------------------------------------
-- This is what comparison queries hit. Refresh on a schedule (every 5-15 min).
-- Weighted current price = recent observations, decayed by age, confidence-weighted.

CREATE MATERIALIZED VIEW current_prices AS
WITH recent_observations AS (
    SELECT
        canonical_id,
        store_id,
        chain_id,
        price_per_unit,
        price_unit,
        pricing_tier,
        observed_at,
        confidence,
        -- Exponential decay: weight halves every 14 days
        EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - observed_at)) / (14 * 86400)) AS recency_weight
    FROM price_observations
    WHERE
        canonical_id IS NOT NULL
        AND observed_at > NOW() - INTERVAL '90 days'
)
SELECT
    canonical_id,
    store_id,
    chain_id,
    price_unit,
    pricing_tier,
    SUM(price_per_unit * recency_weight * confidence)
        / NULLIF(SUM(recency_weight * confidence), 0) AS weighted_price,
    COUNT(*) AS observation_count,
    MAX(observed_at) AS most_recent_observation,
    -- Freshness color per spec: green <7d, yellow 7-30d, red >30d
    CASE
        WHEN MAX(observed_at) > NOW() - INTERVAL '7 days' THEN 'green'
        WHEN MAX(observed_at) > NOW() - INTERVAL '30 days' THEN 'yellow'
        ELSE 'red'
    END AS freshness
FROM recent_observations
GROUP BY canonical_id, store_id, chain_id, price_unit, pricing_tier;

CREATE UNIQUE INDEX current_prices_pk
    ON current_prices(canonical_id, store_id, price_unit, pricing_tier);
CREATE INDEX current_prices_store_idx ON current_prices(store_id);

-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices;

-- ----------------------------------------------------------------------------
-- USER DOMAIN (separate from price data — never joined in API responses)
-- ----------------------------------------------------------------------------

CREATE TABLE users (
    user_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    home_location         GEOGRAPHY(POINT, 4326),    -- nullable; user-provided
    radius_miles          INTEGER NOT NULL DEFAULT 5
);

-- Basket history per spec: stored separately, deletable, never joined to
-- the public price_observations queries.
CREATE TABLE user_baskets (
    basket_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    receipt_id            UUID NOT NULL REFERENCES receipts(receipt_id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_alerts (
    alert_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    canonical_id          INTEGER NOT NULL REFERENCES canonical_products(canonical_id),
    threshold_price       NUMERIC(10,4) NOT NULL,
    threshold_unit        TEXT NOT NULL,
    radius_miles          INTEGER NOT NULL DEFAULT 5,
    active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- KEY QUERY PATTERNS
-- ============================================================================

-- 1. Comparison query: given a basket from store X, what would it cost at
--    every store within radius?
--
-- SELECT
--     s.store_id,
--     s.chain_id,
--     SUM(cp.weighted_price * basket_item.quantity) AS estimated_basket_cost
-- FROM unnest($1::int[], $2::numeric[]) AS basket_item(canonical_id, quantity)
-- JOIN current_prices cp USING (canonical_id)
-- JOIN stores s ON s.store_id = cp.store_id
-- WHERE ST_DWithin(s.location, $3::geography, $4 * 1609.34)  -- $4 = miles
-- GROUP BY s.store_id, s.chain_id
-- ORDER BY estimated_basket_cost ASC;

-- 2. Receipt ingestion: match a raw line item to a store SKU
--
-- WITH candidates AS (
--     SELECT store_sku_id, canonical_id,
--            similarity(receipt_text_canonical, $1) AS text_sim,
--            1 - (receipt_text_embedding <=> $2::vector) AS semantic_sim
--     FROM store_skus
--     WHERE chain_id = $3
--     ORDER BY receipt_text_embedding <=> $2::vector
--     LIMIT 20
-- )
-- SELECT * FROM candidates
-- WHERE text_sim > 0.4 OR semantic_sim > 0.75
-- ORDER BY (text_sim * 0.4 + semantic_sim * 0.6) DESC
-- LIMIT 1;
