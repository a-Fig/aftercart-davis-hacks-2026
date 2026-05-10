'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchOffProducts } from '@/lib/api/compare';
import type {
  Correction,
  MatchCandidate,
  MatchItem,
  MatchResponse,
  OffSearchHit,
  NormAnnotation,
} from '@/lib/api/compare';
import { V3, fmt } from './theme';

// ── Types ──────────────────────────────────────────────────────────────────

type Choice =
  | { kind: 'in-house'; canonical_id: number }
  | { kind: 'off'; barcode: string }
  | { kind: 'none' };

type TriageGroup = 'good' | 'review' | 'help';

interface V3ReviewProps {
  matchResult: MatchResponse;
  comparing: boolean;
  onConfirm: (corrections: Correction[]) => Promise<void>;
  onCancel: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function V3ReviewA({ matchResult, comparing, onConfirm, onCancel }: V3ReviewProps) {
  const reviewItems = useMemo(
    () => matchResult.items.filter((it) => it.item_type !== 'skip'),
    [matchResult.items],
  );

  // ── State ──────────────────────────────────────────────────────────────

  const [selections, setSelections] = useState<Map<number, Choice>>(() => {
    const m = new Map<number, Choice>();
    for (const item of reviewItems) {
      if (item.suggested_match) {
        const sm = item.suggested_match;
        if (sm.source === 'off' && sm.barcode) {
          m.set(item.line_index, { kind: 'off', barcode: sm.barcode });
        } else if (sm.canonical_id) {
          m.set(item.line_index, { kind: 'in-house', canonical_id: sm.canonical_id });
        } else {
          m.set(item.line_index, { kind: 'none' });
        }
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
  const [qtyEdits, setQtyEdits] = useState<Map<number, { qty: string; unit: string }>>(new Map());
  const searchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => () => {
    for (const timer of searchTimers.current.values()) clearTimeout(timer);
    searchTimers.current.clear();
  }, []);

  // ── Triage classification ──────────────────────────────────────────────

  const triageItems = useMemo(() => {
    const good: MatchItem[] = [];
    const review: MatchItem[] = [];
    const help: MatchItem[] = [];

    for (const item of reviewItems) {
      const sel = selections.get(item.line_index);
      if (!sel || sel.kind === 'none') {
        help.push(item);
      } else {
        const confidence = item.suggested_match?.match_confidence;
        if (confidence === 'high') {
          good.push(item);
        } else {
          review.push(item);
        }
      }
    }
    return { good, review, help };
  }, [reviewItems, selections]);

  // ── Counts ─────────────────────────────────────────────────────────────

  const matchedCount = useMemo(
    () => Array.from(selections.values()).filter((c) => c.kind !== 'none').length,
    [selections],
  );

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleSelect = useCallback((lineIndex: number, choice: Choice) => {
    setSelections((prev) => {
      const m = new Map(prev);
      m.set(lineIndex, choice);
      return m;
    });
    setExpanded((prev) => {
      const s = new Set(prev);
      s.delete(lineIndex);
      return s;
    });
  }, []);

  const handleToggleExpand = useCallback((lineIndex: number) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(lineIndex) ? s.delete(lineIndex) : s.add(lineIndex);
      return s;
    });
  }, []);

  const handleSearchChange = useCallback((lineIndex: number, query: string) => {
    setSearchQueries((prev) => {
      const m = new Map(prev);
      m.set(lineIndex, query);
      return m;
    });

    const existing = searchTimers.current.get(lineIndex);
    if (existing) clearTimeout(existing);

    if (!query.trim() || query.trim().length < 2) {
      setSearchResults((prev) => {
        const m = new Map(prev);
        m.delete(lineIndex);
        return m;
      });
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
      setSearching((prev) => {
        const s = new Set(prev);
        s.delete(lineIndex);
        return s;
      });
    }, 280);
    searchTimers.current.set(lineIndex, timer);
  }, []);

  const handleQtyChange = useCallback((lineIndex: number, field: 'qty' | 'unit', value: string) => {
    setQtyEdits((prev) => {
      const m = new Map(prev);
      const current = m.get(lineIndex) ?? { qty: '', unit: '' };
      m.set(lineIndex, { ...current, [field]: value });
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
        if (!Number.isNaN(parsedQty) && parsedQty !== item.quantity) {
          overrides.quantity_override = parsedQty;
        }
        const trimmedUnit = edit.unit.trim();
        if (trimmedUnit && trimmedUnit !== item.unit) {
          overrides.unit_override = trimmedUnit;
        }
      }
      corrections.push({ line_index: item.line_index, choice, ...overrides } as Correction);
    }
    void onConfirm(corrections);
  }, [reviewItems, selections, qtyEdits, onConfirm]);

  // ── Progress bar segments ──────────────────────────────────────────────

  const progressSegments = useMemo(() => {
    const total = reviewItems.length;
    if (total === 0) return { goodPct: 0, reviewPct: 0, helpPct: 0 };
    return {
      goodPct: (triageItems.good.length / total) * 100,
      reviewPct: (triageItems.review.length / total) * 100,
      helpPct: (triageItems.help.length / total) * 100,
    };
  }, [reviewItems.length, triageItems]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="ra-root">
      {/* Sticky top bar */}
      <div className="ra-topbar">
        <button onClick={onCancel} className="ra-back-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div className="ra-topbar-title">Review</div>
        <div className="ra-topbar-pill">
          <span style={{ color: V3.saveInk, fontWeight: 800 }}>{matchedCount}</span>
          <span style={{ color: V3.inkLight }}> / {reviewItems.length}</span>
        </div>
      </div>

      {/* Main content */}
      <div className="ra-content">

        {/* Receipt summary card */}
        <div className="ra-summary-card">
          <div className="ra-summary-store">
            {(matchResult.receipt.store_name ?? 'Your Receipt').toUpperCase()}
          </div>
          {matchResult.receipt.store_address && (
            <div className="ra-summary-sub">{matchResult.receipt.store_address}</div>
          )}
          <div className="ra-summary-row">
            {matchResult.receipt.receipt_date && (
              <span className="ra-summary-sub">{matchResult.receipt.receipt_date}</span>
            )}
            {matchResult.receipt.item_count != null && (
              <span className="ra-summary-sub">{matchResult.receipt.item_count} items</span>
            )}
            {matchResult.receipt.receipt_total != null && (
              <span className="ra-summary-total">{fmt(matchResult.receipt.receipt_total)}</span>
            )}
          </div>

          {/* Segmented progress bar */}
          <div className="ra-progress-bar">
            {progressSegments.goodPct > 0 && (
              <div className="ra-progress-seg ra-progress-good" style={{ width: `${progressSegments.goodPct}%` }} />
            )}
            {progressSegments.reviewPct > 0 && (
              <div className="ra-progress-seg ra-progress-review" style={{ width: `${progressSegments.reviewPct}%` }} />
            )}
            {progressSegments.helpPct > 0 && (
              <div className="ra-progress-seg ra-progress-help" style={{ width: `${progressSegments.helpPct}%` }} />
            )}
          </div>
          <div className="ra-progress-legend">
            {triageItems.good.length > 0 && (
              <span><span className="ra-legend-dot" style={{ background: V3.saveInk }} />{triageItems.good.length} matched</span>
            )}
            {triageItems.review.length > 0 && (
              <span><span className="ra-legend-dot" style={{ background: V3.edited }} />{triageItems.review.length} to check</span>
            )}
            {triageItems.help.length > 0 && (
              <span><span className="ra-legend-dot" style={{ background: V3.overInk }} />{triageItems.help.length} unmatched</span>
            )}
          </div>
        </div>

        {/* ── GOOD TO GO ──────────────────────────────────────────────── */}
        {triageItems.good.length > 0 && (
          <div className="ra-section">
            <div className="ra-section-header">
              <span className="ra-section-label">Good to go</span>
              <span className="ra-section-count">{triageItems.good.length}</span>
            </div>
            <div className="ra-good-card">
              {triageItems.good.map((item, i) => (
                <GoodRow
                  key={item.line_index}
                  item={item}
                  selection={selections.get(item.line_index) ?? { kind: 'none' }}
                  isExpanded={expanded.has(item.line_index)}
                  onToggle={() => handleToggleExpand(item.line_index)}
                  onSelect={(choice) => handleSelect(item.line_index, choice)}
                  searchQuery={searchQueries.get(item.line_index) ?? ''}
                  onSearchChange={(q) => handleSearchChange(item.line_index, q)}
                  searchHits={searchResults.get(item.line_index) ?? []}
                  isSearching={searching.has(item.line_index)}
                  qtyEdit={qtyEdits.get(item.line_index)}
                  onQtyChange={(field, value) => handleQtyChange(item.line_index, field, value)}
                  isLast={i === triageItems.good.length - 1}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── NEEDS YOUR EYE ──────────────────────────────────────────── */}
        {triageItems.review.length > 0 && (
          <div className="ra-section">
            <div className="ra-section-header">
              <span className="ra-section-label">Needs your eye</span>
              <span className="ra-section-count ra-section-count-amber">{triageItems.review.length}</span>
            </div>
            {triageItems.review.map((item) => (
              <ReviewCard
                key={item.line_index}
                item={item}
                selection={selections.get(item.line_index) ?? { kind: 'none' }}
                isExpanded={expanded.has(item.line_index)}
                onToggle={() => handleToggleExpand(item.line_index)}
                onSelect={(choice) => handleSelect(item.line_index, choice)}
                searchQuery={searchQueries.get(item.line_index) ?? ''}
                onSearchChange={(q) => handleSearchChange(item.line_index, q)}
                searchHits={searchResults.get(item.line_index) ?? []}
                isSearching={searching.has(item.line_index)}
                qtyEdit={qtyEdits.get(item.line_index)}
                onQtyChange={(field, value) => handleQtyChange(item.line_index, field, value)}
              />
            ))}
          </div>
        )}

        {/* ── NEEDS HELP ──────────────────────────────────────────────── */}
        {triageItems.help.length > 0 && (
          <div className="ra-section">
            <div className="ra-section-header">
              <span className="ra-section-label">Needs help</span>
              <span className="ra-section-count ra-section-count-red">{triageItems.help.length}</span>
            </div>
            {triageItems.help.map((item) => (
              <HelpCard
                key={item.line_index}
                item={item}
                selection={selections.get(item.line_index) ?? { kind: 'none' }}
                onSelect={(choice) => handleSelect(item.line_index, choice)}
                searchQuery={searchQueries.get(item.line_index) ?? ''}
                onSearchChange={(q) => handleSearchChange(item.line_index, q)}
                searchHits={searchResults.get(item.line_index) ?? []}
                isSearching={searching.has(item.line_index)}
                qtyEdit={qtyEdits.get(item.line_index)}
                onQtyChange={(field, value) => handleQtyChange(item.line_index, field, value)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky CTA */}
      <div className="ra-cta-wrap">
        <button
          onClick={handleConfirm}
          disabled={comparing}
          className="ra-cta-btn"
        >
          {comparing ? 'Comparing prices...' : 'Compare prices'}
          {!comparing && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 6 }}>
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      <style jsx global>{`
        /* ── Root ───────────────────────────────────────────────── */
        .ra-root {
          min-height: 100vh;
          background: ${V3.page};
          color: ${V3.ink};
        }

        /* ── Top bar ───────────────────────────────────────────── */
        .ra-topbar {
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
        .ra-back-btn {
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
        }
        .ra-topbar-title {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.01em;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
        }
        .ra-topbar-pill {
          border: 1px solid ${V3.border};
          border-radius: 999px;
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        /* ── Content ───────────────────────────────────────────── */
        .ra-content {
          max-width: 520px;
          margin: 0 auto;
          padding: 20px 16px 140px;
        }

        /* ── Summary card ──────────────────────────────────────── */
        .ra-summary-card {
          background: ${V3.paper};
          color: ${V3.paperInk};
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
          box-shadow: 0 8px 24px -8px rgba(0,0,0,0.35);
        }
        .ra-summary-store {
          font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-align: center;
          margin-bottom: 4px;
        }
        .ra-summary-sub {
          font-size: 12px;
          color: ${V3.paperMute};
          text-align: center;
          line-height: 1.4;
        }
        .ra-summary-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 6px;
        }
        .ra-summary-total {
          font-size: 16px;
          font-weight: 800;
          color: ${V3.paperInk};
        }

        /* ── Progress bar ──────────────────────────────────────── */
        .ra-progress-bar {
          display: flex;
          height: 6px;
          border-radius: 3px;
          overflow: hidden;
          background: ${V3.paperShade};
          margin-top: 16px;
          gap: 2px;
        }
        .ra-progress-seg {
          border-radius: 3px;
          transition: width 0.3s ease;
          min-width: 4px;
        }
        .ra-progress-good { background: ${V3.saveInk}; }
        .ra-progress-review { background: ${V3.edited}; }
        .ra-progress-help { background: ${V3.overInk}; }

        .ra-progress-legend {
          display: flex;
          gap: 14px;
          justify-content: center;
          margin-top: 10px;
          font-size: 11px;
          color: ${V3.paperMute};
        }
        .ra-legend-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 4px;
          vertical-align: middle;
        }

        /* ── Section headers ───────────────────────────────────── */
        .ra-section {
          margin-bottom: 24px;
        }
        .ra-section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .ra-section-label {
          font-size: 13px;
          font-weight: 700;
          color: ${V3.inkMid};
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .ra-section-count {
          font-size: 11px;
          font-weight: 800;
          background: ${V3.saveInk};
          color: #fff;
          padding: 2px 8px;
          border-radius: 999px;
        }
        .ra-section-count-amber {
          background: ${V3.edited};
        }
        .ra-section-count-red {
          background: ${V3.overInk};
        }

        /* ── Good-to-go compact card ───────────────────────────── */
        .ra-good-card {
          background: ${V3.paper};
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 2px 8px -2px rgba(0,0,0,0.18);
        }

        /* Good row — compact */
        .ra-good-row {
          display: flex;
          align-items: center;
          padding: 0 14px;
          height: 44px;
          cursor: pointer;
          transition: background 0.1s;
          gap: 10px;
        }
        .ra-good-row:hover {
          background: ${V3.paperShade};
        }
        .ra-good-row-border {
          border-bottom: 1px solid ${V3.paperLine};
        }
        .ra-good-check {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${V3.savePaper};
          border: 1.5px solid ${V3.saveInk};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .ra-good-name {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          color: ${V3.paperInk};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .ra-good-price {
          font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
          font-size: 12px;
          font-weight: 700;
          color: ${V3.paperMid};
          flex-shrink: 0;
        }
        .ra-good-change {
          font-size: 10px;
          font-weight: 700;
          color: ${V3.paperMute};
          text-transform: uppercase;
          letter-spacing: 0.06em;
          flex-shrink: 0;
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid ${V3.paperLine};
          background: transparent;
          cursor: pointer;
          font-family: inherit;
        }
        .ra-good-change:hover {
          background: ${V3.paperShade};
          color: ${V3.paperInk};
        }

        /* Expanded area inside a good row */
        .ra-good-expand {
          background: ${V3.paperShade};
          padding: 12px 14px;
          border-bottom: 1px solid ${V3.paperLine};
        }

        /* ── Review card (medium confidence) ───────────────────── */
        .ra-review-card {
          background: ${V3.paper};
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 10px;
          border: 1px solid ${V3.edited}44;
          box-shadow: 0 2px 8px -2px rgba(0,0,0,0.12);
        }
        .ra-review-raw {
          font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
          font-size: 10px;
          color: ${V3.paperMute};
          letter-spacing: 0.02em;
          margin-bottom: 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ra-review-interp {
          font-size: 14px;
          font-weight: 700;
          color: ${V3.paperInk};
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ra-review-arrow {
          color: ${V3.edited};
          font-size: 12px;
          flex-shrink: 0;
        }

        /* Match button (shared between review and help cards) */
        .ra-match-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid;
          cursor: pointer;
          font-family: inherit;
          color: ${V3.paperInk};
          text-align: left;
          transition: border-color 0.1s;
        }
        .ra-match-btn:hover {
          border-color: ${V3.paperMid};
        }
        .ra-match-name {
          font-size: 13px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ra-match-meta {
          font-size: 10px;
          color: ${V3.paperMute};
          margin-top: 2px;
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .ra-match-source {
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

        /* ── Help card (unmatched) ─────────────────────────────── */
        .ra-help-card {
          background: ${V3.paper};
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 10px;
          border: 1px solid ${V3.overInk}33;
          box-shadow: 0 2px 8px -2px rgba(0,0,0,0.12);
        }
        .ra-help-label {
          font-size: 12px;
          color: ${V3.paperMute};
          margin-bottom: 10px;
          line-height: 1.4;
        }

        /* ── Expand area (candidates + search) ─────────────────── */
        .ra-expand-area {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid ${V3.paperLine};
        }
        .ra-expand-label {
          font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
          font-size: 9px;
          font-weight: 800;
          color: ${V3.paperMute};
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        /* Candidate rows */
        .ra-cand-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 7px;
          border: 1px solid ${V3.paperLine};
          background: ${V3.paper};
          cursor: pointer;
          font-family: inherit;
          color: ${V3.paperInk};
          text-align: left;
          margin-bottom: 6px;
          transition: background 0.1s, border-color 0.1s;
        }
        .ra-cand-btn:hover {
          background: ${V3.paperShade};
        }
        .ra-cand-btn.is-selected {
          background: ${V3.savePaper};
          border-color: ${V3.saveOutline};
        }

        /* Search input */
        .ra-search-input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 7px;
          border: 1px solid ${V3.paperLine};
          background: ${V3.paper};
          color: ${V3.paperInk};
          font-size: 13px;
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          margin-top: 8px;
        }
        .ra-search-input:focus {
          border-color: ${V3.paperMid};
        }
        .ra-search-input::placeholder {
          color: ${V3.paperFaint};
        }
        .ra-searching-label {
          font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
          font-size: 9px;
          color: ${V3.paperMute};
          margin-top: 6px;
          letter-spacing: 0.04em;
        }

        /* No-match button */
        .ra-no-match-btn {
          margin-top: 10px;
          width: 100%;
          padding: 10px;
          font-size: 11px;
          font-weight: 700;
          color: ${V3.paperMid};
          background: transparent;
          border: 1px dashed ${V3.paperLine};
          border-radius: 7px;
          cursor: pointer;
          font-family: inherit;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ra-no-match-btn:hover {
          background: ${V3.paperShade};
          color: ${V3.paperInk};
        }

        /* Qty slot */
        .ra-qty-slot {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
          padding: 4px 8px;
          background: rgba(255,255,255,0.5);
          border: 1px dashed ${V3.paperLine};
          border-radius: 4px;
          font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
          width: fit-content;
        }
        .ra-qty-label {
          font-size: 9px;
          font-weight: 800;
          color: ${V3.paperMute};
          letter-spacing: 0.1em;
          flex-shrink: 0;
        }
        .ra-qty-input,
        .ra-qty-unit-input {
          background: transparent;
          border: none;
          border-bottom: 1px solid ${V3.paperLine};
          color: ${V3.paperInk};
          font-family: inherit;
          font-size: 11px;
          font-weight: 700;
          padding: 0 2px;
          outline: none;
          min-width: 0;
        }
        .ra-qty-input { width: 48px; text-align: right; }
        .ra-qty-unit-input { width: 40px; }
        .ra-qty-input:focus,
        .ra-qty-unit-input:focus {
          border-bottom-color: ${V3.saveInk};
          background: rgba(255,255,255,0.6);
        }
        .ra-qty-input::placeholder,
        .ra-qty-unit-input::placeholder {
          color: ${V3.paperFaint};
          font-weight: 500;
        }

        /* ── Thumbnail ─────────────────────────────────────────── */
        .ra-thumb {
          width: 32px;
          height: 32px;
          border-radius: 5px;
          object-fit: cover;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
          flex-shrink: 0;
        }
        .ra-thumb-empty {
          width: 32px;
          height: 32px;
          border-radius: 5px;
          background: ${V3.paperShade};
          border: 1px solid ${V3.paperLine};
          flex-shrink: 0;
        }

        /* ── Confidence dot ────────────────────────────────────── */
        .ra-conf-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        /* ── Chevron ───────────────────────────────────────────── */
        .ra-chevron {
          color: ${V3.paperMid};
          flex-shrink: 0;
          transition: transform 0.15s;
        }

        /* ── CTA ───────────────────────────────────────────────── */
        .ra-cta-wrap {
          position: fixed;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: min(100%, 520px);
          padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
          background: linear-gradient(180deg, rgba(26,28,31,0), ${V3.page} 34%);
          z-index: 30;
          box-sizing: border-box;
        }
        .ra-cta-btn {
          width: 100%;
          padding: 16px 20px;
          background: ${V3.ink};
          color: ${V3.page};
          border: none;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 800;
          font-family: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 18px 34px -18px rgba(246,245,241,0.7);
          transition: opacity 0.15s;
        }
        .ra-cta-btn:disabled {
          opacity: 0.6;
          cursor: wait;
          box-shadow: none;
        }

        /* ── Mobile adjustments ────────────────────────────────── */
        @media (max-width: 560px) {
          .ra-content {
            padding: 16px 12px 140px;
          }
          .ra-topbar {
            padding: 12px 14px;
          }
          .ra-topbar-title {
            font-size: 15px;
          }
        }
      `}</style>
    </div>
  );
}

// ── Good-to-go row ────────────────────────────────────────────────────────

interface GoodRowProps {
  item: MatchItem;
  selection: Choice;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (choice: Choice) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchHits: OffSearchHit[];
  isSearching: boolean;
  qtyEdit: { qty: string; unit: string } | undefined;
  onQtyChange: (field: 'qty' | 'unit', value: string) => void;
  isLast: boolean;
}

function GoodRow({
  item, selection, isExpanded, onToggle, onSelect,
  searchQuery, onSearchChange, searchHits, isSearching,
  qtyEdit, onQtyChange, isLast,
}: GoodRowProps) {
  const selected = pickSelected(item.candidates, selection);
  const name = selected ? candidateName(selected) : item.description || item.raw_text;
  const price = item.member_price ?? item.shelf_price;

  return (
    <>
      <div
        className={`ra-good-row ${!isLast && !isExpanded ? 'ra-good-row-border' : ''}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <div className="ra-good-check">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
            <path d="M3 7l2.5 2.5L11 4" stroke={V3.saveInk} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="ra-good-name">{name}</span>
        <UnitBadge item={item} />
        <span className="ra-good-price">{fmtPrice(price)}</span>
        <button
          className="ra-good-change"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {isExpanded ? 'close' : 'change'}
        </button>
      </div>
      {isExpanded && (
        <div className="ra-good-expand">
          <div className="ra-review-raw">
            {(item.description_raw || item.description || item.raw_text || '').toUpperCase()}
          </div>
          <QtySlot item={item} qtyEdit={qtyEdit} onQtyChange={onQtyChange} />
          <ExpandArea
            item={item}
            selection={selection}
            onSelect={onSelect}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            searchHits={searchHits}
            isSearching={isSearching}
          />
        </div>
      )}
    </>
  );
}

// ── Review card (medium confidence) ───────────────────────────────────────

interface ReviewCardProps {
  item: MatchItem;
  selection: Choice;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (choice: Choice) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchHits: OffSearchHit[];
  isSearching: boolean;
  qtyEdit: { qty: string; unit: string } | undefined;
  onQtyChange: (field: 'qty' | 'unit', value: string) => void;
}

function ReviewCard({
  item, selection, isExpanded, onToggle, onSelect,
  searchQuery, onSearchChange, searchHits, isSearching,
  qtyEdit, onQtyChange,
}: ReviewCardProps) {
  const selected = pickSelected(item.candidates, selection);
  const matchName = selected ? candidateName(selected) : (item.suggested_match?.name ?? 'Unknown');
  const confidence = item.suggested_match?.match_confidence;

  return (
    <div className="ra-review-card">
      <div className="ra-review-raw">
        {(item.description_raw || item.description || item.raw_text || '').toUpperCase()}
      </div>
      <div className="ra-review-interp">
        <span className="ra-review-arrow">-&gt;</span>
        <span>{item.description || item.raw_text}</span>
        <UnitBadge item={item} />
        {item.shelf_price != null && (
          <span style={{ marginLeft: 'auto', fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", fontSize: 12, color: V3.paperMid, fontWeight: 700, flexShrink: 0 }}>
            {fmtPrice(item.shelf_price)}
          </span>
        )}
      </div>

      <QtySlot item={item} qtyEdit={qtyEdit} onQtyChange={onQtyChange} />

      {/* Match button */}
      <button
        onClick={onToggle}
        className="ra-match-btn"
        style={{
          background: V3.editedBg,
          borderColor: `${V3.edited}66`,
          marginTop: 8,
        }}
      >
        {selected && (
          <Thumbnail imgUrl={selected.image_url ?? item.suggested_match?.enrichment?.image_url ?? null} barcode={selected.source === 'off' ? selected.barcode : item.suggested_match?.barcode} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ra-match-name">{matchName}</div>
          <div className="ra-match-meta">
            {selected?.brand && <span>{selected.brand}</span>}
            {candidateSize(selected) && <span style={{ color: V3.paperFaint }}>{candidateSize(selected)}</span>}
          </div>
        </div>
        <ConfidenceDot confidence={confidence} />
        <ChevronIcon expanded={isExpanded} />
      </button>

      {isExpanded && (
        <ExpandArea
          item={item}
          selection={selection}
          onSelect={onSelect}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          searchHits={searchHits}
          isSearching={isSearching}
        />
      )}
    </div>
  );
}

// ── Help card (unmatched) ─────────────────────────────────────────────────

interface HelpCardProps {
  item: MatchItem;
  selection: Choice;
  onSelect: (choice: Choice) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchHits: OffSearchHit[];
  isSearching: boolean;
  qtyEdit: { qty: string; unit: string } | undefined;
  onQtyChange: (field: 'qty' | 'unit', value: string) => void;
}

function HelpCard({
  item, selection, onSelect,
  searchQuery, onSearchChange, searchHits, isSearching,
  qtyEdit, onQtyChange,
}: HelpCardProps) {
  return (
    <div className="ra-help-card">
      <div className="ra-review-raw">
        {(item.description_raw || item.description || item.raw_text || '').toUpperCase()}
      </div>
      {item.shelf_price != null && (
        <div style={{ fontSize: 13, fontWeight: 700, color: V3.paperInk, marginBottom: 4 }}>
          {item.description || item.raw_text}
          <UnitBadge item={item} />
          <span style={{ marginLeft: 8, fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace", fontSize: 12, color: V3.paperMid }}>
            {fmtPrice(item.shelf_price)}
          </span>
        </div>
      )}
      <div className="ra-help-label">
        We need your help with this one. Search for the product or skip it.
      </div>

      <QtySlot item={item} qtyEdit={qtyEdit} onQtyChange={onQtyChange} />

      {/* Search is shown by default for help items */}
      <input
        type="text"
        placeholder="Search for this product..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="ra-search-input"
        style={{ marginTop: 0 }}
      />
      {isSearching && (
        <div className="ra-searching-label">Searching...</div>
      )}

      {/* Candidates (if any auto-suggestions exist) */}
      {item.candidates.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="ra-expand-label">Suggestions</div>
          {item.candidates.map((cand) => (
            <CandidateRow
              key={candidateKey(cand)}
              candidate={cand}
              selected={isSelected(cand, selection)}
              onSelect={() => onSelect(candidateToChoice(cand))}
            />
          ))}
        </div>
      )}

      {/* Search results */}
      {searchHits.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="ra-expand-label">Search results</div>
          {searchHits.map((hit) => {
            const cand = offHitToCandidate(hit);
            return (
              <CandidateRow
                key={`o-${hit.barcode}`}
                candidate={cand}
                selected={isSelected(cand, selection)}
                onSelect={() => onSelect(candidateToChoice(cand))}
              />
            );
          })}
        </div>
      )}

      <button
        onClick={() => onSelect({ kind: 'none' })}
        className="ra-no-match-btn"
      >
        Skip this item
      </button>
    </div>
  );
}

// ── Shared expand area (candidates + search) ──────────────────────────────

interface ExpandAreaProps {
  item: MatchItem;
  selection: Choice;
  onSelect: (choice: Choice) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchHits: OffSearchHit[];
  isSearching: boolean;
}

function ExpandArea({
  item, selection, onSelect,
  searchQuery, onSearchChange, searchHits, isSearching,
}: ExpandAreaProps) {
  const searchCandidates: MatchCandidate[] = searchHits.map(offHitToCandidate);

  return (
    <div className="ra-expand-area">
      <div className="ra-expand-label">Suggestions</div>

      {item.candidates.length === 0 && searchCandidates.length === 0 && (
        <div style={{ fontSize: 11, color: V3.paperMute, padding: '2px 0 8px' }}>
          No suggestions available. Try searching below.
        </div>
      )}

      {item.candidates.map((cand) => (
        <CandidateRow
          key={candidateKey(cand)}
          candidate={cand}
          selected={isSelected(cand, selection)}
          onSelect={() => onSelect(candidateToChoice(cand))}
        />
      ))}

      <input
        type="text"
        placeholder="Search products..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="ra-search-input"
      />
      {isSearching && (
        <div className="ra-searching-label">Searching...</div>
      )}

      {searchCandidates.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="ra-expand-label">Search results</div>
          {searchCandidates.map((cand) => (
            <CandidateRow
              key={candidateKey(cand)}
              candidate={cand}
              selected={isSelected(cand, selection)}
              onSelect={() => onSelect(candidateToChoice(cand))}
            />
          ))}
        </div>
      )}

      <button
        onClick={() => onSelect({ kind: 'none' })}
        className="ra-no-match-btn"
      >
        Mark no match
      </button>
    </div>
  );
}

// ── Candidate row ─────────────────────────────────────────────────────────

function CandidateRow({ candidate, selected, onSelect }: {
  candidate: MatchCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = candidateName(candidate);
  const brand = candidate.brand;
  const size = candidateSize(candidate);
  const sourceLabel = candidate.source === 'in-house' ? 'catalog' : 'OFF';

  return (
    <button onClick={onSelect} className={`ra-cand-btn ${selected ? 'is-selected' : ''}`}>
      <Thumbnail imgUrl={candidate.image_url ?? null} barcode={candidate.source === 'off' ? candidate.barcode : null} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div className="ra-match-meta">
          {brand && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand}</span>}
          {size && <span style={{ color: V3.paperFaint, flexShrink: 0 }}>{size}</span>}
          <span className="ra-match-source">{sourceLabel}</span>
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

// ── Qty slot ──────────────────────────────────────────────────────────────

function QtySlot({ item, qtyEdit, onQtyChange }: {
  item: MatchItem;
  qtyEdit: { qty: string; unit: string } | undefined;
  onQtyChange: (field: 'qty' | 'unit', value: string) => void;
}) {
  const qtyValue = qtyEdit?.qty ?? (item.quantity != null ? String(item.quantity) : '');
  const unitValue = qtyEdit?.unit ?? (item.unit ?? '');

  if (!qtyValue && !unitValue && item.unit_price == null && !needsUnitWarning(item)) return null;

  return (
    <div className="ra-qty-slot" onClick={(e) => e.stopPropagation()}>
      <span className="ra-qty-label">QTY</span>
      <input
        type="text"
        inputMode="decimal"
        className="ra-qty-input"
        value={qtyValue}
        placeholder="--"
        onChange={(e) => onQtyChange('qty', e.target.value)}
        aria-label="Quantity or weight"
      />
      <input
        type="text"
        className="ra-qty-unit-input"
        value={unitValue}
        placeholder="unit"
        onChange={(e) => onQtyChange('unit', e.target.value)}
        aria-label="Unit"
      />
      {item.unit_price != null && (
        <span style={{ fontSize: 9, color: V3.paperMid, letterSpacing: '0.04em', marginLeft: 4 }}>
          @ {fmt(item.unit_price)}{unitValue ? `/${unitValue}` : ''}
        </span>
      )}
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────

function Thumbnail({ imgUrl, barcode }: { imgUrl: string | null; barcode?: string | null }) {
  const src = imgUrl ?? (barcode ? `/api/off-image/${barcode}` : null);
  if (src) {
    return <img src={src} alt="" className="ra-thumb" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
  }
  return <div className="ra-thumb-empty" />;
}

function ConfidenceDot({ confidence }: { confidence?: string }) {
  if (!confidence) return null;
  const colors: Record<string, string> = { high: V3.saveInk, medium: V3.edited, low: V3.overInk };
  return (
    <span
      className="ra-conf-dot"
      title={`${confidence} confidence`}
      style={{ background: colors[confidence] || V3.paperMute }}
    />
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 18 18"
      className="ra-chevron"
      style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
    >
      <path d="M5 7l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function needsUnitWarning(item: MatchItem): boolean {
  if (item.quantity && item.unit && item.unit !== 'each' && item.unit !== 'count') return false;
  const pu = item.suggested_match?.pricing_unit ?? '';
  return pu !== '' && pu !== 'per_each' && pu !== 'per_pack' && pu !== 'per_count';
}

function UnitBadge({ item }: { item: MatchItem }) {
  if (item.quantity && item.unit && item.unit !== 'each' && item.unit !== 'count') {
    return (
      <span style={{ fontSize: 9, color: V3.paperMid, marginLeft: 6, whiteSpace: 'nowrap' }}>
        {item.quantity} {item.unit}
      </span>
    );
  }
  if (needsUnitWarning(item)) {
    return (
      <span style={{ fontSize: 8, color: '#d97706', marginLeft: 6, whiteSpace: 'nowrap', fontWeight: 600 }}>
        no unit
      </span>
    );
  }
  return null;
}

function fmtPrice(n: number | null | undefined) {
  return typeof n === 'number' ? fmt(n) : '--';
}

function candidateKey(c: MatchCandidate): string {
  return c.source === 'in-house' ? `c-${c.canonical_id}` : `o-${c.barcode}`;
}

function isSelected(c: MatchCandidate, choice: Choice): boolean {
  if (choice.kind === 'in-house') return c.source === 'in-house' && c.canonical_id === choice.canonical_id;
  if (choice.kind === 'off') return c.source === 'off' && c.barcode === choice.barcode;
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

function candidateName(candidate: MatchCandidate) {
  if (candidate.source === 'in-house') return candidate.name;
  return candidate.name ?? candidate.brand ?? 'Unknown product';
}

function candidateSize(candidate: MatchCandidate | null) {
  if (!candidate) return null;
  if (candidate.package_size && candidate.package_unit) {
    return `${candidate.package_size} ${candidate.package_unit}`;
  }
  return candidate.source === 'off' ? candidate.quantity_raw : null;
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
