// pitch-smoothing-test.js — Tests the harmonic-aware pitch smoothing
// helpers used by useAudioPipeline.js. The smoothing is the second line
// of defence against YIN's harmonic-error failure mode (see comments in
// src/audio/pitchSmoothing.js).
//
// Usage: node tests/audio/pitch-smoothing-test.js

import {
  reconcileHarmonic,
  pushAndMedianPitch,
  median,
  PITCH_SMOOTH_LEN,
  PITCH_HARMONIC_TOLERANCE,
  PITCH_HARMONIC_KS,
  PITCH_VALID_MIN_HZ,
  PITCH_VALID_MAX_HZ,
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

console.log("reconcileHarmonic — passthrough cases");

check(
  "null current → passthrough",
  reconcileHarmonic(150, null) === 150,
);
check(
  "null value → null",
  reconcileHarmonic(null, 130) === null,
);
check(
  "current=0 → passthrough (avoid div-by-zero)",
  reconcileHarmonic(150, 0) === 150,
);

// Continuous pitch change (nothing harmonic-related) — leave alone
check(
  "continuous pitch change passes through",
  reconcileHarmonic(155, 150) === 155,
);

console.log("\nreconcileHarmonic — harmonic-up correction");

// 2× error: detected ≈ 2·current
{
  const r = reconcileHarmonic(260, 130);
  check(`260 ≈ 2·130 → 130 (got ${r})`, near(r, 130));
}
{
  const r = reconcileHarmonic(255, 130); // 13% higher than 260 — within tol
  check(`255 ≈ 2·130 (within tol) → 127.5 (got ${r})`, near(r, 127.5));
}
{
  // 3× error: detected ≈ 3·current — the user's reported bug
  const r = reconcileHarmonic(390, 130);
  check(`390 ≈ 3·130 → 130 (got ${r})`, near(r, 130));
}
{
  const r = reconcileHarmonic(380, 130); // slightly off but within tol
  check(`380 ≈ 3·130 (within tol) → ~126.7 (got ${r})`, near(r, 380 / 3));
}

console.log("\nreconcileHarmonic — sub-harmonic correction");

{
  // detected ≈ current/2 → multiply back
  const r = reconcileHarmonic(110, 220);
  check(`110 ≈ 220/2 → 220 (got ${r})`, near(r, 220));
}
{
  const r = reconcileHarmonic(75, 220); // 220/3 ≈ 73.3
  check(`75 ≈ 220/3 → 225 (got ${r})`, near(r, 225));
}

console.log("\nreconcileHarmonic — guards");

// Outside tolerance: don't reconcile
check(
  "value 1.7× current is NOT a harmonic — passthrough",
  reconcileHarmonic(220, 130) === 220,
);
// Sub-harmonic that would land below valid range — don't reconcile
{
  // current=100 means 100/2=50 (below PITCH_VALID_MIN_HZ when multiplied)
  // Actually for sub-harmonic: detected≈50, expected=100/2=50, corrected=50*2=100. That's valid.
  // Try: detected≈200, current=400 → corrected=400, but if we then say current=600...
  // Test: corrected value must stay in valid range.
  const r = reconcileHarmonic(700, 350); // 700 ≈ 2*350, corrected = 350. valid.
  check(`700 ≈ 2·350 → 350 (got ${r})`, near(r, 350));
}

// Edge: corrected value falls below PITCH_VALID_MIN_HZ → don't correct
{
  // current=140, expected=2*140=280, but corrected = 280/2 = 140 (valid).
  // Try a case where corrected would be below 75: current=50 (below valid).
  // But current is null-safe by valid-range upstream. Test in-band:
  // value ≈ 3*30 = 90, current=30 → corrected = 30 (below 75). Don't correct.
  const r = reconcileHarmonic(90, 30);
  // 90 ≈ 3*30 = 90 within tol → corrected = 30, but 30 < PITCH_VALID_MIN_HZ → no correct.
  // So either passthrough (90) OR sub-harmonic case applies.
  // Sub-harmonic: 90 ≈ 30/k, but 30/2=15, 30/3=10 — neither matches 90.
  // So expected behavior: harmonic-up case considered, corrected=30, but 30 < 75 → reject.
  // Result: passthrough = 90.
  check(`harmonic correction below voice range is suppressed (got ${r})`, r === 90);
}

console.log("\nmedian");

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

console.log("\npushAndMedianPitch — sustained 3·f0 spike");

// Simulate: 5 frames of clean 130 Hz, then 4 frames of 390 Hz spike,
// then back to 130. The output should never report >300 Hz because
// reconciliation divides each spike by 3 before it enters the median.
{
  const buf = [];
  let lastOutput = null;
  let neverSpikedAbove = true;
  for (const v of [130, 130, 130, 130, 130]) {
    lastOutput = pushAndMedianPitch(buf, v);
  }
  check(`stable 130 Hz → output ~130 (got ${lastOutput})`, near(lastOutput, 130));

  const spikedOutputs = [];
  for (const v of [390, 390, 390, 390]) {
    const out = pushAndMedianPitch(buf, v);
    spikedOutputs.push(out);
    if (out > 200) neverSpikedAbove = false;
  }
  check(
    `no spike above 200 during 4-frame 3·f0 input (got ${spikedOutputs.map((x) => x.toFixed(0)).join(",")})`,
    neverSpikedAbove,
  );
}

console.log("\npushAndMedianPitch — sustained 2·f0 spike");

{
  const buf = [];
  for (const v of [130, 130, 130, 130, 130]) pushAndMedianPitch(buf, v);
  let neverSpikedAbove = true;
  const spikedOutputs = [];
  for (const v of [260, 260, 260, 260]) {
    const out = pushAndMedianPitch(buf, v);
    spikedOutputs.push(out);
    if (out > 200) neverSpikedAbove = false;
  }
  check(
    `no spike above 200 during 4-frame 2·f0 input (got ${spikedOutputs.map((x) => x.toFixed(0)).join(",")})`,
    neverSpikedAbove,
  );
}

console.log("\npushAndMedianPitch — genuine pitch glide should pass through");

// A real pitch change of ~30% over 5 frames is NOT a harmonic ratio,
// so the smoothing should track it (with the median's natural lag).
{
  const buf = [];
  for (const v of [130, 130, 130]) pushAndMedianPitch(buf, v);
  const outputs = [];
  for (const v of [140, 150, 160, 170, 180]) outputs.push(pushAndMedianPitch(buf, v));
  // After enough frames the output should reach ~160-170
  const finalOutput = outputs[outputs.length - 1];
  check(
    `pitch glide 130 → 180 tracks (final=${finalOutput.toFixed(0)})`,
    finalOutput >= 150 && finalOutput <= 180,
  );
}

console.log("\nconstants");

check(
  `PITCH_SMOOTH_LEN > 1`,
  PITCH_SMOOTH_LEN > 1,
);
check(
  `PITCH_HARMONIC_TOLERANCE in (0, 0.3)`,
  PITCH_HARMONIC_TOLERANCE > 0 && PITCH_HARMONIC_TOLERANCE < 0.3,
);
check(
  `PITCH_HARMONIC_KS includes 2 and 3`,
  PITCH_HARMONIC_KS.includes(2) && PITCH_HARMONIC_KS.includes(3),
);
check(
  `PITCH_VALID range is sensible`,
  PITCH_VALID_MIN_HZ >= 60 && PITCH_VALID_MAX_HZ <= 1000 && PITCH_VALID_MIN_HZ < PITCH_VALID_MAX_HZ,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
