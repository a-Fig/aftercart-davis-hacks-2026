// Shared utilities for seed scripts. All seed scripts run from web/ (npm run scripts).
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SEED_DIR = resolve(ROOT, 'db', 'seed')

export function readEnv() {
  const envPath = resolve(ROOT, 'web', '.env.local')
  const lines = readFileSync(envPath, 'utf8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

export function parsePgUrl(url) {
  const noProto = url.replace(/^postgresql:\/\//, '')
  const lastAt = noProto.lastIndexOf('@')
  const credentials = noProto.slice(0, lastAt)
  const hostPart = noProto.slice(lastAt + 1)
  const colonIdx = credentials.indexOf(':')
  const user = credentials.slice(0, colonIdx)
  const password = credentials.slice(colonIdx + 1)
  const [hostPort, database] = hostPart.split('/')
  const [host, port] = hostPort.split(':')
  return { user, password, host, port: parseInt(port, 10), database }
}

export function toDirectParams(env) {
  // Short-circuit: if libpq env vars are set (post-GCP-migration world),
  // build params straight from them and skip Supabase derivation entirely.
  // process.env wins over the .env.local snapshot here so deploy-time
  // overrides actually reach the connection.
  if (process.env.PGHOST) {
    return {
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    }
  }
  if (env.SUPABASE_DIRECT_DB_URL) return parsePgUrl(env.SUPABASE_DIRECT_DB_URL)
  const refMatch = (env.NEXT_PUBLIC_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
  if (!refMatch) throw new Error('Cannot derive project ref from NEXT_PUBLIC_SUPABASE_URL')
  const poolerParams = parsePgUrl(env.SUPABASE_DB_URL)
  return { host: `db.${refMatch[1]}.supabase.co`, port: 5432, user: 'postgres', password: poolerParams.password, database: 'postgres' }
}

export function createClient() {
  const env = readEnv()
  const params = toDirectParams(env)
  // Unix-socket Cloud SQL connections (PGHOST=/cloudsql/...) do not use SSL
  // and pg refuses to negotiate it on a non-TCP socket. TCP connections
  // (Supabase, Cloud SQL public IP) still get the relaxed SSL.
  const isUnixSocket = typeof params.host === 'string' && params.host.startsWith('/')
  if (isUnixSocket) {
    const { port: _port, ...socketParams } = params
    return new pg.Client(socketParams)
  }
  return new pg.Client({ ...params, ssl: { rejectUnauthorized: false } })
}

export function esc(s) {
  if (s == null) return 'NULL'
  return `'${String(s).replace(/'/g, "''")}'`
}

export function fdcKey() {
  try {
    const env = readEnv()
    return env.FDC_API_KEY || 'DEMO_KEY'
  } catch {
    return process.env.FDC_API_KEY || 'DEMO_KEY'
  }
}

export async function fdcFetch(path, params = {}) {
  const url = new URL(`https://api.nal.usda.gov/fdc/v1${path}`)
  url.searchParams.set('api_key', fdcKey())
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`FDC ${path} HTTP ${res.status}`)
  return res.json()
}

export const delay = ms => new Promise(r => setTimeout(r, ms))
