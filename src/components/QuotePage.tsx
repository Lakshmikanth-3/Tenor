import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { recoverTypedDataAddress, type Address } from 'viem'
import { Check, X } from 'lucide-react'
import { useNet, useWallet } from '@/hooks/network'
import { useBalances, useIsDealer, useNonceUsed, useParams, useQuoteView } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { tenorAbi } from '@/lib/tenorAbi'
import { ceilBps, eurcFor, fmtDate, fmtDateTime, fmtDuration, fmtRate, fmtToken, nowSec } from '@/lib/math'
import { decodeQuote, quoteTypedData } from '@/lib/quote'
import { Link, useLocation } from '@/lib/router'
import { NETWORKS } from '@/lib/networks'
import { AddressLink, Badge, Button, Card, Notice, SectionTitle, TxStatus } from './ui'
import { FundFromAnyChain } from './FundFromAnyChain'
import { StepTracker } from './StepTracker'
import { planLockRate } from '@/lib/steps'

function Check1({ ok, children }: { ok: boolean | undefined; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok === undefined ? (
        <span className="mt-1 h-3.5 w-3.5 rounded-full border border-line" aria-hidden />
      ) : ok ? (
        <Check className="mt-0.5 h-4 w-4 text-success" aria-hidden />
      ) : (
        <X className="mt-0.5 h-4 w-4 text-danger" aria-hidden />
      )}
      <span className={ok === false ? 'text-danger' : 'text-ink-2'}>{children}</span>
    </li>
  )
}

export function QuotePage() {
  const { net, client, setKey } = useNet()
  const { params: qs } = useLocation()
  const { address } = useWallet()
  const link = useMemo(() => {
    const raw = qs.get('q')
    return raw ? decodeQuote(raw) : undefined
  }, [qs])
  const open = useTx()
  const params = useParams()
  const [now, setNow] = useState(nowSec())
  useEffect(() => {
    const t = setInterval(() => setNow(nowSec()), 1000)
    return () => clearInterval(t)
  }, [])

  const quote = link?.quote
  const sigOk = useQuery({
    queryKey: ['sig', qs.get('q')],
    enabled: !!link,
    queryFn: async () => {
      if (!link) return false
      const signer = await recoverTypedDataAddress({
        ...quoteTypedData(link.chainId, link.tenor, link.quote),
        signature: link.signature,
      })
      return signer.toLowerCase() === link.quote.dealer.toLowerCase()
    },
  })
  const allowed = useIsDealer(quote?.dealer)
  const used = useNonceUsed(quote?.dealer, quote?.nonce)
  const tenorLeft = quote ? Number(quote.maturity) - now : 0
  const live = useQuoteView(quote?.notionalUsd6 ?? 0n, BigInt(Math.max(0, Math.round(tenorLeft / 60) * 60)))
  const liveQ = live.data?.ok ? live.data : undefined
  const dealerFree = useQuery({
    queryKey: ['dealerFree', net.key, quote?.dealer],
    enabled: !!quote && !!net.tenor,
    refetchInterval: 8_000,
    queryFn: () =>
      client.readContract({ address: net.tenor as Address, abi: tenorAbi, functionName: 'marginOf', args: [(quote as NonNullable<typeof quote>).dealer] }),
  })
  const bal = useBalances(address)

  if (!link || !quote) {
    return (
      <Wrap>
        <Notice tone="bad" title="This quote link could not be read">
          The link is incomplete or damaged. Ask the dealer to send it again, or go back to the{' '}
          <Link className="font-semibold text-accent-hover underline underline-offset-2" to="/">
            Hedge page
          </Link>
          .
        </Notice>
      </Wrap>
    )
  }

  const linkNet = link.chainId === NETWORKS.mainnet.chainId ? NETWORKS.mainnet : link.chainId === NETWORKS.testnet.chainId ? NETWORKS.testnet : undefined
  if (!linkNet || linkNet.key !== net.key || (net.tenor && link.tenor.toLowerCase() !== net.tenor.toLowerCase())) {
    return (
      <Wrap>
        <Notice tone="warn" title="This quote is for a different network or contract">
          {linkNet ? `It was signed for ${linkNet.label}.` : `It was signed for chain ${link.chainId}.`} Switch the network to take it.
          {linkNet && linkNet.key !== net.key ? (
            <div className="mt-3">
              <Button variant="primary" onClick={() => setKey(linkNet.key)}>
                Switch to {linkNet.label}
              </Button>
            </div>
          ) : null}
        </Notice>
      </Wrap>
    )
  }

  const eurc = eurcFor(quote.notionalUsd6, quote.rate)
  const im = ceilBps(quote.notionalUsd6, quote.initialMarginBps)
  const expiresIn = Number(quote.quoteExpiry) - now
  const expired = expiresIn < 0
  const inBand = liveQ ? quote.rate >= liveQ.bandLow && quote.rate <= liveQ.bandHigh : undefined
  const tenorOk = params.data ? BigInt(Math.max(tenorLeft, 0)) >= params.data.minTenor : undefined
  const plan =
    bal.data && params.data && net.tenor
      ? planLockRate({
          tenor: link.tenor,
          usdc: net.usdc,
          quote,
          signature: link.signature,
          margin: im,
          freeMargin: bal.data.freeUsdc,
          allowance: bal.data.allowUsdc,
          walletBalance: bal.data.walletUsdc,
          cap: params.data.maxNotionalUsd6,
        })
      : undefined
  const marginOk = plan ? !plan.blocker : undefined
  const dealerFunded = dealerFree.data !== undefined ? dealerFree.data >= im : undefined
  const isDealerWallet = !!address && address.toLowerCase() === quote.dealer.toLowerCase()
  const ready = sigOk.data && allowed.data && !used.data && !expired && inBand && tenorOk && marginOk && dealerFunded && !isDealerWallet

  const hedgerSells = quote.side === 0
  const sentence = quote.cashSettled
    ? `On ${fmtDate(quote.maturity)} this ${fmtToken(quote.notionalUsd6)} USDC position settles in USDC only, against the locked rate ${fmtRate(quote.rate)}.`
    : hedgerSells
      ? `On ${fmtDate(quote.maturity)} you will receive exactly ${fmtToken(eurc)} EURC for your ${fmtToken(quote.notionalUsd6)} USDC, whatever EUR/USD does.`
      : `On ${fmtDate(quote.maturity)} you will receive exactly ${fmtToken(quote.notionalUsd6)} USDC for your ${fmtToken(eurc)} EURC, whatever EUR/USD does.`

  return (
    <Wrap>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <Card>
          <SectionTitle hint={expired ? <Badge tone="bad">Expired</Badge> : <Badge tone="info">Valid for {fmtDuration(expiresIn)}</Badge>}>
            Dealer quote
          </SectionTitle>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            <Term k="Your position" v={hedgerSells ? 'Receive USD (exporter)' : 'Pay USD (importer)'} />
            <Term k="USDC notional" v={fmtToken(quote.notionalUsd6)} />
            <Term k="Locked rate" v={fmtRate(quote.rate)} sub="USD per EUR" />
            <Term k={hedgerSells ? 'You receive' : 'You pay'} v={`${fmtToken(eurc)} EURC`} sub="at the locked rate" />
            <Term k="Maturity" v={fmtDateTime(quote.maturity)} />
            <Term k="Settlement" v={quote.cashSettled ? 'Cash-settled' : 'Physical delivery'} />
            <Term k="Margin each side" v={`${fmtToken(im)} USDC`} sub={`${quote.initialMarginBps.toString()} bps`} />
            <div>
              <dt className="label">Dealer</dt>
              <dd className="mt-1">
                <AddressLink address={quote.dealer} />
              </dd>
            </div>
          </dl>
          <p className="mt-6 rounded-xl bg-surface-muted px-4 py-3.5 text-[15px] font-medium leading-relaxed text-ink">{sentence}</p>
          <ul className="mt-6 space-y-2">
            <Check1 ok={sigOk.data}>Signature matches the dealer</Check1>
            <Check1 ok={allowed.data}>Dealer is on the allowlist</Check1>
            <Check1 ok={expired ? false : true}>Quote has not expired</Check1>
            <Check1 ok={used.data === undefined ? undefined : !used.data}>Quote has not been used or cancelled</Check1>
            <Check1 ok={inBand}>
              Rate is inside today&apos;s band{liveQ ? ` (${fmtRate(liveQ.bandLow)} to ${fmtRate(liveQ.bandHigh)})` : ''}
            </Check1>
            <Check1 ok={tenorOk}>Maturity is far enough away</Check1>
            <Check1 ok={dealerFunded}>Dealer has funded the margin</Check1>
            <Check1 ok={marginOk}>You have enough USDC for the margin</Check1>
          </ul>
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Lock rate</SectionTitle>
            <p className="mb-3 text-sm text-muted">
              You post {fmtToken(im)} USDC, the dealer posts the same. It is returned at maturity apart from any variation.
              {bal.data
                ? bal.data.freeUsdc >= im
                  ? ' You already have enough margin in Tenor, so this is one step.'
                  : ` Your margin in Tenor is ${fmtToken(bal.data.freeUsdc)} USDC, so ${fmtToken(im - bal.data.freeUsdc)} USDC will be added first.`
                : ''}
            </p>
            {isDealerWallet ? <p className="mb-3 text-sm text-warn">You are connected as the dealer. Open this link with the hedger wallet.</p> : null}
            {plan?.blocker ? (
              <div className="mb-3 space-y-3">
                <p className="text-sm text-danger" role="alert">
                  {plan.blocker.message}
                </p>
                <FundFromAnyChain className="!p-4" />
              </div>
            ) : null}
            <Button
              variant="primary"
              className="w-full"
              loading={open.busy}
              disabled={!address || !ready || !plan || plan.steps.length === 0}
              onClick={() => plan && open.runSteps(plan.steps)}
            >
              Lock rate
            </Button>
            {!address ? <p className="mt-2 text-xs text-muted">Connect your wallet to continue.</p> : null}
            <StepTracker steps={plan?.steps ?? []} state={open.state} atomic={open.atomic} />
            <TxStatus state={open.state} />
            {open.state.phase === 'done' ? (
              <p className="mt-3 text-sm">
                Your trade is open. <Link className="font-semibold text-accent-hover underline" to="/trades">View it in My trades</Link>
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </Wrap>
  )
}

function Term({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className="num mt-1 font-semibold text-ink">{v}</dd>
      {sub ? <dd className="text-xs text-muted">{sub}</dd> : null}
    </div>
  )
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <h1 className="display mb-6 text-3xl font-semibold text-ink">Take a dealer quote</h1>
      {children}
    </div>
  )
}
