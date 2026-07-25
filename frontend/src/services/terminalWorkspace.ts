import type { WorkspaceWorkerPayload } from './api'

export type TerminalFolderMode = 'shared' | 'separate'

interface TerminalWorkspaceDraft {
  cliId: string
  cliName: string
  count: number
  args: string
  folderMode: TerminalFolderMode
  sharedCwd: string
  terminalCwds: string[]
}

export function resizeTerminalFolders(current: string[], count: number): string[] {
  return Array.from({ length: count }, (_, index) => current[index] ?? '')
}

export function ensureTerminalFolderCapacity(current: string[], count: number): string[] {
  return current.length >= count ? current : resizeTerminalFolders(current, count)
}

export function buildTerminalWorkers(draft: TerminalWorkspaceDraft): WorkspaceWorkerPayload[] {
  if (!Number.isInteger(draft.count) || draft.count < 1 || draft.count > 9) {
    throw new Error('Choose between 1 and 9 terminals')
  }

  const folders =
    draft.folderMode === 'shared'
      ? Array.from({ length: draft.count }, () => draft.sharedCwd.trim())
      : resizeTerminalFolders(draft.terminalCwds, draft.count).map((folder) => folder.trim())

  if (draft.folderMode === 'separate') {
    const missingIndex = folders.findIndex((folder) => !folder)
    if (missingIndex >= 0) {
      throw new Error(`Choose a folder or repository for terminal ${missingIndex + 1}`)
    }
  }

  return folders.map((cwd, index) => ({
    name: `${draft.cliName}${draft.count > 1 ? ` ${index + 1}` : ''}`,
    role: 'terminal',
    cli_id: draft.cliId,
    cwd,
    args: draft.args,
  }))
}
