import { Check, Circle, Loader2, TriangleAlert } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount } from 'wagmi'
import type { TrackedStep, TxState } from '@/hooks/useTx'
import { popupCount } from '@/lib/steps'
import { shortAddr } from '@/lib/math'

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * "Step 1 of 3" with what each wallet popup is for. Shows the plan before the click, progress while it runs, and the wallet
 * account that will sign (with a warning if the wallet moved to another account mid-flow).
 */
export function StepTracker({ steps, state, atomic }: { steps: TrackedStep[]; state: TxState; atomic: boolean }) {
  const { address } = useAccount()
  const running = state.steps !== undefined && state.phase !== 'idle'
  const shown = running && state.steps ? state.steps : steps
  const note = shown.find((s) => s.note)?.note
  if (shown.length === 0) return null
  if (shown.length === 1 && !note) return null

  const batched = running ? !!state.batched : atomic && shown.length > 1
  const current = running ? (state.stepIndex ?? 0) : 0
  const finished = state.phase === 'done' && running
  const failed = state.phase === 'error' && running
  const popups = popupCount(shown.length, batched)
  const required = state.required
  const mismatch = !!required && !!address && !same(required, address)

  return (
    <div className="mt-3 rounded-xl bg-surface-muted/70 px-4 py-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-ink">
          {finished ? `All ${shown.length} steps done` : batched ? `${shown.length} steps, confirmed once in your wallet` : `Step ${Math.min(current + 1, shown.length)} of ${shown.length}`}
        </span>
        <span className="num text-xs text-muted">{popups === 1 ? '1 wallet popup' : `${popups} wallet popups`}</span>
      </div>
      <ol className="mt-2 space-y-2">
        {shown.map((s, i) => {
          const done = finished || (running && !batched && i < current) || (running && batched && state.phase === 'done')
          const active = running && !finished && !failed && (batched || i === current)
          const bad = failed && (batched || i === current)
          return (
            <li key={`${s.label}-${i}`} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {done ? (
                  <Check className="h-4 w-4 text-success" />
                ) : bad ? (
                  <TriangleAlert className="h-4 w-4 text-danger" />
                ) : active && ['simulating', 'wallet', 'confirming'].includes(state.phase) ? (
                  <Loader2 className="h-4 w-4 animate-spin text-ink-2" />
                ) : (
                  <Circle className="h-4 w-4 text-line-strong" />
                )}
              </span>
              <span className="min-w-0">
                <span className={clsx('font-medium', done ? 'text-muted' : 'text-ink')}>
                  {batched ? `${i + 1}. ` : `Step ${i + 1}: `}
                  {s.label}
                </span>
                <span className="block text-xs text-muted">{s.reason.replace(/ One-time permission\..*$/, '')}</span>
                {s.note && !done ? <span className="mt-0.5 block text-xs font-medium text-ink-2">{s.note}</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
      <div className={clsx('mt-3 border-t border-line pt-2 text-xs', mismatch ? 'font-semibold text-danger' : 'text-muted')} role={mismatch ? 'alert' : undefined}>
        {mismatch && required
          ? `Wallet account changed. Active: ${shortAddr(address ?? '')}. Required: ${shortAddr(required)}. Switch back before continuing.`
          : address
            ? `Wallet account: ${shortAddr(address)}${required ? ' (required)' : ''}`
            : 'No wallet connected'}
      </div>
    </div>
  )
}
