'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { V3, fmt, fmtAbs } from '@/components/aftercart-v3/theme';
import {
  projectByChain,
  totalSavingsForChain,
  effectiveTotal,
  type ChainOption,
  type ChainProjection,
} from '@/components/aftercart-v3/projection';
import V3MLineSwap from './V3MLineSwap';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface V3MCompareProps {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
  onRescan: () => void;
}

// Per-row user state.
type LineState = { kind: 'active' } | { kind: 'dropped' };

// Per-(chain, row) user choice state.
type AltLineState =
  | { kind: 'auto' }
  | { kind: 'pick'; canonical_id: number }
  | { kind: 'none' };

// Active swap target — used by the bottom-sheet swap UI.
interface SwapTarget {
  chain_id: number;
  row_idx: number;
  options: ChainOption[];
  selected: number | null;
  useMember: boolean;
  rowItemName: string;
}

export default function V3MCompare({ matchResult, compareResp, onBack, onRescan }: V3MCompareProps) {
  const reviewItems = useMemo(
    () =>
      compareResp.items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.item_type !== 'skip'),
    [compareResp.items],
  );

  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);

  const [lineState, setLineState] = useState<Map<number, LineState>>(() => {
    const m = new Map<number, LineState>();
    for (const { idx } of reviewItems) m.set(idx, { kind: 'active' });
    return m;
  });

  const [altState, setAltState] = useState<Map<string, AltLineState>>(new Map());
  const altKey = (chain_id: number, row_idx: number) => `${chain_id}:${row_idx}`;

  const [memberOn, setMemberOn] = useState<Map<number, boolean>>(new Map());

  // Mobile is single-select: only ONE alt receipt visible at a time.
  // Default to the chain with the biggest savings (chains[0]).
  const [activeChainId, setActiveChainId] = useState<number | null>(chains[0]?.chain_id ?? null);
  useEffect(() => {
    if (activeChainId == null && chains.length > 0) setActiveChainId(chains[0].chain_id);
    if (activeChainId != null && !chains.some((c) => c.chain_id === activeChainId)) {
      setActiveChainId(chains[0]?.chain_id ?? null);
    }
  }, [chains, activeChainId]);

  const activeChain = chains.find((c) => c.chain_id === activeChainId) ?? null;

  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null);

  const toggleLineDrop = useCallback((row_idx: number) => {
    setLineState((prev) => {
      const m = new Map(prev);
      const cur = m.get(row_idx) ?? { kind: 'active' };
      m.set(row_idx, cur.kind === 'active' ? { kind: 'dropped' } : { kind: 'active' });
      return m;
    });
  }, []);

  const setAltChoice = useCallback((chain_id: number, row_idx: number, next: AltLineState) => {
    setAltState((prev) => {
      const m = new Map(prev);
      m.set(altKey(chain_id, row_idx), next);
      return m;
    });
  }, []);

  const toggleMember = useCallback((chain_id: number) => {
    setMemberOn((prev) => {
      const m = new Map(prev);
      m.set(chain_id, !m.get(chain_id));
      return m;
    });
  }, []);

  const resolveOption = useCallback((chain: ChainProjection, row_idx: number) => {
    const opts = chain.options_by_line.get(row_idx) ?? [];
    if (opts.length === 0) return { kind: 'unavailable' as const };
    const choice = altState.get(altKey(chain.chain_id, row_idx)) ?? { kind: 'auto' };
    if (choice.kind === 'none') return { kind: 'none' as const, opts };
    if (choice.kind === 'pick') {
      const found = opts.find((o) => o.canonical_id === choice.canonical_id);
      if (found) return { kind: 'option' as const, option: found, opts };
    }
    return { kind: 'option' as const, option: opts[0], opts };
  }, [altState]);

  // Active-chain summary.
  const summary = useMemo(() => {
    if (!activeChain) return null;
    const useMember = memberOn.get(activeChain.chain_id) ?? false;
    let chainTotal = 0;
    let userPaidForSubset = 0;
    let coveredCount = 0;
    let totalEligible = 0;
    for (const { item, idx } of reviewItems) {
      const ls = lineState.get(idx) ?? { kind: 'active' };
      if (ls.kind === 'dropped') continue;
      totalEligible += 1;
      const r = resolveOption(activeChain, idx);
      if (r.kind === 'option') {
        const et = effectiveTotal(r.option, useMember);
        if (et == null) continue; // can't compute volume-normalized total — skip
        chainTotal += et;
        userPaidForSubset += item.member_price;
        coveredCount += 1;
      }
    }
    return {
      useMember,
      chainTotal,
      userPaidForSubset,
      savings: userPaidForSubset - chainTotal,
      coveredCount,
      totalEligible,
    };
  }, [activeChain, reviewItems, lineState, memberOn, resolveOption]);

  const userBasketTotal = useMemo(() => {
    let n = 0;
    for (const { item, idx } of reviewItems) {
      const ls = lineState.get(idx) ?? { kind: 'active' };
      if (ls.kind === 'dropped') continue;
      n += item.member_price;
    }
    return n;
  }, [reviewItems, lineState]);

  const userReceiptTotal = useMemo(
    () => reviewItems.reduce((s, { item }) => s + item.member_price, 0),
    [reviewItems],
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${V3.border}`,
          gap: 10,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: `1px solid ${V3.border}`,
            color: V3.inkMid,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          ← Home
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {compareResp.receipt.store_name ?? 'Receipt'}
          </div>
          <div style={{ fontSize: 11, color: V3.inkLight }}>
            {reviewItems.length} items · tap to edit
          </div>
        </div>
        <button
          onClick={onRescan}
          style={{
            background: V3.ink,
            color: V3.page,
            border: 'none',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          Rescan
        </button>
      </div>

      {/* Chain selector — single-select, swipeable horizontal scroll.
          Padding lives on the inner scroll container (not the outer wrapper)
          so pills have visual breathing room AT both edges while still being
          scrollable in their entirety. `touch-action: pan-x` tells the browser
          this row owns horizontal swipes — without it, a finger drag inside
          the row gets interpreted as page-vertical-scroll on touch devices
          and the pills never move. The right-edge gradient fade is a
          discoverability cue: when content is clipped to the right, users
          see something is hidden and try to swipe. */}
      {chains.length > 0 && (
        <div
          style={{
            padding: '10px 0 8px',
            background: V3.chrome,
            borderBottom: `1px solid ${V3.border}`,
            position: 'relative',
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: V3.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              fontWeight: 600,
              marginBottom: 6,
              padding: '0 14px',
            }}
          >
            Compare to
          </div>
          <div
            className="v3m-chain-scroll"
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              overflowY: 'hidden',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-x',
              scrollbarWidth: 'thin',
              padding: '2px 14px',
              // Snap so pills come to rest aligned with the left edge.
              scrollSnapType: 'x proximity',
            }}
          >
            {chains.map((c) => {
              const active = c.chain_id === activeChainId;
              const saves = totalSavingsForChain(c, compareResp);
              const cheaper = saves > 0.5;
              const moreExpensive = saves < -0.5;
              return (
                <button
                  key={c.chain_id}
                  onClick={() => setActiveChainId(c.chain_id)}
                  style={{
                    flexShrink: 0,
                    scrollSnapAlign: 'start',
                    padding: '7px 11px',
                    background: active ? V3.pageAlt : 'transparent',
                    border: `1px solid ${active ? V3.borderHi : V3.border}`,
                    borderRadius: 999,
                    color: active ? V3.ink : V3.inkLight,
                    fontFamily: 'inherit',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{c.chain_name}</span>
                  {cheaper && (
                    <span className="v3-num" style={{ color: V3.saveInk, fontWeight: 700 }}>
                      ↓ {fmtAbs(saves)}
                    </span>
                  )}
                  {moreExpensive && (
                    <span className="v3-num" style={{ color: V3.overInk, fontWeight: 700 }}>
                      ↑ {fmtAbs(saves)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Right-edge fade — visual cue that the row is horizontally
              scrollable. Pointer-events: none so it doesn't block taps on the
              last visible pill. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 28,
              pointerEvents: 'none',
              background: `linear-gradient(to right, transparent, ${V3.chrome})`,
            }}
          />
        </div>
      )}

      {/* Receipt grid: user | active alt — fixed 2 columns */}
      <div
        style={{
          flex: 1,
          padding: '14px 12px 22px',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: '1fr 1fr',
            alignItems: 'flex-start',
          }}
        >
          {/* User column */}
          <ReceiptCard
            kind="user"
            title={compareResp.receipt.store_name ?? 'You'}
            subtitle={compareResp.receipt.receipt_date ?? ''}
            footer={<UserFooter paid={userReceiptTotal} comparable={userBasketTotal} />}
          >
            {reviewItems.map(({ item, idx }) => {
              const ls = lineState.get(idx) ?? { kind: 'active' };
              return (
                <UserRow
                  key={idx}
                  item={item}
                  dropped={ls.kind === 'dropped'}
                  onToggle={() => toggleLineDrop(idx)}
                />
              );
            })}
          </ReceiptCard>

          {/* Alt column */}
          {activeChain && summary ? (
            <ReceiptCard
              kind="alt"
              title={activeChain.chain_name}
              subtitle={`${activeChain.distance_miles.toFixed(1)} mi`}
              memberToggle={
                activeChain.has_member_pricing
                  ? {
                      on: summary.useMember,
                      label: activeChain.chain_name.split(' ')[0],
                      onToggle: () => toggleMember(activeChain.chain_id),
                    }
                  : null
              }
              footer={
                <AltFooter
                  chainTotal={summary.chainTotal}
                  userPaidSubset={summary.userPaidForSubset}
                  savings={summary.savings}
                  covered={summary.coveredCount}
                  total={summary.totalEligible}
                />
              }
            >
              {reviewItems.map(({ item, idx }) => {
                const ls = lineState.get(idx) ?? { kind: 'active' };
                if (ls.kind === 'dropped') return <AltRowDropped key={idx} />;
                const r = resolveOption(activeChain, idx);
                return (
                  <AltRow
                    key={idx}
                    item={item}
                    resolved={r}
                    useMember={summary.useMember}
                    onOpenSwap={() => {
                      setSwapTarget({
                        chain_id: activeChain.chain_id,
                        row_idx: idx,
                        options: r.kind === 'unavailable' ? [] : r.opts,
                        selected: r.kind === 'option' ? r.option.canonical_id : null,
                        useMember: summary.useMember,
                        rowItemName: item.user_display_name ?? item.match?.name ?? item.description,
                      });
                    }}
                  />
                );
              })}
            </ReceiptCard>
          ) : (
            <div
              style={{
                padding: 14,
                fontSize: 12,
                color: V3.inkLight,
                border: `1px dashed ${V3.border}`,
                borderRadius: 6,
                textAlign: 'center',
              }}
            >
              No nearby price data yet.
            </div>
          )}
        </div>

        {summary && summary.coveredCount < summary.totalEligible && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              fontSize: 11,
              color: V3.inkLight,
              border: `1px dashed ${V3.border}`,
              borderRadius: 8,
              lineHeight: 1.5,
            }}
          >
            Totals only count rows priced on both sides — gaps stay honest.
          </div>
        )}
      </div>

      {/* Bottom-sheet swap UI */}
      {swapTarget && (
        <V3MLineSwap
          target={swapTarget}
          onPick={(canonical_id) => {
            setAltChoice(swapTarget.chain_id, swapTarget.row_idx, { kind: 'pick', canonical_id });
            setSwapTarget(null);
          }}
          onAuto={() => {
            setAltChoice(swapTarget.chain_id, swapTarget.row_idx, { kind: 'auto' });
            setSwapTarget(null);
          }}
          onNone={() => {
            setAltChoice(swapTarget.chain_id, swapTarget.row_idx, { kind: 'none' });
            setSwapTarget(null);
          }}
          onClose={() => setSwapTarget(null)}
        />
      )}
    </div>
  );
}

// ── ReceiptCard (compact) ─────────────────────────────────────────────────

function ReceiptCard({
  kind, title, subtitle, memberToggle, children, footer,
}: {
  kind: 'user' | 'alt';
  title: string;
  subtitle: string;
  memberToggle?: { on: boolean; label: string; onToggle: () => void } | null;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: V3.paper,
        color: V3.paperInk,
        padding: '14px 12px 12px',
        borderRadius: 4,
        boxShadow: kind === 'user'
          ? '0 18px 36px -14px rgba(0,0,0,0.5), 0 4px 10px rgba(0,0,0,0.2)'
          : '0 14px 30px -12px rgba(0,0,0,0.45), 0 3px 8px rgba(0,0,0,0.18)',
        position: 'relative',
        animation: 'v3FadeUp 0.4s ease',
      }}
    >
      {/* Tear edge */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -6,
          left: 0,
          right: 0,
          height: 8,
          background: V3.paper,
          clipPath: 'polygon(0 100%, 4% 30%, 8% 100%, 12% 30%, 16% 100%, 20% 30%, 24% 100%, 28% 30%, 32% 100%, 36% 30%, 40% 100%, 44% 30%, 48% 100%, 52% 30%, 56% 100%, 60% 30%, 64% 100%, 68% 30%, 72% 100%, 76% 30%, 80% 100%, 84% 30%, 88% 100%, 92% 30%, 96% 100%, 100% 30%, 100% 100%)',
        }}
      />

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div className="v3-mono" style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.1em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {title.toUpperCase()}
        </div>
        {subtitle && (
          <div className="v3-mono" style={{ fontSize: 9, color: V3.paperMute, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>

      {memberToggle && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
          <button
            onClick={memberToggle.onToggle}
            className="v3-mono"
            style={{
              background: memberToggle.on ? V3.paperInk : 'transparent',
              color: memberToggle.on ? V3.paper : V3.paperMid,
              border: `1px solid ${V3.paperLine}`,
              borderRadius: 999,
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
              textTransform: 'uppercase',
            }}
          >
            {memberToggle.on ? `✓ ${memberToggle.label} card` : `${memberToggle.label} card`}
          </button>
        </div>
      )}

      <Divider />

      <div>{children}</div>

      <Divider />

      <div style={{ marginTop: 2 }}>{footer}</div>
    </div>
  );
}

function Divider() {
  return (
    <div className="v3-mono" style={{ textAlign: 'center', fontSize: 8, color: V3.paperFaint, padding: '4px 0', letterSpacing: '0.06em' }}>
      — — — — — — — — — — —
    </div>
  );
}

// ── User row (mobile) ─────────────────────────────────────────────────────

function UserRow({ item, dropped, onToggle }: { item: ApiItem; dropped: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={dropped ? 'Tap to include' : 'Tap to drop'}
      style={{
        width: '100%',
        background: dropped ? V3.noneBg : 'transparent',
        border: 'none',
        padding: '4px 2px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: V3.paperInk,
        textAlign: 'left',
        borderRadius: 3,
        opacity: dropped ? 0.55 : 1,
      }}
    >
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, alignItems: 'baseline' }}>
        <span style={{
          flex: 1,
          textDecoration: dropped ? 'line-through' : 'none',
          textTransform: 'uppercase',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginRight: 6,
        }}>
          {item.user_display_name ?? item.match?.name ?? item.description}
        </span>
        <span style={{
          textDecoration: dropped ? 'line-through' : 'none',
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {fmt(item.member_price)}
        </span>
      </div>
      {!item.match && !dropped && (
        <div className="v3-mono" style={{ fontSize: 8, color: V3.edited, paddingLeft: 1, marginTop: 1 }}>
          NO MATCH
        </div>
      )}
    </button>
  );
}

// ── Alt rows (mobile) ─────────────────────────────────────────────────────

interface AltRowProps {
  item: ApiItem;
  resolved:
    | { kind: 'option'; option: ChainOption; opts: ChainOption[] }
    | { kind: 'none'; opts: ChainOption[] }
    | { kind: 'unavailable' };
  useMember: boolean;
  onOpenSwap: () => void;
}

function AltRow({ item, resolved, useMember, onOpenSwap }: AltRowProps) {
  if (resolved.kind === 'unavailable') {
    return (
      <div
        className="v3-mono"
        style={{
          padding: '4px 2px',
          fontSize: 11,
          color: V3.paperFaint,
          display: 'flex',
          justifyContent: 'space-between',
          fontStyle: 'italic',
        }}
      >
        <span>—</span>
        <span>—</span>
      </div>
    );
  }

  if (resolved.kind === 'none') {
    return (
      <button
        onClick={onOpenSwap}
        className="v3-mono"
        style={{
          width: '100%',
          background: V3.noneBg,
          border: 'none',
          padding: '4px 2px',
          cursor: 'pointer',
          color: V3.paperMute,
          textAlign: 'left',
          borderRadius: 3,
          fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, textDecoration: 'line-through' }}>
          <span>SKIPPED HERE</span>
          <span>—</span>
        </div>
      </button>
    );
  }

  const opt = resolved.option;
  const total = effectiveTotal(opt, useMember);
  const memberShown = useMember && opt.member_total != null;
  const perUnitOnly = total == null;
  const displayPrice = total ?? opt.shelf;
  const diff = perUnitOnly ? 0 : item.member_price - displayPrice;
  const cheaper = diff > 0.05;
  const moreExpensive = diff < -0.05;

  return (
    <button
      onClick={onOpenSwap}
      style={{
        width: '100%',
        background: 'transparent',
        border: 'none',
        padding: '4px 2px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: V3.paperInk,
        textAlign: 'left',
        borderRadius: 3,
      }}
    >
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, alignItems: 'baseline' }}>
        <span style={{
          flex: 1,
          textTransform: 'uppercase',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginRight: 6,
          color: opt.match_type === 'equivalent' ? V3.paperMid : V3.paperInk,
        }}>
          {shortenName(opt.display_name)}
          {opt.match_type === 'equivalent' && (
            <span style={{ color: V3.edited, marginLeft: 3, fontSize: 8 }}>~</span>
          )}
        </span>
        <span style={{ fontWeight: 700, flexShrink: 0, color: memberShown ? V3.saveInk : V3.paperInk }}>
          {perUnitOnly
            ? `${fmt(displayPrice)}/${opt.price_unit.replace(/^per_/, '')}`
            : fmt(displayPrice)}
        </span>
      </div>
      {perUnitOnly && (
        <div className="v3-mono" style={{ fontSize: 8, marginTop: 1, paddingLeft: 1, color: V3.paperMute, fontStyle: 'italic' }}>
          per-unit only
        </div>
      )}
      {!perUnitOnly && (cheaper || moreExpensive) && (
        <div
          className="v3-mono"
          style={{
            fontSize: 8,
            marginTop: 1,
            paddingLeft: 1,
            color: cheaper ? V3.saveInk : V3.overInk,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          {cheaper ? `↓ ${fmtAbs(diff)}` : `↑ ${fmtAbs(diff)}`}
        </div>
      )}
    </button>
  );
}

function AltRowDropped() {
  return (
    <div
      className="v3-mono"
      style={{
        padding: '4px 2px',
        fontSize: 11,
        color: V3.paperFaint,
        display: 'flex',
        justifyContent: 'space-between',
        fontStyle: 'italic',
      }}
    >
      <span>· dropped ·</span>
      <span>—</span>
    </div>
  );
}

function shortenName(s: string) {
  // Mobile receipts are tighter — be aggressive about truncation. The full
  // name is always available in the swap sheet when the user taps.
  if (s.length <= 18) return s;
  return s.slice(0, 17) + '…';
}

// ── Footers (mobile) ─────────────────────────────────────────────────────

function UserFooter({ paid, comparable }: { paid: number; comparable: number }) {
  const dropped = paid - comparable;
  return (
    <div className="v3-mono" style={{ fontSize: 11, color: V3.paperInk }}>
      {dropped > 0.01 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', color: V3.paperMute, marginBottom: 3, fontSize: 9 }}>
          <span>EXCL.</span>
          <span>−{fmt(dropped)}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
        <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>SUBTOTAL</span>
        <span style={{ fontWeight: 800, fontSize: 13 }}>{fmt(comparable)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: V3.paperMute, fontSize: 9, marginTop: 4 }}>
        <span>FULL</span>
        <span>{fmt(paid)}</span>
      </div>
    </div>
  );
}

function AltFooter({ chainTotal, userPaidSubset, savings, covered, total }: {
  chainTotal: number;
  userPaidSubset: number;
  savings: number;
  covered: number;
  total: number;
}) {
  const cheaper = savings > 0.05;
  const moreExpensive = savings < -0.05;

  let stampLabel: string;
  let stampValue: string;
  let stampInk: string;
  let stampPaper: string;
  let stampOutline: string;

  if (cheaper) {
    stampLabel = "YOU'D SAVE";
    stampValue = `↓ ${fmtAbs(savings)}`;
    stampInk = V3.saveInk;
    stampPaper = V3.savePaper;
    stampOutline = V3.saveOutline;
  } else if (moreExpensive) {
    stampLabel = 'PAY MORE';
    stampValue = `↑ ${fmtAbs(savings)}`;
    stampInk = V3.overInk;
    stampPaper = V3.overPaper;
    stampOutline = V3.overOutline;
  } else {
    stampLabel = 'SAME';
    stampValue = fmt(0);
    stampInk = V3.paperMid;
    stampPaper = V3.noneBg;
    stampOutline = V3.paperLine;
  }

  return (
    <div className="v3-mono" style={{ fontSize: 11, color: V3.paperInk }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: V3.paperMute, marginBottom: 3, fontSize: 9 }}>
        <span>{covered}/{total} priced</span>
        <span>—</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
        <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>HERE</span>
        <span style={{ fontWeight: 800, fontSize: 13 }}>{fmt(chainTotal)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: V3.paperMute, fontSize: 9, marginTop: 4 }}>
        <span>YOU PAID</span>
        <span>{fmt(userPaidSubset)}</span>
      </div>
      <div
        style={{
          marginTop: 8,
          padding: '7px 8px',
          background: stampPaper,
          border: `1px solid ${stampOutline}`,
          borderRadius: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span style={{
          fontWeight: 800,
          letterSpacing: '0.06em',
          fontSize: 9,
          color: stampInk,
        }}>
          {stampLabel}
        </span>
        <span style={{
          fontSize: 13,
          fontWeight: 800,
          color: stampInk,
        }}>
          {stampValue}
        </span>
      </div>
    </div>
  );
}
