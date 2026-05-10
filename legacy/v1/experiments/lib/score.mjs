/**
 * Score a parsed receipt against ground truth.
 *
 * Both inputs use the same shape — see experiments/ground-truth/*.json for
 * the truth shape, and the GPT pipeline's parsed.json for the parsed shape.
 *
 * Scoring is per-receipt and yields a structured object that aggregates
 * cleanly across receipts. Item alignment is greedy by description keyword
 * coverage + price proximity + code match — receipts have duplicates, so
 * we don't try to be clever. We do penalize an item for being matched to
 * the wrong slot.
 */

const PRICE_EPS = 0.01

/**
 * @param {object} parsed   - parsed output (GPT or experimental)
 * @param {object} truth    - ground-truth annotation
 * @returns {ScoreResult}
 */
export function scoreReceipt(parsed, truth) {
  const result = {
    image: truth.image,
    store_name_ok: storeNameMatches(parsed.store_name, truth.store_name),
    store_address_ok: storeAddressMatches(parsed.store_address, truth.store_address_substr),
    receipt_date_ok: dateMatches(parsed.receipt_date, truth.receipt_date),
    receipt_total_ok: priceClose(parsed.receipt_total, truth.receipt_total),
    item_count_expected: truth.items.length,
    item_count_returned: (parsed.items ?? []).length,
    items_matched: 0,
    items_with_correct_price: 0,
    items_with_correct_code: 0,
    items_with_correct_quantity: 0,
    sum_price_delta: 0,
    spurious_items: 0,
    missing_items: [],
    misparsed: [],
  }

  const truthItems = truth.items.map((t) => ({ ...t, _used: false }))
  const parsedItems = (parsed.items ?? []).map((p, idx) => ({ ...p, _used: false, _idx: idx }))

  for (const t of truthItems) {
    let bestIdx = -1
    let bestScore = 0
    for (const p of parsedItems) {
      if (p._used) continue
      const sc = alignmentScore(p, t)
      if (sc > bestScore) {
        bestScore = sc
        bestIdx = p._idx
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.4) {
      const p = parsedItems[bestIdx]
      p._used = true
      t._used = true
      result.items_matched += 1
      const pricePaid = p.member_price ?? p.shelf_price
      const priceExpected = t.member_price ?? t.shelf_price
      if (priceClose(pricePaid, priceExpected)) result.items_with_correct_price += 1
      if (priceClose(p.shelf_price, t.shelf_price)) {
        // shelf price exact
      }
      if (codeMatches(p.code, t.code)) result.items_with_correct_code += 1
      if (quantityMatches(p.quantity, p.unit, t.quantity, t.unit)) {
        result.items_with_correct_quantity += 1
      }
      result.sum_price_delta += Math.abs((pricePaid ?? 0) - (priceExpected ?? 0))
      if (!priceClose(pricePaid, priceExpected) || !codeMatches(p.code, t.code)) {
        result.misparsed.push({
          truth: { code: t.code, keywords: t.description_keywords, price: priceExpected },
          parsed: { code: p.code, description: p.description, price: pricePaid },
        })
      }
    } else {
      result.missing_items.push({ keywords: t.description_keywords, price: t.member_price ?? t.shelf_price })
    }
  }

  result.spurious_items = parsedItems.filter((p) => !p._used).length
  return result
}

function storeNameMatches(parsedName, truthName) {
  if (!parsedName || !truthName) return false
  return normalizeStore(parsedName).includes(normalizeStore(truthName))
    || normalizeStore(truthName).includes(normalizeStore(parsedName))
}

function normalizeStore(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function storeAddressMatches(parsedAddr, truthSubstr) {
  if (!parsedAddr || !truthSubstr) return false
  return parsedAddr.toLowerCase().includes(truthSubstr.toLowerCase())
}

function dateMatches(parsedDate, truthDate) {
  if (truthDate === null) return parsedDate === null || parsedDate === undefined
  return parsedDate === truthDate
}

function priceClose(a, b) {
  if (a == null || b == null) return false
  return Math.abs(Number(a) - Number(b)) < PRICE_EPS
}

function codeMatches(a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  // Sometimes leading zeros drop, sometimes trailing check digits drop. Be lenient:
  // match if either is a substring of the other (after stripping leading zeros).
  const A = String(a).replace(/^0+/, '')
  const B = String(b).replace(/^0+/, '')
  return A === B || A.includes(B) || B.includes(A)
}

function quantityMatches(pQty, pUnit, tQty, tUnit) {
  if (tQty == null) return pQty == null || pQty === 1
  if (pQty == null) return false
  const qOk = Math.abs(Number(pQty) - Number(tQty)) < 0.05
  const uOk = !tUnit || !pUnit || normalizeUnit(pUnit) === normalizeUnit(tUnit)
  return qOk && uOk
}

function normalizeUnit(u) {
  if (!u) return null
  const s = String(u).toLowerCase().replace(/\./g, '').trim()
  if (['lb', 'lbs', 'pound', 'pounds'].includes(s)) return 'lb'
  if (['oz', 'ounce', 'ounces'].includes(s)) return 'oz'
  if (['each', 'ea', 'count', 'ct', 'unit', 'units', null, ''].includes(s)) return 'each'
  return s
}

/**
 * Align a parsed item to a truth item. Score in [0,1].
 * Components: code match, keyword coverage, price proximity.
 */
function alignmentScore(p, t) {
  let s = 0
  // Code is the strongest signal.
  if (t.code && p.code && codeMatches(p.code, t.code)) s += 0.5
  // Keyword coverage in description.
  const desc = (p.description ?? p.raw_text ?? '').toUpperCase()
  if (t.description_keywords && t.description_keywords.length > 0) {
    const hits = t.description_keywords.filter((kw) => desc.includes(String(kw).toUpperCase())).length
    s += 0.4 * (hits / t.description_keywords.length)
  }
  // Price proximity (within $0.10 — receipts sometimes get cents wrong).
  const ppPaid = p.member_price ?? p.shelf_price
  const tpPaid = t.member_price ?? t.shelf_price
  if (ppPaid != null && tpPaid != null) {
    const d = Math.abs(Number(ppPaid) - Number(tpPaid))
    if (d < 0.01) s += 0.2
    else if (d < 0.10) s += 0.1
  }
  return s
}

/**
 * Aggregate per-receipt scores into one summary.
 */
export function aggregateScores(scores) {
  const n = scores.length
  if (n === 0) return null
  const sum = (k) => scores.reduce((a, s) => a + (typeof s[k] === 'boolean' ? (s[k] ? 1 : 0) : (s[k] ?? 0)), 0)
  const total_truth_items = sum('item_count_expected')
  const total_matched = sum('items_matched')
  const total_correct_price = sum('items_with_correct_price')
  const total_correct_code = sum('items_with_correct_code')
  const total_correct_qty = sum('items_with_correct_quantity')
  const total_spurious = sum('spurious_items')
  return {
    receipts: n,
    store_name_ok: sum('store_name_ok'),
    store_address_ok: sum('store_address_ok'),
    receipt_date_ok: sum('receipt_date_ok'),
    receipt_total_ok: sum('receipt_total_ok'),
    truth_items: total_truth_items,
    items_matched: total_matched,
    items_with_correct_price: total_correct_price,
    items_with_correct_code: total_correct_code,
    items_with_correct_quantity: total_correct_qty,
    spurious_items: total_spurious,
    item_recall: total_matched / total_truth_items,
    item_price_accuracy: total_correct_price / total_truth_items,
    item_code_accuracy: total_correct_code / total_truth_items,
    item_quantity_accuracy: total_correct_qty / total_truth_items,
    avg_sum_price_delta: scores.reduce((a, s) => a + s.sum_price_delta, 0) / n,
  }
}

export function formatTable(scores, agg) {
  const cols = [
    ['image',            14],
    ['store',            6],
    ['date',             5],
    ['total',            6],
    ['truth/parsed',     14],
    ['matched',          8],
    ['price_ok',         9],
    ['code_ok',          8],
    ['qty_ok',           7],
    ['spurious',         9],
  ]
  const lines = []
  lines.push(cols.map(([h, w]) => h.padEnd(w)).join('  '))
  lines.push(cols.map(([, w]) => '-'.repeat(w)).join('  '))
  for (const s of scores) {
    lines.push(cols.map(([h, w]) => {
      const v = (() => {
        switch (h) {
          case 'image':         return s.image.replace('.jpg', '')
          case 'store':         return s.store_name_ok ? 'ok' : 'NO'
          case 'date':          return s.receipt_date_ok ? 'ok' : 'NO'
          case 'total':         return s.receipt_total_ok ? 'ok' : 'NO'
          case 'truth/parsed':  return `${s.item_count_expected}/${s.item_count_returned}`
          case 'matched':       return `${s.items_matched}/${s.item_count_expected}`
          case 'price_ok':      return `${s.items_with_correct_price}/${s.item_count_expected}`
          case 'code_ok':       return `${s.items_with_correct_code}/${s.item_count_expected}`
          case 'qty_ok':        return `${s.items_with_correct_quantity}/${s.item_count_expected}`
          case 'spurious':      return s.spurious_items
        }
      })()
      return String(v).padEnd(w)
    }).join('  '))
  }
  lines.push('')
  lines.push(`AGGREGATE: ${agg.receipts} receipts, ${agg.truth_items} truth items`)
  lines.push(`  store name ok:    ${agg.store_name_ok}/${agg.receipts}`)
  lines.push(`  store addr ok:    ${agg.store_address_ok}/${agg.receipts}`)
  lines.push(`  date ok:          ${agg.receipt_date_ok}/${agg.receipts}`)
  lines.push(`  total ok:         ${agg.receipt_total_ok}/${agg.receipts}`)
  lines.push(`  item recall:      ${agg.items_matched}/${agg.truth_items}  (${(agg.item_recall * 100).toFixed(1)}%)`)
  lines.push(`  price accuracy:   ${agg.items_with_correct_price}/${agg.truth_items}  (${(agg.item_price_accuracy * 100).toFixed(1)}%)`)
  lines.push(`  code accuracy:    ${agg.items_with_correct_code}/${agg.truth_items}  (${(agg.item_code_accuracy * 100).toFixed(1)}%)`)
  lines.push(`  qty  accuracy:    ${agg.items_with_correct_quantity}/${agg.truth_items}  (${(agg.item_quantity_accuracy * 100).toFixed(1)}%)`)
  lines.push(`  spurious items:   ${agg.spurious_items}`)
  return lines.join('\n')
}
