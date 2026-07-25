import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import {
  groupAgentsByGit,
  totalDirtyWorktrees,
  worktreesWithMultipleWriters,
  type GitRepositoryGroup,
  type GitWorktreeGroup,
} from '../services/gitWorkspace'
import { useAgentStore } from '../stores/agentStore'
import {
  GIT_SIDEBAR_TABS,
  useGitWorkspaceStore,
  type GitSidebarTab,
} from '../stores/gitWorkspaceStore'
import { totalConflicts, useOverlapStore } from '../stores/overlapStore'
import GitChangesPanel from './GitChangesPanel'
import GitCommitsPanel from './GitCommitsPanel'
import GitConflictsPanel from './GitConflictsPanel'
import GitIntegrationPanel from './GitIntegrationPanel'
import GitWorktreesPanel from './GitWorktreesPanel'
import Icon, { type IconName } from './Icon'

const OVERLAP_POLL_MS = 20_000

const TAB_META: Record<GitSidebarTab, { label: string; icon: IconName; title: string }> = {
  repositories: { label: 'Repos', icon: 'gitBranch', title: 'Repositories' },
  changes: { label: 'Changes', icon: 'fileDiff', title: 'Working tree changes' },
  commits: { label: 'Commits', icon: 'history', title: 'Commits' },
  integrate: { label: 'Integrate', icon: 'gitMerge', title: 'Merge preview and restore points' },
  conflicts: { label: 'Conflicts', icon: 'alertTriangle', title: 'Cross-agent conflicts' },
  worktrees: { label: 'Worktrees', icon: 'layers', title: 'Worktree inventory' },
}

function branchLabel(worktree: GitWorktreeGroup): string {
  if (worktree.branch) return worktree.branch
  return worktree.head ? `detached@${worktree.head.slice(0, 7)}` : 'No commits'
}

function worktreeStatusLabel(worktree: GitWorktreeGroup): string {
  if (worktree.error) return 'Status unavailable'
  const parts: string[] = []
  if (worktree.dirty) parts.push(`${worktree.changed || 1} changed`)
  if (worktree.ahead) parts.push(`↑${worktree.ahead}`)
  if (worktree.behind) parts.push(`↓${worktree.behind}`)
  return parts.join(' · ') || 'Clean'
}

export default function GitSidebar() {
  const agents = useAgentStore((state) => state.agents)
  const selectedAgent = useAgentStore((state) => state.selectedAgent)
  const selectAgent = useAgentStore((state) => state.selectAgent)
  const {
    sidebarOpen,
    sidebarWidth,
    activeTab,
    filter,
    expandedRepositoryIds,
    expandedWorktreeIds,
    setSidebarOpen,
    setSidebarWidth,
    setActiveTab,
    setFilter,
    toggleRepository,
    toggleWorktree,
    expandDefaults,
  } = useGitWorkspaceStore()
  const overlapReport = useOverlapStore((state) => state.report)
  const loadOverlaps = useOverlapStore((state) => state.load)
  const groups = useMemo(() => groupAgentsByGit(agents), [agents])
  const dirtyCount = useMemo(() => totalDirtyWorktrees(groups), [groups])
  const sharedCheckouts = useMemo(() => worktreesWithMultipleWriters(groups), [groups])
  const conflictCount = totalConflicts(overlapReport)
  const expansionInitialized = useRef(false)
  const tabRefs = useRef<Partial<Record<GitSidebarTab, HTMLButtonElement | null>>>({})
  const railRefs = useRef<Partial<Record<GitSidebarTab, HTMLButtonElement | null>>>({})
  const [worktreeCount, setWorktreeCount] = useState(0)

  const selectedWorktree = useMemo(() => {
    if (filter?.kind !== 'worktree' || !filter.worktreeId) return null
    for (const repository of groups.repositories) {
      const worktree = repository.worktrees.find((item) => item.id === filter.worktreeId)
      if (worktree) return { repository, worktree }
    }
    return null
  }, [filter, groups.repositories])
  const selectedWorktreeId = selectedWorktree?.worktree.id ?? null
  const selectedLabel = selectedWorktree
    ? `${selectedWorktree.repository.name} › ${selectedWorktree.worktree.name}`
    : ''
  const selectedBranch = selectedWorktree ? branchLabel(selectedWorktree.worktree) : ''

  useEffect(() => {
    setWorktreeCount(
      groups.repositories.reduce((total, repository) => total + repository.worktrees.length, 0)
    )
  }, [groups.repositories])

  useEffect(() => {
    const firstRepository = groups.repositories[0]
    if (!firstRepository || expansionInitialized.current) return
    expansionInitialized.current = true
    expandDefaults(
      [firstRepository.id],
      firstRepository.worktrees.map((worktree) => worktree.id)
    )
  }, [expandDefaults, groups.repositories])

  // The conflict badge has to stay meaningful while the user is looking at the
  // terminals, so the comparison runs on its own slow cadence.
  useEffect(() => {
    void loadOverlaps()
    const timer = window.setInterval(() => void loadOverlaps(), OVERLAP_POLL_MS)
    return () => window.clearInterval(timer)
  }, [loadOverlaps])

  useEffect(() => {
    if (!sidebarOpen) return
    const media = window.matchMedia('(max-width: 980px)')
    const workspace = document.querySelector<HTMLElement>('.terminal-workspace')
    const focusRail = () => railRefs.current[activeTab]?.focus()
    const applyDrawerState = () => {
      if (media.matches) {
        workspace?.setAttribute('inert', '')
        if (workspace?.contains(document.activeElement)) focusRail()
      } else workspace?.removeAttribute('inert')
    }
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !media.matches) return
      event.preventDefault()
      setSidebarOpen(false)
      window.requestAnimationFrame(focusRail)
    }
    applyDrawerState()
    media.addEventListener('change', applyDrawerState)
    window.addEventListener('keydown', handleEscape)
    return () => {
      workspace?.removeAttribute('inert')
      media.removeEventListener('change', applyDrawerState)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [activeTab, setSidebarOpen, sidebarOpen])

  const selectRepository = (repository: GitRepositoryGroup) => {
    setFilter({
      kind: 'repository',
      id: repository.id,
      repositoryId: repository.id,
      label: repository.name,
    })
  }

  const selectWorktree = (repository: GitRepositoryGroup, worktree: GitWorktreeGroup) => {
    setFilter({
      kind: 'worktree',
      id: worktree.id,
      repositoryId: repository.id,
      worktreeId: worktree.id,
      label: `${repository.name} › ${worktree.name} › ${branchLabel(worktree)}`,
    })
  }

  const handleResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    let nextWidth = startWidth
    let frame: number | null = null
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      nextWidth = startWidth + moveEvent.clientX - startX
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        setSidebarWidth(nextWidth, false)
      })
    }
    const handleEnd = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      setSidebarWidth(nextWidth)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
  }

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = GIT_SIDEBAR_TABS.indexOf(activeTab)
    const last = GIT_SIDEBAR_TABS.length - 1
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft'
            ? (index + last) % GIT_SIDEBAR_TABS.length
            : (index + 1) % GIT_SIDEBAR_TABS.length
    const nextTab = GIT_SIDEBAR_TABS[nextIndex]
    setActiveTab(nextTab)
    window.requestAnimationFrame(() => tabRefs.current[nextTab]?.focus())
  }

  const handleResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      setSidebarWidth(sidebarWidth + (event.key === 'ArrowLeft' ? -16 : 16))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(264)
    } else if (event.key === 'End') {
      event.preventDefault()
      setSidebarWidth(420)
    }
  }

  const railBadge = (tab: GitSidebarTab): number => {
    if (tab === 'repositories') return dirtyCount
    if (tab === 'conflicts') return conflictCount
    return 0
  }

  const tabCount = (tab: GitSidebarTab): string => {
    if (tab === 'repositories') return String(groups.repositories.length)
    if (tab === 'conflicts') return conflictCount > 0 ? String(conflictCount) : ''
    if (tab === 'worktrees') return worktreeCount > 0 ? String(worktreeCount) : ''
    return ''
  }

  const sidebarStyle = { '--git-sidebar-width': `${sidebarWidth}px` } as CSSProperties

  return (
    <aside
      className={`git-sidebar-shell${sidebarOpen ? ' open' : ' collapsed'}`}
      style={sidebarStyle}
      aria-label="Git workspace"
    >
      <nav className="git-activity-rail" aria-label="Git sidebar views">
        {GIT_SIDEBAR_TABS.map((tab) => {
          const badge = railBadge(tab)
          return (
            <button
              key={tab}
              ref={(node) => {
                railRefs.current[tab] = node
              }}
              className={`${activeTab === tab && sidebarOpen ? 'active' : ''}${
                tab === 'conflicts' && conflictCount > 0 ? ' alarm' : ''
              }`}
              onClick={() => {
                setActiveTab(tab)
                setSidebarOpen(true)
              }}
              aria-label={`Show ${TAB_META[tab].title.toLowerCase()}`}
              aria-pressed={activeTab === tab && sidebarOpen}
              title={TAB_META[tab].title}
            >
              <Icon name={TAB_META[tab].icon} size={20} />
              {badge > 0 ? <span className="rail-badge">{badge}</span> : null}
            </button>
          )
        })}
        <button
          className="rail-collapse"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? 'Collapse Git sidebar' : 'Expand Git sidebar'}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Icon name="panelLeft" size={19} />
        </button>
      </nav>

      {sidebarOpen ? (
        <div
          className="git-sidebar-scrim"
          aria-hidden="true"
          onPointerDown={() => {
            setSidebarOpen(false)
            window.requestAnimationFrame(() => railRefs.current[activeTab]?.focus())
          }}
        />
      ) : null}

      {sidebarOpen ? (
        <section className="git-sidebar-panel">
          <div className="git-sidebar-tabs" role="tablist" aria-label="Git views">
            {GIT_SIDEBAR_TABS.map((tab) => {
              const count = tabCount(tab)
              return (
                <button
                  key={tab}
                  id={`git-tab-${tab}`}
                  ref={(node) => {
                    tabRefs.current[tab] = node
                  }}
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls="git-sidebar-content"
                  tabIndex={activeTab === tab ? 0 : -1}
                  className={`${activeTab === tab ? 'active' : ''}${
                    tab === 'conflicts' && conflictCount > 0 ? ' alarm' : ''
                  }`}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={handleTabKey}
                  title={TAB_META[tab].title}
                >
                  {TAB_META[tab].label}
                  {count ? <span>{count}</span> : null}
                </button>
              )
            })}
          </div>

          <div
            id="git-sidebar-content"
            className={activeTab === 'repositories' ? 'git-tree' : 'git-history-panel'}
            role="tabpanel"
            aria-labelledby={`git-tab-${activeTab}`}
          >
            {activeTab === 'repositories' ? (
              groups.repositories.length === 0 &&
              groups.nonGitAgents.length === 0 &&
              groups.gitErrorAgents.length === 0 ? (
                <div className="git-sidebar-empty">
                  <Icon name="gitBranch" size={28} />
                  <strong>No Git contexts</strong>
                  <span>Open a terminal inside a repository to see its branch and worktree.</span>
                </div>
              ) : (
                <>
                  {sharedCheckouts.length > 0 ? (
                    <div className="conflict-warning sidebar-warning" role="alert">
                      <Icon name="alertTriangle" size={14} />
                      <span>
                        <strong>
                          {sharedCheckouts.length} checkout
                          {sharedCheckouts.length === 1 ? '' : 's'} with several terminals.
                        </strong>{' '}
                        Agents in one working tree overwrite each other silently.
                      </span>
                    </div>
                  ) : null}
                  {groups.repositories.map((repository) => {
                    const repositoryOpen = expandedRepositoryIds.includes(repository.id)
                    const repositorySelected =
                      filter?.kind === 'repository' && filter.repositoryId === repository.id
                    const repositoryChanges = repository.worktrees.filter(
                      (item) => item.dirty
                    ).length
                    return (
                      <div className="git-repository" key={repository.id}>
                        <button
                          className={`git-tree-row repo-row${repositorySelected ? ' selected' : ''}`}
                          onClick={() => {
                            selectRepository(repository)
                            toggleRepository(repository.id)
                          }}
                          aria-expanded={repositoryOpen}
                          aria-current={repositorySelected ? 'true' : undefined}
                          title={repository.root}
                        >
                          <span
                            className={`tree-chevron${repositoryOpen ? ' expanded' : ''}`}
                            aria-hidden="true"
                          >
                            <Icon name="chevronDown" size={14} />
                          </span>
                          <span className="tree-row-main">
                            <Icon name="folder" size={16} />
                            <strong>{repository.name}</strong>
                            <span className="tree-count">{repository.worktrees.length}</span>
                            {repositoryChanges > 0 ? (
                              <span
                                className="tree-dirty"
                                title={`${repositoryChanges} modified checkouts`}
                              >
                                {repositoryChanges} modified
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {repositoryOpen ? (
                          <div className="git-worktree-list">
                            {repository.worktrees.map((worktree) => {
                              const worktreeOpen = expandedWorktreeIds.includes(worktree.id)
                              const worktreeSelected =
                                filter?.kind === 'worktree' && filter.worktreeId === worktree.id
                              const shared = worktree.agents.length > 1
                              return (
                                <div className="git-worktree" key={worktree.id}>
                                  <button
                                    className={`git-tree-row worktree-row${worktreeSelected ? ' selected' : ''}`}
                                    onClick={() => {
                                      selectWorktree(repository, worktree)
                                      toggleWorktree(worktree.id)
                                    }}
                                    aria-expanded={worktreeOpen}
                                    aria-current={worktreeSelected ? 'true' : undefined}
                                    title={worktree.root}
                                  >
                                    <span
                                      className={`tree-chevron${worktreeOpen ? ' expanded' : ''}`}
                                      aria-hidden="true"
                                    >
                                      <Icon name="chevronDown" size={14} />
                                    </span>
                                    <span className="tree-row-main worktree-main">
                                      <span className="worktree-title-row">
                                        <Icon name="gitBranch" size={15} />
                                        <strong>{worktree.name}</strong>
                                        {shared ? (
                                          <span
                                            className="worktree-shared"
                                            title={`${worktree.agents.length} terminals write in this checkout`}
                                          >
                                            <Icon name="alertTriangle" size={11} />
                                            {worktree.agents.length}
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="worktree-meta-row">
                                        <code>{branchLabel(worktree)}</code>
                                        <span
                                          className={
                                            worktree.error
                                              ? 'stale'
                                              : worktree.dirty
                                                ? 'dirty'
                                                : 'clean'
                                          }
                                          title={worktree.error || undefined}
                                        >
                                          {worktreeStatusLabel(worktree)}
                                        </span>
                                      </span>
                                    </span>
                                  </button>
                                  {worktreeOpen ? (
                                    <div className="git-terminal-list">
                                      <div className="git-terminal-count">
                                        {worktree.agents.length} terminal
                                        {worktree.agents.length === 1 ? '' : 's'}
                                      </div>
                                      {worktree.agents.map((agent) => (
                                        <button
                                          className={`git-terminal-row${selectedAgent === agent.id ? ' target' : ''}`}
                                          key={agent.id}
                                          onClick={() => {
                                            selectWorktree(repository, worktree)
                                            selectAgent(agent.id)
                                          }}
                                          aria-pressed={selectedAgent === agent.id}
                                          title={`${agent.name} · ${agent.cwd}`}
                                        >
                                          <Icon name="terminal" size={14} />
                                          <span>{agent.name}</span>
                                          <span
                                            className={`terminal-mini-status ${agent.status}`}
                                            aria-label={`Status: ${agent.status}`}
                                            title={agent.status}
                                          >
                                            <span aria-hidden="true" />
                                            {agent.status === 'running'
                                              ? 'RUN'
                                              : agent.status === 'error'
                                                ? 'ERR'
                                                : 'STOP'}
                                          </span>
                                          {selectedAgent === agent.id ? <b>TARGET</b> : null}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}

                  {groups.nonGitAgents.length > 0 ? (
                    <div className="git-non-git-group">
                      <button
                        className={`git-tree-row non-git-row${filter?.kind === 'non-git' ? ' selected' : ''}`}
                        onClick={() =>
                          setFilter({ kind: 'non-git', id: 'non-git', label: 'Folders without Git' })
                        }
                        aria-pressed={filter?.kind === 'non-git'}
                      >
                        <Icon name="folder" size={15} />
                        <strong>Folders without Git</strong>
                        <span className="tree-count">{groups.nonGitAgents.length}</span>
                      </button>
                    </div>
                  ) : null}

                  {groups.gitErrorAgents.length > 0 ? (
                    <div className="git-non-git-group git-error-group">
                      <button
                        className={`git-tree-row non-git-row${filter?.kind === 'git-error' ? ' selected' : ''}`}
                        onClick={() =>
                          setFilter({
                            kind: 'git-error',
                            id: 'git-error',
                            label: 'Git status unavailable',
                          })
                        }
                        aria-pressed={filter?.kind === 'git-error'}
                        title={groups.gitErrorAgents[0]?.git.error}
                      >
                        <Icon name="alertCircle" size={15} />
                        <strong>Git status unavailable</strong>
                        <span className="tree-count">{groups.gitErrorAgents.length}</span>
                      </button>
                    </div>
                  ) : null}
                </>
              )
            ) : activeTab === 'changes' ? (
              <GitChangesPanel
                worktreeId={selectedWorktreeId}
                contextLabel={selectedLabel}
                branch={selectedBranch}
                onChooseCheckout={() => setActiveTab('repositories')}
              />
            ) : activeTab === 'commits' ? (
              <GitCommitsPanel
                worktreeId={selectedWorktreeId}
                contextLabel={selectedLabel}
                branch={selectedBranch}
                onChooseCheckout={() => setActiveTab('repositories')}
              />
            ) : activeTab === 'integrate' ? (
              <GitIntegrationPanel
                worktreeId={selectedWorktreeId}
                contextLabel={selectedLabel}
                branch={selectedBranch}
                onChooseCheckout={() => setActiveTab('repositories')}
                onChanged={() => void loadOverlaps(true)}
              />
            ) : activeTab === 'conflicts' ? (
              <GitConflictsPanel />
            ) : (
              <GitWorktreesPanel />
            )}
          </div>

          <footer className="git-sidebar-footer">
            <span title={filter?.label}>{filter?.label || 'All terminals'}</span>
            {filter ? (
              <button onClick={() => setFilter(null)} title="Clear Git filter">
                <Icon name="close" size={13} />
                Clear filter
              </button>
            ) : null}
          </footer>
        </section>
      ) : null}

      {sidebarOpen ? (
        <div
          className="git-sidebar-resizer"
          role="separator"
          aria-label="Resize Git sidebar"
          aria-orientation="vertical"
          aria-valuemin={264}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKey}
        />
      ) : null}
    </aside>
  )
}
