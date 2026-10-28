import { BaseError, decodeErrorResult, isHex, type Hex } from 'viem'
import { tenorAbi } from './tenorAbi'

/** One-line plain-English meaning for each custom error the Tenor contract can raise. */
export const ERROR_COPY: Record<string, string> = {
  StalePrice: 'The EUR/USD price is older than the allowed staleness window, so the contract will not use it.',
  BadPrice: 'The price feed returned a non-positive or invalid answer, so the contract refuses to trade on it.',
  OffMarketRate: 'The quoted rate is outside the allowed band around the fair forward for this tenor.',
  QuoteExpired: 'The dealer quote has passed its expiry time.',
  NonceUsed: 'This quote (its nonce) was already used or cancelled, so it cannot be replayed.',
  BadSignature: 'The signature does not match the dealer named in the quote.',
  DealerNotAllowed: 'The signer is not on the dealer allowlist.',
  TenorTooShort: 'Maturity is sooner than the minimum tenor.',
  TenorTooLong: 'Maturity is further out than the maximum tenor.',
  NotionalTooLarge: 'The notional is above the per-trade cap.',
  InsufficientMargin: 'Not enough free margin (or the margin level is below the minimum).',
  MarkTooSoon: 'This trade was marked too recently. Wait for the mark interval.',
  MarginLocked: 'A margin call is open on this trade, so margin cannot be withdrawn.',
  NoMarginCall: 'There is no open margin call on this trade.',
  CureWindowOpen: 'The margin call can still be cured. Close-out is only possible after the deadline.',
  NotMatured: 'The trade has not reached its maturity date yet.',
  AlreadySettled: 'This trade is already settled.',
  LegAlreadyFunded: 'This leg has already been funded.',
  LegUnfunded: 'A delivery leg is still missing and the grace period has not ended.',
  NotParty: 'Only the hedger or the dealer of this trade can do this.',
  TradeClosed: 'This trade was closed out after a margin default.',
  ZeroAddress: 'A required address was zero.',
  ZeroAmount: 'The amount must be greater than zero.',
  SelfTrade: 'The hedger and the dealer cannot be the same wallet.',
  ParamOutOfBounds: 'That setting is outside the allowed bounds.',
  NotPhysical: 'This trade is cash-settled, so there are no delivery legs to fund.',
  TradeNotFound: 'No trade exists with that id.',
}

export interface DecodedError {
  name?: string
  message: string
}

function findRevertData(e: unknown): Hex | undefined {
  if (e instanceof BaseError) {
    let found: Hex | undefined
    e.walk((err) => {
      const d = (err as { data?: unknown }).data
      if (typeof d === 'string' && isHex(d) && d.length >= 10 && !found) found = d
      return false
    })
    return found
  }
  return undefined
}

/** Decode a thrown viem error into a Tenor custom error name when possible. */
export function decodeRevert(e: unknown): DecodedError {
  const data = findRevertData(e)
  if (data) {
    try {
      const r = decodeErrorResult({ abi: tenorAbi, data })
      return { name: r.errorName, message: ERROR_COPY[r.errorName] ?? r.errorName }
    } catch {
      // not a Tenor error, fall through
    }
  }
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('denied transaction')) return { message: 'Cancelled in wallet.' }
  if (lower.includes('insufficient funds')) return { message: 'Not enough USDC in the wallet to pay gas.' }
  if (e instanceof BaseError) return { message: e.shortMessage }
  return { message: msg.slice(0, 200) }
}

/** Decode raw revert bytes (from eth_call). */
export function decodeRevertData(data: Hex): DecodedError {
  try {
    const r = decodeErrorResult({ abi: tenorAbi, data })
    return { name: r.errorName, message: ERROR_COPY[r.errorName] ?? r.errorName }
  } catch {
    return { message: `Unrecognised revert ${data.slice(0, 10)}` }
  }
}

export function isUserRejection(e: unknown): boolean {
  const msg = e instanceof Error ? e.message.toLowerCase() : ''
  return msg.includes('user rejected') || msg.includes('denied transaction')
}
