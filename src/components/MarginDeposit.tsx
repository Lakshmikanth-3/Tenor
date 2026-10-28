import { useState } from 'react'
import { useNet, useWallet } from '@/hooks/network'
import { useBalances } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { approveCall, tenorCalls } from '@/lib/calls'
import { fmtToken, parseToken } from '@/lib/math'
import { Button, Field, TxStatus, inputClass } from './ui'

/** Deposit USDC into the Tenor margin balance (approve, then depositMargin). `needed` pre-fills the shortfall. */
export function MarginDeposit({ needed }: { needed?: bigint }) {
  const { net } = useNet()
  const { address } = useWallet()
  const bal = useBalances(address)
  const { state, run, busy } = useTx()
  const shortfall = needed !== undefined && bal.data ? (needed > bal.data.freeUsdc ? needed - bal.data.freeUsdc : 0n) : undefined
  const [typed, setAmount] = useState<string>()
  const amount = typed ?? (shortfall !== undefined && shortfall > 0n ? fmtToken(shortfall).replace(/,/g, '') : '')

  const value = parseToken(amount) ?? 0n
  const tooMuch = bal.data ? value > bal.data.walletUsdc : false

  const deposit = async () => {
    if (!net.tenor || value <= 0n) return
    const tenor = net.tenor
    if (!bal.data || bal.data.allowUsdc < value) {
      const ok = await run('Allow USDC', approveCall(net.usdc, tenor, value))
      if (!ok) return
    }
    await run('Deposit margin', tenorCalls(tenor).depositMargin(value))
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
          <Button variant="primary" onClick={deposit} loading={busy} disabled={!address || value <= 0n || tooMuch || !net.tenor}>
            Deposit
          </Button>
        </div>
      </Field>
      <TxStatus state={state} />
    </div>
  )
}
