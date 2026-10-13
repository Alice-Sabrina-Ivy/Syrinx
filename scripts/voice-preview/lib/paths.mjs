// paths.mjs — where the voice-preview spike keeps everything that is not committed.
//
// VP_CACHE (environment) or the default <repo>/build/voice-preview (gitignored):
//   emsdk/        pinned Emscripten SDK (build.mjs --install)
//   world-src/    WORLD at the pinned commit (build.mjs fetches it)
//   wasm/         the built modules: wasm/<simd|nosimd>/vp_world.{mjs,wasm} + build-info.json
//   clips/        public clips prepared by prep/ (16 kHz prototype set, 48 kHz timing set)
//   parity/       parity runs (Node + pyworld outputs, results JSON)
//   timing/       timing-page results
//   browsers/     pinned browsers for the timing driver (@puppeteer/browsers)
//   fe/           F0 front-end comparison (§P4): tracks and scores
//   hum/          hum and noise tests (§P7): condition clips, renders, meter outputs
//   listen/       the listening set's working files (§P9; the WAVs go to a scratch folder)
// The 2026-10-12 runs used VP_CACHE=C:/Coding Projects/Syrinx-cache/voice-preview.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VP_DIR = path.resolve(HERE, "..");
export const REPO = path.resolve(VP_DIR, "../..");
export const CACHE = path.resolve(process.env.VP_CACHE || path.join(REPO, "build", "voice-preview"));
export const P = {
  emsdk: path.join(CACHE, "emsdk"),
  world: path.join(CACHE, "world-src"),
  wasm: path.join(CACHE, "wasm"),
  clips: path.join(CACHE, "clips"),
  parity: path.join(CACHE, "parity"),
  timing: path.join(CACHE, "timing"),
  browsers: path.join(CACHE, "browsers"),
  fe: path.join(CACHE, "fe"),
  hum: path.join(CACHE, "hum"),
  listen: path.join(CACHE, "listen"),
};
