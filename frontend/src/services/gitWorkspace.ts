import type { Agent } from './api'

export type GitFilterKind = 'repository' | 'worktree' | 'non-git' | 'git-error'

export interface GitContextFilter {
  kind: GitFilterKind
  id: string
  label: string
  repositoryId?: string
  worktreeId?: string
}

export interface GitWorktreeGroup {
  id: string
  repositoryId: string
  root: string
  name: string
  branch: string
  head: string
  detached: boolean
  isMain: boolean
  dirty: boolean
  changed: number
  staged: number
  unstaged: number
  untracked: number
  ahead: number
  behind: number
  error: string
  stale: boolean
  agents: Agent[]
}

export interface GitRepositoryGroup {
  id: string
  name: string
  root: string
  worktrees: GitWorktreeGroup[]
}

export interface GitWorkspaceGroups {
  repositories: GitRepositoryGroup[]
  nonGitAgents: Agent[]
  gitErrorAgents: Agent[]
}

function lastPathSegment(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || path || 'Repository'
}

export function groupAgentsByGit(agents: Agent[]): GitWorkspaceGroups {
  const repositories = new Map<string, GitRepositoryGroup>()
  const worktrees = new Map<string, GitWorktreeGroup>()
  const nonGitAgents: Agent[] = []
  const gitErrorAgents: Agent[] = []

  for (const agent of agents) {
    const git = agent.git
    if (!git?.is_git || !git.root) {
      if (git?.error) gitErrorAgents.push(agent)
      else nonGitAgents.push(agent)
      continue
    }

    const repositoryRoot = git.repository_root || git.root
    const repositoryId = git.repository_id || `repo:${repositoryRoot.toLocaleLowerCase()}`
    const worktreeId = git.worktree_id || `worktree:${git.root.toLocaleLowerCase()}`
    let repository = repositories.get(repositoryId)
    if (!repository) {
      repository = {
        id: repositoryId,
        name: git.repository_name || lastPathSegment(repositoryRoot),
        root: repositoryRoot,
        worktrees: [],
      }
      repositories.set(repositoryId, repository)
    }

    let worktree = worktrees.get(worktreeId)
    if (!worktree) {
      worktree = {
        id: worktreeId,
        repositoryId,
        root: git.root,
        name: git.is_main_worktree
          ? 'Main checkout'
          : git.worktree_name || lastPathSegment(git.root),
        branch: git.branch || '',
        head: git.head || '',
        detached: Boolean(git.detached),
        isMain: Boolean(git.is_main_worktree),
        dirty: Boolean(git.dirty),
        changed: git.changed || 0,
        staged: git.staged || 0,
        unstaged: git.unstaged || 0,
        untracked: git.untracked || 0,
        ahead: git.ahead || 0,
        behind: git.behind || 0,
        error: git.error || '',
        stale: Boolean(git.stale),
        agents: [],
      }
      worktrees.set(worktreeId, worktree)
      repository.worktrees.push(worktree)
    }
    worktree.agents.push(agent)
    if (git.error) worktree.error = git.error
    if (git.stale) worktree.stale = true
  }

  const result = [...repositories.values()]
  for (const repository of result) {
    repository.worktrees.sort((left, right) => Number(right.isMain) - Number(left.isMain))
  }
  return { repositories: result, nonGitAgents, gitErrorAgents }
}

export function agentMatchesGitFilter(agent: Agent, filter: GitContextFilter | null): boolean {
  if (!filter) return true
  if (filter.kind === 'git-error') return Boolean(agent.git?.error && !agent.git?.is_git)
  if (filter.kind === 'non-git') return !agent.git?.is_git && !agent.git?.error
  if (filter.kind === 'repository') return agent.git?.repository_id === filter.repositoryId
  return agent.git?.worktree_id === filter.worktreeId
}

export function filterAgentsByGit(agents: Agent[], filter: GitContextFilter | null): Agent[] {
  return filter ? agents.filter((agent) => agentMatchesGitFilter(agent, filter)) : agents
}

/**
 * Checkouts with more than one terminal attached.
 *
 * Two agents writing in the same working tree is the one failure Git cannot
 * help with: there is no merge, the last write simply wins. Worktrees make it
 * safe, so the UI has to surface the unsafe case instead of allowing it quietly.
 */
export function worktreesWithMultipleWriters(groups: GitWorkspaceGroups): GitWorktreeGroup[] {
  return groups.repositories
    .flatMap((repository) => repository.worktrees)
    .filter((worktree) => worktree.agents.length > 1)
}

export function totalDirtyWorktrees(groups: GitWorkspaceGroups): number {
  return groups.repositories.reduce(
    (total, repository) =>
      total + repository.worktrees.filter((worktree) => worktree.dirty).length,
    0
  )
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
