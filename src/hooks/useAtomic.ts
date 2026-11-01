import { useQuery } from '@tanstack/react-query'
import { useAccount, useConfig } from 'wagmi'
import { getCapabilities } from 'wagmi/actions'
import { atomicBatchingAllowed, canBatchAtomically } from '@/lib/steps'
import { useNet } from './network'

/**
 * Does the connected wallet batch atomically (EIP-5792) on the selected chain? Always "no" on Arc (testnet 5042002 and mainnet
 * 5042): smart-account batches revert there, so the sequential flow is used. Elsewhere any failure also means "no": the sequential
 * flow is the fallback and must never be broken by a wallet that lacks wallet_getCapabilities.
 */
export function useAtomic(): boolean {
  const config = useConfig()
  const { net } = useNet()
  const { address, connector, isConnected } = useAccount()
  const q = useQuery({
    queryKey: ['atomicCaps', net.chainId, address, connector?.uid],
    enabled: isConnected && !!address && atomicBatchingAllowed(net.chainId),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const caps = await getCapabilities(config, { account: address, chainId: net.chainId })
        return canBatchAtomically(caps, net.chainId)
      } catch {
        return false
      }
    },
  })
  return atomicBatchingAllowed(net.chainId) && q.data === true
}
