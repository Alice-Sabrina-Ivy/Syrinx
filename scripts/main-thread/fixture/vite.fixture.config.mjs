// Builds the fixed-input fixtures against the source tree they are copied
// into (<tree>/build/fixture/, by scripts/main-thread/visual-check.mjs).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const input = Object.fromEntries(["trace", "cue"]
  .filter((n) => existsSync(path.join(here, `${n}.html`)))
  .map((n) => [n, path.join(here, `${n}.html`)]));
export default {
  root,
  base: "/",
  logLevel: "warn",
  plugins: [react(), tailwindcss()],
  build: { outDir: path.resolve(process.env.FIXTURE_OUT), emptyOutDir: true, minify: false, rollupOptions: { input } },
};
