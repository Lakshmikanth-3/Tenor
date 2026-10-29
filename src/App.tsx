import { NetworkProvider, useNet } from '@/hooks/network'
import { useLocation } from '@/lib/router'
import { Header } from '@/components/Header'
import { Banners } from '@/components/Banners'
import { Hedge } from '@/components/Hedge'
import { Dealer } from '@/components/Dealer'
import { QuotePage } from '@/components/QuotePage'
import { Trades } from '@/components/Trades'
import { Refusal } from '@/components/Refusal'
import { Admin } from '@/components/Admin'
import { Empty } from '@/components/ui'

function Routes() {
  const { path } = useLocation()
  const { net } = useNet()
  if (!net.tenor) {
    return (
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
        <Empty title={`Nothing to show on ${net.label} yet`}>
          Hedging, trades, quotes and the refusal room all read from the Tenor contract. Switch to Testnet to use them.
        </Empty>
      </div>
    )
  }
  if (path.startsWith('/quote')) return <QuotePage />
  if (path.startsWith('/trades')) return <Trades />
  if (path.startsWith('/dealer')) return <Dealer />
  if (path.startsWith('/refusal')) return <Refusal />
  if (path.startsWith('/admin')) return <Admin />
  return <Hedge />
}

export default function App() {
  return (
    <NetworkProvider>
      <Header />
      <Banners />
      <main>
        <Routes />
      </main>
    </NetworkProvider>
  )
}
