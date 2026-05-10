import { Theme } from './data';

interface NavBarProps {
  t: Theme;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

export default function NavBar({ t, title, subtitle, onBack, right }: NavBarProps) {
  return (
    <div style={{ background: t.navBg, color: t.navFg, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 20 }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: '7px 9px', cursor: 'pointer', color: t.navFg, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {!onBack && (
        <span style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-lg)', letterSpacing: '-0.4px' }}>
          AfterCart
        </span>
      )}
      {onBack && (
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-dm-serif), DM Serif Display, serif', fontSize: 'var(--t-md)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 'var(--t-xs)', color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>{subtitle}</div>}
        </div>
      )}
      {!onBack && <div style={{ flex: 1 }} />}
      {right ?? (
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="5" r="3" stroke={t.navFg} strokeWidth="1.5" />
            <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={t.navFg} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
