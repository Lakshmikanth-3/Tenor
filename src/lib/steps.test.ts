import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { approveCall, tenorCalls } from './calls'
import type { QuoteMsg } from './quote'
import {
  defaultMaturity,
  marginShortfall,
  maturityWarning,
  planDeposit,
  planFundLeg,
  planLockRate,
  planTopUp,
  planWithdrawAll,
  popupCount,
  reusableApproval,
  settleIsNext,
  supportsAtomic,
} from './steps'

const TENOR = '0xfa9d0a455959c5fa6e57b4e3fdee9b062bacc3ee' as Address
const USDC = '0x3600000000000000000000000000000000000000' as Address
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as Address
const CAP = 50_000_000n // 50 USDC per-trade cap
const SIG = `0x${'11'.repeat(65)}` as const

const quote: QuoteMsg = {
  dealer: '0x43DDBD19381C8Ea8C1e4670d18DdB97c43fbEFDC',
  side: 0,
  notionalUsd6: 10_000_000n,
  rate: 1_100_000_000_000_000_000n,
  maturity: 1_800_000_000n,
  initialMarginBps: 500n,
  quoteExpiry: 1_790_000_000n,
  nonce: 7n,
  cashSettled: false,
}
const MARGIN = 500_000n // 5% of 10 USDC

const base = { tenor: TENOR, usdc: USDC, cap: CAP }
const kinds = (p: { steps: { kind: string }[] }) => p.steps.map((s) => s.kind)

describe('reusableApproval', () => {
  test('five times the cap when the wallet holds more', () => {
    expect(reusableApproval({ needed: 500_000n, walletBalance: 1_000_000_000n, cap: CAP })).toBe(250_000_000n)
  })
  test('the wallet balance when that is lower than five times the cap', () => {
    expect(reusableApproval({ needed: 500_000n, walletBalance: 90_000_000n, cap: CAP })).toBe(90_000_000n)
  })
  test('never below what is needed right now', () => {
    expect(reusableApproval({ needed: 300_000_000n, walletBalance: 300_000_000n, cap: CAP })).toBe(300_000_000n)
  })
})

describe('planDeposit', () => {
  test('allowance already high enough: deposit only', () => {
    const p = planDeposit({ ...base, amount: 400_000n, allowance: 400_000n, walletBalance: 5_000_000n })
    expect(kinds(p)).toEqual(['deposit'])
  })
  test('allowance too low: approve then deposit, approve is reusable not exact', () => {
    const p = planDeposit({ ...base, amount: 400_000n, allowance: 399_999n, walletBalance: 5_000_000n })
    expect(kinds(p)).toEqual(['approve', 'deposit'])
    expect(p.steps[0].call).toEqual(approveCall(USDC, TENOR, 5_000_000n))
    expect(p.steps[0].note).toContain("One-time permission. You won't be asked again until it runs out.")
  })
  test('zero allowance with a big wallet approves five times the cap', () => {
    const p = planDeposit({ ...base, amount: 400_000n, allowance: 0n, walletBalance: 10_000_000_000n })
    expect(p.steps[0].call).toEqual(approveCall(USDC, TENOR, 250_000_000n))
  })
  test('wallet too small: blocker and no steps, so no popup opens', () => {
    const p = planDeposit({ ...base, amount: 400_000n, allowance: 0n, walletBalance: 100_000n })
    expect(p.steps).toEqual([])
    expect(p.blocker?.code).toBe('InsufficientWallet')
    expect(p.blocker?.shortBy).toBe(300_000n)
  })
  test('nothing to deposit: empty plan', () => {
    expect(planDeposit({ ...base, amount: 0n, allowance: 0n, walletBalance: 0n }).steps).toEqual([])
  })
})

describe('planLockRate: which steps run for each combination', () => {
  const lock = (o: { free: bigint; allowance: bigint; wallet: bigint }) =>
    planLockRate({ ...base, quote, signature: SIG, margin: MARGIN, freeMargin: o.free, allowance: o.allowance, walletBalance: o.wallet })

  test('enough free margin: open only, whatever the allowance', () => {
    expect(kinds(lock({ free: MARGIN, allowance: 0n, wallet: 0n }))).toEqual(['open'])
    expect(kinds(lock({ free: 9_000_000n, allowance: 0n, wallet: 10_000_000n }))).toEqual(['open'])
  })
  test('shortfall with enough allowance: deposit, open', () => {
    expect(kinds(lock({ free: 0n, allowance: MARGIN, wallet: 2_000_000n }))).toEqual(['deposit', 'open'])
  })
  test('shortfall without allowance: approve, deposit, open', () => {
    expect(kinds(lock({ free: 0n, allowance: 0n, wallet: 2_000_000n }))).toEqual(['approve', 'deposit', 'open'])
  })
  test('only the shortfall is deposited', () => {
    const p = lock({ free: 200_000n, allowance: MARGIN, wallet: 2_000_000n })
    expect(marginShortfall(MARGIN, 200_000n)).toBe(300_000n)
    expect(p.steps[0].call).toEqual(tenorCalls(TENOR).depositMargin(300_000n))
  })
  test('the open call carries the signed quote', () => {
    const p = lock({ free: MARGIN, allowance: 0n, wallet: 0n })
    expect(p.steps[0].call).toEqual(tenorCalls(TENOR).open(quote, SIG))
  })
  test('wallet cannot cover the shortfall: blocked, nothing sent', () => {
    const p = lock({ free: 0n, allowance: 0n, wallet: 100_000n })
    expect(p.steps).toEqual([])
    expect(p.blocker?.shortBy).toBe(400_000n)
  })
})

describe('planTopUp', () => {
  const top = (free: bigint, allowance: bigint) =>
    planTopUp({ ...base, tradeId: 3n, amount: 1_000_000n, freeMargin: free, allowance, walletBalance: 5_000_000n })
  test('free margin covers it: top up only', () => expect(kinds(top(1_000_000n, 0n))).toEqual(['topUp']))
  test('shortfall and allowance: deposit, top up', () => expect(kinds(top(0n, 1_000_000n))).toEqual(['deposit', 'topUp']))
  test('shortfall and no allowance: approve, deposit, top up', () => expect(kinds(top(0n, 0n))).toEqual(['approve', 'deposit', 'topUp']))
  test('zero amount: nothing', () =>
    expect(planTopUp({ ...base, tradeId: 3n, amount: 0n, freeMargin: 0n, allowance: 0n, walletBalance: 0n }).steps).toEqual([]))
})

describe('planFundLeg', () => {
  const fund = (allowance: bigint, wallet: bigint) =>
    planFundLeg({ tenor: TENOR, token: EURC, symbol: 'EURC', tradeId: 2n, amount: 9_000_000n, allowance, walletBalance: wallet, cap: CAP })
  test('already approved: fund only', () => expect(kinds(fund(9_000_000n, 9_000_000n))).toEqual(['fundLeg']))
  test('not approved: approve then fund', () => {
    const p = fund(0n, 20_000_000n)
    expect(kinds(p)).toEqual(['approve', 'fundLeg'])
    expect(p.steps[0].call).toEqual(approveCall(EURC, TENOR, 20_000_000n))
  })
  test('wallet short of the leg: blocked', () => {
    const p = fund(0n, 8_000_000n)
    expect(p.steps).toEqual([])
    expect(p.blocker?.message).toContain('EURC')
  })
})

describe('settleIsNext', () => {
  test('I fund USD and EUR is already funded: settle next', () =>
    expect(settleIsNext({ usdLegFunded: false, eurLegFunded: true, iFundUsd: true })).toBe(true))
  test('I fund USD and EUR is not funded: wait', () =>
    expect(settleIsNext({ usdLegFunded: false, eurLegFunded: false, iFundUsd: true })).toBe(false))
  test('I fund EUR and USD is already funded: settle next', () =>
    expect(settleIsNext({ usdLegFunded: true, eurLegFunded: false, iFundUsd: false })).toBe(true))
  test('I fund EUR and USD is not funded: wait', () =>
    expect(settleIsNext({ usdLegFunded: false, eurLegFunded: false, iFundUsd: false })).toBe(false))
})

describe('planWithdrawAll', () => {
  test('USDC and EURC: both calls', () => expect(kinds(planWithdrawAll({ tenor: TENOR, freeUsdc: 1n, eurcCredit: 1n }))).toEqual(['withdraw', 'withdrawEurc']))
  test('USDC only: no withdrawEurc', () => expect(kinds(planWithdrawAll({ tenor: TENOR, freeUsdc: 5n, eurcCredit: 0n }))).toEqual(['withdraw']))
  test('EURC only: no withdraw', () => expect(kinds(planWithdrawAll({ tenor: TENOR, freeUsdc: 0n, eurcCredit: 5n }))).toEqual(['withdrawEurc']))
  test('nothing: empty, so the button is hidden', () => expect(planWithdrawAll({ tenor: TENOR, freeUsdc: 0n, eurcCredit: 0n }).steps).toEqual([]))
})

describe('popupCount', () => {
  test('sequential wallets: one popup per step', () => expect([1, 2, 3].map((n) => popupCount(n, false))).toEqual([1, 2, 3]))
  test('atomic wallets: one popup for any multi-step plan', () => expect([1, 2, 3].map((n) => popupCount(n, true))).toEqual([1, 1, 1]))
  test('no steps: no popups', () => expect(popupCount(0, true)).toBe(0))
})

describe('supportsAtomic (EIP-5792)', () => {
  test('current shape, keyed by chain id', () => {
    expect(supportsAtomic({ '5042002': { atomic: { status: 'supported' } } }, 5042002)).toBe(true)
    expect(supportsAtomic({ '0x4cef52': { atomic: { status: 'ready' } } }, 5042002)).toBe(true)
  })
  test('current shape, already for one chain', () => expect(supportsAtomic({ atomic: { status: 'supported' } }, 5042002)).toBe(true))
  test('older atomicBatch shape', () => expect(supportsAtomic({ '5042002': { atomicBatch: { supported: true } } }, 5042002)).toBe(true))
  test('unsupported or missing', () => {
    expect(supportsAtomic({ '5042002': { atomic: { status: 'unsupported' } } }, 5042002)).toBe(false)
    expect(supportsAtomic({ '1': { atomic: { status: 'supported' } } }, 5042002)).toBe(false)
    expect(supportsAtomic(undefined, 5042002)).toBe(false)
    expect(supportsAtomic({}, 5042002)).toBe(false)
  })
})

describe('dealer maturity', () => {
  test('testnet default is 30 minutes out, on a whole minute', () => {
    const now = 1_800_000_017
    const m = defaultMaturity(now, false)
    expect(m % 60).toBe(0)
    expect(m - now).toBeGreaterThanOrEqual(1800)
    expect(m - now).toBeLessThan(1860)
  })
  test('mainnet default stays a month out', () => expect(defaultMaturity(1_800_000_000, true) - 1_800_000_000).toBeGreaterThanOrEqual(30 * 86_400))
  test('warns when under minTenor, and when under minTenor + 5 minutes', () => {
    const now = 1_800_000_000
    expect(maturityWarning({ maturity: now + 200, now, minTenor: 300 })).toContain('minimum tenor')
    expect(maturityWarning({ maturity: now + 500, now, minTenor: 300 })).toContain('5 minutes')
    expect(maturityWarning({ maturity: now + 600, now, minTenor: 300 })).toBeUndefined()
    expect(maturityWarning({ maturity: defaultMaturity(now, false), now, minTenor: 300 })).toBeUndefined()
  })
})
