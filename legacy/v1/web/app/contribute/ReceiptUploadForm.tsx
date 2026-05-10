'use client'

/**
 * Receipt upload form. Multi-file (queue), drag-and-drop, per-file progress,
 * camera-capable on mobile via the `capture="environment"` hint.
 *
 * We use XMLHttpRequest rather than fetch() because fetch can't surface
 * upload progress events — for receipt photos that can be 3–8 MB on a
 * prepaid plan, the user needs to see the bar advance.
 *
 * State machine per file:
 *   queued → uploading → processing → done | error
 *
 * "uploading" tracks XHR progress; once the request body finishes streaming
 * we flip to "processing" while the server runs OCR + parse + match. The
 * server does both halves in one POST, so we don't actually have a second
 * progress channel — but the visual distinction matters for users on slow
 * uplinks who think the app froze after the bar fills.
 */

import { useCallback, useRef, useState } from 'react'

type FileState = 'queued' | 'uploading' | 'processing' | 'done' | 'error'

type UploadedItem = {
  idx: number
  raw_text: string | null
  description: string | null
  item_type: string | null
  shelf_price: number | null
  member_price: number | null
  match: {
    canonical_id: number
    name: string
    score: number
    review_decision: string | null
    llm_reason: string | null
  } | null
}

type UploadResult = {
  ok: true
  duplicate?: boolean
  already_processed?: boolean
  receipt_id: string
  image: { gs_uri: string | null; sha256: string; bytes: number }
  store: {
    chain_id: number
    chain_name: string | null
    store_id: number | null
    store_address: string | null
    reason: string | null
  } | null
  summary: {
    items_total: number
    items_compared: number
    items_matched: number
    items_unmatched: number
    observations_inserted: number
    total_extracted: number
  }
  items: UploadedItem[]
  review?: { ran: boolean; error: string | null }
}

type Entry = {
  id: string
  file: File
  state: FileState
  pct: number
  error: string | null
  result: UploadResult | null
  thumbDataUrl: string | null
  expanded: boolean
}

let nextId = 0
function newEntry(file: File): Entry {
  return {
    id: `f${++nextId}-${file.name}-${file.size}`,
    file,
    state: 'queued',
    pct: 0,
    error: null,
    result: null,
    thumbDataUrl: null,
    expanded: false,
  }
}

export default function ReceiptUploadForm() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [runReview, setRunReview] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  // Read a small preview thumbnail. We don't downscale the actual upload —
  // the server wants the full-resolution image for OCR — but the UI thumb
  // can be the raw data URL since image elements decode it lazily.
  const attachThumb = useCallback((entry: Entry) => {
    const reader = new FileReader()
    reader.onload = () => {
      setEntries((es) =>
        es.map((e) =>
          e.id === entry.id ? { ...e, thumbDataUrl: String(reader.result ?? '') } : e,
        ),
      )
    }
    reader.readAsDataURL(entry.file)
  }, [])

  const uploadEntry = useCallback(
    (entry: Entry, review: boolean) => {
      setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, state: 'uploading', pct: 0 } : e)))

      const xhr = new XMLHttpRequest()
      const url = review
        ? '/contribute/api/upload?review=true'
        : '/contribute/api/upload'
      xhr.open('POST', url, true)

      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return
        const pct = Math.round((ev.loaded / ev.total) * 100)
        setEntries((es) =>
          es.map((e) =>
            e.id === entry.id
              ? {
                  ...e,
                  pct,
                  // Once the bytes have left, the server is processing — flip
                  // state so the UI stops looking like upload is stuck.
                  state: pct >= 100 ? 'processing' : 'uploading',
                }
              : e,
          ),
        )
      }

      xhr.onload = () => {
        let parsed: unknown = null
        try {
          parsed = JSON.parse(xhr.responseText)
        } catch {
          // Non-JSON body; fall through to error path.
        }
        if (xhr.status >= 200 && xhr.status < 300 && parsed && typeof parsed === 'object') {
          const result = parsed as UploadResult
          setEntries((es) =>
            es.map((e) =>
              e.id === entry.id
                ? { ...e, state: 'done', pct: 100, result, expanded: true }
                : e,
            ),
          )
        } else {
          const errMsg =
            (parsed && typeof parsed === 'object' && 'error' in parsed
              ? String((parsed as { error: unknown }).error)
              : null) || `Upload failed (${xhr.status})`
          setEntries((es) =>
            es.map((e) =>
              e.id === entry.id ? { ...e, state: 'error', error: errMsg } : e,
            ),
          )
        }
      }

      xhr.onerror = () => {
        setEntries((es) =>
          es.map((e) =>
            e.id === entry.id ? { ...e, state: 'error', error: 'Network error' } : e,
          ),
        )
      }

      const fd = new FormData()
      fd.append('image', entry.file)
      xhr.send(fd)
    },
    [],
  )

  const enqueueFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (arr.length === 0) return
      const fresh = arr.map(newEntry)
      setEntries((es) => [...fresh, ...es])
      // Kick off thumb + upload on the next tick so React commits the new
      // entries before we update them with progress.
      queueMicrotask(() => {
        for (const e of fresh) {
          attachThumb(e)
          uploadEntry(e, runReview)
        }
      })
    },
    [attachThumb, uploadEntry, runReview],
  )

  const onDrop = useCallback(
    (ev: React.DragEvent<HTMLDivElement>) => {
      ev.preventDefault()
      setDragOver(false)
      if (ev.dataTransfer?.files) enqueueFiles(ev.dataTransfer.files)
    },
    [enqueueFiles],
  )

  const onDragOver = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    setDragOver(false)
  }, [])

  return (
    <section className="space-y-4">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={
          'rounded-lg border-2 border-dashed p-8 text-center transition-colors ' +
          (dragOver
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-slate-300 bg-white hover:border-slate-400')
        }
      >
        <p className="text-sm font-medium text-slate-900">
          Drag and drop receipt photos here
        </p>
        <p className="mt-1 text-xs text-slate-500">
          or pick from your device — multiple files supported
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Choose files
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Take a photo
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) enqueueFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) enqueueFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <label className="mt-4 inline-flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={runReview}
            onChange={(e) => setRunReview(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Run LLM review (slower but catches matcher mistakes)
        </label>
      </div>

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e) => (
            <UploadRow
              key={e.id}
              entry={e}
              onToggle={() =>
                setEntries((es) =>
                  es.map((x) => (x.id === e.id ? { ...x, expanded: !x.expanded } : x)),
                )
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

function UploadRow({
  entry,
  onToggle,
}: {
  entry: Entry
  onToggle: () => void
}) {
  const r = entry.result
  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-white">
      <div className="flex items-start gap-3 p-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100">
          {entry.thumbDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.thumbDataUrl}
              alt={entry.file.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
              loading…
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="truncate text-sm font-medium text-slate-900">{entry.file.name}</div>
            <div className="shrink-0 text-[11px] text-slate-500 tabular-nums">
              {(entry.file.size / 1024).toFixed(0)} KB
            </div>
          </div>
          <div className="mt-1">
            <StatusBadge state={entry.state} pct={entry.pct} error={entry.error} />
          </div>
          {(entry.state === 'uploading' || entry.state === 'processing') && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={
                  'h-full rounded-full transition-all ' +
                  (entry.state === 'processing' ? 'animate-pulse bg-amber-400' : 'bg-indigo-500')
                }
                style={{ width: entry.state === 'processing' ? '100%' : `${entry.pct}%` }}
              />
            </div>
          )}
          {r && (
            <div className="mt-2 text-xs text-slate-700">
              {r.duplicate ? (
                <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                  Already imported (receipt {r.receipt_id.slice(0, 8)}…)
                </span>
              ) : (
                <ResultSummary result={r} expanded={entry.expanded} onToggle={onToggle} />
              )}
            </div>
          )}
          {entry.error && (
            <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
              {entry.error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({
  state,
  pct,
  error,
}: {
  state: FileState
  pct: number
  error: string | null
}) {
  const map: Record<FileState, { label: string; cls: string }> = {
    queued: { label: 'Queued', cls: 'bg-slate-100 text-slate-700' },
    uploading: { label: `Uploading ${pct}%`, cls: 'bg-indigo-100 text-indigo-700' },
    processing: { label: 'Processing', cls: 'bg-amber-100 text-amber-800' },
    done: { label: 'Done', cls: 'bg-emerald-100 text-emerald-700' },
    error: { label: error ? 'Failed' : 'Error', cls: 'bg-rose-100 text-rose-700' },
  }
  const m = map[state]
  return (
    <span
      className={
        'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ' +
        m.cls
      }
    >
      {m.label}
    </span>
  )
}

function ResultSummary({
  result,
  expanded,
  onToggle,
}: {
  result: UploadResult
  expanded: boolean
  onToggle: () => void
}) {
  const s = result.summary
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <span className="font-medium text-slate-900">
            {result.store?.chain_name ?? 'unresolved store'}
          </span>
          {result.store?.store_address && (
            <span className="text-slate-500"> · {result.store.store_address}</span>
          )}
        </span>
        <span className="text-slate-700">
          {s.items_matched}/{s.items_compared} matched
        </span>
        <span className="text-slate-700">{s.observations_inserted} obs</span>
        <span className="text-slate-500 tabular-nums">
          ${s.total_extracted.toFixed(2)} extracted
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto text-indigo-700 hover:underline"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 overflow-hidden rounded border border-slate-200">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-left font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Type</th>
                <th className="px-2 py-1">Raw</th>
                <th className="px-2 py-1">Match</th>
                <th className="px-2 py-1 text-right">Shelf</th>
                <th className="px-2 py-1 text-right">Member</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((it) => (
                <tr key={it.idx} className="border-t border-slate-100">
                  <td className="px-2 py-1 align-top text-slate-500 tabular-nums">{it.idx}</td>
                  <td className="px-2 py-1 align-top text-slate-600">{it.item_type ?? '—'}</td>
                  <td className="px-2 py-1 align-top">
                    <div className="font-mono text-[11px] text-slate-700">{it.raw_text ?? ''}</div>
                    {it.description && it.description !== it.raw_text && (
                      <div className="text-[11px] text-slate-500">{it.description}</div>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top">
                    {it.match ? (
                      <div>
                        <div className="text-slate-900">{it.match.name}</div>
                        <div className="text-[11px] text-slate-500">
                          score {it.match.score.toFixed(2)}
                          {it.match.review_decision ? ` · ${it.match.review_decision}` : ''}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">no match</span>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top text-right tabular-nums">
                    {it.shelf_price != null ? `$${Number(it.shelf_price).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-2 py-1 align-top text-right tabular-nums">
                    {it.member_price != null ? `$${Number(it.member_price).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
