/**
 * End-to-end run against Arc Testnet with real transactions.
 *
 * The deployed Tenor is owned by your wallet and only your wallet is an allowlisted dealer, so this
 * script deploys its own copy of the same bytecode (owner and dealer = a throwaway key), then drives
 * the same library code the web app uses: quote signing, share-link codec, call encoders, error
 * decoding, log scanning and the refusal scenarios.
 *
 *   bun run scripts/e2e.ts            (keys in /tmp/e2e/keys.json)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEventLogs,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { tenorAbi } from '../src/lib/tenorAbi'
import { feedAbi } from '../src/lib/feedAbi'
import { approveCall, setAnswerCall, tenorCalls, type Call } from '../src/lib/calls'
import { decodeQuote, encodeQuote, quoteTypedData, randomNonce, type QuoteMsg } from '../src/lib/quote'
import { decodeRevert } from '../src/lib/errors'
import { eurcFor, fmtRate, fmtToken, hedgerMtm, nowSec } from '../src/lib/math'
import { SCENARIOS } from '../src/lib/refusal'
import { scanLogs } from '../src/hooks/activity'
import { NETWORKS } from '../src/lib/networks'

const net = NETWORKS.testnet
const keys = JSON.parse(readFileSync('/tmp/e2e/keys.json', 'utf8')) as { dealer: Hex; hedger: Hex }
const dealer = privateKeyToAccount(keys.dealer)
const hedger = privateKeyToAccount(keys.hedger)
const pc = createPublicClient({ chain: arcTestnet, transport: http(net.rpcUrl) })
const wc = (account: typeof dealer) => createWalletClient({ account, chain: arcTestnet, transport: http(net.rpcUrl) })
const EURC = net.eurc as Address
const USDC = net.usdc

interface Row {
  step: string
  hash?: string
  status: string
  gas?: bigint
  note?: string
}
const rows: Row[] = []
const checks: { name: string; ok: boolean; detail: string }[] = []
const log = (s: string) => console.log(s)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitUntil(ts: number, why: string) {
  const left = ts - nowSec()
  if (left > 0) {
    log(`... waiting ${left}s for ${why}`)
    await sleep(left * 1000 + 3000)
  }
}
function check(name: string, ok: boolean, detail = '') {
  checks.push({ name, ok, detail })
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`)
}

async function send(who: typeof dealer, step: string, call: Call, expectRevert?: string) {
  const sim = await pc.call({ account: who.address, to: call.to, data: call.data }).then(
    () => undefined,
    (e: unknown) => decodeRevert(e),
  )
  if (sim) {
    rows.push({ step: `${step} (eth_call)`, status: `reverted: ${sim.name ?? sim.message}` })
    check(`${step} refused`, expectRevert === sim.name, `${sim.name}`)
    return undefined
  }
  if (expectRevert) check(`${step} refused`, false, 'call succeeded unexpectedly')
  const hash = await wc(who).sendTransaction({ to: call.to, data: call.data })
  const receipt = await pc.waitForTransactionReceipt({ hash })
  rows.push({ step, hash, status: receipt.status, gas: receipt.gasUsed })
  log(`TX ${step}: ${hash} ${receipt.status} gas ${receipt.gasUsed}`)
  if (receipt.status !== 'success') throw new Error(`${step} reverted`)
  return receipt
}

async function deploy(who: typeof dealer, step: string, abi: readonly unknown[], bytecode: Hex, args: unknown[]) {
  const hash = await wc(who).deployContract({ abi: abi as never, bytecode, args: args })
  const receipt = await pc.waitForTransactionReceipt({ hash })
  rows.push({ step, hash, status: receipt.status, gas: receipt.gasUsed, note: receipt.contractAddress ?? '' })
  log(`DEPLOY ${step}: ${receipt.contractAddress} ${hash}`)
  return receipt
}

const art = (n: string) => JSON.parse(readFileSync(`contracts/out/${n}.sol/${n}.json`, 'utf8')) as { bytecode: { object: Hex } }

async function tail(tenor: Address, deployBlock: bigint) {
  // log scanning in windows under 10,000 blocks
  const head = await pc.getBlockNumber()
  const logs = await scanLogs(pc, tenor, deployBlock, head)
  const names: string[] = [...new Set(logs.map((l) => l.eventName))]
  check('getLogs windows from the deploy block return the lifecycle events', ['TradeOpened', 'Marked', 'MarginCalled', 'MarginCured', 'ClosedOut', 'LegFunded', 'Delivered', 'CashSettled'].every((n) => names.includes(n)), names.join(', '))
  const userLogs = await scanLogs(pc, net.tenor as Address, net.deployBlock as bigint, head)
  log(`user's deployed Tenor: ${userLogs.length} events scanned over ${(head - (net.deployBlock as bigint)).toString()} blocks in windows <= 9000`)

  // 9. refusal room against the deployed contract (read-only)
  for (const s of SCENARIOS) {
    const o = await s.run({ client: pc, tenor: net.tenor as Address })
    const ok = s.expected ? o.kind === 'revert' && o.errorName === s.expected : o.kind === 'pass'
    check(`Refusal room: ${s.title}`, ok, o.kind === 'revert' ? (o.errorName ?? o.message) : o.kind === 'pass' ? o.detail : o.message)
  }

}

async function main() {
  if (process.argv.includes('--tail')) {
    const prev = JSON.parse(readFileSync('/tmp/e2e/results-main.json', 'utf8')) as { rows: Row[] }
    const tenorRow = prev.rows.find((r) => r.step === 'Deploy Tenor')
    const rc = await pc.getTransactionReceipt({ hash: tenorRow?.hash as Hex })
    await tail(rc.contractAddress as Address, rc.blockNumber)
    writeFileSync('/tmp/e2e/results-tail.json', JSON.stringify({ checks }, null, 2))
    log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed`)
    return
  }
  log(`dealer/owner ${dealer.address}\nhedger       ${hedger.address}`)
  const [d0, h0] = await Promise.all([
    pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [dealer.address] }),
    pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [hedger.address] }),
  ])
  const de0 = await pc.readContract({ address: EURC, abi: erc20Abi, functionName: 'balanceOf', args: [dealer.address] })
  log(`start balances: dealer ${fmtToken(d0)} USDC / ${fmtToken(de0)} EURC, hedger ${fmtToken(h0)} USDC`)

  // 1. deploy a private copy of the contracts
  const feedRc = await deploy(dealer, 'Deploy MockAggregator', feedAbi, art('MockAggregator').bytecode.object, [dealer.address, 111_500_000n])
  const feed = feedRc.contractAddress as Address
  const tenorRc = await deploy(dealer, 'Deploy Tenor', tenorAbi, art('Tenor').bytecode.object, [
    dealer.address, EURC, feed, 40_000_000_000_000_000n, 20_000_000_000_000_000n, [dealer.address],
  ])
  const tenor = tenorRc.contractAddress as Address
  const deployBlock = tenorRc.blockNumber
  const t = tenorCalls(tenor)

  // 2. margin: approve + deposit
  await send(hedger, 'Hedger: allow USDC', approveCall(USDC, tenor, 1_000_000n))
  await send(hedger, 'Hedger: deposit margin 1.000000 USDC', t.depositMargin(1_000_000n))
  await send(dealer, 'Dealer: allow USDC', approveCall(USDC, tenor, 1_500_000n))
  await send(dealer, 'Dealer: deposit margin 1.500000 USDC', t.depositMargin(1_500_000n))

  // 3. dealer signs quotes, link codec round trip, hedger opens
  const params = { mat: nowSec() + 420 }
  const mk = async (notional: bigint, cash: boolean) => {
    const q = await pc.readContract({ address: tenor, abi: tenorAbi, functionName: 'quote', args: [notional, 400n] })
    const msg: QuoteMsg = {
      dealer: dealer.address,
      side: 0,
      notionalUsd6: notional,
      rate: q[1],
      maturity: BigInt(params.mat),
      initialMarginBps: 500n,
      quoteExpiry: BigInt(nowSec() + 1800),
      nonce: randomNonce(),
      cashSettled: cash,
    }
    const signature = await dealer.signTypedData(quoteTypedData(net.chainId, tenor, msg))
    const payload = encodeQuote({ chainId: net.chainId, tenor, quote: msg, signature })
    const back = decodeQuote(payload)
    const signer = back ? await recoverTypedDataAddress({ ...quoteTypedData(back.chainId, back.tenor, back.quote), signature: back.signature }) : undefined
    check(`Share link round-trips and the signature verifies (${cash ? 'cash' : 'physical'}, ${notional} notional)`, !!back && signer === dealer.address && back.quote.rate === msg.rate, `${payload.length} chars`)
    return { msg, signature, link: `/quote?q=${payload}` }
  }
  const A = await mk(10_000_000n, true)
  const B = await mk(2_000_000n, false)
  const C = await mk(2_000_000n, true)
  log(`Quote link A: ${A.link.slice(0, 80)}...`)

  const openRcs = []
  for (const [name, x] of [['A cash-settled 10 USDC', A], ['B physical 2 USDC', B], ['C cash-settled 2 USDC', C]] as const) {
    const rc = await send(hedger, `Hedger: Lock rate, trade ${name}`, t.open(x.msg, x.signature))
    openRcs.push(rc)
  }
  const ids = openRcs.map((rc) => parseEventLogs({ abi: tenorAbi, logs: rc?.logs ?? [], eventName: 'TradeOpened' })[0]?.args.tradeId)
  log(`trade ids ${ids.join(', ')}`)
  const [idA, idB, idC] = ids
  const replay = await send(hedger, 'Hedger: replay quote A', t.open(A.msg, A.signature), 'NonceUsed')
  check('Replay of a used quote is refused with NonceUsed', replay === undefined)

  // 4. push price +3% (owner), mark, margin call
  const openedAt = (await pc.readContract({ address: tenor, abi: tenorAbi, functionName: 'getTrade', args: [idC] })).openedAt // C opens last
  const spot0 = (await pc.readContract({ address: feed, abi: feedAbi, functionName: 'latestRoundData' }))[1]
  const spot1 = (spot0 * 103n) / 100n
  await send(dealer, `Owner: push price ${fmtRate(spot0 * 10n ** 10n)} -> ${fmtRate(spot1 * 10n ** 10n)}`, setAnswerCall(feed, spot1))
  await waitUntil(Number(openedAt) + 60, 'the mark interval')
  const rA = await send(dealer, 'Anyone: Mark trade A', t.mark(idA))
  await send(hedger, 'Anyone: Mark trade C', t.mark(idC))
  const evA = parseEventLogs({ abi: tenorAbi, logs: rA?.logs ?? [] })
  check('Mark A emitted Marked and MarginCalled', evA.some((e) => e.eventName === 'Marked') && evA.some((e) => e.eventName === 'MarginCalled'))
  const marked = evA.find((e) => e.eventName === 'Marked')
  if (marked && marked.eventName === 'Marked') {
    const exp = hedgerMtm(0, 10_000_000n, A.msg.rate, marked.args.forwardNow)
    check('Marked MTM equals independent N*(F-K)/K', marked.args.mtm === exp, `${marked.args.mtm} vs ${exp}`)
  }
  await send(dealer, 'Dealer: withdrawExcess while called', t.withdrawExcess(idA, 1n), 'MarginLocked')
  await send(hedger, 'Anyone: closeOut before deadline', t.closeOut(idA), 'CureWindowOpen')
  await send(hedger, 'Anyone: Mark again too soon', t.mark(idA), 'MarkTooSoon')
  const rTop = await send(dealer, 'Dealer: top up trade A 0.400000 USDC', t.topUp(idA, 400_000n))
  check('Top up cured the margin call', parseEventLogs({ abi: tenorAbi, logs: rTop?.logs ?? [] }).some((e) => e.eventName === 'MarginCured'))
  await send(hedger, 'Hedger: settle before maturity', t.settle(idA), 'NotMatured')

  // 5. close out the uncured trade C
  const tradeC = await pc.readContract({ address: tenor, abi: tenorAbi, functionName: 'getTrade', args: [idC] })
  await waitUntil(Number(tradeC.callDeadline) + 1, 'the cure window on trade C')
  const rClose = await send(hedger, 'Anyone: Close out trade C', t.closeOut(idC))
  check('Close out emitted ClosedOut', parseEventLogs({ abi: tenorAbi, logs: rClose?.logs ?? [] }).some((e) => e.eventName === 'ClosedOut'))

  // 6. maturity: cash settle A, physical delivery B
  await waitUntil(params.mat + 1, 'maturity')
  const before = await pc.readContract({ address: tenor, abi: tenorAbi, functionName: 'marginOf', args: [hedger.address] })
  await send(hedger, 'Hedger: Fund USDC leg (allow USDC)', approveCall(USDC, tenor, 2_000_000n))
  await send(hedger, 'Hedger: Fund USDC leg, trade B', t.fundLeg(idB))
  await send(hedger, 'Anyone: settle trade B with a leg missing', t.settle(idB), 'LegUnfunded')
  const eurAmt = eurcFor(2_000_000n, B.msg.rate)
  await send(dealer, 'Dealer: Fund EURC leg (allow EURC)', approveCall(EURC, tenor, eurAmt))
  await send(dealer, 'Dealer: Fund EURC leg, trade B', t.fundLeg(idB))
  await send(dealer, 'Dealer: fund the same leg twice', t.fundLeg(idB), 'LegAlreadyFunded')
  const rSetB = await send(hedger, 'Anyone: settle trade B (physical)', t.settle(idB))
  check('Physical settle emitted Delivered', parseEventLogs({ abi: tenorAbi, logs: rSetB?.logs ?? [] }).some((e) => e.eventName === 'Delivered'))
  const eurHedger = await pc.readContract({ address: tenor, abi: tenorAbi, functionName: 'eurcBalanceOf', args: [hedger.address] })
  check('Hedger EURC credit equals exactly notional*1e18/rate', eurHedger === eurAmt, `${eurHedger} vs ${eurAmt}`)
  const rSetA = await send(hedger, 'Anyone: Cash settle trade A', t.settle(idA))
  const cs = parseEventLogs({ abi: tenorAbi, logs: rSetA?.logs ?? [] }).find((e) => e.eventName === 'CashSettled')
  check('Cash settle emitted CashSettled', !!cs)
  await send(hedger, 'Anyone: settle trade A again', t.settle(idA), 'AlreadySettled')

  // 7. withdraw
  const after = await pc.readContract({ address: tenor, abi: tenorAbi, functionName: 'marginOf', args: [hedger.address] })
  log(`hedger free margin ${fmtToken(before)} -> ${fmtToken(after)}`)
  const hBal = await pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [hedger.address] })
  await send(hedger, 'Hedger: Withdraw USDC', t.withdraw())
  await send(hedger, 'Hedger: Withdraw EURC', t.withdrawEurc())
  await send(dealer, 'Dealer: Withdraw USDC', t.withdraw())
  const tenorUsdc = await pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [tenor] })
  const tenorEurc = await pc.readContract({ address: EURC, abi: erc20Abi, functionName: 'balanceOf', args: [tenor] })
  check('After everyone withdraws the contract holds 0 USDC and 0 EURC (solvency)', tenorUsdc === 0n && tenorEurc === 0n, `${tenorUsdc} / ${tenorEurc}`)
  log(`hedger wallet before withdraw ${fmtToken(hBal)} USDC`)
  log(`contract balances: ${fmtToken(tenorUsdc)} USDC, ${fmtToken(tenorEurc)} EURC`)

  await tail(tenor, deployBlock)

  const out = { dealer: dealer.address, hedger: hedger.address, feed, tenor, deployBlock: deployBlock.toString(), rows: rows.map((r) => ({ ...r, gas: r.gas?.toString() })), checks }
  writeFileSync('/tmp/e2e/results.json', JSON.stringify(out, null, 2))
  log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed`)
}

main().catch((e) => {
  console.error('E2E FAILED', e)
  writeFileSync('/tmp/e2e/results.json', JSON.stringify({ rows: rows.map((r) => ({ ...r, gas: r.gas?.toString() })), checks, error: String(e) }, null, 2))
  process.exit(1)
})
