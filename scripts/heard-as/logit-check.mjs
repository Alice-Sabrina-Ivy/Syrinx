// logit-check.mjs — femaleLogitFromResult (what the gender worker now posts
// as `logit`) vs the model's raw fc7 logit difference d[female] − d[male],
// on public windows; and the cost of computing it
// (measurements/heard-as-window-logit-2026-10-07.md §1, §4).
//
//   node scripts/heard-as/logit-check.mjs [--r1=<jobs_r1.json>] [--hill=<dir of Hillenbrand wavs>] [--max=2400]
//
// Windows: 0.75 s (12000 samples at 16 kHz) every 0.3 s over
//   - the three committed lab fixtures (LibriSpeech, CC BY 4.0),
//   - LibriSpeech test-clean r1 utterances (--r1: [{audio: float32 16 kHz file}]),
//   - Hillenbrand /hVd/ vowels (--hill: 16 kHz WAVs; padded / cut to 0.75 s).
// Both paths run the deployed q8-v2 model from the transformers.js cache in
// Node (onnxruntime-node): the audio-classification PIPELINE (what the worker
// calls) and AutoModelForAudioClassification (raw logits).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const MAX = Number(arg("max", "2400"));
const { femaleLogitFromResult, femaleScoreFromResult } = await import(pathToFileURL(path.join(repo, "src/ml/audio-utils.js")).href);
const T = await import("@huggingface/transformers");
const ID = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";
if (!existsSync(path.join(repo, "node_modules/@huggingface/transformers/.cache", ID, "onnx/model_quantized.onnx"))) {
  console.error("model not in the transformers.js cache — run node tests/ml/perceived-voice-hillenbrand-test.js once"); process.exit(2);
}
T.env.allowRemoteModels = false;
T.env.allowLocalModels = true;
T.env.localModelPath = path.join(repo, "node_modules/@huggingface/transformers/.cache");
const opts = { dtype: "q8", session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } };
const classifier = await T.pipeline("audio-classification", ID, opts);
const model = await T.AutoModelForAudioClassification.from_pretrained(ID, opts);
const male = Object.entries(model.config.id2label).find(([, l]) => l.toLowerCase() === "male")[0];
const female = Object.entries(model.config.id2label).find(([, l]) => l.toLowerCase() === "female")[0];

function readWav16(p) {
  const b = readFileSync(p);
  let off = 12, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4); const len = b.readUInt32LE(off + 4);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return x;
}
const W = 12000, HOP = 4800;
const windows = []; // {src, x}
function addStream(src, x) {
  for (let s = 0; s + W <= x.length; s += HOP) windows.push({ src, x: x.slice(s, s + W) });
}
for (const n of ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"]) addStream("lab fixtures", readWav16(path.join(repo, "tests/resonance-lab/fixtures", `${n}.wav`)));
const hill = arg("hill", "");
if (hill && existsSync(hill)) {
  for (const f of readdirSync(hill).filter((f) => f.endsWith(".wav")).slice(0, 300)) {
    const x = readWav16(path.join(hill, f));
    const y = new Float32Array(W); y.set(x.subarray(0, W));
    windows.push({ src: "Hillenbrand", x: y });
  }
}
const r1 = arg("r1", "");
if (r1) {
  for (const j of JSON.parse(readFileSync(r1, "utf8"))) {
    const b = readFileSync(j.audio);
    addStream("LibriSpeech r1", new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
    if (windows.length >= MAX) break;
  }
}
windows.length = Math.min(windows.length, MAX);

let maxAbs = 0, n = 0, signMismatch = 0, nulls = 0, minL = Infinity, maxL = -Infinity;
const perSrc = new Map();
let pipeMs = 0, helperMs = 0;
for (const w of windows) {
  const t0 = performance.now();
  const res = await classifier(w.x, { sampling_rate: 16000 });
  pipeMs += performance.now() - t0;
  const t1 = performance.now();
  const L = femaleLogitFromResult(res);
  helperMs += performance.now() - t1;
  const out = await model({ input_values: new T.Tensor("float32", w.x, [1, W]) });
  const d = out.logits.data;
  const raw = d[female] - d[male];
  if (L === null) { nulls++; continue; }
  const diff = Math.abs(L - raw);
  maxAbs = Math.max(maxAbs, diff);
  if (Math.sign(L) !== Math.sign(femaleScoreFromResult(res) - 0.5)) signMismatch++;
  minL = Math.min(minL, L); maxL = Math.max(maxL, L);
  n++;
  const s = perSrc.get(w.src) ?? { n: 0, max: 0 };
  s.n++; s.max = Math.max(s.max, diff); perSrc.set(w.src, s);
}
console.log(`windows: ${n} (${[...perSrc].map(([k, v]) => `${k} ${v.n}`).join(", ")}), null logits ${nulls}`);
console.log(`max |femaleLogitFromResult - (d[female] - d[male])| = ${maxAbs.toExponential(2)}  (${[...perSrc].map(([k, v]) => `${k} ${v.max.toExponential(1)}`).join(", ")})`);
console.log(`logit range ${minL.toFixed(2)} .. ${maxL.toFixed(2)}; sign disagreements with femaleScoreFromResult - 0.5: ${signMismatch}`);
console.log(`per window: pipeline ${(pipeMs / windows.length).toFixed(2)} ms (1 thread, Node ${process.version}); femaleLogitFromResult ${(1000 * helperMs / windows.length).toFixed(2)} µs`);
