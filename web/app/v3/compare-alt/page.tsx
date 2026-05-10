'use client';

/**
 * Index page for the comparison-screen design sandbox. Three cohorts:
 *
 *   1. Receipt-vibe + rich pricing (H/I/J) — alternate-reality receipt
 *      metaphor with shelf substitutes baked into the lines AND richer
 *      pricing context (per-unit, percent, spread, market position).
 *
 *   2. Shelf-aware (E/F/G) — surface every option at every chain, badge what
 *      would change, but the receipt aesthetic is muted.
 *
 *   3. Savings-only (current/A/B/C/D) — first-iteration designs that hide
 *      the substitution dimension. Kept for reference.
 */

import Link from 'next/link';
import { V3 } from '@/components/aftercart-v3/theme';

interface Option {
  href: string;
  title: string;
  tag: string;
  tagColor: string;
  thesis: string;
  improvements: string[];
  tradeoffs: string[];
  bestFor: string;
}

const RECEIPT_COHORT: Option[] = [
  {
    href: '/v3/compare-alt/w',
    title: 'Alt W — Forest/Pine',
    tag: 'S variant',
    tagColor: '#6b9e6b',
    thesis: 'Alt S with a deep forest palette — desaturated pine and moss, nothing neon. Hero is a dark forest-green gradient (#1a2e1a → #1e3d1e). The single accent is muted sage #6b9e6b — think lichen, not lime. Negative indicator is a soft muted rose #b05c5c. Chain palette runs sage, dusty teal, warm tan, olive, muted rose. Everything else (parallel rows, ↕ ALL STORES sheet, chain tabs with match counts, per-chain pick memory) is identical to S.',
    improvements: [
      'Deep forest hero feels grounded, organic — no "green = money" or "green = positive" shortcut',
      'Muted sage accent reads calm and earthy at this saturation level — clearly positive but not loud',
      'Near-black forest gradient creates strong contrast without the sharp edge of pure black',
      'Chain palette stays within a natural earthy register — sage, teal, tan, olive — no harsh primaries',
      'Muted rose negative is clearly negative but not alarming — softer than pure red',
    ],
    tradeoffs: [
      'Sage accent is the most visually restrained of the S variants — requires the numbers to carry the savings signal',
      'Dark forest hero may blend into the dark chrome background at screen edges if not careful',
      'Very desaturated palette — high-fidelity displays make it feel premium; lower-end displays may mute it further',
    ],
    bestFor: 'Users who want earthy, nature-adjacent aesthetics without any neon or financial-green associations. Most organic of the S variants.',
  },
  {
    href: '/v3/compare-alt/x',
    title: 'Alt X — Anthropic/Coral',
    tag: 'S variant',
    tagColor: '#c2612a',
    thesis: 'Alt S with a warm terracotta palette — brand-adjacent to Anthropic\'s coral without being a direct copy. Hero is a deep terracotta gradient (#5c1e12 → #7a2a18). The single accent is muted coral #c2612a — warm, rich, clearly positive without neon. Savings deltas run in lighter coral #d97558. Manual picks badge in violet #7c3aed for clean complementary contrast. Chain palette: coral, violet, cyan, emerald, red. Everything else identical to S.',
    improvements: [
      'Deep terracotta hero is warm and distinctive — no cool-blue or money-green association',
      'Coral accent at this saturation level reads "positive" without screaming — sits between orange and red-orange',
      'Violet manual-pick badge creates a strong complementary contrast to coral without fighting it',
      'Hero off-white (#fff7ed orange-50) for neutral stats — warmer than pure white, aligns with the terracotta family',
      'Chain palette mixes warm (coral) with cool (violet, cyan) — chain dots are clearly distinct',
    ],
    tradeoffs: [
      'Terracotta can read as "warning" or "heat" to some users — savings signal relies entirely on the downward arrow and number',
      'Deep terracotta hero is the warmest of the S variants — may feel intense on long sessions',
      'Coral is close to red on some displays — the positive/negative distinction requires the ↓/↑ arrows to do work',
    ],
    bestFor: 'Brand-resonant option for Anthropic-adjacent demos. Warm, distinctive, and professional without the standard financial-UI blues or greens.',
  },
  {
    href: '/v3/compare-alt/t',
    title: 'Alt T — Slate/Mist',
    tag: 'S variant',
    tagColor: '#38bdf8',
    thesis: 'Alt S with a cool slate palette. Hero is a deep navy-slate gradient (#0f172a → #1e293b) instead of vivid green. The single accent color is sky-400 (#38bdf8) — a desaturated, airy blue. Savings deltas run sky-300/red-400. Chain palette: sky, violet, purple, amber, rose. Everything else (parallel rows, ↕ ALL STORES sheet, chain tabs with match counts, per-chain pick memory) is identical to S.',
    improvements: [
      'Cool, professional feel — no green association with "savings"',
      'Sky-400 reads clearly at the saturation level of the dark UI without being neon',
      'Near-black hero creates strong contrast for the chain name and three numbers',
      'Chain palette avoids greens entirely — distinct from the standard savings UI language',
    ],
    tradeoffs: [
      'Sky-blue savings accent is less immediately "good" than green — requires a moment to parse',
      'Very cool palette may feel clinical compared to the warmth of S\'s green',
    ],
    bestFor: 'Users who find the neon green too aggressive. Same information, calmer delivery.',
  },
  {
    href: '/v3/compare-alt/u',
    title: 'Alt U — Amber/Earth',
    tag: 'S variant',
    tagColor: '#d97706',
    thesis: 'Alt S with a warm amber-earth palette. Hero is a deep amber-brown gradient (#78350f → #92400e) — earthy, warm, nothing like money-green. The single accent is amber-600 (#d97706), a muted warm gold. Savings deltas run amber-500/red-600. Chain palette: amber, cyan, violet, emerald, red. Everything else identical to S.',
    improvements: [
      'Warm amber hero feels grounded and human — no "green = good" shortcut',
      'Amber-600 is clearly positive without being loud or neon',
      'Brown-to-amber gradient reads earthy rather than financial',
      'Cyan MANUAL badge creates a clean complementary contrast to amber',
    ],
    tradeoffs: [
      'Amber can read as "warning" to some users — the positive savings signal requires the number to do the work',
      'Warm palette may feel less "precise" than the cool slate or ink themes',
    ],
    bestFor: 'A warmer, more human alternative to S. Works well if the receipt/paper aesthetic is a priority.',
  },
  {
    href: '/v3/compare-alt/v',
    title: 'Alt V — Ink/Indigo',
    tag: 'S variant',
    tagColor: '#818cf8',
    thesis: 'Alt S taken near-monochrome. Hero is a near-flat zinc-900 gradient (#18181b → #27272a) — almost black. The single accent is indigo-400 (#818cf8), the only real color on the page. Savings deltas run indigo-300/rose-400. Chain palette: indigo, sky, pink, yellow, rose. Everything else identical to S. Editorial, typographic, zero neon.',
    improvements: [
      'One accent color across the entire page — indigo-400 marks every positive signal',
      'Near-black hero puts maximum visual emphasis on the chain name and numbers',
      'Indigo reads "confident" without the "savings = green" association',
      'Rose-400 negative (higher price) is clearly negative but desaturated — less alarming',
      'Chain palette uses clearly distinct colors with no saturation competition',
    ],
    tradeoffs: [
      'Near-monochrome hero may feel too spare for some users — no warmth signal',
      'Indigo savings accent is the furthest from conventional "cheaper = green" — requires learning',
      'Very dark hero on an already-dark page — strongest visual contrast, but leaves little room to go darker for emphasis',
    ],
    bestFor: 'The most editorial option. Maximum focus on numbers and typography, minimum color noise.',
  },
  {
    href: '/v3/compare-alt/s',
    title: 'Alt S — Minimal Hero + All-Stores Sheet',
    tag: 'M variant',
    tagColor: '#a855f7',
    thesis: 'M\'s structure with two changes. The hero is reduced to three numbers — what you paid at your store, what you\'d pay at the active alt chain, and the % savings — for the items the chain actually has prices for. No verdict text, no green gradient. Each row gains a small "↕ ALL STORES" pill on the alt column; tapping it slides up a bottom sheet from the screen edge with every nearby chain\'s prices and options for that item, grouped by chain, with ★ on the cheapest. Read-only, dismisses on backdrop click or Escape.',
    improvements: [
      'Hero is just three numbers — your store total, alt store total, and % off — no verdict framing',
      'Both store names anchor the hero ("Your Safeway trip vs Costco · 3.4 mi") and label each stat column',
      'Per-row "↕ ALL STORES" pill opens a bottom sheet with every chain\'s prices for that item',
      'Bottom sheet shows ALL options per chain (not just the auto-cheapest) — full cross-chain visibility per item',
      '★ CHEAPEST tag on the lowest price across all chains in the sheet; ACTIVE tag on the page-active chain',
      'Sheet locks body scroll while open and dismisses on Escape, backdrop click, or × button',
      'Everything else preserved from M: parallel rows, picker drawer on row click, chain tabs, per-chain pick memory',
    ],
    tradeoffs: [
      'Two affordances per row (sheet button + picker drawer) — discoverable but two things to learn',
      'Sheet is read-only — picking a substitute still requires opening the row picker drawer',
      'No dollar-savings number on the hero (per spec — only % matters), some users may want both',
      'Bottom sheet on desktop covers a lot of vertical space; designed for the mobile primary user first',
    ],
    bestFor: 'The cleanest M variant — minimal hero communicates only the three numbers that matter, and per-item cross-chain prices are one tap away in a familiar mobile sheet pattern.',
  },
  {
    href: '/v3/compare-alt/n',
    title: 'Alt N — Optimized Basket (multi-chain drawer)',
    tag: 'Cross-chain',
    tagColor: '#22c55e',
    thesis: 'Drops the global chain tabs entirely. Each row is independently pinned to whichever chain has the cheapest option for that item by default — modeling how shoppers actually think ("I\'ll Costco the meat, TJ the dairy, GO the produce"). The hero shows your "optimized trip across N stores" with a chain-by-chain breakdown of where you\'d go and how many items per stop. Tapping any row opens a drawer that shows EVERY chain\'s options for that item, grouped into chain sections — pick across chain boundaries without leaving the row.',
    improvements: [
      'No global chain tab — the hero is the verdict, the rows are the basket',
      'Per-row chain pinning — each item belongs to whichever chain is best for it',
      'Drawer shows every chain at once, grouped — no tab switching to compare',
      '"Where you\'d go" hero panel — pill per chain with item counts (★ on cheapest contributor)',
      'Right column shows the pinned chain + distance + ★ CHEAPEST badge inline',
      '"✏ MANUAL" pill on rows you\'ve overridden the auto-cheapest for',
      'Skip option marks the item as "wouldn\'t buy this anywhere" (not just at one chain)',
    ],
    tradeoffs: [
      'Big product framing change — savings narrative is now "split-trip optimization," not single-store',
      'A 3-stop optimized trip ignores the cost of driving to 3 stops; user has to read between the lines',
      'Drawer is taller than M\'s — every chain\'s options are listed, including unavailable',
      'Per-chain pick memory from L/M is gone (one pin per row, not per chain)',
    ],
    bestFor: 'Users who already cherry-pick across stores in real life. The hero answers "where should I split this trip?" — a different question than M/L\'s "which single store is cheapest."',
  },
  {
    href: '/v3/compare-alt/o',
    title: 'Alt O — Quick Peek (per-row popover)',
    tag: 'Cross-chain',
    tagColor: '#3b82f6',
    thesis: 'M\'s structure unchanged. Each row gets a small "⌥ COMPARE" pill on the right edge. Tapping it opens a tight inline popover anchored to the row showing every nearby chain\'s best price for that item — chain name, distance, substitute, change badge, price + delta, ★ on the cheapest. The peek is read-only and dismisses on outside click or Escape. The full picker drawer (clicking elsewhere on the row) still works the same as M for actually picking. Keeps M\'s headline-first single-store framing while answering "what\'s this item cost everywhere else?" without leaving the row.',
    improvements: [
      'Cross-chain prices for any item in one tap, no tab switching',
      'Visible affordance — "⌥ COMPARE" pill makes the peek discoverable on touch and desktop',
      'Read-only — no commit cost, just a quick scan',
      '★ on cheapest, "ACTIVE" pill on the page-active chain so context is preserved',
      'Compact — popover is anchored to the row, doesn\'t hide other items',
      'Dismisses on Escape, outside click, or chain switch — no zombie popovers',
      'Full picker drawer (click elsewhere on row) still works as in M',
    ],
    tradeoffs: [
      'Two affordances per row (peek + drawer) — more learnable than guessable',
      'Popover only shows each chain\'s ONE auto-cheapest pick; multiple options per chain need the picker drawer',
      'Mobile: popover competes with row content for tap area; might need a slide-up sheet on small screens',
    ],
    bestFor: 'Users who want M/L\'s headline-first framing but occasionally need to spot-check "how cheap is this elsewhere?" without committing to switching chains.',
  },
  {
    href: '/v3/compare-alt/m',
    title: 'Alt M — Parallel Rows',
    tag: 'L variant',
    tagColor: '#a855f7',
    thesis: 'L\'s structure with the row body reworked. Each breakdown row is now two equal columns separated by a dashed divider — "YOU PAID" on the left, "AT [chain]" on the right. Each side has its own header pill, big price, product name, and pack/brand meta. The user\'s actual purchase reads as equal in stature to the alternative, instead of being a small muted label under the substitute. Same hero, tabs, picker drawer, accordion, and per-chain pick memory as L.',
    improvements: [
      'User\'s purchase has equal visual weight per row — name, qty/pack, and price all prominent',
      '"$5.29" reads as big as "$3.00" — the comparison is parallel, not unequal',
      'Dashed column divider — paper-ledger feel without an actual receipt artifact',
      'Change badge (BULK PACK, ORGANIC, etc.) sits on the row meta line, not just in the picker',
      'Skip and not-stocked states render in the right column with muted opacity, preserving symmetry',
      'Everything else from L: live hero, accordion, per-chain memory, ✏ MANUAL pill, AUTO-CHEAPEST reset',
    ],
    tradeoffs: [
      'Each row is taller than L — the page lengthens significantly on a long basket',
      'Pack-size labels can wrap when both columns are narrow on smaller widths',
      'Less compact at-a-glance than L; you read each row top-to-bottom on both sides',
    ],
    bestFor: 'Users who want to see what they actually bought presented as equally important to the alternative — not as a tag on the alt\'s row.',
  },
  {
    href: '/v3/compare-alt/l',
    title: 'Alt L — Verdict + Picker',
    tag: 'Synthesis',
    tagColor: '#a855f7',
    thesis: 'Love child of A and G. Keeps A\'s presentation — green hero verdict on top with savings dollar + percent, other-chain tabs, per-category breakdown rows. But every breakdown row is now interactive: tap any row to drop an inline picker drawer with G\'s radio-style candidate list. Pick the substitute YOU\'D actually buy at the active chain. Skip items you wouldn\'t buy there. The hero number recomputes live from your picks. Picks persist per chain — switching from Grocery Outlet to Trader Joe\'s and back doesn\'t lose your work. Single-row accordion keeps the page focused.',
    improvements: [
      'A\'s headline-first verdict — the savings number is visible before any reading',
      'Every row is a tappable drawer — opens G\'s picker right where the row sits',
      'Hero recomputes LIVE — change a substitute, watch the headline update',
      '"✏ MANUAL" pill on rows where you\'ve overridden the auto-cheapest',
      '"✏ N personalized" hint on chain tabs and hero so you know your picks are sticky',
      'Per-chain pick memory — bouncing between chains doesn\'t reset your work',
      'Skip option per row — items you wouldn\'t buy there don\'t inflate the comparison',
      'Single accordion — opening row B closes row A so the page never feels overwhelming',
    ],
    tradeoffs: [
      'No receipt-paper aesthetic; this is the dark-chrome A look, not a tangible artifact',
      'Doesn\'t show all chains side-by-side per item (one chain active at a time, like A and G)',
      'No inline OFF search yet — picker only shows the candidates the API surfaced',
    ],
    bestFor: 'The user who wants a clear headline answer AND wants to personalize the basket. Verdict-first reading, customization on demand, no scroll-fatigue.',
  },
  {
    href: '/v3/compare-alt/k',
    title: 'Alt K — Comparison Ledger',
    tag: 'Synthesis',
    tagColor: '#a855f7',
    thesis: 'A printed-ledger artifact that lays out items × chains as a paper-styled spreadsheet. Each cell is an "alternate trip" sub-receipt with substitute name, change badge, total, and percent. Click any cell to drop an inline sub-row showing every other shelf option at that chain — with a search box to find products the auto-suggest missed and a radio to pick which substitute is "your" pick. Per-chain comparison stamps at the bottom recompute live as picks change. Combines F\'s grid with H\'s paper-receipt vibes.',
    improvements: [
      'Single ledger artifact — items × chains laid out side by side, no horizontal scroll between receipts',
      'Click any cell to expand inline — see all shelf options at that chain for that item',
      'Search box per cell — find products the auto-suggest missed ("type \'organic\'", "type \'lactaid\'")',
      'Radio selection — pick the substitute YOU\'D actually buy; manual picks marked "✏ MANUAL"',
      'Live total recomputation — change a pick, watch the comparison stamps update',
      '"Reset to cheapest auto-pick" link in expanded view to undo a manual override',
      'Skipped-items footer per chain — what each store doesn\'t stock',
    ],
    tradeoffs: [
      'Wide layout — needs ~720px+ to render comfortably; mobile gets a horizontal scroll on the ledger',
      'More to absorb at first glance than a single-receipt design — ledger reads richer but slower',
    ],
    bestFor: 'The default. Has the receipt artifact feel, the spreadsheet grid, and the actual shopping-decision tools (pick + search) in one place.',
  },
  {
    href: '/v3/compare-alt/h',
    title: 'Alt H — Parallel-Reality Receipts',
    tag: 'Could-Have-Been',
    tagColor: '#22c55e',
    thesis: 'Render each alternative chain as a complete fictional receipt — chain-specific header, substitute products as line items, subtotal/tax/total/payment/transaction line, comparison stamp. Not a comparison column; a tangible artifact from an alternate trip you didn\'t take. The user can mentally hold it next to their real receipt and see "this could\'ve been mine."',
    improvements: [
      'Each alt is a STANDALONE RECEIPT, not a column in a comparison',
      'Inline change badges on every line: SAME BRAND, STORE BRAND, BULK PACK, ORGANIC, DIFF FORM',
      'Skipped items live in a footer ("3 items you\'d skip here") — never silently dropped',
      'Per-line pricing: total, per-unit ($/lb, $/oz), percent off, "+N other shelf options"',
      'Bottom stamp shows comparison vs your actual trip: "↓ $9.64 SAVED · 21% OFF"',
    ],
    tradeoffs: [
      'Horizontal scroll on desktop with 3+ chains; tighter on mobile',
      'Auto-picks the cheapest substitute at each chain — others are surfaced as "+N more on shelf" but not detailed',
    ],
    bestFor: 'The strongest emotional pitch. Users scanning their own receipt to see what other lives this trip could\'ve had.',
  },
  {
    href: '/v3/compare-alt/i',
    title: 'Alt I — Diff Receipt',
    tag: 'Annotated',
    tagColor: '#3b82f6',
    thesis: 'Keep the user\'s actual receipt as the anchor and annotate every line with what each chain would have stocked. Annotations live inline in the same monospace font, indented under each item, so the page reads as "your receipt, expanded with shelf data." Cheapest across chains is starred. A "spread $X–$Y across N options" line answers "where does my price actually fall?"',
    improvements: [
      'User\'s real receipt is the anchor — no mental swap to a fictional artifact',
      'All chains visible per item simultaneously — no horizontal scroll, no chain switcher',
      'Per-chain sub-line: arrow + chain + substitute name + price + percent + change badge',
      'Star (★) on the cheapest substitute across all chains — the answer is one glyph',
      'Spread summary per item: "$3.00–$7.49 across 7 nearby options"',
      '"Not stocked" is its own sub-line ("× COSTCO  NOT STOCKED")',
    ],
    tradeoffs: [
      'Dense — long basket × multiple chains can feel busy; small monospace typography',
      'Less emotionally direct than Alt H — feels analytical rather than visceral',
    ],
    bestFor: 'Users who want to skim their own receipt and read the local shelf reality off it without losing the original artifact.',
  },
  {
    href: '/v3/compare-alt/j',
    title: 'Alt J — Price-Range Receipt',
    tag: 'Visual spread',
    tagColor: '#a855f7',
    thesis: 'Render each item\'s available prices as a horizontal spectrum — cheapest on the left, most expensive on the right, with markers for every chain\'s substitute and a clearly-labeled "YOU" marker. The bar makes "your price was at the cheap end" or "you overpaid by a wide margin" visible in one glance, before any reading. Substitute lines below preserve the brand/badge context.',
    improvements: [
      'Visual price spectrum per item — pre-cognitive read of "how bad is it?"',
      'YOU marker shows your purchase\'s position in the local market',
      'Color-coded chain markers — Safeway = amber, Grocery Outlet = green, TJ\'s = red, Costco = blue',
      'Cheapest marker gets a ★ — same star as Alt I for consistency',
      'Substitute list below the bar still carries change badges and percent deltas',
    ],
    tradeoffs: [
      'Bar can be dense when prices are tight (e.g., bananas at $0.99 vs $1.47 vs $1.49)',
      'Visual chart adds complexity — some users may prefer pure numerics',
      'Per-chain comparison is one step less direct than Alt I (you read the bar AND the list)',
    ],
    bestFor: 'Users who skim, not read. The visual position on the bar communicates more in 200ms than any numeric label.',
  },
];

const SHELF_AWARE: Option[] = [
  {
    href: '/v3/compare-alt/e',
    title: 'Alt E — Shelf Browser',
    tag: 'Shelf-aware',
    tagColor: '#9ca3af',
    thesis: 'Per-item cards. Each chain inside the card lists every option on its shelf with a colored badge for what would change. Cheapest is starred. "Not stocked" is a first-class state.',
    improvements: ['Shows ALL options at each chain, not just the auto-cheapest'],
    tradeoffs: ['Modern card aesthetic, not a receipt — less emotional pull'],
    bestFor: 'Reference for the shelf-aware concept without receipt theater.',
  },
  {
    href: '/v3/compare-alt/f',
    title: 'Alt F — Substitution Diff',
    tag: 'Compact diff',
    tagColor: '#9ca3af',
    thesis: 'A grid: rows are items, columns are chains. Each cell is a "what would change" card with colored badge. Other options collapse to "+N other options."',
    improvements: ['Side-by-side substitution comparison'],
    tradeoffs: ['Spreadsheet aesthetic, not a receipt'],
    bestFor: 'Reference for the diff-grid concept.',
  },
  {
    href: '/v3/compare-alt/g',
    title: 'Alt G — Per-Item Picker',
    tag: 'Interactive',
    tagColor: '#9ca3af',
    thesis: 'Pick a chain, then for each item tap the substitute you\'d actually buy. Live total updates as you go.',
    improvements: ['Treats user preference as input, not noise'],
    tradeoffs: ['No receipt feel; requires effort'],
    bestFor: 'Reference for the interactive shopping-cart concept.',
  },
];

const SAVINGS_ONLY: Option[] = [
  {
    href: '/v3/compare-alt/current',
    title: 'Current — Side-by-side receipts',
    tag: 'Production',
    tagColor: '#9ca3af',
    thesis: 'Production V3Compare: paper receipts side by side. Substitution differences are buried in a popover.',
    improvements: [],
    tradeoffs: ['Substitutions hidden by default; auto-picks cheapest invisibly'],
    bestFor: 'The baseline.',
  },
  {
    href: '/v3/compare-alt/a',
    title: 'Alt A — Verdict First',
    tag: 'Savings-only',
    tagColor: '#9ca3af',
    thesis: 'Hero card with the savings number, items grouped by category. No substitution awareness.',
    improvements: ['Headline first'],
    tradeoffs: ['Treats alternatives as identical to the original'],
    bestFor: 'Reference for "headline-first."',
  },
  {
    href: '/v3/compare-alt/b',
    title: 'Alt B — Decision Map',
    tag: 'Savings-only',
    tagColor: '#9ca3af',
    thesis: 'Heatmap. Cells show price; substitution is invisible.',
    improvements: ['One-screen cross-chain view'],
    tradeoffs: ['Same blind spot as the current design'],
    bestFor: 'Reference for tabular density.',
  },
  {
    href: '/v3/compare-alt/c',
    title: 'Alt C — Strikethrough Receipt',
    tag: 'Savings-only',
    tagColor: '#9ca3af',
    thesis: 'Annotated receipt with strikethrough. Only the auto-cheapest substitute shown.',
    improvements: ['Lowest cognitive load'],
    tradeoffs: ['Hides substitution behind "~similar"'],
    bestFor: 'Reference for receipt-rewrite.',
  },
  {
    href: '/v3/compare-alt/d',
    title: 'Alt D — Savings Story',
    tag: 'Savings-only',
    tagColor: '#9ca3af',
    thesis: 'Narrative sentences. Mentions "a similar one" but doesn\'t name the substitute.',
    improvements: ['Most accessible language'],
    tradeoffs: ['Too vague about what would actually change'],
    bestFor: 'Reference for conversational frame.',
  },
];

export default function CompareAltIndex() {
  return (
    <div style={{
      minHeight: '100vh',
      background: V3.page,
      color: V3.ink,
      fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '60px 24px' }}>
        <div style={{ marginBottom: 8 }}>
          <Link href="/v3" style={{ fontSize: 12, color: V3.inkLight, textDecoration: 'none' }}>
            ← Back to /v3
          </Link>
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', margin: '12px 0 12px' }}>
          Compare-page design sandbox
        </h1>
        <p style={{ fontSize: 16, color: V3.inkMid, lineHeight: 1.55, margin: '0 0 16px', maxWidth: 720 }}>
          A grocery comparison is a shopping decision, not just a math problem. The substitute at the alt store is rarely the same product —
          different brand, different size, sometimes not stocked at all. <strong style={{ color: V3.ink }}>What would change is just as
          important as how much you'd save.</strong>
        </p>
        <p style={{ fontSize: 14, color: V3.inkMid, lineHeight: 1.55, margin: '0 0 16px', maxWidth: 720 }}>
          Cohort 1 (H/I/J) leans into the "this could've been your receipt" feeling: receipt aesthetic, full substitution awareness,
          and richer per-line pricing — totals, per-unit, percent off, market spread, your price's position in the spectrum.
        </p>
        <p style={{ fontSize: 13, color: V3.inkLight, lineHeight: 1.55, margin: '0 0 36px', maxWidth: 720 }}>
          Same mock receipt across all designs (Safeway, $54.78, 9 items, 2–3 substitutes per chain) so the differences are pure design.
        </p>

        {/* Cohort 1 — Receipt + rich pricing */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: '#22c55e' }} />
            <h2 style={{ fontSize: 22, fontWeight: 800, color: V3.ink, margin: 0 }}>Receipt vibes + richer pricing</h2>
            <span style={{ fontSize: 12, color: V3.inkLight }}>
              The "could've been your receipt" feeling, with substitution + market context
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14, marginBottom: 50 }}>
          {RECEIPT_COHORT.map((opt) => <OptionCard key={opt.href} option={opt} />)}
        </div>

        {/* Cohort 2 — Shelf-aware (without receipt) */}
        <div style={{ marginBottom: 16, marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: '#3b82f6' }} />
            <h2 style={{ fontSize: 22, fontWeight: 800, color: V3.ink, margin: 0 }}>Shelf-aware (no receipt aesthetic)</h2>
            <span style={{ fontSize: 12, color: V3.inkLight }}>
              Substitution awareness without the receipt theater
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14, marginBottom: 50 }}>
          {SHELF_AWARE.map((opt) => <OptionCard key={opt.href} option={opt} />)}
        </div>

        {/* Cohort 3 — Savings-only baselines */}
        <div style={{ marginBottom: 16, marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: '#9ca3af' }} />
            <h2 style={{ fontSize: 22, fontWeight: 800, color: V3.ink, margin: 0 }}>Savings-only (first iteration)</h2>
            <span style={{ fontSize: 12, color: V3.inkLight }}>
              Treats alternatives as identical · the dimension we now show
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          {SAVINGS_ONLY.map((opt) => <OptionCard key={opt.href} option={opt} />)}
        </div>

        <div style={{
          marginTop: 60,
          padding: '20px 24px',
          background: V3.pageAlt,
          border: `1px solid ${V3.border}`,
          borderRadius: 12,
          fontSize: 13,
          color: V3.inkMid,
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: V3.ink, marginBottom: 6, fontSize: 14 }}>How to evaluate cohort 1</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Open Alt K and ask: <em>can I read every alternate trip at once, AND swap any pick to my real preference?</em></li>
            <li>Open Alt H and ask: <em>does each alt receipt feel like an artifact I could imagine holding?</em></li>
            <li>Open Alt I and ask: <em>can I read the local market off my own receipt without leaving the page?</em></li>
            <li>Open Alt J and ask: <em>can I see at a glance whether I overpaid or got a deal — before reading any number?</em></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function OptionCard({ option }: { option: Option }) {
  return (
    <Link
      href={option.href}
      style={{
        display: 'block',
        background: V3.pageAlt,
        border: `1px solid ${V3.border}`,
        borderRadius: 16,
        padding: '24px 26px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = V3.borderHi;
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = V3.border;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{
          display: 'inline-block',
          padding: '3px 10px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          background: option.tagColor + '22',
          color: option.tagColor,
          borderRadius: 999,
        }}>
          {option.tag}
        </span>
        <h3 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em', margin: 0, color: V3.ink }}>
          {option.title}
        </h3>
      </div>

      <p style={{ fontSize: 14, color: V3.inkMid, lineHeight: 1.55, margin: '0 0 14px' }}>
        {option.thesis}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: option.improvements.length > 0 ? '1fr 1fr' : '1fr', gap: 18, marginBottom: 14 }}>
        {option.improvements.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#22c55e', marginBottom: 6 }}>
              Improves
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: V3.inkMid, lineHeight: 1.55 }}>
              {option.improvements.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
            </ul>
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f59e0b', marginBottom: 6 }}>
            Trade-offs
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: V3.inkMid, lineHeight: 1.55 }}>
            {option.tradeoffs.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
          </ul>
        </div>
      </div>

      <div style={{ fontSize: 12, color: V3.inkLight, marginBottom: 14, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 700, color: V3.inkMid }}>Best for: </span>
        {option.bestFor}
      </div>

      <div style={{
        display: 'inline-block',
        background: V3.ink,
        color: V3.page,
        padding: '8px 16px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
      }}>
        View this design →
      </div>
    </Link>
  );
}
