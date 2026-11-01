import { describe, expect, test } from 'bun:test'
import { computeRail, currentStep, parseRole, quotePathFrom, readRole, writeRole, type RailInput, type TradeInput } from './roles'

const ME = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'
const NOW = 1_800_000_000

const trade = (o: Partial<TradeInput> = {}): TradeInput => ({
  hedger: ME,
  dealer: OTHER,
  side: 0,
  status: 1,
  cashSettled: false,
  maturity: BigInt(NOW + 3600),
  callParty: 0,
  usdLegFunded: false,
  eurLegFunded: false,
  ...o,
})

const rail = (o: Partial<RailInput>) =>
  computeRail({ role: 'business', connected: true, isDealer: false, trades: [], address: ME, freeUsdc: 0n, creditEurc: 0n, now: NOW, ...o })
const statuses = (o: Partial<RailInput>) => rail(o).map((s) => s.status)

describe('business rail', () => {
  test('no trades: step 1 is current, the rest wait', () => {
    expect(statuses({})).toEqual(['current', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting'])
  })
  test('open trade before maturity: 1-3 done, watching is current', () => {
    expect(statuses({ trades: [trade()] })).toEqual(['done', 'done', 'done', 'current', 'waiting', 'waiting'])
  })
  test('margin call on the business is called out in step 4', () => {
    const s = rail({ trades: [trade({ callParty: 1 })] })[3]
    expect(s.status).toBe('current')
    expect(s.detail).toContain('Margin call')
  })
  test('a margin call on the dealer is not a call on me', () => {
    expect(rail({ trades: [trade({ callParty: 2 })] })[3].detail).not.toContain('Margin call')
  })
  test('matured physical trade: fund your leg is current, and names the token', () => {
    const r = rail({ trades: [trade({ maturity: BigInt(NOW - 1) })] })
    expect(r.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done', 'current', 'waiting'])
    expect(r[4].detail).toContain('USDC')
  })
  test('hedger who buys USD funds EURC', () => {
    expect(rail({ trades: [trade({ side: 1, maturity: BigInt(NOW - 1) })] })[4].detail).toContain('EURC')
  })
  test('matured cash trade: settle is ready', () => {
    const r = rail({ trades: [trade({ cashSettled: true, maturity: BigInt(NOW - 1) })] })
    expect(r[4].status).toBe('current')
    expect(r[4].detail).toContain('ready to settle')
  })
  test('both legs funded: ready to settle', () => {
    const r = rail({ trades: [trade({ maturity: BigInt(NOW - 1), usdLegFunded: true, eurLegFunded: true })] })
    expect(r[4].detail).toContain('ready to settle')
  })
  test('my leg funded, waiting for the other', () => {
    const r = rail({ trades: [trade({ maturity: BigInt(NOW - 1), usdLegFunded: true })] })
    expect(r[4].detail).toContain('your leg is funded')
  })
  test('settled with balances to withdraw: withdraw is current', () => {
    expect(statuses({ trades: [trade({ status: 3 })], freeUsdc: 5n })).toEqual(['done', 'done', 'done', 'done', 'done', 'current'])
    expect(statuses({ trades: [trade({ status: 2 })], creditEurc: 5n })[5]).toBe('current')
  })
  test('settled and withdrawn: everything is done', () => {
    expect(statuses({ trades: [trade({ status: 3 })] })).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
  })
  test('free margin alone, with no trade, is not a withdraw step yet', () => {
    expect(rail({ freeUsdc: 5n })[5].status).toBe('waiting')
  })
  test('exactly one current step in every state', () => {
    const states: Partial<RailInput>[] = [
      {},
      { trades: [trade()] },
      { trades: [trade({ maturity: BigInt(NOW - 1) })] },
      { trades: [trade({ status: 3 })], freeUsdc: 1n },
      { trades: [trade(), trade({ maturity: BigInt(NOW - 5) })] },
    ]
    for (const s of states) expect(rail(s).filter((x) => x.status === 'current')).toHaveLength(1)
  })
})

describe('dealer rail', () => {
  const dealerRail = (o: Partial<RailInput>) =>
    computeRail({ role: 'dealer', connected: true, isDealer: true, trades: [], address: ME, freeUsdc: 0n, creditEurc: 0n, now: NOW, ...o })
  const dtrade = (o: Partial<TradeInput> = {}) => trade({ hedger: OTHER, dealer: ME, ...o })

  test('fresh dealer: deposit margin is current', () => {
    expect(dealerRail({}).map((s) => s.status)).toEqual(['current', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting'])
  })
  test('margin deposited: sign a quote is current', () => {
    expect(dealerRail({ freeUsdc: 1n }).map((s) => s.status)).toEqual(['done', 'current', 'waiting', 'waiting', 'waiting', 'waiting'])
  })
  test('a wallet that is not allowlisted cannot sign: blocked with a reason, no current signing step', () => {
    const r = dealerRail({ isDealer: false, freeUsdc: 1n })
    expect(r[1].blocked).toContain('allowlist')
    expect(r[1].status).toBe('waiting')
  })
  test('quotes taken are counted', () => {
    const r = dealerRail({ trades: [dtrade(), dtrade()] })
    expect(r[2].detail).toBe('Quotes taken: 2.')
    expect(r.slice(0, 3).map((s) => s.status)).toEqual(['done', 'done', 'done'])
    expect(r[3].status).toBe('current')
  })
  test('zero quotes taken reads as zero', () => expect(dealerRail({ freeUsdc: 1n })[2].detail).toBe('Quotes taken: 0.'))
  test('dealer on a SELL_USD trade delivers EURC; on BUY_USD delivers USDC', () => {
    expect(dealerRail({ trades: [dtrade({ maturity: BigInt(NOW - 1) })] })[4].detail).toContain('EURC')
    expect(dealerRail({ trades: [dtrade({ side: 1, maturity: BigInt(NOW - 1) })] })[4].detail).toContain('USDC')
  })
  test('margin call on the dealer (party 2) shows in step 4', () => {
    expect(dealerRail({ trades: [dtrade({ callParty: 2 })] })[3].detail).toContain('Margin call')
    expect(dealerRail({ trades: [dtrade({ callParty: 1 })] })[3].detail).not.toContain('Margin call')
  })
  test('settled with funds: withdraw is current', () => {
    expect(currentStep(dealerRail({ trades: [dtrade({ status: 3 })], freeUsdc: 9n }))?.n).toBe(6)
  })
})

describe('role storage', () => {
  const mem = () => {
    const d = new Map<string, string>()
    return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v) }
  }
  test('defaults to business', () => expect(readRole(mem())).toBe('business'))
  test('remembers the choice', () => {
    const s = mem()
    writeRole('dealer', s)
    expect(readRole(s)).toBe('dealer')
    writeRole('business', s)
    expect(readRole(s)).toBe('business')
  })
  test('garbage falls back to business', () => expect(parseRole('admin')).toBe('business'))
  test('broken storage never throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readRole(broken)).toBe('business')
    expect(() => writeRole('dealer', broken)).not.toThrow()
  })
})

describe('quotePathFrom', () => {
  test('accepts a full link or a bare path', () => {
    expect(quotePathFrom('https://app.example/quote?q=abc123')).toBe('/quote?q=abc123')
    expect(quotePathFrom('/quote?q=abc123')).toBe('/quote?q=abc123')
    expect(quotePathFrom('  https://x.io/quote?q=abc&z=1 ')).toBe('/quote?q=abc&z=1')
  })
  test('rejects anything else', () => {
    expect(quotePathFrom('')).toBeUndefined()
    expect(quotePathFrom('https://x.io/trades')).toBeUndefined()
    expect(quotePathFrom('https://x.io/quote')).toBeUndefined()
    expect(quotePathFrom('not a link')).toBeUndefined()
  })
})
