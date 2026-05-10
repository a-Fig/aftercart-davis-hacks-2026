/**
 * Inspect a receipt image or OCR text file and print a human-readable summary
 * of everything the parser extracted.
 *
 * Usage (from repo root):
 *   node web/scripts/inspect-receipt.mjs <path>
 *   node web/scripts/inspect-receipt.mjs <path> --raw   # include merged OCR lines
 *   node web/scripts/inspect-receipt.mjs <path> --json  # dump raw ParsedReceipt JSON
 *
 * Accepts image files (.jpg/.jpeg/.png/.webp/.heic) or plain text files (.txt).
 * For images, reads from tmp/ocr-output/<name>/full-text.txt when cached.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname, basename, extname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { parseReceipt } from '../lib/receipts/parse.mjs'
import { readEnv } from './seed-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const TMP = resolve(ROOT, 'tmp')
const CACHE_DIR = join(TMP, 'ocr-cache')
const OUTPUT_DIR = join(TMP, 'ocr-output')

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const inputPath = args.find(a => !a.startsWith('--'))
const showRaw = args.includes('--raw')
const jsonMode = args.includes('--json')

if (!inputPath) {
  process.stderr.write(
    'Usage:\n' +
    '  node web/scripts/inspect-receipt.mjs <path>\n' +
    '  node web/scripts/inspect-receipt.mjs <path> --raw   # include merged OCR lines\n' +
    '  node web/scripts/inspect-receipt.mjs <path> --json  # dump raw ParsedReceipt JSON\n' +
    '\nAccepts .jpg/.jpeg/.png/.webp/.heic images or .txt files.\n'
  )
  process.exit(1)
}

const absPath = resolve(inputPath)
if (!existsSync(absPath)) {
  process.stderr.write(`File not found: ${absPath}\n`)
  process.exit(1)
}

// ── OCR text resolution ───────────────────────────────────────────────────────

const ext = extname(absPath).toLowerCase()
const isText = ext === '.txt'
const isImage = /\.(jpe?g|png|webp|heic)$/i.test(ext)

if (!isText && !isImage) {
  process.stderr.write(`Unsupported file type: ${ext}. Expected .txt or image (.jpg/.jpeg/.png/.webp/.heic).\n`)
  process.exit(1)
}

let ocrText, label

if (isText) {
  ocrText = readFileSync(absPath, 'utf8')
  label = 'text'
} else {
  const name = basename(absPath, ext)
  const cachedTxt = join(OUTPUT_DIR, name, 'full-text.txt')

  if (existsSync(cachedTxt)) {
    ocrText = readFileSync(cachedTxt, 'utf8')
    label = 'cached'
  } else {
    // Need Vision API
    const env = readEnv()
    const apiKey = env.GOOGLE_VISION_API_KEY
    if (!apiKey) {
      process.stderr.write('Missing GOOGLE_VISION_API_KEY in web/.env.local\n')
      process.exit(1)
    }

    const bytes = readFileSync(absPath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const cacheFile = join(CACHE_DIR, `${hash}.json`)

    let visionResponse
    if (existsSync(cacheFile)) {
      visionResponse = JSON.parse(readFileSync(cacheFile, 'utf8'))
    } else {
      process.stderr.write('No cached OCR found — calling Vision API...\n')
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: bytes.toString('base64') },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['en'] },
            }],
          }),
        }
      )
      if (!res.ok) {
        const text = await res.text()
        process.stderr.write(`Vision API error ${res.status}: ${text.slice(0, 500)}\n`)
        process.exit(1)
      }
      visionResponse = await res.json()
      if (visionResponse.responses?.[0]?.error) {
        process.stderr.write(`Vision error: ${JSON.stringify(visionResponse.responses[0].error)}\n`)
        process.exit(1)
      }
      mkdirSync(CACHE_DIR, { recursive: true })
      writeFileSync(cacheFile, JSON.stringify(visionResponse, null, 2))
    }

    ocrText = visionResponse.responses?.[0]?.fullTextAnnotation?.text || ''

    // Write to standard output locations for future cache hits
    const outDir = join(OUTPUT_DIR, name)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'full-text.txt'), ocrText)
    label = 'live'
  }
}

// ── Parse ─────────────────────────────────────────────────────────────────────

const parsed = parseReceipt(ocrText)

// ── JSON mode ─────────────────────────────────────────────────────────────────

if (jsonMode) {
  process.stdout.write(JSON.stringify(parsed, null, 2) + '\n')
  process.exit(0)
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const W = 61

function hr(char = '─') { return char.repeat(W) }

function d(n) {
  // Display a nullable number as "$X.XX" or "—"
  if (n == null) return '—'
  return `$${Math.abs(n).toFixed(2)}`
}

function circle(i) {
  // ①②...⑳ then [N]
  return i < 20 ? String.fromCodePoint(0x2460 + i) : `[${i + 1}]`
}

// ── Print ─────────────────────────────────────────────────────────────────────

const filename = basename(absPath)

console.log('═'.repeat(W))
console.log(` ${filename}  [${label}]`)
console.log('═'.repeat(W))
console.log()

// STORE
const {
  store_name, store_address, store_phone,
  receipt_date, receipt_total, tax, subtotal,
  items, unparsed_lines, merged_lines,
} = parsed
console.log('STORE')
if (store_name) {
  const loc = [store_name, store_address].filter(Boolean).join(' · ')
  console.log(`  ${loc}`)
} else {
  console.log('  (store not identified)')
}
if (store_phone) console.log(`  Phone: ${store_phone}`)
console.log(`  Date: ${receipt_date ?? '—'}   Total: ${d(receipt_total)}   Tax: ${d(tax)}   Subtotal: ${d(subtotal)}`)
console.log()

// ITEMS
console.log(`ITEMS (${items.length})`)
if (items.length === 0) {
  console.log('  (none)')
} else {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    console.log(`  ${circle(i)} ${item.description ?? '(no description)'}`)

    // Price/qty line — shelf_price is the printed price, member_price reflects
    // any loyalty discount. They're equal for stores without a loyalty program.
    const priceParts = []
    if (item.quantity != null && item.unit) {
      priceParts.push(`qty: ${item.quantity} ${item.unit}`)
      if (item.unit_price != null) priceParts.push(`unit_price: ${d(item.unit_price)}`)
    }
    priceParts.push(`shelf: ${d(item.shelf_price)}`)
    if (item.member_price != null && item.member_price !== item.shelf_price) {
      priceParts.push(`member: ${d(item.member_price)}`)
    }
    if (item.discount != null) {
      priceParts.push(`discount: –${Math.abs(item.discount).toFixed(2)}`)
    }
    console.log(`    ${priceParts.join('   ')}`)

    // Identifier + confidence
    const idPart = item.code ? `id: ${item.code} (${item.code_type})   ` : ''
    console.log(`    ${idPart}confidence: ${item.confidence.toFixed(2)}`)

    // Raw text (newlines → ' / ')
    console.log(`    raw: "${item.raw_text.replace(/\n/g, ' / ')}"`)

    if (i < items.length - 1) console.log()
  }
}
console.log()

// UNPARSED LINES
console.log(`UNPARSED LINES (${unparsed_lines.length})`)
if (unparsed_lines.length === 0) {
  console.log('  (none)')
} else {
  for (const line of unparsed_lines) console.log(`  "${line}"`)
}
console.log()

// TOTALS CHECK
console.log(hr())
console.log('TOTALS CHECK')
// shelf_price is the printed line total (pre-discount); member_price is what
// the customer actually paid after any loyalty discount.
const shelfSum  = items.reduce((s, it) => s + (it.shelf_price  ?? 0), 0)
const memberSum = items.reduce((s, it) => s + (it.member_price ?? it.shelf_price ?? 0), 0)
console.log(`  items shelf: $${shelfSum.toFixed(2)}   items member (after loyalty): $${memberSum.toFixed(2)}`)
console.log(`  receipt total: ${d(receipt_total)}   tax: ${d(tax)}`)
if (receipt_total != null) {
  const diff = Math.min(Math.abs(shelfSum - receipt_total), Math.abs(memberSum - receipt_total))
  if (diff < 0.02) {
    console.log('  ✓ items sum matches receipt total')
  } else {
    console.log(`  ✗ mismatch: shelf $${shelfSum.toFixed(2)} / member $${memberSum.toFixed(2)} ≠ receipt total ${d(receipt_total)} (diff $${diff.toFixed(2)})`)
  }
} else {
  console.log('  (receipt total not found — cannot verify)')
}

// MERGED OCR LINES (--raw)
if (showRaw) {
  console.log()
  console.log(hr())
  console.log(`MERGED OCR LINES (${merged_lines.length})`)
  const pad = String(merged_lines.length).length
  for (let i = 0; i < merged_lines.length; i++) {
    console.log(`  ${String(i + 1).padStart(pad)}  ${merged_lines[i]}`)
  }
}

console.log()
