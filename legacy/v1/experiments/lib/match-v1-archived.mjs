/**
 * Archived snapshot of the ORIGINAL web/lib/receipts/match.mjs (pre-v2 rollout).
 *
 * Per-item DB query, raw description (no normalization), 50/50 trigram+vector
 * blend with a length-bonus tiebreaker. Kept for the viewer's three-way
 * comparison so the historical baseline doesn't shift under us.
 *
 * Do not edit. Treat as a frozen reference implementation.
 */

import { query } from '../../web/lib/receipts/db.mjs'
import { embedText, toPgVector } from '../../web/lib/receipts/embed.mjs'

const TRIGRAM_WEIGHT = 0.5
const VECTOR_WEIGHT = 0.5
const MIN_BLENDED_SCORE = 0.35
const TOP_K_CANDIDATES = 25
const LENGTH_BONUS_PER_CHAR = 0.006
const LENGTH_BONUS_CAP = 0.15

export async function matchOne(description) {
  if (!description || description.trim().length === 0) return null
  const vec = await embedText(description)
  const pgVec = toPgVector(vec)

  const rows = await query(
    `
    SELECT
      canonical_id,
      name,
      brand,
      package_size,
      package_unit,
      pricing_unit,
      similarity(name, $1) AS trigram_sim,
      1 - (description_embedding <=> $2::vector) AS vector_sim
    FROM canonical_products
    WHERE description_embedding IS NOT NULL
    ORDER BY description_embedding <=> $2::vector
    LIMIT $3
    `,
    [description, pgVec, TOP_K_CANDIDATES],
  )

  if (rows.length === 0) return null

  let best = null
  for (const row of rows) {
    const trigram = Number(row.trigram_sim) || 0
    const vector = Number(row.vector_sim) || 0
    const lengthBonus = Math.min(
      LENGTH_BONUS_CAP,
      (row.name?.length ?? 0) * LENGTH_BONUS_PER_CHAR,
    )
    const score = trigram * TRIGRAM_WEIGHT + vector * VECTOR_WEIGHT + lengthBonus
    if (!best || score > best.score) {
      best = {
        canonical_id: row.canonical_id,
        name: row.name,
        brand: row.brand,
        package_size: row.package_size != null ? Number(row.package_size) : null,
        package_unit: row.package_unit,
        pricing_unit: row.pricing_unit,
        trigram_sim: trigram,
        vector_sim: vector,
        score,
      }
    }
  }

  return best && best.score >= MIN_BLENDED_SCORE ? best : null
}

export async function matchItems(items) {
  if (!items || items.length === 0) return []
  return Promise.all(
    items.map(async (item) => {
      if (item.item_type !== 'compare') return { item, match: null }
      const match = await matchOne(item.description)
      return { item, match }
    }),
  )
}
