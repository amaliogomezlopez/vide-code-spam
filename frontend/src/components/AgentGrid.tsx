import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import AddAgentModal from './AddAgentModal'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'
import SessionRestoreBanner from './SessionRestoreBanner'
import { deleteAgent, deleteAllAgents, fetchAgents, removeWorktree, startAgent, stopAgent } from '../services/api'
import { needsAttention } from '../services/attention'
import {
  filterAgentsByGit,
  groupAgentsByGit,
  worktreesWithMultipleWriters,
} from '../services/gitWorkspace'
import { useNow } from '../hooks/useNow'
import { useAgentStore } from '../stores/agentStore'
import { useGitWorkspaceStore } from '../stores/gitWorkspaceStore'
import { useTerminalActivityStore } from '../stores/terminalActivityStore'

const AgentTerminal = lazy(() => import('./AgentTerminal'))

export default function AgentGrid() {
  const { agents, setAgents, selectAgent, selectedAgent, removeAgent, updateAgentStatus } =
    useAgentStore()
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | {
    title: string
    message: string
    confirmLabel?: string
    onConfirm: () => void
  }>(null)
  const refreshingRef = useRef(false)
  const filter = useGitWorkspaceStore((state) => state.filter)
  const setFilter = useGitWorkspaceStore((state) => state.setFilter)
  const activity = useTerminalActivityStore((state) => state.activity)
  const noteSeen = useTerminalActivityStore((state) => state.noteSeen)
  const forgetActivity = useTerminalActivityStore((state) => state.forget)
  // Two seconds is invisible against a 4 s silence threshold and halves the
  // re-renders of a grid that can hold nine live terminals.
  const now = useNow(2000)
  const visibleAgents = useMemo(() => filterAgentsByGit(agents, filter), [agents, filter])
  const visibleIds = useMemo(
    () => new Set(visibleAgents.map((agent) => agent.id)),
    [visibleAgents]
  )
  const sharedCheckouts = useMemo(
    () => worktreesWithMultipleWriters(groupAgentsByGit(agents)),
    [agents]
  )
  const selectedTargetHidden = Boolean(filter && selectedAgent && !visibleIds.has(selectedAgent))

  const refresh = async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAgents()
      setAgents(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents')
    } finally {
      refreshingRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [setAgents])

  const focusAgent = (id: string) => {
    selectAgent(id)
    noteSeen(id)
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirm({
      title: 'Close terminal',
      message: 'Close this terminal and stop its process?',
      onConfirm: async () => {
        setConfirm(null)
        try {
          await deleteAgent(id)
          removeAgent(id)
          forgetActivity(id)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to delete agent')
        }
      },
    })
  }

  const handleCloseAll = () => {
    if (agents.length === 0) return
    setConfirm({
      title: 'Close all terminals',
      message: `Close all ${agents.length} terminals? Every running CLI process will be stopped.`,
      onConfirm: async () => {
        setConfirm(null)
        setLoading(true)
        setError(null)
        try {
          await deleteAllAgents()
          agents.forEach((agent) => forgetActivity(agent.id))
          setAgents([])
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to close all agents')
          refresh()
        } finally {
          setLoading(false)
        }
      },
    })
  }

  const toggleStatus = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const agent = agents.find((a) => a.id === id)
    if (!agent) return
    try {
      if (agent.status === 'running') {
        await stopAgent(id)
        updateAgentStatus(id, 'stopped')
      } else {
        await startAgent(id)
        updateAgentStatus(id, 'running')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle agent')
    }
  }

  const handleRemoveWorktree = (agent: (typeof agents)[number], e: React.MouseEvent) => {
    e.stopPropagation()
    const sharedAgents = agents.filter(
      (item) => item.git?.worktree_id === agent.git?.worktree_id
    ).length
    setConfirm({
      title: 'Remove worktree',
      message: `Stop ${sharedAgents} terminal${sharedAgents === 1 ? '' : 's'} and remove this worktree? Uncommitted changes block removal. The Git branch is preserved.`,
      confirmLabel: 'Remove worktree',
      onConfirm: async () => {
        setConfirm(null)
        setLoading(true)
        setError(null)
        try {
          await removeWorktree(agent.cwd)
          await refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to remove worktree')
        } finally {
          setLoading(false)
        }
      },
    })
  }

  return (
    <div className="grid-wrap">
      <div className="toolbar">
        <div className="toolbar-actions">
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Icon name="plus" />
            Open terminal
          </button>
          <button onClick={refresh} disabled={loading}>
            <Icon name="refresh" />
            Refresh
          </button>
          <button
            className="btn-danger"
            onClick={handleCloseAll}
            disabled={loading || agents.length === 0}
            title="Close every open terminal"
          >
            <Icon name="trash" />
            Close all
          </button>
        </div>
        <span className="count-pill">
          {filter ? `${visibleAgents.length} of ${agents.length}` : agents.length} terminal
          {(filter ? agents.length : visibleAgents.length) === 1 ? '' : 's'}
        </span>
      </div>

      <SessionRestoreBanner agents={agents} onRestored={refresh} />

      {sharedCheckouts.length > 0 ? (
        <div className="shared-checkout-warning" role="status">
          <Icon name="alertTriangle" size={15} />
          <div>
            <strong>
              {sharedCheckouts.length === 1
                ? 'Two or more terminals share one checkout'
                : `${sharedCheckouts.length} checkouts have more than one terminal`}
            </strong>
            <span>
              {sharedCheckouts
                .map((worktree) => `${worktree.name} (${worktree.agents.length})`)
                .join(' · ')}
              . Agents writing in the same working tree overwrite each other without a Git
              conflict — give each writer its own worktree.
            </span>
          </div>
        </div>
      ) : null}

      {filter ? (
        <div className="grid-context-bar" aria-live="polite">
          <div className="grid-context-copy">
            <Icon name="gitBranch" size={14} />
            <span>Filtered by</span>
            <strong title={filter.label}>{filter.label}</strong>
          </div>
          {selectedTargetHidden ? (
            <span className="hidden-target-note">Voice target remains outside this view.</span>
          ) : null}
          <button className="btn-ghost btn-xs" onClick={() => setFilter(null)}>
            <Icon name="close" size={13} />
            Clear filter
          </button>
        </div>
      ) : null}

      {error && (
        <div className="error-banner">
          <Icon name="alertCircle" />
          {error}
        </div>
      )}

      {agents.length === 0 && !error && (
        <div className="empty-state">
          <Icon name="terminal" size={56} className="empty-icon" />
          <h3>No terminals yet</h3>
          <p>Open a CLI terminal to start vibe-coding. Pick a preset like Kimi, Claude or Codex.</p>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Icon name="plus" />
            Open terminal
          </button>
        </div>
      )}

      {agents.length > 0 && visibleAgents.length === 0 && !error ? (
        <div className="empty-state filtered-empty-state">
          <Icon name="gitBranch" size={48} className="empty-icon" />
          <h3>No terminals in this Git context</h3>
          <p>The selected repository or worktree no longer has an open terminal.</p>
          <button onClick={() => setFilter(null)}>
            <Icon name="close" />
            Show all terminals
          </button>
        </div>
      ) : null}

      <div className="terminal-grid">
        {/* Filtered-out terminals stay mounted and merely hidden: unmounting one
            disposes its xterm instance and throws away the whole session's
            scrollback. */}
        {agents.map((agent) => {
          const hidden = !visibleIds.has(agent.id)
          const waiting = needsAttention(activity[agent.id], now)
          return (
            <div
              key={agent.id}
              onClick={() => focusAgent(agent.id)}
              className={`terminal-card${selectedAgent === agent.id ? ' selected' : ''}${
                hidden ? ' filtered-out' : ''
              }${waiting ? ' needs-attention' : ''}`}
              hidden={hidden}
            >
              <div className="terminal-header">
                <div className="terminal-title">
                  <Icon name="terminal" size={18} className="term-icon" />
                  <div className="terminal-title-meta">
                    <strong>{agent.name}</strong>
                    {agent.cwd && (
                      <span className="terminal-cwd" title={agent.cwd}>
                        {agent.cwd}
                      </span>
                    )}
                    {agent.cwd_drifted && agent.process_cwd_actual ? (
                      <span
                        className="cwd-drift"
                        title={`The process moved to ${agent.process_cwd_actual}. The Git context below still describes the launch folder.`}
                      >
                        <Icon name="alertTriangle" size={11} />
                        moved to {agent.process_cwd_actual}
                      </span>
                    ) : null}
                    {agent.git?.is_git && (
                      <span
                        className={`git-status${agent.git.dirty ? ' dirty' : ''}`}
                        title={`Git branch: ${agent.git.branch || 'detached'}`}
                      >
                        <span>⑂</span> {agent.git.branch || 'detached'}
                        {agent.git.dirty ? ' • modified' : ''}
                        {agent.git.ahead ? ` ↑${agent.git.ahead}` : ''}
                        {agent.git.behind ? ` ↓${agent.git.behind}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="terminal-actions">
                  {waiting ? (
                    <span className="attention-pill" title="Idle since its last output">
                      <Icon name="bell" size={12} />
                      Waiting
                    </span>
                  ) : null}
                  <span className={`agent-status ${agent.status}`}>
                    <span className="status-dot" />
                    {agent.status}
                  </span>
                  <button
                    className="btn-xs"
                    onClick={(e) => toggleStatus(agent.id, e)}
                    title={agent.status === 'running' ? 'Stop' : 'Start'}
                  >
                    <Icon name={agent.status === 'running' ? 'stop' : 'play'} size={14} />
                    {agent.status === 'running' ? 'Stop' : 'Start'}
                  </button>
                  {agent.git?.is_worktree && (
                    <button className="btn-xs" onClick={(e) => handleRemoveWorktree(agent, e)} title="Remove clean Git worktree">
                      <Icon name="trash" size={14} /> Worktree
                    </button>
                  )}
                  <button
                    className="btn-danger btn-xs"
                    onClick={(e) => handleDelete(agent.id, e)}
                    title="Close"
                  >
                    <Icon name="close" size={14} />
                    Close
                  </button>
                </div>
              </div>
              <Suspense fallback={<div className="terminal-surface" aria-label="Loading terminal" />}>
                <AgentTerminal agent={agent} />
              </Suspense>
            </div>
          )
        })}
      </div>

      {showModal && <AddAgentModal onClose={() => setShowModal(false)} onCreated={refresh} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={
            confirm.confirmLabel ?? (confirm.title === 'Close all terminals' ? 'Close all' : 'Close')
          }
          cancelLabel="Cancel"
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
