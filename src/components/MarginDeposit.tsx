import { useState } from 'react'
import { useNet, useWallet } from '@/hooks/network'
import { useBalances, useParams } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { fmtToken, parseToken } from '@/lib/math'
import { planDeposit } from '@/lib/steps'
import { Button, Field, TxStatus, inputClass } from './ui'
import { FundFromAnyChain } from './FundFromAnyChain'
import { StepTracker } from './StepTracker'

/** Deposit USDC into the Tenor margin balance. Asks for a permission only when the allowance is too low. `needed` pre-fills the shortfall. */
export function MarginDeposit({ needed }: { needed?: bigint }) {
  const { net } = useNet()
  const { address } = useWallet()
  const bal = useBalances(address)
  const params = useParams()
  const { state, runSteps, busy, atomic } = useTx()
  const shortfall = needed !== undefined && bal.data ? (needed > bal.data.freeUsdc ? needed - bal.data.freeUsdc : 0n) : undefined
  const [typed, setAmount] = useState<string>()
  const amount = typed ?? (shortfall !== undefined && shortfall > 0n ? fmtToken(shortfall).replace(/,/g, '') : '')

  const value = parseToken(amount) ?? 0n
  const tooMuch = bal.data ? value > bal.data.walletUsdc : false
  const plan =
    net.tenor && bal.data && params.data
      ? planDeposit({
          tenor: net.tenor,
          usdc: net.usdc,
          amount: value,
          allowance: bal.data.allowUsdc,
          walletBalance: bal.data.walletUsdc,
          cap: params.data.maxNotionalUsd6,
        })
      : undefined

  const deposit = async () => {
    if (plan && plan.steps.length > 0) await runSteps(plan.steps)
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="label">Free margin in Tenor</div>
          <div className="num mt-1 font-semibold">{bal.data ? `${fmtToken(bal.data.freeUsdc)} USDC` : '–'}</div>
        </div>
        <div>
          <div className="label">USDC in your wallet</div>
          <div className="num mt-1 font-semibold">{bal.data ? `${fmtToken(bal.data.walletUsdc)} USDC` : '–'}</div>
        </div>
      </div>
      <Field label="Amount to deposit" hint={tooMuch ? 'More than your wallet holds.' : undefined}>
        <div className="flex gap-2">
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000000" aria-label="Deposit amount in USDC" />
          <Button variant="primary" onClick={deposit} loading={busy} disabled={!address || value <= 0n || tooMuch || !plan || plan.steps.length === 0}>
            Deposit
          </Button>
        </div>
      </Field>
      <StepTracker steps={plan?.steps ?? []} state={state} atomic={atomic} />
      <TxStatus state={state} />
      <FundFromAnyChain className="mt-4 !p-4" />
    </div>
  )
}
