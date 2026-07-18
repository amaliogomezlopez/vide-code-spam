export interface AppSettings {
  pushToTalkShortcut: string
  globalDictationShortcut: string
  globalDictationEnabled: boolean
  dictationOverlayPosition?: { x: number; y: number } | null
  showWindowShortcut: string
  theme: 'dark' | 'light' | 'midnight'
  fontSize: number
  fontFamily: string
  debugModeEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  pushToTalkShortcut: 'CommandOrControl+Shift+Space',
  globalDictationShortcut: 'CommandOrControl+Shift+D',
  globalDictationEnabled: false,
  dictationOverlayPosition: null,
  showWindowShortcut: 'CommandOrControl+Shift+V',
  theme: 'dark',
  fontSize: 12,
  fontFamily: 'monospace',
  debugModeEnabled: false,
}

export interface ElectronAPI {
  getBackendUrl: () => Promise<string>
  getBackendConnection?: () => Promise<BackendConnection>
  selectFolder?: () => Promise<string | null>
  selectExecutable?: () => Promise<string | null>
  getSettings?: () => Promise<AppSettings>
  getPlatformCapabilities?: () => Promise<PlatformCapabilities>
  requestMacOSAccessibility?: () => Promise<boolean>
  saveSettings?: (settings: AppSettings) => Promise<AppSettings>
  beginShortcutCapture?: () => Promise<void>
  endShortcutCapture?: () => Promise<void>
  onSettingsChanged?: (callback: (settings: AppSettings) => void) => () => void
  onGlobalPushToTalk?: (callback: (state: 'start' | 'stop' | 'toggle') => void) => () => void
  onGlobalDictation?: (callback: (state: 'start' | 'stop' | 'toggle') => void) => () => void
  onGlobalShowWindow?: (callback: () => void) => () => void
  onDictationDebug?: (
    callback: (event: {
      source: string
      message: string
      level?: 'info' | 'warn' | 'error'
    }) => void
  ) => () => void
  updateDictationOverlay?: (state: {
    mode: 'idle' | 'listening' | 'transcribing' | 'error'
    level?: number
    text?: string
  }) => Promise<void>
  insertGlobalDictationText?: (text: string) => Promise<boolean>
}

export interface PlatformCapabilities {
  platform: string
  globalPasteSupported: boolean
  microphonePermission: string
  accessibilityPermission: 'granted' | 'denied' | 'not-applicable'
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

let cachedBaseUrl: string | null = null
let baseUrlPromise: Promise<string> | null = null
let cachedConnection: BackendConnection | null = null

export interface BackendConnection {
  baseUrl: string
  apiToken: string
}

export async function getBackendConnection(): Promise<BackendConnection> {
  if (cachedConnection) return cachedConnection
  if (window.electronAPI?.getBackendConnection) {
    try {
      cachedConnection = await window.electronAPI.getBackendConnection()
      cachedBaseUrl = cachedConnection.baseUrl
      return cachedConnection
    } catch (err) {
      console.error('Failed to get authenticated backend connection:', err)
    }
  }
  return { baseUrl: await getBackendBaseUrl(), apiToken: '' }
}

export async function getBackendBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl
  if (baseUrlPromise) return baseUrlPromise

  baseUrlPromise = (async () => {
    if (window.electronAPI?.getBackendConnection) {
      try {
        const connection = await window.electronAPI.getBackendConnection()
        cachedConnection = connection
        cachedBaseUrl = connection.baseUrl
        return cachedBaseUrl
      } catch (err) {
        console.error('Failed to get backend connection from Electron:', err)
      }
    } else if (window.electronAPI?.getBackendUrl) {
      try {
        cachedBaseUrl = await window.electronAPI.getBackendUrl()
        return cachedBaseUrl
      } catch (err) {
        console.error('Failed to get backend URL from Electron:', err)
      }
    }
    // Browser dev mode: same origin (Vite proxy forwards /api and /ws).
    cachedBaseUrl = ''
    return cachedBaseUrl
  })()

  return baseUrlPromise
}
