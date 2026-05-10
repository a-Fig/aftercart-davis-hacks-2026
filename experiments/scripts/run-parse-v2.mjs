/**
 * Run the v2 parser on cached Vision OCR text and score against ground truth.
 *
 * Reads tmp/ocr-cache/<sha256>.json (Vision response) by hashing the receipt
 * image — same logic as web/scripts/ocr-receipts.mjs. No new API calls.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { resolve, dirname, join, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

import { parseReceipt as parseReceiptV2 } from '../../web/lib/receipts/parse.mjs'
import { scoreReceipt, aggregateScores, formatTable } from '../lib/score.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const CACHE_DIR = resolve(ROOT, 'tmp', 'ocr-cache')
const PHOTOS = resolve(ROOT, 'receipt photos')
const GT_DIR = resolve(__dirname, '..', 'ground-truth')
const REPORT_DIR = resolve(__dirname, '..', 'tmp')
const OUT_DIR = resolve(__dirname, '..', 'tmp', 'parse-v2-output')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(REPORT_DIR, { recursive: true })

const truthFiles = readdirSync(GT_DIR).filter((f) => f.endsWith('.json')).sort()
const scores = []

for (const tf of truthFiles) {
  const truth = JSON.parse(readFileSync(join(GT_DIR, tf), 'utf8'))
  const stem = tf.replace('.json', '')
  const imgPath = findPhoto(stem)
  if (!imgPath) {
    console.log(`SKIP ${stem}: no photo found`)
    continue
  }
  const bytes = readFileSync(imgPath)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const cachePath = join(CACHE_DIR, `${hash}.json`)
  if (!existsSync(cachePath)) {
    console.log(`SKIP ${stem}: no Vision cache at ${cachePath}`)
    continue
  }
  const visionResp = JSON.parse(readFileSync(cachePath, 'utf8'))
  const text = visionResp.responses?.[0]?.fullTextAnnotation?.text || ''

  const t0 = Date.now()
  const parsed = parseReceiptV2(text)
  const elapsed = Date.now() - t0

  writeFileSync(join(OUT_DIR, `${stem}.json`), JSON.stringify(parsed, null, 2))

  const score = scoreReceipt(parsed, truth)
  score._parse_ms = elapsed
  scores.push(score)
}

const agg = aggregateScores(scores)
console.log(formatTable(scores, agg))

writeFileSync(
  join(REPORT_DIR, 'parse-v2-report.json'),
  JSON.stringify({ scores, aggregate: agg }, null, 2),
)

console.log('\n── Per-receipt errors ──')
for (const s of scores) {
  if (s.missing_items.length === 0 && s.misparsed.length === 0 && s.spurious_items === 0) continue
  console.log(`\n${s.image} (parse=${s._parse_ms}ms)`)
  for (const m of s.missing_items) {
    console.log(`  MISSING:  ${m.keywords.join(' ')}  (paid $${m.price})`)
  }
  for (const m of s.misparsed.slice(0, 4)) {
    console.log(`  WRONG:    truth=[${m.truth.code ?? '-'}] ${m.truth.keywords.join(' ')} $${m.truth.price}  →  parsed=[${m.parsed.code ?? '-'}] ${m.parsed.description} $${m.parsed.price}`)
  }
  if (s.spurious_items > 0) {
    console.log(`  SPURIOUS: ${s.spurious_items} extra item(s)`)
  }
}

const totalMs = scores.reduce((a, s) => a + s._parse_ms, 0)
console.log(`\nTotal parse time: ${totalMs}ms across ${scores.length} receipts (avg ${(totalMs/scores.length).toFixed(1)}ms)`)

function findPhoto(stem) {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = join(PHOTOS, stem + ext)
    if (existsSync(p)) return p
  }
  return null
}
