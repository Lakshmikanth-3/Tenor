import type { Address } from 'viem'
import { WalletButton } from './WalletButton'
import { useNet, useWallet } from '@/hooks/network'
import { useBalances, useParams, useTrades } from '@/hooks/data'
import { useActivity } from '@/hooks/activity'
import { useTx } from '@/hooks/useTx'
import { fmtDateTime, fmtToken } from '@/lib/math'
import { useTxHistory } from '@/lib/txstore'
import { Link } from '@/lib/router'
import { Badge, Button, Card, Empty, SectionTitle, Stat, TxLink, TxStatus } from './ui'
import { MarginDeposit } from './MarginDeposit'
import { Permissions } from './Permissions'
import { ScanProgress } from './ScanProgress'
import { StepTracker } from './StepTracker'
import { planWithdrawAll } from '@/lib/steps'
import { YieldPanel } from './YieldPanel'
import { TradeCard } from './TradeCard'

export function Trades() {
  const { net } = useNet()
  const { address, isConnected } = useWallet()
  const params = useParams()
  const trades = useTrades(address)
  const activity = useActivity()
  const history = useTxHistory(net.chainId)

  if (!isConnected || !address) {
    return (
      <Page>
        <Card className="text-center">
          <p className="mb-4 text-ink-2">Connect a wallet to see the trades you hold as hedger or dealer.</p>
          <div className="flex justify-center">
            <WalletButton />
          </div>
        </Card>
      </Page>
    )
  }

  return (
    <Page>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="space-y-6">
          <ScanProgress activity={activity} />
          {trades.isLoading ? <Card>Loading trades from {net.label}…</Card> : null}
          {trades.data && trades.data.length === 0 ? (
            <Empty title="No trades yet">
              Open a dealer quote to create one. <Link className="font-semibold text-accent-hover underline" to="/">Start a hedge</Link>
            </Empty>
          ) : null}
          {params.data && trades.data
            ? trades.data.map((row) => (
                <TradeCard key={row.id.toString()} row={row} me={address} params={params.data} logs={activity.logs} />
              ))
            : null}
        </div>
        <div className="space-y-6">
          <Account address={address} />
          <Card>
            <SectionTitle hint={activity.head > 0n ? `events from block ${activity.from.toString()}` : undefined}>Your transactions</SectionTitle>
            {history.length === 0 ? (
              <p className="text-sm text-muted">Transactions you send from this app appear here with an explorer link.</p>
            ) : (
              <ul className="space-y-2.5">
                {history.slice(0, 12).map((h) => (
                  <li key={h.hash} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-ink">{h.label}</span>
                    <span className="num text-xs text-muted">{fmtDateTime(Math.floor(h.ts / 1000))}</span>
                    <span className="flex items-center gap-2">
                      {h.status === 'reverted' ? <Badge tone="bad">reverted</Badge> : null}
                      <TxLink hash={h.hash} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  )
}

function Account({ address }: { address: Address }) {
  const { net } = useNet()
  const bal = useBalances(address)
  const { state, runSteps, busy, atomic } = useTx()
  const tenor = net.tenor
  const withdrawPlan = planWithdrawAll({ tenor: tenor as Address, freeUsdc: bal.data?.freeUsdc ?? 0n, eurcCredit: bal.data?.creditEurc ?? 0n })
  return (
    <Card>
      <SectionTitle>Balances in Tenor</SectionTitle>
      <div className="grid grid-cols-2 gap-5">
        <Stat label="Free USDC" value={bal.data ? fmtToken(bal.data.freeUsdc) : '–'} sub="margin, payouts and vault" />
        <Stat label="EURC credit" value={bal.data ? fmtToken(bal.data.creditEurc) : '–'} sub="delivered, withdrawable" />
      </div>
      {withdrawPlan.steps.length > 0 ? (
        <div className="mt-4">
          <Button variant="primary" disabled={!tenor || busy} loading={busy} onClick={() => void runSteps(withdrawPlan.steps)}>
            Withdraw everything
          </Button>
          <StepTracker steps={withdrawPlan.steps} state={state} atomic={atomic} />
        </div>
      ) : null}
      <TxStatus state={state} />
      <div className="mt-5 border-t border-line pt-4">
        <Permissions />
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <YieldPanel />
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <MarginDeposit />
      </div>
    </Card>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <h1 className="display mb-6 text-3xl font-semibold text-ink">My trades</h1>
      {children}
    </div>
  )
}
