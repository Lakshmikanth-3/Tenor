import { useQuery } from '@tanstack/react-query'
import { parseEventLogs, type Address, type GetContractEventsReturnType, type PublicClient } from 'viem'
import { tenorAbi } from '@/lib/tenorAbi'
import { useNet } from './network'

export type TenorLog = GetContractEventsReturnType<typeof tenorAbi>[number]

/** Every getLogs request spans fewer than 10,000 blocks. */
const WINDOW = 9_000n
const CONCURRENCY = 4

interface Cache {
  next: bigint
  logs: TenorLog[]
}
const caches = new Map<string, Cache>()

export async function scanLogs(client: PublicClient, tenor: Address, from: bigint, to: bigint): Promise<TenorLog[]> {
  const windows: [bigint, bigint][] = []
  for (let start = from; start <= to; start += WINDOW) {
    const end = start + WINDOW - 1n > to ? to : start + WINDOW - 1n
    windows.push([start, end])
  }
  const out: TenorLog[] = []
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      windows.slice(i, i + CONCURRENCY).map(async ([fromBlock, toBlock]) => {
        // Filter by address only. A topic0 list of every event is rejected by the Arc RPC as "range too large".
        const raw = await client.getLogs({ address: tenor, fromBlock, toBlock })
        return parseEventLogs({ abi: tenorAbi, logs: raw })
      }),
    )
    for (const b of batch) out.push(...b)
  }
  return out
}

/** Tenor events from the deployment block to head, scanned incrementally in windows under 10,000 blocks. */
export function useActivity() {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['activity', net.key, net.tenor],
    enabled: !!net.tenor,
    refetchInterval: 10_000,
    queryFn: async () => {
      const tenor = net.tenor as Address
      const key = `${net.chainId}:${tenor}`
      const head = await client.getBlockNumber()
      const cached = caches.get(key)
      const start = cached?.next ?? net.deployBlock ?? (head > WINDOW ? head - WINDOW : 0n)
      const fresh = start <= head ? await scanLogs(client, tenor, start, head) : []
      const next: Cache = { next: head + 1n, logs: [...(cached?.logs ?? []), ...fresh] }
      caches.set(key, next)
      return { logs: next.logs, head, from: net.deployBlock ?? start }
    },
  })
}
