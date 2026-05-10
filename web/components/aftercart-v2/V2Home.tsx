'use client';

import { useMemo } from 'react';
import { V2, fmt, fmtBig } from './theme';
import type { Receipt } from '@/components/aftercart/data';

interface V2HomeProps {
  receipt: Receipt | null;
  onCameraClick: () => void;
  onUploadClick: () => void;
  onViewLastScan: () => void;
}

export default function V2Home({ receipt, onCameraClick, onUploadClick, onViewLastScan }: V2HomeProps) {
  // Pick the best store from the receipt comparisons (greatest savings).
  const bestStore = useMemo(() => {
    if (!receipt) return null;
    const entries = Object.entries(receipt.comparisons);
    if (entries.length === 0) return null;
    return entries.reduce((a, b) => (b[1].saves > a[1].saves ? b : a));
  }, [receipt]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Brand bar ───────────────────────────────────────────── */}
      <div
        style={{
          padding: '20px 22px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: V2.lime,
              display: 'grid',
              placeItems: 'center',
              color: V2.bg,
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: '-0.05em',
            }}
          >
            ƒ
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>
            aftercart
            <span style={{ color: V2.inkFaint, marginLeft: 6, fontWeight: 500 }}>/ v2</span>
          </div>
        </div>
        <a
          href="/"
          style={{
            fontSize: 12,
            color: V2.inkLight,
            textDecoration: 'none',
            padding: '6px 10px',
            borderRadius: 8,
            border: `1px solid ${V2.border}`,
          }}
        >
          v1 ↗
        </a>
      </div>

      {/* ── Hero CTA — single decisive action ───────────────────── */}
      <div style={{ padding: '36px 22px 24px', flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            color: V2.inkLight,
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            marginBottom: 16,
            fontWeight: 600,
          }}
        >
          Scan a receipt
        </div>

        <button
          onClick={onCameraClick}
          style={{
            width: '100%',
            padding: '34px 22px',
            background: V2.lime,
            color: V2.bg,
            border: 'none',
            borderRadius: 22,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 700,
            textAlign: 'left',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: `0 16px 48px -12px ${V2.limeRing}`,
            transition: 'transform 0.12s ease',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.985)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = '')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 32, lineHeight: 1, letterSpacing: '-0.03em', fontWeight: 800 }}>
                Open camera
              </div>
              <div style={{ fontSize: 14, marginTop: 8, opacity: 0.7, fontWeight: 500 }}>
                Snap a grocery receipt — we&apos;ll do the rest.
              </div>
            </div>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M3 8a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
        </button>

        <button
          onClick={onUploadClick}
          style={{
            width: '100%',
            marginTop: 12,
            padding: '14px 18px',
            background: V2.surface,
            color: V2.ink,
            border: `1px solid ${V2.border}`,
            borderRadius: 14,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Upload from camera roll
        </button>
      </div>

      {/* ── Last scan card ─────────────────────────────────────── */}
      {receipt && (
        <div style={{ padding: '0 22px 16px' }}>
          <div
            style={{
              fontSize: 12,
              color: V2.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              marginBottom: 10,
              fontWeight: 600,
            }}
          >
            Last scan
          </div>

          <button
            onClick={onViewLastScan}
            style={{
              width: '100%',
              background: V2.surface,
              border: `1px solid ${V2.border}`,
              borderRadius: 18,
              padding: 18,
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: V2.ink,
              textAlign: 'left',
              display: 'block',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{receipt.store}</div>
                <div style={{ fontSize: 12, color: V2.inkLight, marginTop: 2 }}>
                  {receipt.date} · {receipt.items_count} items · {fmt(receipt.total)}
                </div>
              </div>
              {bestStore && bestStore[1].saves > 0 ? (
                <div style={{ textAlign: 'right' }}>
                  <div className="v2-num" style={{ fontSize: 24, fontWeight: 800, color: V2.lime, lineHeight: 1 }}>
                    {fmtBig(bestStore[1].saves, true)}
                  </div>
                  <div style={{ fontSize: 11, color: V2.inkLight, marginTop: 4 }}>
                    at {bestStore[0].split(' ')[0]}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 11,
                    color: V2.inkLight,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: `1px solid ${V2.border}`,
                  }}
                >
                  no comp data
                </div>
              )}
            </div>

            <div style={{ height: 1, background: V2.border, margin: '0 -2px 14px' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: V2.lime, fontWeight: 600 }}>
                Open breakdown →
              </span>
              <span style={{ fontSize: 11, color: V2.inkFaint }}>
                {receipt.compared_count} of {receipt.items_count} matched
              </span>
            </div>
          </button>
        </div>
      )}

      {/* ── Tiny footer ─────────────────────────────────────────── */}
      <div style={{ padding: '16px 22px 28px', color: V2.inkFaint, fontSize: 11, lineHeight: 1.6 }}>
        Community price data · no ads · no retailer relationships
      </div>
    </div>
  );
}
