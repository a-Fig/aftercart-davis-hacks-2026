/**
 * Score the existing GPT pipeline output (tmp/gpt-output/*) against
 * experiments/ground-truth/*.json to establish a baseline.
 *
 * Run from repo root:
 *   node experiments/scripts/run-baseline.mjs
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { scoreReceipt, aggregateScores, formatTable } from '../lib/score.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const GPT_OUT = resolve(ROOT, 'tmp', 'gpt-output')
const GT_DIR = resolve(__dirname, '..', 'ground-truth')
const REPORT_DIR = resolve(__dirname, '..', 'tmp')

const truthFiles = readdirSync(GT_DIR).filter((f) => f.endsWith('.json')).sort()
const scores = []

for (const tf of truthFiles) {
  const truth = JSON.parse(readFileSync(join(GT_DIR, tf), 'utf8'))
  const stem = tf.replace('.json', '')
  const parsedPath = join(GPT_OUT, stem, 'parsed.json')
  if (!existsSync(parsedPath)) {
    console.log(`SKIP ${stem}: no baseline output at ${parsedPath}`)
    continue
  }
  const parsed = JSON.parse(readFileSync(parsedPath, 'utf8'))
  const score = scoreReceipt(parsed, truth)
  scores.push(score)
}

const agg = aggregateScores(scores)
const table = formatTable(scores, agg)
console.log(table)

mkdirSync(REPORT_DIR, { recursive: true })
const reportPath = join(REPORT_DIR, 'baseline-report.json')
writeFileSync(reportPath, JSON.stringify({ scores, aggregate: agg }, null, 2))
console.log(`\nReport: ${reportPath}`)

// Also print per-receipt error details — what we're trying to fix.
console.log('\n── Per-receipt errors ──')
for (const s of scores) {
  if (s.missing_items.length === 0 && s.misparsed.length === 0 && s.spurious_items === 0) continue
  console.log(`\n${s.image}`)
  for (const m of s.missing_items) {
    console.log(`  MISSING:  ${m.keywords.join(' ')}  (paid $${m.price})`)
  }
  for (const m of s.misparsed) {
    console.log(`  WRONG:    truth=[${m.truth.code ?? '-'}] ${m.truth.keywords.join(' ')} $${m.truth.price}  →  parsed=[${m.parsed.code ?? '-'}] ${m.parsed.description} $${m.parsed.price}`)
  }
  if (s.spurious_items > 0) {
    console.log(`  SPURIOUS: ${s.spurious_items} extra item(s)`)
  }
}
