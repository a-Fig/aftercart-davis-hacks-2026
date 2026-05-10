'use client';

/**
 * Alt N — Optimized Basket (option C; per-row chain pinning).
 *
 * Each row is pinned to its own chain. The picker drawer shows every chain's
 * options grouped by chain section, so users can compare cross-chain in one
 * glance and pin the row to whichever chain they prefer. Hero shows "your
 * optimized trip across N stores" — the total if you went to the
 * cheapest-per-item across all available chains.
 *
 * Models how shoppers actually think: "I'll Costco the meat, TJ the dairy,
 * GO the produce." No global chain tabs at the page level — the hero is the
 * verdict, and each row's pinned chain is shown in its right column.
 */

import { useMemo, useState, useEffect } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, type ChainOption, type ChainProjection } from '../projection';
import { classifyChange, CHANGE_LABELS, CHANGE_COLORS } from '@/app/v3/compare-alt/mock-data';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

const CATEGORY_BY_CANONICAL: Record<number, string> = {
  17: 'Meat & Seafood', 18: 'Meat & Seafood',
  12: 'Dairy', 53: 'Dairy', 64: 'Dairy',
  91: 'Produce', 42: 'Produce',
  73: 'Bread & Bakery',
};
const CATEGORY_ICON: Record<string, string> = {
  'Meat & Seafood': '🥩', 'Dairy': '🥛', 'Produce': '🥦', 'Bread & Bakery': '🍞', 'Other': '🧴',
};

const CHAIN_PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444'];

type RowPin =
  | { kind: 'auto' }
  | { kind: 'pin'; chain_id: number; canonical_id: number }
  | { kind: 'skip' };

interface Resolved {
  chain: ChainProjection;
  opt: ChainOption;
  total: number;
}

interface RowVerdict {
  item: ApiItem;
  idx: number;
  category: string;
  unmatched: boolean;
}

function buildVerdicts(compareResp: CompareResponse): RowVerdict[] {
  return compareResp.items
    .map((item, idx): RowVerdict | null => {
      if (item.item_type === 'skip') return null;
      const cat = item.match?.canonical_id != null
        ? (CATEGORY_BY_CANONICAL[item.match.canonical_id] ?? 'Other')
        : 'Other';
      return { item, idx, category: cat, unmatched: !item.match };
    })
    .filter((v): v is RowVerdict => v !== null);
}

function cheapestAcross(chains: ChainProjection[], row_idx: number): Resolved | null {
  let best: Resolved | null = null;
  for (const chain of chains) {
    const opts = chain.options_by_line.get(row_idx) ?? [];
    for (const opt of opts) {
      const t = effectiveTotal(opt, false);
      if (t == null) continue;
      if (best == null || t < best.total) best = { chain, opt, total: t };
    }
  }
  return best;
}

function resolveRow(chains: ChainProjection[], row_idx: number, pin: RowPin): Resolved | 'skip' | null {
  if (pin.kind === 'skip') return 'skip';
  if (pin.kind === 'pin') {
    for (const chain of chains) {
      if (chain.chain_id !== pin.chain_id) continue;
      const opts = chain.options_by_line.get(row_idx) ?? [];
      const opt = opts.find((o) => o.canonical_id === pin.canonical_id);
      if (opt) {
        const t = effectiveTotal(opt, false);
        if (t == null) return null;
        return { chain, opt, total: t };
      }
    }
    return null;
  }
  return cheapestAcross(chains, row_idx);
}

function userQtyLabel(item: ApiItem): string {
  if (item.quantity != null && item.unit && item.unit !== 'each') return `${item.quantity} ${item.unit}`;
  if (item.match?.package_size != null && item.match?.package_unit) return `${item.match.package_size} ${item.match.package_unit}`;
  if (item.quantity != null && item.quantity !== 1) return `${item.quantity}×`;
  return '1 each';
}

function altPackLabel(opt: ChainOption): string {
  if (opt.pack_size != null && opt.pack_unit) return `${opt.pack_size} ${opt.pack_unit}`;
  return '—';
}

export default function CompareAltN({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const verdicts = useMemo(() => buildVerdicts(compareResp), [compareResp]);

  // Stable per-chain color assignment.
  const chainColor = useMemo(() => {
    const m = new Map<number, string>();
    chains.forEach((c, i) => m.set(c.chain_id, CHAIN_PALETTE[i % CHAIN_PALETTE.length]));
    return m;
  }, [chains]);

  const [pins, setPins] = useState<Map<number, RowPin>>(new Map());
  const setPin = (row_idx: number, p: RowPin) => {
    setPins((prev) => {
      const m = new Map(prev);
      m.set(row_idx, p);
      return m;
    });
  };

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const resolutions = useMemo(() => {
    const m = new Map<number, Resolved | 'skip' | null>();
    for (const v of verdicts) {
      m.set(v.idx, resolveRow(chains, v.idx, pins.get(v.idx) ?? { kind: 'auto' }));
    }
    return m;
  }, [chains, verdicts, pins]);

  const summary = useMemo(() => {
    let total = 0;
    let userPaidSubset = 0;
    let chosenCount = 0;
    let skippedCount = 0;
    let unavailableCount = 0;
    let manualCount = 0;
    const chainCounts = new Map<number, { name: string; count: number }>();

    for (const v of verdicts) {
      const r = resolutions.get(v.idx);
      if (r === 'skip') { skippedCount++; continue; }
      if (r == null) { unavailableCount++; continue; }
      total += r.total;
      userPaidSubset += v.item.member_price;
      chosenCount++;
      const c = chainCounts.get(r.chain.chain_id);
      if (c) c.count++;
      else chainCounts.set(r.chain.chain_id, { name: r.chain.chain_name, count: 1 });

      const pin = pins.get(v.idx);
      if (pin?.kind === 'pin') {
        const cheapest = cheapestAcross(chains, v.idx);
        if (cheapest && (cheapest.chain.chain_id !== pin.chain_id || cheapest.opt.canonical_id !== pin.canonical_id)) {
          manualCount++;
        }
      }
    }

    return {
      total,
      userPaidSubset,
      savings: userPaidSubset - total,
      chosenCount,
      skippedCount,
      unavailableCount,
      manualCount,
      chainCounts: Array.from(chainCounts.entries())
        .map(([id, v]) => ({ chain_id: id, ...v }))
        .sort((a, b) => b.count - a.count),
    };
  }, [verdicts, resolutions, pins, chains]);

  const grouped = useMemo(() => {
    const buckets: Record<string, RowVerdict[]> = {};
    const order: string[] = [];
    for (const v of verdicts) {
      if (!buckets[v.category]) { buckets[v.category] = []; order.push(v.category); }
      buckets[v.category].push(v);
    }
    return { buckets, order };
  }, [verdicts]);

  const userTotal = compareResp.items.reduce(
    (s, i) => i.item_type !== 'skip' ? s + i.member_price : s, 0);

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date}
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 60px' }}>
        {/* Optimized basket hero */}
        {summary.savings > 0.5 ? (
          <div style={{
            background: 'linear-gradient(135deg, #1f7a3a 0%, #2c9b4a 100%)',
            borderRadius: 16,
            padding: '28px 24px',
            color: '#fff',
            marginBottom: 16,
            boxShadow: '0 10px 40px -10px rgba(31,122,58,0.4)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Your optimized trip</span>
              {summary.manualCount > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                  background: 'rgba(255,255,255,0.22)', padding: '2px 7px',
                  borderRadius: 999, color: '#fff',
                }}>
                  ✏ YOUR PICKS
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(summary.total)}
              </div>
              <div style={{ fontSize: 14, opacity: 0.9 }}>
                across <strong>{summary.chainCounts.length}</strong> store{summary.chainCounts.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.5, marginBottom: 14 }}>
              ↓ <strong>{fmtAbs(summary.savings)}</strong> vs your <strong>{fmt(summary.userPaidSubset)}</strong> trip
              {' · '}
              <strong>{((summary.savings / Math.max(summary.userPaidSubset, 0.01)) * 100).toFixed(0)}% off</strong>
              {summary.skippedCount > 0 && ` · ${summary.skippedCount} skipped`}
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.22)', paddingTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 8 }}>
                Where you'd go
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {summary.chainCounts.map((c) => (
                  <div key={c.chain_id} style={{
                    background: 'rgba(255,255,255,0.16)',
                    borderRadius: 999,
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 999,
                      background: chainColor.get(c.chain_id) ?? '#fff',
                      boxShadow: '0 0 0 2px rgba(255,255,255,0.4)',
                    }} />
                    {c.name}
                    <span style={{ opacity: 0.85, fontWeight: 600 }}>· {c.count} item{c.count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{
            background: V3.pageAlt,
            border: `1px solid ${V3.borderHi}`,
            borderRadius: 16,
            padding: '24px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 8 }}>
              Looks like you got a fair deal
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
              No optimization saves much vs your trip
            </div>
            <div style={{ fontSize: 13, color: V3.inkMid }}>
              An optimized split-trip across {summary.chainCounts.length} store{summary.chainCounts.length !== 1 ? 's' : ''} comes to <strong>{fmt(summary.total)}</strong> — about the same as your <strong>{fmt(summary.userPaidSubset)}</strong>.
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 12, paddingLeft: 4 }}>
          Item-by-item · tap any row to compare every chain
        </div>

        {grouped.order.map((cat) => {
          const items = grouped.buckets[cat];
          if (items.every((v) => v.unmatched)) return null;
          const matchedItems = items.filter((v) => !v.unmatched);
          return (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: V3.ink, marginBottom: 8, paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{CATEGORY_ICON[cat] ?? '•'}</span>
                <span>{cat}</span>
              </div>
              <div style={{ background: V3.pageAlt, borderRadius: 12, border: `1px solid ${V3.border}`, overflow: 'hidden' }}>
                {matchedItems.map((v, i) => {
                  const isLast = i === matchedItems.length - 1;
                  const expanded = expandedIdx === v.idx;
                  return (
                    <BreakdownRow
                      key={v.idx}
                      v={v}
                      isLast={isLast}
                      chains={chains}
                      chainColor={chainColor}
                      pin={pins.get(v.idx) ?? { kind: 'auto' as const }}
                      resolved={resolutions.get(v.idx) ?? null}
                      onSetPin={(p) => setPin(v.idx, p)}
                      expanded={expanded}
                      onToggleExpand={() => setExpandedIdx(expanded ? null : v.idx)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {verdicts.some((v) => v.unmatched) && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: V3.inkMid, marginBottom: 8, paddingLeft: 4 }}>
              Couldn't compare
            </div>
            <div style={{ background: V3.pageAlt, borderRadius: 12, border: `1px dashed ${V3.border}`, padding: '12px 16px' }}>
              {verdicts.filter((v) => v.unmatched).map((v) => (
                <div key={v.idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
                  <span style={{ color: V3.inkMid }}>{v.item.description}</span>
                  <span style={{ color: V3.inkLight, fontVariantNumeric: 'tabular-nums' }}>{fmt(v.item.member_price)}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 8, lineHeight: 1.5 }}>
                We couldn't confidently match these to nearby store prices. They're excluded from the optimization above.
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 24, padding: '16px', background: V3.pageAlt, border: `1px solid ${V3.border}`, borderRadius: 12, fontSize: 13, color: V3.inkMid, display: 'flex', justifyContent: 'space-between' }}>
          <span>Your trip ({compareResp.receipt.store_name})</span>
          <span style={{ fontWeight: 700, color: V3.ink, fontVariantNumeric: 'tabular-nums' }}>{fmt(userTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({
  v, isLast, chains, chainColor, pin, resolved, onSetPin, expanded, onToggleExpand,
}: {
  v: RowVerdict;
  isLast: boolean;
  chains: ChainProjection[];
  chainColor: Map<number, string>;
  pin: RowPin;
  resolved: Resolved | 'skip' | null;
  onSetPin: (p: RowPin) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const skipped = pin.kind === 'skip';
  const cheapest = cheapestAcross(chains, v.idx);
  const isCheapest = pin.kind !== 'pin' || (
    cheapest != null
    && pin.chain_id === cheapest.chain.chain_id
    && pin.canonical_id === cheapest.opt.canonical_id
  );
  const manualPick = pin.kind === 'pin' && !isCheapest;

  let altPrice: number | null = null;
  let savings: number | null = null;
  if (resolved && resolved !== 'skip') {
    altPrice = resolved.total;
    savings = v.item.member_price - resolved.total;
  }
  const cheaper = (savings ?? 0) > 0.05;

  const change = resolved && resolved !== 'skip'
    ? classifyChange(resolved.opt.equiv_note, resolved.opt.match_type === 'exact')
    : null;
  const badgeLabel = change ? CHANGE_LABELS[change] : null;
  const badgeColor = change ? CHANGE_COLORS[change] : null;
  const showChangeBadge = change != null && change !== 'same_brand';

  const dotColor = resolved && resolved !== 'skip'
    ? chainColor.get(resolved.chain.chain_id) ?? '#22c55e'
    : V3.inkLight;

  return (
    <div style={{ borderBottom: isLast ? 'none' : `1px solid ${V3.border}` }}>
      <button
        onClick={onToggleExpand}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 14px',
          gap: 14,
          alignItems: 'flex-start',
          padding: '14px 14px 14px 11px',
          width: '100%',
          background: expanded ? 'rgba(74,222,128,0.04)' : 'transparent',
          border: 'none',
          borderLeft: `3px solid ${expanded ? '#22c55e' : 'transparent'}`,
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={labelStyle}>You paid</div>
          <div style={bigPriceStyle}>{fmt(v.item.member_price)}</div>
          <div style={nameStyle}>{v.item.match?.name ?? v.item.description}</div>
          <div style={metaStyle}>{userQtyLabel(v.item)}</div>
        </div>

        <div style={{
          minWidth: 0,
          borderLeft: `1px dashed ${V3.border}`,
          paddingLeft: 14,
          opacity: skipped ? 0.55 : 1,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, marginBottom: 4, minHeight: 14 }}>
            <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 0 }}>
              {resolved && resolved !== 'skip' && (
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: 999,
                  background: dotColor,
                }} />
              )}
              <span>
                {resolved === 'skip' ? "Skipped here" :
                 resolved == null ? 'Not stocked nearby' :
                 `At ${resolved.chain.chain_name} · ${resolved.chain.distance_miles.toFixed(1)} mi`}
              </span>
            </div>
            {isCheapest && resolved && resolved !== 'skip' && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                color: '#22c55e', background: 'rgba(34,197,94,0.18)',
                padding: '1px 6px', borderRadius: 4,
              }}>
                ★ CHEAPEST
              </span>
            )}
            {manualPick && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                color: '#3b82f6', background: 'rgba(59,130,246,0.15)',
                padding: '1px 6px', borderRadius: 4,
              }}>
                ✏ MANUAL
              </span>
            )}
            {skipped && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                color: '#f59e0b', background: 'rgba(245,158,11,0.15)',
                padding: '1px 6px', borderRadius: 4,
              }}>
                ✓ SKIPPED
              </span>
            )}
          </div>

          {resolved && resolved !== 'skip' && altPrice != null ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ ...bigPriceStyle, color: cheaper ? '#22c55e' : V3.ink }}>
                  {fmt(altPrice)}
                </span>
                {savings != null && Math.abs(savings) > 0.05 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: cheaper ? '#4ade80' : '#ef4444', letterSpacing: '0.04em',
                  }}>
                    {cheaper ? `↓ ${fmtAbs(savings)}` : `↑ ${fmtAbs(savings)}`}
                  </span>
                )}
              </div>
              <div style={nameStyle}>{resolved.opt.display_name}</div>
              <div style={{ ...metaStyle, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{altPackLabel(resolved.opt)}</span>
                {showChangeBadge && badgeColor && badgeLabel && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                    padding: '1px 5px', borderRadius: 3,
                    color: badgeColor.fg, background: badgeColor.bg,
                  }}>
                    {badgeLabel}
                  </span>
                )}
              </div>
            </>
          ) : resolved === 'skip' ? (
            <div style={{ marginTop: 6, fontSize: 12, color: '#f59e0b', fontStyle: 'italic', lineHeight: 1.4 }}>
              You'd pass on this one anywhere.
            </div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 12, color: V3.inkLight, fontStyle: 'italic', lineHeight: 1.4 }}>
              No nearby store stocks this.
            </div>
          )}
        </div>

        <div style={{
          fontSize: 16, color: V3.inkLight, alignSelf: 'center',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
          width: 14, textAlign: 'center',
        }}>
          ›
        </div>
      </button>

      {expanded && (
        <MultiChainPicker
          v={v}
          chains={chains}
          chainColor={chainColor}
          pin={pin}
          resolved={resolved}
          onSetPin={onSetPin}
        />
      )}
    </div>
  );
}

function MultiChainPicker({
  v, chains, chainColor, pin, resolved, onSetPin,
}: {
  v: RowVerdict;
  chains: ChainProjection[];
  chainColor: Map<number, string>;
  pin: RowPin;
  resolved: Resolved | 'skip' | null;
  onSetPin: (p: RowPin) => void;
}) {
  const skipped = pin.kind === 'skip';
  const cheapest = cheapestAcross(chains, v.idx);
  const stockedChains = chains.filter((c) => (c.options_by_line.get(v.idx) ?? []).length > 0);
  const unstockedChains = chains.filter((c) => (c.options_by_line.get(v.idx) ?? []).length === 0);
  const manualPick = pin.kind === 'pin'
    && cheapest != null
    && (pin.chain_id !== cheapest.chain.chain_id || pin.canonical_id !== cheapest.opt.canonical_id);

  return (
    <div style={{
      padding: '4px 14px 14px 14px',
      borderTop: `1px dashed ${V3.border}`,
      background: 'rgba(74,222,128,0.03)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: V3.inkLight, padding: '10px 0 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>Where you'd buy {v.item.match?.name ?? 'this'}</span>
        {(manualPick || skipped) && (
          <button
            onClick={() => onSetPin({ kind: 'auto' })}
            style={{
              background: 'transparent',
              border: `1px solid ${V3.border}`,
              color: V3.inkMid,
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            ↺ AUTO-CHEAPEST
          </button>
        )}
      </div>

      {stockedChains.length === 0 ? (
        <div style={{
          padding: '12px 14px',
          background: V3.chrome,
          border: `1px dashed ${V3.border}`,
          borderRadius: 8,
          fontSize: 12,
          color: V3.inkLight,
          lineHeight: 1.5,
        }}>
          No nearby chain stocks anything matching this item.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {stockedChains.map((chain) => {
            const opts = chain.options_by_line.get(v.idx) ?? [];
            const isChainCheapest = cheapest != null && cheapest.chain.chain_id === chain.chain_id;
            return (
              <div key={chain.chain_id}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  color: V3.ink,
                  padding: '0 0 6px',
                  borderBottom: `1px solid ${V3.border}`,
                  marginBottom: 6,
                }}>
                  <span style={{
                    display: 'inline-block',
                    width: 10, height: 10, borderRadius: 999,
                    background: chainColor.get(chain.chain_id) ?? '#22c55e',
                  }} />
                  <span style={{ flex: 1 }}>
                    {chain.chain_name.toUpperCase()}
                    <span style={{ color: V3.inkLight, fontWeight: 600, marginLeft: 6 }}>
                      · {chain.distance_miles.toFixed(1)} mi
                    </span>
                  </span>
                  {isChainCheapest && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                      color: '#22c55e', background: 'rgba(34,197,94,0.18)',
                      padding: '1px 6px', borderRadius: 4,
                    }}>
                      ★ HAS CHEAPEST
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {opts.map((opt) => {
                    const isSelected = !skipped && (
                      pin.kind === 'pin'
                        ? pin.chain_id === chain.chain_id && pin.canonical_id === opt.canonical_id
                        : (cheapest != null && cheapest.chain.chain_id === chain.chain_id && cheapest.opt.canonical_id === opt.canonical_id)
                    );
                    return (
                      <OptionRadio
                        key={opt.canonical_id}
                        opt={opt}
                        userPrice={v.item.member_price}
                        selected={isSelected}
                        onSelect={() => onSetPin({ kind: 'pin', chain_id: chain.chain_id, canonical_id: opt.canonical_id })}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {unstockedChains.length > 0 && (
            <div style={{
              fontSize: 10, color: V3.inkLight, padding: '4px 0 0',
              fontStyle: 'italic', borderTop: `1px dashed ${V3.border}`, paddingTop: 8,
            }}>
              Not stocked at: {unstockedChains.map((c) => c.chain_name).join(', ')}
            </div>
          )}

          <button
            onClick={() => onSetPin(skipped ? { kind: 'auto' } : { kind: 'skip' })}
            style={{
              background: skipped ? 'rgba(245,158,11,0.15)' : 'transparent',
              border: `1px dashed ${skipped ? '#f59e0b' : V3.border}`,
              color: skipped ? '#f59e0b' : V3.inkMid,
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              marginTop: 4,
            }}
          >
            {skipped ? '✓ SKIPPED — would not buy anywhere · tap to undo' : "I wouldn't buy this anywhere"}
          </button>
        </div>
      )}
    </div>
  );
}

function OptionRadio({ opt, userPrice, selected, onSelect }: {
  opt: ChainOption;
  userPrice: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const total = effectiveTotal(opt, false);
  const displayTotal = total ?? opt.shelf;
  const savings = total != null ? userPrice - total : null;
  const cheaper = savings != null && savings > 0.05;
  const change = classifyChange(opt.equiv_note, opt.match_type === 'exact');
  const badgeColor = CHANGE_COLORS[change];
  const badgeLabel = CHANGE_LABELS[change];

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 12px',
        borderRadius: 10,
        background: selected ? 'rgba(74,222,128,0.10)' : V3.page,
        border: `1px solid ${selected ? 'rgba(74,222,128,0.55)' : V3.border}`,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        color: V3.ink,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: 999,
        border: `2px solid ${selected ? '#22c55e' : V3.border}`,
        background: selected ? '#22c55e' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
            padding: '1px 6px', borderRadius: 4,
            color: badgeColor.fg, background: badgeColor.bg,
          }}>
            {badgeLabel}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: V3.ink, lineHeight: 1.3, marginBottom: 2 }}>
          {opt.display_name}
        </div>
        {opt.equiv_note && (
          <div style={{ fontSize: 10, color: V3.inkLight, lineHeight: 1.4 }}>
            {opt.equiv_note}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: cheaper ? '#22c55e' : V3.ink }}>
          {fmt(displayTotal)}
        </div>
        {savings != null && Math.abs(savings) > 0.05 && (
          <div style={{ fontSize: 10, fontWeight: 700, color: cheaper ? '#22c55e' : '#ef4444' }}>
            {cheaper ? `↓ ${fmtAbs(savings)}` : `↑ ${fmtAbs(savings)}`}
          </div>
        )}
      </div>
    </button>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: V3.inkLight, marginBottom: 4,
};
const bigPriceStyle: React.CSSProperties = {
  fontSize: 22, fontWeight: 800, color: V3.ink,
  fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
  letterSpacing: '-0.01em',
};
const nameStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: V3.ink,
  lineHeight: 1.3, marginTop: 6,
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};
const metaStyle: React.CSSProperties = {
  fontSize: 11, color: V3.inkLight,
  marginTop: 2, fontVariantNumeric: 'tabular-nums',
};
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
