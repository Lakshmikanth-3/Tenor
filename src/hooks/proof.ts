import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { tenorAbi } from '@/lib/tenorAbi'
import { usycAdapterAbi } from '@/lib/usycAdapterAbi'
import { useActivity, type TenorLog } from './activity'
import { useNet } from './network'

/** The events the Proof page lists, in the order its filter chips appear. */
export const PROOF_EVENTS = [
  'TradeOpened',
  'Marked',
  'MarginCalled',
  'MarginCured',
  'ClosedOut',
  'LegFunded',
  'Delivered',
  'DeliveryFailed',
  'CashSettled',
  'YieldDeposited',
  'YieldRedeemed',
  'MarginDeposited',
  'MarginWithdrawn',
] as const
export type ProofEvent = (typeof PROOF_EVENTS)[number]

export interface ProofRow {
  key: string
  block: bigint
  logIndex: number
  event: ProofEvent
  tradeId?: bigint
  /** 6-decimal token amount, when the event carries one. */
  amount?: bigint
  tx: string
}

const abs = (v: bigint) => (v < 0n ? -v : v)
const big = (v: unknown): bigint => (typeof v === 'bigint' ? v : 0n)

export function toRow(l: TenorLog): ProofRow | undefined {
  const base = { key: `${l.transactionHash}:${l.logIndex}`, block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash }
  const a = (l as { args?: Record<string, unknown> }).args ?? {}
  switch (l.eventName) {
    case 'TradeOpened':
      return { ...base, event: l.eventName, tradeId: big(a.tradeId), amount: big(a.notionalUsd6) }
    case 'Marked':
      return { ...base, event: l.eventName, tradeId: big(a.tradeId), amount: abs(big(a.vmMoved)) }
    case 'MarginCalled':
    case 'MarginCured':
    case 'Delivered':
      return { ...base, event: l.eventName, tradeId: big(a.tradeId) }
    case 'ClosedOut':
    case 'DeliveryFailed':
      return { ...base, event: l.eventName, tradeId: big(a.tradeId), amount: big(a.paidToNonDefaulter) }
    case 'LegFunded':
      return { ...base, event: l.eventName, tradeId: big(a.tradeId), amount: big(a.amount) }
    case 'CashSettled':
      return { ...base, event: l.eventName, tradeId: big(a.tradeId), amount: big(a.paidToWinner) }
    case 'YieldDeposited':
    case 'YieldRedeemed':
      return { ...base, event: l.eventName, amount: big(a.assets) }
    case 'MarginDeposited':
    case 'MarginWithdrawn':
      return { ...base, event: l.eventName, amount: big(a.amount) }
    default:
      return undefined
  }
}

export interface ProofTotals {
  opened: number
  delivered: number
  cashSettled: number
  deliveryFailed: number
  notionalUsd6: bigint
  usdcDelivered: bigint
  eurcDelivered: bigint
}

/** Aggregates over every scanned event, not just the 200 shown in the table. */
export function computeTotals(logs: TenorLog[], usdc: string, eurc: string | undefined): ProofTotals {
  const t: ProofTotals = { opened: 0, delivered: 0, cashSettled: 0, deliveryFailed: 0, notionalUsd6: 0n, usdcDelivered: 0n, eurcDelivered: 0n }
  const legs = new Map<string, { usdc: bigint; eurc: bigint }>()
  const delivered: bigint[] = []
  for (const l of logs) {
    const a = (l as { args?: Record<string, unknown> }).args ?? {}
    if (l.eventName === 'TradeOpened') {
      t.opened += 1
      t.notionalUsd6 += big(a.notionalUsd6)
    } else if (l.eventName === 'CashSettled') t.cashSettled += 1
    else if (l.eventName === 'DeliveryFailed') t.deliveryFailed += 1
    else if (l.eventName === 'Delivered') {
      t.delivered += 1
      delivered.push(big(a.tradeId))
    } else if (l.eventName === 'LegFunded') {
      const k = big(a.tradeId).toString()
      const cur = legs.get(k) ?? { usdc: 0n, eurc: 0n }
      const token = String(a.token).toLowerCase()
      if (token === usdc.toLowerCase()) cur.usdc += big(a.amount)
      else if (eurc && token === eurc.toLowerCase()) cur.eurc += big(a.amount)
      legs.set(k, cur)
    }
  }
  for (const id of delivered) {
    const leg = legs.get(id.toString())
    if (leg) {
      t.usdcDelivered += leg.usdc
      t.eurcDelivered += leg.eurc
    }
  }
  return t
}

const blockTimes = new Map<string, number>()

/** Block timestamps (seconds) for the given blocks, fetched once and cached. */
export function useBlockTimes(blocks: bigint[]) {
  const { net, client } = useNet()
  const key = blocks.map(String).join(',')
  return useQuery({
    queryKey: ['blockTimes', net.chainId, key],
    enabled: blocks.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const missing = blocks.filter((b) => !blockTimes.has(`${net.chainId}:${b}`))
      for (let i = 0; i < missing.length; i += 6) {
        await Promise.all(
          missing.slice(i, i + 6).map(async (b) => {
            const blk = await client.getBlock({ blockNumber: b })
            blockTimes.set(`${net.chainId}:${b}`, Number(blk.timestamp))
          }),
        )
      }
      return Object.fromEntries(blocks.map((b) => [b.toString(), blockTimes.get(`${net.chainId}:${b}`)]))
    },
  })
}

/** Contract addresses read live from Tenor, plus the USDC currently held in the yield vault. */
export function useProofChain() {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['proofChain', net.key, net.tenor],
    enabled: !!net.tenor,
    refetchInterval: 15_000,
    queryFn: async () => {
      const t = { address: net.tenor as Address, abi: tenorAbi } as const
      const [vault, feed, eurc, shares] = await Promise.all([
        client.readContract({ ...t, functionName: 'yieldVault' }),
        client.readContract({ ...t, functionName: 'feed' }),
        client.readContract({ ...t, functionName: 'EURC' }),
        client.readContract({ ...t, functionName: 'totalVaultShares' }),
      ])
      const hasVault = vault !== '0x0000000000000000000000000000000000000000'
      const inVault = hasVault && shares > 0n ? await client.readContract({ address: vault, abi: usycAdapterAbi, functionName: 'convertToAssets', args: [shares] }).catch(() => undefined) : 0n
      return { vault: hasVault ? vault : undefined, feed, eurc, shares, inVault }
    },
  })
}

/** Newest-first rows, the totals, and scan progress, all from one incremental log scan. */
export function useProofData(filter: Set<ProofEvent>, usdc: string, eurc: string | undefined) {
  const activity = useActivity()
  const logs = activity.logs
  const all = useMemo(() => {
    const rows = logs.map(toRow).filter((r): r is ProofRow => !!r)
    return rows.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block < b.block ? 1 : -1))
  }, [logs])
  const counts = useMemo(() => {
    const c: Partial<Record<ProofEvent, number>> = {}
    for (const r of all) c[r.event] = (c[r.event] ?? 0) + 1
    return c
  }, [all])
  const rows = useMemo(() => all.filter((r) => filter.size === 0 || filter.has(r.event)).slice(0, 200), [all, filter])
  const totals = useMemo(() => computeTotals(logs, usdc, eurc), [logs, usdc, eurc])
  return { activity, rows, counts, totals, total: all.length }
}
