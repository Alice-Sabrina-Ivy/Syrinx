// bench.mjs — CPU cost of the Dashboard's resonance cue in Node (ms of CPU per
// second of audio), the production path vs the lab engine's own pitch replica.
//
//   node scripts/resonance/bench.mjs [--reps=5]
//
// Audio: the three committed lab fixtures (public LibriSpeech, 15 s, ~60 %
// voiced) band-limited-upsampled to 48 kHz, 25 ms chunks, looped 4x (60 s).
// Rows:
//   production  src/resonance/resonance-worker.js (fake `self`): the vtln
//               finalist in "frames" mode + the gated cue, fed the REAL pitch
//               worker's posted frames (the pitch worker's own cost is NOT
//               counted — it runs anyway for the pitch trace)
//   lab-internal createLabEngine({ models: { vtln } }) with its internal pitch
//               replica (what the lab costs for the same finalist)
// CPU = process.cpuUsage() user+system around the worker calls only.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reps = Number((process.argv.find((a) => a.startsWith("--reps=")) ?? "--reps=5").split("=")[1]);
const ASSETS = path.join(repo, "public/resonance-lab");
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);
const { createLabEngine } = await import(pathToFileURL(path.join(repo, "src/resonance-lab/lab-engine.js")).href);

let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
await import(pathToFileURL(path.join(repo, "src/dsp/pitch-worker.js")).href);
const pitchOn = self.onmessage;
globalThis.fetch = async (url) => {
  const body = readFileSync(path.join(ASSETS, String(url).split("/").pop()), "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
await import(pathToFileURL(path.join(repo, "src/resonance/resonance-worker.js")).href);
const resOn = self.onmessage;

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
const parts = ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"].map((n) => Float32Array.from(upsample(readWav16(path.join(repo, "tests/resonance-lab/fixtures", `${n}.wav`)))));
const one = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
let o = 0; for (const p of parts) { one.set(p, o); o += p.length; }
const LOOPS = 4;
const y = new Float32Array(one.length * LOOPS);
for (let i = 0; i < LOOPS; i++) y.set(one, i * one.length);
const SR = 48000, CH = 1200;
const audioS = y.length / SR;

// pitch posts per chunk (computed once; not timed)
pitchOn({ data: { type: "init", inputSampleRate: SR } });
const pport = {}; pitchOn({ data: { type: "audioPort", port: pport } });
const chunks = [];
for (let s = 0, i = 0; s < y.length; s += CH, i++) {
  const x = y.slice(s, Math.min(y.length, s + CH));
  const ct = Math.min(y.length, s + CH) / SR;
  sink = [];
  pport.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
  chunks.push({ x, ct, posts: sink.filter((m) => m.type === "pitch") });
}
const voicedShare = chunks.reduce((a, c) => a + c.posts.filter((m) => m.voiced).length, 0) / chunks.reduce((a, c) => a + c.posts.length, 0);

const cpuMs = (u) => (u.user + u.system) / 1000;
async function benchProduction() {
  sink = [];
  await resOn({ data: { type: "init", sampleRate: SR, assetBase: "/", diag: true } });
  const port = {}; resOn({ data: { type: "audioPort", port } });
  const msgs = chunks.map((c) => ({ chunk: { data: { buffer: c.x.slice().buffer, contextTime: c.ct } },
    hints: c.posts.map((m) => ({ data: { type: "pitch-hint", voiced: m.voiced, pitch: m.pitch, contextTime: m.contextTime } })) }));
  const u0 = process.cpuUsage();
  for (const m of msgs) { port.onmessage(m.chunk); for (const h of m.hints) resOn(h); }
  const ms = cpuMs(process.cpuUsage(u0));
  const last = sink.filter((m) => m.type === "state").pop();
  return { ms, workerSelf: last?.perf?.meanMsPerAudioS ?? null, u: last?.u };
}
function benchLab() {
  const vtln = JSON.parse(readFileSync(path.join(ASSETS, "vtln_warp.json"), "utf8"));
  const reference = JSON.parse(readFileSync(path.join(ASSETS, "reference.json"), "utf8"));
  const eng = createLabEngine({ sampleRate: SR, models: { vtln }, reference });
  const xs = chunks.map((c) => c.x.slice());
  const u0 = process.cpuUsage();
  for (const x of xs) eng.pushChunk(x);
  return { ms: cpuMs(process.cpuUsage(u0)) };
}

const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
const prod = [], lab = [], self_ = [];
for (let r = 0; r < reps; r++) {
  const p = await benchProduction(); prod.push(p.ms / audioS); self_.push(p.workerSelf);
  lab.push(benchLab().ms / audioS);
}
console.log(`audio ${audioS.toFixed(1)} s @ 48 kHz, ${(100 * voicedShare).toFixed(0)} % of pitch frames voiced, ${reps} reps (median, min-max)`);
console.log(`node ${process.version}`);
console.log(`production (resonance worker, frames mode): ${med(prod).toFixed(1)} ms CPU / s audio  (${Math.min(...prod).toFixed(1)}-${Math.max(...prod).toFixed(1)}); worker's own perf.meanMsPerAudioS ${med(self_).toFixed(1)}`);
console.log(`lab engine vtln + internal pitch replica:   ${med(lab).toFixed(1)} ms CPU / s audio  (${Math.min(...lab).toFixed(1)}-${Math.max(...lab).toFixed(1)})`);
