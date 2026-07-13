import { useEffect, useState } from 'react'
import AgentGrid from './components/AgentGrid'
import ConnectionStatus from './components/ConnectionStatus'
import DictationDebugPanel from './components/DictationDebugPanel'
import Icon from './components/Icon'
import SettingsModal from './components/SettingsModal'
import VoiceButton from './components/VoiceButton'
import { useAgentStore } from './stores/agentStore'
import { useDebugStore } from './stores/debugStore'
import { useSettingsStore } from './stores/settingsStore'

function App() {
  const selectedAgent = useAgentStore((s) => s.selectedAgent)
  const selected = useAgentStore((s) => s.agents.find((a) => a.id === s.selectedAgent))
  const loadSettings = useSettingsStore((s) => s.load)
  const addDebug = useDebugStore((s) => s.add)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    loadSettings()
    const api = window.electronAPI
    if (api?.onSettingsChanged) {
      const unsub = api.onSettingsChanged(() => loadSettings())
      return unsub
    }
  }, [loadSettings])

  useEffect(() => {
    const unsub = window.electronAPI?.onDictationDebug?.((event) => {
      addDebug(event.source, event.message, event.level)
    })
    return unsub
  }, [addDebug])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">VS</div>
          <h1 className="brand-title">
            Vibe<span className="accent-dot">Spam</span>
          </h1>
          <span
            style={{
              width: 1,
              height: 22,
              background: 'var(--border)',
              margin: '0 4px',
            }}
          />
          <ConnectionStatus />
        </div>
        <div className="topbar-actions">
          <span className="target-pill" title={selected?.id ?? selectedAgent ?? undefined}>
            <span className="pill-dot" />
            <span className="pill-label">Target</span>
            <span>{selected?.name ?? selectedAgent ?? 'none'}</span>
          </span>
          <button
            className="icon-button"
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="Settings"
          >
            <Icon name="settings" />
          </button>
          <VoiceButton />
        </div>
      </header>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        <AgentGrid />
      </main>
      <DictationDebugPanel />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}

export default App
