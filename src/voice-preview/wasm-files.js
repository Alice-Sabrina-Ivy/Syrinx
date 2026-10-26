// wasm-files.js — Voice Shaper's WebAssembly files as content-hashed build assets
// (the src/ml/ort-runtime-files.js pattern): the explicit `?url` imports make Vite emit
// the committed glue and both .wasm builds unmodified into dist/assets/ and hand back
// their URLs. Imported only by Voice Shaper's lazily loaded card, which passes the
// URLs to the worker (`init`); the worker fetches exactly one .wasm (SIMD or not).
// A module id under src/voice-preview/wasm/ in the build also brings WORLD's and
// Emscripten's licence texts into THIRD_PARTY_NOTICES.txt (scripts/third-party-notices.mjs).
// measurements/voice-preview-phase1-2026-10-19.md §2, §11, §12.
import glue from "./wasm/vp_world.mjs?url";
import simd from "./wasm/simd/vp_world.wasm?url";
import nosimd from "./wasm/nosimd/vp_world.wasm?url";
// Background-noise reduction (DeepFilterNet 3, ./dfn3.js): the app's own onnxruntime-web runtime
// files (the ones the pitch worker uses for FireRedVAD) and where the three graphs come from.
import { ORT_RUNTIME_URLS } from "../ml/ort-runtime-files.js";
import { ORT_RUNTIME_VARIANTS, selfHostedWasmPaths } from "../ml/ort-wasm-paths.js";
import { DFN3_MODEL, dfn3ModelSource } from "./dfn3-model.js";

// Absolute: the worker imports the glue and fetches the .wasm from its own scope.
const abs = (u) => new URL(u, self.location.href).href;

export const VP_GLUE_URL = abs(glue);
export const VP_WASM_URLS = Object.freeze({ simd: abs(simd), nosimd: abs(nosimd) });
export const VP_ORT_WASM_PATHS = selfHostedWasmPaths({ wasm: ORT_RUNTIME_VARIANTS.plain.wasm }, ORT_RUNTIME_URLS);
/** The Hugging Face mirror at the pinned commit, else the app's own models/dfn3/ (development). */
export function vpDfn3Source() {
  let appBaseUrl = null;
  try { appBaseUrl = new URL(`${import.meta.env.BASE_URL}${DFN3_MODEL.dir}`, self.location.href).href; } catch { /* no page location */ }
  return dfn3ModelSource({ appBaseUrl });
}
