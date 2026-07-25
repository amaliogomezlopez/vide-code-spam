import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import type { Agent } from '../services/api'
import { resizeAgent } from '../services/api'
import { registerTerminalSocket, unregisterTerminalSocket } from '../services/terminalInput'
import { createTerminalWebSocket } from '../services/websocket'
import { useAgentStore } from '../stores/agentStore'
import { THEMES, useSettingsStore } from '../stores/settingsStore'
import { useTerminalActivityStore } from '../stores/terminalActivityStore'
import Icon from './Icon'

interface Props {
  agent: Agent
}

export default function AgentTerminal({ agent }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const theme = useSettingsStore((s) => s.settings.theme)
  const fontSize = useSettingsStore((s) => s.settings.fontSize)
  const fontFamily = useSettingsStore((s) => s.settings.fontFamily)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const noteOutput = useTerminalActivityStore((s) => s.noteOutput)
  const noteSeen = useTerminalActivityStore((s) => s.noteSeen)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const term = terminalRef.current
    if (!term) return
    const colors = THEMES[theme] ?? THEMES.dark
    term.options.theme = {
      background: colors.background,
      foreground: colors.foreground,
    }
    term.options.fontSize = fontSize
    term.options.fontFamily = fontFamily
    const el = containerRef.current
    if (el) el.style.background = colors.background
  }, [theme, fontSize, fontFamily])

  useEffect(() => {
    if (!containerRef.current) return

    const snapshot = useSettingsStore.getState().settings
    const colors = THEMES[snapshot.theme] ?? THEMES.dark
    const term = new Terminal({
      fontSize: snapshot.fontSize,
      fontFamily: snapshot.fontFamily,
      theme: {
        background: colors.background,
        foreground: colors.foreground,
      },
      cursorBlink: true,
      convertEol: true,
      windowsPty: { backend: 'winpty' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    term.open(containerRef.current)
    // The DOM renderer is the bottleneck once several terminals stream at once.
    // WebGL is optional: a machine without a usable context keeps working.
    let webgl: WebglAddon | null = null
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl?.dispose()
        webgl = null
      })
      term.loadAddon(webgl)
    } catch {
      webgl = null
    }
    fit.fit()
    if (useAgentStore.getState().selectedAgent === agent.id) term.focus()
    terminalRef.current = term
    if (containerRef.current) containerRef.current.style.background = colors.background

    let resizeFrame: number | null = null
    let lastCols = 0
    let lastRows = 0
    const syncSize = () => {
      if (resizeFrame !== null) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        try {
          fit.fit()
          if (term.cols === lastCols && term.rows === lastRows) return
          lastCols = term.cols
          lastRows = term.rows
          // A terminal hidden by the Git filter comes back with a stale canvas
          // under the WebGL renderer; repainting on the size change fixes it.
          term.refresh(0, term.rows - 1)
          void resizeAgent(agent.id, term.cols, term.rows).catch(() => undefined)
        } catch {
          // The terminal may be between layout and disposal during a resize.
        }
      })
    }
    syncSize()

    let ws: WebSocket | null = null
    let closed = false
    let reconnectTimer: number | null = null
    // The backend replays the scrollback right after the socket opens; that is
    // history, not fresh activity, so it must not raise the attention flag.
    let connectedAt = 0
    const REPLAY_GRACE_MS = 300

    const connect = async () => {
      if (closed) return
      let socket: WebSocket
      try {
        socket = await createTerminalWebSocket(agent.id)
      } catch {
        if (closed) return
        term.writeln(`\r\n\x1b[31m[Failed to connect to ${agent.name}]\x1b[0m\r\n`)
        reconnectTimer = window.setTimeout(connect, 2000)
        return
      }

      // The effect can unmount while Electron resolves the backend connection.
      // Never let that late socket claim the PTY after cleanup has run.
      if (closed) {
        socket.close()
        return
      }

      ws = socket
      wsRef.current = socket
      socket.onmessage = (event) => {
        term.write(event.data)
        if (connectedAt && Date.now() - connectedAt > REPLAY_GRACE_MS) noteOutput(agent.id)
      }
      socket.onopen = () => {
        if (closed) {
          socket.close()
          return
        }
        connectedAt = Date.now()
        registerTerminalSocket(agent.id, socket)
        term.writeln(`\r\n\x1b[32m[Connected to ${agent.name}]\x1b[0m\r\n`)
        syncSize()
      }
      socket.onclose = () => {
        unregisterTerminalSocket(agent.id, socket)
        if (wsRef.current === socket) wsRef.current = null
        if (ws === socket) ws = null
        if (closed) return
        term.writeln(`\r\n\x1b[31m[Disconnected from ${agent.name}, retrying…]\x1b[0m\r\n`)
        reconnectTimer = window.setTimeout(connect, 2000)
      }
      socket.onerror = () => {
        socket.close()
      }
    }

    connect()

    // Ctrl+F is not meaningful to a CLI agent, and finding an error in
    // thousands of lines of output is a daily need with several agents running.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'f' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setSearchOpen(true)
        window.requestAnimationFrame(() => searchInputRef.current?.focus())
        return false
      }
      return true
    })

    const onDataDisposable = term.onData((data) => {
      selectAgent(agent.id)
      const socket = wsRef.current
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(data)
      }
    })

    const handleResize = () => syncSize()
    window.addEventListener('resize', handleResize)

    const ro = new ResizeObserver(() => syncSize())
    ro.observe(containerRef.current)

    return () => {
      closed = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      window.removeEventListener('resize', handleResize)
      ro.disconnect()
      onDataDisposable.dispose()
      if (ws) unregisterTerminalSocket(agent.id, ws)
      ws?.close()
      webgl?.dispose()
      searchRef.current = null
      term.dispose()
    }
  }, [agent.id, agent.name, noteOutput, selectAgent])

  const runSearch = (value: string, direction: 'next' | 'previous') => {
    setQuery(value)
    if (!value) {
      searchRef.current?.clearDecorations()
      return
    }
    const options = {
      decorations: {
        matchOverviewRuler: '#8b94a8',
        activeMatchColorOverviewRuler: '#f5b13d',
        activeMatchBackground: '#f5b13d',
      },
    }
    if (direction === 'next') searchRef.current?.findNext(value, options)
    else searchRef.current?.findPrevious(value, options)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setQuery('')
    searchRef.current?.clearDecorations()
    terminalRef.current?.focus()
  }

  const focusTerminal = () => {
    selectAgent(agent.id)
    noteSeen(agent.id)
    terminalRef.current?.focus()
  }

  return (
    <div className="terminal-surface-wrap">
      {searchOpen ? (
        <div className="terminal-search" role="search">
          <Icon name="search" size={13} />
          <input
            ref={searchInputRef}
            value={query}
            placeholder={`Search in ${agent.name}`}
            aria-label={`Search in ${agent.name}`}
            onChange={(event) => runSearch(event.target.value, 'next')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch()
              else if (event.key === 'Enter') runSearch(query, event.shiftKey ? 'previous' : 'next')
            }}
          />
          <button onClick={() => runSearch(query, 'previous')} aria-label="Previous match">
            ↑
          </button>
          <button onClick={() => runSearch(query, 'next')} aria-label="Next match">
            ↓
          </button>
          <button onClick={closeSearch} aria-label="Close search">
            <Icon name="close" size={13} />
          </button>
        </div>
      ) : null}
      <div
        id={`terminal-${agent.id}`}
        ref={containerRef}
        tabIndex={-1}
        onMouseDown={focusTerminal}
        onFocus={focusTerminal}
        className="terminal-surface"
      />
    </div>
  )
}
