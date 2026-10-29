import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useNet, useWallet } from '@/hooks/network'
import { useParams, useSpot } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { setAnswerCall } from '@/lib/calls'
import { feedAbi } from '@/lib/feedAbi'
import { fmtDateTime, fmtDuration, fmtRate, parseRate } from '@/lib/math'
import { Link } from '@/lib/router'
import { RiskPanel } from './RiskPanel'
import { AddressLink, Badge, Button, Card, Field, Notice, SectionTitle, Stat, TxStatus, inputClass } from './ui'

export function Admin() {
  const { net, client } = useNet()
  const { address } = useWallet()
  const params = useParams()
  const spot = useSpot()
  const { state, run, busy } = useTx()
  const [price, setPrice] = useState('')
  const feed = params.data?.feed

  const feedOwner = useQuery({
    queryKey: ['feedOwner', feed],
    enabled: !!feed && !net.isMainnet,
    queryFn: () => client.readContract({ address: feed as Address, abi: feedAbi, functionName: 'owner' }),
  })

  if (net.isMainnet) {
    return (
      <Wrap>
        <Notice tone="info" title="Not available on mainnet">
          Mainnet reads the Chainlink EUR/USD feed. Nobody can push prices there. <Link className="underline" to="/">Back to Hedge</Link>
        </Notice>
      </Wrap>
    )
  }

  const isOwner = !!address && !!feedOwner.data && address.toLowerCase() === feedOwner.data.toLowerCase()
  const parsed = parseRate(price)
  const current = spot.data?.spot1e18
  const push = (rate1e18: bigint) => {
    if (!feed) return
    // 8-decimal feed answer from a 1e18 rate
    void run('Push price', setAnswerCall(feed, rate1e18 / 10n ** 10n))
  }
  const nudge = (bps: bigint) => current && push((current * (10_000n + bps)) / 10_000n)

  return (
    <Wrap>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card className="space-y-5">
          <SectionTitle hint={isOwner ? <Badge tone="good">You own this feed</Badge> : <Badge tone="warn">Owner only</Badge>}>Push a test price</SectionTitle>
          {!isOwner ? (
            <Notice tone="warn" title="Only the feed owner can push prices">
              Connect the owner wallet{feedOwner.data ? <> (<AddressLink address={feedOwner.data} />)</> : ''}. Anyone can still read the price.
            </Notice>
          ) : null}
          <Field label="New EUR/USD (5 dp)" hint="Stored on the feed with 8 decimals. Refreshing it also clears a stale-price state.">
            <div className="flex gap-2">
              <input className={inputClass} inputMode="decimal" placeholder={current ? fmtRate(current) : '1.11500'} value={price} onChange={(e) => setPrice(e.target.value)} />
              <Button variant="primary" loading={busy} disabled={!isOwner || !parsed || parsed <= 0n} onClick={() => parsed && push(parsed)}>
                Push
              </Button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            {[-500n, -100n, 100n, 500n].map((b) => (
              <Button key={b.toString()} disabled={!isOwner || busy || !current} onClick={() => nudge(b)}>
                {b > 0n ? '+' : ''}
                {Number(b) / 100}%
              </Button>
            ))}
            <Button disabled={!isOwner || busy || !current} onClick={() => current && push(current)}>
              Refresh
            </Button>
          </div>
          <TxStatus state={state} />
        </Card>
        <Card>
          <SectionTitle>Feed state</SectionTitle>
          <div className="grid grid-cols-2 gap-5">
            <Stat label="EUR/USD" value={current ? fmtRate(current) : '–'} sub="mock feed" />
            <Stat
              label="Updated"
              value={spot.data ? `${fmtDuration(spot.data.age)} ago` : '–'}
              sub={spot.data ? fmtDateTime(spot.data.updatedAt) : undefined}
              tone={spot.data?.stale ? 'bad' : undefined}
            />
          </div>
          <p className="mt-4 text-sm text-muted">
            The contract rejects prices older than {params.data ? fmtDuration(Number(params.data.maxStaleness)) : '–'}. This panel exists only on testnet.
          </p>
          {feed ? (
            <div className="mt-3">
              <AddressLink address={feed} label="Feed contract" />
            </div>
          ) : null}
        </Card>
      </div>
      <RiskPanel />
    </Wrap>
  )
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <h1 className="display mb-1 text-3xl font-semibold text-ink">Admin / demo</h1>
      <p className="mb-6 max-w-xl text-muted">Testnet only. Move the mock EUR/USD price to demonstrate marks, margin calls and settlement.</p>
      {children}
    </div>
  )
}
