import { describe, expect, it } from 'vitest'
import type { OverlapReport } from '../services/api'
import { totalConflicts } from './overlapStore'

function report(partial: Partial<OverlapReport['repositories'][number]>): OverlapReport {
  return {
    generated_at: 0,
    repositories: [
      {
        repository_id: 'repo-1',
        repository_name: 'vibe-spam',
        base: 'abc',
        worktrees: [],
        conflicts: [],
        shared_checkouts: [],
        error: '',
        ...partial,
      },
    ],
  }
}

describe('totalConflicts', () => {
  it('is zero without a report', () => {
    expect(totalConflicts(null)).toBe(0)
  })

  it('counts overlapping files', () => {
    const value = report({
      conflicts: [
        { path: 'src/app.ts', worktree_ids: ['a', 'b'] },
        { path: 'src/api.ts', worktree_ids: ['a', 'c'] },
      ],
    })

    expect(totalConflicts(value)).toBe(2)
  })

  it('counts a shared checkout as its own risk', () => {
    expect(totalConflicts(report({ shared_checkouts: ['Main checkout'] }))).toBe(1)
  })

  it('adds both kinds of risk together', () => {
    const value = report({
      conflicts: [{ path: 'src/app.ts', worktree_ids: ['a', 'b'] }],
      shared_checkouts: ['Main checkout'],
    })

    expect(totalConflicts(value)).toBe(2)
  })
})
