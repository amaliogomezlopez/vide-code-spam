import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import AddAgentModal from './AddAgentModal'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'
import { deleteAgent, deleteAllAgents, fetchAgents, removeWorktree, startAgent, stopAgent } from '../services/api'
import { useAgentStore } from '../stores/agentStore'

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
    onConfirm: () => void
  }>(null)
  const refreshingRef = useRef(false)

  const gridCols = Math.max(1, Math.ceil(Math.sqrt(agents.length)))

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

  const handleRemoveWorktree = (id: string, cwd: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirm({
      title: 'Remove worktree',
      message: 'Stop this terminal and remove its worktree? Uncommitted changes block removal. The Git branch is preserved.',
      onConfirm: async () => {
        setConfirm(null)
        try {
          await deleteAgent(id)
          removeAgent(id)
          await removeWorktree(cwd)
          await refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to remove worktree')
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
          {agents.length} terminal{agents.length === 1 ? '' : 's'}
        </span>
      </div>

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

      <div
        className="terminal-grid"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        }}
      >
        {agents.map((agent) => (
          <div
            key={agent.id}
            onClick={() => selectAgent(agent.id)}
            className={`terminal-card${selectedAgent === agent.id ? ' selected' : ''}`}
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
                  {agent.git?.is_git && (
                    <span className={`git-status${agent.git.dirty ? ' dirty' : ''}`} title="Git branch status">
                      <span>⑂</span> {agent.git.branch || 'detached'}
                      {agent.git.dirty ? ' • modified' : ''}
                      {agent.git.ahead ? ` ↑${agent.git.ahead}` : ''}
                      {agent.git.behind ? ` ↓${agent.git.behind}` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="terminal-actions">
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
                  <button className="btn-xs" onClick={(e) => handleRemoveWorktree(agent.id, agent.cwd, e)} title="Remove clean Git worktree">
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
        ))}
      </div>

      {showModal && <AddAgentModal onClose={() => setShowModal(false)} onCreated={refresh} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.title === 'Close all terminals' ? 'Close all' : 'Close'}
          cancelLabel="Cancel"
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
