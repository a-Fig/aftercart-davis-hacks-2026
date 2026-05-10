/**
 * /inspect/off — direct OFF SQLite browser.
 *
 * - Free-text FTS5 search via ?q=… (uses the same searchOff() the user-facing
 *   ReviewScreen calls)
 * - Quick "barcode lookup" form that links to /inspect/off/[barcode]
 * - Each search result row carries a "linked to canonical" badge if it shows
 *   up in canonical_barcodes, with click-through to the canonical detail page
 *
 * "Recently auto-suggested" deferred — no logging in the API routes today.
 */

import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import { searchOffProducts, offAvailable } from '@/lib/inspector/off-queries.mjs'
import { getCanonicalLinksForBarcodes } from '@/lib/inspector/queries.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OffSearchHit {
  barcode: string
  product_name: string | null
  brands: string | null
  generic_name: string | null
  quantity_raw: string | null
  package_size: number | null
  package_unit: string | null
  image_url: string | null
  nutriscore_grade: string | null
  nova_group: number | null
  score: number
}

interface CanonicalLink {
  barcode: string
  canonical_id: number
  source: string
  confidence: number | string
  name: string
}

type Search = Record<string, string | string[] | undefined>

export default async function OffBrowserPage(props: { searchParams: Promise<Search> }) {
  await inspectorGuard()
  const sp = await props.searchParams
  const q = (singleParam(sp.q) ?? '').trim()
  const barcodeJump = (singleParam(sp.barcode) ?? '').trim()

  // Barcode lookup is a hard redirect — the user typed a UPC and wants to
  // see that product page. We don't try to validate it here; the detail
  // page itself handles "no such barcode in OFF."
  if (barcodeJump) {
    return (
      <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
        Loading{' '}
        <Link
          href={`/inspect/off/${encodeURIComponent(barcodeJump)}`}
          className="text-indigo-700 hover:underline"
        >
          {barcodeJump}
        </Link>
        … <noscript>JavaScript disabled — click the link above.</noscript>
        <meta httpEquiv="refresh" content={`0; url=/inspect/off/${encodeURIComponent(barcodeJump)}`} />
      </div>
    )
  }

  const off = offAvailable()
  const hits: OffSearchHit[] = q && off ? (searchOffProducts(q, 50) as OffSearchHit[]) : []

  // Cross-reference every hit's barcode against canonical_barcodes so we
  // can render the "linked to canonical" badge inline.
  const links = hits.length
    ? ((await getCanonicalLinksForBarcodes(hits.map((h) => h.barcode))) as CanonicalLink[])
    : []
  const linksByBarcode = new Map<string, CanonicalLink>()
  for (const l of links) linksByBarcode.set(l.barcode, l)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Open Food Facts browser</h1>
        <p className="mt-1 text-sm text-slate-600">
          Direct view of the local OFF SQLite — same searchOff() the user-facing
          review screen uses.
        </p>
      </header>

      {!off && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          OFF SQLite unavailable in this environment. The search and lookup
          tools will not return results until the database is built. Run{' '}
          <code className="font-mono">node web/scripts/build-off-sqlite.mjs</code>.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* FTS5 search */}
        <form
          action="/inspect/off"
          method="get"
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Free-text search
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="chicken thigh"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Search
            </button>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            FTS5 over product_name + brands + generic_name. Last token gets a prefix wildcard.
          </div>
        </form>

        {/* Direct barcode lookup */}
        <form
          action="/inspect/off"
          method="get"
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Barcode (UPC) lookup
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              name="barcode"
              placeholder="0078742370156"
              className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
            <button
              type="submit"
              className="rounded border border-slate-300 bg-slate-50 px-3 py-1 text-sm hover:bg-slate-100"
            >
              Open
            </button>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Leading-zero variants are tried automatically.
          </div>
        </form>
      </div>

      {q && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Results for &ldquo;{q}&rdquo; — {hits.length} hit{hits.length === 1 ? '' : 's'}
          </h2>
          {hits.length === 0 ? (
            <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
              No matches. (FTS5 wants ≥2-character tokens.)
            </div>
          ) : (
            <div className="space-y-2">
              {hits.map((h) => {
                const link = linksByBarcode.get(h.barcode)
                return (
                  <div
                    key={h.barcode}
                    className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-xl">
                      {h.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={h.image_url}
                          alt={h.product_name ?? 'product'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span aria-label="no image">📦</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link
                          href={`/inspect/off/${encodeURIComponent(h.barcode)}`}
                          className="truncate font-medium text-indigo-700 hover:underline"
                        >
                          {h.product_name ?? <span className="italic">(no name)</span>}
                        </Link>
                        <span className="font-mono text-[11px] text-slate-400">
                          {h.barcode}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600">
                        {h.brands ?? '—'}
                        {h.quantity_raw && (
                          <>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span>{h.quantity_raw}</span>
                          </>
                        )}
                        {h.generic_name && (
                          <>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span className="text-slate-500">{h.generic_name}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {h.nutriscore_grade && (
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold text-white"
                            style={{
                              background: nutriscoreColor(
                                String(h.nutriscore_grade).toLowerCase(),
                              ),
                            }}
                            title={`Nutri-Score ${String(h.nutriscore_grade).toUpperCase()}`}
                          >
                            {String(h.nutriscore_grade).toUpperCase()}
                          </span>
                        )}
                        {h.nova_group != null && (
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold text-white"
                            style={{ background: novaColor(Number(h.nova_group)) }}
                            title={`NOVA ${h.nova_group}`}
                          >
                            {h.nova_group}
                          </span>
                        )}
                        {link ? (
                          <Link
                            href={`/inspect/products/${link.canonical_id}`}
                            className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold uppercase text-emerald-700 hover:bg-emerald-100"
                            title={`Linked to canonical_id ${link.canonical_id} — ${link.name}`}
                          >
                            linked
                          </Link>
                        ) : (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 uppercase text-slate-500">
                            unlinked
                          </span>
                        )}
                        <span className="ml-auto text-[11px] text-slate-400">
                          score {Number(h.score).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function nutriscoreColor(g: string): string {
  return ({ a: '#1d7d3e', b: '#7eb53d', c: '#e8b22b', d: '#e07a2f', e: '#c93434' }[g]) ?? '#666'
}

function novaColor(n: number): string {
  return ({ 1: '#1d7d3e', 2: '#7eb53d', 3: '#e8b22b', 4: '#c93434' } as Record<number, string>)[n] ?? '#666'
}

function singleParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}
