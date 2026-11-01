import type { Activity } from '@/hooks/activity'

/** "Scanning Arc blocks… 40%" with a bar, while the shared event scan is still running. Renders nothing once it is complete. */
export function ScanProgress({ activity, compact }: { activity: Activity; compact?: boolean }) {
  if (activity.complete && !activity.running) return null
  const pct = Math.max(0, Math.min(100, activity.progress))
  const stalled = !activity.running && !!activity.error
  return (
    <div
      className={compact ? 'rounded-xl bg-surface-muted/70 px-4 py-3' : 'rounded-xl border border-line bg-surface-muted/70 px-4 py-3'}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink">{stalled ? 'Some Arc blocks are still unread' : `Scanning Arc blocks… ${pct}%`}</span>
        <span className="num text-xs text-muted">{activity.logs.length} events so far</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Block scan progress"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      {activity.rateLimited ? <p className="mt-2 text-xs text-muted">The public RPC is busy, so the scan is slowing down. Nothing is lost.</p> : null}
      {stalled && activity.error ? <p className="mt-2 text-xs text-muted">{activity.error}</p> : null}
    </div>
  )
}

/** Placeholder while a number is not known yet. */
export function Skeleton({ className = 'w-14' }: { className?: string }) {
  return (
    <span className={`inline-block h-6 animate-pulse rounded-md bg-line align-middle ${className}`} role="img" aria-label="Loading">
      <span className="sr-only">Loading</span>
    </span>
  )
}
