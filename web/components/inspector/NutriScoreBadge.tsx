/**
 * Compact Nutri-Score letter badge for the inspector.
 *
 * Same color palette and label table as the user-facing OffEnrichmentBlock,
 * but smaller and lighter-chrome — engineers don't need the framed card
 * treatment the modal uses.
 */

const COLORS: Record<string, string> = {
  a: '#1d7d3e',
  b: '#7eb53d',
  c: '#e8b22b',
  d: '#e07a2f',
  e: '#c93434',
}

const LABELS: Record<string, string> = {
  a: 'Best nutritional quality',
  b: 'Good',
  c: 'Average',
  d: 'Poor',
  e: 'Worst',
}

export default function NutriScoreBadge({
  grade,
  size = 'md',
  showLabel = true,
}: {
  grade: 'a' | 'b' | 'c' | 'd' | 'e' | string | null | undefined
  size?: 'sm' | 'md'
  showLabel?: boolean
}) {
  if (!grade) return null
  const g = String(grade).toLowerCase()
  const color = COLORS[g] ?? '#666'
  const label = LABELS[g] ?? ''
  const dim = size === 'sm' ? 22 : 30

  return (
    <span className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-slate-700">
      <span
        className="inline-flex items-center justify-center rounded font-bold text-white"
        style={{ width: dim, height: dim, background: color, fontSize: size === 'sm' ? 12 : 14 }}
        title={`Nutri-Score ${g.toUpperCase()} – ${label}`}
        aria-label={`Nutri-Score ${g.toUpperCase()}`}
      >
        {g.toUpperCase()}
      </span>
      {showLabel && (
        <span className="flex flex-col leading-tight">
          <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Nutri-Score</span>
          <span className="text-xs text-slate-700">{label}</span>
        </span>
      )}
    </span>
  )
}
