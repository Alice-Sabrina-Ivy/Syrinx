// ort-runtime-files.js — the ONNX Runtime Web runtime files, shipped with
// the app instead of fetched from jsDelivr (user decision 2026-10-07: run
// time depends only on GitHub Pages and the project's Hugging Face account).
//
// The explicit `?url` imports make Vite emit each file from
// node_modules/onnxruntime-web/dist (the same package version as the ORT
// JavaScript bundled with Transformers.js) as a content-hashed asset, so a
// new ORT version gets a new URL. Only the two variants Transformers.js
// selects are shipped (src/ml/ort-wasm-paths.js);
// tests/ml/ort-runtime-files-test.js fails if a Transformers.js upgrade
// asks for another one. measurements/self-hosted-ort-2026-10-07.md.

import asyncifyMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { ORT_RUNTIME_VARIANTS, selfHostedWasmPaths } from "./ort-wasm-paths.js";

// Absolute (Transformers.js fetches these and ORT imports the factory from
// inside a worker, so a base-relative path is resolved against the page).
const abs = (u) => new URL(u, self.location.href).href;

export const ORT_RUNTIME_URLS = Object.freeze({
  [ORT_RUNTIME_VARIANTS.asyncify.mjs]: abs(asyncifyMjs),
  [ORT_RUNTIME_VARIANTS.asyncify.wasm]: abs(asyncifyWasm),
  [ORT_RUNTIME_VARIANTS.plain.mjs]: abs(plainMjs),
  [ORT_RUNTIME_VARIANTS.plain.wasm]: abs(plainWasm),
});

// Points an onnxruntime-web `env.wasm` (Transformers.js:
// env.backends.onnx.wasm) at the app's own runtime files, keeping the
// variant Transformers.js chose. Call it after Transformers.js has loaded
// (it writes its jsDelivr default on import) and before any session is
// created.
export function pointOrtAtAppRuntime(wasmEnv) {
  wasmEnv.wasmPaths = selfHostedWasmPaths(wasmEnv.wasmPaths, ORT_RUNTIME_URLS);
  return wasmEnv.wasmPaths;
}
