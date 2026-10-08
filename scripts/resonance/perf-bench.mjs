// perf-bench.mjs — CPU of resonance-cue candidates vs the base, interleaved in
// one Node process (measurements/resonance-cue-cpu-2026-10-07.md).
//
//   node scripts/resonance/perf-bench.mjs --base=<tree> --cand=<tree> --configs=<configs.json> [--rounds=7]
//
// Same audio and path as scripts/resonance/bench.mjs (the three lab fixtures,
// 48 kHz, looped to 60 s, 1200-sample chunks; the REAL pitch worker's posted
// frames computed once, not timed), but each run drives the cue + lab engine
// in "frames" mode directly (what resonance-worker.js does per chunk / per
// pitch hint, without the worker shim), so engine options can be varied.
// Rounds alternate base / every config to share the machine's load.
// CPU = process.cpuUsage() user+system around the loop; median per config.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const BASE = path.resolve(arg("base", path.resolve(here, "../..")));
const CAND = path.resolve(arg("cand", path.resolve(here, "../..")));
const CONFIGS = arg("configs", "") ? JSON.parse(readFileSync(arg("configs", ""), "utf8")) : {};
const ROUNDS = Number(arg("rounds", "7"));
const imp = (root, p) => import(pathToFileURL(path.join(root, p)).href);

const { upsample } = await imp(BASE, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs");
let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
await imp(BASE, "src/dsp/pitch-worker.js");
const pitchOn = self.onmessage;
const trees = {
  base: { eng: (await imp(BASE, "src/resonance-lab/lab-engine.js")).createLabEngine, cue: (await imp(BASE, "src/resonance/resonanceCue.js")).createResonanceCue },
  cand: { eng: (await imp(CAND, "src/resonance-lab/lab-engine.js")).createLabEngine, cue: (await imp(CAND, "src/resonance/resonanceCue.js")).createResonanceCue },
};
const ASSETS = path.join(BASE, "public/resonance-lab");
const vtln = JSON.parse(readFileSync(path.join(ASSETS, "vtln_warp.json"), "utf8"));
const reference = JSON.parse(readFileSync(path.join(ASSETS, "reference.json"), "utf8"));

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
const parts = ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"].map((n) => Float32Array.from(upsample(readWav16(path.join(BASE, "tests/resonance-lab/fixtures", `${n}.wav`)))));
const one = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
let o = 0; for (const p of parts) { one.set(p, o); o += p.length; }
const LOOPS = 4, SR = 48000, CH = 1200;
const y = new Float32Array(one.length * LOOPS);
for (let i = 0; i < LOOPS; i++) y.set(one, i * one.length);
const audioS = y.length / SR;
pitchOn({ data: { type: "init", inputSampleRate: SR } });
const pport = {}; pitchOn({ data: { type: "audioPort", port: pport } });
const chunks = [];
for (let s = 0; s < y.length; s += CH) {
  const x = y.slice(s, Math.min(y.length, s + CH)), ct = Math.min(y.length, s + CH) / SR;
  sink = [];
  pport.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
  chunks.push({ x, ct, posts: sink.filter((m) => m.type === "pitch").map((m) => ({ voiced: m.voiced, pitch: m.pitch, contextTime: m.contextTime })) });
}

function once(kind, opts) {
  const T = trees[kind];
  const cue = T.cue({ reference });
  const eng = T.eng({ sampleRate: SR, models: { vtln }, reference, pitchSource: "frames", ...opts,
    onStamped: (n, te, st, v) => { if (n === "vtln") cue.onStamped(te, st, v); } });
  const xs = chunks.map((c) => c.x.slice());
  const u0 = process.cpuUsage();
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    cue.noteChunk(c.ct);
    eng.pushChunk(xs[i], null, c.ct);
    for (const m of c.posts) { cue.notePitchHint(m); eng.pushPitchFrame(m.contextTime, m.voiced ? m.pitch : 0); }
  }
  const u = process.cpuUsage(u0);
  return (u.user + u.system) / 1000 / audioS;
}

const RUNS = [["base", "base", {}], ...Object.entries(CONFIGS).map(([n, op]) => [n, "cand", op])];
const ms = Object.fromEntries(RUNS.map(([n]) => [n, []]));
for (const [n, k, op] of RUNS) once(k, op); // warm-up (JIT), not counted
for (let r = 0; r < ROUNDS; r++) for (const [n, k, op] of RUNS) ms[n].push(once(k, op));
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log(`node ${process.version}; ${audioS.toFixed(0)} s audio @ 48 kHz; ${ROUNDS} interleaved rounds (median, min-max)`);
const b = med(ms.base);
for (const [n] of RUNS) {
  console.log(`${n.padEnd(14)} ${med(ms[n]).toFixed(1).padStart(6)} ms CPU / s audio  (${Math.min(...ms[n]).toFixed(1)}-${Math.max(...ms[n]).toFixed(1)})  ratio to base ${(med(ms[n]) / b).toFixed(3)}`);
}
