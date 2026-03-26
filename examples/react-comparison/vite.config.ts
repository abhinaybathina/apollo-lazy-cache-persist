import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'apollo-lazy-cache-persist': resolve(__dirname, '../../src/index.ts'),
    },
  },
})
