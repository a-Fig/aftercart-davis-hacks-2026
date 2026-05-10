import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Field collection — AfterCart',
  description: 'Capture shelf prices in-store; build the price database one tag at a time.',
}

/**
 * Wrapper layout for the /field/* portal. The root layout already provides
 * the dark `body { background: #1a1a1a }` and DM Sans font; we just add a
 * mobile-first centered column with comfortable padding for thumb reach.
 */
export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-zinc-100">
      <div className="mx-auto max-w-[580px] px-4 py-6">{children}</div>
    </div>
  )
}
