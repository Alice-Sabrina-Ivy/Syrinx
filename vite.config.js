import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/Syrinx/',
  build: { outDir: 'docs' },
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Transformers.js loads ONNX runtime + model weights at runtime; let it
  // self-manage rather than pre-bundling its WASM/ONNX assets.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
