'use client';

import { useState, useEffect } from 'react';
import NavBar from './NavBar';
import { THEMES, fmt, Receipt } from './data';

interface HomeScreenProps {
  receipt: Receipt;
  hasReceipt: boolean;
  onCameraClick: () => void;
  onUploadClick: () => void;
  onViewLastScan: () => void;
}

export default function HomeScreen({ receipt, hasReceipt, onCameraClick, onUploadClick, onViewLastScan }: HomeScreenProps) {
  const t = THEMES.forest;
  const [visible, setVisible] = useState(false);
  useEffect(() => { const id = setTimeout(() => setVisible(true), 60); return () => clearTimeout(id); }, []);

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'none' : 'translateY(10px)',
    transition: `all 0.45s ease ${delay}s`,
  });

  return (
    <div>
      <NavBar t={t} />

      <div style={{ padding: '32px 24px 20px', ...fade() }}>
        <div style={{ color: t.inkFaint, fontSize: 'var(--t-xs)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Welcome back</div>
        <h1 style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-xl)', lineHeight: 1.15, color: t.inkDark, marginBottom: 10 }}>
          Did you pay more<br />than you had to?
        </h1>
        <p style={{ fontSize: 'var(--t-base)', color: t.inkLight, lineHeight: 1.65, maxWidth: 300 }}>
          Scan any grocery receipt — we&apos;ll show you what your basket costs at nearby stores.
        </p>
      </div>

      <div style={{ padding: '0 24px 28px', ...fade(0.1) }}>
        <button
          onClick={onCameraClick}
          style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', cursor: 'pointer', background: t.cta, color: '#fff', fontSize: 'var(--t-md)', fontWeight: 600, letterSpacing: '-0.2px', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: `0 4px 18px ${t.cta}44`, transition: 'transform 0.12s' }}
          onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
          onMouseUp={e => (e.currentTarget.style.transform = '')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3 7V4a1 1 0 011-1h3M13 3h3a1 1 0 011 1v3M17 13v3a1 1 0 01-1 1h-3M7 17H4a1 1 0 01-1-1v-3" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          Scan a Receipt
        </button>
        <button
          onClick={onUploadClick}
          style={{ width: '100%', padding: 14, marginTop: 10, borderRadius: 12, border: `1.5px solid ${t.border}`, background: 'transparent', color: t.inkMid, fontFamily: 'inherit', fontSize: 'var(--t-sm)', fontWeight: 500, cursor: 'pointer', letterSpacing: '-0.1px' }}
        >
          Upload from camera roll
        </button>
      </div>

      {/* Last scan card — only shown once a real scan has completed. */}
      {hasReceipt && (
        <div style={{ padding: '0 24px', ...fade(0.15) }}>
          <button
            onClick={onViewLastScan}
            style={{ width: '100%', background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: '16px 18px', cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s, box-shadow 0.12s', display: 'block' }}
            onMouseEnter={e => { e.currentTarget.style.background = t.surfaceAlt; e.currentTarget.style.boxShadow = `0 2px 12px ${t.border}`; }}
            onMouseLeave={e => { e.currentTarget.style.background = t.surface; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: t.inkDark }}>Last scan</span>
              <span style={{ fontSize: 'var(--t-xs)', color: t.inkFaint }}>{receipt.date}</span>
            </div>
            <div style={{ fontSize: 'var(--t-sm)', color: t.inkLight, marginBottom: 10 }}>
              {receipt.store} · {receipt.items_count} items · {fmt(receipt.total)}
            </div>

            {Object.keys(receipt.comparisons).length > 0 ? (
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {Object.entries(receipt.comparisons).map(([store, c]) => (
                  <div key={store} style={{ flex: 1, background: t.surfaceAlt, borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginBottom: 2 }}>{store.split(' ')[0]}</div>
                    <div style={{ fontSize: 'var(--t-sm)', fontWeight: 700, color: c.saves > 0 ? t.save : t.inkLight }}>
                      {c.saves > 0 ? `−${fmt(c.saves)}` : fmt(c.total)}
                    </div>
                    <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint }}>{c.dist}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 'var(--t-xs)', color: t.inkFaint, marginBottom: 10 }}>
                {receipt.compared_count} of {receipt.items_count} items matched · no nearby price data yet
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--t-xs)', color: t.accent, fontWeight: 600 }}>View full breakdown</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: t.accent }}>
                <path d="M4 7h6M8 5l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </button>
        </div>
      )}

      <div style={{ padding: '28px 24px 8px', ...fade(0.2) }}>
        <div style={{ color: t.inkFaint, fontSize: 'var(--t-xs)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>How it works</div>
        {[
          ['Photograph your receipt', 'Any store, any lighting, even crumpled'],
          ['We compare every item', 'Matched to nearby stores within 5 miles'],
          ['See where to save', 'Real prices, real distances, no ads'],
        ].map(([heading, sub], i) => (
          <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: t.accentBg, color: t.accent, fontWeight: 700, fontSize: 'var(--t-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              {i + 1}
            </div>
            <div>
              <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: t.inkDark }}>{heading}</div>
              <div style={{ fontSize: 'var(--t-xs)', color: t.inkLight, marginTop: 2 }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
