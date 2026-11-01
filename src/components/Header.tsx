import { useEffect } from 'react'
import { WalletButton } from './WalletButton'
import { RoleSwitch } from './RoleSwitch'
import { useRole } from '@/hooks/useRole'
import { clsx } from 'clsx'
import { Link, useLocation } from '@/lib/router'
import { useNet } from '@/hooks/network'

const NAV = [
  { to: '/business', label: 'Business', also: ['/', '/hedge', '/quote'] },
  { to: '/dealer-desk', label: 'Dealer', also: ['/dealer'] },
  { to: '/trades', label: 'My trades' },
  { to: '/refusal', label: 'Refusal room' },
  { to: '/proof', label: 'Proof' },
  { to: '/admin', label: 'Admin / demo', testnetOnly: true },
]

export function Header() {
  const { net, setKey } = useNet()
  const { path } = useLocation()
  const items = NAV.filter((n) => !n.testnetOnly || !net.isMainnet)
  const [role, setRole] = useRole()
  // Opening a side's dashboard directly (a bookmark, a link) also switches the role switch to that side.
  useEffect(() => {
    if (path.startsWith('/business') && role !== 'business') setRole('business')
    else if (path.startsWith('/dealer-desk') && role !== 'dealer') setRole('dealer')
  }, [path, role, setRole])
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[#f9f9fc]/90 backdrop-blur">
      {net.isMainnet ? (
        <div className="bg-danger px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-white">
          Arc mainnet selected. Transactions move real funds and cannot be reversed.
        </div>
      ) : null}
      <div className="border-b border-line bg-surface/60">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-1.5">
          <RoleSwitch />
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Tenor logo" className="h-9 w-9 rounded-lg" />
          <span className="display text-xl font-semibold text-ink">Tenor</span>
        </Link>
        <nav aria-label="Primary" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1">
          {items.map((n) => {
            const active = [n.to, ...(n.also ?? [])].some((m) => (m === '/' ? path === '/' : path.startsWith(m)))
            return (
              <Link
                key={n.to}
                to={n.to}
                className={clsx(
                  'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
                  active ? 'bg-accent text-white' : 'text-ink-2 hover:bg-surface-muted',
                )}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {net.isMainnet ? (
            <span className="rounded-md bg-danger px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-white">Mainnet</span>
          ) : null}
          <div role="radiogroup" aria-label="Network" className="flex rounded-lg border border-line bg-surface p-0.5 text-xs font-semibold">
            {(['testnet', 'mainnet'] as const).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={net.key === k}
                onClick={() => setKey(k)}
                className={clsx(
                  'min-h-[32px] rounded-md px-3 capitalize transition',
                  net.key === k ? (k === 'mainnet' ? 'bg-danger text-white' : 'bg-accent text-white') : 'text-ink-2 hover:bg-surface-muted',
                )}
              >
                {k}
              </button>
            ))}
          </div>
          <WalletButton />
        </div>
      </div>
    </header>
  )
}
