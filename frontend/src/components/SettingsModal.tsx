import { useEffect, useState } from 'react'
import {
  fetchCurrentProviders,
  fetchProviders,
  setCleanerProvider,
  setSttProvider,
} from '../services/api'
import { AppSettings, DEFAULT_SETTINGS } from '../services/env'
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

export default function SettingsModal({ onClose }: Props) {
  const { settings, persist } = useSettingsStore()
  const [tab, setTab] = useState<Tab>('shortcuts')
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState<null | 'ptt' | 'global' | 'show'>(null)

  const [sttProviders, setSttProviders] = useState<string[]>([])
  const [cleanerProviders, setCleanerProviders] = useState<string[]>([])
  const [stt, setStt] = useState('')
  const [cleaner, setCleaner] = useState('')
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providerMsg, setProviderMsg] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'providers') return
    setProvidersLoading(true)
    setProviderMsg(null)
    Promise.all([fetchProviders(), fetchCurrentProviders()])
      .then(([info, current]) => {
        setSttProviders(info.stt)
        setCleanerProviders(info.cleaner)
        setStt(current.stt_provider)
        setCleaner(current.cleaner_provider)
      })
      .catch((err) =>
        setProviderMsg(err instanceof Error ? err.message : 'Failed to load providers')
      )
      .finally(() => setProvidersLoading(false))
  }, [tab])

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

  const handleSttChange = async (value: string) => {
    setStt(value)
    try {
      await setSttProvider(value)
      setProviderMsg(`STT provider set to ${value}`)
    } catch (err) {
      setProviderMsg(err instanceof Error ? err.message : 'Failed to set STT provider')
    }
  }
  const handleCleanerChange = async (value: string) => {
    setCleaner(value)
    try {
      await setCleanerProvider(value)
      setProviderMsg(`Cleaner provider set to ${value}`)
    } catch (err) {
      setProviderMsg(err instanceof Error ? err.message : 'Failed to set cleaner provider')
    }
  }

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
            {!providersLoading && (
              <>
                <div className="field">
                  <label>STT provider</label>
                  <select value={stt} onChange={(e) => handleSttChange(e.target.value)}>
                    {sttProviders.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>LLM cleaner provider</label>
                  <select value={cleaner} onChange={(e) => handleCleanerChange(e.target.value)}>
                    {cleanerProviders.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                {providerMsg && <p className="field-hint">{providerMsg}</p>}
                <p className="field-hint">
                  Model size, device and API keys are configured via <code>.env</code> and applied
                  on backend restart.
                </p>
              </>
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
