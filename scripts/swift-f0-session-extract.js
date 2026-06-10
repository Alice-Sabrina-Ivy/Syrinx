// swift-f0-session-extract.js — SwiftF0 streaming pitch contours for the
// low-F0 field-accuracy investigation (2026-06-09).
//
// Runs the production pitch-worker streaming simulation (25 ms chunks,
// rolling 1024-sample buffer at 16 kHz, per-chunk inference; mirrors
// src/dsp/pitch-worker.js exactly like swift-f0-streaming-verify.js
// does) over one or more 16 kHz 16-bit PCM mono WAVs and writes
// per-frame {tAttrMs, pitch, confidence} contours to JSON for
// comparison against Praat reference contours on the same audio.
//
// Usage: node scripts/swift-f0-session-extract.js OUT.json WAV [WAV...]

import { readFileSync, writeFileSync } from "node:fs";
import {
  createSwiftF0Session,
  resampleLinear,
  SWIFT_F0_SAMPLE_RATE,
  SWIFT_F0_FRAME_LENGTH,
} from "../tests/dsp/swift-f0-adapter.js";
import * as ort from "onnxruntime-node";

const CONFIDENCE_THRESHOLD = 0.5;
const HOP_MS = 25;
// SwiftF0 reports pitch for the audio centered ~56 ms before the latest
// buffered sample (see swift-f0-streaming-verify.js).
const PITCH_LATENCY_MS = (SWIFT_F0_FRAME_LENGTH - 127.5) / SWIFT_F0_SAMPLE_RATE * 1000;

function readWav(filePath) {
  const buf = readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("Not a RIFF file");
  if (buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAVE file");
  let offset = 12, sampleRate = 0, bitsPerSample = 0, dataStart = 0, dataSize = 0;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataStart = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }
  if (dataStart === 0) throw new Error("No data chunk");
  if (bitsPerSample !== 16) throw new Error(`Expected 16-bit PCM, got ${bitsPerSample}`);
  const n = Math.floor(dataSize / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return { samples, sampleRate };
}

const outPath = process.argv[2];
const wavs = process.argv.slice(3);

console.log("Loading SwiftF0 model …");
const { session } = await createSwiftF0Session();
const inputName = session.inputNames[0];

const buffer = new Float32Array(SWIFT_F0_FRAME_LENGTH);
let fill = 0;
function append(incoming) {
  const k = incoming.length;
  if (k === 0) return;
  if (k >= SWIFT_F0_FRAME_LENGTH) {
    buffer.set(incoming.subarray(k - SWIFT_F0_FRAME_LENGTH));
    fill = SWIFT_F0_FRAME_LENGTH;
    return;
  }
  buffer.copyWithin(0, k, SWIFT_F0_FRAME_LENGTH);
  buffer.set(incoming, SWIFT_F0_FRAME_LENGTH - k);
  fill = Math.min(SWIFT_F0_FRAME_LENGTH, fill + k);
}

const files = [];
for (const wav of wavs) {
  console.log(`streaming ${wav} ...`);
  const { samples, sampleRate } = readWav(wav);
  buffer.fill(0); fill = 0;
  const hopN = Math.floor(sampleRate * HOP_MS / 1000);
  const hopMs = hopN * 1000 / sampleRate;
  const tAttr0Ms = hopMs - PITCH_LATENCY_MS; // attribution time of frame n is tAttr0Ms + n*hopMs
  const pitch = [];   // Hz, 0 = below confidence gate
  const conf = [];
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i + hopN <= samples.length; i += hopN, n++) {
    const chunk = samples.subarray(i, i + hopN);
    append(sampleRate === SWIFT_F0_SAMPLE_RATE ? chunk : resampleLinear(chunk, sampleRate, SWIFT_F0_SAMPLE_RATE));
    if (fill < SWIFT_F0_FRAME_LENGTH) { pitch.push(0); conf.push(0); continue; }
    const tensor = new ort.Tensor("float32", buffer, [1, SWIFT_F0_FRAME_LENGTH]);
    const outputs = await session.run({ [inputName]: tensor });
    const p = outputs[session.outputNames[0]].data[0];
    const c = outputs[session.outputNames[1]].data[0];
    pitch.push(c >= CONFIDENCE_THRESHOLD ? +p.toFixed(2) : 0);
    conf.push(+c.toFixed(3));
  }
  const reported = pitch.filter((v) => v > 0);
  console.log(`  ${n} hops, ${reported.length} reported (${(100 * reported.length / n).toFixed(1)}%) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  files.push({ path: wav, hopMs, tAttr0Ms, pitch, conf });
}

writeFileSync(outPath, JSON.stringify({
  config: {
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    hopMs: HOP_MS,
    pitchLatencyMs: PITCH_LATENCY_MS,
    method: "production streaming sim (pitch-worker.js semantics)",
  },
  files,
}));
console.log(`saved ${outPath}`);
