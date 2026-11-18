import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['node-pty'] } } },
  preload: {},
  renderer: { plugins: [react(), tailwindcss()] }
})
