'use client';

/**
 * ReviewAltD — "Editable Receipt Review"
 *
 * Dark-chrome review screen with paper-cream item cards. Key differentiators
 * from the production V3ReviewA:
 *
 *   1. Prominent unit dropdown (lb/oz/gal/count/each) + qty input on every row
 *   2. Editable prices with bidirectional sync (total <-> unit price)
 *   3. Big product images (100x100) on candidates and search results
 *   4. Expand/collapse accordion (one item at a time)
 *   5. CompareAltS "vibe" — dark bg, paper cards, green gradient accents,
 *      small uppercase labels, clean grid
 *
 * CSS class prefix: `rad-` to avoid collision.
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

interface ReviewAltDProps {
  matchResult: MatchResponse;
  comparing: boolean;
  onConfirm: (corrections: Correction[]) => Promise<void>;
  onCancel: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['each', 'lb', 'oz', 'gal'] as const;

const FONT_SANS = "var(--font-dm-sans), -apple-system, system-ui, sans-serif";
const FONT_MONO = "'Courier New', monospace";

function fmtPrice(n: number | null | undefined): string {
  return typeof n === 'number' ? fmt(n) : '--';
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

function candidateName(c: MatchCandidate): string {
  if (c.source === 'in-house') return c.name;
  return c.name ?? c.brand ?? 'Unknown product';
}

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

function candidateSize(c: MatchCandidate | null): string | null {
  if (!c) return null;
  if (c.package_size && c.package_unit) return `${c.package_size} ${c.package_unit}`;
  return c.source === 'off' ? c.quantity_raw ?? null : null;
}

function getConfidence(item: MatchItem): 'high' | 'medium' | 'low' | null {
  return item.suggested_match?.match_confidence ?? null;
}

function pickSelected(candidates: MatchCandidate[], choice: Choice): MatchCandidate | null {
  if (choice.kind === 'none') return null;
  return candidates.find((c) => isSelected(c, choice)) ?? null;
}

/** Get image url from the resolved selected candidate or item's suggested match */
function getImageForCandidate(sel: MatchCandidate | null, item: MatchItem): string | null {
  if (sel?.image_url) return sel.image_url;
  if (sel?.source === 'off' && sel.barcode) return `/api/off-image/${sel.barcode}`;
  if (item.suggested_match?.enrichment?.image_url) return item.suggested_match.enrichment.image_url;
  if (item.suggested_match?.barcode) return `/api/off-image/${item.suggested_match.barcode}`;
  return null;
}

type FieldState = 'ok' | 'warn' | 'error';

/** Effective values for an item given user edits + candidate fallbacks */
function effectiveValues(
  item: MatchItem,
  qe: { qty: string; unit: string } | undefined,
  pe: { total: string; unitPrice: string } | undefined,
  selected: MatchCandidate | null,
) {
  const qtyStr = qe?.qty || (item.quantity != null ? String(item.quantity) : '');
  const unitStr = qe?.unit || item.unit || selected?.package_unit || '';
  const priceFallback = item.member_price ?? item.shelf_price;
  const priceStr = pe?.total || (priceFallback != null ? String(priceFallback) : '');
  return { qtyStr, unitStr, priceStr };
}

/** Has all fields filled (selection + qty + unit + price)? */
function hasAllFields(
  choice: Choice,
  values: { qtyStr: string; unitStr: string; priceStr: string },
): boolean {
  if (choice.kind === 'none') return false;
  const qtyOK = !!values.qtyStr && !isNaN(parseFloat(values.qtyStr)) && parseFloat(values.qtyStr) > 0;
  const unitOK = !!values.unitStr;
  const priceOK = !!values.priceStr && !isNaN(parseFloat(values.priceStr)) && parseFloat(values.priceStr) > 0;
  return qtyOK && unitOK && priceOK;
}

/** Compute badge state per the new spec:
 *  - 'ok' (✓) — all fields filled AND (high confidence OR user touched)
 *  - 'warn' (!) — all fields filled BUT medium/low confidence and not touched
 *  - 'error' (✗) — missing fields
 */
function getBadgeState(
  item: MatchItem,
  choice: Choice,
  values: { qtyStr: string; unitStr: string; priceStr: string },
  touched: boolean,
): FieldState {
  if (!hasAllFields(choice, values)) return 'error';
  const conf = item.suggested_match?.match_confidence;
  if (conf === 'high' || touched) return 'ok';
  return 'warn';
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ReviewAltD({
  matchResult,
  comparing,
  onConfirm,
  onCancel,
}: ReviewAltDProps) {
  const reviewItems = useMemo(
    () => matchResult.items.filter((it) => it.item_type !== 'skip'),
    [matchResult.items],
  );

  // ── State ────────────────────────────────────────────────────────────

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

  const [expandedIdx, setExpandedIdx] = useState<number | null>(() => {
    // Auto-expand the first item that needs attention
    for (const item of reviewItems) {
      const conf = getConfidence(item);
      if (conf === 'medium' || conf === 'low' || conf === null) return item.line_index;
    }
    return null;
  });

  const [searchQueries, setSearchQueries] = useState<Map<number, string>>(new Map());
  const [searchResults, setSearchResults] = useState<Map<number, OffSearchHit[]>>(new Map());
  const [searching, setSearching] = useState<Set<number>>(new Set());
  const [qtyEdits, setQtyEdits] = useState<Map<number, { qty: string; unit: string }>>(new Map());
  const [priceEdits, setPriceEdits] = useState<Map<number, { total: string; unitPrice: string }>>(new Map());
  // Persist OFF candidates selected from search so they survive query changes
  const [offSelections, setOffSelections] = useState<Map<number, MatchCandidate>>(new Map());
  // Track which items the user has explicitly interacted with — drives ✓ vs !
  const [touchedItems, setTouchedItems] = useState<Set<number>>(new Set());

  const markTouched = useCallback((lineIndex: number) => {
    setTouchedItems((prev) => {
      if (prev.has(lineIndex)) return prev;
      const s = new Set(prev);
      s.add(lineIndex);
      return s;
    });
  }, []);
  const searchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const abortControllers = useRef<Map<number, AbortController>>(new Map());

  // Cleanup timers and abort controllers on unmount
  useEffect(() => () => {
    for (const timer of searchTimers.current.values()) clearTimeout(timer);
    searchTimers.current.clear();
    for (const ctrl of abortControllers.current.values()) ctrl.abort();
    abortControllers.current.clear();
  }, []);

  // ── Counts ───────────────────────────────────────────────────────────

  const matchedCount = useMemo(
    () => Array.from(selections.values()).filter((c) => c.kind !== 'none').length,
    [selections],
  );

  const triageCounts = useMemo(() => {
    let good = 0, review = 0, help = 0;
    for (const item of reviewItems) {
      const choice = selections.get(item.line_index) ?? { kind: 'none' as const };
      const selected = pickSelected(item.candidates, choice) ?? offSelections.get(item.line_index) ?? null;
      const qe = qtyEdits.get(item.line_index);
      const pe = priceEdits.get(item.line_index);
      const values = effectiveValues(item, qe, pe, selected);
      const touched = touchedItems.has(item.line_index);
      const state = getBadgeState(item, choice, values, touched);
      if (state === 'ok') good++;
      else if (state === 'warn') review++;
      else help++;
    }
    return { good, review, help };
  }, [reviewItems, selections, offSelections, qtyEdits, priceEdits, touchedItems]);

  // ── Progress bar segments ────────────────────────────────────────────

  const progressSegments = useMemo(() => {
    const total = reviewItems.length;
    if (total === 0) return { goodPct: 0, reviewPct: 0, helpPct: 0 };
    return {
      goodPct: (triageCounts.good / total) * 100,
      reviewPct: (triageCounts.review / total) * 100,
      helpPct: (triageCounts.help / total) * 100,
    };
  }, [reviewItems.length, triageCounts]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleSelect = useCallback((lineIndex: number, choice: Choice) => {
    setSelections((prev) => {
      const m = new Map(prev);
      m.set(lineIndex, choice);
      return m;
    });
    // Clear stale OFF selection when switching to in-house or none
    if (choice.kind !== 'off') {
      setOffSelections((prev) => {
        if (!prev.has(lineIndex)) return prev;
        const m = new Map(prev);
        m.delete(lineIndex);
        return m;
      });
    }
    markTouched(lineIndex);
  }, [markTouched]);

  const handleSelectFromSearch = useCallback((lineIndex: number, candidate: MatchCandidate) => {
    handleSelect(lineIndex, candidateToChoice(candidate));
    setOffSelections((prev) => new Map(prev).set(lineIndex, candidate));
  }, [handleSelect]);

  const handleToggle = useCallback((lineIndex: number) => {
    setExpandedIdx((prev) => (prev === lineIndex ? null : lineIndex));
  }, []);

  const handleSearchChange = useCallback((lineIndex: number, query: string) => {
    setSearchQueries((prev) => new Map(prev).set(lineIndex, query));

    const existing = searchTimers.current.get(lineIndex);
    if (existing) clearTimeout(existing);

    // Abort any in-flight request for this item
    const prevCtrl = abortControllers.current.get(lineIndex);
    if (prevCtrl) prevCtrl.abort();

    if (!query.trim() || query.trim().length < 2) {
      setSearchResults((prev) => { const m = new Map(prev); m.delete(lineIndex); return m; });
      return;
    }

    const timer = setTimeout(async () => {
      const ctrl = new AbortController();
      abortControllers.current.set(lineIndex, ctrl);
      setSearching((prev) => new Set(prev).add(lineIndex));
      try {
        const resp = await searchOffProducts(query.trim(), 10, ctrl.signal);
        setSearchResults((prev) => new Map(prev).set(lineIndex, resp.hits));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setSearchResults((prev) => new Map(prev).set(lineIndex, []));
      }
      setSearching((prev) => {
        const s = new Set(prev);
        s.delete(lineIndex);
        return s;
      });
    }, 280);
    searchTimers.current.set(lineIndex, timer);
  }, []);

  const handleQtyChange = useCallback((lineIndex: number, field: 'qty' | 'unit', value: string, item: MatchItem) => {
    setQtyEdits((prev) => {
      const m = new Map(prev);
      const cur = m.get(lineIndex) ?? { qty: '', unit: '' };
      m.set(lineIndex, { ...cur, [field]: value });
      return m;
    });
    // When quantity changes, recalculate unit price from total
    if (field === 'qty') {
      setPriceEdits((prev) => {
        const m = new Map(prev);
        const pe = m.get(lineIndex);
        // Use edited total if present, otherwise fall back to item's price
        const fallbackPrice = item.member_price ?? item.shelf_price;
        const totalStr = pe?.total ?? (fallbackPrice != null ? fallbackPrice.toFixed(2) : null);
        if (!totalStr) return prev;
        const newQty = parseFloat(value);
        const total = parseFloat(totalStr);
        if (!isNaN(newQty) && newQty > 0 && !isNaN(total)) {
          m.set(lineIndex, { total: totalStr, unitPrice: (total / newQty).toFixed(2) });
        }
        return m;
      });
    }
    markTouched(lineIndex);
  }, [markTouched]);

  const handlePriceChange = useCallback((lineIndex: number, field: 'total' | 'unitPrice', value: string, item: MatchItem) => {
    setPriceEdits((prev) => {
      const m = new Map(prev);
      const cur = m.get(lineIndex) ?? { total: '', unitPrice: '' };
      const qe = qtyEdits.get(lineIndex);
      const qty = qe?.qty ? parseFloat(qe.qty) : (item.quantity ?? 1);

      if (field === 'total') {
        const newTotal = parseFloat(value);
        if (!isNaN(newTotal) && qty > 0) {
          m.set(lineIndex, { total: value, unitPrice: (newTotal / qty).toFixed(2) });
        } else {
          m.set(lineIndex, { ...cur, total: value });
        }
      } else {
        const newUP = parseFloat(value);
        if (!isNaN(newUP) && qty > 0) {
          m.set(lineIndex, { total: (newUP * qty).toFixed(2), unitPrice: value });
        } else {
          m.set(lineIndex, { ...cur, unitPrice: value });
        }
      }
      return m;
    });
    markTouched(lineIndex);
  }, [qtyEdits, markTouched]);

  const handleConfirm = useCallback(() => {
    const corrections: Correction[] = reviewItems.map((item) => {
      const choice = selections.get(item.line_index) ?? { kind: 'none' as const };
      const qe = qtyEdits.get(item.line_index);
      const pe = priceEdits.get(item.line_index);
      return {
        line_index: item.line_index,
        choice,
        ...(qe?.qty ? { quantity_override: parseFloat(qe.qty) } : {}),
        ...(qe?.unit ? { unit_override: qe.unit } : {}),
        ...(pe?.total ? { price_override: parseFloat(pe.total) } : {}),
      } as Correction;
    });
    void onConfirm(corrections);
  }, [reviewItems, selections, qtyEdits, priceEdits, onConfirm]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="rad-root">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="rad-topbar">
        <button onClick={onCancel} className="rad-back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div className="rad-topbar-title">Confirm items</div>
        <div className="rad-topbar-pill">
          <span style={{ color: V3.saveInk, fontWeight: 800 }}>{matchedCount}</span>
          <span style={{ color: V3.inkLight }}> / {reviewItems.length}</span>
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="rad-content">
        {/* Receipt summary */}
        <div className="rad-summary">
          <div className="rad-summary-store">
            {(matchResult.receipt.store_name ?? 'Your Receipt').toUpperCase()}
          </div>
          {matchResult.receipt.store_address && (
            <div className="rad-summary-sub">{matchResult.receipt.store_address}</div>
          )}
          <div className="rad-summary-row">
            {matchResult.receipt.receipt_date && (
              <span className="rad-summary-sub">{matchResult.receipt.receipt_date}</span>
            )}
            {matchResult.receipt.item_count != null && (
              <span className="rad-summary-sub">{matchResult.receipt.item_count} items</span>
            )}
            {matchResult.receipt.receipt_total != null && (
              <span className="rad-summary-total">{fmt(matchResult.receipt.receipt_total)}</span>
            )}
          </div>

          {/* Progress bar */}
          <div className="rad-progress">
            {progressSegments.goodPct > 0 && (
              <div className="rad-progress-seg" style={{ width: `${progressSegments.goodPct}%`, background: V3.saveInk }} />
            )}
            {progressSegments.reviewPct > 0 && (
              <div className="rad-progress-seg" style={{ width: `${progressSegments.reviewPct}%`, background: V3.edited }} />
            )}
            {progressSegments.helpPct > 0 && (
              <div className="rad-progress-seg" style={{ width: `${progressSegments.helpPct}%`, background: V3.overInk }} />
            )}
          </div>
          <div className="rad-legend">
            {triageCounts.good > 0 && (
              <span><span className="rad-legend-dot" style={{ background: V3.saveInk }} />{triageCounts.good} matched</span>
            )}
            {triageCounts.review > 0 && (
              <span><span className="rad-legend-dot" style={{ background: V3.edited }} />{triageCounts.review} to check</span>
            )}
            {triageCounts.help > 0 && (
              <span><span className="rad-legend-dot" style={{ background: V3.overInk }} />{triageCounts.help} unmatched</span>
            )}
          </div>
        </div>

        {/* ── Item list ─────────────────────────────────────────── */}
        {reviewItems.map((item) => {
          const isExpanded = expandedIdx === item.line_index;
          const choice = selections.get(item.line_index) ?? { kind: 'none' as const };
          const selected = pickSelected(item.candidates, choice) ?? (() => {
            // Check persisted OFF search selections
            const offSel = offSelections.get(item.line_index);
            if (offSel && offSel.source === 'off' && choice.kind === 'off' && offSel.barcode === (choice as { barcode: string }).barcode) return offSel;
            return null;
          })();
          const imgSrc = getImageForCandidate(selected, item);
          const displayName = selected ? candidateName(selected) : (item.description || item.raw_text);
          const price = item.member_price ?? item.shelf_price;
          const qe = qtyEdits.get(item.line_index);
          const pe = priceEdits.get(item.line_index);
          const values = effectiveValues(item, qe, pe, selected);
          const touched = touchedItems.has(item.line_index);
          const fieldState = getBadgeState(item, choice, values, touched);

          return (
            <div key={item.line_index} className="rad-item-card" style={{
              borderColor: fieldState === 'error' ? `${V3.overInk}33` : fieldState === 'warn' ? `${V3.edited}44` : V3.border,
            }}>
              {/* ── Collapsed header row ─────────────────────────── */}
              <div
                className="rad-item-header"
                onClick={() => handleToggle(item.line_index)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(item.line_index); } }}
              >
                {/* Thumbnail */}
                <div className="rad-thumb-wrap">
                  <SafeImage
                    src={imgSrc}
                    className="rad-thumb"
                    fallback={
                      <div className="rad-thumb-fallback">
                        <span style={{ fontSize: 22 }}>&#128230;</span>
                      </div>
                    }
                  />
                </div>

                {/* Name + receipt text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="rad-item-name">{displayName}</div>
                  <div className="rad-item-raw">{(item.raw_text || '').toUpperCase()}</div>
                </div>

                {/* Price + confidence + qty badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {(() => {
                    const badgeUnit = values.unitStr;
                    const badgeQty = values.qtyStr || (selected?.package_size != null ? String(selected.package_size) : '');
                    if (!badgeQty) return null;
                    if (badgeUnit === 'each' || !badgeUnit) {
                      return <span className="rad-qty-badge">&times;{badgeQty}</span>;
                    }
                    return <span className="rad-qty-badge">{badgeQty} {badgeUnit}</span>;
                  })()}
                  <span className="rad-header-price">{fmtPrice(pe?.total ? parseFloat(pe.total) : price)}</span>
                  <ConfBadge state={fieldState} />
                  <svg
                    width="14" height="14" viewBox="0 0 18 18"
                    style={{ color: V3.paperMid, flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}
                  >
                    <path d="M5 7l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* ── Expanded detail ──────────────────────────────── */}
              {isExpanded && (
                <div className="rad-expand" onClick={(e) => e.stopPropagation()}>
                  {/* Raw receipt text */}
                  <div className="rad-expand-raw">
                    {(item.description_raw || item.description || item.raw_text || '').toUpperCase()}
                  </div>

                  {/* Selected product image — BIG */}
                  <div className="rad-expand-product">
                    <ProductImage
                      src={imgSrc}
                      size={100}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: V3.paperInk, marginBottom: 2 }}>
                        {displayName}
                      </div>
                      {selected?.brand && (
                        <div style={{ fontSize: 11, color: V3.paperMute }}>{selected.brand}</div>
                      )}
                      {candidateSize(selected) && (
                        <div style={{ fontSize: 11, color: V3.paperFaint, marginTop: 2 }}>{candidateSize(selected)}</div>
                      )}
                      {choice.kind !== 'none' && (
                        <span className="rad-source-pill">{selected?.source === 'in-house' ? 'CATALOG' : 'OFF'}</span>
                      )}
                      {choice.kind === 'none' && (
                        <span className="rad-source-pill" style={{ borderColor: `${V3.overInk}44`, color: V3.overInk }}>UNMATCHED</span>
                      )}
                    </div>
                  </div>

                  {/* ── Qty + Unit inputs ──────────────────────────── */}
                  <div className="rad-field-section">
                    <div className="rad-field-label">QUANTITY & UNIT</div>
                    <div className="rad-field-row">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="rad-input"
                        style={{ width: 72 }}
                        value={qe?.qty ?? (item.quantity != null ? String(item.quantity) : '')}
                        placeholder="Qty"
                        onChange={(e) => handleQtyChange(item.line_index, 'qty', e.target.value, item)}
                        aria-label="Quantity"
                      />
                      <select
                        className="rad-select"
                        value={qe?.unit || item.unit || selected?.package_unit || ''}
                        onChange={(e) => handleQtyChange(item.line_index, 'unit', e.target.value, item)}
                        aria-label="Unit"
                      >
                        <option value="">--</option>
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* ── Price inputs (bidirectional) ───────────────── */}
                  <div className="rad-field-section">
                    <div className="rad-field-label">PRICE</div>
                    <div className="rad-field-row">
                      <div className="rad-price-field">
                        <span className="rad-price-prefix">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="rad-input rad-input-price"
                          value={pe?.total ?? (price != null ? price.toFixed(2) : '')}
                          placeholder="0.00"
                          onChange={(e) => handlePriceChange(item.line_index, 'total', e.target.value, item)}
                          aria-label="Total price"
                        />
                        <span className="rad-price-suffix">total</span>
                      </div>
                      <span style={{ color: V3.paperFaint, fontSize: 11, fontWeight: 600, flexShrink: 0, alignSelf: 'center' }}>=</span>
                      <div className="rad-price-field">
                        <span className="rad-price-prefix">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="rad-input rad-input-price"
                          value={pe?.unitPrice ?? (item.unit_price != null ? item.unit_price.toFixed(2) : (price != null && (item.quantity ?? 1) > 0 ? (price / (item.quantity ?? 1)).toFixed(2) : ''))}
                          placeholder="0.00"
                          onChange={(e) => handlePriceChange(item.line_index, 'unitPrice', e.target.value, item)}
                          aria-label="Unit price"
                        />
                        <span className="rad-price-suffix">/{(qe?.unit || item.unit || selected?.package_unit || 'ea')}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Candidates ─────────────────────────────────── */}
                  {item.candidates.length > 0 && (
                    <div className="rad-field-section">
                      <div className="rad-field-label">MATCH CANDIDATES</div>
                      {item.candidates.map((cand) => (
                        <CandidateRow
                          key={candidateKey(cand)}
                          candidate={cand}
                          isSelected={isSelected(cand, choice)}
                          onSelect={() => handleSelect(item.line_index, candidateToChoice(cand))}
                        />
                      ))}
                    </div>
                  )}

                  {/* ── OFF search ─────────────────────────────────── */}
                  <div className="rad-field-section">
                    <div className="rad-field-label">SEARCH PRODUCTS</div>
                    <input
                      type="text"
                      className="rad-search-input"
                      placeholder="Search Open Food Facts..."
                      value={searchQueries.get(item.line_index) ?? ''}
                      onChange={(e) => handleSearchChange(item.line_index, e.target.value)}
                      aria-label="Search products"
                    />
                    {searching.has(item.line_index) && (
                      <div className="rad-searching">Searching...</div>
                    )}
                    {(searchResults.get(item.line_index) ?? []).map((hit) => {
                      const cand = offHitToCandidate(hit);
                      return (
                        <CandidateRow
                          key={`search-${hit.barcode}`}
                          candidate={cand}
                          isSelected={isSelected(cand, choice)}
                          onSelect={() => handleSelectFromSearch(item.line_index, cand)}
                        />
                      );
                    })}
                  </div>

                  {/* ── No match ───────────────────────────────────── */}
                  <button
                    onClick={() => handleSelect(item.line_index, { kind: 'none' })}
                    className="rad-nomatch-btn"
                  >
                    Mark no match
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Sticky CTA ──────────────────────────────────────────── */}
      <div className="rad-cta-wrap">
        <button
          onClick={handleConfirm}
          disabled={comparing}
          className="rad-cta-btn"
        >
          {comparing ? 'Comparing prices...' : 'Compare prices'}
          {!comparing && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 6 }}>
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Styles ──────────────────────────────────────────────── */}
      <style>{`
        @keyframes rad-fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .rad-root {
          min-height: 100vh;
          background: ${V3.page};
          color: ${V3.ink};
          font-family: ${FONT_SANS};
        }

        /* ── Top bar ──────────────────────────────────────────── */
        .rad-topbar {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          background: ${V3.chrome}f2;
          border-bottom: 1px solid ${V3.border};
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .rad-back-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: 1px solid ${V3.border};
          color: ${V3.inkMid};
          border-radius: 8px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.15s;
        }
        .rad-back-btn:hover {
          border-color: ${V3.borderHi};
          color: ${V3.ink};
        }
        .rad-topbar-title {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.01em;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
        }
        .rad-topbar-pill {
          border: 1px solid ${V3.border};
          border-radius: 999px;
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        /* ── Content ──────────────────────────────────────────── */
        .rad-content {
          max-width: 580px;
          margin: 0 auto;
          padding: 20px 16px 140px;
        }

        /* ── Summary card ─────────────────────────────────────── */
        .rad-summary {
          background: ${V3.paper};
          color: ${V3.paperInk};
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
          box-shadow: 0 8px 24px -8px rgba(0,0,0,0.35);
        }
        .rad-summary-store {
          font-family: ${FONT_MONO};
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-align: center;
          margin-bottom: 4px;
        }
        .rad-summary-sub {
          font-size: 12px;
          color: ${V3.paperMute};
          text-align: center;
          line-height: 1.4;
        }
        .rad-summary-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 6px;
        }
        .rad-summary-total {
          font-size: 16px;
          font-weight: 800;
          color: ${V3.paperInk};
          font-variant-numeric: tabular-nums;
        }

        /* ── Progress bar ─────────────────────────────────────── */
        .rad-progress {
          display: flex;
          height: 6px;
          border-radius: 3px;
          overflow: hidden;
          background: ${V3.paperShade};
          margin-top: 16px;
          gap: 2px;
        }
        .rad-progress-seg {
          border-radius: 3px;
          transition: width 0.3s ease;
          min-width: 4px;
        }
        .rad-legend {
          display: flex;
          gap: 14px;
          justify-content: center;
          margin-top: 10px;
          font-size: 11px;
          color: ${V3.paperMute};
        }
        .rad-legend-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 4px;
          vertical-align: middle;
        }

        /* ── Item card ────────────────────────────────────────── */
        .rad-item-card {
          background: ${V3.paper};
          border-radius: 12px;
          margin-bottom: 10px;
          border: 1px solid ${V3.border};
          box-shadow: 0 2px 8px -2px rgba(0,0,0,0.18);
          overflow: hidden;
          transition: border-color 0.15s;
        }

        /* ── Item header (collapsed) ──────────────────────────── */
        .rad-item-header {
          display: flex;
          align-items: center;
          padding: 12px 14px;
          gap: 12px;
          cursor: pointer;
          transition: background 0.1s;
        }
        .rad-item-header:hover {
          background: ${V3.paperShade};
        }
        .rad-thumb-wrap {
          position: relative;
          width: 48px;
          height: 48px;
          flex-shrink: 0;
        }
        .rad-thumb {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          object-fit: cover;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
        }
        .rad-thumb-fallback {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rad-item-name {
          font-size: 13px;
          font-weight: 700;
          color: ${V3.paperInk};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rad-item-raw {
          font-family: ${FONT_MONO};
          font-size: 9px;
          color: ${V3.paperFaint};
          letter-spacing: 0.02em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-top: 2px;
        }
        .rad-qty-badge {
          font-family: ${FONT_MONO};
          font-size: 10px;
          font-weight: 700;
          color: ${V3.paperMid};
          background: ${V3.paperShade};
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .rad-header-price {
          font-family: ${FONT_MONO};
          font-size: 13px;
          font-weight: 800;
          color: ${V3.paperInk};
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        /* ── Expanded area ────────────────────────────────────── */
        .rad-expand {
          border-top: 1px solid ${V3.paperLine};
          padding: 14px;
          background: ${V3.paperShade};
          animation: rad-fadeIn 0.2s ease;
        }
        .rad-expand-raw {
          font-family: ${FONT_MONO};
          font-size: 10px;
          color: ${V3.paperMute};
          letter-spacing: 0.02em;
          margin-bottom: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rad-expand-product {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          margin-bottom: 14px;
        }
        .rad-source-pill {
          display: inline-block;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid ${V3.paperLine};
          color: ${V3.paperMid};
          margin-top: 6px;
        }

        /* ── Field sections ───────────────────────────────────── */
        .rad-field-section {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid ${V3.paperLine};
        }
        .rad-field-label {
          font-size: 9px;
          font-weight: 800;
          color: ${V3.paperMute};
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .rad-field-row {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        /* ── Inputs ───────────────────────────────────────────── */
        .rad-input {
          background: ${V3.paper};
          border: 1px solid ${V3.paperLine};
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
          font-weight: 600;
          font-family: ${FONT_MONO};
          font-variant-numeric: tabular-nums;
          color: ${V3.paperInk};
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s;
        }
        .rad-input:focus {
          border-color: ${V3.saveInk};
          box-shadow: 0 0 0 2px ${V3.saveInk}22;
        }
        .rad-input::placeholder {
          color: ${V3.paperFaint};
          font-weight: 500;
        }
        .rad-input-price {
          width: 68px;
          text-align: right;
        }
        .rad-select {
          background: ${V3.paper};
          border: 1px solid ${V3.paperLine};
          border-radius: 6px;
          padding: 8px 28px 8px 10px;
          font-size: 13px;
          font-weight: 600;
          font-family: ${FONT_SANS};
          color: ${V3.paperInk};
          outline: none;
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          min-width: 80px;
          background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23857d6a' fill='none' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          transition: border-color 0.15s;
        }
        .rad-select:focus {
          border-color: ${V3.saveInk};
          box-shadow: 0 0 0 2px ${V3.saveInk}22;
        }

        /* ── Price field compound ──────────────────────────────── */
        .rad-price-field {
          display: flex;
          align-items: center;
          background: ${V3.paper};
          border: 1px solid ${V3.paperLine};
          border-radius: 6px;
          padding: 0 8px;
          transition: border-color 0.15s;
        }
        .rad-price-field:focus-within {
          border-color: ${V3.saveInk};
          box-shadow: 0 0 0 2px ${V3.saveInk}22;
        }
        .rad-price-field .rad-input-price {
          border: none;
          background: transparent;
          padding: 8px 2px;
          box-shadow: none;
        }
        .rad-price-field .rad-input-price:focus {
          border: none;
          box-shadow: none;
        }
        .rad-price-prefix {
          font-size: 13px;
          font-weight: 700;
          color: ${V3.paperMid};
          font-family: ${FONT_MONO};
          flex-shrink: 0;
        }
        .rad-price-suffix {
          font-size: 10px;
          font-weight: 600;
          color: ${V3.paperFaint};
          white-space: nowrap;
          flex-shrink: 0;
          margin-left: 2px;
        }

        /* ── Search input ─────────────────────────────────────── */
        .rad-search-input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 6px;
          border: 1px solid ${V3.paperLine};
          background: ${V3.paper};
          color: ${V3.paperInk};
          font-size: 13px;
          font-family: ${FONT_SANS};
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s;
          margin-bottom: 8px;
        }
        .rad-search-input:focus {
          border-color: ${V3.saveInk};
          box-shadow: 0 0 0 2px ${V3.saveInk}22;
        }
        .rad-search-input::placeholder {
          color: ${V3.paperFaint};
        }
        .rad-searching {
          font-family: ${FONT_MONO};
          font-size: 10px;
          color: ${V3.paperMute};
          letter-spacing: 0.04em;
          margin-bottom: 6px;
        }

        /* ── Candidate row ────────────────────────────────────── */
        .rad-cand-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid ${V3.paperLine};
          background: ${V3.paper};
          cursor: pointer;
          font-family: ${FONT_SANS};
          color: ${V3.paperInk};
          text-align: left;
          margin-bottom: 6px;
          transition: background 0.1s, border-color 0.15s;
        }
        .rad-cand-row:hover {
          background: ${V3.paperShade};
        }
        .rad-cand-row.rad-cand-selected {
          background: ${V3.savePaper};
          border-color: ${V3.saveInk}88;
        }
        .rad-cand-info {
          flex: 1;
          min-width: 0;
        }
        .rad-cand-name {
          font-size: 13px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rad-cand-meta {
          font-size: 10px;
          color: ${V3.paperMute};
          margin-top: 2px;
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .rad-cand-source {
          font-size: 9px;
          padding: 1px 5px;
          border-radius: 4px;
          border: 1px solid ${V3.paperLine};
          color: ${V3.paperMid};
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 800;
          margin-left: auto;
          flex-shrink: 0;
        }

        /* ── No match button ──────────────────────────────────── */
        .rad-nomatch-btn {
          margin-top: 14px;
          width: 100%;
          padding: 10px;
          font-size: 11px;
          font-weight: 700;
          color: ${V3.paperMid};
          background: transparent;
          border: 1px dashed ${V3.paperLine};
          border-radius: 7px;
          cursor: pointer;
          font-family: ${FONT_SANS};
          text-transform: uppercase;
          letter-spacing: 0.04em;
          transition: background 0.1s, color 0.1s;
        }
        .rad-nomatch-btn:hover {
          background: ${V3.paperShade};
          color: ${V3.paperInk};
        }

        /* ── CTA ──────────────────────────────────────────────── */
        .rad-cta-wrap {
          position: fixed;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: min(100%, 580px);
          padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
          background: linear-gradient(180deg, rgba(26,28,31,0), ${V3.page} 34%);
          z-index: 30;
          box-sizing: border-box;
        }
        .rad-cta-btn {
          width: 100%;
          padding: 16px 20px;
          background: linear-gradient(135deg, ${V3.saveInk} 0%, #2c9b4a 100%);
          color: #fff;
          border: none;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 800;
          font-family: ${FONT_SANS};
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 30px -10px rgba(31,122,58,0.5);
          transition: opacity 0.15s, transform 0.15s;
        }
        .rad-cta-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 14px 36px -10px rgba(31,122,58,0.6);
        }
        .rad-cta-btn:disabled {
          opacity: 0.6;
          cursor: wait;
          box-shadow: none;
        }

        /* ── Confidence badge ─────────────────────────────────── */
        .rad-conf {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 11px;
        }

        /* ── Product image (big) ──────────────────────────────── */
        .rad-product-img {
          border-radius: 10px;
          object-fit: cover;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
          flex-shrink: 0;
        }
        .rad-product-placeholder {
          border-radius: 10px;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 36px;
        }

        /* ── Candidate image ──────────────────────────────────── */
        .rad-cand-img {
          width: 80px;
          height: 80px;
          border-radius: 8px;
          object-fit: cover;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
          flex-shrink: 0;
        }
        .rad-cand-img-ph {
          width: 80px;
          height: 80px;
          border-radius: 8px;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 28px;
        }

        /* ── Mobile ───────────────────────────────────────────── */
        @media (max-width: 600px) {
          .rad-content {
            padding: 16px 12px 140px;
          }
          .rad-topbar {
            padding: 12px 14px;
          }
          .rad-topbar-title {
            font-size: 15px;
          }
          .rad-field-row {
            flex-wrap: wrap;
          }
          .rad-cand-img, .rad-cand-img-ph {
            width: 60px;
            height: 60px;
          }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Image with React-managed error state. Resets on src change so a previously
 *  broken image doesn't poison subsequent renders for a different src. */
function SafeImage({ src, alt, className, style, fallback }: {
  src: string | null;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  fallback: React.ReactNode;
}) {
  const [errored, setErrored] = useState(false);
  // Reset error state when src changes
  useEffect(() => { setErrored(false); }, [src]);
  if (!src || errored) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt ?? ''}
      className={className}
      style={style}
      onError={() => setErrored(true)}
    />
  );
}

/** Field-state badge:
 *   ok    → green check    (all fields filled, high confidence or user-approved)
 *   warn  → amber !        (all fields filled, but low/medium confidence, untouched)
 *   error → red X          (missing field — qty / unit / price / no selection)
 */
function ConfBadge({ state }: { state: FieldState }) {
  if (state === 'ok') {
    return (
      <div className="rad-conf" style={{ background: V3.savePaper, border: `1.5px solid ${V3.saveInk}` }}>
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M3 7l2.5 2.5L11 4" stroke={V3.saveInk} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (state === 'warn') {
    return (
      <div className="rad-conf" style={{ background: V3.editedBg, border: `1.5px solid ${V3.edited}` }}>
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M7 4v4M7 10h.01" stroke={V3.edited} strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  return (
    <div className="rad-conf" style={{ background: V3.overPaper, border: `1.5px solid ${V3.overInk}` }}>
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
        <path d="M4 4l6 6M10 4l-6 6" stroke={V3.overInk} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Big product image with fallback (uses SafeImage so error state is reactive) */
function ProductImage({ src, size }: { src: string | null; size: number }) {
  return (
    <SafeImage
      src={src}
      className="rad-product-img"
      style={{ width: size, height: size }}
      fallback={
        <div className="rad-product-placeholder" style={{ width: size, height: size }}>
          <span>&#128230;</span>
        </div>
      }
    />
  );
}

/** Candidate row with big image */
function CandidateRow({ candidate, isSelected: selected, onSelect }: {
  candidate: MatchCandidate;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const name = candidateName(candidate);
  const brand = candidate.brand;
  const size = candidateSize(candidate);
  const sourceLabel = candidate.source === 'in-house' ? 'CATALOG' : 'OFF';
  const imgUrl = candidate.image_url ?? (candidate.source === 'off' ? `/api/off-image/${candidate.barcode}` : null);

  return (
    <button onClick={onSelect} className={`rad-cand-row ${selected ? 'rad-cand-selected' : ''}`}>
      <SafeImage
        src={imgUrl}
        className="rad-cand-img"
        fallback={
          <div className="rad-cand-img-ph">
            <span>&#128230;</span>
          </div>
        }
      />
      <div className="rad-cand-info">
        <div className="rad-cand-name">{name}</div>
        <div className="rad-cand-meta">
          {brand && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand}</span>}
          {size && <span style={{ color: V3.paperFaint, flexShrink: 0 }}>{size}</span>}
        </div>
      </div>
      <span className="rad-cand-source">{sourceLabel}</span>
      {selected && (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: V3.saveInk, flexShrink: 0 }}>
          <path d="M4 9l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
