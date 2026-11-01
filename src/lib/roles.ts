export type Role = 'business' | 'dealer'
export type StepStatus = 'done' | 'current' | 'waiting'

/** The part of an on-chain trade the dashboards need. Matches the shape returned by Tenor.getTrade. */
export interface TradeInput {
  hedger: string
  dealer: string
  side: number // 0 = hedger sells USD, 1 = hedger buys USD
  status: number // 1 = open
  cashSettled: boolean
  maturity: bigint
  callParty: number // 0 none, 1 hedger, 2 dealer
  usdLegFunded: boolean
  eurLegFunded: boolean
}

export interface RailInput {
  role: Role
  connected: boolean
  /** Wallet is on the dealer allowlist (only matters for the dealer rail). */
  isDealer: boolean
  /** Only the trades where the wallet plays this role. */
  trades: TradeInput[]
  address?: string
  /** Free margin in Tenor, including anything held in the yield vault. */
  freeUsdc: bigint
  creditEurc: bigint
  now: number
}

export interface RailStep {
  n: number
  title: string
  detail: string
  status: StepStatus
  /** Why the step cannot be done by this wallet (shown in place of an action). */
  blocked?: string
}

const ROLE_KEY = 'tenor.role'

export function parseRole(v: unknown): Role {
  return v === 'dealer' ? 'dealer' : 'business'
}

export function readRole(storage?: { getItem(k: string): string | null } | null): Role {
  try {
    return parseRole((storage ?? (typeof localStorage === 'undefined' ? null : localStorage))?.getItem(ROLE_KEY))
  } catch {
    return 'business'
  }
}

export function writeRole(role: Role, storage?: { setItem(k: string, v: string): void } | null): void {
  try {
    ;(storage ?? (typeof localStorage === 'undefined' ? null : localStorage))?.setItem(ROLE_KEY, role)
  } catch {
    // storage unavailable: the choice lasts for this visit only
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Does this wallet owe a delivery leg on this trade, and in which token? */
export function myLeg(t: TradeInput, role: Role): { token: 'USDC' | 'EURC'; funded: boolean } {
  const isHedger = role === 'business'
  const sellsUsd = (isHedger && t.side === 0) || (!isHedger && t.side === 1)
  return sellsUsd ? { token: 'USDC', funded: t.usdLegFunded } : { token: 'EURC', funded: t.eurLegFunded }
}

/**
 * Status of the six steps for one role, computed only from the wallet's on-chain state. Off-chain steps (requesting a rate,
 * receiving a link, signing a quote) are inferred from whether a trade exists.
 */
export function computeRail(i: RailInput): RailStep[] {
  const mine = i.trades
  const open = mine.filter((t) => t.status === 1)
  const matured = open.filter((t) => i.now >= Number(t.maturity))
  const myParty = i.role === 'business' ? 1 : 2
  const calledOnMe = open.filter((t) => t.callParty === myParty)
  const legsDue = matured.filter((t) => !t.cashSettled && !myLeg(t, i.role).funded)
  const settleReady = matured.filter((t) => t.cashSettled || (t.usdLegFunded && t.eurLegFunded))
  const hasAny = mine.length > 0
  const toWithdraw = i.freeUsdc > 0n || i.creditEurc > 0n
  const business = i.role === 'business'

  const watch = (): RailStep => {
    const detail = !hasAny
      ? 'Once a trade is open you see mark-to-market and margin health here.'
      : calledOnMe.length > 0
        ? `Margin call on ${plural(calledOnMe.length, 'trade', 'trades')}: top up before the cure window ends.`
        : open.length > 0
          ? `${plural(open.length, 'open trade', 'open trades')}. ${business ? 'Watch' : 'Mark'} mark-to-market and margin health${business ? '; anyone can mark.' : ', and mark when the interval allows.'}`
          : 'No open trades left to watch.'
    const status: StepStatus = !hasAny ? 'waiting' : open.length === 0 || matured.length > 0 ? 'done' : 'current'
    return { n: 4, title: business ? 'Watch the trade' : 'Watch the trade and mark it', detail, status }
  }

  const maturity = (): RailStep => {
    let detail = 'At maturity you fund your delivery leg (physical) or settle (cash).'
    if (matured.length > 0) {
      const due = legsDue[0]
      if (due) detail = `Matured: fund your ${myLeg(due, i.role).token} leg${legsDue.length > 1 ? ` (${legsDue.length} trades)` : ''}, then settle.`
      else if (settleReady.length > 0) detail = `Matured: ${plural(settleReady.length, 'trade is', 'trades are')} ready to settle.`
      else detail = 'Matured: your leg is funded. Settle once the other side has funded theirs.'
    } else if (hasAny && open.length === 0) detail = 'Everything has settled.'
    const status: StepStatus = !hasAny ? 'waiting' : matured.length > 0 ? 'current' : open.length > 0 ? 'waiting' : 'done'
    return { n: 5, title: business ? 'At maturity: fund your leg or settle' : 'At maturity: fund the EURC/USDC leg or settle', detail, status }
  }

  const withdraw = (): RailStep => {
    const status: StepStatus = !hasAny || open.length > 0 ? 'waiting' : toWithdraw ? 'current' : 'done'
    const detail = toWithdraw
      ? open.length > 0
        ? 'Funds that are free now can already be withdrawn; locked margin returns after settlement.'
        : 'Withdraw your free USDC and any EURC in one go.'
      : 'Nothing to withdraw right now.'
    return { n: 6, title: 'Withdraw everything', detail, status }
  }

  if (business) {
    return [
      {
        n: 1,
        title: 'Request a rate',
        detail: hasAny
          ? `You have ${plural(mine.length, 'trade', 'trades')} as the hedger. Request another any time.`
          : 'Choose amount, date and physical or cash, then send the request to a dealer.',
        status: hasAny ? 'done' : 'current',
      },
      {
        n: 2,
        title: "Open the dealer's quote link",
        detail: hasAny ? 'Quote links you opened became trades.' : 'Paste the link the dealer sends back and check it: rate, margin, expiry and signature.',
        status: hasAny ? 'done' : 'waiting',
      },
      {
        n: 3,
        title: 'Lock rate (posts USDC margin)',
        detail: hasAny ? 'Rate locked and margin posted.' : 'On the quote page one button posts the missing margin and locks the rate.',
        status: hasAny ? 'done' : 'waiting',
      },
      watch(),
      maturity(),
      withdraw(),
    ]
  }

  const signBlocked = !i.isDealer ? 'This wallet is not on the dealer allowlist, so it cannot sign quotes.' : undefined
  return [
    {
      n: 1,
      title: 'Deposit dealer margin',
      detail: i.freeUsdc > 0n || hasAny ? 'Margin is in place. The dealer posts the same initial margin as the hedger when a quote is taken.' : 'A quote can only be taken if you hold enough free USDC margin.',
      status: i.freeUsdc > 0n || hasAny ? 'done' : 'current',
    },
    {
      n: 2,
      title: 'Sign a quote and share the link',
      detail: signBlocked ? signBlocked : hasAny ? 'Your quotes were taken. Sign another any time.' : 'Sign an EIP-712 quote in your wallet and send the link to the business.',
      status: hasAny ? 'done' : signBlocked || !(i.freeUsdc > 0n) ? 'waiting' : 'current',
      blocked: signBlocked,
    },
    {
      n: 3,
      title: 'Wait for the business to lock the rate',
      detail: `Quotes taken: ${mine.length}.`,
      status: hasAny ? 'done' : 'waiting',
    },
    watch(),
    maturity(),
    withdraw(),
  ]
}

export const currentStep = (steps: RailStep[]): RailStep | undefined => steps.find((s) => s.status === 'current')

/** Pull the in-app path (/quote?q=...) out of whatever the user pasted: a full link or just the path. */
export function quotePathFrom(input: string): string | undefined {
  const raw = input.trim()
  if (!raw) return undefined
  let path = raw
  try {
    const u = new URL(raw, 'https://tenor.invalid')
    path = u.pathname + u.search
  } catch {
    return undefined
  }
  const q = new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('q')
  return path.startsWith('/quote') && q ? path : undefined
}
