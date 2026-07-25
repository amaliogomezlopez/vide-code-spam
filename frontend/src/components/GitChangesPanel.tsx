import { useEffect, useState } from 'react'
import { fetchGitChanges, type GitChange } from '../services/api'
import Icon from './Icon'

interface Props {
  worktreeId: string | null
  contextLabel: string
  branch: string
  onChooseCheckout: () => void
}

const CODE_LABELS: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Conflict',
  '?': 'Untracked',
}

/** Files an agent has actually touched inside its checkout. */
export default function GitChangesPanel({
  worktreeId,
  contextLabel,
  branch,
  onChooseCheckout,
}: Props) {
  const [changes, setChanges] = useState<GitChange[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!worktreeId) {
      setChanges([])
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchGitChanges(worktreeId, controller.signal)
      .then((response) => setChanges(response.changes))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not read the working tree')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [worktreeId, reload])

  if (!worktreeId) {
    return (
      <div className="git-history-message">
        <Icon name="fileDiff" size={26} />
        <strong>Select a checkout</strong>
        <span>Choose a worktree in Repositories to see the files its agent is changing.</span>
        <button onClick={onChooseCheckout}>Choose checkout</button>
      </div>
    )
  }

  return (
    <>
      <div className="git-history-context">
        <div>
          <span>Working tree</span>
          <strong title={contextLabel}>{contextLabel}</strong>
        </div>
        <code>{branch}</code>
        <button
          className="btn-ghost icon-button"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
          aria-label="Refresh changes"
          title="Refresh changes"
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      {loading ? (
        <div className="git-commit-skeleton" aria-label="Loading changes">
          <span />
          <span />
          <span />
        </div>
      ) : error ? (
        <div className="git-history-message error" role="alert">
          <Icon name="alertCircle" size={22} />
          <strong>Changes unavailable</strong>
          <span>{error}</span>
          <button onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>
      ) : changes.length === 0 ? (
        <div className="git-history-message">
          <Icon name="fileDiff" size={24} />
          <strong>Clean checkout</strong>
          <span>This worktree has no uncommitted changes.</span>
        </div>
      ) : (
        <ul className="git-change-list">
          {changes.map((change) => (
            <li key={`${change.code}:${change.path}`} className="git-change-row">
              <span
                className={`change-code code-${change.untracked ? 'untracked' : change.code.toLowerCase()}`}
                title={CODE_LABELS[change.code] ?? change.code}
                aria-label={CODE_LABELS[change.code] ?? change.code}
              >
                {change.code}
              </span>
              <span className="change-path" title={change.path}>
                {change.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
