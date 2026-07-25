import { useEffect, useState } from 'react'
import { fetchGitCommits, type GitCommit } from '../services/api'
import { formatRelativeTime } from '../services/gitWorkspace'
import Icon from './Icon'

interface Props {
  worktreeId: string | null
  contextLabel: string
  branch: string
  onChooseCheckout: () => void
}

const LOADING_ROWS = ['loading-1', 'loading-2', 'loading-3', 'loading-4']

function GitCommitRow({ commit }: { commit: GitCommit }) {
  return (
    <li className="git-commit-row">
      <span className="git-commit-node" aria-hidden="true" />
      <div className="git-commit-copy">
        <div className="git-commit-subject-row">
          <strong title={commit.subject}>{commit.subject}</strong>
          <code>{commit.short_sha}</code>
        </div>
        <div className="git-commit-meta">
          <span>{commit.author}</span>
          <time dateTime={commit.authored_at}>{formatRelativeTime(commit.authored_at)}</time>
        </div>
        {commit.refs.length > 0 ? (
          <div className="git-commit-refs" aria-label="Git references">
            {commit.refs.slice(0, 3).map((ref) => (
              <span key={ref}>{ref}</span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

export default function GitCommitsPanel({
  worktreeId,
  contextLabel,
  branch,
  onChooseCheckout,
}: Props) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!worktreeId) {
      setCommits([])
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchGitCommits(worktreeId, 50, controller.signal)
      .then((response) => setCommits(response.commits))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not read Git history')
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
        <Icon name="gitBranch" size={26} />
        <strong>Select a checkout</strong>
        <span>Choose a worktree in Repositories to inspect its branch history.</span>
        <button onClick={onChooseCheckout}>Choose checkout</button>
      </div>
    )
  }

  return (
    <>
      <div className="git-history-context">
        <div>
          <span>History</span>
          <strong title={contextLabel}>{contextLabel}</strong>
        </div>
        <code>{branch}</code>
        <button
          className="btn-ghost icon-button"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
          aria-label="Refresh commits"
          title="Refresh commits"
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      {loading ? (
        <div className="git-commit-skeleton" aria-label="Loading commits">
          {LOADING_ROWS.map((row) => (
            <span key={row} />
          ))}
        </div>
      ) : error ? (
        <div className="git-history-message error" role="alert">
          <Icon name="alertCircle" size={22} />
          <strong>Git history unavailable</strong>
          <span>{error}</span>
          <button onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>
      ) : commits.length > 0 ? (
        <ol className="git-commit-list">
          {commits.map((commit) => (
            <GitCommitRow key={commit.sha} commit={commit} />
          ))}
        </ol>
      ) : (
        <div className="git-history-message">
          <Icon name="commit" size={24} />
          <strong>No commits yet</strong>
          <span>This checkout does not have any commit history.</span>
        </div>
      )}
    </>
  )
}
