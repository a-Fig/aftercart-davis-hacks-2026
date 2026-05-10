'use client';

import NavBar from './NavBar';
import { THEMES, fmt, allComparableItems, ReceiptItem, Receipt } from './data';

interface SavedScreenProps {
  receipt: Receipt;
  savedItems: Set<string>;
  onItemClick: (item: ReceiptItem) => void;
}

export default function SavedScreen({ receipt, savedItems, onItemClick }: SavedScreenProps) {
  const t = THEMES.forest;
  const items = allComparableItems(receipt).filter(i => savedItems.has(i.id));

  return (
    <div style={{ minHeight: '100%', background: t.bg }}>
      <NavBar t={t} />
      <div style={{ padding: '24px 24px 12px' }}>
        <h2 style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-xl)', color: t.inkDark, marginBottom: 4 }}>Saved Items</h2>
        <p style={{ fontSize: 'var(--t-sm)', color: t.inkLight }}>
          {items.length ? `${items.length} item${items.length > 1 ? 's' : ''} saved for tracking` : 'No saved items yet'}
        </p>
      </div>

      {items.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: t.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 4C9 4 5 7 5 12c0 7 7 10 7 10s7-3 7-10c0-5-4-8-7-8z" stroke={t.inkFaint} strokeWidth="1.6" />
            </svg>
          </div>
          <p style={{ fontSize: 'var(--t-sm)', color: t.inkFaint, lineHeight: 1.6 }}>
            Tap any item in a breakdown<br />and save it to track price drops
          </p>
        </div>
      )}

      <div style={{ padding: '0 14px' }}>
        {items.map(item => {
          const prices = Object.values(item.prices);
          const minP = Math.min(...prices.map(p => p.price));
          const curP = prices.find(p => p.current);
          const save = curP ? curP.price - minP : 0;
          return (
            <div
              key={item.id}
              onClick={() => onItemClick(item)}
              style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.background = t.surfaceAlt)}
              onMouseLeave={e => (e.currentTarget.style.background = t.surface)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: t.inkDark }}>{item.name}</div>
                <div style={{ fontSize: 'var(--t-xs)', color: t.inkLight, marginTop: 2 }}>{item.detail}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: curP ? t.inkDark : t.inkLight }}>
                  {curP ? fmt(curP.price) : '—'}
                </div>
                {save > 0.05 && (
                  <div style={{ fontSize: 'var(--t-xs)', color: t.save, fontWeight: 600 }}>−{fmt(save)} elsewhere</div>
                )}
              </div>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: t.inkFaint, flexShrink: 0 }}>
                <path d="M3.5 6h5M6.5 4l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}
