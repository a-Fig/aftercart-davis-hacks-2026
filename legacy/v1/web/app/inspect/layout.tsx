/**
 * Shared chrome for the internal /inspect dashboard.
 *
 * Sidebar nav + light-mode page background. The root globals.css sets a
 * dark body — we override here on a per-route basis with a light wrapper
 * because the inspector is a desktop, dense, table-heavy UI and the dark
 * mobile-app shell makes data unreadable.
 *
 * Auth is enforced PER-PAGE via inspectorGuard() in each server component
 * (Phase 4 deleted middleware.ts so we can't gate it there). The login
 * page is itself under /inspect/login and skips the guard.
 *
 * Demo banner: when fake observations exist in the DB, render a slim
 * amber strip across the top of every page so a demo never accidentally
 * shows synthetic prices to an audience.
 */

import Link from 'next/link'
import { isInspectorAuthed } from '@/lib/inspector/auth'
import { getDataHealth } from '@/lib/inspector/queries.mjs'
import NavLink from '@/components/inspector/NavLink'

export const metadata = {
  title: 'Inspector — AfterCart',
  description: 'Internal data inspector for the AfterCart catalog and pricing graph.',
}

export default async function InspectLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const authed = await isInspectorAuthed()

  // Health check is best-effort — when DB is down, the rest of the page
  // still loads and shows its own errors. We swallow here so a flaky
  // connection can't blank the layout.
  let fakeObsCount = 0
  if (authed) {
    try {
      const h = await getDataHealth()
      fakeObsCount = Number(h.obs_fake) || 0
    } catch {
      fakeObsCount = 0
    }
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      {/* Demo-readiness warning — only on authed pages and only when there's
          fake data to warn about. Slim, amber, dismissible-feeling-but-not. */}
      {authed && fakeObsCount > 0 && (
        <div className="bg-amber-100 text-amber-900">
          <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-6 py-2 text-xs">
            <span className="text-base leading-none">⚠</span>
            <div className="flex-1">
              <strong>Synthetic data present:</strong>{' '}
              {fakeObsCount.toLocaleString()} price_observations have{' '}
              <code className="font-mono">source=&apos;fake&apos;</code>. Run{' '}
              <code className="font-mono">node web/scripts/purge-fake-data.mjs</code>{' '}
              before any external demo.
            </div>
            <Link href="/inspect" className="font-semibold underline-offset-2 hover:underline">
              View health →
            </Link>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/inspect" className="text-base font-semibold text-slate-900 hover:text-indigo-700">
              AfterCart Inspector
            </Link>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              internal · v2
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {authed ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Authenticated
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                Not signed in
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-6 px-6 py-6">
        {/* Sidebar — only meaningful when authed; hidden on the login page so
            the form is centered and undistracted. */}
        {authed && (
          <aside className="w-48 shrink-0">
            <nav className="flex flex-col gap-1 text-sm">
              <NavSection label="Overview" />
              <NavLink href="/inspect" exact>
                Dashboard
              </NavLink>

              <NavSection label="Catalog" />
              <NavLink href="/inspect/products">Products</NavLink>
              <NavLink href="/inspect/stores">Stores</NavLink>

              <NavSection label="Sources" />
              <NavLink href="/inspect/receipts">Receipts</NavLink>
              <NavLink href="/inspect/off">OFF browser</NavLink>

              <NavSection label="Tools" />
              {/* /contribute lives outside /inspect/ but shares the inspector
                  auth gate and audience — surface it in the same nav. */}
              <NavLink href="/contribute">Contribute</NavLink>
            </nav>
            <div className="mt-6 rounded border border-slate-200 bg-white p-2.5 text-[10px] leading-snug text-slate-500">
              <div className="font-semibold text-slate-700">Internal tool</div>
              <p className="mt-1">
                Source-tagged data: fake (synthetic), receipt (real ingest), manual (fieldwork CSV), OFF (third-party).
              </p>
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}

function NavSection({ label }: { label: string }) {
  return (
    <div className="mt-3 px-3 text-[9px] font-semibold uppercase tracking-wider text-slate-400 first:mt-0">
      {label}
    </div>
  )
}
