import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useNet } from '@/hooks/network'
import { useParams, useQuoteView, useSpot } from '@/hooks/data'
import { useShareLink } from '@/hooks/useShareLink'
import { eurcFor, fmtDate, fmtRate, fmtToken, nowSec, parseToken, type Side } from '@/lib/math'
import { extractQuotePayload } from '@/lib/quote'
import { Link, navigate } from '@/lib/router'
import { addressUrl } from '@/lib/networks'
import { Button, Card, CopyButton, Field, Notice, SectionTitle, Segmented, Stat, inputClass } from './ui'
import { HedgeChart } from './HedgeChart'

const toLocalInput = (ts: number) => {
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Hedge() {
  const { net } = useNet()
  const params = useParams()
  const spot = useSpot()
  const [side, setSide] = useState<Side>(0)
  const [amount, setAmount] = useState('10')
  const [cash, setCash] = useState(false)
  const [maturityStr, setMaturityStr] = useState(() => toLocalInput(nowSec() + 30 * 86400))
  const [pasted, setPasted] = useState('')

  const notional = parseToken(amount) ?? 0n
  const maturityTs = Math.floor(new Date(maturityStr).getTime() / 1000)
  const tenorRaw = Number.isFinite(maturityTs) ? maturityTs - nowSec() : 0
  const tenorQ = BigInt(Math.max(0, Math.round(tenorRaw / 60) * 60))
  const minTenor = params.data?.minTenor ?? 300n
  const maxNotional = params.data?.maxNotionalUsd6
  const q = useQuoteView(notional, tenorQ > 0n ? tenorQ : 0n)
  const quote = q.data?.ok ? q.data : undefined

  const problems: string[] = []
  if (notional <= 0n) problems.push('Enter an amount greater than zero (up to 6 decimals).')
  if (maxNotional !== undefined && notional > maxNotional) problems.push(`The per-trade cap is ${fmtToken(maxNotional, 2)} USDC.`)
  if (BigInt(Math.max(tenorRaw, 0)) < minTenor) problems.push(`Maturity must be at least ${Number(minTenor) / 60} minutes from now.`)

  const eurc = quote ? eurcFor(notional, quote.forwardFair) : undefined
  const reqPath = useMemo(
    () => (problems.length === 0 ? `/dealer?side=${side}&n=${notional.toString()}&m=${maturityTs}&cash=${cash ? 1 : 0}` : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [side, notional, maturityTs, cash, problems.length],
  )
  const reqLink = useShareLink(reqPath)

  const chips = [
    ...(net.isMainnet ? [] : [{ label: '10 min', secs: 600 }]),
    { label: '1 week', secs: 7 * 86400 },
    { label: '1 month', secs: 30 * 86400 },
    { label: '3 months', secs: 90 * 86400 },
  ]

  const maturityDate = fmtDate(maturityTs)
  const sentence = (() => {
    if (!quote || eurc === undefined) return undefined
    if (cash) {
      return `On ${maturityDate} your position settles in USDC only: you receive or pay the gap between ${fmtRate(quote.forwardFair)} and EUR/USD at maturity, on ${fmtToken(eurc)} EUR of notional.`
    }
    return side === 0
      ? `On ${maturityDate} you will receive exactly ${fmtToken(eurc)} EURC for your ${fmtToken(notional)} USDC, whatever EUR/USD does.`
      : `On ${maturityDate} you will receive exactly ${fmtToken(notional)} USDC for your ${fmtToken(eurc)} EURC, whatever EUR/USD does.`
  })()

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <div className="mb-8 max-w-2xl">
        <p className="label">Deliverable USDC / EURC forwards on Arc</p>
        <h1 className="display mt-2 text-[2.1rem] font-semibold leading-tight text-balance text-ink md:text-5xl">
          Lock your EUR/USD rate. Settle both currencies at once.
        </h1>
        <p className="mt-3 max-w-xl text-pretty text-muted">
          Agree a rate with an allowlisted dealer today, post USDC margin on both sides, and exchange USDC and EURC in a single
          transaction on the maturity date.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card className="space-y-5 self-start">
          <SectionTitle>Your hedge</SectionTitle>
          <Field label="Your position">
            <Segmented
              label="Position"
              value={side}
              onChange={setSide}
              options={[
                { value: 0, label: 'I will RECEIVE USD', sub: 'Exporter: sell USD, get EURC' },
                { value: 1, label: 'I will PAY USD', sub: 'Importer: pay EURC, get USD' },
              ]}
            />
          </Field>
          <Field label="Amount (USDC notional)" hint={maxNotional !== undefined ? `Cap per trade: ${fmtToken(maxNotional, 2)} USDC` : undefined}>
            <div className="relative">
              <input
                className={inputClass}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="USDC notional"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">USDC</span>
            </div>
          </Field>
          <Field label="Maturity">
            <input type="datetime-local" className={inputClass} value={maturityStr} onChange={(e) => setMaturityStr(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              {chips.map((c) => (
                <button
                  key={c.label}
                  onClick={() => setMaturityStr(toLocalInput(nowSec() + c.secs))}
                  className="min-h-[36px] rounded-lg border border-line px-3 text-xs font-semibold text-ink-2 hover:bg-surface-muted"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Settlement">
            <Segmented
              label="Settlement"
              value={cash ? 'cash' : 'physical'}
              onChange={(v) => setCash(v === 'cash')}
              options={[
                { value: 'physical', label: 'Physical', sub: 'Exchange USDC and EURC' },
                { value: 'cash', label: 'Cash-settled', sub: 'Pay the difference in USDC' },
              ]}
            />
          </Field>
          {problems.map((p) => (
            <p key={p} className="text-sm text-danger" role="alert">
              {p}
            </p>
          ))}
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionTitle
              hint={
                net.feed ? (
                  <a className="text-accent-hover hover:underline" target="_blank" rel="noopener noreferrer" href={addressUrl(net, params.data?.feed ?? net.feed)}>
                    {net.isMainnet ? 'Chainlink EUR/USD' : 'Mock EUR/USD feed'}
                  </a>
                ) : undefined
              }
            >
              Live pricing
            </SectionTitle>
            {q.data && !q.data.ok ? (
              <Notice tone="warn" title={q.data.errorName ?? 'Quote unavailable'}>
                {q.data.message}
              </Notice>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                <Stat label="EUR/USD spot" value={spot.data && spot.data.spot1e18 > 0n ? fmtRate(spot.data.spot1e18) : '–'} sub="from the feed" />
                <Stat label="Fair forward" value={quote ? fmtRate(quote.forwardFair) : '–'} sub="covered interest parity" />
                <Stat
                  label="Allowed band"
                  value={quote ? `${fmtRate(quote.bandLow)}` : '–'}
                  sub={quote ? `to ${fmtRate(quote.bandHigh)}` : undefined}
                />
                <Stat label="Initial margin" value={quote ? `${fmtToken(quote.initialMargin)}` : '–'} sub="USDC, each side" />
              </div>
            )}
            {sentence ? (
              <p className="mt-6 rounded-xl bg-surface-muted px-4 py-3.5 text-pretty text-[15px] font-medium leading-relaxed text-ink">{sentence}</p>
            ) : null}
            {sentence && !cash ? (
              <p className="mt-2 text-xs text-muted">
                Indicative, at the fair forward. The rate in the dealer&apos;s signed quote must sit inside the band and is the final rate.
              </p>
            ) : null}
          </Card>

          {quote && eurc !== undefined && problems.length === 0 ? (
            <Card>
              <SectionTitle hint="EUR/USD at maturity, -10% to +10%">Hedged vs unhedged</SectionTitle>
              <HedgeChart side={side} notionalUsd6={notional} spot={quote.spot} lockedRate={quote.forwardFair} />
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Get a locked rate</SectionTitle>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-ink-2">
              <li>Send your request to the dealer. They sign a quote in their wallet and send you back a link.</li>
              <li>Open the link, deposit margin, and press Lock rate.</li>
            </ol>
            <div className="flex flex-wrap gap-3">
              <CopyButton text={reqLink ?? ''} disabled={!reqLink} label="Copy request for dealer" />
              <Link to={reqPath ?? '/dealer'} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink-2 hover:bg-surface-muted">
                I am the dealer <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <Field label="Already have a signed quote link?">
                <div className="flex gap-2">
                  <input className={inputClass} placeholder="Paste the dealer's link" value={pasted} onChange={(e) => setPasted(e.target.value)} />
                  <Button
                    variant="primary"
                    disabled={!pasted.trim()}
                    onClick={() => navigate(`/quote?q=${encodeURIComponent(extractQuotePayload(pasted))}`)}
                  >
                    Open
                  </Button>
                </div>
              </Field>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
