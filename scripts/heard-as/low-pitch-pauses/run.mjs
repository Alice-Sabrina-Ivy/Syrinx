// run.mjs — the app's "Likely heard as" chain on every stream of
// build_streams.py, with stage taps (measurements/heard-as-low-pitch-and-pauses-2026-10-21.md).
//
//   node run.mjs --jobs=<jobs.json,...> --out=<out.jsonl> --silero=<silero_vad.onnx> [--shard=i/n]
//
// The chain is scripts/heard-as/chain.mjs replay() line for line (REAL pitch
// worker under a fake `self`, the gender worker's 150 ms decision tick, the
// REAL utterance gate fed the relayed pitch frames AND the Silero speech
// detector exactly as gender-worker.js handleChunk does, decideMlWindow, the
// silence floor, classifyDue every 450 ms, the deployed q8-v2 classifier),
// plus observation-only taps:
//   pitch stages  an independent replica of pitch-worker.js processChunk
//                 (same factories: createBoersmaAC, createPathTracker,
//                 createNoiseNotch, createHarmonicVoicingGuard, the streaming
//                 resampler) records per posted frame the tracker decode, the
//                 ghost veto, the above-400 Hz null and the harmonic guard; its
//                 posted value is checked equal to the real worker's on every
//                 frame (the run stops otherwise);
//   gate          each tick's verdict (not only the voice state), and whether
//                 a "warming" verdict is the post-onset share rule (a second
//                 gate instance fed the same hints with the post-onset share at
//                 0 does not say "warming") or the steady-onset hold;
//   speech        every Silero frame probability with its audio time.
// One JSON line per stream: { ...job meta, durS, pitch: [[ms, f0]],
//   stages: [[ms, dec, veto, above, guardVeto]], windows: [[ms, mode, classify]],
//   ticks: [[ms, voiceState, verdict, warmCause, score, spanId]], speech: [[ms, p]], logits: { ms: logit } }
// Resumable (skips ids already in --out).

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { loadClassifier, loadSpeechDetector, upsample16to48 } = await imp("scripts/heard-as/chain.mjs");
const { createStreamingResampler, RingWindow, SilenceTracker, windowPeak, TARGET_SAMPLE_RATE, ML_DECISION_HOP_MS, ML_CLASSIFY_HOP_MS, classifyDue } = await imp("src/ml/audio-utils.js");
const { createUtteranceGate, decideMlWindow } = await imp("src/ml/utterance-gate.js");
const { createBoersmaAC, createPathTracker, createHarmonicVoicingGuard, BOERSMA_FRAME_LENGTH_16K } = await imp("src/dsp/boersma-ac.js");
const { createNoiseNotch, isNearNotch } = await imp("src/dsp/noise-notch.js");
const { PITCH_DISPLAY_RANGE } = await imp("src/utils/constants.js");

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const JOBS = arg("jobs", ""), OUT = arg("out", ""), SILERO = arg("silero", "");
const [shI, shN] = arg("shard", "0/1").split("/").map(Number);

// --- the real pitch worker (as chain.mjs) ---
let sink = [];
const prevSelf = globalThis.self;
globalThis.self = { postMessage: (m) => sink.push(m) };
await imp("src/dsp/pitch-worker.js");
const pitchOnMessage = globalThis.self.onmessage;
const pitchSelf = globalThis.self;
if (prevSelf) globalThis.self = prevSelf;

// --- observation replica of pitch-worker.js processChunk (stage taps) ---
function pitchReplica(sr) {
  const FL = BOERSMA_FRAME_LENGTH_16K;
  const detector = createBoersmaAC(TARGET_SAMPLE_RATE, FL);
  const tracker = createPathTracker();
  const notch = createNoiseNotch(TARGET_SAMPLE_RATE);
  const guard = createHarmonicVoicingGuard();
  const resample = createStreamingResampler(sr, TARGET_SAMPLE_RATE);
  const buf = new Float32Array(FL);
  let fill = 0;
  let delay = [];
  let meta = [];
  return (x, ct) => {
    const inc = notch.process(resample(x));
    const k = inc.length;
    if (k >= FL) { buf.set(inc.subarray(k - FL)); fill = FL; }
    else if (k > 0) { buf.copyWithin(0, k, FL); buf.set(inc, FL - k); fill = Math.min(FL, fill + k); }
    if (fill < FL) return null;
    const fc = detector.candidates(buf);
    meta.push(ct);
    delay.push(Float32Array.from(buf));
    if (delay.length > tracker.config.lookback + 1) delay.shift();
    const dec = tracker.emit(fc);
    if (meta.length <= tracker.config.lookback) return null;
    const ctx = meta.shift();
    let v = dec;
    let veto = 0, above = 0, gv = 0;
    if (v > 0 && isNearNotch(v, notch.activeLines())) { v = null; veto = 1; }
    if (v > PITCH_DISPLAY_RANGE.high) { v = null; above = 1; }
    if (v > 0 && !guard.check(delay[0], v, TARGET_SAMPLE_RATE)) { v = null; gv = 1; }
    const voiced = v !== null && v !== undefined && v > 0;
    return { ctx, dec: dec > 0 ? dec : 0, veto, above, gv, post: voiced ? v : 0 };
  };
}

const classify = await loadClassifier();
if (!classify) { console.error("classifier not in the transformers.js cache"); process.exit(2); }
const newDetector = await loadSpeechDetector(SILERO);

async function run(y, sr) {
  const chunk = Math.round(sr * 0.025);
  globalThis.self = pitchSelf;
  pitchOnMessage({ data: { type: "init", inputSampleRate: sr } });
  const port = {};
  pitchOnMessage({ data: { type: "audioPort", port } });
  const rep = pitchReplica(sr);
  const resample = createStreamingResampler(sr, TARGET_SAMPLE_RATE);
  const ring = new RingWindow(12000);
  const gate = createUtteranceGate({ windowMs: 750 });
  const gate0 = createUtteranceGate({ windowMs: 750, speechMinPostOnsetFrac: 0, minPostOnsetFrac: 0 });
  const silence = new SilenceTracker();
  const det = newDetector();
  det.framer.reset();
  let lastGateMode = null, lastInferMs = -Infinity, lastClassifyMs = null;
  let relay = [];
  const pitch = [], stages = [], windows = [], ticks = [], speech = [], logits = {};
  for (let s = 0; s < y.length; s += chunk) {
    const e = Math.min(y.length, s + chunk);
    const x = y.slice(s, e);
    const ct = e / sr;
    for (const m of relay) {
      const h = { voiced: m.voiced, pitch: m.pitch, ts: m.contextTime * 1000 };
      gate.notePitchHint(h); gate0.notePitchHint(h);
    }
    relay = [];
    const audioNowMs = ct * 1000;
    const x16 = resample(x);
    ring.append(x16);
    for (const f of det.framer.push(x16, audioNowMs)) {
      const p = await det.run(f.input);
      speech.push([Math.round(f.ts * 10) / 10, Math.round(p * 1000) / 1000]);
      gate.noteSpeech({ ts: f.ts, p }); gate0.noteSpeech({ ts: f.ts, p });
    }
    if (ring.isFull() && audioNowMs - lastInferMs >= ML_DECISION_HOP_MS - 1e-6) {
      const win = ring.snapshot();
      const d = decideMlWindow({ gate, audioNowMs, peak: windowPeak(win), lastGateMode, silenceTracker: silence });
      const d0 = gate0.decide(audioNowMs);
      lastGateMode = d.mode;
      lastInferMs = audioNowMs;
      const cls = d.score && classifyDue(audioNowMs, lastClassifyMs, ML_CLASSIFY_HOP_MS);
      if (cls) { lastClassifyMs = audioNowMs; logits[audioNowMs] = await classify(win); }
      if (d.score) windows.push([audioNowMs, d.mode, cls ? 1 : 0]);
      const warm = d.verdict === "warming" ? (d0.verdict === "warming" ? "steady" : "postOnset") : "";
      ticks.push([audioNowMs, d.voiceState, d.verdict, warm, d.score ? 1 : 0, d.spanId]);
    }
    sink.length = 0;
    port.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
    const r = rep(x, ct);
    const posted = sink.filter((m) => m.type === "pitch");
    if ((r === null) !== (posted.length === 0) || posted.length > 1) throw new Error(`replica frame count differs at ${ct}`);
    for (const m of posted) {
      const f0 = m.voiced ? m.pitch : 0;
      if (Math.abs(m.contextTime - r.ctx) > 1e-9 || f0 !== r.post) throw new Error(`replica differs at ${ct}: ${f0} vs ${r.post}`);
      pitch.push([m.contextTime * 1000, f0]);
      stages.push([m.contextTime * 1000, Math.round(r.dec * 100) / 100, r.veto, r.above, r.gv]);
      relay.push(m);
    }
  }
  return { pitch, stages, windows, ticks, speech, logits };
}

const done = new Set();
if (existsSync(OUT)) for (const l of readFileSync(OUT, "utf8").split("\n")) if (l.trim()) try { done.add(JSON.parse(l).id); } catch { /* partial */ }
const all = [];
for (const p of JOBS.split(",")) all.push(...JSON.parse(readFileSync(p, "utf8")));
// run order: the families the attribution needs first (a partial run is still usable)
const prio = (j) => j.family === "natlow" ? 0
  : j.pause === "pnat" && j.voice !== "w1" ? 1 : j.voice === "nat" && j.pause === "p0" ? 1
  : j.voice === "nat" && (j.pause === "p1.0" || j.pause === "p2.5") ? 2
  : j.voice === "nat" && j.pause === "p0.6" ? 3 : 4;
all.sort((a, b) => prio(a) - prio(b) || (a.id < b.id ? -1 : 1));
const jobs = all.filter((_, i) => i % shN === shI).filter((j) => !done.has(j.id));
const t0 = Date.now();
let n = 0, audioS = 0;
for (const job of jobs) {
  const b = readFileSync(job.f32);
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const y = job.sr === 48000 ? Float32Array.from(x) : job.sr === 16000 ? await upsample16to48(x) : null;
  if (!y) throw new Error(`${job.id}: sr ${job.sr}`);
  const r = await run(y, 48000);
  const { f32: _f, ...meta } = job;
  appendFileSync(OUT, JSON.stringify({ ...meta, durS: y.length / 48000, ...r }) + "\n");
  n++; audioS += y.length / 48000;
  if (n % 10 === 0 || n === 1) console.log(`${n}/${jobs.length}  audio ${(audioS / 60).toFixed(1)} min  wall ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`done ${n} streams -> ${OUT}`);
