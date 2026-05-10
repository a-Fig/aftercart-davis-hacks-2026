/**
 * /inspect/products/[canonical_id] — product detail.
 *
 * Four sections:
 *   1. Identity     — name, brand, package, embedding presence + first-8-dims preview,
 *                     category breadcrumb
 *   2. Pricing      — every store with a current_price (shelf + member, freshness,
 *                     obs count) — uses nearbyPricesGlobal, no distance filter
 *   3. Alternatives — equivalence-group peers; explicitly rendered "no equivalents
 *                     recorded yet" when the table is empty (the canonical case
 *                     today since equivalence_groups is unpopulated)
 *   4. OFF enrichment — one OffEnrichmentPanel per row in canonical_barcodes,
 *                       hydrated via getEnrichmentBatch()
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import {
  getProduct,
  getProductBarcodes,
  getEquivalencePeers,
  nearbyPricesGlobal,
  getProductSourceBreakdown,
} from '@/lib/inspector/queries.mjs'
import { lookupEnrichmentBatch, offAvailable } from '@/lib/inspector/off-queries.mjs'
import OffEnrichmentPanel, {
  type OffEnrichment,
} from '@/components/inspector/OffEnrichmentPanel'
import FreshnessDot from '@/components/inspector/FreshnessDot'
import SourceBadge from '@/components/inspector/SourceBadge'
import DataLineageBar from '@/components/inspector/DataLineageBar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProductIdentity {
  canonical_id: number
  name: string
  brand: string | null
  is_store_brand: boolean
  store_brand_chain_id: number | null
  store_brand_chain_name: string | null
  package_size: number | null
  package_unit: string | null
  pricing_unit: string | null
  upc: string | null
  category_id: number | null
  category_name: string | null
  parent_category_id: number | null
  parent_category_name: string | null
  created_at: string
  has_embedding: boolean
  embedding_text: string | null
}

interface BarcodeLink {
  barcode: string
  source: string
  confidence: number | string
  added_at: string
}

interface PriceRow {
  user_canonical_id: number
  canonical_id: number
  weighted_price: number | string
  price_unit: string
  pricing_tier: 'shelf' | 'member' | 'sale'
  observation_count: number | string
  most_recent_observation: string | null
  freshness: string | null
  store_id: number
  address: string
  lon: number | string
  lat: number | string
  chain_id: number
  chain_name: string
  display_name: string | null
  match_type: 'exact' | 'equivalent'
  equivalence_strength: number | string
  equiv_name: string
  equiv_pack_size: number | null
  equiv_pack_unit: string | null
}

interface PeerRow {
  group_id: number
  group_name: string
  peer_canonical_id: number
  peer_name: string
  peer_brand: string | null
  peer_package_size: number | null
  peer_package_unit: string | null
  equivalence_strength: number | string
}

export default async function ProductDetailPage(props: {
  params: Promise<{ canonical_id: string }>
}) {
  await inspectorGuard()
  const { canonical_id } = await props.params
  const id = parseInt(canonical_id, 10)
  if (!Number.isFinite(id)) notFound()

  const product = (await getProduct(id)) as ProductIdentity | null
  if (!product) notFound()

  // Pull the rest in parallel; each is independent.
  const [barcodes, peers, prices, sourceBreakdown] = await Promise.all([
    getProductBarcodes(id) as Promise<BarcodeLink[]>,
    getEquivalencePeers(id) as Promise<PeerRow[]>,
    nearbyPricesGlobal([id]) as Promise<PriceRow[]>,
    getProductSourceBreakdown(id) as Promise<Array<{ source: string; count: number }>>,
  ])

  // Hydrate OFF enrichment for each linked barcode in one bulk SQLite call.
  const enrichmentMap = barcodes.length
    ? lookupEnrichmentBatch(barcodes.map((b) => b.barcode))
    : new Map<string, OffEnrichment>()

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inspect/products" className="text-xs text-indigo-700 hover:underline">
          ← All products
        </Link>
      </div>

      {/* Section 1 — Identity */}
      <Identity product={product} />

      {/* Section 1b — Where this data comes from */}
      <DataSources breakdown={sourceBreakdown} barcodes={barcodes} />

      {/* Section 2 — Pricing across stores */}
      <Pricing rows={prices.filter((r) => r.match_type === 'exact')} />

      {/* Section 3 — Alternatives (equivalence peers) */}
      <Alternatives
        peers={peers}
        equivalentPriceRows={prices.filter((r) => r.match_type === 'equivalent')}
      />

      {/* Section 4 — OFF enrichment */}
      <OffSection barcodes={barcodes} enrichmentMap={enrichmentMap} />
    </div>
  )
}

// ── Section 1: Identity ─────────────────────────────────────────────────────

function Identity({ product }: { product: ProductIdentity }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Identity
      </h2>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold text-slate-900">{product.name}</h1>
          <span className="text-xs text-slate-400">canonical_id {product.canonical_id}</span>
        </div>
        {(product.parent_category_name || product.category_name) && (
          <div className="mt-1 text-xs text-slate-500">
            {product.parent_category_name && (
              <>
                <span>{product.parent_category_name}</span>
                <span className="mx-1.5 text-slate-300">›</span>
              </>
            )}
            <span>{product.category_name ?? 'Uncategorized'}</span>
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="Brand" value={product.brand ?? '—'} />
          <Field
            label="Store brand"
            value={
              product.is_store_brand
                ? `yes (${product.store_brand_chain_name ?? 'unknown chain'})`
                : 'no'
            }
          />
          <Field
            label="Package"
            value={
              product.package_size != null && product.package_unit
                ? `${product.package_size} ${product.package_unit}`
                : '—'
            }
          />
          <Field label="Pricing unit" value={product.pricing_unit ?? '—'} mono />
          <Field label="UPC" value={product.upc ?? '—'} mono />
          <Field label="Created" value={formatDate(product.created_at)} />
        </dl>

        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Description embedding
          </div>
          {product.has_embedding ? (
            <div className="mt-1">
              <span className="text-xs text-emerald-700">●</span>{' '}
              <span className="text-xs text-slate-600">
                Present (384-dim). Preview of first 8 components:
              </span>
              <div className="mt-1 break-all font-mono text-[10px] text-slate-600">
                {previewEmbedding(product.embedding_text, 8)}
              </div>
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-500">
              <span className="text-slate-300">○</span> No embedding stored. Run{' '}
              <code className="font-mono">node web/scripts/generate-embeddings.mjs</code>.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Section 1b: Data sources ────────────────────────────────────────────────

function DataSources({
  breakdown,
  barcodes,
}: {
  breakdown: Array<{ source: string; count: number }>
  barcodes: BarcodeLink[]
}) {
  const total = breakdown.reduce((a, b) => a + Number(b.count), 0)
  const fakeCount = breakdown.find((b) => b.source === 'fake')?.count ?? 0
  const realCount = total - Number(fakeCount)
  const tone =
    total === 0
      ? 'amber'
      : realCount === 0
        ? 'rose'
        : Number(fakeCount) > 0
          ? 'amber'
          : 'emerald'
  const summary =
    total === 0
      ? 'No price observations recorded for this product yet.'
      : realCount === 0
        ? `All ${total} observations are from synthetic seed (source='fake'). Prices below are not real.`
        : Number(fakeCount) > 0
          ? `${realCount} real observation${realCount === 1 ? '' : 's'} + ${Number(fakeCount)} synthetic. Real wins in current_prices via confidence weighting.`
          : `All ${total} observations are real (receipt/manual fieldwork). Demo-ready.`
  const toneClass = {
    amber:   'border-amber-200 bg-amber-50 text-amber-900',
    rose:    'border-rose-200 bg-rose-50 text-rose-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone]

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Where this data comes from
      </h2>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Price-observation source breakdown */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Price observations ({total})
            </div>
            <div className="mt-2">
              <DataLineageBar
                segments={breakdown.map((b) => ({ source: b.source, value: Number(b.count) }))}
                height={10}
                showLegend
              />
            </div>
            <div className={`mt-3 rounded border p-2 text-xs ${toneClass}`}>
              {summary}
            </div>
          </div>

          {/* OFF link source breakdown */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              OFF barcode links ({barcodes.length})
            </div>
            {barcodes.length === 0 ? (
              <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                Not linked to any Open Food Facts product. Run{' '}
                <code className="font-mono">enrich-canonicals-from-off.mjs --apply</code>{' '}
                to attempt automatic linking.
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {barcodes.map((b) => (
                  <li
                    key={b.barcode}
                    className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1"
                  >
                    <span className="font-mono text-xs text-slate-700">{b.barcode}</span>
                    <span className="flex items-center gap-2">
                      <SourceBadge source={b.source} size="xs" />
                      <span className="font-mono text-[10px] text-slate-500">
                        {Number(b.confidence).toFixed(2)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function previewEmbedding(text: string | null, count: number): string {
  if (!text) return '(empty)'
  // pg returns vector as "[0.123,0.456,...]"
  const inner = text.replace(/^\[/, '').replace(/\]$/, '')
  const parts = inner.split(',').slice(0, count).map((s) => {
    const n = parseFloat(s)
    if (!Number.isFinite(n)) return s.trim()
    return n.toFixed(4)
  })
  return `[${parts.join(', ')}, … ]`
}

// ── Section 2: Pricing ──────────────────────────────────────────────────────

function Pricing({ rows }: { rows: PriceRow[] }) {
  // Fold shelf/member rows for the same store into one display row.
  const byStore = new Map<number, FoldedPriceRow>()
  for (const r of rows) {
    const key = r.store_id
    let f = byStore.get(key)
    if (!f) {
      f = {
        store_id: r.store_id,
        chain_id: r.chain_id,
        chain_name: r.chain_name,
        address: r.address,
        display_name: r.display_name,
        price_unit: r.price_unit,
        shelf: null,
        member: null,
        sale: null,
        observation_count: 0,
        most_recent_observation: null,
        freshness: r.freshness,
      }
      byStore.set(key, f)
    }
    if (r.pricing_tier === 'shelf') f.shelf = Number(r.weighted_price)
    if (r.pricing_tier === 'member') f.member = Number(r.weighted_price)
    if (r.pricing_tier === 'sale') f.sale = Number(r.weighted_price)
    f.observation_count += Number(r.observation_count)
    const t = r.most_recent_observation ? new Date(r.most_recent_observation).getTime() : 0
    const cur = f.most_recent_observation ? new Date(f.most_recent_observation).getTime() : 0
    if (t > cur) {
      f.most_recent_observation = r.most_recent_observation
      f.freshness = r.freshness
    }
  }
  const folded = [...byStore.values()].sort(
    (a, b) => (a.shelf ?? Infinity) - (b.shelf ?? Infinity),
  )

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Pricing across stores ({folded.length})
      </h2>
      {folded.length === 0 ? (
        <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No current prices for this canonical at any store. Either no
          observations in the 90-day window, the matview hasn&apos;t been
          refreshed, or no chain has reported this product yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Chain / store</th>
                <th className="px-3 py-2 text-right">Shelf</th>
                <th className="px-3 py-2 text-right">Member</th>
                <th className="px-3 py-2 text-right">Sale</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2 text-center">Fresh</th>
                <th className="px-3 py-2 text-right">Obs</th>
                <th className="px-3 py-2 text-right">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {folded.map((r) => (
                <tr key={r.store_id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/inspect/stores/${r.store_id}`}
                      className="font-medium text-indigo-700 hover:underline"
                    >
                      {r.chain_name}
                    </Link>
                    <div className="text-[11px] text-slate-500">
                      {r.address}
                      {r.display_name && (
                        <>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span>{r.display_name}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">
                    {r.shelf != null ? `$${r.shelf.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {r.member != null ? `$${r.member.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {r.sale != null ? `$${r.sale.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{r.price_unit}</td>
                  <td className="px-3 py-1.5 text-center">
                    <FreshnessDot freshness={r.freshness} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.observation_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-slate-500">
                    {formatDate(r.most_recent_observation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

interface FoldedPriceRow {
  store_id: number
  chain_id: number
  chain_name: string
  address: string
  display_name: string | null
  price_unit: string
  shelf: number | null
  member: number | null
  sale: number | null
  observation_count: number
  most_recent_observation: string | null
  freshness: string | null
}

// ── Section 3: Alternatives ────────────────────────────────────────────────

function Alternatives({
  peers,
  equivalentPriceRows,
}: {
  peers: PeerRow[]
  equivalentPriceRows: PriceRow[]
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Equivalence alternatives
      </h2>
      {peers.length === 0 ? (
        <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No equivalents recorded yet.{' '}
          <span className="text-xs text-slate-400">
            (equivalence_groups is empty per the demo scope notes — a future
            seed pass will populate size variants and cross-brand substitutes.)
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {peers.map((p) => {
            const peerPrices = equivalentPriceRows.filter(
              (r) => r.canonical_id === p.peer_canonical_id,
            )
            return (
              <div
                key={`${p.group_id}:${p.peer_canonical_id}`}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex items-baseline justify-between">
                  <div>
                    <Link
                      href={`/inspect/products/${p.peer_canonical_id}`}
                      className="font-medium text-indigo-700 hover:underline"
                    >
                      {p.peer_name}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500">
                      {p.peer_brand ?? '—'}
                      {p.peer_package_size != null && p.peer_package_unit
                        ? ` · ${p.peer_package_size} ${p.peer_package_unit}`
                        : ''}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    group {p.group_name} · strength{' '}
                    <span className="font-mono">
                      {Number(p.equivalence_strength).toFixed(2)}
                    </span>
                  </span>
                </div>
                {peerPrices.length > 0 && (
                  <div className="mt-2 text-xs text-slate-600">
                    Priced at {peerPrices.length}{' '}
                    store{peerPrices.length === 1 ? '' : 's'}: lowest{' '}
                    <span className="font-medium text-slate-900">
                      ${Math.min(...peerPrices.map((r) => Number(r.weighted_price))).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Section 4: OFF enrichment ──────────────────────────────────────────────

function OffSection({
  barcodes,
  enrichmentMap,
}: {
  barcodes: BarcodeLink[]
  enrichmentMap: Map<string, OffEnrichment>
}) {
  const off = offAvailable()

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Open Food Facts enrichment ({barcodes.length} link{barcodes.length === 1 ? '' : 's'})
      </h2>
      {!off && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          OFF SQLite unavailable in this environment — barcode links are shown
          but no enrichment data can be rendered.
        </div>
      )}

      {barcodes.length === 0 ? (
        <div className="mt-2 rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No barcodes linked to this canonical yet. Run{' '}
          <code className="font-mono">
            node web/scripts/enrich-canonicals-from-off.mjs --apply
          </code>{' '}
          to populate <code className="font-mono">canonical_barcodes</code> from OFF.
        </div>
      ) : (
        <div className="space-y-3">
          {barcodes.map((b) => {
            const e = enrichmentMap.get(b.barcode)
            if (!e) {
              return (
                <div
                  key={b.barcode}
                  className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500"
                >
                  <span className="font-mono">{b.barcode}</span> — linked, but no OFF
                  product row found (either OFF unavailable or barcode not in the
                  US-products subset).
                  <span className="ml-2 text-[11px] text-slate-400">
                    source: {b.source} · confidence: {Number(b.confidence).toFixed(2)}
                  </span>
                </div>
              )
            }
            return (
              <OffEnrichmentPanel
                key={b.barcode}
                enrichment={e}
                link={{
                  source: b.source,
                  confidence: Number(b.confidence),
                  added_at: b.added_at,
                }}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── small helpers ──────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm ${mono ? 'font-mono text-slate-700' : 'text-slate-700'}`}>
        {value}
      </dd>
    </div>
  )
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toISOString().slice(0, 10)
  } catch {
    return String(d)
  }
}
