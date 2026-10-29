import { useNet, useWallet } from '@/hooks/network'
import { useYield } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { tenorCalls } from '@/lib/calls'
import { fmtToken } from '@/lib/math'
import { Badge, Button, Notice, TxStatus } from './ui'

/** Shown on testnet where the vault is the mock; mainnet would use the real USYC adapter. */
export const vaultLabel = (isMainnet: boolean) => (isMainnet ? 'USYC' : 'Mock USYC (testnet)')

export const fmtApy = (bps: bigint) => `${(Number(bps) / 100).toFixed(2)}%`

/** Per-account opt-in for earning yield on free (not locked) margin. Locked trade margin always stays plain USDC. */
export function YieldPanel() {
  const { net } = useNet()
  const { address } = useWallet()
  const y = useYield(address)
  const { state, run, busy } = useTx()
  const tenor = net.tenor
  const d = y.data

  if (!tenor || !d || !d.vault) return null

  const toggle = () => run(d.mode ? 'Turn off yield' : 'Turn on yield', tenorCalls(tenor).setYieldMode(!d.mode))
  const sweep = () => run('Move idle USDC into vault', tenorCalls(tenor).sweepToYield())
  const canToggle = !!address && !busy && (d.mode || d.active)

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="display text-base font-semibold text-ink" id="yield-toggle-label">
            Earn yield on idle margin
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Free margin is held in {vaultLabel(net.isMainnet)} at {fmtApy(d.apyBps)} APY. Margin locked in a trade stays plain USDC and earns nothing.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={d.mode}
          aria-labelledby="yield-toggle-label"
          disabled={!canToggle}
          onClick={() => void toggle()}
          className={`relative mt-0.5 inline-flex h-7 min-h-[44px] w-12 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            d.mode ? 'bg-accent' : 'bg-line-strong/40'
          }`}
        >
          <span
            aria-hidden
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${d.mode ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="label">In vault</div>
          <div className="num mt-1 font-semibold">{fmtToken(d.inVault)}</div>
        </div>
        <div>
          <div className="label">Yield earned</div>
          <div className="num mt-1 font-semibold text-success">{fmtToken(d.earned)}</div>
        </div>
        <div>
          <div className="label">Idle, not yet in vault</div>
          <div className="num mt-1 font-semibold">{fmtToken(d.plain)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {d.mode ? <Badge tone="good">Yield on</Badge> : <Badge>Yield off</Badge>}
        <Badge tone="info">{vaultLabel(net.isMainnet)}</Badge>
        {d.mode && d.active && d.plain > 0n ? (
          <Button onClick={sweep} loading={busy} className="ml-auto">
            Move idle USDC into vault
          </Button>
        ) : null}
      </div>

      {!d.active && !d.mode ? (
        <p className="mt-3 text-xs text-muted">New yield deposits are paused by the contract owner. Withdrawals still work.</p>
      ) : null}
      {d.shortfall > 0n ? (
        <div className="mt-3">
          <Notice tone="warn" title="Demo vault reserve is not fully funded">
            The testnet vault only pays accrued yield out of USDC that was funded to it. Redeeming past that can fail until the vault owner tops up the reserve.
            Settlement, marking and close-out never wait on the vault.
          </Notice>
        </div>
      ) : null}
      <TxStatus state={state} />
    </div>
  )
}
