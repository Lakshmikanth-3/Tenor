import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useSendTransaction, useSwitchChain } from 'wagmi'
import { decodeRevert, isUserRejection } from '@/lib/errors'
import type { Call } from '@/lib/calls'
import { recordTx } from '@/lib/txstore'
import { useNet } from './network'

export type TxPhase = 'idle' | 'simulating' | 'wallet' | 'confirming' | 'done' | 'error'

export interface TxState {
  phase: TxPhase
  label?: string
  hash?: string
  error?: string
  errorName?: string
}

/** Runs one or more wallet transactions on the selected network, with a pre-flight simulation to surface contract errors. */
export function useTx() {
  const { net, client } = useNet()
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const qc = useQueryClient()
  const [state, setState] = useState<TxState>({ phase: 'idle' })

  const run = useCallback(
    async (label: string, call: Call): Promise<boolean> => {
      if (!address) {
        setState({ phase: 'error', label, error: 'Connect your wallet first.' })
        return false
      }
      try {
        if (chainId !== net.chainId) await switchChainAsync({ chainId: net.chainId })
        setState({ phase: 'simulating', label })
        try {
          await client.call({ account: address, to: call.to, data: call.data })
        } catch (e) {
          const d = decodeRevert(e)
          setState({ phase: 'error', label, error: d.message, errorName: d.name })
          return false
        }
        setState({ phase: 'wallet', label })
        const hash = await sendTransactionAsync({ to: call.to, data: call.data, chainId: net.chainId })
        setState({ phase: 'confirming', label, hash })
        const receipt = await client.waitForTransactionReceipt({ hash })
        recordTx({
          hash,
          label,
          chainId: net.chainId,
          ts: Date.now(),
          status: receipt.status === 'success' ? 'success' : 'reverted',
        })
        if (receipt.status !== 'success') {
          setState({ phase: 'error', label, hash, error: 'The transaction reverted onchain.' })
          return false
        }
        setState({ phase: 'done', label, hash })
        await qc.invalidateQueries()
        return true
      } catch (e) {
        if (isUserRejection(e)) {
          setState({ phase: 'idle' })
          return false
        }
        const d = decodeRevert(e)
        setState({ phase: 'error', label, error: d.message, errorName: d.name })
        return false
      }
    },
    [address, chainId, client, net.chainId, qc, sendTransactionAsync, switchChainAsync],
  )

  const reset = useCallback(() => setState({ phase: 'idle' }), [])
  return { state, run, reset, busy: ['simulating', 'wallet', 'confirming'].includes(state.phase) }
}
