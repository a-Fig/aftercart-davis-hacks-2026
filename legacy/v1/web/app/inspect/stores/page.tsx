/**
 * /inspect/stores — list every store with chain, observation count, last-observed,
 * and a per-store source breakdown so a store with only-fake data is visible
 * at a glance.
 *
 * Filter by chain via ?chain=<id>; sort columns via ?sort=<col>:<dir>.
 * New: ?source=fake|real|none filter.
 */

import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import { listStores, listChains } from '@/lib/inspector/queries.mjs'
import DataLineageBar from '@/components/inspector/DataLineageBar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StoreRow {
  store_id: number
  chain_id: number
  chain_name: string
  address: string
  external_id: string | null
  snap_authorized: boolean
  lon: number
  lat: number
  obs_count: number | string
  obs_fake: number | string
  obs_receipt: number | string
  obs_manual: number | string
  obs_other: number | string
  last_observed: string | null
}

interface ChainRow {
  chain_id: number
  name: string
  store_count: number | string
}

const SORT_COLS = new Set(['chain', 'address', 'obs', 'last'])

type Search = Record<string, string | string[] | undefined>

export default async function StoresPage(props: { searchParams: Promise<Search> }) {
  await inspectorGuard()
  const sp = await props.searchParams
  const chainFilter = singleParam(sp.chain)
  const sourceFilter = singleParam(sp.source) // 'fake' | 'real' | 'none'
  const sortParam = singleParam(sp.sort) ?? 'obs:desc'
  const [sortColRaw, sortDirRaw] = sortParam.split(':')
  const sortCol = SORT_COLS.has(sortColRaw) ? sortColRaw : 'obs'
  const sortDir: 'asc' | 'desc' = sortDirRaw === 'asc' ? 'asc' : 'desc'

  const [allStores, chains] = await Promise.all([
    listStores() as Promise<StoreRow[]>,
    listChains() as Promise<ChainRow[]>,
  ])

  let filtered = chainFilter
    ? allStores.filter((s) => String(s.chain_id) === chainFilter)
    : allStores

  const realCount = (s: StoreRow) =>
    Number(s.obs_receipt) + Number(s.obs_manual) + Number(s.obs_other)

  if (sourceFilter === 'fake') {
    filtered = filtered.filter((s) => Number(s.obs_fake) > 0 && realCount(s) === 0)
  } else if (sourceFilter === 'real') {
    filtered = filtered.filter((s) => realCount(s) > 0)
  } else if (sourceFilter === 'none') {
    filtered = filtered.filter((s) => Number(s.obs_count) === 0)
  }

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortCol) {
      case 'chain':
        return a.chain_name.localeCompare(b.chain_name) * dir
      case 'address':
        return a.address.localeCompare(b.address) * dir
      case 'last': {
        const ax = a.last_observed ? new Date(a.last_observed).getTime() : 0
        const bx = b.last_observed ? new Date(b.last_observed).getTime() : 0
        return (ax - bx) * dir
      }
      case 'obs':
      default:
        return (Number(a.obs_count) - Number(b.obs_count)) * dir
    }
  })

  const summary = {
    total: filtered.length,
    real: filtered.filter((s) => realCount(s) > 0).length,
    fakeOnly: filtered.filter((s) => Number(s.obs_fake) > 0 && realCount(s) === 0).length,
    none: filtered.filter((s) => Number(s.obs_count) === 0).length,
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Stores</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every store from the USDA SNAP retailer registry, plus a per-store
          source breakdown of price observations.
        </p>
      </header>

      <form
        action="/inspect/stores"
        method="get"
        className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-3 text-sm"
      >
        <label className="flex items-center gap-1 text-slate-600">
          Chain:
          <select
            name="chain"
            defaultValue={chainFilter ?? ''}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">All chains</option>
            {chains.map((c) => (
              <option key={c.chain_id} value={c.chain_id}>
                {c.name} ({Number(c.store_count)})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Source:
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
        <input type="hidden" name="sort" value={sortParam} />
        <button
          type="submit"
          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-sm hover:bg-slate-100"
        >
          Apply
        </button>
        {(chainFilter || sourceFilter) && (
          <Link
            href="/inspect/stores"
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
          >
            clear filters
          </Link>
        )}
        <span className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>{summary.total.toLocaleString()} stores</span>
          <span>· {summary.real.toLocaleString()} real</span>
          <span>· {summary.fakeOnly.toLocaleString()} fake-only</span>
          <span>· {summary.none.toLocaleString()} no data</span>
        </span>
      </form>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeader col="chain" sortCol={sortCol} sortDir={sortDir} sp={sp}>
                Chain
              </SortHeader>
              <SortHeader col="address" sortCol={sortCol} sortDir={sortDir} sp={sp}>
                Address
              </SortHeader>
              <th className="px-3 py-2">Ext. ID</th>
              <th className="px-3 py-2">SNAP</th>
              <SortHeader col="obs" sortCol={sortCol} sortDir={sortDir} sp={sp} align="right">
                Obs.
              </SortHeader>
              <th className="px-3 py-2 w-32">Source mix</th>
              <SortHeader col="last" sortCol={sortCol} sortDir={sortDir} sp={sp} align="right">
                Last seen
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                  No stores match this filter.
                </td>
              </tr>
            )}
            {sorted.map((s) => (
              <tr key={s.store_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5">
                  <Link
                    href={`/inspect/stores/${s.store_id}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {s.chain_name}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-slate-700">{s.address}</td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">
                  {s.external_id ?? '—'}
                </td>
                <td className="px-3 py-1.5">
                  {s.snap_authorized ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                      yes
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase text-slate-400">no</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {Number(s.obs_count).toLocaleString()}
                </td>
                <td className="px-3 py-1.5">
                  {Number(s.obs_count) > 0 ? (
                    <DataLineageBar
                      height={5}
                      showLegend={false}
                      segments={[
                        { source: 'fake', value: Number(s.obs_fake) },
                        { source: 'receipt', value: Number(s.obs_receipt) },
                        { source: 'manual', value: Number(s.obs_manual) },
                        { source: 'unknown', value: Number(s.obs_other) },
                      ]}
                    />
                  ) : (
                    <span className="text-[10px] text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-500">
                  {formatDate(s.last_observed)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortHeader({
  col,
  sortCol,
  sortDir,
  sp,
  align,
  children,
}: {
  col: string
  sortCol: string
  sortDir: 'asc' | 'desc'
  sp: Search
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const active = sortCol === col
  const nextDir = active && sortDir === 'desc' ? 'asc' : 'desc'
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'sort') continue
    if (typeof v === 'string') params.set(k, v)
  }
  params.set('sort', `${col}:${nextDir}`)
  return (
    <th className="px-3 py-2" style={{ textAlign: align ?? 'left' }}>
      <Link href={`/inspect/stores?${params.toString()}`} className="hover:text-slate-900">
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

function formatDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toISOString().slice(0, 10)
  } catch {
    return String(d)
  }
}
