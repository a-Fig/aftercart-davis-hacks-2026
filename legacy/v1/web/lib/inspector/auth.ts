/**
 * Inspector access guard.
 *
 * Single shared password gate — set via INSPECTOR_PASSWORD (env or Secret
 * Manager binding). The /inspect/api/login route POSTs the user-typed password,
 * compares to the env value, and (on success) sets an `inspector_session`
 * cookie containing the same password value (httpOnly + Secure + 30 days).
 *
 * inspectorGuard() runs at the top of every /inspect/* server component.
 * It throws a redirect when the cookie is missing/wrong — so callers must
 * call it BEFORE any DB query, never inside try/catch that would swallow it.
 *
 * Why we keep the cookie value identical to the password rather than a random
 * session token: the inspector is a single-shared-password admin tool. There
 * is no per-user session state to look up, no logout-everywhere requirement,
 * and no DB table for sessions. Comparing the cookie to env directly is the
 * simplest possible thing that's secure given httpOnly + Secure flags.
 *
 * If INSPECTOR_PASSWORD is unset, the guard fails closed (redirects to login).
 * The login page itself shows a clear error in that case so the operator knows
 * to set the env var.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const INSPECTOR_COOKIE = 'inspector_session'

/** True iff INSPECTOR_PASSWORD env var is set to a non-empty value. */
export function isInspectorConfigured(): boolean {
  const pw = process.env.INSPECTOR_PASSWORD
  return typeof pw === 'string' && pw.length > 0
}

/**
 * Verify the request carries a valid inspector_session cookie.
 * Returns true on match, false otherwise. Does not redirect — pure check.
 */
export async function isInspectorAuthed(): Promise<boolean> {
  const expected = process.env.INSPECTOR_PASSWORD
  if (!expected) return false
  const jar = await cookies()
  const got = jar.get(INSPECTOR_COOKIE)?.value
  if (!got) return false
  // Constant-time-ish compare. The values here are short and the threat
  // model is "someone with no credentials guesses the cookie" — the
  // httpOnly+Secure flags do the heavy lifting. A timing leak on a
  // server-side cookie compare is not a realistic risk for this tool.
  return got === expected
}

/**
 * Guard helper for server components. Redirects to /inspect/login when the
 * cookie is missing, wrong, or the env var is unset. Call FIRST in every
 * /inspect/* server component, before touching the DB.
 *
 *   export default async function Page() {
 *     await inspectorGuard()
 *     const data = await query(...)
 *     ...
 *   }
 *
 * Returns void on success.
 */
export async function inspectorGuard(): Promise<void> {
  const ok = await isInspectorAuthed()
  if (!ok) redirect('/inspect/login')
}
