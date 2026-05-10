'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  storeId: number
  mode: 'shelf_tag' | 'wide_shot'
  label: string
  icon: string
  contributorHandle?: string | null
}

export function CaptureButton({ storeId, mode, label, icon, contributorHandle }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    setProgress('Uploading photo...')

    const fd = new FormData()
    fd.append('photo', file)
    fd.append('store_id', String(storeId))
    fd.append('mode', mode)
    if (contributorHandle) fd.append('contributor_handle', contributorHandle)

    try {
      setProgress('Reading prices...')
      const res = await fetch('/api/field/photo', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }
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
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            handleFile(file)
            // Reset so picking the same file twice still fires onChange.
            e.target.value = ''
          }
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={`w-full h-20 rounded-xl flex items-center justify-center gap-3 text-lg font-medium transition ${
          busy
            ? 'bg-zinc-800 text-zinc-500 cursor-wait'
            : mode === 'shelf_tag'
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
            : 'bg-sky-600 hover:bg-sky-500 text-white'
        }`}
      >
        <span aria-hidden className="text-2xl">{icon}</span>
        <span>{busy ? progress || 'Working...' : label}</span>
      </button>
      {error && (
        <div className="mt-2 text-sm text-rose-400 bg-rose-950/40 border border-rose-900 rounded-md p-2">
          {error}
        </div>
      )}
    </div>
  )
}
