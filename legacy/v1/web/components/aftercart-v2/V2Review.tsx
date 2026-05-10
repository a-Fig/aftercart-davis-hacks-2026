'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { V2, fmt } from './theme';
import { searchOffProducts, type MatchResponse, type OffSearchHit } from '@/lib/api/compare';
import type { MatchCandidate, Correction } from '@/components/aftercart/data';

type Choice =
  | { kind: 'in-house'; canonical_id: number }
  | { kind: 'off'; barcode: string }
  | { kind: 'none' };

interface V2ReviewProps {
  matchResult: MatchResponse;
  comparing: boolean;
  onConfirm: (corrections: Correction[]) => Promise<void>;
  onCancel: () => void;
}

export default function V2Review({ matchResult, comparing, onConfirm, onCancel }: V2ReviewProps) {
  const reviewItems = useMemo(
    () => matchResult.items.filter((it) => it.item_type !== 'skip'),
    [matchResult.items],
  );

  const [selections, setSelections] = useState<Map<number, Choice>>(() => {
    const m = new Map<number, Choice>();
    for (const item of reviewItems) {
      if (item.suggested_match && item.suggested_match.canonical_id) {
        m.set(item.line_index, { kind: 'in-house', canonical_id: item.suggested_match.canonical_id });
      } else if (item.suggested_match && item.suggested_match.source === 'off' && (item.suggested_match as { barcode?: string }).barcode) {
        m.set(item.line_index, { kind: 'off', barcode: (item.suggested_match as { barcode: string }).barcode });
      } else {
        m.set(item.line_index, { kind: 'none' });
      }
    }
    return m;
  });

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [searchQueries, setSearchQueries] = useState<Map<number, string>>(new Map());
  const [searchResults, setSearchResults] = useState<Map<number, OffSearchHit[]>>(new Map());
  const [searching, setSearching] = useState<Set<number>>(new Set());
  const searchTimers = useRef<Map<number, NodeJS.Timeout>>(new Map());
  useEffect(() => () => {
    for (const timer of searchTimers.current.values()) clearTimeout(timer);
    searchTimers.current.clear();
  }, []);

  const handleSelect = useCallback((line_index: number, choice: Choice) => {
    setSelections((prev) => { const m = new Map(prev); m.set(line_index, choice); return m; });
    setExpanded((prev) => { const s = new Set(prev); s.delete(line_index); return s; });
  }, []);

  const handleToggleExpand = useCallback((line_index: number) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(line_index) ? s.delete(line_index) : s.add(line_index);
      return s;
    });
  }, []);

  const handleSearchChange = useCallback((line_index: number, query: string) => {
    setSearchQueries((prev) => { const m = new Map(prev); m.set(line_index, query); return m; });
    const existing = searchTimers.current.get(line_index);
    if (existing) clearTimeout(existing);

    if (!query.trim() || query.trim().length < 2) {
      setSearchResults((prev) => { const m = new Map(prev); m.delete(line_index); return m; });
      return;
    }
    const timer = setTimeout(async () => {
      setSearching((prev) => { const s = new Set(prev); s.add(line_index); return s; });
      try {
        const resp = await searchOffProducts(query.trim(), 8);
        setSearchResults((prev) => { const m = new Map(prev); m.set(line_index, resp.hits); return m; });
      } catch (err) {
        console.warn('OFF search failed:', (err as Error).message);
        setSearchResults((prev) => { const m = new Map(prev); m.set(line_index, []); return m; });
      }
      setSearching((prev) => { const s = new Set(prev); s.delete(line_index); return s; });
    }, 280);
    searchTimers.current.set(line_index, timer);
  }, []);

  const handleConfirm = useCallback(() => {
    const corrections: Correction[] = [];
    for (const item of reviewItems) {
      const choice = selections.get(item.line_index);
      if (!choice) continue;
      if (choice.kind === 'in-house') {
        corrections.push({ line_index: item.line_index, choice });
      } else if (choice.kind === 'off') {
        corrections.push({ line_index: item.line_index, choice });
      } else {
        corrections.push({ line_index: item.line_index, choice });
      }
    }
    void onConfirm(corrections);
  }, [reviewItems, selections, onConfirm]);

  const matchedCount = useMemo(
    () => Array.from(selections.values()).filter((c) => c.kind !== 'none').length,
    [selections],
  );

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 110, position: 'relative' }}>
      {/* Header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: `${V2.bg}f0`,
          backdropFilter: 'blur(12px)',
          padding: '18px 20px 14px',
          borderBottom: `1px solid ${V2.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: V2.inkLight,
              fontSize: 13,
              fontWeight: 600,
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ← Cancel
          </button>
          <div className="v2-num" style={{ fontSize: 12, color: V2.inkLight, fontWeight: 600 }}>
            <span style={{ color: V2.lime }}>{matchedCount}</span> / {reviewItems.length} matched
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Review your matches
          </div>
          <div style={{ fontSize: 13, color: V2.inkLight, marginTop: 4 }}>
            Tap any row to swap or search · {matchResult.receipt.store_name ?? 'Receipt'}
          </div>
        </div>
      </div>

      {/* Items list */}
      <div style={{ padding: '12px 14px' }}>
        {reviewItems.map((item) => {
          const selection = selections.get(item.line_index) ?? { kind: 'none' };
          const isExpanded = expanded.has(item.line_index);
          const selectedCandidate = pickSelected(item.candidates, selection);
          const liveSearchHits = searchResults.get(item.line_index) ?? [];
          const searchCandidates: MatchCandidate[] = liveSearchHits.map((h) => ({
            source: 'off',
            barcode: h.barcode,
            name: h.name,
            brand: h.brand,
            quantity_raw: h.quantity_raw,
            package_size: h.package_size,
            package_unit: h.package_unit,
            image_url: h.image_url,
            score: 0,
            enrichment: h.enrichment,
          }));

          // Visual: 'matched' = lime accent, 'no-match' = amber accent.
          const isNoMatch = selection.kind === 'none';
          const accent = isNoMatch ? V2.amber : V2.lime;

          return (
            <div
              key={item.line_index}
              style={{
                background: V2.surface,
                border: `1px solid ${isExpanded ? V2.borderHi : V2.border}`,
                borderRadius: 14,
                marginBottom: 8,
                overflow: 'hidden',
                transition: 'border-color 0.15s ease',
              }}
            >
              <button
                onClick={() => handleToggleExpand(item.line_index)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: V2.ink,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  padding: '14px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'left',
                }}
              >
                {/* Status pill */}
                <div
                  style={{
                    width: 6,
                    alignSelf: 'stretch',
                    background: accent,
                    borderRadius: 3,
                    minHeight: 36,
                    flexShrink: 0,
                  }}
                />

                {/* Selection preview thumbnail */}
                <Thumbnail
                  imgUrl={selectedCandidate?.source === 'in-house' ? selectedCandidate.image_url : selectedCandidate?.image_url ?? null}
                  fallback={isNoMatch ? '?' : '✓'}
                  bg={isNoMatch ? V2.amberBg : V2.limeBg}
                  fg={accent}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Receipt-side line */}
                  <div style={{ fontSize: 11, color: V2.inkFaint, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 2 }}>
                    {fmtPrice(item.member_price)} · receipt
                  </div>
                  {/* Matched-to */}
                  <div style={{ fontSize: 14, fontWeight: 600, color: V2.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedCandidate
                      ? selectedCandidate.source === 'in-house'
                        ? selectedCandidate.name
                        : (selectedCandidate.name ?? selectedCandidate.brand ?? 'Unknown')
                      : 'No match selected'}
                  </div>
                  <div style={{ fontSize: 12, color: V2.inkLight, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    From: {item.description || item.raw_text}
                  </div>
                </div>

                {/* Chevron */}
                <svg
                  width="14" height="14" viewBox="0 0 14 14" fill="none"
                  style={{ color: V2.inkLight, flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}
                >
                  <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {isExpanded && (
                <div style={{ padding: '4px 14px 16px', borderTop: `1px solid ${V2.border}`, background: V2.bg }}>
                  <div style={{ fontSize: 11, color: V2.inkLight, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, padding: '12px 0 8px' }}>
                    Suggestions
                  </div>

                  {item.candidates.length === 0 && searchCandidates.length === 0 && (
                    <div style={{ color: V2.inkFaint, fontSize: 13, padding: '4px 0' }}>
                      No suggestions from the matcher. Search below.
                    </div>
                  )}

                  {item.candidates.map((cand) => (
                    <V2CandidateRow
                      key={candidateKey(cand)}
                      candidate={cand}
                      selected={isSelected(cand, selection)}
                      onSelect={() => handleSelect(item.line_index, candidateToChoice(cand))}
                    />
                  ))}

                  {/* Free-text search */}
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="text"
                      placeholder="Search 896k products…"
                      value={searchQueries.get(item.line_index) ?? ''}
                      onChange={(e) => handleSearchChange(item.line_index, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: 10,
                        border: `1px solid ${V2.border}`,
                        background: V2.surface,
                        color: V2.ink,
                        fontSize: 13,
                        fontFamily: 'inherit',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = V2.borderHi)}
                      onBlur={(e) => (e.currentTarget.style.borderColor = V2.border)}
                    />
                    {searching.has(item.line_index) && (
                      <div style={{ fontSize: 11, color: V2.inkLight, marginTop: 4, padding: '0 4px' }}>
                        Searching…
                      </div>
                    )}
                  </div>

                  {searchCandidates.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: V2.inkLight, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, padding: '4px 0 8px' }}>
                        Search results
                      </div>
                      {searchCandidates.map((cand) => (
                        <V2CandidateRow
                          key={candidateKey(cand)}
                          candidate={cand}
                          selected={isSelected(cand, selection)}
                          onSelect={() => handleSelect(item.line_index, candidateToChoice(cand))}
                        />
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => handleSelect(item.line_index, { kind: 'none' })}
                    style={{
                      marginTop: 10,
                      width: '100%',
                      padding: '10px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: V2.inkLight,
                      background: 'transparent',
                      border: `1px dashed ${V2.border}`,
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Mark as no match
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky CTA */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '14px 16px 18px',
          background: `linear-gradient(180deg, transparent, ${V2.bg} 30%)`,
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <button
          onClick={handleConfirm}
          disabled={comparing}
          style={{
            width: '100%',
            padding: '16px 20px',
            background: V2.lime,
            color: V2.bg,
            border: 'none',
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            fontFamily: 'inherit',
            cursor: comparing ? 'wait' : 'pointer',
            opacity: comparing ? 0.65 : 1,
            transition: 'opacity 0.15s ease',
            boxShadow: comparing ? 'none' : `0 12px 32px -10px ${V2.limeRing}`,
          }}
        >
          {comparing ? 'Comparing prices…' : 'Looks good — show prices →'}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined) {
  return typeof n === 'number' ? fmt(n) : '—';
}

function Thumbnail({ imgUrl, fallback, bg, fg }: { imgUrl: string | null; fallback: string; bg: string; fg: string }) {
  if (imgUrl) {
    return (
      <img
        src={imgUrl}
        alt=""
        style={{
          width: 44, height: 44, borderRadius: 10,
          objectFit: 'cover', flexShrink: 0,
          background: V2.surfaceAlt,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 44, height: 44, borderRadius: 10,
        background: bg, color: fg,
        display: 'grid', placeItems: 'center',
        fontSize: 18, fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {fallback}
    </div>
  );
}

function V2CandidateRow({ candidate, selected, onSelect }: { candidate: MatchCandidate; selected: boolean; onSelect: () => void }) {
  const name = candidate.source === 'in-house' ? candidate.name : (candidate.name ?? 'Unknown');
  const brand = candidate.brand;
  const size = candidate.package_size && candidate.package_unit
    ? `${candidate.package_size} ${candidate.package_unit}`
    : (candidate.source === 'off' ? candidate.quantity_raw : null);
  const sourceLabel = candidate.source === 'in-house' ? 'catalog' : 'OFF';

  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%',
        background: selected ? V2.limeBg : V2.surface,
        border: `1px solid ${selected ? V2.lime : V2.border}`,
        borderRadius: 12,
        padding: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: V2.ink,
        textAlign: 'left',
        marginBottom: 6,
        transition: 'all 0.12s ease',
      }}
    >
      <Thumbnail
        imgUrl={candidate.image_url}
        fallback="·"
        bg={V2.surfaceAlt}
        fg={V2.inkLight}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ fontSize: 11, color: V2.inkLight, marginTop: 1, display: 'flex', gap: 8, alignItems: 'center' }}>
          {brand && <span>{brand}</span>}
          {size && <span style={{ color: V2.inkFaint }}>· {size}</span>}
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 4,
              background: V2.surfaceAlt,
              color: V2.inkLight,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              marginLeft: 'auto',
            }}
          >
            {sourceLabel}
          </span>
        </div>
      </div>
      {selected && (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: V2.lime, flexShrink: 0 }}>
          <path d="M4 9l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function candidateKey(c: MatchCandidate): string {
  return c.source === 'in-house' ? `c-${c.canonical_id}` : `o-${c.barcode}`;
}

function isSelected(c: MatchCandidate, choice: Choice): boolean {
  if (choice.kind === 'in-house') return c.source === 'in-house' && c.canonical_id === choice.canonical_id;
  if (choice.kind === 'off')      return c.source === 'off' && c.barcode === choice.barcode;
  return false;
}

function candidateToChoice(c: MatchCandidate): Choice {
  return c.source === 'in-house'
    ? { kind: 'in-house', canonical_id: c.canonical_id }
    : { kind: 'off', barcode: c.barcode };
}

function pickSelected(candidates: MatchCandidate[], choice: Choice): MatchCandidate | null {
  if (choice.kind === 'none') return null;
  return candidates.find((c) => isSelected(c, choice)) ?? null;
}
