/**
 * Inspector-side OFF enrichment panel.
 *
 * Renders the same enrichment payload shape as the user-facing
 * OffEnrichmentBlock (web/components/aftercart/OffEnrichmentBlock.tsx) — the
 * intent is for the inspector and live app to show the same fields with
 * comparable visual treatment, so a developer can verify "this is what the
 * user sees in ItemDetailModal."
 *
 * Differences from the user-facing block:
 *   - Tailwind utilities + slate palette instead of inline THEMES + accent
 *     color (this is engineer chrome, not the consumer chrome)
 *   - Sections are always expanded (no collapse buttons) — the inspector
 *     is for inspecting, not for tap-to-reveal
 *   - Includes the link metadata (source / confidence / added_at) up top
 *     when provided, so we can see HOW each barcode got linked
 *
 * Defensive: every optional field is null-checked. The minimum render is
 * the barcode + a "no enrichment data" notice. We never throw on missing
 * fields.
 */

export interface OffNutriments {
  energy_kcal_100g?: number | null
  sugars_100g?: number | null
  sodium_100g?: number | null
  fat_100g?: number | null
  saturated_fat_100g?: number | null
  proteins_100g?: number | null
  fiber_100g?: number | null
  salt_100g?: number | null
  [extra: string]: number | string | null | undefined
}

export interface OffEnrichment {
  barcode: string
  product_name: string | null
  generic_name: string | null
  brands: string | null
  image_url: string | null
  serving_size: string | null
  quantity_raw: string | null
  package_size: number | null
  package_unit: string | null
  nutriscore_grade: 'a' | 'b' | 'c' | 'd' | 'e' | string | null
  nova_group: 1 | 2 | 3 | 4 | number | null
  ecoscore_grade: 'a' | 'b' | 'c' | 'd' | 'e' | string | null
  ingredients_text: string | null
  allergens: string[]
  traces: string[]
  additives: string[]
  nutriments: OffNutriments
}

import NutriScoreBadge from './NutriScoreBadge'
import NovaGroupBadge from './NovaGroupBadge'

interface Props {
  enrichment: OffEnrichment
  // Optional metadata about how this barcode got linked to a canonical.
  // Only relevant on the product detail page where we render one panel
  // per linked barcode.
  link?: {
    source: string
    confidence: number
    added_at?: string | Date | null
  } | null
}

export default function OffEnrichmentPanel({ enrichment, link }: Props) {
  const e = enrichment
  const hasScoring = !!(e.nutriscore_grade || e.nova_group != null || e.ecoscore_grade)
  const hasComposition = !!(
    e.ingredients_text ||
    e.allergens.length ||
    e.traces.length ||
    e.additives.length
  )
  const hasNutrition = hasAnyNutriment(e.nutriments)
  const hasAnything =
    e.image_url ||
    e.product_name ||
    e.brands ||
    hasScoring ||
    hasComposition ||
    hasNutrition

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {/* Top: image + identity + link meta */}
      <div className="flex gap-4">
        <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-2xl">
          {e.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={e.image_url}
              alt={e.product_name ?? 'product'}
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-label="no image">📦</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">
            {e.product_name || <span className="text-slate-400">(no product_name)</span>}
          </div>
          {e.brands && (
            <div className="mt-0.5 text-xs text-slate-600">{e.brands}</div>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            <span>
              <span className="font-mono">{e.barcode}</span>
            </span>
            {e.quantity_raw && <span>qty: {e.quantity_raw}</span>}
            {e.package_size != null && (
              <span>
                pack: {e.package_size}
                {e.package_unit ? ` ${e.package_unit}` : ''}
              </span>
            )}
            {e.serving_size && <span>serving: {e.serving_size}</span>}
          </div>
          {link && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span>
                link source: <span className="font-medium text-slate-700">{link.source}</span>
              </span>
              <span>
                confidence:{' '}
                <span className="font-medium text-slate-700">
                  {Number(link.confidence).toFixed(2)}
                </span>
              </span>
              {link.added_at && (
                <span>added: {formatDate(link.added_at)}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scoring badges */}
      {hasScoring && (
        <div className="mt-3 flex flex-wrap gap-2">
          {e.nutriscore_grade && <NutriScoreBadge grade={e.nutriscore_grade} size="sm" />}
          {e.nova_group != null && <NovaGroupBadge group={e.nova_group as number} size="sm" />}
          {e.ecoscore_grade && (
            <span className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700">
              <span
                className="inline-flex h-[22px] w-[22px] items-center justify-center rounded text-[12px] font-bold text-white"
                style={{ background: ecoColor(String(e.ecoscore_grade).toLowerCase()) }}
              >
                {String(e.ecoscore_grade).toUpperCase()}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  Eco-Score
                </span>
                <span className="text-xs text-slate-700">Sustainability</span>
              </span>
            </span>
          )}
        </div>
      )}

      {/* Allergens */}
      {e.allergens.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-rose-700">
            Contains
          </div>
          <div className="flex flex-wrap gap-1">
            {e.allergens.map((a) => (
              <span
                key={a}
                className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
              >
                {prettifyTag(a)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Traces */}
      {e.traces.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            May contain
          </div>
          <div className="flex flex-wrap gap-1">
            {e.traces.map((t) => (
              <span
                key={t}
                className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
              >
                {prettifyTag(t)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-100g nutrition */}
      {hasNutrition && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Per 100 g
          </div>
          <NutritionTable n={e.nutriments} />
        </div>
      )}

      {/* Ingredients (always shown in inspector) */}
      {e.ingredients_text && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Ingredients
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs leading-relaxed text-slate-700">
            {e.ingredients_text}
          </div>
        </div>
      )}

      {/* Additives */}
      {e.additives.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Additives ({e.additives.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {e.additives.map((a) => (
              <span
                key={a}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] uppercase text-slate-600"
              >
                {prettifyTag(a)}
              </span>
            ))}
          </div>
        </div>
      )}

      {!hasAnything && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
          No enrichment data populated for this barcode.
        </div>
      )}

      <div className="mt-3 text-[10px] text-slate-400">
        Source: <strong>Open Food Facts</strong> (community-maintained)
      </div>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

function ecoColor(grade: string): string {
  return (
    { a: '#1d7d3e', b: '#7eb53d', c: '#e8b22b', d: '#e07a2f', e: '#c93434' }[grade] ?? '#666'
  )
}

function NutritionTable({ n }: { n: OffNutriments }) {
  const rows: Array<{ label: string; value: number; unit: string }> = []
  if (typeof n.energy_kcal_100g === 'number')   rows.push({ label: 'Calories',      value: n.energy_kcal_100g,   unit: 'kcal' })
  if (typeof n.fat_100g === 'number')           rows.push({ label: 'Fat',           value: n.fat_100g,           unit: 'g' })
  if (typeof n.saturated_fat_100g === 'number') rows.push({ label: 'Saturated fat', value: n.saturated_fat_100g, unit: 'g' })
  if (typeof n.sugars_100g === 'number')        rows.push({ label: 'Sugars',        value: n.sugars_100g,        unit: 'g' })
  if (typeof n.fiber_100g === 'number')         rows.push({ label: 'Fiber',         value: n.fiber_100g,         unit: 'g' })
  if (typeof n.proteins_100g === 'number')      rows.push({ label: 'Protein',       value: n.proteins_100g,      unit: 'g' })
  if (typeof n.sodium_100g === 'number')        rows.push({ label: 'Sodium',        value: n.sodium_100g * 1000, unit: 'mg' })
  if (typeof n.salt_100g === 'number')          rows.push({ label: 'Salt',          value: n.salt_100g,          unit: 'g' })

  if (!rows.length) return null

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between py-0.5 text-xs">
          <span className="text-slate-500">{r.label}</span>
          <span className="font-medium text-slate-800">
            {formatNum(r.value)} {r.unit}
          </span>
        </div>
      ))}
    </div>
  )
}

function hasAnyNutriment(n: OffNutriments): boolean {
  return [
    n.energy_kcal_100g, n.fat_100g, n.saturated_fat_100g, n.sugars_100g,
    n.fiber_100g, n.proteins_100g, n.sodium_100g, n.salt_100g,
  ].some((v) => typeof v === 'number')
}

function formatNum(n: number): string {
  if (n === 0) return '0'
  if (Math.abs(n) < 0.01) return n.toFixed(3)
  if (Math.abs(n) < 1) return n.toFixed(2)
  if (Math.abs(n) < 10) return n.toFixed(1)
  return Math.round(n).toString()
}

function prettifyTag(tag: string): string {
  const stripped = tag.replace(/^[a-z]{2}:/, '')
  const spaced = stripped.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatDate(d: string | Date): string {
  try {
    const date = typeof d === 'string' ? new Date(d) : d
    return date.toISOString().slice(0, 10)
  } catch {
    return String(d)
  }
}
