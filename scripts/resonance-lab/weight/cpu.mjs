// cpu.mjs — CPU of the resonance lab's DSP engine with and without the weight × clarity
// analysis (measurements/weight-lab-prototype-2026-10-08.md §5 check 5, Node half).
//
//   node scripts/resonance-lab/weight/cpu.mjs --wav=<48 kHz mono speech, 16-bit> [--reps=3]
//
// Drives src/resonance-lab/lab-engine.js exactly as the lab worker does (25 ms capture
// chunks, internal production pitch replica, the le / vtln / fv finalists; pnml's model
// inference is a separate cost and is not included, as in the lab's "DSP" cost line),
// alternating runs without and with the weight tap, and prints ms CPU per second of audio.
// With the tap attached the mapping step is running, so every analysis path is active.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLabEngine } from "../../../src/resonance-lab/lab-engine.js";
import { createWeightLab } from "../../../src/resonance-lab/weight-lab.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = arg("wav", "");
const REPS = Number(arg("reps", "3"));
if (!WAV) { console.error("need --wav"); process.exit(2); }

function readWav(p) {
  const b = readFileSync(p);
  let off = 12, sr = 0;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "fmt ") sr = b.readUInt32LE(off + 12);
    if (id === "data") {
      const x = new Float32Array(len / 2);
      for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(off + 8 + 2 * i) / 32768;
      return { x, sr };
    }
    off += 8 + len;
  }
  throw new Error("no data chunk");
}

const json = (n) => JSON.parse(readFileSync(path.join(repo, "public/resonance-lab", n), "utf8"));
const models = { le: json("le_ens_h64.json"), vtln: json("vtln_warp.json"), fv: json("fv_model.json") };
const reference = json("reference.json");
const weightModel = json("weight_v5.json");
const { x, sr } = readWav(WAV);
const chunk = Math.round(sr * 0.025);
const secs = x.length / sr;

function run(withWeight) {
  const eng = createLabEngine({ sampleRate: sr, models, reference });
  let wl = null;
  if (withWeight) {
    wl = createWeightLab(weightModel);
    wl.map.setCapture({ autoGainControl: false, deviceId: "bench" });
    wl.map.startMapping();
    eng.setFrameTap(wl);
  }
  let ms = 0;
  for (let i = 0; i + chunk <= x.length; i += chunk) {
    const c = x.subarray(i, i + chunk);
    const t0 = performance.now();
    eng.pushChunk(c);
    ms += performance.now() - t0;
  }
  return { total: ms / secs, weight: wl ? wl.cpuMs / secs : null, frames: wl?.featureFrames ?? null };
}

run(false); run(true); // warm-up (JIT)
const off = [], on = [], w = [];
for (let r = 0; r < REPS; r++) {
  off.push(run(false).total);
  const o = run(true);
  on.push(o.total); w.push(o.weight);
}
const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
console.log(JSON.stringify({
  wav: path.basename(WAV), sampleRate: sr, seconds: +secs.toFixed(1), reps: REPS,
  labDspMsPerS_weightOff: +med(off).toFixed(2),
  labDspMsPerS_weightOn: +med(on).toFixed(2),
  weightAnalysisMsPerS: +med(w).toFixed(2),
  runs: { off: off.map((v) => +v.toFixed(2)), on: on.map((v) => +v.toFixed(2)) },
}));
