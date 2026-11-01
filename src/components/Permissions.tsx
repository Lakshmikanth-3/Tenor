import { useNet, useWallet } from '@/hooks/network'
import { useBalances } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { approveCall } from '@/lib/calls'
import { fmtToken } from '@/lib/math'
import { AddressLink, TxStatus } from './ui'

const UNLIMITED = 2n ** 128n

const amount = (v: bigint, symbol: string) => (v >= UNLIMITED ? `unlimited ${symbol}` : `${fmtToken(v)} ${symbol}`)

/** Who can spend from your wallet, how much, and a link to set each permission back to 0. */
export function Permissions() {
  const { net } = useNet()
  const { address } = useWallet()
  const bal = useBalances(address)
  const { state, run, busy } = useTx()
  const tenor = net.tenor
  if (!tenor || !address || !bal.data) return null

  const rows = [
    { symbol: 'USDC', token: net.usdc, allowance: bal.data.allowUsdc },
    ...(net.eurc ? [{ symbol: 'EURC', token: net.eurc, allowance: bal.data.allowEurc }] : []),
  ]
  const any = rows.some((r) => r.allowance > 0n)

  return (
    <div>
      <div className="label">Permissions you have given</div>
      <p className="mt-1 text-xs text-muted">
        Tenor <AddressLink address={tenor} label={`${tenor.slice(0, 6)}…${tenor.slice(-4)}`} /> can spend, from your wallet:
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.symbol} className="flex flex-wrap items-center justify-between gap-2">
            <span className="num font-medium text-ink">{r.allowance > 0n ? amount(r.allowance, r.symbol) : `0 ${r.symbol}`}</span>
            {r.allowance > 0n ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(`Revoke ${r.symbol} permission`, approveCall(r.token, tenor, 0n))}
                className="text-xs font-semibold text-danger underline underline-offset-2 disabled:opacity-50"
              >
                Revoke permission
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!any ? <p className="mt-1 text-xs text-muted">None. The next action that needs one will ask once.</p> : null}
      <TxStatus state={state} />
    </div>
  )
}
