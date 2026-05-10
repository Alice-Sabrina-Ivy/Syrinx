// vocal-weight-baseline-test.js — Tests for the per-user CPP
// baseline tracker.
//
// Usage: node tests/audio/vocal-weight-baseline-test.js

import {
  VocalWeightBaseline,
  BASELINE_VOICED_MS,
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

console.log("\nLocking after enough voiced time + samples");
{
  const b = new VocalWeightBaseline();
  // Push samples spread across 31 seconds of "voiced time" (using
  // sample timestamps as the clock). Mean ≈ 2.0, modest spread.
  // Use enough samples (16) to clear the minSamples=8 floor.
  const cpps = [1.8, 2.1, 1.9, 2.3, 2.0, 1.7, 2.2, 2.0, 1.9, 2.1, 2.0, 2.2, 1.8, 2.0, 2.1, 2.0];
  for (let i = 0; i < cpps.length; i++) {
    b.accumulate({ time: i * 2000, cpp: cpps[i] });   // 2 s apart, 30 s spread
  }
  check("ready() true after baseline locks", b.ready() === true);
  check("mu() ≈ 2.0", b.mu() !== null && Math.abs(b.mu() - 2.0) < 0.1);
  check("sigma() > 0", b.sigma() !== null && b.sigma() > 0);
  check("progress() = 1 after lock", b.progress() === 1);
}

console.log("\nNot enough voiced time keeps unlocked");
{
  const b = new VocalWeightBaseline();
  // Many samples but only over 10 seconds.
  for (let i = 0; i < 20; i++) {
    b.accumulate({ time: i * 500, cpp: 2.0 });   // 0.5 s apart, 9.5 s spread
  }
  check("not locked when voiced time < 30 s", b.ready() === false);
  check("progress() < 1 while accumulating", b.progress() < 1);
  check("progress() reflects voiced-time fraction", Math.abs(b.progress() - 9500 / 30000) < 1e-9);
}

console.log("\nNot enough samples keeps unlocked even with 30 s elapsed");
{
  const b = new VocalWeightBaseline();
  // Only 4 samples spread across 32 s. Voiced-time gate satisfied
  // but sample-count floor (8) is not.
  b.accumulate({ time: 0, cpp: 2.0 });
  b.accumulate({ time: 10000, cpp: 2.1 });
  b.accumulate({ time: 20000, cpp: 1.9 });
  b.accumulate({ time: 32000, cpp: 2.0 });
  check("not locked with < BASELINE_MIN_SAMPLES samples", b.ready() === false);
}

console.log("\nGauge position mapping");
{
  const b = new VocalWeightBaseline();
  // 16 samples deliberately distributed around mean 2.0 with σ≈0.5
  const targets = [1.0, 1.5, 2.0, 2.5, 3.0, 1.5, 2.0, 2.5, 1.0, 1.5, 2.0, 2.5, 3.0, 1.5, 2.0, 2.5];
  for (let i = 0; i < targets.length; i++) {
    b.accumulate({ time: i * 2000, cpp: targets[i] });
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

console.log("\nReset clears all state");
{
  const b = new VocalWeightBaseline();
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 2000, cpp: 2.0 + i * 0.05 });
  check("locked before reset", b.ready());
  b.reset();
  check("ready() false after reset", b.ready() === false);
  check("mu() null after reset", b.mu() === null);
  check("sigma() null after reset", b.sigma() === null);
  check("progress() = 0 after reset", b.progress() === 0);
}

console.log("\nLocked baseline does not drift with subsequent samples");
{
  const b = new VocalWeightBaseline();
  // Lock baseline at μ ≈ 2.0
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 2000, cpp: 2.0 });
  const muLocked = b.mu();

  // Push subsequent voiced samples at very different CPP.
  for (let i = 16; i < 50; i++) b.accumulate({ time: i * 2000, cpp: 8.0 });

  check("μ stays at locked value", b.mu() === muLocked);
  check("locked flag stays true", b.ready());
}

console.log("\nDegenerate baseline: all-identical samples");
{
  const b = new VocalWeightBaseline();
  for (let i = 0; i < 16; i++) b.accumulate({ time: i * 2000, cpp: 2.0 });
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
  // Tighter baseline window (5 s, min 4 samples) for tests/tuning.
  const b = new VocalWeightBaseline({
    baselineVoicedMs: 5000,
    gaugeSigma: 1.5,
    minSamples: 4,
  });
  b.accumulate({ time: 0, cpp: 1.8 });
  b.accumulate({ time: 1500, cpp: 2.0 });
  b.accumulate({ time: 3000, cpp: 2.2 });
  b.accumulate({ time: 5000, cpp: 2.0 });
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
