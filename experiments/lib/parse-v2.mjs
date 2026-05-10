/**
 * Receipt parser v2 — improved heuristic.
 *
 * Differences from web/lib/receipts/parse.mjs:
 *
 *   1. Output schema matches the GPT pipeline (store_name, receipt_total,
 *      shelf_price/member_price, code, item_type) — drop-in compatible with
 *      experiments/lib/score.mjs and the existing matcher.
 *   2. Expanded KNOWN_CHAINS (Smart & Final, Sprouts, Lucky, etc.).
 *   3. Better skip rules for tax-computation lines, masked card numbers,
 *      cash/change lines, Costco column markers.
 *   4. Quantity defaults to 1 instead of null when no explicit qty is on the
 *      line — matches the implicit receipt semantics.
 *   5. Costco-style "**** TOTAL" / next-line value extraction.
 *   6. Description cleanup: strips leading "E"/"EEEE", strips "**", strips
 *      trailing tax flags after price already removed.
 *   7. Tracks shelf_price and member_price separately (Safeway loyalty).
 *
 * Pure JS, no I/O, no DB — same constraints as v1.
 */

const KNOWN_CHAINS = [
  { pattern: /SAFEWAY/i,                     name: "Safeway" },
  { pattern: /FELIPES?\s*MARKET/i,           name: "Felipes Market" },
  { pattern: /FOOTHILL\s*PRODUCE/i,          name: "Foothill Produce" },
  { pattern: /TRADER\s*JOE'?S/i,             name: "Trader Joe's" },
  { pattern: /WHOLE\s*FOODS/i,               name: "Whole Foods" },
  { pattern: /COSTCO/i,                      name: "Costco" },
  { pattern: /TARGET/i,                      name: "Target" },
  { pattern: /WAL[\s-]?MART/i,               name: "Walmart" },
  { pattern: /NUGGET/i,                      name: "Nugget Markets" },
  { pattern: /GROCERY\s*OUTLET/i,            name: "Grocery Outlet" },
  { pattern: /DAVIS\s*FOOD\s*CO[\s-]?OP/i,   name: "Davis Food Co-op" },
  { pattern: /99\s*RANCH/i,                  name: "99 Ranch" },
  { pattern: /VALLARTA/i,                    name: "Vallarta" },
  { pattern: /SMART\s*&?\s*FINAL/i,          name: "Smart & Final" },
  { pattern: /SPROUTS/i,                     name: "Sprouts" },
  { pattern: /LUCKY\b/i,                     name: "Lucky" },
  { pattern: /RALEY'?S/i,                    name: "Raley's" },
  { pattern: /SAVE\s*MART/i,                 name: "Save Mart" },
  { pattern: /FOOD\s*MAXX/i,                 name: "FoodMaxx" },
  { pattern: /WINCO/i,                       name: "WinCo" },
  { pattern: /ALDI/i,                        name: "Aldi" },
  { pattern: /KROGER/i,                      name: "Kroger" },
  { pattern: /H\s*MART/i,                    name: "H Mart" },
  { pattern: /MITSUWA/i,                     name: "Mitsuwa" },
  { pattern: /MARINA\s*FOOD/i,               name: "Marina Food" },
]

const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
const ADDR_RE  = /\b([A-Z][A-Za-z .'-]+),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/
const DATE_RE  = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/
const PRICE_RE = /-?\$?\s*(?:\d+\.\d{2}|\.\d{2})\b/g

/**
 * @param {string} text  raw OCR text
 * @returns {object}     parsed receipt in score-compatible shape
 */
export function parseReceiptV2(text) {
  const rawLines = text
    .split('\n')
    .map((s) => s.replace(/\s+$/, ''))
    .filter((s) => s.trim().length > 0)

  const merged = mergeContinuations(rawLines)
  const cleaned = stripColumnMarkers(merged)

  const store = extractStore(cleaned)
  const receipt_date = extractDate(cleaned)
  const totals = extractTotals(cleaned, rawLines)
  const { items, unparsed } = extractItems(cleaned)

  return {
    store_name: store.name,
    store_address: store.address,
    receipt_date,
    receipt_total: totals.total,
    item_count: totals.itemCount,
    items,
    _internal: {
      raw_lines: rawLines,
      merged_lines: cleaned,
      unparsed_lines: unparsed,
      subtotal: totals.subtotal,
      tax: totals.tax,
    },
  }
}

// ── Row reconstruction ──────────────────────────────────────────────────────

const BARE_PRICE_RE      = /^-?\$?\s*(?:\d+\.\d{2}|\.\d{2})(?:\s+[A-Z])?\s*$/
const MULTI_PRICE_RE     = /^(?:-?\$?\s*(?:\d+\.\d{2}|\.\d{2})\s*){2,}(?:[A-Z])?\s*$/
const BARE_NUMERIC_RE    = /^\d{4,13}$/
const QTY_SUFFIX_DOLLAR  = /^\s*\d+\s*@\s*\$\d+\.\d{2}\s*$/
const SHORT_PREFIX_PRICE = /^[A-Z*]{1,4}\s+\d+\.\d{2}\s*$/

function isContinuation(line) {
  const t = line.trim()
  return (
    BARE_PRICE_RE.test(t) ||
    MULTI_PRICE_RE.test(t) ||
    BARE_NUMERIC_RE.test(t) ||
    QTY_SUFFIX_DOLLAR.test(t) ||
    SHORT_PREFIX_PRICE.test(t)
  )
}

// Lines that should NOT be pair-up partners for column-flattened continuations
// — receipt headers ("Price", "You Pay") are short and priceless, but the
// numbers below them belong to the item ROW, not the header.
const HEADER_LIKE_RE = /^\s*(?:price|you\s+pay|qty|unit\s+price|price\s+you\s+pay)\s*$/i

function mergeContinuations(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    if (isContinuation(lines[i])) {
      let runEnd = i
      while (runEnd < lines.length && isContinuation(lines[runEnd])) runEnd++
      const conts = lines.slice(i, runEnd)

      if (conts.length >= 2) {
        let labelsAvailable = 0
        let cursor = out.length - 1
        // Step backwards through priceless lines, but stop when we hit a
        // header-like line so its numbers don't get stolen from the item below.
        while (cursor >= 0 && pricesIn(out[cursor]).length === 0 && !HEADER_LIKE_RE.test(out[cursor])) {
          labelsAvailable++
          if (labelsAvailable >= conts.length) break
          cursor--
        }
        if (labelsAvailable >= conts.length) {
          const pairFrom = out.length - conts.length
          for (let j = 0; j < conts.length; j++) {
            out[pairFrom + j] = out[pairFrom + j].trim() + ' ' + conts[j].trim()
          }
          i = runEnd
          continue
        }
      }

      // Fallback: dump all conts onto the most-recent non-header line.
      let target = out.length - 1
      while (target >= 0 && HEADER_LIKE_RE.test(out[target])) target--
      if (target >= 0) {
        out[target] = out[target].trim() + ' ' + conts.map((c) => c.trim()).join(' ')
      } else {
        out.push(...conts)
      }
      i = runEnd
      continue
    }
    out.push(lines[i])
    i++
  }
  return out
}

// Costco prints stray "E" / "EEEE" prefix columns ahead of item lines.
// Strip them so they don't end up in descriptions.
function stripColumnMarkers(lines) {
  return lines
    .map((l) => l.replace(/^\s*E{1,8}\s+/, ''))
    .filter((l) => !/^\s*E{1,8}\s*$/.test(l))
}

// ── Store header ────────────────────────────────────────────────────────────

function extractStore(lines) {
  const head = lines.slice(0, 22)
  let name = null
  for (const line of head) {
    for (const chain of KNOWN_CHAINS) {
      if (chain.pattern.test(line)) { name = chain.name; break }
    }
    if (name) break
  }

  let address = null
  for (let i = 0; i < head.length; i++) {
    const line = head[i]
    if (ADDR_RE.test(line)) {
      const prev = i > 0 ? head[i - 1].trim() : ''
      const street = /\d+\s+\w/.test(prev) ? prev : ''
      address = (street ? street + ', ' : '') + line.trim()
      break
    }
  }
  return { name, address }
}

function extractDate(lines) {
  for (const line of lines) {
    const m = line.match(DATE_RE)
    if (!m) continue
    let [, mm, dd, yy] = m
    let year = parseInt(yy, 10)
    if (yy.length === 2) year = year <= 50 ? 2000 + year : 1900 + year
    const month = parseInt(mm, 10)
    const day = parseInt(dd, 10)
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  for (const line of lines) {
    const m = line.match(/\b(\d{2})-(\d{2})-(\d{4})\b/)
    if (m) return `${m[3]}-${m[1]}-${m[2]}`
  }
  return null
}

// ── Totals (improved Costco handling) ───────────────────────────────────────

function extractTotals(lines, rawLines) {
  let subtotal = null, tax = null, total = null, itemCount = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase()
    const prices = pricesIn(line)

    // "TOTAL NUMBER OF ITEMS SOLD = N" or "Items in Transaction:N" or "Total # Items Sold N"
    if (itemCount === null) {
      const m = line.match(/(?:total\s+number\s+of\s+items\s+sold|items?\s+in\s+transaction|total\s*#?\s*items?\s+sold|number\s+of\s+items)\s*[:=-]?\s*(\d+)/i)
      if (m) itemCount = parseInt(m[1], 10)
    }

    if (prices.length === 0) continue
    const last = prices[prices.length - 1]

    if (subtotal === null && /\bsub\s*total\b/.test(lower)) {
      subtotal = last
      continue
    }
    if (tax === null && (/\btotal\s+tax\b/.test(lower) || /^\s*tax\b/.test(lower))) {
      tax = last
      continue
    }
    if (total === null
        && /\btotal\b/.test(lower)
        && !/total\s+tax/.test(lower)
        && !/total\s+savings?/.test(lower)
        && !/total\s+number/.test(lower)
        && !/total\s+#/.test(lower)
        && !/total\s+saving\s+value/.test(lower)
        && !/total\s+purchase/.test(lower)) {
      total = last
      continue
    }
    if (total === null && /\bbalance\b/.test(lower) && !/balance\s+to\s+pay/.test(lower)) {
      total = last
      continue
    }
  }

  // TJ-style: "Balance to pay" + value on its own next line, or "TOTAL PURCHASE"
  if (total === null) {
    for (const line of lines) {
      const lower = line.toLowerCase()
      const prices = pricesIn(line)
      if (prices.length === 0) continue
      if (/\btotal\s+purchase\b/.test(lower) || /balance\s+to\s+pay/.test(lower)) {
        total = prices[prices.length - 1]
        break
      }
    }
  }

  // Costco-style: "**** TOTAL" with the actual value several lines later next
  // to a masked-card line (e.g., "XXXXXXXXXXXX2366  153.28"). Look up to 6
  // lines after the "**** TOTAL" marker for the next price.
  if (total === null) {
    for (let i = 0; i < rawLines.length; i++) {
      if (/^\s*\*+\s*total\b/i.test(rawLines[i])) {
        for (let j = i + 1; j < Math.min(rawLines.length, i + 8); j++) {
          const ps = pricesIn(rawLines[j])
          if (ps.length > 0) {
            // Pick the largest non-trivial price (skip 0.00/change/etc).
            const candidate = Math.max(...ps)
            if (candidate > 0.5) {
              total = candidate
              break
            }
          }
        }
        if (total !== null) break
      }
    }
  }

  return { subtotal, tax, total, itemCount }
}

// ── Item classification ─────────────────────────────────────────────────────

const SKIP_KEYWORDS = [
  /\bcashier\b/i,
  /\bstore\s*:?\s*\d/i,
  /\bstore\s*#\s*\d/i,
  /\b(?:credit\s+purchase|tender|change|payment\s+amount|payment\s+card)\b/i,
  /\b(?:visa|mastercard|amex|discover|debit|us\s+debit)\b/i,
  /\b(?:aid|tvr|approval|appr|appr?vl|acct|card\s*#|ref|auth(?:\s+code)?|mid|tid)\b/i,
  /\bpoints\b/i,
  /\bnumber\s+of\s+items\b/i,
  /\btotal\s+number\b/i,
  /\bitems?\s+in\s+transaction\b/i,
  /\btotal\s*#\s*items\b/i,
  /\b(?:your\s+savings|your\s+points|your\s+cashier)\b/i,
  /\btotal\s+saving\b/i,
  /\b(?:trx|term)\b/i,
  /\b(?:main|rx)\s*:/i,
  /\bthank\s*you/i,
  /\bjoin\s*us/i,
  /facebook\.com/i,
  /\b[\w.-]+@[\w.-]+\.\w{2,}\b/,
  /\bvisit\s*us\b/i,
  /\bfor\s+safeway\s+for\s+u\b/i,
  /\bfor\s+u\s+savings\b/i,
  /\bmember\s+savings\b/i,
  /\btotal\s+savings?\s+value\b/i,
  /\bsale\s+transaction\b/i,
  /\bopen\s+\d+:\d+\s*(?:am|pm)/i,
  /\bcustomer\s+copy\b/i,
  /\bcardholder\b/i,
  /\bplease\s+retain\b/i,
  /\bfor\s+your\s+records\b/i,
  /\bbalance\s+to\s+pay\b/i,
  /^contactless\b|\btype\s*:\s*(?:contactless|mobile|chip|swipe)/i,
  /^\*{2,}\d+/,
  /^x{4,}\d/i,
  // v2 additions
  /\bcash\s+\d+\.\d{2}\b/i,
  /^\s*cash\b/i,
  /\bchange\b/i,
  /\bsubtotal\b/i,
  /\b\d+\.\d{2}\s*@\s*\d+(?:\.\d+)?%/,
  /\bpoints\s+(?:earned|available)\b/i,
  /\bpurchase\s+transaction\b/i,
  /\bdebit\s+sale\b/i,
  /\bauth(?:\s+code)?\b/i,
  /\bbottom\s+of\s+basket\b/i,
  /\bbob\s+count\b/i,
  /\bf\s+-\s+food\s+stamp/i,
  /\blegend\b/i,
  /\bprice\s+you\s+pay\b/i,
  /^you\s+pay\s+/i,
  /\bsale\s+savings?\b/i,
  /\bsavings?\s+\d+\.\d{2}\b/i,
]

const DEPT_HEADERS = [
  /^\s*(?:REFRIG|FROZEN|GROCERY|PRODUCE|DAIRY|MEAT|BAKERY|DELI|BEVERAGE|GENERAL\s+MERCH|MISC|HBA|HEALTH|FLORAL|SEAFOOD|BULK)\b/i,
  /^\s*REFRIG\/FROZEN\b/i,
  /^\s*PRODUCE\/BULK\/FLORAL\b/i,
]

const WEIGHT_PREFIX_RE = /^\s*(\d+(?:\.\d+)?)\s*(lb|oz)\s*@\s*\d+\s*(?:lb|oz)\s*\/\s*(\d+\.\d{2})\b/i
const QTY_PREFIX_RE    = /^\s*(\d+)\s*@\s*(?:\d+\s*\/\s*)?\$?(\d+\.\d{2})\s*$/
const PRICE_YOU_PAY_RE = /\byou\s*pay\b/i
const DISCOUNT_RE      = /\b(?:coupon|savings?|discount)\b/i

function classifyLine(line) {
  if (PRICE_YOU_PAY_RE.test(line)) return 'price_you_pay_header'
  if (DEPT_HEADERS.some((re) => re.test(line))) return 'dept_header'
  if (WEIGHT_PREFIX_RE.test(line)) return 'weight_prefix'
  if (QTY_PREFIX_RE.test(line))    return 'qty_prefix'
  if (/^\s*\d{8,}\s*$/.test(line)) return 'barcode'
  if (DISCOUNT_RE.test(line) && /-\s*\d+\.\d{2}/.test(line)) return 'discount'
  if (ADDR_RE.test(line)) return 'store_meta'
  if (PHONE_RE.test(line) && pricesIn(line).length === 0) return 'store_meta'
  if (SKIP_KEYWORDS.some((re) => re.test(line))) return 'skip'

  const lower = line.toLowerCase()
  if (/\bsub\s*total\b/.test(lower)) return 'totals'
  if (/\btotal\s+tax\b/.test(lower) || /^\s*tax\b/.test(lower)) return 'totals'
  if (/\bbalance\b/.test(lower)) return 'totals'
  if (/\btotal\b/.test(lower) && pricesIn(line).length > 0) return 'totals'

  if (pricesIn(line).length > 0) return 'item_candidate'
  return 'noise'
}

// ── Item extraction ─────────────────────────────────────────────────────────

function extractItems(lines) {
  const items = []
  const unparsed = []
  let pendingPrefix = null
  let useRightmostPrice = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cls = classifyLine(line)

    if (cls === 'price_you_pay_header') { useRightmostPrice = true; continue }
    if (cls === 'skip' || cls === 'store_meta' || cls === 'noise' ||
        cls === 'totals' || cls === 'barcode' || cls === 'dept_header') continue

    if (cls === 'weight_prefix') {
      pendingPrefix = parseWeightPrefix(line)
      continue
    }
    if (cls === 'qty_prefix') {
      pendingPrefix = parseQtyPrefix(line)
      continue
    }

    if (cls === 'discount') {
      const amt = extractDiscountAmount(line)
      if (items.length && amt !== null) {
        const last = items[items.length - 1]
        last.discount = (last.discount ?? 0) + amt
        // If the line already had a two-column "Price You Pay" layout, the
        // discount was already baked into member_price — record it but don't
        // re-apply. Only subtract when shelf == member (single-column line).
        if (last.member_price === last.shelf_price) {
          last.member_price = +(last.shelf_price + last.discount).toFixed(2)
        }
        last.raw_text += '\n' + line
      } else {
        unparsed.push(line)
      }
      continue
    }

    if (cls === 'item_candidate') {
      const item = parseItemLine(line, { pendingPrefix, useRightmostPrice })
      if (item) {
        items.push(item)
        pendingPrefix = null
      } else {
        unparsed.push(line)
      }
      continue
    }
  }

  if (pendingPrefix) unparsed.push(pendingPrefix.raw)
  return { items, unparsed }
}

function parseWeightPrefix(line) {
  const m = line.match(WEIGHT_PREFIX_RE)
  if (!m) return null
  return {
    quantity: parseFloat(m[1]),
    unit: m[2].toLowerCase(),
    unit_price: parseFloat(m[3]),
    raw: line,
  }
}

function parseQtyPrefix(line) {
  const m = line.match(QTY_PREFIX_RE)
  if (!m) return null
  return {
    quantity: parseInt(m[1], 10),
    unit: 'each',
    unit_price: parseFloat(m[2]),
    raw: line,
  }
}

function extractDiscountAmount(line) {
  const m = line.match(/-\s*(\d+\.\d{2})/)
  if (!m) return null
  return -parseFloat(m[1])
}

function parseItemLine(line, ctx) {
  let work = line
  let quantity = null, unit = null, unit_price = null

  let m = work.match(/\b(\d+)\s*@\s*(?:\d+\s*\/\s*)?\$?(\d+\.\d{2})\b/)
  if (m) {
    quantity = parseInt(m[1], 10)
    unit_price = parseFloat(m[2])
    unit = 'each'
    work = work.slice(0, m.index) + ' ' + work.slice(m.index + m[0].length)
  } else {
    m = work.match(/\b(\d+)\s*@\s+(?=[A-Z])/)
    if (m) {
      quantity = parseInt(m[1], 10)
      unit = 'each'
      work = work.slice(0, m.index) + ' ' + work.slice(m.index + m[0].length)
    }
  }

  if (ctx.pendingPrefix) {
    quantity = ctx.pendingPrefix.quantity
    unit = ctx.pendingPrefix.unit
    unit_price = ctx.pendingPrefix.unit_price
  }

  const prices = pricesIn(work)
  if (prices.length === 0) return null

  // Determine shelf vs member when two prices are present (Safeway loyalty layout).
  // Defaults: single-price line → shelf == member == that price.
  let shelf_price, member_price
  if (ctx.useRightmostPrice && prices.length >= 2) {
    shelf_price = prices[0]
    member_price = prices[prices.length - 1]
  } else {
    shelf_price = prices[0]
    member_price = prices[0]
  }

  // Identifier: leading digit run of 4-14, else inline 4-13.
  let code = null
  let idMatch = work.match(/^\s*(\d{4,14})\b/)
  if (idMatch) {
    code = idMatch[1]
  } else {
    const inline = work.match(/\b(\d{4,13})\b/)
    if (inline && !inline[1].includes('.')) {
      code = inline[1]
    }
  }

  // Description: strip identifier, prices, trailing tax flag, leftover symbols.
  let desc = work
  if (code) desc = desc.replace(new RegExp(`\\b${code}\\b`, 'g'), ' ')
  desc = desc.replace(/-?\$?\s*(?:\d+\.\d{2}|\.\d{2})\b/g, ' ')
  desc = desc.replace(/\s+[A-Z]\b\s*$/, ' ')      // trailing tax flag (F, T, A)
  desc = desc.replace(/\s+\*+\s*/g, ' ')           // ** markers
  desc = desc.replace(/^[*\s]+|[*\s]+$/g, '')      // leading/trailing punctuation
  desc = desc.replace(/\s+/g, ' ').trim()
  if (!desc) return null

  // Default qty=1 for compare semantics when no explicit qty/weight on line.
  if (quantity === null && unit === null) {
    quantity = 1
  }

  if (unit_price === null && quantity && quantity > 0 && unit !== null && member_price !== null) {
    unit_price = +(member_price / quantity).toFixed(4)
  }

  // Heuristic item_type. Bag fees, deposits, lottery, etc. are skip.
  const item_type = classifyItemType(desc)

  return {
    raw_text: ctx.pendingPrefix ? ctx.pendingPrefix.raw + '\n' + line : line,
    description: desc,
    code,
    quantity,
    unit,
    unit_price,
    shelf_price,
    member_price,
    discount: null,
    is_store_brand: detectStoreBrand(desc),
    item_type,
  }
}

function classifyItemType(desc) {
  const u = desc.toUpperCase()
  if (/\bBAG\s*(?:FEE|CHRG|CHARGE)?\b/.test(u)) return 'skip'
  if (/\bBOTTLE\s+DEPOSIT\b/.test(u)) return 'skip'
  if (/\bCRV\b/.test(u)) return 'skip' // CA redemption value bottle deposit
  if (/\bLOTTERY\b/.test(u)) return 'skip'
  if (/\bGIFT\s+CARD\b/.test(u)) return 'skip'
  if (/\bRX\b|PHARMACY/.test(u)) return 'skip'
  return 'compare'
}

function detectStoreBrand(desc) {
  const u = desc.toUpperCase()
  if (/\bKS\b|KIRKLAND/.test(u)) return true
  if (/^TJ\s|\bTRADER\s+JOE/.test(u)) return true
  if (/\b365\b/.test(u)) return true
  if (/\bO\s+ORGANICS\b|SAFEWAY\s+SELECT|SIGNATURE\s+(?:SELECT|CAFE)|OPEN\s+NATURE|WATERFRONT\s+BISTRO|LUCERNE|PRIMO\s+TAGLIO/.test(u)) return true
  if (/^FIRST\s+STREET\b/.test(u)) return true // Smart & Final
  return false
}

function pricesIn(line) {
  const matches = line.match(PRICE_RE) || []
  return matches.map((s) => parseFloat(s.replace(/\$|\s/g, '')))
}
