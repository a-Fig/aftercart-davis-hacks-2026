'use client'

import { useState, useEffect, useRef } from 'react'

import type { CanonicalHit } from './types'

type Props = {
  initialQuery?: string
  onPick: (canonical: CanonicalHit) => void
  onCancel?: () => void
}

export function CanonicalPicker({ initialQuery = '', onPick, onCancel }: Props) {
  const [q, setQ] = useState(initialQuery)
  const [results, setResults] = useState<CanonicalHit[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/field/canonical-search?q=${encodeURIComponent(q.trim())}&limit=10`,
        )
        const data = await res.json().catch(() => ({}))
        setResults(Array.isArray(data?.canonicals) ? data.canonicals : [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products… e.g. 'whole milk'"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2"
          >
            Cancel
          </button>
        )}
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto">
        {loading && <div className="text-xs text-zinc-500 px-1 py-2">Searching…</div>}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <div className="text-xs text-zinc-500 px-1 py-2">No matches.</div>
        )}
        {results.map((r) => (
          <button
            key={r.canonical_id}
            type="button"
            onClick={() => onPick(r)}
            className="w-full text-left flex flex-col gap-0.5 p-2 rounded hover:bg-zinc-800 transition"
          >
            <span className="text-sm text-zinc-100">{r.name}</span>
            <span className="text-xs text-zinc-500">
              {[r.brand, r.package_size && r.package_unit
                ? `${r.package_size} ${r.package_unit}`
                : null,
              `${r.pricing_unit}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
