import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end smoke tests against a real backend and a real PTY.
 *
 * Unit tests mock the API, so nothing else proves that opening a terminal in
 * the UI actually spawns a process and streams its output back. Run with
 * `npm run e2e` (it starts the backend and Vite itself).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  // One retry: these tests drive a real PTY through a real WebSocket, and a
  // loaded machine can push the shell's first prompt past any fixed wait.
  retries: 1,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      // xterm's WebGL renderer paints to a canvas, leaving nothing in the DOM to
      // assert on. Disabling WebGL exercises the documented fallback renderer and
      // makes the terminal contents readable by the test.
      args: ['--disable-webgl', '--disable-webgl2', '--disable-gpu'],
    },
  },
  // Two entries instead of `dev:all`: Playwright then waits for the backend to
  // answer /api/health before the first test, rather than racing a Vite server
  // that is ready seconds earlier.
  webServer: [
    {
      command: 'npm run dev:backend',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
