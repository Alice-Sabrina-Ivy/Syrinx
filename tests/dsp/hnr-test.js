// hnr-test.js — regression guard for src/dsp/hnr.js (window-corrected AC HNR).
// Synthetic harmonic complex (harmonics < 7.8 kHz) + white noise at an
// exact power ratio, at the production DSP rates (44.1 / 48 kHz) and the
// production framing (70 ms frames every 25 ms). Two sources: 1/k
// amplitudes with random phases, and a zero-phase pulse train (energy
// concentrated once per period — the worst case for the window
// correction, and closest to glottal excitation). Checks accuracy vs the
// true HNR, absence of an F0 confound, and the 75 Hz search-floor edge.
// The F0 80 Hz / 25 dB cases guard the frame-length choice (a 60 ms frame
// reads ~+9 dB there; see hnr.js header).
// The pre-2026-10-03 biased-ACF version read ~7-15 dB low with a ~5 dB
// spread across 80-400 Hz and fails 100 of these 109 checks.
// measurements/hnr-window-corrected-2026-10-03.md.
// Usage: node tests/dsp/hnr-test.js
import { computeHNR } from "../../src/dsp/hnr.js";

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { let u = 0; for (let j = 0; j < 12; j++) u += r(); return u - 6; }
function stimulus(f0, sr, hnrDb, seed, pulse) {
  const r = rng(seed), n = sr, x = new Float64Array(n), K = Math.floor(7800 / f0);
  const ph = Array.from({ length: K + 1 }, () => (pulse ? Math.PI / 2 : 2 * Math.PI * r()));
  for (let k = 1; k <= K; k++) for (let i = 0; i < n; i++) x[i] += Math.sin(2 * Math.PI * k * f0 * i / sr + ph[k]) / k;
  let e = 0; for (let i = 0; i < n; i++) e += x[i] * x[i]; e /= n;
  const nz = new Float64Array(n); let en = 0; for (let i = 0; i < n; i++) { nz[i] = gauss(r); en += nz[i] * nz[i]; } en /= n;
  const g = Math.sqrt(e / en / Math.pow(10, hnrDb / 10));
  const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = x[i] + g * nz[i];
  return out;
}
function meanHnr(x, sr) {
  const ws = Math.floor(sr * 0.07), hop = Math.floor(sr * 0.025); const v = [];
  for (let e = ws; e <= x.length; e += hop) { const h = computeHNR(x.subarray(e - ws, e), sr); if (h !== null) v.push(h); }
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log(`FAIL ${name}: ${detail}`); } }
for (const sr of [44100, 48000]) {
  for (const pulse of [false, true]) {
    for (const hnr of [5, 15, 25]) {
      const errs = [];
      for (const f0 of [75, 80, 100, 130, 160, 220, 300, 400]) {
        const est = meanHnr(stimulus(f0, sr, hnr, f0 * 7 + hnr, pulse), sr);
        errs.push(est - hnr);
        check(`sr ${sr} ${pulse ? "pulse" : "1/k"} F0 ${f0} HNR ${hnr}`, Math.abs(est - hnr) <= 1.5, `estimate ${est.toFixed(2)} dB`);
      }
      const spread = Math.max(...errs) - Math.min(...errs);
      check(`sr ${sr} ${pulse ? "pulse" : "1/k"} HNR ${hnr} F0 spread`, spread <= 1.5, `error spread across F0 ${spread.toFixed(2)} dB`);
      console.log(`sr ${sr} ${pulse ? "pulse" : "1/k  "} true ${String(hnr).padStart(2)} dB: errors ${errs.map((e) => e.toFixed(2)).join(" ")} (spread ${spread.toFixed(2)})`);
    }
  }
}
const silent = computeHNR(new Float32Array(3360), 48000);
check("silence -> null", silent === null, `got ${silent}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
