/**
 * One-shot Cloud SQL bootstrap. Run AFTER `gcloud sql instances create`
 * and AFTER `gcloud sql databases create receiptcheck` and
 * `gcloud sql users create aftercart_app`.
 *
 *   1. Connect as the `postgres` superuser
 *   2. Enable extensions (postgis, vector, pg_trgm, pgcrypto)
 *   3. Grant ALL on schema public to the app user
 *   4. Disconnect, reconnect as the app user, apply db/schema.sql
 *
 * Required env (from web/.env.local or process.env):
 *   PGHOST, PGUSER (=aftercart_app), PGPASSWORD (app pw),
 *   PGDATABASE (=receiptcheck), CLOUD_SQL_ROOT_PASSWORD
 *
 * Usage (from repo root):
 *   node web/scripts/bootstrap-cloudsql.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// Read web/.env.local into process.env (without overwriting existing values)
function loadEnvFile() {
  const envPath = resolve(__dirname, '..', '.env.local')
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      if (process.env[key]) continue
      process.env[key] = t.slice(eq + 1).trim()
    }
  } catch {
    // .env.local missing is fine on CI / Cloud Run
  }
}
loadEnvFile()

const PGHOST = process.env.PGHOST
const PGUSER = process.env.PGUSER
const PGPASSWORD = process.env.PGPASSWORD
const PGDATABASE = process.env.PGDATABASE
const ROOT_PW = process.env.CLOUD_SQL_ROOT_PASSWORD

if (!PGHOST) throw new Error('PGHOST not set')
if (!PGUSER) throw new Error('PGUSER not set')
if (!PGPASSWORD) throw new Error('PGPASSWORD not set')
if (!PGDATABASE) throw new Error('PGDATABASE not set')
if (!ROOT_PW) throw new Error('CLOUD_SQL_ROOT_PASSWORD not set')

const isUnixSocket = PGHOST.startsWith('/')

function makeClient(user, password) {
  if (isUnixSocket) {
    return new Client({ host: PGHOST, user, password, database: PGDATABASE })
  }
  return new Client({
    host: PGHOST,
    port: parseInt(process.env.PGPORT || '5432', 10),
    user,
    password,
    database: PGDATABASE,
    ssl: { rejectUnauthorized: false },
  })
}

// ── Step 1+2+3: extensions + grant, as root ────────────────────────────────
const root = makeClient('postgres', ROOT_PW)
await root.connect()
console.log(`Connected as postgres to ${PGHOST}/${PGDATABASE}`)

const extensions = ['postgis', 'vector', 'pg_trgm', 'pgcrypto']
for (const ext of extensions) {
  await root.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`)
  console.log(`  ✓ extension ${ext}`)
}

await root.query(`GRANT ALL ON SCHEMA public TO ${PGUSER}`)
console.log(`  ✓ granted ALL on schema public to ${PGUSER}`)

await root.end()

// ── Step 4: apply schema as the app user ───────────────────────────────────
const app = makeClient(PGUSER, PGPASSWORD)
await app.connect()
console.log(`\nConnected as ${PGUSER} to ${PGHOST}/${PGDATABASE}`)

const schemaPath = resolve(ROOT, 'db', 'schema.sql')
const sql = readFileSync(schemaPath, 'utf8')
console.log(`Applying ${schemaPath}...`)
await app.query(sql)
console.log('✓ Schema applied successfully.')

// Sanity verification
const exts = await app.query(
  `SELECT extname FROM pg_extension WHERE extname IN ('postgis','vector','pg_trgm','pgcrypto') ORDER BY extname`,
)
const tables = await app.query(
  `SELECT count(*)::int FROM pg_tables WHERE schemaname='public'`,
)
const matviews = await app.query(
  `SELECT matviewname FROM pg_matviews WHERE schemaname='public'`,
)
console.log(`\nExtensions: ${exts.rows.map((r) => r.extname).join(', ')}`)
console.log(`Tables in public: ${tables.rows[0].count}`)
console.log(`Materialized views: ${matviews.rows.map((r) => r.matviewname).join(', ') || '(none)'}`)

await app.end()
