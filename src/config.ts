/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { requireChain } from './onchain-facts'

const testnetRpc = requireChain(arcTestnet.id).rpcUrls[0]
const mainnetRpc = requireChain(arc.id).rpcUrls[0]

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, testnetRpc)
registerChain(arc.id, mainnetRpc)

export const config = createConfig({
  chains: [arcTestnet, arc, mainnet], // Ethereum mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(testnetRpc),
    [arc.id]: http(mainnetRpc),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
