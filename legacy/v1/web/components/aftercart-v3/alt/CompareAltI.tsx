'use client';

/**
 * Alt I — Diff Receipt.
 *
 * Design thesis: Keep the user's actual receipt as the anchor — it's
 * something they recognize as their trip — and annotate every line with what
 * each chain would have substituted on their shelf. The annotations live
 * inline (indented under the item) in the same monospace receipt font, so
 * the page reads as "your receipt, expanded with shelf data." Each
 * substitute carries the brand name, a change badge, a per-unit price, the
 * dollar savings, and the percent. Cheapest across chains is starred. A
 * spread line at the end of each item answers "where in the local market
 * does my price actually fall?"
 *
 * Best when the user wants to skim *their own receipt* and read the local
 * shelf reality off it without losing the original artifact.
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

interface AnnotatedRow {
  item: ApiItem;
  idx: number;
  // Per chain: the cheapest stocked option (or null if not stocked / unmatched)
  chainPicks: Array<{
    chain: ChainProjection;
    pick: ChainOption | null;
    altCount: number;
  }>;
  // Computed: cheapest pick across all chains; spread.
  cheapestChainId: number | null;
  spreadMin: number | null;
  spreadMax: number | null;
  totalOptions: number;
}

function buildRows(compareResp: CompareResponse, chains: ChainProjection[]): AnnotatedRow[] {
  return compareResp.items.map((item, idx): AnnotatedRow | null => {
    if (item.item_type === 'skip') return null;

    const chainPicks = chains.map((chain) => {
      const opts = chain.options_by_line.get(idx) ?? [];
      return { chain, pick: opts[0] ?? null, altCount: Math.max(0, opts.length - 1) };
    });

    let cheapestChainId: number | null = null;
    let cheapest = Infinity;
    let spreadMin = Infinity;
    let spreadMax = -Infinity;
    let totalOptions = 0;

    for (const { chain, pick } of chainPicks) {
      // Aggregate all options at the chain (not just the cheapest) for spread.
      const opts = chain.options_by_line.get(idx) ?? [];
      for (const opt of opts) {
        const t = effectiveTotal(opt, false);
        if (t == null) continue;
        totalOptions += 1;
        if (t < spreadMin) spreadMin = t;
        if (t > spreadMax) spreadMax = t;
      }
      if (!pick) continue;
      const t = effectiveTotal(pick, false);
      if (t == null) continue;
      if (t < cheapest) {
        cheapest = t;
        cheapestChainId = chain.chain_id;
      }
    }

    return {
      item, idx, chainPicks,
      cheapestChainId,
      spreadMin: spreadMin === Infinity ? null : spreadMin,
      spreadMax: spreadMax === -Infinity ? null : spreadMax,
      totalOptions,
    };
  }).filter((r): r is AnnotatedRow => r !== null);
}

export default function CompareAltI({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const rows = useMemo(() => buildRows(compareResp, chains), [compareResp, chains]);

  const userTotal = rows.reduce((s, r) => s + r.item.member_price, 0);
  // "Could've paid" — sum of cheapest-substitute totals across chains for each item.
  const couldHavePaid = rows.reduce((s, r) => {
    if (r.cheapestChainId == null) return s + r.item.member_price;
    const ch = r.chainPicks.find((cp) => cp.chain.chain_id === r.cheapestChainId);
    if (!ch || !ch.pick) return s + r.item.member_price;
    return s + (effectiveTotal(ch.pick, false) ?? r.item.member_price);
  }, 0);
  const totalSavings = userTotal - couldHavePaid;

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          Annotated receipt
        </div>
      </div>

      <div style={{ padding: '36px 20px 60px', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          background: V3.paper,
          color: V3.paperInk,
          width: '100%',
          maxWidth: 580,
          padding: '32px 28px 26px',
          borderRadius: 4,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.25)',
          position: 'relative',
        }}>
          {/* Tear edge */}
          <div aria-hidden style={{
            position: 'absolute',
            top: -6,
            left: 0,
            right: 0,
            height: 8,
            background: V3.paper,
            clipPath: 'polygon(0 100%, 4% 30%, 8% 100%, 12% 30%, 16% 100%, 20% 30%, 24% 100%, 28% 30%, 32% 100%, 36% 30%, 40% 100%, 44% 30%, 48% 100%, 52% 30%, 56% 100%, 60% 30%, 64% 100%, 68% 30%, 72% 100%, 76% 30%, 80% 100%, 84% 30%, 88% 100%, 92% 30%, 96% 100%, 100% 30%, 100% 100%)',
          }} />

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
              ✱ ANNOTATED WITH NEARBY SHELF DATA ✱
            </div>
          </div>

          <Divider />

          {/* Annotated lines */}
          <div>
            {rows.map((r) => <AnnotatedItem key={r.idx} row={r} />)}
          </div>

          <Divider />

          {/* Totals */}
          <div className="v3-mono" style={{ fontSize: 11, color: V3.paperInk }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: V3.paperMute, letterSpacing: '0.06em' }}>YOUR TOTAL</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(userTotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: V3.paperMute, letterSpacing: '0.06em' }}>BEST-DEAL TOTAL</span>
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
                IF YOU'D CHERRY-PICKED THE CHEAPEST SHELF
              </div>
              <div className="v3-mono" style={{ fontSize: 28, color: V3.saveInk, fontWeight: 900, marginTop: 4, letterSpacing: '-0.02em' }}>
                ↓ {fmtAbs(totalSavings)}
              </div>
              <div className="v3-mono" style={{ fontSize: 10, color: V3.saveInk, opacity: 0.8, marginTop: 2, fontWeight: 700, letterSpacing: '0.08em' }}>
                {((totalSavings / userTotal) * 100).toFixed(0)}% LESS · ACROSS {rows.filter((r) => r.cheapestChainId != null).length} ITEMS WITH NEARBY OPTIONS
              </div>
            </div>
          )}

          <div className="v3-mono" style={{ fontSize: 9, color: V3.paperFaint, marginTop: 14, lineHeight: 1.6, textAlign: 'center' }}>
            ★ = cheapest substitute across nearby chains.<br />
            % = price difference vs what you actually paid.
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnotatedItem({ row }: { row: AnnotatedRow }) {
  const item = row.item;
  const itemName = (item.match?.brand
    ? `${item.match.brand} ${item.match.name ?? item.description}`
    : (item.match?.name ?? item.description)).toUpperCase();
  const sizeTxt = item.match?.package_size && item.match?.package_unit
    ? `${item.match.package_size} ${item.match.package_unit}`
    : item.quantity != null && item.unit && item.unit !== 'each'
      ? `${item.quantity} ${item.unit}`
      : '';
  const userPerUnit = item.unit_price && item.unit && item.unit !== 'each'
    ? `${fmt(item.unit_price)}/${item.unit}`
    : null;

  const unmatched = !item.match;

  return (
    <div style={{ padding: '8px 0', borderBottom: `1px dashed ${V3.paperFaint}` }}>
      {/* User's line */}
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600 }}>
        <span style={{ flex: 1, marginRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {itemName}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(item.member_price)}</span>
      </div>
      {(sizeTxt || userPerUnit) && (
        <div className="v3-mono" style={{ fontSize: 9, color: V3.paperMute, paddingLeft: 2, marginTop: 1 }}>
          {sizeTxt}{sizeTxt && userPerUnit ? ' · ' : ''}{userPerUnit ?? ''}
        </div>
      )}

      {unmatched ? (
        <div className="v3-mono" style={{ fontSize: 9, color: V3.paperFaint, paddingLeft: 14, marginTop: 6, fontStyle: 'italic' }}>
          ? no nearby comparison
        </div>
      ) : (
        <>
          {/* Per-chain stack */}
          <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${V3.paperLine}`, marginLeft: 4 }}>
            {row.chainPicks.map(({ chain, pick, altCount }) => (
              <ChainSubLine
                key={chain.chain_id}
                chain={chain}
                pick={pick}
                userPaid={item.member_price}
                isCheapest={row.cheapestChainId === chain.chain_id}
                altCount={altCount}
              />
            ))}
          </div>

          {/* Spread summary */}
          {row.spreadMin != null && row.spreadMax != null && row.totalOptions > 1 && (
            <div className="v3-mono" style={{ fontSize: 8.5, color: V3.paperMute, paddingLeft: 14, marginTop: 4, letterSpacing: '0.04em' }}>
              SPREAD {fmt(row.spreadMin)}–{fmt(row.spreadMax)} ACROSS {row.totalOptions} NEARBY OPTION{row.totalOptions > 1 ? 'S' : ''}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChainSubLine({ chain, pick, userPaid, isCheapest, altCount }: {
  chain: ChainProjection;
  pick: ChainOption | null;
  userPaid: number;
  isCheapest: boolean;
  altCount: number;
}) {
  // Not stocked
  if (!pick) {
    return (
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: V3.paperFaint, padding: '2px 0', fontStyle: 'italic' }}>
        <span style={{ opacity: 0.85 }}>
          × {chain.chain_name.toUpperCase()}
        </span>
        <span>NOT STOCKED</span>
      </div>
    );
  }

  const total = effectiveTotal(pick, false) ?? pick.shelf;
  const savings = userPaid - total;
  const cheaper = savings > 0.05;
  const more = savings < -0.05;
  const arrow = cheaper ? '↓' : more ? '↑' : '=';
  const change = classifyChange(pick.equiv_note, pick.match_type === 'exact');
  const badgeColor = CHANGE_COLORS[change];
  const badgeLabel = CHANGE_LABELS[change];

  return (
    <div style={{ padding: '3px 0' }}>
      <div className="v3-mono" style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 10.5 }}>
        <span style={{
          width: 12,
          fontSize: 11,
          color: isCheapest ? V3.saveInk : cheaper ? V3.saveInk : more ? V3.overInk : V3.paperFaint,
          fontWeight: 700,
        }}>
          {isCheapest ? '★' : arrow}
        </span>
        <span style={{
          flex: '0 0 64px',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: V3.paperMid,
        }}>
          {chain.chain_name.toUpperCase()}
        </span>
        <span style={{
          flex: 1,
          color: V3.paperInk,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 500,
        }}>
          {pick.display_name}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: cheaper ? V3.saveInk : more ? V3.overInk : V3.paperInk, flexShrink: 0 }}>
          {fmt(total)}
        </span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: cheaper ? V3.saveInk : more ? V3.overInk : V3.paperMute,
          minWidth: 36,
          textAlign: 'right',
          flexShrink: 0,
        }}>
          {Math.abs(savings) > 0.05 ? `${cheaper ? '↓' : '↑'}${((Math.abs(savings) / userPaid) * 100).toFixed(0)}%` : '='}
        </span>
      </div>
      {/* Sub-row: badge + per-unit + extra options */}
      <div className="v3-mono" style={{ fontSize: 8.5, color: V3.paperMute, paddingLeft: 82, marginTop: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
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
        {pick.equiv_note && (
          <span style={{ fontStyle: 'italic' }}>{pick.equiv_note.toLowerCase()}</span>
        )}
        {altCount > 0 && (
          <span style={{ color: V3.paperFaint }}>+{altCount} more on shelf</span>
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
