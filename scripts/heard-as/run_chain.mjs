// run_chain.mjs — the "Likely heard as" inputs of each stimulus through the
// PRODUCTION chain (chain.mjs: real pitch worker, the gender worker's window
// schedule with the real utterance gate, the deployed classifier pipeline,
// src/ml/heard-as.js), pooled over the whole stimulus.
//
//   node scripts/heard-as/run_chain.mjs <jobs.json> <out.jsonl>
//
// jobs: [{ key, audio: <float32 file>, sr: 48000 | 16000 }] — 16 kHz items
// are band-limited-upsampled x3 to 48 kHz (as the resonance lab's harnesses
// do). Output per item: { key, dur, nWindows, meterLogit, lnF0, voicedMs,
// nVoicedFrames, windows: [[audioMs, logit]] } — the aggregate is heard-as.js
// aggregate() at the stimulus end over the whole stimulus (windowMs = ∞,
// minimum rules off; failures of the live minimums are counted by the
// analysis, not here). Outputs belong in the gitignored build/heard-as/.

import { readFileSync, openSync, writeSync, closeSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replay, loadClassifier, upsample16to48 } from "./chain.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { createHeardAsAggregator } = await import(pathToFileURL(path.join(repo, "src/ml/heard-as.js")).href);
const [jobsPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// --burst=40 --jitter=5: the measurement note's burst-jitter check (chain.mjs replay options)
const opt = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=")[1]);
const burstMs = opt("burst", 0), jitterMs = opt("jitter", 0);
if (!jobsPath || !outPath) { console.error("usage: run_chain.mjs <jobs.json> <out.jsonl>"); process.exit(2); }
const score = await loadClassifier();
if (!score) { console.error("classifier not in the transformers.js cache"); process.exit(2); }
mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
const fd = openSync(outPath, "w");
const t0 = Date.now();
let done = 0;
for (const job of jobs) {
  const b = readFileSync(job.audio);
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const y = job.sr === 48000 ? Float32Array.from(x) : await upsample16to48(x);
  const r = await replay(y, { sr: 48000, burstMs, jitterMs, seed: done + 1 });
  const agg = createHeardAsAggregator({ windowMs: Infinity, minVoicedMs: 0, minWindows: 0 });
  const wins = [];
  for (const [ms, f0] of r.pitch) agg.addPitch({ audioMs: ms, f0 });
  for (const w of r.windows) {
    const logit = await score(w.win);
    wins.push([w.audioMs, logit]);
    agg.addWindow({ audioMs: w.audioMs, logit, mode: w.mode });
  }
  const g = agg.aggregate(Infinity);
  writeSync(fd, JSON.stringify({ key: job.key, dur: y.length / 48000, nWindows: g.nWindows, meterLogit: g.meterLogit, lnF0: g.lnF0,
    voicedMs: g.voicedMs, nVoicedFrames: g.nVoicedFrames ?? 0, decisions: r.decisions, windows: wins }) + "\n");
  done++;
  if (done % 20 === 0) console.log(`${done}/${jobs.length}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
closeSync(fd);
console.log(`${done} items -> ${outPath}`);
