import { describe, expect, it } from 'vitest'
import { resolveDictationDelivery } from './dictationTarget'

describe('dictation delivery', () => {
  it('keeps in-app dictation on the selected terminal', () => {
    expect(resolveDictationDelivery('terminal', 'external', 'codex-2')).toEqual({
      kind: 'terminal',
      agentId: 'codex-2',
    })
  })

  it('routes floating dictation directly to a focused Vibe Spam terminal', () => {
    expect(resolveDictationDelivery('global', 'terminal', 'kimi-4')).toEqual({
      kind: 'terminal',
      agentId: 'kimi-4',
    })
  })

  it('preserves global paste for other applications', () => {
    expect(resolveDictationDelivery('global', 'external', 'codex-1')).toEqual({
      kind: 'external',
    })
  })

  it('does not guess a terminal when none is selected', () => {
    expect(resolveDictationDelivery('global', 'terminal', null)).toEqual({
      kind: 'unavailable',
    })
  })
})
