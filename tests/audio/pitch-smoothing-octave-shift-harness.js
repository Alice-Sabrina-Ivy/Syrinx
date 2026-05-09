// pitch-smoothing-octave-shift-harness.js — Measures pitchSmoothing.js
// behavior when raw pitch shifts by exactly an octave (a 2:1 ratio sits
// inside reconcileHarmonic's k=2 window and a 3:1 ratio inside k=3).
// Surfaces the user-reported bug from 2026-05-09: pitch trace locks at
// the old octave for many seconds after an abrupt 100 Hz↔200 Hz shift.
//
// Usage: node tests/audio/pitch-smoothing-octave-shift-harness.js
//
// Compares three smoother variants on synthetic raw-pitch sequences that
// simulate SwiftF0 output (per-25-ms-hop scalar pitch + null gaps):
//   - "current": status quo (reconcileHarmonic always on)
//   - "no-reconcile": removes harmonic correction entirely
//   - "sustained-shift": only reconciles single-frame spikes; passes
//     through after N consecutive frames at the new octave
//
// Each variant is implemented inline so the harness compares variants
// against each other independent of the production import. The "current"
// implementation is the same algorithm as src/audio/pitchSmoothing.js;
// the harness verifies this by running the production exports for the
// same sequences and matching the lock signature.
//
// Output: human-readable per-scenario tables + a CSV summary at end.

import {
  pushAndMedianPitch as prodPushAndMedianPitch,
  PITCH_SMOOTH_LEN,
} from "../../src/audio/pitchSmoothing.js";

// These constants used to be exported by pitchSmoothing.js as part of
// the (now-removed) `reconcileHarmonic` helper. The harness keeps a
// local copy of the old implementation as one of the variants ("current"
// in pre-fix runs, kept here for historical comparison and as a guard
// against re-introducing the failure mode in a future change).
const PITCH_HARMONIC_KS = [2, 3];
const PITCH_HARMONIC_TOLERANCE = 0.15;
const PITCH_VALID_MIN_HZ = 75;
const PITCH_VALID_MAX_HZ = 600;
const RECONCILE_AFTER_FRAMES = 3;

// ---------------------------------------------------------------------------
//  Variant implementations
// ---------------------------------------------------------------------------

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// "legacy-reconcile" — pre-2026-05-09 production behavior. Kept here as
// a regression-comparison reference against which the sustained-octave
// lock failure mode reproduces. Production was rewritten to plain
// rolling-median on 2026-05-09 (see measurements/pitchsmoothing-octave-
// shift-2026-05-09.md).
function reconcileHarmonic_legacy(value, current) {
  if (value == null || current == null) return value;
  if (current <= 0) return value;
  for (const k of PITCH_HARMONIC_KS) {
    const expectedUp = k * current;
    if (Math.abs(value - expectedUp) <= PITCH_HARMONIC_TOLERANCE * expectedUp) {
      const corrected = value / k;
      if (corrected >= PITCH_VALID_MIN_HZ) return corrected;
    }
    const expectedDown = current / k;
    if (Math.abs(value - expectedDown) <= PITCH_HARMONIC_TOLERANCE * expectedDown) {
      const corrected = value * k;
      if (corrected <= PITCH_VALID_MAX_HZ) return corrected;
    }
  }
  return value;
}

function makeSmoother_legacy() {
  const buf = [];
  return (value) => {
    let pushValue;
    if (buf.length < RECONCILE_AFTER_FRAMES) {
      pushValue = value;
    } else {
      const cur = median(buf);
      pushValue = reconcileHarmonic_legacy(value, cur);
    }
    buf.push(pushValue);
    if (buf.length > PITCH_SMOOTH_LEN) buf.shift();
    return median(buf);
  };
}

// "no-reconcile" — drop harmonic correction entirely. Plain rolling median.
function makeSmoother_noReconcile() {
  const buf = [];
  return (value) => {
    buf.push(value);
    if (buf.length > PITCH_SMOOTH_LEN) buf.shift();
    return median(buf);
  };
}

// "sustained-shift" — reconcile single-frame spikes but accept the new
// octave when N consecutive frames land at the same shifted ratio.
//
// Mechanism: track a small window of recent RAW (un-reconciled) values.
// Before reconciling, check whether the last SHIFT_CONFIRM frames are
// also near-harmonic to current. If so, the "spike" has persisted long
// enough to be a real shift — pass the value through without correction.
const SHIFT_CONFIRM = 3;
function makeSmoother_sustainedShift() {
  const buf = [];
  const recent = []; // recent raw inputs
  return (value) => {
    recent.push(value);
    if (recent.length > SHIFT_CONFIRM) recent.shift();

    let pushValue;
    if (buf.length < RECONCILE_AFTER_FRAMES) {
      pushValue = value;
    } else {
      const cur = median(buf);
      // Would the current value be reconciled? If so, check whether the
      // last SHIFT_CONFIRM raw values would ALL be reconciled the same
      // way — that's the signature of a sustained shift. If they all
      // would, accept the new octave instead of correcting.
      const reconciled = reconcileHarmonic_legacy(value, cur);
      const wouldReconcile = reconciled !== value;
      if (wouldReconcile && recent.length >= SHIFT_CONFIRM) {
        const allShifted = recent.every((v) => {
          const r = reconcileHarmonic_legacy(v, cur);
          return r !== v && Math.abs(r - reconciled) / reconciled < 0.1;
        });
        if (allShifted) {
          // Sustained shift — flush the buffer and start tracking the new octave.
          buf.length = 0;
          buf.push(value);
          return value;
        }
      }
      pushValue = reconciled;
    }
    buf.push(pushValue);
    if (buf.length > PITCH_SMOOTH_LEN) buf.shift();
    return median(buf);
  };
}

const VARIANTS = {
  legacy: makeSmoother_legacy,
  "no-reconcile": makeSmoother_noReconcile,
  "sustained-shift": makeSmoother_sustainedShift,
};

// ---------------------------------------------------------------------------
//  Scenarios
// ---------------------------------------------------------------------------

function rep(value, n) {
  return Array(n).fill(value);
}

const SCENARIOS = {
  // Stationary baseline — should track exactly.
  "steady-100": rep(100, 30),
  "steady-200": rep(200, 30),

  // The user-reported bug: speak at 100 Hz, abruptly shift to 200 Hz.
  // Expected: smoother tracks the shift within a small lag (~5 frames).
  // Status-quo: locks at 100 Hz indefinitely.
  "shift-100-to-200": [...rep(100, 15), ...rep(200, 30)],
  "shift-200-to-100": [...rep(200, 15), ...rep(100, 30)],

  // 3:1 octave shift — same lock failure mode if reconciliation fires.
  "shift-100-to-300": [...rep(100, 15), ...rep(300, 30)],
  "shift-300-to-100": [...rep(300, 15), ...rep(100, 30)],

  // Brief single-frame harmonic spike — the original use case for
  // reconciliation. The status-quo passes this; we want any fix to also pass.
  "spike-1-frame":
    [...rep(130, 10), 260, ...rep(130, 10)],

  // Brief 2-frame harmonic spike — also pYIN's typical failure pattern.
  "spike-2-frames":
    [...rep(130, 10), 260, 260, ...rep(130, 10)],

  // 3-frame spike — at the boundary of "transient" vs "sustained".
  "spike-3-frames":
    [...rep(130, 10), 260, 260, 260, ...rep(130, 10)],

  // 4-frame spike — pre-existing test asserts this is reconciled. Decide
  // explicitly if the fix changes this behavior.
  "spike-4-frames":
    [...rep(130, 10), 260, 260, 260, 260, ...rep(130, 10)],

  // Real pitch glide — should track the underlying motion. Not a
  // harmonic ratio so reconciliation should never fire here.
  "glide-130-to-200":
    [...rep(130, 5), 140, 150, 160, 170, 180, 190, 200, ...rep(200, 10)],

  // Slow drift through a harmonic ratio (e.g. singing scale) — pitch
  // gradually rises through 2x of the starting value. Status quo would
  // start reconciling once the value crosses into the k=2 window of the
  // running median.
  "rising-100-to-220-slow": (() => {
    const seq = [];
    for (let i = 0; i < 40; i++) seq.push(100 + i * 3); // 100..217
    return seq;
  })(),
};

// ---------------------------------------------------------------------------
//  Verification: production code produces the documented lock failure
// ---------------------------------------------------------------------------

function runProductionForCmp(values) {
  const buf = [];
  return values.map((v) => prodPushAndMedianPitch(buf, v));
}

console.log("=== Production smoother sanity check ===");
//
// After 2026-05-09, production matches the "no-reconcile" variant. The
// harness's "legacy" variant reproduces the pre-2026-05-09 behavior for
// regression comparison. If a future change reintroduces reconciliation
// or any other transform, this sanity check will fail and the harness
// scenarios above will surface what changed.
{
  const seq = SCENARIOS["shift-100-to-200"];
  const prod = runProductionForCmp(seq);
  const noReconcile = (() => {
    const s = makeSmoother_noReconcile();
    return seq.map((v) => s(v));
  })();
  let identical = true;
  for (let i = 0; i < seq.length; i++) {
    if (Math.abs(prod[i] - noReconcile[i]) > 0.01) {
      identical = false;
      console.log(`  divergence at i=${i}: prod=${prod[i]}, no-reconcile=${noReconcile[i]}`);
    }
  }
  console.log(`  production matches "no-reconcile" variant: ${identical}`);
  if (!identical) {
    console.error("  HARNESS-PROD MISMATCH — measurements untrustable, aborting.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
//  Run scenarios across variants
// ---------------------------------------------------------------------------

const EXPECTED_FOR_INPUT = (rawSeq) => rawSeq; // ground truth = the input itself

function rms(arr) {
  if (arr.length === 0) return null;
  let s = 0;
  for (const v of arr) s += v * v;
  return Math.sqrt(s / arr.length);
}

function summarizeError(output, expected) {
  // Skip the first PITCH_SMOOTH_LEN frames — every smoother has cold-start lag.
  const start = PITCH_SMOOTH_LEN;
  const errs = [];
  for (let i = start; i < output.length; i++) {
    if (output[i] != null && expected[i] != null) {
      errs.push(output[i] - expected[i]);
    }
  }
  return {
    meanAbsErr: rms(errs.map(Math.abs)),
    maxAbsErr: errs.reduce((m, e) => Math.max(m, Math.abs(e)), 0),
    n: errs.length,
  };
}

// Frames-to-converge: how many frames after the shift point until the
// output is within `eps` of the new ground-truth value.
function framesToConverge(output, expected, shiftIdx, eps = 5) {
  for (let i = shiftIdx; i < output.length; i++) {
    if (Math.abs(output[i] - expected[i]) <= eps) return i - shiftIdx;
  }
  return Infinity;
}

console.log("\n=== Per-scenario per-variant outputs ===\n");

const csvRows = [];
csvRows.push([
  "scenario",
  "variant",
  "mean_abs_err_hz",
  "max_abs_err_hz",
  "frames_to_converge_post_shift",
  "final_output",
  "final_expected",
].join(","));

for (const [name, seq] of Object.entries(SCENARIOS)) {
  console.log(`Scenario: ${name}  (length=${seq.length})`);
  const expected = EXPECTED_FOR_INPUT(seq);

  for (const [vname, factory] of Object.entries(VARIANTS)) {
    const smoother = factory();
    const output = seq.map((v) => smoother(v));

    const err = summarizeError(output, expected);

    // Detect the first shift point: where input changes by ≥10%.
    let shiftIdx = -1;
    for (let i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i] - seq[i - 1]) / seq[i - 1] >= 0.1) {
        shiftIdx = i;
        break;
      }
    }
    const conv = shiftIdx >= 0 ? framesToConverge(output, expected, shiftIdx) : null;

    const last = output[output.length - 1];
    const lastExp = expected[expected.length - 1];
    const trace = output.map((v) => (v == null ? "·" : v.toFixed(0))).join(",");

    console.log(
      `  ${vname.padEnd(18)} mae=${err.meanAbsErr?.toFixed(1) ?? "—"}Hz` +
        `  max=${err.maxAbsErr.toFixed(1)}Hz` +
        `  conv=${conv === Infinity ? "never" : `${conv}f`}` +
        `  final=${last?.toFixed(0) ?? "—"}/${lastExp?.toFixed(0) ?? "—"}`,
    );
    if (name.startsWith("shift-") || name.startsWith("spike-")) {
      console.log(`    trace: ${trace}`);
    }

    csvRows.push([
      name,
      vname,
      err.meanAbsErr?.toFixed(2) ?? "",
      err.maxAbsErr.toFixed(2),
      conv === Infinity ? "never" : conv,
      last?.toFixed(2) ?? "",
      lastExp?.toFixed(2) ?? "",
    ].join(","));
  }
  console.log();
}

console.log("\n=== CSV summary ===\n");
console.log(csvRows.join("\n"));
