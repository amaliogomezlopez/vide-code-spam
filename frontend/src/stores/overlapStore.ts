import { create } from 'zustand'
import { fetchOverlaps, type OverlapReport } from '../services/api'

interface OverlapState {
  report: OverlapReport | null
  loading: boolean
  error: string | null
  load: (refresh?: boolean) => Promise<void>
}

let inFlight: Promise<void> | null = null

export const useOverlapStore = create<OverlapState>((set) => ({
  report: null,
  loading: false,
  error: null,
  load: async (refresh = false) => {
    // The report is polled for the sidebar badge and requested again when the
    // panel opens; one request at a time is enough.
    if (inFlight) return inFlight
    set({ loading: true })
    inFlight = fetchOverlaps(refresh)
      .then((report) => {
        set({ report, error: null })
      })
      .catch((error: unknown) => {
        set({ error: error instanceof Error ? error.message : 'Failed to compare worktrees' })
      })
      .finally(() => {
        inFlight = null
        set({ loading: false })
      })
    return inFlight
  },
}))

export function totalConflicts(report: OverlapReport | null): number {
  if (!report) return 0
  return report.repositories.reduce(
    (total, repository) => total + repository.conflicts.length + repository.shared_checkouts.length,
    0
  )
}
