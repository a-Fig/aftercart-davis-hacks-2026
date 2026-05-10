/**
 * Generates 384-dim sentence embeddings for canonical_products.description_embedding.
 * Uses @xenova/transformers with Xenova/all-MiniLM-L6-v2 (matches VECTOR(384) columns).
 *
 * Run after seed-build.mjs has applied the seed:
 *   node web/scripts/generate-embeddings.mjs
 *
 * First run downloads the model (~25 MB) and caches it locally.
 * Subsequent runs use the cache and take ~2–3 minutes for 47 products.
 */

import { createClient } from './seed-utils.mjs'
import { pipeline, env } from '@xenova/transformers'

// Disable remote model check in offline environments
env.allowLocalModels = true

const MODEL = 'Xenova/all-MiniLM-L6-v2'
const BATCH = 10

console.log(`Loading model ${MODEL}...`)
const embed = await pipeline('feature-extraction', MODEL)
console.log('Model loaded.')

const client = createClient()
await client.connect()

const { rows: products } = await client.query(`
  SELECT canonical_id, name FROM canonical_products WHERE description_embedding IS NULL ORDER BY canonical_id
`)

if (products.length === 0) {
  console.log('All canonical_products already have embeddings.')
  await client.end()
  process.exit(0)
}

console.log(`Generating embeddings for ${products.length} products...`)

for (let i = 0; i < products.length; i += BATCH) {
  const batch = products.slice(i, i + BATCH)
  const texts = batch.map(p => p.name)

  const output = await embed(texts, { pooling: 'mean', normalize: true })
  const vectors = output.tolist ? output.tolist() : Array.from({ length: batch.length }, (_, j) => Array.from(output.data.slice(j * 384, (j + 1) * 384)))

  for (let j = 0; j < batch.length; j++) {
    const { canonical_id, name } = batch[j]
    const vec = vectors[j]
    // PostgreSQL vector literal: '[0.1,0.2,...]'
    const pgVec = `[${vec.join(',')}]`
    await client.query(
      `UPDATE canonical_products SET description_embedding = $1::vector WHERE canonical_id = $2`,
      [pgVec, canonical_id]
    )
    process.stdout.write(`  [${i + j + 1}/${products.length}] ${name}\n`)
  }
}

await client.end()
console.log(`✓ Embeddings generated for ${products.length} products.`)
console.log('Refresh the materialized view: REFRESH MATERIALIZED VIEW CONCURRENTLY current_prices;')
