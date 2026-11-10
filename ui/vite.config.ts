import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/dsh-bot/',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
})
