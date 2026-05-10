'use client'

import Link from 'next/link'

import type { FieldStore } from './types'

type Props = {
  store: FieldStore
  onToggleStar?: (storeId: number, currentlyStarred: boolean) => void
}

export function StoreCard({ store, onToggleStar }: Props) {
  const subline = [store.address_full, store.city, store.state]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="flex items-stretch gap-3 rounded-xl bg-zinc-900 border border-zinc-800 p-4 hover:border-zinc-700 transition">
      <Link
        href={`/field/stores/${store.store_id}`}
        className="flex-1 min-w-0 flex flex-col gap-1"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-zinc-100 font-medium truncate">
            {store.display_name}
          </span>
          {store.chain_name && store.chain_name !== store.display_name && (
            <span className="text-xs text-zinc-500 truncate">
              {store.chain_name}
            </span>
          )}
        </div>
        {subline && (
          <div className="text-xs text-zinc-500 truncate">{subline}</div>
        )}
        <div className="flex items-center gap-2 mt-1">
          {store.pending_count > 0 ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-900">
              {store.pending_count} pending
            </span>
          ) : (
            <span className="text-xs text-zinc-600">No pending</span>
          )}
        </div>
      </Link>

      {onToggleStar && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onToggleStar(store.store_id, store.is_field_starred)
          }}
          aria-label={store.is_field_starred ? 'Unstar' : 'Star'}
          className={`shrink-0 self-center w-10 h-10 rounded-full flex items-center justify-center text-lg transition ${
            store.is_field_starred
              ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
              : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
          }`}
        >
          {store.is_field_starred ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}
