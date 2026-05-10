/**
 * End-to-end pipeline runner — compares two pipelines on the test set:
 *
 *   A) BASELINE: Vision OCR → web/lib/receipts/parse.mjs (heuristic v1) →
 *                web/lib/receipts/match.mjs (DB-side blended)
 *   B) EXPERIMENT: Vision OCR → experiments/lib/parse-v2.mjs →
 *                experiments/lib/match-v2.mjs (in-memory normalized)
 *
 * Both use the same Vision OCR cache, so OCR latency is excluded from the
 * comparison — only parse + match time is measured. The Vision call itself
 * is identical in either pipeline so the full-pipeline latency just adds a
 * constant ~1-2s for the API call.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

for (const line of readFileSync(resolve(ROOT, 'web', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq === -1) continue
  if (!process.env[t.slice(0, eq).trim()]) {
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  }
}

const { parseReceipt: parseV1 } = await import('../lib/parse-v1-archived.mjs')
const { parseReceipt: parseV2 } = await import('../../web/lib/receipts/parse.mjs')
const { matchItems: matchV1 } = await import('../lib/match-v1-archived.mjs')
const { matchItems: matchV2 } = await import('../../web/lib/receipts/match.mjs')
const { getPool } = await import('../../web/lib/receipts/db.mjs')
const { scoreReceipt, aggregateScores, formatTable } = await import('../lib/score.mjs')

const CACHE_DIR = resolve(ROOT, 'tmp', 'ocr-cache')
const PHOTOS = resolve(ROOT, 'receipt photos')
const GT_DIR = resolve(__dirname, '..', 'ground-truth')
const REPORT_DIR = resolve(__dirname, '..', 'tmp')

// ── Parse-v1 result → score-compatible shape ────────────────────────────
function adaptV1(h) {
  return {
    store_name: h.store?.name ?? null,
    store_address: h.store?.address ?? null,
    receipt_date: h.dated_at ?? null,
    receipt_total: h.total ?? null,
    item_count: null,
    items: (h.items ?? []).map((it) => {
      const member = it.total_price
      const shelf = it.total_price != null && it.discount != null
        ? +(it.total_price - it.discount).toFixed(2)
        : it.total_price
      return {
        raw_text: it.raw_text,
        description: it.description,
        code: it.identifier,
        quantity: it.quantity,
        unit: it.unit,
        shelf_price: shelf,
        member_price: member,
        item_type: 'compare',
      }
    }),
  }
}

const truthFiles = readdirSync(GT_DIR).filter((f) => f.endsWith('.json')).sort()

const v1Scores = []
const v2Scores = []
let v1ParseMs = 0, v2ParseMs = 0
let v1MatchMs = 0, v2MatchMs = 0
let v1Matches = 0, v2Matches = 0
let totalCompare = 0

for (const tf of truthFiles) {
  const truth = JSON.parse(readFileSync(join(GT_DIR, tf), 'utf8'))
  const stem = tf.replace('.json', '')
  const imgPath = findPhoto(stem)
  if (!imgPath) continue
  const bytes = readFileSync(imgPath)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const cachePath = join(CACHE_DIR, `${hash}.json`)
  if (!existsSync(cachePath)) {
    console.log(`SKIP ${stem}: no Vision cache`)
    continue
  }
  const text = JSON.parse(readFileSync(cachePath, 'utf8')).responses?.[0]?.fullTextAnnotation?.text || ''

  // Parse — both pipelines.
  const t0 = Date.now()
  const a = parseV1(text)
  const v1ParseT = Date.now() - t0
  const adaptedV1 = adaptV1(a)
  v1ParseMs += v1ParseT

  const t1 = Date.now()
  const v2Parsed = parseReceiptV2(text)
  const v2ParseT = Date.now() - t1
  v2ParseMs += v2ParseT

  // Match — both pipelines.
  const v1Items = adaptedV1.items.map((it) => ({ ...it, item_type: 'compare' }))
  const v2Items = (v2Parsed.items ?? []).filter((it) => (it.item_type ?? 'compare') === 'compare')

  const t2 = Date.now()
  const v1MatchResults = await matchV1(v1Items)
  const v1MatchT = Date.now() - t2
  v1MatchMs += v1MatchT

  const t3 = Date.now()
  const v2MatchResults = await matchV2(v2Items)
  const v2MatchT = Date.now() - t3
  v2MatchMs += v2MatchT

  const v1MatchCount = v1MatchResults.filter((r) => r.match).length
  const v2MatchCount = v2MatchResults.filter((r) => r.match).length
  v1Matches += v1MatchCount
  v2Matches += v2MatchCount
  totalCompare += v2Items.length

  const v1Score = scoreReceipt(adaptedV1, truth)
  const v2Score = scoreReceipt(v2Parsed, truth)
  v1Score._parse_ms = v1ParseT
  v1Score._match_ms = v1MatchT
  v1Score._match_rate = v1Items.length > 0 ? v1MatchCount / v1Items.length : 0
  v2Score._parse_ms = v2ParseT
  v2Score._match_ms = v2MatchT
  v2Score._match_rate = v2Items.length > 0 ? v2MatchCount / v2Items.length : 0
  v1Scores.push(v1Score)
  v2Scores.push(v2Score)
}

console.log('\n===== BASELINE: Vision + parse-v1 + match-v1 =====\n')
console.log(formatTable(v1Scores, aggregateScores(v1Scores)))
console.log(`\nparse:  ${v1ParseMs}ms total`)
console.log(`match:  ${v1MatchMs}ms total`)
console.log(`item match rate: ${v1Matches}/${totalCompare} (${((v1Matches/totalCompare)*100).toFixed(1)}%)`)

console.log('\n===== EXPERIMENT: Vision + parse-v2 + match-v2 =====\n')
console.log(formatTable(v2Scores, aggregateScores(v2Scores)))
console.log(`\nparse:  ${v2ParseMs}ms total`)
console.log(`match:  ${v2MatchMs}ms total`)
console.log(`item match rate: ${v2Matches}/${totalCompare} (${((v2Matches/totalCompare)*100).toFixed(1)}%)`)

console.log('\n===== Δ summary =====')
const v1Agg = aggregateScores(v1Scores)
const v2Agg = aggregateScores(v2Scores)
function fmtDelta(label, v1, v2, max) {
  const d = v2 - v1
  const arrow = d > 0 ? '↑' : (d < 0 ? '↓' : '·')
  const pct = max ? `  (${((v1/max)*100).toFixed(1)}% → ${((v2/max)*100).toFixed(1)}%)` : ''
  console.log(`  ${label.padEnd(28)} ${String(v1).padStart(3)} → ${String(v2).padStart(3)}  ${arrow} ${(d > 0 ? '+' : '') + d}${pct}`)
}
fmtDelta('item recall',           v1Agg.items_matched,            v2Agg.items_matched,            v1Agg.truth_items)
fmtDelta('price accuracy',        v1Agg.items_with_correct_price, v2Agg.items_with_correct_price, v1Agg.truth_items)
fmtDelta('code accuracy',         v1Agg.items_with_correct_code,  v2Agg.items_with_correct_code,  v1Agg.truth_items)
fmtDelta('quantity accuracy',     v1Agg.items_with_correct_quantity, v2Agg.items_with_correct_quantity, v1Agg.truth_items)
fmtDelta('store name detected',   v1Agg.store_name_ok,            v2Agg.store_name_ok,            v1Agg.receipts)
fmtDelta('receipt total detected', v1Agg.receipt_total_ok,        v2Agg.receipt_total_ok,         v1Agg.receipts)
fmtDelta('spurious items',        v1Agg.spurious_items,           v2Agg.spurious_items)
console.log()
console.log(`  parse latency               ${v1ParseMs}ms → ${v2ParseMs}ms  (${v2ParseMs < v1ParseMs ? 'faster' : 'slower'})`)
console.log(`  match latency               ${v1MatchMs}ms → ${v2MatchMs}ms  (${v2MatchMs < v1MatchMs ? 'faster' : 'slower'})`)
console.log(`  total post-OCR latency      ${v1ParseMs+v1MatchMs}ms → ${v2ParseMs+v2MatchMs}ms`)
console.log(`  match rate                  ${v1Matches}/${totalCompare} → ${v2Matches}/${totalCompare}`)

mkdirSync(REPORT_DIR, { recursive: true })
writeFileSync(
  join(REPORT_DIR, 'end-to-end-report.json'),
  JSON.stringify({
    baseline: { scores: v1Scores, aggregate: v1Agg, parse_ms: v1ParseMs, match_ms: v1MatchMs, match_count: v1Matches },
    experiment: { scores: v2Scores, aggregate: v2Agg, parse_ms: v2ParseMs, match_ms: v2MatchMs, match_count: v2Matches },
    total_compare_items: totalCompare,
  }, null, 2),
)

await (await getPool()).end()

function findPhoto(stem) {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = join(PHOTOS, stem + ext)
    if (existsSync(p)) return p
  }
  return null
}
