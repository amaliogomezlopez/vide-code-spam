import { useEffect, useState } from 'react'
import {
  fetchProviders,
  fetchRuntimeSettings,
  saveRuntimeSettings,
  type RuntimeSettings,
} from '../services/api'
import { AppSettings, DEFAULT_SETTINGS, type PlatformCapabilities } from '../services/env'
import { THEMES, useSettingsStore } from '../stores/settingsStore'
import Icon, { type IconName } from './Icon'

interface Props {
  onClose: () => void
}

type Tab = 'shortcuts' | 'appearance' | 'providers'

const TAB_ICONS: Record<Tab, IconName> = {
  shortcuts: 'keyboard',
  appearance: 'palette',
  providers: 'cpu',
}

// Mirrors the backend allowlist in core/user_config.py.
const MODEL_SIZES = ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3', 'large-v3-turbo']
const DEVICES = ['cpu', 'cuda', 'auto']
const COMPUTE_TYPES = ['int8', 'int8_float16', 'float16', 'float32', 'auto']
const LANGUAGES = [
  { value: 'es', label: 'Spanish' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'auto', label: 'Auto-detect' },
]

export default function SettingsModal({ onClose }: Props) {
  const { settings, persist } = useSettingsStore()
  const [tab, setTab] = useState<Tab>('shortcuts')
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState<null | 'ptt' | 'global' | 'show'>(null)

  const [sttProviders, setSttProviders] = useState<string[]>([])
  const [cleanerProviders, setCleanerProviders] = useState<string[]>([])
  const [voice, setVoice] = useState<RuntimeSettings | null>(null)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providerMsg, setProviderMsg] = useState<string | null>(null)
  const [savingVoice, setSavingVoice] = useState(false)
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null)

  useEffect(() => {
    void window.electronAPI?.getPlatformCapabilities?.().then(setCapabilities).catch(console.error)
  }, [])

  useEffect(() => {
    if (tab !== 'providers') return
    const controller = new AbortController()
    setProvidersLoading(true)
    setProviderMsg(null)
    Promise.all([fetchProviders(), fetchRuntimeSettings(controller.signal)])
      .then(([info, runtime]) => {
        setSttProviders(info.stt)
        setCleanerProviders(info.cleaner)
        setVoice(runtime)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setProviderMsg(err instanceof Error ? err.message : 'Failed to load voice settings')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setProvidersLoading(false)
      })
    return () => controller.abort()
  }, [tab])

  const patchVoice = (patch: Partial<RuntimeSettings>) =>
    setVoice((current) => (current ? { ...current, ...patch } : current))

  const applyVoice = async () => {
    if (!voice) return
    setSavingVoice(true)
    setProviderMsg(null)
    try {
      const saved = await saveRuntimeSettings(voice)
      setVoice(saved)
      setProviderMsg('Voice settings saved. A model change applies to the next dictation.')
    } catch (err) {
      setProviderMsg(err instanceof Error ? err.message : 'Failed to save voice settings')
    } finally {
      setSavingVoice(false)
    }
  }

  const startRecording = async (which: 'ptt' | 'global' | 'show') => {
    setRecording(which)
    await window.electronAPI?.beginShortcutCapture?.()

    const finish = async () => {
      setRecording(null)
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('blur', cancel, true)
      await window.electronAPI?.endShortcutCapture?.()
    }

    const cancel = () => {
      void finish()
    }

    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const parts: string[] = []
      if (e.ctrlKey) parts.push('CommandOrControl')
      if (e.metaKey) parts.push('CommandOrControl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      let key = e.key
      if (key === ' ') key = 'Space'
      if (key.length === 1) key = key.toUpperCase()
      if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return
      parts.push(key)
      const accel = Array.from(new Set(parts)).join('+')
      setDraft((d) => ({
        ...d,
        pushToTalkShortcut: which === 'ptt' ? accel : d.pushToTalkShortcut,
        globalDictationShortcut: which === 'global' ? accel : d.globalDictationShortcut,
        showWindowShortcut: which === 'show' ? accel : d.showWindowShortcut,
      }))
      void finish()
    }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('blur', cancel, true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await persist(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => setDraft({ ...DEFAULT_SETTINGS })

  const requestMacOSAccessibility = async () => {
    await window.electronAPI?.requestMacOSAccessibility?.()
    const updated = await window.electronAPI?.getPlatformCapabilities?.()
    if (updated) setCapabilities(updated)
  }

  // The per-field STT/cleaner setters were replaced by the persisted runtime
  // settings form below, which saves every voice option in one request.
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-button close-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="tabs">
          {(['shortcuts', 'appearance', 'providers'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`tab-button${tab === t ? ' active' : ''}`}
            >
              <Icon name={TAB_ICONS[t]} size={15} />
              {t}
            </button>
          ))}
        </div>

        {tab === 'shortcuts' && (
          <div className="form-stack">
            <div className="field">
              <label>Push-to-talk shortcut</label>
              <div className="inline-field">
                <input
                  value={draft.pushToTalkShortcut}
                  onChange={(e) => setDraft({ ...draft, pushToTalkShortcut: e.target.value })}
                  placeholder="CommandOrControl+Shift+Space"
                />
                <button onClick={() => startRecording('ptt')}>
                  {recording === 'ptt' ? 'Press keys…' : 'Record'}
                </button>
              </div>
            </div>
            <div className="field">
              <label>Global dictation</label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.globalDictationEnabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      globalDictationEnabled: e.target.checked,
                    })
                  }
                />
                <span>
                  Show floating dictation button and paste transcriptions into the focused app
                </span>
              </label>
              <div className="inline-field">
                <input
                  value={draft.globalDictationShortcut}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      globalDictationShortcut: e.target.value,
                    })
                  }
                  placeholder="CommandOrControl+Shift+D"
                  disabled={!draft.globalDictationEnabled}
                />
                <button
                  onClick={() => startRecording('global')}
                  disabled={!draft.globalDictationEnabled}
                >
                  {recording === 'global' ? 'Press keys…' : 'Record'}
                </button>
              </div>
              {capabilities?.platform === 'darwin' && (
                <div className="field-hint">
                  macOS uses the clipboard and <code>⌘V</code>. Microphone:{' '}
                  <strong>{capabilities.microphonePermission}</strong>. Accessibility:{' '}
                  <strong>{capabilities.accessibilityPermission}</strong>.
                  {capabilities.accessibilityPermission !== 'granted' && (
                    <button type="button" onClick={requestMacOSAccessibility}>
                      Open permission prompt
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="field">
              <label>Show window shortcut</label>
              <div className="inline-field">
                <input
                  value={draft.showWindowShortcut}
                  onChange={(e) => setDraft({ ...draft, showWindowShortcut: e.target.value })}
                  placeholder="CommandOrControl+Shift+V"
                />
                <button onClick={() => startRecording('show')}>
                  {recording === 'show' ? 'Press keys…' : 'Record'}
                </button>
              </div>
            </div>
            <p className="field-hint">
              Format Electron: <code>CommandOrControl+Shift+Space</code>. Click Record and press a
              key combo.
            </p>
            <div className="field">
              <label>Notifications</label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.attentionNotifications}
                  onChange={(e) =>
                    setDraft({ ...draft, attentionNotifications: e.target.checked })
                  }
                />
                <span>
                  Notify when a terminal goes quiet and waits for you (only while Vibe Spam is not
                  focused)
                </span>
              </label>
            </div>
            <div className="field">
              <label>Diagnostics</label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.debugModeEnabled}
                  onChange={(e) => setDraft({ ...draft, debugModeEnabled: e.target.checked })}
                />
                <span>Show live dictation debug log</span>
              </label>
            </div>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="form-stack">
            <div className="field">
              <label>Theme</label>
              <select
                value={draft.theme}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    theme: e.target.value as AppSettings['theme'],
                  })
                }
              >
                {Object.entries(THEMES).map(([key, t]) => (
                  <option key={key} value={key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Font size — {draft.fontSize}px</label>
              <input
                type="range"
                min={8}
                max={24}
                value={draft.fontSize}
                onChange={(e) => setDraft({ ...draft, fontSize: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Font family</label>
              <input
                value={draft.fontFamily}
                onChange={(e) => setDraft({ ...draft, fontFamily: e.target.value })}
                placeholder="monospace"
              />
            </div>
          </div>
        )}

        {tab === 'providers' && (
          <div className="form-stack">
            {providersLoading && (
              <p className="loading-dot" style={{ color: 'var(--muted)' }}>
                Loading
              </p>
            )}
            {!providersLoading && voice && (
              <>
                <div className="field">
                  <label>STT provider</label>
                  <select
                    value={voice.stt_provider}
                    onChange={(e) => patchVoice({ stt_provider: e.target.value })}
                  >
                    {sttProviders.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>LLM cleaner provider</label>
                  <select
                    value={voice.cleaner_provider}
                    onChange={(e) => patchVoice({ cleaner_provider: e.target.value })}
                  >
                    {cleanerProviders.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Whisper model</label>
                  <select
                    value={voice.whisper_model_size}
                    onChange={(e) => patchVoice({ whisper_model_size: e.target.value })}
                  >
                    {MODEL_SIZES.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Dictation language</label>
                  <select
                    value={voice.whisper_language}
                    onChange={(e) => patchVoice({ whisper_language: e.target.value })}
                  >
                    {LANGUAGES.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Device</label>
                  <select
                    value={voice.whisper_device}
                    onChange={(e) => patchVoice({ whisper_device: e.target.value })}
                  >
                    {DEVICES.map((device) => (
                      <option key={device} value={device}>
                        {device}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Compute type</label>
                  <select
                    value={voice.whisper_compute_type}
                    onChange={(e) => patchVoice({ whisper_compute_type: e.target.value })}
                  >
                    {COMPUTE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Beam size — {voice.whisper_beam_size}</label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={voice.whisper_beam_size}
                    onChange={(e) => patchVoice({ whisper_beam_size: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Startup</label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={voice.preload_model}
                      onChange={(e) => patchVoice({ preload_model: e.target.checked })}
                    />
                    <span>Preload the speech model on launch (faster first dictation)</span>
                  </label>
                </div>
                <div className="field">
                  <label>
                    Terminal scrollback — {Math.round(voice.scrollback_chars / 1000)}k characters
                    per terminal
                  </label>
                  <input
                    type="range"
                    min={20000}
                    max={2000000}
                    step={20000}
                    value={voice.scrollback_chars}
                    onChange={(e) => patchVoice({ scrollback_chars: Number(e.target.value) })}
                  />
                </div>
                <button className="btn-primary" onClick={applyVoice} disabled={savingVoice}>
                  {savingVoice ? 'Applying…' : 'Apply settings'}
                </button>
                {providerMsg && <p className="field-hint">{providerMsg}</p>}
                <p className="field-hint">
                  Saved per user, so a packaged build no longer depends on a <code>.env</code> file.
                  API keys still come from the environment.
                </p>
              </>
            )}
            {!providersLoading && !voice && providerMsg && (
              <p className="field-hint">{providerMsg}</p>
            )}
          </div>
        )}

        <div className="modal-footer align-between" style={{ marginTop: 'var(--sp-6)' }}>
          <button onClick={handleReset} disabled={saving}>
            Reset defaults
          </button>
          <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
            <button onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <span className="loading-dot">Saving</span> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
