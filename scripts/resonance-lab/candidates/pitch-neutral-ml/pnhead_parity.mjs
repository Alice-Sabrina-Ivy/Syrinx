// pnhead_parity.mjs — run a head-folded ECAPA export through the PRODUCTION transformers.js
// audio-classification pipeline (as src/ml/gender-worker.js would), to check the deployment
// claim "swap the model file, keep the pipeline". Prints the female probability per window.
//   node pnhead_parity.mjs <modelRoot> <modelId> <windows.f32> <nwin> <winSamples> <out.json>
import { pipeline, env } from "@huggingface/transformers";
import { readFileSync, writeFileSync } from "node:fs";

const [root, modelId, winPath, nwin, winSamples, outPath] = process.argv.slice(2);
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = root;
const buf = readFileSync(winPath);
const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const W = parseInt(winSamples, 10);
const clf = await pipeline("audio-classification", modelId, { dtype: "q8" });
const out = [];
const t0 = performance.now();
for (let i = 0; i < parseInt(nwin, 10); i++) {
  const r = await clf(all.slice(i * W, (i + 1) * W), { top_k: 2 });
  const f = r.find((x) => x.label === "female");
  out.push(f ? f.score : null);
}
const ms = (performance.now() - t0) / parseInt(nwin, 10);
writeFileSync(outPath, JSON.stringify({ p: out, ms_per_inference: ms }));
console.log(`windows ${out.length}, ${ms.toFixed(1)} ms/inference (Node ORT, default threads)`);
