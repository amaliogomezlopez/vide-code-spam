import { getBackendConnection } from './env'

export type AudioMessage =
  | { type: 'recording_started' }
  | { type: 'transcription_partial'; raw: string }
  | {
      type: 'transcription'
      raw: string
      cleaned: string
      timings?: { decode_s?: number; stt_s?: number; format_s?: number }
    }
  | { type: 'transcription_error'; message: string }
  | { type: 'pong' }

export function resolveWebSocketUrl(
  base: string,
  path: string,
  browserLocation: Pick<Location, 'protocol' | 'host'>
): string {
  if (!base) {
    const protocol = browserLocation.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${browserLocation.host}${path}`
  }
  const protocol = base.startsWith('https') ? 'wss' : 'ws'
  const host = base.replace(/^https?:\/\//, '')
  return new URL(`${protocol}://${host}${path}`).toString()
}

async function wsConnection(path: string): Promise<{ url: string; protocols?: string[] }> {
  const { baseUrl, apiToken } = await getBackendConnection()
  return {
    url: resolveWebSocketUrl(baseUrl, path, window.location),
    protocols: apiToken ? [`vibe-spam-token.${apiToken}`] : undefined,
  }
}

export class AudioWebSocket {
  private ws: WebSocket | null = null
  private url: string
  private onMessage: (msg: AudioMessage) => void
  private onClose?: () => void
  private shouldReconnect = true
  private pendingMessages: string[] = []
  private reconnectTimer: number | null = null
  private recordingStartMessage: string | null = null

  constructor(onMessage: (msg: AudioMessage) => void, path = '/ws/audio', onClose?: () => void) {
    this.url = path
    this.onMessage = onMessage
    this.onClose = onClose
    this.connect()
  }

  private async connect() {
    if (!this.shouldReconnect) return
    let connection: { url: string; protocols?: string[] }
    try {
      connection = await wsConnection(this.url)
      if (!this.shouldReconnect) return
      this.ws = new WebSocket(connection.url, connection.protocols)
    } catch {
      if (this.shouldReconnect) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 1000)
      }
      return
    }
    this.ws.onopen = () => {
      for (const message of this.pendingMessages.splice(0)) {
        this.ws?.send(message)
      }
    }
    this.ws.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(event.data))
      } catch {
        // ignore malformed
      }
    }
    this.ws.onclose = () => {
      this.onClose?.()
      if (this.shouldReconnect) {
        if (
          this.recordingStartMessage &&
          !this.pendingMessages.includes(this.recordingStartMessage)
        ) {
          this.pendingMessages.unshift(this.recordingStartMessage)
        }
        this.reconnectTimer = window.setTimeout(() => this.connect(), 1000)
      }
    }
  }

  sendAudio(base64: string) {
    this.sendMessage({ action: 'audio_chunk', data: base64 })
  }

  startRecording(format = 'webm', sampleRate?: number, channels?: number) {
    const payload = {
      action: 'start_recording',
      format,
      sample_rate: sampleRate,
      channels,
      client_started_at: Date.now(),
    }
    this.recordingStartMessage = JSON.stringify(payload)
    this.sendSerialized(this.recordingStartMessage)
  }

  stopRecording() {
    this.sendMessage({
      action: 'stop_recording',
      client_stopped_at: Date.now(),
    })
    this.recordingStartMessage = null
  }

  close() {
    this.shouldReconnect = false
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.pendingMessages = []
    this.recordingStartMessage = null
    this.ws?.close()
  }

  private sendMessage(payload: unknown) {
    this.sendSerialized(JSON.stringify(payload))
  }

  private sendSerialized(message: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message)
      return
    }
    this.pendingMessages.push(message)
  }
}

export async function createTerminalWebSocket(agentId: string): Promise<WebSocket> {
  const connection = await wsConnection(`/ws/terminal/${agentId}`)
  return new WebSocket(connection.url, connection.protocols)
}
