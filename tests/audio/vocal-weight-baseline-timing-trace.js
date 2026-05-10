// vocal-weight-baseline-timing-trace.js — Reproduce the user-
// reported slow-calibration finding (~60 s vs audit's 30 s).
//
// Simulates realistic conversational speech (with brief consonant
// gaps and short pauses) through the production pipeline and
// measures wall-clock time from session start to baseline lock.
//
// Usage: node tests/audio/vocal-weight-baseline-timing-trace.js

import { computeCPP, CPP_INPUT_LEN, CPP_MIN_INPUT_LEN } from "../../src/dsp/cpp.js";
import { VocalWeightAggregator } from "../../src/audio/vocal-weight-aggregator.js";
import { VocalWeightBaseline } from "../../src/audio/vocal-weight-baseline.js";

const SAMPLE_RATE = 48000;
const CHUNK_MS = 25;                  // capture-processor chunk cadence
const WINDOW_MS = 50;                 // dsp-worker analysis window
const SIM_SECONDS = 90;
const SILENCE_DEBOUNCE_FRAMES = 3;    // matches useAudioPipeline.js

// Realistic speech profile: a fraction of frames are "quiet" even
// during continuous speech — fricatives like /s/, /f/, brief stops,
// and inter-word gaps. Mid-conversation, this is typically 10-20 %
// of frames.
function generateConversationalVoicingPattern(numFrames, fractionQuiet, gapEvery, gapDuration) {
  // Returns a Uint8Array of voicing flags (1=voiced, 0=quiet).
  const flags = new Uint8Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    if (Math.random() < fractionQuiet) flags[i] = 0;
    else flags[i] = 1;
  }
  // Add deliberate longer gaps to model breath pauses
  if (gapEvery > 0) {
    for (let g = gapEvery; g < numFrames; g += gapEvery) {
      const dur = Math.min(gapDuration, numFrames - g);
      for (let i = 0; i < dur; i++) flags[g + i] = 0;
    }
  }
  return flags;
}

function simulate(label, fractionQuiet, gapEverySec, gapDurMs) {
  console.log(`\n=== ${label} ===`);
  console.log(`  raw-frame quiet fraction = ${(fractionQuiet * 100).toFixed(1)}%, breath gaps every ${gapEverySec}s for ${gapDurMs}ms`);

  const aggregator = new VocalWeightAggregator();
  const baseline = new VocalWeightBaseline();
  let lastAggTime = -1;

  const totalFrames = Math.floor((SIM_SECONDS * 1000) / CHUNK_MS);
  const gapEveryFrames = Math.floor(gapEverySec * 1000 / CHUNK_MS);
  const gapDurFrames = Math.floor(gapDurMs / CHUNK_MS);
  const flags = generateConversationalVoicingPattern(totalFrames, fractionQuiet, gapEveryFrames, gapDurFrames);

  // Pre-generate one period of synthetic vowel; reuse on each frame.
  // We don't actually need different audio per frame for this timing
  // analysis — what matters is that computeCPP returns valid CPP
  // when called.
  const winSize = Math.floor(SAMPLE_RATE * WINDOW_MS / 1000);
  const audioWindow = new Float32Array(winSize);
  const period = SAMPLE_RATE / 120;
  for (let t = 0; t < winSize; t += period) {
    const idx = Math.round(t);
    if (idx < winSize) audioWindow[idx] = 0.5;
  }
  // Apply spectral tilt so cepstrum has nontrivial peak
  let prev = 0;
  for (let i = 0; i < winSize; i++) {
    audioWindow[i] = audioWindow[i] + 0.98 * prev;
    prev = audioWindow[i];
  }

  let analysisCount = 0;
  let quietFrameCount = 0;
  let voicedAggregateCount = 0;
  let totalAggregateCount = 0;
  let baselineLockTime = null;
  let firstAccumulateTime = null;
  let firstAggregateEmitTime = null;

  for (let f = 0; f < totalFrames; f++) {
    const time = f * CHUNK_MS;
    const rawVoiced = flags[f] === 1;
    // Mimic the silence debounce: requires SILENCE_DEBOUNCE_FRAMES
    // consecutive raw-quiet frames before isQuiet=true. Matches
    // useAudioPipeline.js logic.
    if (!rawVoiced) quietFrameCount++;
    else quietFrameCount = 0;
    const isQuiet = quietFrameCount >= SILENCE_DEBOUNCE_FRAMES;

    let cpp = null;
    if (analysisCount % 6 === 0) {
      cpp = computeCPP(audioWindow, SAMPLE_RATE);
    }
    analysisCount++;

    const cppAggregate = aggregator.push({ time, cpp, voiced: !isQuiet });

    if (cppAggregate && cppAggregate.time !== lastAggTime) {
      totalAggregateCount++;
      if (firstAggregateEmitTime === null) firstAggregateEmitTime = cppAggregate.time;
      // Baseline accumulator's gate (matches useAudioPipeline.js)
      if (!isQuiet) {
        if (firstAccumulateTime === null) firstAccumulateTime = cppAggregate.time;
        baseline.accumulate({ time: cppAggregate.time, cpp: cppAggregate.cpp });
        voicedAggregateCount++;
        if (baseline.ready() && baselineLockTime === null) {
          baselineLockTime = cppAggregate.time;
          break;
        }
      }
      lastAggTime = cppAggregate.time;
    }
  }

  console.log(`  Total DSP frames: ${analysisCount}`);
  console.log(`  First aggregate emit: ${firstAggregateEmitTime !== null ? (firstAggregateEmitTime / 1000).toFixed(2) + " s" : "NEVER"}`);
  console.log(`  Total aggregate emits: ${totalAggregateCount}`);
  console.log(`  Voiced aggregate emits (baseline-eligible): ${voicedAggregateCount}`);
  console.log(`  First baseline accumulate: ${firstAccumulateTime !== null ? (firstAccumulateTime / 1000).toFixed(2) + " s" : "NEVER"}`);
  if (baselineLockTime !== null) {
    console.log(`  Baseline LOCKED at: ${(baselineLockTime / 1000).toFixed(2)} s ✓`);
    console.log(`  Time from first accumulate to lock: ${((baselineLockTime - firstAccumulateTime) / 1000).toFixed(2)} s`);
  } else {
    const progress = baseline.progress();
    const samples = baseline.state().sampleCount;
    console.log(`  Baseline NOT LOCKED after ${SIM_SECONDS}s; progress=${(progress * 100).toFixed(0)}%, samples=${samples}`);
  }

  return { baselineLockTime, firstAccumulateTime, voicedAggregateCount };
}

console.log("Vocal-weight calibration-time trace");
console.log("===================================");
console.log("Reproducing user-reported ~60 s calibration time.");
console.log(`Sample rate: ${SAMPLE_RATE} Hz, CHUNK_MS: ${CHUNK_MS}, simulating up to ${SIM_SECONDS}s.\n`);

// Three regimes:
// (a) Pure continuous voiced speech (audit's assumed condition)
// (b) Conversational speech with 15% quiet frames + 1s breath every 6s
// (c) Heavy-fricative speech with 25% quiet frames + 1.5s breath every 5s
simulate("(a) Continuous pure-voiced speech (audit assumption)", 0.0, 0, 0);
simulate("(b) Conversational speech (15% quiet + breath every 6s)", 0.15, 6, 1000);
simulate("(c) Heavy fricatives + frequent breaths (25% quiet)", 0.25, 5, 1500);
