import { describe, expect, it } from 'vitest'
import { ATTENTION_SILENCE_MS, attentionIds, needsAttention } from './attention'

const NOW = 1_000_000

describe('needsAttention', () => {
  it('ignores terminals that never produced output', () => {
    expect(needsAttention(undefined, NOW)).toBe(false)
    expect(needsAttention({ lastOutputAt: 0, seenAt: 0 }, NOW)).toBe(false)
  })

  it('waits for the silence window before asking for attention', () => {
    const activity = { lastOutputAt: NOW - 1000, seenAt: 0 }

    expect(needsAttention(activity, NOW)).toBe(false)
    expect(needsAttention({ lastOutputAt: NOW - ATTENTION_SILENCE_MS, seenAt: 0 }, NOW)).toBe(true)
  })

  it('clears once the terminal has been looked at after its last output', () => {
    const activity = { lastOutputAt: NOW - 10_000, seenAt: NOW - 9_000 }

    expect(needsAttention(activity, NOW)).toBe(false)
  })

  it('asks again when new output arrives after the last visit', () => {
    const activity = { lastOutputAt: NOW - 5_000, seenAt: NOW - 9_000 }

    expect(needsAttention(activity, NOW)).toBe(true)
  })
})

describe('attentionIds', () => {
  it('returns only the terminals waiting for the user', () => {
    const activity = {
      quiet: { lastOutputAt: NOW - 10_000, seenAt: 0 },
      seen: { lastOutputAt: NOW - 10_000, seenAt: NOW - 1_000 },
      busy: { lastOutputAt: NOW - 100, seenAt: 0 },
    }

    expect(attentionIds(activity, ['quiet', 'seen', 'busy', 'unknown'], NOW)).toEqual(['quiet'])
  })
})
