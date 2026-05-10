-- One-shot migration: widen the current_prices matview from 90 days → 5 years
-- (1825 days), and lengthen the recency half-life from 14 days → 365 days.
--
-- Why: OFF Prices contributors uploaded receipts spanning multiple years.
-- 16,579 of 18,649 (89%) of our priced observations are older than 90 days
-- and were silently dropped by the old matview's WHERE clause. The freshness
-- column ('green'/'yellow'/'red') already conveys age-based trust to users —
-- the hard cutoff is just throwing away usable comparison signal.
--
-- The longer half-life keeps the recency-weight math meaningful at 5-year
-- distance: 5y at 365d half-life ≈ 0.001 weight (small but non-zero), so
-- a 5-year-old price contributes minimally if any newer ones exist, and
-- becomes the published price when no newer ones do. With the old 14d
-- half-life, anything beyond ~6 months underflowed to zero.
--
-- Reversible: DROP+CREATE rebuilds derived data from the intact `prices`
-- and `unbarcoded_observations` source tables.

DROP MATERIALIZED VIEW IF EXISTS current_prices CASCADE;
DROP MATERIALIZED VIEW IF EXISTS unbarcoded_current_prices CASCADE;

CREATE MATERIALIZED VIEW current_prices AS
WITH recent AS (
    SELECT
        barcode,
        store_id,
        chain_id,
        price,
        price_per,
        pricing_tier,
        observed_at,
        confidence,
        EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - observed_at::timestamptz)) / (365 * 86400)) AS recency_weight
    FROM prices
    WHERE observed_at > (NOW() - INTERVAL '5 years')::date
)
SELECT
    barcode,
    store_id,
    chain_id,
    pricing_tier,
    SUM(price * recency_weight * confidence)
        / NULLIF(SUM(recency_weight * confidence), 0) AS weighted_price,
    SUM(price_per * recency_weight * confidence)
        / NULLIF(SUM(recency_weight * confidence) FILTER (WHERE price_per IS NOT NULL), 0) AS weighted_price_per,
    COUNT(*) AS observation_count,
    MAX(observed_at) AS most_recent_observation,
    CASE
        WHEN MAX(observed_at) > (NOW() - INTERVAL '7 days')::date   THEN 'green'
        WHEN MAX(observed_at) > (NOW() - INTERVAL '30 days')::date  THEN 'yellow'
        ELSE 'red'
    END AS freshness
FROM recent
GROUP BY barcode, store_id, chain_id, pricing_tier;

CREATE UNIQUE INDEX current_prices_pk ON current_prices(barcode, store_id, pricing_tier);
CREATE INDEX current_prices_store_idx ON current_prices(store_id);
CREATE INDEX current_prices_barcode_idx ON current_prices(barcode);

CREATE MATERIALIZED VIEW unbarcoded_current_prices AS
WITH recent AS (
    SELECT
        canonical_id,
        store_id,
        chain_id,
        price_per_unit,
        price_unit,
        pricing_tier,
        observed_at,
        confidence,
        EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - observed_at::timestamptz)) / (365 * 86400)) AS recency_weight
    FROM unbarcoded_observations
    WHERE observed_at > (NOW() - INTERVAL '5 years')::date
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
    CASE
        WHEN MAX(observed_at) > (NOW() - INTERVAL '7 days')::date   THEN 'green'
        WHEN MAX(observed_at) > (NOW() - INTERVAL '30 days')::date  THEN 'yellow'
        ELSE 'red'
    END AS freshness
FROM recent
GROUP BY canonical_id, store_id, chain_id, price_unit, pricing_tier;

CREATE UNIQUE INDEX unbarcoded_current_prices_pk
    ON unbarcoded_current_prices(canonical_id, store_id, price_unit, pricing_tier);
CREATE INDEX unbarcoded_current_prices_store_idx
    ON unbarcoded_current_prices(store_id);
