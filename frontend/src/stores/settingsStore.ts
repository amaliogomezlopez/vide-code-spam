import { create } from 'zustand'
import { AppSettings, DEFAULT_SETTINGS } from '../services/env'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  setSettings: (settings: AppSettings) => void
  load: () => Promise<void>
  persist: (settings: AppSettings) => Promise<void>
}

const fallbackSettings = { ...DEFAULT_SETTINGS }

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  setSettings: (settings) => set({ settings }),
  load: async () => {
    const api = window.electronAPI
    if (api?.getSettings) {
      try {
        const s = await api.getSettings()
        set({ settings: s, loaded: true })
        return
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }
    set({ settings: { ...fallbackSettings }, loaded: true })
  },
  persist: async (settings) => {
    set({ settings })
    const api = window.electronAPI
    if (api?.saveSettings) {
      try {
        const saved = await api.saveSettings(settings)
        set({ settings: saved })
        return
      } catch (err) {
        console.error('Failed to persist settings:', err)
      }
    }
    fallbackSettings.pushToTalkShortcut = settings.pushToTalkShortcut
    fallbackSettings.globalDictationShortcut = settings.globalDictationShortcut
    fallbackSettings.globalDictationEnabled = settings.globalDictationEnabled
    fallbackSettings.dictationOverlayPosition = settings.dictationOverlayPosition ?? null
    fallbackSettings.showWindowShortcut = settings.showWindowShortcut
    fallbackSettings.theme = settings.theme
    fallbackSettings.fontSize = settings.fontSize
    fallbackSettings.fontFamily = settings.fontFamily
    fallbackSettings.debugModeEnabled = settings.debugModeEnabled
  },
}))

/**
 * Full xterm themes. `AgentTerminal` only reads background/foreground today,
 * but exposing the full palette (ANSI, cursor, selection) is harmless and lets
 * the terminal render coherently with the app's amber identity.
 */
export const THEMES: Record<
  AppSettings['theme'],
  {
    background: string
    foreground: string
    name: string
    cursor?: string
    cursorAccent?: string
    selection?: string
    black?: string
    red?: string
    green?: string
    yellow?: string
    blue?: string
    magenta?: string
    cyan?: string
    white?: string
    brightBlack?: string
    brightRed?: string
    brightGreen?: string
    brightYellow?: string
    brightBlue?: string
    brightMagenta?: string
    brightCyan?: string
    brightWhite?: string
  }
> = {
  dark: {
    name: 'Dark',
    background: '#0a0c10',
    foreground: '#eceef3',
    cursor: '#f5b13d',
    cursorAccent: '#0a0c10',
    selection: 'rgba(245, 177, 61, 0.22)',
    black: '#0a0c10',
    red: '#fb7185',
    green: '#34d399',
    yellow: '#f5b13d',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#eceef3',
    brightBlack: '#8b94a8',
    brightRed: '#fda4af',
    brightGreen: '#6ee7b7',
    brightYellow: '#fcd34d',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff',
  },
  light: {
    name: 'Light',
    background: '#fafafa',
    foreground: '#1a1a1a',
    cursor: '#d99a26',
    cursorAccent: '#fafafa',
    selection: 'rgba(217, 154, 38, 0.22)',
    black: '#1a1a1a',
    red: '#e11d48',
    green: '#059669',
    yellow: '#d99a26',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#525252',
    brightBlack: '#737373',
    brightRed: '#be123c',
    brightGreen: '#047857',
    brightYellow: '#b45309',
    brightBlue: '#1d4ed8',
    brightMagenta: '#7e22ce',
    brightCyan: '#0e7490',
    brightWhite: '#171717',
  },
  midnight: {
    name: 'Midnight',
    background: '#0a0f1f',
    foreground: '#c9d1e6',
    cursor: '#f5b13d',
    cursorAccent: '#0a0f1f',
    selection: 'rgba(245, 177, 61, 0.2)',
    black: '#0a0f1f',
    red: '#ff7b85',
    green: '#3fb950',
    yellow: '#f5b13d',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#c9d1e6',
    brightBlack: '#8b949e',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
}
