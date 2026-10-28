import { useMemo, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useSignTypedData, useSwitchChain } from 'wagmi'
import { useNet, useWallet } from '@/hooks/network'
import { useBalances, useIsDealer, useParams, useQuoteView } from '@/hooks/data'
import { useShareLink } from '@/hooks/useShareLink'
import { useTx } from '@/hooks/useTx'
import { tenorCalls } from '@/lib/calls'
import { ceilBps, fmtDate, fmtRate, fmtToken, nowSec, parseRate, parseToken, type Side } from '@/lib/math'
import { encodeQuote, quoteTypedData, randomNonce, type QuoteMsg } from '@/lib/quote'
import { useLocation } from '@/lib/router'
import { decodeRevert, isUserRejection } from '@/lib/errors'
import { Badge, Button, Card, CopyButton, Field, Notice, SectionTitle, Segmented, TxStatus, inputClass } from './ui'
import { MarginDeposit } from './MarginDeposit'

const toLocalInput = (ts: number) => {
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Dealer() {
  const { net } = useNet()
  const { params: qs } = useLocation()
  const { address, isConnected } = useWallet()
  const isDealer = useIsDealer(address)
  const params = useParams()
  const bal = useBalances(address)
  const { signTypedDataAsync, isPending: signing } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()
  const cancel = useTx()

  const [side, setSide] = useState<Side>(qs.get('side') === '1' ? 1 : 0)
  const [amount, setAmount] = useState(() => {
    const n = qs.get('n')
    return n && /^\d+$/.test(n) ? fmtToken(BigInt(n)).replace(/,/g, '') : '10'
  })
  const [maturityStr, setMaturityStr] = useState(() => {
    const m = Number(qs.get('m'))
    return toLocalInput(Number.isFinite(m) && m > nowSec() ? m : nowSec() + 30 * 86400)
  })
  const [cash, setCash] = useState(qs.get('cash') === '1')
  const [rateStr, setRateStr] = useState('')
  const [marginBps, setMarginBps] = useState('')
  const [expiryMin, setExpiryMin] = useState('30')
  const [cancelNonceStr, setCancelNonceStr] = useState('')
  const [path, setPath] = useState<string>()
  const [signError, setSignError] = useState<string>()
  const link = useShareLink(path)

  const notional = parseToken(amount) ?? 0n
  const maturity = Math.floor(new Date(maturityStr).getTime() / 1000)
  const tenorQ = BigInt(Math.max(0, Math.round((maturity - nowSec()) / 60) * 60))
  const q = useQuoteView(notional, tenorQ)
  const quote = q.data?.ok ? q.data : undefined
  const rate = parseRate(rateStr) ?? quote?.forwardFair
  const bps = marginBps ? BigInt(marginBps.replace(/\D/g, '') || '0') : (params.data?.initialMarginBps ?? 500n)
  const need = ceilBps(notional, bps)
  const inBand = !!quote && !!rate && rate >= quote.bandLow && rate <= quote.bandHigh
  const minBps = params.data?.initialMarginBps ?? 0n
  const freeOk = !!bal.data && bal.data.freeUsdc >= need

  const issues = useMemo(() => {
    const out: string[] = []
    if (notional <= 0n) out.push('Enter a notional.')
    if (params.data && notional > params.data.maxNotionalUsd6) out.push('Notional is above the per-trade cap.')
    if (!quote) out.push('Waiting for a live quote from the contract.')
    else if (!rate || !inBand) out.push('The rate must sit inside the allowed band, or open() will revert with OffMarketRate.')
    if (bps < minBps || bps > 10_000n) out.push(`Initial margin must be between ${minBps} and 10000 bps.`)
    if (!Number.isFinite(maturity) || BigInt(maturity - nowSec()) < (params.data?.minTenor ?? 0n)) out.push('Maturity is too soon.')
    return out
  }, [notional, quote, rate, inBand, bps, minBps, maturity, params.data])

  const sign = async () => {
    if (!address || !net.tenor || !rate) return
    setSignError(undefined)
    const msg: QuoteMsg = {
      dealer: address,
      side,
      notionalUsd6: notional,
      rate,
      maturity: BigInt(maturity),
      initialMarginBps: bps,
      quoteExpiry: BigInt(nowSec() + Math.max(1, Number(expiryMin) || 30) * 60),
      nonce: randomNonce(),
      cashSettled: cash,
    }
    try {
      await switchChainAsync({ chainId: net.chainId })
      const signature = await signTypedDataAsync(quoteTypedData(net.chainId, net.tenor, msg))
      setPath(`/quote?q=${encodeQuote({ chainId: net.chainId, tenor: net.tenor, quote: msg, signature })}`)
    } catch (e) {
      if (!isUserRejection(e)) setSignError(decodeRevert(e).message)
    }
  }

  if (!isConnected) {
    return (
      <Shell>
        <Card className="text-center">
          <p className="mb-4 text-ink-2">Connect the allowlisted dealer wallet to sign quotes.</p>
          <div className="flex justify-center">
            <ConnectKitButton />
          </div>
        </Card>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card className="space-y-5">
          <SectionTitle hint={isDealer.data ? <Badge tone="good">Allowlisted dealer</Badge> : <Badge tone="bad">Not on the allowlist</Badge>}>
            Sign a quote
          </SectionTitle>
          {isDealer.data === false ? (
            <Notice tone="warn" title="This wallet cannot be a counterparty yet">
              The contract owner must allowlist your address. A signature from a non-allowlisted wallet is rejected with DealerNotAllowed.
            </Notice>
          ) : null}
          <Field label="Hedger's position">
            <Segmented
              label="Hedger position"
              value={side}
              onChange={setSide}
              options={[
                { value: 0, label: 'Hedger RECEIVES USD', sub: 'You take the other side' },
                { value: 1, label: 'Hedger PAYS USD', sub: 'You take the other side' },
              ]}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Notional (USDC)">
              <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Maturity">
              <input type="datetime-local" className={inputClass} value={maturityStr} onChange={(e) => setMaturityStr(e.target.value)} />
            </Field>
            <Field
              label="Rate (USD per EUR, 5 dp)"
              hint={quote ? `Fair ${fmtRate(quote.forwardFair)}. Allowed ${fmtRate(quote.bandLow)} to ${fmtRate(quote.bandHigh)}.` : undefined}
            >
              <input className={inputClass} inputMode="decimal" value={rateStr} placeholder={quote ? fmtRate(quote.forwardFair) : ''} onChange={(e) => setRateStr(e.target.value)} />
            </Field>
            <Field label="Initial margin (bps)" hint={`Minimum ${minBps.toString()} bps. Each side posts ${fmtToken(need)} USDC.`}>
              <input className={inputClass} inputMode="numeric" value={marginBps} placeholder={minBps.toString()} onChange={(e) => setMarginBps(e.target.value)} />
            </Field>
            <Field label="Quote valid for (minutes)">
              <input className={inputClass} inputMode="numeric" value={expiryMin} onChange={(e) => setExpiryMin(e.target.value)} />
            </Field>
            <Field label="Settlement">
              <Segmented
                label="Settlement"
                value={cash ? 'cash' : 'physical'}
                onChange={(v) => setCash(v === 'cash')}
                options={[
                  { value: 'physical', label: 'Physical' },
                  { value: 'cash', label: 'Cash-settled' },
                ]}
              />
            </Field>
          </div>
          {issues.map((i) => (
            <p key={i} className="text-sm text-danger" role="alert">
              {i}
            </p>
          ))}
          {!freeOk && bal.data ? (
            <p className="text-sm text-warn">
              You need {fmtToken(need)} USDC of free margin for open() to succeed. You have {fmtToken(bal.data.freeUsdc)}. Deposit below.
            </p>
          ) : null}
          <Button variant="primary" onClick={sign} loading={signing} disabled={issues.length > 0 || !isDealer.data}>
            Sign quote in wallet
          </Button>
          {signError ? <p className="text-sm text-danger">{signError}</p> : null}
          {link ? (
            <div className="rounded-xl border border-success/30 bg-success/5 p-4">
              <div className="label mb-1 text-success">Signed. Share this link with the hedger</div>
              <p className="mono break-all text-xs text-ink-2">{link}</p>
              <p className="mt-2 text-xs text-muted">
                {fmtToken(notional)} USDC at {rate ? fmtRate(rate) : ''}, maturing {fmtDate(maturity)}. The link holds the quote and your signature,
                nothing secret.
              </p>
              <div className="mt-3">
                <CopyButton text={link} />
              </div>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Dealer margin</SectionTitle>
            <p className="mb-3 text-sm text-muted">The dealer posts the same initial margin as the hedger when a quote is taken.</p>
            <MarginDeposit needed={need} />
          </Card>
          <Card>
            <SectionTitle>Cancel a quote</SectionTitle>
            <Field label="Nonce" hint="Burns the nonce so a quote you signed can no longer be opened.">
              <div className="flex gap-2">
                <input className={inputClass} inputMode="numeric" value={cancelNonceStr} onChange={(e) => setCancelNonceStr(e.target.value)} />
                <Button
                  onClick={() => net.tenor && /^\d+$/.test(cancelNonceStr) && cancel.run('Cancel quote', tenorCalls(net.tenor).cancelNonce(BigInt(cancelNonceStr)))}
                  loading={cancel.busy}
                  disabled={!/^\d+$/.test(cancelNonceStr)}
                >
                  Cancel
                </Button>
              </div>
            </Field>
            <TxStatus state={cancel.state} />
          </Card>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <h1 className="display mb-1 text-3xl font-semibold text-ink">Dealer desk</h1>
      <p className="mb-6 max-w-xl text-muted">Sign an EIP-712 quote with your wallet. The hedger takes it with one transaction. No backend, no custody.</p>
      {children}
    </div>
  )
}
