/**
 * Visual data-flow diagram for the inspector overview.
 *
 * Renders the schema's data architecture as a horizontal pipeline of nodes
 * with arrows, with live counts pulled from the page-level queries. Built
 * with plain HTML/CSS — no SVG library, no chart dep. The arrows are
 * Tailwind-styled spans.
 *
 * The intent: someone opening the inspector cold should be able to look at
 * the diagram and understand the architecture. Each node links to the
 * relevant inspector subpage.
 */

import Link from 'next/link'

export interface PipelineNode {
  /** Display name. */
  label: string
  /** Headline count for this node. */
  count: number | null
  /** One-line subtitle (e.g. "896k US products"). */
  subtitle?: string
  /** URL to navigate to when the node is clicked. */
  href?: string
  /** Visual treatment — colors the top stripe + icon. */
  tone: 'off' | 'canonical' | 'sku' | 'observation' | 'matview' | 'receipt'
  /** Tiny tag in the corner — usually a source attribution like "OFF" or "Mixed". */
  badge?: string
  /** When set, replaces the count with this string. Used for "N (M fake)". */
  countOverride?: string
  /** Optional warning rendered under the count. */
  warning?: string
}

const TONE_STYLES: Record<
  PipelineNode['tone'],
  { stripe: string; icon: string; ring: string }
> = {
  off:         { stripe: 'bg-indigo-500',  icon: '🌐', ring: 'ring-indigo-200' },
  canonical:   { stripe: 'bg-slate-700',   icon: '📦', ring: 'ring-slate-200' },
  sku:         { stripe: 'bg-cyan-500',    icon: '🏷',  ring: 'ring-cyan-200' },
  observation: { stripe: 'bg-emerald-500', icon: '💰', ring: 'ring-emerald-200' },
  matview:     { stripe: 'bg-amber-500',   icon: '⚡', ring: 'ring-amber-200' },
  receipt:     { stripe: 'bg-rose-500',    icon: '🧾', ring: 'ring-rose-200' },
}

interface Props {
  nodes: PipelineNode[]
}

export default function PipelineDiagram({ nodes }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Data flow</div>
          <div className="text-xs text-slate-500">
            How a receipt photo turns into a price comparison. Click any node to drill in.
          </div>
        </div>
      </div>

      {/* Horizontal pipeline. Wraps on narrow viewports — each node card
          has its own border, so the wrap is visually clean. */}
      <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3">
        {nodes.map((n, i) => (
          <div key={n.label} className="flex items-stretch gap-2">
            <NodeCard node={n} />
            {i < nodes.length - 1 && <Arrow />}
          </div>
        ))}
      </div>
    </div>
  )
}

function NodeCard({ node }: { node: PipelineNode }) {
  const t = TONE_STYLES[node.tone]
  const inner = (
    <div
      className={`flex h-full w-44 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm ring-1 ${t.ring} transition hover:shadow-md`}
    >
      <div className={`h-1 w-full ${t.stripe}`} />
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-base" aria-hidden>
            {t.icon}
          </span>
          {node.badge && (
            <span className="rounded bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-600">
              {node.badge}
            </span>
          )}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          {node.label}
        </div>
        <div className="text-lg font-semibold tabular-nums text-slate-900">
          {node.countOverride ?? (node.count != null ? node.count.toLocaleString() : '—')}
        </div>
        {node.subtitle && (
          <div className="text-[11px] leading-tight text-slate-500">{node.subtitle}</div>
        )}
        {node.warning && (
          <div className="mt-1 text-[10px] font-medium text-amber-700">⚠ {node.warning}</div>
        )}
      </div>
    </div>
  )
  if (node.href) {
    return (
      <Link href={node.href} className="block">
        {inner}
      </Link>
    )
  }
  return inner
}

function Arrow() {
  return (
    <div className="flex items-center self-stretch text-slate-300">
      <svg
        width="20"
        height="14"
        viewBox="0 0 20 14"
        aria-hidden
        className="flex-shrink-0"
      >
        <path
          d="M0 7 L17 7 M11 1 L17 7 L11 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
