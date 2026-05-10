'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { StoreCard } from '@/components/field/StoreCard'
import type { FieldStore } from '@/components/field/types'

export default function FieldHomePage() {
  const [starred, setStarred] = useState<FieldStore[]>([])
  const [pendingTotal, setPendingTotal] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [starredRes, pendingRes] = await Promise.all([
          fetch('/api/field/stores?starred=1'),
          fetch('/api/field/pending?limit=1'),
        ])
        const starredData = await starredRes.json().catch(() => ({}))
        const pendingData = await pendingRes.json().catch(() => ({}))
        if (cancelled) return
        const stores = Array.isArray(starredData?.stores) ? starredData.stores : []
        setStarred(stores)
        const totalPending = stores.reduce(
          (acc: number, s: FieldStore) => acc + (s.pending_count ?? 0),
          0,
        )
        // Pending count from the (max 1) sample is just a heads-up that there's
        // _any_ pending; combine with the per-store totals from the starred call.
        const probeHasPending = Array.isArray(pendingData?.pending) && pendingData.pending.length > 0
        setPendingTotal(probeHasPending ? Math.max(totalPending, 1) : totalPending)
      } catch (e) {
        if (!cancelled) setErr((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-medium text-zinc-100">Field collection</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Snap shelf tags in-store. Gemini reads the price; you review and accept.
        </p>
      </header>

      {err && (
        <div className="text-sm text-rose-400 bg-rose-950/40 border border-rose-900 rounded p-3">
          {err}
        </div>
      )}

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wide text-zinc-500">Your stores</h2>
          <Link
            href="/field/stores"
            className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
          >
            All stores →
          </Link>
        </div>

        {loading && <div className="text-sm text-zinc-500">Loading…</div>}

        {!loading && starred.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
            <div className="text-zinc-300 mb-2">No stores starred yet.</div>
            <div className="text-xs text-zinc-500 mb-4">
              Star up to 3 stores so they show up here for one-tap access.
            </div>
            <Link
              href="/field/stores"
              className="inline-block text-sm px-4 py-2 rounded bg-zinc-100 text-zinc-900 hover:bg-white"
            >
              Browse stores
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {starred.map((s) => (
            <StoreCard key={s.store_id} store={s} />
          ))}
        </div>

        {!loading && starred.length > 0 && (
          <Link
            href="/field/stores?add=1"
            className="block mt-3 text-center text-sm py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
          >
            + Add another store
          </Link>
        )}
      </section>

      <section className="pt-4 border-t border-zinc-900">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/field/review"
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 flex flex-col gap-1"
          >
            <span className="text-zinc-500 text-xs uppercase tracking-wide">Review queue</span>
            <span className="text-zinc-100 text-lg">
              {pendingTotal > 0 ? `${pendingTotal} pending` : 'All caught up'}
            </span>
          </Link>
          <Link
            href="/field/stores"
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 flex flex-col gap-1"
          >
            <span className="text-zinc-500 text-xs uppercase tracking-wide">All stores</span>
            <span className="text-zinc-100 text-lg">Browse / search</span>
          </Link>
        </div>
      </section>
    </div>
  )
}
