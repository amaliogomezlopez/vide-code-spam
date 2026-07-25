import { useEffect } from 'react'
import type { RepositoryOverlap } from '../services/api'
import { useOverlapStore } from '../stores/overlapStore'
import Icon from './Icon'

function worktreeNames(repository: RepositoryOverlap, ids: string[]): string {
  return ids
    .map((id) => repository.worktrees.find((item) => item.worktree_id === id)?.name ?? id)
    .join(' ↔ ')
}

/**
 * Files more than one agent is changing at the same time.
 *
 * Branches keep the work apart until the merge; this shows the collision while
 * it is still cheap to redirect an agent, instead of at integration time.
 */
export default function GitConflictsPanel() {
  const { report, loading, error, load } = useOverlapStore()

  useEffect(() => {
    void load(true)
  }, [load])

  const repositories = report?.repositories ?? []
  const active = repositories.filter(
    (repository) => repository.conflicts.length > 0 || repository.shared_checkouts.length > 0
  )

  return (
    <>
      <div className="git-history-context">
        <div>
          <span>Cross-agent</span>
          <strong>Conflict radar</strong>
        </div>
        <button
          className="btn-ghost icon-button"
          onClick={() => void load(true)}
          disabled={loading}
          aria-label="Recompare worktrees"
          title="Recompare worktrees"
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {error ? (
        <div className="git-history-message error" role="alert">
          <Icon name="alertCircle" size={22} />
          <strong>Comparison unavailable</strong>
          <span>{error}</span>
          <button onClick={() => void load(true)}>Retry</button>
        </div>
      ) : loading && !report ? (
        <div className="git-commit-skeleton" aria-label="Comparing worktrees">
          <span />
          <span />
          <span />
        </div>
      ) : active.length === 0 ? (
        <div className="git-history-message">
          <Icon name="gitBranch" size={26} />
          <strong>No overlapping work</strong>
          <span>
            {repositories.length === 0
              ? 'Open terminals in a repository to compare what each agent is touching.'
              : 'Every agent is currently working on its own files.'}
          </span>
        </div>
      ) : (
        <div className="conflict-list">
          {active.map((repository) => (
            <section className="conflict-repo" key={repository.repository_id}>
              <header>
                <strong>{repository.repository_name}</strong>
                <span>
                  {repository.worktrees.length} checkout
                  {repository.worktrees.length === 1 ? '' : 's'}
                </span>
              </header>

              {repository.shared_checkouts.length > 0 ? (
                <div className="conflict-warning" role="alert">
                  <Icon name="alertTriangle" size={14} />
                  <span>
                    <strong>Same working tree:</strong> {repository.shared_checkouts.join(', ')}.
                    Git cannot arbitrate this — the last write wins.
                  </span>
                </div>
              ) : null}

              {repository.error ? (
                <div className="conflict-warning" role="alert">
                  <Icon name="alertCircle" size={14} />
                  <span>{repository.error}</span>
                </div>
              ) : null}

              {repository.worktrees.length > 0 ? (
                <ul className="conflict-legend">
                  {repository.worktrees.map((worktree) => (
                    <li key={worktree.worktree_id}>
                      <code>{worktree.branch || worktree.name}</code>
                      <span>
                        {worktree.files} file{worktree.files === 1 ? '' : 's'} ·{' '}
                        {worktree.agents.join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {repository.conflicts.length > 0 ? (
                <ul className="conflict-files">
                  {repository.conflicts.map((conflict) => (
                    <li key={conflict.path}>
                      <span className="conflict-path" title={conflict.path}>
                        {conflict.path}
                      </span>
                      <span className="conflict-owners">
                        {worktreeNames(repository, conflict.worktree_ids)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </>
  )
}
