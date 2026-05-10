'use client'

import { useState } from 'react'

import { CanonicalPicker } from './CanonicalPicker'
import type { FieldObservation, CanonicalHit } from './types'

type Props = {
  obs: FieldObservation
  onAccept: (id: number, edits?: Record<string, unknown>) => Promise<void>
  onReject: (id: number, reason?: string) => Promise<void>
  onEdit?: (id: number, patch: Record<string, unknown>) => Promise<void>
}

export function ObservationCard({ obs, onAccept, onReject, onEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const [pickingCanonical, setPickingCanonical] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local draft of editable fields. Saved on Apply.
  const [draft, setDraft] = useState<Record<string, unknown>>({
    barcode: obs.barcode ?? '',
    product_name_raw: obs.product_name_raw ?? '',
    brand: obs.brand ?? '',
    price: obs.price ?? '',
    member_price: obs.member_price ?? '',
    pack_size: obs.pack_size ?? '',
    pack_unit: obs.pack_unit ?? '',
    pricing_tier: obs.pricing_tier ?? 'shelf',
    canonical_id: obs.canonical_id ?? null,
  })

  const isAccepted = obs.status === 'accepted'
  const isRejected = obs.status === 'rejected'
  const canAccept =
    !isAccepted && !isRejected &&
    (obs.barcode != null || obs.canonical_id != null) &&
    obs.price != null && Number(obs.price) > 0

  async function applyEdits() {
    if (!onEdit) return
    setBusy(true)
    setError(null)
    try {
      // Convert empty strings to null + numeric strings to numbers.
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) {
        if (v === '' || v == null) {
          patch[k] = null
        } else if (k === 'price' || k === 'member_price' || k === 'pack_size') {
          const n = Number(v)
          patch[k] = Number.isFinite(n) ? n : null
        } else {
          patch[k] = v
        }
      }
      await onEdit(obs.observation_id, patch)
      setEditing(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function pickCanonical(c: CanonicalHit) {
    setPickingCanonical(false)
    if (!onEdit) return
    setBusy(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = { canonical_id: c.canonical_id }
      // If reviewer hasn't supplied product_name_raw, seed it from the canonical.
      if (!obs.product_name_raw) patch.product_name_raw = c.name
      if (!obs.pack_size && c.package_size != null) patch.pack_size = c.package_size
      if (!obs.pack_unit && c.package_unit) patch.pack_unit = c.package_unit
      await onEdit(obs.observation_id, patch)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The match line — show what the row resolves to in the live tables.
  let matchLine: React.ReactNode
  if (obs.barcode) {
    matchLine = (
      <span className="text-emerald-400 text-xs">
        ⬢ Will write to <code className="text-emerald-300">prices</code> with barcode {obs.barcode}
      </span>
    )
  } else if (obs.canonical_id && obs.canonical_name) {
    matchLine = (
      <span className="text-emerald-400 text-xs">
        ✓ Matches canonical: <span className="text-zinc-100">{obs.canonical_name}</span>
      </span>
    )
  } else {
    matchLine = (
      <button
        type="button"
        onClick={() => setPickingCanonical(true)}
        className="text-amber-400 text-xs underline decoration-dotted"
      >
        ✗ No match — pick a canonical
      </button>
    )
  }

  return (
    <div
      className={`rounded-xl border p-4 transition ${
        isAccepted
          ? 'border-emerald-900 bg-emerald-950/20 opacity-70'
          : isRejected
          ? 'border-rose-900 bg-rose-950/20 opacity-50'
          : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      {/* Header: product name + price + tier */}
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-zinc-100 font-medium truncate">
            {obs.product_name_raw ?? <span className="text-zinc-500 italic">(no name)</span>}
          </div>
          {obs.brand && <div className="text-xs text-zinc-500 truncate">{obs.brand}</div>}
        </div>
        <div className="text-right shrink-0">
          {obs.price != null ? (
            <div className="text-lg text-zinc-100 tabular-nums">
              ${Number(obs.price).toFixed(2)}
            </div>
          ) : (
            <div className="text-sm text-rose-400">No price</div>
          )}
          {obs.member_price != null && (
            <div className="text-xs text-amber-300 tabular-nums">
              ${Number(obs.member_price).toFixed(2)} w/ card
            </div>
          )}
        </div>
      </div>

      {/* Pack + tier + position */}
      <div className="flex flex-wrap gap-2 text-xs text-zinc-400 mb-2">
        {obs.pack_size && obs.pack_unit && (
          <span className="px-2 py-0.5 rounded bg-zinc-800">
            {obs.pack_size} {obs.pack_unit}
          </span>
        )}
        <span className="px-2 py-0.5 rounded bg-zinc-800">{obs.pricing_tier}</span>
        {obs.position_note && (
          <span className="px-2 py-0.5 rounded bg-zinc-800 italic">{obs.position_note}</span>
        )}
        {obs.llm_confidence != null && (
          <span
            className={`px-2 py-0.5 rounded ${
              obs.llm_confidence >= 0.8
                ? 'bg-emerald-950 text-emerald-300'
                : obs.llm_confidence >= 0.5
                ? 'bg-amber-950 text-amber-300'
                : 'bg-rose-950 text-rose-300'
            }`}
          >
            conf {Math.round((obs.llm_confidence ?? 0) * 100)}%
          </span>
        )}
      </div>

      {/* Match indicator */}
      <div className="mb-3">{matchLine}</div>

      {/* Canonical picker (inline) */}
      {pickingCanonical && (
        <div className="mb-3">
          <CanonicalPicker
            initialQuery={obs.product_name_raw ?? obs.brand ?? ''}
            onPick={pickCanonical}
            onCancel={() => setPickingCanonical(false)}
          />
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Product name"
              value={draft.product_name_raw}
              onChange={(v) => setDraft({ ...draft, product_name_raw: v })}
              span2
            />
            <Field
              label="Brand"
              value={draft.brand}
              onChange={(v) => setDraft({ ...draft, brand: v })}
            />
            <Field
              label="Barcode"
              value={draft.barcode}
              onChange={(v) => setDraft({ ...draft, barcode: v })}
            />
            <Field
              label="Price ($)"
              value={draft.price}
              onChange={(v) => setDraft({ ...draft, price: v })}
              numeric
            />
            <Field
              label="Member ($)"
              value={draft.member_price}
              onChange={(v) => setDraft({ ...draft, member_price: v })}
              numeric
            />
            <Field
              label="Pack size"
              value={draft.pack_size}
              onChange={(v) => setDraft({ ...draft, pack_size: v })}
              numeric
            />
            <Field
              label="Pack unit"
              value={draft.pack_unit}
              onChange={(v) => setDraft({ ...draft, pack_unit: v })}
            />
            <SelectField
              label="Tier"
              value={draft.pricing_tier as string}
              onChange={(v) => setDraft({ ...draft, pricing_tier: v })}
              options={['shelf', 'member', 'sale']}
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyEdits}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!isAccepted && !isRejected && !editing && (
        <div className="flex gap-2 justify-end">
          {onEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            >
              ✏️ Edit
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onReject(obs.observation_id)
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
            className="text-xs px-3 py-1.5 rounded bg-rose-950 text-rose-300 hover:bg-rose-900 disabled:opacity-50"
          >
            ✗ Reject
          </button>
          <button
            type="button"
            disabled={busy || !canAccept}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onAccept(obs.observation_id)
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
            title={!canAccept ? 'Need a barcode or canonical, plus a price' : undefined}
            className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ✓ Accept
          </button>
        </div>
      )}

      {/* Resolved-state badges */}
      {isAccepted && (
        <div className="text-xs text-emerald-400">
          ✓ Accepted{obs.promoted_price_id ? ` → prices #${obs.promoted_price_id}` : ''}
          {obs.promoted_obs_id ? ` → unbarcoded #${obs.promoted_obs_id}` : ''}
        </div>
      )}
      {isRejected && (
        <div className="text-xs text-rose-400">
          ✗ Rejected{obs.rejected_reason ? ` — ${obs.rejected_reason}` : ''}
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded p-2">
          {error}
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
  span2 = false,
}: {
  label: string
  value: unknown
  onChange: (v: string) => void
  numeric?: boolean
  span2?: boolean
}) {
  return (
    <label className={`flex flex-col gap-1 ${span2 ? 'col-span-2' : ''}`}>
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        step={numeric ? 'any' : undefined}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
