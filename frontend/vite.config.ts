import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? './' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Electron's dev window loads http://localhost:5173. Silently moving to
    // another port used to produce a blank app window, so fail loudly instead.
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    // e2e/ belongs to Playwright, which owns its own runner and fixtures.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
}))
