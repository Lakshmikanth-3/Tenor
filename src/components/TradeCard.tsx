import { useState } from 'react'
import type { Address } from 'viem'
import { useNet } from '@/hooks/network'
import { useBalances, type Params, type TradeRow } from '@/hooks/data'
import type { TenorLog } from '@/hooks/activity'
import { useNow } from '@/hooks/useNow'
import { useTx } from '@/hooks/useTx'
import { approveCall, tenorCalls } from '@/lib/calls'
import { ceilBps, eurcFor, fmtDate, fmtDateTime, fmtDuration, fmtRate, fmtToken, hedgerMtm, parseToken, type Side } from '@/lib/math'
import { Badge, Button, Card, Stat, TxLink, TxStatus, inputClass } from './ui'

const STATUS = ['None', 'Open', 'Delivered', 'Cash settled', 'Delivery failed', 'Closed out'] as const

export function TradeCard({ row, me, params, logs }: { row: TradeRow; me: Address; params: Params; logs: TenorLog[] }) {
  const { net } = useNet()
  const now = useNow()
  const t = row.trade
  const bal = useBalances(me)
  const { state, run, busy } = useTx()
  const [topUpAmt, setTopUpAmt] = useState('')
  const tenor = net.tenor as Address

  const isHedger = t.hedger.toLowerCase() === me.toLowerCase()
  const mySide: Side = isHedger ? (t.side as Side) : t.side === 0 ? 1 : 0
  const open = t.status === 1
  const matured = now >= Number(t.maturity)
  const myMargin = isHedger ? t.hedgerMargin : t.dealerMargin
  const theirMargin = isHedger ? t.dealerMargin : t.hedgerMargin
  const maintenance = ceilBps(t.notionalUsd6, t.maintenanceBps)
  const initial = t.initialMarginUsd6

  const mtmH = row.forwardNow !== undefined ? hedgerMtm(t.side as Side, t.notionalUsd6, t.rate, row.forwardNow) : undefined
  const myMtm = mtmH === undefined ? undefined : isHedger ? mtmH : -mtmH
  const myVm = isHedger ? t.lastMtmHedger : -t.lastMtmHedger

  const callOpen = open && t.callParty !== 0
  const iAmCalled = callOpen && (t.callParty === 1) === isHedger
  const deadline = Number(t.callDeadline)
  const canClose = callOpen && now > deadline
  const canMark = open && now >= Number(t.lastMarkAt) + Number(params.markInterval)

  const sellsUsd = (isHedger && t.side === 0) || (!isHedger && t.side === 1)
  const myLegFunded = sellsUsd ? t.usdLegFunded : t.eurLegFunded
  const legToken = sellsUsd ? net.usdc : (net.eurc as Address)
  const legAmount = sellsUsd ? t.notionalUsd6 : t.eurAmount6
  const canFund = open && !t.cashSettled && matured && !myLegFunded
  const legSymbol = sellsUsd ? 'USDC' : 'EURC'
  const approved = !!bal.data && (sellsUsd ? bal.data.allowUsdc : bal.data.allowEurc) >= legAmount
  const showApprove = open && !t.cashSettled && !myLegFunded && !!bal.data && !approved

  const barMax = (initial > myMargin ? initial : myMargin) * 2n || 1n
  const pct = (v: bigint) => Math.min(100, Number((v * 10000n) / barMax) / 100)
  const tone = myMargin < maintenance ? 'bg-danger' : myMargin < initial ? 'bg-warn' : 'bg-success'

  const approveLeg = () => run(`Allow ${legSymbol} for delivery`, approveCall(legToken, tenor, legAmount))

  const fundLeg = async () => {
    if (!bal.data) return
    if (!approved && !(await approveLeg())) return
    await run('Fund leg', tenorCalls(tenor).fundLeg(row.id))
  }

  const topUp = async () => {
    const amt = parseToken(topUpAmt)
    if (!amt || !bal.data) return
    if (bal.data.freeUsdc < amt) {
      const need = amt - bal.data.freeUsdc
      if (bal.data.allowUsdc < need) {
        const ok = await run('Allow USDC', approveCall(net.usdc, tenor, need))
        if (!ok) return
      }
      const ok = await run('Deposit margin', tenorCalls(tenor).depositMargin(need))
      if (!ok) return
    }
    await run('Top up', tenorCalls(tenor).topUp(row.id, amt))
  }

  const withdraw = async () => {
    if (!bal.data) return
    if (bal.data.freeUsdc > 0n && !(await run('Withdraw USDC', tenorCalls(tenor).withdraw()))) return
    if (bal.data.creditEurc > 0n) await run('Withdraw EURC', tenorCalls(tenor).withdrawEurc())
  }

  const mine = logs.filter((l) => (l.args as { tradeId?: bigint }).tradeId === row.id)
  const canWithdraw = !open && bal.data && (bal.data.freeUsdc > 0n || bal.data.creditEurc > 0n)

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="display text-lg font-semibold">Trade #{row.id.toString()}</h3>
            <Badge tone={open ? 'info' : t.status === 5 ? 'bad' : 'good'}>{STATUS[t.status]}</Badge>
            <Badge>{isHedger ? 'You are the hedger' : 'You are the dealer'}</Badge>
            <Badge>{t.cashSettled ? 'Cash-settled' : 'Physical'}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {mySide === 0 ? 'Receive USD' : 'Pay USD'}: {fmtToken(t.notionalUsd6)} USDC against {fmtToken(eurcFor(t.notionalUsd6, t.rate))} EURC at {fmtRate(t.rate)}
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="label">Maturity</div>
          <div className="num font-semibold">{fmtDate(t.maturity)}</div>
          <div className="num text-xs text-muted">{matured ? 'Matured' : `in ${fmtDuration(Number(t.maturity) - now)}`}</div>
        </div>
      </div>

      {open ? (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat
            label="Mark-to-market"
            value={myMtm === undefined ? '–' : `${myMtm >= 0n ? '+' : ''}${fmtToken(myMtm)}`}
            sub={myMtm === undefined ? row.forwardError : 'USDC, live'}
            tone={myMtm === undefined ? undefined : myMtm > 0n ? 'good' : myMtm < 0n ? 'bad' : undefined}
          />
          <Stat label="Variation moved" value={`${myVm >= 0n ? '+' : ''}${fmtToken(myVm)}`} sub="USDC, at last mark" />
          <Stat label="Your margin" value={fmtToken(myMargin)} sub="USDC posted" />
          <Stat label="Their margin" value={fmtToken(theirMargin)} sub="USDC posted" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
          <Stat label="Final variation" value={`${myVm >= 0n ? '+' : ''}${fmtToken(myVm)}`} sub="USDC at last mark" />
          <Stat label="Shortfall recorded" value={fmtToken(isHedger ? t.hedgerShortfall : t.dealerShortfall)} sub="USDC owed to the other side" />
        </div>
      )}

      {open ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="label">Margin health</span>
            <span className="num text-muted">
              Maintenance {fmtToken(maintenance)} · Initial {fmtToken(initial)}
            </span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-valuemin={0} aria-valuemax={Number(barMax)} aria-valuenow={Number(myMargin)} aria-label="Posted margin against maintenance">
            <div className={`h-full ${tone}`} style={{ width: `${pct(myMargin)}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${pct(maintenance)}%` }} title="Maintenance" />
            <div className="absolute inset-y-0 w-0.5 bg-ink/50" style={{ left: `${pct(initial)}%` }} title="Initial" />
          </div>
          {callOpen ? (
            <p className={`mt-2 text-sm ${iAmCalled ? 'font-semibold text-danger' : 'text-warn'}`} role="alert">
              {iAmCalled ? 'Margin call on you.' : 'Margin call on the counterparty.'}{' '}
              {now <= deadline ? `Cure within ${fmtDuration(deadline - now)}.` : 'The cure window has ended. Anyone can close the trade out.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {open && !t.cashSettled ? (
        <p className="text-sm text-muted">
          Delivery: USDC leg {t.usdLegFunded ? 'funded' : 'not funded'}, EURC leg {t.eurLegFunded ? 'funded' : 'not funded'}.
          {matured && !(t.usdLegFunded && t.eurLegFunded) ? ` Missing legs fail ${fmtDuration(Math.max(0, Number(t.maturity) + Number(t.deliveryGrace) - now))} after maturity grace starts.` : ''}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        {open ? (
          <Button onClick={() => run('Mark', tenorCalls(tenor).mark(row.id))} disabled={!canMark || busy}>
            {canMark ? 'Mark' : `Mark in ${fmtDuration(Number(t.lastMarkAt) + Number(params.markInterval) - now)}`}
          </Button>
        ) : null}
        {showApprove ? (
          <Button onClick={approveLeg} loading={busy}>
            Approve {legSymbol} for delivery
          </Button>
        ) : null}
        {open && !t.cashSettled && !myLegFunded && approved && !matured ? <Badge tone="good">{legSymbol} approved for delivery</Badge> : null}
        {canFund ? (
          <Button variant="primary" onClick={fundLeg} loading={busy}>
            Fund {legSymbol} leg ({fmtToken(legAmount)}){approved ? '' : ' · approve first'}
          </Button>
        ) : null}
        {open && matured ? (
          <Button variant={t.cashSettled ? 'primary' : 'secondary'} onClick={() => run('Settle', tenorCalls(tenor).settle(row.id))} disabled={busy}>
            Settle
          </Button>
        ) : null}
        {canClose ? (
          <Button variant="danger" onClick={() => run('Close out', tenorCalls(tenor).closeOut(row.id))} disabled={busy}>
            Close out
          </Button>
        ) : null}
        {canWithdraw ? (
          <Button variant="primary" onClick={withdraw} loading={busy}>
            Withdraw
          </Button>
        ) : null}
        {open ? (
          <div className="ml-auto flex items-end gap-2">
            <input
              className={`${inputClass} !w-32`}
              inputMode="decimal"
              aria-label="Top up amount in USDC"
              placeholder="Top up USDC"
              value={topUpAmt}
              onChange={(e) => setTopUpAmt(e.target.value)}
            />
            <Button onClick={topUp} disabled={busy || !parseToken(topUpAmt)}>
              Top up
            </Button>
          </div>
        ) : null}
      </div>
      <TxStatus state={state} />

      {mine.length > 0 ? (
        <details className="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink-2">Activity ({mine.length})</summary>
          <ul className="mt-3 space-y-2">
            {[...mine].reverse().map((l) => (
              <li key={`${l.transactionHash}-${l.logIndex}`} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{l.eventName}</span>
                <span className="num text-xs text-muted">{detail(l)}</span>
                <TxLink hash={l.transactionHash} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="sr-only">{fmtDateTime(t.openedAt)}</div>
    </Card>
  )
}

function detail(l: TenorLog): string {
  const a = l.args as Record<string, unknown>
  if (l.eventName === 'Marked') return `fwd ${fmtRate(a.forwardNow as bigint)} · VM ${fmtToken(a.vmMoved as bigint)}`
  if (l.eventName === 'MarginCalled') return `deadline ${fmtDateTime(a.deadline as bigint)}`
  if (l.eventName === 'LegFunded') return `${fmtToken(a.amount as bigint)}`
  if (l.eventName === 'CashSettled') return `MTM ${fmtToken(a.finalMtm as bigint)}`
  if (l.eventName === 'TradeOpened') return `${fmtToken(a.notionalUsd6 as bigint)} @ ${fmtRate(a.rate as bigint)}`
  return ''
}
