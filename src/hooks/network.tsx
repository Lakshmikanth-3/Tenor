import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPublicClient, http, type PublicClient } from 'viem'
import { useAccount } from 'wagmi'
import { NETWORKS, defaultNetwork, type NetworkCfg, type NetworkKey } from '@/lib/networks'

interface NetCtx {
  net: NetworkCfg
  setKey: (k: NetworkKey) => void
  client: PublicClient
}

const Ctx = createContext<NetCtx | undefined>(undefined)

const clients: Partial<Record<NetworkKey, PublicClient>> = {}

function clientFor(net: NetworkCfg): PublicClient {
  let c = clients[net.key]
  if (!c) {
    c = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) })
    clients[net.key] = c
  }
  return c
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [key, setKeyState] = useState<NetworkKey>(defaultNetwork)
  const setKey = useCallback((k: NetworkKey) => {
    localStorage.setItem('tenor.network', k)
    setKeyState(k)
  }, [])
  const value = useMemo<NetCtx>(() => {
    const net = NETWORKS[key]
    return { net, setKey, client: clientFor(net) }
  }, [key, setKey])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNet(): NetCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNet outside NetworkProvider')
  return v
}

/** Wallet state relative to the selected network. */
export function useWallet() {
  const { net } = useNet()
  const { address, chainId, isConnected } = useAccount()
  return {
    address,
    isConnected,
    walletChainId: chainId,
    wrongNetwork: isConnected && chainId !== net.chainId,
  }
}
