/**
 * /inspect — overview dashboard.
 *
 * Lead with "Data Health" — the most-asked question is "what's real?". Then
 * a pipeline diagram so the architecture is visible. Then a recent-activity
 * stream and the top-stores / top-products tables.
 *
 * The page is a server component; every panel is its own async function
 * inside <Suspense> so a slow OFF SQLite query can't block the rest of the
 * page from rendering.
 */

import { Suspense } from 'react'
import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import {
  getOverviewCounts,
  getTopStores,
  getTopProducts,
  getDataHealth,
  getReceiptCounts,
  listRecentObservations,
  getObservationSourceBreakdown,
  getBarcodeSourceBreakdown,
  getSkuVerifiedByBreakdown,
} from '@/lib/inspector/queries.mjs'
import { getOffCoverage } from '@/lib/inspector/off-queries.mjs'
import DataLineageBar from '@/components/inspector/DataLineageBar'
import PipelineDiagram, { type PipelineNode } from '@/components/inspector/PipelineDiagram'
import { SourceChip } from '@/components/inspector/SourceBadge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  await inspectorGuard()
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="mt-1 text-sm text-slate-600">
          Snapshot of the catalog and pricing graph — what&apos;s in here, where it came from, and how it connects.
        </p>
      </header>

      <Suspense fallback={<SectionFallback label="data health" />}>
        <DataHealth />
      </Suspense>

      <Suspense fallback={<SectionFallback label="pipeline diagram" />}>
        <Pipeline />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionFallback label="recent activity" />}>
          <RecentActivity />
        </Suspense>
        <Suspense fallback={<SectionFallback label="OFF coverage" />}>
          <OffCoverage />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionFallback label="top stores" />}>
          <TopStores />
        </Suspense>
        <Suspense fallback={<SectionFallback label="top products" />}>
          <TopProducts />
        </Suspense>
      </div>
    </div>
  )
}

// ── Data Health (the new headline section) ─────────────────────────────────

async function DataHealth() {
  const [h, obsBreakdown, bcBreakdown, skuBreakdown] = await Promise.all([
    getDataHealth(),
    getObservationSourceBreakdown(),
    getBarcodeSourceBreakdown(),
    getSkuVerifiedByBreakdown(),
  ])

  const fakePct = h.obs_total > 0 ? (h.obs_fake / h.obs_total) * 100 : 0
  const realPct = 100 - fakePct
  const isAllFake = h.obs_total > 0 && h.obs_real === 0
  const isMixed = h.obs_fake > 0 && h.obs_real > 0
  const isAllReal = h.obs_total > 0 && h.obs_fake === 0

  // Demo-readiness verdict — a one-line answer to "can I show this to anyone?"
  let verdict: { tone: 'red' | 'amber' | 'green'; title: string; body: string }
  if (h.obs_total === 0) {
    verdict = {
      tone: 'amber',
      title: 'No price data',
      body: 'price_observations is empty. Run one of the seeding scripts (load-collection-sheet, import-receipts, or generate-fake-prices) before demoing.',
    }
  } else if (isAllFake) {
    verdict = {
      tone: 'red',
      title: 'All data is synthetic',
      body: 'Every price observation in the DB is from generate-fake-prices.mjs. Purge with `node web/scripts/purge-fake-data.mjs` before any external demo and seed real data first.',
    }
  } else if (isMixed) {
    verdict = {
      tone: 'amber',
      title: `${fakePct.toFixed(0)}% synthetic, ${realPct.toFixed(0)}% real`,
      body: 'Mixed real and fake data. The fake confidence (0.50) is below real (0.95) so real data wins in current_prices, but fake rows are still visible. Purge before any external demo.',
    }
  } else {
    verdict = {
      tone: 'green',
      title: '100% real data',
      body: 'No synthetic observations in the DB. Demo-ready from a data-source perspective.',
    }
  }

  const verdictColors = {
    red:   'border-rose-300 bg-rose-50 text-rose-900',
    amber: 'border-amber-300 bg-amber-50 text-amber-900',
    green: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  }[verdict.tone]
  const verdictIcon = { red: '⛔', amber: '⚠', green: '✓' }[verdict.tone]

  return (
    <Section
      title="Data health"
      hint="Where the price-graph data came from. Watch this panel before demos."
    >
      {/* Verdict banner */}
      <div className={`rounded-lg border p-3 ${verdictColors}`}>
        <div className="flex items-start gap-3">
          <div className="text-lg leading-none">{verdictIcon}</div>
          <div className="flex-1">
            <div className="text-sm font-semibold">{verdict.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed">{verdict.body}</div>
          </div>
        </div>
      </div>

      {/* Source breakdown — the three source-tagged tables side by side */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BreakdownCard
          title="Price observations"
          subtitle="time-series of every price ever recorded"
          total={Number(h.obs_total)}
          breakdown={obsBreakdown}
          href="/inspect/products"
        />
        <BreakdownCard
          title="Store SKUs"
          subtitle="chain-specific product records (verified_by)"
          total={Number(h.skus_total)}
          breakdown={skuBreakdown}
        />
        <BreakdownCard
          title="OFF barcode links"
          subtitle="canonical_barcodes (canonical → OFF UPC)"
          total={Number(h.bc_total)}
          breakdown={bcBreakdown}
          href="/inspect/products?off=linked"
        />
      </div>

      {/* Store coverage breakdown */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-sm font-semibold text-slate-900">Store coverage</div>
          <div className="text-[11px] text-slate-500">across all {Number(h.stores_with_real) + Number(h.stores_with_only_fake) + Number(h.stores_with_no_data)} stores</div>
        </div>
        <DataLineageBar
          height={10}
          segments={[
            { source: 'receipt', value: Number(h.stores_with_real), label: 'Has real observations' },
            { source: 'fake', value: Number(h.stores_with_only_fake), label: 'Only fake observations' },
            { source: 'unknown', value: Number(h.stores_with_no_data), label: 'No observations' },
          ]}
        />
        {Number(h.stores_with_real) === 0 && Number(h.stores_with_only_fake) > 0 && (
          <div className="mt-2 rounded bg-amber-50 p-2 text-[11px] text-amber-800">
            ⚠ Zero stores have any real (non-fake) prices. Run <code className="font-mono">import-receipts.mjs</code> or fill <code className="font-mono">collection-sheet.csv</code> before demoing the comparison flow.
          </div>
        )}
      </div>
    </Section>
  )
}

function BreakdownCard({
  title,
  subtitle,
  total,
  breakdown,
  href,
}: {
  title: string
  subtitle: string
  total: number
  breakdown: Array<{ source: string; count: number | string }>
  href?: string
}) {
  const segments = breakdown.map((b) => ({
    source: b.source,
    value: Number(b.count),
  }))
  const inner = (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-3 transition hover:border-slate-300">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="text-[11px] text-slate-500">{subtitle}</div>
        </div>
        <div className="text-2xl font-semibold tabular-nums text-slate-900">
          {total.toLocaleString()}
        </div>
      </div>
      <div className="mt-3">
        <DataLineageBar segments={segments} height={8} showLegend={true} total={total} />
      </div>
    </div>
  )
  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    )
  }
  return inner
}

// ── Pipeline ───────────────────────────────────────────────────────────────

async function Pipeline() {
  const [c, h, off, receiptCounts] = await Promise.all([
    getOverviewCounts(),
    getDataHealth(),
    Promise.resolve(getOffCoverage()),
    getReceiptCounts(),
  ])

  // Construct the 6-node pipeline. Counts come from a mix of overview +
  // health queries; the layout is the documented architecture.
  const obsTotal = Number(h.obs_total)
  const obsFake = Number(h.obs_fake)
  const fakeWarning =
    obsTotal > 0 && obsFake / obsTotal > 0.5
      ? `${Math.round((obsFake / obsTotal) * 100)}% synthetic`
      : undefined

  const nodes: PipelineNode[] = [
    {
      label: 'OFF SQLite',
      count: off.available ? off.products_total : null,
      subtitle: off.available ? 'community-curated US products' : 'unavailable in this env',
      tone: 'off',
      badge: 'OFF',
      href: '/inspect/off',
    },
    {
      label: 'Canonical barcodes',
      count: Number(c.barcode_links_total),
      subtitle: `${Number(c.canonicals_with_off_link)} canonicals linked`,
      tone: 'off',
      badge: 'LINK',
      href: '/inspect/products?off=linked',
    },
    {
      label: 'Canonical products',
      count: Number(c.canonicals),
      subtitle: `${Number(c.embedded)} embedded · hand-curated`,
      tone: 'canonical',
      badge: 'SEED',
      href: '/inspect/products',
    },
    {
      label: 'Store SKUs',
      count: Number(h.skus_total),
      subtitle: `${Number(h.skus_real)} real · ${Number(h.skus_fake)} fake-seed`,
      tone: 'sku',
      badge: 'CHAIN',
      warning: Number(h.skus_fake) > 0 && Number(h.skus_real) === 0 ? 'all from fake-seed' : undefined,
    },
    {
      label: 'Receipts',
      count: Number(receiptCounts.total),
      subtitle: Number(receiptCounts.total) > 0
        ? `${Number(receiptCounts.processed)} processed`
        : 'no receipts ingested yet',
      tone: 'receipt',
      badge: 'OPT',
      href: '/inspect/receipts',
    },
    {
      label: 'Price observations',
      count: obsTotal,
      subtitle: `append-only time-series`,
      tone: 'observation',
      badge: 'CORE',
      warning: fakeWarning,
    },
    {
      label: 'current_prices',
      count: Number(c.coverage_pairs),
      subtitle: 'matview · 90-day window, decay-weighted',
      tone: 'matview',
      badge: 'AGG',
    },
  ]

  return (
    <Section
      title="Architecture"
      hint="From data sources on the left, through normalization, to the materialized view that serves the comparison API."
    >
      <PipelineDiagram nodes={nodes} />
      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <strong className="text-slate-800">Reading the diagram:</strong>{' '}
        Open Food Facts is the third-party enrichment layer (image, Nutri-Score, NOVA, ingredients). Our hand-curated{' '}
        <Link href="/inspect/products" className="text-indigo-700 underline-offset-2 hover:underline">
          canonical products
        </Link>{' '}
        link to OFF UPCs through{' '}
        <code className="font-mono">canonical_barcodes</code>. Each chain has its own SKU
        record per canonical (chain-specific pack size + display name). Receipts and the
        manual collection sheet write rows into <code className="font-mono">price_observations</code>;{' '}
        <code className="font-mono">current_prices</code> is a 90-day-window matview that
        the comparison API reads.
      </div>
    </Section>
  )
}

// ── Recent activity ────────────────────────────────────────────────────────

async function RecentActivity() {
  const rows = await listRecentObservations(10)
  return (
    <Section
      title="Recent observations"
      hint="Last 10 price_observations by ingested_at."
    >
      {rows.length === 0 ? (
        <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No price observations yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Ingested</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: RecentObsRow) => (
                <tr key={String(r.observation_id)} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5">
                    <SourceChip source={r.source} />
                    {r.pricing_tier && r.pricing_tier !== 'shelf' && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-500">
                        {r.pricing_tier}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.canonical_name ? (
                      <Link
                        href={`/inspect/products/${r.canonical_id}`}
                        className="text-indigo-700 hover:underline"
                      >
                        {r.canonical_name}
                      </Link>
                    ) : (
                      <span className="text-slate-400">unmatched</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-600">
                    <Link
                      href={`/inspect/stores/${r.store_id}`}
                      className="hover:underline"
                    >
                      {r.chain_name}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    ${Number(r.price_total).toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[11px] text-slate-500">
                    {formatRelative(r.ingested_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

interface RecentObsRow {
  observation_id: number | string
  source: string
  pricing_tier: string | null
  price_total: number | string
  price_per_unit: number | string
  price_unit: string
  observed_at: string
  ingested_at: string
  confidence: number | string
  canonical_id: number | null
  canonical_name: string | null
  store_id: number
  store_address: string
  chain_name: string
}

// ── OFF coverage (kept from the old overview, now compact) ─────────────────

async function OffCoverage() {
  const o = getOffCoverage()
  if (!o.available) {
    return (
      <Section title="Open Food Facts coverage">
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          OFF SQLite is unavailable in this environment. Run{' '}
          <code className="font-mono">node web/scripts/build-off-sqlite.mjs</code> to build it,
          or set <code className="font-mono">OFF_SQLITE_PATH</code> to a built database.
        </div>
      </Section>
    )
  }
  const total = Math.max(1, o.products_total)
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`
  const cards: Array<{ label: string; value: number; sub?: string }> = [
    { label: 'OFF products (US)', value: o.products_total, sub: '100%' },
    { label: 'With Nutri-Score', value: o.with_nutriscore, sub: pct(o.with_nutriscore) },
    { label: 'With NOVA group',  value: o.with_nova,       sub: pct(o.with_nova) },
    { label: 'With ingredients', value: o.with_ingredients, sub: pct(o.with_ingredients) },
    { label: 'With allergens',   value: o.with_allergens,  sub: pct(o.with_allergens) },
    { label: 'With image',       value: o.with_image,      sub: pct(o.with_image) },
  ]
  return (
    <Section
      title="OFF data coverage"
      hint="Per-field coverage of the local Open Food Facts SQLite mirror."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded border border-slate-200 bg-white p-2.5"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {card.label}
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums text-slate-900">
              {Number(card.value).toLocaleString()}
            </div>
            {card.sub && <div className="text-[10px] text-slate-500">{card.sub}</div>}
          </div>
        ))}
      </div>
      {o.with_image === 0 && (
        <div className="mt-2 rounded bg-slate-50 p-2 text-[11px] text-slate-600">
          ℹ Image URLs are stripped from OFF&apos;s bulk dump (it&apos;s a known gap — see CLAUDE.md). The modal
          uses a 📦 placeholder for now.
        </div>
      )}
    </Section>
  )
}

// ── Top stores / top products ──────────────────────────────────────────────

async function TopStores() {
  const rows = await getTopStores(8)
  return (
    <Section title="Top stores by observation count">
      <Table
        empty="No price observations yet."
        rows={rows}
        cols={[
          {
            label: 'Store',
            cell: (r: TopStoreRow) => (
              <Link
                href={`/inspect/stores/${r.store_id}`}
                className="font-medium text-indigo-700 hover:underline"
              >
                {r.chain_name}
              </Link>
            ),
          },
          { label: 'Address', cell: (r: TopStoreRow) => <span className="text-slate-600">{r.address}</span> },
          {
            label: 'Obs',
            align: 'right',
            cell: (r: TopStoreRow) => (
              <span className="tabular-nums">{Number(r.obs_count).toLocaleString()}</span>
            ),
          },
        ]}
      />
    </Section>
  )
}

async function TopProducts() {
  const rows = await getTopProducts(8)
  return (
    <Section title="Top products by store coverage">
      <Table
        empty="No products with price coverage yet."
        rows={rows}
        cols={[
          {
            label: 'Product',
            cell: (r: TopProductRow) => (
              <Link
                href={`/inspect/products/${r.canonical_id}`}
                className="font-medium text-indigo-700 hover:underline"
              >
                {r.name}
              </Link>
            ),
          },
          { label: 'Brand', cell: (r: TopProductRow) => <span className="text-slate-600">{r.brand ?? '—'}</span> },
          {
            label: 'Stores',
            align: 'right',
            cell: (r: TopProductRow) => (
              <span className="tabular-nums">{Number(r.store_coverage)}</span>
            ),
          },
        ]}
      />
    </Section>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {title}
        </h2>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function SectionFallback({ label }: { label: string }) {
  return (
    <section>
      <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Loading {label}…
      </div>
    </section>
  )
}

type Col<T> = {
  label: string
  cell: (row: T) => React.ReactNode
  align?: 'left' | 'right' | 'center'
}

function Table<T>({
  rows,
  cols,
  empty,
}: {
  rows: T[]
  cols: Col<T>[]
  empty: string
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
        {empty}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            {cols.map((c) => (
              <th
                key={c.label}
                className="px-3 py-2"
                style={{ textAlign: c.align ?? 'left' }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-t border-slate-100 hover:bg-slate-50"
            >
              {cols.map((c) => (
                <td
                  key={c.label}
                  className="px-3 py-1.5 align-middle"
                  style={{ textAlign: c.align ?? 'left' }}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type TopStoreRow = {
  store_id: number
  chain_name: string
  address: string
  obs_count: number | string
  last_observed: string | null
}

type TopProductRow = {
  canonical_id: number
  name: string
  brand: string | null
  store_coverage: number | string
  obs_count: number | string
}
