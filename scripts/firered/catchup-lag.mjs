// catchup-lag.mjs — how far the voice detector's first-use catch-up puts the
// pitch posts behind real time (measurements/voice-gate-catchup-2026-10-21.md).
//
// Real createVoiceDetector (src/dsp/firered-vad.js) with the real model
// (build/models/firered/, `node scripts/fetch-firered-model.mjs`) through
// onnxruntime-web WASM, one thread (the app's runtime build). Audio waits in
// the backlog for BACKLOG seconds before the model is set (as while the model
// downloads), then each 25 ms hop runs pushAudio + await hop(t), timed. A
// slower CPU is modelled by scaling each hop's time by m; the lag is the
// pitch worker's own estimate (noteLag: max(0, lag + busy − 25 ms)).
//
//   node scripts/firered/catchup-lag.mjs [--caps=50,30,20,15,10] [--backlogs=1,2,4] [--reps=5]
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=")[1];
const CAPS = arg("caps", "50,30,20,15,10").split(",").map(Number);
const BACKLOGS = arg("backlogs", "1,2,4").split(",").map(Number);
const REPS = Number(arg("reps", "5"));
const MS = [1, 2, 3, 4.5, 6];
const PITCH_MS = 0.25;   // the pitch part of a hop (CLAUDE.md: ~0.2 ms/frame)
const HOP = 400;         // 25 ms at 16 kHz

const imp = (p) => import(pathToFileURL(p).href);
const ORT_DIST = join(REPO, "node_modules/onnxruntime-web/dist");
const ort = await imp(join(ORT_DIST, "ort.wasm.bundle.min.mjs"));
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = readFileSync(join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
const FV = await imp(join(REPO, "src/dsp/firered-vad.js"));
const { LOCAL_MODEL_DIR } = await imp(join(REPO, "scripts/firered/local-model.mjs"));
const file = (key) => join(LOCAL_MODEL_DIR, FV.FIRERED_MODEL.files.find((f) => f.key === key).name);
const ONNX = readFileSync(file("onnx"));
// A fresh session per run, created before setModel and not timed: in the app
// the catch-up hops are the session's first runs, so their first-call cost
// counts (a session warmed up beforehand hides it).
const newSession = () => ort.InferenceSession.create(ONNX, { executionProviders: ["wasm"] });
const cmvn = FV.parseKaldiCmvn(readFileSync(file("cmvn")));

// Synthetic input: white noise at about −30 dBFS plus a 150 Hz harmonic tone.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
function audio(n, off) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (off + i) / 16000;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * 150 * h * t) / h;
    x[i] = 0.03 * rnd() + 0.05 * s;
  }
  return x;
}

async function once(cap, backlogS) {
  const det = FV.createVoiceDetector({ catchup: cap });
  let off = 0;
  const pre = Math.round(backlogS * 40);
  for (let k = 0; k < pre; k++) {
    det.pushAudio(audio(HOP, off)); off += HOP;
    det.noteHop(off / 16000);
  }
  det.setModel({ runner: FV.createFireRedRunner(ort, await newSession()), cmvn });
  const times = [];
  let decided = -1;
  for (let k = 0; k < 2000; k++) {
    const x = audio(HOP, off); off += HOP;
    const t0 = performance.now();
    det.pushAudio(x);
    const d = await det.hop(off / 16000);
    times.push(performance.now() - t0);
    if (d && decided < 0) decided = k;
    if (decided >= 0 && k >= decided + 20) break;
  }
  return { times, decided };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = [];
// The WASM module itself compiles at the first session's creation (in the
// app too, before setModel), so one session is created up front, unused.
await newSession();
for (const B of BACKLOGS) {
  for (const K of CAPS) {
    const runs = [];
    for (let r = 0; r < REPS; r++) runs.push(await once(K, B));
    const n = Math.min(...runs.map((x) => x.times.length));
    const per = Array.from({ length: n }, (_, i) => median(runs.map((x) => x.times[i])));
    const dec = median(runs.map((x) => x.decided));
    const row = { backlogS: B, cap: K, catchupHops: dec + 1, catchupS: (dec + 1) * 0.025, idleHopMs: median(per.slice(dec + 1)) };
    for (const m of MS) {
      let lag = 0, peak = 0;
      for (const ms of per) { lag = Math.max(0, lag + (m * (ms + PITCH_MS)) / 1000 - 0.025); peak = Math.max(peak, lag); }
      row[`peakLagS_m${m}`] = +peak.toFixed(3);
      row[`maxHopMs_m${m}`] = +(m * Math.max(...per.slice(0, dec + 1))).toFixed(1);
    }
    out.push(row);
    console.log(JSON.stringify(row));
  }
}
console.log("\n| backlog | cap | catch-up | steady hop ms | max hop ms m1 / m2 | peak lag s m1 / m2 / m3 / m4.5 / m6 |");
console.log("|---|---|---|---|---|---|");
for (const r of out) {
  console.log(`| ${r.backlogS} s | ${r.cap} | ${r.catchupHops} hops (${r.catchupS.toFixed(2)} s) | ${r.idleHopMs.toFixed(2)} | ${r.maxHopMs_m1} / ${r.maxHopMs_m2} | ${[1, 2, 3, 4.5, 6].map((m) => r[`peakLagS_m${m}`].toFixed(2)).join(" / ")} |`);
}
