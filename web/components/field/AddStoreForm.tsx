'use client'

import { useState } from 'react'

type Props = {
  onCreated: (storeId: number) => void
  onCancel?: () => void
  knownChains?: Array<{ chain_id: number; name: string }>
}

export function AddStoreForm({ onCreated, onCancel, knownChains = [] }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    display_name: '',
    address: '',
    city: '',
    state: '',
    postal_code: '',
    lat: '',
    lon: '',
    chain_id: '',
    chain_name: '',
  })

  function set(k: keyof typeof form) {
    return (v: string) => setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation not available in this browser')
      return
    }
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((prev) => ({
          ...prev,
          lat: pos.coords.latitude.toFixed(6),
          lon: pos.coords.longitude.toFixed(6),
        }))
      },
      (err) => {
        setError(`Location error: ${err.message}`)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        display_name: form.display_name.trim(),
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postal_code: form.postal_code.trim() || null,
        lat: Number(form.lat),
        lon: Number(form.lon),
      }
      if (form.chain_id) body.chain_id = Number(form.chain_id)
      else if (form.chain_name.trim()) body.chain_name = form.chain_name.trim()

      const res = await fetch('/api/field/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onCreated(Number(data.store_id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3"
    >
      <h2 className="text-zinc-100 font-medium">Add a store</h2>

      <Row label="Store name *">
        <input
          required
          value={form.display_name}
          onChange={(e) => set('display_name')(e.target.value)}
          placeholder="Safeway"
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
        />
      </Row>

      <Row label="Chain (existing)">
        <select
          value={form.chain_id}
          onChange={(e) => set('chain_id')(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
        >
          <option value="">— pick existing chain —</option>
          {knownChains.map((c) => (
            <option key={c.chain_id} value={c.chain_id}>
              {c.name}
            </option>
          ))}
        </select>
      </Row>

      {!form.chain_id && (
        <Row label="…or new chain name">
          <input
            value={form.chain_name}
            onChange={(e) => set('chain_name')(e.target.value)}
            placeholder="Davis Food Co-op"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
          />
        </Row>
      )}

      <Row label="Address">
        <input
          value={form.address}
          onChange={(e) => set('address')(e.target.value)}
          placeholder="1411 W Covell Blvd"
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
        />
      </Row>

      <div className="grid grid-cols-3 gap-2">
        <Row label="City">
          <input
            value={form.city}
            onChange={(e) => set('city')(e.target.value)}
            placeholder="Davis"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
          />
        </Row>
        <Row label="State">
          <input
            value={form.state}
            onChange={(e) => set('state')(e.target.value)}
            placeholder="CA"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
          />
        </Row>
        <Row label="ZIP">
          <input
            value={form.postal_code}
            onChange={(e) => set('postal_code')(e.target.value)}
            placeholder="95616"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
          />
        </Row>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Row label="Latitude *">
          <input
            required
            value={form.lat}
            onChange={(e) => set('lat')(e.target.value)}
            placeholder="38.5538"
            inputMode="decimal"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
          />
        </Row>
        <Row label="Longitude *">
          <input
            required
            value={form.lon}
            onChange={(e) => set('lon')(e.target.value)}
            placeholder="-121.7656"
            inputMode="decimal"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
          />
        </Row>
      </div>

      <button
        type="button"
        onClick={useMyLocation}
        className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
      >
        📍 Use my location
      </button>

      {error && (
        <div className="text-sm text-rose-400 bg-rose-950/40 border border-rose-900 rounded p-2">
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className="text-sm px-4 py-2 rounded bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add store'}
        </button>
      </div>
    </form>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
