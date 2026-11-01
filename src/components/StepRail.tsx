import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { clsx } from 'clsx'
import type { RailStep, StepStatus } from '@/lib/roles'
import { Badge } from './ui'

const TONE: Record<StepStatus, 'good' | 'info' | 'neutral'> = { done: 'good', current: 'info', waiting: 'neutral' }
const LABEL: Record<StepStatus, string> = { done: 'Done', current: 'Current', waiting: 'Waiting' }

/** A numbered rail of steps. Each shows its status, a one-line explanation and whatever action the caller supplies. */
export function StepRail({ steps, actions }: { steps: RailStep[]; actions: Record<number, ReactNode> }) {
  return (
    <ol className="space-y-3" aria-label="Steps">
      {steps.map((s) => (
        <li
          key={s.n}
          aria-current={s.status === 'current' ? 'step' : undefined}
          className={clsx(
            'flex flex-wrap items-start gap-x-4 gap-y-2 rounded-xl border px-4 py-3.5',
            s.status === 'current' ? 'border-accent bg-accent/5' : 'border-line bg-surface',
          )}
        >
          <span
            className={clsx(
              'num mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
              s.status === 'done' ? 'bg-success text-white' : s.status === 'current' ? 'bg-accent text-white' : 'bg-surface-muted text-muted',
            )}
          >
            {s.status === 'done' ? <Check className="h-4 w-4" aria-hidden /> : s.n}
          </span>
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="display text-base font-semibold text-ink">{s.title}</h3>
              <Badge tone={TONE[s.status]}>{LABEL[s.status]}</Badge>
            </div>
            <p className={clsx('mt-0.5 text-sm', s.blocked ? 'text-warn' : 'text-muted')}>{s.detail}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{actions[s.n]}</div>
        </li>
      ))}
    </ol>
  )
}
