import { useEffect, useState } from 'react'

/**
 * A coarse clock for time-derived UI (idle badges, relative labels).
 * Components read a value that advances on its own instead of each one holding
 * its own timer chain.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}
