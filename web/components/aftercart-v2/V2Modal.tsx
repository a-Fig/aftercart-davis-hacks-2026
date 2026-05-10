'use client';

import { useState, useEffect } from 'react';
import { V2, fmt } from './theme';
import {
  ReceiptItem,
  Freshness,
  FRESH_COLORS,
  FRESH_LABELS,
  OffEnrichment,
} from '@/components/aftercart/data';

interface V2ModalProps {
  item: ReceiptItem;
  onClose: () => void;
}

export default function V2Modal({ item, onClose }: V2ModalProps) {
  const [vis, setVis] = useState(false);
  useEffect(() => { const id = setTimeout(() => setVis(true), 16); return () => clearTimeout(id); }, []);
  const close = () => { setVis(false); setTimeout(onClose, 220); };

  const priceList = Object.entries(item.prices).map(([store, p]) => ({ ...p, store }));
  const minP = priceList.length
    ? Math.min(...priceList.map((p) => p.equivalent_total ?? p.price))
    : 0;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        opacity: vis ? 1 : 0,
        transition: 'opacity 0.2s',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: V2.surface,
          borderRadius: '24px 24px 0 0',
          maxWidth: 480,
          margin: '0 auto',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          color: V2.ink,
          transform: vis ? 'none' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.34,1.3,0.64,1)',
          border: `1px solid ${V2.border}`,
          borderBottom: 'none',
        }}
      >
        {/* Drag handle + close */}
        <div style={{ position: 'relative', padding: '12px 16px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: V2.borderHi }} />
          </div>
          <button
            onClick={close}
            style={{
              position: 'absolute',
              right: 16,
              top: 8,
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: V2.surfaceAlt,
              border: 'none',
              color: V2.inkLight,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'inherit',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Header */}
        <div style={{ padding: '14px 22px 18px', borderBottom: `1px solid ${V2.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{item.name}</div>
          <div style={{ fontSize: 13, color: V2.inkLight, marginTop: 4 }}>{item.detail}</div>
          {item.unit_price_label && (
            <div style={{ fontSize: 12, color: V2.inkFaint, marginTop: 4 }}>
              You paid {item.unit_price_label}
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 22px' }}>
          {priceList.length > 0 ? (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: V2.inkLight,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                Price at nearby stores
              </div>

              {priceList.map((p) => {
                const headline = p.equivalent_total ?? p.price;
                const isMin = headline === minP;
                const diff = headline - minP;
                const isEquiv = p.match_type === 'equivalent';
                const accentColor = isMin ? V2.lime : p.current ? V2.amber : V2.inkLight;

                return (
                  <div
                    key={p.store}
                    style={{
                      background: isMin ? V2.limeBg : p.current ? V2.amberBg : V2.surfaceAlt,
                      border: `1px solid ${isMin ? V2.lime + '55' : p.current ? V2.amber + '44' : V2.border}`,
                      borderRadius: 14,
                      padding: '14px 16px',
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: V2.ink }}>{p.store}</span>
                          {p.current && (
                            <Tag color={V2.amber} bg={V2.amberBg}>Your store</Tag>
                          )}
                          {isMin && !p.current && (
                            <Tag color={V2.lime} bg={V2.limeBg}>Lowest</Tag>
                          )}
                          {p.warn_stale && (
                            <Tag color={V2.red} bg={V2.redBg}>Stale</Tag>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: V2.inkLight, marginTop: 4 }}>
                          {p.product_name}
                        </div>
                        {isEquiv && p.equiv_note && (
                          <div style={{ fontSize: 11, color: V2.inkFaint, marginTop: 3, fontStyle: 'italic' }}>
                            {p.equiv_note}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: V2.inkFaint }} className="v2-num">
                            {p.per} · {p.dist}
                          </span>
                          <FreshDot freshness={p.freshness} />
                          <span style={{ fontSize: 11, color: V2.inkFaint }} className="v2-num">
                            {p.observations} receipts
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div
                          className="v2-num"
                          style={{
                            fontSize: 20,
                            fontWeight: 800,
                            color: accentColor,
                            lineHeight: 1,
                            letterSpacing: '-0.02em',
                          }}
                        >
                          {fmt(headline)}
                        </div>
                        {p.equivalent_total != null && Math.abs(p.equivalent_total - p.price) > 0.02 && (
                          <div className="v2-num" style={{ fontSize: 11, color: V2.inkFaint, marginTop: 4 }}>
                            {fmt(p.price)} per pack
                          </div>
                        )}
                        {p.member_price != null && p.member_price < p.price - 0.01 && (
                          <div style={{ fontSize: 11, color: V2.amber, fontWeight: 600, marginTop: 4 }}>
                            <span className="v2-num">{fmt(p.member_price)}</span>
                            <span style={{ color: V2.inkFaint, fontWeight: 500 }}>
                              {' '}w/ {p.store?.split(' ')[0] ?? 'card'}
                            </span>
                          </div>
                        )}
                        {diff > 0.05 && (
                          <div className="v2-num" style={{ fontSize: 11, color: V2.red, marginTop: 4 }}>
                            +{fmt(diff)} more
                          </div>
                        )}
                      </div>
                    </div>
                    {isEquiv && (
                      <div
                        style={{
                          marginTop: 10,
                          paddingTop: 10,
                          borderTop: `1px solid ${V2.border}`,
                          fontSize: 11,
                          color: V2.inkFaint,
                        }}
                      >
                        Similar product · {Math.round((p.equivalence_strength ?? 0) * 100)}% match
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div
              style={{
                background: V2.surfaceAlt,
                border: `1px dashed ${V2.border}`,
                borderRadius: 14,
                padding: '20px 16px',
                textAlign: 'center',
                color: V2.inkLight,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {item.reason ?? 'No nearby price data for this item yet.'}
            </div>
          )}

          {/* Trust legend */}
          {priceList.length > 0 && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: V2.inkFaint,
                lineHeight: 1.6,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span>Community receipts ·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FreshDot freshness="green" /> &lt;7d
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FreshDot freshness="yellow" /> 7–30d
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FreshDot freshness="red" /> &gt;30d
              </span>
            </div>
          )}

          {/* OFF enrichment */}
          {item.enrichment && <V2EnrichmentBlock enrichment={item.enrichment} />}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Tag({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color,
        background: bg,
        padding: '2px 6px',
        borderRadius: 4,
      }}
    >
      {children}
    </span>
  );
}

function FreshDot({ freshness, size = 7 }: { freshness: Freshness; size?: number }) {
  return (
    <span
      title={`Data age: ${FRESH_LABELS[freshness]}`}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: FRESH_COLORS[freshness],
        flexShrink: 0,
      }}
    />
  );
}

// ── Enrichment block (dark variant) ────────────────────────────────────────

const NUTRI_COLORS: Record<string, string> = {
  a: '#22c55e',
  b: '#84cc16',
  c: '#facc15',
  d: '#f97316',
  e: '#ef4444',
};

const NOVA_LABELS: Record<number, string> = {
  1: 'Unprocessed',
  2: 'Processed culinary',
  3: 'Processed',
  4: 'Ultra-processed',
};

function V2EnrichmentBlock({ enrichment }: { enrichment: OffEnrichment }) {
  const [showIng, setShowIng] = useState(false);
  const hasScoring = !!(enrichment.nutriscore_grade || enrichment.nova_group || enrichment.ecoscore_grade);
  const hasComp = !!(
    enrichment.ingredients_text ||
    enrichment.allergens.length ||
    enrichment.traces.length ||
    enrichment.additives.length
  );

  if (!enrichment.image_url && !hasScoring && !hasComp) return null;

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${V2.border}` }}>
      <div
        style={{
          fontSize: 11,
          color: V2.inkLight,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          fontWeight: 600,
          marginBottom: 14,
        }}
      >
        About this product
      </div>

      {(enrichment.image_url || enrichment.product_name) && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 14, alignItems: 'center' }}>
          {enrichment.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={enrichment.image_url}
              alt={enrichment.product_name ?? 'product'}
              style={{ width: 76, height: 76, borderRadius: 12, objectFit: 'cover', background: V2.surfaceAlt, flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: 12,
                background: V2.surfaceAlt,
                display: 'grid',
                placeItems: 'center',
                color: V2.inkFaint,
                fontSize: 24,
                flexShrink: 0,
              }}
            >
              📦
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {enrichment.product_name && (
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {enrichment.product_name}
              </div>
            )}
            {enrichment.brands && (
              <div style={{ fontSize: 12, color: V2.inkLight, marginTop: 2 }}>{enrichment.brands}</div>
            )}
            {enrichment.quantity_raw && (
              <div className="v2-num" style={{ fontSize: 11, color: V2.inkFaint, marginTop: 2 }}>
                {enrichment.quantity_raw}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Score badges */}
      {hasScoring && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {enrichment.nutriscore_grade && (
            <ScoreBadge
              label="Nutri-Score"
              value={enrichment.nutriscore_grade.toUpperCase()}
              color={NUTRI_COLORS[enrichment.nutriscore_grade]}
            />
          )}
          {enrichment.nova_group && (
            <ScoreBadge
              label="NOVA"
              value={String(enrichment.nova_group)}
              caption={NOVA_LABELS[enrichment.nova_group]}
              color={enrichment.nova_group === 4 ? V2.red : enrichment.nova_group === 3 ? V2.amber : V2.lime}
            />
          )}
          {enrichment.ecoscore_grade && (
            <ScoreBadge
              label="Eco-Score"
              value={enrichment.ecoscore_grade.toUpperCase()}
              color={NUTRI_COLORS[enrichment.ecoscore_grade]}
            />
          )}
        </div>
      )}

      {/* Allergens */}
      {enrichment.allergens.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              color: V2.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Allergens
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {enrichment.allergens.map((a) => (
              <span
                key={a}
                style={{
                  fontSize: 11,
                  color: V2.red,
                  background: V2.redBg,
                  padding: '3px 8px',
                  borderRadius: 6,
                  textTransform: 'capitalize',
                }}
              >
                {a.replace(/^en:/, '')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Traces */}
      {enrichment.traces.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              color: V2.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            May contain
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {enrichment.traces.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  color: V2.amber,
                  background: V2.amberBg,
                  padding: '3px 8px',
                  borderRadius: 6,
                  textTransform: 'capitalize',
                }}
              >
                {t.replace(/^en:/, '')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Ingredients (collapsible) */}
      {enrichment.ingredients_text && (
        <div style={{ marginBottom: 8 }}>
          <button
            onClick={() => setShowIng((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: V2.inkLight,
              fontSize: 11,
              fontFamily: 'inherit',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Ingredients {showIng ? '−' : '+'}
          </button>
          {showIng && (
            <div style={{ fontSize: 12, color: V2.inkMid, marginTop: 6, lineHeight: 1.55 }}>
              {enrichment.ingredients_text}
            </div>
          )}
        </div>
      )}

      {/* Per-100g nutrition */}
      <NutrimentTable enrichment={enrichment} />
    </div>
  );
}

function ScoreBadge({ label, value, caption, color }: { label: string; value: string; caption?: string; color: string }) {
  return (
    <div
      style={{
        background: V2.surfaceAlt,
        border: `1px solid ${V2.border}`,
        borderRadius: 10,
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: color,
          color: '#0a0a0a',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {value}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 9,
            color: V2.inkLight,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontWeight: 700,
          }}
        >
          {label}
        </div>
        {caption && (
          <div style={{ fontSize: 11, color: V2.ink, marginTop: 1 }}>{caption}</div>
        )}
      </div>
    </div>
  );
}

function NutrimentTable({ enrichment }: { enrichment: OffEnrichment }) {
  const n = enrichment.nutriments;
  const rows: Array<[string, number | null | undefined, string]> = [
    ['Calories',     n.energy_kcal_100g,    'kcal'],
    ['Fat',          n.fat_100g,            'g'],
    ['Saturated fat',n.saturated_fat_100g,  'g'],
    ['Sugars',       n.sugars_100g,         'g'],
    ['Fiber',        n.fiber_100g,          'g'],
    ['Protein',      n.proteins_100g,       'g'],
    ['Sodium',       n.sodium_100g,         'g'],
    ['Salt',         n.salt_100g,           'g'],
  ];
  const present = rows.filter(([, v]) => typeof v === 'number');
  if (present.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 10,
          color: V2.inkLight,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Per 100 g
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 4,
          background: V2.surfaceAlt,
          borderRadius: 10,
          padding: 10,
        }}
      >
        {present.map(([label, value, unit]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              padding: '4px 6px',
              fontSize: 12,
            }}
          >
            <span style={{ color: V2.inkLight }}>{label}</span>
            <span className="v2-num" style={{ color: V2.ink, fontWeight: 600 }}>
              {(value as number).toFixed(unit === 'kcal' ? 0 : 1)} {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
