'use client';

import { useState, useEffect, useMemo } from 'react';
import NavBar from './NavBar';
import { THEMES, fmt, catSavings, Freshness, FRESH_COLORS, FRESH_LABELS, ReceiptItem, Receipt } from './data';

function FreshDot({ freshness, size = 6 }: { freshness: Freshness; size?: number }) {
  return (
    <span
      title={`Data age: ${FRESH_LABELS[freshness]}`}
      style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: FRESH_COLORS[freshness], flexShrink: 0 }}
    />
  );
}

interface ResultsScreenProps {
  receipt: Receipt;
  onBack: () => void;
  savedItems: Set<string>;
  onItemClick: (item: ReceiptItem) => void;
}

export default function ResultsScreen({ receipt, onBack, savedItems, onItemClick }: ResultsScreenProps) {
  const t = THEMES.forest;
  const [openCats, setOpenCats] = useState<Set<string>>(() => {
    // Default-open the first non-unmatched category so users see content immediately.
    const first = receipt.categories.find((c) => !c.isUnmatched);
    return new Set(first ? [first.id] : []);
  });

  // Comparison stores come from the receipt itself, not a global constant —
  // a Costco receipt and a TJ's receipt produce different alternative store
  // sets depending on what's nearby with current price data.
  const storeNames = useMemo(() => Object.keys(receipt.comparisons), [receipt]);

  // Derive activeStore from a "user override" + the current storeNames list,
  // rather than syncing via useEffect (the prior pattern triggered the
  // react-hooks/set-state-in-effect rule). When the receipt changes and the
  // override no longer appears in storeNames, fall back to the first store.
  const [userSelectedStore, setUserSelectedStore] = useState<string | null>(null);
  const activeStore =
    userSelectedStore && storeNames.includes(userSelectedStore)
      ? userSelectedStore
      : (storeNames[0] ?? null);
  const setActiveStore = setUserSelectedStore;

  const [visible, setVisible] = useState(false);
  useEffect(() => { const id = setTimeout(() => setVisible(true), 50); return () => clearTimeout(id); }, []);

  const comp = activeStore ? receipt.comparisons[activeStore] : null;
  const toggle = (id: string) =>
    setOpenCats(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <div style={{ minHeight: '100%', background: t.bg }}>
      <NavBar
        t={t}
        onBack={onBack}
        title={`${receipt.store}${receipt.date ? ` · ${receipt.date}` : ''}`}
        subtitle={`${receipt.compared_count} of ${receipt.items_count} items compared`}
      />

      {/* Savings hero — switches to a no-data variant when comparisons is empty. */}
      <div style={{ background: `linear-gradient(150deg, ${t.accent} 0%, #071a10 100%)`, padding: '24px 24px 20px', opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(6px)', transition: 'all 0.4s ease' }}>
        {comp ? (
          <>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 'var(--t-xs)', marginBottom: 6 }}>
              Your {fmt(comp.paid)} on {comp.matched_count} {comp.matched_count === 1 ? 'item' : 'items'} could cost
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-disp)', color: '#fff', lineHeight: 1 }}>
                {fmt(comp.total)}
              </span>
              {comp.saves > 0 && (
                <span style={{ background: t.save, color: '#fff', borderRadius: 20, padding: '3px 10px', fontSize: 'var(--t-xs)', fontWeight: 700, letterSpacing: '0.03em' }}>
                  −{fmt(comp.saves)}
                </span>
              )}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 'var(--t-sm)', marginTop: 2 }}>
              at <strong style={{ color: '#fff' }}>{activeStore}</strong> · {comp.dist} away{comp.saves > 0 ? ` · saves ${comp.pct}%` : ''}
            </div>
            {/* Honest coverage: comp.matched_count of total_compared. When a store
                only carries 4 of 19 of the user's matched items, the headline
                savings number above only reflects those 4. */}
            {comp.matched_count < comp.total_compared && (
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 'var(--t-xs)', marginTop: 6, fontStyle: 'italic' }}>
                Comparable on {comp.matched_count} of {comp.total_compared} matched items at this store. The rest aren&apos;t priced here yet.
              </div>
            )}
            {storeNames.length > 1 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
                {storeNames.map(s => (
                  <button
                    key={s}
                    onClick={() => setActiveStore(s)}
                    style={{ padding: '7px 14px', borderRadius: 20, border: `1.5px solid ${activeStore === s ? '#fff' : 'rgba(255,255,255,0.18)'}`, background: activeStore === s ? 'rgba(255,255,255,0.14)' : 'transparent', color: '#fff', fontFamily: 'inherit', fontSize: 'var(--t-xs)', fontWeight: activeStore === s ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s' }}
                  >
                    {s} <span style={{ opacity: 0.55 }}>−{fmt(receipt.comparisons[s].saves)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 'var(--t-xs)', marginBottom: 6 }}>
              Your trip at {receipt.store}
            </div>
            <div style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-disp)', color: '#fff', lineHeight: 1, marginBottom: 8 }}>
              {fmt(receipt.total)}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 'var(--t-sm)', lineHeight: 1.55 }}>
              We matched {receipt.compared_count} of {receipt.items_count} items, but no nearby store has reported recent prices for them yet. As more receipts come in, this comparison fills out.
            </div>
          </>
        )}
      </div>

      {/* Breakdown */}
      <div style={{ padding: '12px 14px 0' }}>
        <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: t.inkFaint, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 2px 12px' }}>
          Item Breakdown
        </div>

        {receipt.categories.map((cat, ci) => {
          const isOpen = openCats.has(cat.id);
          const { save: catSave, hasEquiv } = activeStore
            ? catSavings(cat, activeStore)
            : { save: 0, hasEquiv: false };

          if (cat.isUnmatched) return (
            <div key={cat.id} style={{ background: t.surface, borderRadius: 12, border: `1.5px dashed ${t.border}`, marginBottom: 8, overflow: 'hidden', opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(6px)', transition: `all 0.4s ease ${0.08 + ci * 0.06}s` }}>
              <button onClick={() => toggle(cat.id)} style={{ width: '100%', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: t.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 4v4M7 10v.5" stroke={t.inkFaint} strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="7" cy="7" r="6" stroke={t.inkFaint} strokeWidth="1.2" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: t.inkLight }}>{cat.label}</div>
                  <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 2 }}>{cat.items.length} item{cat.items.length === 1 ? '' : 's'} · no nearby price data</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: t.inkFaint }}>
                  <path d="M2.5 5l4.5 4.5L11.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {isOpen && (
                <div style={{ borderTop: `1px solid ${t.border}` }}>
                  {cat.items.map(item => (
                    <div key={item.id} style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 500, color: t.inkLight }}>{item.name}</div>
                        <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 2 }}>{item.detail}</div>
                        {item.reason && (
                          <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 4, lineHeight: 1.4 }}>{item.reason}</div>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--t-sm)', color: t.inkLight, fontWeight: 500, flexShrink: 0 }}>{fmt(item.paid)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );

          return (
            <div key={cat.id} style={{ background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, marginBottom: 8, overflow: 'hidden', opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(6px)', transition: `all 0.4s ease ${0.08 + ci * 0.06}s` }}>
              <button onClick={() => toggle(cat.id)} style={{ width: '100%', padding: '15px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: t.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                  {cat.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: t.inkDark }}>{cat.label}</div>
                  <div style={{ fontSize: 'var(--t-xs)', color: t.inkLight, marginTop: 2 }}>
                    You paid {fmt(cat.items.reduce((s, i) => s + i.paid, 0))} · {cat.items.length} items{hasEquiv ? ' · incl. similar' : ''}
                  </div>
                </div>
                {activeStore && (
                  <div style={{ textAlign: 'right', marginRight: 6, flexShrink: 0 }}>
                    {catSave > 0.05 ? (
                      <>
                        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 700, color: t.save }}>−{fmt(catSave)}</div>
                        <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginTop: 1 }}>at {activeStore.split(' ')[0]}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 'var(--t-xs)', color: t.pos }}>Best price ✓</div>
                    )}
                  </div>
                )}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0, color: t.inkFaint }}>
                  <path d="M2.5 5l4.5 4.5L11.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>

              {isOpen && (
                <div style={{ borderTop: `1px solid ${t.border}` }}>
                  {cat.items.map((item, ii) => {
                    const altP = activeStore ? item.prices[activeStore] : undefined;
                    const save = altP ? item.paid - altP.price : 0;
                    const isSaved = savedItems.has(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => onItemClick(item)}
                        style={{ padding: '13px 16px', borderBottom: ii < cat.items.length - 1 ? `1px solid ${t.border}` : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = t.surfaceAlt)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 'var(--t-sm)', fontWeight: 500, color: t.inkDark }}>{item.name}</span>
                            {isSaved && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: t.saved, background: t.savedBg, padding: '1px 6px', borderRadius: 8, letterSpacing: '0.04em' }}>SAVED</span>
                            )}
                            {altP?.match_type === 'equivalent' && (
                              <span style={{ fontSize: 10, color: t.chipFg, background: t.chip, padding: '1px 5px', borderRadius: 6 }}>~similar</span>
                            )}
                            {altP?.member_price != null && altP.member_price < altP.price - 0.01 && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: t.saved, background: t.savedBg, padding: '1px 5px', borderRadius: 6 }}>w/ card</span>
                            )}
                          </div>
                          <div style={{ fontSize: 'var(--t-xs)', color: t.inkLight, marginTop: 3 }}>{item.detail}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 'var(--t-sm)', color: t.inkDark, fontWeight: 500 }}>{fmt(item.paid)}</div>
                          {save > 0.05 && <div style={{ fontSize: 'var(--t-xs)', color: t.save, fontWeight: 600 }}>−{fmt(save)}</div>}
                          {save <= 0.05 && altP && <div style={{ fontSize: 'var(--t-xs)', color: t.pos }}>Best ✓</div>}
                        </div>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: t.inkFaint, flexShrink: 0 }}>
                          <path d="M3.5 6h5M6.5 4l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Footer note */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 2px 24px' }}>
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
      </div>
    </div>
  );
}
