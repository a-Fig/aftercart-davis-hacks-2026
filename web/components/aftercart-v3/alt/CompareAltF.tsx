'use client';

/**
 * Alt F — Substitution Diff.
 *
 * Design thesis: A diff is the right metaphor for "what would change." Per
 * item, render a tight grid of chain cells. Each cell shows the SUBSTITUTION,
 * not just the price — a colored badge for the kind of change (DIFF BRAND,
 * BULK PACK, ORGANIC, NOT STOCKED) so the trade is legible at a glance. Other
 * stocked options collapse into mini-chips beneath the primary swap so the
 * full shelf is one tap away without dominating the screen.
 *
 * Best when the user wants to compare what would change at multiple chains
 * for the same item — e.g. "I'd rather buy a different brand than a bigger
 * pack." Side-by-side diff makes that decision immediate.
 */

import { useMemo, useState } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, type ChainOption, type ChainProjection } from '../projection';
import { classifyChange, CHANGE_LABELS, CHANGE_COLORS } from '@/app/v3/compare-alt/mock-data';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

export default function CompareAltF({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const items = useMemo(
    () => compareResp.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.item_type !== 'skip'),
    [compareResp.items],
  );

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: V3.ink }}>
            What would change at each store
          </h1>
          <p style={{ fontSize: 14, color: V3.inkMid, margin: '6px 0 0', lineHeight: 1.5 }}>
            One row per item. Each cell shows the substitution that store would force on you — different brand, different size, different pack — and the price impact. Tap any cell to see the rest of that store's shelf.
          </p>
        </div>

        {/* Legend */}
        <Legend />

        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `minmax(200px, 1.4fr) repeat(${chains.length}, minmax(220px, 1fr))`,
          gap: 8,
          marginTop: 16,
          marginBottom: 6,
          padding: '0 4px',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: V3.inkLight,
        }}>
          <div>Your purchase</div>
          {chains.map((c) => (
            <div key={c.chain_id} style={{ fontSize: 11, color: V3.inkMid }}>
              {c.chain_name}
              <span style={{ color: V3.inkLight, marginLeft: 6, fontWeight: 500 }}>{c.distance_miles.toFixed(1)} mi</span>
            </div>
          ))}
        </div>

        {/* Item rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(({ item, idx }) => (
            <ItemRow key={idx} item={item} idx={idx} chains={chains} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const kinds: Array<keyof typeof CHANGE_COLORS> = ['same_brand', 'store_brand', 'different_brand', 'organic', 'larger_pack', 'different_form'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px', background: V3.pageAlt, borderRadius: 10, border: `1px solid ${V3.border}` }}>
      <span style={{ fontSize: 11, color: V3.inkLight, fontWeight: 600, marginRight: 4, alignSelf: 'center' }}>What changes:</span>
      {kinds.map((k) => (
        <span key={k} style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '2px 8px',
          borderRadius: 4,
          color: CHANGE_COLORS[k].fg,
          background: CHANGE_COLORS[k].bg,
        }}>
          {CHANGE_LABELS[k]}
        </span>
      ))}
      <span style={{ fontSize: 11, color: V3.inkLight, alignSelf: 'center', marginLeft: 8 }}>
        · gray cell = not stocked
      </span>
    </div>
  );
}

function ItemRow({ item, idx, chains }: { item: ApiItem; idx: number; chains: ChainProjection[] }) {
  const userName = item.match?.name ?? item.description;
  const userBrand = item.match?.brand;
  const userSize = item.match?.package_size != null && item.match?.package_unit
    ? `${item.match.package_size} ${item.match.package_unit}`
    : item.quantity != null && item.unit && item.unit !== 'each'
      ? `${item.quantity} ${item.unit}`
      : '—';
  const unmatched = !item.match;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `minmax(200px, 1.4fr) repeat(${chains.length}, minmax(220px, 1fr))`,
      gap: 8,
      alignItems: 'stretch',
    }}>
      {/* Anchor cell: user's purchase */}
      <div style={{
        background: V3.chrome,
        border: `1px solid ${V3.border}`,
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: V3.ink, lineHeight: 1.25 }}>
            {userName}
          </div>
          {userBrand && (
            <div style={{ fontSize: 11, color: V3.inkMid, marginTop: 2 }}>
              {userBrand}
            </div>
          )}
          <div style={{ fontSize: 10, color: V3.inkLight, marginTop: 4 }}>
            {userSize}
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800, color: V3.ink, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(item.member_price)}
        </div>
      </div>

      {unmatched ? (
        <>
          {chains.map((c) => (
            <div key={c.chain_id} style={{
              background: V3.pageAlt,
              border: `1px dashed ${V3.border}`,
              borderRadius: 10,
              padding: '12px 14px',
              fontSize: 11,
              color: V3.inkLight,
              fontStyle: 'italic',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              No match attempted
            </div>
          ))}
        </>
      ) : (
        chains.map((chain) => {
          const opts = chain.options_by_line.get(idx) ?? [];
          return <ChainCell key={chain.chain_id} opts={opts} chain={chain} userPrice={item.member_price} />;
        })
      )}
    </div>
  );
}

function ChainCell({ opts, chain, userPrice }: { opts: ChainOption[]; chain: ChainProjection; userPrice: number }) {
  const [expanded, setExpanded] = useState(false);

  if (opts.length === 0) {
    return (
      <div style={{
        background: V3.pageAlt,
        border: `1px solid ${V3.border}`,
        borderRadius: 10,
        padding: '12px 14px',
        opacity: 0.7,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: V3.inkLight, textTransform: 'uppercase' }}>
          Not stocked
        </div>
        <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 4, lineHeight: 1.4 }}>
          {chain.chain_name} doesn't carry anything matching this.
        </div>
      </div>
    );
  }

  const top = opts[0];
  const rest = opts.slice(1);

  return (
    <div style={{
      background: V3.pageAlt,
      border: `1px solid ${V3.border}`,
      borderRadius: 10,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <OptCell opt={top} userPrice={userPrice} primary />
      {rest.length > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: 'transparent',
            border: `1px dashed ${V3.border}`,
            color: V3.inkMid,
            borderRadius: 8,
            padding: '6px 8px',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'center',
          }}
        >
          + {rest.length} OTHER OPTION{rest.length > 1 ? 'S' : ''} ON SHELF
        </button>
      )}
      {expanded && rest.map((opt) => (
        <OptCell key={opt.canonical_id} opt={opt} userPrice={userPrice} primary={false} />
      ))}
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: V3.inkLight,
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: 0,
          }}
        >
          collapse
        </button>
      )}
    </div>
  );
}

function OptCell({ opt, userPrice, primary }: { opt: ChainOption; userPrice: number; primary: boolean }) {
  const total = effectiveTotal(opt, false);
  const displayTotal = total ?? opt.shelf;
  const savings = total != null ? userPrice - total : null;
  const cheaper = savings != null && savings > 0.05;
  const more = savings != null && savings < -0.05;
  const change = classifyChange(opt.equiv_note, opt.match_type === 'exact');
  const badgeColor = CHANGE_COLORS[change];
  const badgeLabel = CHANGE_LABELS[change];

  return (
    <div style={{
      borderLeft: primary ? `3px solid ${badgeColor.fg}` : `2px solid ${V3.border}`,
      paddingLeft: primary ? 10 : 8,
      paddingTop: 2,
      paddingBottom: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '1px 6px',
          borderRadius: 4,
          color: badgeColor.fg,
          background: badgeColor.bg,
          flexShrink: 0,
        }}>
          {badgeLabel}
        </span>
        {opt.match_type === 'exact' && (
          <span style={{ fontSize: 9, color: V3.inkLight, fontStyle: 'italic' }}>exact</span>
        )}
      </div>
      <div style={{
        fontSize: primary ? 13 : 12,
        fontWeight: primary ? 700 : 500,
        color: V3.ink,
        lineHeight: 1.3,
        marginBottom: 2,
      }}>
        {opt.display_name}
      </div>
      {opt.equiv_note && (
        <div style={{ fontSize: 10, color: V3.inkLight, lineHeight: 1.4, marginBottom: 4 }}>
          {opt.equiv_note}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
        <span style={{ fontSize: primary ? 16 : 13, fontWeight: 800, color: cheaper ? '#22c55e' : V3.ink, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(displayTotal)}
        </span>
        {savings != null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: cheaper ? '#22c55e' : more ? '#ef4444' : V3.inkLight }}>
            {cheaper ? `↓ ${fmtAbs(savings)}` : more ? `↑ ${fmtAbs(savings)}` : 'same'}
          </span>
        )}
      </div>
    </div>
  );
}

const topBtn: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${V3.border}`,
  color: V3.inkMid,
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
