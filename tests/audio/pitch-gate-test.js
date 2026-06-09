// pitch-gate-test.js — Unit tests for the frame-level silence-gate,
// pitch-staleness, and bounded pitch-hold logic in src/audio/pitchGate.js
// (extracted from useAudioPipeline.js on 2026-06-09).
//
// The two bugs this module's bounds fix, demonstrated as scenarios below:
//
//   1. Unbounded pitch hold: on main pre-fix, sustained loud-but-pitchless
//      audio (breath, fan, typing) held the last pitch indefinitely —
//      phantom flatline on the trace, voiced frames at stale F0 in
//      session recordings. Now bounded at PITCH_HOLD_MAX_MS (corpus-
//      grounded: measurements/swift-f0-null-gap-distribution-2026-06-09
//      .json).
//
//   2. Stuck silence gate on pitch-worker stall/death: the "latest pitch"
//      merge had no staleness check, so a worker dying with its last
//      confidence ≥ 0.5 disabled the gate's voicedness arm permanently.
//      Now samples older than PITCH_STALE_MS are treated as absent,
//      collapsing the gate to intensity-only (the designed pre-warmup
//      fallback).
//
// Usage: node tests/audio/pitch-gate-test.js

import {
  createGateState,
  evaluateFrameGate,
  SILENCE_THRESHOLD_DB,
  SILENCE_DEBOUNCE_FRAMES,
  CONFIDENCE_THRESHOLD,
  PITCH_STALE_MS,
  PITCH_HOLD_MAX_MS,
} from "../../src/audio/pitchGate.js";

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

const HOP_MS = 25; // production chunk cadence

// Helper: drive the gate with a sequence of frames at the production
// cadence. Each spec: { intensity, pitch, confidence, pitchFresh }.
// pitchFresh=true stamps pitchTs at the frame time (healthy worker);
// pitchFresh=false reuses a fixed stale timestamp.
function run(state, specs, { startMs = 100000 } = {}) {
  const out = [];
  let t = startMs;
  for (const spec of specs) {
    out.push(
      evaluateFrameGate(state, {
        now: t,
        intensity: spec.intensity,
        pitch: spec.pitch,
        confidence: spec.confidence,
        pitchTs: spec.pitchTs ?? (spec.pitchFresh ? t - 5 : 0),
      }),
    );
    t += HOP_MS;
  }
  return out;
}

const SPEECH = { intensity: -38, pitch: 200, confidence: 0.9, pitchFresh: true };
// Loud but pitchless: breath / fricative / broadband noise. The pitch-
// worker keeps running (fresh timestamps) but reports no pitch.
const LOUD_NOISE = { intensity: -42, pitch: null, confidence: 0.2, pitchFresh: true };
const SILENT = { intensity: -60, pitch: null, confidence: 0.1, pitchFresh: true };

console.log("silence gate — AND logic + debounce (behavior preserved from PR #74)");

{
  const s = createGateState();
  const out = run(s, [SPEECH, SPEECH, SILENT, SILENT, SILENT, SILENT]);
  check("speech frames are not quiet", !out[0].isQuiet && !out[1].isQuiet);
  check(
    `gate engages only after ${SILENCE_DEBOUNCE_FRAMES} consecutive quiet frames`,
    !out[2].isQuiet && !out[3].isQuiet && out[4].isQuiet && out[5].isQuiet,
  );
}

{
  // Either arm alone must NOT engage the gate (AND, not OR).
  const s = createGateState();
  const quietButConfident = { intensity: -60, pitch: 180, confidence: 0.8, pitchFresh: true };
  const out = run(s, [quietButConfident, quietButConfident, quietButConfident, quietButConfident]);
  check("intensity-quiet but confident frames never gate", out.every((o) => !o.isQuiet));
}

{
  const s = createGateState();
  const out = run(s, [LOUD_NOISE, LOUD_NOISE, LOUD_NOISE, LOUD_NOISE]);
  check("loud but unconfident frames never gate", out.every((o) => !o.isQuiet));
}

console.log("\npre-warmup — no pitch sample yet (pitchTs = 0)");

{
  const s = createGateState();
  const warmup = { intensity: -60, pitch: null, confidence: null, pitchTs: 0 };
  const out = run(s, [warmup, warmup, warmup]);
  check(
    "intensity-only gating before first inference",
    !out[0].isQuiet && !out[1].isQuiet && out[2].isQuiet,
  );
  check("no pitch reported pre-warmup", out.every((o) => !o.hasPitch && o.pitch === null));
}

console.log("\nbounded hold — brief intra-speech null gaps are bridged");

{
  // 2-frame SwiftF0 null gap mid-speech (e.g. a stop consonant): hold
  // allowed throughout, no fragmentation. This is the PR #74 concern —
  // the bound must not re-introduce trace fragmentation on real speech.
  const s = createGateState();
  const out = run(s, [SPEECH, SPEECH, LOUD_NOISE, LOUD_NOISE, SPEECH]);
  check("gap frame 1 bridged", out[2].holdAllowed);
  check("gap frame 2 bridged", out[3].holdAllowed);
  check("speech resumes with fresh pitch", out[4].hasPitch && !out[4].holdAllowed);
}

{
  // Gap exactly at the bound is still bridged; one frame past is not.
  const boundFrames = Math.floor(PITCH_HOLD_MAX_MS / HOP_MS);
  const s = createGateState();
  const seq = [SPEECH, ...Array(boundFrames + 2).fill(LOUD_NOISE)];
  const out = run(s, seq);
  check(
    `hold allowed through frame at ${boundFrames * HOP_MS} ms`,
    out[boundFrames].holdAllowed,
  );
  check(
    `hold denied past PITCH_HOLD_MAX_MS (${PITCH_HOLD_MAX_MS} ms)`,
    !out[boundFrames + 1].holdAllowed && !out[boundFrames + 2].holdAllowed,
  );
}

console.log("\nbounded hold — phantom-flatline scenario (bug 1)");

{
  // Speech, then 60 s of loud pitchless noise (fan/breath/typing kept
  // intensity above the gate). Pre-fix: the hold never expired and the
  // trace painted the stale pitch the entire time. Post-fix: hold
  // expires after PITCH_HOLD_MAX_MS and every later frame is a gap.
  const s = createGateState();
  const noiseFrames = Math.ceil(60000 / HOP_MS);
  const out = run(s, [SPEECH, SPEECH, ...Array(noiseFrames).fill(LOUD_NOISE)]);
  const heldFrames = out.filter((o) => o.holdAllowed).length;
  check(
    `hold expires after ≤ ${PITCH_HOLD_MAX_MS} ms of pitchless audio (held ${heldFrames * HOP_MS} ms)`,
    heldFrames * HOP_MS <= PITCH_HOLD_MAX_MS,
  );
  check(
    "all frames after expiry render as gaps",
    out.slice(2 + heldFrames + 1).every((o) => !o.holdAllowed && !o.hasPitch),
  );
  check(
    "silence gate still never engages on loud noise (intensity arm)",
    out.every((o) => !o.isQuiet),
  );
}

{
  // Hold re-arms after expiry once real pitch returns.
  const s = createGateState();
  const out = run(s, [
    SPEECH,
    ...Array(30).fill(LOUD_NOISE), // 750 ms — exhausts the hold
    SPEECH,
    LOUD_NOISE,
  ]);
  check("fresh pitch after expiry is accepted", out[31].hasPitch);
  check("hold re-arms after fresh pitch", out[32].holdAllowed);
}

console.log("\nstaleness — pitch-worker stall/death (bug 2)");

{
  // Worker dies right after emitting a confident voiced sample. The
  // frozen ref keeps {pitch: 200, confidence: 0.9, ts: t0} forever.
  // Pre-fix: voicednessQuiet stayed false forever → the silence gate
  // could never engage, even in a dead-quiet room. Post-fix: the sample
  // goes stale after PITCH_STALE_MS and the gate collapses to
  // intensity-only.
  const s = createGateState();
  const t0 = 100000;
  const staleSpec = { intensity: -60, pitch: 200, confidence: 0.9, pitchTs: t0 };
  const frames = Math.ceil((PITCH_STALE_MS + 200) / HOP_MS);
  const out = run(s, Array(frames).fill(staleSpec), { startMs: t0 + HOP_MS });
  const staleOnset = out.findIndex((o) => o.pitchStale);
  check(
    `frozen sample goes stale within ${PITCH_STALE_MS} ms (onset frame ${staleOnset})`,
    staleOnset >= 0 && staleOnset * HOP_MS <= PITCH_STALE_MS,
  );
  check("stale sample reports no pitch", out[out.length - 1].pitch === null);
  check(
    "gate engages on silence despite frozen confident sample",
    out[out.length - 1].isQuiet,
  );
}

{
  // Healthy cadence never trips the staleness fallback: pitch messages
  // arrive every ~25 ms, far inside PITCH_STALE_MS.
  const s = createGateState();
  const out = run(s, Array(40).fill(SPEECH));
  check("healthy worker never reads stale", out.every((o) => !o.pitchStale));
  check("healthy worker always has pitch", out.every((o) => o.hasPitch));
}

console.log("\nconstants — sanity");

check("SILENCE_THRESHOLD_DB unchanged from pre-extraction value (-50)", SILENCE_THRESHOLD_DB === -50);
check("SILENCE_DEBOUNCE_FRAMES unchanged from pre-extraction value (3)", SILENCE_DEBOUNCE_FRAMES === 3);
check("CONFIDENCE_THRESHOLD matches pitch-worker gate (0.5)", CONFIDENCE_THRESHOLD === 0.5);
check(
  `PITCH_STALE_MS (${PITCH_STALE_MS}) is ≥ 4 hops and < pitch-worker inference timeout (1500 ms)`,
  PITCH_STALE_MS >= 4 * HOP_MS && PITCH_STALE_MS < 1500,
);
check(
  `PITCH_HOLD_MAX_MS (${PITCH_HOLD_MAX_MS}) covers corpus p95 intra-speech null run (275 ms)`,
  PITCH_HOLD_MAX_MS >= 275,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
