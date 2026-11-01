import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useAccount, useConfig, useSendTransaction, useSwitchChain } from 'wagmi'
import { getAccount, sendCalls, waitForCallsStatus } from 'wagmi/actions'
import { decodeRevert, isUserRejection } from '@/lib/errors'
import type { Call } from '@/lib/calls'
import { notifyTx } from '@/lib/notify'
import { balanceSlot } from '@/lib/refusal'
import type { Step } from '@/lib/steps'
import { txUrl } from '@/lib/networks'
import { shortAddr } from '@/lib/math'
import { recordTx } from '@/lib/txstore'
import { useAtomic } from './useAtomic'
import { useNet } from './network'

export type TxPhase = 'idle' | 'simulating' | 'wallet' | 'confirming' | 'done' | 'error'

export interface TrackedStep {
  label: string
  reason: string
  note?: string
}

export interface TxState {
  phase: TxPhase
  label?: string
  hash?: string
  error?: string
  errorName?: string
  /** Multi-step flows: the steps, which one is current, and whether they go to the wallet as one atomic batch. */
  steps?: TrackedStep[]
  stepIndex?: number
  batched?: boolean
  /** Account the flow started with, and the account the wallet is on now. */
  required?: Address
  active?: Address
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

const single = (label: string, call: Call): Step => ({ id: label, kind: 'settle', label, reason: '', call })

/**
 * Runs wallet transactions on the selected network. Every call is simulated first, so a call that would fail never opens the wallet.
 * Multi-step plans go to the wallet as one atomic EIP-5792 batch when the wallet supports it, and as sequential transactions otherwise.
 */
export function useTx() {
  const { net, client } = useNet()
  const config = useConfig()
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const qc = useQueryClient()
  const atomic = useAtomic()
  const [state, setState] = useState<TxState>({ phase: 'idle' })

  const runSteps = useCallback(
    async (steps: Step[]): Promise<boolean> => {
      if (steps.length === 0) return true
      const required = address
      const label = steps.length === 1 ? steps[0].label : steps[steps.length - 1].label
      const tracked: TrackedStep[] = steps.map((s) => ({ label: s.label, reason: s.reason, note: s.note }))
      const fail = (error: string, errorName?: string, hash?: string, stepIndex?: number) =>
        setState((s) => ({ ...s, phase: 'error', label, error, errorName, hash, stepIndex: stepIndex ?? s.stepIndex }))
      if (!required) {
        setState({ phase: 'error', label, error: 'Connect your wallet first.' })
        return false
      }
      // The wallet may be on another account than the one that started the flow: say which, before anything is sent.
      const accountGuard = (): boolean => {
        const active = getAccount(config).address
        if (!same(active, required)) {
          setState((s) => ({
            ...s,
            phase: 'error',
            errorName: 'WrongAccount',
            error: `Your wallet is on ${active ? shortAddr(active) : 'no account'}, but this action needs ${shortAddr(required)}. Switch back to ${shortAddr(required)} in your wallet, then try again.`,
            active,
            required,
          }))
          return false
        }
        return true
      }
      const simulate = async (step: Step, index: number, batched: boolean): Promise<boolean> => {
        const prior = steps.slice(0, index)
        // In a batch the earlier steps have not run yet. Where a step cannot be simulated honestly, rely on the planner's checks.
        if (batched && step.kind === 'deposit' && prior.some((p) => p.kind === 'approve')) return true
        if (batched && step.kind === 'fundLeg' && prior.some((p) => p.kind === 'approve')) return true
        const override =
          batched && step.assume && net.tenor
            ? [{ address: net.tenor, stateDiff: [balanceSlot(required, step.assume.plainUsdc)] }]
            : undefined
        try {
          await client.call({ account: required, to: step.call.to, data: step.call.data, ...(override ? { stateOverride: override } : {}) })
          return true
        } catch (e) {
          const d = decodeRevert(e)
          setState((s) => ({ ...s, phase: 'error', error: d.message, errorName: d.name, stepIndex: index }))
          return false
        }
      }

      try {
        if (chainId !== net.chainId) await switchChainAsync({ chainId: net.chainId })
        const base: TxState = { phase: 'simulating', label, steps: tracked, stepIndex: 0, required, active: getAccount(config).address }

        // Atomic batch: one wallet confirmation for the whole plan. Any failure before the wallet accepted it falls back to sequential.
        if (atomic && steps.length > 1) {
          setState({ ...base, batched: true })
          let submitted = false
          try {
            if (!accountGuard()) return false
            for (let i = 0; i < steps.length; i++) {
              if (!(await simulate(steps[i], i, true))) return false
            }
            setState({ ...base, batched: true, phase: 'wallet' })
            const { id } = await sendCalls(config, {
              account: required,
              chainId: net.chainId,
              calls: steps.map((s) => ({ to: s.call.to, data: s.call.data })),
              forceAtomic: true,
            })
            submitted = true
            setState({ ...base, batched: true, phase: 'confirming' })
            const result = await waitForCallsStatus(config, { id, timeout: 120_000 })
            const receipts = result.receipts ?? []
            for (const r of receipts) {
              recordTx({ hash: r.transactionHash, label, chainId: net.chainId, ts: Date.now(), status: r.status === 'success' ? 'success' : 'reverted' })
            }
            const hash = receipts[receipts.length - 1]?.transactionHash
            if (result.status !== 'success') {
              fail('The batched transaction reverted onchain. Nothing was changed.', undefined, hash)
              return false
            }
            if (hash) notifyTx(label, txUrl(net, hash))
            setState({ ...base, batched: true, phase: 'done', hash, stepIndex: steps.length })
            await qc.invalidateQueries()
            return true
          } catch (e) {
            if (isUserRejection(e)) {
              setState({ phase: 'idle' })
              return false
            }
            if (submitted) {
              // The wallet took the batch; never send it again. Refresh and tell the truth.
              await qc.invalidateQueries()
              fail('The wallet accepted the batch but its status could not be confirmed. Check your transactions, then refresh.')
              return false
            }
            // Wallet does not really support it: fall through to the sequential flow.
          }
        }

        setState({ ...base, batched: false })
        let lastHash: string | undefined
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]
          const here: TxState = { ...base, batched: false, stepIndex: i }
          setState({ ...here, phase: 'simulating' })
          if (!accountGuard()) return false
          if (!(await simulate(step, i, false))) return false
          setState({ ...here, phase: 'wallet', hash: undefined })
          const hash = await sendTransactionAsync({ to: step.call.to, data: step.call.data, chainId: net.chainId, account: required })
          setState({ ...here, phase: 'confirming', hash })
          const receipt = await client.waitForTransactionReceipt({ hash })
          recordTx({ hash, label: step.label, chainId: net.chainId, ts: Date.now(), status: receipt.status === 'success' ? 'success' : 'reverted' })
          if (receipt.status !== 'success') {
            fail('The transaction reverted onchain.', undefined, hash, i)
            return false
          }
          lastHash = hash
          notifyTx(step.label, txUrl(net, hash))
          await qc.invalidateQueries()
        }
        setState({ ...base, batched: false, phase: 'done', hash: lastHash, stepIndex: steps.length })
        return true
      } catch (e) {
        if (isUserRejection(e)) {
          setState({ phase: 'idle' })
          return false
        }
        const d = decodeRevert(e)
        fail(d.message, d.name)
        return false
      }
    },
    [address, atomic, chainId, client, config, net, qc, sendTransactionAsync, switchChainAsync],
  )

  /** One transaction. Same safety as runSteps: simulated first, account checked, toast on confirmation. */
  const run = useCallback((label: string, call: Call) => runSteps([single(label, call)]), [runSteps])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])
  return { state, run, runSteps, reset, atomic, busy: ['simulating', 'wallet', 'confirming'].includes(state.phase) }
}
