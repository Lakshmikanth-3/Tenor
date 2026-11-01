import { useMemo, useState, type ReactNode } from 'react'
import { useNet, useWallet } from '@/hooks/network'
import { useBalances, useIsDealer, useParams, useTrades } from '@/hooks/data'
import { useActivity } from '@/hooks/activity'
import { useNow } from '@/hooks/useNow'
import { computeRail, currentStep, myLeg, quotePathFrom, type Role } from '@/lib/roles'
import { lastQuote } from '@/lib/lastQuote'
import { fmtToken } from '@/lib/math'
import { Link, navigate } from '@/lib/router'
import { Badge, Button, Card, Empty, Notice, SectionTitle, Stat, inputClass } from './ui'
import { ScanProgress } from './ScanProgress'
import { StepRail } from './StepRail'
import { TradeCard } from './TradeCard'
import { WalletButton } from './WalletButton'

const COPY: Record<Role, { title: string; intro: string; tradesTitle: string; empty: string }> = {
  business: {
    title: 'Business dashboard',
    intro: 'Lock a EUR/USD rate for a future date. Six steps from request to withdrawal; your progress is read from your wallet on chain.',
    tradesTitle: 'Your trades as the hedger',
    empty: 'You have no trades as the hedger yet. Request a rate to get started.',
  },
  dealer: {
    title: 'Dealer desk',
    intro: 'Quote the rate, post margin, then run the trade to settlement. Your progress is read from your wallet on chain.',
    tradesTitle: 'Your trades as the dealer',
    empty: 'No business has taken one of your quotes yet.',
  },
}

/** One dashboard for either side of the market: the step rail first, then only this wallet's trades in that role. */
export function RoleDashboard({ role }: { role: Role }) {
  const { net } = useNet()
  const { address, isConnected } = useWallet()
  const now = useNow()
  const trades = useTrades(address)
  const bal = useBalances(address)
  const allowed = useIsDealer(address)
  const params = useParams()
  const activity = useActivity()
  const copy = COPY[role]
  const me = address?.toLowerCase()

  const rows = useMemo(
    () => (trades.data ?? []).filter((r) => (role === 'business' ? r.trade.hedger : r.trade.dealer).toLowerCase() === me),
    [trades.data, role, me],
  )
  const steps = useMemo(
    () =>
      computeRail({
        role,
        connected: isConnected,
        isDealer: allowed.data === true,
        trades: rows.map((r) => r.trade),
        address,
        freeUsdc: bal.data?.freeUsdc ?? 0n,
        creditEurc: bal.data?.creditEurc ?? 0n,
        now,
      }),
    [role, isConnected, allowed.data, rows, address, bal.data, now],
  )
  const loading = isConnected && (trades.isLoading || bal.isLoading)
  const focus = currentStep(steps)

  // Step 5 changes its button depending on what is actually due.
  const dueLeg = rows.map((r) => r.trade).find((t) => t.status === 1 && now >= Number(t.maturity) && !t.cashSettled && !myLeg(t, role).funded)
  const maturityLabel = dueLeg ? `Fund your ${myLeg(dueLeg, role).token} leg` : 'Settle'

  const go = (to: string, label: string, step: number, opts?: { disabled?: boolean }): ReactNode => (
    <Button variant={focus?.n === step ? 'primary' : 'secondary'} disabled={opts?.disabled} onClick={() => navigate(to)}>
      {label}
    </Button>
  )
  const actions: Record<number, ReactNode> =
    role === 'business'
      ? {
          1: go('/hedge', 'Request a rate', 1),
          2: <QuoteLinkBox primary={focus?.n === 2} />,
          3: go(lastQuote() ?? '/hedge', lastQuote() ? 'Go to Lock rate' : 'Needs a quote link', 3, { disabled: !lastQuote() }),
          4: go('/trades', 'Open My trades', 4),
          5: go('/trades', maturityLabel, 5),
          6: go('/trades', 'Withdraw everything', 6),
        }
      : {
          1: go('/dealer', 'Deposit margin', 1),
          2: go('/dealer', 'Sign a quote', 2, { disabled: !!steps[1]?.blocked }),
          3: go('/trades', 'See quotes taken', 3),
          4: go('/trades', 'Open My trades', 4),
          5: go('/trades', maturityLabel, 5),
          6: go('/trades', 'Withdraw everything', 6),
        }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-semibold text-ink">{copy.title}</h1>
          <p className="mt-1 max-w-xl text-muted">{copy.intro}</p>
        </div>
        {role === 'dealer' && isConnected ? (
          allowed.data === undefined ? null : allowed.data ? <Badge tone="good">Allowlisted dealer</Badge> : <Badge tone="bad">Not on the allowlist</Badge>
        ) : null}
      </div>

      {!isConnected ? (
        <Card className="mb-6 text-center">
          <p className="mb-4 text-ink-2">Connect a wallet to see where you are. The steps below are the same for everyone; your progress comes from your wallet.</p>
          <div className="flex justify-center">
            <WalletButton />
          </div>
        </Card>
      ) : null}

      {role === 'dealer' && isConnected && allowed.data === false ? (
        <div className="mb-6">
          <Notice tone="warn" title="Only allowlisted dealers can sign quotes">
            This wallet is not on the dealer allowlist, so a quote it signs is rejected with DealerNotAllowed. You can still deposit margin and withdraw, but ask the Tenor owner to allowlist
            your address before you sign. If you meant to hedge, switch to Business above.
          </Notice>
        </div>
      ) : null}

      <Card className="mb-6">
        <SectionTitle hint={loading ? 'Reading your wallet…' : undefined}>Your steps</SectionTitle>
        {isConnected ? (
          <div className="mb-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Free margin" value={bal.data ? fmtToken(bal.data.freeUsdc) : '–'} sub="USDC in Tenor" />
            <Stat label="EURC credit" value={bal.data ? fmtToken(bal.data.creditEurc) : '–'} sub="withdrawable" />
            <Stat label={role === 'business' ? 'Trades as hedger' : 'Quotes taken'} value={trades.data ? rows.length : '–'} sub={`${rows.filter((r) => r.trade.status === 1).length} open`} />
            <Stat label="Network" value={net.label} />
          </div>
        ) : null}
        <StepRail steps={steps} actions={actions} />
      </Card>

      <Card>
        <SectionTitle>{copy.tradesTitle}</SectionTitle>
        <div className="mb-4">
          <ScanProgress activity={activity} compact />
        </div>
        {!isConnected ? (
          <p className="text-sm text-muted">Connect a wallet to see your trades.</p>
        ) : trades.isLoading ? (
          <p className="text-sm text-muted">Loading trades from {net.label}…</p>
        ) : rows.length === 0 ? (
          <Empty title="No trades yet">
            {copy.empty}{' '}
            {role === 'business' ? (
              <Link className="font-semibold text-accent-hover underline" to="/hedge">
                Request a rate
              </Link>
            ) : (
              <Link className="font-semibold text-accent-hover underline" to="/dealer">
                Sign a quote
              </Link>
            )}
          </Empty>
        ) : (
          <div className="space-y-6">
            {params.data && address
              ? rows.map((row) => <TradeCard key={row.id.toString()} row={row} me={address} params={params.data} logs={activity.logs} />)
              : null}
          </div>
        )}
      </Card>
    </div>
  )
}

/** Step 2 for the business: paste the dealer's link and open it on the quote page. */
function QuoteLinkBox({ primary }: { primary: boolean }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const open = () => {
    const path = quotePathFrom(text)
    if (!path) {
      setError('That is not a quote link. It should look like …/quote?q=…')
      return
    }
    setError(undefined)
    navigate(path)
  }
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-80">
      <div className="flex gap-2">
        <input
          className={inputClass}
          aria-label="Paste the dealer's quote link"
          placeholder="Paste the quote link"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(undefined)
          }}
        />
        <Button variant={primary ? 'primary' : 'secondary'} disabled={!text.trim()} onClick={open}>
          Open
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
