#!/usr/bin/env node
/**
 * End-to-end smoke test: POST a receipt image to /api/match, then echo the
 * parsed receipt back to /api/compare with auto-confirmed picks. Prints a
 * coverage summary.
 *
 * Usage:
 *   node web/scripts/smoke-test-api.mjs receipts/inbox/IMG_1881.jpg
 *   PORT=3001 node web/scripts/smoke-test-api.mjs <image>
 *
 * Default port: 3001 (aftercart-bc dev server).
 */

import { readFileSync } from 'fs'
import { resolve, basename } from 'path'

const PORT = parseInt(process.env.PORT || '3001', 10)
const BASE = `http://localhost:${PORT}`

const imgPath = process.argv[2]
if (!imgPath) {
  console.error('Usage: node smoke-test-api.mjs <receipt.jpg>')
  process.exit(1)
}

const bytes = readFileSync(resolve(imgPath))
const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`

console.log(`\n=== POST ${BASE}/api/match  (${basename(imgPath)}, ${(bytes.length/1024).toFixed(0)}KB) ===`)
const t0 = Date.now()
const matchRes = await fetch(`${BASE}/api/match`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image: dataUrl }),
})
if (!matchRes.ok) {
  console.error('match failed:', matchRes.status, await matchRes.text())
  process.exit(1)
}
const match = await matchRes.json()
console.log(`  ${(Date.now() - t0)}ms`)
console.log(`  receipt: ${match.receipt?.store_name ?? '(unknown)'} on ${match.receipt?.receipt_date ?? 'unknown date'}`)
console.log(`  parse_source: ${match.parse_source}`)
console.log(`  items: ${match.items.length}`)
const itemSummary = {
  with_in_house_match: 0,
  with_off_candidate: 0,
  with_no_candidates: 0,
  printed_upc: 0,
}
for (const it of match.items) {
  if (it.code) itemSummary.printed_upc++
  if (it.suggested_match?.canonical_id || it.suggested_match?.barcode) itemSummary.with_in_house_match++
  if (it.candidates?.some(c => c.source === 'off')) itemSummary.with_off_candidate++
  if (!it.candidates || it.candidates.length === 0) itemSummary.with_no_candidates++
}
console.log(`  ${JSON.stringify(itemSummary)}`)

// Auto-confirm picks: prefer the matcher's suggested match. If suggested_match
// has a canonical_id → in-house pick. If it has a barcode → off pick. Else use
// the top candidate.
const corrections = match.items.map((it, idx) => {
  const suggested = it.suggested_match
  if (suggested?.canonical_id != null) {
    return { line_index: idx, choice: { kind: 'in-house', canonical_id: suggested.canonical_id } }
  }
  if (suggested?.barcode) {
    return { line_index: idx, choice: { kind: 'off', barcode: suggested.barcode } }
  }
  // Fall back to top candidate
  const top = it.candidates?.[0]
  if (top?.source === 'in-house') return { line_index: idx, choice: { kind: 'in-house', canonical_id: top.canonical_id } }
  if (top?.source === 'off') return { line_index: idx, choice: { kind: 'off', barcode: top.barcode } }
  return { line_index: idx, choice: { kind: 'none' } }
})

// Forward LLM interpretations (brand-stripped product names) so the
// semantic comparison engine has the high-recall query source. Mirrors
// what compareReceipt() does in lib/api/compare.ts.
const interpretations = match.items
  .filter(it => it.llm_interpretation)
  .map(it => ({
    line_index: it.line_index,
    product_name: it.llm_interpretation.product_name,
    brand_guess: it.llm_interpretation.brand_guess,
    size_guess: it.llm_interpretation.size_guess,
    is_produce_or_generic: it.llm_interpretation.is_produce_or_generic,
  }))

console.log(`\n=== POST ${BASE}/api/compare  (${corrections.length} corrections, ${interpretations.length} interpretations) ===`)
const t1 = Date.now()
const cmpRes = await fetch(`${BASE}/api/compare`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    parsed: match.parsed,
    chain_detected: match.chain_detected,
    corrections,
    interpretations,
    radius_miles: 10000,  // global for this test
  }),
})
if (!cmpRes.ok) {
  console.error('compare failed:', cmpRes.status, await cmpRes.text())
  process.exit(1)
}
const cmp = await cmpRes.json()
console.log(`  ${(Date.now() - t1)}ms`)

let withAlts = 0
let withoutAlts = 0
let exactCount = 0
let equivCount = 0
let canonicalCount = 0
let totalAltRows = 0
for (const it of cmp.items) {
  if (!it.alternatives || it.alternatives.length === 0) {
    withoutAlts++
    continue
  }
  withAlts++
  totalAltRows += it.alternatives.length
  for (const a of it.alternatives) {
    if (a.bc_match_type === 'barcode_exact') exactCount++
    else if (a.bc_match_type === 'equivalent') equivCount++
    else if (a.bc_match_type === 'canonical_exact') canonicalCount++
  }
}

console.log(`\n=== Results ===`)
console.log(`  items: ${cmp.items.length} (compare: ${cmp.summary.compare_items}, matched: ${cmp.summary.matched})`)
console.log(`  items with at least one alt: ${withAlts}`)
console.log(`  items with NO alts:          ${withoutAlts}`)
console.log(`  total alt rows: ${totalAltRows}`)
console.log(`    barcode_exact:    ${exactCount}`)
console.log(`    equivalent:       ${equivCount}`)
console.log(`    canonical_exact:  ${canonicalCount}`)

// Show 3 sample items in detail
console.log(`\n=== Sample items (first 3 with alts) ===`)
let shown = 0
for (const it of cmp.items) {
  if (!it.alternatives || it.alternatives.length === 0) continue
  if (shown >= 3) break
  shown++
  console.log(`\n• ${it.user_display_name}  (paid $${it.member_price ?? '?'} for ${it.quantity ?? 1} ${it.unit ?? ''})`)
  console.log(`   match: ${it.match?.name ?? '(none)'} ${it.match?.canonical_id ? `(canonical_id ${it.match.canonical_id})` : ''}`)
  console.log(`   picked_off_barcode: ${it.picked_off_barcode ?? '—'}`)
  for (const a of it.alternatives.slice(0, 5)) {
    const tier = a.bc_match_type ?? a.match_type
    const dist = parseFloat(a.distance_miles).toFixed(1)
    const price = parseFloat(a.weighted_price).toFixed(2)
    console.log(`     [${tier}] $${price}/${a.price_unit} @ ${a.chain_name} (${dist} mi) — ${a.display_name ?? '?'}  obs=${a.observation_count} fresh=${a.freshness}`)
  }
}
