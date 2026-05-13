// vocal-weight-baseline-test.js — Tests for the per-user CPP
// baseline tracker.
//
// Usage: node tests/audio/vocal-weight-baseline-test.js

import {
  VocalWeightBaseline,
  BASELINE_VOICED_MS,
  BASELINE_AGGREGATE_INTERVAL_MS,
  BASELINE_SIGMA,
  BASELINE_MIN_SAMPLES,
} from "../../src/audio/vocal-weight-baseline.js";

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

console.log("VocalWeightBaseline — exported defaults");
{
  check("BASELINE_VOICED_MS = 30000", BASELINE_VOICED_MS === 30000);
  check("BASELINE_AGGREGATE_INTERVAL_MS = 250", BASELINE_AGGREGATE_INTERVAL_MS === 250);
  check("BASELINE_SIGMA = 2", BASELINE_SIGMA === 2);
  check("BASELINE_MIN_SAMPLES = 8", BASELINE_MIN_SAMPLES === 8);
}

console.log("\nInitial state");
{
  const b = new VocalWeightBaseline();
  check("ready() false before any samples", b.ready() === false);
  check("mu() null before lock", b.mu() === null);
  check("sigma() null before lock", b.sigma() === null);
  check("progress() = 0 before any samples", b.progress() === 0);
  check("gaugePosition returns null while warming up", b.gaugePosition(2.0) === null);
  check("sigmaDelta returns null while warming up", b.sigmaDelta(2.0) === null);
}

console.log("\nLocking after enough voiced-content samples");
{
  const b = new VocalWeightBaseline();
  // Default: BASELINE_VOICED_MS=30000, AGGREGATE_INTERVAL_MS=250.
  // Sample target = 30000 / 250 = 120 samples.
  // Push 120 samples; baseline should lock on the 120th.
  let lockedAt = null;
  for (let i = 0; i < 120; i++) {
    b.accumulate({ time: i * 250, cpp: 2.0 + (i % 5) * 0.1 });
    if (b.ready() && lockedAt === null) lockedAt = i;
  }
  check("ready() true after 120 samples (30 s × 4 Hz)", b.ready() === true);
  check("locks at 120th sample (sample-count threshold)", lockedAt === 119, `locked at index ${lockedAt}`);
  check("mu() ≈ 2.2", b.mu() !== null && Math.abs(b.mu() - 2.2) < 0.1);
  check("sigma() > 0", b.sigma() !== null && b.sigma() > 0);
  check("progress() = 1 after lock", b.progress() === 1);
}

console.log("\nFewer samples than target keeps unlocked");
{
  const b = new VocalWeightBaseline();
  // 30 samples — well under the 120-sample target.
  for (let i = 0; i < 30; i++) {
    b.accumulate({ time: i * 250, cpp: 2.0 });
  }
  check("not locked when samples < target", b.ready() === false);
  check("progress() = 30/120 = 0.25", Math.abs(b.progress() - 30 / 120) < 1e-9);
}

console.log("\nWall-clock spread does NOT affect lock — only sample count");
{
  // Critical regression test for the iteration fix. A user with
  // long pauses (or slow speech) shouldn't have to wait longer
  // than a user with continuous fast speech to calibrate.
  const b = new VocalWeightBaseline();
  // 120 samples with HUGE wall-clock spread (each sample 10 s
  // apart = 1200 s wall-clock). Lock should fire on sample 120
  // regardless of the absurd spread.
  for (let i = 0; i < 120; i++) {
    b.accumulate({ time: i * 10000, cpp: 2.0 });
  }
  check("locks based on sample count, not wall-clock spread", b.ready() === true);
}

console.log("\nNot enough samples keeps unlocked");
{
  const b = new VocalWeightBaseline();
  // 5 samples — under both minSamples=8 floor and the default
  // 120-sample target.
  b.accumulate({ time: 0, cpp: 2.0 });
  b.accumulate({ time: 10000, cpp: 2.1 });
  b.accumulate({ time: 20000, cpp: 1.9 });
  b.accumulate({ time: 32000, cpp: 2.0 });
  b.accumulate({ time: 40000, cpp: 2.05 });
  check("not locked with < target samples", b.ready() === false);
}

console.log("\nGauge position mapping");
{
  // Use a smaller baseline (16 samples target) so this test stays
  // small while exercising the position math.
  const b = new VocalWeightBaseline({ baselineVoicedMs: 4000, minSamples: 16 });
  // 16 samples deliberately distributed around mean 2.0 with σ≈0.5
  const targets = [1.0, 1.5, 2.0, 2.5, 3.0, 1.5, 2.0, 2.5, 1.0, 1.5, 2.0, 2.5, 3.0, 1.5, 2.0, 2.5];
  for (let i = 0; i < targets.length; i++) {
    b.accumulate({ time: i * 250, cpp: targets[i] });
  }
  check("locked", b.ready());
  const mu = b.mu();
  const sigma = b.sigma();
  check("μ ≈ 2.0", Math.abs(mu - 2.0) < 0.2, `μ=${mu.toFixed(2)}`);
  check("σ > 0", sigma > 0);

  // Position at μ should be 0.5
  const posAtMu = b.gaugePosition(mu);
  check("gaugePosition(μ) ≈ 0.5", Math.abs(posAtMu - 0.5) < 1e-9);

  // Position at μ + 2σ should be 1.0 (top of gauge)
  const posAtPlus2 = b.gaugePosition(mu + 2 * sigma);
  check("gaugePosition(μ + 2σ) = 1.0 (top)", Math.abs(posAtPlus2 - 1.0) < 1e-9);

  // Position at μ - 2σ should be 0.0 (bottom)
  const posAtMinus2 = b.gaugePosition(mu - 2 * sigma);
  check("gaugePosition(μ - 2σ) = 0.0 (bottom)", Math.abs(posAtMinus2 - 0.0) < 1e-9);

  // Position at μ + 5σ should be clamped to 1.0
  const posWayHigh = b.gaugePosition(mu + 5 * sigma);
  check("gaugePosition above ±gaugeSigma is clamped to 1", posWayHigh === 1);

  // sigmaDelta should be straightforward (σ-units)
  check("sigmaDelta(μ + σ) ≈ 1", Math.abs(b.sigmaDelta(mu + sigma) - 1) < 1e-9);
  check("sigmaDelta(μ - 2σ) ≈ -2", Math.abs(b.sigmaDelta(mu - 2 * sigma) - (-2)) < 1e-9);
}

// Helper: smaller-target baseline for tests that want to exercise
// post-lock behavior without pushing 120 samples each time.
function fastBaseline(opts = {}) {
  return new VocalWeightBaseline({ baselineVoicedMs: 4000, minSamples: 16, ...opts });
}

console.log("\nReset clears all state");
{
  const b = fastBaseline();
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 250, cpp: 2.0 + i * 0.05 });
  check("locked before reset", b.ready());
  b.reset();
  check("ready() false after reset", b.ready() === false);
  check("mu() null after reset", b.mu() === null);
  check("sigma() null after reset", b.sigma() === null);
  check("progress() = 0 after reset", b.progress() === 0);
}

console.log("\nSliding window: μ tracks the recent window");
{
  const b = fastBaseline();
  // Fill window with CPP=2.0 — μ should be 2.0
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 250, cpp: 2.0 });
  check("ready after first 16 samples", b.ready());
  const muInitial = b.mu();
  check("μ ≈ 2.0 after initial fill", Math.abs(muInitial - 2.0) < 1e-9, `got ${muInitial}`);

  // Push 16 more samples at CPP=8.0 — buffer is now ALL 8.0s
  for (let i = 16; i < 32; i++) b.accumulate({ time: i * 250, cpp: 8.0 });
  check("μ has drifted to ≈ 8.0 after full window of new values",
    Math.abs(b.mu() - 8.0) < 1e-9, `got ${b.mu()}`);
  check("ready stays true throughout drift", b.ready());
}

console.log("\nSliding window: σ tracks the recent window");
{
  const b = fastBaseline();
  // Fill with low-σ samples (all 2.0)
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 250, cpp: 2.0 });
  check("σ = 0 with all-identical fill", b.sigma() === 0);

  // Push 16 alternating high/low samples — σ should grow
  for (let i = 16; i < 32; i++) {
    b.accumulate({ time: i * 250, cpp: i % 2 === 0 ? 5.0 : 1.0 });
  }
  check("σ > 0 after window fills with varied samples", b.sigma() > 0);
  // μ should be ≈ 3.0 (avg of 5 and 1)
  check("μ ≈ 3.0 after alternating fill", Math.abs(b.mu() - 3.0) < 0.1, `got ${b.mu()}`);
}

console.log("\nSliding window: old emits age out FIFO");
{
  // 4-sample window so we can verify ageout precisely.
  const b = new VocalWeightBaseline({
    baselineVoicedMs: 1000,
    aggregateIntervalMs: 250,
    minSamples: 4,
  });
  b.accumulate({ time: 0, cpp: 1.0 });
  b.accumulate({ time: 250, cpp: 2.0 });
  b.accumulate({ time: 500, cpp: 3.0 });
  check("not ready with 3 of 4 samples", b.ready() === false);
  b.accumulate({ time: 750, cpp: 4.0 });
  check("ready with 4/4 samples", b.ready());
  // μ = (1+2+3+4)/4 = 2.5
  check("μ = 2.5 with window [1,2,3,4]", Math.abs(b.mu() - 2.5) < 1e-9);

  // Push a new sample — oldest (1.0) ages out, window becomes [2,3,4,5]
  b.accumulate({ time: 1000, cpp: 5.0 });
  check("μ = 3.5 after oldest (1.0) ages out", Math.abs(b.mu() - 3.5) < 1e-9, `got ${b.mu()}`);

  // Another push — window becomes [3,4,5,6]
  b.accumulate({ time: 1250, cpp: 6.0 });
  check("μ = 4.5 after second ageout", Math.abs(b.mu() - 4.5) < 1e-9, `got ${b.mu()}`);
}

console.log("\nSliding window: aggregator hard-reset interaction (long unvoiced gap)");
{
  // Use a 4-sample window so we can drive this precisely.
  const b = new VocalWeightBaseline({
    baselineVoicedMs: 1000,
    aggregateIntervalMs: 250,
    minSamples: 4,
  });
  // First voiced burst: 2 samples, not enough to fill
  b.accumulate({ time: 0, cpp: 2.0 });
  b.accumulate({ time: 250, cpp: 2.1 });
  check("partial fill: 2/4 samples", b.state().sampleCount === 2);

  // Long unvoiced gap (aggregator would hard-reset internally) —
  // baseline sees no calls. State should be unchanged.
  check("count unchanged across unvoiced gap", b.state().sampleCount === 2);
  check("not yet ready", b.ready() === false);

  // Voiced resumption — baseline keeps filling from where it was.
  b.accumulate({ time: 60000, cpp: 2.0 });  // huge wall-clock jump, doesn't matter
  b.accumulate({ time: 60250, cpp: 2.0 });
  check("ready after 4 cumulative voiced emits regardless of wall-clock", b.ready());
}

console.log("\nDegenerate baseline: all-identical samples");
{
  const b = fastBaseline();
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 250, cpp: 2.0 });
  check("locked with identical samples", b.ready());
  check("σ = 0 when all samples identical", b.sigma() === 0);
  // gaugePosition with σ=0 should return 0.5 (gauge center) — not
  // crash on division-by-zero.
  const pos = b.gaugePosition(3.0);
  check("gaugePosition(any) = 0.5 when σ = 0", pos === 0.5);
  check("sigmaDelta(any) = 0 when σ = 0", b.sigmaDelta(3.0) === 0);
}

console.log("\nIgnores invalid input");
{
  const b = new VocalWeightBaseline();
  b.accumulate({ time: 0, cpp: NaN });
  b.accumulate({ time: 1000, cpp: undefined });
  b.accumulate({ time: 2000, cpp: Infinity });
  b.accumulate({ time: 3000, cpp: null });
  check("invalid samples are ignored", b.state().sampleCount === 0);
}

console.log("\nCustom configuration");
{
  // Custom config: smaller voicedMs target + larger aggregate interval
  // → only 4 samples needed to satisfy voiced-content threshold.
  // Exercises the new (baselineVoicedMs / aggregateIntervalMs) math.
  const b = new VocalWeightBaseline({
    baselineVoicedMs: 6000,
    aggregateIntervalMs: 1500,    // sample target = 4
    gaugeSigma: 1.5,
    minSamples: 4,
  });
  b.accumulate({ time: 0, cpp: 1.8 });
  b.accumulate({ time: 1500, cpp: 2.0 });
  b.accumulate({ time: 3000, cpp: 2.2 });
  b.accumulate({ time: 4500, cpp: 2.0 });
  check("custom config locks at custom voicedMs", b.ready());
  // gaugeSigma=1.5 means ±1.5σ maps to gauge ends.
  const mu = b.mu();
  const sigma = b.sigma();
  const posAt15 = b.gaugePosition(mu + 1.5 * sigma);
  check("custom gaugeSigma=1.5 maps μ+1.5σ to top", Math.abs(posAt15 - 1.0) < 1e-9);
}

console.log("\n--------");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
