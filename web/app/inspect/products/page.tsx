/**
 * /inspect/products — list every canonical product.
 *
 * Columns: name, brand, category, package, store coverage count, median
 * shelf price, OFF link count, source mix (tiny stacked bar), embedding dot.
 *
 * Filters via query params:
 *   ?off=missing|linked
 *   ?coverage=any
 *   ?source=fake|real|none      — filter by observation source
 *   ?q=<text>                   — name/brand substring search
 *
 * Sort via ?sort=name|coverage|obs|off|price:asc|desc
 */

import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import { listProducts } from '@/lib/inspector/queries.mjs'
import { offAvailable } from '@/lib/inspector/off-queries.mjs'
import DataLineageBar from '@/components/inspector/DataLineageBar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProductRow {
  canonical_id: number
  name: string
  brand: string | null
  is_store_brand: boolean
  package_size: number | null
  package_unit: string | null
  pricing_unit: string | null
  upc: string | null
  category_name: string | null
  has_embedding: boolean
  store_coverage: number | string
  obs_count: number | string
  median_shelf_price: number | string | null
  shelf_price_unit: string | null
  off_link_count: number | string
  off_mean_confidence: number | string | null
  obs_fake: number
  obs_receipt: number
  obs_manual: number
  obs_other: number
}

const SORT_COLS = new Set(['name', 'coverage', 'obs', 'off', 'price'])

type Search = Record<string, string | string[] | undefined>

export default async function ProductsPage(props: {
  searchParams: Promise<Search>
}) {
  await inspectorGuard()
  const sp = await props.searchParams
  const offFilter = singleParam(sp.off) // 'missing' | 'linked' | null
  const coverageFilter = singleParam(sp.coverage) // 'any' | null
  const sourceFilter = singleParam(sp.source) // 'fake' | 'real' | 'none' | null
  const q = (singleParam(sp.q) ?? '').trim().toLowerCase()
  const sortParam = singleParam(sp.sort) ?? 'name:asc'
  const [colRaw, dirRaw] = sortParam.split(':')
  const sortCol = SORT_COLS.has(colRaw) ? colRaw : 'name'
  const sortDir: 'asc' | 'desc' = dirRaw === 'desc' ? 'desc' : 'asc'

  let rows = (await listProducts()) as ProductRow[]

  // Aggregate "real observations" = anything that isn't fake.
  const realCount = (r: ProductRow) =>
    Number(r.obs_receipt) + Number(r.obs_manual) + Number(r.obs_other)

  if (offFilter === 'missing') rows = rows.filter((r) => Number(r.off_link_count) === 0)
  else if (offFilter === 'linked') rows = rows.filter((r) => Number(r.off_link_count) > 0)
  if (coverageFilter === 'any') rows = rows.filter((r) => Number(r.store_coverage) > 0)
  if (sourceFilter === 'fake') {
    rows = rows.filter((r) => Number(r.obs_fake) > 0 && realCount(r) === 0)
  } else if (sourceFilter === 'real') {
    rows = rows.filter((r) => realCount(r) > 0)
  } else if (sourceFilter === 'none') {
    rows = rows.filter((r) => Number(r.obs_count) === 0)
  }
  if (q) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.brand ?? '').toLowerCase().includes(q),
    )
  }

  rows.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortCol) {
      case 'coverage':
        return (Number(a.store_coverage) - Number(b.store_coverage)) * dir
      case 'obs':
        return (Number(a.obs_count) - Number(b.obs_count)) * dir
      case 'off':
        return (Number(a.off_link_count) - Number(b.off_link_count)) * dir
      case 'price': {
        const ax = a.median_shelf_price == null ? -Infinity : Number(a.median_shelf_price)
        const bx = b.median_shelf_price == null ? -Infinity : Number(b.median_shelf_price)
        return (ax - bx) * dir
      }
      case 'name':
      default:
        return a.name.localeCompare(b.name) * dir
    }
  })

  // Aggregate counts for the filter-bar summary
  const totalRows = rows.length
  const totalFakeOnly = rows.filter((r) => Number(r.obs_fake) > 0 && realCount(r) === 0).length
  const totalReal = rows.filter((r) => realCount(r) > 0).length
  const totalNoData = rows.filter((r) => Number(r.obs_count) === 0).length

  const PAGE_LIMIT = 250
  const visible = rows.slice(0, PAGE_LIMIT)

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
        <p className="mt-1 text-sm text-slate-600">
          Hand-curated canonical products — the comparison anchor. Every product
          is matched to OFF (where possible) for enrichment, and accumulates
          price observations from receipts, manual fieldwork, or synthetic seed.
        </p>
      </header>

      {/* Filter bar */}
      <form
        action="/inspect/products"
        method="get"
        className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-3 text-sm"
      >
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search name or brand…"
          className="min-w-[220px] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-1 text-slate-600">
          OFF link:
          <select
            name="off"
            defaultValue={offFilter ?? ''}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">any</option>
            <option value="linked">linked</option>
            <option value="missing">missing</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Price source:
          <select
            name="source"
            defaultValue={sourceFilter ?? ''}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">any</option>
            <option value="real">real (receipt or manual)</option>
            <option value="fake">fake only</option>
            <option value="none">no observations</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Coverage:
          <select
            name="coverage"
            defaultValue={coverageFilter ?? ''}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">any</option>
            <option value="any">priced at ≥1 store</option>
          </select>
        </label>
        <input type="hidden" name="sort" value={sortParam} />
        <button
          type="submit"
          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-sm hover:bg-slate-100"
        >
          Apply
        </button>
        {(q || offFilter || coverageFilter || sourceFilter) && (
          <Link
            href="/inspect/products"
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
          >
            clear filters
          </Link>
        )}
        {!offAvailable() && (
          <span className="ml-auto text-[11px] text-amber-700">
            (OFF SQLite unavailable)
          </span>
        )}
      </form>

      {/* Summary line */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>{totalRows.toLocaleString()} matching</span>
        <span>· {totalReal.toLocaleString()} with real prices</span>
        <span>· {totalFakeOnly.toLocaleString()} only-fake</span>
        <span>· {totalNoData.toLocaleString()} no observations</span>
        {visible.length < totalRows && (
          <span className="text-slate-700">(showing first {visible.length})</span>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeader col="name" sortCol={sortCol} sortDir={sortDir} sp={sp}>
                Product
              </SortHeader>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Package</th>
              <SortHeader col="coverage" sortCol={sortCol} sortDir={sortDir} sp={sp} align="right">
                Stores
              </SortHeader>
              <SortHeader col="obs" sortCol={sortCol} sortDir={sortDir} sp={sp} align="right">
                Obs.
              </SortHeader>
              <th className="px-3 py-2 w-32">Source mix</th>
              <SortHeader col="price" sortCol={sortCol} sortDir={sortDir} sp={sp} align="right">
                Median shelf
              </SortHeader>
              <SortHeader col="off" sortCol={sortCol} sortDir={sortDir} sp={sp} align="right">
                OFF
              </SortHeader>
              <th className="px-3 py-2 text-center">Emb</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-sm text-slate-500">
                  No products match these filters.
                </td>
              </tr>
            )}
            {visible.map((p) => (
              <tr
                key={p.canonical_id}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-1.5">
                  <Link
                    href={`/inspect/products/${p.canonical_id}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-slate-600">
                  {p.brand ?? <span className="text-slate-300">—</span>}
                  {p.is_store_brand && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">
                      store
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-600">
                  {p.category_name ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-600">
                  {p.package_size != null && p.package_unit
                    ? `${p.package_size} ${p.package_unit}`
                    : '—'}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {Number(p.store_coverage).toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {Number(p.obs_count).toLocaleString()}
                </td>
                <td className="px-3 py-1.5">
                  {Number(p.obs_count) > 0 ? (
                    <DataLineageBar
                      height={5}
                      showLegend={false}
                      segments={[
                        { source: 'fake', value: Number(p.obs_fake) },
                        { source: 'receipt', value: Number(p.obs_receipt) },
                        { source: 'manual', value: Number(p.obs_manual) },
                        { source: 'unknown', value: Number(p.obs_other) },
                      ]}
                    />
                  ) : (
                    <span className="text-[10px] text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {p.median_shelf_price != null
                    ? `$${Number(p.median_shelf_price).toFixed(2)}`
                    : '—'}
                  {p.shelf_price_unit && (
                    <span className="ml-0.5 text-[10px] text-slate-400">
                      / {p.shelf_price_unit.replace(/^per_/, '')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <OffLinkChip count={Number(p.off_link_count)} />
                </td>
                <td className="px-3 py-1.5 text-center">
                  {p.has_embedding ? (
                    <span className="text-[11px] text-emerald-600" title="Has 384-dim embedding">
                      ●
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-300" title="No embedding">
                      ○
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OffLinkChip({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
        none
      </span>
    )
  }
  return (
    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
      {count}
    </span>
  )
}

function SortHeader({
  col,
  sortCol,
  sortDir,
  align,
  sp,
  children,
}: {
  col: string
  sortCol: string
  sortDir: 'asc' | 'desc'
  align?: 'left' | 'right'
  sp: Search
  children: React.ReactNode
}) {
  const active = sortCol === col
  const nextDir = active && sortDir === 'asc' ? 'desc' : 'asc'
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'sort') continue
    if (typeof v === 'string') params.set(k, v)
  }
  params.set('sort', `${col}:${nextDir}`)
  return (
    <th className="px-3 py-2" style={{ textAlign: align ?? 'left' }}>
      <Link href={`/inspect/products?${params.toString()}`} className="hover:text-slate-900">
        {children}
        {active && <span className="ml-1 text-slate-400">{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </Link>
    </th>
  )
}

function singleParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}
