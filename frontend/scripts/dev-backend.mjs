#!/usr/bin/env node
/**
 * Start the development backend with the repository's virtualenv.
 *
 * `setup.ps1`/`setup.sh` create `backend/.venv`, but a bare `python` from PATH
 * is usually a different interpreter without the dependencies installed. This
 * picks the venv when it exists and explains the fallback when it does not.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const isWindows = process.platform === 'win32'
const venvPython = path.join(
  repoRoot,
  'backend',
  '.venv',
  isWindows ? 'Scripts' : 'bin',
  isWindows ? 'python.exe' : 'python'
)

const interpreter = existsSync(venvPython) ? venvPython : isWindows ? 'python' : 'python3'
if (!existsSync(venvPython)) {
  console.warn(
    `[dev-backend] ${venvPython} not found; falling back to "${interpreter}" from PATH. ` +
      'Run scripts/setup.ps1 (Windows) or scripts/setup.sh to create the virtualenv.'
  )
}

const port = process.env.PORT ?? '8000'
const child = spawn(
  interpreter,
  [
    '-m',
    'uvicorn',
    'backend.app.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    port,
    '--reload',
    // Watch only the backend. Reloading on every frontend write restarts the
    // PTYs and reloads the speech model for changes that cannot affect Python.
    '--reload-dir',
    path.join(repoRoot, 'backend', 'app'),
  ],
  { cwd: repoRoot, stdio: 'inherit' }
)

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (error) => {
  console.error(`[dev-backend] could not start the backend: ${error.message}`)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
