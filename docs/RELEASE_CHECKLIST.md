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

## Plataformas experimentales

- Linux y macOS no deben etiquetarse como soporte estable hasta probar sus
  artefactos en hardware real y añadir helpers nativos para dictado global.
- Una matriz CI que compila backend/frontend no sustituye el smoke test de PTY,
  micrófono, permisos, empaquetado y lifecycle en el sistema objetivo.

## Release

1. Actualizar versión y `CHANGELOG.md`.
2. Ejecutar `scripts/build-windows-installer.ps1 -AllowUnsigned` para CPU y,
   opcionalmente, `scripts/build-windows-installer.ps1 -Cuda -AllowUnsigned`.
3. Comprobar estado de firma, tamaño y SHA-256 de
   `frontend/release/<perfil>/`.
4. Instalar desde cero, completar smoke tests y publicar notas con limitaciones.
