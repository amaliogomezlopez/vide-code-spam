# macOS

Vibe Spam funciona en macOS con terminales PTY, captura de micrófono, Whisper
local y dictado global en otras aplicaciones. El paquete todavía no está
firmado con Developer ID ni notarizado (el build local usa firma ad-hoc), por
lo que se considera beta.

## Estado verificado

El 18 de julio de 2026 se verificó en hardware Apple Silicon (`arm64`) el flujo
completo del DMG empaquetado: arranque del backend nativo, carga de Whisper,
captura real de micrófono, transcripción, escritura en el portapapeles,
reactivación de TextEdit y pegado automático con `Command+V`. El bundle pasó
además `codesign --verify --deep --strict`. La arquitectura Intel (`x64`) sigue
necesitando su propio build y smoke test porque el backend PyInstaller es nativo.

## Requisitos

- macOS 13 o posterior.
- Python 3.11 o 3.12. El `/usr/bin/python3` de algunas versiones de macOS es
  demasiado antiguo.
- Node.js 20.19 o posterior.
- Espacio y conexión para descargar el modelo Whisper en el primer arranque.

Con Homebrew:

```bash
brew install python@3.12 node@22
VIBE_SPAM_PYTHON="$(brew --prefix python@3.12)/bin/python3.12" ./scripts/setup.sh
```

## Desarrollo

```bash
source backend/.venv/bin/activate
cd frontend
npm run electron:dev
```

Electron usa automáticamente `backend/.venv/bin/python`, de modo que una app
arrancada desde Finder o npm no depende del Python 3.9 incluido por el sistema.
La detección de CLIs añade las rutas habituales de Homebrew, npm, Bun, pnpm y
NVM porque Finder suele proporcionar un `PATH` mínimo.

## Permisos

1. Al dictar por primera vez, acepta el permiso de **Micrófono**.
2. Activa **Settings → Shortcuts → Global dictation**.
3. Autoriza Vibe Spam en **Ajustes del Sistema → Privacidad y seguridad →
   Accesibilidad**. La propia pantalla de ajustes muestra el estado y puede
   volver a abrir la solicitud.
4. Coloca el cursor en un campo de texto y usa `⌘⇧D` para iniciar/detener.

En macOS usa el atajo global en vez de pulsar la burbuja flotante. Según la
versión del sistema, hacer clic en esa ventana puede activar Vibe Spam y cambiar
la aplicación frontal antes de que se capture el destino.

El dictado se escribe primero en el portapapeles de macOS. Después la app envía
`⌘V` al campo que conserva el foco. Vibe Spam recuerda el bundle de la
aplicación frontal al empezar a escuchar y lo reactiva justo antes del pegado,
esperando además a que macOS restaure el receptor nativo del teclado; por lo que
un diálogo de permisos o una transcripción lenta no cambia el destino. Si
Accesibilidad no está concedido, el texto permanece en el
portapapeles para poder pegarlo manualmente.

## Crear el DMG

```bash
source backend/.venv/bin/activate
python -m pip install pyinstaller
./scripts/build-backend-exe.sh
./scripts/build-electron.sh
```

El resultado queda en `frontend/release/`. El backend PyInstaller es específico
de la arquitectura de la máquina que lo construye (`arm64` o `x64`), así que no
debe etiquetarse como universal. Sin `CSC_LINK`/`CSC_NAME`, el script aplica una
firma ad-hoc reproducible para uso local. Define `VIBE_SPAM_MAC_SIGNING=auto` si
quieres seleccionar deliberadamente una identidad del llavero. Para distribuir
públicamente hacen falta un certificado Developer ID, hardened runtime y
notarización.
