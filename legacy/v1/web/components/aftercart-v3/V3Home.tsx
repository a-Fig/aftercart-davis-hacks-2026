'use client';

import { V3 } from './theme';

interface V3HomeProps {
  hasReceipt: boolean;
  comparing: boolean;
  onCameraClick: () => void;
  onUploadClick: () => void;
  onViewLastScan: () => void;
}

export default function V3Home({ hasReceipt, comparing, onCameraClick, onUploadClick, onViewLastScan }: V3HomeProps) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div
        style={{
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${V3.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark />
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
            aftercart
            <span style={{ color: V3.inkFaint, marginLeft: 8, fontWeight: 500 }}>/ v3 · side-by-side</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href="/" style={navLink}>v1</a>
          <a href="/v2" style={navLink}>v2</a>
        </div>
      </div>

      {/* Hero */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 32px',
        }}
      >
        <div style={{ maxWidth: 980, width: '100%', display: 'grid', gap: 32, gridTemplateColumns: 'minmax(260px, 1.1fr) minmax(240px, 1fr)', alignItems: 'center' }}>
          {/* Left: action */}
          <div>
            <div
              style={{
                fontSize: 11,
                color: V3.inkLight,
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                fontWeight: 600,
                marginBottom: 14,
              }}
            >
              Receipt comparison
            </div>
            <h1
              style={{
                fontSize: 52,
                lineHeight: 1.05,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                margin: 0,
              }}
            >
              Two receipts.<br />
              <span style={{ color: V3.saveInk }}>One verdict.</span>
            </h1>
            <p
              style={{
                marginTop: 20,
                fontSize: 16,
                lineHeight: 1.55,
                color: V3.inkMid,
                maxWidth: 460,
              }}
            >
              Scan a grocery receipt — we&apos;ll print what the same trip would have looked like at every nearby store. Edit any line; the totals update.
            </p>

            <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
              <button
                onClick={onCameraClick}
                disabled={comparing}
                style={{
                  padding: '16px 26px',
                  background: V3.ink,
                  color: V3.page,
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  fontFamily: 'inherit',
                  cursor: comparing ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
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
                  padding: '16px 22px',
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
                    padding: '16px 22px',
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
          </div>

          {/* Right: visual — two stacked tiny receipts */}
          <div
            style={{
              position: 'relative',
              minHeight: 360,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <MiniReceipt
              title="SAFEWAY"
              total="$54.67"
              rows={[
                ['CHKN THIGHS', '7.39'],
                ['GROUND BEEF', '6.49'],
                ['WHOLE MILK', '5.29'],
                ['GREEK YOGURT', '4.99'],
                ['CHEDDAR', '3.79'],
              ]}
              tone="receipt"
              style={{ position: 'absolute', transform: 'translate(-22%, -8%) rotate(-4deg)' }}
            />
            <MiniReceipt
              title="GROCERY OUTLET"
              total="$41.15"
              tag="↓ $13.52"
              rows={[
                ['CHKN THIGHS', '4.26'],
                ['GROUND BEEF', '5.16'],
                ['WHOLE MILK', '4.99'],
                ['GREEK YOGURT', '3.49'],
                ['CHEDDAR', '2.99'],
              ]}
              tone="alt"
              style={{ position: 'absolute', transform: 'translate(28%, 14%) rotate(5deg)' }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '14px 32px',
          color: V3.inkFaint,
          fontSize: 11,
          borderTop: `1px solid ${V3.border}`,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Community price data · no ads · no retailer relationships</span>
        <span>Tablet / desktop layout</span>
      </div>
    </div>
  );
}

const navLink: React.CSSProperties = {
  fontSize: 12,
  color: V3.inkMid,
  textDecoration: 'none',
  padding: '6px 10px',
  borderRadius: 6,
  border: `1px solid ${V3.border}`,
};

function Mark() {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        background: V3.ink,
        color: V3.page,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: 16,
        letterSpacing: '-0.05em',
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

function MiniReceipt({
  title, total, tag, rows, tone, style,
}: {
  title: string; total: string; tag?: string;
  rows: Array<[string, string]>;
  tone: 'receipt' | 'alt';
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        ...style,
        background: V3.paper,
        color: V3.paperInk,
        width: 220,
        padding: '20px 18px 18px',
        boxShadow: '0 30px 60px -20px rgba(0,0,0,0.6), 0 8px 16px rgba(0,0,0,0.3)',
        borderRadius: 4,
        position: 'relative',
        ...(style ?? {}),
      }}
    >
      {tag && (
        <div
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
          className="v3-num"
        >
          {tag}
        </div>
      )}
      <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '0.1em', marginBottom: 4 }} className="v3-mono">
        {title}
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, color: V3.paperMute, marginBottom: 10 }} className="v3-mono">
        — — — — — — — — —
      </div>
      {rows.map(([name, price], i) => (
        <div
          key={i}
          className="v3-mono"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            padding: '2px 0',
            color: tone === 'alt' ? V3.paperInk : V3.paperInk,
          }}
        >
          <span>{name}</span>
          <span>{price}</span>
        </div>
      ))}
      <div style={{ textAlign: 'center', fontSize: 9, color: V3.paperMute, margin: '8px 0' }} className="v3-mono">
        — — — — — — — — —
      </div>
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800 }}>
        <span>TOTAL</span>
        <span>{total}</span>
      </div>
    </div>
  );
}
