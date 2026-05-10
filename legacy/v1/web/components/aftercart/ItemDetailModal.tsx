'use client';

import { useState, useEffect } from 'react';
import { THEMES, fmt, Freshness, FRESH_COLORS, FRESH_LABELS, ReceiptItem } from './data';
import OffEnrichmentBlock from './OffEnrichmentBlock';

function FreshDot({ freshness, size = 6 }: { freshness: Freshness; size?: number }) {
  return (
    <span
      title={`Data age: ${FRESH_LABELS[freshness]}`}
      style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: FRESH_COLORS[freshness], flexShrink: 0 }}
    />
  );
}

interface ItemDetailModalProps {
  item: ReceiptItem;
  savedItems: Set<string>;
  onToggleSave: (id: string) => void;
  onClose: () => void;
}

export default function ItemDetailModal({ item, savedItems, onToggleSave, onClose }: ItemDetailModalProps) {
  const t = THEMES.forest;
  const isSaved = savedItems.has(item.id);
  const [vis, setVis] = useState(false);
  useEffect(() => { const id = setTimeout(() => setVis(true), 20); return () => clearTimeout(id); }, []);
  const close = () => { setVis(false); setTimeout(onClose, 240); };

  const priceList = Object.entries(item.prices).map(([store, p]) => ({ ...p, store }));
  // Compare on the apples-to-apples number — only items with a volume-
  // normalized total participate in "LOWEST" so per-unit-only rows don't
  // compete with totals.
  const comparablePrices = priceList.filter(p => !p.comparison_unavailable);
  const minP = comparablePrices.length > 0
    ? Math.min(...comparablePrices.map(p => p.equivalent_total ?? p.price))
    : Infinity;

  return (
    <div
      onClick={close}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.48)', zIndex: 100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', opacity: vis ? 1 : 0, transition: 'opacity 0.22s' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: t.surface, borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', maxHeight: '88vh', transform: vis ? 'none' : 'translateY(100%)', transition: 'transform 0.28s cubic-bezier(0.34,1.3,0.64,1)' }}
      >
        {/* Handle + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 16px 4px', flexShrink: 0, position: 'relative' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: t.border }} />
          <button
            onClick={close}
            style={{ position: 'absolute', right: 16, top: 10, width: 28, height: 28, borderRadius: '50%', background: t.surfaceAlt, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.inkLight }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Header */}
        <div style={{ padding: '12px 24px 16px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-lg)', color: t.inkDark, marginBottom: 4 }}>{item.name}</div>
          <div style={{ fontSize: 'var(--t-sm)', color: t.inkLight }}>{item.detail}</div>
          {/* Receipt-side per-unit price — anchors honest comparison when
              alternatives have different pack sizes. */}
          {item.unit_price_label && (
            <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 3 }}>
              You paid {item.unit_price_label}
            </div>
          )}
        </div>

        {/* Scrollable price list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 24px 0' }}>
          <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: t.inkFaint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Price at nearby stores
          </div>

          {priceList.map(p => {
            const perUnitOnly = !!p.comparison_unavailable;
            const headline = perUnitOnly ? p.price : (p.equivalent_total ?? p.price);
            const isMin = !perUnitOnly && headline === minP;
            const diff = perUnitOnly ? 0 : headline - minP;
            const isEquiv = p.match_type === 'equivalent';
            return (
              <div
                key={p.store}
                style={{ borderRadius: 12, marginBottom: 8, padding: '13px 15px', background: isMin ? t.posBg : p.current ? t.saveBg : t.surfaceAlt, border: `1.5px solid ${isMin ? t.pos + '44' : p.current ? t.save + '22' : t.border}` }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: t.inkDark }}>{p.store}</span>
                      {p.current && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: t.save, background: t.saveBg, padding: '1px 6px', borderRadius: 8, border: `1px solid ${t.save}33` }}>YOUR STORE</span>
                      )}
                      {isMin && !p.current && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: t.pos, background: t.posBg, padding: '1px 6px', borderRadius: 8, border: `1px solid ${t.pos}33` }}>LOWEST</span>
                      )}
                      {p.warn_stale && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: 8 }}>STALE DATA</span>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--t-xs)', color: t.inkLight, marginTop: 3 }}>{p.product_name}</div>
                    {isEquiv && p.equiv_note && (
                      <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 2, fontStyle: 'italic' }}>{p.equiv_note}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                      <span style={{ fontSize: 'var(--t-xs)', color: t.inkFaint }}>{p.per} · {p.dist}</span>
                      <FreshDot freshness={p.freshness} />
                      <span style={{ fontSize: 'var(--t-xs)', color: t.inkFaint }}>{p.observations} receipts</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 'var(--t-md)', fontWeight: 700, color: isMin ? t.pos : t.inkDark, lineHeight: 1 }}>
                      {perUnitOnly
                        ? `${fmt(headline)}/${(p.price_unit ?? 'per_each').replace(/^per_/, '')}`
                        : fmt(headline)}
                    </div>
                    {perUnitOnly && p.per_unit_savings_label && (
                      <div style={{ fontSize: 'var(--t-xs)', color: t.pos, fontWeight: 600, marginTop: 3, lineHeight: 1.2 }}>
                        {p.per_unit_savings_label}
                      </div>
                    )}
                    {perUnitOnly && !p.per_unit_savings_label && (
                      <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 3, lineHeight: 1.2, fontStyle: 'italic' }}>
                        per-unit only
                      </div>
                    )}
                    {!perUnitOnly && p.equivalent_total != null && Math.abs(p.equivalent_total - p.price) > 0.02 && (
                      <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 3, lineHeight: 1.2 }}>
                        {fmt(p.price)} per pack
                      </div>
                    )}
                    {/* Member-tier secondary price. Surfaced separately so the
                        user reads "shelf is $3.93, with the loyalty card it's
                        $2.25" rather than seeing a single ambiguous number. */}
                    {p.member_price != null && p.member_price < p.price - 0.01 && (
                      <div style={{ fontSize: 'var(--t-xs)', color: t.saved, fontWeight: 600, marginTop: 4, lineHeight: 1.2 }}>
                        {fmt(p.member_price)} <span style={{ color: t.inkFaint, fontWeight: 500 }}>with {p.store?.split(' ')[0] ?? 'store'} card</span>
                      </div>
                    )}
                    {diff > 0.05 && <div style={{ fontSize: 'var(--t-xs)', color: t.save, marginTop: 3 }}>+{fmt(diff)} more</div>}
                  </div>
                </div>
                {isEquiv && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1 3.5h8M1 6.5h8" stroke={t.inkFaint} strokeWidth="1.1" strokeLinecap="round" />
                    </svg>
                    <span style={{ fontSize: 'var(--t-xs)', color: t.inkFaint }}>Similar product · {Math.round((p.equivalence_strength ?? 0) * 100)}% match</span>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '4px 0 16px' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: t.inkFaint, marginTop: 1, flexShrink: 0 }}>
              <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.1" />
              <line x1="6.5" y1="4" x2="6.5" y2="7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              <circle cx="6.5" cy="9" r="0.5" fill="currentColor" />
            </svg>
            <span style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, lineHeight: 1.6 }}>
              Prices from community receipts.{' '}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <FreshDot freshness="green" /> &lt;7d <FreshDot freshness="yellow" /> 7–30d <FreshDot freshness="red" /> &gt;30d
              </span>
            </span>
          </div>

          {/* Open Food Facts enrichment — image, Nutri-Score, NOVA, ingredients,
              allergens, per-100g nutriments. Renders only when the item has a
              canonical_barcodes link (or the user picked an OFF entry directly
              in the review screen). */}
          {item.enrichment && <OffEnrichmentBlock enrichment={item.enrichment} />}
        </div>

        {/* Sticky save footer */}
        <div style={{ padding: '12px 24px 28px', borderTop: `1px solid ${t.border}`, background: t.surface, flexShrink: 0 }}>
          <button
            onClick={() => onToggleSave(item.id)}
            style={{ width: '100%', padding: 15, borderRadius: 12, background: isSaved ? t.surfaceAlt : t.cta, border: isSaved ? `1.5px solid ${t.border}` : 'none', color: isSaved ? t.inkMid : '#fff', fontFamily: 'inherit', fontSize: 'var(--t-base)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.18s' }}
          >
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
              <path d="M8.5 2.5C6.5 2.5 3.5 4.5 3.5 7.5c0 4.5 5 7 5 7s5-2.5 5-7c0-3-3-5-5-5z" stroke="currentColor" strokeWidth="1.6" fill={isSaved ? 'currentColor' : 'none'} />
            </svg>
            {isSaved ? 'Saved to your list' : 'Save this item'}
          </button>
          {!isSaved && (
            <div style={{ textAlign: 'center', fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 8 }}>
              Get notified when price drops below {fmt(minP)} nearby
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
