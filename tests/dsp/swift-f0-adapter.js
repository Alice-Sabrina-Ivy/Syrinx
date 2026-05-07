// swift-f0-adapter.js — Node-side SwiftF0 inference adapter for the
// pitch-bucket harness. Loads the bundled ONNX model via onnxruntime-node,
// resamples corpus audio to 16 kHz via linear interpolation, runs inference,
// and exposes per-frame pitch + confidence + timestamp.
//
// Stage 3.1 of the SwiftF0 + Syrinx investigation. Validation only — this
// adapter is NOT a production worker. Production integration would mirror
// gender-worker.js and route through onnxruntime-web in the browser.
//
// Model spec (from upstream swift_f0/core.py):
//   Sample rate:    16 kHz
//   Frame length:   1024 samples (64 ms)
//   Hop size:       256 samples (16 ms)
//   STFT padding:   384 samples symmetric
//   Center offset:  127.5 samples (timestamp of first frame's center)
//   Frequency:      46.875 Hz – 2093.75 Hz (strict)
//   Confidence:     scalar per frame, default voicing threshold 0.9
//   Outputs:        [0] = pitch_hz (n_frames,)  [1] = confidence (n_frames,)

import * as ort from "onnxruntime-node";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const MODEL_PATH = join(ROOT, "tests/dsp/data/swift-f0/model.onnx");

// Model constants — must match swift_f0/core.py.
export const SWIFT_F0_SAMPLE_RATE = 16000;
export const SWIFT_F0_FRAME_LENGTH = 1024;
export const SWIFT_F0_HOP_LENGTH = 256;
export const SWIFT_F0_STFT_PADDING = (SWIFT_F0_FRAME_LENGTH - SWIFT_F0_HOP_LENGTH) / 2; // 384
export const SWIFT_F0_MIN_AUDIO = 256;
export const SWIFT_F0_CENTER_OFFSET = (SWIFT_F0_FRAME_LENGTH - 1) / 2 - SWIFT_F0_STFT_PADDING; // 127.5
export const SWIFT_F0_HOP_MS = SWIFT_F0_HOP_LENGTH * 1000 / SWIFT_F0_SAMPLE_RATE; // 16.0
export const SWIFT_F0_FIRST_FRAME_MS = SWIFT_F0_CENTER_OFFSET * 1000 / SWIFT_F0_SAMPLE_RATE; // 7.96875
export const SWIFT_F0_DEFAULT_CONF_THRESHOLD = 0.9;

// ---------------------------------------------------------------------------
//  Resampling — linear interpolation, mirrors gender-worker's pattern.
//  Speech energy above 8 kHz is minimal and the corpus material is already
//  band-limited; a polyphase FIR isn't necessary for validation purposes.
// ---------------------------------------------------------------------------

export function resampleLinear(samples, srIn, srOut) {
  if (srIn === srOut) return samples;
  const ratio = srOut / srIn;
  const n = Math.floor(samples.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const srcF = i / ratio;
    const i0 = Math.floor(srcF);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const t = srcF - i0;
    out[i] = samples[i0] * (1 - t) + samples[i1] * t;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Session lifecycle
// ---------------------------------------------------------------------------

let _session = null;
let _inputName = null;

export async function createSwiftF0Session() {
  if (_session) return { session: _session, inputName: _inputName };
  if (!existsSync(MODEL_PATH)) {
    throw new Error(`SwiftF0 model not found at ${MODEL_PATH}. ` +
      `Fetch with: curl -fsSL https://raw.githubusercontent.com/lars76/swift-f0/main/swift_f0/model.onnx ` +
      `-o tests/dsp/data/swift-f0/model.onnx`);
  }
  const modelBytes = readFileSync(MODEL_PATH);
  _session = await ort.InferenceSession.create(modelBytes, {
    interOpNumThreads: 1,
    intraOpNumThreads: 1,
    executionProviders: ["cpu"],
  });
  _inputName = _session.inputNames[0];
  return { session: _session, inputName: _inputName };
}

// ---------------------------------------------------------------------------
//  Inference
// ---------------------------------------------------------------------------

// Run SwiftF0 over the entire input track. Returns { pitchHz, confidence,
// timestamps } as Float32Array each, with the model's native 16 ms hop.
export async function detectPitch(session, inputName, samples, sampleRate) {
  let s = samples;
  if (sampleRate !== SWIFT_F0_SAMPLE_RATE) {
    s = resampleLinear(samples, sampleRate, SWIFT_F0_SAMPLE_RATE);
  }
  if (s.length < SWIFT_F0_MIN_AUDIO) {
    const padded = new Float32Array(SWIFT_F0_MIN_AUDIO);
    padded.set(s);
    s = padded;
  }
  // Ensure Float32Array (ort tensor needs typed array, copy to be safe).
  const input = s instanceof Float32Array ? s : new Float32Array(s);
  const tensor = new ort.Tensor("float32", input, [1, input.length]);
  const feeds = { [inputName]: tensor };
  const outputs = await session.run(feeds);
  const outNames = session.outputNames;
  // Upstream uses outputs[0][0] and outputs[1][0]; ort-node maps by name
  // but order is preserved. We also strip the leading batch dim of size 1.
  const out0 = outputs[outNames[0]];
  const out1 = outputs[outNames[1]];
  const pitchHz = stripBatch(out0);
  const confidence = stripBatch(out1);
  if (pitchHz.length !== confidence.length) {
    throw new Error(`SwiftF0 output length mismatch: pitch ${pitchHz.length} vs confidence ${confidence.length}`);
  }
  const n = pitchHz.length;
  const timestamps = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    timestamps[i] = (i * SWIFT_F0_HOP_LENGTH + SWIFT_F0_CENTER_OFFSET) / SWIFT_F0_SAMPLE_RATE;
  }
  return { pitchHz, confidence, timestamps };
}

function stripBatch(tensor) {
  const dims = tensor.dims;
  const data = tensor.data;
  if (dims.length === 2 && dims[0] === 1) {
    return data instanceof Float32Array ? data : new Float32Array(data);
  }
  if (dims.length === 1) {
    return data instanceof Float32Array ? data : new Float32Array(data);
  }
  throw new Error(`Unexpected SwiftF0 output shape: [${dims.join(",")}]`);
}

// ---------------------------------------------------------------------------
//  Time-attribution helper
// ---------------------------------------------------------------------------

// Given target time in milliseconds and SwiftF0 timestamps in seconds,
// return the index of the SwiftF0 frame nearest to target. O(1) via direct
// formula since SwiftF0's hops are uniform.
export function nearestSwiftF0Frame(targetMs, n) {
  // tFrameMs(i) = (i * 256 + 127.5) / 16 = i * 16 + 7.96875
  // Solve for i: i = round((targetMs - 7.96875) / 16)
  const i = Math.round((targetMs - SWIFT_F0_FIRST_FRAME_MS) / SWIFT_F0_HOP_MS);
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}
