'use client';

/**
 * ReviewAltC — "Flat Triage List"
 *
 * No section headers. No grouped cards. Every item in a single scrollable
 * flat list, compact as possible. Each row carries:
 *   - Colored left-border strip (green/amber/red for confidence tier)
 *   - Raw receipt text in small monospace
 *   - Interpreted name in normal weight
 *   - Quantity/unit badge
 *   - Price on the right
 *   - A tiny confidence dot
 *
 * Tapping any row expands it full-width inline with a 2-column candidate
 * grid, a search input below it, and a skip button. Only one row can be
 * expanded at a time — opening a new one closes the previous. The items
 * that need attention (amber/red) start expanded automatically.
 *
 * Everything is on a single flat paper-cream card so the whole receipt
 * reads as one coherent artifact, not separate UI sections.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchOffProducts } from '@/lib/api/compare';
import type {
  Correction,
  MatchCandidate,
  MatchItem,
  MatchResponse,
  OffSearchHit,
} from '@/lib/api/compare';
import { V3, fmt } from '../theme';

// ── Types ──────────────────────────────────────────────────────────────────

type Choice =
  | { kind: 'in-house'; canonical_id: number }
  | { kind: 'off'; barcode: string }
  | { kind: 'none' };

interface ReviewAltCProps {
  matchResult: MatchResponse;
  comparing: boolean;
  onConfirm: (corrections: Correction[]) => Promise<void>;
  onCancel: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const fmtPrice = (n: number | null | undefined) =>
  typeof n === 'number' ? fmt(n) : '—';

function candidateKey(c: MatchCandidate): string {
  return c.source === 'in-house' ? `c-${c.canonical_id}` : `o-${c.barcode}`;
}

function isSelected(c: MatchCandidate, choice: Choice): boolean {
  if (choice.kind === 'in-house')
    return c.source === 'in-house' && c.canonical_id === choice.canonical_id;
  if (choice.kind === 'off')
    return c.source === 'off' && c.barcode === choice.barcode;
  return false;
}

function candidateToChoice(c: MatchCandidate): Choice {
  return c.source === 'in-house'
    ? { kind: 'in-house', canonical_id: c.canonical_id }
    : { kind: 'off', barcode: c.barcode };
}

function pickSelected(candidates: MatchCandidate[], choice: Choice) {
  if (choice.kind === 'none') return null;
  return candidates.find((c) => isSelected(c, choice)) ?? null;
}

function candidateName(c: MatchCandidate): string {
  if (c.source === 'in-house') return c.name;
  return c.name ?? c.brand ?? 'Unknown product';
}

function candidateSize(c: MatchCandidate | null): string | null {
  if (!c) return null;
  if (c.package_size && c.package_unit) return `${c.package_size} ${c.package_unit}`;
  return c.source === 'off' ? c.quantity_raw ?? null : null;
}

function offHitToCandidate(hit: OffSearchHit): MatchCandidate {
  return {
    source: 'off' as const,
    barcode: hit.barcode,
    name: hit.name,
    brand: hit.brand,
    quantity_raw: hit.quantity_raw,
    package_size: hit.package_size,
    package_unit: hit.package_unit,
    image_url: hit.image_url,
    score: 0,
    enrichment: hit.enrichment,
  };
}

function getTriageFor(item: MatchItem, choice: Choice): 'good' | 'review' | 'help' {
  if (choice.kind === 'none') return 'help';
  const c = item.suggested_match?.match_confidence;
  return c === 'high' ? 'good' : 'review';
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ReviewAltC({
  matchResult,
  comparing,
  onConfirm,
  onCancel,
}: ReviewAltCProps) {
  const reviewItems = useMemo(
    () => matchResult.items.filter((it) => it.item_type !== 'skip'),
    [matchResult.items],
  );

  // ── State ──────────────────────────────────────────────────────────────
  const [selections, setSelections] = useState<Map<number, Choice>>(() => {
    const m = new Map<number, Choice>();
    for (const item of reviewItems) {
      const sm = item.suggested_match;
      if (!sm) { m.set(item.line_index, { kind: 'none' }); continue; }
      if (sm.source === 'off' && sm.barcode) {
        m.set(item.line_index, { kind: 'off', barcode: sm.barcode });
      } else if (sm.canonical_id) {
        m.set(item.line_index, { kind: 'in-house', canonical_id: sm.canonical_id });
      } else {
        m.set(item.line_index, { kind: 'none' });
      }
    }
    return m;
  });

  // Start with items needing attention pre-expanded
  const [expanded, setExpanded] = useState<number | null>(() => {
    const first = reviewItems.find((it) => {
      const c = it.suggested_match?.match_confidence;
      return !it.suggested_match || c !== 'high';
    });
    return first?.line_index ?? null;
  });

  const [searchQueries, setSearchQueries] = useState<Map<number, string>>(new Map());
  const [searchResults, setSearchResults] = useState<Map<number, OffSearchHit[]>>(new Map());
  const [searching, setSearching] = useState<Set<number>>(new Set());
  const [qtyEdits, setQtyEdits] = useState<Map<number, { qty: string; unit: string }>>(new Map());
  const searchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => () => {
    for (const t of searchTimers.current.values()) clearTimeout(t);
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────
  const matchedCount = useMemo(
    () => Array.from(selections.values()).filter((c) => c.kind !== 'none').length,
    [selections],
  );

  // Triage counts for the status bar
  const triagedCounts = useMemo(() => {
    let good = 0, review = 0, help = 0;
    for (const item of reviewItems) {
      const t = getTriageFor(item, selections.get(item.line_index) ?? { kind: 'none' });
      if (t === 'good') good++;
      else if (t === 'review') review++;
      else help++;
    }
    return { good, review, help };
  }, [reviewItems, selections]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSelect = useCallback((lineIndex: number, choice: Choice) => {
    setSelections((prev) => new Map(prev).set(lineIndex, choice));
  }, []);

  const handleToggle = useCallback((lineIndex: number) => {
    setExpanded((prev) => prev === lineIndex ? null : lineIndex);
  }, []);

  const handleSearchChange = useCallback((lineIndex: number, query: string) => {
    setSearchQueries((prev) => new Map(prev).set(lineIndex, query));
    const existing = searchTimers.current.get(lineIndex);
    if (existing) clearTimeout(existing);
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults((prev) => { const m = new Map(prev); m.delete(lineIndex); return m; });
      return;
    }
    const timer = setTimeout(async () => {
      setSearching((prev) => new Set(prev).add(lineIndex));
      try {
        const resp = await searchOffProducts(query.trim(), 8);
        setSearchResults((prev) => new Map(prev).set(lineIndex, resp.hits));
      } catch {
        setSearchResults((prev) => new Map(prev).set(lineIndex, []));
      }
      setSearching((prev) => { const s = new Set(prev); s.delete(lineIndex); return s; });
    }, 280);
    searchTimers.current.set(lineIndex, timer);
  }, []);

  const handleQtyChange = useCallback((lineIndex: number, field: 'qty' | 'unit', value: string) => {
    setQtyEdits((prev) => {
      const m = new Map(prev);
      const cur = m.get(lineIndex) ?? { qty: '', unit: '' };
      m.set(lineIndex, { ...cur, [field]: value });
      return m;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const corrections: Correction[] = [];
    for (const item of reviewItems) {
      const choice = selections.get(item.line_index);
      if (!choice) continue;
      const edit = qtyEdits.get(item.line_index);
      const overrides: { quantity_override?: number; unit_override?: string } = {};
      if (edit) {
        const parsedQty = parseFloat(edit.qty);
        if (!Number.isNaN(parsedQty) && parsedQty !== item.quantity) overrides.quantity_override = parsedQty;
        const trimmedUnit = edit.unit.trim();
        if (trimmedUnit && trimmedUnit !== item.unit) overrides.unit_override = trimmedUnit;
      }
      corrections.push({ line_index: item.line_index, choice, ...overrides } as Correction);
    }
    void onConfirm(corrections);
  }, [reviewItems, selections, qtyEdits, onConfirm]);

  const total = reviewItems.length;
  const goodPct = total > 0 ? (triagedCounts.good / total) * 100 : 0;
  const reviewPct = total > 0 ? (triagedCounts.review / total) * 100 : 0;
  const helpPct = total > 0 ? (triagedCounts.help / total) * 100 : 0;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans, -apple-system, system-ui, sans-serif)' }}>

      {/* Top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: `${V3.chrome}f2`, borderBottom: `1px solid ${V3.border}`, backdropFilter: 'blur(14px)' }}>
        <button onClick={onCancel} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: `1px solid ${V3.border}`, color: V3.inkMid, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Back
        </button>
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
          Review
        </div>
        <div style={{ border: `1px solid ${V3.border}`, borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <span style={{ color: V3.saveInk, fontWeight: 800 }}>{matchedCount}</span>
          <span style={{ color: V3.inkLight }}> / {reviewItems.length}</span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '20px 16px 140px' }}>

        {/* Receipt info + segmented bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: V3.ink, marginBottom: 1 }}>
                {matchResult.receipt.store_name ?? 'Your Receipt'}
              </div>
              {matchResult.receipt.receipt_date && (
                <div style={{ fontSize: 11, color: V3.inkLight }}>{matchResult.receipt.receipt_date.split(' ')[0]}</div>
              )}
            </div>
            {matchResult.receipt.receipt_total != null && (
              <div style={{ fontSize: 18, fontWeight: 800, color: V3.ink, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>
                {fmt(matchResult.receipt.receipt_total)}
              </div>
            )}
          </div>

          {/* Segmented progress bar */}
          <div style={{ height: 5, borderRadius: 3, overflow: 'hidden', background: V3.pageAlt, display: 'flex', gap: 2 }}>
            {goodPct > 0 && <div style={{ height: '100%', width: `${goodPct}%`, background: V3.saveInk, borderRadius: 3, transition: 'width 0.3s ease' }} />}
            {reviewPct > 0 && <div style={{ height: '100%', width: `${reviewPct}%`, background: V3.edited, borderRadius: 3, transition: 'width 0.3s ease' }} />}
            {helpPct > 0 && <div style={{ height: '100%', width: `${helpPct}%`, background: V3.overInk, borderRadius: 3, transition: 'width 0.3s ease' }} />}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 7, fontSize: 10, color: V3.inkLight }}>
            {triagedCounts.good > 0 && (
              <span>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: V3.saveInk, marginRight: 4, verticalAlign: 'middle' }} />
                {triagedCounts.good} matched
              </span>
            )}
            {triagedCounts.review > 0 && (
              <span>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: V3.edited, marginRight: 4, verticalAlign: 'middle' }} />
                {triagedCounts.review} to check
              </span>
            )}
            {triagedCounts.help > 0 && (
              <span>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: V3.overInk, marginRight: 4, verticalAlign: 'middle' }} />
                {triagedCounts.help} unmatched
              </span>
            )}
          </div>
        </div>

        {/* Flat list on paper card */}
        <div style={{ background: V3.paper, borderRadius: 14, overflow: 'hidden', boxShadow: '0 6px 28px -8px rgba(0,0,0,0.38)' }}>
          {reviewItems.map((item, i) => {
            const choice = selections.get(item.line_index) ?? { kind: 'none' };
            const triage = getTriageFor(item, choice);
            const isOpen = expanded === item.line_index;
            const selected = pickSelected(item.candidates, choice);
            const name = selected ? candidateName(selected) : (item.description || item.raw_text);
            const price = item.member_price ?? item.shelf_price;

            const borderColor =
              triage === 'good' ? V3.saveInk :
              triage === 'review' ? V3.edited : V3.overInk;

            const dotColor = borderColor;

            const isLast = i === reviewItems.length - 1;

            return (
              <div key={item.line_index} style={{ borderBottom: isLast && !isOpen ? 'none' : `1px solid ${V3.paperLine}` }}>
                {/* Compact row */}
                <button
                  onClick={() => handleToggle(item.line_index)}
                  style={{ width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', display: 'flex', fontFamily: 'inherit' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = V3.paperShade; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {/* Colored left strip */}
                  <div style={{ width: 4, flexShrink: 0, background: borderColor, alignSelf: 'stretch', opacity: 0.8 }} />

                  <div style={{ flex: 1, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {/* Text block */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", fontWeight: 600, color: V3.paperMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.04em', marginBottom: 2 }}>
                        {(item.description_raw || item.raw_text || '').toUpperCase()}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: V3.paperInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                        {item.quantity && item.unit && item.unit !== 'each' && (
                          <span style={{ fontSize: 9, color: V3.paperMid, marginLeft: 6, fontWeight: 500 }}>
                            {item.quantity} {item.unit}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Price + dot */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: V3.paperMid, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>
                        {fmtPrice(price)}
                      </span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <svg
                        width="12" height="12" viewBox="0 0 18 18"
                        style={{ color: V3.paperMid, transition: 'transform 0.15s', transform: isOpen ? 'rotate(180deg)' : 'none' }}
                      >
                        <path d="M5 7l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                </button>

                {/* Expanded panel */}
                {isOpen && (
                  <ExpandPanel
                    item={item}
                    choice={choice}
                    onSelect={(c) => handleSelect(item.line_index, c)}
                    onClose={() => setExpanded(null)}
                    searchQuery={searchQueries.get(item.line_index) ?? ''}
                    onSearchChange={(q) => handleSearchChange(item.line_index, q)}
                    searchHits={searchResults.get(item.line_index) ?? []}
                    isSearching={searching.has(item.line_index)}
                    qtyEdit={qtyEdits.get(item.line_index)}
                    onQtyChange={(field, val) => handleQtyChange(item.line_index, field, val)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky CTA */}
      <div style={{ position: 'fixed', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: 'min(100%, 520px)', padding: '16px 16px calc(16px + env(safe-area-inset-bottom))', background: `linear-gradient(180deg, rgba(26,28,31,0), ${V3.page} 34%)`, zIndex: 30, boxSizing: 'border-box' }}>
        <button
          onClick={handleConfirm}
          disabled={comparing}
          style={{ width: '100%', padding: '16px 20px', background: V3.ink, color: V3.page, border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', cursor: comparing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 18px 34px -18px rgba(246,245,241,0.7)', opacity: comparing ? 0.6 : 1, transition: 'opacity 0.15s' }}
        >
          {comparing ? 'Comparing prices...' : 'Compare prices'}
          {!comparing && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Expand Panel ───────────────────────────────────────────────────────────

interface ExpandPanelProps {
  item: MatchItem;
  choice: Choice;
  onSelect: (c: Choice) => void;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchHits: OffSearchHit[];
  isSearching: boolean;
  qtyEdit: { qty: string; unit: string } | undefined;
  onQtyChange: (field: 'qty' | 'unit', value: string) => void;
}

function ExpandPanel({ item, choice, onSelect, onClose, searchQuery, onSearchChange, searchHits, isSearching, qtyEdit, onQtyChange }: ExpandPanelProps) {
  const searchCandidates = searchHits.map(offHitToCandidate);
  const qtyValue = qtyEdit?.qty ?? (item.quantity != null ? String(item.quantity) : '');
  const unitValue = qtyEdit?.unit ?? (item.unit ?? '');

  return (
    <div style={{ background: V3.paperShade, padding: '12px 16px 16px 18px', borderTop: `1px solid ${V3.paperLine}` }}>

      {/* Qty editor (if relevant) */}
      {(qtyValue || unitValue) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '4px 8px', background: 'rgba(0,0,0,0.04)', border: `1px dashed ${V3.paperLine}`, borderRadius: 4, width: 'fit-content', fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em' }}>QTY</span>
          <input type="text" inputMode="decimal" value={qtyValue} placeholder="—" onChange={(e) => onQtyChange('qty', e.target.value)} onClick={(e) => e.stopPropagation()} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${V3.paperLine}`, color: V3.paperInk, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '0 2px', outline: 'none', width: 48, textAlign: 'right' }} />
          <input type="text" value={unitValue} placeholder="unit" onChange={(e) => onQtyChange('unit', e.target.value)} onClick={(e) => e.stopPropagation()} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${V3.paperLine}`, color: V3.paperInk, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '0 2px', outline: 'none', width: 40 }} />
        </div>
      )}

      {/* Candidates as 2-column grid */}
      {item.candidates.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Suggestions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {item.candidates.map((cand) => {
              const selected = isSelected(cand, choice);
              const name = candidateName(cand);
              const size = candidateSize(cand);
              const srcLabel = cand.source === 'in-house' ? 'catalog' : 'OFF';

              return (
                <button
                  key={candidateKey(cand)}
                  onClick={() => onSelect(candidateToChoice(cand))}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '9px 10px', borderRadius: 8, border: `1.5px solid ${selected ? V3.saveInk : V3.paperLine}`, background: selected ? V3.savePaper : V3.paper, cursor: 'pointer', fontFamily: 'inherit', color: V3.paperInk, textAlign: 'left', transition: 'background 0.1s, border-color 0.1s', position: 'relative' }}
                >
                  {selected && (
                    <div style={{ position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: '50%', background: V3.saveInk, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l2.5 2.5L10 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, paddingRight: selected ? 20 : 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {size && (
                      <span style={{ fontSize: 9, color: V3.paperMute }}>{size}</span>
                    )}
                    <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: `1px solid ${V3.paperLine}`, color: V3.paperMid, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>
                      {srcLabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search products..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', padding: '9px 11px', borderRadius: 7, border: `1px solid ${V3.paperLine}`, background: V3.paper, color: V3.paperInk, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
      />
      {isSearching && (
        <div style={{ fontSize: 9, color: V3.paperMute, marginBottom: 8, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", letterSpacing: '0.04em' }}>Searching...</div>
      )}

      {/* Search results — also 2-column grid */}
      {searchCandidates.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Results</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {searchCandidates.map((cand) => {
              const selected = isSelected(cand, choice);
              const name = candidateName(cand);
              const size = candidateSize(cand);
              return (
                <button
                  key={candidateKey(cand)}
                  onClick={() => onSelect(candidateToChoice(cand))}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '9px 10px', borderRadius: 8, border: `1.5px solid ${selected ? V3.saveInk : V3.paperLine}`, background: selected ? V3.savePaper : V3.paper, cursor: 'pointer', fontFamily: 'inherit', color: V3.paperInk, textAlign: 'left', position: 'relative' }}
                >
                  {selected && (
                    <div style={{ position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: '50%', background: V3.saveInk, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l2.5 2.5L10 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, paddingRight: selected ? 20 : 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {name}
                  </div>
                  {size && <span style={{ fontSize: 9, color: V3.paperMute }}>{size}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Skip */}
      <button
        onClick={() => { onSelect({ kind: 'none' }); onClose(); }}
        style={{ width: '100%', padding: '9px', fontSize: 11, fontWeight: 700, color: V3.paperMid, background: 'transparent', border: `1px dashed ${V3.paperLine}`, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        Skip — no match
      </button>
    </div>
  );
}
