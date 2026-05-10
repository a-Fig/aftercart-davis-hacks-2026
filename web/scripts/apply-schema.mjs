/**
 * Applies db/schema.sql to the Supabase Postgres database.
 * Reads SUPABASE_DB_URL from web/.env.local.
 *
 * Usage (from repo root):
 *   node web/scripts/apply-schema.mjs
 *
 * To wipe and reapply on a dev project:
 *   node web/scripts/apply-schema.mjs --reset
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// ── Parse env ──────────────────────────────────────────────────────────────

function readEnv(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    env[key] = value
  }
  return env
}

// ── Parse pg connection URL ─────────────────────────────────────────────────
// Handles passwords that contain '@' (Supabase-generated passwords often do).

function parsePgUrl(url) {
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

// Supabase pooler URLs fail for schema migrations ("Tenant or user not found").
// Derive the direct DB connection from the project URL or pooler URL.
function toDirectParams(env) {
  // Short-circuit: if libpq env vars are set (post-GCP-migration world),
  // build params straight from them. process.env wins over the .env.local
  // snapshot so deploy-time overrides reach the connection.
  if (process.env.PGHOST) {
    return {
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    }
  }

  // Prefer SUPABASE_DIRECT_DB_URL if explicitly set
  if (env.SUPABASE_DIRECT_DB_URL) return parsePgUrl(env.SUPABASE_DIRECT_DB_URL)

  // Derive project ref from the Supabase project URL
  // NEXT_PUBLIC_SUPABASE_URL = https://PROJECT_REF.supabase.co
  const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL || ''
  const refMatch = projectUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
  if (!refMatch) throw new Error('Cannot derive project ref from NEXT_PUBLIC_SUPABASE_URL')

  const projectRef = refMatch[1]

  // Extract password from the pooler URL (same password for direct connection)
  const poolerParams = parsePgUrl(env.SUPABASE_DB_URL)

  return {
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: poolerParams.password,
    database: 'postgres',
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const reset = process.argv.includes('--reset')
const envPath = resolve(__dirname, '..', '.env.local')
const schemaPath = resolve(ROOT, 'db', 'schema.sql')

let connParams
try {
  // If PGHOST is set (post-GCP-migration), skip the .env.local read entirely —
  // toDirectParams short-circuits on PGHOST so reading the file is unnecessary
  // and Cloud Run / CI environments may not have one.
  if (process.env.PGHOST) {
    connParams = toDirectParams({})
  } else {
    const env = readEnv(envPath)
    if (!env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is empty in .env.local')
    connParams = toDirectParams(env)
  }
} catch (err) {
  console.error(`Setup error: ${err.message}`)
  process.exit(1)
}

// Unix-socket Cloud SQL connections (PGHOST=/cloudsql/...) don't use SSL;
// pg refuses to negotiate it on a non-TCP socket. TCP gets the relaxed SSL.
const isUnixSocket = typeof connParams.host === 'string' && connParams.host.startsWith('/')
const client = isUnixSocket
  ? new Client({ host: connParams.host, user: connParams.user, password: connParams.password, database: connParams.database })
  : new Client({ ...connParams, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  console.log(`Connected to ${connParams.host}/${connParams.database}`)

  if (reset) {
    console.log('⚠️  --reset: dropping and recreating public schema...')
    await client.query('DROP SCHEMA public CASCADE')
    await client.query('CREATE SCHEMA public')
    console.log('Schema wiped.')
  }

  const sql = readFileSync(schemaPath, 'utf8')
  console.log(`Applying ${schemaPath}...`)
  await client.query(sql)
  console.log('✓  Schema applied successfully.')
} catch (err) {
  console.error('Failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
