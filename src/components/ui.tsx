import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import type { TxState } from '@/hooks/useTx'
import { useNet } from '@/hooks/network'
import { addressUrl, txUrl } from '@/lib/networks'
import { shortAddr } from '@/lib/math'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(18,45,69,0.04)]', className)}>
      {children}
    </section>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="display text-lg font-semibold text-ink">{children}</h2>
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  loading,
  className,
  children,
  onClick,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: Variant
  loading?: boolean
  onClick?: () => unknown
}) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-white hover:bg-accent-hover disabled:hover:bg-accent',
    secondary: 'border border-line-strong/40 bg-surface text-ink hover:bg-surface-muted',
    ghost: 'text-ink-2 hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
  }
  return (
    <button
      {...rest}
      onClick={() => {
        void onClick?.()
      }}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div
        className={clsx(
          'num mt-1 truncate text-xl font-semibold text-ink display',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-danger',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </div>
      {sub ? <div className="num mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'num w-full min-h-[44px] rounded-xl border border-line bg-surface-muted/60 px-3 text-base text-ink outline-none transition placeholder:text-subtle focus:border-line-strong focus:bg-surface'

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; sub?: string }[]
  label?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm transition',
            o.value === value ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink hover:bg-surface-muted',
          )}
        >
          <span className="block font-semibold">{o.label}</span>
          {o.sub ? <span className={clsx('block text-xs', o.value === value ? 'text-white/70' : 'text-muted')}>{o.sub}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' }) {
  const t = {
    neutral: 'bg-surface-muted text-ink-2',
    good: 'bg-success/10 text-success',
    bad: 'bg-danger/10 text-danger',
    warn: 'bg-warn/10 text-warn',
    info: 'bg-accent-hover/10 text-accent-hover',
  }[tone]
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', t)}>{children}</span>
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad'; title?: string; children: ReactNode }) {
  const t = {
    info: 'border-accent-hover/20 bg-accent-hover/5',
    warn: 'border-warn/30 bg-warn/5',
    bad: 'border-danger/30 bg-danger/5',
  }[tone]
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={clsx('rounded-xl border px-4 py-3 text-sm text-ink-2', t)}>
      {title ? <div className="mb-0.5 font-semibold text-ink">{title}</div> : null}
      {children}
    </div>
  )
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  const { net } = useNet()
  return (
    <a
      href={txUrl(net, hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="mono inline-flex items-center gap-1 text-xs text-accent-hover underline-offset-2 hover:underline"
    >
      {label ?? `${hash.slice(0, 10)}…${hash.slice(-6)}`}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  )
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  const { net } = useNet()
  return (
    <a
      href={addressUrl(net, address)}
      target="_blank"
      rel="noopener noreferrer"
      className="mono inline-flex items-center gap-1 text-xs text-accent-hover underline-offset-2 hover:underline"
    >
      {label ?? shortAddr(address)}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  )
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === 'idle') return null
  const busy = ['simulating', 'wallet', 'confirming'].includes(state.phase)
  const text: Record<string, string> = {
    simulating: 'Checking the call against the contract…',
    wallet: 'Confirm in your wallet…',
    confirming: 'Waiting for confirmation…',
    done: 'Confirmed',
  }
  if (state.phase === 'error') {
    return (
      <div role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-ink-2">
        {state.errorName ? <span className="mono mr-2 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">{state.errorName}</span> : null}
        {state.error}
        {state.hash ? (
          <div className="mt-1">
            <TxLink hash={state.hash} />
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden /> : <Check className="h-4 w-4 text-success" aria-hidden />}
      <span>
        {state.label}: {text[state.phase]}
      </span>
      {state.hash ? <TxLink hash={state.hash} /> : null}
    </div>
  )
}

export function CopyButton({ text, disabled, label = 'Copy link' }: { text: string; disabled?: boolean; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="secondary"
      disabled={disabled}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1800)
        } catch {
          setDone(false)
        }
      }}
    >
      {done ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {done ? 'Copied' : label}
    </Button>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <div className="display font-semibold text-ink">{title}</div>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  )
}
