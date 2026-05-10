# AfterCart v1 (canonical-keyed) — historical

This directory contains the original AfterCart implementation: a hand-curated **canonical product catalog** with prices keyed on `(canonical_id, store_id)`. It is preserved here for reference only — the live demo runs the v2 (barcode-keyed) variant at the repo root.

For the full story of why there are two variants and what changed between them, see [`docs/DESIGN-EVOLUTION.md`](../../docs/DESIGN-EVOLUTION.md).

For the product spec and architecture, see:

- [`docs/PRODUCT.md`](../../docs/PRODUCT.md) — what the product does
- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — how it's built (covers both variants; v1 differences are called out)

## Quick orientation

| | v1 (this directory) | v2 (repo root) |
|---|---|---|
| Price storage axis | `(canonical_id, store_id)` | `(barcode, store_id)` |
| Catalog | 939 hand-curated canonicals | 14,053 OFF barcodes + 939 canonicals (produce) |
| Stores source | USDA SNAP retailer registry | Open Food Facts Locations |
| Equivalences | Hand-curated `equivalence_groups` | Derived nightly from OFF categories |
| Demo data state | LLM-generated synthetic prices | Real receipt-verified OFF Prices observations |

The receipt-side flow (parser, normalizer, matcher, review screen) is byte-identical between v1 and v2. Only the price-storage layer changed.

## Running v1 locally

The v1 codebase still works against its own database (`receiptcheck`, separate from v2's `receiptcheck_bc`). It is not deployed; the live Cloud Run service runs v2.

```bash
cd web
npm install
cp ../.env.example .env.local   # fill in PG*, GOOGLE_VISION_API_KEY, GOOGLE_CLOUD_PROJECT, etc.
npm run dev
```

Schema lives at [`db/schema.sql`](db/schema.sql). Apply with `node web/scripts/apply-schema.mjs`.
