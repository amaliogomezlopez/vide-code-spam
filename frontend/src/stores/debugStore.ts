import { create } from 'zustand'

export type DebugLevel = 'info' | 'warn' | 'error'

export interface DebugEvent {
  id: number
  at: string
  level: DebugLevel
  source: string
  message: string
}

interface DebugState {
  events: DebugEvent[]
  add: (source: string, message: string, level?: DebugLevel) => void
  clear: () => void
}

let nextId = 1

export const useDebugStore = create<DebugState>((set) => ({
  events: [],
  add: (source, message, level = 'info') =>
    set((state) => ({
      events: [
        ...state.events,
        {
          id: nextId++,
          at: new Date().toLocaleTimeString(),
          level,
          source,
          message,
        },
      ].slice(-80),
    })),
  clear: () => set({ events: [] }),
}))
