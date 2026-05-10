'use client';

/**
 * Alt V — Ink/Indigo theme variant of Alt S.
 *
 * Identical structure and logic to Alt S. Only the palette changes:
 *   · Hero: near-flat zinc-900 → zinc-800 gradient (#18181b → #27272a) — almost black
 *   · Accent: indigo-400 (#818cf8) — the one pop of color, muted and editorial
 *   · Savings lighter: indigo-300 (#a5b4fc)
 *   · Negative: rose-400 (#fb7185) — desaturated warm
 *   · Chain palette: indigo, sky, pink, yellow, rose
 *
 * The "less saturated, less neon" brief taken to its logical conclusion —
 * near-monochrome with a single soft accent.
 */

import { useMemo, useState, useCallback, useEffect } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, type ChainOption, type ChainProjection } from '../projection';
import { classifyChange, CHANGE_LABELS, CHANGE_COLORS } from '@/app/v3/compare-alt/mock-data';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

// ── Theme palette ────────────────────────────────────────────────────────────
const VV = {
  heroGrad: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
  heroShadow: 'rgba(0,0,0,0.65)',
  heroGood: '#c4b5fd',    // violet-300
  heroBad: '#fda4af',     // rose-300
  heroNeutral: '#f4f4f5', // zinc-100
  accent: '#818cf8',      // indigo-400
  accentLight: '#a5b4fc', // indigo-300
  accentFaint4: 'rgba(129,140,248,0.04)',
  accentFaint3: 'rgba(129,140,248,0.03)',
  accentFaint10: 'rgba(129,140,248,0.10)',
  accentBorder: 'rgba(129,140,248,0.45)',
  accentBorder35: 'rgba(129,140,248,0.35)',
  accentBadgeBg: 'rgba(129,140,248,0.15)',
  negative: '#fb7185',    // rose-400
  manual: '#6366f1',      // indigo-500
  manualBg: 'rgba(99,102,241,0.15)',
  allStoresHover: '#6366f1', // indigo-500
};
// ─────────────────────────────────────────────────────────────────────────────

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

const CHAIN_PALETTE = ['#818cf8', '#38bdf8', '#f472b6', '#facc15', '#fb7185'];

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

export default function CompareAltV({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const verdicts = useMemo(() => buildVerdicts(compareResp), [compareResp]);

  const chainColor = useMemo(() => {
    const m = new Map<number, string>();
    chains.forEach((c, i) => m.set(c.chain_id, CHAIN_PALETTE[i % CHAIN_PALETTE.length]));
    return m;
  }, [chains]);

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

  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  useEffect(() => {
    if (sheetIdx == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetIdx(null); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [sheetIdx]);

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
        if (opts.length === 0) { unavailableCount += 1; return; }
        const p = picks.get(pickKey(chain.chain_id, idx));
        if (p?.kind === 'pick' && p.canonical_id !== opts[0].canonical_id) manualCount += 1;
        const chosen = resolveChosenOpt(chain, idx);
        if (chosen === 'skip' || chosen == null) { skippedCount += 1; return; }
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

  const sheetVerdict = sheetIdx != null ? verdicts.find((v) => v.idx === sheetIdx) ?? null : null;

  const pctSavings = selected && selected.userPaidSubset > 0.01
    ? (selected.savings / selected.userPaidSubset) * 100
    : 0;
  const cheaper = selected && selected.savings > 0.5;

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date}
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 60px' }}>
        {selected && (
          <div style={{
            background: VV.heroGrad,
            borderRadius: 16,
            padding: '28px 24px',
            color: '#fff',
            marginBottom: 16,
            boxShadow: `0 10px 40px -10px ${VV.heroShadow}`,
          }}>
            <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.0, marginBottom: 6 }}>
              {selected.chain_name}
            </div>
            <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 22, letterSpacing: '0.02em' }}>
              {selected.distance.toFixed(1)} mi away
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, alignItems: 'flex-start' }}>
              <HeroStat label={`At ${compareResp.receipt.store_name}`} value={fmt(selected.userPaidSubset)} tone="neutral" />
              <HeroStat label={`At ${selected.chain_name}`} value={fmt(selected.chainTotal)} tone="neutral" />
              <HeroStat
                label="Savings"
                value={cheaper ? `${pctSavings.toFixed(0)}%` : pctSavings < -0.5 ? `${Math.abs(pctSavings).toFixed(0)}%` : '0%'}
                tone={cheaper ? 'good' : pctSavings < -0.5 ? 'bad' : 'neutral'}
                prefix={cheaper ? '↓ ' : pctSavings < -0.5 ? '↑ ' : ''}
              />
            </div>

            <div style={{ fontSize: 12, opacity: 0.55, marginTop: 18, lineHeight: 1.5 }}>
              Based on {selected.chosenCount} of {selected.totalEligible} items priced at this store
              {selected.unavailableCount > 0 && ` · ${selected.unavailableCount} not stocked here`}
              {selected.manualCount > 0 && ` · ${selected.manualCount} of your picks`}
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
                const pct = s.userPaidSubset > 0.01 ? (s.savings / s.userPaidSubset) * 100 : 0;
                const matched = s.chosenCount;
                return (
                  <button
                    key={s.chain_id}
                    onClick={() => setSelectedChainId(s.chain_id)}
                    style={{
                      background: active ? V3.pageAlt : 'transparent',
                      border: `1px solid ${active ? V3.borderHi : V3.border}`,
                      borderRadius: 12, padding: '12px 10px', cursor: 'pointer',
                      color: V3.ink, fontFamily: 'inherit', textAlign: 'left',
                      display: 'flex', flexDirection: 'column', gap: 4, position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>
                      {s.chain_name}
                      <span style={{ color: V3.inkLight, fontWeight: 600, marginLeft: 6 }}>
                        · {matched}/{s.totalEligible}
                      </span>
                      <span style={{ color: V3.inkLight, fontWeight: 500, fontSize: 10, marginLeft: 4 }}>
                        matched
                      </span>
                    </span>
                    <span style={{ fontSize: 10, color: V3.inkLight }}>{s.distance.toFixed(1)} mi</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: cheap ? VV.accentLight : V3.inkMid, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {cheap ? `↓ ${pct.toFixed(0)}%` : 'No savings'}
                    </span>
                    {s.manualCount > 0 && (
                      <span style={{ position: 'absolute', top: 6, right: 6, background: VV.manual, color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 999, padding: '1px 6px', letterSpacing: '0.05em' }}>
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
          Your basket vs {selected?.chain_name ?? 'this chain'}
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
                      onOpenSheet={() => setSheetIdx(v.idx)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {verdicts.some((v) => v.unmatched) && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: V3.inkMid, marginBottom: 8, paddingLeft: 4 }}>Couldn't compare</div>
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

      {sheetVerdict && (
        <AllStoresSheet
          v={sheetVerdict}
          chains={chains}
          chainColor={chainColor}
          activeChainId={selectedChainId}
          receiptStoreName={compareResp.receipt.store_name}
          onClose={() => setSheetIdx(null)}
        />
      )}
    </div>
  );
}

function HeroStat({ label, value, tone, prefix = '' }: {
  label: string; value: string; tone: 'neutral' | 'good' | 'bad'; prefix?: string;
}) {
  const color = tone === 'good' ? VV.heroGood : tone === 'bad' ? VV.heroBad : VV.heroNeutral;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.55, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1.05 }}>
        {prefix}{value}
      </div>
    </div>
  );
}

function BreakdownRow({
  v, isLast, chain, pick, onSetPick, expanded, onToggleExpand, onOpenSheet,
}: {
  v: RowVerdict; isLast: boolean; chain: ChainProjection | null; pick: PickState;
  onSetPick: (p: PickState) => void; expanded: boolean; onToggleExpand: () => void; onOpenSheet: () => void;
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
    if (t != null) { altPrice = t; savings = v.item.member_price - t; }
  }
  const cheaper = (savings ?? 0) > 0.05;

  const change = display.kind === 'opt' ? classifyChange(display.opt.equiv_note, display.opt.match_type === 'exact') : null;
  const badgeLabel = change ? CHANGE_LABELS[change] : null;
  const badgeColor = change ? CHANGE_COLORS[change] : null;
  const showChangeBadge = change != null && change !== 'same_brand';

  return (
    <div style={{ borderBottom: isLast ? 'none' : `1px solid ${V3.border}` }}>
      <div
        onClick={onToggleExpand}
        style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 14px', gap: 14,
          alignItems: 'flex-start', padding: '14px 14px 14px 11px', width: '100%',
          background: expanded ? VV.accentFaint4 : 'transparent',
          borderLeft: `3px solid ${expanded ? VV.accent : 'transparent'}`,
          cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={labelStyle}>You paid</div>
          <div style={bigPriceStyle}>{fmt(v.item.member_price)}</div>
          <div style={nameStyle}>{v.item.match?.name ?? v.item.description}</div>
          <div style={metaStyle}>{userQtyLabel(v.item)}</div>
        </div>

        <div style={{ minWidth: 0, borderLeft: `1px dashed ${V3.border}`, paddingLeft: 14, opacity: skipped ? 0.55 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, marginBottom: 4, minHeight: 14, flexWrap: 'wrap' }}>
            <div style={labelStyle}>At {chain?.chain_name ?? '—'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {manualPick && (
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: VV.manual, background: VV.manualBg, padding: '1px 6px', borderRadius: 4 }}>
                  ✏ MANUAL
                </span>
              )}
              {skipped && (
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: 4 }}>
                  ✓ SKIPPED
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onOpenSheet(); }}
                style={{
                  background: 'transparent', color: V3.inkMid, border: `1px solid ${V3.border}`,
                  borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 800,
                  letterSpacing: '0.08em', cursor: 'pointer', fontFamily: 'inherit',
                  whiteSpace: 'nowrap', transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = VV.allStoresHover;
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.borderColor = VV.allStoresHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = V3.inkMid;
                  e.currentTarget.style.borderColor = V3.border;
                }}
                aria-label="See prices at all nearby stores"
              >
                ↕ ALL STORES
              </button>
            </div>
          </div>

          {display.kind === 'opt' && altPrice != null ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ ...bigPriceStyle, color: cheaper ? VV.accent : V3.ink }}>{fmt(altPrice)}</span>
                {savings != null && Math.abs(savings) > 0.05 && (
                  <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: cheaper ? VV.accentLight : VV.negative, letterSpacing: '0.04em' }}>
                    {cheaper ? `↓ ${fmtAbs(savings)}` : `↑ ${fmtAbs(savings)}`}
                  </span>
                )}
              </div>
              <div style={nameStyle}>{display.opt.display_name}</div>
              <div style={{ ...metaStyle, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{altPackLabel(display.opt)}</span>
                {showChangeBadge && badgeColor && badgeLabel && (
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', padding: '1px 5px', borderRadius: 3, color: badgeColor.fg, background: badgeColor.bg }}>
                    {badgeLabel}
                  </span>
                )}
              </div>
            </>
          ) : display.kind === 'skip' ? (
            <div style={{ marginTop: 6, fontSize: 12, color: '#f59e0b', fontStyle: 'italic', lineHeight: 1.4 }}>You'd pass on this one here.</div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 12, color: V3.inkLight, fontStyle: 'italic', lineHeight: 1.4 }}>
              {chain?.chain_name ?? 'This chain'} doesn't stock this.
            </div>
          )}
        </div>

        <div style={{ fontSize: 16, color: V3.inkLight, alignSelf: 'center', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', width: 14, textAlign: 'center' }}>›</div>
      </div>

      {expanded && chain && (
        <div style={{ padding: '4px 14px 14px 14px', borderTop: `1px dashed ${V3.border}`, background: VV.accentFaint3 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: V3.inkLight, padding: '10px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>What you'd buy at {chain.chain_name}</span>
            {(manualPick || skipped) && (
              <button
                onClick={() => onSetPick({ kind: 'auto' })}
                style={{ background: 'transparent', border: `1px solid ${V3.border}`, color: V3.inkMid, padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                ↺ AUTO-CHEAPEST
              </button>
            )}
          </div>

          {opts.length === 0 ? (
            <div style={{ padding: '12px 14px', background: V3.chrome, border: `1px dashed ${V3.border}`, borderRadius: 8, fontSize: 12, color: V3.inkLight, lineHeight: 1.5 }}>
              {chain.chain_name} doesn't stock anything matching this item. You'd skip it here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {opts.map((opt) => {
                const isSelected = !skipped && (
                  pick.kind === 'pick' ? pick.canonical_id === opt.canonical_id : opt.canonical_id === opts[0].canonical_id
                );
                return (
                  <OptionRadio key={opt.canonical_id} opt={opt} userPrice={v.item.member_price} selected={isSelected} onSelect={() => onSetPick({ kind: 'pick', canonical_id: opt.canonical_id })} />
                );
              })}
              <button
                onClick={() => onSetPick(skipped ? { kind: 'auto' } : { kind: 'skip' })}
                style={{
                  background: skipped ? 'rgba(245,158,11,0.15)' : 'transparent',
                  border: `1px dashed ${skipped ? '#f59e0b' : V3.border}`,
                  color: skipped ? '#f59e0b' : V3.inkMid,
                  borderRadius: 8, padding: '8px 10px', fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.06em', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginTop: 2,
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

function AllStoresSheet({
  v, chains, chainColor, activeChainId, receiptStoreName, onClose,
}: {
  v: RowVerdict; chains: ChainProjection[]; chainColor: Map<number, string>;
  activeChainId: number | null; receiptStoreName: string; onClose: () => void;
}) {
  const cheapestTotal = useMemo(() => {
    let best: number | null = null;
    for (const chain of chains) {
      for (const opt of chain.options_by_line.get(v.idx) ?? []) {
        const t = effectiveTotal(opt, false);
        if (t == null) continue;
        if (best == null || t < best) best = t;
      }
    }
    return best;
  }, [chains, v.idx]);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', zIndex: 50, animation: 'vsheet-fade 0.18s ease' }} />
      <div
        role="dialog" aria-modal="true"
        aria-label={`Prices at all nearby stores for ${v.item.match?.name ?? v.item.description}`}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 51,
          background: V3.pageAlt,
          borderTop: `1px solid ${V3.borderHi}`, borderLeft: `1px solid ${V3.borderHi}`, borderRight: `1px solid ${V3.borderHi}`,
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          maxWidth: 760, margin: '0 auto', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -20px 50px -10px rgba(0,0,0,0.7)',
          animation: 'vsheet-slide 0.22s cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 38, height: 4, background: V3.border, borderRadius: 999 }} />
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: V3.inkLight, fontSize: 22, padding: '0 4px', fontFamily: 'inherit', lineHeight: 1, position: 'absolute', right: 14, top: 10 }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: '6px 22px 14px', borderBottom: `1px solid ${V3.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 4 }}>
            All stores · {chains.length} nearby
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: V3.ink, lineHeight: 1.25, letterSpacing: '-0.01em' }}>
            {v.item.match?.name ?? v.item.description}
          </div>
          <div style={{ fontSize: 12, color: V3.inkMid, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {userQtyLabel(v.item)} · You paid <strong style={{ color: V3.ink }}>{fmt(v.item.member_price)}</strong> at {receiptStoreName}
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '10px 18px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {chains.map((chain) => {
            const opts = chain.options_by_line.get(v.idx) ?? [];
            const isActive = chain.chain_id === activeChainId;
            const dot = chainColor.get(chain.chain_id) ?? V3.inkMid;
            return (
              <div key={chain.chain_id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: V3.ink, padding: '4px 0 8px', borderBottom: `1px solid ${V3.border}`, marginBottom: 8 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: dot }} />
                  <span style={{ flex: 1 }}>
                    {chain.chain_name.toUpperCase()}
                    <span style={{ color: V3.inkLight, fontWeight: 600, marginLeft: 6 }}>· {chain.distance_miles.toFixed(1)} mi</span>
                  </span>
                  {isActive && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: V3.inkMid, background: V3.chrome, padding: '1px 6px', borderRadius: 4 }}>ACTIVE</span>
                  )}
                </div>

                {opts.length === 0 ? (
                  <div style={{ padding: '10px 12px', fontSize: 12, color: V3.inkLight, fontStyle: 'italic' }}>Not stocked at this store.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {opts.map((opt) => {
                      const total = effectiveTotal(opt, false);
                      const isCheapest = total != null && cheapestTotal != null && total === cheapestTotal;
                      const change = classifyChange(opt.equiv_note, opt.match_type === 'exact');
                      const badgeColor = CHANGE_COLORS[change];
                      const badgeLabel = CHANGE_LABELS[change];
                      const ch = total != null && v.item.member_price - total > 0.05;
                      return (
                        <div key={opt.canonical_id} style={{
                          display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '10px 12px',
                          borderRadius: 10, background: V3.page,
                          border: `1px solid ${isCheapest ? VV.accentBorder35 : V3.border}`,
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 4, color: badgeColor.fg, background: badgeColor.bg }}>{badgeLabel}</span>
                              {isCheapest && (
                                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: VV.accent, background: VV.accentBadgeBg, padding: '1px 6px', borderRadius: 4 }}>★ CHEAPEST</span>
                              )}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: V3.ink, lineHeight: 1.3 }}>{opt.display_name}</div>
                            <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 3, fontVariantNumeric: 'tabular-nums', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <span>{altPackLabel(opt)}</span>
                              {opt.equiv_note && <span>· {opt.equiv_note}</span>}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: ch ? VV.accent : V3.ink }}>{total != null ? fmt(total) : '—'}</div>
                            {total != null && Math.abs(v.item.member_price - total) > 0.05 && (
                              <div style={{ fontSize: 10, fontWeight: 700, color: ch ? VV.accent : VV.negative }}>
                                {ch ? `↓ ${fmtAbs(v.item.member_price - total)}` : `↑ ${fmtAbs(v.item.member_price - total)}`}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 4, lineHeight: 1.4, fontStyle: 'italic', textAlign: 'center' }}>
            Read-only · tap a row in the page underneath to pick what you'd buy.
          </div>
        </div>
      </div>

      <style>{`
        @keyframes vsheet-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes vsheet-slide { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </>
  );
}

function OptionRadio({ opt, userPrice, selected, onSelect }: {
  opt: ChainOption; userPrice: number; selected: boolean; onSelect: () => void;
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
        display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 12, alignItems: 'center',
        padding: '10px 12px', borderRadius: 10,
        background: selected ? VV.accentFaint10 : V3.page,
        border: `1px solid ${selected ? VV.accentBorder : V3.border}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: V3.ink,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: 999,
        border: `2px solid ${selected ? VV.accent : V3.border}`,
        background: selected ? VV.accent : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 4, color: badgeColor.fg, background: badgeColor.bg }}>{badgeLabel}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: V3.ink, lineHeight: 1.3, marginBottom: 2 }}>{opt.display_name}</div>
        {opt.equiv_note && <div style={{ fontSize: 10, color: V3.inkLight, lineHeight: 1.4 }}>{opt.equiv_note}</div>}
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: cheaper ? VV.accent : V3.ink }}>{fmt(displayTotal)}</div>
        {savings != null && Math.abs(savings) > 0.05 && (
          <div style={{ fontSize: 10, fontWeight: 700, color: cheaper ? VV.accent : VV.negative }}>
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
  fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, letterSpacing: '-0.01em',
};
const nameStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: V3.ink, lineHeight: 1.3, marginTop: 6,
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
};
const metaStyle: React.CSSProperties = {
  fontSize: 11, color: V3.inkLight, marginTop: 2, fontVariantNumeric: 'tabular-nums',
};
const topBtn: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${V3.border}`, color: V3.inkMid,
  borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
