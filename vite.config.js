import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev:mobile` invokes Vite with `--mode mobile`, which gates the
// self-signed-cert plugin so the LAN URL works on phones (mic capture
// requires HTTPS on non-localhost origins). Default `npm run dev` keeps
// HTTP localhost behavior unchanged. See CLAUDE.md "Mobile testing" for
// the firewall + cert-warning workflow.
export default defineConfig(({ mode }) => ({
  base: '/Syrinx/',
  build: { outDir: 'docs' },
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'mobile' ? [basicSsl()] : []),
  ],
  worker: { format: 'es' },
  // Transformers.js loads ONNX runtime + model weights at runtime; let it
  // self-manage rather than pre-bundling its WASM/ONNX assets.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
}))
