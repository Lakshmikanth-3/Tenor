import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { erc20Abi, type Address } from 'viem'
import { useNet, useWallet } from '@/hooks/network'
import { useYield } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { approveCall, bumpVaultPriceCall, fundVaultYieldCall } from '@/lib/calls'
import { fmtToken, parseToken } from '@/lib/math'
import { vaultAbi } from '@/lib/vaultAbi'
import { AddressLink, Badge, Button, Card, Field, SectionTitle, Stat, TxStatus, inputClass } from './ui'
import { fmtApy, vaultLabel } from './YieldPanel'

/** Testnet demo controls for the mock yield vault: bump its share price and fund the USDC reserve that pays yield. */
export function VaultPanel() {
  const { net, client } = useNet()
  const { address } = useWallet()
  const y = useYield(address)
  const { state, run, busy } = useTx()
  const [amount, setAmount] = useState('')
  const vault = y.data?.vault

  const info = useQuery({
    queryKey: ['vaultInfo', net.key, vault],
    enabled: !!vault,
    refetchInterval: 10_000,
    queryFn: async () => {
      const v = vault as Address
      const [price, reserve, assets] = await Promise.all([
        client.readContract({ address: v, abi: vaultAbi, functionName: 'price' }),
        client.readContract({ address: net.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [v] }),
        client.readContract({ address: v, abi: vaultAbi, functionName: 'totalAssets' }),
      ])
      return { price, reserve, assets }
    },
  })

  if (net.isMainnet || !vault || !y.data) return null

  const isOwner = !!address && !!y.data.owner && address.toLowerCase() === y.data.owner.toLowerCase()
  const value = parseToken(amount) ?? 0n
  const fund = async () => {
    if (value <= 0n) return
    const allowance = await client.readContract({ address: net.usdc, abi: erc20Abi, functionName: 'allowance', args: [address as Address, vault] })
    if (allowance < value && !(await run('Allow USDC', approveCall(net.usdc, vault, value)))) return
    await run('Fund yield reserve', fundVaultYieldCall(vault, value))
  }

  return (
    <Card className="space-y-5">
      <SectionTitle hint={isOwner ? <Badge tone="good">You own this vault</Badge> : <Badge tone="warn">Owner only</Badge>}>
        {vaultLabel(false)}
      </SectionTitle>
      <div className="grid grid-cols-3 gap-5">
        <Stat label="APY" value={fmtApy(y.data.apyBps)} sub="fixed, simple interest" />
        <Stat label="Share price" value={info.data ? (Number(info.data.price) / 1e18).toFixed(6) : '–'} sub="USDC per share" />
        <Stat
          label="Reserve"
          value={info.data ? fmtToken(info.data.reserve) : '–'}
          sub={y.data.shortfall > 0n ? `${fmtToken(y.data.shortfall)} short` : 'covers all shares'}
          tone={y.data.shortfall > 0n ? 'warn' : 'good'}
        />
      </div>
      <p className="text-sm text-muted">
        A testnet stand-in for Circle USYC. It does not invest anything, so accrued yield is only redeemable from USDC funded to the reserve. Anyone can top it up.
      </p>
      <Field label="Fund reserve (USDC)">
        <div className="flex gap-2">
          <input className={inputClass} inputMode="decimal" placeholder="10.000000" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button variant="primary" loading={busy} disabled={!address || value <= 0n} onClick={fund}>
            Fund
          </Button>
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        {[10n, 100n].map((b) => (
          <Button key={b.toString()} disabled={!isOwner || busy} onClick={() => run(`Bump price +${Number(b) / 100}%`, bumpVaultPriceCall(vault, b))}>
            Bump price +{Number(b) / 100}%
          </Button>
        ))}
      </div>
      <TxStatus state={state} />
      <AddressLink address={vault} label="Vault contract" />
    </Card>
  )
}
