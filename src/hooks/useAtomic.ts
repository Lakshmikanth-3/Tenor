import { useQuery } from '@tanstack/react-query'
import { useAccount, useConfig } from 'wagmi'
import { getCapabilities } from 'wagmi/actions'
import { supportsAtomic } from '@/lib/steps'
import { useNet } from './network'

/**
 * Does the connected wallet batch atomically (EIP-5792) on the selected chain? Any failure means "no": the sequential flow is
 * the fallback and must never be broken by a wallet that lacks wallet_getCapabilities.
 */
export function useAtomic(): boolean {
  const config = useConfig()
  const { net } = useNet()
  const { address, connector, isConnected } = useAccount()
  const q = useQuery({
    queryKey: ['atomicCaps', net.chainId, address, connector?.uid],
    enabled: isConnected && !!address,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const caps = await getCapabilities(config, { account: address, chainId: net.chainId })
        return supportsAtomic(caps, net.chainId)
      } catch {
        return false
      }
    },
  })
  return q.data === true
}
