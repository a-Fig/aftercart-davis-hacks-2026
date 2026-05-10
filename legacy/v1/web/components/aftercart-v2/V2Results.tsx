'use client';

import { useState, useMemo, useEffect } from 'react';
import { V2, fmt, fmtBig } from './theme';
import {
  Receipt,
  ReceiptItem,
  StoreComparison,
  StorePrice,
  Freshness,
  FRESH_COLORS,
  allComparableItems,
} from '@/components/aftercart/data';

interface V2ResultsProps {
  receipt: Receipt;
  onBack: () => void;
  onItemClick: (item: ReceiptItem) => void;
  onScanAgain: () => void;
}

type FilterKind = 'all' | 'savings' | 'best-here';

export default function V2Results({ receipt, onBack, onItemClick, onScanAgain }: V2ResultsProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const id = setTimeout(() => setVisible(true), 30); return () => clearTimeout(id); }, []);

  const storeNames = useMemo(() => Object.keys(receipt.comparisons), [receipt]);
  const sortedStores: Array<[string, StoreComparison]> = useMemo(() => {
    const entries = Object.entries(receipt.comparisons);
    entries.sort((a, b) => b[1].saves - a[1].saves);
    return entries;
  }, [receipt]);

  // Active store: defaults to the cheapest alternative.
  const [activeStore, setActiveStore] = useState<string | null>(sortedStores[0]?.[0] ?? null);
  useEffect(() => {
    // Re-select if a new receipt comes in.
    if (activeStore && !storeNames.includes(activeStore)) {
      setActiveStore(sortedStores[0]?.[0] ?? null);
    }
  }, [storeNames, sortedStores, activeStore]);

  const [filter, setFilter] = useState<FilterKind>('all');

  const comp = activeStore ? receipt.comparisons[activeStore] : null;
  const items = useMemo(() => allComparableItems(receipt), [receipt]);

  // Build the flat items list with the active-store comparison in mind.
  const itemRows = useMemo(() => {
    return items.map((item) => {
      const altPrice = activeStore ? item.prices[activeStore] : undefined;
      const localPrice = item.prices[receipt.store];
      const altTotal = altPrice ? (altPrice.equivalent_total ?? altPrice.price) : null;
      const save = altTotal != null ? item.paid - altTotal : 0;
      const status: 'cheaper' | 'best-here' | 'no-data' =
        altPrice == null ? 'no-data' :
          save > 0.05 ? 'cheaper' :
            'best-here';
      return { item, altPrice, localPrice, save, status };
    });
  }, [items, activeStore, receipt.store]);

  const filteredRows = itemRows.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'savings') return row.status === 'cheaper';
    if (filter === 'best-here') return row.status === 'best-here';
    return true;
  });

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'none' : 'translateY(10px)',
    transition: `all 0.42s ease ${delay}s`,
  });

  // Unmatched items section
  const unmatchedItems = receipt.categories.find((c) => c.isUnmatched)?.items ?? [];

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 28 }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        style={{
          padding: '18px 22px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          ...fade(0),
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: 'none',
            color: V2.inkLight,
            fontSize: 13,
            fontWeight: 600,
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ← Home
        </button>
        <div style={{ fontSize: 12, color: V2.inkLight }}>
          {receipt.store} · {receipt.date}
        </div>
      </div>

      {/* ── Hero — store-first ──────────────────────────────────── */}
      {comp ? (
        <div style={{ padding: '8px 22px 24px', ...fade(0.05) }}>
          <div
            style={{
              fontSize: 11,
              color: V2.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Best stop next time
          </div>

          <div
            style={{
              background: `linear-gradient(160deg, ${V2.surface} 0%, ${V2.surfaceAlt} 100%)`,
              border: `1px solid ${V2.borderHi}`,
              borderRadius: 22,
              padding: '22px 22px 20px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* glow */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: -80,
                right: -60,
                width: 220,
                height: 220,
                borderRadius: '50%',
                background: V2.limeBg,
                filter: 'blur(40px)',
                pointerEvents: 'none',
              }}
            />

            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>
                {activeStore}
              </div>
              <div style={{ fontSize: 13, color: V2.inkLight }}>
                {comp.dist} away
              </div>

              <div
                className="v2-num"
                style={{
                  marginTop: 22,
                  fontSize: 64,
                  fontWeight: 800,
                  lineHeight: 1,
                  color: comp.saves > 0 ? V2.lime : V2.ink,
                  letterSpacing: '-0.04em',
                }}
              >
                {comp.saves > 0 ? `−${fmtBig(comp.saves)}` : fmt(comp.total)}
              </div>
              <div style={{ fontSize: 13, color: V2.inkLight, marginTop: 8, lineHeight: 1.6 }}>
                {comp.saves > 0 ? (
                  <>
                    You&apos;d save <span className="v2-num" style={{ color: V2.lime, fontWeight: 700 }}>{comp.pct}%</span>
                    {' '}on a <span className="v2-num" style={{ color: V2.ink, fontWeight: 600 }}>{fmt(comp.paid)}</span> basket
                  </>
                ) : (
                  <>You&apos;re already at the best price here</>
                )}
              </div>

              {/* Coverage caveat */}
              {comp.matched_count < comp.total_compared && (
                <div
                  style={{
                    marginTop: 16,
                    padding: '10px 12px',
                    fontSize: 11,
                    color: V2.amber,
                    background: V2.amberBg,
                    border: `1px solid ${V2.amber}33`,
                    borderRadius: 10,
                    lineHeight: 1.5,
                  }}
                >
                  Comparable on {comp.matched_count} of {comp.total_compared} items —
                  the rest aren&apos;t priced here yet.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: '8px 22px 24px', ...fade(0.05) }}>
          <div
            style={{
              background: V2.surface,
              border: `1px solid ${V2.border}`,
              borderRadius: 22,
              padding: 24,
            }}
          >
            <div style={{ fontSize: 12, color: V2.inkLight, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 8 }}>
              Your trip at {receipt.store}
            </div>
            <div className="v2-num" style={{ fontSize: 56, fontWeight: 800, color: V2.ink, lineHeight: 1, letterSpacing: '-0.04em' }}>
              {fmt(receipt.total)}
            </div>
            <div style={{ fontSize: 13, color: V2.inkLight, marginTop: 10, lineHeight: 1.55 }}>
              We matched {receipt.compared_count} of {receipt.items_count} items, but no nearby store has reported recent prices yet. As more receipts come in, this comparison fills out.
            </div>
          </div>
        </div>
      )}

      {/* ── Store comparison table ──────────────────────────────── */}
      {sortedStores.length > 1 && (
        <div style={{ padding: '0 22px 18px', ...fade(0.1) }}>
          <div
            style={{
              fontSize: 11,
              color: V2.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            Other stores nearby
          </div>
          <div
            style={{
              background: V2.surface,
              border: `1px solid ${V2.border}`,
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            {sortedStores.map(([name, c], i) => {
              const isActive = name === activeStore;
              return (
                <button
                  key={name}
                  onClick={() => setActiveStore(name)}
                  style={{
                    width: '100%',
                    background: isActive ? V2.surfaceAlt : 'transparent',
                    border: 'none',
                    borderTop: i === 0 ? 'none' : `1px solid ${V2.border}`,
                    color: V2.ink,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    transition: 'background 0.12s',
                  }}
                >
                  <div
                    style={{
                      width: 4,
                      alignSelf: 'stretch',
                      background: isActive ? V2.lime : 'transparent',
                      borderRadius: 2,
                      minHeight: 32,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </div>
                    <div style={{ fontSize: 11, color: V2.inkLight, marginTop: 2 }}>
                      {c.dist} · {c.matched_count} of {c.total_compared} items
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {c.saves > 0 ? (
                      <>
                        <div className="v2-num" style={{ fontSize: 16, fontWeight: 700, color: V2.lime }}>
                          −{fmt(c.saves)}
                        </div>
                        <div className="v2-num" style={{ fontSize: 10, color: V2.inkLight, marginTop: 2 }}>
                          {c.pct}% off {fmt(c.paid)}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: V2.inkLight }}>no savings</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filter chips ────────────────────────────────────────── */}
      <div style={{ padding: '0 22px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', ...fade(0.13) }}>
        <div
          style={{
            fontSize: 11,
            color: V2.inkLight,
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            fontWeight: 600,
          }}
        >
          Items · {filteredRows.length}
        </div>
      </div>

      <div style={{ padding: '0 22px 14px', display: 'flex', gap: 6, overflowX: 'auto', ...fade(0.15) }}>
        <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} count={itemRows.length} />
        <FilterChip
          label="With savings"
          active={filter === 'savings'}
          onClick={() => setFilter('savings')}
          count={itemRows.filter((r) => r.status === 'cheaper').length}
          accent={V2.lime}
        />
        <FilterChip
          label="Already best"
          active={filter === 'best-here'}
          onClick={() => setFilter('best-here')}
          count={itemRows.filter((r) => r.status === 'best-here').length}
        />
      </div>

      {/* ── Items list ──────────────────────────────────────────── */}
      <div style={{ padding: '0 14px', ...fade(0.18) }}>
        {filteredRows.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: V2.inkLight,
              fontSize: 13,
              border: `1px dashed ${V2.border}`,
              borderRadius: 14,
              margin: '0 8px',
            }}
          >
            No items match this filter.
          </div>
        ) : (
          filteredRows.map(({ item, altPrice, save, status }) => (
            <V2ItemRow
              key={item.id}
              item={item}
              altPrice={altPrice}
              save={save}
              status={status}
              onClick={() => onItemClick(item)}
            />
          ))
        )}

        {/* Unmatched */}
        {unmatchedItems.length > 0 && filter === 'all' && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 11,
                color: V2.inkLight,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                fontWeight: 600,
                padding: '6px 10px 8px',
              }}
            >
              No comparison found · {unmatchedItems.length}
            </div>
            {unmatchedItems.map((item) => (
              <div
                key={item.id}
                style={{
                  background: V2.surface,
                  border: `1px dashed ${V2.border}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ width: 6, alignSelf: 'stretch', background: V2.inkFaint, borderRadius: 3, minHeight: 24 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: V2.inkMid }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: V2.inkLight, marginTop: 2 }}>{item.detail}</div>
                  {item.reason && (
                    <div style={{ fontSize: 11, color: V2.inkFaint, marginTop: 4 }}>{item.reason}</div>
                  )}
                </div>
                <div className="v2-num" style={{ fontSize: 13, color: V2.inkMid, fontWeight: 600, flexShrink: 0 }}>
                  {fmt(item.paid)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Action bar ──────────────────────────────────────────── */}
      <div style={{ padding: '20px 22px 8px', ...fade(0.22) }}>
        <button
          onClick={onScanAgain}
          style={{
            width: '100%',
            padding: '14px 18px',
            background: V2.surface,
            color: V2.ink,
            border: `1px solid ${V2.border}`,
            borderRadius: 14,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 8a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Scan another receipt
        </button>
      </div>

      {/* Trust footer */}
      <div style={{ padding: '12px 22px 24px', display: 'flex', alignItems: 'center', gap: 10, color: V2.inkFaint, fontSize: 11, ...fade(0.25) }}>
        <span>Community receipts ·</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Dot color={FRESH_COLORS.green} /> &lt;7d
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Dot color={FRESH_COLORS.yellow} /> 7–30d
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Dot color={FRESH_COLORS.red} /> &gt;30d
        </span>
      </div>
    </div>
  );
}

// ── Components ─────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick, count, accent }: { label: string; active: boolean; onClick: () => void; count: number; accent?: string }) {
  const c = accent ?? V2.ink;
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 12px',
        background: active ? V2.surface : 'transparent',
        border: `1px solid ${active ? V2.borderHi : V2.border}`,
        borderRadius: 999,
        color: active ? c : V2.inkLight,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all 0.12s',
      }}
    >
      {label}
      <span className="v2-num" style={{ marginLeft: 6, color: V2.inkFaint, fontWeight: 500 }}>{count}</span>
    </button>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color }} />;
}

function V2ItemRow({
  item,
  altPrice,
  save,
  status,
  onClick,
}: {
  item: ReceiptItem;
  altPrice: StorePrice | undefined;
  save: number;
  status: 'cheaper' | 'best-here' | 'no-data';
  onClick: () => void;
}) {
  const accent =
    status === 'cheaper' ? V2.lime :
      status === 'best-here' ? V2.blue :
        V2.inkFaint;

  const fresh: Freshness | null = altPrice?.freshness ?? null;

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        background: V2.surface,
        border: `1px solid ${V2.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 6,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: V2.ink,
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        transition: 'border-color 0.12s, background 0.12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = V2.borderHi; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = V2.border; }}
    >
      {/* Status bar */}
      <div
        style={{
          width: 4,
          alignSelf: 'stretch',
          background: accent,
          borderRadius: 2,
          minHeight: 32,
          flexShrink: 0,
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</span>
          {altPrice?.match_type === 'equivalent' && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: V2.blueBg,
                color: V2.blue,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              ~similar
            </span>
          )}
          {altPrice?.member_price != null && altPrice.member_price < altPrice.price - 0.01 && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                background: V2.amberBg,
                color: V2.amber,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              w/ card
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: V2.inkLight, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</span>
          {fresh && <Dot color={FRESH_COLORS[fresh]} />}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="v2-num" style={{ fontSize: 14, fontWeight: 600, color: V2.ink }}>
          {fmt(item.paid)}
        </div>
        {status === 'cheaper' && (
          <div className="v2-num" style={{ fontSize: 12, fontWeight: 700, color: V2.lime, marginTop: 2 }}>
            −{fmt(save)}
          </div>
        )}
        {status === 'best-here' && (
          <div style={{ fontSize: 10, color: V2.blue, marginTop: 2, fontWeight: 600 }}>
            best ✓
          </div>
        )}
        {status === 'no-data' && (
          <div style={{ fontSize: 10, color: V2.inkFaint, marginTop: 2 }}>
            no data
          </div>
        )}
      </div>

      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: V2.inkFaint, flexShrink: 0 }}>
        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
