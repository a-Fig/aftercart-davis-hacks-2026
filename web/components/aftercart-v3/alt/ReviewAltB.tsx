'use client';

/**
 * ReviewAltB — "Decision Queue"
 *
 * Items split into two tiers:
 *   1. Auto-confirmed batch — high-confidence matches shown as a compact read-only
 *      strip with a single "Approve all" button. Users can expand to review or
 *      un-approve individual items.
 *   2. Attention queue — medium/low-confidence items shown one at a time as a
 *      focused card. Simple radio-style candidate list + search + skip. After
 *      each decision the queue advances to the next item.
 *
 * The idea: a user with 20 well-matched items sees 1 bulk-confirm button, then
 * maybe 1–2 focused cards to handle. Zero visual overwhelm.
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

interface ReviewAltBProps {
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

// ── Main component ─────────────────────────────────────────────────────────

export default function ReviewAltB({
  matchResult,
  comparing,
  onConfirm,
  onCancel,
}: ReviewAltBProps) {
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

  // Which queue card we're showing (index into queueItems)
  const [queueStep, setQueueStep] = useState(0);
  const [batchExpanded, setBatchExpanded] = useState(false);
  const [searchQueries, setSearchQueries] = useState<Map<number, string>>(new Map());
  const [searchResults, setSearchResults] = useState<Map<number, OffSearchHit[]>>(new Map());
  const [searching, setSearching] = useState<Set<number>>(new Set());
  const [qtyEdits, setQtyEdits] = useState<Map<number, { qty: string; unit: string }>>(new Map());
  const searchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => () => {
    for (const t of searchTimers.current.values()) clearTimeout(t);
  }, []);

  // ── Triage split ────────────────────────────────────────────────────────
  const { batchItems, queueItems } = useMemo(() => {
    const batch: MatchItem[] = [];
    const queue: MatchItem[] = [];
    for (const item of reviewItems) {
      const c = item.suggested_match?.match_confidence;
      if (c === 'high') batch.push(item);
      else queue.push(item);
    }
    return { batchItems: batch, queueItems: queue };
  }, [reviewItems]);

  const currentQueueItem = queueItems[queueStep] ?? null;
  const queueDone = queueStep >= queueItems.length;

  // ── Counts ─────────────────────────────────────────────────────────────
  const matchedCount = useMemo(
    () => Array.from(selections.values()).filter((c) => c.kind !== 'none').length,
    [selections],
  );

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSelect = useCallback((lineIndex: number, choice: Choice) => {
    setSelections((prev) => new Map(prev).set(lineIndex, choice));
  }, []);

  const handleSelectAndAdvance = useCallback((lineIndex: number, choice: Choice) => {
    setSelections((prev) => new Map(prev).set(lineIndex, choice));
    setQueueStep((s) => s + 1);
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

  // ── Progress ────────────────────────────────────────────────────────────
  const totalSteps = queueItems.length;
  const stepsDone = Math.min(queueStep, totalSteps);
  const progressPct = totalSteps > 0 ? (stepsDone / totalSteps) * 100 : 100;

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
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px 140px' }}>

        {/* ── Batch strip (high-confidence items) ─────────────────────────── */}
        {batchItems.length > 0 && (
          <div style={{ background: V3.savePaper.replace('e8f4ec', '1a2b1e') || '#1a2b1e', border: '1px solid rgba(31,122,58,0.3)', borderRadius: 14, marginBottom: 20, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(31,122,58,0.2)', border: '2px solid rgba(31,122,58,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M4 10l4 4 8-8" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#f0fdf4' }}>
                  {batchItems.length} item{batchItems.length !== 1 ? 's' : ''} matched
                </div>
                <div style={{ fontSize: 12, color: '#86efac', marginTop: 1 }}>
                  High confidence — ready to compare
                </div>
              </div>
              <button
                onClick={() => setBatchExpanded((v) => !v)}
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, color: '#86efac', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {batchExpanded ? 'Hide' : 'Review'}
              </button>
            </div>

            {/* Expandable list */}
            {batchExpanded && (
              <div style={{ borderTop: '1px solid rgba(31,122,58,0.2)' }}>
                {batchItems.map((item, i) => {
                  const choice = selections.get(item.line_index) ?? { kind: 'none' };
                  const selected = pickSelected(item.candidates, choice);
                  const name = selected ? candidateName(selected) : item.description ?? item.raw_text;
                  const price = item.member_price ?? item.shelf_price;

                  return (
                    <div key={item.line_index} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: i < batchItems.length - 1 ? '1px solid rgba(31,122,58,0.15)' : 'none' }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8l3 3 7-7" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0fdf4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <div style={{ fontSize: 10, color: '#86efac', marginTop: 1, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>
                          {(item.description_raw || item.raw_text || '').toUpperCase()}
                          {item.quantity && item.unit && item.unit !== 'each' && (
                            <span style={{ marginLeft: 6 }}>{item.quantity} {item.unit}</span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#d1fae5', fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", flexShrink: 0 }}>
                        {fmtPrice(price)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Queue (medium/low confidence items) ─────────────────────────── */}
        {queueItems.length > 0 && (
          <div>
            {/* Queue header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: V3.ink, marginBottom: 4 }}>
                  {queueDone
                    ? 'All done!'
                    : `Item ${stepsDone + 1} of ${totalSteps} needing a look`}
                </div>
                {/* Progress track */}
                <div style={{ height: 4, background: V3.pageAlt, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progressPct}%`, background: V3.saveInk, borderRadius: 2, transition: 'width 0.35s cubic-bezier(0.32,0.72,0,1)' }} />
                </div>
              </div>
              {!queueDone && (
                <div style={{ fontSize: 11, color: V3.inkLight, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {totalSteps - stepsDone} left
                </div>
              )}
            </div>

            {/* Current queue card or done state */}
            {!queueDone && currentQueueItem ? (
              <QueueCard
                item={currentQueueItem}
                choice={selections.get(currentQueueItem.line_index) ?? { kind: 'none' }}
                onSelectAndAdvance={(c) => handleSelectAndAdvance(currentQueueItem.line_index, c)}
                onSelect={(c) => handleSelect(currentQueueItem.line_index, c)}
                searchQuery={searchQueries.get(currentQueueItem.line_index) ?? ''}
                onSearchChange={(q) => handleSearchChange(currentQueueItem.line_index, q)}
                searchHits={searchResults.get(currentQueueItem.line_index) ?? []}
                isSearching={searching.has(currentQueueItem.line_index)}
                qtyEdit={qtyEdits.get(currentQueueItem.line_index)}
                onQtyChange={(field, val) => handleQtyChange(currentQueueItem.line_index, field, val)}
              />
            ) : (
              // Done state
              <div style={{ background: V3.pageAlt, border: `1px solid ${V3.border}`, borderRadius: 14, padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: V3.ink, marginBottom: 8 }}>
                  All items reviewed
                </div>
                <div style={{ fontSize: 14, color: V3.inkMid, lineHeight: 1.55 }}>
                  {matchedCount} of {reviewItems.length} items matched.<br />
                  Ready to compare prices.
                </div>
              </div>
            )}

            {/* Back/forward controls for the queue */}
            {!queueDone && queueItems.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 14 }}>
                <button
                  onClick={() => setQueueStep((s) => Math.max(0, s - 1))}
                  disabled={queueStep === 0}
                  style={{ background: 'transparent', border: `1px solid ${V3.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: queueStep === 0 ? V3.inkFaint : V3.inkMid, cursor: queueStep === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}
                >
                  ← Previous
                </button>
                <button
                  onClick={() => setQueueStep((s) => Math.min(totalSteps, s + 1))}
                  style={{ background: 'transparent', border: `1px solid ${V3.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: V3.inkMid, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Skip for now →
                </button>
              </div>
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
    </div>
  );
}

// ── Queue Card ─────────────────────────────────────────────────────────────

interface QueueCardProps {
  item: MatchItem;
  choice: Choice;
  onSelectAndAdvance: (c: Choice) => void;
  onSelect: (c: Choice) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchHits: OffSearchHit[];
  isSearching: boolean;
  qtyEdit: { qty: string; unit: string } | undefined;
  onQtyChange: (field: 'qty' | 'unit', value: string) => void;
}

function QueueCard({ item, choice, onSelectAndAdvance, onSelect, searchQuery, onSearchChange, searchHits, isSearching, qtyEdit, onQtyChange }: QueueCardProps) {
  const hasMatch = choice.kind !== 'none';
  const confidence = item.suggested_match?.match_confidence;
  const isHelp = !item.suggested_match || confidence === 'low';
  const searchCandidates = searchHits.map(offHitToCandidate);
  const price = item.member_price ?? item.shelf_price;
  const qtyValue = qtyEdit?.qty ?? (item.quantity != null ? String(item.quantity) : '');
  const unitValue = qtyEdit?.unit ?? (item.unit ?? '');

  return (
    <div style={{ background: V3.paper, borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 32px -8px rgba(0,0,0,0.45)', color: V3.paperInk }}>

      {/* Card header */}
      <div style={{ padding: '18px 20px 14px', background: V3.paperShade, borderBottom: `1px solid ${V3.paperLine}` }}>
        <div style={{ fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", fontSize: 11, fontWeight: 700, color: V3.paperMute, letterSpacing: '0.06em', marginBottom: 6 }}>
          {(item.description_raw || item.raw_text || '').toUpperCase()}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: V3.paperInk, flex: 1, lineHeight: 1.2 }}>
            {item.description || item.raw_text}
          </div>
          <div style={{ fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", fontSize: 16, fontWeight: 800, color: V3.paperMid, flexShrink: 0 }}>
            {fmtPrice(price)}
          </div>
        </div>
        {item.quantity && item.unit && item.unit !== 'each' && (
          <div style={{ fontSize: 11, color: V3.paperMid, marginTop: 4 }}>{item.quantity} {item.unit}</div>
        )}
        {isHelp && (
          <div style={{ marginTop: 8, fontSize: 12, color: V3.overInk, fontWeight: 600 }}>
            We couldn't match this — help us find the right product
          </div>
        )}

        {/* Qty editor */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '4px 8px', background: 'rgba(0,0,0,0.04)', border: `1px dashed ${V3.paperLine}`, borderRadius: 4, width: 'fit-content', fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace" }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: V3.paperMute, letterSpacing: '0.1em' }}>QTY</span>
          <input type="text" inputMode="decimal" value={qtyValue} placeholder="—" onChange={(e) => onQtyChange('qty', e.target.value)} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${V3.paperLine}`, color: V3.paperInk, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '0 2px', outline: 'none', width: 48, textAlign: 'right' }} />
          <input type="text" value={unitValue} placeholder="unit" onChange={(e) => onQtyChange('unit', e.target.value)} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${V3.paperLine}`, color: V3.paperInk, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '0 2px', outline: 'none', width: 40 }} />
        </div>
      </div>

      {/* Candidates */}
      <div style={{ padding: '14px 16px' }}>
        {item.candidates.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: V3.paperMute, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Best matches
            </div>
            {item.candidates.map((cand) => {
              const selected = isSelected(cand, choice);
              const name = candidateName(cand);
              const size = candidateSize(cand);
              const sourceLabel = cand.source === 'in-house' ? 'catalog' : 'OFF';

              return (
                <button
                  key={candidateKey(cand)}
                  onClick={() => onSelect(candidateToChoice(cand))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, border: `2px solid ${selected ? V3.saveInk : V3.paperLine}`, background: selected ? V3.savePaper : V3.paper, cursor: 'pointer', fontFamily: 'inherit', color: V3.paperInk, textAlign: 'left', marginBottom: 6, transition: 'background 0.12s, border-color 0.12s' }}
                >
                  <div style={{ width: 38, height: 38, borderRadius: 6, background: V3.paperShade, border: `1px solid ${V3.paperLine}`, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ fontSize: 10, color: V3.paperMute, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {cand.brand && <span>{cand.brand}</span>}
                      {size && <span style={{ color: V3.paperFaint }}>{size}</span>}
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, border: `1px solid ${V3.paperLine}`, color: V3.paperMid, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, marginLeft: 'auto', flexShrink: 0 }}>{sourceLabel}</span>
                    </div>
                  </div>
                  {selected && (
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: V3.saveInk, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7l2.5 2.5L11 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search */}
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder={item.candidates.length > 0 ? 'Or search for a different product...' : 'Search for this product...'}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${V3.paperLine}`, background: V3.paper, color: V3.paperInk, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.12s' }}
            onFocus={(e) => { e.target.style.borderColor = V3.paperMid; }}
            onBlur={(e) => { e.target.style.borderColor = V3.paperLine; }}
          />
          {isSearching && (
            <div style={{ fontSize: 9, color: V3.paperMute, marginTop: 6, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", letterSpacing: '0.04em' }}>Searching...</div>
          )}
          {searchCandidates.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {searchCandidates.map((cand) => {
                const selected = isSelected(cand, choice);
                const name = candidateName(cand);
                const size = candidateSize(cand);
                return (
                  <button
                    key={candidateKey(cand)}
                    onClick={() => onSelect(candidateToChoice(cand))}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${selected ? V3.saveInk : V3.paperLine}`, background: selected ? V3.savePaper : V3.paper, cursor: 'pointer', fontFamily: 'inherit', color: V3.paperInk, textAlign: 'left', marginBottom: 6 }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: 5, background: V3.paperShade, border: `1px solid ${V3.paperLine}`, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      {size && <div style={{ fontSize: 10, color: V3.paperMute }}>{size}</div>}
                    </div>
                    {selected && (
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: V3.saveInk, flexShrink: 0 }}>
                        <path d="M4 9l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
          <button
            onClick={() => onSelectAndAdvance({ kind: 'none' })}
            style={{ padding: '12px 8px', background: 'transparent', border: `1.5px solid ${V3.paperLine}`, borderRadius: 9, fontSize: 12, fontWeight: 700, color: V3.paperMid, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Skip this item
          </button>
          <button
            onClick={() => hasMatch ? onSelectAndAdvance(choice) : undefined}
            disabled={!hasMatch}
            style={{ padding: '12px 8px', background: hasMatch ? V3.saveInk : V3.paperShade, border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 700, color: hasMatch ? '#fff' : V3.paperMute, cursor: hasMatch ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'background 0.15s' }}
          >
            {hasMatch ? '✓ Looks right →' : 'Pick a match above'}
          </button>
        </div>
      </div>
    </div>
  );
}
