'use client';

/**
 * Alt B — Decision Map.
 *
 * Design thesis: A grocery shopper reading prices across stores does mental
 * grid math. Make the grid explicit. One row per item, one column per chain,
 * cheapest cell glows. The eye scans for the green column and that's the
 * answer. Best when the user's question is "where should I be shopping?"
 * not "what did I overpay on?"
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

interface Column {
  chain_id: number;
  chain_name: string;
  distance: number;
  isUserSource: boolean;
}

interface RowCell {
  total: number | null;
  isCheapest: boolean;
  freshness?: 'green' | 'yellow' | 'red';
  observations?: number;
}

interface Row {
  item: ApiItem;
  idx: number;
  cells: Map<number, RowCell>;     // keyed by chain_id
  cheapestChainId: number | null;  // tied means whichever the projection sorted first
}

function buildRows(compareResp: CompareResponse, columns: Column[], chains: ChainProjection[]): Row[] {
  return compareResp.items
    .map((item, idx): Row | null => {
      if (item.item_type === 'skip') return null;
      const cells = new Map<number, RowCell>();
      // User's "source" column shows what they paid.
      const sourceCol = columns.find((c) => c.isUserSource);
      if (sourceCol) {
        cells.set(sourceCol.chain_id, { total: item.member_price, isCheapest: false });
      }
      // Alt chain prices from the projection.
      for (const chain of chains) {
        const opts = chain.options_by_line.get(idx);
        if (!opts || opts.length === 0) continue;
        const total = effectiveTotal(opts[0], false);
        if (total == null) continue;
        cells.set(chain.chain_id, {
          total,
          isCheapest: false,
          freshness: opts[0].freshness,
          observations: opts[0].observations,
        });
      }
      // Find cheapest across all chains (including source).
      let cheapestChainId: number | null = null;
      let cheapest = Infinity;
      for (const [cid, cell] of cells.entries()) {
        if (cell.total == null) continue;
        if (cell.total < cheapest - 0.005) {
          cheapest = cell.total;
          cheapestChainId = cid;
        }
      }
      // Mark the cheapest cell.
      if (cheapestChainId != null) {
        const cell = cells.get(cheapestChainId);
        if (cell) cell.isCheapest = true;
      }
      return { item, idx, cells, cheapestChainId };
    })
    .filter((r): r is Row => r !== null);
}

export default function CompareAltB({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);

  // Columns: source chain first, then alt chains by savings.
  const columns: Column[] = useMemo(() => {
    const sourceName = compareResp.receipt.store_name ?? 'Your store';
    const cols: Column[] = [{ chain_id: -1, chain_name: sourceName, distance: 0, isUserSource: true }];
    for (const c of chains) {
      cols.push({ chain_id: c.chain_id, chain_name: c.chain_name, distance: c.distance_miles, isUserSource: false });
    }
    return cols;
  }, [chains, compareResp.receipt.store_name]);

  const rows = useMemo(() => buildRows(compareResp, columns, chains), [compareResp, columns, chains]);

  // Per-column totals and savings vs the user.
  const columnSummaries = useMemo(() => {
    return columns.map((col) => {
      let total = 0;
      let userPaid = 0;
      let covered = 0;
      let totalEligible = 0;
      let cheapestCount = 0;
      for (const row of rows) {
        totalEligible += 1;
        const cell = row.cells.get(col.chain_id);
        if (!cell || cell.total == null) continue;
        total += cell.total;
        userPaid += row.item.member_price;
        covered += 1;
        if (cell.isCheapest) cheapestCount += 1;
      }
      return {
        ...col,
        total,
        userPaid,
        savings: userPaid - total,
        covered,
        totalEligible,
        cheapestCount,
      };
    });
  }, [columns, rows]);

  const userTotal = compareResp.items.reduce((s, i) => i.item_type !== 'skip' ? s + i.member_price : s, 0);

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          {compareResp.receipt.store_name} · {compareResp.receipt.receipt_date} · {fmt(userTotal)}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>
        {/* ── Chain summary strip ─────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columnSummaries.length}, 1fr)`, gap: 8, marginBottom: 20 }}>
          {columnSummaries.map((s) => {
            const cheaper = s.savings > 0.5 && !s.isUserSource;
            const more = s.savings < -0.5 && !s.isUserSource;
            return (
              <div
                key={s.chain_id}
                style={{
                  background: cheaper ? 'rgba(74, 222, 128, 0.08)' : V3.pageAlt,
                  border: `1px solid ${cheaper ? 'rgba(74, 222, 128, 0.4)' : V3.border}`,
                  borderRadius: 12,
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: V3.inkMid, letterSpacing: '0.04em' }}>
                  {s.isUserSource && <span style={{ color: '#9ca3af' }}>YOU SHOPPED HERE · </span>}
                  {s.chain_name}
                </div>
                <div style={{ fontSize: 10, color: V3.inkLight, marginTop: 2 }}>
                  {s.distance > 0 ? `${s.distance.toFixed(1)} mi · ` : ''}
                  {s.covered}/{s.totalEligible} priced
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: V3.ink, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(s.total)}
                </div>
                {!s.isUserSource && (
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, color: cheaper ? '#22c55e' : more ? '#ef4444' : V3.inkLight }}>
                    {cheaper ? `↓ ${fmtAbs(s.savings)} saved` : more ? `↑ ${fmtAbs(s.savings)} more` : 'same'}
                  </div>
                )}
                {s.cheapestCount > 0 && (
                  <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginTop: 4 }}>
                    ⭐ Cheapest on {s.cheapestCount} item{s.cheapestCount > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Heatmap table ──────────────────────────────────────────── */}
        <div style={{ background: V3.pageAlt, borderRadius: 12, border: `1px solid ${V3.border}`, overflow: 'hidden' }}>
          {/* Sticky-style header row */}
          <div style={{ display: 'grid', gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${columnSummaries.length}, 1fr)`, background: V3.chrome, borderBottom: `1px solid ${V3.border}` }}>
            <div style={{ padding: '12px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: V3.inkLight }}>
              Item
            </div>
            {columnSummaries.map((c) => (
              <div key={c.chain_id} style={{ padding: '12px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: V3.inkMid, textAlign: 'right' }}>
                {c.chain_name}
              </div>
            ))}
          </div>

          {rows.map((row, i) => (
            <div
              key={row.idx}
              style={{
                display: 'grid',
                gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${columnSummaries.length}, 1fr)`,
                borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${V3.border}`,
              }}
            >
              {/* Item name cell */}
              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: V3.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.item.match?.name ?? row.item.description}
                </div>
                <div style={{ fontSize: 10, color: V3.inkLight, marginTop: 2 }}>
                  {row.item.quantity != null && row.item.unit && row.item.unit !== 'each' ? `${row.item.quantity} ${row.item.unit}` : (row.item.match?.package_size ? `${row.item.match.package_size} ${row.item.match.package_unit}` : '')}
                  {!row.item.match && <span style={{ color: '#f59e0b' }}>· no match</span>}
                </div>
              </div>
              {/* Price cells */}
              {columnSummaries.map((col) => {
                const cell = row.cells.get(col.chain_id);
                return (
                  <PriceCell
                    key={col.chain_id}
                    cell={cell}
                    isUserSource={col.isUserSource}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{ marginTop: 16, padding: '12px 16px', background: V3.pageAlt, borderRadius: 10, fontSize: 11, color: V3.inkLight, lineHeight: 1.6 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: '#22c55e', marginRight: 6, verticalAlign: 'middle' }} />Cheapest in row</span>
            <span><span style={{ marginRight: 6 }}>—</span>No data at this chain</span>
            <span><span style={{ marginRight: 6 }}>~</span>Different brand or pack size</span>
          </div>
          <div style={{ marginTop: 8 }}>
            Stores with empty cells don't have recent prices for that item — savings are computed only against items priced at both stores.
          </div>
        </div>
      </div>
    </div>
  );
}

function PriceCell({ cell, isUserSource }: { cell: RowCell | undefined; isUserSource: boolean }) {
  if (!cell || cell.total == null) {
    return (
      <div style={{ padding: '12px 10px', textAlign: 'right', fontSize: 13, color: V3.inkLight, fontVariantNumeric: 'tabular-nums' }}>
        —
      </div>
    );
  }
  if (cell.isCheapest) {
    return (
      <div style={{
        padding: '12px 10px',
        textAlign: 'right',
        background: 'rgba(34, 197, 94, 0.12)',
        position: 'relative',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>
          ⭐ {fmt(cell.total)}
        </div>
        {cell.freshness && cell.observations != null && !isUserSource && (
          <div style={{ fontSize: 9, color: V3.inkLight, marginTop: 2 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: cell.freshness === 'green' ? '#22c55e' : cell.freshness === 'yellow' ? '#f59e0b' : '#ef4444', marginRight: 3, verticalAlign: 'middle' }} />
            {cell.observations} obs
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ padding: '12px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: isUserSource ? V3.inkMid : V3.ink }}>
        {fmt(cell.total)}
      </div>
      {cell.freshness && cell.observations != null && !isUserSource && (
        <div style={{ fontSize: 9, color: V3.inkLight, marginTop: 2 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: cell.freshness === 'green' ? '#22c55e' : cell.freshness === 'yellow' ? '#f59e0b' : '#ef4444', marginRight: 3, verticalAlign: 'middle' }} />
          {cell.observations} obs
        </div>
      )}
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
