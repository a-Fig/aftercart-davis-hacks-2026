# Design Evolution

## TL;DR

We built AfterCart twice. The first version (v1) shipped a working
end-to-end loop on top of a hand-curated catalog of 939 canonical products.
It worked. It also had a quiet flaw at the price-storage layer that meant
the only way to make the demo look good was to fabricate price observations.
The second version (v2) keeps every byte of the receipt-side code and rebuilds
the price layer around real Open Food Facts Prices data, keyed on barcode.
Both versions are in this repository — v2 at the root, v1 under
[`legacy/v1/`](../legacy/v1) — because the contrast is the most honest
description of what we learned.

The live demo at <https://aftercart-web-407493014719.us-west1.run.app/>
runs v2.

This document explains why the rebuild was the right call, what it costs,
and what we'd do next.

---

## What v1 is

v1 is a canonical-keyed comparison engine. The core idea: every grocery
product gets a row in `canonical_products` (`Honeycrisp Apple`,
`Boneless Skinless Chicken Thighs`, `Whole Milk, 1 gal`). The receipt
parser maps each line to one of those canonicals via a hybrid trigram +
embedding match. Prices are stored against `(canonical_id, store_id)` in
`price_observations`, with a separate `store_skus` table holding the
chain-specific display name and pack size that the comparison UI shows
on each row.

This is internally consistent and reads cleanly. From
[`legacy/v1/db/schema.sql`](../legacy/v1/db/schema.sql):

```sql
CREATE TABLE price_observations (
    observation_id    BIGSERIAL PRIMARY KEY,
    store_sku_id      INTEGER NOT NULL REFERENCES store_skus(store_sku_id),
    canonical_id      INTEGER REFERENCES canonical_products(canonical_id),
    store_id          INTEGER NOT NULL REFERENCES stores(store_id),
    chain_id          INTEGER NOT NULL REFERENCES chains(chain_id),
    price_total       NUMERIC(10,2) NOT NULL,
    price_per_unit    NUMERIC(10,4) NOT NULL,
    pricing_tier      TEXT NOT NULL DEFAULT 'shelf',
    -- ...
);
```

Final state: 939 canonical products, 3,960 price observations, 8 chains,
~489 stores, 1,200 store_skus with chain-specific pack sizes. The hero
card, per-item breakdown, item detail modal with pricing tiers,
per-unit pricing, and OFF enrichment all work end-to-end.

## The flaw

The mental model for v1 is: *match the receipt to a curated canonical,
then look up which stores carry that canonical, then show their prices.*

Two problems compound in that sentence.

**The user's specific identification gets thrown away on the way to the
price-storage layer.** When a Costco receipt says `KS EGG WHITES 64Z`, the
matcher resolves it to a canonical called something like "Egg Whites,
liquid carton." That canonical is the comparison key. Whatever Costco
SKU the user actually picked is reduced to a row in `store_skus` whose
only job is to look up a display name. The price comparison query has
no idea the user bought Kirkland specifically — it averages every
egg-whites observation that ever landed on that canonical, regardless
of brand or pack size, and presents the result as the answer.

**Building canonicals is a manual chokepoint that doesn't scale.** Every
new product class needs a row. Every receipt that doesn't match any
existing canonical either needs new curation work or gets dropped. A
939-row catalog is what one team can maintain in a hackathon; it is
nowhere near the long tail of what a single Whole Foods stocks, let
alone the full US market.

The two problems together meant the only realistic way to make the v1
demo look populated was to fabricate the price data. That's exactly what
we did:
[`web/scripts/generate-fake-prices.mjs`](../legacy/v1/web/scripts/generate-fake-prices.mjs)
calls Gemini to invent price observations across the canonical catalog.
Those rows are tagged `source = 'fake'` and there is a `purge-fake-data.mjs`
script whose existence is the whole story — you cannot demo this build
externally without running it first. 3,960 observations divided across
939 canonicals reads as four observations per product on the hero card.
None of them are real.

A demo built on synthetic data is not the product. It is a screenshot of
the product. And the moment you switch the demo to real receipts, the
canonical catalog isn't the right shape to absorb them.

## The v2 redesign

v2 starts from a different sentence: *match the receipt to a specific
OFF product (preferred) or curated canonical (produce only). Look up
prices for that exact identity. If none exist nearby, fall through to
equivalent barcodes derived from OFF categories. If still nothing, show
the cold-start state honestly.*

Three concrete shifts make that sentence work.

**Barcode is the price-storage axis for packaged goods.** The `prices`
table in [`db/schema.sql`](../db/schema.sql) keys on `(barcode, store_id)`,
not `(canonical_id, store_id)`. Open Food Facts Prices is a
crowd-contributed dataset of receipt-verified prices keyed exactly that
way; the schema mirrors what the data actually is. 18,649 observations
imported, all real, all linkable back to a contributor's proof photo.

```sql
CREATE TABLE prices (
    price_id              BIGSERIAL PRIMARY KEY,
    barcode               TEXT      NOT NULL,
    store_id              BIGINT    NOT NULL REFERENCES stores(store_id),
    chain_id              INTEGER   REFERENCES chains(chain_id),
    price                 NUMERIC(10,2) NOT NULL,
    price_per             NUMERIC(10,4),
    pricing_tier          TEXT      NOT NULL DEFAULT 'shelf',
    observed_at           DATE      NOT NULL,
    source                TEXT      NOT NULL,   -- 'off_prices' | 'receipt' | 'manual'
    proof_id              TEXT,                 -- OFF proof UUID
    proof_image_url       TEXT,                 -- direct link to receipt photo
    confidence            NUMERIC(3,2) NOT NULL,
    -- ...
);
```

**Canonical products survive only where barcodes don't exist.** Produce
sold by weight (Honeycrisp at Safeway), bulk bins, and Costco's internal
6-digit SKUs go through `unbarcoded_observations`, which is canonical-keyed.
Everything packaged routes around the canonical layer entirely. The
939 canonicals are still in the database — about 200 of them earn
their keep on the produce path; the rest stay around as a bridge so
matched-but-no-barcode items can still pull OFF enrichment for the
modal.

**The comparison query is tiered.** `nearbyPrices()` fans out three SQL
arms in priority order:

1. `barcode_exact` — same UPC the user picked, observed at a nearby store.
2. `equivalent` — different UPC, same OFF category and pack size within
   ±5%, observed at a nearby store.
3. `canonical_exact` — produce path, keyed on `canonical_id`.

When all three return empty, the row goes to "No Comparison Found" with
the matched-vs-unmatched count surfaced. Equivalent matches carry a
`match_type` tag so the UI can render the `~similar` chip and caption
the spec asks for.

**Stores come from OFF Locations, not USDA SNAP.** v1's stores table was
seeded from the USDA SNAP retailer registry — the universe of stores
that *could* have prices. v2's stores table is seeded from OFF Locations
— the universe of stores that *do* have prices in the dataset. SNAP
authorization survives as a flag (`stores.snap_authorized`) for the
primary user's filter, but it's no longer the row identity. The result
is 244 stores across 110 chains where the database actually has
something to say.

**Equivalence is derived, not curated.**
[`web/scripts/derive-equivalences.mjs`](../web/scripts/derive-equivalences.mjs)
runs nightly across OFF's `categories_tags` + `brands` + `product_quantity`
and emits 1,810 groups with 7,445 members. The hand-curated approach
in v1 was always going to be empty in production; this approach is
already populated.

## The architectural deltas

| Concern | v1 | v2 |
|---|---|---|
| Price storage axis | `(canonical_id, store_id)` | `(barcode, store_id)` for packaged; `(canonical_id, store_id)` for produce |
| Primary tables | `price_observations`, `store_skus` | `prices`, `unbarcoded_observations` (`store_skus` dropped) |
| Comparison query | One arm: canonical exact + canonical equivalence | Three tiers: `barcode_exact` → `equivalent` → `canonical_exact` |
| Stores source-of-truth | USDA SNAP retailer registry (489 rows) | OFF Locations (244 rows where prices exist); SNAP becomes a flag |
| Equivalence graph | Hand-curated (empty in production) | Derived nightly from OFF categories + brands + pack (1,810 groups) |
| Trust signal | Internal `confidence` numeric | OFF `proof_id` linking to a real receipt photo |
| Comparison universe | 939 canonicals | 14,053 barcodes, growing automatically with OFF |
| Demo data source | Synthetic prices (`source = 'fake'`) | Real receipts (`source = 'off_prices'`, conf 0.85) |

## What stayed unchanged

This is the surgical part of the rebuild, and it's the part we want to
emphasize. The receipt-side flow — every byte of it — is identical
between the two variants:

- [`web/lib/receipts/parse.mjs`](../web/lib/receipts/parse.mjs) — Vision
  OCR cleanup, column reconstruction, line classification.
- [`web/lib/receipts/normalize.mjs`](../web/lib/receipts/normalize.mjs) —
  abbreviation dictionary, brand-prefix stripping, pack-size extraction.
- [`web/lib/receipts/match.mjs`](../web/lib/receipts/match.mjs) —
  in-memory hybrid trigram + cosine + keyword + size-affinity matcher.
- [`web/components/aftercart-v3/V3ReviewE.tsx`](../web/components/aftercart-v3/V3ReviewE.tsx) —
  the Confidence Triage review screen.
- The four-screen flow (home → scan → review → results).
- The OFF Products SQLite (~896k US products) used for enrichment and
  free-text search on the review screen.

Only the price-storage layer and the comparison query changed. That's
the surgical piece — the redesign was a knife into one specific layer,
not a rewrite. The receipt pipeline shipped early in the hackathon and
was already good; throwing it out alongside the price layer would have
been a much worse trade.

## What it costs

OFF Prices is **sparse**. 18,649 observations across an 896k-product
catalog is a thin slice of the real grocery economy. We measured
this on the smoke-test set:

| Receipt | Items | Items with ≥1 nearby alt |
|---|---|---|
| IMG_1881 (Costco, mostly UPCs) | 15 | 3 (1 exact + 2 equivalent) |
| IMG_1882 (Smart & Final) | 3 | 0 |
| IMG_3380 (Safeway, 88 lines) | 88 | 5 (4 exact + 1 equivalent) |
| IMG_6875 (Safeway, 2 items) | 2 | 0 |

Realistic per-receipt coverage today is 3–10% of items returning a
nearby alternative. Below that threshold, the hero card has nothing to
say.

This is a *data* limitation, not an architectural one. Every new receipt
loaded — through the OFF Prices import, through manual fieldwork via
`load-collection-sheet.mjs`, through friend-receipt drives via
`import-receipts.mjs`, or through users contributing back to OFF Prices
itself — raises a barcode-keyed observation by exactly one. There is no
new canonical to curate, no new store_sku row to vouch for, no
human-in-the-loop step blocking the next data point.

v1 had the opposite problem: dense canonical coverage but the prices
were fabricated by an LLM. The two trade-offs aren't symmetric:

- **v1: dense, fake.** Looks great in screenshots.
- **v2: sparse, real.** Looks honest when sparse data is honestly the
  state of the world.

The product spec has a section called "Cold-Start Graceful State" that
describes exactly the situation v2 puts itself in — a region with
incomplete coverage where the headline must say so out loud rather than
fabricate a comparison. v1 cannot honor that principle without a
`purge-fake-data.mjs` step before every demo. v2 doesn't need it.

The honest version is harder to demo. It is also the version we'd
actually ship.

## Final state, side by side

|  | v1 | v2 |
|---|---|---|
| Price observations | 3,960 (synthetic) | **18,649 (real)** |
| Unique products priced | 939 canonicals | 14,053 barcodes + ~200 produce canonicals |
| Stores | 489 (USDA SNAP) | 244 (OFF Locations) |
| Chains | 8 | 110 |
| Equivalence groups | Schema only, empty | **1,810** (derived) |
| Equivalence members | 0 | **7,445** |
| `current_prices` rows | (matview over fake data) | 2,851 |
| Source field on price rows | `'fake'` (must purge before demo) | `'off_prices'`, conf 0.85 |
| Per-receipt coverage in smoke tests | 100% (because all data is invented) | 3–10% (real-world sparse) |

## What we'd do next

A few honest follow-ups, from highest leverage to lowest:

**Tighter equivalence quality.** The derived groups are loose. One
smoke-test surfaced "Italian bread" alongside "blueberry crumble" as
peers because both share an OFF category tag. The 3-rule algorithm in
`derive-equivalences.mjs` could add a basic-keyword filter (already
implicit in the matcher) and a stricter category depth before two items
are allowed into the same group. This is the single change that would
most improve the perceived quality of the comparison.

**OFF proof receipts on the modal.** The `prices` schema captures
`proof_id` and `proof_image_url` for every imported observation, but the
item detail modal still renders only the legacy "Based on N receipts"
text. A lazy-loaded thumbnail strip showing the real receipts that
contributed to a price point would turn the trust signal from a number
into evidence — exactly what the spec asks for, and the data is already
present.

**Contribute back to OFF Prices.** A receipt successfully matched and
confirmed by a user is, by construction, a high-quality OFF Prices
contribution. The plumbing for this is sketched in
`web/lib/off-prices/contribute.mjs` but defaults off pending a UX pass on
consent. Closing the loop here is what turns sparse coverage into a
flywheel: every user who gets a comparison contributes the data that
makes the next user's comparison better.

We don't need to over-promise here. The redesign is the thing we want
to be judged on; the follow-ups are what we'd build with another week.
