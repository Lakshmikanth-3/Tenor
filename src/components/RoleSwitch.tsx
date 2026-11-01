import { clsx } from 'clsx'
import { navigate } from '@/lib/router'
import { useRole } from '@/hooks/useRole'
import type { Role } from '@/lib/roles'

export const ROLE_HOME: Record<Role, string> = { business: '/business', dealer: '/dealer-desk' }

const OPTIONS: { role: Role; label: string }[] = [
  { role: 'business', label: 'Business (hedger)' },
  { role: 'dealer', label: 'Dealer' },
]

/** "I am a…" switch at the top of the app. Picking a side remembers it and opens that side's dashboard. */
export function RoleSwitch() {
  const [role, setRole] = useRole()
  return (
    <div className="flex items-center gap-3">
      <span className="label hidden sm:inline">I am a</span>
      <div role="radiogroup" aria-label="Your role" className="flex rounded-lg border border-line bg-surface p-0.5 text-xs font-semibold">
        {OPTIONS.map((o) => (
          <button
            key={o.role}
            role="radio"
            aria-checked={role === o.role}
            onClick={() => {
              setRole(o.role)
              navigate(ROLE_HOME[o.role])
            }}
            className={clsx(
              'min-h-[32px] rounded-md px-3 transition',
              role === o.role ? 'bg-accent text-white' : 'text-ink-2 hover:bg-surface-muted',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
