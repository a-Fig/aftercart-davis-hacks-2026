'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'

import { CaptureButton } from '@/components/field/CaptureButton'
import { PdfUploadButton } from '@/components/field/PdfUploadButton'
import type { FieldStore } from '@/components/field/types'

type Recent = {
  observation_id: number
  upload_id: number
  product_name_raw: string | null
  price: number | null
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  upload_mode: 'shelf_tag' | 'wide_shot'
  image_url: string
}

export default function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const storeId = Number(id)

  const [store, setStore] = useState<FieldStore | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [handle, setHandle] = useState<string>('')

  // Persist contributor_handle in localStorage for repeat sessions.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('field.contributor_handle')
      if (saved) setHandle(saved)
    }
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (handle) window.localStorage.setItem('field.contributor_handle', handle)
      else window.localStorage.removeItem('field.contributor_handle')
    }
  }, [handle])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // Use the search endpoint (which carries pending_count) and pick our id.
        const [storesRes, pendingRes] = await Promise.all([
          fetch(`/api/field/stores`),
          fetch(`/api/field/pending?store_id=${storeId}&limit=20`),
        ])
        const sd = await storesRes.json().catch(() => ({}))
        const pd = await pendingRes.json().catch(() => ({}))
        if (cancelled) return
        const list: FieldStore[] = Array.isArray(sd?.stores) ? sd.stores : []
        const me = list.find((s) => Number(s.store_id) === storeId) ?? null
        setStore(me)
        setRecent(Array.isArray(pd?.pending) ? pd.pending : [])
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
  }, [storeId])

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
  if (!store) {
    return (
      <div className="space-y-4">
        <Link href="/field" className="text-xs text-sky-400 hover:text-sky-300">
          ← Home
        </Link>
        <div className="text-sm text-rose-400">
          {err ?? 'Store not found.'}
        </div>
      </div>
    )
  }

  const subline = [store.address_full, store.city, store.state]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="space-y-5">
      <Link
        href="/field"
        className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
      >
        ← Home
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-medium text-zinc-100">{store.display_name}</h1>
        {store.chain_name && store.chain_name !== store.display_name && (
          <div className="text-sm text-zinc-400">{store.chain_name}</div>
        )}
        {subline && <div className="text-sm text-zinc-500">{subline}</div>}
        {store.lat != null && store.lon != null && (
          <a
            href={`https://www.google.com/maps?q=${store.lat},${store.lon}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
          >
            Open in Maps
          </a>
        )}
      </header>

      {/* Optional contributor handle for self-attribution. */}
      <details className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <summary className="text-xs text-zinc-400 cursor-pointer">
          Contributor handle (optional)
        </summary>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="e.g. tylerd"
          className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <p className="text-[11px] text-zinc-600 mt-1">
          Saved on this device. Tagged onto every observation you contribute.
        </p>
      </details>

      <section className="space-y-3">
        <PdfUploadButton
          storeId={store.store_id}
          contributorHandle={handle || undefined}
        />
        <details className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <summary className="text-xs text-zinc-400 cursor-pointer">
            In-store capture (camera)
          </summary>
          <div className="mt-3 space-y-3">
            <CaptureButton
              storeId={store.store_id}
              mode="shelf_tag"
              label="Snap a shelf tag"
              icon="📷"
              contributorHandle={handle || undefined}
            />
            <CaptureButton
              storeId={store.store_id}
              mode="wide_shot"
              label="Wide shelf shot"
              icon="📐"
              contributorHandle={handle || undefined}
            />
          </div>
        </details>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wide text-zinc-500">
            Recent at this store
          </h2>
          {store.pending_count > 0 && (
            <Link
              href={`/field/review?store_id=${store.store_id}`}
              className="text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted"
            >
              Review {store.pending_count} pending →
            </Link>
          )}
        </div>
        {recent.length === 0 && (
          <div className="text-sm text-zinc-500">
            Nothing yet. Snap a tag above to get started.
          </div>
        )}
        <div className="space-y-2">
          {recent.map((r) => (
            <Link
              key={r.observation_id}
              href={`/field/upload/${r.upload_id}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-2 hover:border-zinc-700"
            >
              {/* Use plain <img> not next/image so private GCS proxy URLs don't go through the optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.image_url}
                alt=""
                loading="lazy"
                className="w-12 h-12 rounded object-cover bg-zinc-950"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-zinc-100 truncate">
                  {r.product_name_raw ?? <span className="text-zinc-500 italic">(no name)</span>}
                </div>
                <div className="text-xs text-zinc-500">
                  {r.upload_mode === 'shelf_tag' ? 'Shelf tag' : 'Wide shot'}
                  {' · '}
                  {r.price != null ? `$${Number(r.price).toFixed(2)}` : 'no price'}
                </div>
              </div>
              <div className="text-xs text-zinc-500 shrink-0">{r.status}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
