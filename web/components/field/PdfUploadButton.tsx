'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  storeId: number
  contributorHandle?: string | null
}

/**
 * Desktop-friendly PDF upload control. Drag-and-drop area + click-to-pick
 * fallback. Posts to the same /api/field/photo endpoint as the photo
 * capture buttons but with mode='online_pdf' and accept='application/pdf'.
 *
 * On success, navigates to /field/upload/[id] for review of the extracted
 * observations (often 30-50 per PDF).
 */
export function PdfUploadButton({ storeId, contributorHandle }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(file: File) {
    if (file.type !== 'application/pdf') {
      setError(`Need a PDF — got "${file.type || 'unknown'}".`)
      return
    }
    setError(null)
    setBusy(true)
    setProgress('Uploading PDF...')

    const fd = new FormData()
    fd.append('photo', file)
    fd.append('store_id', String(storeId))
    fd.append('mode', 'online_pdf')
    if (contributorHandle) fd.append('contributor_handle', contributorHandle)

    try {
      setProgress('Reading inventory page (this can take 30-60s)...')
      const res = await fetch('/api/field/photo', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const uploadId = data?.upload?.upload_id
      if (!uploadId) throw new Error('Upload succeeded but no upload_id returned')
      router.push(`/field/upload/${uploadId}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
      setProgress('')
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            handleFile(file)
            e.target.value = ''
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (busy) return
          const file = e.dataTransfer.files?.[0]
          if (file) handleFile(file)
        }}
        className={`w-full min-h-[96px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition px-4 py-3 ${
          busy
            ? 'border-zinc-700 bg-zinc-900 text-zinc-500 cursor-wait'
            : dragOver
            ? 'border-violet-400 bg-violet-950/30 text-violet-200'
            : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-violet-500 hover:bg-violet-950/20 hover:text-violet-200'
        }`}
      >
        <span aria-hidden className="text-2xl">📄</span>
        <span className="text-base font-medium">
          {busy ? progress || 'Working...' : 'Upload inventory PDF'}
        </span>
        {!busy && (
          <span className="text-xs text-zinc-500">
            Drag a PDF here, or click to pick. Up to ~50 products per page.
          </span>
        )}
      </button>
      {error && (
        <div className="mt-2 text-sm text-rose-400 bg-rose-950/40 border border-rose-900 rounded-md p-2">
          {error}
        </div>
      )}
    </div>
  )
}
