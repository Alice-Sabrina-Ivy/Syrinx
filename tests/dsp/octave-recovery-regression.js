// octave-recovery-regression.js — Regression guard for the pYIN HMM
// octave-lock fix (mixture transition prior, α=0.0001). Streams the
// octave-step-200-then-400.wav fixture through detectPitch and asserts
// that the HMM emerges from the wrong-octave lock at 200 Hz to the
// correct 400 Hz state within RECOVERY_BUDGET frames after the input
// step at t=2 s. With the production α=0.0001 the HMM recovers in
// ≤ 6 frames; the budget allows margin for future tuning. Without
// the mixture (α=0) the HMM takes ~10 frames — the test would fail,
// catching any accidental revert of the fix.
//
// Run: node tests/dsp/octave-recovery-regression.js

import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "../../src/dsp/dsp-worker.js");
const FIXTURE_PATH = join(__dirname, "../../tests/audio/fixtures/octave-step-200-then-400.wav");

const RECOVERY_BUDGET = 8;       // frames; production typically 6, margin to 8
const STEP_TIME_SEC = 2.0;       // octave-step fixture transitions here
const CORRECT_THRESHOLD_HZ = 350; // ≥350 Hz = correct-octave (vs ~200 lock)

function loadWorker(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = { self: { postMessage() {}, onmessage: null }, performance: { now: () => 0, timeOrigin: 0 }, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
}

function readWav(path) {
  const buf = readFileSync(path);
  const sr = buf.readUInt32LE(24);
  const N = buf.readUInt32LE(40) / 2;
  const samples = new Float32Array(N);
  for (let i = 0; i < N; i++) samples[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return { samples, sr };
}

const ctx = loadWorker(16000);
const { samples, sr } = readWav(FIXTURE_PATH);
ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });

const winN = Math.floor(sr * 50 / 1000);
const hopN = Math.floor(sr * 25 / 1000);

let recoveryFrame = null;
let frameIdx = 0;
let stepFrameIdx = null;
for (let i = 0; i + winN <= samples.length; i += hopN) {
  const tSec = (i + winN) / sr;
  const r = ctx.detectPitch(samples.subarray(i, i + winN), sr);
  if (stepFrameIdx === null && tSec >= STEP_TIME_SEC) stepFrameIdx = frameIdx;
  if (stepFrameIdx !== null && recoveryFrame === null && r !== null && r >= CORRECT_THRESHOLD_HZ) {
    recoveryFrame = frameIdx - stepFrameIdx;
    break;
  }
  frameIdx++;
}

if (recoveryFrame === null) {
  console.error(`FAIL: HMM never recovered to ≥${CORRECT_THRESHOLD_HZ} Hz after the step`);
  process.exit(1);
}
if (recoveryFrame > RECOVERY_BUDGET) {
  console.error(`FAIL: HMM took ${recoveryFrame} frames to recover, budget is ${RECOVERY_BUDGET}`);
  console.error(`This typically means the α-mixture transition prior was reverted.`);
  console.error(`See src/dsp/dsp-worker.js _PYIN_ALPHA_DEFAULT and measurements/octave-lock-investigation-2026-05-05.md.`);
  process.exit(1);
}

console.log(`pass — HMM recovered from octave lock in ${recoveryFrame} frames (budget ${RECOVERY_BUDGET})`);
