'use client';

import { useEffect, useRef } from 'react';
import { V3, fmt } from './theme';

// ChainOption shape — duplicated locally rather than imported to keep the
// V3LineSwap component self-contained at the type level. (V3Compare exports
// its own ChainOption privately.)
interface ChainOption {
  canonical_id: number;
  match_type: 'exact' | 'equivalent';
  equivalence_strength: number;
  display_name: string;
  equiv_note: string | null;
  shelf: number;
  member: number | null;
  shelf_total: number | null;
  member_total: number | null;
  freshness: 'green' | 'yellow' | 'red';
  observations: number;
  pack_size: number | null;
  pack_unit: string | null;
}

interface V3LineSwapProps {
  options: ChainOption[];
  selectedId: number | null;
  useMember: boolean;
  onPick: (canonical_id: number) => void;
  onAuto: () => void;
  onNone: () => void;
  onClose: () => void;
}

export default function V3LineSwap({
  options, selectedId, useMember, onPick, onAuto, onNone, onClose,
}: V3LineSwapProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click + escape.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer attaching so the click that opened the popover doesn't close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleEsc);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: '-8px',
        right: '-8px',
        zIndex: 50,
        background: V3.chrome,
        color: V3.ink,
        border: `1px solid ${V3.borderHi}`,
        borderRadius: 10,
        padding: 10,
        boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
        fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: V3.inkLight,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          fontWeight: 600,
          padding: '2px 4px 8px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Available at this store</span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: V3.inkLight,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 14,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {options.length === 0 ? (
        <div style={{ padding: 8, color: V3.inkLight, fontSize: 12 }}>
          No alternatives available.
        </div>
      ) : (
        options.map((opt) => {
          const total = useMember && opt.member_total != null ? opt.member_total : opt.shelf_total;
          const memberShown = useMember && opt.member != null;
          const isSelected = selectedId === opt.canonical_id;
          return (
            <button
              key={opt.canonical_id}
              onClick={() => onPick(opt.canonical_id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                background: isSelected ? V3.pageAlt : 'transparent',
                border: `1px solid ${isSelected ? V3.borderHi : 'transparent'}`,
                borderRadius: 8,
                padding: '8px 10px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: V3.ink,
                textAlign: 'left',
                marginBottom: 4,
              }}
            >
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: opt.match_type === 'exact' ? V3.saveInk : V3.edited,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.display_name}
                </div>
                <div style={{ fontSize: 10, color: V3.inkLight, marginTop: 2 }}>
                  {opt.match_type === 'exact' ? 'Exact match' : 'Similar'}
                  {opt.match_type === 'equivalent' && opt.equiv_note && ` · ${opt.equiv_note}`}
                  {' · '}
                  {opt.observations} receipts
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="v3-num" style={{ fontSize: 14, fontWeight: 700 }}>
                  {total != null ? fmt(total) : '—'}
                </div>
                {memberShown && opt.shelf_total != null && (
                  <div className="v3-num" style={{ fontSize: 10, color: V3.inkLight, marginTop: 1 }}>
                    shelf {fmt(opt.shelf_total)}
                  </div>
                )}
              </div>
              {isSelected && (
                <svg width="14" height="14" viewBox="0 0 18 18" fill="none" style={{ color: V3.ink, flexShrink: 0 }}>
                  <path d="M4 9l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          );
        })
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${V3.border}` }}>
        <button
          onClick={onAuto}
          style={{
            flex: 1,
            background: 'transparent',
            border: `1px dashed ${V3.border}`,
            borderRadius: 6,
            padding: '7px 8px',
            color: V3.inkMid,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Auto pick
        </button>
        <button
          onClick={onNone}
          style={{
            flex: 1,
            background: 'transparent',
            border: `1px dashed ${V3.border}`,
            borderRadius: 6,
            padding: '7px 8px',
            color: V3.inkMid,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Not buying here
        </button>
      </div>
    </div>
  );
}
