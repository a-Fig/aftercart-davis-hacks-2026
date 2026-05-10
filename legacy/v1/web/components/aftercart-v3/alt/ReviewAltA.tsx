'use client';

/**
 * ReviewAltA — "Receipt Annotator"
 *
 * The review screen is the actual receipt. Items appear as printed receipt lines
 * in monospace; each line carries a colored status badge (✓ / ⚠ / ✗) and a
 * faint interpreted-name annotation below. Tapping any line slides up a full
 * bottom sheet for candidate picking and search. Nothing moves — you always
 * have the full receipt in view.
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

interface ReviewAltAProps {
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

export default function ReviewAltA({
  matchResult,
  comparing,
  onConfirm,
  onCancel,
}: ReviewAltAProps) {
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

  // active sheet = line_index of the item being edited, or null
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const [searchQueries, setSearchQueries] = useState<Map<number, string>>(new Map());
  const [searchResults, setSearchResults] = useState<Map<number, OffSearchHit[]>>(new Map());
  const [searching, setSearching] = useState<Set<number>>(new Set());
  const [qtyEdits, setQtyEdits] = useState<Map<number, { qty: string; unit: string }>>(new Map());
  const searchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Body scroll lock while sheet is open
  useEffect(() => {
    if (sheetIdx !== null) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [sheetIdx]);

  // Escape to close sheet
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetIdx(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => () => {
    for (const t of searchTimers.current.values()) clearTimeout(t);
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────
  const matchedCount = useMemo(
    () => Array.from(selections.values()).filter((c) => c.kind !== 'none').length,
    [selections],
  );

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSelect = useCallback((lineIndex: number, choice: Choice) => {
    setSelections((prev) => new Map(prev).set(lineIndex, choice));
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

  // ── Receipt date formatting ─────────────────────────────────────────────
  const dateStr = matchResult.receipt.receipt_date
    ? matchResult.receipt.receipt_date.split(' ')[0]
    : '';

  const sheetItem = sheetIdx !== null
    ? reviewItems.find((it) => it.line_index === sheetIdx) ?? null
    : null;

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
          Confirm items
        </div>
        <div style={{ border: `1px solid ${V3.border}`, borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <span style={{ color: V3.saveInk, fontWeight: 800 }}>{matchedCount}</span>
          <span style={{ color: V3.inkLight }}> / {reviewItems.length}</span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px 140px' }}>

        {/* Receipt paper */}
        <div style={{ background: V3.paper, borderRadius: 14, overflow: 'hidden', boxShadow: '0 12px 40px -10px rgba(0,0,0,0.45)', fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>

          {/* Receipt header */}
          <div style={{ padding: '22px 20px 16px', borderBottom: `1px solid ${V3.paperLine}`, textAlign: 'center', background: V3.paperShade }}>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.12em', color: V3.paperInk, marginBottom: 4 }}>
              {(matchResult.receipt.store_name ?? 'Your Receipt').toUpperCase()}
            </div>
            {matchResult.receipt.store_address && (
              <div style={{ fontSize: 10, color: V3.paperMute, lineHeight: 1.5 }}>{matchResult.receipt.store_address}</div>
            )}
            {dateStr && (
              <div style={{ fontSize: 10, color: V3.paperMute, marginTop: 2 }}>{dateStr}</div>
            )}
          </div>

          {/* Dashes divider */}
          <div style={{ padding: '8px 20px', fontSize: 11, color: V3.paperFaint, letterSpacing: '0.03em', userSelect: 'none' }}>
            {'- '.repeat(28)}
          </div>

          {/* Item lines */}
          <div>
            {reviewItems.map((item) => {
              const choice = selections.get(item.line_index) ?? { kind: 'none' };
              const triage = getTriageFor(item, choice);
              const selected = pickSelected(item.candidates, choice);
              const interpretedName = selected ? candidateName(selected) : (item.suggested_match?.name ?? null);
              const price = item.member_price ?? item.shelf_price;

              const statusColor =
                triage === 'good' ? V3.saveInk :
                triage === 'review' ? V3.edited : V3.overInk;
              const statusGlyph =
                triage === 'good' ? '✓' :
                triage === 'review' ? '?' : '✗';

              return (
                <button
                  key={item.line_index}
                  onClick={() => setSheetIdx(item.line_index)}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid ${V3.paperLine}`, padding: '10px 20px', cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s', fontFamily: 'inherit' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = V3.paperShade; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Top line: raw text + price + badge */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: V3.paperInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {(item.description_raw || item.raw_text || '').toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: V3.paperMid, flexShrink: 0, marginLeft: 8 }}>
                      {fmtPrice(price)}
                    </span>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: statusColor + '22', border: `1.5px solid ${statusColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: statusColor, flexShrink: 0, fontFamily: 'inherit' }}>
                      {statusGlyph}
                    </span>
                  </div>

                  {/* Annotation line: interpreted name */}
                  {triage !== 'help' && interpretedName ? (
                    <div style={{ fontSize: 10, color: V3.paperMute, marginTop: 3, paddingLeft: 10, fontStyle: 'italic' }}>
                      → {interpretedName}
                      {item.quantity && item.unit && item.unit !== 'each' && (
                        <span style={{ marginLeft: 6, fontStyle: 'normal', color: V3.paperFaint }}>{item.quantity} {item.unit}</span>
                      )}
                    </div>
                  ) : triage === 'help' ? (
                    <div style={{ fontSize: 10, color: V3.overInk + 'bb', marginTop: 3, paddingLeft: 10, fontStyle: 'italic' }}>
                      → tap to find this item
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Bottom divider + total */}
          <div style={{ padding: '8px 20px 0', fontSize: 11, color: V3.paperFaint, letterSpacing: '0.03em', userSelect: 'none' }}>
            {'- '.repeat(28)}
          </div>
          {matchResult.receipt.receipt_total != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px 18px', fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: V3.paperInk, letterSpacing: '0.04em' }}>TOTAL</span>
              <span style={{ fontSize: 15, fontWeight: 900, color: V3.paperInk }}>{fmt(matchResult.receipt.receipt_total)}</span>
            </div>
          )}

          {/* Match summary line */}
          <div style={{ padding: '0 20px 18px', fontSize: 10, color: V3.paperMute, textAlign: 'center', fontStyle: 'italic' }}>
            {matchedCount} of {reviewItems.length} items matched and ready to compare
          </div>
        </div>

        {/* Help nudge */}
        {reviewItems.some((it) => getTriageFor(it, selections.get(it.line_index) ?? { kind: 'none' }) !== 'good') && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: V3.pageAlt, borderRadius: 10, border: `1px solid ${V3.border}`, fontSize: 12, color: V3.inkMid, lineHeight: 1.5 }}>
            <strong style={{ color: V3.ink }}>Tap any line</strong> to confirm or swap its match before comparing.
            {reviewItems.some((it) => getTriageFor(it, selections.get(it.line_index) ?? { kind: 'none' }) === 'help') && (
              <> Items marked <span style={{ color: V3.overInk, fontWeight: 700 }}>✗</span> need your help to find a product.</>
            )}
          </div>
        )}
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

      {/* Bottom sheet */}
      {sheetItem && (
        <MatchSheet
          item={sheetItem}
          choice={selections.get(sheetItem.line_index) ?? { kind: 'none' }}
          onSelect={(c) => handleSelect(sheetItem.line_index, c)}
          onClose={() => setSheetIdx(null)}
          searchQuery={searchQueries.get(sheetItem.line_index) ?? ''}
          onSearchChange={(q) => handleSearchChange(sheetItem.line_index, q)}
          searchHits={searchResults.get(sheetItem.line_index) ?? []}
          isSearching={searching.has(sheetItem.line_index)}
          qtyEdit={qtyEdits.get(sheetItem.line_index)}
          onQtyChange={(field, val) => handleQtyChange(sheetItem.line_index, field, val)}
        />
      )}

      <style jsx global>{`
        @keyframes raa-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes raa-slide { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </div>
  );
}

// ── Match Sheet ────────────────────────────────────────────────────────────

interface MatchSheetProps {
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

function MatchSheet({ item, choice, onSelect, onClose, searchQuery, onSearchChange, searchHits, isSearching, qtyEdit, onQtyChange }: MatchSheetProps) {
  const triage = getTriageFor(item, choice);
  const statusColor = triage === 'good' ? V3.saveInk : triage === 'review' ? V3.edited : V3.overInk;
  const price = item.member_price ?? item.shelf_price;
  const searchCandidates = searchHits.map(offHitToCandidate);

  const qtyValue = qtyEdit?.qty ?? (item.quantity != null ? String(item.quantity) : '');
  const unitValue = qtyEdit?.unit ?? (item.unit ?? '');

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 40, animation: 'raa-fade 0.2s ease' }}
      />
      {/* Sheet */}
      <div style={{ position: 'fixed', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: 'min(100%, 520px)', background: V3.paper, borderRadius: '20px 20px 0 0', zIndex: 50, maxHeight: '85vh', display: 'flex', flexDirection: 'column', animation: 'raa-slide 0.25s cubic-bezier(0.32,0.72,0,1)', boxShadow: '0 -16px 60px -10px rgba(0,0,0,0.5)', color: V3.paperInk, fontFamily: 'var(--font-dm-sans, -apple-system, system-ui, sans-serif)' }}>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: V3.paperLine }} />
        </div>

        {/* Header */}
        <div style={{ padding: '4px 20px 14px', borderBottom: `1px solid ${V3.paperLine}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", fontSize: 13, fontWeight: 700, color: V3.paperInk, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(item.description_raw || item.raw_text || '').toUpperCase()}
            </span>
            <span style={{ fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", fontSize: 13, fontWeight: 700, color: V3.paperMid, flexShrink: 0 }}>
              {fmtPrice(price)}
            </span>
            <button onClick={onClose} style={{ background: V3.paperShade, border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: V3.paperMid }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
          {item.description && (
            <div style={{ fontSize: 13, color: V3.paperMute, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: statusColor, fontSize: 11 }}>→</span>
              {item.description}
              {item.quantity && item.unit && item.unit !== 'each' && (
                <span style={{ fontSize: 10, color: V3.paperFaint }}>{item.quantity} {item.unit}</span>
              )}
            </div>
          )}

          {/* Qty editor */}
          {(qtyValue || unitValue || (item.suggested_match?.pricing_unit ?? '').includes('per_') && (item.suggested_match?.pricing_unit ?? '') !== 'per_each') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '4px 8px', background: 'rgba(0,0,0,0.04)', border: `1px dashed ${V3.paperLine}`, borderRadius: 4, width: 'fit-content', fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em' }}>QTY</span>
              <input type="text" inputMode="decimal" value={qtyValue} placeholder="—" onChange={(e) => onQtyChange('qty', e.target.value)} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${V3.paperLine}`, color: V3.paperInk, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '0 2px', outline: 'none', width: 48, textAlign: 'right' }} />
              <input type="text" value={unitValue} placeholder="unit" onChange={(e) => onQtyChange('unit', e.target.value)} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${V3.paperLine}`, color: V3.paperInk, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '0 2px', outline: 'none', width: 40 }} />
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 20px 24px' }}>

          {/* Candidates */}
          {item.candidates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Suggestions</div>
              {item.candidates.map((cand) => (
                <SheetCandidateRow
                  key={candidateKey(cand)}
                  candidate={cand}
                  selected={isSelected(cand, choice)}
                  onSelect={() => { onSelect(candidateToChoice(cand)); onClose(); }}
                />
              ))}
            </div>
          )}

          {/* Search */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Search products</div>
            <input
              type="text"
              placeholder="Search by name, brand, or barcode..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 7, border: `1px solid ${V3.paperLine}`, background: V3.paper, color: V3.paperInk, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
            {isSearching && (
              <div style={{ fontSize: 9, color: V3.paperMute, marginTop: 6, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", letterSpacing: '0.04em' }}>Searching...</div>
            )}
            {searchCandidates.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Search results</div>
                {searchCandidates.map((cand) => (
                  <SheetCandidateRow
                    key={candidateKey(cand)}
                    candidate={cand}
                    selected={isSelected(cand, choice)}
                    onSelect={() => { onSelect(candidateToChoice(cand)); onClose(); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* No match */}
          <button
            onClick={() => { onSelect({ kind: 'none' }); onClose(); }}
            style={{ width: '100%', padding: '11px', fontSize: 11, fontWeight: 700, color: V3.paperMid, background: 'transparent', border: `1px dashed ${V3.paperLine}`, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}
          >
            Skip this item — no match
          </button>
        </div>
      </div>
    </>
  );
}

function SheetCandidateRow({ candidate, selected, onSelect }: { candidate: MatchCandidate; selected: boolean; onSelect: () => void }) {
  const name = candidateName(candidate);
  const size = candidateSize(candidate);
  const sourceLabel = candidate.source === 'in-house' ? 'catalog' : 'OFF';

  return (
    <button
      onClick={onSelect}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 7, border: `1px solid ${selected ? V3.saveOutline : V3.paperLine}`, background: selected ? V3.savePaper : V3.paper, cursor: 'pointer', fontFamily: 'inherit', color: V3.paperInk, textAlign: 'left', marginBottom: 6, transition: 'background 0.1s, border-color 0.1s' }}
    >
      <div style={{ width: 32, height: 32, borderRadius: 5, background: V3.paperShade, border: `1px solid ${V3.paperLine}`, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 10, color: V3.paperMute, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
          {candidate.brand && <span>{candidate.brand}</span>}
          {size && <span style={{ color: V3.paperFaint }}>{size}</span>}
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, border: `1px solid ${V3.paperLine}`, color: V3.paperMid, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, marginLeft: 'auto', flexShrink: 0 }}>{sourceLabel}</span>
        </div>
      </div>
      {selected && (
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: V3.saveInk, flexShrink: 0 }}>
          <path d="M4 9l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
