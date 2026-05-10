'use client';

/**
 * Alt O — Quick Peek (option D, productized for touch).
 *
 * Same hero / tabs / picker drawer as M. Each row gains a small "compare"
 * pill on the right edge. Tapping it opens a tight inline peek popover
 * showing every nearby chain's best price for that item — substitute name,
 * price, change badge, and a ★ on the cheapest. Dismisses on outside click
 * or Escape. The peek doesn't commit to a pick — it's pure read-only
 * scanning, lighter-weight than expanding the full picker drawer.
 *
 * Original D was hover/long-press, but those die on touch and have low
 * discoverability. A visible affordance (the "compare" pill) makes the
 * peek work the same on mobile and desktop.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
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

type PickState =
  | { kind: 'auto' }
  | { kind: 'pick'; canonical_id: number }
  | { kind: 'skip' };

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

const pickKey = (chain_id: number, row_idx: number) => `${chain_id}:${row_idx}`;

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

interface PerChainBest {
  chain: ChainProjection;
  opt: ChainOption | null;
  total: number | null;
}

function bestPerChain(chains: ChainProjection[], row_idx: number): PerChainBest[] {
  return chains.map((chain) => {
    const opts = chain.options_by_line.get(row_idx) ?? [];
    let best: { opt: ChainOption; total: number } | null = null;
    for (const opt of opts) {
      const t = effectiveTotal(opt, false);
      if (t == null) continue;
      if (best == null || t < best.total) best = { opt, total: t };
    }
    return { chain, opt: best?.opt ?? null, total: best?.total ?? null };
  });
}

export default function CompareAltO({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const verdicts = useMemo(() => buildVerdicts(compareResp), [compareResp]);

  const [selectedChainId, setSelectedChainId] = useState<number | null>(chains[0]?.chain_id ?? null);
  const selectedChain = chains.find((c) => c.chain_id === selectedChainId) ?? null;

  const [picks, setPicks] = useState<Map<string, PickState>>(new Map());
  const setPick = useCallback((chain_id: number, row_idx: number, p: PickState) => {
    setPicks((prev) => {
      const m = new Map(prev);
      m.set(pickKey(chain_id, row_idx), p);
      return m;
    });
  }, []);

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  useEffect(() => { setExpandedIdx(null); }, [selectedChainId]);

  // Quick-peek state — separate from the full picker drawer.
  const [peekIdx, setPeekIdx] = useState<number | null>(null);
  // Close peek on Escape and on outside click.
  useEffect(() => {
    if (peekIdx == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPeekIdx(null);
    }
    function onClick(e: MouseEvent) {
      const tgt = e.target as HTMLElement;
      if (!tgt.closest('[data-peek-shell]') && !tgt.closest('[data-peek-trigger]')) {
        setPeekIdx(null);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [peekIdx]);
  // Close peek on chain switch.
  useEffect(() => { setPeekIdx(null); }, [selectedChainId]);

  const resolveChosenOpt = useCallback((chain: ChainProjection, row_idx: number): ChainOption | 'skip' | null => {
    const opts = chain.options_by_line.get(row_idx) ?? [];
    if (opts.length === 0) return null;
    const p = picks.get(pickKey(chain.chain_id, row_idx)) ?? { kind: 'auto' as const };
    if (p.kind === 'skip') return 'skip';
    if (p.kind === 'pick') {
      const found = opts.find((o) => o.canonical_id === p.canonical_id);
      if (found) return found;
    }
    return opts[0];
  }, [picks]);

  const chainSummaries = useMemo(() => {
    let totalEligible = 0;
    for (const item of compareResp.items) {
      if (item.item_type !== 'skip') totalEligible += 1;
    }
    return chains.map((chain) => {
      let chainTotal = 0;
      let userPaidSubset = 0;
      let chosenCount = 0;
      let skippedCount = 0;
      let unavailableCount = 0;
      let manualCount = 0;
      compareResp.items.forEach((item, idx) => {
        if (item.item_type === 'skip') return;
        const opts = chain.options_by_line.get(idx) ?? [];
        if (opts.length === 0) {
          unavailableCount += 1;
          return;
        }
        const p = picks.get(pickKey(chain.chain_id, idx));
        if (p?.kind === 'pick' && p.canonical_id !== opts[0].canonical_id) manualCount += 1;
        const chosen = resolveChosenOpt(chain, idx);
        if (chosen === 'skip' || chosen == null) {
          skippedCount += 1;
          return;
        }
        const t = effectiveTotal(chosen, false);
        if (t == null) return;
        chainTotal += t;
        userPaidSubset += item.member_price;
        chosenCount += 1;
      });
      return {
        chain_id: chain.chain_id,
        chain_name: chain.chain_name,
        distance: chain.distance_miles,
        chainTotal,
        userPaidSubset,
        savings: userPaidSubset - chainTotal,
        chosenCount,
        skippedCount,
        unavailableCount,
        manualCount,
        totalEligible,
      };
    });
  }, [chains, compareResp, picks, resolveChosenOpt]);

  const selected = chainSummaries.find((s) => s.chain_id === selectedChainId) ?? chainSummaries[0];

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
        {selected && selected.savings > 0.5 && (
          <div style={{
            background: 'linear-gradient(135deg, #1f7a3a 0%, #2c9b4a 100%)',
            borderRadius: 16,
            padding: '28px 24px',
            color: '#fff',
            marginBottom: 16,
            boxShadow: '0 10px 40px -10px rgba(31,122,58,0.4)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>You could have paid less at</span>
              {selected.manualCount > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                  background: 'rgba(255,255,255,0.22)', padding: '2px 7px',
                  borderRadius: 999, color: '#fff',
                }}>
                  ✏ YOUR PICKS
                </span>
              )}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
              {selected.chain_name}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 18 }}>
              {selected.distance.toFixed(1)} mi away · {selected.chosenCount} of {selected.totalEligible} items priced
              {selected.manualCount > 0 && ` · ${selected.manualCount} personalized`}
              {selected.skippedCount > 0 && ` · ${selected.skippedCount} skipped`}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>You'd save</div>
                <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtAbs(selected.savings)}
                </div>
              </div>
              {selected.userPaidSubset > 0 && (
                <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.9, padding: '4px 10px', background: 'rgba(255,255,255,0.18)', borderRadius: 999 }}>
                  {((selected.savings / selected.userPaidSubset) * 100).toFixed(0)}% off
                </div>
              )}
            </div>
            <div style={{ marginTop: 18, fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
              Your <strong>{fmt(selected.userPaidSubset)}</strong> trip would cost <strong>{fmt(selected.chainTotal)}</strong> at {selected.chain_name}.
            </div>
          </div>
        )}

        {selected && selected.savings <= 0.5 && (
          <div style={{
            background: V3.pageAlt,
            border: `1px solid ${V3.borderHi}`,
            borderRadius: 16,
            padding: '24px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 8 }}>
              {selected.manualCount > 0 ? 'Looks like your picks come out about even' : 'Looks like you got a fair deal'}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
              {selected.chain_name} wouldn't be cheaper for what you'd buy
            </div>
            <div style={{ fontSize: 13, color: V3.inkMid }}>
              With your picks, your basket at {selected.chain_name} comes to <strong>{fmt(selected.chainTotal)}</strong> — about the same as your trip.
            </div>
          </div>
        )}

        {chainSummaries.length > 1 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 8, paddingLeft: 4 }}>
              Other nearby stores
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${chainSummaries.length}, 1fr)`, gap: 8 }}>
              {chainSummaries.map((s) => {
                const active = s.chain_id === selected?.chain_id;
                const cheap = s.savings > 0.5;
                return (
                  <button
                    key={s.chain_id}
                    onClick={() => setSelectedChainId(s.chain_id)}
                    style={{
                      background: active ? V3.pageAlt : 'transparent',
                      border: `1px solid ${active ? V3.borderHi : V3.border}`,
                      borderRadius: 12,
                      padding: '12px 10px',
                      cursor: 'pointer',
                      color: V3.ink,
                      fontFamily: 'inherit',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.chain_name}</span>
                    <span style={{ fontSize: 10, color: V3.inkLight }}>{s.distance.toFixed(1)} mi</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: cheap ? '#4ade80' : V3.inkMid, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {cheap ? `↓ ${fmtAbs(s.savings)}` : 'No savings'}
                    </span>
                    {s.manualCount > 0 && (
                      <span style={{
                        position: 'absolute', top: 6, right: 6,
                        background: '#3b82f6', color: '#fff',
                        fontSize: 9, fontWeight: 800,
                        borderRadius: 999, padding: '1px 6px',
                        letterSpacing: '0.05em',
                      }}>
                        ✏ {s.manualCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 12, paddingLeft: 4 }}>
          Your basket vs {selected?.chain_name ?? 'this chain'} · tap "compare" for cross-chain prices
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
                      activeChain={selectedChain}
                      pick={selectedChain ? (picks.get(pickKey(selectedChain.chain_id, v.idx)) ?? { kind: 'auto' as const }) : { kind: 'auto' as const }}
                      onSetPick={(p) => selectedChain && setPick(selectedChain.chain_id, v.idx, p)}
                      expanded={expanded}
                      onToggleExpand={() => setExpandedIdx(expanded ? null : v.idx)}
                      peekOpen={peekIdx === v.idx}
                      onTogglePeek={() => setPeekIdx(peekIdx === v.idx ? null : v.idx)}
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
                We couldn't confidently match these to nearby store prices. They're excluded from the savings number above.
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
  v, isLast, chains, activeChain, pick, onSetPick, expanded, onToggleExpand, peekOpen, onTogglePeek,
}: {
  v: RowVerdict;
  isLast: boolean;
  chains: ChainProjection[];
  activeChain: ChainProjection | null;
  pick: PickState;
  onSetPick: (p: PickState) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  peekOpen: boolean;
  onTogglePeek: () => void;
}) {
  const opts = activeChain?.options_by_line.get(v.idx) ?? [];
  const skipped = pick.kind === 'skip';
  const manualPick = pick.kind === 'pick' && opts.length > 0 && pick.canonical_id !== opts[0].canonical_id;

  let display: { kind: 'opt'; opt: ChainOption } | { kind: 'skip' } | { kind: 'none' };
  if (skipped) display = { kind: 'skip' };
  else if (opts.length === 0) display = { kind: 'none' };
  else if (pick.kind === 'pick') {
    const found = opts.find((o) => o.canonical_id === pick.canonical_id);
    display = { kind: 'opt', opt: found ?? opts[0] };
  } else display = { kind: 'opt', opt: opts[0] };

  let altPrice: number | null = null;
  let savings: number | null = null;
  if (display.kind === 'opt') {
    const t = effectiveTotal(display.opt, false);
    if (t != null) {
      altPrice = t;
      savings = v.item.member_price - t;
    }
  }
  const cheaper = (savings ?? 0) > 0.05;

  const change = display.kind === 'opt'
    ? classifyChange(display.opt.equiv_note, display.opt.match_type === 'exact')
    : null;
  const badgeLabel = change ? CHANGE_LABELS[change] : null;
  const badgeColor = change ? CHANGE_COLORS[change] : null;
  const showChangeBadge = change != null && change !== 'same_brand';

  return (
    <div style={{ borderBottom: isLast ? 'none' : `1px solid ${V3.border}`, position: 'relative' }}>
      <div
        onClick={onToggleExpand}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr auto',
          gap: 14,
          alignItems: 'flex-start',
          padding: '14px 14px 14px 11px',
          width: '100%',
          background: expanded ? 'rgba(74,222,128,0.04)' : 'transparent',
          borderLeft: `3px solid ${expanded ? '#22c55e' : 'transparent'}`,
          cursor: 'pointer',
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
            <div style={labelStyle}>At {activeChain?.chain_name ?? '—'}</div>
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

          {display.kind === 'opt' && altPrice != null ? (
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
              <div style={nameStyle}>{display.opt.display_name}</div>
              <div style={{ ...metaStyle, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{altPackLabel(display.opt)}</span>
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
          ) : display.kind === 'skip' ? (
            <div style={{ marginTop: 6, fontSize: 12, color: '#f59e0b', fontStyle: 'italic', lineHeight: 1.4 }}>
              You'd pass on this one here.
            </div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 12, color: V3.inkLight, fontStyle: 'italic', lineHeight: 1.4 }}>
              {activeChain?.chain_name ?? 'This chain'} doesn't stock this.
            </div>
          )}
        </div>

        {/* Right column with peek button + chevron */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', alignSelf: 'flex-start', paddingTop: 2 }}>
          <button
            data-peek-trigger
            onClick={(e) => { e.stopPropagation(); onTogglePeek(); }}
            style={{
              background: peekOpen ? '#3b82f6' : 'transparent',
              color: peekOpen ? '#fff' : V3.inkMid,
              border: `1px solid ${peekOpen ? '#3b82f6' : V3.border}`,
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.08em',
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
            aria-label="Compare prices across all chains"
          >
            ⌥ COMPARE
          </button>
          <div style={{
            fontSize: 16, color: V3.inkLight,
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
            width: 14, textAlign: 'center',
          }}>
            ›
          </div>
        </div>
      </div>

      {/* Peek popover — anchored to the row, dismisses on outside click */}
      {peekOpen && (
        <PeekPopover v={v} chains={chains} activeChainId={activeChain?.chain_id ?? null} onClose={onTogglePeek} />
      )}

      {expanded && activeChain && (
        <div style={{
          padding: '4px 14px 14px 14px',
          borderTop: `1px dashed ${V3.border}`,
          background: 'rgba(74,222,128,0.03)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: V3.inkLight, padding: '10px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>What you'd buy at {activeChain.chain_name}</span>
            {(manualPick || skipped) && (
              <button
                onClick={() => onSetPick({ kind: 'auto' })}
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

          {opts.length === 0 ? (
            <div style={{
              padding: '12px 14px',
              background: V3.chrome,
              border: `1px dashed ${V3.border}`,
              borderRadius: 8,
              fontSize: 12,
              color: V3.inkLight,
              lineHeight: 1.5,
            }}>
              {activeChain.chain_name} doesn't stock anything matching this item. You'd skip it here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {opts.map((opt) => {
                const isSelected = !skipped && (
                  pick.kind === 'pick'
                    ? pick.canonical_id === opt.canonical_id
                    : opt.canonical_id === opts[0].canonical_id
                );
                return (
                  <OptionRadio
                    key={opt.canonical_id}
                    opt={opt}
                    userPrice={v.item.member_price}
                    selected={isSelected}
                    onSelect={() => onSetPick({ kind: 'pick', canonical_id: opt.canonical_id })}
                  />
                );
              })}
              <button
                onClick={() => onSetPick(skipped ? { kind: 'auto' } : { kind: 'skip' })}
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
                  marginTop: 2,
                }}
              >
                {skipped ? '✓ SKIPPED — would not buy here · tap to undo' : "I wouldn't buy this here"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PeekPopover({
  v, chains, activeChainId, onClose,
}: {
  v: RowVerdict;
  chains: ChainProjection[];
  activeChainId: number | null;
  onClose: () => void;
}) {
  const rows = useMemo(() => bestPerChain(chains, v.idx), [chains, v.idx]);
  const cheapestTotal = rows.reduce((m, r) => r.total != null && (m == null || r.total < m) ? r.total : m, null as number | null);

  return (
    <div
      data-peek-shell
      style={{
        position: 'absolute',
        top: 6,
        right: 14,
        zIndex: 20,
        minWidth: 280,
        maxWidth: 360,
        background: V3.pageAlt,
        border: `1px solid ${V3.borderHi}`,
        borderRadius: 12,
        boxShadow: '0 14px 40px -10px rgba(0,0,0,0.55), 0 4px 12px -4px rgba(0,0,0,0.45)',
        padding: '12px 14px 12px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: V3.inkLight }}>
            {v.item.match?.name ?? v.item.description}
          </div>
          <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {chains.length} nearby · you paid {fmt(v.item.member_price)}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: V3.inkLight, fontSize: 16, padding: '0 4px', fontFamily: 'inherit', lineHeight: 1,
          }}
          aria-label="Close peek"
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => {
          const isCheapest = r.total != null && cheapestTotal != null && r.total === cheapestTotal;
          const isActive = r.chain.chain_id === activeChainId;
          const change = r.opt ? classifyChange(r.opt.equiv_note, r.opt.match_type === 'exact') : null;
          const showBadge = change != null && change !== 'same_brand';
          const badgeColor = change ? CHANGE_COLORS[change] : null;
          const badgeLabel = change ? CHANGE_LABELS[change] : null;
          const cheaper = r.total != null && v.item.member_price - r.total > 0.05;
          return (
            <div key={r.chain.chain_id} style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${isActive ? V3.borderHi : V3.border}`,
              background: isActive ? V3.chrome : 'transparent',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 10,
              alignItems: 'center',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: V3.ink, letterSpacing: '0.04em' }}>
                    {r.chain.chain_name}
                  </span>
                  <span style={{ fontSize: 10, color: V3.inkLight }}>{r.chain.distance_miles.toFixed(1)} mi</span>
                  {isCheapest && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                      color: '#22c55e', background: 'rgba(34,197,94,0.18)',
                      padding: '1px 5px', borderRadius: 3,
                    }}>
                      ★ CHEAPEST
                    </span>
                  )}
                  {isActive && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                      color: V3.inkMid, background: 'rgba(255,255,255,0.07)',
                      padding: '1px 5px', borderRadius: 3,
                    }}>
                      ACTIVE
                    </span>
                  )}
                </div>
                {r.opt ? (
                  <div style={{ fontSize: 11, color: V3.inkMid, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {r.opt.display_name}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: V3.inkLight, fontStyle: 'italic' }}>not stocked</div>
                )}
                {showBadge && badgeColor && badgeLabel && (
                  <span style={{
                    display: 'inline-block', marginTop: 3,
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                    padding: '1px 5px', borderRadius: 3,
                    color: badgeColor.fg, background: badgeColor.bg,
                  }}>
                    {badgeLabel}
                  </span>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {r.total != null ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 800, color: cheaper ? '#22c55e' : V3.ink }}>
                      {fmt(r.total)}
                    </div>
                    {Math.abs(v.item.member_price - r.total) > 0.05 && (
                      <div style={{ fontSize: 9, fontWeight: 700, color: cheaper ? '#22c55e' : '#ef4444' }}>
                        {cheaper ? `↓ ${fmtAbs(v.item.member_price - r.total)}` : `↑ ${fmtAbs(v.item.member_price - r.total)}`}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: V3.inkLight }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 10, color: V3.inkLight, marginTop: 10, lineHeight: 1.4, fontStyle: 'italic' }}>
        Tap "compare" again or anywhere outside to dismiss · tap the row to pick.
      </div>
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
