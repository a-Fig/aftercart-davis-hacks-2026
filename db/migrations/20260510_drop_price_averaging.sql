-- Cut price averaging from the current_prices + unbarcoded_current_prices
-- matviews. Replaces the recency-weighted, confidence-weighted blend with a
-- DISTINCT ON pick of the latest observation per group.
--
-- Why: averaging WITHIN a (canonical_id, store_id) group is only meaningful
-- when every observation in the group is the same product over time. The
-- moment two distinct products map to one canonical (which is common when
-- canonicals drift toward category-level), the average becomes fiction
-- (e.g. averaging 5.3oz $0.99/oz Greek yogurt with 32oz $0.16/oz Greek
-- yogurt → meaningless ~$0.58/oz). For the hackathon demo we want the
-- headline number to be real, not an aggregation artefact.
--
-- New behavior: per (group key) take the most-recent-by-observed_at
-- observation's `price` / `price_per_unit`. observation_count is preserved
-- via a side-channel COUNT subquery so the UI's "Based on N observations"
-- trust signal stays accurate. freshness is computed from the latest
-- observed_at — same buckets as before (green <7d, yellow 7-30d, red >30d).
--
-- Column names unchanged (`weighted_price`, `weighted_price_per`,
-- `observation_count`, `most_recent_observation`, `freshness`) so no
-- consumer code (route.ts, semantic-compare.mjs, adapter.ts, inspector
-- queries) needs to change. The names are now slightly misleading
-- ("weighted_*" no longer involves a weighted blend) but renaming would
-- churn 13 files for no functional gain — better as a follow-up cleanup.
--
-- Reversible: DROP+CREATE rebuilds derived data from the intact `prices`
-- and `unbarcoded_observations` source tables. The 5y window is also gone
-- — there's no benefit to filtering out old observations when we always
-- pick the single latest one (and `freshness=red` already signals stale).

DROP MATERIALIZED VIEW IF EXISTS current_prices CASCADE;
DROP MATERIALIZED VIEW IF EXISTS unbarcoded_current_prices CASCADE;

-- ── Barcoded path ────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW current_prices AS
WITH counts AS (
    SELECT barcode, store_id, chain_id, pricing_tier, COUNT(*)::int AS n
    FROM prices
    GROUP BY barcode, store_id, chain_id, pricing_tier
),
latest AS (
    SELECT DISTINCT ON (barcode, store_id, chain_id, pricing_tier)
        barcode,
        store_id,
        chain_id,
        pricing_tier,
        price,
        price_per,
        observed_at
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
        WHEN l.observed_at > (NOW() - INTERVAL '7 days')::date   THEN 'green'
        WHEN l.observed_at > (NOW() - INTERVAL '30 days')::date  THEN 'yellow'
        ELSE 'red'
    END                             AS freshness
FROM latest l
JOIN counts c
    ON c.barcode = l.barcode
   AND c.store_id = l.store_id
   AND c.chain_id IS NOT DISTINCT FROM l.chain_id
   AND c.pricing_tier = l.pricing_tier;

CREATE UNIQUE INDEX current_prices_pk
    ON current_prices(barcode, store_id, pricing_tier);
CREATE INDEX current_prices_store_idx   ON current_prices(store_id);
CREATE INDEX current_prices_barcode_idx ON current_prices(barcode);

-- ── Unbarcoded path ──────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW unbarcoded_current_prices AS
WITH counts AS (
    SELECT canonical_id, store_id, chain_id, price_unit, pricing_tier, COUNT(*)::int AS n
    FROM unbarcoded_observations
    GROUP BY canonical_id, store_id, chain_id, price_unit, pricing_tier
),
latest AS (
    SELECT DISTINCT ON (canonical_id, store_id, chain_id, price_unit, pricing_tier)
        canonical_id,
        store_id,
        chain_id,
        price_unit,
        pricing_tier,
        price_per_unit,
        observed_at
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
        WHEN l.observed_at > (NOW() - INTERVAL '7 days')::date   THEN 'green'
        WHEN l.observed_at > (NOW() - INTERVAL '30 days')::date  THEN 'yellow'
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
