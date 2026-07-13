import { useEffect, useState } from 'react'
import { healthCheck } from '../services/api'

export default function ConnectionStatus() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      const ok = await healthCheck()
      if (mounted) setConnected(ok)
    }
    check()
    const interval = setInterval(check, 3000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  let label = 'Checking'
  let color = 'var(--muted)'
  let cls = ''
  if (connected === true) {
    label = 'Online'
    color = 'var(--running)'
    cls = 'connected'
  } else if (connected === false) {
    label = 'Offline'
    color = 'var(--recording)'
  }

  return (
    <span className={`status-chip ${cls}`} style={{ color }} title={label}>
      <span className="status-dot" />
      {label}
    </span>
  )
}
