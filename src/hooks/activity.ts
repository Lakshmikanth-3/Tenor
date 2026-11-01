import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { LogScanner, browserStorage, type ScanSnapshot, type TenorLog } from '@/lib/logScanner'
import type { NetworkCfg } from '@/lib/networks'
import { useNet } from './network'

export type { TenorLog } from '@/lib/logScanner'

const POLL_MS = 10_000
// The public Arc RPC allows roughly two requests a second; staying under that avoids 429s altogether.
const MIN_INTERVAL_MS = 550
// Without a configured deploy block, only recent history is scanned.
const FALLBACK_LOOKBACK = 9_900n

interface Entry {
  scanner: LogScanner
  users: number
  timer?: ReturnType<typeof setInterval>
}
const entries = new Map<string, Entry>()

/** A client for scanning only: the transport does not retry on its own, so every retry is ours and honours the rate limit. */
const scanClients = new Map<string, PublicClient>()
function scanClient(net: NetworkCfg): PublicClient {
  let c = scanClients.get(net.key)
  if (!c) {
    c = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl, { retryCount: 0 }) })
    scanClients.set(net.key, c)
  }
  return c
}

function acquire(entry: Entry): void {
  entry.users += 1
  if (entry.users > 1) return
  void entry.scanner.scan()
  // After the first pass only new blocks (and any window that failed earlier) are read.
  entry.timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    void entry.scanner.scan()
  }, POLL_MS)
}

function release(entry: Entry): void {
  entry.users -= 1
  if (entry.users > 0) return
  if (entry.timer) clearInterval(entry.timer)
  entry.timer = undefined
}

/** One scanner per network + contract, shared by every component on every page. */
function scannerFor(net: NetworkCfg, tenor: Address, fallbackClient: PublicClient): Entry {
  const key = `${net.chainId}:${tenor.toLowerCase()}`
  const hit = entries.get(key)
  if (hit) return hit
  const client = net.deployBlock !== undefined ? scanClient(net) : fallbackClient
  const entry: Entry = {
    users: 0,
    scanner: new LogScanner({
      storageKey: `tenor.scan.v1:${key}`,
      from: net.deployBlock,
      lookback: FALLBACK_LOOKBACK,
      minIntervalMs: MIN_INTERVAL_MS,
      storage: browserStorage(),
      getHead: () => client.getBlockNumber(),
      getLogs: async (fromBlock, toBlock) => {
        // Filter by address only. A topic0 list of every event is rejected by the Arc RPC as "range too large".
        const logs = await client.getLogs({ address: tenor, fromBlock, toBlock })
        return logs
      },
    }),
  }
  entries.set(key, entry)
  return entry
}

export interface Activity extends ScanSnapshot {
  /** True until the first window has been read (or the cache was loaded). */
  loading: boolean
}

const EMPTY: Activity = { logs: [], from: 0n, head: 0n, progress: 0, running: false, complete: false, rateLimited: false, requests: 0, loading: false }
const noopSubscribe = () => () => undefined
const emptySnapshot = () => EMPTY

/**
 * Tenor events from the deployment block to head. Every caller shares one scan: it streams newest windows first, resumes from a
 * local cache on repeat visits, and afterwards only polls for new blocks.
 */
export function useActivity(): Activity {
  const { net, client } = useNet()
  const entry = useMemo(() => (net.tenor ? scannerFor(net, net.tenor, client) : undefined), [net, client])
  const snap = useSyncExternalStore(entry ? entry.scanner.subscribe : noopSubscribe, entry ? entry.scanner.getSnapshot : emptySnapshot)

  useEffect(() => {
    if (!entry) return
    acquire(entry)
    return () => release(entry)
  }, [entry])

  if (!entry) return EMPTY
  return { ...snap, loading: !snap.complete && snap.logs.length === 0 && snap.progress < 100 }
}

/** One-off scan of [from, to] with no cache (scripts and tests). */
export async function scanLogs(client: PublicClient, tenor: Address, from: bigint, to: bigint): Promise<TenorLog[]> {
  const scanner = new LogScanner({
    storageKey: 'unused',
    from,
    storage: null,
    getHead: () => Promise.resolve(to),
    getLogs: async (fromBlock, toBlock) => await client.getLogs({ address: tenor, fromBlock, toBlock }),
  })
  await scanner.scan()
  return scanner.getSnapshot().logs
}
