'use client';

import { useEffect, useState } from 'react';
import { V3, fmt } from '@/components/aftercart-v3/theme';
import type { ChainOption } from '@/components/aftercart-v3/projection';

interface SwapTarget {
  chain_id: number;
  row_idx: number;
  options: ChainOption[];
  selected: number | null;
  useMember: boolean;
  rowItemName: string;
}

interface V3MLineSwapProps {
  target: SwapTarget;
  onPick: (canonical_id: number) => void;
  onAuto: () => void;
  onNone: () => void;
  onClose: () => void;
}

/**
 * Bottom sheet swap UI for the mobile compare screen. The desktop popover
 * doesn't fit at narrow viewports and would clip; a sheet is the standard
 * mobile pattern. Slides up from the bottom, respects the safe-area inset,
 * tap-outside or close button to dismiss.
 */
export default function V3MLineSwap({ target, onPick, onAuto, onNone, onClose }: V3MLineSwapProps) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    // Defer the appearance so the slide-in transition runs on mount.
    const t = setTimeout(() => setVis(true), 12);
    return () => clearTimeout(t);
  }, []);

  // Slide-out animation before unmount.
  const close = () => {
    setVis(false);
    setTimeout(onClose, 200);
  };

  // Escape closes the sheet.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: vis ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        transition: 'background 0.2s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: V3.chrome,
          color: V3.ink,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          padding: '14px 16px calc(20px + env(safe-area-inset-bottom))',
          maxHeight: '78vh',
          display: 'flex',
          flexDirection: 'column',
          transform: vis ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.24s cubic-bezier(0.34, 1.2, 0.64, 1)',
          boxShadow: '0 -16px 36px rgba(0,0,0,0.5)',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: V3.borderHi }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 10,
              color: V3.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              fontWeight: 600,
              marginBottom: 3,
            }}>
              Available at this store
            </div>
            <div style={{
              fontSize: 14,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {target.rowItemName}
            </div>
          </div>
          <button
            onClick={close}
            style={{
              background: 'transparent',
              border: 'none',
              color: V3.inkLight,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 18,
              padding: 0,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Options scroll area */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {target.options.length === 0 ? (
            <div style={{ padding: 14, color: V3.inkLight, fontSize: 13, textAlign: 'center' }}>
              No alternatives available at this store.
            </div>
          ) : (
            target.options.map((opt) => {
              const total = target.useMember && opt.member_total != null ? opt.member_total : opt.shelf_total;
              const memberShown = target.useMember && opt.member != null;
              const isSelected = target.selected === opt.canonical_id;
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
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: V3.ink,
                    textAlign: 'left',
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: opt.match_type === 'exact' ? V3.saveInk : V3.edited,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opt.display_name}
                    </div>
                    <div style={{ fontSize: 11, color: V3.inkLight, marginTop: 2 }}>
                      {opt.match_type === 'exact' ? 'Exact match' : 'Similar'}
                      {opt.match_type === 'equivalent' && opt.equiv_note && ` · ${opt.equiv_note}`}
                      {' · '}
                      {opt.observations} receipts
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="v3-num" style={{ fontSize: 15, fontWeight: 700 }}>
                      {total != null ? fmt(total) : '—'}
                    </div>
                    {memberShown && opt.shelf_total != null && (
                      <div className="v3-num" style={{ fontSize: 10, color: V3.inkLight, marginTop: 1 }}>
                        shelf {fmt(opt.shelf_total)}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: V3.ink, flexShrink: 0 }}>
                      <path d="M4 9l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Sticky actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${V3.border}` }}>
          <button
            onClick={onAuto}
            style={{
              flex: 1,
              background: 'transparent',
              border: `1px dashed ${V3.border}`,
              borderRadius: 8,
              padding: '11px 8px',
              color: V3.inkMid,
              fontSize: 12,
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
              borderRadius: 8,
              padding: '11px 8px',
              color: V3.inkMid,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Skip here
          </button>
        </div>
      </div>
    </div>
  );
}
