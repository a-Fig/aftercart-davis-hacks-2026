'use client';

/**
 * Index for the review-screen design sandbox.
 *
 * Three distinct alternatives to V3ReviewA (Confidence Triage):
 *   A — Receipt Annotator:  the whole screen is the actual receipt, items as
 *                            printed lines, colored status badges, bottom sheet for editing
 *   B — Decision Queue:     high-confidence items batch-confirmed up front;
 *                            medium/low items shown one at a time as a focused card
 *   C — Flat Triage List:   single flat list, colored left-border per confidence tier,
 *                            2-column candidate grid expands inline
 */

import Link from 'next/link';
import { V3 } from '@/components/aftercart-v3/theme';

interface Option {
  href: string;
  currentHref?: string;
  title: string;
  tag: string;
  tagColor: string;
  thesis: string;
  improvements: string[];
  tradeoffs: string[];
  bestFor: string;
}

const ALTS: Option[] = [
  {
    href: '/v3/review-alt/a',
    title: 'Alt A — Receipt Annotator',
    tag: 'Receipt artifact',
    tagColor: '#22c55e',
    thesis: 'The review screen IS the receipt. Items appear as printed receipt lines in monospace — raw text, price, right-aligned colored badge (✓ / ⚠ / ✗). An italic annotation below each line shows the interpreted product name. Tapping any line slides up a bottom sheet for candidate picking and search. The whole receipt stays visible throughout — no items disappear or move into sections. If the receipt had 20 items and 18 are perfect, you see 20 lines, 18 green badges, and you tap the 2 amber/red ones.',
    improvements: [
      'Anchored to the physical receipt — users recognize the format instantly',
      'Full receipt always visible — no items hidden in sections, no scroll-jump on expand',
      'Green/amber/red badges are immediate at a glance — no reading needed to know the state',
      'Bottom sheet keeps the receipt intact while editing — no layout shift',
      'Annotation line ("→ Boneless Skinless Chicken Thighs") is unambiguous about what the app understood',
      'Tap target = whole receipt line, not a small button',
    ],
    tradeoffs: [
      'Receipt line width is fixed — long product names get truncated in the receipt format',
      'Bottom sheet is taller than an inline expand — more finger travel on short receipts',
      'Dense monospace style may be harder to scan for users unfamiliar with receipts',
    ],
    bestFor: 'Users who photograph receipts daily and trust the artifact format. Best emotional fit for the paper-receipt V3 aesthetic.',
  },
  {
    href: '/v3/review-alt/b',
    title: 'Alt B — Decision Queue',
    tag: 'One at a time',
    tagColor: '#3b82f6',
    thesis: 'High-confidence items form a "batch confirmed" strip at the top — a collapsed card with a count and a ✓. Users can expand it to review individual items but don\'t need to. The items that need attention (medium/low confidence) appear in a focused queue: one card at a time, front and center. Each card has large readable text, a radio-style candidate list, a search input, and two action buttons ("Skip" / "✓ Looks right →"). After each decision the queue auto-advances to the next item. Progress bar shows how many remain.',
    improvements: [
      'Batch-confirm for high-confidence items — most users tap one button and see the queue',
      'One card at a time eliminates overwhelm — never more than one decision in view',
      'Large text, large tap targets — optimized for the primary user\'s older Android device',
      'Progress bar makes the queue feel finite — "2 more items" is more motivating than a list of 20',
      '"Looks right →" auto-advances — no separate "done" state per item',
      'Back/forward navigation — users can revisit a previous decision without losing state',
    ],
    tradeoffs: [
      'No holistic receipt view — items are seen individually, not as a group',
      'Batch strip loses nuance: "4 items confirmed" doesn\'t show what those items are without expanding',
      'Queue metaphor assumes the order matters — re-ordering for priority would need extra logic',
      'If ALL items need attention (all low confidence), the batch strip is empty and the queue is the whole receipt — less efficient than V3ReviewA in that case',
    ],
    bestFor: 'Receipts where the matcher is mostly confident and 1–3 items need attention. Ideal for the primary user who just wants to confirm and move on.',
  },
  {
    href: '/v3/review-alt/c',
    title: 'Alt C — Flat Triage List',
    tag: 'Dense list',
    tagColor: '#a855f7',
    thesis: 'No section headers, no grouped cards, no visual noise. Every item in a single flat list on a paper-cream card, compact as possible. Each row: 4px colored left-border strip (green/amber/red), small monospace raw text, larger interpreted name, unit badge, price, confidence dot. Tapping any row expands it full-width inline — candidates appear as a 2-column tile grid, search below, skip at the bottom. Only one row open at a time. Items needing attention start pre-expanded. The whole design fits the V3 paper aesthetic without the section-header overhead.',
    improvements: [
      'No section labels — "Good to go / Needs your eye / Needs help" is all communicated by the colored strip',
      'Compact row height — 20+ items fit on screen without scrolling',
      'Left-border strip is scannable even when skimming — peripheral vision picks up green/amber/red',
      'Pre-expanded rows for uncertain items — user sees what needs attention the moment the page loads',
      '2-column candidate grid is more space-efficient than the current vertical list',
      'Single open row at a time keeps the page focused without hiding other items',
    ],
    tradeoffs: [
      'Less descriptive than V3ReviewA — the confidence state is color-only, not labeled',
      'Very compact row may feel small for tapping on older Android devices (mitigation: left-border is also a tap target)',
      '2-column tile grid cuts off long product names — fixed by 2-line clamp but can look uneven',
      'No receipt summary card (store name + progress bar in header is the replacement) — slightly less context',
    ],
    bestFor: 'Power users scanning quickly through a long receipt. The most information-dense option with the lowest chrome overhead.',
  },
  {
    href: '/v3/review-alt/d',
    title: 'Alt D — Edit-First Cards',
    tag: 'Full control',
    tagColor: '#f97316',
    thesis: 'Every item is an editable card with always-visible unit dropdown (lb/oz/gal/count/each), quantity input, and bidirectional price editing — change the total and unit price recalculates, or change unit price and total updates. Big product images from OFF (100×100) make it easy to visually confirm the right product. Styled after the CompareAltS visual language: dark chrome, paper-cream cards, green gradient CTA, clean grid layouts. Search input is prominent with large image results. Designed for users who need to correct OCR errors on every field, not just the product match.',
    improvements: [
      'Unit dropdown always visible — no extra tap to edit units (lb, oz, gal, count, each)',
      'Bidirectional price sync — edit total or unit price, the other recalculates automatically',
      'Big product images (100×100) from OFF — visual confirmation beats reading text',
      'All fields editable inline — quantity, unit, total price, unit price',
      'CompareAltS visual language — proven clean dark-chrome aesthetic',
      'Search results show large product images — users pick the right product faster',
    ],
    tradeoffs: [
      'More UI per item than A/B/C — each expanded card is taller with all the editable fields',
      'Bidirectional price sync can surprise users if they don\'t expect the other field to change',
      'Full-control design may overwhelm users who just want to tap "confirm" on good matches',
    ],
    bestFor: 'Receipts with OCR errors in prices/quantities/units. Best when the user needs to fix data, not just confirm matches.',
  },
  {
    href: '/v3/review-alt/e',
    title: 'Alt E — Edit-First + Pack Size',
    tag: 'Multi-pack aware',
    tagColor: '#06b6d4',
    thesis: 'Same chassis as Alt D, but adds an optional "size per item" row that appears whenever the unit is `each`. A user buying 3 × 32oz deep dish pizzas can express both the count (qty 3, unit each) AND the per-item pack size (each is 32 oz) without conflating them. The collapsed-header badge surfaces both as twin chips: ×3 + 32oz ea. The field pre-fills from the matched candidate\'s package_size when present, and is never required — users who only care about total price can ignore it. Solves the semantic gap where one qty/unit pair couldn\'t represent both purchase count and pack size.',
    improvements: [
      'Separates purchase count from per-item pack size — no more ambiguous "3 oz" meaning either "3 individual pizzas" or "3oz total"',
      'Pack size shown as a green chip in the collapsed badge: `×3 32oz ea` reads as "three of these, 32oz each"',
      'Pre-fills from the matched candidate\'s package_size — the common case is zero typing',
      'Inline hint computes total: "3 × 32 oz = 96 oz for per-unit comparison"',
      'Optional, never blocks — users with all weight/volume items never see the field',
      'Field auto-shows when unit is `each` (or empty), auto-hides when unit is lb/oz/gal',
    ],
    tradeoffs: [
      'One more field to potentially fill — slight visual weight even when collapsed',
      'Two layers of size info (purchase qty + pack size) is conceptually heavier than one',
      'Users who never multi-buy see a feature that never activates for them',
    ],
    bestFor: 'Receipts with multi-quantity packaged purchases (3 pizzas, 2 jars of peanut butter, 4 yogurt cups). Makes per-unit comparison honest when a user buys multiple of the same packaged item.',
  },
];

const CURRENT: Option = {
  href: '/v3/review-test',
  title: 'Current — Confidence Triage (V3ReviewA)',
  tag: 'Production',
  tagColor: '#9ca3af',
  thesis: 'Items grouped into three named sections: "Good to Go" (compact checklist), "Needs Your Eye" (medium confidence cards), and "Needs Help" (full unmatched cards with search shown). Receipt summary card at top with store info + segmented progress bar. Sticky CTA at bottom.',
  improvements: [],
  tradeoffs: ['Section headers add vertical chrome — long receipts require significant scroll before reaching uncertain items'],
  bestFor: 'The baseline.',
};

export default function ReviewAltIndex() {
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
          Review-screen design sandbox
        </h1>
        <p style={{ fontSize: 16, color: V3.inkMid, lineHeight: 1.55, margin: '0 0 10px', maxWidth: 720 }}>
          The review screen sits between scan and results — users confirm each item's match before any price comparison runs.
          The design challenge: <strong style={{ color: V3.ink }}>most items match correctly on a good receipt, so the UI must handle the common case (skim and confirm) as efficiently as it handles the hard case (fix a bad match).</strong>
        </p>
        <p style={{ fontSize: 13, color: V3.inkLight, lineHeight: 1.55, margin: '0 0 36px', maxWidth: 720 }}>
          Same mock data across all designs: Safeway receipt, 6 items, 3 high-confidence matches,
          1 medium-confidence, 1 high-confidence with no unit, 1 unmatched.
        </p>

        {/* Alts */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: '#22c55e' }} />
            <h2 style={{ fontSize: 22, fontWeight: 800, color: V3.ink, margin: 0 }}>New alternatives</h2>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14, marginBottom: 50 }}>
          {ALTS.map((opt) => <OptionCard key={opt.href} option={opt} />)}
        </div>

        {/* Current baseline */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: '#9ca3af' }} />
            <h2 style={{ fontSize: 22, fontWeight: 800, color: V3.ink, margin: 0 }}>Current production design</h2>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14, marginBottom: 50 }}>
          <OptionCard option={CURRENT} />
        </div>

        <div style={{ padding: '20px 24px', background: V3.pageAlt, border: `1px solid ${V3.border}`, borderRadius: 12, fontSize: 13, color: V3.inkMid, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: V3.ink, marginBottom: 6, fontSize: 14 }}>How to evaluate</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Open A and ask: <em>can I read the whole receipt and see its match state at a glance, before touching anything?</em></li>
            <li>Open B and ask: <em>how fast can I get through a 20-item receipt where 18 are matched and 2 need attention?</em></li>
            <li>Open C and ask: <em>can I scan 20 items and spot the 2 uncertain ones without reading every row?</em></li>
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

      {option.improvements.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#22c55e', marginBottom: 6 }}>
              Improvements over current
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: V3.inkMid, lineHeight: 1.55 }}>
              {option.improvements.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
            </ul>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f59e0b', marginBottom: 6 }}>
              Trade-offs
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: V3.inkMid, lineHeight: 1.55 }}>
              {option.tradeoffs.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
            </ul>
          </div>
        </div>
      )}

      {option.improvements.length === 0 && option.tradeoffs.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f59e0b', marginBottom: 6 }}>
            Notes
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: V3.inkMid, lineHeight: 1.55 }}>
            {option.tradeoffs.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
          </ul>
        </div>
      )}

      <div style={{ fontSize: 12, color: V3.inkLight, marginBottom: 14, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 700, color: V3.inkMid }}>Best for: </span>
        {option.bestFor}
      </div>

      <div style={{ display: 'inline-block', background: V3.ink, color: V3.page, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
        View this design →
      </div>
    </Link>
  );
}
