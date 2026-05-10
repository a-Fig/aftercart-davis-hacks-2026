'use client';

/**
 * Alt E — Shelf Browser.
 *
 * Design thesis: A grocery comparison isn't a math problem, it's a shopping
 * decision. The substitution at the alt store is *the most important
 * information* — what brand would you actually be buying? What sizes are
 * stocked? Is your favorite even there? Alt E surfaces the full shelf at each
 * chain per item: every option, badged with what's different (brand, size,
 * organic, bulk-pack-only), with the recommended swap starred but never
 * presented as "the answer."
 *
 * The point isn't to tell the user "switch to Grocery Outlet." It's to tell
 * them: "Here's what your basket looks like everywhere nearby. You decide."
 */

import { useMemo } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, effectivePrice, type ChainOption, type ChainProjection } from '../projection';
import { classifyChange, CHANGE_LABELS, CHANGE_COLORS } from '@/app/v3/compare-alt/mock-data';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

export default function CompareAltE({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);

  const items = useMemo(
    () => compareResp.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.item_type !== 'skip'),
    [compareResp.items],
  );

  // Aggregate cheapest-per-chain totals so the user has SOME bottom line.
  const chainTotals = useMemo(() => {
    return chains.map((chain) => {
      let total = 0;
      let userPaidSubset = 0;
      let covered = 0;
      let totalEligible = 0;
      for (const { item, idx } of items) {
        totalEligible += 1;
        const opts = chain.options_by_line.get(idx) ?? [];
        if (opts.length === 0) continue;
        const t = effectiveTotal(opts[0], false);
        if (t == null) continue;
        total += t;
        userPaidSubset += item.member_price;
        covered += 1;
      }
      return {
        chain_id: chain.chain_id,
        chain_name: chain.chain_name,
        distance: chain.distance_miles,
        total,
        userPaidSubset,
        savings: userPaidSubset - total,
        covered,
        totalEligible,
      };
    });
  }, [chains, items]);

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date}
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 20px 60px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: V3.ink }}>
            What's on each shelf
          </h1>
          <p style={{ fontSize: 14, color: V3.inkMid, margin: '6px 0 0', lineHeight: 1.5 }}>
            For every item you bought, here's what each nearby store actually stocks — every brand, size, and pack size we have data for. The cheapest option is starred, but it's not the only option.
          </p>
        </div>

        {/* Per-chain "if you switched everything" totals strip */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${chainTotals.length}, 1fr)`, gap: 8, marginBottom: 28 }}>
          {chainTotals.map((c) => {
            const cheaper = c.savings > 0.5;
            const more = c.savings < -0.5;
            return (
              <div key={c.chain_id} style={{
                background: cheaper ? 'rgba(74,222,128,0.06)' : V3.pageAlt,
                border: `1px solid ${cheaper ? 'rgba(74,222,128,0.3)' : V3.border}`,
                borderRadius: 10,
                padding: '10px 12px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: V3.inkMid }}>
                  {c.chain_name}
                </div>
                <div style={{ fontSize: 9, color: V3.inkLight, marginTop: 1 }}>
                  {c.distance.toFixed(1)} mi · {c.covered}/{c.totalEligible} priced
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: cheaper ? '#22c55e' : more ? '#ef4444' : V3.inkLight, marginTop: 6 }}>
                  {cheaper ? `↓ ${fmtAbs(c.savings)}` : more ? `↑ ${fmtAbs(c.savings)}` : 'no diff'}
                  <span style={{ color: V3.inkLight, fontWeight: 500, marginLeft: 4 }}>(if cheapest each)</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Per-item shelf cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {items.map(({ item, idx }) => (
            <ShelfCard key={idx} item={item} idx={idx} chains={chains} />
          ))}
        </div>

        <div style={{ marginTop: 24, padding: '14px 18px', background: V3.pageAlt, borderRadius: 12, fontSize: 12, color: V3.inkLight, lineHeight: 1.6 }}>
          <strong style={{ color: V3.inkMid }}>How to read this:</strong> each card is one item from your receipt. Each chain row inside shows what they actually stock that fills that role — same brand or different, same size or different. A swap is never silent here.
        </div>
      </div>
    </div>
  );
}

// ── Per-item shelf card ────────────────────────────────────────────────────

function ShelfCard({ item, idx, chains }: { item: ApiItem; idx: number; chains: ChainProjection[] }) {
  const userName = item.match?.name ?? item.description;
  const userBrand = item.match?.brand ?? null;
  const userSize = item.match?.package_size != null && item.match?.package_unit
    ? `${item.match.package_size} ${item.match.package_unit}`
    : item.quantity != null && item.unit && item.unit !== 'each'
      ? `${item.quantity} ${item.unit}`
      : '';
  const unmatched = !item.match;

  return (
    <div style={{
      background: V3.pageAlt,
      border: `1px solid ${V3.border}`,
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {/* User's purchase header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        background: V3.chrome,
        borderBottom: `1px solid ${V3.border}`,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: V3.inkLight, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
            You bought
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: V3.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userBrand ? `${userBrand} · ` : ''}{userName}
          </div>
          {userSize && (
            <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 1 }}>
              {userSize}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: V3.ink, fontVariantNumeric: 'tabular-nums' }}>
            {fmt(item.member_price)}
          </div>
        </div>
      </div>

      {unmatched ? (
        <div style={{ padding: '20px 18px', fontSize: 13, color: V3.inkLight, fontStyle: 'italic' }}>
          We couldn't match this to a canonical product, so no nearby comparisons were attempted.
        </div>
      ) : (
        <div>
          {chains.map((chain) => (
            <ChainShelfRow key={chain.chain_id} chain={chain} idx={idx} userPrice={item.member_price} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChainShelfRow({ chain, idx, userPrice }: { chain: ChainProjection; idx: number; userPrice: number }) {
  const opts = chain.options_by_line.get(idx) ?? [];
  // The "auto-pick" — projection sorts by cheapest first, but we'll mark exact-brand
  // matches as the recommendation when present (saves the user from accidentally
  // optimizing $0.50 by switching brands they don't want).
  const cheapestIdx = 0;

  return (
    <div style={{
      borderBottom: `1px solid ${V3.border}`,
      padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: V3.ink }}>{chain.chain_name}</span>
          <span style={{ fontSize: 11, color: V3.inkLight, marginLeft: 8 }}>{chain.distance_miles.toFixed(1)} mi</span>
        </div>
        {opts.length === 0 ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: V3.inkLight, padding: '2px 8px', background: V3.pageAlt, borderRadius: 999, border: `1px solid ${V3.border}` }}>
            NOT STOCKED
          </span>
        ) : (
          <span style={{ fontSize: 11, color: V3.inkLight }}>
            {opts.length} option{opts.length > 1 ? 's' : ''} on the shelf
          </span>
        )}
      </div>

      {opts.length === 0 ? (
        <div style={{ fontSize: 12, color: V3.inkLight, fontStyle: 'italic', paddingLeft: 4 }}>
          {chain.chain_name} doesn't stock anything matching this item — you'd need to skip it or buy it elsewhere.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {opts.map((opt, i) => (
            <ShelfOption
              key={opt.canonical_id}
              opt={opt}
              isRecommended={i === cheapestIdx}
              userPrice={userPrice}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShelfOption({ opt, isRecommended, userPrice }: { opt: ChainOption; isRecommended: boolean; userPrice: number }) {
  const total = effectiveTotal(opt, false) ?? opt.shelf;
  const perUnit = opt.shelf;
  const savings = userPrice - (effectiveTotal(opt, false) ?? userPrice);
  const cheaper = savings > 0.05;
  const change = classifyChange(opt.equiv_note, opt.match_type === 'exact');
  const badgeColor = CHANGE_COLORS[change];
  const badgeLabel = CHANGE_LABELS[change];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '20px 1fr auto',
      gap: 10,
      alignItems: 'center',
      padding: '8px 10px',
      borderRadius: 8,
      background: isRecommended ? 'rgba(74,222,128,0.06)' : 'transparent',
      border: `1px solid ${isRecommended ? 'rgba(74,222,128,0.3)' : 'transparent'}`,
    }}>
      <div style={{ fontSize: 13, color: isRecommended ? '#22c55e' : V3.inkFaint, textAlign: 'center' }}>
        {isRecommended ? '⭐' : '•'}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: V3.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opt.display_name}
          </span>
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
        </div>
        {opt.equiv_note && (
          <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 2, lineHeight: 1.35 }}>
            {opt.equiv_note}
          </div>
        )}
        <div style={{ fontSize: 10, color: V3.inkFaint, marginTop: 3, display: 'flex', gap: 8 }}>
          <span>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: opt.freshness === 'green' ? '#22c55e' : opt.freshness === 'yellow' ? '#f59e0b' : '#ef4444', marginRight: 4, verticalAlign: 'middle' }} />
            {opt.observations} obs
          </span>
          {opt.match_type === 'equivalent' && opt.equivalence_strength && (
            <span>match {(opt.equivalence_strength * 100).toFixed(0)}%</span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: cheaper ? '#22c55e' : V3.ink }}>
          {fmt(total)}
        </div>
        {cheaper && (
          <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>
            ↓ {fmtAbs(savings)}
          </div>
        )}
        {savings < -0.05 && (
          <div style={{ fontSize: 10, color: V3.inkLight, fontWeight: 600 }}>
            ↑ {fmtAbs(savings)}
          </div>
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
