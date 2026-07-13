import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Agent } from '../services/api'
import { resizeAgent } from '../services/api'
import { registerTerminalSocket, unregisterTerminalSocket } from '../services/terminalInput'
import { createTerminalWebSocket } from '../services/websocket'
import { useAgentStore } from '../stores/agentStore'
import { THEMES, useSettingsStore } from '../stores/settingsStore'

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
    term.open(containerRef.current)
    fit.fit()
    term.focus()
    terminalRef.current = term
    if (containerRef.current) containerRef.current.style.background = colors.background

    const syncSize = () => {
      try {
        fit.fit()
        resizeAgent(agent.id, term.cols, term.rows)
      } catch {
        // ignore
      }
    }
    syncSize()

    let ws: WebSocket | null = null
    let closed = false
    let reconnectTimer: number | null = null

    const connect = async () => {
      if (closed) return
      try {
        ws = await createTerminalWebSocket(agent.id)
      } catch {
        term.writeln(`\r\n\x1b[31m[Failed to connect to ${agent.name}]\x1b[0m\r\n`)
        return
      }
      wsRef.current = ws
      ws.onmessage = (event) => {
        term.write(event.data)
      }
      ws.onopen = () => {
        registerTerminalSocket(agent.id, ws as WebSocket)
        term.writeln(`\r\n\x1b[32m[Connected to ${agent.name}]\x1b[0m\r\n`)
        syncSize()
      }
      ws.onclose = () => {
        if (ws) unregisterTerminalSocket(agent.id, ws)
        if (closed) return
        term.writeln(`\r\n\x1b[31m[Disconnected from ${agent.name}, retrying…]\x1b[0m\r\n`)
        reconnectTimer = window.setTimeout(connect, 2000)
      }
      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

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
      window.removeEventListener('resize', handleResize)
      ro.disconnect()
      onDataDisposable.dispose()
      if (ws) unregisterTerminalSocket(agent.id, ws)
      ws?.close()
      term.dispose()
    }
  }, [agent.id, agent.name, selectAgent])

  const focusTerminal = () => {
    selectAgent(agent.id)
    terminalRef.current?.focus()
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseDown={focusTerminal}
      onFocus={focusTerminal}
      className="terminal-surface"
    />
  )
}
