import { useState } from 'react'
import { Check, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useNet } from '@/hooks/network'
import { SCENARIOS, type Outcome, type Scenario } from '@/lib/refusal'
import { Button, Card, Notice } from './ui'

type Result = { loading: true } | { loading: false; outcome: Outcome }

export function Refusal() {
  const { net, client } = useNet()
  const [results, setResults] = useState<Record<string, Result>>({})
  const tenor = net.tenor

  const run = async (s: Scenario) => {
    if (!tenor) return
    setResults((r) => ({ ...r, [s.id]: { loading: true } }))
    let outcome: Outcome
    try {
      outcome = await s.run({ client, tenor })
    } catch (e) {
      outcome = { kind: 'error', message: e instanceof Error ? e.message.slice(0, 160) : 'The simulation failed.' }
    }
    setResults((r) => ({ ...r, [s.id]: { loading: false, outcome } }))
  }
  const runAll = async () => {
    for (const s of SCENARIOS) await run(s)
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold text-ink">Refusal room</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Eight ways to abuse a forward, each run as a read-only <span className="mono text-sm">eth_call</span> against the deployed contract on {net.label}. The error
            you see is the one the contract&apos;s own code raises. Nothing is sent and nothing changes onchain.
          </p>
        </div>
        <Button variant="primary" onClick={runAll} disabled={!tenor}>
          Run all
        </Button>
      </div>
      {!tenor ? (
        <Notice tone="warn" title="No Tenor contract on this network">
          Switch to testnet to run the scenarios.
        </Notice>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {SCENARIOS.map((s) => (
            <ScenarioCard key={s.id} s={s} result={results[s.id]} onRun={() => run(s)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ScenarioCard({ s, result, onRun }: { s: Scenario; result?: Result; onRun: () => unknown }) {
  const done = result && !result.loading ? result.outcome : undefined
  const control = s.expected === undefined
  const matches = done ? (control ? done.kind === 'pass' : done.kind === 'revert' && done.errorName === s.expected) : undefined
  return (
    <Card className={control ? 'border-success/40' : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-lg font-semibold text-ink">{s.title}</h2>
          <p className="mt-1 text-sm text-ink-2">{s.attack}</p>
        </div>
        <Button onClick={onRun} loading={result?.loading} className="shrink-0">
          Run
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted">
        <span className="font-semibold text-ink-2">Simulation setup.</span> {s.setup}
      </p>
      {done ? (
        <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${matches ? 'border-success/30 bg-success/5' : 'border-warn/40 bg-warn/5'}`} role="status">
          {done.kind === 'revert' ? (
            <>
              <div className="flex items-center gap-2">
                {matches ? <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> : <TriangleAlert className="h-4 w-4 text-warn" aria-hidden />}
                <span className="font-semibold text-ink">Refused</span>
                {done.errorName ? <span className="mono rounded bg-ink/5 px-1.5 py-0.5 text-xs font-medium">{done.errorName}</span> : null}
              </div>
              <p className="mt-1 text-ink-2">{done.message}</p>
              {!matches && s.expected ? <p className="mt-1 text-xs text-warn">Expected {s.expected}. Check that the price feed is fresh.</p> : null}
            </>
          ) : done.kind === 'pass' ? (
            <>
              <div className="flex items-center gap-2">
                {control ? <Check className="h-4 w-4 text-success" aria-hidden /> : <TriangleAlert className="h-4 w-4 text-warn" aria-hidden />}
                <span className="font-semibold text-ink">{control ? 'Accepted' : 'Not refused'}</span>
              </div>
              <p className="mt-1 text-ink-2">{done.detail}</p>
            </>
          ) : (
            <p className="text-ink-2">Could not run: {done.message}</p>
          )}
        </div>
      ) : null}
    </Card>
  )
}
