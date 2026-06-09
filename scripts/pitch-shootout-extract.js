// pitch-shootout-extract.js — Single-pass data extraction for the
// 2026-06-09 pitch-detector shootout: SwiftF0 baseline vs SwiftF0 +
// half-period referee vs frame-local Boersma AC (Praat-style).
//
// For every 25 ms hop of every input track (production streaming
// semantics — rolling 1024-sample 16 kHz buffer), records:
//   - truthHz   (corpus ground truth aligned at the attribution time,
//                or Praat-reference f0 for session WAVs)
//   - swift     (SwiftF0 reported pitch, 0 if below confidence gate)
//   - rT, rHalf (normalized autocorrelation at the lag of the SwiftF0
//                pitch and at twice that lag — i.e. the half-frequency
//                period — for post-hoc referee margin sweeps)
//   - ac        (Boersma AC frame-local pitch, 0 if unvoiced)
//
// The referee margin sweep happens entirely in the analysis script —
// the decision "halve when r(2T) > r(T) - margin" only needs (rT,
// rHalf), so one extraction pass serves every margin value.
//
// Usage:
//   node scripts/pitch-shootout-extract.js --corpora OUT.json
//   node scripts/pitch-shootout-extract.js --wav=PATH OUT.json
//
// Outputs go under build/pitch-compare/ (gitignored scratch);
// aggregates belong in measurements/ via the analysis script.

import { readFileSync, writeFileSync } from "node:fs";
import { loadAllCorpora } from "../tests/dsp/data/corpora.js";
import {
  createSwiftF0Session,
  resampleLinear,
  SWIFT_F0_SAMPLE_RATE,
  SWIFT_F0_FRAME_LENGTH,
} from "../tests/dsp/swift-f0-adapter.js";
import { createBoersmaAC, normCorrAtLag } from "../tests/dsp/boersma-ac.js";
import * as ort from "onnxruntime-node";

const CONFIDENCE_THRESHOLD = 0.5;
const HOP_MS = 25;
const PITCH_LATENCY_MS = (SWIFT_F0_FRAME_LENGTH - 127.5) / SWIFT_F0_SAMPLE_RATE * 1000;

function readWav(filePath) {
  const buf = readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("Not RIFF");
  let offset = 12, sampleRate = 0, bits = 0, dataStart = 0, dataSize = 0;
  while (offset < buf.length - 8) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") { sampleRate = buf.readUInt32LE(offset + 12); bits = buf.readUInt16LE(offset + 22); }
    else if (id === "data") { dataStart = offset + 8; dataSize = size; break; }
    offset += 8 + size;
  }
  if (bits !== 16) throw new Error(`expected 16-bit, got ${bits}`);
  const n = Math.floor(dataSize / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return { samples, sampleRate };
}

console.log("Loading SwiftF0 model …");
const { session } = await createSwiftF0Session();
const inputName = session.inputNames[0];
const ac = createBoersmaAC(SWIFT_F0_SAMPLE_RATE, SWIFT_F0_FRAME_LENGTH);

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

let acTotalMs = 0, acCalls = 0;

async function processTrack(samples, sampleRate, refLookup) {
  buffer.fill(0); fill = 0;
  const hopN = Math.floor(sampleRate * HOP_MS / 1000);
  const hopMs = hopN * 1000 / sampleRate;
  const rows = []; // [truthHz, swift, rT, rHalf, ac] per hop with valid truth
  let n = 0;
  for (let i = 0; i + hopN <= samples.length; i += hopN, n++) {
    const chunk = samples.subarray(i, i + hopN);
    append(sampleRate === SWIFT_F0_SAMPLE_RATE ? chunk : resampleLinear(chunk, sampleRate, SWIFT_F0_SAMPLE_RATE));
    if (fill < SWIFT_F0_FRAME_LENGTH) continue;
    const attrMs = (n + 1) * hopMs - PITCH_LATENCY_MS;
    if (attrMs < 0) continue;
    const truthHz = refLookup(attrMs);
    if (truthHz === null) continue; // outside reference range

    const tensor = new ort.Tensor("float32", buffer, [1, SWIFT_F0_FRAME_LENGTH]);
    const outputs = await session.run({ [inputName]: tensor });
    const p = outputs[session.outputNames[0]].data[0];
    const c = outputs[session.outputNames[1]].data[0];
    const swift = c >= CONFIDENCE_THRESHOLD ? p : 0;

    let rT = 0, rHalf = 0;
    if (swift > 0 && swift >= 100) {
      // Referee lags: period of the reported pitch and twice that
      // (the half-frequency hypothesis). Only meaningful when the
      // halved pitch stays above the ~50 Hz analysis floor.
      const lagT = Math.round(SWIFT_F0_SAMPLE_RATE / swift);
      rT = normCorrAtLag(buffer, lagT);
      rHalf = normCorrAtLag(buffer, lagT * 2);
    }

    const t0 = performance.now();
    const acOut = ac.detect(buffer);
    acTotalMs += performance.now() - t0;
    acCalls++;

    rows.push([
      +truthHz.toFixed(2),
      swift > 0 ? +swift.toFixed(2) : 0,
      +rT.toFixed(4),
      +rHalf.toFixed(4),
      acOut.pitch ? +acOut.pitch.toFixed(2) : 0,
    ]);
  }
  return rows;
}

const mode = process.argv[2];
const outPath = process.argv[process.argv.length - 1];
const out = { config: { hopMs: HOP_MS, confidenceThreshold: CONFIDENCE_THRESHOLD, acConfig: ac.config }, tracks: [] };

if (mode === "--corpora") {
  const corpora = loadAllCorpora();
  console.log(`Processing ${corpora.length} corpus tracks …`);
  const t0 = Date.now();
  let done = 0;
  for (const track of corpora) {
    const { ref } = track;
    const refLookup = (attrMs) => {
      const idx = Math.round(attrMs / ref.hopMs);
      if (idx < 0 || idx >= ref.f0.length) return null;
      return ref.f0[idx]; // 0 = unvoiced per corpus convention
    };
    const rows = await processTrack(track.samples, track.sampleRate, refLookup);
    out.tracks.push({ corpus: track.corpus, trackId: track.trackId, gender: track.gender, rows });
    if (++done % 200 === 0) console.log(`  ${done}/${corpora.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
} else if (mode.startsWith("--wav=")) {
  const wavPath = mode.slice(6);
  const praatPath = process.argv[3].startsWith("--praat=") ? process.argv[3].slice(8) : null;
  const praatDoc = JSON.parse(readFileSync(praatPath, "utf8"));
  const pf = praatDoc.files.find((f) => f.path === wavPath);
  if (!pf) throw new Error(`no praat contour for ${wavPath}`);
  const { samples, sampleRate } = readWav(wavPath);
  const refLookup = (attrMs) => {
    const idx = Math.round((attrMs / 1000 - pf.t0) / pf.dt);
    if (idx < 0 || idx >= pf.f0.length) return null;
    return pf.f0[idx];
  };
  console.log(`Processing session WAV ${wavPath} …`);
  const rows = await processTrack(samples, sampleRate, refLookup);
  out.tracks.push({ corpus: "session", trackId: wavPath.split("/").pop(), gender: "u", rows });
} else {
  throw new Error("usage: --corpora OUT.json | --wav=PATH --praat=CONTOURS.json OUT.json");
}

out.acPerFrameMs = +(acTotalMs / acCalls).toFixed(4);
console.log(`Boersma AC mean cost: ${out.acPerFrameMs} ms/frame over ${acCalls} frames`);
writeFileSync(outPath, JSON.stringify(out));
console.log(`saved ${outPath}`);
