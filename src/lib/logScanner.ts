import { parseEventLogs, type Address, type GetContractEventsReturnType, type Hex } from 'viem'
import { tenorAbi } from './tenorAbi'

export type TenorLog = GetContractEventsReturnType<typeof tenorAbi>[number]

/** Every getLogs request spans fewer than 10,000 blocks. */
export const WINDOW = 9_900n
const DEFAULT_CONCURRENCY = 2
const MAX_ATTEMPTS = 8
/** A window that failed for good is not retried by polling for this long. */
const FAILED_RETRY_MS = 60_000
const STORAGE_VERSION = 1

export interface Range {
  start: bigint
  end: bigint
}

/** The fields of a log that are kept, cached and decoded. */
export interface RawLog {
  address: Address
  topics: readonly Hex[]
  data: Hex
  blockNumber: bigint
  transactionHash: Hex
  logIndex: number
  transactionIndex: number
  blockHash: Hex
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// ------------------------------------------------------------------------------------------------
// Pure range maths
// ------------------------------------------------------------------------------------------------

/** Windows covering [from, to], newest first, each at most `size` blocks. */
export function planWindows(from: bigint, to: bigint, size = WINDOW): Range[] {
  const out: Range[] = []
  for (let end = to; end >= from; ) {
    const start = end - size + 1n > from ? end - size + 1n : from
    out.push({ start, end })
    if (start === from) break
    end = start - 1n
  }
  return out
}

/** Sorted, non-overlapping, touching ranges merged. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + 1n) {
      if (r.end > last.end) last.end = r.end
    } else out.push({ ...r })
  }
  return out
}

/** The parts of [from, to] not inside `covered`. */
export function missingRanges(from: bigint, to: bigint, covered: Range[]): Range[] {
  if (to < from) return []
  const out: Range[] = []
  let cursor = from
  for (const c of mergeRanges(covered)) {
    if (c.end < cursor) continue
    if (c.start > to) break
    if (c.start > cursor) out.push({ start: cursor, end: c.start - 1n })
    cursor = c.end + 1n > cursor ? c.end + 1n : cursor
    if (cursor > to) return out
  }
  if (cursor <= to) out.push({ start: cursor, end: to })
  return out
}

/** Whole percent (0 to 100) of [from, to] that is covered. 100 only when everything is. */
export function coveragePercent(from: bigint, to: bigint, covered: Range[]): number {
  if (to < from) return 100
  const total = to - from + 1n
  const missing = missingRanges(from, to, covered).reduce((n, r) => n + (r.end - r.start + 1n), 0n)
  if (missing === 0n) return 100
  return Math.min(99, Number(((total - missing) * 100n) / total))
}

export function isRateLimit(e: unknown): boolean {
  const err = e as { status?: number; code?: number; details?: string; shortMessage?: string; message?: string; cause?: unknown } | undefined
  if (!err) return false
  if (err.status === 429 || err.code === -32005) return true
  const text = `${err.details ?? ''} ${err.shortMessage ?? ''} ${err.message ?? ''}`.toLowerCase()
  if (text.includes('rate limit') || text.includes('429') || text.includes('too many requests') || text.includes('exceeds defined limit')) return true
  return err.cause ? isRateLimit(err.cause) : false
}

// ------------------------------------------------------------------------------------------------
// Persistence (every storage touch is wrapped: private mode, quota and corrupt JSON must never break the scan)
// ------------------------------------------------------------------------------------------------

interface Stored {
  v: number
  covered: [string, string][]
  logs: { a: Address; t: Hex[]; d: Hex; b: string; h: Hex; i: number; x: number; bh: Hex }[]
}

function readStored(storage: StorageLike | null | undefined, key: string): { covered: Range[]; logs: RawLog[] } | undefined {
  try {
    const text = storage?.getItem(key)
    if (!text) return undefined
    const s = JSON.parse(text) as Stored
    if (s.v !== STORAGE_VERSION || !Array.isArray(s.covered) || !Array.isArray(s.logs)) return undefined
    return {
      covered: s.covered.map(([a, b]) => ({ start: BigInt(a), end: BigInt(b) })),
      logs: s.logs.map((l) => ({
        address: l.a,
        topics: l.t,
        data: l.d,
        blockNumber: BigInt(l.b),
        transactionHash: l.h,
        logIndex: l.i,
        transactionIndex: l.x,
        blockHash: l.bh,
      })),
    }
  } catch {
    return undefined
  }
}

function writeStored(storage: StorageLike | null | undefined, key: string, covered: Range[], logs: RawLog[]): void {
  try {
    const s: Stored = {
      v: STORAGE_VERSION,
      covered: covered.map((r) => [r.start.toString(), r.end.toString()]),
      logs: logs.map((l) => ({ a: l.address, t: [...l.topics], d: l.data, b: l.blockNumber.toString(), h: l.transactionHash, i: l.logIndex, x: l.transactionIndex, bh: l.blockHash })),
    }
    storage?.setItem(key, JSON.stringify(s))
  } catch {
    // storage unavailable or full: the in-memory scan keeps working
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// ------------------------------------------------------------------------------------------------
// The scanner: one per network + contract, shared by every consumer
// ------------------------------------------------------------------------------------------------

export interface ScanSnapshot {
  /** Decoded events, oldest first. Grows window by window while the scan runs. */
  logs: TenorLog[]
  from: bigint
  head: bigint
  /** 0 to 100. */
  progress: number
  running: boolean
  complete: boolean
  rateLimited: boolean
  error?: string
  /** getLogs requests sent by this scanner, retries included. */
  requests: number
}

export interface ScannerOptions {
  /** Cache key, e.g. `tenor.scan.v1:5042002:0xabc…`. */
  storageKey: string
  /** First block to read. Leave out to read only the last `lookback` blocks. */
  from?: bigint
  lookback?: bigint
  getLogs: (from: bigint, to: bigint) => Promise<RawLog[]>
  getHead: () => Promise<bigint>
  storage?: StorageLike | null
  concurrency?: number
  /** Minimum gap between the starts of two getLogs requests, to stay under the RPC's request rate. */
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class LogScanner {
  private readonly o: ScannerOptions
  private readonly raw = new Map<string, RawLog>()
  private readonly decoded = new Map<string, TenorLog>()
  private covered: Range[] = []
  private head = 0n
  private start: bigint | undefined
  private requests = 0
  private rateLimited = false
  private error: string | undefined
  private running = false
  private inflight: Promise<void> | undefined
  private cooldownUntil = 0
  private nextStart = 0
  private concurrency: number
  private readonly retryAfter = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private snap: ScanSnapshot

  constructor(o: ScannerOptions) {
    this.o = o
    this.concurrency = o.concurrency ?? DEFAULT_CONCURRENCY
    this.start = o.from
    const stored = readStored(o.storage, o.storageKey)
    if (stored) {
      this.covered = mergeRanges(stored.covered)
      this.ingest(stored.logs)
    }
    this.snap = this.build()
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  getSnapshot = (): ScanSnapshot => this.snap

  /** Scan whatever is missing. A scan already in flight is joined, never duplicated. */
  scan(): Promise<void> {
    this.inflight ??= this.doScan().finally(() => {
      this.inflight = undefined
      this.running = false
      this.update()
    })
    return this.inflight
  }

  private firstBlock(): bigint {
    return this.start ?? 0n
  }

  private now = () => (this.o.now ? this.o.now() : Date.now())
  private sleep = (ms: number) => (this.o.sleep ?? defaultSleep)(ms)

  private build(): ScanSnapshot {
    const logs = [...this.decoded.values()].sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
    )
    const head = this.head
    const complete = head > 0n && missingRanges(this.firstBlock(), head, this.covered).length === 0
    return {
      logs,
      from: this.firstBlock(),
      head,
      progress: head === 0n ? 0 : coveragePercent(this.firstBlock(), head, this.covered),
      running: this.running,
      complete,
      rateLimited: this.rateLimited,
      error: this.error,
      requests: this.requests,
    }
  }

  private update(): void {
    this.snap = this.build()
    for (const l of this.listeners) l()
  }

  private ingest(logs: RawLog[]): void {
    const fresh: RawLog[] = []
    for (const l of logs) {
      const k = `${l.transactionHash}:${l.logIndex}`
      if (this.raw.has(k)) continue
      this.raw.set(k, l)
      fresh.push(l)
    }
    if (fresh.length === 0) return
    // Unknown events (not in the ABI) are skipped by parseEventLogs.
    const parsed = parseEventLogs({ abi: tenorAbi, logs: fresh.map((l) => ({ ...l, removed: false })) as never })
    for (const p of parsed) this.decoded.set(`${p.transactionHash}:${p.logIndex}`, p)
  }

  private async doScan(): Promise<void> {
    try {
      this.head = await this.o.getHead()
      this.start ??= this.head > (this.o.lookback ?? WINDOW) ? this.head - (this.o.lookback ?? WINDOW) : 0n
    } catch (e) {
      this.error = isRateLimit(e) ? 'The RPC is busy. Retrying.' : 'Could not read the latest block.'
      this.update()
      return
    }
    const t = this.now()
    // Newest windows first, so recent events appear before old ones. Windows that failed recently are left for a later poll.
    const windows = missingRanges(this.firstBlock(), this.head, this.covered)
      .flatMap((r) => planWindows(r.start, r.end))
      .sort((a, b) => (a.end < b.end ? 1 : -1))
      .filter((w) => (this.retryAfter.get(w.start.toString()) ?? 0) <= t)
    this.error = undefined
    this.concurrency = this.o.concurrency ?? DEFAULT_CONCURRENCY
    if (windows.length === 0) {
      this.running = false
      this.update()
      return
    }
    this.running = true
    this.update()
    const queue = [...windows]
    const worker = async (id: number) => {
      for (;;) {
        // After a 429 only one worker keeps going, so the RPC gets room to recover.
        while (id > 0 && this.concurrency < 2 && queue.length > 0) await this.sleep(250)
        const w = queue.shift()
        if (!w) return
        await this.scanWindow(w)
      }
    }
    await Promise.all(Array.from({ length: this.o.concurrency ?? DEFAULT_CONCURRENCY }, (_, i) => worker(i)))
    const stillMissing = missingRanges(this.firstBlock(), this.head, this.covered)
    if (stillMissing.length > 0) this.error = 'Some blocks could not be read yet. They will be retried.'
    this.rateLimited = false
  }

  private async scanWindow(w: Range): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Pace request starts (shared by all workers) and honour any rate-limit pause.
      const gap = this.o.minIntervalMs ?? 0
      const startAt = Math.max(this.cooldownUntil, this.nextStart)
      this.nextStart = Math.max(startAt, this.now()) + gap
      const wait = startAt - this.now()
      if (wait > 0) await this.sleep(wait)
      try {
        this.requests += 1
        const logs = await this.o.getLogs(w.start, w.end)
        this.ingest(logs)
        this.covered = mergeRanges([...this.covered, w])
        this.rateLimited = this.cooldownUntil > this.now()
        this.persist()
        this.update()
        return
      } catch (e) {
        if (isRateLimit(e)) {
          // Honour the limit: every worker pauses, and the pause grows with each consecutive hit.
          this.rateLimited = true
          this.concurrency = 1
          const pause = Math.min(10_000, 600 * 2 ** attempt) + Math.floor(Math.random() * 250)
          this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + pause)
          this.update()
        } else {
          await this.sleep(300 * (attempt + 1))
        }
      }
    }
    this.retryAfter.set(w.start.toString(), this.now() + FAILED_RETRY_MS)
  }

  private persist(): void {
    writeStored(this.o.storage, this.o.storageKey, this.covered, [...this.raw.values()])
  }
}
