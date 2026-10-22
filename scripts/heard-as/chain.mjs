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
//      silence floor on the window peak; the classifier runs on a scored
//      window only every ML_CLASSIFY_HOP_MS (audio-utils classifyDue: 450 ms
//      since 2026-10-07, measurements/heard-as-cpu-2026-10-07.md; option
//      classifyHopMs, 150 = every scored decision as before);
//   2b. optional (option `speech`): the speech detector exactly as the gender
//      worker's handleChunk feeds it — after the relayed pitch hints, the
//      chunk's 16 kHz samples (the same resampler output that fills the ring)
//      go through createSpeechFramer; each 32 ms frame's probability goes to
//      gate.noteSpeech before the decision. `speech` = { framer, run: async
//      (input) => p } (createSileroRunner) or { probs: [p, ...] } (recorded
//      probabilities, frame i = the i-th framer output — the CI fixture).
//      Omitted = the gate's pitch-voicing path (detector loading / failed).
//      measurements/heard-as-voiced-windows-2026-10-08.md;
//   3. (callers) each classified window through the deployed classifier ->
//      femaleLogitFromResult, then src/ml/heard-as.js (scored windows the
//      classifier skipped go in with classified: false).
// No ONNX here: replay() returns the scored windows' audio and the posted
// pitch so the window-set guard can run in CI without the model.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createStreamingResampler, RingWindow, SilenceTracker, windowPeak, TARGET_SAMPLE_RATE, ML_DECISION_HOP_MS, ML_CLASSIFY_HOP_MS, classifyDue } = await imp("src/ml/audio-utils.js");
const { createUtteranceGate, decideMlWindow } = await imp("src/ml/utterance-gate.js");
const { createSpeechFramer, createSileroRunner, SPEECH_DETECTOR, sha256Hex } = await imp("src/ml/speech-detector.js");

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
export const ML_HOP_MS = ML_DECISION_HOP_MS;

/**
 * y: Float32Array at `sr`; chunk: samples per capture chunk (default 25 ms).
 * burstMs (measurement only): chunks reach the ML worker in bursts, one per
 *   hardware buffer of this length, plus 0-jitterMs of scheduling jitter;
 *   the worker's 150 ms hop is timed on that arrival ("wall") clock as in
 *   the app (performance.now()), not on the audio clock. 0 = no bursts.
 * classifyHopMs: the worker's classifier hop (audio-utils classifyDue; the
 *   production ML_CLASSIFY_HOP_MS by default; 150 = every scored decision,
 *   the pre-2026-10-07 schedule). Decisions stay on the 150 ms tick.
 * -> { pitch: [[audioMs, f0 (0 = unvoiced)]],
 *      windows: [{ audioMs, mode, spanId, classify, win: Float32Array | null }] (every SCORED
 *        window; classify = the classifier runs on it, win only then),
 *      decisions: number, ticks: [[audioMs, voiceState, scored (0/1), classified (0/1)]] }
 */
export async function replay(y, { sr = 48000, chunk = Math.round(sr * 0.025), burstMs = 0, jitterMs = 0, seed = 1, classifyHopMs = ML_CLASSIFY_HOP_MS, speech = null } = {}) {
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
    let lastClassifyMs = null;
    const ticks = [];
    let relay = [];
    const pitch = [];
    const windows = [];
    let decisions = 0;
    const framer = speech ? (speech.framer ?? createSpeechFramer()) : null;
    framer?.reset();
    const probs = [];        // every speech probability fed to the gate, in order
    for (let s = 0; s < y.length; s += chunk) {
      const e = Math.min(y.length, s + chunk);
      const x = y.slice(s, e);
      const ct = e / sr;
      // ML worker: relayed hints first (posted while the previous chunk was processed)
      for (const m of relay) gate.notePitchHint({ voiced: m.voiced, pitch: m.pitch, ts: m.contextTime * 1000 });
      relay = [];
      const audioNowMs = ct * 1000;
      const wallMs = burstMs > 0 ? Math.ceil(audioNowMs / burstMs - 1e-9) * burstMs + jitterMs * rand() : audioNowMs;
      const x16 = resample(x);
      ring.append(x16);
      if (framer) {
        for (const f of framer.push(x16, audioNowMs)) {
          let p;
          if (speech.probs) {
            p = speech.probs[probs.length];
            if (typeof p !== "number") throw new Error(`recorded speech probabilities ran out at frame ${probs.length}`);
          } else p = await speech.run(f.input);
          probs.push(p);
          gate.noteSpeech({ ts: f.ts, p });
        }
      }
      if (ring.isFull() && wallMs - lastInferMs >= ML_HOP_MS - 1e-6) {
        const win = ring.snapshot();
        const d = decideMlWindow({ gate, audioNowMs, peak: windowPeak(win), lastGateMode, silenceTracker: silence });
        lastGateMode = d.mode;
        lastInferMs = wallMs;
        decisions++;
        const classify = d.score && classifyDue(wallMs, lastClassifyMs, classifyHopMs);
        if (classify) lastClassifyMs = wallMs;
        if (d.score) windows.push({ audioMs: audioNowMs, mode: d.mode, spanId: d.spanId, classify, win: classify ? win : null });
        ticks.push([audioNowMs, d.voiceState, d.score ? 1 : 0, classify ? 1 : 0]);
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
    return { pitch, windows, decisions, ticks, speechProbs: framer ? probs : null };
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

/**
 * The speech detector in Node: onnxruntime-web (WASM, 1 thread — the browser
 * runtime) on the pinned Silero file at `modelPath` (sha256 checked against
 * SPEECH_DETECTOR.modelSha256). -> () => { framer, run, reset } — one fresh
 * framer + LSTM state per stream, as the worker has per start.
 */
export async function loadSpeechDetector(modelPath) {
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(modelPath);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if ((await sha256Hex(ab)) !== SPEECH_DETECTOR.modelSha256) throw new Error(`${modelPath}: not the pinned Silero model`);
  const ort = await import(pathToFileURL(path.join(repo, "node_modules/onnxruntime-web/dist/ort.node.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(new Uint8Array(ab), { executionProviders: ["wasm"] });
  return () => {
    const runner = createSileroRunner(ort, session);
    return { framer: createSpeechFramer(), run: (input) => runner.run(input) };
  };
}
