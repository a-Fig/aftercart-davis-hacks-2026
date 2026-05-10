/**
 * Inline color dot for the freshness column from current_prices.
 * green = data within 7 days, yellow = 7-30, red = older / sparse.
 */

const COLORS: Record<string, { bg: string; ring: string; label: string }> = {
  green:  { bg: '#16a34a', ring: '#bbf7d0', label: 'Fresh (≤7d)' },
  yellow: { bg: '#eab308', ring: '#fef3c7', label: 'Aging (7–30d)' },
  red:    { bg: '#dc2626', ring: '#fecaca', label: 'Stale (>30d)' },
}

export default function FreshnessDot({
  freshness,
  size = 10,
}: {
  freshness: string | null | undefined
  size?: number
}) {
  const f = (freshness || '').toLowerCase()
  const c = COLORS[f]
  if (!c) {
    return (
      <span
        className="inline-block rounded-full bg-slate-300"
        style={{ width: size, height: size }}
        title="Unknown freshness"
      />
    )
  }
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background: c.bg,
        boxShadow: `0 0 0 2px ${c.ring}`,
      }}
      title={c.label}
      aria-label={c.label}
    />
  )
}
