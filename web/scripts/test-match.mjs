/**
 * Smoke test: read every parsed.json under tmp/gpt-output/ and run
 * matchItems() against it, printing the matched canonical_product per
 * "compare" item. Lets us verify the trigram + vector blend without
 * needing to spin up the Next.js dev server or re-bill GPT.
 *
 * Run from repo root:
 *   node web/scripts/test-match.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// Match what Next.js does with .env.local so process.env has SUPABASE_DB_URL etc.
dotenv.config({ path: resolve(ROOT, 'web', '.env.local') })

const { matchItems } = await import('../lib/receipts/match.mjs')
const { getPool } = await import('../lib/receipts/db.mjs')

const OUT_DIR = resolve(ROOT, 'tmp', 'gpt-output')
const dirs = readdirSync(OUT_DIR)
  .map((d) => join(OUT_DIR, d))
  .filter((p) => statSync(p).isDirectory())
  .sort()

console.log(`Loading parsed.json from ${dirs.length} receipt(s)...\n`)

for (const dir of dirs) {
  const parsedPath = join(dir, 'parsed.json')
  let parsed
  try {
    parsed = JSON.parse(readFileSync(parsedPath, 'utf8'))
  } catch {
    continue
  }

  const name = dir.split(/[\\/]/).pop()
  const items = parsed.items ?? []
  const matches = await matchItems(items)

  const compareCount = items.filter((i) => i.item_type === 'compare').length
  const matchedCount = matches.filter((m) => m.match).length

  console.log(`── ${name}  (${parsed.store_name})`)
  console.log(`   ${matchedCount}/${compareCount} compare items matched`)
  for (const { item, match } of matches) {
    if (item.item_type !== 'compare') continue
    if (match) {
      const score = match.score.toFixed(2)
      const trig = match.trigram_sim.toFixed(2)
      const vec = match.vector_sim.toFixed(2)
      console.log(`   ✓ "${item.description}" → ${match.name}  (s=${score} t=${trig} v=${vec})`)
    } else {
      console.log(`   ✗ "${item.description}" → no match`)
    }
  }
  console.log()
}

await (await getPool()).end()
