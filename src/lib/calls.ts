import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem'
import { tenorAbi } from './tenorAbi'
import { feedAbi } from './feedAbi'
import { quoteTuple, type QuoteMsg } from './quote'

export interface RiskParamsArg {
  initialMarginBps: bigint
  maintenanceBps: bigint
  bandBps: bigint
  markInterval: bigint
  cureWindow: bigint
  deliveryGrace: bigint
  minTenor: bigint
  maxNotionalUsd6: bigint
  maxStaleness: bigint
}

export interface Call {
  to: Address
  data: Hex
}

const t = (to: Address) => ({
  depositMargin: (amount: bigint): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'depositMargin', args: [amount] }),
  }),
  withdraw: (): Call => ({ to, data: encodeFunctionData({ abi: tenorAbi, functionName: 'withdraw' }) }),
  withdrawEurc: (): Call => ({ to, data: encodeFunctionData({ abi: tenorAbi, functionName: 'withdrawEurc' }) }),
  open: (q: QuoteMsg, sig: Hex): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'open', args: [quoteTuple(q), sig] }),
  }),
  mark: (id: bigint): Call => ({ to, data: encodeFunctionData({ abi: tenorAbi, functionName: 'mark', args: [id] }) }),
  topUp: (id: bigint, amount: bigint): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'topUp', args: [id, amount] }),
  }),
  withdrawExcess: (id: bigint, amount: bigint): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'withdrawExcess', args: [id, amount] }),
  }),
  closeOut: (id: bigint): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'closeOut', args: [id] }),
  }),
  fundLeg: (id: bigint): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'fundLeg', args: [id] }),
  }),
  settle: (id: bigint): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'settle', args: [id] }),
  }),
  setRiskParams: (p: RiskParamsArg): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'setRiskParams', args: [p] }),
  }),
  cancelNonce: (nonce: bigint): Call => ({
    to,
    data: encodeFunctionData({ abi: tenorAbi, functionName: 'cancelNonce', args: [nonce] }),
  }),
})

export const tenorCalls = t

export const approveCall = (token: Address, spender: Address, amount: bigint): Call => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
})

export const setAnswerCall = (feed: Address, answer: bigint): Call => ({
  to: feed,
  data: encodeFunctionData({ abi: feedAbi, functionName: 'setAnswer', args: [answer] }),
})
