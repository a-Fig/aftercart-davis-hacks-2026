#!/usr/bin/env node
/**
 * One-shot provisioner for the AfterCart-BC variant database.
 *
 * Connects to the shared Cloud SQL instance as the postgres superuser, creates
 * a NEW logical database `receiptcheck_bc`, and grants ownership to the app
 * user `aftercart_app`. Idempotent: skips if the DB already exists.
 *
 * Reads CLOUD_SQL_ROOT_PASSWORD + PGHOST + PGPORT + PGUSER from web/.env.local.
 *
 * Usage (from repo root):
 *   node web/scripts/provision-bc-db.mjs
 *
 * After this, `node web/scripts/apply-schema.mjs --reset` applies schema.sql
 * to receiptcheck_bc.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const ENV_PATH = resolve(ROOT, 'web', '.env.local')

function readEnv(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const env = {}
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return env
}

const env = readEnv(ENV_PATH)
const PGHOST     = env.PGHOST     || process.env.PGHOST
const PGPORT     = parseInt(env.PGPORT || process.env.PGPORT || '5432', 10)
const APP_USER   = env.PGUSER     || 'aftercart_app'
const ROOT_PWD   = env.CLOUD_SQL_ROOT_PASSWORD || process.env.CLOUD_SQL_ROOT_PASSWORD
const NEW_DB     = env.PGDATABASE || 'receiptcheck_bc'

if (!PGHOST || !ROOT_PWD) {
  console.error('Missing PGHOST or CLOUD_SQL_ROOT_PASSWORD in web/.env.local')
  process.exit(1)
}

const client = new pg.Client({
  host: PGHOST,
  port: PGPORT,
  user: 'postgres',
  password: ROOT_PWD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

async function main() {
  console.log(`Provisioning database "${NEW_DB}" on ${PGHOST}:${PGPORT}`)
  await client.connect()
  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [NEW_DB]
    )
    if (exists.rows.length > 0) {
      console.log(`Database "${NEW_DB}" already exists. Skipping CREATE.`)
    } else {
      console.log(`Creating database "${NEW_DB}" with owner ${APP_USER}...`)
      // pg can't parameterize identifiers; the values are validated above.
      await client.query(`CREATE DATABASE "${NEW_DB}" OWNER "${APP_USER}"`)
      console.log('Created.')
    }
    // Make sure aftercart_app can connect + create extensions in the new DB.
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE "${NEW_DB}" TO "${APP_USER}"`)
    console.log(`Granted privileges to ${APP_USER}.`)
  } finally {
    await client.end()
  }

  // Connect to the new database as postgres to ensure extensions are
  // installable by the app user (pg_trgm etc. need superuser on first
  // CREATE EXTENSION). We pre-create them here as superuser.
  const newDbClient = new pg.Client({
    host: PGHOST,
    port: PGPORT,
    user: 'postgres',
    password: ROOT_PWD,
    database: NEW_DB,
    ssl: { rejectUnauthorized: false },
  })
  await newDbClient.connect()
  try {
    await newDbClient.query('CREATE EXTENSION IF NOT EXISTS postgis')
    await newDbClient.query('CREATE EXTENSION IF NOT EXISTS vector')
    await newDbClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    await newDbClient.query(`GRANT USAGE, CREATE ON SCHEMA public TO "${APP_USER}"`)
    await newDbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${APP_USER}"`)
    await newDbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${APP_USER}"`)
    console.log('Extensions and grants applied to the new database.')
  } finally {
    await newDbClient.end()
  }

  console.log('\nDone. Next: node web/scripts/apply-schema.mjs --reset')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
