import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  systemPreferences,
  Tray,
} from 'electron'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import http from 'http'
import net from 'net'
import { randomBytes } from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let dictationOverlayWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let tray: Tray | null = null
let isQuitting = false
const DEFAULT_BACKEND_PORT = 8765
let backendPort = DEFAULT_BACKEND_PORT
const backendToken = randomBytes(32).toString('hex')
const MAX_HEALTH_RETRIES = 60
const HEALTH_INTERVAL_MS = 500

const PUSH_TO_TALK_ACCELERATOR_DEFAULT = 'CommandOrControl+Shift+Space'
const GLOBAL_DICTATION_ACCELERATOR_DEFAULT = 'CommandOrControl+Shift+D'
const GLOBAL_DICTATION_ACCELERATOR_LEGACY = 'CommandOrControl+Alt+Space'
const SHOW_WINDOW_ACCELERATOR_DEFAULT = 'CommandOrControl+Shift+V'
const BACKEND_EXE_NAME =
  process.platform === 'win32' ? 'vibe-spam-backend.exe' : 'vibe-spam-backend'
const APP_NAME = 'Vibe Spam'

interface AppSettings {
  pushToTalkShortcut: string
  globalDictationShortcut: string
  globalDictationEnabled: boolean
  dictationOverlayPosition?: OverlayPosition | null
  showWindowShortcut: string
  theme: 'dark' | 'light' | 'midnight'
  fontSize: number
  fontFamily: string
  debugModeEnabled: boolean
}

interface OverlayPosition {
  x: number
  y: number
}

const DEFAULT_SETTINGS: AppSettings = {
  pushToTalkShortcut: PUSH_TO_TALK_ACCELERATOR_DEFAULT,
  globalDictationShortcut: GLOBAL_DICTATION_ACCELERATOR_DEFAULT,
  globalDictationEnabled: false,
  dictationOverlayPosition: null,
  showWindowShortcut: SHOW_WINDOW_ACCELERATOR_DEFAULT,
  theme: 'dark',
  fontSize: 12,
  fontFamily: 'monospace',
  debugModeEnabled: false,
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    const merged = { ...DEFAULT_SETTINGS, ...parsed }
    const normalized = normalizeSettings(merged)
    if (normalized.globalDictationShortcut !== merged.globalDictationShortcut) {
      fs.writeFileSync(settingsPath(), JSON.stringify(normalized, null, 2), 'utf-8')
    }
    return normalized
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let currentSettings: AppSettings = { ...DEFAULT_SETTINGS }
let globalDictationMode: 'idle' | 'listening' | 'transcribing' | 'error' = 'idle'
let globalDictationCaptureJson: string | null = null
let globalDictationTargetLabel: string | null = null
let globalDictationTargetBundleId: string | null = null
let dictationOverlayDrag: {
  cursorStart: OverlayPosition
  windowStart: OverlayPosition
} | null = null

function saveSettings(settings: AppSettings): void {
  currentSettings = settings
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

function isOverlayPosition(value: unknown): value is OverlayPosition {
  if (!value || typeof value !== 'object') return false
  const position = value as Record<string, unknown>
  return Number.isFinite(position.x) && Number.isFinite(position.y)
}

function normalizeSettings(value: unknown): AppSettings {
  const input = value && typeof value === 'object' ? (value as Partial<AppSettings>) : {}
  const shortcut = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128
      ? candidate
      : fallback
  const normalized: AppSettings = {
    pushToTalkShortcut: shortcut(input.pushToTalkShortcut, DEFAULT_SETTINGS.pushToTalkShortcut),
    globalDictationShortcut: shortcut(
      input.globalDictationShortcut,
      DEFAULT_SETTINGS.globalDictationShortcut
    ),
    globalDictationEnabled:
      typeof input.globalDictationEnabled === 'boolean'
        ? input.globalDictationEnabled
        : DEFAULT_SETTINGS.globalDictationEnabled,
    dictationOverlayPosition: isOverlayPosition(input.dictationOverlayPosition)
      ? input.dictationOverlayPosition
      : null,
    showWindowShortcut: shortcut(input.showWindowShortcut, DEFAULT_SETTINGS.showWindowShortcut),
    theme:
      input.theme === 'dark' || input.theme === 'light' || input.theme === 'midnight'
        ? input.theme
        : DEFAULT_SETTINGS.theme,
    fontSize:
      typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)
        ? Math.max(8, Math.min(24, Math.round(input.fontSize)))
        : DEFAULT_SETTINGS.fontSize,
    fontFamily:
      typeof input.fontFamily === 'string' && input.fontFamily.length <= 200
        ? input.fontFamily
        : DEFAULT_SETTINGS.fontFamily,
    debugModeEnabled:
      typeof input.debugModeEnabled === 'boolean'
        ? input.debugModeEnabled
        : DEFAULT_SETTINGS.debugModeEnabled,
  }
  if (normalized.globalDictationShortcut === GLOBAL_DICTATION_ACCELERATOR_LEGACY) {
    normalized.globalDictationShortcut = GLOBAL_DICTATION_ACCELERATOR_DEFAULT
  }
  if (!isOverlayPosition(normalized.dictationOverlayPosition)) {
    normalized.dictationOverlayPosition = null
  }
  return normalized
}

function requireSender(
  event: { sender: { id: number } },
  ...windows: Array<BrowserWindow | null>
): void {
  if (
    !windows.some(
      (window) => window && !window.isDestroyed() && window.webContents.id === event.sender.id
    )
  ) {
    throw new Error('Untrusted IPC sender')
  }
}

// Prevent multiple Electron instances. If the user double-clicks the exe while
// one is already running, focus the existing window instead.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

function logPath(): string {
  const logDir = path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  return path.join(logDir, 'backend.log')
}

function backendUrl(port = backendPort): string {
  return `http://127.0.0.1:${port}`
}

function appIconPath(): string {
  const iconName =
    process.platform === 'win32'
      ? 'vibe-spam.ico'
      : process.platform === 'darwin'
        ? 'vibe-spam-32.png'
        : 'vibe-spam-256.png'
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', iconName)
  }
  return path.join(__dirname, '..', 'assets', iconName)
}

function getAppIcon() {
  const iconPath = appIconPath()
  return fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  updateTrayMenu()
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.hide()
  updateTrayMenu()
}

function shutdownBackend() {
  if (!backendProcess) return
  try {
    backendProcess.kill()
  } catch {}
  backendProcess = null
}

function quitCompletely() {
  isQuitting = true
  globalShortcut.unregisterAll()
  setDictationOverlayVisible(false)
  shutdownBackend()
  app.quit()
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

function readHealth(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(`${backendUrl(port)}/api/health`, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        resolve(res.statusCode === 200 ? body : null)
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(500, () => {
      req.destroy()
      resolve(null)
    })
  })
}

async function isVibeSpamBackend(port: number): Promise<boolean> {
  const body = await readHealth(port)
  if (!body) return false
  try {
    const parsed = JSON.parse(body)
    return parsed?.status === 'ok' && Object.keys(parsed).length === 1
  } catch {
    return false
  }
}

function killOrphanBackend(): Promise<void> {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'taskkill' : 'pkill'
    const args =
      process.platform === 'win32' ? ['/F', '/IM', BACKEND_EXE_NAME] : ['-f', BACKEND_EXE_NAME]

    const proc = spawn(command, args, { stdio: 'ignore' })
    proc.on('error', () => resolve())
    proc.on('exit', () => resolve())
  })
}

async function chooseBackendPort(): Promise<number> {
  for (let port = DEFAULT_BACKEND_PORT; port < DEFAULT_BACKEND_PORT + 40; port++) {
    if (await isPortFree(port)) return port

    if (await isVibeSpamBackend(port)) {
      await killOrphanBackend()
      const start = Date.now()
      while (Date.now() - start < 3000) {
        if (await isPortFree(port)) return port
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }

  throw new Error(
    `No free backend port found from ${DEFAULT_BACKEND_PORT} to ${DEFAULT_BACKEND_PORT + 39}`
  )
}

function waitForBackend(retries = MAX_HEALTH_RETRIES): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const tryHealth = () => {
      attempts++
      const req = http.get(`${backendUrl()}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve()
        } else {
          retry()
        }
      })
      req.on('error', retry)
      req.setTimeout(1000, () => {
        req.destroy()
        retry()
      })

      function retry() {
        if (attempts >= retries) {
          reject(new Error(`Backend did not respond after ${retries} attempts`))
          return
        }
        setTimeout(tryHealth, HEALTH_INTERVAL_MS)
      }
    }
    tryHealth()
  })
}

function developmentPythonPath(): string {
  const projectRoot = path.join(__dirname, '..', '..')
  const virtualenvPython =
    process.platform === 'win32'
      ? path.join(projectRoot, 'backend', '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'backend', '.venv', 'bin', 'python')
  if (fs.existsSync(virtualenvPython)) return virtualenvPython
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function startBackend(): Promise<void> {
  const isDev = !app.isPackaged
  backendPort = await chooseBackendPort()
  const command = isDev
    ? developmentPythonPath()
    : path.join(process.resourcesPath, 'backend', BACKEND_EXE_NAME)
  const args = isDev
    ? [
        '-m',
        'uvicorn',
        'backend.app.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(backendPort),
      ]
    : ['--port', String(backendPort)]

  return new Promise((resolve, reject) => {
    const logFile = fs.createWriteStream(logPath(), { flags: 'a' })
    logFile.write(`\n--- Vibe Spam started at ${new Date().toISOString()} ---\n`)
    logFile.write(`[startup] Launching backend on ${backendUrl()}\n`)

    backendProcess = spawn(command, args, {
      cwd: isDev ? path.join(__dirname, '..', '..') : undefined,
      env: {
        ...process.env,
        PORT: String(backendPort),
        VIBE_SPAM_API_TOKEN: backendToken,
      },
      stdio: 'pipe',
      detached: false,
    })

    backendProcess.stdout?.on('data', (data) => {
      const text = String(data)
      console.log(`[backend] ${text}`)
      logFile.write(`[stdout] ${text}`)
    })

    backendProcess.stderr?.on('data', (data) => {
      const text = String(data)
      console.error(`[backend] ${text}`)
      logFile.write(`[stderr] ${text}`)
    })

    backendProcess.on('error', (err) => {
      logFile.write(`[error] ${err.message}\n`)
      reject(err)
    })

    backendProcess.on('exit', (code) => {
      const msg = `Backend exited with code ${code}`
      console.log(msg)
      logFile.write(`[exit] ${msg}\n`)
    })

    waitForBackend()
      .then(resolve)
      .catch((err) => {
        logFile.write(`[startup] Backend health timed out on ${backendUrl()}: ${err.message}\n`)
        try {
          backendProcess?.kill()
        } catch {}
        reject(err)
      })
  })
}

const SPLASH_HTML = `<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    height:100vh;background:#0a0c10;color:#eceef3;
    font-family:system-ui,"Segoe UI",Roboto,sans-serif;text-align:center;
    -webkit-font-smoothing:antialiased;overflow:hidden;
  }
  .mark{
    width:64px;height:64px;border-radius:14px;
    background:linear-gradient(135deg,#ffc456,#d99a26);
    color:#1a1305;font-weight:800;font-size:24px;letter-spacing:-0.03em;
    display:grid;place-items:center;
    box-shadow:0 8px 30px rgba(245,177,61,.35), inset 0 1px 0 rgba(255,255,255,.25);
    margin-bottom:22px;
  }
  h2{font-size:1.1rem;font-weight:650;letter-spacing:-.01em;margin-bottom:6px}
  h2 .accent{color:#f5b13d}
  #status{color:#8b94a8;font-size:.82rem;font-weight:500;min-height:1.2em}
  .spinner{
    width:18px;height:18px;border:2px solid #353f52;border-top-color:#f5b13d;
    border-radius:50%;animation:spin .8s linear infinite;margin-top:16px;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
  <div class="mark">Vs</div>
  <h2>Vibe<span class="accent">Spam</span></h2>
  <p id="status">Starting backend…</p>
  <div class="spinner"></div>
</body></html>`

const DICTATION_OVERLAY_HTML = `<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} html,body{margin:0;width:100%;height:100%;overflow:hidden}
  body{
    display:grid;place-items:center;background:transparent;
    font-family:system-ui,"Segoe UI",Roboto,sans-serif;user-select:none;
  }
  button{
    position:relative;width:72px;height:72px;border:1px solid rgba(245,177,61,.32);
    border-radius:20px;background:rgba(10,12,16,.82);color:#f5b13d;
    box-shadow:0 18px 42px rgba(0,0,0,.38),0 0 0 1px rgba(255,255,255,.05) inset;
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    display:grid;place-items:center;cursor:pointer;padding:0;overflow:hidden;
  }
  button::before{
    content:"";position:absolute;inset:-18px;border-radius:28px;
    background:radial-gradient(circle at 50% 35%,rgba(245,177,61,.28),transparent 52%);
    opacity:.38;transform:scale(var(--level,.18));transition:transform 90ms linear,opacity 160ms ease;
  }
  .mark{
    position:relative;z-index:2;width:40px;height:40px;border-radius:12px;
    display:grid;place-items:center;background:linear-gradient(135deg,#ffc456,#d99a26);
    color:#1a1305;font-weight:850;font-size:14px;letter-spacing:-.02em;
    box-shadow:0 6px 20px rgba(245,177,61,.28),inset 0 1px 0 rgba(255,255,255,.28);
    transition:transform 160ms ease,opacity 160ms ease;
  }
  .meter{position:absolute;z-index:3;display:flex;align-items:center;gap:4px;opacity:0;transition:opacity 120ms ease}
  .meter i{width:4px;height:18px;border-radius:999px;background:#ffd07a;transform:scaleY(.35);transform-origin:center;box-shadow:0 0 12px rgba(245,177,61,.46)}
  .meter i:nth-child(1){height:18px;transform:scaleY(calc(.25 + var(--level,.2) * .55))}
  .meter i:nth-child(2){height:29px;transform:scaleY(calc(.24 + var(--level,.2) * .9))}
  .meter i:nth-child(3){height:38px;transform:scaleY(calc(.2 + var(--level,.2) * 1.05))}
  .meter i:nth-child(4){height:29px;transform:scaleY(calc(.24 + var(--level,.2) * .78))}
  .meter i:nth-child(5){height:18px;transform:scaleY(calc(.25 + var(--level,.2) * .6))}
  .state-listening .mark,.state-transcribing .mark{opacity:0;transform:scale(.72)}
  .state-listening .meter,.state-transcribing .meter{opacity:1}
  .state-listening button{border-color:rgba(245,177,61,.62)}
  .state-transcribing button{border-color:rgba(96,165,250,.58);color:#93c5fd}
  .state-transcribing .meter i{background:#93c5fd;animation:thinking 780ms ease-in-out infinite}
  .state-transcribing .meter i:nth-child(2){animation-delay:70ms}.state-transcribing .meter i:nth-child(3){animation-delay:140ms}.state-transcribing .meter i:nth-child(4){animation-delay:210ms}.state-transcribing .meter i:nth-child(5){animation-delay:280ms}
  .state-error button{border-color:rgba(251,113,133,.7);color:#fb7185}
  .state-error .mark{background:linear-gradient(135deg,#fb7185,#e11d48);color:#fff}
  @keyframes thinking{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}
</style></head><body class="state-idle">
  <button id="overlay" title="Global dictation">
    <span class="mark">VS</span>
    <span class="meter"><i></i><i></i><i></i><i></i><i></i></span>
  </button>
  <script>
    const body = document.body
    const overlay = document.getElementById('overlay')
    const dragThreshold = 4
    let pointerDown = false
    let dragMoved = false
    let startX = 0
    let startY = 0

    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      pointerDown = true
      dragMoved = false
      startX = event.screenX
      startY = event.screenY
      overlay.setPointerCapture(event.pointerId)
      window.overlayAPI.dragStart()
    })

    overlay.addEventListener('pointermove', (event) => {
      if (!pointerDown) return
      const distance = Math.hypot(event.screenX - startX, event.screenY - startY)
      if (distance >= dragThreshold) dragMoved = true
      if (dragMoved) window.overlayAPI.dragMove()
    })

    overlay.addEventListener('pointerup', (event) => {
      if (!pointerDown) return
      pointerDown = false
      try { overlay.releasePointerCapture(event.pointerId) } catch {}
      window.overlayAPI.dragEnd()
      if (!dragMoved) window.overlayAPI.toggle()
    })

    overlay.addEventListener('pointercancel', () => {
      pointerDown = false
      window.overlayAPI.dragEnd()
    })

    window.setDictationOverlay = (payload) => {
      const mode = payload && payload.mode ? payload.mode : 'idle'
      const level = Math.max(0.08, Math.min(1, Number(payload && payload.level) || 0.08))
      body.className = 'state-' + mode
      document.documentElement.style.setProperty('--level', String(level))
      overlay.title = mode === 'listening' ? 'Listening - click to stop' : mode === 'transcribing' ? 'Transcribing' : 'Global dictation'
    }
    window.overlayAPI.onState(window.setDictationOverlay)
  </script>
</body></html>`

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#0a0c10',
    icon: getAppIcon(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`)
}

function updateSplashStatus(text: string, isError = false) {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents.executeJavaScript(
    `document.getElementById('status').textContent = ${JSON.stringify(text)};
     document.getElementById('status').style.color = ${isError ? '"#ef4444"' : '"#e6e6e6"'};`
  )
}

function createDictationOverlayWindow() {
  if (dictationOverlayWindow && !dictationOverlayWindow.isDestroyed()) return
  const display = screen.getPrimaryDisplay()
  const { workArea } = display
  const size = 88
  const fallbackPosition = {
    x: workArea.x + workArea.width - size - 24,
    y: workArea.y + workArea.height - size - 28,
  }
  const position = clampOverlayPosition(
    currentSettings.dictationOverlayPosition ?? fallbackPosition,
    size
  )
  dictationOverlayWindow = new BrowserWindow({
    width: size,
    height: size,
    x: position.x,
    y: position.y,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    show: Boolean(currentSettings.globalDictationEnabled),
    focusable: false,
    icon: getAppIcon(),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  dictationOverlayWindow.setAlwaysOnTop(true, 'screen-saver')
  dictationOverlayWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(DICTATION_OVERLAY_HTML)}`
  )
  dictationOverlayWindow.on('closed', () => {
    dictationOverlayDrag = null
    dictationOverlayWindow = null
  })
}

function clampOverlayPosition(position: OverlayPosition, size = 88): OverlayPosition {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(position.x + size / 2),
    y: Math.round(position.y + size / 2),
  })
  const { workArea } = display
  return {
    x: Math.max(workArea.x, Math.min(Math.round(position.x), workArea.x + workArea.width - size)),
    y: Math.max(workArea.y, Math.min(Math.round(position.y), workArea.y + workArea.height - size)),
  }
}

function persistDictationOverlayPosition(position: OverlayPosition): void {
  const normalized = normalizeSettings({
    ...currentSettings,
    dictationOverlayPosition: clampOverlayPosition(position),
  })
  saveSettings(normalized)
  mainWindow?.webContents.send('settings-changed', currentSettings)
}

function startDictationOverlayDrag(): void {
  if (!dictationOverlayWindow || dictationOverlayWindow.isDestroyed()) return
  dictationOverlayDrag = {
    cursorStart: screen.getCursorScreenPoint(),
    windowStart: dictationOverlayWindow.getBounds(),
  }
}

function moveDictationOverlayDrag(): void {
  if (!dictationOverlayDrag || !dictationOverlayWindow || dictationOverlayWindow.isDestroyed())
    return
  const cursor = screen.getCursorScreenPoint()
  const position = clampOverlayPosition({
    x: dictationOverlayDrag.windowStart.x + cursor.x - dictationOverlayDrag.cursorStart.x,
    y: dictationOverlayDrag.windowStart.y + cursor.y - dictationOverlayDrag.cursorStart.y,
  })
  dictationOverlayWindow.setPosition(position.x, position.y, false)
}

function endDictationOverlayDrag(): void {
  if (!dictationOverlayDrag || !dictationOverlayWindow || dictationOverlayWindow.isDestroyed()) {
    dictationOverlayDrag = null
    return
  }
  dictationOverlayDrag = null
  const { x, y } = dictationOverlayWindow.getBounds()
  persistDictationOverlayPosition({ x, y })
}

function setDictationOverlayVisible(visible: boolean) {
  createDictationOverlayWindow()
  if (!dictationOverlayWindow || dictationOverlayWindow.isDestroyed()) return
  if (visible) dictationOverlayWindow.showInactive()
  else dictationOverlayWindow.hide()
}

function updateDictationOverlay(state: { mode: string; level?: number; text?: string }) {
  if (
    state.mode === 'idle' ||
    state.mode === 'listening' ||
    state.mode === 'transcribing' ||
    state.mode === 'error'
  ) {
    globalDictationMode = state.mode
  }
  createDictationOverlayWindow()
  if (!dictationOverlayWindow || dictationOverlayWindow.isDestroyed()) return
  if (currentSettings.globalDictationEnabled) dictationOverlayWindow.showInactive()
  dictationOverlayWindow.webContents.send('dictation-overlay-state', state)
}

function updateTrayMenu() {
  if (!tray) return
  const isVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isVisible ? 'Ocultar Vibe Spam' : 'Mostrar Vibe Spam',
        click: () => {
          if (isVisible) hideMainWindow()
          else showMainWindow()
        },
      },
      {
        label: currentSettings.globalDictationEnabled
          ? 'Dictado global activo'
          : 'Dictado global inactivo',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Salir completamente',
        click: () => quitCompletely(),
      },
    ])
  )
}

function createTray() {
  if (tray) return
  const icon = getAppIcon()
  tray = icon ? new Tray(icon) : new Tray(nativeImage.createEmpty())
  tray.setToolTip(`${APP_NAME} - dictado y terminales`)
  tray.on('click', () => showMainWindow())
  updateTrayMenu()
}

function sendDictationDebug(
  source: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info'
) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('dictation-debug', { source, message, level })
}

function ensureAutomationTempDir(): string {
  const tempDir = path.join(app.getPath('userData'), 'tmp')
  fs.mkdirSync(tempDir, { recursive: true })
  return tempDir
}

// Path to the bundled native inserter helper. In packaged builds it lives under
// resources/inserter/inserter.exe; in dev it is built under frontend/inserter-dist.
function inserterExePath(): string | null {
  if (process.platform !== 'win32') return null
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'inserter', 'inserter.exe')
  }
  const devPath = path.join(__dirname, '..', 'inserter-dist', 'inserter.exe')
  return fs.existsSync(devPath) ? devPath : null
}

// Capture the currently focused element (the actual text control, not just the
// window) using the native UIAutomation helper. Asynchronous: spawns the helper
// without blocking Electron's main thread and invokes `onResult` with the
// helper's JSON line (hwnd, thread, runtimeId, process, ...) — or null on
// failure. Blocking here (former spawnSync) froze the UI for tens/hundreds of
// ms every time the dictation shortcut was pressed.
function captureFocusedElementAsync(onResult: (json: string | null) => void): void {
  if (process.platform !== 'win32') {
    onResult(null)
    return
  }
  const exe = inserterExePath()
  if (!exe) {
    sendDictationDebug('focus', 'inserter.exe not found', 'error')
    onResult(null)
    return
  }
  let stdout = ''
  let settled = false
  const finish = (result: string | null) => {
    if (settled) return
    settled = true
    onResult(result)
  }
  const proc: ChildProcess = spawn(exe, ['capture'], {
    windowsHide: true,
  })
  const timeout = setTimeout(() => {
    try {
      proc.kill()
    } catch {}
    sendDictationDebug('focus', 'capture timed out', 'error')
    finish(null)
  }, 4000)
  proc.stdout?.on('data', (data) => {
    stdout += String(data)
  })
  proc.on('error', (err) => {
    clearTimeout(timeout)
    sendDictationDebug('focus', `capture failed: ${err.message}`, 'error')
    finish(null)
  })
  proc.on('close', (code) => {
    clearTimeout(timeout)
    if (code !== 0) {
      sendDictationDebug('focus', `capture exited ${code}`, 'error')
      finish(null)
      return
    }
    const line = stdout.trim().split(/\r?\n/).pop() ?? ''
    if (!line.startsWith('{')) {
      sendDictationDebug('focus', `capture bad output: ${line.slice(0, 120)}`, 'error')
      finish(null)
      return
    }
    // Pull a readable label out of the JSON for debug logging.
    const procMatch = line.match(/"process":"([^"]*)"/)
    const nameMatch = line.match(/"name":"([^"]*)"/)
    const typeMatch = line.match(/"controlType":"([^"]*)"/)
    globalDictationTargetLabel =
      [procMatch?.[1], typeMatch?.[1]?.replace('ControlType.', ''), nameMatch?.[1]]
        .filter(Boolean)
        .join(' / ') || null
    finish(line)
  })
}

function captureMacOSFrontmostApplicationAsync(
  onResult: (bundleId: string | null) => void
): void {
  if (process.platform !== 'darwin') {
    onResult(null)
    return
  }
  let stdout = ''
  let settled = false
  const finish = (bundleId: string | null) => {
    if (settled) return
    settled = true
    onResult(bundleId)
  }
  const proc = spawn(
    '/usr/bin/osascript',
    [
      '-e',
      'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  )
  const timeout = setTimeout(() => {
    try {
      proc.kill()
    } catch {}
    sendDictationDebug('focus', 'macOS target capture timed out', 'warn')
    finish(null)
  }, 4000)
  proc.stdout?.on('data', (data) => {
    stdout += String(data)
  })
  proc.on('error', (err) => {
    clearTimeout(timeout)
    sendDictationDebug('focus', `macOS target capture failed: ${err.message}`, 'warn')
    finish(null)
  })
  proc.on('close', (code) => {
    clearTimeout(timeout)
    const bundleId = stdout.trim()
    if (code === 0 && /^[A-Za-z0-9.-]{1,255}$/.test(bundleId)) {
      finish(bundleId)
      return
    }
    finish(null)
  })
}

// Insert transcribed text into the previously captured control via the native
// helper. The helper handles focus restoration, Ctrl+V, ValuePattern and
// SendInput fallbacks, and verifies the control's value actually changed.
function insertWithHelper(text: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const exe = inserterExePath()
  const captureJson = globalDictationCaptureJson
  if (!exe) {
    sendDictationDebug('paste', 'inserter.exe not found', 'error')
    return Promise.resolve(false)
  }
  const tempDir = ensureAutomationTempDir()
  const textPath = path.join(tempDir, `vibe-spam-dictation-${Date.now()}.txt`)
  fs.writeFileSync(textPath, text, 'utf8')

  // Hide the always-on-top overlay during the paste sequence so it cannot
  // interfere with the foreground window / Z-order, then restore it after.
  const overlayWasVisible =
    currentSettings.globalDictationEnabled &&
    dictationOverlayWindow !== null &&
    !dictationOverlayWindow.isDestroyed() &&
    dictationOverlayWindow.isVisible()
  if (overlayWasVisible) {
    dictationOverlayWindow?.hide()
    sendDictationDebug('paste', 'overlay hidden')
  }

  const args = ['insert', '--text', textPath]
  if (captureJson) args.push('--capture', captureJson)
  return new Promise((resolve) => {
    const proc = spawn(exe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    sendDictationDebug(
      'paste',
      captureJson
        ? `paste attempt ${globalDictationTargetLabel ?? ''}`.trim()
        : 'paste attempt no capture',
      'info'
    )
    let succeeded = false
    proc.stdout?.on('data', (data) => {
      for (const line of String(data).split(/\r?\n/).filter(Boolean)) {
        if (line.startsWith('RESULT ')) {
          const result = line.slice(7)
          try {
            succeeded = JSON.parse(result).status === 'ok'
          } catch {
            succeeded = false
          }
          const m = line.match(/"status":"([^"]*)".*"detail":"([^"]*)"/)
          sendDictationDebug(
            'paste',
            m ? `${m[1]} (${m[2]})` : line,
            m && m[1] === 'ok' ? 'info' : 'error'
          )
        } else {
          sendDictationDebug('paste', line)
        }
      }
    })
    proc.stderr?.on('data', (data) => {
      for (const line of String(data).split(/\r?\n/).filter(Boolean)) {
        sendDictationDebug('paste', line, 'error')
      }
    })
    proc.on('error', (err) => {
      sendDictationDebug('paste', err.message, 'error')
      console.error('Failed to insert global dictation:', err)
    })
    proc.on('close', (code) => {
      if (code !== 0 && !succeeded) {
        sendDictationDebug('paste', `inserter exited ${code}`, 'error')
      }
      if (overlayWasVisible) {
        dictationOverlayWindow?.showInactive()
        sendDictationDebug('paste', 'overlay restored')
      }
      try {
        fs.unlinkSync(textPath)
      } catch {}
      resolve(code === 0 && succeeded)
    })
  })
}

// macOS keeps the previously focused application active because both the
// shortcut and the floating overlay are non-focusable. Put the transcription
// on the system clipboard and ask System Events to send Command+V to that app.
// macOS gates this behind Accessibility, which we check before spawning
// osascript so a missing permission produces an actionable failure.
function insertWithMacOSClipboard(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    sendDictationDebug(
      'paste',
      'macOS Accessibility permission is required; enable Vibe Spam in Privacy & Security > Accessibility',
      'error'
    )
    systemPreferences.isTrustedAccessibilityClient(true)
    return Promise.resolve(false)
  }

  const overlayWasVisible =
    currentSettings.globalDictationEnabled &&
    dictationOverlayWindow !== null &&
    !dictationOverlayWindow.isDestroyed() &&
    dictationOverlayWindow.isVisible()
  if (overlayWasVisible) {
    dictationOverlayWindow?.hide()
    sendDictationDebug('paste', 'overlay hidden')
  }

  return new Promise((resolve) => {
    let settled = false
    let stderr = ''
    const finish = (succeeded: boolean) => {
      if (settled) return
      settled = true
      if (overlayWasVisible) {
        dictationOverlayWindow?.showInactive()
        sendDictationDebug('paste', 'overlay restored')
      }
      resolve(succeeded)
    }

    const sendPaste = () => {
      const proc = spawn(
        '/usr/bin/osascript',
        [
          '-e',
          'tell application "System Events" to keystroke "v" using {command down}',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      )
      const timeout = setTimeout(() => {
        try {
          proc.kill()
        } catch {}
        sendDictationDebug('paste', 'macOS paste timed out', 'error')
        finish(false)
      }, 30000)
      sendDictationDebug('paste', 'macOS Command+V attempt')
      proc.stderr?.on('data', (data) => {
        stderr += String(data)
      })
      proc.on('error', (err) => {
        clearTimeout(timeout)
        sendDictationDebug('paste', `osascript failed: ${err.message}`, 'error')
        finish(false)
      })
      proc.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          sendDictationDebug('paste', 'macOS paste keystroke sent')
          finish(true)
          return
        }
        sendDictationDebug(
          'paste',
          (stderr.trim() || `osascript exited ${code}`).slice(0, 300),
          'error'
        )
        finish(false)
      })
    }

    const targetBundleId = globalDictationTargetBundleId
    if (!targetBundleId) {
      setTimeout(sendPaste, 100)
      return
    }

    // LaunchServices brings the previously captured app back without requiring
    // a separate Apple Events authorization for every possible target app.
    const activate = spawn('/usr/bin/open', ['-b', targetBundleId], {
      stdio: 'ignore',
    })
    let activationSettled = false
    const continueAfterActivation = () => {
      if (activationSettled) return
      activationSettled = true
      // LaunchServices can report completion before the target window has
      // restored its native first responder. A short grace period avoids
      // dropping Command+V while macOS is still switching applications.
      setTimeout(sendPaste, 1000)
    }
    const activationTimeout = setTimeout(() => {
      try {
        activate.kill()
      } catch {}
      sendDictationDebug('focus', `activation timed out: ${targetBundleId}`, 'warn')
      continueAfterActivation()
    }, 3000)
    activate.on('error', (err) => {
      clearTimeout(activationTimeout)
      sendDictationDebug('focus', `activation failed: ${err.message}`, 'warn')
      continueAfterActivation()
    })
    activate.on('close', () => {
      clearTimeout(activationTimeout)
      sendDictationDebug('focus', `reactivated ${targetBundleId}`)
      continueAfterActivation()
    })
  })
}

function sendGlobalDictationCommand(command: 'start' | 'stop') {
  if (!currentSettings.globalDictationEnabled || !mainWindow || mainWindow.isDestroyed()) return
  sendDictationDebug('electron', `send ${command}`)
  mainWindow.webContents.send('global-dictation', command)
}

function requestGlobalDictationToggle() {
  sendDictationDebug('electron', `toggle requested while ${globalDictationMode}`)
  if (!currentSettings.globalDictationEnabled) return
  if (globalDictationMode === 'listening') {
    globalDictationMode = 'transcribing'
    updateDictationOverlay({ mode: 'transcribing', level: 0.35 })
    sendGlobalDictationCommand('stop')
    return
  }
  if (globalDictationMode === 'transcribing') return

  // Capture the focused text control in the background (non-blocking) and start
  // recording as soon as we have the capture (or immediately if capture fails).
  // The control is re-located at insert time by its stable RuntimeId, so a
  // slightly later capture does not hurt reliability and avoids freezing the
  // main thread.
  globalDictationMode = 'listening'
  updateDictationOverlay({ mode: 'listening', level: 0.18 })
  if (process.platform === 'darwin') {
    globalDictationCaptureJson = null
    captureMacOSFrontmostApplicationAsync((bundleId) => {
      globalDictationTargetBundleId = bundleId
      globalDictationTargetLabel = bundleId ?? 'focused macOS app'
      sendDictationDebug(
        'focus',
        bundleId ? `captured ${bundleId}` : 'using the current focused macOS field',
        bundleId ? 'info' : 'warn'
      )
      if (globalDictationMode === 'listening') sendGlobalDictationCommand('start')
    })
    return
  }
  globalDictationTargetBundleId = null
  captureFocusedElementAsync((json) => {
    globalDictationCaptureJson = json
    sendDictationDebug(
      'focus',
      json
        ? `captured ${globalDictationTargetLabel ?? 'element'}`
        : 'could not capture focused element',
      json ? 'info' : 'warn'
    )
    // Guard against the user toggling again while capture was in flight.
    if (globalDictationMode === 'listening') {
      sendGlobalDictationCommand('start')
    }
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    show: false,
    backgroundColor: '#0a0c10',
    icon: getAppIcon(),
    // Frameless window with native caption controls overlaid on our topbar.
    // On Windows this draws min/max/close as themed buttons at the top-right;
    // CSS reserves space (--titlebar-reserve) so they don't overlap UI actions.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 52,
      color: '#0a0c10',
      symbolColor: '#8b94a8',
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(webContents === mainWindow?.webContents && permission === 'media')
    }
  )
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return webContents === mainWindow?.webContents && permission === 'media'
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged
      ? url.startsWith('file://')
      : url.startsWith('http://localhost:5173/')
    if (!allowed) event.preventDefault()
  })

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    updateTrayMenu()
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
    }
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideMainWindow()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    updateTrayMenu()
  })
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll()
  try {
    const registered = globalShortcut.register(currentSettings.pushToTalkShortcut, () => {
      if (mainWindow) {
        showMainWindow()
        mainWindow.webContents.send('global-push-to-talk', 'toggle')
      }
    })
    if (!registered) {
      console.error('Failed to register push-to-talk shortcut:', currentSettings.pushToTalkShortcut)
    }
  } catch (err) {
    console.error('Failed to register push-to-talk shortcut:', err)
  }
  if (currentSettings.globalDictationEnabled) {
    try {
      const registered = globalShortcut.register(currentSettings.globalDictationShortcut, () => {
        sendDictationDebug('shortcut', `${currentSettings.globalDictationShortcut} fired`)
        requestGlobalDictationToggle()
      })
      if (!registered) {
        console.error(
          'Failed to register global dictation shortcut:',
          currentSettings.globalDictationShortcut
        )
        sendDictationDebug(
          'shortcut',
          `failed to register ${currentSettings.globalDictationShortcut}`,
          'error'
        )
      } else {
        sendDictationDebug('shortcut', `registered ${currentSettings.globalDictationShortcut}`)
      }
    } catch (err) {
      console.error('Failed to register global dictation shortcut:', err)
    }
  }
  try {
    const registered = globalShortcut.register(currentSettings.showWindowShortcut, () => {
      if (mainWindow) {
        showMainWindow()
        mainWindow.webContents.send('global-show-window')
      }
    })
    if (!registered) {
      console.error('Failed to register show-window shortcut:', currentSettings.showWindowShortcut)
    }
  } catch (err) {
    console.error('Failed to register show-window shortcut:', err)
  }
}

if (gotTheLock) {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    app.setName(APP_NAME)
    currentSettings = loadSettings()
    createTray()
    createSplashWindow()

    try {
      updateSplashStatus('Starting backend...')
      await startBackend()
      updateSplashStatus('Backend ready. Loading UI...')
      createMainWindow()
      createDictationOverlayWindow()
      setDictationOverlayVisible(currentSettings.globalDictationEnabled)
      registerGlobalShortcuts()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to start backend:', err)
      updateSplashStatus(`Backend failed: ${message}`, true)

      dialog.showErrorBox(
        'Vibe Spam - Backend failed',
        `The backend could not start.\n\n${message}\n\nCheck the log at:\n${logPath()}`
      )

      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close()
      }
      app.quit()
    }

    app.on('activate', () => {
      showMainWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    shutdownBackend()
  })

  app.on('window-all-closed', () => {
    if (isQuitting || process.platform === 'darwin') return
  })

  ipcMain.handle('get-backend-url', (event) => {
    requireSender(event, mainWindow)
    return backendUrl()
  })
  ipcMain.handle('get-backend-connection', (event) => {
    requireSender(event, mainWindow)
    return {
      baseUrl: backendUrl(),
      apiToken: backendToken,
    }
  })

  ipcMain.handle('get-settings', (event) => {
    requireSender(event, mainWindow)
    return currentSettings
  })

  ipcMain.handle('get-platform-capabilities', (event) => {
    requireSender(event, mainWindow)
    return {
      platform: process.platform,
      globalPasteSupported: process.platform === 'win32' || process.platform === 'darwin',
      microphonePermission:
        process.platform === 'darwin'
          ? systemPreferences.getMediaAccessStatus('microphone')
          : 'not-applicable',
      accessibilityPermission:
        process.platform === 'darwin'
          ? systemPreferences.isTrustedAccessibilityClient(false)
            ? 'granted'
            : 'denied'
          : 'not-applicable',
    }
  })

  ipcMain.handle('request-macos-accessibility', (event) => {
    requireSender(event, mainWindow)
    if (process.platform !== 'darwin') return true
    return systemPreferences.isTrustedAccessibilityClient(true)
  })

  ipcMain.handle('save-settings', (_event, settings: AppSettings) => {
    requireSender(_event, mainWindow)
    const previous = currentSettings
    const normalized = normalizeSettings(settings)
    saveSettings(normalized)
    if (
      process.platform === 'darwin' &&
      normalized.globalDictationEnabled &&
      !previous.globalDictationEnabled
    ) {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true)
      sendDictationDebug(
        'permission',
        trusted
          ? 'macOS Accessibility permission granted'
          : 'macOS Accessibility permission requested',
        trusted ? 'info' : 'warn'
      )
    }
    if (
      previous.pushToTalkShortcut !== normalized.pushToTalkShortcut ||
      previous.globalDictationShortcut !== normalized.globalDictationShortcut ||
      previous.globalDictationEnabled !== normalized.globalDictationEnabled ||
      previous.showWindowShortcut !== normalized.showWindowShortcut
    ) {
      registerGlobalShortcuts()
    }
    setDictationOverlayVisible(currentSettings.globalDictationEnabled)
    updateDictationOverlay({ mode: 'idle', level: 0.12 })
    updateTrayMenu()
    mainWindow?.webContents.send('settings-changed', currentSettings)
    return currentSettings
  })

  ipcMain.handle('begin-shortcut-capture', (event) => {
    requireSender(event, mainWindow)
    globalShortcut.unregisterAll()
  })

  ipcMain.handle('end-shortcut-capture', (event) => {
    requireSender(event, mainWindow)
    registerGlobalShortcuts()
  })

  ipcMain.handle('select-folder', async (event) => {
    requireSender(event, mainWindow)
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('select-executable', async (event) => {
    requireSender(event, mainWindow)
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: process.platform === 'win32'
        ? [{ name: 'Executables', extensions: ['exe', 'cmd', 'bat', 'com'] }, { name: 'All files', extensions: ['*'] }]
        : [{ name: 'All files', extensions: ['*'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('push-to-talk-stop', (event) => {
    requireSender(event, mainWindow)
    mainWindow?.webContents.send('global-push-to-talk', 'stop')
  })

  ipcMain.handle('request-global-dictation-toggle', (event) => {
    requireSender(event, mainWindow, dictationOverlayWindow)
    requestGlobalDictationToggle()
  })

  ipcMain.on('dictation-overlay-drag-start', (event) => {
    requireSender(event, dictationOverlayWindow)
    startDictationOverlayDrag()
  })

  ipcMain.on('dictation-overlay-drag-move', (event) => {
    requireSender(event, dictationOverlayWindow)
    moveDictationOverlayDrag()
  })

  ipcMain.on('dictation-overlay-drag-end', (event) => {
    requireSender(event, dictationOverlayWindow)
    endDictationOverlayDrag()
  })

  ipcMain.handle(
    'update-dictation-overlay',
    (_event, state: { mode: string; level?: number; text?: string }) => {
      requireSender(_event, mainWindow)
      updateDictationOverlay(state)
    }
  )

  ipcMain.handle('insert-global-dictation-text', async (_event, text: string) => {
    requireSender(_event, mainWindow)
    if (!text.trim()) return false
    // The helper's primary strategy is Ctrl+V, so the clipboard must hold the
    // text. Write it here, then let the helper handle focus + paste + verify.
    clipboard.writeText(text)
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (process.platform === 'win32') return insertWithHelper(text)
    if (process.platform === 'darwin') return insertWithMacOSClipboard()
    sendDictationDebug('paste', 'global paste is not supported on this platform', 'error')
    return false
  })
}
