import { useCallback, useEffect, useState } from 'react'
import {
  createSnapshot,
  deleteSnapshot,
  fetchMergePreview,
  fetchSnapshots,
  integrateBranch,
  openPullRequest,
  restoreSnapshot,
  type MergePreview,
  type Snapshot,
} from '../services/api'
import { formatRelativeTime } from '../services/gitWorkspace'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'

interface Props {
  worktreeId: string | null
  contextLabel: string
  branch: string
  onChooseCheckout: () => void
  onChanged: () => void
}

// One literal per member so TypeScript can narrow the discriminant exactly.
type PendingAction =
  | { kind: 'merge' }
  | { kind: 'cherry-pick' }
  | { kind: 'restore'; tag: string }
  | { kind: 'delete'; tag: string }

/**
 * What to do with a branch once its work is done.
 *
 * The conflict radar tells you two agents collided; this closes the loop:
 * preview the merge without touching any working tree, integrate it (or open a
 * PR), and keep restore points so an agent's `reset --hard` is recoverable.
 */
export default function GitIntegrationPanel({
  worktreeId,
  contextLabel,
  branch,
  onChooseCheckout,
  onChanged,
}: Props) {
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!worktreeId) {
      setPreview(null)
      setSnapshots([])
      setError(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([
      fetchMergePreview(worktreeId, controller.signal),
      fetchSnapshots(worktreeId, controller.signal),
    ])
      .then(([mergePreview, snapshotList]) => {
        setPreview(mergePreview)
        setSnapshots(snapshotList.snapshots)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not inspect the branch')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [worktreeId, reload])

  const refresh = useCallback(() => setReload((value) => value + 1), [])

  const run = useCallback(
    async (action: () => Promise<string>) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        setNotice(await action())
        refresh()
        onChanged()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The operation failed')
      } finally {
        setBusy(false)
      }
    },
    [onChanged, refresh]
  )

  const confirmPending = useCallback(async () => {
    if (!worktreeId || !pending) return
    const action = pending
    setPending(null)
    if (action.kind === 'merge' || action.kind === 'cherry-pick') {
      await run(async () => {
        const result = await integrateBranch(worktreeId, action.kind)
        return `${action.kind === 'merge' ? 'Merged' : 'Cherry-picked'} ${result.branch} into ${result.target}.`
      })
      return
    }
    if (action.kind === 'restore') {
      await run(async () => {
        await restoreSnapshot(worktreeId, action.tag)
        return 'Restore point applied. Files created after it are still present.'
      })
      return
    }
    await run(async () => {
      await deleteSnapshot(worktreeId, action.tag)
      return 'Restore point deleted.'
    })
  }, [pending, run, worktreeId])

  if (!worktreeId) {
    return (
      <div className="git-history-message">
        <Icon name="gitMerge" size={26} />
        <strong>Select a checkout</strong>
        <span>Choose a worktree in Repositories to preview and integrate its branch.</span>
        <button onClick={onChooseCheckout}>Choose checkout</button>
      </div>
    )
  }

  const confirmCopy: Record<PendingAction['kind'], { title: string; message: string }> = {
    merge: {
      title: 'Merge branch',
      message: `Merge ${branch} into the repository's main checkout? It must be clean, and a failed merge is rolled back automatically.`,
    },
    'cherry-pick': {
      title: 'Cherry-pick branch',
      message: `Replay every commit of ${branch} onto the main checkout? A conflict aborts and restores the previous state.`,
    },
    restore: {
      title: 'Apply restore point',
      message:
        'Restore tracked files from this point. Untracked files were never captured and files added since are not removed; current changes to tracked files are overwritten.',
    },
    delete: { title: 'Delete restore point', message: 'Delete this restore point permanently?' },
  }

  return (
    <>
      <div className="git-history-context">
        <div>
          <span>Integrate</span>
          <strong title={contextLabel}>{contextLabel}</strong>
        </div>
        <code>{branch}</code>
        <button
          className="btn-ghost icon-button"
          onClick={refresh}
          disabled={loading || busy}
          aria-label="Refresh integration status"
          title="Refresh"
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {notice ? (
        <div className="conflict-warning integration-notice" role="status">
          <Icon name="info" size={14} />
          <span>{notice}</span>
        </div>
      ) : null}
      {error ? (
        <div className="conflict-warning integration-error" role="alert">
          <Icon name="alertCircle" size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && !preview ? (
        <div className="git-commit-skeleton" aria-label="Inspecting branch">
          <span />
          <span />
          <span />
        </div>
      ) : preview ? (
        <section className="integration-block">
          <header>
            <strong>Merge preview</strong>
            <span>
              ↑{preview.ahead} ↓{preview.behind} vs <code>{preview.target}</code>
            </span>
          </header>
          {preview.up_to_date ? (
            <p className="integration-state neutral">
              Nothing to integrate: this branch has no commits beyond {preview.target}.
            </p>
          ) : preview.clean ? (
            <p className="integration-state clean">
              Merges cleanly — {preview.ahead} commit{preview.ahead === 1 ? '' : 's'} would land on{' '}
              {preview.target}.
            </p>
          ) : (
            <>
              <p className="integration-state conflicted">
                {preview.conflicts.length} file
                {preview.conflicts.length === 1 ? '' : 's'} would conflict. Resolve them in the
                worktree before integrating.
              </p>
              <ul className="conflict-files">
                {preview.conflicts.slice(0, 50).map((path) => (
                  <li key={path}>
                    <span className="conflict-path" title={path}>
                      {path}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="integration-actions">
            <button
              className="btn-primary btn-xs"
              disabled={busy || preview.up_to_date || !preview.clean}
              onClick={() => setPending({ kind: 'merge' })}
              title={
                preview.clean ? 'Merge into the main checkout' : 'Resolve the conflicts first'
              }
            >
              <Icon name="gitMerge" size={13} />
              Merge
            </button>
            <button
              className="btn-xs"
              disabled={busy || preview.up_to_date || !preview.clean}
              onClick={() => setPending({ kind: 'cherry-pick' })}
            >
              <Icon name="commit" size={13} />
              Cherry-pick
            </button>
            <button
              className="btn-xs"
              disabled={busy || preview.up_to_date}
              onClick={() =>
                void run(async () => {
                  const result = await openPullRequest(
                    worktreeId,
                    `${branch}`,
                    'Opened from Vibe Spam.'
                  )
                  return result.url ? `Pull request created: ${result.url}` : 'Pull request created.'
                })
              }
              title="Push the branch and open a pull request with the GitHub CLI"
            >
              <Icon name="gitBranch" size={13} />
              Pull request
            </button>
          </div>
        </section>
      ) : null}

      <section className="integration-block">
        <header>
          <strong>Restore points</strong>
          <button
            className="btn-xs"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const snapshot = await createSnapshot(
                  worktreeId,
                  `Manual restore point for ${branch}`
                )
                return `Restore point created (${snapshot.sha.slice(0, 7)}).`
              })
            }
          >
            <Icon name="plus" size={13} />
            Create
          </button>
        </header>
        {snapshots.length === 0 ? (
          <p className="integration-state neutral">
            No restore points yet. Create one before letting an agent rewrite this checkout — they
            capture tracked files only, which is exactly what <code>git reset --hard</code>{' '}
            destroys.
          </p>
        ) : (
          <ul className="snapshot-list">
            {snapshots.map((snapshot) => (
              <li key={snapshot.tag}>
                <div className="snapshot-copy">
                  <span title={snapshot.label}>{snapshot.label || snapshot.tag}</span>
                  <code>
                    {snapshot.sha.slice(0, 7)} · {formatRelativeTime(snapshot.created_at)}
                  </code>
                </div>
                <button
                  className="btn-xs"
                  disabled={busy}
                  onClick={() => setPending({ kind: 'restore', tag: snapshot.tag })}
                >
                  <Icon name="restore" size={13} />
                  Restore
                </button>
                <button
                  className="btn-xs btn-danger"
                  disabled={busy}
                  onClick={() => setPending({ kind: 'delete', tag: snapshot.tag })}
                  aria-label={`Delete ${snapshot.tag}`}
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending ? (
        <ConfirmDialog
          title={confirmCopy[pending.kind].title}
          message={confirmCopy[pending.kind].message}
          confirmLabel={confirmCopy[pending.kind].title}
          cancelLabel="Cancel"
          danger
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  )
}
