import { useCallback, useEffect, useState } from 'react'
import {
  fetchWorktreeInventory,
  removeWorktree,
  type RepositoryWorktrees,
  type WorktreeEntry,
} from '../services/api'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'

/**
 * Every worktree of every open repository, not just the ones with a terminal.
 *
 * Vibe Spam creates worktrees and branches on demand, and until now they became
 * invisible as soon as their terminal closed — so they piled up on disk with no
 * way to find or remove them from the app.
 */
export default function GitWorktreesPanel() {
  const [repositories, setRepositories] = useState<RepositoryWorktrees[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<WorktreeEntry | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchWorktreeInventory(controller.signal)
      .then((inventory) => setRepositories(inventory.repositories))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not list worktrees')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reload])

  const confirmRemoval = useCallback(async () => {
    if (!pending) return
    const target = pending
    setPending(null)
    setActionError(null)
    try {
      await removeWorktree(target.path)
      setReload((value) => value + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove the worktree')
    }
  }, [pending])

  const total = repositories.reduce(
    (count, repository) => count + repository.worktrees.length,
    0
  )

  return (
    <>
      <div className="git-history-context">
        <div>
          <span>Inventory</span>
          <strong>
            {total} worktree{total === 1 ? '' : 's'}
          </strong>
        </div>
        <button
          className="btn-ghost icon-button"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
          aria-label="Refresh worktrees"
          title="Refresh worktrees"
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {actionError ? (
        <div className="conflict-warning" role="alert">
          <Icon name="alertCircle" size={14} />
          <span>{actionError}</span>
        </div>
      ) : null}

      {error ? (
        <div className="git-history-message error" role="alert">
          <Icon name="alertCircle" size={22} />
          <strong>Inventory unavailable</strong>
          <span>{error}</span>
          <button onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>
      ) : repositories.length === 0 ? (
        <div className="git-history-message">
          <Icon name="layers" size={26} />
          <strong>No repositories open</strong>
          <span>Open a terminal inside a repository to inspect its worktrees.</span>
        </div>
      ) : (
        <div className="worktree-inventory">
          {repositories.map((repository) => (
            <section key={repository.repository_id}>
              <header>
                <strong title={repository.repository_root}>{repository.repository_name}</strong>
                <span>
                  {repository.worktrees.length} checkout
                  {repository.worktrees.length === 1 ? '' : 's'}
                </span>
              </header>
              {repository.error ? (
                <div className="conflict-warning">
                  <Icon name="alertCircle" size={14} />
                  <span>{repository.error}</span>
                </div>
              ) : null}
              <ul>
                {repository.worktrees.map((worktree) => (
                  <li key={worktree.id} className={worktree.terminals > 0 ? 'in-use' : ''}>
                    <div className="worktree-inventory-copy">
                      <span className="worktree-inventory-name" title={worktree.path}>
                        {worktree.is_main ? 'Main checkout' : worktree.name}
                      </span>
                      <code>
                        {worktree.branch ||
                          (worktree.head ? `detached@${worktree.head.slice(0, 7)}` : 'No commits')}
                      </code>
                    </div>
                    <div className="worktree-inventory-tags">
                      {worktree.terminals > 0 ? (
                        <span className="tag-live">
                          {worktree.terminals} terminal{worktree.terminals === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="tag-idle">No terminal</span>
                      )}
                      {!worktree.exists ? <span className="tag-warn">Missing</span> : null}
                      {worktree.prunable ? <span className="tag-warn">Prunable</span> : null}
                      {worktree.locked ? <span className="tag-warn">Locked</span> : null}
                    </div>
                    {!worktree.is_main ? (
                      <button
                        className="btn-xs btn-danger"
                        onClick={() => setPending(worktree)}
                        title="Remove this worktree (only when clean)"
                      >
                        <Icon name="trash" size={13} />
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pending ? (
        <ConfirmDialog
          title="Remove worktree"
          message={`Remove ${pending.path}? Uncommitted changes block removal and the branch ${
            pending.branch || 'it points to'
          } is preserved.`}
          confirmLabel="Remove worktree"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmRemoval}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  )
}
