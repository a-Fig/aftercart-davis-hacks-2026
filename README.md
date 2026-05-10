# AfterCart

> A receipt based grocery price comparison tool that tells you exactly what you could've paid for your groceries had you gone elsewhere.

**[Try the live demo](https://aftercart-web-407493014719.us-west1.run.app/)** · Built for [Davis Hacks 2026](https://devpost.com/software/aftercart)

---

## What it is

Photograph a grocery receipt. AfterCart runs OCR over it, matches every line item to a real product, and tells you what the same basket would have cost at nearby stores. Every receipt uploaded silently contributes a timestamped price observation to a community price-transparency database — so the next person to scan their receipt sees better data than you did.

The primary user is a SNAP recipient on a prepaid plan and an older Android phone. Region-general (no hardcoded geography), no ads, no sponsored results, no retailer relationships. The comparison must be honest, or it isn't worth shipping.

## We built it twice

The repo at the top level is **v2**, a barcode-keyed rebuild. The original canonical-keyed v1 lives under [`legacy/v1/`](legacy/v1/).

Why two? v1 stored prices against ~939 hand-curated canonical products and looked great in screenshots, but the user's actual identification (the specific barcode they bought) was lost on the way into the price store. A user picking *Kirkland Egg Whites* saw prices averaged across every egg-white observation. We rebuilt the price-storage axis around barcodes from real Open Food Facts Prices data, kept the curated canonicals as a fallback for produce and no-UPC items, and turned the comparison into a three-tier query: barcode-exact, then equivalence-derived, then canonical.

The receipt-side flow (parser, matcher, review screen) is byte-identical between the two. The differences are entirely on the price side.

Full story: **[docs/DESIGN-EVOLUTION.md](docs/DESIGN-EVOLUTION.md)**

## By the numbers (v2)

| | |
|---|---|
| Real receipt-verified price observations | 18,649 |
| Unique barcodes priced | 14,053 |
| Stores | 244 |
| Chains | 110 |
| Equivalence groups (OFF-derived) | 1,810 |
| Canonical products (preserved for produce) | 939 |
| Open Food Facts catalog | ~896k US products |

## Repo layout

```
.
├── README.md                  ← you are here
├── LICENSE                    MIT
├── docs/
│   ├── PRODUCT.md             What it does, from the user's perspective
│   ├── ARCHITECTURE.md        How it's built, from the developer's perspective
│   └── DESIGN-EVOLUTION.md    Why there's a v1 and a v2
└── legacy/
    └── v1/                    Original canonical-keyed variant
```

The v2 source lives at the root.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind |
| Database | Cloud SQL Postgres 16 + PostGIS + pgvector |
| Hosting | Cloud Run (4 GiB, `min-instances=1`) |
| OCR | Google Vision API |
| LLM | Vertex AI Gemini 2.5 Flash |
| Enrichment | Open Food Facts (~896k US products in local SQLite) |

## Run it locally

This is a portfolio piece — full setup steps live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version: clone, install Node 20, copy `.env.example` to `web/.env.local`, fill in the GCP credentials, and `npm run dev`. The legacy v1 has its own runbook in [legacy/v1/](legacy/v1/).

## Team

Built by **[Tyler Darisme](https://github.com/a-Fig)** and **Thy Tang**, with [Claude](https://www.anthropic.com/claude) / [Claude Code](https://www.anthropic.com/claude-code) as the AI pair-programming partner.

## License

[MIT](LICENSE).
