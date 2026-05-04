// yin-harmonic-test.js — Synthetic regression test for the YIN
// harmonic-tripling guard in src/dsp/dsp-worker.js.
//
// The user reported pitch-trace spikes from 128 Hz up to ~380 Hz
// (3 × F0). Investigation traced this to the worker's harmonic guard
// skipping itself when CMND at the false-lock tau is already very
// small — which is exactly what happens when a formant amplifies the
// 3rd harmonic and YIN locks at tau ≈ T/3 with deep CMND there.
//
// This test synthesizes that exact failure mode and asserts the
// detector returns the true F0, not the harmonic.
//
// Usage: node tests/dsp/yin-harmonic-test.js
//
// State-contract note: detectPitch maintains HMM state across calls
// under PYIN_STAGE=2. All stimuli in this file are stationary 50 ms
// synthetic harmonic-stack signals; we use steadyStateDetect to reset
// HMM state between stimuli and feed enough warm-up frames to satisfy
// the lookback before reading output. See real-speech-test.js for the
// helper-choice contract (steadyStateDetect for stationary stimuli,
// streamingMedianDetect for real recordings).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "../../src/dsp/dsp-worker.js");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

// ============================================================
//  Worker context (pYIN — replaces inline copy of legacy detectPitch)
// ============================================================

function loadWorker(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return { ctx, detectPitch: ctx.detectPitch };
}

// Steady-state evaluation for an independent stationary stimulus.
// Reset HMM, feed (lookback+3) frames, return final result. See
// real-speech-test.js for the matching helper and rationale.
function steadyStateDetect(w, sig, sr) {
  const lookback = (typeof w.ctx.__PYIN_LOOKBACK === "number" && w.ctx.__PYIN_LOOKBACK >= 1)
    ? w.ctx.__PYIN_LOOKBACK : 4;
  const frames = lookback + 3;
  w.ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
  let result = null;
  for (let i = 0; i < frames; i++) result = w.detectPitch(sig, sr);
  return result;
}

const w48 = loadWorker(48000);

// ============================================================
//  Synthesis helpers
// ============================================================

// Glottal-pulse-ish waveform: F0 fundamental + decaying harmonic stack.
// `harmonicAmps` is an array indexed by harmonic number (h=1 = F0, h=2,
// h=3, ...). Lets us bias specific harmonics arbitrarily.
function synthesizeHarmonic(f0, sr, durationSec, harmonicAmps) {
  const N = Math.floor(sr * durationSec);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    let v = 0;
    for (let h = 1; h < harmonicAmps.length; h++) {
      const amp = harmonicAmps[h];
      if (amp === 0) continue;
      v += amp * Math.sin(2 * Math.PI * h * f0 * t);
    }
    out[i] = v;
  }
  // Normalize to avoid clipping
  let peak = 0;
  for (let i = 0; i < N; i++) if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
  if (peak > 0) {
    const scale = 0.7 / peak;
    for (let i = 0; i < N; i++) out[i] *= scale;
  }
  return out;
}

// ============================================================
//  Tests
// ============================================================

const SR = 48000;
const WINDOW_MS = 50;
const WINDOW = Math.floor(SR * WINDOW_MS / 1000);

function near(a, b, eps) {
  return Math.abs(a - b) <= eps;
}

console.log("YIN — clean fundamentals (regression: nothing should regress)");

// Each entry: F0 + a normal-ish harmonic decay (geometric).
const decay = (n) => {
  const arr = [0];
  for (let h = 1; h <= n; h++) arr.push(1 / h);
  return arr;
};

for (const f0 of [100, 130, 200, 250, 300, 440]) {
  const sig = synthesizeHarmonic(f0, SR, WINDOW_MS / 1000, decay(8));
  const detected = steadyStateDetect(w48, sig, SR);
  check(
    `clean ${f0} Hz with geometric harmonics → detected ~${f0} Hz (got ${detected?.toFixed(1)})`,
    detected != null && near(detected, f0, 1.5),
  );
}

console.log("\nYIN — formant-amplified 3rd harmonic (the user's bug)");

// A male speaker at 128 Hz with F1 near 380 Hz makes the 3rd harmonic
// (= 3 × 128 = 384 Hz) ring louder than the fundamental. We model this
// by giving harmonic 3 (and to a lesser extent 4-5) much higher
// amplitudes than the F0 itself. Without the harmonic guard, YIN locks
// at tau ≈ T/3 → 384 Hz.
{
  // F0 fundamental partly suppressed; harmonics 3-4 dominant.
  const amps = [0, 0.15, 0.3, 1.0, 0.7, 0.4, 0.2, 0.1];
  const f0 = 128;
  const sig = synthesizeHarmonic(f0, SR, WINDOW_MS / 1000, amps);
  const detected = steadyStateDetect(w48, sig, SR);
  check(
    `128 Hz with strong 3rd harmonic → detected ~128 Hz (got ${detected?.toFixed(1)})`,
    detected != null && near(detected, f0, 2),
  );
  // The bug we're fixing would have produced ~384 here.
  check(
    `…and definitely NOT ~384 Hz (got ${detected?.toFixed(1)})`,
    detected != null && Math.abs(detected - 3 * f0) > 20,
  );
}

// Also test 130 Hz with formant-amplified 2nd harmonic (the simpler
// historic case the original guard already handled).
{
  const amps = [0, 0.2, 1.0, 0.5, 0.3, 0.2, 0.1];
  const f0 = 130;
  const sig = synthesizeHarmonic(f0, SR, WINDOW_MS / 1000, amps);
  const detected = steadyStateDetect(w48, sig, SR);
  check(
    `130 Hz with strong 2nd harmonic → detected ~130 Hz (got ${detected?.toFixed(1)})`,
    detected != null && near(detected, f0, 2),
  );
}

console.log("\nYIN — clean signals must NOT be falsely halved");

// A very-pure 200 Hz sine should be detected as exactly 200, not 100.
// Pure sines used to be the case where the old `cmnd[baseTau] >= 0.01`
// skip protected against false halving from CMND noise at 2× tau. The
// new absolute-improvement check should make the same protection.
{
  const sig = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) sig[i] = 0.5 * Math.sin(2 * Math.PI * 200 * i / SR);
  const detected = steadyStateDetect(w48, sig, SR);
  check(
    `pure 200 Hz sine → detected ~200 Hz (got ${detected?.toFixed(1)})`,
    detected != null && near(detected, 200, 1),
  );
}

// Pure sine + tiny noise — historically a place where false halving
// could appear if the guard's relative threshold was too generous.
{
  const sig = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) {
    sig[i] = 0.5 * Math.sin(2 * Math.PI * 250 * i / SR) + 0.001 * (Math.random() - 0.5);
  }
  const detected = steadyStateDetect(w48, sig, SR);
  check(
    `pure 250 Hz + noise → detected ~250 Hz (got ${detected?.toFixed(1)})`,
    detected != null && near(detected, 250, 2),
  );
}

console.log("\nYIN — back-vowel-like signal (was the regression test for halving)");

// Back vowels (/u/, /o/) have low F1 (< 500 Hz) which can produce
// CMND that's marginally lower at 2×tau than at the true F0. The
// HARMONIC_IMPROVEMENT_MIN threshold should reject these "marginal"
// cases.
{
  // F0 = 110 Hz, F1 ~400 Hz, F2 ~800 Hz — a cartoon /u/.
  const amps = [0, 1.0, 0.4, 0.6, 0.3, 0.2, 0.15, 0.1];
  const f0 = 110;
  const sig = synthesizeHarmonic(f0, SR, WINDOW_MS / 1000, amps);
  const detected = steadyStateDetect(w48, sig, SR);
  check(
    `/u/-like 110 Hz → detected ~110 Hz, not 55 Hz (got ${detected?.toFixed(1)})`,
    detected != null && near(detected, f0, 2),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
