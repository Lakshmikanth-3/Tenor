import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { useNet } from '@/hooks/network'
import { useYield } from '@/hooks/data'
import { PROOF_EVENTS, useBlockTimes, useProofChain, useProofData, type ProofEvent } from '@/hooks/proof'
import { fmtDateTime, fmtToken } from '@/lib/math'
import { SCENARIOS } from '@/lib/refusal'
import { AddressLink, Badge, Card, Empty, Notice, SectionTitle, Stat, TxLink } from './ui'
import { ScanProgress, Skeleton } from './ScanProgress'
import { vaultLabel } from './YieldPanel'

const STUDIO_URL = 'https://studio.arc.io/app/e5ec61eb-5f78-47d8-8423-d315eba31d29'
const REPO_URL = 'https://github.com/Lakshmikanth-3/Tenor'

export function Proof() {
  const { net } = useNet()
  const chain = useProofChain()
  const yieldInfo = useYield()
  const [filter, setFilter] = useState<Set<ProofEvent>>(new Set())
  const eurc = chain.data?.eurc ?? net.eurc
  const { activity, rows, counts, totals, total } = useProofData(filter, net.usdc, eurc)
  const times = useBlockTimes([...new Set(rows.map((r) => r.block))])

  const toggle = (e: ProofEvent) =>
    setFilter((cur) => {
      const next = new Set(cur)
      if (next.has(e)) next.delete(e)
      else next.add(e)
      return next
    })

  // While the scan is still running a zero means "not found yet", never "none", so zeros show as Loading.
  const partial = !activity.complete
  const count = (v: number) => (partial && v === 0 ? <Skeleton /> : v)
  const money = (v: bigint) => (partial && v === 0n ? <Skeleton className="w-20" /> : fmtToken(v))
  const so = (sub: string) => (partial ? 'so far' : sub)

  const kind = yieldInfo.data && 'kind' in yieldInfo.data ? yieldInfo.data.kind : undefined

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <h1 className="display mb-1 text-3xl font-semibold text-ink">Proof</h1>
      <p className="mb-6 max-w-xl text-muted">
        Everything here is read from {net.label} in your browser: the contracts, every Tenor event since deployment, and the totals computed from them.
      </p>

      {!net.tenor ? (
        <div className="mb-6">
          <Notice tone="info" title={`Tenor is not deployed on ${net.label} yet`}>
            No Tenor address is configured for this network, so there is no activity to show. The token contracts below are real; switch to Testnet to see live history.
          </Notice>
        </div>
      ) : null}

      {net.tenor ? (
        <div className="mb-6">
          <ScanProgress activity={activity} />
        </div>
      ) : null}

      <div className="space-y-6">
        <Card>
          <SectionTitle hint={net.deployBlock !== undefined ? `Tenor deploy block ${net.deployBlock.toString()}` : 'Tenor deploy block not set'}>Contracts</SectionTitle>
          <ul className="divide-y divide-line text-sm">
            {[
              net.tenor ? { label: 'Tenor', note: 'Forwards, margin and settlement', address: net.tenor } : undefined,
              chain.data?.vault
                ? { label: 'Yield vault', note: vaultLabel(kind), address: chain.data.vault }
                : net.tenor && chain.data
                  ? { label: 'Yield vault', note: 'Not set, yield margin is off', address: undefined }
                  : undefined,
              chain.data?.feed ? { label: 'EUR/USD feed', note: net.isMainnet ? 'Chainlink' : 'Mock aggregator (testnet)', address: chain.data.feed } : undefined,
              eurc ? { label: 'EURC', note: 'Euro leg of delivery', address: eurc } : undefined,
              { label: 'USDC', note: 'Margin, USD leg and gas on Arc', address: net.usdc },
            ]
              .filter((r) => !!r)
              .map((r) => (
                <li key={r.label} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{r.label}</span>
                    <span className="ml-2 text-muted">{r.note}</span>
                  </span>
                  {r.address ? <AddressLink address={r.address} label={r.address} /> : <Badge>none</Badge>}
                </li>
              ))}
          </ul>
        </Card>

        {net.tenor ? (
          <>
            <Card>
              <SectionTitle hint={activity.head > 0n ? `blocks ${activity.from.toString()} to ${activity.head.toString()}` : undefined}>Totals</SectionTitle>
              <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
                <Stat label="Trades opened" value={count(totals.opened)} sub={partial ? 'so far' : undefined} />
                <Stat label="Delivered" value={count(totals.delivered)} sub={so('physical')} />
                <Stat label="Cash-settled" value={count(totals.cashSettled)} sub={partial ? 'so far' : undefined} />
                <Stat label="Delivery failed" value={count(totals.deliveryFailed)} sub={partial ? 'so far' : undefined} />
                <Stat label="USDC notional" value={money(totals.notionalUsd6)} sub={so('total opened')} />
                <Stat label="USDC delivered" value={money(totals.usdcDelivered)} sub={so('physical legs')} />
                <Stat label="EURC delivered" value={money(totals.eurcDelivered)} sub={so('physical legs')} />
                <Stat
                  label="Margin held in USYC"
                  value={chain.data ? (chain.data.vault ? (chain.data.inVault !== undefined ? fmtToken(chain.data.inVault) : '–') : 'Off') : <Skeleton className="w-20" />}
                  sub={chain.data?.vault ? `USDC value of ${fmtToken(chain.data.shares)} shares` : 'no yield vault set'}
                />
              </div>
            </Card>

            <Card>
              <SectionTitle hint={`${total} events, showing the newest ${Math.min(rows.length, 200)}`}>Live activity</SectionTitle>
              <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by event">
                <button
                  onClick={() => setFilter(new Set())}
                  aria-pressed={filter.size === 0}
                  className={clsx(
                    'min-h-[36px] rounded-full border px-3 text-xs font-semibold transition',
                    filter.size === 0 ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink hover:bg-surface-muted',
                  )}
                >
                  All
                </button>
                {PROOF_EVENTS.map((e) => (
                  <button
                    key={e}
                    onClick={() => toggle(e)}
                    aria-pressed={filter.has(e)}
                    className={clsx(
                      'min-h-[36px] rounded-full border px-3 text-xs font-semibold transition',
                      filter.has(e) ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink hover:bg-surface-muted',
                    )}
                  >
                    {e} <span className="num opacity-70">{partial && !counts[e] ? '…' : (counts[e] ?? 0)}</span>
                  </button>
                ))}
              </div>
              {rows.length === 0 && partial ? (
                <div className="space-y-2" role="status" aria-label="Loading events">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded-lg bg-surface-muted" />
                  ))}
                  <p className="text-sm text-muted">Newest blocks are read first, so recent events appear as soon as they are found.</p>
                </div>
              ) : rows.length === 0 ? (
                <Empty title="No matching events">Nothing has been emitted for this filter since block {net.deployBlock?.toString() ?? 'the scan start'}.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="label border-b border-line">
                        <th className="py-2 pr-3 font-medium">Time</th>
                        <th className="py-2 pr-3 font-medium">Event</th>
                        <th className="py-2 pr-3 font-medium">Trade</th>
                        <th className="py-2 pr-3 text-right font-medium">Amount (USDC / EURC)</th>
                        <th className="py-2 font-medium">Tx</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((r) => {
                        const ts = times.data?.[r.block.toString()]
                        return (
                          <tr key={r.key}>
                            <td className="num whitespace-nowrap py-2 pr-3 text-muted">{ts ? fmtDateTime(ts) : `block ${r.block.toString()}`}</td>
                            <td className="py-2 pr-3 font-medium text-ink">{r.event}</td>
                            <td className="num py-2 pr-3">{r.tradeId !== undefined ? `#${r.tradeId.toString()}` : '–'}</td>
                            <td className="num py-2 pr-3 text-right">{r.amount !== undefined ? fmtToken(r.amount) : '–'}</td>
                            <td className="py-2">
                              <TxLink hash={r.tx} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        ) : null}

        <Card>
          <SectionTitle>Built with Arc Studio</SectionTitle>
          <p className="text-sm text-ink-2">
            245 Foundry tests, {SCENARIOS.filter((s) => s.expected).length} refusal cases. Contracts, tests and this app were built in Arc Studio.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <a className="inline-flex items-center gap-1 font-semibold text-accent-hover underline-offset-2 hover:underline" href={STUDIO_URL} target="_blank" rel="noopener noreferrer">
              Arc Studio project <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            <a className="inline-flex items-center gap-1 font-semibold text-accent-hover underline-offset-2 hover:underline" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              GitHub repository <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        </Card>
      </div>
    </div>
  )
}
