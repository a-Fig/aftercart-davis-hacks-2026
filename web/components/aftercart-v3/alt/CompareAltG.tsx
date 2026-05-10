'use client';

/**
 * Alt G — Per-Item Picker.
 *
 * Design thesis: The user has preferences. The auto-cheapest pick at the alt
 * store assumes "you'll switch brands to save $0.30 on yogurt" — but that
 * might be exactly the brand they hate. Make the user the chooser. For each
 * item in their basket, show a radio-style list of what's stocked at the
 * selected chain, let them tap their preference, and update the basket total
 * live. The savings number that results is one they personally agreed to,
 * not one the algorithm picked for them.
 *
 * Best when the user has specific brand or size preferences and wants the
 * "what would my real basket cost there?" answer to reflect those.
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

type PickState =
  | { kind: 'auto' }
  | { kind: 'pick'; canonical_id: number }
  | { kind: 'skip' };       // user wouldn't buy this here

export default function CompareAltG({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const items = useMemo(
    () => compareResp.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.item_type !== 'skip'),
    [compareResp.items],
  );

  const [activeChainId, setActiveChainId] = useState<number | null>(chains[0]?.chain_id ?? null);
  const activeChain = chains.find((c) => c.chain_id === activeChainId) ?? null;

  // Per-(chain, row_idx) pick state.
  const [picks, setPicks] = useState<Map<string, PickState>>(new Map());
  const pickKey = (chain_id: number, row_idx: number) => `${chain_id}:${row_idx}`;

  const setPick = useCallback((chain_id: number, row_idx: number, p: PickState) => {
    setPicks((prev) => {
      const m = new Map(prev);
      m.set(pickKey(chain_id, row_idx), p);
      return m;
    });
  }, []);

  // Reset picks when the active chain changes — picks are per-chain.
  useEffect(() => {
    if (activeChainId == null && chains.length > 0) setActiveChainId(chains[0].chain_id);
  }, [activeChainId, chains]);

  const resolvePick = useCallback((chain_id: number, row_idx: number, opts: ChainOption[]) => {
    if (opts.length === 0) return null;
    const p = picks.get(pickKey(chain_id, row_idx)) ?? { kind: 'auto' as const };
    if (p.kind === 'skip') return 'skip' as const;
    if (p.kind === 'pick') {
      const found = opts.find((o) => o.canonical_id === p.canonical_id);
      if (found) return found;
    }
    return opts[0];
  }, [picks]);

  // Live totals for the active chain.
  const totals = useMemo(() => {
    if (!activeChain) return null;
    let chainTotal = 0;
    let userPaidSubset = 0;
    let chosenCount = 0;
    let skippedCount = 0;
    let unavailableCount = 0;
    for (const { item, idx } of items) {
      const opts = activeChain.options_by_line.get(idx) ?? [];
      if (opts.length === 0) {
        unavailableCount += 1;
        continue;
      }
      const chosen = resolvePick(activeChain.chain_id, idx, opts);
      if (chosen === 'skip' || chosen == null) {
        skippedCount += 1;
        continue;
      }
      const t = effectiveTotal(chosen, false);
      if (t == null) continue;
      chainTotal += t;
      userPaidSubset += item.member_price;
      chosenCount += 1;
    }
    return {
      chainTotal,
      userPaidSubset,
      savings: userPaidSubset - chainTotal,
      chosenCount,
      skippedCount,
      unavailableCount,
    };
  }, [activeChain, items, resolvePick]);

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date}
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 200px' }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: V3.ink }}>
            Build your alt basket
          </h1>
          <p style={{ fontSize: 14, color: V3.inkMid, margin: '6px 0 0', lineHeight: 1.5 }}>
            Pick a chain, then choose what you'd actually buy off their shelf for each item. Skip anything you wouldn't buy there. The savings number at the bottom updates as you go.
          </p>
        </div>

        {/* Chain selector */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${chains.length}, 1fr)`, gap: 6, marginBottom: 18 }}>
          {chains.map((c) => {
            const active = c.chain_id === activeChainId;
            return (
              <button
                key={c.chain_id}
                onClick={() => setActiveChainId(c.chain_id)}
                style={{
                  background: active ? V3.ink : 'transparent',
                  color: active ? V3.page : V3.ink,
                  border: `1px solid ${active ? V3.ink : V3.border}`,
                  borderRadius: 10,
                  padding: '10px 8px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                <div>{c.chain_name}</div>
                <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8, marginTop: 2 }}>
                  {c.distance_miles.toFixed(1)} mi
                </div>
              </button>
            );
          })}
        </div>

        {/* Per-item picker */}
        {activeChain && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map(({ item, idx }) => (
              <ItemPickerRow
                key={idx}
                item={item}
                idx={idx}
                chain={activeChain}
                pick={picks.get(`${activeChain.chain_id}:${idx}`) ?? { kind: 'auto' }}
                onSetPick={(p) => setPick(activeChain.chain_id, idx, p)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky live total */}
      {activeChain && totals && (
        <LiveTotalBar
          chainName={activeChain.chain_name}
          totals={totals}
        />
      )}
    </div>
  );
}

function ItemPickerRow({ item, idx, chain, pick, onSetPick }: {
  item: ApiItem;
  idx: number;
  chain: ChainProjection;
  pick: PickState;
  onSetPick: (p: PickState) => void;
}) {
  const opts = chain.options_by_line.get(idx) ?? [];
  const userName = item.match?.name ?? item.description;
  const userBrand = item.match?.brand;
  const userSize = item.match?.package_size != null && item.match?.package_unit
    ? `${item.match.package_size} ${item.match.package_unit}`
    : item.quantity != null && item.unit && item.unit !== 'each'
      ? `${item.quantity} ${item.unit}`
      : '';
  const unmatched = !item.match;
  const skipped = pick.kind === 'skip';

  // Resolve the currently-selected option.
  const selectedId = pick.kind === 'pick' ? pick.canonical_id : opts[0]?.canonical_id ?? null;

  return (
    <div style={{
      background: V3.pageAlt,
      border: `1px solid ${V3.border}`,
      borderRadius: 14,
      padding: '14px 16px',
      opacity: skipped ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: V3.ink, lineHeight: 1.25 }}>
            {userName}
          </div>
          <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 2 }}>
            You bought: {userBrand ? `${userBrand} · ` : ''}{userSize || '—'} · {fmt(item.member_price)}
          </div>
        </div>
      </div>

      {unmatched ? (
        <div style={{ fontSize: 12, color: V3.inkLight, fontStyle: 'italic', padding: '8px 4px' }}>
          We couldn't match this — leaving it on your bill as-is.
        </div>
      ) : opts.length === 0 ? (
        <div style={{
          padding: '10px 12px',
          background: V3.chrome,
          border: `1px dashed ${V3.border}`,
          borderRadius: 8,
          fontSize: 12,
          color: V3.inkLight,
        }}>
          {chain.chain_name} doesn't stock anything matching this item. You'd skip it here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {opts.map((opt) => (
            <OptionRadio
              key={opt.canonical_id}
              opt={opt}
              userPrice={item.member_price}
              selected={!skipped && selectedId === opt.canonical_id}
              onSelect={() => onSetPick({ kind: 'pick', canonical_id: opt.canonical_id })}
            />
          ))}
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
  const more = savings != null && savings < -0.05;
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
        background: selected ? 'rgba(74,222,128,0.08)' : 'transparent',
        border: `1px solid ${selected ? 'rgba(74,222,128,0.45)' : V3.border}`,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        color: V3.ink,
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: 999,
        border: `2px solid ${selected ? '#22c55e' : V3.border}`,
        background: selected ? '#22c55e' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.08em',
            padding: '1px 6px',
            borderRadius: 4,
            color: badgeColor.fg,
            background: badgeColor.bg,
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

function LiveTotalBar({ chainName, totals }: {
  chainName: string;
  totals: { chainTotal: number; userPaidSubset: number; savings: number; chosenCount: number; skippedCount: number; unavailableCount: number };
}) {
  const cheaper = totals.savings > 0.05;
  const more = totals.savings < -0.05;
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: V3.chrome,
      borderTop: `1px solid ${V3.borderHi}`,
      padding: '14px 20px',
      boxShadow: '0 -8px 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: V3.inkLight, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Your basket at {chainName}
          </div>
          <div style={{ fontSize: 11, color: V3.inkMid, marginTop: 2 }}>
            {totals.chosenCount} item{totals.chosenCount !== 1 ? 's' : ''} chosen
            {totals.skippedCount > 0 && ` · ${totals.skippedCount} skipped`}
            {totals.unavailableCount > 0 && ` · ${totals.unavailableCount} not stocked`}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: V3.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {fmt(totals.chainTotal)}
          </div>
          {Math.abs(totals.savings) > 0.05 && (
            <div style={{
              fontSize: 12,
              fontWeight: 700,
              color: cheaper ? '#22c55e' : '#ef4444',
              marginTop: 2,
            }}>
              {cheaper ? `↓ ${fmtAbs(totals.savings)} vs your trip` : `↑ ${fmtAbs(totals.savings)} more`}
            </div>
          )}
          {!cheaper && !more && (
            <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 2 }}>
              same price
            </div>
          )}
        </div>
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
