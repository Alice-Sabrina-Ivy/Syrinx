// vocal-weight-pipeline-trace.js — Node-side reproduction of the
// production pipeline behavior for the vocal-weight metric.
//
// Synthesizes the exact frame stream that useAudioPipeline.js
// constructs in production: per-DSP-frame CPP (every 6th call),
// per-frame voicing flag, the aggregator + baseline wired the same
// way. Goal: see whether the aggregator ever emits a non-null
// aggregate, which would surface "Calibrating: listening for
// voice…" sticking in the UI.
//
// Tests at multiple realistic sample rates because the browser
// AudioContext samplerate isn't always 48 kHz (mobile silent
// downsampling, Safari sometimes picks 44.1, dev tooling can land
// at 22.05 kHz under some Linux configs).
//
// Usage: node tests/audio/vocal-weight-pipeline-trace.js
// Prints the trace; non-zero exit if no aggregate emits within
// 5 simulated seconds.

import { computeCPP, CPP_INPUT_LEN, CPP_MIN_INPUT_LEN, CANONICAL_SR } from "../../src/dsp/cpp.js";
import { VocalWeightAggregator } from "../../src/audio/vocal-weight-aggregator.js";
import { VocalWeightBaseline } from "../../src/audio/vocal-weight-baseline.js";

const WINDOW_MS = 50;        // matches dsp-worker.js
const HOP_MS = 25;            // matches capture-processor chunk cadence
const SIM_SECONDS = 5;

function simulate(sampleRate, label) {
  console.log(`\n=== ${label}: sampleRate = ${sampleRate} Hz ===`);
  const windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
  const canonicalLen = Math.floor(windowSize * CANONICAL_SR / sampleRate);
  console.log(`  windowSize = ${windowSize} native → ${canonicalLen} canonical (cap ${CPP_INPUT_LEN}, min ${CPP_MIN_INPUT_LEN})`);
  if (canonicalLen < CPP_MIN_INPUT_LEN) {
    console.log(`  ⚠ canonical (${canonicalLen}) < CPP_MIN_INPUT_LEN (${CPP_MIN_INPUT_LEN}) → computeCPP will return null`);
  } else if (canonicalLen < CPP_INPUT_LEN) {
    console.log(`  ℹ canonical (${canonicalLen}) < CPP_INPUT_LEN (${CPP_INPUT_LEN}) → computeCPP zero-pads to ${CPP_INPUT_LEN}-pt FFT`);
  }

  // Synthetic voiced signal: 120 Hz pulse train + cascaded resonators
  // for /a/ vowel formants. This is the modal-phonation case from
  // cpp-test.js — we know computeCPP returns ~10 dB on it at 48 kHz.
  const totalSamples = sampleRate * SIM_SECONDS;
  const signal = new Float32Array(totalSamples);
  const period = sampleRate / 120;
  for (let t = 0; t < totalSamples; t += period) {
    const idx = Math.round(t);
    if (idx < totalSamples) signal[idx] = 1.0;
  }
  // Apply spectral tilt
  let prev = 0;
  for (let i = 0; i < totalSamples; i++) {
    signal[i] = signal[i] + 0.98 * prev;
    prev = signal[i];
  }
  // Single biquad resonator at F1=700 (just to make it not pure pulse train)
  const r = Math.exp(-Math.PI * 80 / sampleRate);
  const cosTheta = Math.cos(2 * Math.PI * 700 / sampleRate);
  const a1 = -2 * r * cosTheta;
  const a2 = r * r;
  const b0 = (1 - r * r) * Math.sin(2 * Math.PI * 700 / sampleRate);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < totalSamples; i++) {
    const y = b0 * signal[i] - a1 * y1 - a2 * y2;
    signal[i] = y;
    y2 = y1;
    y1 = y;
  }
  // Normalize
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) if (Math.abs(signal[i]) > peak) peak = Math.abs(signal[i]);
  if (peak > 0) for (let i = 0; i < totalSamples; i++) signal[i] /= peak;

  const aggregator = new VocalWeightAggregator();
  const baseline = new VocalWeightBaseline();
  let lastAggTime = -1;

  // Simulate the ring-buffer + analysisCount pattern of dsp-worker.js
  const hopSamples = Math.floor(sampleRate * HOP_MS / 1000);
  let analysisCount = 0;
  let cppNullCount = 0;
  let cppValueCount = 0;
  let firstAggregateTime = null;
  let aggregatesEmitted = 0;
  let baselineLockTime = null;

  // First analysis can happen once we have windowSize samples.
  for (let pos = windowSize; pos <= totalSamples; pos += hopSamples) {
    const window = signal.subarray(pos - windowSize, pos);
    const time = (pos / sampleRate) * 1000;   // ms

    let cpp = null;
    if (analysisCount % 6 === 0) {
      cpp = computeCPP(window, sampleRate);
      if (cpp === null) cppNullCount++;
      else cppValueCount++;
    }
    analysisCount++;

    // Production sets voiced = !isQuiet (debounced). For this synthetic
    // signal (always voiced), simulate that the debouncer says voiced=true.
    const cppAggregate = aggregator.push({ time, cpp, voiced: true });

    if (cppAggregate && cppAggregate.time !== lastAggTime) {
      if (firstAggregateTime === null) firstAggregateTime = cppAggregate.time;
      aggregatesEmitted++;
      baseline.accumulate({ time: cppAggregate.time, cpp: cppAggregate.cpp });
      lastAggTime = cppAggregate.time;
      if (baseline.ready() && baselineLockTime === null) {
        baselineLockTime = cppAggregate.time;
      }
    }
  }

  console.log(`  Total DSP frames: ${analysisCount}`);
  console.log(`  CPP computations: ${cppValueCount} successful, ${cppNullCount} null`);
  console.log(`  Aggregates emitted: ${aggregatesEmitted}`);
  console.log(`  First aggregate at: ${firstAggregateTime !== null ? firstAggregateTime.toFixed(0) + " ms" : "NEVER"}`);
  console.log(`  Baseline ready: ${baseline.ready() ? `yes (locked at ${baselineLockTime.toFixed(0)} ms, μ=${baseline.mu().toFixed(2)} σ=${baseline.sigma().toFixed(3)})` : "no, progress=" + (baseline.progress() * 100).toFixed(0) + "%"}`);

  return { aggregatesEmitted, firstAggregateTime, baselineReady: baseline.ready() };
}

console.log("Vocal-weight pipeline trace");
console.log("==========================");
console.log(`Simulating ${SIM_SECONDS} s of voiced 120 Hz speech through the production pipeline (CPP → aggregator → baseline) at common AudioContext sample rates.`);

const results = [
  ["48 kHz (typical desktop)", simulate(48000, "48 kHz")],
  ["44.1 kHz (Safari, some configs)", simulate(44100, "44.1 kHz")],
  ["32 kHz", simulate(32000, "32 kHz")],
  ["22.05 kHz", simulate(22050, "22.05 kHz")],
  ["16 kHz (mobile silent downsample)", simulate(16000, "16 kHz")],
];

console.log("\n--------");
console.log("Summary:");
for (const [label, r] of results) {
  const status = r.aggregatesEmitted > 0 ? "✓" : "✗";
  console.log(`  ${status} ${label}: ${r.aggregatesEmitted} aggregates`);
}

// Exit non-zero if 48 kHz fails (production-relevant case).
const desktop48k = results[0][1];
if (desktop48k.aggregatesEmitted === 0) {
  console.log("\nFAIL: no aggregate at 48 kHz. Production pipeline is broken.");
  process.exit(1);
}
