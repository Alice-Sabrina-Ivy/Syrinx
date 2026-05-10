// vocal-weight-aggregator-test.js — Tests for the per-frame CPP
// aggregation buffer used by the vocal-weight gauge.
//
// Mirrors the audio-utils-test.js pattern: pass/fail console
// reporting, exit code 0 for all-pass and 1 for any failure.
//
// Usage: node tests/audio/vocal-weight-aggregator-test.js

import {
  VocalWeightAggregator,
  AGGREGATE_WINDOW_MS,
  EMIT_INTERVAL_MS,
  HARD_RESET_UNVOICED_MS,
  MIN_VOICED_FRAMES,
} from "../../src/audio/vocal-weight-aggregator.js";

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

// Helper: push a sequence of frames with monotonic timestamps.
function pushFrames(agg, frames) {
  let lastReturn = null;
  for (const f of frames) lastReturn = agg.push(f);
  return lastReturn;
}

// Helper: build a frame.
function frame(time, cpp, voiced) {
  return { time, cpp, voiced };
}

console.log("VocalWeightAggregator — exported defaults");
{
  check("AGGREGATE_WINDOW_MS = 1000", AGGREGATE_WINDOW_MS === 1000);
  check("EMIT_INTERVAL_MS = 250", EMIT_INTERVAL_MS === 250);
  check("HARD_RESET_UNVOICED_MS = 2000", HARD_RESET_UNVOICED_MS === 2000);
  check("MIN_VOICED_FRAMES = 6", MIN_VOICED_FRAMES === 6);
}

console.log("\nWarming-up state (insufficient voiced frames)");
{
  const agg = new VocalWeightAggregator();
  // Push 5 voiced frames at 150 ms cadence — under the 6-frame minimum.
  let result = null;
  for (let i = 0; i < 5; i++) {
    result = agg.push(frame(i * 150, 20 + i, true));
  }
  check(
    "returns null while voiced frames < MIN_VOICED_FRAMES",
    result === null,
  );
}

console.log("\nFresh aggregate after MIN_VOICED_FRAMES voiced");
{
  const agg = new VocalWeightAggregator();
  // 6 voiced frames at 150 ms cadence. _lastEmitMs starts at
  // -Infinity, so each push >= 250 ms ago is eligible to compute.
  // Pushes 0-4 compute but emit nothing (under MIN_VOICED_FRAMES).
  // Push 5 (t=750 ms) computes with 6 voiced contributors and emits.
  const cppValues = [18, 20, 22, 19, 21, 20];
  let last = null;
  for (let i = 0; i < cppValues.length; i++) {
    last = agg.push(frame(i * 150, cppValues[i], true));
  }
  const expectedMean = cppValues.reduce((a, b) => a + b, 0) / cppValues.length;
  check("emits non-null aggregate once minimum reached", last !== null);
  check(
    "aggregate.cpp is mean of voiced CPPs in window",
    last !== null && Math.abs(last.cpp - expectedMean) < 1e-9,
    last && `got ${last.cpp.toFixed(3)}, expected ${expectedMean.toFixed(3)}`,
  );
  check(
    "aggregate.voicedFrames = number of voiced contributors",
    last !== null && last.voicedFrames === cppValues.length,
    last && `got voicedFrames=${last.voicedFrames}`,
  );
  check(
    "aggregate.time matches the triggering push",
    last !== null && last.time === (cppValues.length - 1) * 150,
    last && `got time=${last.time}`,
  );
}

console.log("\nEmit-cadence throttle holds value between emits");
{
  // Demonstrate that frames arriving WITHIN the 250 ms emit interval
  // are buffered (and contribute to future means) but the emitted
  // _latest does not flicker. This is the load-bearing UX property
  // — the gauge updates 4 Hz at most.
  const agg = new VocalWeightAggregator();
  for (let i = 0; i < 6; i++) agg.push(frame(i * 150, 20, true));
  const firstEmit = agg.state().latest;

  // 7th frame at t=900 ms is only 150 ms after the t=750 emit;
  // throttle should preserve the previous _latest unchanged.
  const result = agg.push(frame(900, 30, true));
  check(
    "emit-throttled push returns previous aggregate unchanged",
    result === firstEmit,
  );
  check(
    "buffer still contains the new entry (will affect next emit)",
    agg.state().frameCount === 7,
  );
}

console.log("\nEmit-cadence throttle (250 ms minimum between emits)");
{
  const agg = new VocalWeightAggregator();
  // First emit happens once we cross ≥ 6 voiced frames.
  for (let i = 0; i < 6; i++) agg.push(frame(i * 150, 20, true));
  const firstEmit = agg.state().lastEmitMs;
  check("first emit recorded", firstEmit !== null);

  // Push another voiced frame 100 ms later — under 250 ms since the
  // previous emit. Aggregator should NOT update.
  agg.push(frame(firstEmit + 100, 30, true));
  const stateAfter100 = agg.state();
  check(
    "second push within emit-interval does not advance lastEmitMs",
    stateAfter100.lastEmitMs === firstEmit,
  );

  // Push a frame 251 ms after the first emit — should produce a new
  // emit (different cpp value reflecting the new entry).
  agg.push(frame(firstEmit + 251, 30, true));
  const stateAfter251 = agg.state();
  check(
    "push beyond emit-interval advances lastEmitMs",
    stateAfter251.lastEmitMs === firstEmit + 251,
  );
}

console.log("\nWindow trim (entries older than windowMs are dropped)");
{
  const agg = new VocalWeightAggregator();
  // Fill 1.5 s of voiced frames; entries from the first 0.5 s should
  // be trimmed by the time the 1.5 s entry is pushed.
  // Use 200 ms cadence so only 5 frames fit in 1 s — but we need
  // ≥6 voiced to emit. Reduce to 150 ms so 7 fit in 1 s.
  for (let i = 0; i < 11; i++) agg.push(frame(i * 150, 20, true));
  // At t=1500 ms with windowMs=1000, the cutoff is 500 ms. Entries
  // from t=0, 150, 300, 450 should be dropped (4 entries).
  // The remaining buffer holds t=600..1500 = 7 entries.
  const s = agg.state();
  check(
    "window holds only frames within windowMs of latest push",
    s.frameCount === 7,
    `got frameCount=${s.frameCount}`,
  );
}

console.log("\nVoicing gate (unvoiced frames excluded from mean)");
{
  const agg = new VocalWeightAggregator();
  // Mix of voiced and unvoiced frames. Only voiced should contribute.
  agg.push(frame(0, 20, true));
  agg.push(frame(150, 99, false));   // unvoiced — excluded
  agg.push(frame(300, 22, true));
  agg.push(frame(450, 99, false));   // unvoiced — excluded
  agg.push(frame(600, 24, true));
  agg.push(frame(750, 26, true));
  agg.push(frame(900, 28, true));
  // Voiced CPP values: 20, 22, 24, 26, 28 (5 frames). 5 < 6 minimum
  // → still null.
  check("5 voiced + 2 unvoiced still under minimum", agg.state().latest === null);
  // One more voiced frame to cross the threshold.
  const result = agg.push(frame(1050, 30, true));
  // Voiced CPPs: 20, 22, 24, 26, 28, 30. Mean = 25.
  // But entry at t=0 is 1050 ms old → outside windowMs=1000 → dropped.
  // After trim, voiced frames: 22, 24, 26, 28, 30 = 5 entries → still
  // under minimum, no emit.
  check(
    "trim removes oldest voiced frame; emit deferred until ≥6 voiced inside window",
    result === null,
    `got ${result === null ? "null" : JSON.stringify(result)}`,
  );

  // Push another voiced frame so 6 voiced fit in the window.
  const result2 = agg.push(frame(1200, 28, true));
  check("aggregate emits once ≥ 6 voiced in window", result2 !== null);
  check(
    "aggregate excludes unvoiced CPP=99 spike",
    result2 && result2.cpp < 50,
    result2 && `got ${result2.cpp.toFixed(3)}`,
  );
}

console.log("\nNull CPP frames (computation failures excluded)");
{
  const agg = new VocalWeightAggregator();
  // Voiced flag true but CPP null — exclude from mean even though
  // voiced. Simulates a computation failure.
  agg.push(frame(0, null, true));
  agg.push(frame(150, 20, true));
  agg.push(frame(300, null, true));
  agg.push(frame(450, 22, true));
  agg.push(frame(600, 24, true));
  agg.push(frame(750, 26, true));
  agg.push(frame(900, 28, true));
  // Valid CPPs: 20, 22, 24, 26, 28 = 5 — still under threshold.
  check("null-cpp voiced frames excluded from voiced count", agg.state().latest === null);
  const result = agg.push(frame(1050, 30, true));
  // After this push, t=0 is exactly 1050 ms old. Cutoff is t=50.
  // Frames with time < 50 dropped → t=0 dropped (which was null
  // anyway). Surviving frames: 150-1050 with valid CPPs at 150, 450,
  // 600, 750, 900, 1050 = 6 valid. Should emit.
  check("aggregate emits once ≥ 6 valid voiced CPPs accumulate", result !== null);
}

console.log("\nHard reset on long unvoiced gap");
{
  const agg = new VocalWeightAggregator();
  // Establish an aggregate from voice block 1.
  for (let i = 0; i < 7; i++) agg.push(frame(i * 150, 20, true));
  const beforeReset = agg.state();
  check("aggregate established before gap", beforeReset.latest !== null);

  // Long unvoiced gap >2 s, then voiced resumes. The next voiced
  // push should trigger a hard reset and the buffer should drop.
  const gapEnd = beforeReset.lastEmitMs + 2500;
  agg.push(frame(gapEnd, 30, true));
  const afterReset = agg.state();
  check(
    "hard reset clears _latest when gap exceeds HARD_RESET_UNVOICED_MS",
    afterReset.latest === null,
  );
  check(
    "hard reset leaves only the new seed frame in buffer",
    afterReset.frameCount === 1,
  );
}

console.log("\nNo hard reset on short gaps (< 2 s)");
{
  const agg = new VocalWeightAggregator();
  for (let i = 0; i < 7; i++) agg.push(frame(i * 150, 20, true));
  const stable = agg.state().latest;
  check("baseline aggregate established", stable !== null);

  // 1.5 s gap — under the hard-reset threshold. Should NOT clear.
  // The unvoiced frames during the gap (modeled as not-pushed for
  // simplicity) just don't contribute; the next voiced push enters
  // the existing window. By the time the new voiced frame arrives,
  // most of the original frames are aged out by windowMs trim, but
  // _latest should NOT be force-cleared.
  const gapEnd = stable.time + 1500;
  agg.push(frame(gapEnd, 22, true));
  const after = agg.state();
  // _latest may or may not be updated (depending on emit cadence + min),
  // but it MUST NOT be null — the gap was below the hard-reset threshold.
  check(
    "short gap does not force-clear _latest",
    after.latest !== null,
  );
}

console.log("\nReset clears all state");
{
  const agg = new VocalWeightAggregator();
  for (let i = 0; i < 7; i++) agg.push(frame(i * 150, 20, true));
  agg.reset();
  const s = agg.state();
  check("reset clears frame buffer", s.frameCount === 0);
  check("reset clears latest", s.latest === null);
  check("reset clears lastVoicedMs", s.lastVoicedMs === null);
  check("reset clears lastEmitMs", s.lastEmitMs === null);
}

console.log("\nWater-break scenario (long voiced silence then resume)");
{
  // User speaks for several seconds, pauses for a 5-second water
  // break, then resumes. The post-break aggregate should reflect
  // post-break speech only — not blend with pre-break state.
  const agg = new VocalWeightAggregator();
  // Pre-break: 12 voiced frames at 150 ms = 1.8 s of speech.
  for (let i = 0; i < 12; i++) agg.push(frame(i * 150, 18, true));
  const preBreak = agg.state().latest;
  check("pre-break aggregate established", preBreak !== null);

  // 5-second silence: push a single voiced frame 5 s later. Should
  // hard-reset the buffer.
  const breakStart = 12 * 150;
  agg.push(frame(breakStart + 5000, 25, true));
  // Continue with post-break voiced speech at 25 dB CPP.
  for (let i = 1; i < 12; i++) agg.push(frame(breakStart + 5000 + i * 150, 25, true));
  const postBreak = agg.state().latest;
  check("post-break aggregate emits", postBreak !== null);
  check(
    "post-break aggregate reflects post-break speech (≈25), not pre-break (18)",
    postBreak && Math.abs(postBreak.cpp - 25) < 0.5,
    postBreak && `got ${postBreak.cpp.toFixed(2)}`,
  );
}

console.log("\nVoicing-gate flapping (rapid voiced/unvoiced alternation)");
{
  // Voicing gate near the threshold can produce rapid alternation.
  // Aggregator should still produce a sensible mean of the voiced
  // frames; unvoiced gaps don't reset until total unvoiced span
  // exceeds 2 s.
  const agg = new VocalWeightAggregator();
  // Alternating voiced/unvoiced, 12 frames at 150 ms = 1.8 s.
  for (let i = 0; i < 12; i++) {
    agg.push(frame(i * 150, 20, i % 2 === 0));
  }
  // 6 voiced (i=0,2,4,6,8,10) inside a 1-s window: window holds
  // entries from t=800..1650 → entries i=6..10 plus i=11 = 6 frames,
  // but the voiced ones are i=6,8,10 = 3. Under the 6-voiced
  // minimum. _latest should remain null.
  const s = agg.state();
  check("alternating gate near threshold keeps aggregate null below min", s.latest === null);
}

console.log("\nSession-start: no voiced speech yet");
{
  const agg = new VocalWeightAggregator();
  // Pure silence: 10 unvoiced frames.
  for (let i = 0; i < 10; i++) agg.push(frame(i * 150, null, false));
  check("silence-only session has null aggregate", agg.state().latest === null);
  check("silence-only session has null lastVoicedMs", agg.state().lastVoicedMs === null);
}

console.log("\nMonotonic time consistency");
{
  // Aggregator should be deterministic given a sequence of frames;
  // re-running the same sequence on a new instance produces the
  // same final state.
  const sequence = [];
  for (let i = 0; i < 20; i++) sequence.push(frame(i * 150, 18 + (i % 3), i % 5 !== 4));
  const agg1 = new VocalWeightAggregator();
  const agg2 = new VocalWeightAggregator();
  for (const f of sequence) agg1.push(f);
  for (const f of sequence) agg2.push(f);
  const s1 = agg1.state();
  const s2 = agg2.state();
  check(
    "deterministic across instances",
    s1.frameCount === s2.frameCount &&
      s1.lastEmitMs === s2.lastEmitMs &&
      JSON.stringify(s1.latest) === JSON.stringify(s2.latest),
  );
}

console.log("\nCustom configuration");
{
  // The hot-path defaults are sensible, but tunable for tests and
  // future tuning. Verify the constructor honors overrides.
  const agg = new VocalWeightAggregator({
    windowMs: 500,
    emitIntervalMs: 100,
    hardResetUnvoicedMs: 1000,
    minVoicedFrames: 3,
  });
  agg.push(frame(0, 20, true));
  agg.push(frame(120, 22, true));
  agg.push(frame(240, 24, true));
  // 3 voiced frames in a 500 ms window with 100 ms emit interval and
  // minVoicedFrames=3 → first emit at t=240.
  const s = agg.state();
  check("custom config emits at lower thresholds", s.latest !== null);
  check(
    "custom config aggregate is mean of pushed CPPs",
    s.latest && Math.abs(s.latest.cpp - 22) < 1e-9,
    s.latest && `got ${s.latest.cpp}`,
  );
}

console.log("\n--------");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
