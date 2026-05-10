'use client';

/**
 * Alt K — Comparison Ledger.
 *
 * Synthesis of F (spreadsheet feel — items × chains grid, expandable cells,
 * change badges) and H (receipt vibes — paper aesthetic, "alternate trip"
 * framing, comparison stamps, tear edge).
 *
 * One large paper-style ledger. Rows are the user's items, columns are
 * nearby chains. Each cell is an "alternate trip" sub-receipt for that one
 * item at that one chain — substitute name, change badge, total, percent.
 * Click a cell to drop a sub-row that lists every other shelf option at
 * that chain for that item, with a search box to find products the
 * auto-suggest missed and a radio to pick which substitute is "your" pick.
 * Totals at the bottom recompute live as picks change. Per-chain comparison
 * stamps below the totals row preserve the "↓ SAVED $X" emotional payoff.
 *
 * The point: a printed-ledger artifact that lets you read every alternate
 * universe at once *and* edit any cell to your real preference.
 */

import { Fragment, useCallback, useMemo, useState } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, type ChainOption, type ChainProjection } from '../projection';
import { classifyChange, CHANGE_LABELS, CHANGE_COLORS } from '@/app/v3/compare-alt/mock-data';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

interface ChainSummary {
  chain: ChainProjection;
  total: number;
  comparable: number;
  savings: number;
  coveredCount: number;
  totalEligible: number;
  skippedItems: Array<{ item: ApiItem; idx: number }>;
}

export default function CompareAltK({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const items = useMemo(
    () => compareResp.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.item_type !== 'skip'),
    [compareResp.items],
  );

  // Per-(chain, idx) user pick override. Map key: "chain_id:idx" → canonical_id.
  const [picks, setPicks] = useState<Map<string, number>>(new Map());
  // Currently-expanded cell, if any. Null means nothing expanded.
  const [expanded, setExpanded] = useState<{ chain_id: number; idx: number } | null>(null);
  const [searchQ, setSearchQ] = useState<string>('');

  const setPick = useCallback((chain_id: number, idx: number, canonical_id: number | null) => {
    setPicks((prev) => {
      const next = new Map(prev);
      const k = `${chain_id}:${idx}`;
      if (canonical_id == null) next.delete(k);
      else next.set(k, canonical_id);
      return next;
    });
  }, []);

  const resolvePick = useCallback((chain_id: number, idx: number, opts: ChainOption[]): ChainOption | null => {
    if (opts.length === 0) return null;
    const pickedId = picks.get(`${chain_id}:${idx}`);
    if (pickedId != null) {
      const f = opts.find((o) => o.canonical_id === pickedId);
      if (f) return f;
    }
    return opts[0];
  }, [picks]);

  const chainSummaries: ChainSummary[] = useMemo(() => {
    return chains.map((chain) => {
      let total = 0;
      let comparable = 0;
      let coveredCount = 0;
      const skippedItems: Array<{ item: ApiItem; idx: number }> = [];
      for (const { item, idx } of items) {
        const opts = chain.options_by_line.get(idx) ?? [];
        if (opts.length === 0) {
          skippedItems.push({ item, idx });
          continue;
        }
        const pick = resolvePick(chain.chain_id, idx, opts);
        if (!pick) continue;
        const t = effectiveTotal(pick, false);
        if (t == null) continue;
        total += t;
        comparable += item.member_price;
        coveredCount += 1;
      }
      return {
        chain, total, comparable,
        savings: comparable - total,
        coveredCount,
        totalEligible: items.length,
        skippedItems,
      };
    });
  }, [chains, items, resolvePick]);

  const userTotal = items.reduce((s, { item }) => s + item.member_price, 0);

  // Width of the ledger paper grows with the chain count.
  // Anchor column ~190px + 170px per chain + 56px paper padding.
  const ledgerWidth = 190 + chains.length * 170 + 56;

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          Comparison ledger
        </div>
      </div>

      <div style={{ padding: '36px 20px 60px', overflowX: 'auto' }}>
        <div style={{
          width: ledgerWidth,
          maxWidth: '100%',
          margin: '0 auto',
          minWidth: 720,
        }}>
          {/* The paper ledger card */}
          <div style={{
            background: V3.paper,
            color: V3.paperInk,
            padding: '32px 28px 26px',
            borderRadius: 4,
            boxShadow: '0 24px 60px -16px rgba(0,0,0,0.55), 0 8px 22px rgba(0,0,0,0.28)',
            position: 'relative',
          }}>
            <div aria-hidden style={{
              position: 'absolute',
              top: -6,
              left: 0,
              right: 0,
              height: 8,
              background: V3.paper,
              clipPath: 'polygon(0 100%, 4% 30%, 8% 100%, 12% 30%, 16% 100%, 20% 30%, 24% 100%, 28% 30%, 32% 100%, 36% 30%, 40% 100%, 44% 30%, 48% 100%, 52% 30%, 56% 100%, 60% 30%, 64% 100%, 68% 30%, 72% 100%, 76% 30%, 80% 100%, 84% 30%, 88% 100%, 92% 30%, 96% 100%, 100% 30%, 100% 100%)',
            }} />

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 6 }}>
              <div className="v3-mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', color: V3.edited, marginBottom: 6 }}>
                ✱ ALT-TRIP COMPARISON LEDGER ✱
              </div>
              <div className="v3-mono" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.14em' }}>
                {(compareResp.receipt.store_name ?? 'RECEIPT').toUpperCase()}
              </div>
              {compareResp.receipt.store_address && (
                <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 4 }}>
                  {compareResp.receipt.store_address}
                </div>
              )}
              {compareResp.receipt.receipt_date && (
                <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 2 }}>
                  {compareResp.receipt.receipt_date}
                </div>
              )}
            </div>

            <PaperDivider />

            {/* Badge legend */}
            <BadgeLegendPaper />

            <PaperDivider />

            {/* The grid */}
            <Grid chainCount={chains.length}>
              {/* Chain header row */}
              <GridHeaderCell title="YOUR PURCHASE" subtitle={`@ ${compareResp.receipt.store_name ?? 'STORE'}`} tint="actual" />
              {chains.map((c) => (
                <GridHeaderCell
                  key={c.chain_id}
                  title={c.chain_name.toUpperCase()}
                  subtitle={`${c.distance_miles.toFixed(1)} MI · ALTERNATE TRIP`}
                  tint="alt"
                />
              ))}

              {/* Item rows + expansion sub-rows */}
              {items.map(({ item, idx }) => {
                const isRowExpanded = expanded?.idx === idx;
                return (
                  <Fragment key={idx}>
                    {/* Anchor cell — the user's purchase */}
                    <UserAnchorCell item={item} highlighted={isRowExpanded} />

                    {/* Per-chain cells */}
                    {chains.map((chain) => {
                      const opts = chain.options_by_line.get(idx) ?? [];
                      const pick = resolvePick(chain.chain_id, idx, opts);
                      const isCellExpanded = expanded?.chain_id === chain.chain_id && expanded?.idx === idx;
                      const otherCount = Math.max(0, opts.length - 1);
                      const isManualPick = picks.has(`${chain.chain_id}:${idx}`);

                      return (
                        <ChainCell
                          key={chain.chain_id}
                          pick={pick}
                          userPaid={item.member_price}
                          otherCount={otherCount}
                          isExpanded={isCellExpanded}
                          isManualPick={isManualPick}
                          rowHighlighted={isRowExpanded}
                          onClick={() => {
                            if (isCellExpanded) {
                              setExpanded(null);
                            } else {
                              setExpanded({ chain_id: chain.chain_id, idx });
                              setSearchQ('');
                            }
                          }}
                        />
                      );
                    })}

                    {/* Sub-row when this row has an expanded cell — spans grid */}
                    {isRowExpanded && expanded && (
                      <ExpansionSubRow
                        chainCount={chains.length}
                        chains={chains}
                        item={item}
                        idx={idx}
                        expandedChainId={expanded.chain_id}
                        pickedCanonicalId={picks.get(`${expanded.chain_id}:${idx}`) ?? null}
                        onPick={(cid) => setPick(expanded.chain_id, idx, cid)}
                        onResetAuto={() => setPick(expanded.chain_id, idx, null)}
                        onClose={() => setExpanded(null)}
                        searchQ={searchQ}
                        setSearchQ={setSearchQ}
                      />
                    )}
                  </Fragment>
                );
              })}
            </Grid>

            <PaperDivider />

            {/* Totals row */}
            <Grid chainCount={chains.length}>
              <UserTotalCell total={userTotal} />
              {chainSummaries.map((s) => (
                <ChainTotalCell key={s.chain.chain_id} summary={s} />
              ))}
            </Grid>

            <PaperDivider />

            {/* Per-chain comparison stamps */}
            <Grid chainCount={chains.length}>
              <div style={{ padding: '12px 8px' }} className="v3-mono">
                <div style={{ fontSize: 9, color: V3.paperMute, fontWeight: 700, letterSpacing: '0.12em' }}>
                  YOU PAID
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(userTotal)}
                </div>
              </div>
              {chainSummaries.map((s) => (
                <StampCell key={s.chain.chain_id} summary={s} />
              ))}
            </Grid>

            {/* Skipped per chain (footer) */}
            {chainSummaries.some((s) => s.skippedItems.length > 0) && (
              <>
                <PaperDivider />
                <SkippedFooter chainSummaries={chainSummaries} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Layout primitives ───────────────────────────────────────────────────────

function Grid({ chainCount, children }: { chainCount: number; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `minmax(180px, 1.4fr) repeat(${chainCount}, minmax(160px, 1fr))`,
      gap: 0,
      borderTop: `1px dashed ${V3.paperLine}`,
      borderLeft: `1px dashed ${V3.paperLine}`,
    }}>
      {children}
    </div>
  );
}

function PaperDivider() {
  return (
    <div className="v3-mono" style={{ textAlign: 'center', fontSize: 10, color: V3.paperFaint, padding: '8px 0', letterSpacing: '0.08em' }}>
      — — — — — — — — — — — — — — — — — — — — — — —
    </div>
  );
}

function BadgeLegendPaper() {
  const kinds: Array<keyof typeof CHANGE_COLORS> = [
    'same_brand', 'store_brand', 'different_brand', 'organic',
    'larger_pack', 'smaller_pack', 'different_form', 'fresh_diff',
  ];
  return (
    <div className="v3-mono" style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '4px 0',
    }}>
      <span style={{ fontSize: 9, color: V3.paperMute, fontWeight: 700, letterSpacing: '0.08em', marginRight: 4 }}>
        WHAT CHANGES:
      </span>
      {kinds.map((k) => (
        <span key={k} style={{
          fontSize: 8.5,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '2px 6px',
          borderRadius: 2,
          color: CHANGE_COLORS[k].fg,
          background: CHANGE_COLORS[k].bg,
        }}>
          {CHANGE_LABELS[k]}
        </span>
      ))}
      <span style={{ fontSize: 9, color: V3.paperMute, marginLeft: 6 }}>
        · CLICK ANY CELL TO PICK A DIFFERENT SUBSTITUTE
      </span>
    </div>
  );
}

// ── Header cells ────────────────────────────────────────────────────────────

function GridHeaderCell({ title, subtitle, tint }: { title: string; subtitle: string; tint: 'actual' | 'alt' }) {
  return (
    <div style={{
      padding: '12px 10px',
      borderRight: `1px dashed ${V3.paperLine}`,
      borderBottom: `1px solid ${V3.paperLine}`,
      background: tint === 'actual' ? V3.paperShade : V3.paper,
    }} className="v3-mono">
      <div style={{
        fontSize: 8.5,
        color: tint === 'actual' ? V3.paperMid : V3.edited,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textAlign: 'center',
      }}>
        {tint === 'actual' ? '✱ ACTUAL ✱' : '✱ ALT TRIP ✱'}
      </div>
      <div style={{
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: '0.1em',
        color: V3.paperInk,
        textAlign: 'center',
        marginTop: 4,
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 8.5,
        color: V3.paperMute,
        textAlign: 'center',
        marginTop: 2,
        letterSpacing: '0.06em',
      }}>
        {subtitle}
      </div>
    </div>
  );
}

// ── Anchor cell (user's purchase) ───────────────────────────────────────────

function UserAnchorCell({ item, highlighted }: { item: ApiItem; highlighted: boolean }) {
  const itemName = (item.match?.brand
    ? `${item.match.brand} ${item.match.name ?? item.description}`
    : (item.match?.name ?? item.description)).toUpperCase();
  const sizeTxt = item.match?.package_size && item.match?.package_unit
    ? `${item.match.package_size} ${item.match.package_unit}`
    : item.quantity != null && item.unit && item.unit !== 'each'
      ? `${item.quantity} ${item.unit}`
      : '';
  const userPerUnit = item.unit_price && item.unit && item.unit !== 'each'
    ? `${fmt(item.unit_price)}/${item.unit}`
    : null;

  return (
    <div style={{
      padding: '10px 10px',
      borderRight: `1px dashed ${V3.paperLine}`,
      borderBottom: `1px dashed ${V3.paperLine}`,
      background: highlighted ? V3.paperShade : V3.paperShade,
    }} className="v3-mono">
      <div style={{ fontSize: 11, fontWeight: 700, color: V3.paperInk, lineHeight: 1.3, marginBottom: 4 }}>
        {itemName}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: V3.paperMute }}>
          {sizeTxt}
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(item.member_price)}
        </span>
      </div>
      {userPerUnit && (
        <div style={{ fontSize: 9, color: V3.paperMute }}>
          {userPerUnit}
        </div>
      )}
      {!item.match && (
        <div style={{ fontSize: 9, color: V3.edited, fontStyle: 'italic', marginTop: 2 }}>
          ? unmatched
        </div>
      )}
    </div>
  );
}

// ── Chain cell (one item × one chain) ───────────────────────────────────────

function ChainCell({ pick, userPaid, otherCount, isExpanded, isManualPick, rowHighlighted, onClick }: {
  pick: ChainOption | null;
  userPaid: number;
  otherCount: number;
  isExpanded: boolean;
  isManualPick: boolean;
  rowHighlighted: boolean;
  onClick: () => void;
}) {
  // Not stocked
  if (!pick) {
    return (
      <button
        onClick={onClick}
        disabled
        style={{
          padding: '10px 10px',
          borderRight: `1px dashed ${V3.paperLine}`,
          borderBottom: `1px dashed ${V3.paperLine}`,
          background: V3.noneBg,
          opacity: 0.7,
          cursor: 'default',
          border: 'none',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
        className="v3-mono"
      >
        <div style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.12em',
          color: V3.paperMute,
          textTransform: 'uppercase',
        }}>
          NOT STOCKED
        </div>
        <div style={{
          fontSize: 9,
          color: V3.paperFaint,
          marginTop: 4,
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}>
          (you'd skip this here)
        </div>
      </button>
    );
  }

  const total = effectiveTotal(pick, false) ?? pick.shelf;
  const savings = userPaid - total;
  const cheaper = savings > 0.05;
  const more = savings < -0.05;
  const change = classifyChange(pick.equiv_note, pick.match_type === 'exact');
  const badgeColor = CHANGE_COLORS[change];
  const badgeLabel = CHANGE_LABELS[change];

  const unitTxt = pick.price_unit && pick.price_unit.startsWith('per_') && pick.price_unit !== 'per_each'
    ? `${fmt(pick.shelf)}/${pick.price_unit.replace('per_', '')}`
    : pick.pack_size && pick.pack_unit && pick.pack_unit !== 'each' && pick.pack_unit !== 'count'
      ? `${pick.pack_size} ${pick.pack_unit}`
      : null;

  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 10px',
        borderRight: `1px dashed ${V3.paperLine}`,
        borderBottom: `1px dashed ${V3.paperLine}`,
        background: isExpanded ? V3.paperShade : (rowHighlighted ? V3.paperShade : 'transparent'),
        cursor: 'pointer',
        border: 'none',
        fontFamily: 'inherit',
        textAlign: 'left',
        position: 'relative',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        if (!isExpanded) e.currentTarget.style.background = V3.paperShade;
      }}
      onMouseLeave={(e) => {
        if (!isExpanded) e.currentTarget.style.background = rowHighlighted ? V3.paperShade : 'transparent';
      }}
      className="v3-mono"
    >
      {/* Manual-pick indicator */}
      {isManualPick && (
        <div style={{
          position: 'absolute',
          top: 4,
          right: 6,
          fontSize: 7,
          fontWeight: 800,
          letterSpacing: '0.08em',
          color: V3.edited,
        }}>
          ✏ MANUAL
        </div>
      )}

      {/* Badge */}
      <div style={{ marginBottom: 4 }}>
        <span style={{
          fontSize: 8.5,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '2px 6px',
          borderRadius: 2,
          color: badgeColor.fg,
          background: badgeColor.bg,
        }}>
          {badgeLabel}
        </span>
      </div>

      {/* Substitute name */}
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: V3.paperInk,
        lineHeight: 1.25,
        marginBottom: 4,
        // Truncate to 2 lines
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {pick.display_name}
      </div>

      {/* Price + savings */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: cheaper ? V3.saveInk : more ? V3.overInk : V3.paperInk, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(total)}
        </span>
        {Math.abs(savings) > 0.05 && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            color: cheaper ? V3.saveInk : V3.overInk,
            letterSpacing: '0.04em',
          }}>
            {cheaper ? '↓' : '↑'}{((Math.abs(savings) / userPaid) * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* Per-unit / pack info */}
      {unitTxt && (
        <div style={{ fontSize: 8.5, color: V3.paperMute, marginTop: 2 }}>
          {unitTxt}
        </div>
      )}

      {/* Other-on-shelf hint */}
      {otherCount > 0 && (
        <div style={{
          fontSize: 8.5,
          color: V3.edited,
          fontWeight: 700,
          letterSpacing: '0.04em',
          marginTop: 4,
        }}>
          {isExpanded ? '▾ HIDE OTHER OPTIONS' : `▸ +${otherCount} OTHER ON SHELF`}
        </div>
      )}
    </button>
  );
}

// ── Expansion sub-row (spans full grid width) ───────────────────────────────

function ExpansionSubRow({ chainCount, chains, item, idx, expandedChainId, pickedCanonicalId, onPick, onResetAuto, onClose, searchQ, setSearchQ }: {
  chainCount: number;
  chains: ChainProjection[];
  item: ApiItem;
  idx: number;
  expandedChainId: number;
  pickedCanonicalId: number | null;
  onPick: (canonical_id: number) => void;
  onResetAuto: () => void;
  onClose: () => void;
  searchQ: string;
  setSearchQ: (q: string) => void;
}) {
  const chain = chains.find((c) => c.chain_id === expandedChainId);
  if (!chain) return null;
  const opts = chain.options_by_line.get(idx) ?? [];
  const autoCheapestId = opts[0]?.canonical_id ?? null;
  const isManualPick = pickedCanonicalId != null && pickedCanonicalId !== autoCheapestId;

  // Filter by search.
  const lower = searchQ.trim().toLowerCase();
  const filtered = lower
    ? opts.filter((o) =>
        o.display_name.toLowerCase().includes(lower) ||
        (o.equiv_note ?? '').toLowerCase().includes(lower))
    : opts;

  const itemName = (item.match?.name ?? item.description).toUpperCase();

  return (
    <div style={{
      gridColumn: `1 / span ${chainCount + 1}`,
      borderRight: `1px dashed ${V3.paperLine}`,
      borderBottom: `1px solid ${V3.paperLine}`,
      background: V3.paperShade,
      padding: '14px 16px',
    }} className="v3-mono">
      {/* Header with item + chain context */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: V3.paperMid }}>
          OTHER OPTIONS · {itemName} · ON {chain.chain_name.toUpperCase()}'S SHELF
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: V3.paperMute,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.08em',
          }}
        >
          ✕ CLOSE
        </button>
      </div>

      {/* Search input */}
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: V3.paperMute }}>🔎</span>
        <input
          type="text"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder={`Search ${chain.chain_name}'s shelf for this category…`}
          style={{
            flex: 1,
            background: V3.paper,
            border: `1px dashed ${V3.paperLine}`,
            borderRadius: 3,
            padding: '6px 10px',
            fontSize: 11,
            fontFamily: 'inherit',
            color: V3.paperInk,
            outline: 'none',
            letterSpacing: '0.04em',
          }}
        />
        {isManualPick && (
          <button
            onClick={onResetAuto}
            style={{
              background: V3.paper,
              border: `1px dashed ${V3.paperLine}`,
              borderRadius: 3,
              padding: '6px 10px',
              fontSize: 9,
              fontFamily: 'inherit',
              color: V3.paperMid,
              fontWeight: 700,
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            ↺ RESET TO CHEAPEST
          </button>
        )}
      </div>

      {/* Options list — radio rows */}
      {filtered.length === 0 ? (
        <div style={{ fontSize: 11, color: V3.paperMute, fontStyle: 'italic', padding: '12px 4px' }}>
          No matches on {chain.chain_name}'s shelf for "{searchQ}".
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map((opt) => {
            const total = effectiveTotal(opt, false) ?? opt.shelf;
            const savings = item.member_price - total;
            const cheaper = savings > 0.05;
            const more = savings < -0.05;
            const change = classifyChange(opt.equiv_note, opt.match_type === 'exact');
            const badgeColor = CHANGE_COLORS[change];
            const badgeLabel = CHANGE_LABELS[change];
            const isCurrentPick = pickedCanonicalId != null
              ? opt.canonical_id === pickedCanonicalId
              : opt.canonical_id === autoCheapestId;
            const isAuto = opt.canonical_id === autoCheapestId;

            return (
              <button
                key={opt.canonical_id}
                onClick={() => onPick(opt.canonical_id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 4,
                  background: isCurrentPick ? V3.paper : 'transparent',
                  border: `1px solid ${isCurrentPick ? V3.saveOutline : V3.paperLine}`,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  color: V3.paperInk,
                  transition: 'background 0.1s, border-color 0.1s',
                }}
                onMouseEnter={(e) => { if (!isCurrentPick) e.currentTarget.style.background = V3.paper; }}
                onMouseLeave={(e) => { if (!isCurrentPick) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Radio */}
                <div style={{
                  width: 14, height: 14, borderRadius: 999,
                  border: `2px solid ${isCurrentPick ? V3.saveInk : V3.paperLine}`,
                  background: isCurrentPick ? V3.saveInk : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {isCurrentPick && <div style={{ width: 5, height: 5, borderRadius: 999, background: V3.paper }} />}
                </div>

                {/* Name + badge */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{
                      fontSize: 8.5,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      padding: '1px 5px',
                      borderRadius: 2,
                      color: badgeColor.fg,
                      background: badgeColor.bg,
                    }}>
                      {badgeLabel}
                    </span>
                    {isAuto && (
                      <span style={{ fontSize: 8, color: V3.paperMute, fontWeight: 700, letterSpacing: '0.06em' }}>
                        AUTO-PICK · CHEAPEST
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: V3.paperInk, lineHeight: 1.3 }}>
                    {opt.display_name}
                  </div>
                  {opt.equiv_note && (
                    <div style={{ fontSize: 9, color: V3.paperMute, marginTop: 1, fontStyle: 'italic' }}>
                      {opt.equiv_note}
                    </div>
                  )}
                </div>

                {/* Price */}
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: cheaper ? V3.saveInk : more ? V3.overInk : V3.paperInk }}>
                    {fmt(total)}
                  </div>
                </div>

                {/* % savings */}
                <div style={{ minWidth: 36, textAlign: 'right', flexShrink: 0 }}>
                  {Math.abs(savings) > 0.05 && (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: cheaper ? V3.saveInk : V3.overInk,
                      letterSpacing: '0.04em',
                    }}>
                      {cheaper ? '↓' : '↑'}{((Math.abs(savings) / item.member_price) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Totals row cells ────────────────────────────────────────────────────────

function UserTotalCell({ total }: { total: number }) {
  return (
    <div style={{
      padding: '10px 10px',
      borderRight: `1px dashed ${V3.paperLine}`,
      borderBottom: `1px dashed ${V3.paperLine}`,
      background: V3.paperShade,
    }} className="v3-mono">
      <div style={{ fontSize: 9, color: V3.paperMid, fontWeight: 800, letterSpacing: '0.12em' }}>
        TOTAL
      </div>
      <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {fmt(total)}
      </div>
    </div>
  );
}

function ChainTotalCell({ summary }: { summary: ChainSummary }) {
  const cheaper = summary.savings > 0.05;
  const more = summary.savings < -0.05;
  return (
    <div style={{
      padding: '10px 10px',
      borderRight: `1px dashed ${V3.paperLine}`,
      borderBottom: `1px dashed ${V3.paperLine}`,
      background: V3.paper,
    }} className="v3-mono">
      <div style={{ fontSize: 9, color: V3.paperMid, fontWeight: 800, letterSpacing: '0.12em' }}>
        TOTAL · {summary.coveredCount}/{summary.totalEligible} ITEMS
      </div>
      <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2, color: cheaper ? V3.saveInk : more ? V3.overInk : V3.paperInk, fontVariantNumeric: 'tabular-nums' }}>
        {fmt(summary.total)}
      </div>
    </div>
  );
}

function StampCell({ summary }: { summary: ChainSummary }) {
  const cheaper = summary.savings > 0.05;
  const more = summary.savings < -0.05;
  const stampInk = cheaper ? V3.saveInk : more ? V3.overInk : V3.paperMid;
  const stampBg = cheaper ? V3.savePaper : more ? V3.overPaper : V3.noneBg;
  const stampBorder = cheaper ? V3.saveOutline : more ? V3.overOutline : V3.paperLine;
  const label = cheaper ? "YOU'D SAVE" : more ? "YOU'D PAY MORE" : 'SAME PRICE';
  const value = `${cheaper ? '↓' : more ? '↑' : ''} ${fmtAbs(summary.savings)}`.trim();
  const pct = summary.comparable > 0 ? Math.abs((summary.savings / summary.comparable) * 100) : 0;

  return (
    <div style={{
      padding: '10px 8px',
      borderRight: `1px dashed ${V3.paperLine}`,
      borderBottom: `1px dashed ${V3.paperLine}`,
    }}>
      <div style={{
        padding: '8px 10px',
        background: stampBg,
        border: `1px solid ${stampBorder}`,
        borderRadius: 3,
        textAlign: 'center',
      }} className="v3-mono">
        <div style={{ fontSize: 8, color: stampInk, fontWeight: 700, letterSpacing: '0.12em' }}>
          {label}
        </div>
        <div style={{ fontSize: 16, color: stampInk, fontWeight: 900, marginTop: 2, letterSpacing: '-0.01em' }}>
          {value}
        </div>
        {(cheaper || more) && (
          <div style={{ fontSize: 8, color: stampInk, fontWeight: 700, marginTop: 1, opacity: 0.85, letterSpacing: '0.08em' }}>
            {pct.toFixed(0)}% {cheaper ? 'OFF' : 'MORE'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skipped items footer ────────────────────────────────────────────────────

function SkippedFooter({ chainSummaries }: { chainSummaries: ChainSummary[] }) {
  return (
    <div className="v3-mono" style={{ marginTop: 8, fontSize: 10, color: V3.paperMute }}>
      <div style={{ fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6, color: V3.paperMid }}>
        Items some stores don't stock:
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${chainSummaries.length}, 1fr)`, gap: 12 }}>
        {chainSummaries.map((s) => (
          <div key={s.chain.chain_id}>
            <div style={{ fontSize: 9, fontWeight: 700, color: V3.paperMid, letterSpacing: '0.06em' }}>
              {s.chain.chain_name.toUpperCase()}
            </div>
            {s.skippedItems.length === 0 ? (
              <div style={{ fontSize: 9, color: V3.paperFaint, fontStyle: 'italic', marginTop: 2 }}>
                — stocks everything
              </div>
            ) : (
              s.skippedItems.map((sk) => (
                <div key={sk.idx} style={{ fontSize: 9, color: V3.paperMute, marginTop: 2, fontStyle: 'italic' }}>
                  · {(sk.item.match?.name ?? sk.item.description).toLowerCase()}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const topBtn: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${V3.border}`,
  color: V3.inkMid,
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
