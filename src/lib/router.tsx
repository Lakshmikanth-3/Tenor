import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const EVENT = 'tenor:navigate'

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(EVENT, cb)
  }
}

const snapshot = () => window.location.pathname + window.location.search

export function useLocation(): { path: string; params: URLSearchParams } {
  const s = useSyncExternalStore(subscribe, snapshot)
  const q = s.indexOf('?')
  return { path: q === -1 ? s : s.slice(0, q), params: new URLSearchParams(q === -1 ? '' : s.slice(q)) }
}

export function navigate(to: string) {
  if (to === snapshot()) return
  window.history.pushState({}, '', to)
  window.dispatchEvent(new Event(EVENT))
  window.scrollTo({ top: 0 })
}

export function Link({ to, onClick, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
