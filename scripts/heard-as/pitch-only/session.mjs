// session.mjs — one simulated live session through the cue-strip production
// chain (the study ran on a source snapshot of branch cue-strip @ 370d107;
// SYRINX_SRC_ROOT points at such a snapshot, default = this checkout):
//   REAL pitch worker (fake self) -> posted frames
//   gender worker window schedule (streaming resampler, 0.75 s ring, 150 ms hop,
//     decideMlWindow + REAL utterance gate fed relayed pitch frames, silence floor)
//     -> deployed q8-v2 classifier -> femaleLogitFromResult -> heard-as aggregator
//   resonance worker path: lab engine "frames" mode (vtln) + gated resonanceCue
// Every 2 s of audio (the panel's update cadence) a tick records the panel's
// estimate (heard-as estimate() with the ML voice state) and the resonance cue
// snapshot. Posted pitch frames and scored windows are stored too, so rules can be
// evaluated offline from causal inputs.
//
//   node session.mjs <jobs.json> <out.jsonl> [--shard=i/n]
// jobs: [{ key, meta, phases: [{ phase, files: [{audio, sr}], gapS }] }]

import { readFileSync, openSync, writeSync, closeSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const snap = process.env.SYRINX_SRC_ROOT ?? path.resolve(here, "../../..");
const imp = (p) => import(pathToFileURL(path.join(snap, p)).href);
const { createStreamingResampler, RingWindow, SilenceTracker, windowPeak, TARGET_SAMPLE_RATE, femaleLogitFromResult } = await imp("src/ml/audio-utils.js");
const { createUtteranceGate, decideMlWindow } = await imp("src/ml/utterance-gate.js");
const { createHeardAsAggregator, heardAsShares } = await imp("src/ml/heard-as.js");
const { createLabEngine } = await imp("src/resonance-lab/lab-engine.js");
const { createResonanceCue } = await imp("src/resonance/resonanceCue.js");
const { upsample } = await imp("scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs");

const ASSETS = path.join(snap, "public/resonance-lab");
const vtlnModel = JSON.parse(readFileSync(path.join(ASSETS, "vtln_warp.json"), "utf8"));
const reference = JSON.parse(readFileSync(path.join(ASSETS, "reference.json"), "utf8"));

// pitch worker (module global state; re-init per session)
let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
await imp("src/dsp/pitch-worker.js");
const pitchOn = globalThis.self.onmessage;

// classifier
async function loadClassifier() {
  const ID = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";
  const cache = path.resolve(here, "../../../node_modules/@huggingface/transformers/.cache");
  if (!existsSync(path.join(cache, ID, "onnx/model_quantized.onnx"))) throw new Error("model missing");
  const T = await import("@huggingface/transformers");
  T.env.allowRemoteModels = false;
  T.env.allowLocalModels = true;
  T.env.localModelPath = cache;
  const clf = await T.pipeline("audio-classification", ID, { dtype: "q8", session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
  return async (win) => femaleLogitFromResult(await clf(win, { sampling_rate: TARGET_SAMPLE_RATE }));
}

const SR = 48000, CH = 1200, ML_WINDOW_SAMPLES = 12000, ML_HOP_MS = 150, TICK_MS = 2000;

function readAudio({ audio, sr }) {
  const b = readFileSync(audio);
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  if (sr === 48000) return Float32Array.from(x);
  if (sr === 16000) return Float32Array.from(upsample(x));
  throw new Error(`sr ${sr}`);
}

function build(job) {
  const parts = [];
  const bounds = [];
  let n = 0;
  for (const ph of job.phases) {
    const t0 = n / SR;
    const gap = new Float32Array(Math.round((ph.gapS ?? 0.25) * SR));
    for (const f of ph.files) {
      const y = readAudio(f);
      parts.push(y, gap); n += y.length + gap.length;
    }
    bounds.push({ phase: ph.phase, t0, t1: n / SR });
  }
  const y = new Float32Array(n);
  let o = 0; for (const p of parts) { y.set(p, o); o += p.length; }
  return { y, bounds };
}

async function runSession(job, score) {
  const { y, bounds } = build(job);
  pitchOn({ data: { type: "init", inputSampleRate: SR } });
  const port = {}; pitchOn({ data: { type: "audioPort", port } });
  // ML side
  const resample = createStreamingResampler(SR, TARGET_SAMPLE_RATE);
  const ring = new RingWindow(ML_WINDOW_SAMPLES);
  const gate = createUtteranceGate({ windowMs: 750 });
  const silence = new SilenceTracker();
  let lastGateMode = null, lastInferMs = -Infinity, relay = [], voiceState = null;
  const agg = createHeardAsAggregator();
  // resonance side
  const cue = createResonanceCue({ reference });
  const eng = createLabEngine({ sampleRate: SR, models: { vtln: vtlnModel }, reference, pitchSource: "frames",
    onStamped: (name, te, st, v) => { if (name === "vtln") cue.onStamped(te, st, v); } });
  const pitch = [], windows = [], ticks = [];
  let nextTick = TICK_MS;
  for (let s = 0; s < y.length; s += CH) {
    const e = Math.min(y.length, s + CH);
    const x = y.slice(s, e);
    const ct = e / SR, nowMs = ct * 1000;
    // ML worker: hints relayed after the previous chunk
    for (const m of relay) gate.notePitchHint({ voiced: m.voiced, pitch: m.pitch, ts: m.contextTime * 1000 });
    relay = [];
    ring.append(resample(x));
    if (ring.isFull() && nowMs - lastInferMs >= ML_HOP_MS - 1e-6) {
      const win = ring.snapshot();
      const d = decideMlWindow({ gate, audioNowMs: nowMs, peak: windowPeak(win), lastGateMode, silenceTracker: silence });
      lastGateMode = d.mode; lastInferMs = nowMs; voiceState = d.voiceState;
      if (d.score) {
        const logit = await score(win);
        if (agg.addWindow({ audioMs: nowMs, logit, mode: d.mode })) windows.push([+(nowMs.toFixed(1)), +logit.toFixed(4)]);
      }
    }
    // resonance worker: chunk
    cue.noteChunk(ct);
    eng.pushChunk(x, null, ct);
    // pitch worker
    sink = [];
    port.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
    for (const m of sink) {
      if (m.type !== "pitch") continue;
      const f0 = m.voiced && m.pitch > 0 ? m.pitch : 0;
      pitch.push([+(m.contextTime * 1000).toFixed(1), +f0.toFixed(2)]);
      agg.addPitch({ audioMs: m.contextTime * 1000, f0: m.pitch });
      relay.push(m);
      cue.notePitchHint({ voiced: m.voiced, pitch: m.pitch, contextTime: m.contextTime });
      eng.pushPitchFrame(m.contextTime, m.voiced ? m.pitch : 0);
    }
    if (nowMs >= nextTick) {
      nextTick += TICK_MS;
      const est = agg.estimate(nowMs, voiceState);
      let E;
      if (est.hidden) E = { hidden: est.hidden };
      else { const sh = heardAsShares(est.meterLogit, est.lnF0); E = { m: +est.meterLogit.toFixed(4), f: +est.lnF0.toFixed(5), s: +sh.s.toFixed(5), v: Math.round(est.voicedMs), age: Math.round(est.ageMs) }; }
      const r = cue.snapshot();
      ticks.push({ t: +(nowMs / 1000).toFixed(3), vs: voiceState, e: E,
        r: { u: r.u == null ? null : +r.u.toFixed(4), su: r.startU == null ? null : +r.startU.toFixed(4), fill: +(r.fill ?? 0).toFixed(3),
          vd: r.verdict, sr: +(r.sinceResumeS ?? 0).toFixed(2), vs: +(r.voicedS ?? 0).toFixed(2), sp: +(r.startProgress ?? 0).toFixed(3), cl: r.clamp } });
    }
  }
  return { key: job.key, meta: job.meta ?? {}, dur: y.length / SR, bounds, ticks, pitch, windows };
}

const [jobsPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const shardArg = (process.argv.find((a) => a.startsWith("--shard=")) ?? "--shard=0/1").split("=")[1].split("/").map(Number);
const jobs = JSON.parse(readFileSync(jobsPath, "utf8")).filter((_, i) => i % shardArg[1] === shardArg[0]);
const done = new Set();
if (existsSync(outPath)) for (const l of readFileSync(outPath, "utf8").split("\n")) if (l.trim()) { try { done.add(JSON.parse(l).key); } catch {} }
const score = await loadClassifier();
const fd = openSync(outPath, "a");
const t0 = Date.now();
let k = 0, audioS = 0;
for (const job of jobs) {
  if (done.has(job.key)) continue;
  const r = await runSession(job, score);
  writeSync(fd, JSON.stringify(r) + "\n");
  k++; audioS += r.dur;
  const el = (Date.now() - t0) / 1000;
  console.log(`${k} ${job.key} ${r.dur.toFixed(0)} s audio  total ${audioS.toFixed(0)} s in ${el.toFixed(0)} s  (${(audioS / el).toFixed(1)}x)`);
}
closeSync(fd);
console.log("done");
