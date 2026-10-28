import { isAddress, isHex, type Address, type Hex } from 'viem'

/** Signed dealer quote, mirroring Tenor.Quote. `side` is the HEDGER's side: 0 SELL_USD (exporter), 1 BUY_USD (importer). */
export interface QuoteMsg {
  dealer: Address
  side: 0 | 1
  notionalUsd6: bigint
  rate: bigint
  maturity: bigint
  initialMarginBps: bigint
  quoteExpiry: bigint
  nonce: bigint
  cashSettled: boolean
}

export const QUOTE_TYPES = {
  Quote: [
    { name: 'dealer', type: 'address' },
    { name: 'side', type: 'uint8' },
    { name: 'notionalUsd6', type: 'uint256' },
    { name: 'rate', type: 'uint256' },
    { name: 'maturity', type: 'uint256' },
    { name: 'initialMarginBps', type: 'uint256' },
    { name: 'quoteExpiry', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'cashSettled', type: 'bool' },
  ],
} as const

export function quoteDomain(chainId: number, verifyingContract: Address) {
  return { name: 'Tenor', version: '1', chainId, verifyingContract } as const
}

export function quoteTypedData(chainId: number, tenor: Address, message: QuoteMsg) {
  return {
    domain: quoteDomain(chainId, tenor),
    types: QUOTE_TYPES,
    primaryType: 'Quote' as const,
    message,
  }
}

/** Struct form for contract calls. */
export function quoteTuple(q: QuoteMsg) {
  return {
    dealer: q.dealer,
    side: q.side,
    notionalUsd6: q.notionalUsd6,
    rate: q.rate,
    maturity: q.maturity,
    initialMarginBps: q.initialMarginBps,
    quoteExpiry: q.quoteExpiry,
    nonce: q.nonce,
    cashSettled: q.cashSettled,
  }
}

export interface QuoteLink {
  chainId: number
  tenor: Address
  quote: QuoteMsg
  signature: Hex
}

const toB64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromB64Url = (s: string) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return new TextDecoder().decode(Uint8Array.from(atob(pad), (c) => c.charCodeAt(0)))
}

/** Compact payload for the share link query (`?q=`): quote fields plus signature. No secret is inside. */
export function encodeQuote(link: QuoteLink): string {
  const q = link.quote
  return toB64Url(
    JSON.stringify([
      1,
      link.chainId,
      link.tenor,
      q.dealer,
      q.side,
      q.notionalUsd6.toString(),
      q.rate.toString(),
      q.maturity.toString(),
      q.initialMarginBps.toString(),
      q.quoteExpiry.toString(),
      q.nonce.toString(),
      q.cashSettled ? 1 : 0,
      link.signature,
    ]),
  )
}

export function decodeQuote(payload: string): QuoteLink | undefined {
  try {
    const a = JSON.parse(fromB64Url(payload.trim())) as unknown[]
    if (!Array.isArray(a) || a[0] !== 1 || a.length !== 13) return undefined
    const [, chainId, tenor, dealer, side, notional, rate, maturity, imBps, expiry, nonce, cash, sig] = a
    if (typeof tenor !== 'string' || !isAddress(tenor)) return undefined
    if (typeof dealer !== 'string' || !isAddress(dealer)) return undefined
    if (typeof sig !== 'string' || !isHex(sig) || sig.length !== 132) return undefined
    if (side !== 0 && side !== 1) return undefined
    if (typeof chainId !== 'number') return undefined
    return {
      chainId,
      tenor,
      signature: sig,
      quote: {
        dealer,
        side,
        notionalUsd6: BigInt(String(notional)),
        rate: BigInt(String(rate)),
        maturity: BigInt(String(maturity)),
        initialMarginBps: BigInt(String(imBps)),
        quoteExpiry: BigInt(String(expiry)),
        nonce: BigInt(String(nonce)),
        cashSettled: cash === 1,
      },
    }
  } catch {
    return undefined
  }
}

/** Accepts a full pasted link or a bare payload. */
export function extractQuotePayload(input: string): string {
  const t = input.trim()
  try {
    const u = new URL(t)
    return u.searchParams.get('q') ?? t
  } catch {
    return t
  }
}

export function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint32Array(2))
  return (BigInt(b[0]) << 20n) ^ BigInt(b[1])
}
