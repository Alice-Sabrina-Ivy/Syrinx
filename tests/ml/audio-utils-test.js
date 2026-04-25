// audio-utils-test.js — Tests for the pure helpers used by the gender
// inference worker. The worker itself depends on @huggingface/transformers
// + Web Worker globals and isn't directly runnable in plain Node; these
// tests cover the deterministic pieces that AREN'T model inference:
// resampling, ring-buffer windowing, and result-label parsing.
//
// Usage: node tests/ml/audio-utils-test.js

import {
  resampleLinear,
  RingWindow,
  femaleScoreFromResult,
  TARGET_SAMPLE_RATE,
} from "../../src/ml/audio-utils.js";

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

console.log("resampleLinear");

// Identity at matching rate
{
  const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const out = resampleLinear(input, 16000, 16000);
  check("same rate returns input identity", out === input);
}

// 48 kHz → 16 kHz: output length should be input.length / 3
{
  const input = new Float32Array(1200);            // 25 ms @ 48 kHz
  const out = resampleLinear(input, 48000, 16000);
  check(
    "48 kHz → 16 kHz produces ~1/3 length",
    out.length === 400,
    `got ${out.length}`,
  );
}

// 44.1 kHz → 16 kHz: ratio ≈ 2.756, output ≈ input/2.756
{
  const input = new Float32Array(4410);            // 100 ms @ 44.1 kHz
  const out = resampleLinear(input, 44100, 16000);
  // expect ~1600 samples (100 ms @ 16 kHz)
  check(
    "44.1 kHz → 16 kHz produces ~1600 samples for 100 ms input",
    Math.abs(out.length - 1600) <= 1,
    `got ${out.length}`,
  );
}

// Linear interp preserves a constant signal exactly
{
  const input = new Float32Array(900);
  input.fill(0.5);
  const out = resampleLinear(input, 48000, 16000);
  let allCorrect = true;
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i] - 0.5) > 1e-6) { allCorrect = false; break; }
  }
  check("constant input stays constant after resampling", allCorrect);
}

// Linear interp on a linear ramp: output should also be a linear ramp
{
  const input = new Float32Array(300);
  for (let i = 0; i < input.length; i++) input[i] = i;
  const out = resampleLinear(input, 48000, 16000);
  // Expected: out[i] should be ~3*i (sample every 3rd, with linear interp)
  let maxErr = 0;
  for (let i = 0; i < out.length; i++) {
    maxErr = Math.max(maxErr, Math.abs(out[i] - 3 * i));
  }
  check(
    "linear ramp resamples to linear ramp",
    maxErr < 0.01,
    `max error ${maxErr.toExponential(2)}`,
  );
}

console.log("\nRingWindow");

// Capacity + initial state
{
  const ring = new RingWindow(10);
  check("starts not full", !ring.isFull());
  check("initial filled is 0", ring.filled === 0);
}

// Append less than capacity
{
  const ring = new RingWindow(10);
  ring.append(new Float32Array([1, 2, 3]));
  ring.append(new Float32Array([4, 5]));
  const snap = ring.snapshot();
  check("partial fill stores in order", snap.length === 5 && snap[0] === 1 && snap[4] === 5);
  check("partial fill is not full", !ring.isFull());
}

// Fill exactly to capacity
{
  const ring = new RingWindow(5);
  ring.append(new Float32Array([1, 2, 3]));
  ring.append(new Float32Array([4, 5]));
  check("fills to exact capacity → isFull()", ring.isFull());
  const snap = ring.snapshot();
  check(
    "snapshot at full holds full window",
    snap.length === 5 && snap[0] === 1 && snap[4] === 5,
  );
}

// Overflow: oldest data gets shifted out
{
  const ring = new RingWindow(5);
  ring.append(new Float32Array([1, 2, 3, 4, 5]));        // full: [1,2,3,4,5]
  ring.append(new Float32Array([6, 7]));                  // expect [3,4,5,6,7]
  const snap = ring.snapshot();
  check(
    "overflow drops oldest samples",
    snap.length === 5 && snap[0] === 3 && snap[4] === 7,
    `got ${Array.from(snap)}`,
  );
}

// Single chunk larger than capacity: keeps only the tail
{
  const ring = new RingWindow(4);
  ring.append(new Float32Array([1, 2, 3, 4, 5, 6, 7]));
  const snap = ring.snapshot();
  check(
    "single oversize chunk keeps tail",
    snap.length === 4 && snap[0] === 4 && snap[3] === 7,
    `got ${Array.from(snap)}`,
  );
}

// reset() clears
{
  const ring = new RingWindow(3);
  ring.append(new Float32Array([1, 2, 3]));
  ring.reset();
  check("reset() clears filled", ring.filled === 0);
  check("reset() un-fulls", !ring.isFull());
}

console.log("\nfemaleScoreFromResult");

check(
  "lowercase female/male",
  Math.abs(femaleScoreFromResult([
    { label: "female", score: 0.9 },
    { label: "male", score: 0.1 },
  ]) - 0.9) < 1e-6,
);

check(
  "uppercase FEMALE/MALE",
  Math.abs(femaleScoreFromResult([
    { label: "MALE", score: 0.2 },
    { label: "FEMALE", score: 0.8 },
  ]) - 0.8) < 1e-6,
);

check(
  "single-letter F/M",
  Math.abs(femaleScoreFromResult([
    { label: "M", score: 0.4 },
    { label: "F", score: 0.6 },
  ]) - 0.6) < 1e-6,
);

check(
  "only male present → female = 1 - male",
  Math.abs(femaleScoreFromResult([
    { label: "male", score: 0.3 },
  ]) - 0.7) < 1e-6,
);

check(
  "unknown labels → fallback to index 1",
  Math.abs(femaleScoreFromResult([
    { label: "label_0", score: 0.4 },
    { label: "label_1", score: 0.6 },
  ]) - 0.6) < 1e-6,
);

check(
  "empty array → null",
  femaleScoreFromResult([]) === null,
);

check(
  "non-array input → null",
  femaleScoreFromResult(null) === null,
);

console.log("\nconstants");

check(
  `TARGET_SAMPLE_RATE === 16000`,
  TARGET_SAMPLE_RATE === 16000,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
