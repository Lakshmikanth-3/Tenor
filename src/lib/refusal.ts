import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tenorAbi } from './tenorAbi'
import { decodeRevert } from './errors'
import { isRateLimit } from './logScanner'
import { ceilBps, nowSec } from './math'
import { quoteTuple, quoteTypedData, type QuoteMsg } from './quote'

/**
 * Refusal room engine. Every scenario is an `eth_call` against the deployed Tenor contract.
 * Nothing is sent onchain. Where a scenario needs contract state that does not exist yet
 * (an allowlisted dealer, a used nonce, a trade with an open margin call) the call carries a
 * state override. The revert always comes from the deployed bytecode.
 */

// Storage layout of Tenor (forge inspect storageLayout).
const SLOT = { dealers: 17n, nonceUsed: 18n, usdcBalance: 19n, trades: 21n } as const
const TRADE = { party: 1n, notional: 2n, maturity: 5n, callParty: 15n, hedger: 0n } as const
const FAKE_TRADE_ID = 1_000_000_000n

type Slot = { slot: Hex; value: Hex }

/** Public RPCs (Arc mainnet in particular) throttle bursts. Retry only on a rate-limit answer, with growing waits. */
async function retryLimited<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isRateLimit(e) || attempt >= tries - 1) throw e
      await new Promise((r) => setTimeout(r, 700 * 2 ** attempt))
    }
  }
}

const word = (n: bigint): Hex => pad(toHex(n), { size: 32 })
const addrWord = (a: Address): Hex => pad(a, { size: 32 })
const mapSlot = (key: Hex, slot: bigint): Hex => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [key, slot]))

const dealerSlot = (a: Address): Slot => ({ slot: mapSlot(addrWord(a), SLOT.dealers), value: word(1n) })
export const balanceSlot = (a: Address, amount: bigint): Slot => ({ slot: mapSlot(addrWord(a), SLOT.usdcBalance), value: word(amount) })
const nonceSlot = (dealer: Address, nonce: bigint): Slot => {
  const outer = mapSlot(addrWord(dealer), SLOT.nonceUsed)
  return { slot: keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [nonce, outer])), value: word(1n) }
}

interface FakeTrade {
  hedger: Address
  status: number // 1 Open, 2 Delivered
  maturity: bigint
  callParty?: number
}

function tradeSlots(t: FakeTrade): Slot[] {
  const base = BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [FAKE_TRADE_ID, SLOT.trades])))
  const at = (i: bigint) => word(base + i)
  // slot 1 packs dealer(20 bytes) | side(1) | status(1) | cashSettled(1); status sits at byte offset 21.
  const packed = BigInt(t.status) << (21n * 8n)
  return [
    { slot: at(TRADE.hedger), value: addrWord(t.hedger) },
    { slot: at(TRADE.party), value: word(packed) },
    { slot: at(TRADE.maturity), value: word(t.maturity) },
    { slot: at(TRADE.callParty), value: word(BigInt(t.callParty ?? 0)) },
  ]
}

export type Outcome =
  | { kind: 'revert'; errorName?: string; message: string }
  | { kind: 'pass'; detail: string }
  | { kind: 'error'; message: string }

export interface ScenarioCtx {
  client: PublicClient
  tenor: Address
}

export interface Scenario {
  id: string
  title: string
  attack: string
  /** What the simulation sets up before the call. */
  setup: string
  /** Custom error the contract is expected to raise, or undefined for the control call. */
  expected?: string
  run: (ctx: ScenarioCtx) => Promise<Outcome>
}

async function simulate(
  ctx: ScenarioCtx,
  from: Address,
  data: Hex,
  slots: Slot[] = [],
  time?: bigint,
): Promise<{ ok: true; data?: Hex } | { ok: false; errorName?: string; message: string }> {
  try {
    const r = await retryLimited(() => ctx.client.call({
      account: from,
      to: ctx.tenor,
      data,
      ...(slots.length ? { stateOverride: [{ address: ctx.tenor, stateDiff: slots }] } : {}),
      ...(time ? { blockOverrides: { time } } : {}),
    }))
    return { ok: true, data: r.data }
  } catch (e) {
    const d = decodeRevert(e)
    return { ok: false, errorName: d.name, message: d.message }
  }
}

const toOutcome = (r: Awaited<ReturnType<typeof simulate>>, passDetail = 'The call was accepted.'): Outcome =>
  r.ok ? { kind: 'pass', detail: passDetail } : r.errorName ? { kind: 'revert', errorName: r.errorName, message: r.message } : { kind: 'error', message: r.message }

// Throwaway identities for the simulation. They never hold funds and live only in memory.
const dealerAcct = privateKeyToAccount(generatePrivateKey())
const forgerAcct = privateKeyToAccount(generatePrivateKey())
const hedgerAddr = privateKeyToAccount(generatePrivateKey()).address

async function fairRate(ctx: ScenarioCtx, notional: bigint, tenor: bigint): Promise<bigint> {
  const q = await retryLimited(() => ctx.client.readContract({ address: ctx.tenor, abi: tenorAbi, functionName: 'quote', args: [notional, tenor] }))
  return q[1]
}

async function signedOpen(
  ctx: ScenarioCtx,
  patch: (q: QuoteMsg, fair: bigint) => QuoteMsg,
  signer = dealerAcct,
  slots: (q: QuoteMsg) => Slot[] = () => [],
): Promise<Outcome> {
  const chainId = await retryLimited(() => ctx.client.getChainId())
  const notional = 10_000_000n
  const tenorSecs = 86_400n
  let fair: bigint
  try {
    fair = await fairRate(ctx, notional, tenorSecs)
  } catch (e) {
    const d = decodeRevert(e)
    return d.name ? { kind: 'revert', errorName: d.name, message: d.message } : { kind: 'error', message: d.message }
  }
  const base: QuoteMsg = {
    dealer: dealerAcct.address,
    side: 0,
    notionalUsd6: notional,
    rate: fair,
    maturity: BigInt(nowSec()) + tenorSecs,
    initialMarginBps: 500n,
    quoteExpiry: BigInt(nowSec()) + 600n,
    nonce: BigInt(Date.now()),
    cashSettled: false,
  }
  const q = patch(base, fair)
  const signature = await signer.signTypedData(quoteTypedData(chainId, ctx.tenor, q))
  const data = encodeFunctionData({ abi: tenorAbi, functionName: 'open', args: [quoteTuple(q), signature] })
  const funded = [balanceSlot(hedgerAddr, 1_000_000_000n), balanceSlot(dealerAcct.address, 1_000_000_000n)]
  const r = await simulate(ctx, hedgerAddr, data, [dealerSlot(dealerAcct.address), ...funded, ...slots(q)])
  if (r.ok) {
    const id = r.data && r.data.length >= 66 ? BigInt(r.data.slice(0, 66)) : undefined
    return { kind: 'pass', detail: id !== undefined ? `open() accepted the quote and would create trade #${id}, locking ${Number(ceilBps(notional, 500n)) / 1e6} USDC from each side.` : 'open() accepted the quote.' }
  }
  return r.errorName ? { kind: 'revert', errorName: r.errorName, message: r.message } : { kind: 'error', message: r.message }
}

async function fakeTradeCall(
  ctx: ScenarioCtx,
  fn: 'settle' | 'withdrawExcess',
  trade: FakeTrade,
): Promise<Outcome> {
  const data =
    fn === 'settle'
      ? encodeFunctionData({ abi: tenorAbi, functionName: 'settle', args: [FAKE_TRADE_ID] })
      : encodeFunctionData({ abi: tenorAbi, functionName: 'withdrawExcess', args: [FAKE_TRADE_ID, 1n] })
  return toOutcome(await simulate(ctx, trade.hedger, data, tradeSlots(trade)))
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'stale',
    title: 'Stale price',
    attack: 'Ask for a rate when the EUR/USD feed has not updated for longer than the staleness window.',
    setup: 'The simulated block is moved past the feed\'s last update plus the staleness limit.',
    expected: 'StalePrice',
    run: async (ctx) => {
      const feed = await retryLimited(() => ctx.client.readContract({ address: ctx.tenor, abi: tenorAbi, functionName: 'feed' }))
      const maxStaleness = await retryLimited(() => ctx.client.readContract({ address: ctx.tenor, abi: tenorAbi, functionName: 'maxStaleness' }))
      const round = await retryLimited(() => ctx.client.readContract({
        address: feed,
        abi: [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const,
        functionName: 'latestRoundData',
      }))
      const target = round[3] + maxStaleness + 60n
      const time = target > BigInt(nowSec()) + 60n ? target : BigInt(nowSec()) + 60n
      const data = encodeFunctionData({ abi: tenorAbi, functionName: 'quote', args: [10_000_000n, 86_400n] })
      return toOutcome(await simulate(ctx, hedgerAddr, data, [], time))
    },
  },
  {
    id: 'offmarket',
    title: 'Off-market rate',
    attack: 'A dealer signs a rate 5% away from the fair forward to extract value from the hedger.',
    setup: 'The dealer is allowlisted and both sides hold margin, so only the rate is wrong.',
    expected: 'OffMarketRate',
    run: (ctx) => signedOpen(ctx, (q, fair) => ({ ...q, rate: (fair * 105n) / 100n })),
  },
  {
    id: 'replay',
    title: 'Replayed quote',
    attack: 'Submit a quote that was already taken, hoping to open a second trade from the same signature.',
    setup: 'The quote\'s nonce is marked used, which is the state right after a first successful open().',
    expected: 'NonceUsed',
    run: (ctx) => signedOpen(ctx, (q) => q, dealerAcct, (q) => [nonceSlot(q.dealer, q.nonce)]),
  },
  {
    id: 'forged',
    title: 'Forged signature',
    attack: 'Someone other than the dealer signs a quote and claims it came from the dealer.',
    setup: 'The quote names the dealer but is signed by a different key.',
    expected: 'BadSignature',
    run: (ctx) => signedOpen(ctx, (q) => q, forgerAcct),
  },
  {
    id: 'expired',
    title: 'Expired quote',
    attack: 'Take a quote after its expiry time has passed.',
    setup: 'A correctly signed quote whose expiry is one minute in the past.',
    expected: 'QuoteExpired',
    run: (ctx) => signedOpen(ctx, (q) => ({ ...q, quoteExpiry: BigInt(nowSec()) - 60n })),
  },
  {
    id: 'locked',
    title: 'Withdraw while margin-called',
    attack: 'A party under a margin call tries to pull margin out of the trade.',
    setup: 'A trade of yours is open with a margin call on it.',
    expected: 'MarginLocked',
    run: (ctx) => fakeTradeCall(ctx, 'withdrawExcess', { hedger: hedgerAddr, status: 1, maturity: BigInt(nowSec()) + 86_400n, callParty: 1 }),
  },
  {
    id: 'twice',
    title: 'Settle twice',
    attack: 'Call settle on a trade that has already been delivered, to pay out a second time.',
    setup: 'The trade is already in the Delivered state.',
    expected: 'AlreadySettled',
    run: (ctx) => fakeTradeCall(ctx, 'settle', { hedger: hedgerAddr, status: 2, maturity: BigInt(nowSec()) - 86_400n }),
  },
  {
    id: 'early',
    title: 'Settle before maturity',
    attack: 'Settle a trade a day early to lock in a favourable moment.',
    setup: 'The trade is open and matures tomorrow.',
    expected: 'NotMatured',
    run: (ctx) => fakeTradeCall(ctx, 'settle', { hedger: hedgerAddr, status: 1, maturity: BigInt(nowSec()) + 86_400n }),
  },
  {
    id: 'control',
    title: 'Control: a valid quote',
    attack: 'The same open() call with everything correct: fair rate, fresh signature, allowlisted dealer, funded margin.',
    setup: 'Same setup as the off-market card, with the rate set to the live fair forward.',
    run: (ctx) => signedOpen(ctx, (q) => q),
  },
]
