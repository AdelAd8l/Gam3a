import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import serviceWorker from './sw-plugin.ts'

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
})
