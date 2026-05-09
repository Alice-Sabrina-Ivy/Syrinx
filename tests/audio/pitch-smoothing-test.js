// pitch-smoothing-test.js — Unit tests for the rolling-median smoother
// used by useAudioPipeline.js. The smoother applies on top of SwiftF0's
// per-frame pitch output; it is responsible for filtering 1- and 2-
// frame outliers and tracking sustained pitch shifts.
//
// Earlier versions of this file tested a `reconcileHarmonic` helper
// that performed k=2/k=3 octave correction. That helper was removed on
// 2026-05-09 — see measurements/pitchsmoothing-octave-shift-2026-05-09.md
// for the failure mode it was creating (sustained-octave lock).
// Octave-shift tracking behavior is verified by the dedicated harness in
// pitch-smoothing-octave-shift-harness.js; this file covers the
// arithmetic of `median` and `pushAndMedianPitch`.
//
// Usage: node tests/audio/pitch-smoothing-test.js

import {
  pushAndMedianPitch,
  median,
  PITCH_SMOOTH_LEN,
} from "../../src/audio/pitchSmoothing.js";

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

function near(a, b, eps = 0.5) {
  return Math.abs(a - b) <= eps;
}

console.log("median");

check("empty array → null", median([]) === null);
check("single element → that element", median([42]) === 42);
check("odd-length sorted middle", median([1, 2, 3, 4, 5]) === 3);
check("even-length avg of mids", median([1, 2, 3, 4]) === 2.5);
check("unsorted — still picks middle", median([5, 1, 3, 4, 2]) === 3);

console.log("\npushAndMedianPitch — empty buffer");

{
  const buf = [];
  const result = pushAndMedianPitch(buf, 130);
  check("first push returns the value", result === 130);
  check("buffer has the value", buf.length === 1 && buf[0] === 130);
}

console.log("\npushAndMedianPitch — buffer is bounded by maxLen");

{
  const buf = [];
  for (let i = 0; i < PITCH_SMOOTH_LEN + 5; i++) {
    pushAndMedianPitch(buf, 100);
  }
  check(
    `buffer never exceeds PITCH_SMOOTH_LEN (got ${buf.length})`,
    buf.length === PITCH_SMOOTH_LEN,
  );
}

console.log("\npushAndMedianPitch — single-frame outlier rejected by median");

// A length-5 median cannot be flipped by a single outlier: 4 of the 5
// values still hold the original pitch, so the middle of the sorted
// buffer remains the original.
{
  const buf = [];
  for (const v of [130, 130, 130, 130, 130]) pushAndMedianPitch(buf, v);
  const out = pushAndMedianPitch(buf, 260);
  check(`single-frame 2× spike does not reach output (got ${out})`, near(out, 130));
}

console.log("\npushAndMedianPitch — two-frame outlier still rejected");

// At length 5, two outliers leave 3 of 5 values at the original pitch,
// so the sorted middle stays at the original.
{
  const buf = [];
  for (const v of [130, 130, 130, 130, 130]) pushAndMedianPitch(buf, v);
  const a = pushAndMedianPitch(buf, 260);
  const b = pushAndMedianPitch(buf, 260);
  check(
    `two-frame 2× spike does not reach output (got ${a}, ${b})`,
    near(a, 130) && near(b, 130),
  );
}

console.log("\npushAndMedianPitch — three-frame shift is accepted");

// Three consecutive values at the new pitch occupy the majority of the
// length-5 buffer — median flips. This is the intended behavior for
// real sustained pitch shifts.
{
  const buf = [];
  for (const v of [130, 130, 130, 130, 130]) pushAndMedianPitch(buf, v);
  pushAndMedianPitch(buf, 260);
  pushAndMedianPitch(buf, 260);
  const out = pushAndMedianPitch(buf, 260);
  check(`three-frame sustained shift tracks (got ${out})`, near(out, 260));
}

console.log("\npushAndMedianPitch — abrupt octave shift converges in 2 frames");

// The user-reported bug from 2026-05-09: speak at one pitch, abruptly
// shift to its octave, the trace must converge to the new pitch
// quickly. After fix, 2 frames of the new pitch flip the median.
{
  const buf = [];
  for (let i = 0; i < 10; i++) pushAndMedianPitch(buf, 100);
  const trace = [];
  for (let i = 0; i < 5; i++) trace.push(pushAndMedianPitch(buf, 200));
  // Frames 0 and 1 still see majority-old; frame 2 onwards is at new pitch.
  check(
    `octave-up shift converges by frame 3 (trace=${trace.map((x) => x.toFixed(0)).join(",")})`,
    near(trace[2], 200) && near(trace[3], 200) && near(trace[4], 200),
  );
}

{
  const buf = [];
  for (let i = 0; i < 10; i++) pushAndMedianPitch(buf, 200);
  const trace = [];
  for (let i = 0; i < 5; i++) trace.push(pushAndMedianPitch(buf, 100));
  check(
    `octave-down shift converges by frame 3 (trace=${trace.map((x) => x.toFixed(0)).join(",")})`,
    near(trace[2], 100) && near(trace[3], 100) && near(trace[4], 100),
  );
}

console.log("\npushAndMedianPitch — genuine pitch glide tracks");

{
  const buf = [];
  for (const v of [130, 130, 130]) pushAndMedianPitch(buf, v);
  const outputs = [];
  for (const v of [140, 150, 160, 170, 180]) outputs.push(pushAndMedianPitch(buf, v));
  const finalOutput = outputs[outputs.length - 1];
  check(
    `pitch glide 130 → 180 tracks (final=${finalOutput.toFixed(0)})`,
    finalOutput >= 150 && finalOutput <= 180,
  );
}

console.log("\nconstants");

check(`PITCH_SMOOTH_LEN > 1`, PITCH_SMOOTH_LEN > 1);
check(`PITCH_SMOOTH_LEN is odd (so median has no even-length tie)`, PITCH_SMOOTH_LEN % 2 === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
