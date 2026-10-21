// firered-vad-parity-test.js — the try-out voice detector (src/dsp/firered-vad.js)
// against the screen's Python runner (noise-detector try-out, 2026-10-20).
//
// Fixture: committed public clips concatenated (tests/dsp/fixtures/
// firered-parity.json "fixture": CC0 air-conditioner noise from MS-SNSD and
// CC BY 4.0 LibriSpeech speech), rebuilt here and checked by sha256. The
// reference in that JSON was written by scripts/firered/make-parity-ref.py
// with the screen's own code (voice-detector branch: offtheshelf/firered/
// firered.py, offtheshelf/common.py smooth, score.py hop_probs + voice_flags).
//
// Checks
//   A  front end (always): the JS Kaldi log-mel fbank equals the runner's on
//      every 20th frame (max |delta| <= 2e-3, before CMVN: cmvn.ark is not
//      committed; CMVN is covered by C), with the frame count; two broken
//      front ends (no pre-emphasis; samples not scaled to the int16 range)
//      must FAIL the same comparison;
//   B  gate (always): the JS R1 h gate (w5, p >= 0.55, 2 s hangover) on the
//      runner's probabilities, fed hop by hop as the worker feeds it, equals
//      score.py's per-hop score and decision on every hop;
//   C  model (when public/models/firered/ holds the pinned files — run
//      `node scripts/fetch-firered-model.mjs`; skipped with a notice
//      otherwise): onnxruntime-web WASM (the bundle and .wasm the app ships)
//      through createVoiceDetector, hop by hop: per-frame probabilities
//      within 1e-3 of the runner's, the gate decision equal to score.py's on
//      every hop, also when the model arrives late (backlog replay); the
//      broken front end must move the probabilities past 1e-3.
//
//   node tests/dsp/firered-vad-parity-test.js

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FIRERED_MODEL, FBANK, parseKaldiCmvn, createFireRedFrontend, createVoiceGate,
  createFireRedRunner, createVoiceDetector,
} from "../../src/dsp/firered-vad.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REF = JSON.parse(readFileSync(path.join(repo, "tests/dsp/fixtures/firered-parity.json"), "utf8"));
const FEAT_TOL = 2e-3;
const PROB_TOL = 1e-3;
const HOP = 400; // samples per pitch-worker chunk at 16 kHz (25 ms)

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

function readWav16(rel) {
  const b = readFileSync(path.join(repo, rel));
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") {
      if (!fmt || fmt.ch !== 1 || fmt.sr !== 16000 || fmt.bits !== 16) throw new Error(`${rel}: expected 16 kHz mono 16-bit`);
      return new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + size));
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`${rel}: no data chunk`);
}

// ---- the fixture stream
const parts = REF.fixture.map((s) => readWav16(s.file).subarray(Math.round(s.start_s * 16000), Math.round(s.end_s * 16000)));
const pcm = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
{ let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; } }
const x16 = Float32Array.from(pcm, (v) => v / 32768);
const nHops = Math.floor(x16.length / HOP);
console.log(`fixture: ${(x16.length / 16000).toFixed(2)} s, ${nHops} hops, ${REF.frames} frames`);
check("fixture rebuilt bit for bit (sha256 of the int16 stream)",
  createHash("sha256").update(Buffer.from(pcm.buffer)).digest("hex") === REF.pcm_sha256);

// The model files (not committed): public/models/firered/, fetched by
// scripts/fetch-firered-model.mjs. Parts A and B do not need them.
const MODEL_DIR = path.join(repo, "public", FIRERED_MODEL.dir);
const fileOk = (f) => {
  const p = path.join(MODEL_DIR, f.name);
  if (!existsSync(p)) return false;
  const b = readFileSync(p);
  return b.length === f.bytes && createHash("sha256").update(b).digest("hex") === f.sha256;
};
const [onnxSpec, cmvnSpec] = ["onnx", "cmvn"].map((k) => FIRERED_MODEL.files.find((f) => f.key === k));
const haveModel = fileOk(cmvnSpec) && fileOk(onnxSpec);

// ---- A: front end
function hopFeatures(frontendOpts, cmvn = null) {
  const fe = createFireRedFrontend(cmvn, frontendOpts);
  const feats = [];
  for (let k = 0; k < nHops; k++) for (const f of fe.push(x16.subarray(k * HOP, (k + 1) * HOP))) feats.push(f);
  return feats;
}
const refB = Buffer.from(REF.logmel_f32_b64, "base64");
const refFeat = new Float32Array(refB.buffer.slice(refB.byteOffset, refB.byteOffset + refB.length));
function featDelta(feats) {
  let d = 0;
  REF.feat_frames.forEach((fi, j) => {
    for (let b = 0; b < FBANK.numMel; b++) d = Math.max(d, Math.abs(feats[fi][b] - refFeat[j * FBANK.numMel + b]));
  });
  return d;
}
console.log("\nA. front end (Kaldi log-mel fbank) vs the runner");
const feats = hopFeatures();
check("frame count", feats.length === REF.frames, `${feats.length} vs ${REF.frames}`);
const dFeat = featDelta(feats);
check(`log-mel within ${FEAT_TOL} on ${REF.feat_frames.length} frames`, dFeat <= FEAT_TOL, `max |delta| ${dFeat.toExponential(2)}`);
const BROKEN = {
  "no pre-emphasis": { params: { preemph: 0 } },
  "samples not scaled to int16": { params: { scale: 1 } },
};
for (const [name, opts] of Object.entries(BROKEN)) {
  const d = featDelta(hopFeatures(opts));
  check(`a broken front end fails the comparison (${name})`, d > FEAT_TOL, `max |delta| ${d.toFixed(3)}`);
}

// ---- B: gate on the runner's probabilities, hop by hop as the worker feeds it
function gateOverHops(probsOf, framesAtHop) {
  const g = createVoiceGate();
  let added = 0;
  const out = [];
  for (let k = 0; k < nHops; k++) {
    while (added < framesAtHop[k]) g.addFrame(probsOf[added++]);
    out.push(g.hop(((k + 1) * HOP) / 16000));
  }
  return out;
}
// frames whose 400 samples have arrived by the end of hop k
const framesAtHop = Array.from({ length: nHops }, (_, k) => {
  const n = (k + 1) * HOP;
  return n < FBANK.frameLength ? 0 : Math.floor((n - FBANK.frameLength) / FBANK.frameShift) + 1;
});
console.log("\nB. gate (w5, p >= 0.55, 2000 ms) on the runner's probabilities vs score.py");
const refGate = REF.gate["25"];
const gB = gateOverHops(REF.probs, framesAtHop);
const pMismatch = gB.filter((h, k) => h.p !== refGate.hop_p[k]).length;
const vMismatch = gB.filter((h, k) => (h.voice ? "1" : "0") !== refGate.voice[k]).length;
check("per-hop smoothed score equals score.py's hop_probs (bit for bit)", pMismatch === 0, `${pMismatch} hops differ`);
check("per-hop decision equals score.py's voice_flags", vMismatch === 0,
  `${vMismatch} of ${nHops} hops differ; voice on ${refGate.voice.split("").filter((c) => c === "1").length} hops`);
check("the fixture exercises both decisions and the hangover running out",
  /1+0+1+0+/.test(refGate.voice) || /0+1+0+/.test(refGate.voice));

// ---- C: the model through onnxruntime-web
if (!haveModel) {
  console.log("\nC. SKIPPED: public/models/firered/ lacks the pinned model files (run `node scripts/fetch-firered-model.mjs`)");
} else {
  console.log("\nC. onnxruntime-web WASM through createVoiceDetector, hop by hop");
  const DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
  const ort = await import(pathToFileURL(path.join(DIST, "ort.wasm.bundle.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(path.join(DIST, "ort-wasm-simd-threaded.wasm"));
  const session = await ort.InferenceSession.create(readFileSync(path.join(MODEL_DIR, onnxSpec.name)), { executionProviders: ["wasm"] });
  const cmvn = parseKaldiCmvn(readFileSync(path.join(MODEL_DIR, cmvnSpec.name)));
  check("cmvn.ark parsed: 80 means, finite inverse std", cmvn.dim === 80 && [...cmvn.istd].every((v) => Number.isFinite(v) && v > 0));

  // A recording runner: the production runner, keeping every probability.
  const recording = () => {
    const r = createFireRedRunner(ort, session);
    const probs = [];
    return { probs, runner: { async run(fr) { const p = await r.run(fr); probs.push(...p); return p; }, reset: r.reset } };
  };
  async function runDetector({ readyAtHop = 0 } = {}) {
    const det = createVoiceDetector();
    const rec = recording();
    const out = [];
    for (let k = 0; k < nHops; k++) {
      if (k === readyAtHop) det.setModel({ runner: rec.runner, cmvn });
      det.pushAudio(x16.subarray(k * HOP, (k + 1) * HOP));
      out.push(det.ready ? await det.hop(((k + 1) * HOP) / 16000) : det.noteHop(((k + 1) * HOP) / 16000));
    }
    return { out, probs: rec.probs };
  }

  const live = await runDetector();
  check("every frame scored", live.probs.length === REF.frames, `${live.probs.length} vs ${REF.frames}`);
  let dP = 0;
  for (let i = 0; i < REF.frames; i++) dP = Math.max(dP, Math.abs(live.probs[i] - REF.probs[i]));
  check(`per-frame probabilities within ${PROB_TOL} of the runner's`, dP <= PROB_TOL, `max |delta| ${dP.toExponential(2)}`);
  const vC = live.out.filter((h, k) => (h.voice ? "1" : "0") !== refGate.voice[k]).length;
  check("per-hop decision equals score.py's on every hop (model live from the first hop)", vC === 0, `${vC} hops differ`);

  // Model ready only after 1.5 s: hops before get no decision; after it, the
  // replayed state gives the same decisions as a run from stream start.
  const late = await runDetector({ readyAtHop: 60 });
  check("before the model is ready: no decision (display not gated)", late.out.slice(0, 60).every((h) => h === null));
  const vL = late.out.slice(60).filter((h, k) => (h.voice ? "1" : "0") !== refGate.voice[60 + k]).length;
  check("model ready late (hop 60): later decisions equal score.py's (backlog replayed)", vL === 0, `${vL} hops differ`);

  // The broken front end through the model: the probabilities move past the tolerance.
  for (const [name] of Object.entries(BROKEN)) {
    const r = createFireRedRunner(ort, session);
    const bf = hopFeatures(BROKEN[name], cmvn);
    const pb = [];
    for (let a = 0; a < bf.length; a += 100) pb.push(...await r.run(bf.slice(a, a + 100)));
    let d = 0;
    for (let i = 0; i < REF.frames; i++) d = Math.max(d, Math.abs(pb[i] - REF.probs[i]));
    check(`a broken front end fails the probability check (${name})`, d > PROB_TOL, `max |delta| ${d.toFixed(3)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
