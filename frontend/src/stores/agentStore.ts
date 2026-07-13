import { create } from 'zustand'
import type { Agent } from '../services/api'

interface AgentState {
  agents: Agent[]
  selectedAgent: string | null
  setAgents: (agents: Agent[]) => void
  addAgent: (agent: Agent) => void
  removeAgent: (id: string) => void
  selectAgent: (id: string | null) => void
  updateAgentStatus: (id: string, status: Agent['status']) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selectedAgent: null,
  setAgents: (agents) =>
    set((state) => {
      const selectedStillExists =
        state.selectedAgent !== null && agents.some((agent) => agent.id === state.selectedAgent)
      return {
        agents,
        selectedAgent: selectedStillExists ? state.selectedAgent : (agents[0]?.id ?? null),
      }
    }),
  addAgent: (agent) =>
    set((state) => ({
      agents: [...state.agents, agent],
      selectedAgent: state.selectedAgent ?? agent.id,
    })),
  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      selectedAgent:
        state.selectedAgent === id
          ? (state.agents.filter((a) => a.id !== id)[0]?.id ?? null)
          : state.selectedAgent,
    })),
  selectAgent: (id) => set({ selectedAgent: id }),
  updateAgentStatus: (id, status) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, status } : a)),
    })),
}))
