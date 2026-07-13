const terminalSockets = new Map<string, WebSocket>()

export function registerTerminalSocket(agentId: string, socket: WebSocket): void {
  terminalSockets.set(agentId, socket)
}

export function unregisterTerminalSocket(agentId: string, socket: WebSocket): void {
  if (terminalSockets.get(agentId) === socket) {
    terminalSockets.delete(agentId)
  }
}

export function sendToTerminal(agentId: string, text: string): boolean {
  const socket = terminalSockets.get(agentId)
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(text)
  return true
}
