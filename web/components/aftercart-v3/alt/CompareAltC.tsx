'use client';

/**
 * Alt C — Strikethrough Receipt.
 *
 * Design thesis: Take the user's actual receipt and *rewrite* it. Cross out
 * each price they overpaid on, write the cheaper nearby price next to it,
 * stamp the chain that has it. The "what could have been" total at the
 * bottom is the most emotionally direct way to surface savings — it's the
 * shape the user already understands (a receipt) but transformed.
 *
 * Best for the SNAP-recipient primary user: minimum cognitive overhead,
 * maximum emotional resonance, no chart/table to interpret.
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

interface AnnotatedRow {
  item: ApiItem;
  idx: number;
  bestChainName: string | null;
  bestTotal: number | null;
  savings: number;             // user_paid - bestTotal (positive = cheaper alt exists)
  unmatched: boolean;
  matchType: 'exact' | 'equivalent' | null;
}

function buildRows(compareResp: CompareResponse, chains: ChainProjection[]): AnnotatedRow[] {
  return compareResp.items
    .map((item, idx): AnnotatedRow | null => {
      if (item.item_type === 'skip') return null;
      if (!item.match) {
        return { item, idx, bestChainName: null, bestTotal: null, savings: 0, unmatched: true, matchType: null };
      }
      let bestChainName: string | null = null;
      let bestTotal: number | null = null;
      let bestMatchType: 'exact' | 'equivalent' | null = null;
      for (const chain of chains) {
        const opts = chain.options_by_line.get(idx);
        if (!opts || opts.length === 0) continue;
        const total = effectiveTotal(opts[0], false);
        if (total == null) continue;
        if (bestTotal == null || total < bestTotal) {
          bestTotal = total;
          bestChainName = chain.chain_name;
          bestMatchType = opts[0].match_type;
        }
      }
      const savings = bestTotal != null ? item.member_price - bestTotal : 0;
      return { item, idx, bestChainName, bestTotal, savings, unmatched: false, matchType: bestMatchType };
    })
    .filter((r): r is AnnotatedRow => r !== null);
}

export default function CompareAltC({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const rows = useMemo(() => buildRows(compareResp, chains), [compareResp, chains]);

  const userPaid = rows.reduce((s, r) => s + r.item.member_price, 0);
  const couldHavePaid = rows.reduce((s, r) => s + (r.bestTotal ?? r.item.member_price), 0);
  const totalSavings = userPaid - couldHavePaid;

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>Annotated receipt</div>
      </div>

      <div style={{ padding: '36px 20px 60px', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          background: V3.paper,
          color: V3.paperInk,
          width: '100%',
          maxWidth: 460,
          padding: '32px 28px 26px',
          borderRadius: 4,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.25)',
          position: 'relative',
        }}>
          {/* Tear edge top */}
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
            <div className="v3-mono" style={{
              fontSize: 9,
              color: V3.edited,
              marginTop: 8,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>
              ✱ ReceiptCheck Annotated ✱
            </div>
          </div>

          <Divider />

          {/* Items */}
          <div>
            {rows.map((row) => (
              <AnnotatedLine key={row.idx} row={row} />
            ))}
          </div>

          <Divider />

          {/* Totals breakdown */}
          <div className="v3-mono" style={{ fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ color: V3.paperMute }}>YOU PAID</span>
              <span style={{ textDecoration: totalSavings > 0.05 ? 'line-through' : 'none', color: totalSavings > 0.05 ? V3.paperMute : V3.paperInk }}>
                {fmt(userPaid)}
              </span>
            </div>
            {totalSavings > 0.05 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: V3.paperInk, fontWeight: 700 }}>COULD HAVE PAID</span>
                <span style={{ color: V3.paperInk, fontWeight: 700 }}>
                  {fmt(couldHavePaid)}
                </span>
              </div>
            )}
          </div>

          {/* Big savings stamp */}
          {totalSavings > 0.05 && (
            <div style={{
              marginTop: 18,
              padding: '20px 16px',
              background: V3.savePaper,
              border: `2px dashed ${V3.saveOutline}`,
              borderRadius: 4,
              textAlign: 'center',
              transform: 'rotate(-1.5deg)',
            }}>
              <div className="v3-mono" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: V3.saveInk }}>
                YOU OVERPAID BY
              </div>
              <div className="v3-mono" style={{ fontSize: 38, fontWeight: 900, color: V3.saveInk, lineHeight: 1.05, marginTop: 4, letterSpacing: '-0.02em' }}>
                {fmtAbs(totalSavings)}
              </div>
              <div className="v3-mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: V3.saveInk, opacity: 0.85, marginTop: 6 }}>
                THAT'S {((totalSavings / userPaid) * 100).toFixed(0)}% MORE THAN NEEDED
              </div>
            </div>
          )}

          {totalSavings <= 0.05 && (
            <div style={{
              marginTop: 18,
              padding: '20px 16px',
              background: V3.noneBg,
              border: `1px solid ${V3.paperLine}`,
              borderRadius: 4,
              textAlign: 'center',
            }}>
              <div className="v3-mono" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: V3.paperMid }}>
                NO CHEAPER NEARBY OPTION FOUND
              </div>
              <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 6, lineHeight: 1.5 }}>
                {compareResp.receipt.store_name} priced this trip in line with nearby competitors.
              </div>
            </div>
          )}

          {/* Coverage caveat */}
          {rows.some((r) => r.unmatched) && (
            <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 14, padding: '10px 12px', border: `1px dashed ${V3.paperLine}`, borderRadius: 4, lineHeight: 1.5 }}>
              {rows.filter((r) => r.unmatched).length} item{rows.filter((r) => r.unmatched).length > 1 ? 's' : ''} couldn't be matched to nearby prices. They're left in the YOU PAID total but not in the COULD HAVE PAID total.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnnotatedLine({ row }: { row: AnnotatedRow }) {
  const item = row.item;
  const cheaper = row.bestTotal != null && row.savings > 0.05;
  const noCheaper = row.bestTotal != null && row.savings <= 0.05 && row.savings >= -0.05;

  return (
    <div style={{ padding: '6px 0' }}>
      {/* Top line: name + price */}
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, alignItems: 'baseline' }}>
        <span style={{ flex: 1, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8, color: row.unmatched ? V3.paperMute : V3.paperInk }}>
          {item.match?.name ?? item.description}
        </span>
        <span style={{
          fontWeight: 600,
          flexShrink: 0,
          textDecoration: cheaper ? 'line-through' : 'none',
          color: cheaper ? V3.paperMute : V3.paperInk,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {fmt(item.member_price)}
        </span>
      </div>

      {/* Quantity hint */}
      {item.quantity != null && item.unit && item.unit !== 'each' && (
        <div className="v3-mono" style={{ fontSize: 9, color: V3.paperFaint, paddingLeft: 2, marginTop: 1 }}>
          {item.quantity} {item.unit}
        </div>
      )}

      {/* Annotation: cheaper alternative */}
      {cheaper && row.bestChainName && row.bestTotal != null && (
        <div className="v3-mono" style={{
          marginTop: 4,
          marginLeft: 8,
          paddingLeft: 8,
          borderLeft: `2px solid ${V3.saveOutline}`,
          fontSize: 11,
          color: V3.saveInk,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            ↓ AT {row.bestChainName.toUpperCase()}
            {row.matchType === 'equivalent' && <span style={{ opacity: 0.7, marginLeft: 4, fontSize: 9 }}>~similar</span>}
          </span>
          <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {fmt(row.bestTotal)}
          </span>
        </div>
      )}

      {/* No cheaper found */}
      {noCheaper && (
        <div className="v3-mono" style={{
          marginTop: 4,
          marginLeft: 8,
          fontSize: 9,
          color: V3.paperMute,
          fontStyle: 'italic',
        }}>
          ✓ best nearby price
        </div>
      )}

      {/* Unmatched */}
      {row.unmatched && (
        <div className="v3-mono" style={{
          marginTop: 4,
          marginLeft: 8,
          fontSize: 9,
          color: V3.paperFaint,
          fontStyle: 'italic',
        }}>
          ? no nearby comparison
        </div>
      )}
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
