# Changelog

Todos los cambios notables de **Vibe Spam** se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/),
y este proyecto intenta seguir [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido — 2026-07-18 — Dictado y empaquetado funcionales en macOS

- El dictado global en macOS escribe la transcripción en el portapapeles y
  envía `Command+V` a la aplicación enfocada mediante System Events, con
  comprobación y solicitud del permiso de Accesibilidad. Captura además el
  bundle de la app frontal y la reactiva con LaunchServices antes de pegar para
  conservar el destino durante transcripciones lentas o diálogos de permisos;
  espera a que macOS restaure el receptor nativo del teclado antes de `⌘V`.
- El DMG declara el uso de Micrófono y Apple Events, y deja de intentar incluir
  el `inserter.exe` exclusivo de Windows. La UI muestra el estado de permisos.
- Electron usa el Python del virtualenv en desarrollo; `setup.sh` exige 3.11 o
  3.12 y admite `VIBE_SPAM_PYTHON`. La detección de CLIs contempla rutas de
  Homebrew, npm, Bun, pnpm y NVM cuando Finder proporciona un `PATH` mínimo.
- El entrypoint empaquetado activa `multiprocessing.freeze_support()` para que
  los helpers internos de Whisper no vuelvan a entrar en `argparse` ni fallen
  con los argumentos privados de `resource_tracker` en macOS.
- El build local usa firma ad-hoc explícita cuando no recibe credenciales
  `CSC_LINK`/`CSC_NAME`, evitando que un certificado de desarrollo descubierto
  por casualidad deje una firma inválida. Las releases pueden seguir usando
  Developer ID y notarización.

### Arreglado — 2026-07-13 11:55 — Tipado Linux en CI público

- Corregidos cuatro errores de mypy en Ubuntu al resolver explícitamente APIs
  exclusivas de Windows (`os.add_dll_directory`, `ctypes.windll` y
  `ctypes.WinDLL`). Causa raíz: el runtime ya comprobaba la plataforma, pero los
  stubs Linux eliminan esos atributos y mypy no estrecha tipos usando
  `platform.system()`. Verificado con mypy estricto dirigido a `linux` y
  `win32`, además de Python 3.11 y 3.12.
- Desactivado `fail-fast` en la matriz backend para que un fallo futuro no
  cancele los otros sistemas/versiones y deje un diagnóstico incompleto.

### Cambiado — 2026-07-13 11:35 — Repositorio público definitivo

- Actualizados el metadata npm, homepage y enlace de Releases para apuntar a
  `amaliogomezlopez/vide-code-spam`, evitando que usuarios y herramientas de
  empaquetado terminen en el mirror privado anterior.
- El exportador omite `AGENTS.md` porque contiene instrucciones operativas del
  checkout privado; las reglas públicas para colaboradores permanecen en
  `CONTRIBUTING.md`. El snapshot sigue incluyendo únicamente fuentes
  rastreadas, sin historial privado ni artefactos locales.

### Arreglado — 2026-07-13 11:16 — CI privado y scripts Linux

- CodeQL se omite únicamente en el mirror privado, donde GitHub Advanced
  Security no está disponible, y se activa automáticamente cuando el snapshot
  se publique como repositorio público. Causa raíz: ambos análisis fallaban por
  disponibilidad del servicio, no por hallazgos en Python o TypeScript.
- `setup.sh` usa directamente el intérprete y `pip` del virtualenv en lugar de
  cargar un `activate` generado. Esto elimina el falso positivo `SC1091` de
  ShellCheck y evita depender del estado del shell; también se corrigió el
  contador de progreso `[2/3]` a `[2/4]`.

### Añadido — 2026-07-12 19:05 — Preparación de comunidad pública

- Documentadas las descargas CPU universal y CUDA/NVIDIA acelerada, incluyendo
  nombres de artefacto, diferencia de tamaño y el motivo por el que un build
  CPU no puede activar CUDA después de instalarse.
- Añadidas políticas de seguridad, contribución y conducta ampliadas,
  plantillas de issues/PR, limitaciones conocidas y una guía para publicar un
  snapshot sin historial privado. Motivo: hacer explícitos permisos de
  micrófono, SmartScreen, descarga inicial del modelo y dependencia de CLIs de
  terceros antes de aceptar usuarios y colaboradores.
- Añadidos Dependabot y CodeQL para npm, Python, Actions, JavaScript/TypeScript
  y Python. La guía detalla la protección de `main`, secret scanning y private
  vulnerability reporting que deben activarse en GitHub al crear el nuevo repo,
  con un script `gh` para aplicar la parte repetible de la configuración.
- Añadido un exportador que usa únicamente archivos rastreados por `HEAD`,
  rechaza destinos dentro del checkout y archivos con nombres típicos de
  secretos, e inicia un historial público nuevo. La limpieza del ZIP reintenta
  bloqueos transitorios de Windows; causa raíz encontrada en la primera prueba:
  `Remove-Item` podía quedar bloqueado por políticas del entorno aunque el ZIP
  ya estuviera cerrado, por lo que se usa borrado directo y reintentos.
  Verificado sobre un directorio temporal externo al repositorio.
- Declarada formalmente la publicación inicial sin Authenticode: se conservan
  SHA-256 y advertencias de SmartScreen, sin presentarla como binario firmado.

### Mejorado — 2026-07-12 18:17 — Preparación y precisión del dictado

- Añadido `GET /api/audio/status` con estado, modelo, dispositivo, compute type,
  beam y duración de warmup. El frontend bloquea botón y atajos hasta que STT
  está realmente listo, evitando que la primera grabación compita con la carga
  del modelo. Causa raíz observada: 0,28 s de audio tardaron 9,53 s al entrar
  durante el warmup CPU.
- Ampliado el auto-stop por silencio de 750 a 1200 ms para no cortar frases en
  pausas naturales. La captura solicita mono, cancelación de eco, reducción de
  ruido y control automático de ganancia para mejorar consistencia del audio.
- Separados los portables y releases `CPU`/`CUDA` en los scripts de Windows para
  evitar sobreescrituras. En RTX 4070, el warmup inferencial CUDA tarda 0,38 s
  frente a 10,65 s CPU; el backend CUDA ocupa 2188,54 MiB, por lo que sigue
  siendo un artefacto opcional y CPU continúa como descarga universal.
- El perfil CUDA lleva una marca interna y selecciona GPU automáticamente solo
  cuando incluye y puede cargar cuBLAS/cuDNN; un `WHISPER_DEVICE=cpu` explícito
  conserva prioridad. Verificado fuera del repositorio: `cuda/float16` sin
  depender de `.env`; el perfil CPU reporta `cpu/int8`.
- Extraída la compilación de `inserter.exe` a un paso común obligatorio para
  que el instalador funcione desde un checkout limpio. NSIS y portable usan
  nombres distintos (`Setup-CPU`/`Portable-CPU`): causa raíz del fallo previo,
  ambos targets compartían `artifactName` y podían sobrescribirse.

### Arreglado — 2026-07-12 13:52 — Dictado CPU tras build reducido

- Corregido el dictado del portable CPU cuando el entorno o `.env` solicitaba
  CUDA sin incluir las DLL `cublas64_12.dll`/cuDNN. Causa raíz: el engine
  reinterpretaba `cpu/int8` por defecto como permiso para autoactivar GPU y el
  warmup con silencio no ejecutaba el encoder porque VAD descartaba todo el
  audio. La carga aparentaba funcionar y fallaba solo al dictar voz real.
- CPU/int8 es ahora un contrato estricto; `WHISPER_DEVICE=auto` selecciona GPU
  únicamente si el runtime está completo. Una petición explícita de CUDA con
  DLLs incompletas degrada a CPU, y un error CUDA tardío durante inferencia
  recarga el modelo en CPU sin perder la transcripción.
- El warmup usa señal no silenciosa sin VAD para ejecutar realmente el encoder.
  Verificado conservando el `.env` local `cuda/float16`: fallback efectivo a
  `cpu/int8`, carga del modelo e inferencia de warmup correctas sin cuBLAS.

### Añadido — 2026-07-12 11:30 — CLIs detectables y workspaces paralelos

- Añadido un registro extensible para Codex, Claude Code, Kimi Code, Grok
  Build, OpenCode, Aider, MiniMax Mini-Agent y MMX. Detecta ejecutables en
  `PATH`, ubicaciones comunes de npm/uv/Cargo/Scoop/WinGet y WSL, obtiene su
  versión en paralelo y distingue agentes de coding de asistentes generales.
  Motivo: evitar presets rígidos y errores poco claros después de instalar un
  CLI.
- Añadidos perfiles personalizados persistentes con selector de ejecutable,
  argumentos predeterminados, validación de ruta y diagnóstico. Nunca se
  ejecutan instaladores ni se almacenan claves API; la autenticación sigue
  perteneciendo a cada CLI.
- Añadido `Parallel workspace`: permite combinar hasta nueve CLIs y carpetas,
  crear ramas/worktrees aislados para agentes escritores y lanzar el conjunto
  como una transacción. Si falla Git, la resolución del CLI o un PTY, detiene
  los procesos creados y revierte los worktrees. Causa raíz del riesgo previo:
  varias terminales compartían checkout e índice Git y la apertura múltiple
  podía quedar parcialmente aplicada.
- Añadido estado Git por terminal (rama, cambios, ahead/behind y worktree) y
  limpieza segura: un worktree con cambios sin commit nunca se elimina y la
  rama se conserva por defecto. Verificado con repositorios Git reales y
  regresiones de rollback, ramas maliciosas y worktrees sucios.
- Añadido selector de archivo Electron aislado mediante IPC y nueva UI para
  escaneo, rutas personalizadas y workers. Verificado con mypy estricto,
  pytest, ESLint, TypeScript y build Vite.
- Corregido el parsing de argumentos Windows con `CommandLineToArgvW`. Causa
  raíz: `shlex(posix=False)` conservaba las comillas como parte del argumento y
  rompía worktrees o ejecutables cuyas rutas contenían espacios. Verificado con
  regresiones Windows/Unix, 31 tests backend y smoke test del backend
  PyInstaller incluido en el portable.

### Arreglado — 2026-07-10 12:45 — Seguridad local, lifecycle y red

- Protegidas todas las rutas HTTP y WebSocket capaces de controlar procesos con
  un token efímero generado por Electron. El backend queda en loopback por
  defecto, rechaza binds externos sin token/proxy confiable y no acepta el
  origen `null` sin autenticación. Causa raíz: CORS no protegía WebSockets ni
  clientes no navegador y la API permitía lanzar comandos sin autenticación.
  Verificado con regresiones HTTP, rechazo `403`, WebSocket sin token rechazado
  y PTY autenticado devolviendo salida real.
- Corregido el lifecycle de agentes: rollback de autostart fallido, estado de
  procesos muertos, cierre global en lifespan, prevención de reinicio tras
  borrado, carrera borrar-durante-start y lector terminal único. Causa raíz: el
  manager conservaba referencias y estados sin sincronización suficiente.
- WinPTY usa ahora el socket real con timeout e incremental UTF-8, evitando
  hilos bloqueados sin perder salida. Causa raíz: la lectura no bloqueante del
  objeto PTY no consumía el transporte usado por `PtyProcess`. Verificado con
  test unitario, `cmd.exe` directo y terminal WebSocket empaquetada.
- El cambio de proveedor STT reemplaza el engine cacheado y se resuelve en cada
  transcripción; una configuración CPU explícita ya no se convierte a CUDA.
  Causa raíz: el WebSocket retenía el singleton creado al conectarse y no se
  distinguían defaults de campos configurados.
- Corregidos reintentos de mutaciones, timeouts HTTP, URLs WebSocket relativas,
  timers de reconexión huérfanos y reanudación de PCM tras reconectar. El token
  WebSocket viaja como subprotocolo negociado y no aparece en logs/URLs.
- El dictado global espera la confirmación real de `inserter.exe` y muestra
  fallo en plataformas sin helper. La captura UIAutomation ejecuta su callback
  una sola vez aunque coincidan timeout y cierre.

### Cambiado — 2026-07-10 12:45 — Builds pequeños y reproducibles

- Separado el build CPU predeterminado del perfil CUDA opcional. PyInstaller ya
  no recopila NVIDIA, tests, pytest ni herramientas ONNX innecesarias; conserva
  los binarios WinPTY requeridos. El backend bajó de 2.189,76 MiB a 251,50 MiB
  y el portable completo de 2.465,45 MiB a 609,85 MiB; instalador y portable
  comprimido quedan en ~170 MiB.
- Actualizados Electron 33→43, electron-builder 25→26, Vite 5→8 y xterm a los
  paquetes `@xterm/*`. `npm audit` pasó de 12 vulnerabilidades a cero.
- Reparados Docker (`backend.app`), aislamiento del puerto backend, `npm ci`,
  metadatos de paquete y code splitting del terminal.
- Los scripts PowerShell validan códigos de salida nativos. NSIS usa un TEMP
  dedicado y el release público falla si Authenticode no es válido, salvo
  `-AllowUnsigned` explícito para pruebas. Verificado generando ambos `.exe`.

### Añadido — 2026-07-10 12:45 — Calidad y preparación open source

- Añadidos licencia MIT, `CONTRIBUTING.md`, `SECURITY.md`, código de conducta,
  configuración ESLint/Prettier, packaging Python instalable y CI para Windows,
  Linux, Python 3.11/3.12, frontend, tests, audit, shellcheck y Compose.
- Añadidas regresiones de seguridad, agentes, WinPTY, STT, audio y red. Gates
  locales: 17 tests Python, 3 tests Vitest, Ruff, mypy estricto, ESLint, builds
  TypeScript/Electron y `npm audit`, todos correctos. Docker Compose validó su
  configuración; la construcción de imágenes no se ejecutó porque Docker
  Desktop no estaba iniciado en la máquina de auditoría.

### Añadido — 2026-07-08 09:56 — Ayuda de PATH al abrir terminales

- Añadido un icono de información en el modal `Open terminal` junto a
  `Choose a CLI`. Motivo: explicar que Vibe Spam lanza `codex`, `kimi`,
  `opencode`, etc. desde el `PATH` del sistema y que el usuario debe instalar
  la CLI antes de seleccionarla.
- La ayuda indica cómo validar el comando con `--version` y que `Custom` permite
  usar una ruta completa o comando alternativo. Verificado con `npm run build`.

### Arreglado — 2026-07-08 09:48 — Reintentos al mover el backend PyInstaller

- `scripts/build-backend-exe.ps1` ahora reintenta mover
  `frontend/backend-dist-build/vibe-spam-backend` a `frontend/backend-dist`.
  Causa raíz: en Windows, justo después de terminar PyInstaller, algún archivo
  generado puede quedar bloqueado brevemente por el sistema/antivirus/indexador,
  haciendo fallar `Move-Item` aunque el build haya terminado bien. Verificado
  reconstruyendo backend, generando el portable Electron y arrancando
  `VibeSpam-Portable/Vibe Spam.exe`; `/api/health` respondió `status: ok`.
- Añadido `frontend/backend-dist-build/` a `.gitignore` para que los restos de
  builds interrumpidos no aparezcan como archivos nuevos del repositorio.

### Cambiado — 2026-07-08 09:34 — Limpieza de release multiplataforma

- Eliminados los `.spec` generados por PyInstaller de la raíz y de `backend/`.
  Motivo: los scripts de build son la fuente de verdad y esos specs estaban
  desactualizados, por lo que podían confundir a quien compilara una release.
- Corregida la regla de `.gitignore` `models/` a `/models/` y añadido el paquete
  real `backend/app/models` al repositorio. Causa raíz: la regla anterior
  ignoraba cualquier carpeta llamada `models`, incluyendo esquemas Pydantic
  usados por la API.
- Los scripts Unix `build-backend-exe.sh` e `install-models.sh` ahora siguen el
  mismo flujo que Windows: empaquetado `--onedir` con colecciones necesarias y
  descarga/precalentamiento mediante `backend.app.tools.install_models`. Motivo:
  dejar Mac/Linux en un estado más coherente aunque sigan siendo experimentales.
- Añadida una matriz de soporte por plataforma en `README.md`. Se documenta que
  Windows es el target principal, mientras que macOS/Linux necesitan helpers
  nativos adicionales para dictado global externo. Verificado con compilación
  Python, tests backend y build frontend.

### Añadido — 2026-07-08 09:14 — Flujo de release público con instalador y modelos

- Añadido `backend.app.tools.install_models` y el flag
  `vibe-spam-backend.exe --install-models` para descargar y precalentar el
  modelo local `faster-whisper` configurado. Motivo: permitir que usuarios de
  releases preparen `large-v3-turbo` sin tocar Python ni ejecutar comandos
  internos complejos.
- Añadidos `scripts/install-models.ps1` y `scripts/build-windows-installer.ps1`.
  El primero prepara el modelo desde el checkout; el segundo genera artefactos
  Windows publicables con instalador NSIS y portable. Motivo: separar el flujo
  de desarrollo del flujo de distribución pública.
- El target Windows de `electron-builder` ahora incluye `portable` y `nsis`, con
  instalador por usuario, selector de carpeta y accesos directos. Los pesos del
  modelo no se commitean ni se empaquetan por defecto; se descargan en la caché
  local del usuario al primer arranque o con `--install-models`.
- Arreglado `scripts/setup.ps1`, que intentaba usar sintaxis heredoc de bash
  dentro de PowerShell. Causa raíz: la descarga del modelo estaba embebida con
  `python - <<'PY'`, inválido en PowerShell. Verificado con compilación Python
  del backend y build TypeScript/frontend.
- Quitado un handler duplicado de `shutdown` en FastAPI. Motivo: limpiar ruido
  antes de publicar el repositorio para terceros.

### Añadido — 2026-07-07 09:23 — Icono de dictado global arrastrable

- El icono flotante del dictado global ahora se puede mover pinchándolo y
  arrastrándolo, y la posición queda guardada en `settings.json`. Motivo:
  evitar que el botón quede fijo abajo a la derecha cuando tapa contenido o no
  encaja con el flujo de trabajo del usuario. Verificado con build TypeScript y
  recompilación del portable.

### Añadido — 2026-07-05 13:45 — Bandeja del sistema e icono propio

- Añadido icono propio `VS` para el ejecutable, las ventanas y la bandeja del
  sistema, de modo que Vibe Spam deje de aparecer como una app genérica de
  Electron en Windows.
- La ventana principal ahora se oculta al cerrar con la X y la app sigue viva en
  segundo plano con el backend activo. Motivo: permitir dictado global y
  terminales residentes como una app profesional de bandeja. La bandeja permite
  mostrar/ocultar la ventana y usar `Salir completamente`, que apaga también el
  backend. Causa raíz: el flujo anterior trataba `window-all-closed` como cierre
  total y mataba el backend aunque el usuario solo quisiera esconder la UI.
- El build del backend PyInstaller ahora usa `--onedir` con `--clean
  --noconfirm` manteniendo la ruta final `resources/backend/vibe-spam-backend.exe`.
  Motivo: evitar los fallos del autoextractor `--onefile` con DLLs grandes como
  `cublasLt64_12.dll` o `swscale`. Verificado reconstruyendo backend y portable
  desde cero.

### Arreglado — 2026-07-05 13:31 — Evitar bloqueo UIAutomation antes de pegar

- El dictado transcribía rápido y dejaba el texto en el portapapeles, pero
  `inserter.exe` se quedaba colgado tras `foreground already set` tanto en Codex
  como en Chrome. Causa raíz: el helper intentaba resolver/enfocar el elemento
  UIAutomation capturado antes de enviar `Ctrl+V`; en Chromium esos nodos pueden
  ser contenedores `Group` o `Edit` que bloquean o no representan el caret real.
  Ahora, si la ventana capturada ya está en foreground, se pega primero al foco
  actual con `Ctrl+V` y solo se usa UIAutomation como fallback si ese envío falla.
  Esto coincide con el comportamiento manual que sí funcionaba.

### Arreglado — 2026-07-05 13:21 — Timeout de arranque del backend portable

- Electron podía mostrar error de backend tras agotar los reintentos aunque el
  backend empaquetado hubiese quedado vivo escuchando en un puerto alternativo
  como `8766`. Causa raíz: la limpieza de backends huérfanos solo se aplicaba si
  el proceso ocupaba `8765`; si una ejecución previa fallaba tras elegir `8766`,
  el siguiente arranque podía dejar otro estado inconsistente. Ahora se detecta
  un backend Vibe Spam huérfano en cualquier puerto del rango `8765-8804`, se
  limpia antes de elegir puerto, y si el health-check agota reintentos se mata el
  proceso recién lanzado para no dejar restos. También se loguea el puerto exacto
  elegido durante el startup.

### Arreglado — 2026-07-05 13:11 — Inserción global en Codex tras dictado rápido

- El texto transcrito quedaba en el portapapeles pero no se pegaba en Codex,
  aunque `Ctrl+V` manual sí funcionaba. Causa raíz: UIAutomation capturaba el
  destino como `Codex / Group` sin `ValuePattern`; el helper intentaba hacer
  `SetFocus()` sobre ese contenedor y se quedaba antes de enviar `Ctrl+V` al
  textarea real. Ahora, si la ventana capturada ya está en foreground y el
  target no expone valor verificable, el helper pega directamente al foco actual
  con `Ctrl+V` y reporta `ctrl+v-foreground`. Verificado recompilando el helper
  dentro del portable.

### Cambiado — 2026-07-05 12:51 — Pipeline PCM para dictado de baja latencia

- El dictado ya no espera a generar un Blob WebM final antes de enviar audio al
  backend. El frontend captura audio con Web Audio, lo convierte a PCM16 mono a
  16 kHz y envía chunks de ~250 ms por WebSocket mientras el usuario habla. El
  backend acepta `start_recording` con `format=pcm_s16le`, acumula los chunks y
  los envuelve como WAV sin pasar por `pydub`/ffmpeg. Motivo: reducir trabajo
  post-stop y preparar el camino para streaming real.
- El auto-stop global baja de 1,2 s a 750 ms de silencio tras un mínimo de 650 ms
  de grabación. Causa raíz de la sensación lenta: después de hablar, la app
  seguía grabando silencio y recién al parar codificaba/enviaba el Blob completo.
- Añadida telemetría de latencia en el panel de debug: tiempo hasta micro listo,
  primer chunk PCM, duración de captura, latencia post-stop y tiempos backend
  (`decode_s`, `stt_s`, `format_s`). Verificado con `python -m compileall
  backend\app`, `python -m pytest backend\tests` y `npm run build`.

### Añadido — 2026-07-05 12:22 — Benchmark aislado de motores ASR

- Añadidos `scripts/stt_benchmark.py` y `scripts/prepare_fleurs_manifest.py`
  para comparar motores speech-to-text sin tocar el flujo principal de dictado.
  Permiten preparar muestras FLEURS en español y ejecutar los mismos audios
  contra `faster-whisper` y el modelo experimental
  `nvidia/nemotron-3.5-asr-streaming-0.6b`, midiendo carga en frío, latencia de
  inferencia, RTF, WER/CER cuando hay texto de referencia, GPU detectada y VRAM
  pico si `torch` está disponible. Motivo: separar la decisión de integrar
  Nemotron de las sensaciones subjetivas y comprobar con audios reales en
  español si gana en velocidad/calidad antes de añadir un nuevo `STT_PROVIDER` o
  sidecar local. `benchmark-results/` queda ignorado para evitar commitear
  entornos virtuales, audios, gráficas o pesos descargados.

### Cambiado — 2026-07-03 22:01 — Optimización de latencia del dictado (Nivel A)

El dictado global tardaba varios segundos desde que se soltaba el atajo hasta
que el texto aparecía en la caja de texto (más lento que Win+H), lo que lo hacía
poco usable en la práctica. Esta pasada aplica "quick wins" que reducen la
latencia total de ~5 s a ~1 s, sin cambiar la arquitectura (el streaming real
queda para una fase posterior). Se mantiene el modelo `large-v3-turbo`.

Cambios concretos y porqué:

- **Diagnóstico CUDA (`faster_whisper_engine.py`)**: el `.env` pedía `device=cuda`
  / `compute_type=float16`, pero no había telemetría que confirmara que
  ctranslate2 estaba usando la GPU de verdad. Ahora se loguea
  `ctranslate2.get_cuda_device_count()` antes de cargar y se calcula el **RTF**
  (duración_audio / tiempo_transcripción) en cada transcripción. Con CUDA +
  large-v3-turbo el RTF esperado es <0,1; ~1 o más indica que está en CPU (causa
  raíz de la latencia). Esto permite distinguir "CUDA no funciona" de "falta
  afinar parámetros".
- **VAD en el backend (`faster_whisper_engine.py`)**: añadido `vad_filter=True`
  con `min_silence_duration_ms=500`, `speech_pad_ms=200`. El VAD (Silero) recorta
  los silencios antes de transcribir → menos audio que procesar y mejor
  precisión. (Antes el único "VAD" era el umbral frontal de auto-stop, que solo
  cortaba la grabación pero no limpiaba el silencio ya grabado.)
- **`beam_size` 5 → 1 (`.env`)**: greedy en vez de beam search. ~3-5× más rápido,
  sin pérdida notable en dicciones cortas en español.
- **`language` `auto` → `es` (`.env`)**: elimina la detección automática de
  idioma de los primeros 30 s (latencia extra). Dejar `auto` si se dicta en
  varios idiomas.
- **Precarga del modelo en `startup` (`main.py`)**: el modelo Whisper se cargaba
  de forma perezosa en la **primera** transcripción (varios segundos + init de
  CUDA/cuDNN). Ahora se precarga en background al arrancar el backend, con un
  executor para no bloquear el startup. La primera dictación real ya no paga la
  carga del modelo.
- **Singleton de transcriber (`transcriber.py`)**: `get_transcriber()` creaba una
  instancia nueva de `FasterWhisperEngine` por cada conexión `/ws/audio`. Aunque
  el modelo se cacheaba en la instancia, si la WS se cerraba y reabrria entre
  dictaciones se perdía la referencia y se recargaba. Ahora es singleton y todas
  las conexiones comparten el mismo modelo cargado.
- **Eliminado `transcription_partial` redundante (`websocket.py`)**: con
  `cleaner=none` (config actual) el mensaje "partial" enviaba exactamente el
  mismo texto que el `transcription` siguiente, sumando un viaje WS sin valor.
- **Auto-stop de silencio 3 s → 1,2 s (`VoiceButton.tsx`)**: en modo global se
  grababan hasta ~3 s de audio "muerto" tras dejar de hablar, que luego se
  transcribía igual. Reducido a 1,2 s (el mínimo de 1,2 s tras inicio se
  mantiene para evitar cortes accidentales).
- **`captureFocusedElement` sincrónico → asíncrono (`main.ts`)**: la captura del
  control enfocado usaba `spawnSync`, que bloqueaba el main thread de Electron
  (UI/overlay congelados) decenas–cientos de ms cada vez que se pulsaba
  Ctrl+Shift+D. Ahora usa `spawn` con callback: la grabación arranca en cuanto
  se tiene la captura (o al fallar), sin congelar la UI. La fiabilidad no cambia:
  el helper re-localiza el control por `RuntimeId` estable en el momento del
  insert.

Cómo verificar: dictar y mirar los logs del backend. Debe aparecer
`device=cuda cuda_devices=1` y `RTF<0,100`. Si `cuda_devices=0` o RTF≈1, CUDA no
está funcionando y el siguiente paso es arreglar las DLLs CUDA del bundle (tarea
apartada para la siguiente iteración).

### Cambiado — 2026-07-03 21:34

- **AGENTS.md**: añadida sección "Git y registro de cambios (OBLIGATORIO)" con la
  regla de que, al terminar cualquier cambio, el agente DEBE: (1) verificar que
  no entren secretos/artifacts en el commit, (2) actualizar `CHANGELOG.md` con
  fecha y hora local (`YYYY-MM-DD HH:MM`) + qué/porqué/causa raíz, (3) commit
  descriptivo con título imperativo ≤72 chars + cuerpo, (4) push a `origin main`,
  (5) confirmar el push. Sin esto el trabajo se considera no terminado.
  Motivo: garantizar un historial claro que permita reconstruir el porqué de
  cada cambio. También se completó la lista de artifacts a no commitear
  (`frontend/inserter-dist/`, `frontend/dist-electron/`) y se listaron los
  secretos explícitamente (`.env`, `.agents/`, `.zcode/`).

### Arreglado — Dictado global: por fin inserta el texto transcrito en cualquier app

El dictado global (Ctrl+Shift+D → hablar → insertar en la caja de texto enfocada)
obtenía la transcripción correctamente y la copiaba al portapapeles, pero la
inserción automática en la caja de texto de destino **fallaba de forma silenciosa**
en Chrome, VS Code, Codex y otras apps modernas. El usuario tenía que hacer
Ctrl+V manualmente. Solucionado mediante un helper nativo compilado.

#### Causa raíz: `cbSize` incorrecto en `SendInput`

El helper invocaba `SendInput` pasando `Marshal.SizeOf(typeof(INPUT))` como
`tamaño de la estructura`. Pero la struct Win32 `INPUT` es una **unión**:

```c
typedef struct tagINPUT {
    DWORD   type;
    union {
        MOUSEINPUT    mi;
        KEYBDINPUT    ki;
        HARDWAREINPUT hi;
    } DUMMYUNIONNAME;
} INPUT;
```

El tamaño de la unión lo dicta su **miembro más grande** (`MOUSEINPUT`), no el
que se use en cada llamada. La primera versión de la struct en C# solo declaraba
`KEYBDINPUT`, así que `Marshal.SizeOf(INPUT)` devolvía **32** en x64 en lugar de
**40**. La documentación de `SendInput` dice:

> *"If cbSize is not the size of an INPUT structure, the function fails."*

Y falla **devolviendo 0**, sin lanzar excepción. Resultado: ni Ctrl+V ni
SendInput Unicode enviaban **ninguna tecla jamás**, aunque el foco y el
portapapeles estuvieran bien (por eso Ctrl+V manual sí funcionaba).

Síntomas en el panel DICTATION DEBUG:

```text
paste: paste ctrl+v failed to send          ← SendInput devolvía 0
paste: paste sendinput unicode sent but value unchanged
paste: paste failed: text left on clipboard, press Ctrl+V
```

#### Solución

- **`frontend/inserter/Inserter.cs`**: declarar la unión completa con
  `[StructLayout(LayoutKind.Explicit)]` y `MOUSEINPUT`/`KEYBDINPUT`/`HARDWAREINPUT`
  mapeados al mismo `FieldOffset(8)`. Así `Marshal.SizeOf(INPUT)` da el valor
  correcto (40 en x64, 28 en x86) y `SendInput` funciona.
- Verificado con un subcomando de autodiagnóstico `inserter.exe selftest`:

  ```text
  INPUT cbSize=40
  SendInput returned 1 (expected 1)
  ```

### Añadido — Helper nativo `inserter.exe` para la "última milla"

Reemplazada la inserción basada en **PowerShell + `Add-Type` en runtime** por un
helper nativo compilado. Es el mismo patrón que usan Espanso, AutoHotkey, Beeftext
o el Voice Typing de Windows (Win+H).

**Por qué un helper compilado y no PowerShell en runtime**: `Add-Type` recompila
un `.cs` en `TEMP` en cada ejecución, lo que es frágil (errores de permisos en
TEMP, antivirus, rutas sanboxeadas — ya nos había roto antes). Un `.exe`
precompilado arranca en ~30 ms frente a 300-800 ms, y es determinístico: lo que
se prueba es lo que se envía.

**Archivos clave**:

- `frontend/inserter/Inserter.cs` — fuente C# (.NET Framework 4, compilable con
  `csc.exe` incluido en Windows).
- `frontend/inserter-dist/inserter.exe` — build del helper (lo genera
  `build-electron.ps1`, no se commitea).
- `scripts/build-electron.ps1` — compila el helper con `csc.exe` referenciando
  `UIAutomationClient.dll`/`UIAutomationTypes.dll` del GAC **antes** de
  `electron-builder`.
- `frontend/package.json` — `extraResources` mapea `inserter-dist` →
  `resources/inserter/`.
- `frontend/electron/main.ts` — `inserterExePath()`, `captureFocusedElement()`,
  `insertWithHelper()`.

**Subcomandos**:

- `inserter.exe capture` — captura el **control enfocado** vía UIAutomation
  (con `RuntimeId` estable) + hwnd/thread/proceso. Lo invoca Electron al pulsar
  Ctrl+Shift+D, **antes** de grabar.
- `inserter.exe insert --capture <json> --text <path>` — re-localiza el control
  por `RuntimeId`, le hace `SetFocus`, y aplica la cadena de inserción (ver abajo).
- `inserter.exe selftest` — autodiagnóstico: reporta `cbSize` de `INPUT` y el
  valor de retorno de `SendInput`.

**Cadena de inserción** (cada paso verifica antes de declarar éxito):

1. Traer la ventana host al frente **solo si no lo está ya**, con el truco ALT
   para destrabar el `SetForegroundWindow` lock. **No** des-maximizar ventanas
   (bug corregido: `SW_RESTORE` sobre una ventana maximizada la reducía).
2. Re-localizar el **control exacto** por `RuntimeId` y hacerle `SetFocus`.
3. **Ctrl+V** vía `SendInput`, tras liberar modificadores "atorados" (Shift/Ctrl/
   Alt/Win) que el truco ALT pueda haber dejado pulsados. Verificar que el
   `Value` del control creció (con reintentos, porque Chromium actualiza su árbol
   de accesibilidad de forma asíncrona).
4. Si no → **`ValuePattern.SetValue`** pero **solo en campos vacíos** ( SetValue
   *reemplaza* todo el contenido, no inserta en el caret), verificando el valor.
5. Si no → **SendInput Unicode** char-a-char (último recurso; inestable en Chromium).
6. Si todo falla → dejar el texto en el portapapeles y reportar el fallo claro
   para que el usuario haga Ctrl+V manual.

**Lección clave**: capturar el `hwnd` de la ventana no sirve; hay que capturar el
**control de texto exacto** (con el caret) y re-enfocar ESE control al pegar.
Traer la ventana al frente (`SetForegroundWindow`) no restaura el foco de teclado
dentro del textarea. Por eso el helper usa `AutomationElement.FocusedElement` +
`RuntimeId` en vez de `GetForegroundWindow` solo.

### Arreglado — Evitar que la ventana destino se "minimizara" al pegar

`ShowWindow(hwnd, SW_RESTORE)` se llamaba incondicionalmente. `SW_RESTORE` sobre
una ventana **maximizada** la **des-maximiza** (la reduce a tamaño ventana).
Ahora solo se restaura si `IsIconic()` (está minimizada); si está maximizada, se
deja como está. Además, si el destino **ya es** el foreground, no se toca la
ventana en absoluto (fast-path).

### Arreglado — Modificadores "atorados" rompían el Ctrl+V

El truco ALT (Alt down/up) podía dejar el estado de teclado con modificadores en
estado "abajo". El Ctrl+V posterior se corrompía (se convertía en Ctrl+Alt+V,
Ctrl+Shift+V, etc.) y no pegaba nada. Añadida `ReleaseStuckModifiers` que usa
`GetAsyncKeyState` para detectar Shift/Ctrl/Alt/Win realmente pulsados y enviarles
un key-up explícito antes de cualquier inyección de teclas.

### Arreglado — `ValuePattern.SetValue` reemplazaba contenido sin verificar

`ValuePattern.SetValue` **reemplaza** todo el campo, no inserta en el caret.
Además, reportaba éxito sin verificar que el valor cambió, y Chromium no honra
`SetValue` en textareas. Ahora solo se usa si el campo **está vacío** (donde
reemplazar = insertar) y se verifica que el valor resultante coincide.

## [0.1.0] - 2025-06

Versión inicial pública.

- Backend FastAPI con HTTP + WebSockets.
- `/api/agents`: crear, listar, arrancar, parar, borrar, resize y enviar texto.
- `/ws/terminal/{agent_id}`: puente WebSocket ↔ PTY.
- `/ws/audio`: streaming de audio para STT.
- `AgentManager` dinámico para múltiples CLIs (Kimi, Claude, Codex, OpenCode, Aider, custom).
- PTY cross-platform: `pywinpty`/WinPTY en Windows, `pexpect` en Unix.
- STT intercambiable: `faster-whisper` local, `OpenWhispr` HTTP opcional.
- LLM cleaner opcional: `none`, `ollama`, `groq`.
- Frontend React/Vite/TypeScript con grilla de terminales `xterm.js`.
- Electron portable de doble clic: lanza backend empaquetado, sirve frontend,
  registra atajos globales.
