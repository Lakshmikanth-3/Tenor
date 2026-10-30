import { useQuery } from '@tanstack/react-query'
import { erc20Abi, type Address, type ContractFunctionReturnType } from 'viem'
import { tenorAbi } from '@/lib/tenorAbi'
import { feedAbi } from '@/lib/feedAbi'
import { vaultAbi } from '@/lib/vaultAbi'
import { usycAdapterAbi } from '@/lib/usycAdapterAbi'
import { decodeRevert } from '@/lib/errors'
import { nowSec } from '@/lib/math'
import { useNet } from './network'

export type Trade = ContractFunctionReturnType<typeof tenorAbi, 'view', 'getTrade'>

export function useParams() {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['params', net.key, net.tenor],
    enabled: !!net.tenor,
    refetchInterval: 15_000,
    queryFn: async () => {
      const address = net.tenor as Address
      const r = <N extends 'owner' | 'feed' | 'rUsd' | 'rEur' | 'initialMarginBps' | 'maintenanceBps' | 'bandBps' | 'markInterval' | 'cureWindow' | 'deliveryGrace' | 'minTenor' | 'maxNotionalUsd6' | 'maxStaleness'>(
        functionName: N,
      ) => client.readContract({ address, abi: tenorAbi, functionName })
      const [owner, feed, rUsd, rEur, initialMarginBps, maintenanceBps, bandBps, markInterval, cureWindow, deliveryGrace, minTenor, maxNotionalUsd6, maxStaleness] =
        await Promise.all([
          r('owner'), r('feed'), r('rUsd'), r('rEur'), r('initialMarginBps'), r('maintenanceBps'), r('bandBps'),
          r('markInterval'), r('cureWindow'), r('deliveryGrace'), r('minTenor'), r('maxNotionalUsd6'), r('maxStaleness'),
        ])
      return { owner, feed, rUsd, rEur, initialMarginBps, maintenanceBps, bandBps, markInterval, cureWindow, deliveryGrace, minTenor, maxNotionalUsd6, maxStaleness }
    },
  })
}

export type Params = NonNullable<ReturnType<typeof useParams>['data']>

/** Live EUR/USD from the feed that Tenor actually reads. */
export function useSpot() {
  const { net, client } = useNet()
  const params = useParams()
  const feed = params.data?.feed
  const staleness = params.data?.maxStaleness
  return useQuery({
    queryKey: ['spot', net.key, feed],
    enabled: !!feed && staleness !== undefined,
    refetchInterval: 8_000,
    queryFn: async () => {
      const [round, decimals] = await Promise.all([
        client.readContract({ address: feed as Address, abi: feedAbi, functionName: 'latestRoundData' }),
        client.readContract({ address: feed as Address, abi: feedAbi, functionName: 'decimals' }),
      ])
      const answer = round[1]
      const updatedAt = round[3]
      const spot1e18 = answer > 0n ? answer * 10n ** BigInt(18 - decimals) : 0n
      const age = nowSec() - Number(updatedAt)
      return { answer, updatedAt, decimals, spot1e18, age, stale: age > Number(staleness), bad: answer <= 0n }
    },
  })
}

export function useQuoteView(notionalUsd6: bigint, tenorSeconds: bigint) {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['quote', net.key, notionalUsd6.toString(), tenorSeconds.toString()],
    enabled: !!net.tenor && notionalUsd6 > 0n && tenorSeconds > 0n,
    refetchInterval: 10_000,
    retry: false,
    queryFn: async () => {
      try {
        const q = await client.readContract({
          address: net.tenor as Address,
          abi: tenorAbi,
          functionName: 'quote',
          args: [notionalUsd6, tenorSeconds],
        })
        return { ok: true as const, spot: q[0], forwardFair: q[1], bandLow: q[2], bandHigh: q[3], initialMargin: q[4] }
      } catch (e) {
        const d = decodeRevert(e)
        return { ok: false as const, errorName: d.name, message: d.message }
      }
    },
  })
}

export function useBalances(account?: Address) {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['balances', net.key, account],
    enabled: !!account && !!net.tenor && !!net.eurc,
    refetchInterval: 8_000,
    queryFn: async () => {
      const tenor = net.tenor as Address
      const eurc = net.eurc as Address
      const holder = account as Address
      const [freeUsdc, creditEurc, walletUsdc, walletEurc, allowUsdc, allowEurc] = await Promise.all([
        client.readContract({ address: tenor, abi: tenorAbi, functionName: 'freeMarginOf', args: [holder] }),
        client.readContract({ address: tenor, abi: tenorAbi, functionName: 'eurcBalanceOf', args: [holder] }),
        client.readContract({ address: net.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }),
        client.readContract({ address: eurc, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }),
        client.readContract({ address: net.usdc, abi: erc20Abi, functionName: 'allowance', args: [holder, tenor] }),
        client.readContract({ address: eurc, abi: erc20Abi, functionName: 'allowance', args: [holder, tenor] }),
      ])
      return { freeUsdc, creditEurc, walletUsdc, walletEurc, allowUsdc, allowEurc }
    },
  })
}

export type VaultKind = 'usyc' | 'mock' | 'unknown'

/**
 * Yield-bearing margin state for one account. The vault is whatever the Tenor owner configured: the Circle USYC adapter
 * (detected by its teller()) or the testnet mock. Idle when no vault is configured.
 */
export function useYield(account?: Address) {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['yield', net.key, net.tenor, account],
    enabled: !!net.tenor,
    refetchInterval: 8_000,
    queryFn: async () => {
      const tenor = net.tenor as Address
      const t = { address: tenor, abi: tenorAbi } as const
      const [vault, active] = await Promise.all([
        client.readContract({ ...t, functionName: 'yieldVault' }),
        client.readContract({ ...t, functionName: 'yieldActive' }),
      ])
      if (vault === '0x0000000000000000000000000000000000000000') return { vault: undefined }
      const holder = account as Address
      const acct = <T,>(zero: T, read: () => Promise<T>): Promise<T> => (account ? read() : Promise.resolve(zero))
      const adapter = { address: vault, abi: usycAdapterAbi } as const
      const mockV = { address: vault, abi: vaultAbi } as const
      const kind: VaultKind = await client.readContract({ ...adapter, functionName: 'teller' }).then(
        () => 'usyc' as const,
        () => client.readContract({ ...mockV, functionName: 'apyBps' }).then(() => 'mock' as const, () => 'unknown' as const),
      )
      const [mode, shares, free, inVault, earned, plain] = await Promise.all([
        acct(false, () => client.readContract({ ...t, functionName: 'yieldMode', args: [holder] })),
        acct(0n, () => client.readContract({ ...t, functionName: 'vaultShares', args: [holder] })),
        acct(0n, () => client.readContract({ ...t, functionName: 'freeMarginOf', args: [holder] })),
        acct(0n, () => client.readContract({ ...t, functionName: 'vaultValueOf', args: [holder] })),
        acct(0n, () => client.readContract({ ...t, functionName: 'yieldEarned', args: [holder] })),
        acct(0n, () => client.readContract({ ...t, functionName: 'marginOf', args: [holder] })),
      ])
      // USDC paid for 1 whole USYC (6 decimals) at the Teller's price, read through the adapter.
      const usycPrice = kind === 'usyc' ? await client.readContract({ ...adapter, functionName: 'convertToAssets', args: [1_000_000n] }).catch(() => undefined) : undefined
      const mock =
        kind === 'mock'
          ? await Promise.all([
              client.readContract({ ...mockV, functionName: 'apyBps' }),
              client.readContract({ ...mockV, functionName: 'reserveShortfall' }),
              client.readContract({ ...mockV, functionName: 'owner' }),
            ])
          : undefined
      return {
        vault,
        kind,
        active,
        mode,
        shares,
        free,
        inVault,
        earned,
        plain,
        usycPrice,
        apyBps: mock?.[0] ?? 0n,
        shortfall: mock?.[1] ?? 0n,
        owner: mock?.[2],
      }
    },
  })
}

export interface TradeRow {
  id: bigint
  trade: Trade
  forwardNow?: bigint
  forwardError?: string
}

export function useTrades(account?: Address) {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['trades', net.key, account],
    enabled: !!account && !!net.tenor,
    refetchInterval: 8_000,
    queryFn: async (): Promise<TradeRow[]> => {
      const tenor = net.tenor as Address
      const ids = await client.readContract({ address: tenor, abi: tenorAbi, functionName: 'tradesOf', args: [account as Address] })
      const rows = await Promise.all(
        [...ids].reverse().map(async (id): Promise<TradeRow> => {
          const trade = await client.readContract({ address: tenor, abi: tenorAbi, functionName: 'getTrade', args: [id] })
          if (trade.status !== 1) return { id, trade }
          try {
            const forwardNow = await client.readContract({ address: tenor, abi: tenorAbi, functionName: 'forwardNow', args: [id] })
            return { id, trade, forwardNow }
          } catch (e) {
            return { id, trade, forwardError: decodeRevert(e).name ?? 'unavailable' }
          }
        }),
      )
      return rows
    },
  })
}

export function useNonceUsed(dealer?: Address, nonce?: bigint) {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['nonce', net.key, dealer, nonce?.toString()],
    enabled: !!net.tenor && !!dealer && nonce !== undefined,
    refetchInterval: 10_000,
    queryFn: () =>
      client.readContract({ address: net.tenor as Address, abi: tenorAbi, functionName: 'nonceUsed', args: [dealer as Address, nonce as bigint] }),
  })
}

export function useIsDealer(account?: Address) {
  const { net, client } = useNet()
  return useQuery({
    queryKey: ['isDealer', net.key, account],
    enabled: !!net.tenor && !!account,
    refetchInterval: 15_000,
    queryFn: () =>
      client.readContract({ address: net.tenor as Address, abi: tenorAbi, functionName: 'dealers', args: [account as Address] }),
  })
}
