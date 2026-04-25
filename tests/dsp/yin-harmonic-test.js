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
// Follows the inline-copy pattern of tests/dsp/accuracy-test.js — keeps
// the YIN/FFT code self-contained so we can test it without spinning
// up the worker. The implementation here MUST stay in sync with
// dsp-worker.js.

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
//  DSP — exact copies from src/dsp/dsp-worker.js
// ============================================================

function fft(re, im) {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, got ${n}`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wkRe = 1, wkIm = 0;
      for (let k = 0; k < half; k++) {
        const tre = wkRe * re[i + k + half] - wkIm * im[i + k + half];
        const tim = wkRe * im[i + k + half] + wkIm * re[i + k + half];
        re[i + k + half] = re[i + k] - tre;
        im[i + k + half] = im[i + k] - tim;
        re[i + k] += tre;
        im[i + k] += tim;
        const nwRe = wkRe * wRe - wkIm * wIm;
        const nwIm = wkRe * wIm + wkIm * wRe;
        wkRe = nwRe;
        wkIm = nwIm;
      }
    }
  }
}

// detectPitch — kept structurally identical to dsp-worker.js, with the
// same harmonic guard logic. If you change the worker, mirror it here.
function detectPitch(buffer, sr) {
  const threshold = 0.20;
  const minF0 = 75;
  const maxF0 = 600;
  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.floor(sr / minF0);
  const halfLen = Math.floor(buffer.length / 2);
  const searchLen = Math.min(maxLag + 2, halfLen);

  if (maxLag >= halfLen) return null;

  const N = buffer.length;
  let fftLen = 1;
  while (fftLen < N * 2) fftLen <<= 1;

  const re = new Float64Array(fftLen);
  const im = new Float64Array(fftLen);
  for (let i = 0; i < N; i++) re[i] = buffer[i];

  fft(re, im);
  for (let i = 0; i < fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im);

  const diff = new Float32Array(searchLen);
  const cumSq = new Float64Array(N + 1);
  cumSq[0] = 0;
  for (let i = 0; i < N; i++) cumSq[i + 1] = cumSq[i] + buffer[i] * buffer[i];

  diff[0] = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    const autocorr = re[tau] / fftLen;
    diff[tau] = cumSq[N - tau] + (cumSq[N] - cumSq[tau]) - 2 * autocorr;
  }

  const cmnd = new Float32Array(searchLen);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, searchLen); tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < searchLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }
  if (bestTau === -1) return null;

  // Harmonic guard — mirror of the dsp-worker.js logic.
  const HARMONIC_IMPROVEMENT_MIN = 0.003;
  const baseTau = bestTau;
  const bestFreq = sr / baseTau;
  const maxMult = bestFreq > 300 ? 4 : 2;
  let correctedTau = -1;
  let correctedCmnd = Infinity;
  for (let mult = 2; mult <= maxMult; mult++) {
    const multiTau = baseTau * mult;
    if (multiTau + 1 >= searchLen || multiTau >= maxLag) break;
    const searchStart = Math.max(minLag, Math.floor(multiTau * 0.9));
    const searchEnd = Math.min(Math.ceil(multiTau * 1.1), searchLen - 1, maxLag);
    let minCmndVal = Infinity;
    let minTau = -1;
    for (let tau = searchStart; tau <= searchEnd; tau++) {
      if (cmnd[tau] < minCmndVal) {
        minCmndVal = cmnd[tau];
        minTau = tau;
      }
    }
    if (minTau === -1) continue;
    const absOk = minCmndVal < 0.15;
    const improvementOk = (cmnd[baseTau] - minCmndVal) >= HARMONIC_IMPROVEMENT_MIN;
    if (absOk && improvementOk && minCmndVal < correctedCmnd) {
      correctedTau = minTau;
      correctedCmnd = minCmndVal;
    }
  }
  if (correctedTau !== -1) bestTau = correctedTau;

  // Step 4: Parabolic interpolation
  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < searchLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  let refinedTau = denom !== 0 ? bestTau + (s0 - s2) / denom : bestTau;

  const minTauVal = sr / maxF0;
  const maxTauVal = sr / minF0;
  refinedTau = Math.max(minTauVal, Math.min(maxTauVal, refinedTau));

  return sr / refinedTau;
}

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
  const detected = detectPitch(sig, SR);
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
  const detected = detectPitch(sig, SR);
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
  const detected = detectPitch(sig, SR);
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
  const detected = detectPitch(sig, SR);
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
  const detected = detectPitch(sig, SR);
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
  const detected = detectPitch(sig, SR);
  check(
    `/u/-like 110 Hz → detected ~110 Hz, not 55 Hz (got ${detected?.toFixed(1)})`,
    detected != null && near(detected, f0, 2),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
