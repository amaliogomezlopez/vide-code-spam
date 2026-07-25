import { useEffect, useRef, useState } from 'react'
import {
  fetchPreviousSession,
  forgetSession,
  restoreSession,
  type Agent,
  type SessionSnapshot,
} from '../services/api'
import Icon from './Icon'

interface Props {
  agents: Agent[]
  onRestored: () => void
}

/**
 * Offer to reopen the terminals from the previous run.
 *
 * Agents live in memory, so closing the app used to throw away the whole
 * workspace: which CLI, in which folder, on which worktree. The backend keeps a
 * snapshot; this is the one place that offers it back, and only while the user
 * has not started working again.
 */
export default function SessionRestoreBanner({ agents, onRestored }: Props) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Once this run has had terminals open, the offer is over: closing them all
  // is a deliberate act, not an empty workspace waiting to be restored.
  const workedThisRun = useRef(false)
  if (agents.length > 0) workedThisRun.current = true

  useEffect(() => {
    const controller = new AbortController()
    fetchPreviousSession(controller.signal)
      .then(setSnapshot)
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  if (dismissed || workedThisRun.current || !snapshot?.restorable || agents.length > 0) return null

  const restore = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await restoreSession()
      if (result.skipped.length > 0) {
        setError(
          `${result.restored.length} restored · ${result.skipped.length} skipped: ${result.skipped
            .map((item) => `${item.id} (${item.reason})`)
            .join('; ')}`
        )
      } else {
        setDismissed(true)
      }
      onRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore the session')
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    setDismissed(true)
    try {
      await forgetSession()
    } catch {
      // Forgetting is a convenience; the banner is already gone.
    }
  }

  return (
    <div className="session-restore-banner" role="status">
      <Icon name="restore" size={16} />
      <div className="session-restore-copy">
        <strong>
          Restore {snapshot.agents.length} terminal{snapshot.agents.length === 1 ? '' : 's'} from
          your last session?
        </strong>
        <span title={snapshot.agents.map((agent) => `${agent.name} · ${agent.cwd}`).join('\n')}>
          {snapshot.agents
            .slice(0, 4)
            .map((agent) => agent.name)
            .join(', ')}
          {snapshot.agents.length > 4 ? ` +${snapshot.agents.length - 4} more` : ''}
        </span>
        {error ? <span className="session-restore-error">{error}</span> : null}
      </div>
      <div className="session-restore-actions">
        <button className="btn-primary btn-xs" onClick={restore} disabled={busy}>
          {busy ? 'Restoring…' : 'Restore'}
        </button>
        <button className="btn-ghost btn-xs" onClick={forget} disabled={busy}>
          Forget
        </button>
      </div>
    </div>
  )
}
