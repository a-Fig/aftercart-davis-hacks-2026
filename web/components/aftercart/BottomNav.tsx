import { Theme } from './data';

interface BottomNavProps {
  tab: string;
  setTab: (tab: string) => void;
  onScan: () => void;
  t: Theme;
}

export default function BottomNav({ tab, setTab, onScan, t }: BottomNavProps) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: t.surface, borderTop: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', zIndex: 30, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Home tab */}
      <button onClick={() => setTab('home')} style={{ flex: 1, padding: '10px 0 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: tab === 'home' ? t.accent : t.inkFaint }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M7 18v-6h6v6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 'var(--t-xs)', fontWeight: tab === 'home' ? 600 : 400 }}>Home</span>
      </button>

      {/* Centre scan FAB */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '6px 0 10px' }}>
        <button onClick={onScan} style={{ width: 52, height: 52, borderRadius: '50%', background: t.cta, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 16px ${t.cta}55`, color: '#fff' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="3" y="3" width="5" height="5" rx="1" stroke="white" strokeWidth="1.7" />
            <rect x="14" y="3" width="5" height="5" rx="1" stroke="white" strokeWidth="1.7" />
            <rect x="3" y="14" width="5" height="5" rx="1" stroke="white" strokeWidth="1.7" />
            <circle cx="16.5" cy="16.5" r="2.5" stroke="white" strokeWidth="1.7" />
            <line x1="11" y1="5" x2="13" y2="5" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
            <line x1="11" y1="11" x2="19" y2="11" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
            <line x1="5" y1="11" x2="9" y2="11" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Saved tab */}
      <button onClick={() => setTab('saved')} style={{ flex: 1, padding: '10px 0 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: tab === 'saved' ? t.accent : t.inkFaint }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 3C7.5 3 4 5.5 4 9.5c0 5.5 6 9 6 9s6-3.5 6-9C16 5.5 12.5 3 10 3z" stroke="currentColor" strokeWidth="1.6" fill={tab === 'saved' ? 'currentColor' : 'none'} />
        </svg>
        <span style={{ fontSize: 'var(--t-xs)', fontWeight: tab === 'saved' ? 600 : 400 }}>Saved</span>
      </button>
    </div>
  );
}
