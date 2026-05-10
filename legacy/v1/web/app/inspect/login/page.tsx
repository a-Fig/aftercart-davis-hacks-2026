/**
 * /inspect/login — single password field that POSTs to /inspect/api/login.
 *
 * This page intentionally does NOT call inspectorGuard() — it's the gate
 * itself. Renders an error notice if INSPECTOR_PASSWORD is unset (server-side
 * misconfiguration that would otherwise produce a confusing "wrong password"
 * loop).
 *
 * Server component shell + a small client form so we can do a fetch-based
 * POST and redirect on success without a full-page reload (avoids flashing
 * the login page when the cookie is set).
 */

import LoginForm from './LoginForm'
import { isInspectorConfigured } from '@/lib/inspector/auth'

export const runtime = 'nodejs'

export default function LoginPage() {
  const configured = isInspectorConfigured()
  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Inspector access</h1>
        <p className="mt-1 text-sm text-slate-600">
          Internal tool. Enter the shared inspector password to continue.
        </p>
        {!configured && (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            <strong>Server is not configured:</strong> the{' '}
            <code className="font-mono">INSPECTOR_PASSWORD</code> env var is unset. Sign-in
            will fail until it is set in <code className="font-mono">web/.env.local</code> (dev)
            or via Secret Manager binding (Cloud Run).
          </div>
        )}
        <LoginForm />
      </div>
    </div>
  )
}
