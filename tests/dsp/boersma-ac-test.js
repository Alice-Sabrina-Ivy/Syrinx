// boersma-ac-test.js — Unit tests for the Boersma-AC detector + path
// tracker (src/dsp/boersma-ac.js), the production pitch backend since
// the 2026-06-09 cutover. Corpus-level accuracy is covered by the
// shootout harnesses (scripts/pitch-shootout-*); this file guards the
// frame-level basics and the weak-H1 case that motivated the cutover.
//
// Usage: node tests/dsp/boersma-ac-test.js

import {
  createBoersmaAC,
  createPathTracker,
  BOERSMA_FRAME_LENGTH_16K,
} from "../../src/dsp/boersma-ac.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const SR = 16000, N = BOERSMA_FRAME_LENGTH_16K;
const ac = createBoersmaAC(SR, N);

function tone(f, amps = [1]) {
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let h = 0; h < amps.length; h++) s += amps[h] * Math.sin(2 * Math.PI * f * (h + 1) * i / SR);
    b[i] = 0.3 * s;
  }
  return b;
}
const near = (a, b, tol) => a !== null && Math.abs(a - b) <= tol;

console.log("detector — frame-local");
check("100 Hz pure tone", near(ac.detect(tone(100)).pitch, 100, 1));
check("300 Hz pure tone", near(ac.detect(tone(300)).pitch, 300, 2));
check("60 Hz low tone (below SwiftF0's reliable floor)", near(ac.detect(tone(60)).pitch, 60, 1));
// The cutover motivation: fundamental weaker than the 2nd harmonic
// (breathy/pressed phonation). SwiftF0 confidently reported 2×F0 here.
const weakH1 = tone(95, [0.35, 1.0, 0.4, 0.2]);
check("95 Hz with dominant H2 stays at 95 (weak-H1 case)", near(ac.detect(weakH1).pitch, 95, 1.5));
check("silence is unvoiced", ac.detect(new Float32Array(N)).pitch === null);
{
  const noise = new Float32Array(N);
  let seed = 42;
  for (let i = 0; i < N; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise[i] = (seed / 0x3fffffff - 1) * 0.05; }
  check("white noise is unvoiced", ac.detect(noise).pitch === null);
}

console.log("\ndetector — real-mic levels (adaptive global peak)");
{
  // Regression: live mics with AGC off peak at 0.01-0.05 full scale. The
  // pre-fix silence term normalized against hardcoded full scale (1.0)
  // and silenced quiet-but-clean speech (live-use report 2026-06-09).
  const quiet = createBoersmaAC(SR, N);
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) b[i] = 0.02 * Math.sin(2 * Math.PI * 100 * i / SR);
  let r;
  for (let k = 0; k < 5; k++) r = quiet.detect(b);
  check("quiet mic (peak 0.02) 100 Hz tone is voiced", near(r.pitch, 100, 1));
}

console.log("\ncandidates — shape");
{
  const c = ac.candidates(tone(150));
  check("voiced candidates sorted by strength", c.voiced.length > 0 &&
    c.voiced.every((x, i) => i === 0 || x.strength <= c.voiced[i - 1].strength));
  check("unvoicedStrength present", typeof c.unvoicedStrength === "number");
}

console.log("\npath tracker — decode delay, stability, flush");
{
  const pt = createPathTracker();
  const L = pt.config.lookback;
  const out = [];
  for (let i = 0; i < 12; i++) out.push(pt.emit(ac.candidates(weakH1)));
  check(`first ${L} emits are null (decode delay)`, out.slice(0, L).every((v) => v === null));
  check("decoded frames hold 95 Hz", out.slice(L).every((v) => near(v, 95, 1.5)));
  const tail = pt.flush();
  check(`flush drains ${L} pending frames`, tail.length === L && tail.every((v) => near(v, 95, 1.5)));
}
{
  // A single-frame octave outlier must not flip the decoded contour.
  const pt = createPathTracker();
  const seq = Array(8).fill(tone(110)).concat([tone(220)]).concat(Array(8).fill(tone(110)));
  const out = [];
  for (const f of seq) { const v = pt.emit(ac.candidates(f)); if (v !== null) out.push(v); }
  out.push(...pt.flush());
  const flipped = out.filter((v) => v !== null && near(v, 220, 5)).length;
  check(`1-frame octave outlier suppressed (${flipped} frames at 220)`, flipped <= 1);
}
{
  // A sustained octave shift IS tracked. Note the stimulus subtlety: a
  // perfectly periodic tone correlates identically at lag T and 2T, so
  // the octave is genuinely ambiguous frame-locally and only the
  // octaveCost bonus (+0.01/frame toward the higher octave) accumulates
  // against the one-time jump cost (0.15) — ~15 frames to amortize.
  // Real voices break the 2T correlation via jitter/noise and flip in
  // 2-3 frames (measured: session flip behavior at Praat parity).
  const pt = createPathTracker();
  const seq = Array(8).fill(tone(110)).concat(Array(30).fill(tone(220)));
  const out = [];
  for (const f of seq) { const v = pt.emit(ac.candidates(f)); if (v !== null) out.push(v); }
  out.push(...pt.flush());
  check("sustained octave shift tracks to 220", near(out[out.length - 1], 220, 5));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
