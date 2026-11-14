import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base "./" so the built app loads from files inside the desktop app (no web server).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5174, strictPort: true },
})
