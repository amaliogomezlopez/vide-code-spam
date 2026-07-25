import { create } from 'zustand'
import type { GitContextFilter } from '../services/gitWorkspace'

export type GitSidebarTab =
  | 'repositories'
  | 'changes'
  | 'commits'
  | 'integrate'
  | 'conflicts'
  | 'worktrees'

export const GIT_SIDEBAR_TABS: GitSidebarTab[] = [
  'repositories',
  'changes',
  'commits',
  'integrate',
  'conflicts',
  'worktrees',
]

interface StoredLayout {
  sidebarOpen: boolean
  sidebarWidth: number
  activeTab: GitSidebarTab
}

interface GitWorkspaceState extends StoredLayout {
  filter: GitContextFilter | null
  expandedRepositoryIds: string[]
  expandedWorktreeIds: string[]
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number, persist?: boolean) => void
  setActiveTab: (tab: GitSidebarTab) => void
  setFilter: (filter: GitContextFilter | null) => void
  toggleRepository: (id: string) => void
  toggleWorktree: (id: string) => void
  expandDefaults: (repositoryIds: string[], worktreeIds: string[]) => void
}

const STORAGE_KEY = 'vibe-spam:git-sidebar-layout'
const DEFAULT_LAYOUT: StoredLayout = {
  sidebarOpen: true,
  sidebarWidth: 304,
  activeTab: 'repositories',
}

function clampWidth(width: number): number {
  return Math.min(420, Math.max(264, Math.round(width)))
}

function readLayout(): StoredLayout {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<StoredLayout>
    return {
      sidebarOpen: typeof value.sidebarOpen === 'boolean' ? value.sidebarOpen : true,
      sidebarWidth: clampWidth(value.sidebarWidth ?? DEFAULT_LAYOUT.sidebarWidth),
      activeTab:
        value.activeTab && GIT_SIDEBAR_TABS.includes(value.activeTab)
          ? value.activeTab
          : 'repositories',
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function storeLayout(layout: StoredLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Layout persistence is a convenience; restricted storage must not break the app.
  }
}

const initialLayout = readLayout()

export const useGitWorkspaceStore = create<GitWorkspaceState>((set) => ({
  ...initialLayout,
  filter: null,
  expandedRepositoryIds: [],
  expandedWorktreeIds: [],
  setSidebarOpen: (sidebarOpen) =>
    set((state) => {
      storeLayout({ sidebarOpen, sidebarWidth: state.sidebarWidth, activeTab: state.activeTab })
      return { sidebarOpen }
    }),
  setSidebarWidth: (value, persist = true) =>
    set((state) => {
      const sidebarWidth = clampWidth(value)
      if (persist) {
        storeLayout({ sidebarOpen: state.sidebarOpen, sidebarWidth, activeTab: state.activeTab })
      }
      return { sidebarWidth }
    }),
  setActiveTab: (activeTab) =>
    set((state) => {
      storeLayout({ sidebarOpen: state.sidebarOpen, sidebarWidth: state.sidebarWidth, activeTab })
      return { activeTab, sidebarOpen: true }
    }),
  setFilter: (filter) => set({ filter }),
  toggleRepository: (id) =>
    set((state) => ({
      expandedRepositoryIds: state.expandedRepositoryIds.includes(id)
        ? state.expandedRepositoryIds.filter((item) => item !== id)
        : [...state.expandedRepositoryIds, id],
    })),
  toggleWorktree: (id) =>
    set((state) => ({
      expandedWorktreeIds: state.expandedWorktreeIds.includes(id)
        ? state.expandedWorktreeIds.filter((item) => item !== id)
        : [...state.expandedWorktreeIds, id],
    })),
  expandDefaults: (repositoryIds, worktreeIds) =>
    set((state) => ({
      expandedRepositoryIds:
        state.expandedRepositoryIds.length > 0 ? state.expandedRepositoryIds : repositoryIds,
      expandedWorktreeIds:
        state.expandedWorktreeIds.length > 0 ? state.expandedWorktreeIds : worktreeIds,
    })),
}))
