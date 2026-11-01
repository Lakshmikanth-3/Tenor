import { useEffect, useMemo, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useConnect, useConnectors } from 'wagmi'
import { Button } from './ui'

const isMetaMask = (c: { id: string; name: string }) => c.id === 'io.metamask' || c.id === 'io.metamask.flask' || /^metamask/i.test(c.name)

/**
 * Connect button that chooses the wallet by EIP-6963, so one installed wallet cannot intercept another's requests.
 * MetaMask is listed first and marked recommended. Once connected, ConnectKit's account menu takes over.
 */
export function WalletButton({ className }: { className?: string }) {
  const { isConnected } = useAccount()
  const [open, setOpen] = useState(false)
  if (isConnected) return <ConnectKitButton showBalance={false} />
  return (
    <>
      <Button variant="primary" className={className} onClick={() => setOpen(true)}>
        Connect wallet
      </Button>
      {open ? <WalletChooser onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function WalletChooser({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors()
  const { connectAsync, isPending, error, variables } = useConnect()
  const [message, setMessage] = useState<string>()

  // Wallets announced through EIP-6963 each have their own id. The generic `injected` entry reads window.ethereum, which any
  // wallet may have taken over, so it is only offered when nothing announced itself.
  const wallets = useMemo(() => {
    const announced = connectors.filter((c) => c.id !== 'injected')
    const list = announced.length > 0 ? announced : connectors.filter((c) => c.id === 'injected')
    return [...list].sort((a, b) => Number(isMetaMask(b)) - Number(isMetaMask(a)))
  }, [connectors])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = async (connector: (typeof wallets)[number]) => {
    setMessage(undefined)
    try {
      await connectAsync({ connector })
      onClose()
    } catch (e) {
      setMessage(e instanceof Error && /rejected|denied/i.test(e.message) ? 'Connection cancelled in the wallet.' : 'Could not connect. Unlock the wallet and try again.')
    }
  }

  const multiple = wallets.length > 1
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-chooser-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="wallet-chooser-title" className="display text-lg font-semibold text-ink">
          Choose a wallet
        </h2>
        <p className="mt-1 text-sm text-muted">
          {multiple ? 'You have more than one wallet installed. Pick the one you want to use here.' : 'Connect the wallet you want to use here.'}
        </p>
        <ul className="mt-4 space-y-2">
          {wallets.length === 0 ? <li className="text-sm text-muted">No browser wallet found. Install MetaMask, then reload.</li> : null}
          {wallets.map((c) => (
            <li key={c.uid}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => void pick(c)}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-line px-3 text-left transition hover:bg-surface-muted disabled:opacity-60"
              >
                {c.icon ? <img src={c.icon} alt="" className="h-7 w-7 rounded-md" /> : <span className="h-7 w-7 rounded-md bg-surface-muted" aria-hidden />}
                <span className="flex-1 font-semibold text-ink">{c.id === 'injected' ? 'Browser wallet' : c.name}</span>
                {isMetaMask(c) ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">Recommended</span> : null}
                {isPending && variables?.connector === c ? <span className="text-xs text-muted">Check your wallet…</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {message || error ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {message ?? 'Could not connect.'}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
