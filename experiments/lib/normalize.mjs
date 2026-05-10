/**
 * Receipt-text → canonical-text normalization.
 *
 * Receipt printers use a tight character budget, so item descriptions arrive
 * as terse abbreviations: "BFLS CKNG THGH 2.13LB", "WHL ORG MLK 1GAL", "KS
 * WLD BLBRY". The matcher's trigram + embedding both score better when they
 * see "boneless chicken thighs" rather than the raw abbreviation.
 *
 * This is a pure function: receipt text in, normalized text + signals out.
 * No DB, no I/O. The normalizer also surfaces structured signals (brand,
 * is_store_brand, organic flag, weight, package_count) that the matcher
 * can use as side-channels in scoring.
 *
 * Strategy:
 *   1. Strip leading store-internal markers (SAFWY, KS, TJ-, **).
 *   2. Replace each receipt-token with its expansion via a curated dictionary.
 *   3. Identify and strip size markers (1GAL, 12OZ, 2.13LB) for separate use.
 *   4. Lowercase and clean whitespace.
 *
 * The dictionary is intentionally conservative — only entries that are
 * unambiguous on grocery receipts. Ambiguous tokens (e.g., "PR" could be
 * "pair" or "Premier") stay as-is and let the embedding handle them.
 */

// ── Brand / store-prefix tokens to strip from the front ────────────────────
const BRAND_PREFIXES = [
  'KS',           // Kirkland Signature (Costco)
  'KIRKLAND',
  'TJ',           // Trader Joe's
  '365',          // Whole Foods 365
  'SAFWY',
  'SFWY',
  'O ORG',        // O Organics (Safeway)
  'O ORGANICS',
  'GV',           // Great Value (Walmart)
  'MM',           // Market Maid
  'WMK',          // Western
  'SS',           // Signature Select
  'SIGNATURE',
  'OPEN NATURE',
  'LUCERNE',
  'PRIMO TAGLIO',
  'WATERFRONT BISTRO',
  'FIRST STREET', // Smart & Final
]

// ── Receipt abbreviation dictionary ────────────────────────────────────────
// Mapping is applied as whole-word replacement after splitting on whitespace.
// Keys are uppercased; values are lowercase canonical English.
const ABBREV = {
  // Proteins
  CKN:    'chicken',
  CKNG:   'chicken',
  CHKN:   'chicken',
  CHIK:   'chicken',
  BFLS:   'boneless',
  BNLS:   'boneless',
  BNLSS:  'boneless',
  SKLS:   'skinless',
  SKNLS:  'skinless',
  SLS:    'skinless',
  THGH:   'thigh',
  THGHS:  'thighs',
  BRST:   'breast',
  BRSTS:  'breasts',
  TNDRS:  'tenders',
  GRND:   'ground',
  GRD:    'ground',
  BF:     'beef',
  PRK:    'pork',
  TKY:    'turkey',
  TURK:   'turkey',
  SAUS:   'sausage',
  SAUSG:  'sausage',
  BCN:    'bacon',
  HM:     'ham',
  // Seafood
  SLMN:   'salmon',
  SCKEYE: 'sockeye salmon',
  SOCKEYE:'sockeye salmon',
  CHNK:   'chinook salmon',
  COHO:   'coho salmon',
  TLPA:   'tilapia',
  COD:    'cod',
  TUNA:   'tuna',
  SHRMP:  'shrimp',
  SHRP:   'shrimp',
  // Dairy
  MLK:    'milk',
  WHL:    'whole',
  WHLE:   'whole',
  WHT:    'white',
  '2%':   '2 percent',
  '1%':   '1 percent',
  RDC:    'reduced',
  FF:     'fat free',
  YOG:    'yogurt',
  YGT:    'yogurt',
  GRK:    'greek',
  CHZ:    'cheese',
  CHED:   'cheddar',
  CHDR:   'cheddar',
  MOZZ:   'mozzarella',
  MZRL:   'mozzarella',
  PARM:   'parmesan',
  CRM:    'cream',
  BTR:    'butter',
  STD:    'salted',
  UNSLT:  'unsalted',
  // Produce / fruit / veg
  ORG:    'organic',
  ORGN:   'organic',
  BAN:    'banana',
  BANS:   'bananas',
  AVO:    'avocado',
  AVOS:   'avocados',
  STRWBY: 'strawberry',
  STRWBR: 'strawberry',
  RASPBRY:'raspberry',
  RASPBRR:'raspberry',
  RASPBERY:'raspberry',
  RASPBERRY:'raspberry',
  BLBRY:  'blueberry',
  BLBR:   'blueberry',
  BLKBRY: 'blackberry',
  BLACKBRY:'blackberry',
  LMN:    'lemon',
  LIM:    'lime',
  ONI:    'onion',
  ONN:    'onion',
  PEPR:   'pepper',
  PEP:    'pepper',
  TOM:    'tomato',
  CARR:   'carrot',
  POT:    'potato',
  POTS:   'potatoes',
  RUSS:   'russet',
  YEL:    'yellow',
  WLD:    'wild',
  // Grains / pantry
  BRD:    'bread',
  WHT_BRD:'wheat bread',
  WHT_FLR:'wheat flour',
  RC:     'rice',
  PSTA:   'pasta',
  SPAG:   'spaghetti',
  CER:    'cereal',
  OAT:    'oats',
  OATS:   'oats',
  FLR:    'flour',
  SGR:    'sugar',
  SLT:    'salt',
  // Frozen / prepared
  PIZ:    'pizza',
  FZN:    'frozen',
  FRZ:    'frozen',
  FLATB:  'flatbread',
  CRUSTS: 'crust',
  CRUSTLS:'crustless',
  // Beverages
  JCE:    'juice',
  OJ:     'orange juice',
  AJ:     'apple juice',
  COF:    'coffee',
  TEA:    'tea',
  // Misc
  CHOC:   'chocolate',
  DK:     'dark',
  PB:     'peanut butter',
  PNTBTR: 'peanut butter',
  JLY:    'jelly',
  SOUP:   'soup',
  CHKBRTH:'chicken broth',
  VEGBRTH:'vegetable broth',
  BRTH:   'broth',
  SAU:    'sauce',
  SLD:    'salad',
  // Household
  TP:     'toilet paper',
  PT:     'paper towels',
  DET:    'detergent',
  SOAP:   'soap',
  SOFTSOAP:'soft soap',
  // Generic
  EAS:    'east',
  EST:    'east',
  WST:    'west',
  GR:     'green',
  BG:     'big',
  SM:     'small',
  REG:    'regular',
  DSP:    'disposable',
  PCK:    'pack',
  PK:     'pack',
  PKG:    'package',
  CRACK:  'crackers',
  CKRS:   'crackers',
  COOKIES:'cookies',
}

// Costco-style "48Z" (= 48 oz) and the standard suffixes.
const SIZE_RE     = /\b(\d+(?:\.\d+)?)\s*(LB|LBS|OZ|Z|FL\s*OZ|FLOZ|GAL|G|ML|L|CT|CTN|PK|PACK|EACH|EA)\b/gi
const COUNT_RE    = /\b(\d+)\s*(CT|COUNT|PK|PACK|CTN)\b/gi
const PERCENT_RE  = /\b(\d{1,3})\s*%/g

/**
 * @param {string} raw - description as parsed from the receipt
 * @returns {{
 *   normalized: string,
 *   raw: string,
 *   brand: string|null,
 *   is_store_brand: boolean,
 *   is_organic: boolean,
 *   sizes: Array<{value:number, unit:string}>,
 *   tokens: string[],
 * }}
 */
export function normalizeDescription(raw) {
  if (!raw) {
    return { normalized: '', raw: '', brand: null, is_store_brand: false, is_organic: false, sizes: [], tokens: [] }
  }

  let s = String(raw).trim()
  // Strip leading/trailing punctuation (asterisks, etc.)
  s = s.replace(/^[*\s]+|[*\s]+$/g, '')

  // Capture and strip size markers.
  const sizes = []
  s = s.replace(SIZE_RE, (_, num, unit) => {
    sizes.push({ value: parseFloat(num), unit: normalizeUnit(unit) })
    return ' '
  })

  // Identify and strip a known brand prefix (whole-word match at start).
  let brand = null
  let is_store_brand = false
  for (const prefix of BRAND_PREFIXES) {
    const re = new RegExp(`^${escapeRegExp(prefix)}\\b\\s*`, 'i')
    if (re.test(s)) {
      brand = prefix.toLowerCase()
      is_store_brand = true
      s = s.replace(re, '')
      break
    }
  }

  // Detect organic flag (could be embedded mid-string or stripped above).
  const upper = s.toUpperCase()
  const is_organic = /\bORG(?:ANIC)?\b/.test(upper) || raw.toUpperCase().match(/\bORG(?:ANIC)?\b/) !== null

  // Tokenize and expand.
  const rawTokens = s
    .toUpperCase()
    .replace(/[^A-Z0-9% ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  const expanded = []
  for (const t of rawTokens) {
    if (ABBREV[t]) expanded.push(ABBREV[t])
    else expanded.push(t.toLowerCase())
  }

  let normalized = expanded.join(' ').replace(/\s+/g, ' ').trim()
  // Strip standalone digits that came from package sizes already captured.
  normalized = normalized.replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim()

  return {
    normalized,
    raw: String(raw),
    brand,
    is_store_brand,
    is_organic,
    sizes,
    tokens: expanded,
  }
}

function normalizeUnit(u) {
  const s = String(u).toLowerCase().replace(/\s+/g, '')
  if (s === 'lb' || s === 'lbs') return 'lb'
  if (s === 'oz' || s === 'z') return 'oz'
  if (s === 'floz' || s === 'fl oz' || s === 'fl_oz') return 'fl_oz'
  if (s === 'gal') return 'gal'
  if (s === 'g') return 'g'
  if (s === 'ml') return 'ml'
  if (s === 'l') return 'l'
  if (['ct', 'count', 'pk', 'pack', 'ctn'].includes(s)) return 'count'
  if (['each', 'ea'].includes(s)) return 'each'
  return s
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
