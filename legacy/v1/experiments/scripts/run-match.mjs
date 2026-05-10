/**
 * Match every parsed item from parse-v2 output against canonical_products
 * with both matchers (v1 from web/lib, v2 in-memory normalized) and report
 * the side-by-side comparison.
 *
 * Run from repo root:
 *   node experiments/scripts/run-match.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// Load web/.env.local manually so the DB and embedder can connect — no
// dotenv dep at the repo root.
for (const line of readFileSync(resolve(ROOT, 'web', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq === -1) continue
  const k = t.slice(0, eq).trim()
  const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  if (!process.env[k]) process.env[k] = v
}

// v1 = frozen pre-rollout matcher; v2 = current production matcher.
const { matchItems: matchV1 } = await import('../lib/match-v1-archived.mjs')
const { matchItems: matchV2 } = await import('../../web/lib/receipts/match.mjs')
const { getPool } = await import('../../web/lib/receipts/db.mjs')

const PARSE_OUT = resolve(__dirname, '..', 'tmp', 'parse-v2-output')
const files = readdirSync(PARSE_OUT).filter((f) => f.endsWith('.json')).sort()

let v1Matches = 0
let v2Matches = 0
let v1MatchesGoodScore = 0
let v2MatchesGoodScore = 0
let totalCompareItems = 0
let v1TotalMs = 0
let v2TotalMs = 0

for (const f of files) {
  const stem = f.replace('.json', '')
  const parsed = JSON.parse(readFileSync(join(PARSE_OUT, f), 'utf8'))
  const items = (parsed.items ?? []).filter((it) => (it.item_type ?? 'compare') === 'compare')
  if (items.length === 0) continue
  totalCompareItems += items.length

  const t0 = Date.now()
  const v1 = await matchV1(items)
  const v1Ms = Date.now() - t0
  v1TotalMs += v1Ms

  const t1 = Date.now()
  const v2 = await matchV2(items)
  const v2Ms = Date.now() - t1
  v2TotalMs += v2Ms

  console.log(`\n── ${stem} (${parsed.store_name}) — v1: ${v1Ms}ms, v2: ${v2Ms}ms`)
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const m1 = v1[i]?.match
    const m2 = v2[i]?.match
    if (m1) v1Matches++
    if (m2) v2Matches++
    if (m1 && m1.score >= 0.5) v1MatchesGoodScore++
    if (m2 && m2.score >= 0.5) v2MatchesGoodScore++

    const desc = (it.description || '').padEnd(28).slice(0, 28)
    const v1Tag = m1 ? `${m1.name.slice(0, 22).padEnd(22)} s=${m1.score.toFixed(2)}` : 'no match'.padEnd(30)
    const v2Tag = m2 ? `${m2.name.slice(0, 22).padEnd(22)} s=${m2.score.toFixed(2)}` : 'no match'.padEnd(30)
    const flag = (m1?.canonical_id !== m2?.canonical_id) ? ' DIFF' : ''
    console.log(`  ${desc} | v1: ${v1Tag} | v2: ${v2Tag}${flag}`)
  }
}

console.log(`\n────────────────────────`)
console.log(`Total compare items: ${totalCompareItems}`)
console.log(`v1 matches:          ${v1Matches}/${totalCompareItems}  (${((v1Matches/totalCompareItems)*100).toFixed(1)}%)`)
console.log(`v2 matches:          ${v2Matches}/${totalCompareItems}  (${((v2Matches/totalCompareItems)*100).toFixed(1)}%)`)
console.log(`v1 score≥0.5:        ${v1MatchesGoodScore}/${totalCompareItems}`)
console.log(`v2 score≥0.5:        ${v2MatchesGoodScore}/${totalCompareItems}`)
console.log(`v1 total time:       ${v1TotalMs}ms`)
console.log(`v2 total time:       ${v2TotalMs}ms`)

const pool = getPool()
await pool.end()
