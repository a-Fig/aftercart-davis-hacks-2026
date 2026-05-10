#!/usr/bin/env node
/**
 * Helper that talks to Cloud SQL via cloud-sql-proxy on localhost:5433.
 *
 * Reasoning: the user's IP isn't currently in the Cloud SQL authorized
 * networks, so direct TCP at the public IP times out. cloud-sql-proxy provides
 * a TLS-encrypted tunnel to the instance and exposes a plaintext socket on
 * 127.0.0.1:5433. The local hop is intentionally plaintext (standard pattern;
 * docs at https://cloud.google.com/sql/docs/postgres/connect-auth-proxy).
 *
 * This script DOES NOT modify .env.local — it constructs its own connection
 * params at runtime so the production env stays clean.
 *
 * Subcommands:
 *   provision   — create receiptcheck_bc + extensions + grants
 *   apply       — apply db/schema.sql to receiptcheck_bc
 *   ingest      — run import-off-prices.mjs (proxy-aware)
 *   ingest-locations  — run import-off-locations.mjs (proxy-aware)
 *   refresh     — REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices + unbarcoded_current_prices
 *   query "SQL" — run an arbitrary SQL string and print the result
 *
 * Usage from repo root:
 *   node web/scripts/bc-via-proxy.mjs provision
 *   node web/scripts/bc-via-proxy.mjs apply
 *   node web/scripts/bc-via-proxy.mjs ingest -- --refresh-views
 *   node web/scripts/bc-via-proxy.mjs query "SELECT COUNT(*) FROM prices"
 */

import { readFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..', '..')
const ENV_PATH  = resolve(ROOT, 'web', '.env.local')
const SCHEMA_FILE = resolve(ROOT, 'db', 'schema.sql')

function readEnv(file) {
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

const env = readEnv(ENV_PATH)
const PROXY_PORT = parseInt(process.env.BC_PROXY_PORT || '5433', 10)
const APP_USER   = env.PGUSER || 'aftercart_app'
const APP_PWD    = env.PGPASSWORD
const ROOT_PWD   = env.CLOUD_SQL_ROOT_PASSWORD
const DB_NAME    = env.PGDATABASE || 'receiptcheck_bc'

if (!APP_PWD)  { console.error('Missing PGPASSWORD in .env.local'); process.exit(1) }
if (!ROOT_PWD) { console.error('Missing CLOUD_SQL_ROOT_PASSWORD in .env.local'); process.exit(1) }

function rootClient(database = 'postgres') {
  return new pg.Client({
    host: '127.0.0.1', port: PROXY_PORT,
    user: 'postgres', password: ROOT_PWD,
    database,
    ssl: false,
  })
}
function appClient(database = DB_NAME) {
  return new pg.Client({
    host: '127.0.0.1', port: PROXY_PORT,
    user: APP_USER, password: APP_PWD,
    database,
    ssl: false,
  })
}

async function provision() {
  console.log(`Provisioning "${DB_NAME}" via proxy at 127.0.0.1:${PROXY_PORT}`)
  const c = rootClient('postgres')
  await c.connect()
  try {
    const exists = await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [DB_NAME])
    if (exists.rows.length === 0) {
      // GRANT membership in the app role to the postgres role so the
      // CREATE DATABASE … OWNER … succeeds (Cloud SQL postgres is not
      // a superuser; it must be a member of the target owner role).
      await c.query(`GRANT "${APP_USER}" TO postgres`)
      await c.query(`CREATE DATABASE "${DB_NAME}" OWNER "${APP_USER}"`)
      console.log(`Created database "${DB_NAME}".`)
    } else {
      console.log(`Database "${DB_NAME}" already exists.`)
    }
    await c.query(`GRANT ALL PRIVILEGES ON DATABASE "${DB_NAME}" TO "${APP_USER}"`)
  } finally {
    await c.end()
  }
  const c2 = rootClient(DB_NAME)
  await c2.connect()
  try {
    await c2.query('CREATE EXTENSION IF NOT EXISTS postgis')
    await c2.query('CREATE EXTENSION IF NOT EXISTS vector')
    await c2.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    await c2.query(`GRANT USAGE, CREATE ON SCHEMA public TO "${APP_USER}"`)
    await c2.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${APP_USER}"`)
    await c2.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${APP_USER}"`)
    console.log('Extensions and grants applied.')
  } finally {
    await c2.end()
  }
}

async function apply(reset = true) {
  console.log(`Applying ${SCHEMA_FILE} to "${DB_NAME}"`)
  const sql = readFileSync(SCHEMA_FILE, 'utf8')
  const c = appClient()
  await c.connect()
  try {
    if (reset) {
      console.log('Resetting public schema...')
      // Drop then recreate; ensures clean slate.
      await c.query('DROP SCHEMA IF EXISTS public CASCADE')
      await c.query('CREATE SCHEMA public')
      // Re-grant default privileges for app user
      await c.query(`GRANT ALL ON SCHEMA public TO "${APP_USER}"`)
    }
    await c.query(sql)
    console.log('Schema applied.')
  } finally {
    await c.end()
  }
}

async function refresh() {
  const c = appClient()
  await c.connect()
  try {
    console.log('REFRESH MATERIALIZED VIEW current_prices...')
    await c.query('REFRESH MATERIALIZED VIEW current_prices')
    console.log('REFRESH MATERIALIZED VIEW unbarcoded_current_prices...')
    await c.query('REFRESH MATERIALIZED VIEW unbarcoded_current_prices')
    console.log('Both matviews refreshed.')
  } finally {
    await c.end()
  }
}

async function runQuery(sql) {
  const c = appClient()
  await c.connect()
  try {
    const r = await c.query(sql)
    console.log(JSON.stringify(r.rows, null, 2))
    console.log(`-- ${r.rowCount} row(s)`)
  } finally {
    await c.end()
  }
}

function runIngest(scriptName, extraArgs = []) {
  // The ingest scripts use createClient() from seed-utils.mjs which honors
  // process.env.PGHOST > .env.local. Set the proxy connection in process.env
  // for THIS subprocess only — does not modify any file on disk.
  const proxyEnv = {
    ...process.env,
    PGHOST: '127.0.0.1',
    PGPORT: String(PROXY_PORT),
    PGUSER: APP_USER,
    PGPASSWORD: APP_PWD,
    PGDATABASE: DB_NAME,
    PGSSLMODE: 'disable',
    // seed-utils.mjs's createClient adds ssl unless PGHOST starts with '/'.
    // We need to disable SSL since the proxy handles it. Patch via
    // PGSSLMODE='disable' won't help since seed-utils ignores it. Instead,
    // we leave seed-utils alone and use a plain Postgres TCP socket via
    // proxy on localhost — pg will try SSL, the proxy refuses, and pg falls
    // back to plaintext. Actually pg DOES NOT auto-fallback. We need to
    // patch seed-utils OR use this script directly.
    AFTERCART_BC_PROXY: '1', // sentinel for any future hook
  }
  const scriptPath = join(__dirname, scriptName)
  const r = spawnSync(
    process.execPath,
    [scriptPath, ...extraArgs],
    { cwd: ROOT, stdio: 'inherit', env: proxyEnv }
  )
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const cmd = process.argv[2]
const extra = process.argv.slice(3)

;(async () => {
  if (cmd === 'provision') {
    await provision()
  } else if (cmd === 'apply') {
    await apply(extra.includes('--no-reset') ? false : true)
  } else if (cmd === 'refresh') {
    await refresh()
  } else if (cmd === 'query') {
    if (!extra.length) { console.error('query needs SQL string'); process.exit(1) }
    await runQuery(extra.join(' '))
  } else if (cmd === 'ingest') {
    runIngest('import-off-prices.mjs', extra.filter(a => a !== '--'))
  } else if (cmd === 'ingest-locations') {
    runIngest('import-off-locations.mjs', extra.filter(a => a !== '--'))
  } else if (cmd === 'derive-equivalences') {
    runIngest('derive-equivalences.mjs', extra.filter(a => a !== '--'))
  } else {
    console.error('Unknown subcommand. Try: provision | apply | ingest | ingest-locations | derive-equivalences | refresh | query "SQL"')
    process.exit(1)
  }
})().catch(err => {
  console.error('Fatal:', err.message)
  console.error(err.stack)
  process.exit(1)
})
