'use client';

import { useMemo } from 'react';
import { THEMES } from './data';

/**
 * Inline editor for the OCR-parsed price + quantity + unit on a single line
 * item. Lives inside the ReviewScreen's expanded "Change…" panel — sits
 * above the candidate list because the conceptual flow is "fix the values
 * first, then confirm or swap the product."
 *
 * Anchoring framing: header copy says "Fix what the scanner misread." This
 * keeps users away from "edit toward what I think I paid with a coupon"
 * — that drift would poison contributed price observations downstream.
 *
 * Behavior:
 *   - Live per-unit recompute as the user types (the one piece of feedback
 *     that's pure math, no judgment).
 *   - Edited inputs get an accent-tinted background and a small "Edited" pill.
 *   - "Reset to scanner values" link appears only when there are edits.
 *   - No blocking validation: zero/negative/NaN inputs are silently dropped
 *     on submit; the input visually clears the "edited" state when the
 *     value matches OCR exactly.
 */

export interface ReceiptValueState {
  price?: number;
  quantity?: number;
  unit?: string;
}

interface ReceiptValueEditorProps {
  /** OCR-parsed values — what the scanner produced. */
  parsedPrice: number | null;
  parsedQuantity: number | null;
  parsedUnit: string | null;

  /** Current edits (sparse — only fields the user has changed). */
  edits: ReceiptValueState;

  /** Called when the user changes a field. The component is fully controlled. */
  onChange: (next: ReceiptValueState) => void;
}

// Common unit options. Receipts span weight, volume, and count; we expose
// the practical set users encounter. The OCR-parsed unit gets pre-selected
// even if it isn't in this list (we add it dynamically).
const UNIT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'each', label: 'each' },
  { value: 'lb',   label: 'lb (pound)' },
  { value: 'oz',   label: 'oz (ounce)' },
  { value: 'g',    label: 'g (gram)' },
  { value: 'kg',   label: 'kg (kilogram)' },
  { value: 'fl_oz',label: 'fl oz' },
  { value: 'ml',   label: 'ml (milliliter)' },
  { value: 'l',    label: 'l (liter)' },
  { value: 'gal',  label: 'gal (gallon)' },
  { value: 'pt',   label: 'pt (pint)' },
  { value: 'qt',   label: 'qt (quart)' },
];

export default function ReceiptValueEditor({
  parsedPrice,
  parsedQuantity,
  parsedUnit,
  edits,
  onChange,
}: ReceiptValueEditorProps) {
  const t = THEMES.forest;

  // Effective values currently displayed = edit ?? parsed.
  const displayPrice = edits.price ?? parsedPrice ?? null;
  const displayQuantity = edits.quantity ?? parsedQuantity ?? null;
  const displayUnit = edits.unit ?? parsedUnit ?? '';

  const priceEdited = edits.price !== undefined && edits.price !== parsedPrice;
  const quantityEdited = edits.quantity !== undefined && edits.quantity !== parsedQuantity;
  const unitEdited = edits.unit !== undefined && edits.unit !== parsedUnit;
  const anyEdited = priceEdited || quantityEdited || unitEdited;

  // Per-unit recompute, mirrors the server's deriveUnitPrice for weight/volume.
  // Returns null for 'each'/'count' since per-each isn't a useful per-unit signal.
  const perUnitLabel = useMemo(() => {
    const p = displayPrice;
    const q = displayQuantity;
    const u = displayUnit;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return null;
    if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0) return null;
    if (!u || u === 'each' || u === 'count') return null;
    const per = p / q;
    return `$${per.toFixed(per < 1 ? 2 : 2)}/${u.replace('_', ' ')}`;
  }, [displayPrice, displayQuantity, displayUnit]);

  // Make sure the dropdown includes the OCR-parsed unit even if it isn't in
  // our common list (e.g., a regional unit the parser surfaced).
  const unitOptions = useMemo(() => {
    const base = [...UNIT_OPTIONS];
    if (parsedUnit && !base.some((o) => o.value === parsedUnit)) {
      base.unshift({ value: parsedUnit, label: parsedUnit });
    }
    return base;
  }, [parsedUnit]);

  const handlePriceChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    if (cleaned === '') { onChange({ ...edits, price: undefined }); return; }
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) { onChange({ ...edits, price: undefined }); return; }
    // Same-as-parsed is treated as "no edit" so the cue clears naturally.
    if (n === parsedPrice) { onChange({ ...edits, price: undefined }); return; }
    onChange({ ...edits, price: n });
  };

  const handleQuantityChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    if (cleaned === '') { onChange({ ...edits, quantity: undefined }); return; }
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) { onChange({ ...edits, quantity: undefined }); return; }
    if (n === parsedQuantity) { onChange({ ...edits, quantity: undefined }); return; }
    onChange({ ...edits, quantity: n });
  };

  const handleUnitChange = (raw: string) => {
    if (raw === parsedUnit) { onChange({ ...edits, unit: undefined }); return; }
    onChange({ ...edits, unit: raw });
  };

  const handleReset = () => {
    onChange({});
  };

  return (
    <div
      style={{
        background: anyEdited ? `${t.accent}08` : t.surfaceAlt,
        border: `1px solid ${anyEdited ? `${t.accent}40` : 'rgba(0,0,0,0.06)'}`,
        borderRadius: 12,
        padding: 12,
        transition: 'background 0.18s ease, border-color 0.18s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 'var(--t-xs)', fontWeight: 700, color: t.inkMid, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Receipt values
          </div>
          <div style={{ fontSize: 'var(--t-xs)', color: t.inkLight, marginTop: 2 }}>
            Fix what the scanner misread
          </div>
        </div>
        {anyEdited && (
          <button
            onClick={handleReset}
            style={{
              padding: '4px 8px',
              fontSize: 'var(--t-xs)',
              fontWeight: 600,
              color: t.inkLight,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Reset
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Price row */}
        <FieldRow label="Price" edited={priceEdited}>
          <PrefixInput
            prefix="$"
            value={typeof displayPrice === 'number' ? displayPrice.toFixed(2).replace(/\.?0+$/, '') : ''}
            onChange={handlePriceChange}
            edited={priceEdited}
            inputMode="decimal"
            placeholder={parsedPrice != null ? parsedPrice.toFixed(2) : '0.00'}
          />
        </FieldRow>

        {/* Quantity + unit row */}
        <FieldRow label="Quantity" edited={quantityEdited || unitEdited}>
          <div style={{ display: 'flex', gap: 6, flex: 1 }}>
            <PrefixInput
              prefix=""
              value={typeof displayQuantity === 'number' ? String(displayQuantity).replace(/\.?0+$/, '') : ''}
              onChange={handleQuantityChange}
              edited={quantityEdited}
              inputMode="decimal"
              placeholder={parsedQuantity != null ? String(parsedQuantity) : '1'}
              flex={1}
            />
            <select
              value={displayUnit}
              onChange={(e) => handleUnitChange(e.target.value)}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${unitEdited ? t.accent : 'rgba(0,0,0,0.12)'}`,
                background: unitEdited ? `${t.accent}10` : '#fff',
                color: t.inkDark,
                fontSize: 'var(--t-sm)',
                fontFamily: 'inherit',
                outline: 'none',
                minWidth: 100,
                cursor: 'pointer',
              }}
            >
              {unitOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </FieldRow>

        {/* Live per-unit recompute. Reserve space even when null so the panel
            doesn't jump as the user types. */}
        <div
          style={{
            marginTop: 4,
            padding: '6px 10px',
            background: '#fff',
            borderRadius: 6,
            fontSize: 'var(--t-xs)',
            color: t.inkLight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 22,
          }}
        >
          <span style={{ color: t.inkFaint }}>Per unit</span>
          <span style={{ fontWeight: 600, color: perUnitLabel ? t.inkDark : t.inkFaint }}>
            {perUnitLabel ?? '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── small subcomponents ────────────────────────────────────────────────────

function FieldRow({ label, edited, children }: { label: string; edited: boolean; children: React.ReactNode }) {
  const t = THEMES.forest;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flexShrink: 0, width: 80, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 'var(--t-sm)', color: t.inkMid, fontWeight: 500 }}>{label}</span>
        {edited && <EditedPill />}
      </div>
      <div style={{ flex: 1, display: 'flex' }}>{children}</div>
    </div>
  );
}

function EditedPill() {
  const t = THEMES.forest;
  return (
    <span
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
  );
}

function PrefixInput({
  prefix, value, onChange, edited, inputMode, placeholder, flex,
}: {
  prefix: string;
  value: string;
  onChange: (raw: string) => void;
  edited: boolean;
  inputMode?: 'decimal' | 'numeric' | 'text';
  placeholder?: string;
  flex?: number;
}) {
  const t = THEMES.forest;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flex: flex ?? 1,
        background: edited ? `${t.accent}10` : '#fff',
        border: `1px solid ${edited ? t.accent : 'rgba(0,0,0,0.12)'}`,
        borderRadius: 8,
        overflow: 'hidden',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      {prefix && (
        <span style={{ padding: '8px 4px 8px 10px', fontSize: 'var(--t-sm)', color: t.inkLight, fontWeight: 500 }}>
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode={inputMode ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          padding: '8px 10px 8px 4px',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontFamily: 'inherit',
          fontSize: 'var(--t-sm)',
          color: '#222',
          minWidth: 0,
          width: '100%',
        }}
      />
    </div>
  );
}
