/**
 * Compact NOVA processing-level badge.
 *
 * NOVA is a 1–4 scale (1 = unprocessed, 4 = ultra-processed), developed
 * at the University of São Paulo. Same color direction as Nutri-Score
 * (green → red) so the visual reading stays consistent.
 */

const COLORS: Record<number, string> = {
  1: '#1d7d3e',
  2: '#7eb53d',
  3: '#e8b22b',
  4: '#c93434',
}

const LABELS: Record<number, string> = {
  1: 'Unprocessed',
  2: 'Processed culinary',
  3: 'Processed',
  4: 'Ultra-processed',
}

export default function NovaGroupBadge({
  group,
  size = 'md',
  showLabel = true,
}: {
  group: 1 | 2 | 3 | 4 | number | null | undefined
  size?: 'sm' | 'md'
  showLabel?: boolean
}) {
  if (group == null) return null
  const g = Number(group)
  const color = COLORS[g as 1 | 2 | 3 | 4] ?? '#666'
  const label = LABELS[g as 1 | 2 | 3 | 4] ?? ''
  const dim = size === 'sm' ? 22 : 30

  return (
    <span className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700">
      <span
        className="inline-flex items-center justify-center rounded font-bold text-white"
        style={{ width: dim, height: dim, background: color, fontSize: size === 'sm' ? 12 : 14 }}
        title={`NOVA ${g} – ${label}`}
        aria-label={`NOVA group ${g}`}
      >
        {g}
      </span>
      {showLabel && (
        <span className="flex flex-col leading-tight">
          <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">NOVA</span>
          <span className="text-xs text-slate-700">{label}</span>
        </span>
      )}
    </span>
  )
}
