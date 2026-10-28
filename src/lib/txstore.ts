import { useSyncExternalStore } from 'react'

export interface TxRecord {
  hash: string
  label: string
  chainId: number
  ts: number
  status: 'success' | 'reverted'
}

const KEY = 'tenor.tx.v1'
let cache: TxRecord[] | undefined
const listeners = new Set<() => void>()

function read(): TxRecord[] {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as TxRecord[]
  } catch {
    cache = []
  }
  return cache
}

export function recordTx(rec: TxRecord): void {
  cache = [rec, ...read().filter((r) => r.hash !== rec.hash)].slice(0, 60)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // storage unavailable, keep in memory
  }
  for (const l of listeners) l()
}

export function useTxHistory(chainId: number): TxRecord[] {
  const all = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
  )
  return all.filter((r) => r.chainId === chainId)
}
