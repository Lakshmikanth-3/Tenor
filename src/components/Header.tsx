import { WalletButton } from './WalletButton'
import { clsx } from 'clsx'
import { Link, useLocation } from '@/lib/router'
import { useNet } from '@/hooks/network'

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <rect width="26" height="26" rx="7" fill="#122d45" />
      <path d="M7 9.5h12M7 13h12M7 16.5h7" stroke="#acc6e9" strokeWidth="2" strokeLinecap="round" />
      <circle cx="19" cy="16.5" r="1.6" fill="#acc6e9" />
    </svg>
  )
}

const NAV = [
  { to: '/', label: 'Hedge' },
  { to: '/trades', label: 'My trades' },
  { to: '/dealer', label: 'Dealer' },
  { to: '/refusal', label: 'Refusal room' },
  { to: '/proof', label: 'Proof' },
  { to: '/admin', label: 'Admin / demo', testnetOnly: true },
]

export function Header() {
  const { net, setKey } = useNet()
  const { path } = useLocation()
  const items = NAV.filter((n) => !n.testnetOnly || !net.isMainnet)
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[#f9f9fc]/90 backdrop-blur">
      {net.isMainnet ? (
        <div className="bg-danger px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-white">
          Arc mainnet selected. Transactions move real funds and cannot be reversed.
        </div>
      ) : null}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="display text-xl font-semibold text-ink">Tenor</span>
        </Link>
        <nav aria-label="Primary" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1">
          {items.map((n) => {
            const active = n.to === '/' ? path === '/' : path.startsWith(n.to)
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
