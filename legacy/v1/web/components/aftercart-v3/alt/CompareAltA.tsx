'use client';

/**
 * Alt A — Verdict First.
 *
 * Design thesis: The product spec says "User sees a single headline number."
 * Today's V3Compare buries it at the bottom of each receipt column. Alt A
 * promotes it: a single hero card answers "what should I do?" before any
 * itemization. Below the hero, items are grouped by category and each row
 * shows where its cheapest nearby price lives.
 */

import { useMemo, useState } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, totalSavingsForChain, type ChainProjection } from '../projection';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

// Manual category map — in production this would join from canonical_products.
// Hardcoded here for the demo so the page doesn't require an API change.
const CATEGORY_BY_CANONICAL: Record<number, string> = {
  17: 'Meat & Seafood', 18: 'Meat & Seafood',
  12: 'Dairy', 53: 'Dairy', 64: 'Dairy',
  91: 'Produce', 42: 'Produce',
  73: 'Bread & Bakery',
};
const CATEGORY_ICON: Record<string, string> = {
  'Meat & Seafood': '🥩', 'Dairy': '🥛', 'Produce': '🥦', 'Bread & Bakery': '🍞', 'Other': '🧴',
};

interface RowVerdict {
  item: ApiItem;
  idx: number;
  bestChain: { name: string; total: number; chain_id: number } | null;
  bestSavings: number;       // user_paid - best_alt_total (positive = cheaper elsewhere)
  category: string;
  unmatched: boolean;
}

function buildVerdicts(compareResp: CompareResponse, chains: ChainProjection[]): RowVerdict[] {
  return compareResp.items
    .map((item, idx): RowVerdict | null => {
      if (item.item_type === 'skip') return null;
      const cat = item.match?.canonical_id != null
        ? (CATEGORY_BY_CANONICAL[item.match.canonical_id] ?? 'Other')
        : 'Other';
      if (!item.match) {
        return { item, idx, bestChain: null, bestSavings: 0, category: cat, unmatched: true };
      }
      let best: { name: string; total: number; chain_id: number } | null = null;
      for (const chain of chains) {
        const opts = chain.options_by_line.get(idx);
        if (!opts || opts.length === 0) continue;
        const total = effectiveTotal(opts[0], false);
        if (total == null) continue;
        if (best == null || total < best.total) {
          best = { name: chain.chain_name, total, chain_id: chain.chain_id };
        }
      }
      const savings = best ? item.member_price - best.total : 0;
      return { item, idx, bestChain: best, bestSavings: savings, category: cat, unmatched: false };
    })
    .filter((v): v is RowVerdict => v !== null);
}

export default function CompareAltA({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const verdicts = useMemo(() => buildVerdicts(compareResp, chains), [compareResp, chains]);

  // Top-of-page chain selection — the hero shows ONE chain's verdict at a time.
  const [selectedChainId, setSelectedChainId] = useState<number | null>(chains[0]?.chain_id ?? null);

  // Aggregate savings per chain (volume-normalized totals).
  const chainSummaries = useMemo(() => {
    return chains.map((chain) => {
      let chainTotal = 0;
      let userPaid = 0;
      let covered = 0;
      let totalEligible = 0;
      for (const item of compareResp.items) {
        if (item.item_type === 'skip') continue;
        totalEligible += 1;
      }
      compareResp.items.forEach((item, idx) => {
        if (item.item_type === 'skip') return;
        const opts = chain.options_by_line.get(idx);
        if (!opts || opts.length === 0) return;
        const total = effectiveTotal(opts[0], false);
        if (total == null) return;
        chainTotal += total;
        userPaid += item.member_price;
        covered += 1;
      });
      return {
        chain_id: chain.chain_id,
        chain_name: chain.chain_name,
        distance: chain.distance_miles,
        chainTotal,
        userPaid,
        savings: userPaid - chainTotal,
        covered,
        totalEligible,
        savingsRaw: totalSavingsForChain(chain, compareResp),
      };
    });
  }, [chains, compareResp]);

  const selected = chainSummaries.find((s) => s.chain_id === selectedChainId) ?? chainSummaries[0];

  // Group verdicts by category, preserving original order.
  const grouped = useMemo(() => {
    const buckets: Record<string, RowVerdict[]> = {};
    const order: string[] = [];
    for (const v of verdicts) {
      if (!buckets[v.category]) { buckets[v.category] = []; order.push(v.category); }
      buckets[v.category].push(v);
    }
    return { buckets, order };
  }, [verdicts]);

  const userTotal = compareResp.items.reduce((s, i) => i.item_type !== 'skip' ? s + i.member_price : s, 0);

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      {/* Top bar */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date}
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 60px' }}>
        {/* ── Hero verdict card ───────────────────────────────────────── */}
        {selected && selected.savings > 0.5 && (
          <div style={{
            background: 'linear-gradient(135deg, #1f7a3a 0%, #2c9b4a 100%)',
            borderRadius: 16,
            padding: '28px 24px',
            color: '#fff',
            marginBottom: 16,
            boxShadow: '0 10px 40px -10px rgba(31,122,58,0.4)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 8 }}>
              You could have paid less at
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
              {selected.chain_name}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 18 }}>
              {selected.distance.toFixed(1)} mi away · {selected.covered} of {selected.totalEligible} items priced
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>You'd save</div>
                <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {fmtAbs(selected.savings)}
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.9, padding: '4px 10px', background: 'rgba(255,255,255,0.18)', borderRadius: 999 }}>
                {((selected.savings / selected.userPaid) * 100).toFixed(0)}% off
              </div>
            </div>
            <div style={{ marginTop: 18, fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
              Your <strong>{fmt(selected.userPaid)}</strong> trip would cost <strong>{fmt(selected.chainTotal)}</strong> at {selected.chain_name}.
            </div>
          </div>
        )}

        {/* When best chain is more expensive (rare) */}
        {selected && selected.savings <= 0.5 && (
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
              No nearby store would have been cheaper
            </div>
            <div style={{ fontSize: 13, color: V3.inkMid }}>
              Your $-{selected.userPaid.toFixed(2)} trip is in line with what {selected.chain_name} charges nearby.
            </div>
          </div>
        )}

        {/* ── Other chains tabs ───────────────────────────────────────── */}
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
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.chain_name}</span>
                    <span style={{ fontSize: 10, color: V3.inkLight }}>{s.distance.toFixed(1)} mi</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: cheap ? '#4ade80' : V3.inkMid, marginTop: 2 }}>
                      {cheap ? `↓ ${fmtAbs(s.savings)}` : 'No savings'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Breakdown by category ────────────────────────────────────── */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 12, paddingLeft: 4 }}>
          Item-by-item breakdown
        </div>

        {grouped.order.map((cat) => {
          const items = grouped.buckets[cat];
          if (cat === 'Other' && items.every((v) => v.unmatched)) return null;
          if (items.every((v) => v.unmatched)) return null;
          return (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: V3.ink, marginBottom: 8, paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{CATEGORY_ICON[cat] ?? '•'}</span>
                <span>{cat}</span>
              </div>
              <div style={{ background: V3.pageAlt, borderRadius: 12, border: `1px solid ${V3.border}`, overflow: 'hidden' }}>
                {items.filter((v) => !v.unmatched).map((v, i) => (
                  <BreakdownRow key={v.idx} v={v} isLast={i === items.length - 1} selectedChainId={selected?.chain_id ?? null} chains={chains} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Unmatched section */}
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

        {/* Receipt footer */}
        <div style={{ marginTop: 24, padding: '16px', background: V3.pageAlt, border: `1px solid ${V3.border}`, borderRadius: 12, fontSize: 13, color: V3.inkMid, display: 'flex', justifyContent: 'space-between' }}>
          <span>Your trip ({compareResp.receipt.store_name})</span>
          <span style={{ fontWeight: 700, color: V3.ink }}>{fmt(userTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({ v, isLast, selectedChainId, chains }: {
  v: RowVerdict;
  isLast: boolean;
  selectedChainId: number | null;
  chains: ChainProjection[];
}) {
  // Show the SELECTED chain's price if it has one, else the absolute best.
  const selectedChain = chains.find((c) => c.chain_id === selectedChainId);
  const selectedOpts = selectedChain?.options_by_line.get(v.idx) ?? [];
  const selectedTotal = selectedOpts.length ? effectiveTotal(selectedOpts[0], false) : null;
  const selectedSavings = selectedTotal != null ? v.item.member_price - selectedTotal : null;
  const fallbackToBest = selectedTotal == null && v.bestChain != null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 12,
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `1px solid ${V3.border}`,
      alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: V3.ink, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.item.match?.name ?? v.item.description}
        </div>
        <div style={{ fontSize: 11, color: V3.inkLight, fontVariantNumeric: 'tabular-nums' }}>
          {v.item.quantity != null && v.item.unit && v.item.unit !== 'each' ? `${v.item.quantity} ${v.item.unit} · ` : ''}
          You paid {fmt(v.item.member_price)}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {selectedTotal != null ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: V3.ink }}>
              {fmt(selectedTotal)}
            </div>
            <div style={{ fontSize: 10, color: (selectedSavings ?? 0) > 0 ? '#4ade80' : V3.inkLight, fontWeight: 600, marginTop: 2 }}>
              {(selectedSavings ?? 0) > 0.05
                ? `↓ ${fmtAbs(selectedSavings ?? 0)} cheaper`
                : (selectedSavings ?? 0) < -0.05
                  ? `↑ ${fmtAbs(selectedSavings ?? 0)} more`
                  : 'same'}
            </div>
          </>
        ) : fallbackToBest && v.bestChain ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#4ade80' }}>{fmt(v.bestChain.total)}</div>
            <div style={{ fontSize: 10, color: V3.inkLight, fontWeight: 600, marginTop: 2 }}>
              at {v.bestChain.name}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: V3.inkLight }}>not priced here</div>
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
