import { useCallback, useSyncExternalStore } from 'react'
import { readRole, writeRole, type Role } from '@/lib/roles'

const EVENT = 'tenor:role'

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** The side of the market the visitor is acting as. Remembered in localStorage; Business by default. */
export function useRole(): [Role, (r: Role) => void] {
  const role = useSyncExternalStore(subscribe, () => readRole())
  const set = useCallback((r: Role) => {
    writeRole(r)
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [role, set]
}
