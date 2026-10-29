import { useState } from 'react'
import { useNet, useWallet } from '@/hooks/network'
import { useParams, type Params } from '@/hooks/data'
import { useTx } from '@/hooks/useTx'
import { tenorCalls } from '@/lib/calls'
import { fmtDuration } from '@/lib/math'
import { AddressLink, Badge, Button, Card, Field, Notice, SectionTitle, TxStatus, inputClass } from './ui'

const DAY = 86_400n

interface Spec {
  key: 'deliveryGrace' | 'cureWindow' | 'markInterval' | 'minTenor'
  label: string
  hint: string
  min: bigint
  max: bigint
}

/** Bounds mirror Tenor.setRiskParams. */
const SPECS: Spec[] = [
  { key: 'deliveryGrace', label: 'Delivery grace (seconds)', hint: 'Time after maturity to fund both legs before delivery fails.', min: 30n, max: 7n * DAY },
  { key: 'cureWindow', label: 'Cure window (seconds)', hint: 'Time to top up after a margin call before close-out.', min: 30n, max: 7n * DAY },
  { key: 'markInterval', label: 'Mark interval (seconds)', hint: 'Minimum time between marks of the same trade.', min: 10n, max: DAY },
  { key: 'minTenor', label: 'Minimum tenor (seconds)', hint: 'Shortest allowed time from open to maturity.', min: 60n, max: 365n * DAY },
]

const parse = (v: string): bigint | undefined => (/^\d+$/.test(v.trim()) ? BigInt(v.trim()) : undefined)

export function RiskPanel() {
  const { net } = useNet()
  const { address } = useWallet()
  const params = useParams()
  const { state, run, busy } = useTx()
  const [edits, setEdits] = useState<Partial<Record<Spec['key'], string>>>({})

  const p = params.data
  if (!p || !net.tenor) return null
  const isOwner = !!address && address.toLowerCase() === p.owner.toLowerCase()

  const valueOf = (s: Spec): string => edits[s.key] ?? p[s.key].toString()
  const errors = SPECS.map((s) => {
    const v = parse(valueOf(s))
    if (v === undefined) return 'Whole seconds only.'
    if (v < s.min || v > s.max) return `Must be between ${s.min} and ${s.max} seconds (${fmtDuration(Number(s.min))} to ${fmtDuration(Number(s.max))}).`
    return undefined
  })
  const changed = SPECS.some((s) => parse(valueOf(s)) !== p[s.key])
  const valid = errors.every((e) => !e)

  const submit = () => {
    const next = { ...pick(p) }
    for (const s of SPECS) next[s.key] = parse(valueOf(s)) ?? p[s.key]
    void run('Update risk parameters', tenorCalls(net.tenor as NonNullable<typeof net.tenor>).setRiskParams(next))
  }

  return (
    <Card className="mt-6 space-y-5">
      <SectionTitle hint={isOwner ? <Badge tone="good">You own Tenor</Badge> : <Badge tone="warn">Owner only</Badge>}>Risk parameters</SectionTitle>
      {!isOwner ? (
        <Notice tone="warn" title="Only the Tenor owner can change these">
          Connect the owner wallet (<AddressLink address={p.owner} />). Values below are read live from the contract.
        </Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {SPECS.map((s, i) => {
          const v = parse(valueOf(s))
          return (
            <Field key={s.key} label={s.label} hint={errors[i] ?? `${s.hint} Now ${fmtDuration(Number(p[s.key]))}${v !== undefined && v !== p[s.key] ? `, new ${fmtDuration(Number(v))}` : ''}.`}>
              <input
                className={`${inputClass} ${errors[i] ? '!border-danger' : ''}`}
                inputMode="numeric"
                value={valueOf(s)}
                disabled={!isOwner}
                aria-invalid={!!errors[i]}
                onChange={(e) => setEdits((x) => ({ ...x, [s.key]: e.target.value }))}
              />
            </Field>
          )
        })}
      </div>
      <p className="text-xs text-muted">
        Cure window and delivery grace are fixed into each trade when it opens, so changes affect new trades only. Mark interval and minimum tenor apply
        immediately. Margin levels, band, notional cap and staleness stay as they are.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} disabled={!isOwner || !changed || !valid} onClick={submit}>
          Update parameters
        </Button>
        <Button
          disabled={!changed || busy}
          onClick={() => setEdits({})}
        >
          Reset
        </Button>
      </div>
      <TxStatus state={state} />
    </Card>
  )
}

function pick(p: Params) {
  return {
    initialMarginBps: p.initialMarginBps,
    maintenanceBps: p.maintenanceBps,
    bandBps: p.bandBps,
    markInterval: p.markInterval,
    cureWindow: p.cureWindow,
    deliveryGrace: p.deliveryGrace,
    minTenor: p.minTenor,
    maxNotionalUsd6: p.maxNotionalUsd6,
    maxStaleness: p.maxStaleness,
  }
}
