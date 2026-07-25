import { describe, expect, it } from 'vitest'
import type { Agent } from './api'
import {
  filterAgentsByGit,
  formatRelativeTime,
  groupAgentsByGit,
  totalDirtyWorktrees,
  worktreesWithMultipleWriters,
  type GitContextFilter,
} from './gitWorkspace'

function agent(
  id: string,
  git: Agent['git'],
  overrides: Partial<Agent> = {}
): Agent {
  return {
    id,
    name: id,
    command: 'codex',
    args: '',
    cwd: git.root || '',
    status: 'running',
    git,
    ...overrides,
  }
}

const mainGit: Agent['git'] = {
  is_git: true,
  root: 'D:/repos/vibe-spam',
  worktree_name: 'vibe-spam',
  worktree_id: 'worktree-main',
  repository_root: 'D:/repos/vibe-spam',
  repository_name: 'VIBE-SPAM',
  repository_id: 'repo-vibe',
  branch: 'main',
  is_main_worktree: true,
  dirty: true,
  changed: 2,
}

describe('Git workspace grouping', () => {
  it('deduplicates terminals that share one checkout', () => {
    const grouped = groupAgentsByGit([agent('one', mainGit), agent('two', mainGit)])

    expect(grouped.repositories).toHaveLength(1)
    expect(grouped.repositories[0].worktrees).toHaveLength(1)
    expect(grouped.repositories[0].worktrees[0].agents.map((item) => item.id)).toEqual([
      'one',
      'two',
    ])
    expect(totalDirtyWorktrees(grouped)).toBe(1)
  })

  it('flags checkouts where more than one terminal can write', () => {
    const linked = {
      ...mainGit,
      root: 'D:/repos/vibe-spam-worktrees/api',
      worktree_name: 'api',
      worktree_id: 'worktree-api',
      branch: 'vibe/api',
      is_main_worktree: false,
    }
    const grouped = groupAgentsByGit([
      agent('one', mainGit),
      agent('two', mainGit),
      agent('solo', linked),
    ])

    const shared = worktreesWithMultipleWriters(grouped)

    expect(shared.map((item) => item.id)).toEqual(['worktree-main'])
    expect(shared[0].agents).toHaveLength(2)
  })

  it('reports no shared checkout when every terminal has its own worktree', () => {
    const linked = {
      ...mainGit,
      root: 'D:/repos/vibe-spam-worktrees/api',
      worktree_id: 'worktree-api',
      is_main_worktree: false,
    }

    expect(worktreesWithMultipleWriters(groupAgentsByGit([
      agent('one', mainGit),
      agent('two', linked),
    ]))).toEqual([])
  })

  it('groups linked worktrees below the same repository', () => {
    const linked = {
      ...mainGit,
      root: 'D:/repos/vibe-spam-worktrees/sidebar',
      worktree_name: 'sidebar',
      worktree_id: 'worktree-sidebar',
      branch: 'feature/sidebar',
      is_main_worktree: false,
      dirty: false,
      changed: 0,
    }
    const grouped = groupAgentsByGit([agent('main', mainGit), agent('sidebar', linked)])

    expect(grouped.repositories).toHaveLength(1)
    expect(grouped.repositories[0].worktrees.map((item) => item.branch)).toEqual([
      'main',
      'feature/sidebar',
    ])
  })

  it('filters independently by repository and worktree', () => {
    const otherGit = {
      ...mainGit,
      root: 'D:/repos/other',
      worktree_id: 'worktree-other',
      repository_root: 'D:/repos/other',
      repository_name: 'OTHER',
      repository_id: 'repo-other',
    }
    const agents = [agent('one', mainGit), agent('two', mainGit), agent('other', otherGit)]
    const repositoryFilter: GitContextFilter = {
      kind: 'repository', id: 'repo-vibe', repositoryId: 'repo-vibe', label: 'VIBE-SPAM',
    }
    const worktreeFilter: GitContextFilter = {
      kind: 'worktree', id: 'worktree-other', worktreeId: 'worktree-other', label: 'OTHER',
    }

    expect(filterAgentsByGit(agents, repositoryFilter).map((item) => item.id)).toEqual([
      'one',
      'two',
    ])
    expect(filterAgentsByGit(agents, worktreeFilter).map((item) => item.id)).toEqual(['other'])
  })

  it('formats compact relative commit times', () => {
    const now = Date.parse('2026-07-22T12:00:00+02:00')
    expect(formatRelativeTime('2026-07-22T11:45:00+02:00', now)).toBe('15m ago')
    expect(formatRelativeTime('2026-07-20T12:00:00+02:00', now)).toBe('2d ago')
  })

  it('keeps operational Git failures separate from non-Git folders', () => {
    const unavailable = agent('unavailable', {
      is_git: false,
      error: 'git status timed out',
    })
    const plainFolder = agent('plain', { is_git: false })
    const grouped = groupAgentsByGit([unavailable, plainFolder])
    const errorFilter: GitContextFilter = {
      kind: 'git-error', id: 'git-error', label: 'Git status unavailable',
    }

    expect(grouped.gitErrorAgents.map((item) => item.id)).toEqual(['unavailable'])
    expect(grouped.nonGitAgents.map((item) => item.id)).toEqual(['plain'])
    expect(filterAgentsByGit([unavailable, plainFolder], errorFilter)).toEqual([unavailable])
  })

  it('preserves a stale worktree with its operational error', () => {
    const grouped = groupAgentsByGit([
      agent('stale', { ...mainGit, stale: true, error: 'repository locked' }),
    ])

    expect(grouped.repositories[0].worktrees[0].stale).toBe(true)
    expect(grouped.repositories[0].worktrees[0].error).toBe('repository locked')
  })
})
