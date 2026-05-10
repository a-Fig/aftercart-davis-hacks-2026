'use client'

/**
 * Sidebar nav link with active-state highlighting via usePathname().
 *
 * Was a server-rendered <Link> in the old layout — moved client-side so the
 * active route gets visually distinguished. Active rule: exact match for "/"
 * variants, prefix match for nested routes (so /inspect/products/42 lights
 * the "Products" nav item).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavLink({
  href,
  children,
  exact,
}: {
  href: string
  children: React.ReactNode
  /** When true, only highlight on exact pathname match. */
  exact?: boolean
}) {
  const pathname = usePathname() ?? ''
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  const cls = isActive
    ? 'rounded px-3 py-1.5 bg-indigo-50 text-indigo-900 font-medium ring-1 ring-inset ring-indigo-200'
    : 'rounded px-3 py-1.5 text-slate-700 hover:bg-slate-100 hover:text-slate-900'

  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  )
}
