'use client'

import { useEffect, useState, use, useCallback } from 'react'
import Link from 'next/link'

import { ObservationCard } from '@/components/field/ObservationCard'
import type { FieldObservation } from '@/components/field/types'

type UploadResponse = {
  upload: {
    upload_id: number
    store_id: number
    mode: 'shelf_tag' | 'wide_shot' | 'online_pdf'
    uploaded_at: string
    store_display_name?: string
    chain_name?: string | null
    notes?: string | null
  }
  observations: FieldObservation[]
  image_url: string
}

export default function UploadReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const uploadId = Number(id)

  const [data, setData] = useState<UploadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/field/uploads/${uploadId}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      setData(d)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [uploadId])

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

  async function acceptAll() {
    if (!data) return
    setBulkBusy(true)
    try {
      const accepts = data.observations.filter(
        (o) =>
          o.status === 'pending' &&
          o.price != null &&
          Number(o.price) > 0 &&
          (o.barcode != null || o.canonical_id != null),
      )
      // Run sequentially so a failure stops the rest with state intact.
      for (const o of accepts) {
        await handleAccept(o.observation_id)
      }
    } finally {
      setBulkBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Link href="/field" className="text-xs text-sky-400 hover:text-sky-300">
          ← Home
        </Link>
        <div className="text-sm text-zinc-500">Loading…</div>
      </div>
    )
  }
  if (err || !data) {
    return (
      <div className="space-y-4">
        <Link href="/field" className="text-xs text-sky-400 hover:text-sky-300">
          ← Home
        </Link>
        <div className="text-sm text-rose-400">{err ?? 'Upload not found'}</div>
      </div>
    )
  }

  const pending = data.observations.filter((o) => o.status === 'pending')
  const acceptable = pending.filter(
    (o) =>
      o.price != null &&
      Number(o.price) > 0 &&
      (o.barcode != null || o.canonical_id != null),
  )

  return (
    <div className="space-y-4 pb-24">
      <Link
        href={`/field/stores/${data.upload.store_id}`}
        className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
      >
        ← {data.upload.store_display_name ?? `Store #${data.upload.store_id}`}
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-medium text-zinc-100">
          {data.upload.mode === 'shelf_tag'
            ? 'Shelf tag'
            : data.upload.mode === 'wide_shot'
              ? 'Wide shelf shot'
              : 'Inventory PDF'}
        </h1>
        <div className="text-xs text-zinc-500">
          {data.observations.length} extraction
          {data.observations.length === 1 ? '' : 's'}
          {' · '}
          {pending.length} pending
        </div>
      </header>

      {/* Source — image for photo modes, embedded PDF for online_pdf */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        {data.upload.mode === 'online_pdf' ? (
          <div className="bg-zinc-950">
            <iframe
              src={data.image_url}
              title="Uploaded inventory PDF"
              className="w-full h-[480px] block bg-zinc-950"
            />
            <div className="p-2 text-xs text-zinc-500 border-t border-zinc-800">
              <a
                href={data.image_url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:text-sky-300 underline decoration-dotted"
              >
                Open PDF in new tab →
              </a>
            </div>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={data.image_url}
            alt="Captured photo"
            className="w-full h-auto block bg-black"
          />
        )}
      </div>

      {/* Empty state */}
      {data.observations.length === 0 && (
        <div className="rounded-xl border border-amber-900 bg-amber-950/20 p-4 text-amber-200 text-sm">
          {data.upload.mode === 'online_pdf'
            ? "Gemini couldn't read any product cards in this PDF. The page may be a category landing page (no product grid), an out-of-stock-only view, or formatted differently than expected."
            : "Gemini couldn't read any prices in this photo. Try retaking with the tag's text more centered + better lit, or pick a different shelf to start from."}
          <div className="mt-3">
            <Link
              href={`/field/stores/${data.upload.store_id}`}
              className="text-sm px-3 py-1.5 rounded bg-amber-900 text-amber-100 hover:bg-amber-800"
            >
              {data.upload.mode === 'online_pdf' ? 'Try another PDF →' : 'Retake →'}
            </Link>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {data.observations.map((o) => (
          <ObservationCard
            key={o.observation_id}
            obs={o}
            onAccept={handleAccept}
            onReject={handleReject}
            onEdit={handleEdit}
          />
        ))}
      </div>

      {/* Bulk accept */}
      {acceptable.length > 1 && (
        <div className="fixed left-0 right-0 bottom-0 px-4 py-3 bg-zinc-950 border-t border-zinc-800">
          <div className="mx-auto max-w-[580px]">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={acceptAll}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white py-3 font-medium disabled:opacity-50"
            >
              {bulkBusy
                ? 'Accepting…'
                : `Accept all ${acceptable.length} ready observations`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
