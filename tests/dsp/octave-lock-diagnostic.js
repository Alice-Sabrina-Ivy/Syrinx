// octave-lock-diagnostic.js — Reproduce the rapid-sweep octave-lock bug
// offline (no Chrome harness needed) and probe the HMM forward variables
// to characterize the failure mode.
//
// Loads the worker into a vm.createContext so we can read _PYIN_LOG_ALPHA
// directly between detectPitch() calls. Streams the chirp fixture through
// the HMM at 25 ms hop and prints, per frame:
//   t, true_input_freq, returned_pitch, voicedness, top-3 voiced-state
//   alpha values (with their corresponding Hz).
//
// Usage: node tests/dsp/octave-lock-diagnostic.js [path-to-wav]

import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "../../src/dsp/dsp-worker.js");
const WAV_PATH = process.argv[2] ??
  join(__dirname, "../../tests/audio/fixtures/chirp-100-400hz-then-steady.wav");

function loadWorker(sampleRate) {
  // Worker uses const/let at script top level, which don't bind to
  // globalThis in vm contexts. Append a probe function that has lexical
  // access to the HMM internals and exposes them on globalThis.
  const src = readFileSync(WORKER_PATH, "utf8") +
    `\nglobalThis.__probeHMM = function() {
       return {
         logAlpha: _PYIN_LOG_ALPHA,
         frameIdx: _pyinFrameIdx,
         voicedness: _pyinLastVoicedness,
         voicednessObs: _pyinLastVoicednessObs,
         N_PITCH: _PYIN_N_PITCH,
         N_STATES: _PYIN_N_STATES,
       };
     };\n`;
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
}

function readWav(path) {
  const buf = readFileSync(path);
  // Parse minimal WAV header (we control the generator — assume PCM mono int16).
  const sr = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}`);
  const dataOffset = 44;
  const dataSize = buf.readUInt32LE(40);
  const nSamples = dataSize / 2;
  const samples = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return { samples, sr };
}

// True input is fixture-specific; for diagnostics we just print "?" since
// we don't always have the per-time formula at hand. The interesting bit
// is the steady portion at the END of each fixture being 400 Hz.
function trueInputHzAt(tSec) { return NaN; }

function stateToHz(s) {
  return 75 * Math.pow(2, s / 100);
}

const ctx = loadWorker(16000);
const { samples, sr } = readWav(WAV_PATH);
console.log(`# Loaded ${samples.length} samples @ ${sr} Hz, ${(samples.length / sr).toFixed(2)} s`);
console.log(`# Worker config: PYIN_STAGE=2 σ=50 cents L=4`);

// Reset HMM state.
ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });

const winN = Math.floor(sr * 50 / 1000);   // 50 ms window
const hopN = Math.floor(sr * 25 / 1000);   // 25 ms hop
const N_PITCH = 300;

console.log("# t_sec  true_in  returned  voicedness   top1(Hz, logα)        top2                   top3");

let lockedAt = null;
let firstLockedFrame = null;
let frameIdx = 0;
for (let i = 0; i + winN <= samples.length; i += hopN) {
  const win = samples.subarray(i, i + winN);
  const tSec = (i + winN) / sr;
  const r = ctx.detectPitch(win, sr);

  // Reach into the worker's HMM forward variables via the probe.
  const probe = ctx.__probeHMM();
  const t = probe.frameIdx - 1;
  const curOff = (t & 1) * probe.N_STATES;
  const alpha = probe.logAlpha;
  const topK = [];
  for (let s = 0; s < N_PITCH; s++) {
    topK.push({ s, a: alpha[curOff + s] });
  }
  topK.sort((a, b) => b.a - a.a);
  const t1 = topK[0], t2 = topK[1], t3 = topK[2];

  const voicedness = probe.voicedness;
  const trueIn = trueInputHzAt(tSec);
  const rStr = r === null ? "null" : r.toFixed(1);

  // Detect lock: returned pitch < 0.7 × true input AND we're in the steady
  // portion (true input is constant 400 Hz).
  if (r !== null && tSec > 4.5 && r < 280 && firstLockedFrame === null) {
    firstLockedFrame = frameIdx;
    lockedAt = r;
  }

  console.log(
    `${tSec.toFixed(3).padStart(7)}  ${trueIn.toFixed(1).padStart(6)}   ${rStr.padStart(7)}   ` +
    `${(voicedness ?? 0).toFixed(3)}   ` +
    `(${stateToHz(t1.s).toFixed(1)}, ${t1.a.toFixed(2)})   ` +
    `(${stateToHz(t2.s).toFixed(1)}, ${t2.a.toFixed(2)})   ` +
    `(${stateToHz(t3.s).toFixed(1)}, ${t3.a.toFixed(2)})`
  );
  frameIdx++;
}

console.log("");
if (firstLockedFrame !== null) {
  console.log(`# OCTAVE LOCK REPRODUCED — frame ${firstLockedFrame} returned ${lockedAt.toFixed(1)} Hz with steady-400 Hz input`);
} else {
  console.log("# No octave lock observed in this run.");
}
