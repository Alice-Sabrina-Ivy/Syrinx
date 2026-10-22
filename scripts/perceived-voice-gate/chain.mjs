// chain.mjs — production chain runner for the Perceived Voice gate measurement
// (measurements/perceived-voice-gate-2026-10-07.md).
//
// Runs the REAL pitch worker + DSP worker + main-thread handleAnalysisResult
// (useAudioPipeline.js) over 16 kHz float32 streams in 25 ms chunks, via the
// session oracle's loader, and records per chunk what the perceived-voice
// path consumes:
//   pitch  pitch the worker posted while processing chunk k (Hz, 0 = unvoiced,
//          -1 = no message) — it describes the frame L = 2 chunks back
//   ctx    that message's contextTime in ms (the frame's capture time; -1 = none)
//   inten  DSP-worker intensity (dB), gate  DSP gate per chunk ('0' idle,
//          '1' holding, '2' voiced, '9' no DSP frame yet), paint  painted trace Hz
// plus the RETIRED (2026-07-19) gender-worker VAD replayed per 150 ms tick, for
// the "before" columns: ticks = [[k, code]], code 0 window peak below the
// silence floor, 1 scored (voiced pitch in the last 500 ms), 2 scored by the
// sub-75 Hz probe, 3 scored by the stale fallback, 4 gated unvoiced, 5 gated
// stale + quiet. The classifier runs separately (score.py).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/perceived-voice-gate/chain.mjs \
//        <set> [--src=<src tree>] [--shard=i/n]
// reads build/perceived-voice-gate/sets/jobs_<set>.json, appends to
// build/perceived-voice-gate/runs/vad_<set>.<i>.jsonl (resumable). --src
// defaults to this checkout's src/ (`git archive <rev> src` for another commit).
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.SO_TAP = "0";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SET = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!SET) { console.error("usage: chain.mjs <set> [--src=<dir>] [--shard=i/n]"); process.exit(2); }
const SRC = resolve(arg("src", join(REPO, "src")));
const [shI, shN] = arg("shard", "0/1").split("/").map(Number);
const OUT = process.env.SYRINX_PVG_OUT ?? join(REPO, "build", "perceived-voice-gate");
const jobsPath = join(OUT, "sets", `jobs_${SET}.json`);
const outPath = join(OUT, "runs", `vad_${SET}.${shI}.jsonl`);
mkdirSync(dirname(outPath), { recursive: true });

const { loadSrc } = await import(pathToFileURL(join(REPO, "scripts/session-oracle/lib/chain.mjs")).href);
const { M } = await import(pathToFileURL(join(REPO, "scripts/session-oracle/lib/react-mock.mjs")).href);
const S = await loadSrc(SRC);
const AU = await import(pathToFileURL(join(SRC, "ml/audio-utils.js")).href);

let jobs = JSON.parse(readFileSync(jobsPath, "utf8")).filter((_, i) => i % shN === shI);
const done = new Set();
if (existsSync(outPath)) for (const l of readFileSync(outPath, "utf8").split("\n")) { if (l.trim()) try { done.add(JSON.parse(l).id); } catch { /* partial line */ } }
jobs = jobs.filter((j) => !done.has(j.id));

const SR = 16000, C = 400, WIN = Math.floor(SR * 0.75), HOP = 6;

function readF32(p) {
  const b = readFileSync(p);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

let hookGen = 0;
async function runOne(samples) {
  const n = Math.floor(samples.length / C);
  const inten = new Float32Array(n).fill(NaN);
  const msgPitch = new Float32Array(n).fill(NaN), msgConf = new Float32Array(n).fill(NaN);
  const msgCtx = new Float32Array(n).fill(NaN);
  const msgNotch = new Array(n).fill(null);
  const { P, D } = S;
  globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: SR } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  globalThis.self = D; D.posts = [];
  D.onmessage({ data: { type: "init", sampleRate: SR } });
  const dp = {}; D.onmessage({ data: { type: "port", port: dp } });
  for (let k = 0; k < n; k++) {
    const ct = (k + 1) * C / SR;
    globalThis.self = P; P.posts.length = 0;
    pp.onmessage({ data: { buffer: Float32Array.from(samples.subarray(k * C, (k + 1) * C)).buffer, contextTime: ct } });
    for (const m of P.posts) {
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
      if (m.type !== "pitch") continue;
      msgPitch[k] = m.pitch !== null ? m.pitch : 0; msgConf[k] = m.confidence;
      msgCtx[k] = typeof m.contextTime === "number" ? m.contextTime * 1000 : NaN;
      msgNotch[k] = m.notchedFreqs ?? [];
    }
    globalThis.self = D; D.posts.length = 0;
    dp.onmessage({ data: { buffer: Float32Array.from(samples.subarray(k * C, (k + 1) * C)).buffer, contextTime: ct } });
    for (const m of D.posts) if (m.type === "analysis") inten[k] = m.data.intensity;
  }
  // ---- retired gender VAD (2026-07-19 .. 2026-10-07 gender-worker.js maybeInfer) ----
  const ticks = [];
  let lastHint = -1, lastVoiced = -1, lastNotch = [], lastTick = -1e9;
  for (let k = 0; k < n; k++) {
    if (k > 0 && !Number.isNaN(msgPitch[k - 1])) { lastHint = k - 1; lastNotch = msgNotch[k - 1]; if (msgPitch[k - 1] > 0) lastVoiced = k - 1; }
    if ((k + 1) * C < WIN || k - lastTick < HOP) continue;
    lastTick = k;
    const w = samples.subarray((k + 1) * C - WIN, (k + 1) * C);
    const peak = AU.windowPeak(w);
    const stale = lastHint < 0 || (k - lastHint) * 25 > AU.PITCH_HINT_STALE_MS;
    const voiced = !stale && lastVoiced >= 0 && (k - lastVoiced) * 25 <= AU.VOICED_RECENCY_MS;
    let g;
    if (peak < AU.VAD_SILENCE_FLOOR) g = 0;
    else if (stale) g = peak < AU.VAD_PEAK_THRESHOLD ? 5 : 3;
    else if (voiced) g = 1;
    else g = AU.subFloorVoiced(w, SR, lastNotch) ? 2 : 4;
    ticks.push([k, g]);
  }
  // ---- display gate (real handleAnalysisResult) ----
  const frames = [];
  let last = { pitch: null, confidence: null, ts: 0 };
  for (let k = 0; k < n; k++) {
    const now = (k + 1) * C / SR * 1000;
    if (!Number.isNaN(msgPitch[k])) last = { pitch: msgPitch[k] > 0 ? msgPitch[k] : null, confidence: msgConf[k], ts: now };
    if (Number.isNaN(inten[k])) continue;
    frames.push({ k, now, intensity: inten[k], pitch: last.pitch, confidence: last.confidence, ts: last.ts });
  }
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(pathToFileURL(S.hookPath).href + `?pv=${++hookGen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* browser-only */ } }
  const latest = M.refs.find((r) => r.current && typeof r.current === "object" && "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  const gateRef = M.refs.find((r) => r.current && typeof r.current === "object" && Object.keys(r.current).sort().join(",") === "holding,voiced");
  if (!latest || !har || !gateRef) throw new Error("hook refs not found");
  const gate = new Uint8Array(n).fill(9);
  const paint = new Float32Array(n);
  const tr = api.pitchTraceRef;
  for (const f of frames) {
    latest.current = { pitch: f.pitch, confidence: f.confidence, voiced: f.pitch !== null, ts: f.ts };
    har.current({ intensity: f.intensity, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: f.now });
    const g = gateRef.current;
    gate[f.k] = g.voiced ? 2 : g.holding ? 1 : 0;
    const T = tr.current; const lastE = T[T.length - 1];
    paint[f.k] = lastE && lastE.time === Math.round(f.now) && lastE.pitch !== null ? lastE.pitch : 0;
  }
  const r1 = (x) => (Number.isNaN(x) ? -1 : Math.round(x * 10) / 10);
  return {
    n, ticks,
    pitch: Array.from(msgPitch, r1),
    ctx: Array.from(msgCtx, (x) => (Number.isNaN(x) ? -1 : Math.round(x))),
    inten: Array.from(inten, r1),
    gate: Array.from(gate).join(""),
    paint: Array.from(paint, r1),
  };
}

const t0 = Date.now();
let i = 0;
for (const j of jobs) {
  const r = await runOne(readF32(j.f32));
  appendFileSync(outPath, JSON.stringify({ id: j.id, ...r }) + "\n");
  if (++i % 20 === 0) console.log(`${i}/${jobs.length} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`${SET}: ${i} streams in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outPath}`);
