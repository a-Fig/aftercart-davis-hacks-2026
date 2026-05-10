/**
 * Tiny stacked-segment bar showing the source mix of a count.
 *
 * Used on overview + entity detail pages to answer "of these N rows,
 * how many are real vs fake vs from receipts?" at a glance, without
 * needing to scroll a table or do mental math.
 *
 * Sample: <DataLineageBar segments={[{label:'fake', value: 3960}, {label:'manual', value: 200}]} />
 */

import { sourceColor, normalize, type SourceKind } from './SourceBadge'

export interface LineageSegment {
  source: string
  value: number
  /** Optional override for the on-hover label; defaults to "<Label>: <value>". */
  label?: string
}

interface Props {
  segments: LineageSegment[]
  height?: number
  /** When true, render a compact legend below the bar. */
  showLegend?: boolean
  /** Total to use for percentage math. Defaults to sum(segments). */
  total?: number
  className?: string
}

export default function DataLineageBar({
  segments,
  height = 8,
  showLegend = true,
  total,
  className = '',
}: Props) {
  const filtered = segments.filter((s) => s.value > 0)
  const sum = total ?? filtered.reduce((a, b) => a + b.value, 0)

  if (sum === 0) {
    return (
      <div className={className}>
        <div
          className="w-full overflow-hidden rounded bg-slate-100"
          style={{ height }}
          aria-label="No data"
          title="No data"
        />
        {showLegend && (
          <div className="mt-1 text-[10px] text-slate-400">No data yet</div>
        )}
      </div>
    )
  }

  return (
    <div className={className}>
      <div
        className="flex w-full overflow-hidden rounded bg-slate-100"
        style={{ height }}
        role="img"
        aria-label={filtered
          .map((s) => `${labelFor(s)} ${pct(s.value, sum)}%`)
          .join(', ')}
      >
        {filtered.map((s, i) => {
          const kind = normalize(s.source)
          const w = (s.value / sum) * 100
          return (
            <div
              key={`${s.source}:${i}`}
              style={{ width: `${w}%`, background: sourceColor(kind) }}
              title={`${labelFor(s)} — ${s.value.toLocaleString()} (${pct(
                s.value,
                sum,
              )}%)`}
            />
          )
        })}
      </div>
      {showLegend && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600">
          {filtered.map((s, i) => {
            const kind = normalize(s.source)
            return (
              <span
                key={`legend:${s.source}:${i}`}
                className="inline-flex items-center gap-1"
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: sourceColor(kind) }}
                />
                <span className="font-medium">{labelFor(s)}</span>
                <span className="tabular-nums text-slate-500">
                  {s.value.toLocaleString()}
                </span>
                <span className="text-slate-400">({pct(s.value, sum)}%)</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function labelFor(s: LineageSegment): string {
  if (s.label) return s.label
  const kind = normalize(s.source)
  return SOURCE_LABELS[kind]
}

const SOURCE_LABELS: Record<SourceKind, string> = {
  fake: 'Fake (synthetic)',
  fake_seed: 'Fake (synthetic)',
  receipt: 'Receipt',
  manual: 'Manual',
  off_curated: 'OFF',
  off: 'OFF',
  usda_seed: 'USDA',
  scrape: 'Scrape',
  auto: 'Auto-matched',
  unknown: 'Unknown',
}

function pct(n: number, total: number): string {
  if (total === 0) return '0'
  const v = (n / total) * 100
  if (v < 0.1) return '<0.1'
  if (v < 10) return v.toFixed(1)
  return v.toFixed(0)
}
