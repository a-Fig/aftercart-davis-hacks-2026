-- Field collection portal — staging tables for shelf-tag / wide-shelf photos
-- captured via the /field/* mobile-web flow. Pending observations are reviewed
-- one-by-one and promoted into `prices` (barcoded) or `unbarcoded_observations`
-- (canonical-keyed) on accept.
--
-- Reversible: DROP TABLE field_observations, field_uploads (in that order)
-- and ALTER TABLE stores DROP COLUMN is_field_starred. No data in the main
-- price tables is touched by this migration.

CREATE TABLE IF NOT EXISTS field_uploads (
    upload_id           BIGSERIAL PRIMARY KEY,
    store_id            BIGINT      NOT NULL REFERENCES stores(store_id),
    photo_url           TEXT        NOT NULL,                 -- gs:// uri
    photo_sha256        TEXT        NOT NULL,
    mode                TEXT        NOT NULL
                                    CHECK (mode IN ('shelf_tag','wide_shot')),
    contributor_handle  TEXT,                                  -- self-attribution; nullable
    raw_llm_response    JSONB,                                 -- full Gemini output, for audit/debug
    llm_model           TEXT        NOT NULL,                  -- e.g. 'gemini-2.5-flash'
    notes               TEXT,                                  -- user-entered freeform
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (photo_sha256, store_id)                            -- dedup re-uploads of the same photo at the same store
);
CREATE INDEX IF NOT EXISTS field_uploads_store_idx ON field_uploads(store_id);
CREATE INDEX IF NOT EXISTS field_uploads_uploaded_at_idx ON field_uploads(uploaded_at DESC);

CREATE TABLE IF NOT EXISTS field_observations (
    observation_id      BIGSERIAL PRIMARY KEY,
    upload_id           BIGINT      NOT NULL REFERENCES field_uploads(upload_id) ON DELETE CASCADE,
    store_id            BIGINT      NOT NULL REFERENCES stores(store_id),

    -- Editable extracted fields. Reviewer can fix any of these in /field/upload/[id].
    barcode             TEXT,                                  -- nullable: most shelf tags don't show UPC
    product_name_raw    TEXT,                                  -- what Gemini read off the tag
    brand               TEXT,                                  -- Gemini's brand guess; reviewer can edit
    canonical_id        INTEGER REFERENCES canonical_products(canonical_id),  -- resolved via match.mjs or manual pick
    price               NUMERIC(10,2),                         -- regular shelf price
    member_price        NUMERIC(10,2),                         -- loyalty / club price (nullable)
    pack_size           NUMERIC,
    pack_unit           TEXT,                                  -- 'oz' | 'lb' | 'fl_oz' | 'gal' | 'count' | 'each'
    pricing_tier        TEXT NOT NULL DEFAULT 'shelf'
                            CHECK (pricing_tier IN ('shelf','member','sale')),

    -- Unbarcoded path only (produce, deli) — populated when promoting to
    -- unbarcoded_observations. For barcoded items these stay NULL.
    quantity            NUMERIC,
    quantity_unit       TEXT,
    price_per_unit      NUMERIC(10,4),
    price_unit          TEXT,                                  -- 'per_lb' | 'per_oz' | 'per_each'

    -- LLM diagnostics, for audit + debugging extraction quality.
    llm_confidence      NUMERIC(3,2),
    llm_reasoning       TEXT,
    position_note       TEXT,                                  -- e.g. "top shelf, 3rd from left" (wide_shot only)

    -- Review state machine.
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','accepted','rejected')),
    rejected_reason     TEXT,
    promoted_price_id   BIGINT REFERENCES prices(price_id),
    promoted_obs_id     BIGINT REFERENCES unbarcoded_observations(obs_id),

    observed_at         DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ,
    reviewed_by         TEXT,

    -- An observation can be promoted to either `prices` OR
    -- `unbarcoded_observations`, but never both. Promotion is one-shot.
    CHECK ((promoted_price_id IS NULL) OR (promoted_obs_id IS NULL))
);
CREATE INDEX IF NOT EXISTS field_obs_status_idx  ON field_observations(status);
CREATE INDEX IF NOT EXISTS field_obs_store_idx   ON field_observations(store_id);
CREATE INDEX IF NOT EXISTS field_obs_upload_idx  ON field_observations(upload_id);
CREATE INDEX IF NOT EXISTS field_obs_pending_idx ON field_observations(status, created_at DESC)
    WHERE status = 'pending';

-- Stores a user has explicitly added to their "starred" shortcut list on the
-- field portal home. Doesn't affect any other queries — purely UI sugar.
ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS is_field_starred BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS stores_field_starred_idx
    ON stores(is_field_starred) WHERE is_field_starred;
