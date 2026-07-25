// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, SessionSnapshot } from '../services/api'
import SessionRestoreBanner from './SessionRestoreBanner'

const fetchPreviousSession = vi.fn<() => Promise<SessionSnapshot>>()
const restoreSession = vi.fn()
const forgetSession = vi.fn()

vi.mock('../services/api', () => ({
  fetchPreviousSession: () => fetchPreviousSession(),
  restoreSession: () => restoreSession(),
  forgetSession: () => forgetSession(),
}))

function snapshot(restorable: boolean): SessionSnapshot {
  return {
    restorable,
    agents: [
      { id: 'one', name: 'Codex 1', command: 'codex', args: '', cwd: 'D:/repo', cli_id: 'codex' },
      { id: 'two', name: 'Codex 2', command: 'codex', args: '', cwd: 'D:/repo', cli_id: 'codex' },
    ],
  }
}

function agent(id: string): Agent {
  return {
    id,
    name: id,
    command: 'codex',
    args: '',
    cwd: 'D:/repo',
    status: 'running',
    git: {},
  }
}

beforeEach(() => {
  fetchPreviousSession.mockReset()
  restoreSession.mockReset()
  forgetSession.mockReset()
})

afterEach(cleanup)

describe('SessionRestoreBanner', () => {
  it('offers the previous session when nothing is open', async () => {
    fetchPreviousSession.mockResolvedValue(snapshot(true))

    render(<SessionRestoreBanner agents={[]} onRestored={vi.fn()} />)

    expect(await screen.findByText(/Restore 2 terminals/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
  })

  it('stays hidden when the backend has nothing restorable', async () => {
    fetchPreviousSession.mockResolvedValue(snapshot(false))

    const { container } = render(<SessionRestoreBanner agents={[]} onRestored={vi.fn()} />)

    await waitFor(() => expect(fetchPreviousSession).toHaveBeenCalled())
    expect(container.querySelector('.session-restore-banner')).toBeNull()
  })

  it('stays hidden while terminals are already open', async () => {
    fetchPreviousSession.mockResolvedValue(snapshot(true))

    const { container } = render(
      <SessionRestoreBanner agents={[agent('live')]} onRestored={vi.fn()} />
    )

    await waitFor(() => expect(fetchPreviousSession).toHaveBeenCalled())
    expect(container.querySelector('.session-restore-banner')).toBeNull()
  })

  it('does not come back after the user closes every terminal', async () => {
    fetchPreviousSession.mockResolvedValue(snapshot(true))
    const { container, rerender } = render(
      <SessionRestoreBanner agents={[agent('live')]} onRestored={vi.fn()} />
    )
    await waitFor(() => expect(fetchPreviousSession).toHaveBeenCalled())

    // Closing everything is a deliberate act, not an empty workspace.
    rerender(<SessionRestoreBanner agents={[]} onRestored={vi.fn()} />)

    expect(container.querySelector('.session-restore-banner')).toBeNull()
  })

  it('survives a backend that cannot answer', async () => {
    fetchPreviousSession.mockRejectedValue(new Error('offline'))

    const { container } = render(<SessionRestoreBanner agents={[]} onRestored={vi.fn()} />)

    await waitFor(() => expect(fetchPreviousSession).toHaveBeenCalled())
    expect(container.querySelector('.session-restore-banner')).toBeNull()
  })
})
