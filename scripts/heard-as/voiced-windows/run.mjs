// run.mjs — the production chain on every stream of build_streams.py, with and
// without the speech detector (measurements/heard-as-voiced-windows-2026-10-08.md).
//
//   node run.mjs --jobs=<streams/jobs.json> --out=<out.jsonl> --silero=<silero_vad.onnx> [--shard=i/n]
//
// Arms: S = speech detector live (the shipped gate) for every set; P = no
// speech hints (the pitch-voicing path the constants were checked on) also
// for r1, r1dev, pov and synth. Per stream one line:
//   { id, set, meta…, pitch: [[ms, f0]], arms: { S: { windows: [[ms, mode, classified 0/1]],
//     ticks: [[ms, voiceState]] }, P: {…} }, logits: { ms: logit } }
// The posted pitch is the same in both arms (checked). Logits: the deployed
// q8-v2 classifier on each classified window (cached by window end time —
// the same audio in both arms). Resumable (skips ids already in --out).

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { replay, loadClassifier, loadSpeechDetector, upsample16to48 } = await import(pathToFileURL(path.join(here, "../chain.mjs")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const JOBS = arg("jobs", ""), OUT = arg("out", ""), SILERO = arg("silero", "");
const [shI, shN] = arg("shard", "0/1").split("/").map(Number);
const P_SETS = new Set(["r1", "r1dev", "pov", "synth"]);

const classify = await loadClassifier();
if (!classify) { console.error("classifier not in the transformers.js cache"); process.exit(2); }
const newDetector = await loadSpeechDetector(SILERO);

const done = new Set();
if (existsSync(OUT)) for (const l of readFileSync(OUT, "utf8").split("\n")) if (l.trim()) try { done.add(JSON.parse(l).id); } catch { /* partial line */ }
const jobs = JSON.parse(readFileSync(JOBS, "utf8")).filter((_, i) => i % shN === shI).filter((j) => !done.has(j.id));
const t0 = Date.now();
let n = 0, audioS = 0;
for (const job of jobs) {
  const b = readFileSync(job.f32);
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const y = job.sr === 48000 ? Float32Array.from(x) : await upsample16to48(x);
  const logits = {};
  const arms = {};
  let pitch = null;
  for (const arm of P_SETS.has(job.set) ? ["S", "P"] : ["S"]) {
    const r = await replay(y, { sr: 48000, speech: arm === "S" ? newDetector() : null });
    if (pitch === null) pitch = r.pitch;
    else if (r.pitch.length !== pitch.length || r.pitch.some((q, i) => q[0] !== pitch[i][0] || q[1] !== pitch[i][1])) throw new Error(`${job.id}: posted pitch differs between arms`);
    for (const w of r.windows) if (w.classify && !(w.audioMs in logits)) logits[w.audioMs] = await classify(w.win);
    arms[arm] = { windows: r.windows.map((w) => [w.audioMs, w.mode, w.classify ? 1 : 0]), ticks: r.ticks.map((t) => [t[0], t[1]]) };
  }
  const { f32: _f, ...meta } = job;
  appendFileSync(OUT, JSON.stringify({ ...meta, durS: y.length / 48000, pitch, arms, logits }) + "\n");
  n++; audioS += y.length / 48000;
  if (n % 10 === 0) console.log(`${n}/${jobs.length}  audio ${(audioS / 60).toFixed(1)} min  wall ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`done ${n} streams -> ${OUT}`);
