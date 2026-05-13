// cpp-cost-microbench.js — Per-frame cost microbenchmark for
// computeCPP under both legacy and Maryn-default configurations.
// Step 2a of the Option-A measurement plan.
//
// Runs computeCPP many times on the same synthetic input and reports
// median + p95 + p99 timings per frame for each configuration.
//
// Usage: node tests/dsp/cpp-cost-microbench.js
// Output: measurements/cpp-cost-microbench-2026-05-10.json

import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  computeCPP,
  resetCppState,
  CPP_INPUT_LEN,
  CANONICAL_SR,
  CPP_DEFAULT_REGRESSION,
  CPP_DEFAULT_TREND,
  CPP_DEFAULT_TIME_SMOOTH_FRAMES,
  CPP_DEFAULT_QUEFRENCY_SMOOTH_BINS,
} from "../../src/dsp/cpp.js";

const SAMPLE_RATE = 48000;
// Native-rate buffer length sized so the post-resample canonical
// buffer reaches CPP_INPUT_LEN samples (mirrors production at 48 kHz
// with ~50 ms windows that downsample to ~800 canonical samples; we
// use the full CPP_INPUT_LEN here to stress the longest valid path).
const NATIVE_BUFFER_LEN = Math.round((SAMPLE_RATE / CANONICAL_SR) * CPP_INPUT_LEN);
const WARMUP_FRAMES = 100;
const MEASURE_FRAMES = 2000;

function pulseTrain(f0Hz, sr, numSamples) {
  const out = new Float64Array(numSamples);
  const period = sr / f0Hz;
  for (let t = 0; t < numSamples; t += period) {
    const idx = Math.round(t);
    if (idx < numSamples) out[idx] = 1.0;
  }
  return out;
}

function applySpectralTilt(signal, alpha = 0.98) {
  const out = new Float64Array(signal.length);
  out[0] = signal[0];
  for (let i = 1; i < signal.length; i++) {
    out[i] = signal[i] + alpha * out[i - 1];
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

function biquadResonator(signal, freq, bw, sr) {
  const r = Math.exp(-Math.PI * bw / sr);
  const cosTheta = Math.cos(2 * Math.PI * freq / sr);
  const a1 = -2 * r * cosTheta;
  const a2 = r * r;
  const b0 = (1 - r * r) * Math.sin(2 * Math.PI * freq / sr);
  const out = new Float64Array(signal.length);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const y = b0 * signal[i] - a1 * y1 - a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function syntheticVowel() {
  let signal = pulseTrain(120, SAMPLE_RATE, NATIVE_BUFFER_LEN);
  signal = applySpectralTilt(signal, 0.98);
  signal = biquadResonator(signal, 700, 80, SAMPLE_RATE);
  signal = biquadResonator(signal, 1200, 90, SAMPLE_RATE);
  signal = biquadResonator(signal, 2600, 120, SAMPLE_RATE);
  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    const a = Math.abs(signal[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) for (let i = 0; i < signal.length; i++) signal[i] /= peak;
  return signal;
}

function percentile(sorted, p) {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function describe(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    p95: percentile(s, 0.95),
    p99: percentile(s, 0.99),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

function bench(label, opts) {
  resetCppState();
  const signal = syntheticVowel();
  // Warmup
  for (let i = 0; i < WARMUP_FRAMES; i++) computeCPP(signal, SAMPLE_RATE, opts);
  // Measure
  const times = new Float64Array(MEASURE_FRAMES);
  for (let i = 0; i < MEASURE_FRAMES; i++) {
    const t0 = performance.now();
    computeCPP(signal, SAMPLE_RATE, opts);
    times[i] = performance.now() - t0;
  }
  const stats = describe(Array.from(times));
  console.log(`  ${label}:`);
  console.log(`    median=${stats.median.toFixed(3)}ms  p95=${stats.p95.toFixed(3)}ms  p99=${stats.p99.toFixed(3)}ms  max=${stats.max.toFixed(3)}ms`);
  return { label, opts, stats };
}

console.log("CPP per-frame cost microbenchmark (Node native)");
console.log("===============================================");
console.log(`SAMPLE_RATE=${SAMPLE_RATE}, CPP_INPUT_LEN=${CPP_INPUT_LEN} (canonical), NATIVE_BUFFER_LEN=${NATIVE_BUFFER_LEN}`);
console.log(`Warmup=${WARMUP_FRAMES} frames, Measure=${MEASURE_FRAMES} frames\n`);

const results = [
  bench("legacy (linear LSQ + linear trend, no smoothing)", {
    regression: "linear",
    trend: "linear",
    timeSmoothFrames: 1,
    quefrencySmoothBins: 1,
  }),
  bench(
    `production default (regression=${CPP_DEFAULT_REGRESSION}, ` +
    `trend=${CPP_DEFAULT_TREND}, timeSmooth=${CPP_DEFAULT_TIME_SMOOTH_FRAMES}, ` +
    `quefrencySmooth=${CPP_DEFAULT_QUEFRENCY_SMOOTH_BINS})`,
    {
      regression: CPP_DEFAULT_REGRESSION,
      trend: CPP_DEFAULT_TREND,
      timeSmoothFrames: CPP_DEFAULT_TIME_SMOOTH_FRAMES,
      quefrencySmoothBins: CPP_DEFAULT_QUEFRENCY_SMOOTH_BINS,
    },
  ),
  bench("full Maryn (Theil + exp + 3+3 smoothing)", {
    regression: "theil",
    trend: "exponential",
    timeSmoothFrames: 3,
    quefrencySmoothBins: 3,
  }),
  bench("Theil + linear trend (no exponential)", {
    regression: "theil",
    trend: "linear",
    timeSmoothFrames: 1,
    quefrencySmoothBins: 1,
  }),
  bench("linear LSQ + exponential trend (Theil-free)", {
    regression: "linear",
    trend: "exponential",
    timeSmoothFrames: 1,
    quefrencySmoothBins: 1,
  }),
  bench("Maryn − time smoothing", {
    regression: "theil",
    trend: "exponential",
    timeSmoothFrames: 1,
    quefrencySmoothBins: 3,
  }),
  bench("Maryn − quefrency smoothing", {
    regression: "theil",
    trend: "exponential",
    timeSmoothFrames: 3,
    quefrencySmoothBins: 1,
  }),
];

console.log(`\nDecision criteria thresholds (per spec):`);
console.log(`  Per-frame CPP cost < 200ms/s desktop = < 5.0ms/frame at 40fps`);
console.log(`  Per-frame CPP cost < 400ms/s mobile WASM = < 10.0ms/frame at 40fps`);

const desktopBudget = 5.0;
const productionStats = results.find((r) => r.label.startsWith("production default")).stats;
const verdict = productionStats.median < desktopBudget && productionStats.p99 < desktopBudget * 2
  ? "PASS desktop budget at production default"
  : "EXCEEDS desktop budget at production default — investigate cost drivers";
console.log(`\n  ${verdict}`);

mkdirSync("measurements", { recursive: true });
writeFileSync("measurements/cpp-cost-microbench-2026-05-10.json", JSON.stringify({
  timestamp: new Date().toISOString(),
  config: { SAMPLE_RATE, CPP_INPUT_LEN, NATIVE_BUFFER_LEN, WARMUP_FRAMES, MEASURE_FRAMES },
  thresholds: { desktopMsPerFrame: desktopBudget, mobileMsPerFrame: desktopBudget * 2 },
  variants: results.map((r) => ({
    label: r.label,
    opts: r.opts,
    median_ms: r.stats.median,
    p95_ms: r.stats.p95,
    p99_ms: r.stats.p99,
    max_ms: r.stats.max,
    mean_ms: r.stats.mean,
  })),
}, null, 2));
console.log("\nWrote measurements/cpp-cost-microbench-2026-05-10.json");
