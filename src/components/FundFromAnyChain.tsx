import { ExternalLink } from 'lucide-react'
import { useNet, useWallet } from '@/hooks/network'
import { useBalances } from '@/hooks/data'
import { fmtToken } from '@/lib/math'
import { Card } from './ui'

const LINKS = [
  { href: 'https://developers.circle.com/cctp', label: 'Bridge with CCTP' },
  { href: 'https://developers.circle.com/gateway', label: 'Move with Gateway' },
] as const

const linkClass =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line-strong/40 bg-surface px-3 text-sm font-semibold text-ink transition hover:bg-surface-muted'

/** Links only: Circle's official bridge docs, plus the testnet faucet. Shows what the wallet already holds on Arc. */
export function FundFromAnyChain({ className }: { className?: string }) {
  const { net } = useNet()
  const { address } = useWallet()
  const bal = useBalances(address)
  const value = (v: bigint | undefined) => (address && v !== undefined ? fmtToken(v) : '–')

  return (
    <Card className={className}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="display text-base font-semibold text-ink">Fund from any chain</div>
          <p className="mt-0.5 text-sm text-muted">Need USDC or EURC on Arc? Bring it from another chain with Circle.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {l.label}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ))}
            {!net.isMainnet ? (
              <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className={linkClass}>
                Testnet faucet
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:text-right">
          <div>
            <dt className="label">USDC on Arc</dt>
            <dd className="num mt-1 font-semibold">{value(bal.data?.walletUsdc)}</dd>
          </div>
          <div>
            <dt className="label">EURC on Arc</dt>
            <dd className="num mt-1 font-semibold">{value(bal.data?.walletEurc)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  )
}
