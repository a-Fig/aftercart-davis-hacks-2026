/**
 * /inspect/off/[barcode] — full OFF product view.
 *
 * Renders the full enrichment payload (image, scoring, ingredients, allergens,
 * traces, additives, per-100g nutriments) for a single OFF barcode, plus
 * the categories / labels / stores tags from the child tables, plus a
 * "linked to canonical?" badge with click-through.
 */

import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import {
  lookupEnrichment,
  categoriesFor,
  labelsFor,
  storesFor,
  offAvailable,
} from '@/lib/inspector/off-queries.mjs'
import { getCanonicalLinksForBarcodes } from '@/lib/inspector/queries.mjs'
import OffEnrichmentPanel, {
  type OffEnrichment,
} from '@/components/inspector/OffEnrichmentPanel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CanonicalLink {
  barcode: string
  canonical_id: number
  source: string
  confidence: number | string
  name: string
}

export default async function OffProductPage(props: {
  params: Promise<{ barcode: string }>
}) {
  await inspectorGuard()
  const { barcode } = await props.params
  const code = decodeURIComponent(barcode).trim()

  const off = offAvailable()
  const enrichment = off ? (lookupEnrichment(code) as OffEnrichment | null) : null
  const categories = off && enrichment ? categoriesFor(enrichment.barcode) : []
  const labels = off && enrichment ? labelsFor(enrichment.barcode) : []
  const stores = off && enrichment ? storesFor(enrichment.barcode) : []
  const links = (await getCanonicalLinksForBarcodes(
    enrichment ? [enrichment.barcode, code] : [code],
  )) as CanonicalLink[]
  // Dedupe — both the lookup variant and the resolved barcode may show up.
  const linksMap = new Map<string, CanonicalLink>()
  for (const l of links) linksMap.set(`${l.canonical_id}:${l.barcode}`, l)
  const uniqLinks = [...linksMap.values()]

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inspect/off" className="text-xs text-indigo-700 hover:underline">
          ← OFF browser
        </Link>
      </div>

      <header>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            <span className="font-mono">{code}</span>
          </h1>
          <div className="text-xs text-slate-500">Open Food Facts product</div>
        </div>
      </header>

      {!off && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          OFF SQLite unavailable. Cannot render enrichment.
        </div>
      )}
      {off && !enrichment && (
        <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No OFF product matches this barcode (tried with/without leading
          zeros). It may not be in the US-products subset; the live OFF web
          API may still know about it.
        </div>
      )}

      {enrichment && <OffEnrichmentPanel enrichment={enrichment} />}

      {/* Canonical link summary */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Canonical links
        </h2>
        {uniqLinks.length === 0 ? (
          <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
            Not linked to any canonical product. Run{' '}
            <code className="font-mono">
              node web/scripts/enrich-canonicals-from-off.mjs --apply
            </code>{' '}
            to attempt automatic linking, or insert a row into{' '}
            <code className="font-mono">canonical_barcodes</code> manually.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Canonical</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2 text-right">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {uniqLinks.map((l) => (
                  <tr key={`${l.canonical_id}:${l.barcode}`} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/inspect/products/${l.canonical_id}`}
                        className="font-medium text-indigo-700 hover:underline"
                      >
                        {l.name}
                      </Link>
                      <span className="ml-2 text-xs text-slate-400">
                        canonical_id {l.canonical_id}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">{l.source}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {Number(l.confidence).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tag panels — directly off the OFF child tables */}
      {(categories.length > 0 || labels.length > 0 || stores.length > 0) && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            OFF tags
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <TagList title="Categories" tags={categories} />
            <TagList title="Labels" tags={labels} />
            <TagList title="Stores" tags={stores} />
          </div>
        </section>
      )}
    </div>
  )
}

function TagList({ title, tags }: { title: string; tags: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title} ({tags.length})
      </div>
      {tags.length === 0 ? (
        <div className="mt-2 text-xs text-slate-400">—</div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
              title={t}
            >
              {t.replace(/^[a-z]{2}:/, '')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
