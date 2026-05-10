'use client';

/**
 * Alt H — Parallel-Reality Receipts.
 *
 * Design thesis: The strongest emotional argument is "this could have been
 * your receipt." Render each alternative chain as a full, self-contained
 * receipt — chain-specific header, substitute products as line items,
 * subtotal/tax/total, comparison stamp. Not a comparison column; a fictional
 * artifact from an alternate trip you didn't take.
 *
 * Each line shows the cheapest substitute as a primary receipt line; tapping
 * the line expands additional options on that chain's shelf as indented
 * sub-lines so the user can see the full set of choices without leaving the
 * receipt format. A page-level legend keeps the change badges legible.
 *
 * Pricing is enriched: total + per-unit + percent off + change badge per
 * line. "Not stocked" items live in a footer ("Items you'd skip here") so
 * the receipt itself stays clean while the gap is honest.
 */

import { useMemo, useState, useCallback } from 'react';
import { V3, fmt, fmtAbs } from '../theme';
import { projectByChain, effectiveTotal, type ChainOption, type ChainProjection } from '../projection';
import { classifyChange, CHANGE_LABELS, CHANGE_COLORS } from '@/app/v3/compare-alt/mock-data';
import type { CompareResponse, MatchResponse, ApiItem } from '@/lib/api/compare';

interface Props {
  matchResult: MatchResponse;
  compareResp: CompareResponse;
  onBack: () => void;
}

interface AltLine {
  item: ApiItem;
  idx: number;
  primary: ChainOption | null;       // cheapest stocked substitute, or null = not stocked
  others: ChainOption[];              // remaining options on the shelf
}

interface AltBasket {
  chain: ChainProjection;
  lines: AltLine[];
  total: number;                       // sum of cheapest-substitute totals
  comparable: number;                  // user's spend on items the chain DOES stock
  itemCount: number;
  skippedCount: number;
}

function buildAltBasket(chain: ChainProjection, items: Array<{ item: ApiItem; idx: number }>): AltBasket {
  const lines: AltLine[] = items.map(({ item, idx }) => {
    const opts = chain.options_by_line.get(idx) ?? [];
    return {
      item, idx,
      primary: opts[0] ?? null,
      others: opts.slice(1),
    };
  });
  let total = 0;
  let comparable = 0;
  let itemCount = 0;
  let skippedCount = 0;
  for (const l of lines) {
    if (!l.primary) {
      skippedCount += 1;
      continue;
    }
    const t = effectiveTotal(l.primary, false);
    if (t == null) continue;
    total += t;
    comparable += l.item.member_price;
    itemCount += 1;
  }
  return { chain, lines, total, comparable, itemCount, skippedCount };
}

export default function CompareAltH({ matchResult, compareResp, onBack }: Props) {
  const chains = useMemo(() => projectByChain(compareResp), [compareResp]);
  const items = useMemo(
    () => compareResp.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.item_type !== 'skip'),
    [compareResp.items],
  );

  const baskets = useMemo(() => chains.map((c) => buildAltBasket(c, items)), [chains, items]);
  const userTotal = items.reduce((s, { item }) => s + item.member_price, 0);

  // Per-line expansion state — keyed by `${chain_id}:${idx}`. When set, the
  // alt receipt line shows its other-shelf-options as indented sub-lines.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((chain_id: number, idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const k = `${chain_id}:${idx}`;
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: V3.page, color: V3.ink, fontFamily: 'var(--font-dm-sans), -apple-system, system-ui, sans-serif' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${V3.border}` }}>
        <button onClick={onBack} style={topBtn}>← Home</button>
        <div style={{ fontSize: 12, color: V3.inkLight }}>
          Parallel-reality receipts
        </div>
      </div>

      <div style={{ padding: '24px 20px 60px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto 20px' }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: V3.ink }}>
            What your trip would've looked like elsewhere
          </h1>
          <p style={{ fontSize: 14, color: V3.inkMid, margin: '6px 0 0', lineHeight: 1.55, maxWidth: 720 }}>
            Each receipt is a fictional alternate trip — what you'd actually have walked out with from that store.
            The brand on the line is the brand on the shelf. A badge shows what changed. Tap any line to see the
            other options that store stocks for that item. Items the store doesn't carry land in a footer instead
            of being silently swapped.
          </p>
        </div>

        {/* Page-level badge legend */}
        <BadgeLegend />

        <div style={{
          display: 'flex',
          gap: 18,
          padding: '0 20px',
          margin: '0 -20px',
          overflowX: 'auto',
          paddingBottom: 8,
          paddingTop: 16,
          alignItems: 'flex-start',
        }}>
          {/* User's actual receipt */}
          <ActualReceipt
            store={compareResp.receipt.store_name ?? 'Your store'}
            address={compareResp.receipt.store_address ?? ''}
            date={compareResp.receipt.receipt_date ?? ''}
            items={items}
            total={userTotal}
          />

          {/* Alt baskets */}
          {baskets.map((basket) => (
            <AltReceipt
              key={basket.chain.chain_id}
              basket={basket}
              expanded={expanded}
              onToggle={toggleExpanded}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Badge legend (same vocabulary as Alt F) ────────────────────────────────

function BadgeLegend() {
  const kinds: Array<keyof typeof CHANGE_COLORS> = [
    'same_brand', 'store_brand', 'different_brand', 'organic',
    'larger_pack', 'smaller_pack', 'different_form', 'fresh_diff',
  ];
  return (
    <div style={{
      maxWidth: 1100,
      margin: '0 auto',
      padding: '12px 16px',
      background: V3.pageAlt,
      border: `1px solid ${V3.border}`,
      borderRadius: 10,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'center',
    }}>
      <span style={{ fontSize: 11, color: V3.inkLight, fontWeight: 600, letterSpacing: '0.04em', marginRight: 4 }}>
        WHAT CHANGES:
      </span>
      {kinds.map((k) => (
        <span key={k} style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '2px 8px',
          borderRadius: 4,
          color: CHANGE_COLORS[k].fg,
          background: CHANGE_COLORS[k].bg,
        }}>
          {CHANGE_LABELS[k]}
        </span>
      ))}
      <span style={{ fontSize: 11, color: V3.inkLight, marginLeft: 8 }}>
        · tap any line to see other shelf options
      </span>
    </div>
  );
}

// ── User's actual receipt ─────────────────────────────────────────────────

function ActualReceipt({ store, address, date, items, total }: {
  store: string;
  address: string;
  date: string;
  items: Array<{ item: ApiItem; idx: number }>;
  total: number;
}) {
  return (
    <ReceiptCard tint="actual">
      <ReceiptHeader
        title={store}
        subtitle={address}
        date={date}
        kicker="YOUR ACTUAL TRIP"
        kickerColor={V3.paperMid}
      />
      <Divider />
      <div>
        {items.map(({ item, idx }) => (
          <ActualLine key={idx} item={item} />
        ))}
      </div>
      <Divider />
      <ReceiptFooter
        itemCount={items.length}
        total={total}
        stampLabel="YOU PAID"
        stampValue={fmt(total)}
        stampColor={V3.paperInk}
        stampBg={V3.noneBg}
        stampBorder={V3.paperLine}
      />
    </ReceiptCard>
  );
}

function ActualLine({ item }: { item: ApiItem }) {
  const name = item.match?.brand
    ? `${item.match.brand.toUpperCase()} ${(item.match?.name ?? item.description).toUpperCase()}`
    : (item.match?.name ?? item.description).toUpperCase();
  const perUnitTxt = item.unit_price && item.unit && item.unit !== 'each' && item.quantity
    ? `${item.quantity} ${item.unit} @ ${fmt(item.unit_price)}/${item.unit}`
    : item.match?.package_size && item.match.package_unit
      ? `${item.match.package_size} ${item.match.package_unit}`
      : '';

  return (
    <div style={{ padding: '5px 0' }}>
      <div className="v3-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, lineHeight: 1.3 }}>
        <span style={{
          flex: 1,
          marginRight: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: V3.paperInk,
        }}>
          {name}
        </span>
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: V3.paperInk }}>
          {fmt(item.member_price)}
        </span>
      </div>
      {perUnitTxt && (
        <div className="v3-mono" style={{ fontSize: 9, color: V3.paperMute, paddingLeft: 2, marginTop: 1 }}>
          {perUnitTxt}
        </div>
      )}
    </div>
  );
}

// ── Alternate-reality receipt ──────────────────────────────────────────────

function AltReceipt({ basket, expanded, onToggle }: {
  basket: AltBasket;
  expanded: Set<string>;
  onToggle: (chain_id: number, idx: number) => void;
}) {
  const savings = basket.comparable - basket.total;
  const cheaper = savings > 0.05;
  const more = savings < -0.05;
  const stampColor = cheaper ? V3.saveInk : more ? V3.overInk : V3.paperMid;
  const stampBg = cheaper ? V3.savePaper : more ? V3.overPaper : V3.noneBg;
  const stampBorder = cheaper ? V3.saveOutline : more ? V3.overOutline : V3.paperLine;
  const stampLabel = cheaper ? 'SAVED' : more ? 'YOU\'D HAVE PAID MORE' : 'SAME PRICE';
  const stampValue = `${cheaper ? '↓' : more ? '↑' : ''} ${fmtAbs(savings)}`.trim();

  return (
    <ReceiptCard tint="alt">
      <ReceiptHeader
        title={basket.chain.chain_name}
        subtitle={`${basket.chain.distance_miles.toFixed(1)} mi away`}
        date="If you'd gone here · Apr 26, 2026"
        kicker="ALTERNATE TRIP"
        kickerColor={V3.edited}
      />
      <Divider />
      {/* Line items */}
      <div>
        {basket.lines.filter((l) => l.primary).map((l) => (
          <AltLine
            key={l.idx}
            line={l}
            userPaid={l.item.member_price}
            isExpanded={expanded.has(`${basket.chain.chain_id}:${l.idx}`)}
            onToggle={() => onToggle(basket.chain.chain_id, l.idx)}
          />
        ))}
      </div>

      {/* Skipped items footer */}
      {basket.skippedCount > 0 && (
        <>
          <Divider />
          <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, paddingLeft: 2 }}>
            <div style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              {basket.skippedCount} item{basket.skippedCount > 1 ? 's' : ''} you'd skip here:
            </div>
            {basket.lines.filter((l) => !l.primary && l.item.match).map((l) => (
              <div key={l.idx} style={{ paddingLeft: 4, fontStyle: 'italic', textTransform: 'uppercase' }}>
                — {(l.item.match?.name ?? l.item.description).toUpperCase()}
              </div>
            ))}
            {basket.lines.filter((l) => !l.primary && !l.item.match).length > 0 && (
              <div style={{ paddingLeft: 4, fontStyle: 'italic', textTransform: 'uppercase' }}>
                — UNMATCHED ITEMS
              </div>
            )}
          </div>
        </>
      )}

      <Divider />

      {/* Receipt totals (no payment/transaction theater) */}
      <div className="v3-mono" style={{ fontSize: 11, color: V3.paperInk }}>
        <ReceiptStatLine label="ITEMS" value={`${basket.itemCount}`} />
        <ReceiptStatLine label="SUBTOTAL" value={fmt(basket.total)} />
        <ReceiptStatLine label="TAX" value="$0.00" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, padding: '4px 0', borderTop: `1px dashed ${V3.paperLine}` }}>
          <span style={{ fontWeight: 800, letterSpacing: '0.06em' }}>TOTAL</span>
          <span style={{ fontWeight: 800, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmt(basket.total)}</span>
        </div>
      </div>

      {/* Comparison stamp */}
      <div style={{
        marginTop: 14,
        padding: '14px 14px',
        background: stampBg,
        border: `1px solid ${stampBorder}`,
        borderRadius: 4,
        textAlign: 'center',
      }}>
        <div className="v3-mono" style={{ fontSize: 9, color: stampColor, fontWeight: 700, letterSpacing: '0.12em' }}>
          VS YOUR ACTUAL TRIP
        </div>
        <div className="v3-mono" style={{ fontSize: 22, color: stampColor, fontWeight: 900, marginTop: 2, letterSpacing: '-0.01em' }}>
          {stampValue}
        </div>
        <div className="v3-mono" style={{ fontSize: 9, color: stampColor, fontWeight: 700, letterSpacing: '0.08em', marginTop: 2, opacity: 0.85 }}>
          {stampLabel}
          {basket.comparable > 0 && cheaper && ` · ${((savings / basket.comparable) * 100).toFixed(0)}% OFF`}
        </div>
      </div>
    </ReceiptCard>
  );
}

function AltLine({ line, userPaid, isExpanded, onToggle }: {
  line: AltLine;
  userPaid: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  if (!line.primary) return null;
  const opt = line.primary;
  const hasOthers = line.others.length > 0;

  return (
    <div style={{ padding: '5px 0' }}>
      {/* Primary substitute line — clickable */}
      <button
        onClick={onToggle}
        disabled={!hasOthers}
        style={{
          background: isExpanded ? V3.paperShade : 'transparent',
          border: 'none',
          width: '100%',
          padding: '2px 0',
          margin: 0,
          cursor: hasOthers ? 'pointer' : 'default',
          fontFamily: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          borderRadius: 2,
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => {
          if (hasOthers && !isExpanded) e.currentTarget.style.background = V3.paperShade;
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        <ShelfOptionLine opt={opt} userPaid={userPaid} primary altCount={line.others.length} isExpanded={isExpanded} />
      </button>

      {/* Other shelf options for this item at this chain */}
      {isExpanded && hasOthers && (
        <div style={{
          marginTop: 4,
          marginLeft: 10,
          paddingLeft: 10,
          borderLeft: `2px solid ${V3.paperLine}`,
        }}>
          <div className="v3-mono" style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: V3.paperMute,
            textTransform: 'uppercase',
            marginBottom: 3,
          }}>
            ALSO ON THE SHELF:
          </div>
          {line.others.map((other) => (
            <ShelfOptionLine
              key={other.canonical_id}
              opt={other}
              userPaid={userPaid}
              primary={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShelfOptionLine({ opt, userPaid, primary, altCount, isExpanded }: {
  opt: ChainOption;
  userPaid: number;
  primary: boolean;
  altCount?: number;
  isExpanded?: boolean;
}) {
  const total = effectiveTotal(opt, false) ?? opt.shelf;
  const savings = userPaid - total;
  const cheaper = savings > 0.05;
  const more = savings < -0.05;

  const change = classifyChange(opt.equiv_note, opt.match_type === 'exact');
  const badgeColor = CHANGE_COLORS[change];
  const badgeLabel = CHANGE_LABELS[change];

  // Per-unit display: weight items show the user's quantity at the alt's per-unit
  // rate; packaged items show pack size and per-unit.
  const unitTxt = opt.price_unit && opt.price_unit.startsWith('per_') && opt.price_unit !== 'per_each'
    ? `${opt.pack_size ? '' : ''}${fmt(opt.shelf)}/${opt.price_unit.replace('per_', '')}`
    : opt.pack_size && opt.pack_unit
      ? `${opt.pack_size} ${opt.pack_unit}${opt.pack_unit !== 'each' && opt.pack_unit !== 'count' ? ` @ ${fmt(opt.shelf / Math.max(opt.pack_size, 0.0001))}/${opt.pack_unit}` : ''}`
      : '';

  return (
    <>
      <div className="v3-mono" style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: primary ? 11.5 : 10.5,
        lineHeight: 1.3,
        padding: primary ? 0 : '2px 0',
      }}>
        <span style={{
          flex: 1,
          marginRight: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: V3.paperInk,
          textTransform: 'uppercase',
          fontWeight: primary ? 500 : 400,
        }}>
          {opt.display_name}
        </span>
        <span style={{
          fontWeight: primary ? 700 : 600,
          fontVariantNumeric: 'tabular-nums',
          color: V3.paperInk,
        }}>
          {fmt(total)}
        </span>
      </div>
      <div className="v3-mono" style={{
        fontSize: primary ? 9 : 8.5,
        paddingLeft: 2,
        marginTop: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: primary ? 8.5 : 8,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '1px 5px',
          borderRadius: 2,
          color: badgeColor.fg,
          background: badgeColor.bg,
        }}>
          {badgeLabel}
        </span>
        {unitTxt && <span style={{ color: V3.paperMute }}>{unitTxt}</span>}
        {(cheaper || more) && (
          <span style={{
            color: cheaper ? V3.saveInk : V3.overInk,
            fontWeight: 700,
          }}>
            {cheaper
              ? `↓${fmtAbs(savings)} (${((savings / userPaid) * 100).toFixed(0)}%)`
              : `↑${fmtAbs(savings)} (${((-savings / userPaid) * 100).toFixed(0)}%)`}
          </span>
        )}
        {primary && altCount != null && altCount > 0 && (
          <span style={{
            color: V3.edited,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}>
            {isExpanded ? '▾ HIDE' : `▸ +${altCount} OTHER ON SHELF`}
          </span>
        )}
      </div>
    </>
  );
}

// ── Receipt UI primitives ─────────────────────────────────────────────────

function ReceiptCard({ children, tint }: { children: React.ReactNode; tint: 'actual' | 'alt' }) {
  return (
    <div style={{
      background: V3.paper,
      color: V3.paperInk,
      width: 360,
      flexShrink: 0,
      padding: '32px 26px 26px',
      borderRadius: 4,
      boxShadow: tint === 'actual'
        ? '0 24px 60px -16px rgba(0,0,0,0.55), 0 8px 22px rgba(0,0,0,0.28)'
        : '0 18px 44px -14px rgba(0,0,0,0.5), 0 4px 14px rgba(0,0,0,0.22)',
      position: 'relative',
      animation: 'v3FadeUp 0.5s ease',
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
      {children}
    </div>
  );
}

function ReceiptHeader({ title, subtitle, date, kicker, kickerColor }: {
  title: string;
  subtitle?: string;
  date?: string;
  kicker?: string;
  kickerColor?: string;
}) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 6 }}>
      {kicker && (
        <div className="v3-mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', color: kickerColor ?? V3.paperMute, marginBottom: 6 }}>
          ✱ {kicker} ✱
        </div>
      )}
      <div className="v3-mono" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.14em' }}>
        {title.toUpperCase()}
      </div>
      {subtitle && (
        <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 4 }}>
          {subtitle}
        </div>
      )}
      {date && (
        <div className="v3-mono" style={{ fontSize: 10, color: V3.paperMute, marginTop: 2 }}>
          {date}
        </div>
      )}
    </div>
  );
}

function ReceiptFooter({ itemCount, total, stampLabel, stampValue, stampColor, stampBg, stampBorder }: {
  itemCount: number;
  total: number;
  stampLabel: string;
  stampValue: string;
  stampColor: string;
  stampBg: string;
  stampBorder: string;
}) {
  return (
    <div className="v3-mono" style={{ fontSize: 11, color: V3.paperInk }}>
      <ReceiptStatLine label="ITEMS" value={`${itemCount}`} />
      <ReceiptStatLine label="SUBTOTAL" value={fmt(total)} />
      <ReceiptStatLine label="TAX" value="$0.00" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, padding: '4px 0', borderTop: `1px dashed ${V3.paperLine}` }}>
        <span style={{ fontWeight: 800, letterSpacing: '0.06em' }}>TOTAL</span>
        <span style={{ fontWeight: 800, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</span>
      </div>
      <div style={{
        marginTop: 14,
        padding: '14px 14px',
        background: stampBg,
        border: `1px solid ${stampBorder}`,
        borderRadius: 4,
        textAlign: 'center',
      }}>
        <div className="v3-mono" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: stampColor }}>
          {stampLabel}
        </div>
        <div className="v3-mono" style={{ fontSize: 22, fontWeight: 900, color: stampColor, marginTop: 2, letterSpacing: '-0.01em' }}>
          {stampValue}
        </div>
      </div>
    </div>
  );
}

function ReceiptStatLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: V3.paperMute, padding: '1px 0', letterSpacing: '0.06em' }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: V3.paperInk }}>{value}</span>
    </div>
  );
}

function Divider() {
  return (
    <div className="v3-mono" style={{ textAlign: 'center', fontSize: 10, color: V3.paperFaint, padding: '8px 0', letterSpacing: '0.08em' }}>
      — — — — — — — — — — — — — — —
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
