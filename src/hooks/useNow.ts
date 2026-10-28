import { useEffect, useState } from 'react'
import { nowSec } from '@/lib/math'

/** Seconds since epoch, ticking once a second. */
export function useNow(): number {
  const [now, setNow] = useState(nowSec())
  useEffect(() => {
    const t = setInterval(() => setNow(nowSec()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}
