# AfterCart

> A receipt-based grocery price comparison tool that tells you exactly what you could've paid for your groceries had you gone elsewhere.

Built for **Davis Hacks 2026**.

- Live demo: https://aftercart-web-407493014719.us-west1.run.app/
- Devpost: https://devpost.com/software/aftercart

## What It Is

AfterCart is a receipt-based grocery price comparison tool that tells you — after you've already shopped — what you overpaid and where to go next time, while building a community-maintained price transparency database that benefits every user who follows.

## The Core Loop

The product has one irreducible loop. Everything else is built around it.

1. User photographs a grocery receipt.
2. OCR extracts every line item, quantity, and price.
3. Each item is matched to a canonical product, with top candidates surfaced.
4. **User reviews the matches** — confirms with one tap, swaps among candidates, or searches Open Food Facts directly when the matcher missed.
5. User sees a single headline number: what the same basket would have cost elsewhere, and where.
6. Item-level breakdown is available on demand.
7. Every upload silently contributes a timestamped price data point to the community database.

OCR + matching (steps 1-3) finishes in under 40 seconds. Step 4 is user-paced; the user vouches for the headline number that follows.

## Who It's For

The primary user is a **SNAP recipient** on a prepaid Android phone, buying groceries one or two times a week, shopping at whichever store is accessible by transit or short drive — not necessarily the cheapest by choice. Limited time, limited tolerance for error, no margin to absorb a wasted trip. May have limited English literacy. A household manager making decisions under constraint, not a deal hunter.

Every technical and design decision is evaluated through this user's lens first. Budget-conscious general consumers are a valid secondary audience but never the design target.

## Key Features

### Receipt Comparison

Photograph any US grocery receipt. OCR extracts the line items. Each item is normalized (`SAFWY BFLS CKNG THGH 2.13LB $7.39` becomes `chicken thighs, 2.13 lb, $3.47/lb`) and matched to a canonical product. The headline card shows what the same basket would cost at the cheapest nearby alternative store. The breakdown shows every item, what was paid, what's available elsewhere, and the per-unit delta.

### Pricing Tiers (Shelf vs Member)

Most receipts print two prices per line: the shelf price and the member-card price. Both are captured as separate observations and surfaced side by side: *Safeway — $3.93 shelf, $2.25 with Safeway card*. The headline savings number always uses **shelf prices** so the comparison is universally true — anyone walking in pays that. Member-tier is informational, never a signup pitch.

### Per-Unit Pricing as the Primary Metric

A 3.5 oz dark chocolate bar at $4.99 ($1.43/oz) and a 1 lb bar at $9.99 ($0.62/oz) are different products by pack size and the same product by what's inside. Every weight/volume row shows the per-unit price; when packs differ, the per-row delta switches to per-unit (`↓ $0.81/OZ CHEAPER`). The hero card sums volume-normalized totals. Rows whose units genuinely can't be determined are excluded from the chain total rather than faked.

### Equivalence and Substitutes

Real comparisons aren't always 1:1. Size variants of the same product (3.5 oz vs 1 lb dark chocolate) and cross-brand substitutes (Lucerne whole milk vs 365 whole milk vs Trader Joe's whole milk) are surfaced as `match_type: equivalent` with a `~similar` chip. Equivalents never displace exact matches when an exact match is available.

### Match Coverage Honesty

A store that has prices for 4 of 19 matched items must not look artificially cheap by comparing its 4-item subtotal against the full 19-item basket. Each per-store comparison is computed against only the items that store actually carries, with the matched count surfaced: *Comparable on 4 of 19 matched items at this store. The rest aren't priced here yet.*

### Trust Signals

Every price row carries:

- **Freshness color dot** — green (within 7 days), yellow (7-30), red (30+ or near the 90-day decay cutoff).
- **Observation count** — *Based on 14 receipts in the last 12 days.*
- **Stale flag** — explicit pill on rows whose most recent observation is over 30 days old.

Provenance is the moat. A comparison without it is indistinguishable from a guess.

### Match Review (User Confirmation)

Before any price comparison appears, the user sees a **review screen** using a Confidence Triage layout. High-confidence matches show as a compact green checklist; medium-confidence matches as cards needing a glance; unmatched items as full cards with search input ready. A confident user with clean matches taps "Compare prices" in seconds; ambiguous matches get the few extra seconds they deserve.

Missing units are first-class state: when a row's canonical is priced per-weight/volume but the receipt didn't supply a unit, the inline qty/unit editor opens automatically with an amber warning.

### Cold-Start Graceful State

When the database has no nearby price coverage for the user's items, the headline doesn't fabricate a savings number. It states the basket total and explicitly says *We matched 19 of 24 items, but no nearby store has reported recent prices for them yet.*

### Open Food Facts Enrichment

Every confirmed match is enriched at request time with data from Open Food Facts (a community-maintained, openly-licensed product database — ~896k US products). The item detail modal shows: product image, Nutri-Score (A-E), NOVA processing group (1-4), full ingredients, allergens (red chips), traces (yellow chips), additives, and per-100g nutriments.

The product **displays** these. It does not editorialize them. Users with allergies or dietary needs can use the information; users who don't care can ignore it.

### Confidence System

Matches are scored by trigram similarity on the description, cosine similarity on a 384-dim sentence embedding, a lemma-aware keyword bonus, a length tiebreaker, and a pack-size affinity bonus when the receipt and canonical agree. The threshold is conservative on principle: blended ≥ 0.35 **and** (cosine ≥ 0.30 **or** trigram ≥ 0.4). Items below threshold appear in a *No Comparison Found* group with the count surfaced — never silently omitted, never shown with a low-confidence guess as if it were certain.

## What's NOT The Product

Out of scope, deliberately, to prevent drift:

- **Couponing.** This is a regular-price comparison tool, not a deals platform. Coupons introduce retailer relationships and complexity that compromise neutrality.
- **Meal planning.** Generating recipes from a basket is a different product. Tools for it already exist; this isn't trying to be one.
- **Nutrition judgment.** Third-party nutrition data is displayed; the product never says "you should buy less of this" or compares the user's basket to a target diet. Surfacing factual data is informing the user; ranking baskets by nutrition is paternalism.
- **Loyalty card integration.** No API connections to retailer loyalty systems, no in-app card scanning, no signup nudges. The receipts users upload already print both shelf and member prices on the same line; surfacing both is honest reporting, not retailer integration.
- **Retail partnerships.** No retailer has a relationship with AfterCart that gives them visibility into comparison results, user behavior, or ranking influence. No ads, no sponsored results, no paid placement.

## Design Principles

- **Wrong match worse than no match.** The matcher's threshold is conservative on principle. Items below threshold land in *No Comparison Found* rather than getting a low-confidence guess that misleads the user.
- **Honest coverage.** Per-store totals only sum items that store actually carries. The matched count is always surfaced on the comparison.
- **Per-unit price is the primary metric, not metadata.** Total prices alone are meaningless across pack sizes. Every weight/volume comparison shows per-unit, and the hero card volume-normalizes.
- **Match review before any number is shown.** The user vouches for what they bought before the comparison appears. The headline savings number is never one the matcher decided unilaterally.
- **No retailer relationships.** The comparison's neutrality is the product. Anything that creates a retailer dependency is out of scope by definition.

## What Ships in This Hackathon Build

- End-to-end core loop: photo → Vision OCR → heuristic parse → canonical match → user review → nearby prices → comparison hero card with per-item breakdown and detail modal.
- Receipt parsing at 100% item / price / code / quantity accuracy on the 8-receipt test set; canonical match rate ~88-90% on the same set.
- Pricing tiers (shelf + member) captured and rendered side by side.
- Per-unit pricing throughout: chain-specific pack sizes at the SKU layer, per-row deltas in the right unit, volume-normalized hero totals, explicit `N items missing units` caveat when relevant.
- Match-review screen with Confidence Triage layout: top in-house candidates plus OFF auto-suggestions plus free-text OFF search plus editable qty/unit per item.
- Chain house-brand prefix in OFF auto-suggest (Costco→Kirkland, Walmart→Great Value, TJ's→Trader Joe's, Target→Good & Gather, Whole Foods→365, Safeway→Lucerne).
- Open Food Facts enrichment: 896k US products in a local SQLite, joined via `canonical_barcodes`, surfaced in the item detail modal (image, Nutri-Score, NOVA, ingredients, allergens, per-100g nutriments).
- Two-stage API split (`/api/match` then `/api/compare`) backing the review step.
- Web app as a PWA — no install required, works on a mid-range Android device.
- Three seeding paths wired (manual collection sheet, bulk receipt import, synthetic seed for demo testing).

## Roadmap

### Cut for the hackathon (in the full-product target)

- Basket history view (data is captured; UI not built).
- Pre-trip routing — *Based on what you usually buy, Store A would cost $X this week, Store B $Y* — once basket history ships.
- Store coverage map showing data freshness by store.
- Price alerts (requires push notifications and a more populated database).
- Spanish and Vietnamese UI.
- Equivalence groups populated for top staples (schema is in place; table is empty).
- Public data API for researchers, food banks, and policy analysts.

### Definitely out for the hackathon

- Native iOS or Android apps.
- Cloud sync for basket history.
- Commercial API tier or any revenue infrastructure.

The full v1.3 product spec lives in [docs/product-definition.md](product-definition.md) in the build repo and covers long-horizon strategy (public data layer, revenue model, success metrics) that's deliberately not in this build.
