import { formatUnitsFixed, parseUnitsExact } from '@/onchain-money'

/** All token amounts in Tenor are 6 decimals (USDC and EURC). Rates are 1e18 fixed point, shown at 5 dp. */
export const TOKEN_DP = 6
export const RATE_DP = 5
export const E18 = 10n ** 18n
export const YEAR = 31_536_000n

export type Side = 0 | 1 // 0 = SELL_USD (exporter), 1 = BUY_USD (importer)

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Token amount (6 dp) formatted to 6 dp with thousands separators. */
export function fmtToken(raw: bigint, dp = TOKEN_DP): string {
  const neg = raw < 0n
  const s = formatUnitsFixed(neg ? -raw : raw, TOKEN_DP, dp)
  const [i, f] = s.split('.')
  return `${neg ? '-' : ''}${group(i)}${f ? `.${f}` : ''}`
}

/** Rate (1e18) to 5 dp, rounded half up. */
export function fmtRate(rate: bigint): string {
  const unit = 10n ** BigInt(18 - RATE_DP)
  const r = (rate + unit / 2n) / unit
  const s = r.toString().padStart(RATE_DP + 1, '0')
  return `${s.slice(0, -RATE_DP)}.${s.slice(-RATE_DP)}`
}

/** Parse a decimal string with up to 5 dp into a 1e18 rate. */
export function parseRate(value: string): bigint | undefined {
  try {
    const raw = parseUnitsExact(value.trim(), RATE_DP)
    return raw * 10n ** BigInt(18 - RATE_DP)
  } catch {
    return undefined
  }
}

/** Parse a 6 dp token amount. */
export function parseToken(value: string): bigint | undefined {
  try {
    return parseUnitsExact(value.trim(), TOKEN_DP)
  } catch {
    return undefined
  }
}

/** EURC delivered/received for a USDC notional at an agreed rate (floor, as fixed at open). */
export function eurcFor(notionalUsd6: bigint, rate: bigint): bigint {
  return (notionalUsd6 * E18) / rate
}

/** Hedger mark-to-market in USDC (6 dp): N*(forwardNow-rate)/rate for SELL_USD, negated for BUY_USD. */
export function hedgerMtm(side: Side, notionalUsd6: bigint, rate: bigint, forwardNow: bigint): bigint {
  const diff = forwardNow >= rate ? forwardNow - rate : rate - forwardNow
  const mag = (notionalUsd6 * diff) / rate
  const positive = forwardNow >= rate
  const sellUsd = side === 0
  return positive === sellUsd ? mag : -mag
}

export function ceilBps(amount: bigint, bps: bigint): bigint {
  return (amount * bps + 9_999n) / 10_000n
}

export function fmtDate(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function fmtDuration(seconds: number): string {
  if (seconds <= 0) return '0s'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export const nowSec = () => Math.floor(Date.now() / 1000)

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}
