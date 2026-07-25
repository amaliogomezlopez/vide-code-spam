import { create } from 'zustand'
import type { TerminalActivity } from '../services/attention'

interface TerminalActivityState {
  activity: Record<string, TerminalActivity>
  noteOutput: (id: string) => void
  noteSeen: (id: string) => void
  forget: (id: string) => void
}

// Output arrives in bursts; recording every chunk would re-render the whole grid
// dozens of times per second for no visible gain.
const OUTPUT_THROTTLE_MS = 400

export const useTerminalActivityStore = create<TerminalActivityState>((set, get) => ({
  activity: {},
  noteOutput: (id) => {
    const now = Date.now()
    const current = get().activity[id]
    if (current && now - current.lastOutputAt < OUTPUT_THROTTLE_MS) return
    set((state) => ({
      activity: {
        ...state.activity,
        [id]: { lastOutputAt: now, seenAt: current?.seenAt ?? 0 },
      },
    }))
  },
  noteSeen: (id) =>
    set((state) => {
      const current = state.activity[id]
      const now = Date.now()
      if (current && current.seenAt >= current.lastOutputAt) return state
      return {
        activity: {
          ...state.activity,
          [id]: { lastOutputAt: current?.lastOutputAt ?? 0, seenAt: now },
        },
      }
    }),
  forget: (id) =>
    set((state) => {
      if (!(id in state.activity)) return state
      const next = { ...state.activity }
      delete next[id]
      return { activity: next }
    }),
}))
