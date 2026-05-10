'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { ObservationCard } from '@/components/field/ObservationCard'
import type { PendingRow } from '@/components/field/types'

export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-500">Loading…</div>}>
      <ReviewQueueInner />
    </Suspense>
  )
}

function ReviewQueueInner() {
  const searchParams = useSearchParams()
  const storeFilter = searchParams.get('store_id')
  const modeFilter = searchParams.get('mode')

  const [rows, setRows] = useState<PendingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams()
      if (storeFilter) qs.set('store_id', storeFilter)
      if (modeFilter) qs.set('mode', modeFilter)
      qs.set('limit', '100')
      const res = await fetch(`/api/field/pending?${qs}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      setRows(Array.isArray(d?.pending) ? d.pending : [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [storeFilter, modeFilter])

  useEffect(() => {
    load()
  }, [load])

  const handleAccept = useCallback(
    async (id: number, edits?: Record<string, unknown>) => {
      const res = await fetch(`/api/field/observations/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? d?.detail ?? `HTTP ${res.status}`)
      await load()
    },
    [load],
  )

  const handleReject = useCallback(
    async (id: number, reason?: string) => {
      const res = await fetch(`/api/field/observations/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? d?.detail ?? `HTTP ${res.status}`)
      await load()
    },
    [load],
  )

  const handleEdit = useCallback(
    async (id: number, patch: Record<string, unknown>) => {
      const res = await fetch(`/api/field/observations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? d?.detail ?? `HTTP ${res.status}`)
      await load()
    },
    [load],
  )

  return (
    <div className="space-y-4">
      <Link
        href="/field"
        className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
      >
        ← Home
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-medium text-zinc-100">Review queue</h1>
        <p className="text-sm text-zinc-500">
          {loading
            ? 'Loading…'
            : rows.length === 0
            ? 'All caught up. Nothing pending.'
            : `${rows.length} pending observation${rows.length === 1 ? '' : 's'}`}
          {storeFilter ? ` · filtered to store #${storeFilter}` : ''}
          {modeFilter ? ` · ${modeFilter}` : ''}
        </p>
      </header>

      {err && (
        <div className="text-sm text-rose-400 bg-rose-950/40 border border-rose-900 rounded p-3">
          {err}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.observation_id} className="space-y-2">
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <Link
                href={`/field/upload/${r.upload_id}`}
                className="flex items-center gap-2 hover:text-zinc-300"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.image_url}
                  alt=""
                  loading="lazy"
                  className="w-10 h-10 rounded object-cover bg-zinc-950"
                />
                <span className="truncate">
                  {r.store_display_name}
                  {r.chain_name && r.chain_name !== r.store_display_name
                    ? ` · ${r.chain_name}`
                    : ''}
                </span>
              </Link>
            </div>
            <ObservationCard
              obs={r}
              onAccept={handleAccept}
              onReject={handleReject}
              onEdit={handleEdit}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
