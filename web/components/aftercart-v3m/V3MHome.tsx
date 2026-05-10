'use client';

import { V3, fmt } from '@/components/aftercart-v3/theme';

interface V3MHomeProps {
  hasReceipt: boolean;
  comparing: boolean;
  onCameraClick: () => void;
  onUploadClick: () => void;
  onViewLastScan: () => void;
}

/**
 * Mobile home for v3m — a single column. No two-up hero. Brand bar at the top,
 * a punchy headline, scan + upload buttons, and (when present) a "view last
 * scan" affordance. Designed for a 390 × 844 (iPhone) viewport.
 */
export default function V3MHome({ hasReceipt, comparing, onCameraClick, onUploadClick, onViewLastScan }: V3MHomeProps) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Brand bar */}
      <div
        style={{
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${V3.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mark />
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            aftercart
            <span style={{ color: V3.inkFaint, marginLeft: 6, fontWeight: 500 }}>/ v3m</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <a href="/" style={navLink}>v1</a>
          <a href="/v2" style={navLink}>v2</a>
          <a href="/v3" style={navLink}>v3</a>
        </div>
      </div>

      {/* Hero */}
      <div style={{ padding: '32px 22px 18px' }}>
        <div
          style={{
            fontSize: 11,
            color: V3.inkLight,
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Receipt comparison
        </div>
        <h1
          style={{
            fontSize: 36,
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          Two receipts.<br />
          <span style={{ color: V3.saveInk }}>One verdict.</span>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: V3.inkMid, maxWidth: 320 }}>
          Snap a grocery receipt — we&apos;ll show what the same trip would have cost at one nearby store at a time. Edit any line; the totals update.
        </p>
      </div>

      {/* Buttons */}
      <div style={{ padding: '0 22px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={onCameraClick}
          disabled={comparing}
          style={{
            width: '100%',
            padding: '18px 18px',
            background: V3.ink,
            color: V3.page,
            border: 'none',
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            fontFamily: 'inherit',
            cursor: comparing ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            opacity: comparing ? 0.6 : 1,
          }}
        >
          <CameraIcon />
          Scan a receipt
        </button>
        <button
          onClick={onUploadClick}
          disabled={comparing}
          style={{
            width: '100%',
            padding: '14px 18px',
            background: 'transparent',
            color: V3.ink,
            border: `1px solid ${V3.borderHi}`,
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: comparing ? 'wait' : 'pointer',
            opacity: comparing ? 0.6 : 1,
          }}
        >
          Upload a photo
        </button>
        {hasReceipt && (
          <button
            onClick={onViewLastScan}
            style={{
              width: '100%',
              padding: '14px 18px',
              background: 'transparent',
              color: V3.inkMid,
              border: `1px dashed ${V3.borderHi}`,
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            View last scan →
          </button>
        )}
      </div>

      {/* Single mini receipt teaser */}
      <div
        style={{
          flex: 1,
          padding: '16px 22px 28px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        <MiniReceipt
          title="GROCERY OUTLET"
          rows={[
            ['CHKN THIGHS', '4.26'],
            ['GROUND BEEF', '5.16'],
            ['WHOLE MILK', '4.99'],
            ['CHEDDAR', '2.99'],
          ]}
          total={fmt(41.15)}
          tag={`↓ ${fmt(13.52)}`}
        />
      </div>

      <div
        style={{
          padding: '12px 22px calc(20px + env(safe-area-inset-bottom))',
          color: V3.inkFaint,
          fontSize: 11,
          borderTop: `1px solid ${V3.border}`,
          textAlign: 'center',
        }}
      >
        Community price data · no ads · no retailer relationships
      </div>
    </div>
  );
}

const navLink: React.CSSProperties = {
  fontSize: 11,
  color: V3.inkMid,
  textDecoration: 'none',
  padding: '5px 8px',
  borderRadius: 6,
  border: `1px solid ${V3.border}`,
};

function Mark() {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        background: V3.ink,
        color: V3.page,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: 14,
      }}
    >
      ƒ
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 8a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function MiniReceipt({ title, rows, total, tag }: {
  title: string;
  rows: Array<[string, string]>;
  total: string;
  tag?: string;
}) {
  return (
    <div
      style={{
        background: V3.paper,
        color: V3.paperInk,
        width: 220,
        padding: '20px 18px 18px',
        boxShadow: '0 24px 48px -16px rgba(0,0,0,0.55), 0 6px 16px rgba(0,0,0,0.25)',
        borderRadius: 4,
        position: 'relative',
        transform: 'rotate(-1.5deg)',
      }}
    >
      {tag && (
        <div
          className="v3-num"
          style={{
            position: 'absolute',
            top: -10,
            right: -12,
            background: V3.saveInk,
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 800,
            transform: 'rotate(8deg)',
            boxShadow: '0 6px 12px rgba(31,122,58,0.45)',
          }}
        >
          {tag}
        </div>
      )}
      <div className="v3-mono" style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '0.1em' }}>
        {title}
      </div>
      <div className="v3-mono" style={{ textAlign: 'center', fontSize: 9, color: V3.paperMute, margin: '6px 0 8px' }}>
        — — — — — — — — —
      </div>
      {rows.map(([name, price], i) => (
        <div key={i} className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
          <span>{name}</span>
          <span>{price}</span>
        </div>
      ))}
      <div className="v3-mono" style={{ textAlign: 'center', fontSize: 9, color: V3.paperMute, margin: '8px 0' }}>
        — — — — — — — — —
      </div>
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800 }}>
        <span>TOTAL</span>
        <span>{total}</span>
      </div>
    </div>
  );
}
