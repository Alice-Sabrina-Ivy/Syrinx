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

console.log("\nLocked baseline does not drift with subsequent samples");
{
  const b = fastBaseline();
  // Lock baseline at μ ≈ 2.0
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 250, cpp: 2.0 });
  const muLocked = b.mu();

  // Push subsequent voiced samples at very different CPP.
  for (let i = 16; i < 50; i++) b.accumulate({ time: i * 250, cpp: 8.0 });

  check("μ stays at locked value", b.mu() === muLocked);
  check("locked flag stays true", b.ready());
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

console.log("\nloadFromPersisted: skips accumulation, marks locked immediately");
{
  const b = new VocalWeightBaseline();
  check("not ready before load", b.ready() === false);
  b.loadFromPersisted({ mu: 2.5, sigma: 0.4 });
  check("ready immediately after loadFromPersisted", b.ready() === true);
  check("mu reflects loaded value", b.mu() === 2.5);
  check("sigma reflects loaded value", b.sigma() === 0.4);
  check("source = 'loaded'", b.source() === "loaded");
  check("progress = 1 (no accumulation needed)", b.progress() === 1);
  // Loaded baseline still produces correct gauge math
  check(
    "loaded baseline gaugePosition(μ) = 0.5",
    Math.abs(b.gaugePosition(2.5) - 0.5) < 1e-9,
  );
  check(
    "loaded baseline gaugePosition(μ+2σ) = 1.0",
    Math.abs(b.gaugePosition(2.5 + 0.8) - 1.0) < 1e-9,
  );
}

console.log("\nloadFromPersisted rejects invalid values");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: NaN, sigma: 0.5 });
  check("NaN mu ignored", b.ready() === false);
  b.loadFromPersisted({ mu: 2.0, sigma: -0.1 });
  check("negative sigma ignored", b.ready() === false);
  b.loadFromPersisted({ mu: 2.0, sigma: Infinity });
  check("infinite sigma ignored", b.ready() === false);
}

console.log("\nsource() distinguishes captured vs loaded");
{
  const b = fastBaseline();
  // Captured path
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 250, cpp: 2.0 + i * 0.05 });
  check("source = 'captured' after in-session lock", b.source() === "captured");

  // Loaded path
  const b2 = new VocalWeightBaseline();
  b2.loadFromPersisted({ mu: 2.0, sigma: 0.3 });
  check("source = 'loaded' after loadFromPersisted", b2.source() === "loaded");

  // Reset clears source
  b.reset();
  check("source null after reset", b.source() === null);
}

console.log("\nTarget: attach + math + hasTarget");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 1.0, sigma: 0.2 });
  check("hasTarget false before setTarget", b.hasTarget() === false);
  check("polarity 0 before setTarget", b.polarity() === 0);
  check("targetMu null before setTarget", b.targetMu() === null);

  b.setTarget({ mu: 3.0, sigma: 0.3 });
  check("hasTarget true after setTarget", b.hasTarget() === true);
  check("targetMu reflects set value", b.targetMu() === 3.0);
  check("targetSigma reflects set value", b.targetSigma() === 0.3);
  check("polarity +1 when target > baseline", b.polarity() === 1);

  // Position math: 0 = baseline, 1 = target, with GAUGE_MARGIN=0.25
  // so the displayed [0, 1] maps to math t in [-0.25, +1.25].
  // At baseline (cpp = 1.0), t = 0, mapped = (0 - (-0.25)) / 1.5 = 0.1667
  const posAtBaseline = b.gaugePosition(1.0);
  check(
    "position at baseline ≈ 0.17 (within margin band, not at 0)",
    Math.abs(posAtBaseline - 0.16667) < 0.01,
    `got ${posAtBaseline}`,
  );
  // At target (cpp = 3.0), t = 1, mapped = (1 - (-0.25)) / 1.5 = 0.8333
  const posAtTarget = b.gaugePosition(3.0);
  check(
    "position at target ≈ 0.83 (within margin band, not at 1)",
    Math.abs(posAtTarget - 0.83333) < 0.01,
    `got ${posAtTarget}`,
  );
  // At midpoint (cpp = 2.0), t = 0.5, mapped = (0.5 - (-0.25)) / 1.5 = 0.5
  const posMid = b.gaugePosition(2.0);
  check(
    "position at midpoint = 0.5",
    Math.abs(posMid - 0.5) < 1e-9,
    `got ${posMid}`,
  );
  // Beyond target by 1×span (cpp = 5.0), clamps to 1.0
  const posOver = b.gaugePosition(5.0);
  check("position beyond target clamps to 1.0", posOver === 1);
  // Below baseline by 1×span (cpp = -1.0), clamps to 0.0
  const posUnder = b.gaugePosition(-1.0);
  check("position below baseline clamps to 0.0", posUnder === 0);
}

console.log("\nTarget: polarity -1 when target < baseline (training heavier)");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 3.0, sigma: 0.2 });
  b.setTarget({ mu: 1.0, sigma: 0.3 });
  check("polarity -1 when target < baseline", b.polarity() === -1);
  // Position 0 = baseline (cpp = 3.0), 1 = target (cpp = 1.0).
  // At midpoint cpp = 2.0, t = (2 - 3) / (1 - 3) = 0.5, mapped = 0.5
  const posMid = b.gaugePosition(2.0);
  check("midpoint cpp produces position 0.5 regardless of polarity",
    Math.abs(posMid - 0.5) < 1e-9, `got ${posMid}`);
  // At cpp = baseline, position should be in the lower margin
  const posBase = b.gaugePosition(3.0);
  check("at baseline cpp, position in lower margin band",
    posBase > 0 && posBase < 0.25, `got ${posBase}`);
  // At cpp = target, position should be in the upper margin
  const posTarg = b.gaugePosition(1.0);
  check("at target cpp, position in upper margin band",
    posTarg > 0.75 && posTarg < 1, `got ${posTarg}`);
}

console.log("\nTarget: degenerate target == baseline");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 2.0, sigma: 0.2 });
  b.setTarget({ mu: 2.0, sigma: 0.2 });
  check("polarity 0 when target == baseline", b.polarity() === 0);
  check("gaugePosition pinned to 0.5 when span is 0",
    b.gaugePosition(1.0) === 0.5);
  check("sigmaDelta still meaningful in degenerate target",
    b.sigmaDelta(2.4) === ((2.4 - 2.0) / 0.2));
}

console.log("\nTarget: sigmaDelta anchors on target");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 1.0, sigma: 0.2 });
  b.setTarget({ mu: 3.0, sigma: 0.5 });
  // sigmaDelta should be from target with target's σ
  // cpp = 3.5 = target + 1σ_target → sigmaDelta = 1.0
  check("sigmaDelta uses target's σ when anchored to target",
    Math.abs(b.sigmaDelta(3.5) - 1.0) < 1e-9,
    `got ${b.sigmaDelta(3.5)}`);
  // sigmaDeltaFromBaseline always anchors on baseline regardless
  check("sigmaDeltaFromBaseline uses baseline's σ",
    Math.abs(b.sigmaDeltaFromBaseline(1.4) - 2.0) < 1e-9,
    `got ${b.sigmaDeltaFromBaseline(1.4)}`);
}

console.log("\nTarget: σ=0 target falls back to baseline σ");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 1.0, sigma: 0.5 });
  b.setTarget({ mu: 3.0, sigma: 0 });
  // sigmaDelta uses baseline's σ as fallback
  // cpp = 3.5 = target + 1σ_baseline → sigmaDelta = 1.0
  check("sigmaDelta with σ=0 target falls back to baseline σ",
    Math.abs(b.sigmaDelta(3.5) - 1.0) < 1e-9,
    `got ${b.sigmaDelta(3.5)}`);
}

console.log("\nclearTarget reverts to baseline-only mode");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 2.0, sigma: 0.4 });
  b.setTarget({ mu: 3.0, sigma: 0.3 });
  check("hasTarget true after setTarget", b.hasTarget() === true);
  b.clearTarget();
  check("hasTarget false after clearTarget", b.hasTarget() === false);
  check("polarity 0 after clearTarget", b.polarity() === 0);
  check("targetMu null after clearTarget", b.targetMu() === null);
  // gaugePosition should now use baseline ± 2σ math
  check("gaugePosition(μ) = 0.5 after clearTarget",
    Math.abs(b.gaugePosition(2.0) - 0.5) < 1e-9);
  check("gaugePosition(μ+2σ) = 1.0 after clearTarget",
    Math.abs(b.gaugePosition(2.0 + 0.8) - 1.0) < 1e-9);
}

console.log("\nsetTarget with invalid values is no-op (clears target)");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 2.0, sigma: 0.4 });
  b.setTarget({ mu: 3.0, sigma: 0.3 });
  check("target set", b.hasTarget() === true);
  b.setTarget({ mu: NaN });
  check("NaN mu clears target", b.hasTarget() === false);

  b.setTarget({ mu: 3.0, sigma: 0.3 });
  check("target re-set", b.hasTarget() === true);
  b.setTarget({});
  check("missing mu clears target", b.hasTarget() === false);
}

console.log("\nreset clears target along with baseline");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 2.0, sigma: 0.4 });
  b.setTarget({ mu: 3.0, sigma: 0.3 });
  check("target set + baseline ready", b.hasTarget() && b.ready());
  b.reset();
  check("baseline cleared after reset", b.ready() === false);
  check("target cleared after reset", b.hasTarget() === false);
  check("source null after reset", b.source() === null);
}

console.log("\nstate() exposes target + polarity info");
{
  const b = new VocalWeightBaseline();
  b.loadFromPersisted({ mu: 1.0, sigma: 0.2 });
  b.setTarget({ mu: 2.5, sigma: 0.3 });
  const s = b.state();
  check("state.locked = true", s.locked === true);
  check("state.source = 'loaded'", s.source === "loaded");
  check("state.targetMu = 2.5", s.targetMu === 2.5);
  check("state.targetSigma = 0.3", s.targetSigma === 0.3);
  check("state.hasTarget = true", s.hasTarget === true);
  check("state.polarity = +1", s.polarity === 1);
}

console.log("\n--------");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
