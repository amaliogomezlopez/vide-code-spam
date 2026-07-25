import { useEffect, useMemo, useRef } from 'react'
import { useNow } from '../hooks/useNow'
import { attentionIds } from '../services/attention'
import { useAgentStore } from '../stores/agentStore'
import { useTerminalActivityStore } from '../stores/terminalActivityStore'
import Icon from './Icon'

/**
 * Topbar counter for terminals waiting on the user.
 *
 * It owns its own clock so the ticking stays inside this component instead of
 * re-rendering the whole app (and the Git sidebar tree) once per second.
 */
export default function AttentionPill() {
  const agents = useAgentStore((state) => state.agents)
  const selectAgent = useAgentStore((state) => state.selectAgent)
  const activity = useTerminalActivityStore((state) => state.activity)
  const noteSeen = useTerminalActivityStore((state) => state.noteSeen)
  const now = useNow(2000)

  const waiting = useMemo(
    () =>
      attentionIds(
        activity,
        agents.map((agent) => agent.id),
        now
      ),
    [activity, agents, now]
  )

  // Notify once per terminal per waiting episode: the id leaves the set as soon
  // as the user looks at it or the agent produces output again.
  const notified = useRef<Set<string>>(new Set())
  useEffect(() => {
    const current = new Set(waiting)
    for (const id of notified.current) {
      if (!current.has(id)) notified.current.delete(id)
    }
    for (const id of waiting) {
      if (notified.current.has(id)) continue
      notified.current.add(id)
      const agent = agents.find((item) => item.id === id)
      if (!agent) continue
      void window.electronAPI?.notifyAttention?.({
        title: `${agent.name} is waiting`,
        body: agent.cwd ? `No output since its last message · ${agent.cwd}` : 'No output since its last message',
      })
    }
  }, [agents, waiting])

  if (waiting.length === 0) return null

  return (
    <button
      className="attention-pill topbar-attention"
      onClick={() => {
        const next = waiting[0]
        selectAgent(next)
        noteSeen(next)
        document.getElementById(`terminal-${next}`)?.focus()
      }}
      title="Jump to the first terminal waiting for you"
    >
      <Icon name="bell" size={13} />
      {waiting.length} waiting
    </button>
  )
}
