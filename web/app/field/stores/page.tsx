'use client'

import { useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { StoreCard } from '@/components/field/StoreCard'
import { AddStoreForm } from '@/components/field/AddStoreForm'
import type { FieldStore } from '@/components/field/types'

export default function FieldStoresPage() {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-500">Loading…</div>}>
      <FieldStoresInner />
    </Suspense>
  )
}

function FieldStoresInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialAdd = searchParams.get('add') === '1'

  const [stores, setStores] = useState<FieldStore[]>([])
  const [chains, setChains] = useState<Array<{ chain_id: number; name: string }>>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(initialAdd)

  async function load() {
    try {
      setLoading(true)
      const res = await fetch('/api/field/stores')
      const data = await res.json().catch(() => ({}))
      const list: FieldStore[] = Array.isArray(data?.stores) ? data.stores : []
      setStores(list)
      // Derive chains list from the loaded stores so AddStoreForm has options.
      const seen = new Map<number, string>()
      for (const s of list) {
        if (s.chain_id && s.chain_name && !seen.has(s.chain_id)) {
          seen.set(s.chain_id, s.chain_name)
        }
      }
      setChains(
        [...seen.entries()]
          .map(([chain_id, name]) => ({ chain_id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return stores
    return stores.filter((s) => {
      const hay =
        `${s.display_name} ${s.chain_name ?? ''} ${s.address_full ?? ''} ${s.city ?? ''} ${s.state ?? ''}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [stores, q])

  async function toggleStar(storeId: number, currentlyStarred: boolean) {
    // Optimistic update.
    setStores((prev) =>
      prev.map((s) =>
        s.store_id === storeId ? { ...s, is_field_starred: !currentlyStarred } : s,
      ),
    )
    try {
      const res = await fetch(`/api/field/stores/${storeId}/star`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: !currentlyStarred }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      // Roll back on failure.
      setStores((prev) =>
        prev.map((s) =>
          s.store_id === storeId ? { ...s, is_field_starred: currentlyStarred } : s,
        ),
      )
      setErr((e as Error).message)
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-medium text-zinc-100">Stores</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Star up to 3 to pin them to the home screen.
          </p>
        </div>
        <Link
          href="/field"
          className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
        >
          ← Home
        </Link>
      </header>

      {err && (
        <div className="text-sm text-rose-400 bg-rose-950/40 border border-rose-900 rounded p-3">
          {err}
        </div>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, chain, city…"
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
      />

      {!showAdd && (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="w-full rounded-xl border border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 py-3"
        >
          + Add a store
        </button>
      )}

      {showAdd && (
        <AddStoreForm
          knownChains={chains}
          onCancel={() => setShowAdd(false)}
          onCreated={(storeId) => {
            // Take the user straight to the new store's capture page.
            router.push(`/field/stores/${storeId}`)
          }}
        />
      )}

      {loading && <div className="text-sm text-zinc-500">Loading…</div>}

      <div className="space-y-3">
        {filtered.map((s) => (
          <StoreCard key={s.store_id} store={s} onToggleStar={toggleStar} />
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <div className="text-sm text-zinc-500 text-center py-8">
          No stores match.
        </div>
      )}
    </div>
  )
}
