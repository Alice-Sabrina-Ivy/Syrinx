// ort-wasm-paths.js — which ONNX Runtime Web runtime files the app ships,
// and how ORT's `wasmPaths` is pointed at them (pure; Node-testable).
//
// Transformers.js sets `env.backends.onnx.wasm.wasmPaths` to jsDelivr when
// it loads (src/backends/onnx.js): the "asyncify" variant everywhere but
// Safari, the plain one on Safari. Since 2026-10-07 the app ships both
// variants itself (src/ml/ort-runtime-files.js) and only swaps the host:
// Transformers.js's variant choice is kept as it is, so nothing changes
// except where the bytes come from (measurements/self-hosted-ort-2026-10-07.md).

export const ORT_RUNTIME_VARIANTS = Object.freeze({
  asyncify: Object.freeze({ mjs: "ort-wasm-simd-threaded.asyncify.mjs", wasm: "ort-wasm-simd-threaded.asyncify.wasm" }),
  plain: Object.freeze({ mjs: "ort-wasm-simd-threaded.mjs", wasm: "ort-wasm-simd-threaded.wasm" }),
});

function fileName(url) {
  return String(url).split(/[?#]/)[0].split("/").pop();
}

// Which shipped variant the current `wasmPaths` asks for. An object whose
// .wasm names a shipped variant keeps that variant; anything else (unset,
// a string prefix, an unknown file) gets "asyncify", the variant the ORT
// bundle Transformers.js imports (onnxruntime-web/webgpu) is built around.
export function wasmVariantOf(current) {
  if (current && typeof current === "object" && current.wasm) {
    const name = fileName(current.wasm);
    for (const [key, v] of Object.entries(ORT_RUNTIME_VARIANTS)) if (v.wasm === name) return key;
  }
  return "asyncify";
}

// The app-hosted { mjs, wasm } for the variant `current` asks for.
//   urls: { [file name]: app URL } for every file in ORT_RUNTIME_VARIANTS.
export function selfHostedWasmPaths(current, urls) {
  const v = ORT_RUNTIME_VARIANTS[wasmVariantOf(current)];
  const mjs = urls?.[v.mjs];
  const wasm = urls?.[v.wasm];
  if (!mjs || !wasm) throw new Error(`ONNX Runtime files missing from the build: ${v.mjs}, ${v.wasm}`);
  return { mjs, wasm };
}
