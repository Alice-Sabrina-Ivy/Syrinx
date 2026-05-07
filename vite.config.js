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
  // self-manage rather than pre-bundling its WASM/ONNX assets. Same applies
  // to onnxruntime-web (used directly by pitch-worker.js) — when Vite pre-
  // bundles it via esbuild for dev, the relative WASM URLs inside the
  // bundled .vite/deps/ output don't resolve (Vite serves only JS modules
  // from that cache, not .wasm files), causing the pitch-worker to fail
  // load with a "expected magic word 00 61 73 6d, found 3c 21 64 6f" error
  // (HTML SPA fallback served instead of the WASM bytes). Excluding the
  // package lets Vite serve the original node_modules/onnxruntime-web/
  // directory directly in dev, where ORT's relative path resolution works.
  // optimizeDeps is dev-only — production (Rollup) builds correctly emit
  // hashed .wasm assets in docs/assets/ regardless of this setting.
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
}))
