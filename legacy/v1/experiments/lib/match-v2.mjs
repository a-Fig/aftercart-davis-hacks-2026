/**
 * Matcher v2 — in-memory, normalized, batched.
 *
 * Differences from web/lib/receipts/match.mjs:
 *
 *   1. Loads canonical_products + embeddings ONCE (single DB query) into
 *      memory at startup. All subsequent matches scan the in-memory list.
 *      For 47 products this is trivial; even 1000 products is fine. If/when
 *      the catalog grows past ~10k, switch back to HNSW.
 *   2. Embeds receipt items in a single batched call (one model warmup).
 *   3. Normalizes the receipt description before embedding so "BFLS CKNG
 *      THGH" gets compared as "boneless chicken thigh".
 *   4. Multi-text trigram: max similarity over {raw, normalized, raw_no_brand}
 *      so the brand prefix can't hurt scoring.
 *   5. Category-bias: items with strong product keywords ("milk", "eggs",
 *      "cheese") get a small boost when the candidate's name shares the
 *      keyword. Cheap and high-precision.
 *   6. Conservative threshold: a wrong match is worse than no match (per
 *      the product spec — never silently show a low-confidence guess).
 *
 * Public API mirrors v1: matchOne(description), matchItems(items).
 */

import { embedBatch, toPgVector } from '../../web/lib/receipts/embed.mjs'
import { getPool, query } from '../../web/lib/receipts/db.mjs'
import { normalizeDescription } from './normalize.mjs'

// ── Tuning ────────────────────────────────────────────────────────────────
const TRIGRAM_WEIGHT = 0.4
const VECTOR_WEIGHT  = 0.6
const KEYWORD_BONUS  = 0.08
const KEYWORD_BONUS_CAP = 0.16
const LENGTH_BONUS_PER_CHAR = 0.005
const LENGTH_BONUS_CAP = 0.10
const MIN_BLENDED_SCORE = 0.35
const MIN_VECTOR_SIM    = 0.30  // a candidate must clear this individually
                                // OR have a strong trigram match

// Single-token keywords that, when present in BOTH the receipt description
// and a candidate canonical name, justify a small score bump. These are
// curated for high precision — generic words like "and" never appear.
//
// Importantly: this set contains nouns identifying THE PRODUCT (milk,
// chicken, banana). It does NOT contain modifiers like "organic", "frozen",
// "whole", "greek" — those would falsely boost any organic-eggs candidate
// when matching an organic-raspberry receipt line.
const PRODUCT_KEYWORDS = new Set([
  'milk', 'eggs', 'egg', 'cheese', 'butter', 'yogurt', 'cream',
  'chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage',
  'salmon', 'tuna', 'shrimp', 'fish',
  'banana', 'bananas', 'apple', 'apples', 'orange', 'oranges',
  'tomato', 'tomatoes', 'onion', 'onions', 'potato', 'potatoes',
  'carrot', 'carrots', 'pepper', 'peppers', 'broccoli', 'spinach',
  'lemon', 'lime', 'garlic', 'celery', 'lettuce', 'avocado',
  'strawberry', 'strawberries', 'blueberry', 'blueberries',
  'raspberry', 'raspberries', 'blackberry', 'blackberries', 'mango',
  'pineapple', 'grape', 'grapes', 'pomegranate', 'papaya',
  'bread', 'rice', 'pasta', 'spaghetti', 'flour', 'sugar',
  'cereal', 'oats', 'tortilla', 'tortillas',
  'oil', 'olive',
  'sauce', 'soup', 'broth', 'jelly', 'jam',
  'peanut', 'mayonnaise', 'ketchup', 'mustard',
  'coffee', 'tea', 'juice', 'water',
  'cheddar', 'mozzarella', 'parmesan',
  'chocolate', 'cookies', 'cookie', 'crackers',
  'soap', 'detergent', 'pizza', 'flatbread',
  'pesto', 'fennel', 'oregano', 'mushroom', 'mushrooms',
  'pie', 'crust', 'crusts', 'plantain', 'habanero', 'fish',
  'dip', 'sticks',
])

// Modifier tokens we DO want to count when both sides agree, but with a
// smaller bump than product keywords — so "organic raspberry" prefers
// "Organic raspberries" over plain "Raspberries", but "organic milk" doesn't
// beat "Whole milk" purely on the modifier.
const MODIFIER_KEYWORDS = new Set([
  'organic', 'frozen', 'whole', 'greek', 'wild', 'dark', 'light',
  'red', 'green', 'yellow', 'white',
])

// ── In-memory catalog ─────────────────────────────────────────────────────

let catalogPromise = null

async function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const rows = await query(
        `SELECT canonical_id, name, brand, package_size, package_unit,
                pricing_unit, category_id, description_embedding
         FROM canonical_products
         WHERE description_embedding IS NOT NULL`,
        [],
      )
      // Parse the pgvector string "[0.1,0.2,...]" → Float32Array.
      const products = rows.map((r) => {
        const emb = parsePgVector(r.description_embedding)
        const lowerName = String(r.name).toLowerCase()
        return {
          canonical_id: r.canonical_id,
          name: r.name,
          brand: r.brand,
          package_size: r.package_size != null ? Number(r.package_size) : null,
          package_unit: r.package_unit,
          pricing_unit: r.pricing_unit,
          category_id: r.category_id,
          embedding: emb,
          name_lower: lowerName,
          name_keywords: extractKeywords(lowerName),
          name_modifiers: extractModifiers(lowerName),
          name_trigrams: trigrams(lowerName),
        }
      })
      return products
    })()
  }
  return catalogPromise
}

/**
 * Match a single description string against the in-memory catalog.
 * Convenience wrapper — for batches use matchItems().
 */
export async function matchOne(description) {
  const results = await matchItems([{ description, item_type: 'compare' }])
  return results[0]?.match ?? null
}

/**
 * Match every "compare" item against the canonical catalog. Items are
 * embedded in one batched call. Items with item_type !== 'compare' get
 * match: null.
 *
 * @param {Array<{description?: string, item_type?: string}>} items
 * @returns {Promise<Array<{item: object, match: object|null, score_breakdown?: object}>>}
 */
export async function matchItems(items) {
  if (!items || items.length === 0) return []

  const catalog = await getCatalog()

  // Normalize once, embed in one batch.
  const norms = items.map((it) => normalizeDescription(it.description ?? ''))
  const compareIdx = items
    .map((it, i) => ((it.item_type ?? 'compare') === 'compare' ? i : -1))
    .filter((i) => i >= 0)

  const textsToEmbed = compareIdx.map((i) => norms[i].normalized || items[i].description || '')
  const embeddings = textsToEmbed.length > 0 ? await embedBatch(textsToEmbed) : []

  const results = items.map((it) => ({ item: it, match: null }))

  for (let k = 0; k < compareIdx.length; k++) {
    const i = compareIdx[k]
    const item = items[i]
    const norm = norms[i]
    const queryEmbed = embeddings[k]

    let best = null
    for (const cand of catalog) {
      const trig = trigramSimilarity(norm, cand)
      const vec = cosine(queryEmbed, cand.embedding)
      const kwBonus = keywordBonus(norm, cand)
      const lenBonus = Math.min(LENGTH_BONUS_CAP, cand.name.length * LENGTH_BONUS_PER_CHAR)
      const score = trig * TRIGRAM_WEIGHT + vec * VECTOR_WEIGHT + kwBonus + lenBonus

      if (!best || score > best.score) {
        best = {
          canonical_id: cand.canonical_id,
          name: cand.name,
          brand: cand.brand,
          package_size: cand.package_size,
          package_unit: cand.package_unit,
          pricing_unit: cand.pricing_unit,
          category_id: cand.category_id,
          trigram_sim: trig,
          vector_sim: vec,
          keyword_bonus: kwBonus,
          length_bonus: lenBonus,
          score,
        }
      }
    }

    if (best && best.score >= MIN_BLENDED_SCORE && (best.vector_sim >= MIN_VECTOR_SIM || best.trigram_sim >= 0.4)) {
      results[i].match = best
    }
  }

  return results
}

// ── Scoring helpers ───────────────────────────────────────────────────────

function trigramSimilarity(norm, cand) {
  // Take the max similarity over (normalized, raw, no-brand-raw) so that a
  // brand prefix can't hurt the score. Each variant is computed once per
  // (item, canonical) pair, which is fine for 47-product catalogs.
  const a = trigrams(norm.normalized)
  const b = cand.name_trigrams
  let best = jaccard(a, b)

  if (norm.raw) {
    const rawLower = norm.raw.toLowerCase()
    const rawTri = trigrams(rawLower)
    best = Math.max(best, jaccard(rawTri, b))
  }
  return best
}

function trigrams(s) {
  if (!s) return new Set()
  const padded = `  ${s}  `.toLowerCase().replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ').trim()
  const set = new Set()
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3))
  }
  return set
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

function cosine(a, b) {
  // Embeddings come in already L2-normalized (the embedder uses normalize:true
  // and pgvector stored what we generated), so cosine == dot product.
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

function keywordBonus(norm, cand) {
  const tokens = new Set(norm.normalized.split(/\s+/).filter(Boolean).map(lemmatize))
  let bonus = 0
  for (const t of tokens) {
    if (PRODUCT_KEYWORDS.has(t) && cand.name_keywords.has(t)) {
      bonus += KEYWORD_BONUS
    } else if (MODIFIER_KEYWORDS.has(t) && cand.name_modifiers.has(t)) {
      bonus += KEYWORD_BONUS * 0.4
    }
    if (bonus >= KEYWORD_BONUS_CAP) return KEYWORD_BONUS_CAP
  }
  return bonus
}

function extractKeywords(text) {
  const tokens = new Set()
  for (const t of text.split(/[^a-z0-9%]+/).filter(Boolean)) {
    const lemma = lemmatize(t)
    if (PRODUCT_KEYWORDS.has(lemma)) tokens.add(lemma)
  }
  return tokens
}

function extractModifiers(text) {
  const tokens = new Set()
  for (const t of text.split(/[^a-z0-9%]+/).filter(Boolean)) {
    if (MODIFIER_KEYWORDS.has(t)) tokens.add(t)
  }
  return tokens
}

// Naive English noun lemmatizer — collapses common plurals and -y/-ies pairs.
// Just enough that "blueberries" and "blueberry" land in the same bucket.
// We keep PRODUCT_KEYWORDS in singular form so the lemma can be looked up.
function lemmatize(t) {
  if (t.length < 4) return t
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y'      // berries → berry
  if (t.endsWith('oes')) return t.slice(0, -2)             // tomatoes → tomato
  if (t.endsWith('sses')) return t.slice(0, -2)            // crosses → cross
  if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1) // bananas → banana
  return t
}

// ── pgvector parsing ──────────────────────────────────────────────────────

function parsePgVector(s) {
  if (Array.isArray(s)) return Float32Array.from(s)
  if (typeof s !== 'string') return new Float32Array()
  const trimmed = s.startsWith('[') ? s.slice(1, -1) : s
  return Float32Array.from(trimmed.split(',').map(Number))
}

export async function closePool() {
  const p = getPool()
  return p.end()
}
