import { E18, fmtToken, type Side } from '@/lib/math'

interface Props {
  side: Side
  notionalUsd6: bigint
  spot: bigint
  lockedRate: bigint
}

const W = 520
const H = 230
const PAD = { l: 58, r: 16, t: 16, b: 34 }

/** EURC exchanged for the USDC notional: locked (flat) vs unhedged (spot at maturity), for EUR/USD -10%..+10%. */
export function HedgeChart({ side, notionalUsd6, spot, lockedRate }: Props) {
  const steps = Array.from({ length: 21 }, (_, i) => i - 10) // -10..+10 percent
  const eurAt = (rate: bigint) => Number((notionalUsd6 * E18) / rate) / 1e6
  const locked = eurAt(lockedRate)
  const unhedged = steps.map((p) => {
    const s = (spot * BigInt(100 + p)) / 100n
    return { p, eur: eurAt(s) }
  })
  const all = [locked, ...unhedged.map((u) => u.eur)]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const span = hi - lo || 1
  const y0 = lo - span * 0.1
  const y1 = hi + span * 0.1
  const x = (p: number) => PAD.l + ((p + 10) / 20) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b)
  const path = unhedged.map((u, i) => `${i === 0 ? 'M' : 'L'}${x(u.p).toFixed(1)},${y(u.eur).toFixed(1)}`).join(' ')
  const ticks = [y0 + (y1 - y0) * 0.1, (y0 + y1) / 2, y1 - (y1 - y0) * 0.1]
  const importer = side === 1
  // Positive = hedging saved you EURC compared with staying unhedged.
  const saving = (p: number) => {
    const unh = unhedged.find((u) => u.p === p)?.eur ?? locked
    return importer ? unh - locked : locked - unh
  }
  const verdict = (p: number) => {
    const v = saving(p)
    const amt = `${Math.abs(v).toFixed(2)} EURC`
    if (Math.abs(v) < 0.005) return 'hedging makes no difference'
    return v > 0 ? `hedging saves you ${amt}` : `hedging costs you ${amt} compared with staying unhedged`
  }
  const axisTitle = importer
    ? `EURC you pay to receive ${fmtToken(notionalUsd6, 2)} USDC`
    : `EURC you receive for ${fmtToken(notionalUsd6, 2)} USDC`

  return (
    <figure>
      <div className="label mb-1">{axisTitle}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${axisTitle}, hedged versus unhedged, EUR/USD from minus 10 to plus 10 percent`} className="w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(18,45,69,0.08)" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="num" fontSize="10.5" fill="#6b7280">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {[-10, -5, 0, 5, 10].map((p) => (
          <g key={p}>
            <line x1={x(p)} x2={x(p)} y1={PAD.t} y2={H - PAD.b} stroke={p === 0 ? 'rgba(18,45,69,0.25)' : 'rgba(18,45,69,0.06)'} strokeDasharray={p === 0 ? '3 3' : undefined} />
            <text x={x(p)} y={H - 12} textAnchor="middle" fontSize="10.5" fill="#6b7280" className="num">
              {p > 0 ? `+${p}%` : `${p}%`}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#8a93a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(locked)} y2={y(locked)} stroke="#122d45" strokeWidth="2.5" />
        <circle cx={x(0)} cy={y(locked)} r="4" fill="#122d45" />
      </svg>
      <figcaption className="mt-2 space-y-2 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 bg-accent" /> Hedged: you {importer ? 'pay' : 'receive'} {locked.toFixed(2)} EURC, whatever EUR/USD does
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 bg-subtle" /> Unhedged: EURC {importer ? 'paid' : 'received'} at the spot rate on maturity
          </span>
        </div>
        <ul className="num space-y-0.5 text-[13px] text-ink-2">
          <li>
            If EUR/USD rises 10%: {verdict(10)}.
          </li>
          <li>
            If EUR/USD falls 10%: {verdict(-10)}.
          </li>
        </ul>
      </figcaption>
    </figure>
  )
}
