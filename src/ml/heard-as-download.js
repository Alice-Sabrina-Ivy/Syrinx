// heard-as-download.js — what switching the "Likely heard as" panel on
// downloads the first time, for the size shown on its switch and in
// Settings (2026-10-07 UX review: the label said 16 MB — the classifier
// only — while a built-app run fetched 42 MB).
//
// Bytes of each file as served (vite preview / any server without
// compression). GitHub Pages serves .wasm gzip-compressed (the ONNX Runtime
// file is ~5.7 MB gzipped), so the real transfer there is smaller; the
// models come from Hugging Face uncompressed. The label states this
// uncompressed total as an upper bound ("up to"). Safari loads the smaller
// non-asyncify runtime (ort-wasm-simd-threaded.wasm, 12.9 MB).
// tests/ml/heard-as-download-test.js fails when a shipped size drifts
// (ONNX Runtime from node_modules; the speech detector from its pinned
// sha256's byte count; the classifier when it is in the transformers.js
// cache).

export const HEARD_AS_DOWNLOAD_BYTES = Object.freeze({
  // Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2: onnx/model_quantized.onnx
  // + config.json + preprocessor_config.json
  classifier: 16057697 + 370 + 223,
  // Silero VAD v6.2.3 (src/ml/speech-detector.js; THIRD_PARTY_NOTICES.md)
  speechDetector: 2327524,
  // onnxruntime-web ort-wasm-simd-threaded.asyncify.{wasm,mjs} (src/ml/ort-runtime-files.js)
  runtime: 23567050 + 47389,
});

const total = Object.values(HEARD_AS_DOWNLOAD_BYTES).reduce((a, b) => a + b, 0);
export const HEARD_AS_DOWNLOAD_TOTAL_BYTES = total;
/** Whole MB (10^6 bytes): the size the switch and Settings show ("up to N MB"). */
export const HEARD_AS_DOWNLOAD_MB = Math.round(total / 1e6);
