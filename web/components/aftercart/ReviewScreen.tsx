'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import NavBar from './NavBar';
import MatchCandidateCard from './MatchCandidateCard';
import ReceiptValueEditor, { type ReceiptValueState } from './ReceiptValueEditor';
import { THEMES, fmt } from './data';
import type { MatchCandidate, Correction, OffEnrichment } from './data';
import { searchOffProducts, type MatchResponse, type OffSearchHit } from '@/lib/api/compare';

/**
 * The match-review step the user hits after their receipt parses but before
 * any price comparison appears. Per item:
 *
 *   - Show the matcher's auto-pick as the "current" selection at the top of
 *     each row (with image + brand + size).
 *   - Tap to expand: see top-5 in-house candidates, OFF auto-suggestions for
 *     low-confidence items, plus a free-text "Search for product…" input that
 *     hits /api/off-search.
 *   - One tap on any candidate replaces the selection.
 *   - "Mark as no match" stages a `{ kind: 'none' }` correction.
 *
 * On confirm, we collect every selection into a `Correction[]` and hand it
 * back to the parent (AfterCartApp), which calls /api/compare and routes to
 * ResultsScreen.
 */

type Choice =
  | { kind: 'in-house'; canonical_id: number }
  | { kind: 'off'; barcode: string }
  | { kind: 'none' };

interface ReviewScreenProps {
  matchResult: MatchResponse;
  comparing: boolean;
  onConfirm: (corrections: Correction[]) => Promise<void>;
  onCancel: () => void;
}

export default function ReviewScreen({ matchResult, comparing, onConfirm, onCancel }: ReviewScreenProps) {
  const t = THEMES.forest;

  // Skip 'skip' items — bag fees, deposits, etc. — they're never shown to the user.
  const reviewItems = useMemo(
    () => matchResult.items.filter((it) => it.item_type !== 'skip'),
    [matchResult.items],
  );

  // Initial selections: whatever the matcher picked, else 'none'. The user can
  // edit any of these before confirming.
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

  // Per-row OCR-value edits. Sparse — only populated for rows the user has
  // touched. Empty {} for an entry means "no edits"; non-empty means at
  // least one of price/quantity/unit was changed from OCR.
  const [valueEdits, setValueEdits] = useState<Map<number, ReceiptValueState>>(new Map());

  // Per-item OFF search state. Sparse — only populated when the user types.
  const [searchQueries, setSearchQueries] = useState<Map<number, string>>(new Map());
  const [searchResults, setSearchResults] = useState<Map<number, OffSearchHit[]>>(new Map());
  const [searching, setSearching] = useState<Set<number>>(new Set());

  // Debounce per-item searches so each keystroke doesn't fire its own request.
  const searchTimers = useRef<Map<number, NodeJS.Timeout>>(new Map());
  useEffect(() => () => {
    // Cleanup pending timers on unmount.
    for (const timer of searchTimers.current.values()) clearTimeout(timer);
    searchTimers.current.clear();
  }, []);

  const handleSelect = useCallback((line_index: number, choice: Choice) => {
    setSelections((prev) => { const m = new Map(prev); m.set(line_index, choice); return m; });
    // Auto-collapse after picking — confirms the choice visually.
    setExpanded((prev) => { const s = new Set(prev); s.delete(line_index); return s; });
  }, []);

  const handleToggleExpand = useCallback((line_index: number) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(line_index) ? s.delete(line_index) : s.add(line_index);
      return s;
    });
  }, []);

  const handleValueEdit = useCallback((line_index: number, next: ReceiptValueState) => {
    setValueEdits((prev) => {
      const m = new Map(prev);
      // An empty state means "no edits" — drop the entry entirely so the
      // anyEdited check below stays correct without bookkeeping.
      const isEmpty = next.price === undefined && next.quantity === undefined && next.unit === undefined;
      if (isEmpty) m.delete(line_index);
      else m.set(line_index, next);
      return m;
    });
  }, []);

  const handleSearchChange = useCallback((line_index: number, query: string) => {
    setSearchQueries((prev) => { const m = new Map(prev); m.set(line_index, query); return m; });

    // Cancel any pending fire for this item, schedule a new one.
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
      const edits = valueEdits.get(item.line_index);
      // Overrides are sparse: only set fields the user actually edited. The
      // server treats undefined as "use OCR value." Zero/negative values
      // would be filtered here too if needed, but ReceiptValueEditor's
      // change handlers already drop those.
      const overrides: Record<string, unknown> = {};
      if (edits?.price !== undefined && Number.isFinite(edits.price) && edits.price > 0) overrides.price_override = edits.price;
      if (edits?.quantity !== undefined && Number.isFinite(edits.quantity) && edits.quantity > 0) overrides.quantity_override = edits.quantity;
      if (edits?.unit !== undefined && edits.unit) overrides.unit_override = edits.unit;

      // The Correction type is a discriminated union — TS narrows incorrectly
      // when we push a generic Choice. Splitting by tag tells the compiler
      // exactly which arm we're constructing.
      if (choice.kind === 'in-house') {
        corrections.push({ line_index: item.line_index, choice, ...overrides });
      } else if (choice.kind === 'off') {
        corrections.push({ line_index: item.line_index, choice, ...overrides });
      } else {
        corrections.push({ line_index: item.line_index, choice, ...overrides });
      }
    }
    void onConfirm(corrections);
  }, [reviewItems, selections, valueEdits, onConfirm]);

  // Counts for the sticky CTA.
  const matchedCount = useMemo(
    () => Array.from(selections.values()).filter((c) => c.kind !== 'none').length,
    [selections],
  );
  const totalCount = reviewItems.length;

  return (
    <div style={{ minHeight: '100%', background: t.bg, paddingBottom: 100 }}>
      <NavBar
        t={t}
        onBack={onCancel}
        title="Review matches"
        subtitle={`${matchResult.receipt.store_name ?? 'Receipt'}${matchResult.receipt.receipt_date ? ` · ${matchResult.receipt.receipt_date}` : ''}`}
      />

      {/* Intro caption */}
      <div style={{ padding: '14px 20px 8px', color: t.inkMid, fontSize: 'var(--t-sm)', lineHeight: 1.5, opacity: 0.85 }}>
        We matched <strong>{matchedCount}</strong> of <strong>{totalCount}</strong> items. Tap any row to swap, search, or mark as no match — then confirm to see prices.
      </div>

      <div style={{ padding: '8px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {reviewItems.map((item) => {
          const selection = selections.get(item.line_index) ?? { kind: 'none' };
          const isExpanded = expanded.has(item.line_index);
          const selectedCandidate = pickSelected(item.candidates, selection);
          const edits = valueEdits.get(item.line_index) ?? {};
          const hasValueEdits = edits.price !== undefined || edits.quantity !== undefined || edits.unit !== undefined;

          // Effective price for the small right-aligned indicator on the
          // collapsed row. Reflects user edits when present so the user can
          // see at a glance which rows they've corrected.
          const effectivePrice = edits.price ?? item.member_price;

          // Combine the API's candidates with any free-text search hits the
          // user typed for this row (search hits go below built-in candidates).
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
            score: 0,  // unused for sort order — search results are pre-ranked
            enrichment: h.enrichment,
          }));

          return (
            <div
              key={item.line_index}
              style={{
                background: '#fff',
                borderRadius: 14,
                padding: 14,
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                border: '1px solid rgba(0,0,0,0.05)',
              }}
            >
              {/* Receipt-side line: what the user actually paid for. Small, secondary. */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, paddingBottom: 8, borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 'var(--t-xs)', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                      Your receipt
                    </span>
                    {hasValueEdits && (
                      <span
                        title="You corrected the OCR-parsed values"
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: t.accent,
                          color: '#fff',
                        }}
                      >
                        Edited
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--t-sm)', color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {item.description || item.raw_text}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 'var(--t-sm)',
                    color: hasValueEdits ? t.accent : '#444',
                    fontWeight: 600,
                    marginLeft: 12,
                    flexShrink: 0,
                  }}
                >
                  {typeof effectivePrice === 'number' ? fmt(effectivePrice) : ''}
                </div>
              </div>

              {/* Selection preview */}
              {selection.kind === 'none' ? (
                <NoMatchPreview onChange={() => handleToggleExpand(item.line_index)} />
              ) : selectedCandidate ? (
                <MatchCandidateCard
                  candidate={selectedCandidate}
                  selected={true}
                  onSelect={() => handleToggleExpand(item.line_index)}
                  prominent
                />
              ) : (
                <NoMatchPreview onChange={() => handleToggleExpand(item.line_index)} />
              )}

              {/* "Change" / "Show options" affordance */}
              <button
                onClick={() => handleToggleExpand(item.line_index)}
                style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  fontSize: 'var(--t-xs)',
                  fontWeight: 600,
                  color: t.accent,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {isExpanded ? 'Hide options' : 'Change…'}
              </button>

              {/* Expanded candidates panel */}
              {isExpanded && (
                <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px dashed rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Receipt-value editor: lives at the TOP of the expanded
                      panel because the conceptual flow is "fix the values
                      first, then confirm or swap the product." Most users
                      who tap Change… are doing one or the other; bundling
                      the two avoids a second affordance on the row. */}
                  <ReceiptValueEditor
                    parsedPrice={item.member_price}
                    parsedQuantity={item.quantity}
                    parsedUnit={item.unit}
                    edits={edits}
                    onChange={(next) => handleValueEdit(item.line_index, next)}
                  />

                  <div style={{ fontSize: 'var(--t-xs)', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, padding: '0 4px' }}>
                    Match
                  </div>

                  {item.candidates.length === 0 && searchCandidates.length === 0 && (
                    <div style={{ color: '#999', fontSize: 'var(--t-sm)', padding: '4px 0' }}>
                      No candidates from the matcher. Try searching below.
                    </div>
                  )}

                  {item.candidates.map((cand) => (
                    <MatchCandidateCard
                      key={candidateKey(cand)}
                      candidate={cand}
                      selected={isSelected(cand, selection)}
                      onSelect={() => handleSelect(item.line_index, candidateToChoice(cand))}
                    />
                  ))}

                  {/* Free-text search */}
                  <div style={{ marginTop: 6 }}>
                    <input
                      type="text"
                      placeholder="Search for product…"
                      value={searchQueries.get(item.line_index) ?? ''}
                      onChange={(e) => handleSearchChange(item.line_index, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(0,0,0,0.12)',
                        fontSize: 'var(--t-sm)',
                        fontFamily: 'inherit',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    {searching.has(item.line_index) && (
                      <div style={{ fontSize: 'var(--t-xs)', color: '#999', marginTop: 4, padding: '0 4px' }}>
                        Searching…
                      </div>
                    )}
                  </div>

                  {searchCandidates.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      <div style={{ fontSize: 'var(--t-xs)', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, padding: '0 4px' }}>
                        Search results
                      </div>
                      {searchCandidates.map((cand) => (
                        <MatchCandidateCard
                          key={candidateKey(cand)}
                          candidate={cand}
                          selected={isSelected(cand, selection)}
                          onSelect={() => handleSelect(item.line_index, candidateToChoice(cand))}
                        />
                      ))}
                    </div>
                  )}

                  {/* Tertiary "no match" — always available, clicks live at the bottom. */}
                  <button
                    onClick={() => handleSelect(item.line_index, { kind: 'none' })}
                    style={{
                      marginTop: 4,
                      padding: '8px 10px',
                      fontSize: 'var(--t-xs)',
                      fontWeight: 600,
                      color: '#999',
                      background: 'transparent',
                      border: '1px dashed rgba(0,0,0,0.15)',
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
          background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.12) 100%), #fff',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <button
          onClick={handleConfirm}
          disabled={comparing}
          style={{
            width: '100%',
            padding: '14px 20px',
            background: t.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 'var(--t-md)',
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: comparing ? 'wait' : 'pointer',
            opacity: comparing ? 0.7 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          {comparing ? 'Comparing prices…' : 'Looks good — show prices'}
        </button>
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function NoMatchPreview({ onChange }: { onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        border: '1px dashed rgba(0,0,0,0.15)',
        background: '#fafafa',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ width: 56, height: 56, borderRadius: 8, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#bbb', flexShrink: 0 }}>
        ?
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--t-md)', fontWeight: 600, color: '#888' }}>No match selected</div>
        <div style={{ fontSize: 'var(--t-xs)', color: '#aaa', marginTop: 2 }}>Tap to pick a product</div>
      </div>
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

// (kept here for type harmony — OffEnrichment is part of the OffCandidate shape)
export type { OffEnrichment };
