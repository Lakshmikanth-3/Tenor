import { isAddress, type Address, type Chain } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { buildAddressExplorerUrl, buildTxExplorerUrl, getUsdc, requireChain } from '@/onchain-facts'

export type NetworkKey = 'testnet' | 'mainnet'

export interface NetworkCfg {
  key: NetworkKey
  label: string
  chainId: number
  chain: Chain
  isMainnet: boolean
  rpcUrl: string
  usdc: Address
  /** Tenor contract. Undefined when not deployed on this network. */
  tenor?: Address
  /** EUR/USD price source: MockAggregator on testnet, Chainlink on mainnet. */
  feed?: Address
  eurc?: Address
  deployBlock?: bigint
}

const env = import.meta.env as Record<string, string | undefined>

function addr(value: string | undefined): Address | undefined {
  const v = value?.trim()
  return v && isAddress(v) ? (v) : undefined
}

function block(value: string | undefined): bigint | undefined {
  const v = value?.trim()
  return v && /^\d+$/.test(v) ? BigInt(v) : undefined
}

function build(key: NetworkKey): NetworkCfg {
  const chain = key === 'mainnet' ? arc : arcTestnet
  const facts = requireChain(chain.id)
  const usdc = getUsdc(chain.id)
  if (!usdc) throw new Error(`USDC missing for chain ${chain.id}`)
  const suffix = key === 'mainnet' ? 'MAINNET' : 'TESTNET'
  return {
    key,
    label: key === 'mainnet' ? 'Arc Mainnet' : 'Arc Testnet',
    chainId: chain.id,
    chain,
    isMainnet: key === 'mainnet',
    rpcUrl: facts.rpcUrls[0],
    usdc: usdc.address as Address,
    tenor: addr(env[`VITE_TENOR_ADDRESS_${suffix}`] ?? env[`VITE_TENOR_${suffix}`]),
    feed: addr(env[`VITE_FEED_${suffix}`]),
    eurc: addr(env[`VITE_EURC_${suffix}`]),
    deployBlock: block(env[`VITE_DEPLOY_BLOCK_${suffix}`]),
  }
}

export const NETWORKS: Record<NetworkKey, NetworkCfg> = {
  testnet: build('testnet'),
  mainnet: build('mainnet'),
}

export function defaultNetwork(): NetworkKey {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('tenor.network') : null
  if (stored === 'testnet' || stored === 'mainnet') return stored
  return env.VITE_NETWORK_DEFAULT === 'mainnet' ? 'mainnet' : 'testnet'
}

export const txUrl = (net: NetworkCfg, hash: string) => buildTxExplorerUrl(net.chainId, hash)
export const addressUrl = (net: NetworkCfg, address: string) => buildAddressExplorerUrl(net.chainId, address)
