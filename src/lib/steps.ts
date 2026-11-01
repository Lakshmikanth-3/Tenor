import type { Address, Hex } from 'viem'
import { approveCall, tenorCalls, type Call } from './calls'
import { fmtToken } from './math'
import type { QuoteMsg } from './quote'

/** Pure planning of the wallet steps for each goal. No network, no React: this is what the unit tests pin down. */

export type StepKind = 'approve' | 'deposit' | 'open' | 'topUp' | 'fundLeg' | 'withdraw' | 'withdrawEurc' | 'settle'

export interface Step {
  id: string
  kind: StepKind
  /** Short name shown in the step tracker. */
  label: string
  /** Plain-words reason this wallet popup exists. */
  reason: string
  call: Call
  /** Extra line shown before the popup (used for approvals). */
  note?: string
  /**
   * For simulating this step before earlier steps have run (atomic batches): the plain USDC balance the account will hold in Tenor
   * once the earlier deposit lands. Lets the final call be checked without opening the wallet.
   */
  assume?: { plainUsdc: bigint }
}

export interface Plan {
  steps: Step[]
  /** Set when the goal cannot succeed yet; no wallet popup should open. */
  blocker?: { code: 'InsufficientWallet'; shortBy: bigint; message: string }
}

export const APPROVAL_NOTE = "One-time permission. You won't be asked again until it runs out."

/** Reusable approval: five times the per-trade cap, or the whole wallet balance if lower, but never below what is needed now. */
export function reusableApproval(p: { needed: bigint; walletBalance: bigint; cap: bigint }): bigint {
  const target = p.cap * 5n < p.walletBalance ? p.cap * 5n : p.walletBalance
  return target > p.needed ? target : p.needed
}

export const needsApproval = (allowance: bigint, needed: bigint) => allowance < needed

function approveStep(p: { token: Address; spender: Address; symbol: string; needed: bigint; walletBalance: bigint; cap: bigint }): Step {
  const amount = reusableApproval(p)
  return {
    id: `approve-${p.symbol}`,
    kind: 'approve',
    label: `Allow ${p.symbol}`,
    reason: `Lets Tenor take up to ${fmtToken(amount)} ${p.symbol} from your wallet. ${APPROVAL_NOTE}`,
    note: `${APPROVAL_NOTE} Tenor will be able to spend up to ${fmtToken(amount)} ${p.symbol}. You can revoke it any time in My trades.`,
    call: approveCall(p.token, p.spender, amount),
  }
}

interface Base {
  tenor: Address
  usdc: Address
  /** Current USDC allowance the user has given Tenor. */
  allowance: bigint
  /** USDC in the user's wallet. */
  walletBalance: bigint
  /** Per-trade cap (maxNotionalUsd6), the basis of the reusable approval. */
  cap: bigint
}

/** Deposit `amount` USDC of margin: approve only if the allowance is too low, then depositMargin. */
export function planDeposit(p: Base & { amount: bigint }): Plan {
  if (p.amount <= 0n) return { steps: [] }
  if (p.walletBalance < p.amount) return insufficient(p.amount - p.walletBalance, 'USDC')
  const steps: Step[] = []
  if (needsApproval(p.allowance, p.amount)) {
    steps.push(approveStep({ token: p.usdc, spender: p.tenor, symbol: 'USDC', needed: p.amount, walletBalance: p.walletBalance, cap: p.cap }))
  }
  steps.push({
    id: 'deposit',
    kind: 'deposit',
    label: `Deposit ${fmtToken(p.amount)} USDC`,
    reason: `Adds ${fmtToken(p.amount)} USDC to your margin in Tenor.`,
    call: tenorCalls(p.tenor).depositMargin(p.amount),
  })
  return { steps }
}

/** Shortfall of free margin against what a trade needs. Free margin includes anything held as yield shares. */
export const marginShortfall = (needed: bigint, freeMargin: bigint) => (needed > freeMargin ? needed - freeMargin : 0n)

/** Taking a quote: [approve] + [deposit the shortfall] + open. */
export function planLockRate(p: Base & { quote: QuoteMsg; signature: Hex; margin: bigint; freeMargin: bigint }): Plan {
  const dep = planDeposit({ ...p, amount: marginShortfall(p.margin, p.freeMargin) })
  if (dep.blocker) return dep
  return {
    steps: [
      ...dep.steps,
      {
        id: 'open',
        kind: 'open',
        label: 'Lock rate',
        reason: 'Opens the trade at the dealer’s signed rate.',
        call: tenorCalls(p.tenor).open(p.quote, p.signature),
        ...(dep.steps.length > 0 ? { assume: { plainUsdc: p.margin } } : {}),
      },
    ],
  }
}

/** Top up a trade: [approve] + [deposit the shortfall] + topUp. */
export function planTopUp(p: Base & { tradeId: bigint; amount: bigint; freeMargin: bigint }): Plan {
  if (p.amount <= 0n) return { steps: [] }
  const dep = planDeposit({ ...p, amount: marginShortfall(p.amount, p.freeMargin) })
  if (dep.blocker) return dep
  return {
    steps: [
      ...dep.steps,
      {
        id: 'topUp',
        kind: 'topUp',
        label: `Top up ${fmtToken(p.amount)} USDC`,
        reason: 'Moves the margin into this trade.',
        call: tenorCalls(p.tenor).topUp(p.tradeId, p.amount),
        ...(dep.steps.length > 0 ? { assume: { plainUsdc: p.amount } } : {}),
      },
    ],
  }
}

/** Funding a delivery leg: [approve the leg token] + fundLeg. */
export function planFundLeg(p: {
  tenor: Address
  token: Address
  symbol: 'USDC' | 'EURC'
  tradeId: bigint
  amount: bigint
  allowance: bigint
  walletBalance: bigint
  cap: bigint
}): Plan {
  if (p.walletBalance < p.amount) return insufficient(p.amount - p.walletBalance, p.symbol)
  const steps: Step[] = []
  if (needsApproval(p.allowance, p.amount)) {
    steps.push(approveStep({ token: p.token, spender: p.tenor, symbol: p.symbol, needed: p.amount, walletBalance: p.walletBalance, cap: p.cap }))
  }
  steps.push({
    id: 'fundLeg',
    kind: 'fundLeg',
    label: `Fund my ${p.symbol} leg`,
    reason: `Sends ${fmtToken(p.amount)} ${p.symbol} into the trade for delivery.`,
    call: tenorCalls(p.tenor).fundLeg(p.tradeId),
  })
  return { steps }
}

/** After my leg lands, is Settle the next move? True only when the other leg is already funded. */
export function settleIsNext(p: { usdLegFunded: boolean; eurLegFunded: boolean; iFundUsd: boolean }): boolean {
  const usd = p.usdLegFunded || p.iFundUsd
  const eur = p.eurLegFunded || !p.iFundUsd
  return usd && eur
}

/** Withdraw everything: withdraw() only if there is USDC, withdrawEurc() only if there is an EURC credit. Empty plan hides the button. */
export function planWithdrawAll(p: { tenor: Address; freeUsdc: bigint; eurcCredit: bigint }): Plan {
  const steps: Step[] = []
  const c = tenorCalls(p.tenor)
  if (p.freeUsdc > 0n) {
    steps.push({ id: 'withdraw', kind: 'withdraw', label: `Withdraw ${fmtToken(p.freeUsdc)} USDC`, reason: 'Sends your free USDC (including anything earning yield) to your wallet.', call: c.withdraw() })
  }
  if (p.eurcCredit > 0n) {
    steps.push({ id: 'withdrawEurc', kind: 'withdrawEurc', label: `Withdraw ${fmtToken(p.eurcCredit)} EURC`, reason: 'Sends your delivered EURC to your wallet.', call: c.withdrawEurc() })
  }
  return { steps }
}

/** Wallet popups a plan needs: one if the wallet batches atomically, otherwise one per step. */
export function popupCount(stepCount: number, atomic: boolean): number {
  if (stepCount <= 0) return 0
  return atomic && stepCount > 1 ? 1 : stepCount
}

function insufficient(shortBy: bigint, symbol: string): Plan {
  return {
    steps: [],
    blocker: { code: 'InsufficientWallet', shortBy, message: `Your wallet is ${fmtToken(shortBy)} ${symbol} short. Add ${symbol} on Arc first.` },
  }
}

/**
 * EIP-5792 capability check. Handles both response shapes: the current `atomic.status` and the older `atomicBatch.supported`,
 * either for one chain directly or keyed by chain id (decimal or hex).
 */
export function supportsAtomic(caps: unknown, chainId: number): boolean {
  if (!caps || typeof caps !== 'object') return false
  const root = caps as Record<string, unknown>
  const forChain = (root[String(chainId)] ?? root[`0x${chainId.toString(16)}`] ?? root) as Record<string, unknown> | undefined
  if (!forChain || typeof forChain !== 'object') return false
  const atomic = forChain.atomic as { status?: string } | undefined
  if (atomic && (atomic.status === 'supported' || atomic.status === 'ready')) return true
  const legacy = forChain.atomicBatch as { supported?: boolean } | undefined
  return legacy?.supported === true
}

/** Default dealer maturity: near-term on testnet (now + 30 min, rounded up to the next whole minute), a month out on mainnet. */
export function defaultMaturity(now: number, isMainnet: boolean): number {
  const raw = now + (isMainnet ? 30 * 86_400 : 30 * 60)
  return Math.ceil(raw / 60) * 60
}

export const MATURITY_MARGIN_SECONDS = 5 * 60

/** Warns when the maturity is too close for the contract's minimum tenor (or leaves under 5 minutes of slack). */
export function maturityWarning(p: { maturity: number; now: number; minTenor: number }): string | undefined {
  const left = p.maturity - p.now
  if (left < p.minTenor) return 'This maturity is already inside the minimum tenor, so the contract will refuse the trade. Pick a later time.'
  if (left < p.minTenor + MATURITY_MARGIN_SECONDS) {
    return 'This maturity is close to the minimum tenor. By the time a hedger opens the quote it may be too late. Add at least 5 minutes of slack.'
  }
  return undefined
}
