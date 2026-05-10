/**
 * Vertex AI Gemini-based shelf-tag / wide-shot extractor for the field
 * collection portal.
 *
 * Two modes:
 *   shelf_tag — one product's price label, close-up. Returns a single object.
 *   wide_shot — wide shot of an aisle / shelf section. Returns an array.
 *
 * The prompt and responseSchema for each mode share the same per-item shape
 * so the orchestrator (upload.mjs) can normalize everything to a list of
 * extraction candidates.
 *
 * Auth: Application Default Credentials. Same pattern as
 * web/lib/receipts/gpt-parser.mjs — no API key in env.
 *
 * Cache: tmp/field-extract-cache/<sha256>-<mode>-v<CACHE_VERSION>.json
 * Bump CACHE_VERSION when prompts or schemas change (or model changes).
 *
 * @typedef {Object} ShelfTagExtraction
 * @property {string|null} product_name      - As printed on the tag
 * @property {string|null} brand             - Brand guess
 * @property {number|null} regular_price     - Shelf price ($)
 * @property {number|null} member_price      - Loyalty / club price ($), if shown
 * @property {number|null} pack_size         - Numeric size, e.g. 16
 * @property {string|null} pack_unit         - 'oz' | 'lb' | 'fl_oz' | 'gal' | 'ml' | 'l' | 'count' | 'each'
 * @property {string|null} barcode           - UPC if visible (8/12/13/14 digits)
 * @property {number|null} quantity          - For weighed items: lb/oz on the tag
 * @property {string|null} quantity_unit     - 'lb' | 'oz' | 'each'
 * @property {string|null} price_per_unit    - For weighed items: '$X.XX/lb' style
 * @property {string|null} position_note     - wide_shot only: location in the photo
 * @property {number} confidence             - 0.0 to 1.0
 * @property {string|null} notes             - Any caveats / partial reads
 */

import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { VertexAI } from '@google-cloud/vertexai'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..', '..')
const CACHE_DIR = resolve(ROOT, 'tmp', 'field-extract-cache')

const CACHE_VERSION = 1
const MODEL = 'gemini-2.5-flash'
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-west1'

// Per-pick max for online_pdf — these PDFs sometimes have 50+ products.
// Vertex's responseSchema doesn't enforce a max array length, but a generous
// soft target in the prompt keeps the model from trying to under-extract.
const ONLINE_PDF_TARGET = 100

// ── Vertex AI client (singleton) ─────────────────────────────────────────────

let vertexClient = null

function getVertex() {
  if (!vertexClient) {
    const project = process.env.GOOGLE_CLOUD_PROJECT
    if (!project) {
      throw new Error(
        'GOOGLE_CLOUD_PROJECT is not set. The Vertex AI SDK needs it to construct the model endpoint.',
      )
    }
    vertexClient = new VertexAI({ project, location: LOCATION })
  }
  return vertexClient
}

// ── Response schemas ─────────────────────────────────────────────────────────

const ITEM_PROPERTIES = {
  product_name: { type: 'string', nullable: true },
  brand: { type: 'string', nullable: true },
  regular_price: { type: 'number', nullable: true },
  member_price: { type: 'number', nullable: true },
  pack_size: { type: 'number', nullable: true },
  pack_unit: { type: 'string', nullable: true },
  barcode: { type: 'string', nullable: true },
  quantity: { type: 'number', nullable: true },
  quantity_unit: { type: 'string', nullable: true },
  price_per_unit: { type: 'string', nullable: true },
  position_note: { type: 'string', nullable: true },
  confidence: { type: 'number' },
  notes: { type: 'string', nullable: true },
}

const SHELF_TAG_SCHEMA = {
  type: 'object',
  properties: ITEM_PROPERTIES,
  required: ['confidence'],
}

const WIDE_SHOT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: ITEM_PROPERTIES,
        required: ['confidence'],
      },
    },
  },
  required: ['items'],
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const SHELF_TAG_PROMPT = `You are reading a single grocery shelf tag from a photo taken in a US store.

Extract the price information for ONE product:
- product_name: the product name as printed on the tag
- brand: the brand name (e.g. "Lucerne", "Kirkland Signature", "365"), or null
- regular_price: the regular shelf price as a number (e.g. 4.99). NOT a string.
- member_price: the loyalty / club price as a number, or null if no card price shown
- pack_size: numeric size (e.g. 16 for "16 oz")
- pack_unit: one of 'oz', 'lb', 'fl_oz', 'gal', 'ml', 'l', 'count', 'each'
- barcode: the UPC if visible (only digits, 8/12/13/14 chars), else null
- quantity, quantity_unit, price_per_unit: only fill these for items priced
  by weight where the tag shows e.g. "$3.99/lb" — quantity stays null but
  price_per_unit captures "$3.99/lb"
- position_note: leave null for shelf_tag mode (this is wide_shot only)
- confidence: 0.0 to 1.0 — how sure you are of the extraction overall
- notes: any caveats, partial reads, or things the user should verify

Strict rules:
- Return null for any field you can't read confidently. Don't guess.
- If the tag shows BOTH "$X.XX regular" and "$Y.YY with card", regular_price
  is X.XX and member_price is Y.YY.
- If only one price is shown, treat it as regular_price unless the tag
  explicitly says "club price" / "with loyalty card" — then use member_price.
- If the photo is not a price tag (e.g. it's the product itself, or a
  shelf without a tag), return all-null fields with confidence 0 and a
  notes string explaining what you saw.`

const WIDE_SHOT_PROMPT = `You are reading a wide shot of a grocery shelf section. Multiple price tags
are visible in the photo. Extract each LEGIBLE tag as one item in the items[]
array.

For each tag, return the same fields as a single shelf_tag extraction:
- product_name, brand, regular_price, member_price, pack_size, pack_unit,
  barcode, quantity, quantity_unit, price_per_unit, confidence, notes
- position_note: a short string locating this tag in the photo (e.g.
  "top shelf, 2nd from left", "bottom row, far right"). Helps the user
  match your output back to the photo.

Strict rules:
- Skip tags that are too blurry, occluded, or partially out of frame to
  read confidently. Don't guess at illegible numbers.
- One item per product/tag. Don't return duplicates.
- Order items left-to-right, top-to-bottom (reading order).
- If the photo doesn't contain any legible price tags, return items: [].`

// Online PDF prompt — the input is an exported product-listing page from a
// grocery chain's website (Safeway shop pages, Trader Joe's category pages,
// Costco warehouse listings, etc.). Each page typically has a grid of
// product cards: image + name + price + pack size. Density is high (often
// 30-50 products per PDF page) and the text is rendered (not photographed),
// so accuracy should be near-perfect — null fields only when truly absent.
function buildOnlinePdfPrompt(chainName) {
  const chainHint = chainName
    ? `The PDF is an exported page from ${chainName}'s online store.`
    : 'The PDF is an exported product-listing page from a grocery chain website.'
  return `You are reading an exported online-inventory PDF for grocery prices.
${chainHint}

Pages typically show a grid of product cards. Each card has:
- a product name (sometimes truncated with "...")
- a price (sometimes regular + member/club price, sometimes just per-unit)
- a pack size (count, weight, or volume)
- sometimes a sub-category label, image, review count, or promotional badge

Return up to ${ONLINE_PDF_TARGET} items in the items[] array. Each item:
- product_name: the printed name. If it's truncated with "...", expand if you
  can read context that completes it; otherwise keep the truncated form.
- brand: brand name when distinguishable from the product name (e.g. "Lucerne
  Farms", "Vital Farms", "365"). null otherwise.
- regular_price: the regular shelf price as a number. e.g. 4.99
- member_price: the loyalty/club price when shown ALONGSIDE a regular price
  (e.g. Safeway shows "$10.99 $8.99" — regular=10.99, member=8.99). null
  for chains with no loyalty program (Trader Joe's, Costco).
- pack_size: numeric. e.g. 12 for "12 ct" or 32 for "32 oz" or 1 for "1 Doz".
- pack_unit: standardized unit. Use 'count' / 'ct' for egg counts, 'oz' for
  ounces, 'fl_oz' for fluid ounces, 'lb' for pounds, 'gal' for gallons,
  'doz' for "1 Doz" or "Dozen", 'each' for single items.
- barcode: null — online inventory pages don't show UPCs.
- quantity, quantity_unit: null in this mode — these are pack-size fields.
- price_per_unit: when the page shows "$X.XX / Unit" or "$X.XX/Unit", capture
  the literal string (e.g. "$8.99 / Dozen" or "$0.33 / Count"). When the
  ENTIRE price is per-unit (e.g. Trader Joe's "$5.49/32 Oz"), the regular_price
  is the WHOLE price for the pack (5.49 in this example) and price_per_unit
  is "$0.17/oz" if the math is shown; otherwise null.
- position_note: optional, "page 2 row 3 col 1" style locator if it's helpful.
- confidence: 0.9+ for clearly-rendered listings (typical case for these PDFs).
- notes: capture any deal text ("Buy 2 Save $2", "Sponsored", "Bestseller",
  promo badges) so the reviewer can decide what to keep.

Skip rules:
- Skip cards that are out of stock with no price visible.
- Skip ad/banner blocks that aren't products.
- Skip filter/sort/category UI text (e.g. "Egg Count", "Brand", "Filters").
- Skip recipe cards or non-product editorial blocks.
- Skip duplicates within the same PDF (rare but check for repeated cards).

If the PDF has no legible product cards, return items: [].`
}

// ── MIME type detection (mirrors gpt-parser.mjs) ─────────────────────────────

function detectMimeType(base64) {
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  if (base64.startsWith('iVBOR')) return 'image/png'
  if (base64.startsWith('UklGR')) return 'image/webp'
  return 'image/jpeg'
}

// ── Vertex API call ──────────────────────────────────────────────────────────

async function callVertex(systemPrompt, base64, responseSchema, options = {}) {
  const { mimeTypeOverride, userText, maxOutputTokens } = options
  const vertex = getVertex()
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema,
    temperature: 0,
  }
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens

  const model = vertex.getGenerativeModel({
    model: MODEL,
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
    generationConfig,
  })

  const mimeType = mimeTypeOverride ?? detectMimeType(base64)
  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: userText ?? 'Read the price tag(s) in this photo.' },
        ],
      },
    ],
  })

  const response = result?.response
  const candidate = response?.candidates?.[0]
  const text = candidate?.content?.parts
    ?.map((p) => p.text ?? '')
    .filter(Boolean)
    .join('')
  if (!text) {
    throw new Error('Vertex returned empty content for field extraction')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Vertex returned non-JSON for field extraction: ${text.slice(0, 200)}`)
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract a single shelf-tag's data from an image.
 *
 * @param {string} imageBase64
 * @returns {Promise<{ extraction: ShelfTagExtraction, raw: object, cached: boolean, model: string }>}
 */
export async function extractShelfTag(imageBase64) {
  return runMode('shelf_tag', imageBase64, SHELF_TAG_PROMPT, SHELF_TAG_SCHEMA)
}

/**
 * Extract every legible price tag from a wide-shelf shot.
 *
 * @param {string} imageBase64
 * @returns {Promise<{ extractions: ShelfTagExtraction[], raw: object, cached: boolean, model: string }>}
 */
export async function extractWideShot(imageBase64) {
  return runMode('wide_shot', imageBase64, WIDE_SHOT_PROMPT, WIDE_SHOT_SCHEMA)
}

/**
 * Extract every product card from an exported online-inventory PDF.
 * Vertex AI Gemini accepts PDFs directly via inlineData with
 * mimeType='application/pdf' (up to 1000 pages / 50 MB inline).
 *
 * @param {string} pdfBase64
 * @param {Object} [options]
 * @param {string|null} [options.chainName] - "Safeway" / "Trader Joe's" etc.
 *        Adds a chain hint to the system prompt so the model knows whether
 *        to expect loyalty pricing (Safeway: yes; TJ's / Costco: no).
 * @returns {Promise<{ extractions: ShelfTagExtraction[], raw: object, cached: boolean, model: string }>}
 */
export async function extractOnlinePdf(pdfBase64, { chainName = null } = {}) {
  const prompt = buildOnlinePdfPrompt(chainName)
  // Cache key includes a hash of the chainName so swapping Safeway → TJ's
  // doesn't reuse the wrong cached response.
  const chainKey = chainName ? `-${chainName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : ''
  const hash = createHash('sha256').update(pdfBase64).digest('hex')
  const cachePath = join(CACHE_DIR, `${hash}-online_pdf${chainKey}-v${CACHE_VERSION}.json`)

  let raw
  let cached
  if (existsSync(cachePath)) {
    raw = JSON.parse(readFileSync(cachePath, 'utf8'))
    cached = true
  } else {
    raw = await callVertex(prompt, pdfBase64, WIDE_SHOT_SCHEMA, {
      mimeTypeOverride: 'application/pdf',
      userText:
        'Extract every product card from this PDF. Skip filter/category/banner UI.',
      // Generous token budget — a 50-product PDF with full notes can run
      // longer than the default 8k cap.
      maxOutputTokens: 32000,
    })
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cachePath, JSON.stringify(raw, null, 2), 'utf8')
    cached = false
  }

  const items = Array.isArray(raw?.items) ? raw.items : []
  return {
    extractions: items.map(normalizeOne),
    raw,
    cached,
    model: MODEL,
  }
}

async function runMode(mode, imageBase64, prompt, schema) {
  const hash = createHash('sha256').update(imageBase64).digest('hex')
  const cachePath = join(CACHE_DIR, `${hash}-${mode}-v${CACHE_VERSION}.json`)

  let raw
  let cached
  if (existsSync(cachePath)) {
    raw = JSON.parse(readFileSync(cachePath, 'utf8'))
    cached = true
  } else {
    raw = await callVertex(prompt, imageBase64, schema)
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cachePath, JSON.stringify(raw, null, 2), 'utf8')
    cached = false
  }

  if (mode === 'shelf_tag') {
    return { extraction: normalizeOne(raw), raw, cached, model: MODEL }
  }
  const items = Array.isArray(raw?.items) ? raw.items : []
  return {
    extractions: items.map(normalizeOne),
    raw,
    cached,
    model: MODEL,
  }
}

/**
 * Normalize raw model output into the canonical ShelfTagExtraction shape.
 * Coerces numeric strings to numbers, validates barcode shape, fills nulls.
 */
function normalizeOne(item) {
  const out = {
    product_name: trimOrNull(item?.product_name),
    brand: trimOrNull(item?.brand),
    regular_price: toNumberOrNull(item?.regular_price),
    member_price: toNumberOrNull(item?.member_price),
    pack_size: toNumberOrNull(item?.pack_size),
    pack_unit: trimOrNull(item?.pack_unit)?.toLowerCase() ?? null,
    barcode: validateBarcode(item?.barcode),
    quantity: toNumberOrNull(item?.quantity),
    quantity_unit: trimOrNull(item?.quantity_unit)?.toLowerCase() ?? null,
    price_per_unit: trimOrNull(item?.price_per_unit),
    position_note: trimOrNull(item?.position_note),
    confidence: clamp01(toNumberOrNull(item?.confidence) ?? 0),
    notes: trimOrNull(item?.notes),
  }
  return out
}

function trimOrNull(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length === 0 ? null : s
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/**
 * Barcodes from OCR are noisy. Accept only strings of digits, length
 * 8/12/13/14 (UPC-E / UPC-A / EAN-13 / GTIN-14). Otherwise null.
 */
function validateBarcode(v) {
  if (v == null) return null
  const digits = String(v).replace(/\D/g, '')
  if (digits.length === 8 || digits.length === 12 || digits.length === 13 || digits.length === 14) {
    return digits
  }
  return null
}
