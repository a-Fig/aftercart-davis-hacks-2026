/**
 * Build a self-contained viewer for the three-pipeline comparison.
 *
 * Reads:
 *   - experiments/ground-truth/*.json
 *   - tmp/gpt-output/<stem>/parsed.json   (existing GPT-5-nano runs, cached)
 *   - tmp/ocr-cache/<sha256>.json          (Vision OCR text)
 *   - receipt photos/<stem>.jpg
 *
 * Runs:
 *   - parse-v1 (web/lib/receipts/parse.mjs) on Vision text
 *   - parse-v2 (experiments/lib/parse-v2.mjs) on Vision text
 *   - match-v1 (web/lib/receipts/match.mjs) on parsed items from each parser
 *   - match-v2 (experiments/lib/match-v2.mjs) on parsed items from each parser
 *
 * Writes:
 *   - experiments/viewer/data.js         (JS file with: window.RECEIPT_DATA = {...})
 *   - experiments/viewer/images/*.jpg    (copies of the originals)
 *
 * Run from repo root:
 *   node experiments/scripts/build-viewer.mjs
 *
 * Then open experiments/viewer/index.html in a browser. No server needed.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

for (const line of readFileSync(resolve(ROOT, 'web', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq === -1) continue
  if (!process.env[t.slice(0, eq).trim()]) {
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  }
}

// v1 = the ORIGINAL parser/matcher (frozen snapshots in experiments/lib).
// v2 = the production code that lives in web/lib/receipts/ now.
// Importing v2 from web/lib/ keeps the viewer honest after the rollout —
// any future regression in production shows up here immediately.
const { parseReceipt: parseV1 } = await import('../lib/parse-v1-archived.mjs')
const { parseReceipt: parseV2 } = await import('../../web/lib/receipts/parse.mjs')
const { matchItems: matchV1 } = await import('../lib/match-v1-archived.mjs')
const { matchItems: matchV2 } = await import('../../web/lib/receipts/match.mjs')
const { getPool } = await import('../../web/lib/receipts/db.mjs')
const { scoreReceipt, aggregateScores } = await import('../lib/score.mjs')

const GT_DIR = resolve(__dirname, '..', 'ground-truth')
const VIEWER_DIR = resolve(__dirname, '..', 'viewer')
const IMAGES_DIR = resolve(VIEWER_DIR, 'images')
const PHOTOS = resolve(ROOT, 'receipt photos')
const CACHE_DIR = resolve(ROOT, 'tmp', 'ocr-cache')
const GPT_OUT = resolve(ROOT, 'tmp', 'gpt-output')

mkdirSync(IMAGES_DIR, { recursive: true })

function adaptV1(h) {
  return {
    store_name: h.store?.name ?? null,
    store_address: h.store?.address ?? null,
    receipt_date: h.dated_at ?? null,
    receipt_total: h.total ?? null,
    item_count: null,
    items: (h.items ?? []).map((it) => {
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
        item_type: 'compare',
        is_store_brand: false,
        discount: it.discount,
      }
    }),
    _internal: {
      raw_lines: h.raw_lines,
      merged_lines: h.merged_lines,
    },
  }
}

const truthFiles = readdirSync(GT_DIR).filter((f) => f.endsWith('.json')).sort()
const receipts = []

for (const tf of truthFiles) {
  const truth = JSON.parse(readFileSync(join(GT_DIR, tf), 'utf8'))
  const stem = tf.replace('.json', '')

  // Find image and copy to viewer/images
  let imgPath = null
  let imgRel = null
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = join(PHOTOS, stem + ext)
    if (existsSync(p)) {
      imgPath = p
      imgRel = `images/${stem}${ext}`
      copyFileSync(p, join(IMAGES_DIR, stem + ext))
      break
    }
  }
  if (!imgPath) {
    console.log(`SKIP ${stem}: no photo`)
    continue
  }

  // Vision OCR text from cache
  const hash = createHash('sha256').update(readFileSync(imgPath)).digest('hex')
  const cachePath = join(CACHE_DIR, `${hash}.json`)
  let visionText = null
  if (existsSync(cachePath)) {
    const visionResp = JSON.parse(readFileSync(cachePath, 'utf8'))
    visionText = visionResp.responses?.[0]?.fullTextAnnotation?.text || ''
  }

  // GPT pipeline
  const gptParsedPath = join(GPT_OUT, stem, 'parsed.json')
  let gptParsed = existsSync(gptParsedPath) ? JSON.parse(readFileSync(gptParsedPath, 'utf8')) : null
  let gptScore = gptParsed ? scoreReceipt(gptParsed, truth) : null
  let gptMatches = null
  if (gptParsed) {
    const items = (gptParsed.items ?? []).filter((it) => (it.item_type ?? 'compare') === 'compare')
    gptMatches = await matchV2(items)
  }

  // V1 pipeline (Vision + heuristic v1 + match v1)
  let v1Parsed = null, v1Score = null, v1Matches = null
  if (visionText) {
    const t0 = Date.now()
    const raw = parseV1(visionText)
    v1Parsed = adaptV1(raw)
    v1Parsed._parse_ms = Date.now() - t0
    v1Score = scoreReceipt(v1Parsed, truth)
    const items = v1Parsed.items.filter((it) => (it.item_type ?? 'compare') === 'compare')
    const t1 = Date.now()
    v1Matches = await matchV1(items)
    v1Parsed._match_ms = Date.now() - t1
  }

  // V2 pipeline (Vision + production parse + production match)
  let v2Parsed = null, v2Score = null, v2Matches = null
  if (visionText) {
    const t0 = Date.now()
    v2Parsed = parseV2(visionText)
    v2Parsed._parse_ms = Date.now() - t0
    v2Score = scoreReceipt(v2Parsed, truth)
    const items = (v2Parsed.items ?? []).filter((it) => (it.item_type ?? 'compare') === 'compare')
    const t1 = Date.now()
    v2Matches = await matchV2(items)
    v2Parsed._match_ms = Date.now() - t1
  }

  receipts.push({
    stem,
    image: imgRel,
    truth,
    vision_text: visionText,
    pipelines: {
      gpt: { parsed: gptParsed, score: gptScore, matches: gptMatches },
      v1:  { parsed: v1Parsed,  score: v1Score,  matches: v1Matches  },
      v2:  { parsed: v2Parsed,  score: v2Score,  matches: v2Matches  },
    },
  })

  console.log(`✓ ${stem}`)
}

const aggregate = {
  gpt: aggregateScores(receipts.map((r) => r.pipelines.gpt.score).filter(Boolean)),
  v1:  aggregateScores(receipts.map((r) => r.pipelines.v1.score).filter(Boolean)),
  v2:  aggregateScores(receipts.map((r) => r.pipelines.v2.score).filter(Boolean)),
}

const data = { generated_at: new Date().toISOString(), receipts, aggregate }
writeFileSync(
  join(VIEWER_DIR, 'data.js'),
  `// Auto-generated by experiments/scripts/build-viewer.mjs — do not edit\nwindow.RECEIPT_DATA = ${JSON.stringify(data, null, 2)};\n`,
)

console.log(`\nWrote ${join(VIEWER_DIR, 'data.js')}`)
console.log(`Open ${join(VIEWER_DIR, 'index.html')} in a browser.`)

await (await getPool()).end()
