/**
 * /inspect/stores/[store_id] — store detail.
 *
 * Header (chain, address, lat/lon) + a table of every canonical priced at
 * this store with shelf/member tier, freshness color, observation count,
 * most-recent date, and an OFF chip showing whether enrichment is available
 * (linked barcode count + Nutri-Score letter when present).
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import { getStore, getStoreProducts, getStoreSourceBreakdown } from '@/lib/inspector/queries.mjs'
import { lookupEnrichmentBatch, offAvailable } from '@/lib/inspector/off-queries.mjs'
import FreshnessDot from '@/components/inspector/FreshnessDot'
import DataLineageBar from '@/components/inspector/DataLineageBar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProductRow {
  canonical_id: number
  name: string
  brand: string | null
  package_size: number | null
  package_unit: string | null
  pricing_unit: string | null
  category_name: string | null
  chain_display_name: string | null
  price_unit: string
  shelf_price: number | null
  member_price: number | null
  sale_price: number | null
  obs_count: number | string
  most_recent_observation: string | null
  freshness: string | null
  off_link_count: number | string
  off_barcodes: string[] | null
}

export default async function StoreDetailPage(props: {
  params: Promise<{ store_id: string }>
}) {
  await inspectorGuard()
  const { store_id } = await props.params
  const id = parseInt(store_id, 10)
  if (!Number.isFinite(id)) notFound()

  const store = await getStore(id)
  if (!store) notFound()

  const [products, sourceBreakdown] = await Promise.all([
    getStoreProducts(id) as Promise<ProductRow[]>,
    getStoreSourceBreakdown(id) as Promise<Array<{ source: string; count: number }>>,
  ])
  const obsTotal = sourceBreakdown.reduce((a, b) => a + Number(b.count), 0)
  const fakeCount = Number(sourceBreakdown.find((s) => s.source === 'fake')?.count ?? 0)
  const realCount = obsTotal - fakeCount

  // Bulk-lookup the highest-confidence barcode per product so we can
  // overlay a Nutri-Score letter chip in the table.
  const headBarcodes: string[] = []
  for (const p of products) {
    const b = (p.off_barcodes && p.off_barcodes[0]) || null
    if (b) headBarcodes.push(b)
  }
  const enrichments = headBarcodes.length ? lookupEnrichmentBatch(headBarcodes) : new Map()

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inspect/stores" className="text-xs text-indigo-700 hover:underline">
          ← All stores
        </Link>
      </div>

      <header className="rounded-lg border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">{store.chain_name}</h1>
        <div className="mt-1 text-sm text-slate-600">{store.address}</div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <Field label="store_id" value={String(store.store_id)} mono />
          <Field label="chain_id" value={String(store.chain_id)} mono />
          {store.parent_company && <Field label="parent" value={store.parent_company} />}
          {store.external_id && <Field label="external_id" value={store.external_id} mono />}
          {store.usda_retailer_id && (
            <Field label="USDA SNAP id" value={store.usda_retailer_id} mono />
          )}
          <Field
            label="lat / lon"
            value={`${formatNum(store.lat)}, ${formatNum(store.lon)}`}
            mono
          />
          <Field
            label="SNAP authorized"
            value={store.snap_authorized ? 'yes' : 'no'}
          />
          <Field label="observations" value={Number(store.obs_count).toLocaleString()} />
          <Field label="last seen" value={formatDate(store.last_observed)} />
        </div>

        {obsTotal > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Where the {obsTotal.toLocaleString()} observations came from
              </div>
              <div className="text-[11px] text-slate-500">
                {realCount > 0 ? (
                  <>
                    <span className="font-medium text-emerald-700">
                      {realCount.toLocaleString()} real
                    </span>
                    {fakeCount > 0 && (
                      <>
                        {' · '}
                        <span className="font-medium text-amber-700">
                          {fakeCount.toLocaleString()} fake
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="font-medium text-amber-700">
                    All synthetic — no real prices recorded for this store
                  </span>
                )}
              </div>
            </div>
            <DataLineageBar
              segments={sourceBreakdown.map((s) => ({
                source: s.source,
                value: Number(s.count),
              }))}
              height={8}
              showLegend
            />
          </div>
        )}
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Products with current prices ({products.length})
        </h2>

        {products.length === 0 ? (
          <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
            No products have current_prices for this store. Either no observations
            in the 90-day window, or the matview hasn&apos;t been refreshed since
            the latest price_observations were ingested.
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Shelf</th>
                  <th className="px-3 py-2 text-right">Member</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2 text-center">Fresh</th>
                  <th className="px-3 py-2 text-right">Obs</th>
                  <th className="px-3 py-2 text-right">Last seen</th>
                  <th className="px-3 py-2">OFF</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const headBarcode = (p.off_barcodes && p.off_barcodes[0]) || null
                  const e = headBarcode ? enrichments.get(headBarcode) : null
                  const linkCount = Number(p.off_link_count) || 0
                  return (
                    <tr
                      key={`${p.canonical_id}:${p.price_unit}`}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/inspect/products/${p.canonical_id}`}
                          className="font-medium text-indigo-700 hover:underline"
                        >
                          {p.chain_display_name ?? p.name}
                        </Link>
                        {p.chain_display_name && (
                          <span className="ml-2 text-[11px] text-slate-400">
                            ({p.name})
                          </span>
                        )}
                        <div className="text-[11px] text-slate-500">
                          {p.brand ?? '—'}
                          {p.package_size != null && p.package_unit
                            ? ` · ${p.package_size} ${p.package_unit}`
                            : ''}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-600">
                        {p.category_name ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatPrice(p.shelf_price)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {formatPrice(p.member_price)}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-500">{p.price_unit}</td>
                      <td className="px-3 py-1.5 text-center">
                        <FreshnessDot freshness={p.freshness} />
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {Number(p.obs_count).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs text-slate-500">
                        {formatDate(p.most_recent_observation)}
                      </td>
                      <td className="px-3 py-1.5">
                        <OffChip
                          linkCount={linkCount}
                          nutriscore={e?.nutriscore_grade ?? null}
                          available={offAvailable()}
                          headBarcode={headBarcode}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ── Bits ───────────────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span>
      <span className="text-slate-400">{label}: </span>
      <span className={mono ? 'font-mono text-slate-700' : 'text-slate-700'}>
        {value}
      </span>
    </span>
  )
}

function OffChip({
  linkCount,
  nutriscore,
  available,
  headBarcode,
}: {
  linkCount: number
  nutriscore: string | null
  available: boolean
  headBarcode: string | null
}) {
  if (!available) {
    return <span className="text-[11px] text-slate-400">—</span>
  }
  if (linkCount === 0) {
    return (
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
        no link
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {headBarcode ? (
        <Link
          href={`/inspect/off/${headBarcode}`}
          className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700 hover:bg-indigo-100"
          title={`${linkCount} barcode${linkCount === 1 ? '' : 's'} linked — view ${headBarcode} on OFF`}
        >
          {linkCount}× OFF
        </Link>
      ) : (
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
          {linkCount}× OFF
        </span>
      )}
      {nutriscore && (
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold text-white"
          style={{ background: nutriscoreColor(String(nutriscore).toLowerCase()) }}
          title={`Nutri-Score ${String(nutriscore).toUpperCase()}`}
        >
          {String(nutriscore).toUpperCase()}
        </span>
      )}
    </span>
  )
}

function nutriscoreColor(g: string): string {
  return ({ a: '#1d7d3e', b: '#7eb53d', c: '#e8b22b', d: '#e07a2f', e: '#c93434' }[g]) ?? '#666'
}

function formatPrice(p: number | string | null): string {
  if (p == null) return '—'
  const n = typeof p === 'string' ? parseFloat(p) : p
  if (!Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

function formatNum(n: number | string | null): string {
  if (n == null) return '—'
  const x = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(x)) return '—'
  return x.toFixed(4)
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toISOString().slice(0, 10)
  } catch {
    return String(d)
  }
}
