// custom_rerun.mjs — judge checks of the frozen custom voice detector
// (2026-10-07): re-run the deployable ONNX model with onnxruntime-web WASM
// (1 thread) on seeded harness streams (PER per set, every rate), fed through
// the PRODUCTION streaming resampler (src/ml/audio-utils.js
// createStreamingResampler, 25 ms capture chunks), and
//  (1) compare with the harness probability files (onnxruntime CPU EP + the
//      Python resampler port, infer.py --onnx): max |dp| and decisions at p >= 0.3;
//  (2) "live" feeding: every frame run as soon as its last sample arrived
//      (1-3 frames per session.run), against the offline 8-frame chunks;
//  (3) causality: zero the audio from a random cut sample on and re-run; every
//      frame declared available by the cut (first_avail_ms + i * hop_ms <= cut)
//      must be bit-identical; frames after it should change.
// Run from the repo root (the ONNX file and probability files are gitignored build outputs):
//   node scripts/voice-detector/judge/custom_rerun.mjs --ort=<dir with node_modules/onnxruntime-web> [--per=2] [--seed=20261007] [--json=OUT]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { listStreams, loadAudio, SETS } = await import(pathToFileURL(resolve("scripts/voice-detector/lib/streams.mjs")).href);

const A = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const ROOT = "build/vad";
const CAND = "build/vad/cand/custom-vd";
const MODEL = "build/vad-train/model/custom-vd.onnx";
const PER = Number(A.per ?? 2);
const HOP = 200, OFF = 4, CTX = 312, FIRST_AVAIL_MS = 12.375, HOP_MS = 12.5;
const { createStreamingResampler } = await import(pathToFileURL(resolve("src/ml/audio-utils.js")).href);
const ort = await import(pathToFileURL(join(resolve(A.ort), "node_modules", "onnxruntime-web", "dist", "ort.node.min.mjs")).href);
ort.env.wasm.numThreads = 1;
const sess = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
const SHAPES = { ctx: [1, CTX], s0: [1, 1, 2, 64], s1: [1, 24, 2, 32], s2: [1, 48, 1, 16], h: [1, 1, 96] };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function zeroState() { const st = {}; for (const [k, s] of Object.entries(SHAPES)) st[k] = new ort.Tensor("float32", new Float32Array(s.reduce((a, b) => a * b, 1)), s); return st; }

// the app's resampler over 25 ms capture chunks (C = round(0.025 sr)); returns the 16 kHz stream
// and, per capture chunk, the number of 16 kHz samples available after it
function resampleLive(x, sr) {
  const C = Math.round(0.025 * sr);
  const rs = createStreamingResampler(sr, 16000);
  const parts = [], avail = [];
  let tot = 0;
  for (let i = 0; i < x.length; i += C) {
    const o = rs(x.subarray(i, Math.min(x.length, i + C)));
    parts.push(Float32Array.from(o));
    tot += o.length;
    avail.push(tot);
  }
  const y = new Float32Array(tot);
  let k = 0;
  for (const p of parts) { y.set(p, k); k += p.length; }
  return { y, avail };
}

async function runFrames(x16, groups) {
  // groups: list of frame counts per session.run, in order
  const xp = new Float32Array(OFF + x16.length); xp.set(x16, OFF);
  const n = Math.floor(xp.length / HOP);
  const out = new Float32Array(n);
  let st = zeroState(), i = 0;
  for (const g0 of groups) {
    const g = Math.min(g0, n - i);
    if (g <= 0) continue;
    const chunk = new ort.Tensor("float32", xp.slice(i * HOP, (i + g) * HOP), [1, g * HOP]);
    const r = await sess.run({ chunk, ...st });
    out.set(r.p.data, i);
    st = { ctx: r.ctx_out, s0: r.s0_out, s1: r.s1_out, s2: r.s2_out, h: r.h_out };
    i += g;
  }
  return out.subarray(0, i);
}

function offlineGroups(n, c = 8) { const g = []; for (let i = 0; i < n; i += c) g.push(Math.min(c, n - i)); return g; }

function liveGroups(avail) {
  // frame i is complete once (i + 1) * HOP - OFF samples exist; run every complete frame after each capture chunk
  const g = [];
  let done = 0;
  for (const a of avail) {
    const ready = Math.floor((a + OFF) / HOP);
    if (ready > done) { g.push(ready - done); done = ready; }
  }
  return g;
}

const R = rng(Number(A.seed ?? 20261007));
const picks = [];
for (const s of SETS) {
  const ms = listStreams(ROOT, [s]);
  const used = new Set();
  for (let k = 0; k < PER && used.size < ms.length; k++) {
    let j; do { j = Math.floor(R() * ms.length); } while (used.has(j));
    used.add(j); picks.push(ms[j]);
  }
}
const res = [];
let maxRef = 0, maxLive = 0, flipsRef = 0, flipsLive = 0, framesTot = 0, causalMax = 0, causalFrames = 0, afterChanged = 0, afterFrames = 0;
for (const m of picks) {
  const { samples: x, sr } = loadAudio(m);
  const { y, avail } = resampleLive(x, sr);
  const n = Math.floor((y.length + OFF) / HOP);
  const off = await runFrames(y, offlineGroups(n));
  const live = await runFrames(y, liveGroups(avail));
  const b = readFileSync(join(CAND, m.set, `${m.id}.f32`));
  const ref = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  let dRef = 0, dLive = 0, fR = 0, fL = 0;
  const nn = Math.min(ref.length, off.length);
  for (let i = 0; i < nn; i++) {
    dRef = Math.max(dRef, Math.abs(ref[i] - off[i]));
    if ((ref[i] >= 0.3) !== (off[i] >= 0.3)) fR++;
  }
  for (let i = 0; i < Math.min(live.length, off.length); i++) {
    dLive = Math.max(dLive, Math.abs(live[i] - off[i]));
    if ((live[i] >= 0.3) !== (off[i] >= 0.3)) fL++;
  }
  // causality: zero from a random cut sample on (at least 1 s in, at least 1 s before the end)
  const lo = Math.min(sr, x.length - 1), hi = Math.max(lo + 1, x.length - sr);
  const cut = lo + Math.floor(R() * (hi - lo));
  const xz = Float32Array.from(x); xz.fill(0, cut);
  const { y: yz } = resampleLive(xz, sr);
  const offz = await runFrames(yz, offlineGroups(Math.floor((yz.length + OFF) / HOP)));
  const cutMs = (cut / sr) * 1000;
  let cmax = 0, cfr = 0, ach = 0, afr = 0;
  for (let i = 0; i < Math.min(off.length, offz.length); i++) {
    const avMs = FIRST_AVAIL_MS + i * HOP_MS;
    if (avMs <= cutMs) { cmax = Math.max(cmax, Math.abs(off[i] - offz[i])); cfr++; }
    else { afr++; if (off[i] !== offz[i]) ach++; }
  }
  maxRef = Math.max(maxRef, dRef); maxLive = Math.max(maxLive, dLive); flipsRef += fR; flipsLive += fL; framesTot += nn;
  causalMax = Math.max(causalMax, cmax); causalFrames += cfr; afterChanged += ach; afterFrames += afr;
  const r = { stream: `${m.set}/${m.id}`, sr, frames: nn, ref_frames: ref.length, max_abs_ref: dRef, thr_flips_ref: fR, max_abs_live: dLive, thr_flips_live: fL,
    cut_s: +(cut / sr).toFixed(3), causal_frames: cfr, causal_max_abs: cmax, after_cut_frames: afr, after_cut_changed: ach };
  res.push(r);
  console.log(JSON.stringify(r));
}
const sum = { streams: res.length, frames: framesTot, max_abs_vs_harness_files: maxRef, thr_flips_vs_harness_files: flipsRef, max_abs_live_vs_offline: maxLive,
  thr_flips_live: flipsLive, causal_frames_checked: causalFrames, causal_max_abs: causalMax, after_cut_frames: afterFrames, after_cut_changed: afterChanged,
  ort: ort.env.versions?.web, node: process.version };
console.log(JSON.stringify(sum, null, 1));
if (A.json) writeFileSync(A.json, JSON.stringify({ summary: sum, streams: res }, null, 1));
