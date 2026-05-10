/**
 * Visual badge for data sources, used everywhere across the inspector so
 * "where did this row come from" is always one glance away.
 *
 * The schema has three source-tagged tables that we surface:
 *   - price_observations.source: 'fake' | 'receipt' | 'manual' | 'usda_seed' | 'scrape'
 *   - canonical_barcodes.source: 'off_curated' | 'receipt' | 'manual'
 *   - store_skus.verified_by:    'auto' | 'manual' | 'fake_seed' | user_id
 *
 * We collapse them into a small palette of visual treatments. Fake data
 * always gets an amber/yellow warning treatment so it can never be confused
 * with real data; OFF gets indigo because it's the third-party enrichment
 * layer; receipts get emerald because they're the ground-truth user data;
 * manual gets slate because it's the team's seed-fieldwork.
 */

import type { ReactNode } from 'react'

export type SourceKind =
  | 'fake'
  | 'receipt'
  | 'manual'
  | 'off_curated'
  | 'off'
  | 'usda_seed'
  | 'scrape'
  | 'auto'
  | 'fake_seed'
  | 'unknown'

interface Treatment {
  label: string
  bg: string
  text: string
  ring: string
  icon: string
  tooltip: string
}

const TREATMENTS: Record<SourceKind, Treatment> = {
  fake: {
    label: 'Fake',
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    ring: 'ring-amber-300',
    icon: '⚠',
    tooltip: 'Synthetic data from generate-fake-prices.mjs. Must be purged before any external demo.',
  },
  fake_seed: {
    label: 'Fake',
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    ring: 'ring-amber-300',
    icon: '⚠',
    tooltip: 'SKU created by the synthetic-data seed (verified_by=fake_seed). Purge before demo.',
  },
  receipt: {
    label: 'Receipt',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    ring: 'ring-emerald-300',
    icon: '🧾',
    tooltip: 'From a real ingested receipt photo (parse + match → price_observations).',
  },
  manual: {
    label: 'Manual',
    bg: 'bg-slate-100',
    text: 'text-slate-800',
    ring: 'ring-slate-300',
    icon: '✋',
    tooltip: 'From the manual collection sheet (db/seed/collection-sheet.csv) — verified shelf prices.',
  },
  off_curated: {
    label: 'OFF',
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    ring: 'ring-indigo-300',
    icon: '🌐',
    tooltip: 'Open Food Facts community-maintained product enrichment.',
  },
  off: {
    label: 'OFF',
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    ring: 'ring-indigo-300',
    icon: '🌐',
    tooltip: 'Open Food Facts community-maintained product enrichment.',
  },
  usda_seed: {
    label: 'USDA',
    bg: 'bg-sky-50',
    text: 'text-sky-800',
    ring: 'ring-sky-300',
    icon: '🏛',
    tooltip: 'USDA SNAP retailer registry (legacy seed source).',
  },
  scrape: {
    label: 'Scrape',
    bg: 'bg-violet-50',
    text: 'text-violet-800',
    ring: 'ring-violet-300',
    icon: '🕸',
    tooltip: 'Scraped from a public source (legacy / unused today).',
  },
  auto: {
    label: 'Auto',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    ring: 'ring-slate-300',
    icon: '⚙',
    tooltip: 'Created automatically by the matcher (verified_by=auto).',
  },
  unknown: {
    label: 'Unknown',
    bg: 'bg-slate-100',
    text: 'text-slate-500',
    ring: 'ring-slate-200',
    icon: '?',
    tooltip: 'No source attribution recorded.',
  },
}

interface Props {
  source: string | null | undefined
  size?: 'xs' | 'sm' | 'md'
  /** When true, hide the icon. Useful in dense table cells. */
  iconOnly?: boolean
  /** When true, hide the label (icon only). */
  labelOnly?: boolean
}

export default function SourceBadge({ source, size = 'sm', iconOnly, labelOnly }: Props) {
  const kind = normalize(source)
  const t = TREATMENTS[kind]

  const sizing = {
    xs: 'text-[9px] px-1 py-px gap-0.5',
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2 py-1 gap-1.5',
  }[size]

  return (
    <span
      className={`inline-flex items-center rounded font-semibold uppercase tracking-wide ring-1 ring-inset ${t.bg} ${t.text} ${t.ring} ${sizing}`}
      title={t.tooltip}
    >
      {!labelOnly && <span aria-hidden>{t.icon}</span>}
      {!iconOnly && <span>{t.label}</span>}
    </span>
  )
}

/** Normalize the various spellings we see across the schema into a SourceKind. */
export function normalize(source: string | null | undefined): SourceKind {
  if (!source) return 'unknown'
  const s = String(source).toLowerCase().trim()
  if (s === 'fake') return 'fake'
  if (s === 'fake_seed') return 'fake_seed'
  if (s === 'receipt') return 'receipt'
  if (s === 'manual') return 'manual'
  if (s === 'off_curated' || s === 'off') return 'off_curated'
  if (s === 'usda_seed' || s === 'usda') return 'usda_seed'
  if (s === 'scrape') return 'scrape'
  if (s === 'auto') return 'auto'
  return 'unknown'
}

/** Map a source kind back to its display color (for charts, not badges). */
export function sourceColor(kind: SourceKind): string {
  return (
    {
      fake: '#f59e0b',
      fake_seed: '#f59e0b',
      receipt: '#10b981',
      manual: '#64748b',
      off_curated: '#6366f1',
      off: '#6366f1',
      usda_seed: '#0ea5e9',
      scrape: '#8b5cf6',
      auto: '#94a3b8',
      unknown: '#cbd5e1',
    }[kind] ?? '#cbd5e1'
  )
}

/** Render a tiny block letting consumers add an arbitrary trailing element (e.g. count). */
export function SourceChip({
  source,
  children,
}: {
  source: string | null | undefined
  children?: ReactNode
}) {
  const kind = normalize(source)
  const t = TREATMENTS[kind]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${t.bg} ${t.text} ${t.ring}`}
      title={t.tooltip}
    >
      <span aria-hidden>{t.icon}</span>
      <span className="uppercase tracking-wide">{t.label}</span>
      {children != null && <span className="font-mono normal-case">{children}</span>}
    </span>
  )
}
