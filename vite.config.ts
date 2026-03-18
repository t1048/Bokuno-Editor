import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'src-tauri/dist'),
    emptyOutDir: true,
    // Current editor bundle includes heavy parsing/rendering deps; keep warning threshold realistic.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@codemirror')) {
            return 'vendor-codemirror';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
})
