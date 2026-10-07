// chain.mjs — the "Likely heard as" fit-time chain, shared by run_chain.mjs,
// make_golden.mjs and tests/ml/heard-as-equivalence-test.js.
//
// Per stimulus, exactly what the live app does, on the audio clock:
//   1. 25 ms capture chunks (contextTime = end of the chunk, s) into the REAL
//      pitch worker (src/dsp/pitch-worker.js under a fake `self`);
//   2. the gender worker's window schedule: the streaming linear resampler
//      into a 0.75 s ring, a decision every 150 ms of audio once the ring is
//      full (start-to-start; wall clock = audio clock in a replay, inference
//      never overruns), decideMlWindow with the REAL utterance gate fed the
//      posted pitch frames as relayed by the main thread (a frame posted while
//      chunk k is processed reaches the ML worker before chunk k + 1), the
//      silence floor on the window peak;
//   3. (callers) each scored window through the deployed classifier ->
//      femaleLogitFromResult, then src/ml/heard-as.js.
// No ONNX here: replay() returns the scored windows' audio and the posted
// pitch so the window-set guard can run in CI without the model.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createStreamingResampler, RingWindow, SilenceTracker, windowPeak, TARGET_SAMPLE_RATE } = await imp("src/ml/audio-utils.js");
const { createUtteranceGate, decideMlWindow } = await imp("src/ml/utterance-gate.js");

// The pitch worker is a module with global state: one shared instance,
// re-initialised per stimulus. It posts through globalThis.self.
let pitchOnMessage = null;
let sink = [];
async function pitchWorker() {
  if (pitchOnMessage) return pitchOnMessage;
  const prev = globalThis.self;
  globalThis.self = { postMessage: (m) => sink.push(m) };
  await imp("src/dsp/pitch-worker.js");
  pitchOnMessage = globalThis.self.onmessage;
  const ours = globalThis.self;
  if (prev && prev !== ours) globalThis.self = prev;
  // keep our postMessage reachable even if the caller swaps `self` later
  pitchOnMessage.__self = ours;
  return pitchOnMessage;
}

export const ML_WINDOW_SAMPLES = 12000;
export const ML_HOP_MS = 150;

/**
 * y: Float32Array at `sr`; chunk: samples per capture chunk (default 25 ms).
 * burstMs (measurement only): chunks reach the ML worker in bursts, one per
 *   hardware buffer of this length, plus 0-jitterMs of scheduling jitter;
 *   the worker's 150 ms hop is timed on that arrival ("wall") clock as in
 *   the app (performance.now()), not on the audio clock. 0 = no bursts.
 * -> { pitch: [[audioMs, f0 (0 = unvoiced)]], windows: [{ audioMs, mode, spanId, win: Float32Array }],
 *      decisions: number }
 */
export async function replay(y, { sr = 48000, chunk = Math.round(sr * 0.025), burstMs = 0, jitterMs = 0, seed = 1 } = {}) {
  let rnd = seed >>> 0 || 1;
  const rand = () => { rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0; return rnd / 4294967296; };
  const onMsg = await pitchWorker();
  const saved = globalThis.self;
  globalThis.self = onMsg.__self;
  try {
    onMsg({ data: { type: "init", inputSampleRate: sr } });
    const port = {};
    onMsg({ data: { type: "audioPort", port } });
    const resample = createStreamingResampler(sr, TARGET_SAMPLE_RATE);
    const ring = new RingWindow(ML_WINDOW_SAMPLES);
    const gate = createUtteranceGate({ windowMs: 750 });
    const silence = new SilenceTracker();
    let lastGateMode = null;
    let lastInferMs = -Infinity;
    let relay = [];
    const pitch = [];
    const windows = [];
    let decisions = 0;
    for (let s = 0; s < y.length; s += chunk) {
      const e = Math.min(y.length, s + chunk);
      const x = y.slice(s, e);
      const ct = e / sr;
      // ML worker: relayed hints first (posted while the previous chunk was processed)
      for (const m of relay) gate.notePitchHint({ voiced: m.voiced, pitch: m.pitch, ts: m.contextTime * 1000 });
      relay = [];
      const audioNowMs = ct * 1000;
      const wallMs = burstMs > 0 ? Math.ceil(audioNowMs / burstMs - 1e-9) * burstMs + jitterMs * rand() : audioNowMs;
      ring.append(resample(x));
      if (ring.isFull() && wallMs - lastInferMs >= ML_HOP_MS - 1e-6) {
        const win = ring.snapshot();
        const d = decideMlWindow({ gate, audioNowMs, peak: windowPeak(win), lastGateMode, silenceTracker: silence });
        lastGateMode = d.mode;
        lastInferMs = wallMs;
        decisions++;
        if (d.score) windows.push({ audioMs: audioNowMs, mode: d.mode, spanId: d.spanId, win });
      }
      // pitch worker
      sink.length = 0;
      port.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
      for (const m of sink) {
        if (m.type !== "pitch") continue;
        pitch.push([m.contextTime * 1000, m.voiced ? m.pitch : 0]);
        relay.push(m);
      }
    }
    return { pitch, windows, decisions };
  } finally {
    globalThis.self = saved;
  }
}

/** Loads the deployed classifier pipeline from the transformers.js cache (Node). null if absent. */
export async function loadClassifier() {
  const { existsSync } = await import("node:fs");
  const ID = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";
  const cache = path.join(repo, "node_modules/@huggingface/transformers/.cache");
  if (!existsSync(path.join(cache, ID, "onnx/model_quantized.onnx"))) return null;
  const T = await import("@huggingface/transformers");
  T.env.allowRemoteModels = false;
  T.env.allowLocalModels = true;
  T.env.localModelPath = cache;
  const classifier = await T.pipeline("audio-classification", ID, {
    dtype: "q8", session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  });
  const { femaleLogitFromResult } = await imp("src/ml/audio-utils.js");
  return async (win) => femaleLogitFromResult(await classifier(win, { sampling_rate: TARGET_SAMPLE_RATE }));
}

export function readWav16(buf) {
  let off = 12, data = null, sr = 16000;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4); const len = buf.readUInt32LE(off + 4);
    if (id === "fmt ") sr = buf.readUInt32LE(off + 12);
    if (id === "data") { data = buf.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return { x, sr };
}

export async function upsample16to48(x16) {
  const { upsample } = await imp("scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs");
  return Float32Array.from(upsample(x16));
}
