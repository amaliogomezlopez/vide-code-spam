import { describe, expect, it } from 'vitest'
import {
  buildTerminalWorkers,
  ensureTerminalFolderCapacity,
  resizeTerminalFolders,
} from './terminalWorkspace'

const baseDraft = {
  cliId: 'codex',
  cliName: 'Codex',
  count: 2,
  args: '--model gpt-5',
}

describe('terminal workspace drafts', () => {
  it('uses one shared checkout for every terminal', () => {
    const workers = buildTerminalWorkers({
      ...baseDraft,
      folderMode: 'shared',
      sharedCwd: ' D:/repos/vibe-spam ',
      terminalCwds: [],
    })

    expect(workers.map((worker) => worker.cwd)).toEqual([
      'D:/repos/vibe-spam',
      'D:/repos/vibe-spam',
    ])
    expect(workers.map((worker) => worker.name)).toEqual(['Codex 1', 'Codex 2'])
  })

  it('assigns a different repository to each terminal', () => {
    const workers = buildTerminalWorkers({
      ...baseDraft,
      folderMode: 'separate',
      sharedCwd: '',
      terminalCwds: ['D:/repos/api', 'D:/repos/web'],
    })

    expect(workers.map((worker) => worker.cwd)).toEqual(['D:/repos/api', 'D:/repos/web'])
  })

  it('rejects an incomplete separate-repository layout', () => {
    expect(() =>
      buildTerminalWorkers({
        ...baseDraft,
        folderMode: 'separate',
        sharedCwd: '',
        terminalCwds: ['D:/repos/api', ''],
      })
    ).toThrow('terminal 2')
  })

  it('preserves selected folders when the terminal count changes', () => {
    const expanded = ensureTerminalFolderCapacity(['D:/one', 'D:/two'], 3)
    expect(expanded).toEqual([
      'D:/one',
      'D:/two',
      '',
    ])
    expect(ensureTerminalFolderCapacity(expanded, 1)).toBe(expanded)
    expect(resizeTerminalFolders(expanded, 1)).toEqual(['D:/one'])
  })
})
