// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverlapReport } from '../services/api'
import { useOverlapStore } from '../stores/overlapStore'
import GitConflictsPanel from './GitConflictsPanel'

const fetchOverlaps = vi.fn<() => Promise<OverlapReport>>()

vi.mock('../services/api', () => ({
  fetchOverlaps: () => fetchOverlaps(),
}))

function report(partial: Partial<OverlapReport['repositories'][number]>): OverlapReport {
  return {
    generated_at: 0,
    repositories: [
      {
        repository_id: 'repo-1',
        repository_name: 'vibe-spam',
        base: 'abc1234',
        worktrees: [
          {
            worktree_id: 'wt-a',
            name: 'wt-alpha',
            branch: 'vibe/alpha',
            files: 2,
            agents: ['Smoke 1'],
          },
          {
            worktree_id: 'wt-b',
            name: 'wt-beta',
            branch: 'vibe/beta',
            files: 1,
            agents: ['Smoke 2'],
          },
        ],
        conflicts: [],
        shared_checkouts: [],
        error: '',
        ...partial,
      },
    ],
  }
}

beforeEach(() => {
  fetchOverlaps.mockReset()
  useOverlapStore.setState({ report: null, loading: false, error: null })
})

afterEach(cleanup)

describe('GitConflictsPanel', () => {
  it('names the file two agents are fighting over', async () => {
    fetchOverlaps.mockResolvedValue(
      report({ conflicts: [{ path: 'src/shared.ts', worktree_ids: ['wt-a', 'wt-b'] }] })
    )

    render(<GitConflictsPanel />)

    expect(await screen.findByText('src/shared.ts')).toBeTruthy()
    // The owners are shown by worktree name, not by opaque id.
    expect(screen.getByText('wt-alpha ↔ wt-beta')).toBeTruthy()
  })

  it('calls out a checkout shared by several terminals', async () => {
    fetchOverlaps.mockResolvedValue(report({ shared_checkouts: ['Main checkout'] }))

    render(<GitConflictsPanel />)

    expect(await screen.findByText(/Same working tree:/)).toBeTruthy()
  })

  it('reports peace when nothing overlaps', async () => {
    fetchOverlaps.mockResolvedValue(report({}))

    render(<GitConflictsPanel />)

    expect(await screen.findByText('No overlapping work')).toBeTruthy()
  })

  it('surfaces a comparison failure instead of pretending it is clean', async () => {
    fetchOverlaps.mockRejectedValue(new Error('git exploded'))

    render(<GitConflictsPanel />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('git exploded')).toBeTruthy()
  })
})
