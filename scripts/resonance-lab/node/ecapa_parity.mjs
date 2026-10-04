// ecapa_parity.mjs — run the production transformers.js audio-classification
// pipeline (same model id / local cache the app's tests use) over a set of raw
// float32 16 kHz windows, so B2's onnxruntime-python path can be checked for parity.
//
// Usage: node ecapa_parity.mjs <windows.f32> <nwin> <winSamples> <out.json>
import { pipeline, env } from "@huggingface/transformers";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "../../..");
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = join(REPO, "node_modules/@huggingface/transformers/.cache");

const [winPath, nwin, winSamples, outPath] = process.argv.slice(2);
const buf = readFileSync(winPath);
const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const W = parseInt(winSamples, 10);
const clf = await pipeline("audio-classification", "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2", { dtype: "q8" });
const out = [];
for (let i = 0; i < parseInt(nwin, 10); i++) {
  const w = all.slice(i * W, (i + 1) * W);
  const r = await clf(w, { top_k: 2 });
  const f = r.find((x) => x.label === "female");
  out.push(f ? f.score : null);
}
writeFileSync(outPath, JSON.stringify(out));
console.log(`windows ${out.length}`);
