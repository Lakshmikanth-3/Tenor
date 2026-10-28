import { useSwitchChain } from 'wagmi'
import { requireChain } from '@/onchain-facts'
import { useNet, useWallet } from '@/hooks/network'
import { useSpot } from '@/hooks/data'
import { fmtDuration } from '@/lib/math'
import { Button, Notice } from './ui'

export function Banners() {
  const { net } = useNet()
  const { wrongNetwork, walletChainId } = useWallet()
  const { switchChain, isPending } = useSwitchChain()
  const spot = useSpot()
  const walletName = walletChainId ? (requireChainName(walletChainId)) : 'another network'
  return (
    <div className="mx-auto max-w-6xl space-y-3 px-4 pt-4 empty:hidden">
      {wrongNetwork ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3">
          <div className="text-sm text-ink-2">
            <span className="font-semibold text-danger">Wrong network.</span> Your wallet is on {walletName}. This view uses {net.label}.
          </div>
          <Button variant="danger" loading={isPending} onClick={() => switchChain({ chainId: net.chainId })}>
            Switch to {net.label}
          </Button>
        </div>
      ) : null}
      {!net.tenor ? (
        <Notice tone="warn" title={`Tenor is not deployed on ${net.label}`}>
          No contract address is configured for this network, so the app is read-only here. Deploy Tenor from your own wallet, then set
          the address and deployment block in the project environment.
        </Notice>
      ) : null}
      {net.tenor && spot.data?.stale ? (
        <Notice tone="warn" title="Price feed is stale">
          The EUR/USD feed was last updated {fmtDuration(spot.data.age)} ago, which is older than the contract allows. Quotes, marks and
          cash settlement revert until it is refreshed.
          {!net.isMainnet ? ' The owner can push a new price from Admin / demo.' : ''}
        </Notice>
      ) : null}
    </div>
  )
}

function requireChainName(id: number): string {
  try {
    return requireChain(id).name
  } catch {
    return `chain ${id}`
  }
}
