'use client'

/**
 * Client-side login form. POSTs the password to /inspect/api/login as JSON,
 * follows up with window.location.assign on success so the new cookie is
 * present on the very next request.
 *
 * Server-side validation is in /inspect/api/login/route.ts — this is purely
 * UX (no client-side password compare).
 */

import { useState, FormEvent } from 'react'

export default function LoginForm() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/inspect/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        // Hard navigation so SSR sees the new cookie immediately.
        window.location.assign('/inspect')
        return
      }
      const data = await res.json().catch(() => ({}) as { error?: string })
      setError(data?.error ?? `Sign-in failed (${res.status}).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Password</span>
        <input
          type="password"
          autoFocus
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
