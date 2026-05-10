/**
 * Archived snapshot of the ORIGINAL web/lib/receipts/parse.mjs (pre-v2 rollout).
 *
 * Kept verbatim so the viewer's three-pipeline comparison stays honest:
 *   - GPT-5-nano (cached gpt-output)
 *   - parse-v1 (this file)         ← what production used to be
 *   - parse-v2 (lib/parse-v2.mjs)  ← what production is now
 *
 * Do not edit. If the original behaviour drifts, the comparison loses its
 * meaning. Treat this file as a frozen reference implementation.
 */

const KNOWN_CHAINS = [
  { pattern: /SAFEWAY/i,                    name: "Safeway" },
  { pattern: /FELIPES?\s*MARKET/i,          name: "Felipes Market" },
  { pattern: /FOOTHILL\s*PRODUCE/i,         name: "Foothill Produce" },
  { pattern: /TRADER\s*JOE'?S/i,            name: "Trader Joe's" },
  { pattern: /WHOLE\s*FOODS/i,              name: "Whole Foods" },
  { pattern: /COSTCO/i,                     name: "Costco" },
  { pattern: /TARGET/i,                     name: "Target" },
  { pattern: /WAL[\s-]?MART/i,              name: "Walmart" },
  { pattern: /NUGGET/i,                     name: "Nugget Markets" },
  { pattern: /GROCERY\s*OUTLET/i,           name: "Grocery Outlet" },
  { pattern: /DAVIS\s*FOOD\s*CO[\s-]?OP/i,  name: "Davis Food Co-op" },
  { pattern: /99\s*RANCH/i,                 name: "99 Ranch" },
  { pattern: /VALLARTA/i,                   name: "Vallarta" },
];

const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const ADDR_RE  = /\b([A-Z][A-Za-z .'-]+),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;
const DATE_RE  = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
const PRICE_RE = /-?\$?\s*(?:\d+\.\d{2}|\.\d{2})\b/g;

export function parseReceipt(text) {
  const rawLines = text
    .split("\n")
    .map((s) => s.replace(/\s+$/, ""))
    .filter((s) => s.trim().length > 0);

  const merged = mergeContinuations(rawLines);

  const store  = extractStore(merged);
  const dated  = extractDate(merged);
  const totals = extractTotals(merged);
  const { items, unparsed_lines } = extractItems(merged);

  return {
    store,
    dated_at: dated,
    items,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    raw_lines: rawLines,
    merged_lines: merged,
    unparsed_lines,
  };
}

const BARE_PRICE_RE      = /^-?\$?\s*(?:\d+\.\d{2}|\.\d{2})(?:\s+[A-Z])?\s*$/;
const MULTI_PRICE_RE     = /^(?:-?\$?\s*(?:\d+\.\d{2}|\.\d{2})\s*){2,}(?:[A-Z])?\s*$/;
const BARE_NUMERIC_RE    = /^\d{4,13}$/;
const QTY_SUFFIX_DOLLAR  = /^\s*\d+\s*@\s*\$\d+\.\d{2}\s*$/;
const SHORT_PREFIX_PRICE = /^[A-Z*]{1,4}\s+\d+\.\d{2}\s*$/;

function isContinuation(line) {
  const t = line.trim();
  return (
    BARE_PRICE_RE.test(t) ||
    MULTI_PRICE_RE.test(t) ||
    BARE_NUMERIC_RE.test(t) ||
    QTY_SUFFIX_DOLLAR.test(t) ||
    SHORT_PREFIX_PRICE.test(t)
  );
}

function mergeContinuations(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isContinuation(lines[i])) {
      let runEnd = i;
      while (runEnd < lines.length && isContinuation(lines[runEnd])) runEnd++;
      const conts = lines.slice(i, runEnd);

      if (conts.length >= 2) {
        let labelsAvailable = 0;
        let cursor = out.length - 1;
        while (cursor >= 0 && pricesIn(out[cursor]).length === 0) {
          labelsAvailable++;
          if (labelsAvailable >= conts.length) break;
          cursor--;
        }
        if (labelsAvailable >= conts.length) {
          const pairFrom = out.length - conts.length;
          for (let j = 0; j < conts.length; j++) {
            out[pairFrom + j] = out[pairFrom + j].trim() + " " + conts[j].trim();
          }
          i = runEnd;
          continue;
        }
      }

      if (out.length > 0) {
        out[out.length - 1] = out[out.length - 1].trim() + " " + conts.map((c) => c.trim()).join(" ");
      } else {
        out.push(...conts);
      }
      i = runEnd;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out;
}

function extractStore(lines) {
  const head = lines.slice(0, 18);

  let name = null;
  for (const line of head) {
    for (const chain of KNOWN_CHAINS) {
      if (chain.pattern.test(line)) { name = chain.name; break; }
    }
    if (name) break;
  }

  let address = null;
  for (let i = 0; i < head.length; i++) {
    const line = head[i];
    if (ADDR_RE.test(line)) {
      const prev = i > 0 ? head[i - 1].trim() : "";
      const street = /\d+\s+\w/.test(prev) ? prev : "";
      address = (street ? street + ", " : "") + line.trim();
      break;
    }
  }

  let phone = null;
  for (const line of head) {
    const m = line.match(PHONE_RE);
    if (m) { phone = m[0]; break; }
  }

  return { name, address, phone };
}

function extractDate(lines) {
  for (const line of lines) {
    const m = line.match(DATE_RE);
    if (!m) continue;
    let [, mm, dd, yy] = m;
    let year = parseInt(yy, 10);
    if (yy.length === 2) year = year <= 50 ? 2000 + year : 1900 + year;
    const month = parseInt(mm, 10);
    const day = parseInt(dd, 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    return `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  for (const line of lines) {
    const m = line.match(/\b(\d{2})-(\d{2})-(\d{4})\b/);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  }
  return null;
}

function extractTotals(lines) {
  let subtotal = null, tax = null, total = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const prices = pricesIn(line);
    if (prices.length === 0) continue;
    const last = prices[prices.length - 1];

    if (subtotal === null && /\bsub\s*total\b/.test(lower)) {
      subtotal = last;
      continue;
    }
    if (tax === null && (/\btotal\s+tax\b/.test(lower) || /^\s*tax\b/.test(lower))) {
      tax = last;
      continue;
    }
    if (total === null
        && /\btotal\b/.test(lower)
        && !/total\s+tax/.test(lower)
        && !/total\s+savings?/.test(lower)
        && !/total\s+number/.test(lower)
        && !/total\s+saving\s+value/.test(lower)
        && !/total\s+purchase/.test(lower)) {
      total = last;
      continue;
    }
    if (total === null && /\bbalance\b/.test(lower)) {
      total = last;
      continue;
    }
  }

  if (total === null) {
    for (const line of lines) {
      const lower = line.toLowerCase();
      const prices = pricesIn(line);
      if (prices.length === 0) continue;
      if (/\btotal\s+purchase\b/.test(lower)) {
        total = prices[prices.length - 1];
        break;
      }
    }
  }
  return { subtotal, tax, total };
}

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
  /\bitems\s+in\s+transaction\b/i,
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
];

const DEPT_HEADERS = [
  /^\s*(?:REFRIG|FROZEN|GROCERY|PRODUCE|DAIRY|MEAT|BAKERY|DELI|BEVERAGE|GENERAL\s+MERCH|MISC|HBA|HEALTH|FLORAL|SEAFOOD)\b/i,
  /^\s*REFRIG\/FROZEN\b/i,
];

const WEIGHT_PREFIX_RE = /^\s*(\d+(?:\.\d+)?)\s*(lb|oz)\s*@\s*\d+\s*(?:lb|oz)\s*\/\s*(\d+\.\d{2})\b/i;
const QTY_PREFIX_RE    = /^\s*(\d+)\s*@\s*(?:\d+\s*\/\s*)?\$?(\d+\.\d{2})\s*$/;
const PRICE_YOU_PAY_RE = /\byou\s*pay\b/i;
const DISCOUNT_RE      = /\b(?:coupon|savings?|discount)\b/i;

function classifyLine(line) {
  if (PRICE_YOU_PAY_RE.test(line)) return "price_you_pay_header";
  if (DEPT_HEADERS.some((re) => re.test(line))) return "dept_header";
  if (WEIGHT_PREFIX_RE.test(line)) return "weight_prefix";
  if (QTY_PREFIX_RE.test(line))    return "qty_prefix";
  if (/^\s*\d{8,}\s*$/.test(line)) return "barcode";

  if (DISCOUNT_RE.test(line) && /-\s*\d+\.\d{2}/.test(line)) return "discount";

  if (ADDR_RE.test(line)) return "store_meta";
  if (PHONE_RE.test(line) && pricesIn(line).length === 0) return "store_meta";

  if (SKIP_KEYWORDS.some((re) => re.test(line))) return "skip";

  const lower = line.toLowerCase();
  if (/\bsub\s*total\b/.test(lower)) return "totals";
  if (/\btotal\s+tax\b/.test(lower) || /^\s*tax\b/.test(lower)) return "totals";
  if (/\bbalance\b/.test(lower)) return "totals";
  if (/\btotal\b/.test(lower) && pricesIn(line).length > 0) return "totals";

  if (pricesIn(line).length > 0) return "item_candidate";
  return "noise";
}

function extractItems(lines) {
  const items = [];
  const unparsed = [];

  let pendingPrefix = null;
  let useRightmostPrice = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cls = classifyLine(line);

    if (cls === "price_you_pay_header") { useRightmostPrice = true; continue; }
    if (cls === "skip" || cls === "store_meta" || cls === "noise" ||
        cls === "totals" || cls === "barcode" || cls === "dept_header") continue;

    if (cls === "weight_prefix") {
      pendingPrefix = parseWeightPrefix(line);
      continue;
    }
    if (cls === "qty_prefix") {
      pendingPrefix = parseQtyPrefix(line);
      continue;
    }

    if (cls === "discount") {
      const amt = extractDiscountAmount(line);
      if (items.length && amt !== null) {
        const last = items[items.length - 1];
        last.discount = (last.discount ?? 0) + amt;
        last.raw_text += "\n" + line;
        last.confidence = Math.max(0, last.confidence - 0.05);
      } else {
        unparsed.push(line);
      }
      continue;
    }

    if (cls === "item_candidate") {
      const item = parseItemLine(line, { pendingPrefix, useRightmostPrice });
      if (item) {
        items.push(item);
        pendingPrefix = null;
      } else {
        unparsed.push(line);
      }
      continue;
    }
  }

  if (pendingPrefix) unparsed.push(pendingPrefix.raw);
  return { items, unparsed_lines: unparsed };
}

function parseWeightPrefix(line) {
  const m = line.match(WEIGHT_PREFIX_RE);
  if (!m) return null;
  return {
    quantity: parseFloat(m[1]),
    unit: m[2].toLowerCase(),
    unit_price: parseFloat(m[3]),
    raw: line,
  };
}

function parseQtyPrefix(line) {
  const m = line.match(QTY_PREFIX_RE);
  if (!m) return null;
  return {
    quantity: parseInt(m[1], 10),
    unit: "each",
    unit_price: parseFloat(m[2]),
    raw: line,
  };
}

function extractDiscountAmount(line) {
  const m = line.match(/-\s*(\d+\.\d{2})/);
  if (!m) return null;
  return -parseFloat(m[1]);
}

function parseItemLine(line, ctx) {
  let work = line;
  let quantity = null, unit = null, unit_price = null;

  let m = work.match(/\b(\d+)\s*@\s*(?:\d+\s*\/\s*)?\$?(\d+\.\d{2})\b/);
  if (m) {
    quantity = parseInt(m[1], 10);
    unit_price = parseFloat(m[2]);
    unit = "each";
    work = work.slice(0, m.index) + " " + work.slice(m.index + m[0].length);
  } else {
    m = work.match(/\b(\d+)\s*@\s+(?=[A-Z])/);
    if (m) {
      quantity = parseInt(m[1], 10);
      unit = "each";
      work = work.slice(0, m.index) + " " + work.slice(m.index + m[0].length);
    }
  }

  if (ctx.pendingPrefix) {
    quantity = ctx.pendingPrefix.quantity;
    unit = ctx.pendingPrefix.unit;
    unit_price = ctx.pendingPrefix.unit_price;
  }

  const prices = pricesIn(work);
  if (prices.length === 0) return null;

  let total_price;
  if (ctx.useRightmostPrice && prices.length >= 2) {
    total_price = prices[prices.length - 1];
  } else {
    total_price = prices[0];
  }

  let identifier = null, identifier_type = null;
  let idMatch = work.match(/^\s*(\d{4,14})\b/);
  if (idMatch) {
    identifier = idMatch[1];
    identifier_type = classifyIdentifier(identifier);
  } else {
    const inline = work.match(/\b(\d{4,13})\b/);
    if (inline && !inline[1].includes(".")) {
      identifier = inline[1];
      identifier_type = classifyIdentifier(identifier);
    }
  }

  let desc = work;
  if (identifier) desc = desc.replace(new RegExp(`\\b${identifier}\\b`, "g"), " ");
  desc = desc.replace(/-?\$?\s*(?:\d+\.\d{2}|\.\d{2})\b/g, " ");
  desc = desc.replace(/\s+[A-Z]\b\s*$/, " ");
  desc = desc.replace(/\s+/g, " ").trim();
  if (!desc) return null;

  if (unit_price === null && quantity && quantity > 0 && unit !== null && total_price !== null) {
    unit_price = +(total_price / quantity).toFixed(4);
  }

  let confidence = 0.5;
  if (desc.length >= 3) confidence += 0.2;
  if (identifier) confidence += 0.15;
  if (quantity !== null) confidence += 0.05;
  if (unit_price !== null) confidence += 0.05;
  confidence = Math.min(1, confidence);

  return {
    raw_text: ctx.pendingPrefix ? ctx.pendingPrefix.raw + "\n" + line : line,
    description: desc,
    identifier,
    identifier_type,
    quantity,
    unit,
    unit_price,
    total_price,
    discount: null,
    confidence,
  };
}

function classifyIdentifier(id) {
  if (!id) return null;
  if (id.length === 12 || id.length === 13) return "upc";
  if (id.length === 4 || id.length === 5) return "plu";
  return "store_sku";
}

function pricesIn(line) {
  const matches = line.match(PRICE_RE) || [];
  return matches.map((s) => parseFloat(s.replace(/\$|\s/g, "")));
}
