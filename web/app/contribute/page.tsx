/**
 * /contribute — receipt photo upload UI.
 *
 * Server component shell. Auth is enforced via inspectorGuard() (same gate
 * as /inspect/* — these are both internal tools and share the audience).
 * The interactive bits live in <ReceiptUploadForm /> as a client component
 * so we can wire up XHR upload progress + per-file state.
 *
 * "Recent uploads" pulls the last 10 receipts straight from Cloud SQL at
 * page load time so the user can see their most recent contributions
 * without a client-side fetch dance. force-dynamic disables the static
 * cache — every page hit re-queries.
 */

import Link from 'next/link'
import { inspectorGuard } from '@/lib/inspector/auth'
import { query } from '@/lib/receipts/db.mjs'
import ReceiptUploadForm from './ReceiptUploadForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RecentReceiptRow = {
  receipt_id: string
  ingested_at: string
  receipt_dated_at: string | null
  chain_name: string | null
  store_address: string | null
  line_count: number | null
  obs_count: number | string
}

async function getRecentReceipts(): Promise<RecentReceiptRow[]> {
  return (await query(
    `SELECT r.receipt_id,
            r.ingested_at,
            r.receipt_dated_at,
            c.name AS chain_name,
            s.address AS store_address,
            r.line_count,
            (SELECT COUNT(*)
               FROM price_observations po
              WHERE po.source_receipt_id = r.receipt_id) AS obs_count
       FROM receipts r
       LEFT JOIN chains c ON c.chain_id = r.inferred_chain_id
       LEFT JOIN stores s ON s.store_id = r.store_id
      ORDER BY r.ingested_at DESC
      LIMIT 10`,
  )) as RecentReceiptRow[]
}

export default async function ContributePage() {
  await inspectorGuard()

  let recent: RecentReceiptRow[] = []
  let recentError: string | null = null
  try {
    recent = await getRecentReceipts()
  } catch (err) {
    // Don't block the upload UI on a failed read of recent activity. Most
    // common cause: schema not yet applied on a fresh checkout.
    recentError = (err as Error).message
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/inspect" className="text-base font-semibold text-slate-900 hover:text-indigo-700">
              AfterCart Inspector
            </Link>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              contribute
            </span>
          </div>
          <Link
            href="/inspect"
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            ← Back to inspector
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] space-y-8 px-6 py-8">
        <section>
          <h1 className="text-2xl font-semibold text-slate-900">
            Contribute receipt photos
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload receipts to grow the price database. Photos are stored privately for re-processing.
          </p>
        </section>

        <ReceiptUploadForm />

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recent uploads
          </h2>
          {recentError ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Couldn&rsquo;t load recent uploads: {recentError}
            </div>
          ) : recent.length === 0 ? (
            <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">
              No receipts uploaded yet. Drop one above to get started.
            </div>
          ) : (
            <div className="overflow-hidden rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Store</th>
                    <th className="px-3 py-2">Receipt date</th>
                    <th className="px-3 py-2 text-right">Items</th>
                    <th className="px-3 py-2 text-right">Observations</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr
                      key={r.receipt_id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-1.5 align-middle text-slate-600 tabular-nums">
                        {formatRelative(r.ingested_at)}
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <div className="font-medium text-slate-900">
                          {r.chain_name ?? <span className="text-slate-400">— unresolved —</span>}
                        </div>
                        {r.store_address && (
                          <div className="text-[11px] text-slate-500">{r.store_address}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-slate-600 tabular-nums">
                        {r.receipt_dated_at ? r.receipt_dated_at.slice(0, 10) : '—'}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-right tabular-nums">
                        {Number(r.line_count ?? 0)}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-right tabular-nums">
                        {Number(r.obs_count).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function formatRelative(ts: string): string {
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return ts
  const diffSec = (Date.now() - t) / 1000
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}
