# Checklist de publicación

Vibe Spam puede publicar código y prereleases desde `main`. Una release estable
para usuarios finales requiere completar esta lista para cada versión.

## Obligatorio

- [ ] `main` limpio y sincronizado con `origin/main`.
- [ ] Repositorio visible públicamente sin iniciar sesión y pestaña Actions accesible.
- [ ] CI verde en Windows y Linux: Ruff, mypy, pytest, ESLint, Vitest y builds.
- [ ] `npm audit --audit-level=high` sin vulnerabilidades.
- [ ] Smoke test del portable CPU en una instalación limpia de Windows 10/11.
- [ ] Primer arranque descarga el modelo y los siguientes funcionan offline.
- [ ] Dictado global probado en navegador, VS Code y una app Win32.
- [ ] En macOS: `.dmg`, PTY, Micrófono, Accesibilidad y pegado global probados
      en hardware `arm64`/`x64` para cada artefacto publicado.
- [ ] Terminales Codex/Claude/Kimi verificadas con PTY y cierre sin huérfanos.
- [ ] Artefactos sin `.env`, tokens, logs, modelos privados ni bases de datos.
- [ ] SHA-256 publicado para cada artefacto.
- [ ] Estado de firma declarado en las notas. Si la release no está firmada,
      advertir sobre SmartScreen y enlazar hashes SHA-256 sin recomendar
      desactivar protecciones de Windows.
- [ ] Protección de `main`, Dependabot, CodeQL, secret scanning y private
      vulnerability reporting activos en el repositorio público.

## Perfiles Windows

- **CPU**: descarga universal y predeterminada. Verificar `device=cpu`,
  `compute_type=int8` y transcripción real después del warmup.
- **CUDA**: descarga opcional para NVIDIA. Verificar que se incluyan cuBLAS,
  cuDNN y CUDA Runtime, `device=cuda`, `compute_type=float16`, y ejecutar una
  transcripción real. Publicar claramente su tamaño y requisitos.

## Plataformas secundarias

- macOS no debe etiquetarse como estable hasta probar su artefacto en hardware
  real y completar firma/notarización. El dictado global ya dispone de flujo de
  portapapeles + `Command+V` autorizado por Accesibilidad.
- El DMG `arm64` se probó en hardware Apple Silicon el 18 de julio de 2026 con
  micrófono → Whisper → portapapeles → TextEdit. El build y smoke test `x64`
  siguen pendientes antes de declarar cobertura Intel.
- Linux no debe etiquetarse como estable hasta añadir una implementación de
  dictado global para X11/Wayland y probar sus artefactos en hardware real.
- Una matriz CI que compila backend/frontend no sustituye el smoke test de PTY,
  micrófono, permisos, empaquetado y lifecycle en el sistema objetivo.

## Release

1. Actualizar versión y `CHANGELOG.md`.
2. Ejecutar `scripts/build-windows-installer.ps1 -AllowUnsigned` para CPU y,
   opcionalmente, `scripts/build-windows-installer.ps1 -Cuda -AllowUnsigned`.
3. Comprobar estado de firma, tamaño y SHA-256 de
   `frontend/release/<perfil>/`.
4. Instalar desde cero, completar smoke tests y publicar notas con limitaciones.
