'use client';

/**
 * Alt D — Savings Story.
 *
 * Design thesis: A SNAP recipient on a prepaid plan shouldn't have to read a
 * spreadsheet to know what to do. Tell them in plain English: "On these 3
 * items, you overpaid by a lot. On these 4, you got a fair deal. On this one,
 * we couldn't tell." Each finding is a short, scannable sentence; each
 * sentence is a card. No tables, no grids — just guidance.
 *
 * The opportunity is to do what a friend who's watching your money would do:
 * call out specific items by name, give context (distance, brand match), and
 * stop talking when you've made the point.
 */

import { useMemo } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, type ChainProjection } from '../projection';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

interface Insight {
  item: ApiItem;
  idx: number;
  bestChainName: string;
  bestTotal: number;
  bestDistance: number;
  savings: number;
  matchType: 'exact' | 'equivalent';
  equivNote: string | null;
  freshness: 'green' | 'yellow' | 'red';
}

interface FairDeal {
  item: ApiItem;
  idx: number;
  matchedAt: string[];   // chain names where comparable price was found
}

interface Unmatched {
  item: ApiItem;
  idx: number;
}

function buildInsights(compareResp: CompareResponse, chains: ChainProjection[]) {
  const overpaid: Insight[] = [];
  const fair: FairDeal[] = [];
  const unmatched: Unmatched[] = [];

  compareResp.items.forEach((item, idx) => {
    if (item.item_type === 'skip') return;
    if (!item.match) {
      unmatched.push({ item, idx });
      return;
    }
    let bestChainName: string | null = null;
    let bestTotal: number | null = null;
    let bestDistance = 0;
    let bestMatchType: 'exact' | 'equivalent' = 'exact';
    let bestEquivNote: string | null = null;
    let bestFreshness: 'green' | 'yellow' | 'red' = 'green';
    const matchedAt: string[] = [];

    for (const chain of chains) {
      const opts = chain.options_by_line.get(idx);
      if (!opts || opts.length === 0) continue;
      const total = effectiveTotal(opts[0], false);
      if (total == null) continue;
      matchedAt.push(chain.chain_name);
      if (bestTotal == null || total < bestTotal) {
        bestTotal = total;
        bestChainName = chain.chain_name;
        bestDistance = chain.distance_miles;
        bestMatchType = opts[0].match_type;
        bestEquivNote = opts[0].equiv_note;
        bestFreshness = opts[0].freshness;
      }
    }
    if (bestTotal == null || bestChainName == null) {
      unmatched.push({ item, idx });
      return;
    }
    const savings = item.member_price - bestTotal;
    // "Substantial savings" — anything over a dollar OR over 15% of paid price
    const meaningful = savings > 1.0 || savings / item.member_price > 0.15;
    if (savings > 0.1 && meaningful) {
      overpaid.push({
        item, idx,
        bestChainName, bestTotal, bestDistance, savings,
        matchType: bestMatchType,
        equivNote: bestEquivNote,
        freshness: bestFreshness,
      });
    } else {
      fair.push({ item, idx, matchedAt });
    }
  });

  // Sort overpaid by raw dollar savings (descending) — biggest losses first.
  overpaid.sort((a, b) => b.savings - a.savings);
  return { overpaid, fair, unmatched };
}

export default function CompareAltD({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const { overpaid, fair, unmatched } = useMemo(() => buildInsights(compareResp, chains), [compareResp, chains]);

  const userPaid = compareResp.items.reduce((s, i) => i.item_type !== 'skip' ? s + i.member_price : s, 0);
  const totalSavings = overpaid.reduce((s, ins) => s + ins.savings, 0);

  // Find the most-mentioned chain — the one to highlight as "the move".
  const chainCounts = new Map<string, number>();
  let topChain: string | null = null;
  let topCount = 0;
  for (const ins of overpaid) {
    const c = (chainCounts.get(ins.bestChainName) ?? 0) + 1;
    chainCounts.set(ins.bestChainName, c);
    if (c > topCount) { topCount = c; topChain = ins.bestChainName; }
  }

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date}
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 20px 60px' }}>
        {/* ── Story opening ───────────────────────────────────────────── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: V3.inkLight, marginBottom: 12 }}>
            Looking at your trip
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, margin: 0, color: V3.ink }}>
            On this <span style={{ color: V3.inkMid }}>{fmt(userPaid)}</span> trip to {compareResp.receipt.store_name},{' '}
            {totalSavings > 0.05 ? (
              <>you spent <span style={{ color: '#4ade80' }}>{fmtAbs(totalSavings)} more</span> than you needed to.</>
            ) : (
              <>nothing nearby would have been cheaper.</>
            )}
          </h1>
          {totalSavings > 0.05 && topChain && (
            <p style={{ fontSize: 16, color: V3.inkMid, marginTop: 14, lineHeight: 1.55 }}>
              Most of those savings sit at <strong style={{ color: V3.ink }}>{topChain}</strong> — they had the cheapest price on {topCount} of your items.
            </p>
          )}
        </div>

        {/* ── Where you overpaid ──────────────────────────────────────── */}
        {overpaid.length > 0 && (
          <Section
            label="Where you overpaid"
            subtitle={`${overpaid.length} item${overpaid.length > 1 ? 's' : ''} where a nearby store had a meaningfully better price`}
            color="#4ade80"
          >
            {overpaid.map((ins) => (
              <OverpaidCard key={ins.idx} ins={ins} />
            ))}
          </Section>
        )}

        {/* ── Fair deals ──────────────────────────────────────────────── */}
        {fair.length > 0 && (
          <Section
            label="What was a fair deal"
            subtitle={`${fair.length} item${fair.length > 1 ? 's' : ''} where ${compareResp.receipt.store_name} priced it in line with nearby competitors`}
            color={V3.inkMid}
          >
            <div style={{ background: V3.pageAlt, border: `1px solid ${V3.border}`, borderRadius: 12, padding: '12px 16px' }}>
              {fair.map((f, i) => (
                <div key={f.idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: i === fair.length - 1 ? 'none' : `1px solid ${V3.border}`,
                  fontSize: 13,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ color: '#22c55e', fontSize: 14 }}>✓</span>
                    <span style={{ color: V3.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.item.match?.name ?? f.item.description}
                    </span>
                  </div>
                  <span style={{ color: V3.inkLight, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                    {fmt(f.item.member_price)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Couldn't compare ────────────────────────────────────────── */}
        {unmatched.length > 0 && (
          <Section
            label="What we couldn't compare"
            subtitle={`No nearby store has reported recent prices for ${unmatched.length === 1 ? 'this item' : 'these items'}`}
            color={V3.inkLight}
          >
            <div style={{ background: V3.pageAlt, border: `1px dashed ${V3.border}`, borderRadius: 12, padding: '12px 16px' }}>
              {unmatched.map((u, i) => (
                <div key={u.idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: i === unmatched.length - 1 ? 'none' : `1px solid ${V3.border}`,
                  fontSize: 13,
                }}>
                  <span style={{ color: V3.inkMid, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.item.description}
                  </span>
                  <span style={{ color: V3.inkLight, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                    {fmt(u.item.member_price)}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 8, lineHeight: 1.5 }}>
                These don't count toward the savings number above.
              </div>
            </div>
          </Section>
        )}

        {/* Footer */}
        <div style={{ marginTop: 36, fontSize: 11, color: V3.inkLight, textAlign: 'center', lineHeight: 1.5 }}>
          Comparisons use shelf prices from receipts uploaded by other shoppers in the last 30 days.<br />
          Distances are from {compareResp.receipt.store_name}.
        </div>
      </div>
    </div>
  );
}

function Section({ label, subtitle, color, children }: {
  label: string;
  subtitle: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: color }} />
        <h2 style={{ fontSize: 18, fontWeight: 800, color: V3.ink, margin: 0, letterSpacing: '-0.01em' }}>
          {label}
        </h2>
      </div>
      <div style={{ fontSize: 12, color: V3.inkLight, marginBottom: 12, paddingLeft: 20 }}>
        {subtitle}
      </div>
      {children}
    </div>
  );
}

function OverpaidCard({ ins }: { ins: Insight }) {
  const pct = (ins.savings / ins.item.member_price) * 100;
  const itemName = ins.item.match?.name ?? ins.item.description;

  return (
    <div style={{
      background: V3.pageAlt,
      border: `1px solid ${V3.border}`,
      borderRadius: 14,
      padding: '16px 18px',
      marginBottom: 10,
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 16,
      alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: V3.ink, marginBottom: 4, lineHeight: 1.3 }}>
          {itemName}
        </div>
        <div style={{ fontSize: 13, color: V3.inkMid, lineHeight: 1.55 }}>
          You paid <span style={{ fontWeight: 700, color: V3.ink, fontVariantNumeric: 'tabular-nums' }}>{fmt(ins.item.member_price)}</span>.{' '}
          At <strong style={{ color: V3.ink }}>{ins.bestChainName}</strong>{' '}
          ({ins.bestDistance.toFixed(1)} mi),{' '}
          {ins.matchType === 'equivalent' ? 'a similar one' : "the same"} costs <span style={{ fontWeight: 700, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>{fmt(ins.bestTotal)}</span>.
        </div>
        {ins.equivNote && (
          <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 4, fontStyle: 'italic' }}>
            ~ {ins.equivNote}
          </div>
        )}
        {ins.freshness === 'red' && (
          <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>
            ⚠ Their price might be stale — over 30 days old
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: V3.inkLight, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          You'd save
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#4ade80', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
          {fmtAbs(ins.savings)}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: V3.inkLight, marginTop: 2 }}>
          {pct.toFixed(0)}% off
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
