/**
 * POST /api/match
 *
 * First half of the two-stage receipt-comparison flow. Takes an image, runs
 * OCR + parse + LLM-driven matching (OFF-first with canonical fallback),
 * and returns the parsed receipt + per-item matches with LLM reasoning.
 *
 * The client renders the ReviewScreen from this response, lets the user
 * confirm or swap matches, then echoes the parsed receipt + corrections back
 * to /api/compare which does the price lookup.
 *
 *   Stage 1: POST /api/match    { image, location?, radius_miles? }    →  this route
 *   Stage 2: POST /api/compare  { parsed, corrections, location?, radius_miles? }
 *
 * Pipeline:
 *   1. Vision OCR → heuristic chain hint
 *   2. Heuristic parse (primary) or GPT vision parse (fallback)
 *   3. matchUnified() — LLM interprets items, searches OFF, evaluates
 *      candidates. Falls back to canonical trigram+cosine if LLM fails.
 *   4. Enrichment batch for candidate images.
 *
 * Response shape — typed in web/lib/api/compare.ts as MatchResponse.
 */

import { NextRequest } from 'next/server'

import { parseReceipt } from '@/lib/receipts/parse.mjs'
import { processReceipt } from '@/lib/receipts/gpt-parser.mjs'
import { visionAnnotate, extractText } from '@/lib/receipts/vision.mjs'
import { matchUnified } from '@/lib/receipts/match-unified.mjs'
import { normalizeDescription } from '@/lib/receipts/normalize.mjs'
import { getSharedOff, getEnrichmentBatch } from '@/lib/off/query.mjs'

export const runtime = 'nodejs'
export const maxDuration = 60

type RequestBody = {
  image?: string
  location?: { lon: number; lat: number }
  radius_miles?: number
}

function deriveUnitPrice(item: {
  unit_price?: number | null
  unit?: string | null
  quantity?: number | null
  member_price?: number | null
}): number | null {
  if (typeof item.unit_price === 'number' && Number.isFinite(item.unit_price) && item.unit_price > 0) {
    return Number(item.unit_price.toFixed(4))
  }
  const u = item.unit
  const q = item.quantity
  const p = item.member_price
  if (!u || u === 'each' || u === 'count') return null
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0) return null
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return null
  return Number((p / q).toFixed(4))
}

export async function POST(req: NextRequest) {
  const visionKey = process.env.GOOGLE_VISION_API_KEY
  if (!visionKey) {
    return Response.json(
      { error: 'Server missing GOOGLE_VISION_API_KEY' },
      { status: 500 },
    )
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const image = body.image
  if (!image || typeof image !== 'string') {
    return Response.json(
      { error: 'Body must include "image" as a base64 string' },
      { status: 400 },
    )
  }
  const base64 = image.startsWith('data:') ? image.split(',', 2)[1] : image

  // Step 1: Vision OCR → heuristic parse for items AND chain hint.
  // The heuristic parser is more accurate than GPT vision on the test set
  // (100% vs ~80% item recall). Use it as primary, GPT as fallback.
  let ocrText: string | null = null
  let heuristicParsed: Record<string, unknown> | null = null
  let chainHint: string | null = null
  try {
    const visionResp = await visionAnnotate(base64, visionKey)
    ocrText = extractText(visionResp)
    heuristicParsed = parseReceipt(ocrText) as Record<string, unknown>
    chainHint = (heuristicParsed?.store_name as string) ?? null
  } catch (err) {
    console.warn('[match] Vision OCR / heuristic parse failed:', (err as Error).message)
  }

  // Step 2: Determine which parse to use. Prefer heuristic if it produced items.
  let parsed: Record<string, unknown>
  let chain: string
  let warnings: string[] = []
  let parseSource: 'heuristic' | 'gpt'

  const heuristicItems = (heuristicParsed?.items as unknown[]) ?? []
  if (heuristicParsed && heuristicItems.length > 0) {
    parsed = heuristicParsed
    chain = chainHint || '(unknown)'
    parseSource = 'heuristic'
  } else {
    // Fallback to GPT vision parse
    try {
      const openrouterKey = process.env.OPENROUTER_KEY || ''
      const result = await processReceipt(base64, openrouterKey, { chainHint }) as {
        chain: string; parsed: Record<string, unknown>; warnings: string[]
      }
      parsed = result.parsed
      chain = result.chain
      warnings = result.warnings
      parseSource = 'gpt'
    } catch (err) {
      return Response.json(
        { error: 'Receipt parse failed', detail: (err as Error).message },
        { status: 502 },
      )
    }
  }

  const rawItems = (parsed.items ?? []) as Array<Record<string, unknown>>

  // Step 3: LLM-driven matching via matchUnified.
  const offDb = getSharedOff()
  let matchResults: Array<Record<string, unknown>>
  try {
    matchResults = await matchUnified(rawItems, {
      chainName: chain,
      offDb,
      topK: 5,
    }) as Array<Record<string, unknown>>
  } catch (err) {
    console.error('[match] matchUnified failed:', (err as Error).message)
    return Response.json(
      { error: 'Matching failed', detail: (err as Error).message },
      { status: 502 },
    )
  }

  // Step 4: Enrichment batch for all OFF barcodes in candidates + picks.
  const allBarcodes: string[] = []
  for (const r of matchResults) {
    const pick = r.pick as Record<string, unknown> | null
    if (pick?.barcode) allBarcodes.push(pick.barcode as string)
    const candidates = (r.candidates ?? []) as Array<Record<string, unknown>>
    for (const c of candidates) {
      if (c.barcode) allBarcodes.push(c.barcode as string)
    }
  }
  const enrichments = offDb && allBarcodes.length
    ? getEnrichmentBatch(offDb, allBarcodes)
    : new Map()

  // Compose the response.
  const items = matchResults.map((r, line_index) => {
    const item = r.item as Record<string, unknown>
    const norm = r.norm as Record<string, unknown>
    const interp = r.interpretation as Record<string, unknown> | null
    const pick = r.pick as Record<string, unknown> | null
    const candidates = (r.candidates ?? []) as Array<Record<string, unknown>>

    // Attach enrichment to candidates
    const enrichedCandidates = candidates.map(c => {
      const barcode = c.barcode as string | null
      const enrichment = barcode ? (enrichments.get(barcode) || null) : null
      return { ...c, enrichment }
    })

    // Build suggested_match from the LLM's pick
    let suggested_match = null
    if (pick) {
      const barcode = pick.barcode as string | null
      const pickEnrichment = barcode ? (enrichments.get(barcode) || null) : null
      suggested_match = {
        source: pick.source || 'off',
        canonical_id: pick.canonical_id || null,
        barcode: barcode || null,
        name: pick.display_name || pick.derived_canonical_name || '',
        brand: null as string | null,
        package_size: null as number | null,
        package_unit: null as string | null,
        score: null as number | null,
        reason: pick.reason || '',
        match_confidence: pick.match_confidence || 'medium',
        enrichment: pickEnrichment || (r.off_enrichment as Record<string, unknown> | null),
      }
    }

    return {
      line_index,
      raw_text: item.raw_text,
      description: item.description,
      description_raw: item.raw_text || item.description,
      code: item.code,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: deriveUnitPrice(item as {
        unit_price?: number | null; unit?: string | null;
        quantity?: number | null; member_price?: number | null
      }),
      shelf_price: item.shelf_price,
      member_price: item.member_price,
      is_store_brand: item.is_store_brand,
      item_type: item.item_type,
      annotations: (norm?.annotations ?? []) as unknown[],
      llm_interpretation: interp ? {
        product_name: interp.product_name,
        brand_guess: interp.brand_guess || null,
        size_guess: interp.size_guess || null,
        reasoning: interp.reasoning,
        confidence: interp.confidence,
        is_produce_or_generic: interp.is_produce_or_generic,
      } : null,
      suggested_match,
      candidates: enrichedCandidates,
      match_method: r.match_method || 'llm',
    }
  })

  const compareItems = items.filter(i => i.item_type === 'compare')
  const matchedCount = compareItems.filter(i => i.suggested_match).length

  return Response.json({
    receipt: {
      store_name: parsed.store_name,
      store_address: parsed.store_address,
      receipt_date: parsed.receipt_date,
      receipt_total: parsed.receipt_total,
      item_count: parsed.item_count,
    },
    chain_detected: chain,
    parse_source: parseSource,
    parsed,
    items,
    summary: {
      total_items: items.length,
      compare_items: compareItems.length,
      matched: matchedCount,
      unmatched: compareItems.length - matchedCount,
    },
    schema_warnings: warnings,
    location_default: body.location ?? null,
    radius_miles_default: body.radius_miles ?? null,
  })
}
