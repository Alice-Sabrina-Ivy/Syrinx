// heard-as-download-test.js — the "Likely heard as" switch states what turning
// it on downloads (src/ml/heard-as-download.js): the sizes must match what
// ships. ONNX Runtime from node_modules (fails on an ORT upgrade until the
// constant is updated), the speech detector from the pinned model's byte count
// (THIRD_PARTY_NOTICES.md), the classifier when it is in the transformers.js
// cache (SKIPPED otherwise).
//
//   node tests/ml/heard-as-download-test.js

import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HEARD_AS_DOWNLOAD_BYTES as B, HEARD_AS_DOWNLOAD_MB, HEARD_AS_DOWNLOAD_TOTAL_BYTES } from "../../src/ml/heard-as-download.js";
import { ORT_RUNTIME_VARIANTS } from "../../src/ml/ort-wasm-paths.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const size = (p) => statSync(path.join(repo, p)).size;
const v = ORT_RUNTIME_VARIANTS.asyncify;
const ort = size(`node_modules/onnxruntime-web/dist/${v.wasm}`) + size(`node_modules/onnxruntime-web/dist/${v.mjs}`);
check("runtime bytes = the shipped asyncify .wasm + .mjs", B.runtime === ort, `${B.runtime} vs ${ort}`);
const notices = readFileSync(path.join(repo, "THIRD_PARTY_NOTICES.md"), "utf8");
check("speech detector bytes = the pinned Silero file", notices.includes(B.speechDetector.toLocaleString("en-US")), String(B.speechDetector));
const cache = path.join(repo, "node_modules/@huggingface/transformers/.cache/Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2");
if (existsSync(path.join(cache, "onnx/model_quantized.onnx"))) {
  const c = statSync(path.join(cache, "onnx/model_quantized.onnx")).size + statSync(path.join(cache, "config.json")).size + statSync(path.join(cache, "preprocessor_config.json")).size;
  check("classifier bytes = the cached q8-v2 files", B.classifier === c, `${B.classifier} vs ${c}`);
} else console.log("  SKIPPED classifier size: not in the transformers.js cache");
check("the label is the total in whole MB", HEARD_AS_DOWNLOAD_MB === Math.round(HEARD_AS_DOWNLOAD_TOTAL_BYTES / 1e6) && HEARD_AS_DOWNLOAD_MB >= 40, `${HEARD_AS_DOWNLOAD_MB} MB`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
