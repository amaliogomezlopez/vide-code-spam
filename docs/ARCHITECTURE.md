# Arquitectura de Vibe Spam

## Objetivo

Centralizar múltiples agentes de coding CLI en una interfaz única, permitiendo abrir terminales bajo demanda y enviarles instrucciones por voz de forma rápida.

## Componentes

### 1. Frontend

- **Tecnología**: React + TypeScript + Vite.
- **Empaquetado**: Electron para ejecutable de escritorio.
- **Responsabilidades**:
  - Modal `AddAgentModal`: elegir CLI y número de terminales a abrir.
  - Grilla `AgentGrid` + `AgentTerminal`: renderiza cada PTY con `xterm.js`.
  - `VoiceButton`: captura PCM16 mono a 16 kHz, lo envía por WebSocket y reenvía el texto limpio al agente seleccionado.
  - `env.ts`: detecta si corre dentro de Electron y obtiene la URL del backend.

### 2. Backend (FastAPI)

- **Rutas HTTP**:
  - `GET /health`
  - `GET /api/agents` — lista agentes
  - `POST /api/agents` — crea agente dinámicamente
  - `DELETE /api/agents/{id}` — borra agente
  - `POST /api/agents/{id}/send`
  - `POST /api/audio/provider/{provider}` y `/audio/cleaner/{provider}`
- **WebSocket `/ws/audio`**: recibe chunks de audio, devuelve transcripción cruda y limpia.
- **WebSocket `/ws/terminal/{agent_id}`**: puente bidireccional PTY ↔ frontend.

### 3. Agent Manager

- Diccionario dinámico de `AgentProcess`.
- Cada agente abre un proceso PTY real usando `pty_backend.py`:
  - Windows: `winpty.PtyProcess.spawn()`
  - Unix: `pexpect.spawn()`
- Métodos: `create_agent`, `remove_agent`, `start_agent`, `stop_agent`, `send_to_agent`.

### 4. Audio Processor

- Recibe PCM16 en streaming o formatos comprimidos compatibles.
- Envuelve PCM como WAV sin ffmpeg; normaliza formatos comprimidos con `pydub`.
- Acumula chunks hasta recibir `stop_recording`.

### 5. STT Engine (intercambiable)

- Interfaz común `transcribe(audio_bytes) -> str`.
- `FasterWhisperEngine`: usa `faster-whisper` offline.
- `OpenWhisprEngine`: HTTP a un servidor OpenWhispr.
- Selección mediante `RuntimeState.stt_provider` (modificable en caliente).

### 6. LLM Cleaner (intercambiable)

- Interfaz async `clean(text) -> str`.
- Corrige puntuación, mayúsculas y formato.
- Motores: OllamaEngine (local), GroqEngine (cheap/fast), o `none`.

### 7. Electron shell

- `frontend/electron/main.ts`:
  - En dev: lanza `uvicorn backend.app.main:app` como proceso hijo y carga `localhost:5173`.
  - En producción: lanza el backend empaquetado con PyInstaller desde `resources/backend/` y carga `index.html` estático.
- `frontend/electron/preload.cjs`: expone una API aislada y la conexión local autenticada.
- `frontend/electron/overlay-preload.cjs`: mantiene el overlay sin `nodeIntegration`.
- Electron genera un token efímero por arranque para HTTP y WebSockets.

## Flujo de datos

```
Usuario abre terminal → POST /api/agents → AgentManager crea PTY
Usuario habla → Web Audio PCM16 → WS /ws/audio
                              → AudioProcessor → STT → LLM Cleaner
                              → respuesta {raw, cleaned}
Frontend → POST /api/agents/{id}/send → PTY del agente
PTY stdout/stderr → WS /ws/terminal/{id} → xterm.js
```

## Decisiones técnicas

1. **Agentes dinámicos**: en lugar de una lista fija, el usuario crea terminales bajo demanda. Esto requiere PTYs robustos y un manager sin estado global inmutable.
2. **WebSocket para audio**: menor latencia que HTTP polling.
3. **STT offline por defecto**: `faster-whisper` evita depender de APIs externas.
4. **Cleaner separado**: permite comparar fácilmente Ollama vs Groq vs ninguno.
5. **Electron**: elección pragmática para ejecutable de escritorio sin depender de Rust (no está en todos los entornos).
6. **PyInstaller para backend**: empaqueta Python + dependencias en un solo `.exe` fácil de distribuir con Electron.
7. **Backend local autenticado**: loopback por defecto; Electron usa un token efímero y Docker aísla el backend detrás de Nginx.
8. **Builds CPU/CUDA separados**: CPU es el artefacto público por defecto y CUDA es opt-in para evitar ~1,9 GiB de DLLs innecesarias.

## Escalabilidad futura

- Añadir VAD para detener grabación automáticamente.
- Hotkeys globales con Electron `globalShortcut`.
- Métricas automáticas de latencia y WER.
- Soporte para MCP servers y más CLIs.

## Registro de CLIs y workspaces

`core/cli_registry.py` es la fuente de verdad para adaptadores de CLI. Mantiene
separados el ejecutable/ruta, el runtime (`native` o `wsl`) y la clase de
herramienta (`coding-agent`, `general-assistant` o `custom`). Los perfiles del
usuario son datos de configuración; no contienen secretos ni comandos de
instalación.

`core/git_worktrees.py` encapsula todas las llamadas a Git sin shell, valida
refs, obtiene estado con caché y rechaza la eliminación de worktrees sucios.
`POST /api/workspaces/launch` coordina worktrees y procesos como una sola
transacción compensable: cualquier fallo elimina agentes y worktrees creados
durante esa petición.

```text
CLI manager → GET /api/clis → CliRegistry → PATH/common paths/WSL
Parallel workspace → POST /api/workspaces/launch
  ├─ WorktreeService.create (opcional por worker)
  ├─ CliRegistry.resolve
  └─ AgentManager.create_agent
       └─ fallo → remove_agent + WorktreeService.rollback
```
