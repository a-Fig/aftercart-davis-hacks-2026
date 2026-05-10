# AfterCart Architecture

This is the developer-perspective walk through the system: how it's built, the data model, the receipt pipeline, and the technical decisions worth calling out. The user-facing description lives in [PRODUCT.md](PRODUCT.md). The story of why v1 was rebuilt as v2 lives in [DESIGN-EVOLUTION.md](DESIGN-EVOLUTION.md).

The architecture below describes **v2** (the current root). Where v1 differs structurally, there's a "v1 differs by..." callout.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind, Turbopack |
| Database | Cloud SQL for PostgreSQL 16 + PostGIS + `vector` (pgvector) + `pg_trgm` |
| Hosting | Cloud Run, 4 GiB, `min-instances=1` |
| OCR | Google Cloud Vision API |
| LLM | Vertex AI Gemini 2.5 Flash (Application Default Credentials, no API key) |
| Embeddings | `@xenova/transformers` (384-dim sentence embeddings) |
| Enrichment | Open Food Facts US subset (~896k products) in a local SQLite |
| Secrets | Secret Manager in production, `web/.env.local` for local dev |
| Auth | None on the public app. Internal `/inspect/*` routes are password-gated |

There is no ORM. The schema at `db/schema.sql` is hand-written and treated as the source of truth.

---

## Repo map

```
aftercart/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          (this file)
│   ├── PRODUCT.md
│   └── DESIGN-EVOLUTION.md
├── db/
│   ├── schema.sql               hand-written, source of truth
│   ├── migrations/              one-shot SQL migrations
│   └── seed/                    chains, stores, categories, canonical scaffolding
├── web/
│   ├── app/                     Next.js app router (api routes + UI pages)
│   ├── components/              UI shells (v1, v3, v3m) + shared review screen
│   ├── lib/
│   │   ├── receipts/            parse.mjs, normalize.mjs, match.mjs, compare.mjs
│   │   ├── off/                 Open Food Facts SQLite helpers
│   │   ├── api/                 typed client + adapter
│   │   └── field/               field-collection portal helpers
│   ├── scripts/                 CLI entrypoints (seeding, OCR, OFF build, deploy)
│   └── Dockerfile               Cloud Run container
├── experiments/                 receipt-pipeline test harness + 3-pipeline viewer
├── receipts/inbox/              19-receipt regression set
└── legacy/v1/                   original canonical-keyed variant
```

---

## The receipt pipeline

The flow runs across **two API stages joined by a user-review step**. Splitting it lets the user vouch for the headline savings number on the results screen — they've already approved the matches that produced it.

```
┌─────────────────┐
│ receipt photo   │
└────────┬────────┘
         │
         ▼
   POST /api/match
         │
         ├─ Vision OCR (DOCUMENT_TEXT_DETECTION)
         ├─ parseReceipt()       parse.mjs       heuristic line extraction
         ├─ normalizeDescription normalize.mjs   abbrev expansion, brand strip
         ├─ matchItems()         match.mjs       in-memory hybrid scorer
         ├─ OFF FTS auto-suggest                 chain house-brand prefix
         └─ getEnrichmentBatch()                 candidate images + scores
         │
         ▼
   ┌──────────────────────┐
   │ Review screen        │   user picks correct match per item,
   │ (V3ReviewE.tsx)      │   edits qty/unit/pack-size, runs free-text
   │                      │   OFF search if candidates miss
   └─────────┬────────────┘
             │
             ▼
       POST /api/compare
             │
             ├─ applyOverrides()  user edits merged into parsed items
             ├─ canonical_barcodes lookup (when OFF pick has a known link)
             ├─ matchOne() substitute search (OFF picks with no link)
             ├─ nearbyPrices()    3-tier UNION: barcode_exact → equivalent → canonical
             └─ getEnrichmentBatch() OFF data for confirmed picks
             │
             ▼
       comparison response
       (hero card + per-item alts + per-store totals)
```

### Stage 1 — `POST /api/match`

Body `{ image, location?, radius_miles? }`. Returns the parsed receipt plus per-item top-K candidates (in-house canonicals + OFF entries). **No prices.** The client renders this in the review screen.

### Stage 2 — `POST /api/compare`

Body `{ parsed, corrections, location?, radius_miles? }`. Takes the verbatim parsed receipt echoed back from `/api/match` plus an array of user picks, looks up nearby prices against those picks, and attaches OFF enrichment.

### Stage 3 — `POST /api/off-search`

Body `{ query, limit? }`. Wraps `searchOff(db, query, limit)` for the review screen's free-text fallback (~5–20 ms typical latency).

### The three modules under `web/lib/receipts/`

- **[parse.mjs](web/lib/receipts/parse.mjs)** — heuristic receipt parser. Vision joins blocks with newlines, destroying the printed columns; this module reconstructs logical rows by absorbing bare-price/bare-numeric continuation lines, with a header guard so `Price` / `You Pay` lines aren't paired into. Handles the discount-attribution logic (single-column receipts vs two-column "Price | You Pay" layouts), spurious-line filtering (tax computation, masked card numbers, Costco column markers), and store-brand detection from receipt-text prefixes (KS, TJ, 365, O Organics, First Street).
- **[normalize.mjs](web/lib/receipts/normalize.mjs)** — receipt-text expander with a ~120-entry abbreviation dictionary (`BFLS CKNG THGH` → `boneless chicken thigh`), brand-prefix stripping, pack-size markers via `SIZE_RE` (returns `{value, unit}` for `1GAL`, `12CT`, `48Z`), and an organic flag.
- **[match.mjs](web/lib/receipts/match.mjs)** — in-memory hybrid matcher. Catalog of ~939 canonicals × 384-dim embeddings (~1.5 MB) is loaded once on first call and kept in process memory; per-item DB queries are gone. The score blends:
  - **trigram similarity** (max over `{normalized, raw}` description forms)
  - **cosine similarity** against the canonical's stored embedding
  - **lemma-aware keyword bonus** for shared product nouns (`blueberry` ↔ `blueberries`)
  - **smaller modifier bonus** (organic, frozen, whole, greek)
  - **length tiebreaker** so a longer, more-specific canonical name beats a generic one when scores are close
  - **pack-size affinity** — same dimension within ≤1.3× → +0.10, ≤2× → +0.05, ≤5× → 0, beyond → −0.20
  - threshold: blended ≥ 0.35 AND (cosine ≥ 0.30 OR trigram ≥ 0.4)

Items below threshold are surfaced in the *No Comparison Found* group rather than masquerading as low-confidence matches.

The matcher is deliberately conservative — a wrong match is worse than no match. Per the product spec, surfacing "we couldn't match this" beats showing the user a misleading comparison.

### Chain house-brand prefix in OFF FTS

When a receipt is from a chain with a known house brand, `match-llm.mjs` runs an extra brand-prefixed FTS5 query alongside the LLM's queries:

| Chain | House brand |
|---|---|
| Costco | Kirkland |
| Walmart | Great Value |
| Trader Joe's | Trader Joe's |
| Target | Good & Gather |
| Whole Foods | 365 |
| Safeway | Lucerne |

A Costco "ORG WHL MILK" line surfaces "Kirkland Signature Organic Whole Milk" as a candidate even when the LLM didn't think to add the brand. Cost: one extra ~5–20 ms local SQLite query per item, no extra LLM calls.

### Substitute search for OFF picks

When a user picks an OFF entry that has no link in `canonical_barcodes`, the route runs `matchOne()` against the OFF product name (threshold ≥ 0.5) **only to find a comparable canonical for price lookup** — never to relabel the user's pick. Substitute-derived alternatives carry `match_type: 'equivalent'` so the `~similar` chip surfaces. The `canonical_barcodes` table is never auto-poisoned by this lookup; links are built deliberately by `enrich-canonicals-from-off.mjs --apply`.

---

## Data model

### v2 (root) — barcode-first

Real Open Food Facts Prices data flows directly into a `prices` table keyed on `(barcode, store_id)`. Receipt uploads with a barcoded user-pick also write to `prices`. Produce and no-UPC items go to `unbarcoded_observations` keyed on `(canonical_id, store_id)`.

| Table | Purpose |
|---|---|
| `chains` | parent_company, OSM brand mapping, pricing model |
| `stores` | OFF Locations are authoritative; USDA SNAP authorization survives as a `snap_authorized` flag, not row identity |
| `canonical_products` | demoted to ~939 rows for **produce + no-UPC items only**; carries 384-dim `description_embedding` for the matcher |
| `canonical_barcodes` | bridge from canonicals to OFF UPCs, for enrichment fallback |
| `equivalence_groups` + `equivalence_group_members` | derived nightly from OFF `categories_tags` + `brands` + `product_quantity`. Members can be either barcodes or canonical_ids (heterogeneous). 1,810 groups today. |
| `prices` | barcode-keyed price observations, append-only. UNIQUE `(source, source_external_id)` prevents double-imports. Includes `proof_id` + `proof_image_url` linking to the OFF receipt photo. |
| `unbarcoded_observations` | canonical-keyed produce/no-UPC observations |
| `receipts` + `receipt_line_items` | raw upload audit trail |
| `field_uploads` + `field_observations` | shelf-tag photo capture portal staging |

The two materialized views compute "current price" without averaging. `current_prices` (the barcode matview) does a `DISTINCT ON (barcode, store_id, chain_id, pricing_tier)` ordered by `observed_at DESC, ingested_at DESC` — the most-recent observation wins. `observation_count` is preserved as a UI trust signal. A 14-day exponential decay over a 90-day window controls freshness via the `freshness` column (`green`/`yellow`/`red` based on observation age).

The comparison query in `nearbyPrices()` runs as a 3-tier UNION:

1. **barcode_exact** — direct `current_prices` lookup on the user's confirmed barcode
2. **equivalent** — same OFF category + pack size ±5%, joined through `equivalence_group_members`
3. **canonical_exact** — produce path, hits `unbarcoded_current_prices` keyed by `canonical_id`

Per-store totals are computed against **only the items each store actually has prices for**, never the full basket — prevents "store covers 4 of 19 items" from looking artificially cheap.

### v1 differs by:

- Prices are stored on `price_observations` keyed on `(canonical_id, store_id)`.
- A `store_skus` table carries chain-specific display names + pack sizes per `(chain_id, canonical_id)`.
- The `current_prices` matview groups by `(canonical_id, store_id, price_unit, pricing_tier)` and uses the same DISTINCT ON shape.
- Stores come from the USDA SNAP retailer registry (489 rows).
- Equivalence is hand-curated (table empty in production).

**Why we changed it:** in v1, the user's specific identification (the actual barcode they bought) was lost on the way to the price store. A user picking "Kirkland Egg Whites" saw prices averaged across every egg-white observation in the catalog. v2 keeps the user's pick all the way through to the comparison query. Full story in [DESIGN-EVOLUTION.md](DESIGN-EVOLUTION.md).

---

## Open Food Facts integration

Local SQLite mirror of OFF's US-product subset, used for **enrichment** (image, Nutri-Score, NOVA, ingredients, allergens, per-100g nutriments), **free-text product search** in the review screen, and the **chain house-brand FTS prefix pass**. Sits alongside the canonical catalog — never replaces it.

- `data/open-food-facts/us-products.sqlite` (~2.1 GB, ~896k products, gitignored)
- Built nightly from OFF's public dump by `web/scripts/build-off-sqlite.mjs` (input is a JSONL produced by `web/scripts/download-off.mjs`)
- FTS5 index on `product_name + brands + generic_name`; child tables for categories, stores, labels, allergens, traces, additives
- `web/lib/off/query.mjs` exposes `getEnrichment(barcode)`, `getEnrichmentBatch(barcodes[])`, `searchOff(query, limit)`, and a singleton `getSharedOff()` handle for API routes
- The standard 8 nutriments (energy_kcal, fat, sat_fat, sugars, fiber, protein, sodium, salt) are extracted as top-level columns; the full nutriments object is preserved as `nutriments_json` for vitamins/minerals
- Image URLs are **not** in the OFF JSONL bulk export — surfaces as a placeholder unless backfilled from the live API

The `canonical_barcodes` table joins our 939 curated canonicals to OFF UPCs (many-to-many). Population: `enrich-canonicals-from-off.mjs --apply` cross-references each canonical against OFF FTS, scoring on (trigram + brand match + size match) with weights 0.40 / 0.25 / 0.35, threshold ≥ 0.65, max 3 links per canonical.

---

## Production deploy

**Cloud Run** at [aftercart-web-407493014719.us-west1.run.app](https://aftercart-web-407493014719.us-west1.run.app/), 4 GiB memory, `min-instances=1`. The single warm instance keeps three things alive across requests: the in-memory matcher catalog (~1.5 MB), the `@xenova/transformers` model (~25 MB and ~600 ms first-hit cost), and the `better-sqlite3` handle on the OFF database.

The Dockerfile at `web/Dockerfile` builds from the repo root. The OFF SQLite isn't baked into the image — it's downloaded from GCS (`gs://aftercart-off-data/us-products.sqlite`) to `/tmp` at container startup by `web/scripts/download-off-startup.mjs`, ~30s on Cloud Run's internal network. To update OFF data: rebuild the SQLite locally, upload to GCS, restart the service. No rebuild/redeploy needed.

Cloud Run reaches Cloud SQL via Unix socket when `--add-cloudsql-instances=<conn>` is set on deploy. The socket lives at `/cloudsql/<conn>` and the env is `PGHOST=/cloudsql/<conn>`; `db.mjs` auto-detects the socket case (`host.startsWith('/')`) and skips both port and SSL.

**Cloud Scheduler** hits `POST /api/admin/refresh` (bearer-token gated by `REFRESH_TOKEN`) to refresh `current_prices`. **Secret Manager** injects production secrets via `gcloud run deploy --set-secrets`. **Vertex AI auth** is handled by the Cloud Run service account's `roles/aiplatform.user` IAM binding — no API key in env.

---

## Local setup

The short version, for getting the dev server running:

```bash
git clone <repo>
cd aftercart/web
cp ../.env.example ./.env.local       # fill in GCP creds + Cloud SQL connection
npm install
npm run dev                            # Next.js dev server on :3000
```

For the OFF enrichment + free-text search to work locally, the SQLite must be downloaded separately (see `web/scripts/download-off.mjs` and `web/scripts/build-off-sqlite.mjs`). API routes degrade gracefully on a fresh checkout that hasn't built the DB yet — `getSharedOff()` returns `null` rather than throwing.

---

## Receipt parsing accuracy

On the 8-receipt regression test set (Safeway, Trader Joe's ×3, Foothill Produce, Felipes, Costco, Smart & Final):

| Metric | Heuristic (`parse.mjs`) | LLM vision fallback (`--gpt`) |
|---|---|---|
| Item recall | 100% | 80.5% |
| Price accuracy | 100% | 78.0% |
| Code accuracy | 100% | 73.2% |
| Quantity accuracy | 100% | 56.1% |
| Spurious items | 0 | varies |

The Vision OCR + heuristic-parse path is faster, free, and more accurate than the LLM-vision pipeline on every receipt in the set. The `--gpt` mode (Vertex AI `gemini-2.5-flash`) is kept as a fallback for receipts the heuristic can't handle, but is not the default. The CLI flag stayed `--gpt` for muscle memory; the underlying API is Gemini.

Canonical match rate on the same set: ~88–90% (29/33 items). The conservative threshold means the missing 10–12% are surfaced honestly in the *No Comparison Found* group rather than misclassified.

The full three-pipeline side-by-side (heuristic vs LLM vs frozen v1 archive) lives in `experiments/viewer/index.html`, built by `experiments/scripts/build-viewer.mjs`.

---

## Key technical decisions

- **Hand-written schema, no ORM.** `db/schema.sql` is the source of truth. Migrations are explicit one-shot SQL files in `db/migrations/`. An ORM would add a layer of indirection between the schema we want and the queries we run, with no upside for a schema that fits in one file.

- **PostGIS for region-general geography.** Nothing in the code is hardcoded to Bay Area or Davis. All location queries flow through `stores.location` (`GEOGRAPHY(POINT, 4326)`) and a user-supplied radius. Deploying to a new region requires no code changes — only USDA SNAP / OFF Locations data for that region.

- **In-memory matcher, not a vector DB.** The full ~939-canonical catalog × 384-dim embeddings is ~1.5 MB. Loading it once on first call and keeping it in process memory removes per-item DB queries entirely. If the catalog grows past ~10k entries, this falls back to HNSW (the schema already has the index).

- **Conservative match threshold.** Blended ≥ 0.35 AND (cosine ≥ 0.30 OR trigram ≥ 0.4). A wrong match misleads the user about a real-world price; "no match found" is honest. Items below threshold are surfaced as *No Comparison Found* rather than shown with low confidence.

- **Per-unit price as the primary metric, not metadata.** A 3.5 oz chocolate bar at $4.99 and a 1 lb bar at $9.99 are different products by pack size. Total-price comparison conflates pack with cost. Every weight/volume row in the comparison UI shows per-unit price; per-row deltas switch to per-unit (`↓ $0.81/OZ CHEAPER`) when packs differ; the hero card volume-normalizes totals; rows whose units genuinely can't be determined are excluded from the chain total rather than faked with a multiply-by-quantity fallback.

- **Open Food Facts queried from a local SQLite, not the live API.** ~896k products, ~2.1 GB on disk, sub-millisecond barcode lookups, FTS5 search in 5–20 ms. The live OFF API would add network latency and a hard rate-limit dependency to every request that needed enrichment. Updating data is a single `gcloud storage cp` to the GCS bucket — no redeploy.

- **Two API stages joined by user review.** Splitting `/api/match` (OCR + match-with-candidates) from `/api/compare` (price lookup against user-confirmed picks) means the headline savings number is something the user has personally vouched for. The review step also pre-empts the silent-failure case where a wrong match produced a wrong comparison — a wrong match the user could have caught is worse than one explicitly flagged in the *No Comparison Found* group.
