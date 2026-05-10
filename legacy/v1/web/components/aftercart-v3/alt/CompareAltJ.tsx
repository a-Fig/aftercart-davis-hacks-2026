'use client';

/**
 * Alt J — Price-Range Receipt.
 *
 * Design thesis: Saying "$5.16 at Grocery Outlet" tells the user the price
 * but not the *market context*. Did they get an OK deal or a terrible one?
 * Was the cheapest option really worth driving for, or was the spread tiny?
 * Render each item's available prices as a horizontal spectrum — cheapest on
 * the left, most expensive on the right, with a marker for every chain's
 * substitute and a clearly-labeled "YOU" marker showing where the user
 * landed. The bar makes "your price was at the cheap end" or "you overpaid
 * by a wide margin" visible in one glance, before any reading.
 *
 * Substitution awareness is preserved: every marker on the bar is a real
 * shelf product, listed below with brand, change badge, total, and percent.
 * Receipt aesthetic stays so the page feels like a souped-up version of the
 * thing the user already photographed.
 */

import { useMemo } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, type ChainOption, type ChainProjection } from '../projection';
import { classifyChange, CHANGE_LABELS, CHANGE_COLORS } from '@/app/v3/compare-alt/mock-data';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

// Per-chain accent colors used on the price bar. Distinct hues so a marker's
// chain is recognizable without looking at the legend.
const CHAIN_COLOR: Record<number, string> = {
  1: '#f59e0b',  // Safeway — amber (where the user actually shopped)
  2: '#22c55e',  // Grocery Outlet — green
  3: '#ef4444',  // Trader Joe's — red
  4: '#3b82f6',  // Costco — blue
};

interface SpreadEntry {
  chain_id: number;
  chain_name: string;
  total: number;
  opt: ChainOption;
  isCheapest: boolean;
}

interface Row {
  item: ApiItem;
  idx: number;
  entries: SpreadEntry[];
  cheapestId: number | null;
  spreadMin: number;
  spreadMax: number;
  totalOptions: number;
  notStockedAt: string[];
}

function buildRows(compareResp: CompareResponse, chains: ChainProjection[]): Row[] {
  return compareResp.items
    .map((item, idx): Row | null => {
      if (item.item_type === 'skip') return null;
      const entries: SpreadEntry[] = [];
      const notStockedAt: string[] = [];
      let totalOptions = 0;
      for (const chain of chains) {
        const opts = chain.options_by_line.get(idx) ?? [];
        if (opts.length === 0) {
          notStockedAt.push(chain.chain_name);
          continue;
        }
        const cheapestOpt = opts[0];
        const t = effectiveTotal(cheapestOpt, false);
        if (t == null) continue;
        entries.push({
          chain_id: chain.chain_id,
          chain_name: chain.chain_name,
          total: t,
          opt: cheapestOpt,
          isCheapest: false,
        });
        totalOptions += opts.length;
      }
      // Add the user's actual price as a marker too — it's a meaningful point
      // on the spectrum even when no comparison shifts it.
      const userTotal = item.member_price;
      const allTotals = [userTotal, ...entries.map((e) => e.total)];
      const min = Math.min(...allTotals);
      const max = Math.max(...allTotals);
      let cheapestId: number | null = null;
      let cheapest = userTotal;  // User's chain wins ties
      for (const e of entries) {
        if (e.total < cheapest - 0.005) {
          cheapest = e.total;
          cheapestId = e.chain_id;
          e.isCheapest = false;
        }
      }
      // After loop pick the actually-cheapest entry
      let cheapestEntry: SpreadEntry | null = null;
      for (const e of entries) {
        if (cheapestEntry == null || e.total < cheapestEntry.total) cheapestEntry = e;
      }
      if (cheapestEntry && cheapestEntry.total < userTotal - 0.005) {
        cheapestEntry.isCheapest = true;
        cheapestId = cheapestEntry.chain_id;
      }
      return { item, idx, entries, cheapestId, spreadMin: min, spreadMax: max, totalOptions, notStockedAt };
    })
    .filter((r): r is Row => r !== null);
}

export default function CompareAltJ({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const rows = useMemo(() => buildRows(compareResp, chains), [compareResp, chains]);

  const userTotal = rows.reduce((s, r) => s + r.item.member_price, 0);
  const couldHavePaid = rows.reduce((s, r) => {
    if (r.cheapestId == null) return s + r.item.member_price;
    const e = r.entries.find((x) => x.chain_id === r.cheapestId);
    return s + (e ? e.total : r.item.member_price);
  }, 0);
  const totalSavings = userTotal - couldHavePaid;

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          Price-spectrum receipt
        </div>
      </div>

      <div style={{ padding: '36px 20px 60px', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          background: V3.paper,
          color: V3.paperInk,
          width: '100%',
          maxWidth: 620,
          padding: '32px 26px 26px',
          borderRadius: 4,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.25)',
          position: 'relative',
        }}>
          <div aria-hidden style={{
            position: 'absolute',
            top: -6,
            left: 0,
            right: 0,
            height: 8,
            background: V3.paper,
            clipPath: 'polygon(0 100%, 4% 30%, 8% 100%, 12% 30%, 16% 100%, 20% 30%, 24% 100%, 28% 30%, 32% 100%, 36% 30%, 40% 100%, 44% 30%, 48% 100%, 52% 30%, 56% 100%, 60% 30%, 64% 100%, 68% 30%, 72% 100%, 76% 30%, 80% 100%, 84% 30%, 88% 100%, 92% 30%, 96% 100%, 100% 30%, 100% 100%)',
          }} />

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div className="v3-mono" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.14em' }}>
              {(compareResp.receipt.store_name ?? 'RECEIPT').toUpperCase()}
            </div>
            {compareResp.receipt.store_address && (
              <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 4 }}>
                {compareResp.receipt.store_address}
              </div>
            )}
            {compareResp.receipt.receipt_date && (
              <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 2 }}>
                {compareResp.receipt.receipt_date}
              </div>
            )}
            <div className="v3-mono" style={{ fontSize: 9, color: V3.edited, marginTop: 8, fontWeight: 700, letterSpacing: '0.12em' }}>
              ✱ WITH NEARBY PRICE SPECTRUM ✱
            </div>
          </div>

          {/* Chain legend */}
          <div className="v3-mono" style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 6, marginBottom: 10, flexWrap: 'wrap', fontSize: 9 }}>
            {chains.map((c) => (
              <span key={c.chain_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: CHAIN_COLOR[c.chain_id] ?? V3.paperMid, display: 'inline-block' }} />
                <span style={{ color: V3.paperMute, letterSpacing: '0.06em' }}>{c.chain_name.toUpperCase()}</span>
              </span>
            ))}
          </div>

          <Divider />

          {/* Items with price bars */}
          <div>
            {rows.map((r) => <SpectrumItem key={r.idx} row={r} />)}
          </div>

          <Divider />

          {/* Totals */}
          <div className="v3-mono" style={{ fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: V3.paperMute, letterSpacing: '0.06em' }}>YOUR TOTAL</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(userTotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: V3.paperMute, letterSpacing: '0.06em' }}>CHEAPEST AVAILABLE</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt(couldHavePaid)}</span>
            </div>
          </div>

          {totalSavings > 0.05 && (
            <div style={{
              marginTop: 14,
              padding: '14px 16px',
              background: V3.savePaper,
              border: `1px solid ${V3.saveOutline}`,
              borderRadius: 4,
              textAlign: 'center',
            }}>
              <div className="v3-mono" style={{ fontSize: 10, color: V3.saveInk, fontWeight: 800, letterSpacing: '0.16em' }}>
                CHERRY-PICKING THE CHEAPEST EVERYWHERE
              </div>
              <div className="v3-mono" style={{ fontSize: 28, color: V3.saveInk, fontWeight: 900, marginTop: 4, letterSpacing: '-0.02em' }}>
                ↓ {fmtAbs(totalSavings)}
              </div>
              <div className="v3-mono" style={{ fontSize: 10, color: V3.saveInk, opacity: 0.85, marginTop: 2, fontWeight: 700, letterSpacing: '0.08em' }}>
                {((totalSavings / userTotal) * 100).toFixed(0)}% LESS
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Per-item price spectrum ─────────────────────────────────────────────────

function SpectrumItem({ row }: { row: Row }) {
  const item = row.item;
  const itemName = (item.match?.brand
    ? `${item.match.brand} ${item.match.name ?? item.description}`
    : (item.match?.name ?? item.description)).toUpperCase();
  const sizeTxt = item.match?.package_size && item.match?.package_unit
    ? `${item.match.package_size} ${item.match.package_unit}`
    : item.quantity != null && item.unit && item.unit !== 'each'
      ? `${item.quantity} ${item.unit}`
      : '';
  const unmatched = !item.match;
  const userTotal = item.member_price;

  // Bar math: distribute markers along [0, 1] proportional to total within
  // [spreadMin, spreadMax]. When all prices are equal (or only one
  // observation), pin everything at center.
  const span = Math.max(0.01, row.spreadMax - row.spreadMin);
  const pct = (v: number) => ((v - row.spreadMin) / span) * 100;
  const userPct = pct(userTotal);

  return (
    <div style={{ padding: '10px 0', borderBottom: `1px dashed ${V3.paperFaint}` }}>
      {/* Name + price */}
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, alignItems: 'baseline' }}>
        <span style={{ flex: 1, marginRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {itemName}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(userTotal)}</span>
      </div>
      {sizeTxt && (
        <div className="v3-mono" style={{ fontSize: 9, color: V3.paperMute, paddingLeft: 2, marginTop: 1 }}>
          {sizeTxt} · You paid this amount
        </div>
      )}

      {/* Bar */}
      {!unmatched && row.entries.length > 0 && (
        <div style={{ marginTop: 10, paddingLeft: 4, paddingRight: 4 }}>
          <div style={{
            position: 'relative',
            height: 30,
            // Track
            background: 'transparent',
          }}>
            {/* Track line */}
            <div style={{
              position: 'absolute',
              top: 14,
              left: 0,
              right: 0,
              height: 2,
              background: `linear-gradient(to right, ${V3.savePaper}, ${V3.paperShade}, ${V3.overPaper})`,
              borderRadius: 999,
            }} />
            {/* End labels */}
            <div className="v3-mono" style={{
              position: 'absolute',
              top: -2,
              left: -2,
              fontSize: 8,
              color: V3.saveInk,
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}>
              {fmt(row.spreadMin)}
            </div>
            <div className="v3-mono" style={{
              position: 'absolute',
              top: -2,
              right: -2,
              fontSize: 8,
              color: V3.overInk,
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}>
              {fmt(row.spreadMax)}
            </div>
            {/* User marker (always present) */}
            <SpectrumMarker
              left={userPct}
              color={V3.paperInk}
              label="YOU"
              isYou
              total={userTotal}
            />
            {/* Per-chain markers */}
            {row.entries.map((e) => (
              <SpectrumMarker
                key={e.chain_id}
                left={pct(e.total)}
                color={CHAIN_COLOR[e.chain_id] ?? V3.paperMid}
                label={e.chain_name.split(' ')[0].slice(0, 3).toUpperCase()}
                isCheapest={e.isCheapest}
                total={e.total}
              />
            ))}
          </div>
        </div>
      )}

      {/* Per-chain substitute lines */}
      {!unmatched && (
        <div style={{ marginTop: 10, paddingLeft: 4 }}>
          {row.entries.map((e) => (
            <ChainSubLine key={e.chain_id} entry={e} userTotal={userTotal} />
          ))}
          {row.notStockedAt.length > 0 && (
            <div className="v3-mono" style={{ fontSize: 9, color: V3.paperFaint, padding: '3px 0', fontStyle: 'italic' }}>
              × NOT STOCKED AT {row.notStockedAt.map((s) => s.toUpperCase()).join(', ')}
            </div>
          )}
        </div>
      )}

      {unmatched && (
        <div className="v3-mono" style={{ fontSize: 9, color: V3.paperFaint, paddingLeft: 4, marginTop: 6, fontStyle: 'italic' }}>
          ? no nearby comparison
        </div>
      )}
    </div>
  );
}

function SpectrumMarker({ left, color, label, isYou, isCheapest, total }: {
  left: number;
  color: string;
  label: string;
  isYou?: boolean;
  isCheapest?: boolean;
  total?: number;
}) {
  const clamped = Math.max(0, Math.min(100, left));
  return (
    <div style={{
      position: 'absolute',
      left: `${clamped}%`,
      top: 0,
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      pointerEvents: 'none',
    }}>
      {/* Tick + dot */}
      <div style={{
        marginTop: 8,
        width: isYou ? 14 : 10,
        height: isYou ? 14 : 10,
        borderRadius: 999,
        background: color,
        border: isYou ? `2px solid ${V3.paper}` : isCheapest ? `2px solid ${V3.saveInk}` : 'none',
        boxShadow: isYou
          ? `0 0 0 2px ${V3.paperInk}`
          : isCheapest
            ? `0 0 0 1px ${V3.saveInk}`
            : 'none',
        zIndex: isYou ? 3 : isCheapest ? 2 : 1,
      }} />
      {/* Label below */}
      <div className="v3-mono" style={{
        marginTop: 2,
        fontSize: 7,
        fontWeight: 800,
        letterSpacing: '0.04em',
        color: isYou ? V3.paperInk : color,
        whiteSpace: 'nowrap',
        textShadow: `0 0 2px ${V3.paper}, 0 0 2px ${V3.paper}`,
      }}>
        {isCheapest ? '★ ' : ''}{label}
      </div>
    </div>
  );
}

function ChainSubLine({ entry, userTotal }: { entry: SpreadEntry; userTotal: number }) {
  const savings = userTotal - entry.total;
  const cheaper = savings > 0.05;
  const more = savings < -0.05;
  const change = classifyChange(entry.opt.equiv_note, entry.opt.match_type === 'exact');
  const badgeColor = CHANGE_COLORS[change];
  const badgeLabel = CHANGE_LABELS[change];
  const dotColor = CHAIN_COLOR[entry.chain_id] ?? V3.paperMid;

  return (
    <div style={{ padding: '4px 0' }}>
      <div className="v3-mono" style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 10.5 }}>
        {entry.isCheapest ? (
          <span style={{ width: 12, fontSize: 11, color: V3.saveInk, fontWeight: 700 }}>★</span>
        ) : (
          <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: dotColor }} />
          </span>
        )}
        <span style={{
          flex: '0 0 60px',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: V3.paperMid,
        }}>
          {entry.chain_name.toUpperCase()}
        </span>
        <span style={{
          flex: 1,
          color: V3.paperInk,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {entry.opt.display_name}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: cheaper ? V3.saveInk : more ? V3.overInk : V3.paperInk, flexShrink: 0 }}>
          {fmt(entry.total)}
        </span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: cheaper ? V3.saveInk : more ? V3.overInk : V3.paperMute,
          minWidth: 36,
          textAlign: 'right',
          flexShrink: 0,
        }}>
          {Math.abs(savings) > 0.05 ? `${cheaper ? '↓' : '↑'}${((Math.abs(savings) / userTotal) * 100).toFixed(0)}%` : '='}
        </span>
      </div>
      <div className="v3-mono" style={{ fontSize: 8.5, color: V3.paperMute, paddingLeft: 78, marginTop: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '1px 4px',
          borderRadius: 2,
          color: badgeColor.fg,
          background: badgeColor.bg,
        }}>
          {badgeLabel}
        </span>
        {entry.opt.equiv_note && (
          <span style={{ fontStyle: 'italic' }}>{entry.opt.equiv_note.toLowerCase()}</span>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div className="v3-mono" style={{ textAlign: 'center', fontSize: 10, color: V3.paperFaint, padding: '8px 0', letterSpacing: '0.08em' }}>
      — — — — — — — — — — — — — — —
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
