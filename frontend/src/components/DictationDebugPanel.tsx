import { useDebugStore } from '../stores/debugStore'
import { useSettingsStore } from '../stores/settingsStore'
import Icon from './Icon'

export default function DictationDebugPanel() {
  const enabled = useSettingsStore((s) => s.settings.debugModeEnabled)
  const events = useDebugStore((s) => s.events)
  const clear = useDebugStore((s) => s.clear)

  if (!enabled) return null

  return (
    <aside className="debug-panel" aria-label="Dictation debug log">
      <div className="debug-panel-header">
        <strong>Dictation Debug</strong>
        <button className="icon-button btn-xs" onClick={clear} title="Clear debug log">
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div className="debug-panel-body">
        {events.length === 0 && <p className="debug-empty">Waiting for events</p>}
        {events.map((event) => (
          <div key={event.id} className={`debug-line ${event.level}`}>
            <span className="debug-time">{event.at}</span>
            <span className="debug-source">{event.source}</span>
            <span className="debug-message">{event.message}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
