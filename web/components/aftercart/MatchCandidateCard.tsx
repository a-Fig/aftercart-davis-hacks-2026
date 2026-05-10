'use client';

import type { MatchCandidate } from './data';
import { THEMES } from './data';

/**
 * One candidate match for a receipt line — used by ReviewScreen to render
 * either the currently-selected match (large, single) or the alternatives
 * list (small, vertical stack). Discriminates on `source` so OFF candidates
 * can show their image + Nutri-Score and in-house candidates show their
 * canonical brand + pack.
 */

interface MatchCandidateCardProps {
  candidate: MatchCandidate;
  selected: boolean;
  onSelect: () => void;
  /** When true, render larger with more info — used for the "currently selected" preview row. */
  prominent?: boolean;
}

export default function MatchCandidateCard({ candidate, selected, onSelect, prominent = false }: MatchCandidateCardProps) {
  const t = THEMES.forest;

  const name = candidate.name || (candidate.source === 'off' ? 'Unnamed product' : 'Unknown match');
  const brand = candidate.brand;
  const size = formatSize(candidate);
  const imageUrl = candidate.image_url || null;

  // Visual badge: in-house gets a leaf/check, OFF gets a small "DB" pill.
  // We keep it terse — the user doesn't need to learn the data architecture
  // to use the screen.
  const sourcePill = candidate.source === 'in-house' ? 'in catalog' : 'OFF';

  const nutriScore = candidate.source === 'off' ? candidate.enrichment?.nutriscore_grade ?? null : null;

  const cardPadding = prominent ? 14 : 10;
  const imgSize = prominent ? 56 : 44;
  const titleFontSize = prominent ? 'var(--t-md)' : 'var(--t-sm)';

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        textAlign: 'left',
        padding: cardPadding,
        borderRadius: 12,
        border: selected
          ? `1.5px solid ${t.accent}`
          : '1px solid rgba(0,0,0,0.08)',
        background: selected ? `${t.accent}10` : '#fff',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'border-color 0.15s ease, background 0.15s ease',
      }}
    >
      {/* Image / placeholder */}
      <div
        style={{
          width: imgSize,
          height: imgSize,
          borderRadius: 8,
          background: '#f3f3f3',
          flexShrink: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ color: '#aaa', fontSize: 18 }}>{candidate.source === 'in-house' ? '🏷️' : '📦'}</span>
        )}
      </div>

      {/* Text content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: titleFontSize,
              fontWeight: 600,
              color: '#222',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: prominent ? 220 : 180,
            }}
          >
            {name}
          </span>
          <SourcePill source={candidate.source} label={sourcePill} />
          {nutriScore && <NutriScoreChip grade={nutriScore} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 'var(--t-xs)', color: '#666' }}>
          {brand && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{brand}</span>}
          {brand && size && <span>·</span>}
          {size && <span>{size}</span>}
        </div>
      </div>

      {/* Selection check */}
      {selected && (
        <div
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: t.accent,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          ✓
        </div>
      )}
    </button>
  );
}

function SourcePill({ source, label }: { source: 'in-house' | 'off'; label: string }) {
  const isInHouse = source === 'in-house';
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        padding: '2px 6px',
        borderRadius: 4,
        background: isInHouse ? '#e8f4ec' : '#f0f0f5',
        color: isInHouse ? '#2c6a48' : '#5a5a78',
      }}
    >
      {label}
    </span>
  );
}

function NutriScoreChip({ grade }: { grade: 'a' | 'b' | 'c' | 'd' | 'e' }) {
  const colors: Record<string, string> = {
    a: '#1d7d3e',  // green
    b: '#7eb53d',  // light green
    c: '#e8b22b',  // yellow
    d: '#e07a2f',  // orange
    e: '#c93434',  // red
  };
  return (
    <span
      title={`Nutri-Score ${grade.toUpperCase()}`}
      style={{
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.05em',
        padding: '2px 7px',
        borderRadius: 4,
        background: colors[grade] ?? '#999',
        color: '#fff',
      }}
    >
      {grade.toUpperCase()}
    </span>
  );
}

function formatSize(candidate: MatchCandidate): string | null {
  // Prefer a clean size string when available — OFF's quantity_raw is what
  // appeared on the package label ("32 oz", "1 lb"), which is more readable
  // than our parsed (size, unit) pair when the unit is something exotic.
  if (candidate.source === 'off' && candidate.quantity_raw) return candidate.quantity_raw;
  if (candidate.package_size != null && candidate.package_unit) {
    return `${candidate.package_size} ${candidate.package_unit}`;
  }
  return null;
}
