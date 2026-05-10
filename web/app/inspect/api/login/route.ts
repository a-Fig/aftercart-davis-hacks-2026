/**
 * POST /inspect/api/login
 *
 * Body: { password: string }
 * On match (compared to INSPECTOR_PASSWORD env): sets the
 * `inspector_session` cookie (httpOnly, Secure in prod, 30d) and returns 200.
 * On mismatch or missing env: returns 401.
 *
 * The cookie value is the password itself — see web/lib/inspector/auth.ts
 * for the rationale (single shared password, no per-user session state).
 */

import { cookies } from 'next/headers'
import { INSPECTOR_COOKIE } from '@/lib/inspector/auth'

export const runtime = 'nodejs'

const THIRTY_DAYS = 60 * 60 * 24 * 30

export async function POST(req: Request) {
  const expected = process.env.INSPECTOR_PASSWORD
  if (!expected) {
    return Response.json(
      { error: 'Server misconfigured: INSPECTOR_PASSWORD is not set.' },
      { status: 500 },
    )
  }

  let body: { password?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const provided = typeof body?.password === 'string' ? body.password : ''
  if (!provided || provided !== expected) {
    return Response.json({ error: 'Wrong password.' }, { status: 401 })
  }

  const jar = await cookies()
  jar.set({
    name: INSPECTOR_COOKIE,
    value: provided,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS,
  })

  return Response.json({ ok: true })
}
