import { describe, expect, it } from 'vitest'
import { isRetryableMethod } from './api'
import { resolveWebSocketUrl } from './websocket'

describe('network contracts', () => {
  it('uses the browser host for relative WebSocket URLs', () => {
    expect(
      resolveWebSocketUrl('', '/ws/audio', {
        protocol: 'http:',
        host: 'localhost:5173',
      })
    ).toBe('ws://localhost:5173/ws/audio')
  })

  it('builds Electron WebSocket URLs without leaking tokens', () => {
    expect(
      resolveWebSocketUrl('http://127.0.0.1:8765', '/ws/audio', {
        protocol: 'file:',
        host: '',
      })
    ).toBe('ws://127.0.0.1:8765/ws/audio')
  })

  it('never retries non-idempotent mutations', () => {
    expect(isRetryableMethod('GET')).toBe(true)
    expect(isRetryableMethod('POST')).toBe(false)
    expect(isRetryableMethod('DELETE')).toBe(false)
  })
})
