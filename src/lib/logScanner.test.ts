import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem'
import { LogScanner, coveragePercent, mergeRanges, missingRanges, planWindows, type RawLog, type StorageLike } from './logScanner'
import { tenorAbi } from './tenorAbi'

const TENOR = '0xfa9d0a455959c5fa6e57b4e3fdee9b062bacc3ee' as Address
const USER = '0x43DDBD19381C8Ea8C1e4670d18DdB97c43fbEFDC' as Address

/** A real MarginDeposited log at `block`, so decoding is exercised too. */
function log(block: bigint, amount = 1_000_000n, index = 0): RawLog {
  return {
    address: TENOR,
    topics: encodeEventTopics({ abi: tenorAbi, eventName: 'MarginDeposited', args: { user: USER } }) as Hex[],
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
    blockNumber: block,
    transactionHash: `0x${block.toString(16).padStart(64, '0')}`,
    logIndex: index,
    transactionIndex: 0,
    blockHash: `0x${'ab'.repeat(32)}`,
  }
}

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

interface Fake {
  calls: { from: bigint; to: bigint }[]
  scanner: LogScanner
  setHead(h: bigint): void
}

function fake(opts: { head: bigint; from: bigint; storage?: StorageLike | null; events?: bigint[]; fail?: () => Error | undefined; sleeps?: number[] }): Fake {
  let head = opts.head
  const calls: { from: bigint; to: bigint }[] = []
  const events = opts.events ?? []
  let clock = 0
  const scanner = new LogScanner({
    storageKey: 'k',
    from: opts.from,
    storage: opts.storage ?? null,
    getHead: () => Promise.resolve(head),
    getLogs: (from, to) => {
      calls.push({ from, to })
      const err = opts.fail?.()
      if (err) return Promise.reject(err)
      return Promise.resolve(events.filter((b) => b >= from && b <= to).map((b) => log(b)))
    },
    sleep: (ms) => {
      opts.sleeps?.push(ms)
      clock += ms
      return Promise.resolve()
    },
    now: () => clock,
  })
  return { calls, scanner, setHead: (h) => (head = h) }
}

describe('range maths', () => {
  test('planWindows covers the range exactly, newest first, each under 10,000 blocks', () => {
    const w = planWindows(10_000n, 50_000n)
    expect(w).toHaveLength(5)
    expect(w[0].end).toBe(50_000n)
    expect(w[w.length - 1].start).toBe(10_000n)
    for (let i = 0; i < w.length; i++) {
      expect(w[i].end - w[i].start + 1n <= 9_900n).toBe(true)
      if (i > 0) expect(w[i].end + 1n).toBe(w[i - 1].start)
    }
  })
  test('a short range is one window', () => expect(planWindows(5n, 5n)).toEqual([{ start: 5n, end: 5n }]))
  test('mergeRanges joins overlapping and touching ranges', () => {
    expect(
      mergeRanges([
        { start: 10n, end: 20n },
        { start: 21n, end: 30n },
        { start: 40n, end: 50n },
        { start: 45n, end: 60n },
      ]),
    ).toEqual([
      { start: 10n, end: 30n },
      { start: 40n, end: 60n },
    ])
  })
  test('missingRanges returns the gaps only', () => {
    expect(missingRanges(0n, 100n, [{ start: 10n, end: 20n }, { start: 50n, end: 60n }])).toEqual([
      { start: 0n, end: 9n },
      { start: 21n, end: 49n },
      { start: 61n, end: 100n },
    ])
    expect(missingRanges(0n, 100n, [{ start: 0n, end: 100n }])).toEqual([])
    expect(missingRanges(0n, 100n, [])).toEqual([{ start: 0n, end: 100n }])
  })
  test('coveragePercent is 100 only when everything is covered', () => {
    expect(coveragePercent(0n, 99n, [])).toBe(0)
    expect(coveragePercent(0n, 99n, [{ start: 0n, end: 39n }])).toBe(40)
    expect(coveragePercent(0n, 99n, [{ start: 0n, end: 98n }])).toBe(99)
    expect(coveragePercent(0n, 99n, [{ start: 0n, end: 99n }])).toBe(100)
  })
})

describe('LogScanner', () => {
  test('first load: one request per window, newest first, everything decoded', async () => {
    const f = fake({ head: 50_000n, from: 10_000n, events: [12_000n, 30_000n, 49_000n] })
    await f.scanner.scan()
    const s = f.scanner.getSnapshot()
    expect(f.calls).toHaveLength(5)
    expect(s.requests).toBe(5)
    expect(f.calls[0].to).toBe(50_000n)
    for (let i = 1; i < f.calls.length; i++) expect(f.calls[i].to < f.calls[i - 1].to).toBe(true)
    expect(s.complete).toBe(true)
    expect(s.progress).toBe(100)
    expect(s.logs.map((l) => l.eventName)).toEqual(['MarginDeposited', 'MarginDeposited', 'MarginDeposited'])
    expect(s.logs.map((l) => l.blockNumber)).toEqual([12_000n, 30_000n, 49_000n])
  })

  test('results stream: the snapshot grows window by window, newest events first', async () => {
    const f = fake({ head: 50_000n, from: 10_000n, events: [12_000n, 49_000n] })
    const seen: { logs: number; progress: number }[] = []
    f.scanner.subscribe(() => {
      const s = f.scanner.getSnapshot()
      seen.push({ logs: s.logs.length, progress: s.progress })
    })
    await f.scanner.scan()
    const progress = seen.map((x) => x.progress)
    expect(progress.some((p) => p > 0 && p < 100)).toBe(true)
    for (let i = 1; i < progress.length; i++) expect(progress[i] >= progress[i - 1]).toBe(true)
    // the newest event is visible while older windows are still unread
    const firstWithLog = seen.find((x) => x.logs > 0)
    expect(firstWithLog?.progress).toBeLessThan(100)
    expect(firstWithLog?.logs).toBe(1)
  })

  test('concurrent scan() calls share one scan', async () => {
    const f = fake({ head: 50_000n, from: 10_000n })
    await Promise.all([f.scanner.scan(), f.scanner.scan(), f.scanner.scan()])
    expect(f.calls).toHaveLength(5)
  })

  test('repeat load reads only the new blocks and starts with the cached events', async () => {
    const storage = memory()
    const first = fake({ head: 50_000n, from: 10_000n, storage, events: [12_000n, 49_000n] })
    await first.scanner.scan()
    expect(first.calls).toHaveLength(5)

    const second = fake({ head: 50_400n, from: 10_000n, storage, events: [12_000n, 49_000n, 50_300n] })
    // cached events are there before any request
    expect(second.scanner.getSnapshot().logs).toHaveLength(2)
    await second.scanner.scan()
    expect(second.calls).toEqual([{ from: 50_001n, to: 50_400n }])
    expect(second.scanner.getSnapshot().logs).toHaveLength(3)
    expect(second.scanner.getSnapshot().complete).toBe(true)
  })

  test('polling with no new blocks makes no getLogs request', async () => {
    const storage = memory()
    const f = fake({ head: 50_000n, from: 10_000n, storage })
    await f.scanner.scan()
    const before = f.calls.length
    await f.scanner.scan()
    await f.scanner.scan()
    expect(f.calls.length).toBe(before)
    f.setHead(50_050n)
    await f.scanner.scan()
    expect(f.calls.length).toBe(before + 1)
  })

  test('a 429 pauses and retries without failing, and slows to one worker', async () => {
    let n = 0
    const sleeps: number[] = []
    const f = fake({
      head: 30_000n,
      from: 10_000n,
      sleeps,
      events: [29_000n],
      fail: () => (n++ < 2 ? Object.assign(new Error('rate limit exceeded'), { code: -32005 }) : undefined),
    })
    await f.scanner.scan()
    const s = f.scanner.getSnapshot()
    expect(s.complete).toBe(true)
    expect(s.error).toBeUndefined()
    expect(s.logs).toHaveLength(1)
    expect(s.requests).toBe(3 + 2) // three windows plus two rejected attempts
    expect(sleeps.some((ms) => ms >= 600)).toBe(true)
  })

  test('a window that keeps failing is reported and left for a later retry', async () => {
    const f = fake({ head: 20_000n, from: 10_000n, fail: () => new Error('boom') })
    await f.scanner.scan()
    const s = f.scanner.getSnapshot()
    expect(s.complete).toBe(false)
    expect(s.error).toBeTruthy()
  })

  test('unusable storage never breaks the scan', async () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    const f = fake({ head: 20_000n, from: 10_000n, storage: broken, events: [15_000n] })
    await f.scanner.scan()
    expect(f.scanner.getSnapshot().logs).toHaveLength(1)
  })

  test('corrupt cached JSON is ignored', async () => {
    const storage = memory()
    storage.setItem('k', '{not json')
    const f = fake({ head: 20_000n, from: 10_000n, storage })
    await f.scanner.scan()
    expect(f.scanner.getSnapshot().complete).toBe(true)
    expect(f.calls).toHaveLength(2)
  })
})
