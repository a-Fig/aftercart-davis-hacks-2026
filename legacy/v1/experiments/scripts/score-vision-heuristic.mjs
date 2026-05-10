/**
 * Score the existing Vision-OCR + heuristic-parser output (tmp/ocr-output/*)
 * as a comparison baseline. The heuristic parser uses different field names
 * (total vs receipt_total, store.name vs store_name, total_price vs shelf_price),
 * so we adapt to the scoring shape first.
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { scoreReceipt, aggregateScores, formatTable } from '../lib/score.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const OCR_OUT = resolve(ROOT, 'tmp', 'ocr-output')
const GT_DIR = resolve(__dirname, '..', 'ground-truth')

function adaptHeuristic(h) {
  return {
    store_name: h.store?.name ?? null,
    store_address: h.store?.address ?? null,
    receipt_date: h.dated_at ?? null,
    receipt_total: h.total ?? null,
    item_count: null,
    items: (h.items ?? []).map((it) => {
      // total_price is the rightmost price on the line, which on
      // "Price You Pay" receipts (Safeway) is already the member_price.
      // discount is a separate informational field. shelf = member - discount.
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
      }
    }),
  }
}

const truthFiles = readdirSync(GT_DIR).filter((f) => f.endsWith('.json')).sort()
const scores = []
for (const tf of truthFiles) {
  const truth = JSON.parse(readFileSync(join(GT_DIR, tf), 'utf8'))
  const stem = tf.replace('.json', '')
  const parsedPath = join(OCR_OUT, stem, 'parsed.json')
  if (!existsSync(parsedPath)) {
    console.log(`SKIP ${stem}: no Vision-heuristic output`)
    continue
  }
  const heuristic = JSON.parse(readFileSync(parsedPath, 'utf8'))
  const adapted = adaptHeuristic(heuristic)
  scores.push(scoreReceipt(adapted, truth))
}

const agg = aggregateScores(scores)
console.log(formatTable(scores, agg))

console.log('\n── Per-receipt errors ──')
for (const s of scores) {
  if (s.missing_items.length === 0 && s.misparsed.length === 0 && s.spurious_items === 0) continue
  console.log(`\n${s.image}`)
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
