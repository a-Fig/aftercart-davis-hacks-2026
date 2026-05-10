'use client';

/**
 * Alt L — Verdict First × Per-Item Picker (love child of A and G).
 *
 * Layout and presentation are A's: hero verdict card up top, other-chain tabs,
 * per-category breakdown rows. Behavior is G's: every breakdown row is
 * clickable. Tapping a row drops an inline picker drawer with G's radio-style
 * candidates — pick the substitute YOU'D actually buy at the active chain,
 * skip items you wouldn't buy there, and watch the hero savings number
 * recompute live from your picks.
 *
 * Picks persist per chain (switching chains doesn't lose your work). Single
 * accordion: opening row B closes row A, so the page stays focused.
 */

import { useMemo, useState, useCallback, useEffect } from 'react';
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

export default function CompareAltL({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const verdicts = useMemo(() => buildVerdicts(compareResp), [compareResp]);

  const [selectedChainId, setSelectedChainId] = useState<number | null>(chains[0]?.chain_id ?? null);
  const selectedChain = chains.find((c) => c.chain_id === selectedChainId) ?? null;

  // Per-(chain, row) pick state. Persists across chain switches so the user
  // doesn't lose work bouncing between Grocery Outlet and Trader Joe's.
  const [picks, setPicks] = useState<Map<string, PickState>>(new Map());
  const setPick = useCallback((chain_id: number, row_idx: number, p: PickState) => {
    setPicks((prev) => {
      const m = new Map(prev);
      m.set(pickKey(chain_id, row_idx), p);
      return m;
    });
  }, []);

  // Single-row accordion. Reset on chain switch — the user always lands on the
  // verdict, not mid-picker for an item they're no longer looking at.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  useEffect(() => { setExpandedIdx(null); }, [selectedChainId]);

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

  // Live summaries — depend on picks so the hero and tabs both recompute on
  // every selection change.
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

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 60px' }}>
        {/* Hero verdict — recomputes live from picks */}
        {selected && selected.savings > 0.5 && (
          <div style={{
            background: 'linear-gradient(135deg, #1f7a3a 0%, #2c9b4a 100%)',
            borderRadius: 16,
            padding: '28px 24px',
            color: '#fff',
            marginBottom: 16,
            boxShadow: '0 10px 40px -10px rgba(31,122,58,0.4)',
            transition: 'transform 0.15s',
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

        {/* Other-chain tabs — also recompute live */}
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
          Item-by-item breakdown · tap any row to choose your substitute
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
                      chain={selectedChain}
                      pick={selectedChain ? (picks.get(pickKey(selectedChain.chain_id, v.idx)) ?? { kind: 'auto' as const }) : { kind: 'auto' as const }}
                      onSetPick={(p) => selectedChain && setPick(selectedChain.chain_id, v.idx, p)}
                      expanded={expanded}
                      onToggleExpand={() => setExpandedIdx(expanded ? null : v.idx)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Couldn't compare — static, can't pick */}
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
  v, isLast, chain, pick, onSetPick, expanded, onToggleExpand,
}: {
  v: RowVerdict;
  isLast: boolean;
  chain: ChainProjection | null;
  pick: PickState;
  onSetPick: (p: PickState) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const opts = chain?.options_by_line.get(v.idx) ?? [];
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

  return (
    <div style={{ borderBottom: isLast ? 'none' : `1px solid ${V3.border}` }}>
      <button
        onClick={onToggleExpand}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 12,
          padding: '12px 14px 12px 11px',
          alignItems: 'center',
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
          <div style={{ fontSize: 14, fontWeight: 600, color: V3.ink, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {v.item.match?.name ?? v.item.description}
          </div>
          <div style={{ fontSize: 11, color: V3.inkLight, fontVariantNumeric: 'tabular-nums', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>
              {v.item.quantity != null && v.item.unit && v.item.unit !== 'each' ? `${v.item.quantity} ${v.item.unit} · ` : ''}
              You paid {fmt(v.item.member_price)}
            </span>
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
                ✓ SKIPPED HERE
              </span>
            )}
          </div>
          {display.kind === 'opt' && (
            <div style={{ fontSize: 10, color: V3.inkLight, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              → {display.opt.display_name}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {display.kind === 'opt' && altPrice != null ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: V3.ink }}>
                {fmt(altPrice)}
              </div>
              <div style={{ fontSize: 10, color: (savings ?? 0) > 0.05 ? '#4ade80' : V3.inkLight, fontWeight: 600, marginTop: 2 }}>
                {(savings ?? 0) > 0.05
                  ? `↓ ${fmtAbs(savings ?? 0)} cheaper`
                  : (savings ?? 0) < -0.05
                    ? `↑ ${fmtAbs(savings ?? 0)} more`
                    : 'same'}
              </div>
            </>
          ) : display.kind === 'skip' ? (
            <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>not buying</div>
          ) : (
            <div style={{ fontSize: 11, color: V3.inkLight }}>not priced here</div>
          )}
        </div>
        <div style={{
          fontSize: 16, color: V3.inkLight, flexShrink: 0,
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
          width: 14, textAlign: 'center',
        }}>
          ›
        </div>
      </button>

      {expanded && chain && (
        <div style={{
          padding: '4px 14px 14px 14px',
          borderTop: `1px dashed ${V3.border}`,
          background: 'rgba(74,222,128,0.03)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: V3.inkLight, padding: '10px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>What you'd buy at {chain.chain_name}</span>
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
              {chain.chain_name} doesn't stock anything matching this item. You'd skip it here.
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
