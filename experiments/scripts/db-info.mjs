import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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

const { query, getPool } = await import('../../web/lib/receipts/db.mjs')

const [{ count }] = await query(`SELECT COUNT(*)::int AS count FROM canonical_products`)
console.log(`canonical_products: ${count}`)

const withEmb = await query(`SELECT COUNT(*)::int AS count FROM canonical_products WHERE description_embedding IS NOT NULL`)
console.log(`with embedding:     ${withEmb[0].count}`)

const sample = await query(`
  SELECT name FROM canonical_products
  WHERE name ILIKE '%blueb%' OR name ILIKE '%raspb%' OR name ILIKE '%black%' OR name ILIKE '%mushroom%' OR name ILIKE '%flatb%' OR name ILIKE '%pizza%' OR name ILIKE '%soap%' OR name ILIKE '%salmon%' OR name ILIKE '%greek%' OR name ILIKE '%yogurt%' OR name ILIKE '%cookie%' OR name ILIKE '%chocolate%' OR name ILIKE '%tomat%' OR name ILIKE '%mango%'
  ORDER BY name
`)
for (const r of sample) console.log(`  ${r.name}`)

await (await getPool()).end()
