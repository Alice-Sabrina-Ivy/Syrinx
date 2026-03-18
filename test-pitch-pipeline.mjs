#!/usr/bin/env node
// Test: synthetic sine wave through pitch detection + full pipeline
// Isolates whether the algorithm is broken vs the data flow is broken.

// ─── Copy of DSP functions from dsp-worker.js ───

function computeIntensity(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

function detectPitch(buffer, sr) {
  const threshold = 0.20;
  const minF0 = 75;
  const maxF0 = 600;
  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.floor(sr / minF0);
  const halfLen = Math.floor(buffer.length / 2);
  const searchLen = Math.min(maxLag + 2, halfLen);

  if (maxLag >= halfLen) return null;

  const diff = new Float32Array(searchLen);
  for (let tau = 1; tau < searchLen; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  const cmnd = new Float32Array(searchLen);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, searchLen); tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < searchLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null;

  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < searchLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  const refinedTau = denom !== 0 ? bestTau + (s0 - s2) / denom : bestTau;

  const pitch = sr / refinedTau;
  if (pitch < minF0 || pitch > maxF0) return null;
  return pitch;
}

// ─── Copy of ring buffer logic from dsp-worker.js ───

const WINDOW_MS = 200;
const SAMPLE_RATE = 48000;
const windowSize = Math.floor(SAMPLE_RATE * WINDOW_MS / 1000); // 9600
const ringCapacity = windowSize * 2; // 19200
let ringBuffer = new Float32Array(ringCapacity);
let ringLen = 0;

function appendToRingBuffer(chunk) {
  if (ringLen + chunk.length <= ringCapacity) {
    ringBuffer.set(chunk, ringLen);
    ringLen += chunk.length;
  } else {
    const keepLen = Math.min(ringLen, ringCapacity - chunk.length);
    ringBuffer.copyWithin(0, ringLen - keepLen, ringLen);
    ringBuffer.set(chunk, keepLen);
    ringLen = keepLen + chunk.length;
  }
}

// ─── Copy of smoothing/gating logic from useAudioPipeline.js ───

const SILENCE_THRESHOLD_DB = -50;
const SILENCE_DEBOUNCE_FRAMES = 3;
const PITCH_SMOOTH_LEN = 3;

let pitchSmoothBuf = [];
let quietFrameCount = 0;
let silenceStart = null;
let traceEntries = [];

function pushAndMedian(buf, value, maxLen) {
  buf.push(value);
  if (buf.length > maxLen) buf.shift();
  return median(buf);
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function handleAnalysisResult(pitch, intensity, frameTime) {
  const frameQuiet = intensity < SILENCE_THRESHOLD_DB;
  const hasPitch = pitch !== null;

  if (frameQuiet) {
    quietFrameCount++;
  } else {
    quietFrameCount = 0;
  }

  const isQuiet = quietFrameCount >= SILENCE_DEBOUNCE_FRAMES;

  if (isQuiet) {
    if (silenceStart === null) silenceStart = frameTime;
    traceEntries.push({ time: frameTime, pitch: null, voiced: false, reason: "quiet" });
    return;
  }

  silenceStart = null;

  const effectivePitch = hasPitch
    ? pitch
    : (pitchSmoothBuf.length > 0 ? pitchSmoothBuf[pitchSmoothBuf.length - 1] : null);

  if (effectivePitch === null) {
    traceEntries.push({ time: frameTime, pitch: null, voiced: false, reason: "no_pitch" });
    return;
  }

  const smoothedPitch = hasPitch
    ? pushAndMedian(pitchSmoothBuf, pitch, PITCH_SMOOTH_LEN)
    : median(pitchSmoothBuf);

  traceEntries.push({ time: frameTime, pitch: smoothedPitch, voiced: true, reason: "voiced" });
}

// ─── Generate synthetic sine wave ───

function generateSine(freq, sampleRate, durationSec, amplitude = 0.5) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buffer[i] = amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return buffer;
}

// ─── Test 1: Pure pitch detection on a single window ───

console.log("═══════════════════════════════════════════════");
console.log("TEST 1: Pitch detection on single analysis windows");
console.log("═══════════════════════════════════════════════\n");

const testFreqs = [220, 251, 300, 150, 440];
for (const freq of testFreqs) {
  const signal = generateSine(freq, SAMPLE_RATE, 0.2); // 200ms = windowSize
  const detected = detectPitch(signal, SAMPLE_RATE);
  const intensity = computeIntensity(signal);
  const error = detected !== null ? Math.abs(detected - freq).toFixed(2) : "FAILED";
  console.log(`  ${freq} Hz → detected: ${detected !== null ? detected.toFixed(2) : "null"} Hz (error: ${error} Hz)  intensity: ${intensity.toFixed(1)} dB`);
}

// ─── Test 2: Repeated identical windows (simulating constant pitch) ───

console.log("\n═══════════════════════════════════════════════");
console.log("TEST 2: 100 consecutive identical windows at 220 Hz");
console.log("  (simulates constant pitch - the failing condition)");
console.log("═══════════════════════════════════════════════\n");

const constantSignal = generateSine(220, SAMPLE_RATE, 0.2);
let nullCount = 0;
let detections = [];
for (let i = 0; i < 100; i++) {
  const detected = detectPitch(constantSignal, SAMPLE_RATE);
  if (detected === null) nullCount++;
  detections.push(detected);
}
console.log(`  Detections: ${100 - nullCount}/100 succeeded`);
console.log(`  Nulls: ${nullCount}/100`);
if (nullCount > 0) {
  console.log(`  *** PITCH DETECTION FAILS ON CONSTANT INPUT ***`);
  const nullIndices = detections.map((d, i) => d === null ? i : -1).filter(i => i >= 0);
  console.log(`  Null at frames: ${nullIndices.slice(0, 20).join(", ")}${nullIndices.length > 20 ? "..." : ""}`);
}

// ─── Test 3: Full pipeline simulation (ring buffer + detection + smoothing + gating) ───

console.log("\n═══════════════════════════════════════════════");
console.log("TEST 3: Full pipeline - 5 seconds of constant 220 Hz");
console.log("  (ring buffer → detection → smoothing → gating)");
console.log("═══════════════════════════════════════════════\n");

// Reset state
ringBuffer = new Float32Array(ringCapacity);
ringLen = 0;
pitchSmoothBuf = [];
quietFrameCount = 0;
silenceStart = null;
traceEntries = [];

// Generate 5 seconds of 220 Hz sine
const fiveSecSignal = generateSine(220, SAMPLE_RATE, 5.0);
const chunkSize = Math.floor(SAMPLE_RATE * 0.05); // 2400 samples per chunk
const totalChunks = Math.floor(fiveSecSignal.length / chunkSize);

let analysisCount = 0;
let voicedFrames = 0;
let quietFrames = 0;
let noPitchFrames = 0;
let firstGapChunk = -1;

for (let c = 0; c < totalChunks; c++) {
  const chunk = fiveSecSignal.subarray(c * chunkSize, (c + 1) * chunkSize);
  appendToRingBuffer(chunk);

  if (ringLen < windowSize) continue;

  const windowStart = ringLen - windowSize;
  const window = ringBuffer.subarray(windowStart, ringLen);
  const intensity = computeIntensity(window);
  const pitch = detectPitch(window, SAMPLE_RATE);
  const frameTime = c * 50; // 50ms per chunk

  handleAnalysisResult(pitch, intensity, frameTime);
  analysisCount++;

  const lastEntry = traceEntries[traceEntries.length - 1];
  if (lastEntry.reason === "voiced") voicedFrames++;
  else if (lastEntry.reason === "quiet") quietFrames++;
  else if (lastEntry.reason === "no_pitch") noPitchFrames++;

  if (!lastEntry.voiced && firstGapChunk === -1 && analysisCount > 1) {
    firstGapChunk = c;
  }
}

console.log(`  Total chunks sent: ${totalChunks}`);
console.log(`  Analysis frames run: ${analysisCount}`);
console.log(`  Voiced frames: ${voicedFrames}`);
console.log(`  Quiet frames: ${quietFrames}`);
console.log(`  No-pitch frames: ${noPitchFrames}`);
if (firstGapChunk >= 0) {
  console.log(`  *** FIRST GAP at chunk ${firstGapChunk} (${firstGapChunk * 50}ms) ***`);
}

// Show trace timeline: V=voiced, Q=quiet, N=no_pitch
const timeline = traceEntries.map(e => e.voiced ? "V" : e.reason === "quiet" ? "Q" : "N").join("");
console.log(`\n  Timeline (V=voiced, Q=quiet, N=no_pitch):`);
// Print in rows of 80
for (let i = 0; i < timeline.length; i += 80) {
  const chunk = timeline.slice(i, i + 80);
  const startMs = (i * 50);
  console.log(`    ${String(startMs).padStart(5)}ms: ${chunk}`);
}

// ─── Test 4: Varying pitch for comparison ───

console.log("\n═══════════════════════════════════════════════");
console.log("TEST 4: Full pipeline - 5 seconds of VARYING pitch (200-300 Hz sweep)");
console.log("═══════════════════════════════════════════════\n");

// Reset state
ringBuffer = new Float32Array(ringCapacity);
ringLen = 0;
pitchSmoothBuf = [];
quietFrameCount = 0;
silenceStart = null;
traceEntries = [];

// Generate 5 seconds of sweeping sine (200-300 Hz)
const sweepSignal = new Float32Array(SAMPLE_RATE * 5);
for (let i = 0; i < sweepSignal.length; i++) {
  const t = i / SAMPLE_RATE;
  const freq = 200 + 100 * Math.sin(2 * Math.PI * 0.5 * t); // oscillate 200-300 Hz at 0.5 Hz
  sweepSignal[i] = 0.5 * Math.sin(2 * Math.PI * freq * t);
}

analysisCount = 0;
voicedFrames = 0;
quietFrames = 0;
noPitchFrames = 0;
firstGapChunk = -1;

for (let c = 0; c < totalChunks; c++) {
  const chunk = sweepSignal.subarray(c * chunkSize, (c + 1) * chunkSize);
  appendToRingBuffer(chunk);

  if (ringLen < windowSize) continue;

  const windowStart = ringLen - windowSize;
  const window = ringBuffer.subarray(windowStart, ringLen);
  const intensity = computeIntensity(window);
  const pitch = detectPitch(window, SAMPLE_RATE);
  const frameTime = c * 50;

  handleAnalysisResult(pitch, intensity, frameTime);
  analysisCount++;

  const lastEntry = traceEntries[traceEntries.length - 1];
  if (lastEntry.reason === "voiced") voicedFrames++;
  else if (lastEntry.reason === "quiet") quietFrames++;
  else if (lastEntry.reason === "no_pitch") noPitchFrames++;

  if (!lastEntry.voiced && firstGapChunk === -1 && analysisCount > 1) {
    firstGapChunk = c;
  }
}

console.log(`  Total chunks sent: ${totalChunks}`);
console.log(`  Analysis frames run: ${analysisCount}`);
console.log(`  Voiced frames: ${voicedFrames}`);
console.log(`  Quiet frames: ${quietFrames}`);
console.log(`  No-pitch frames: ${noPitchFrames}`);
if (firstGapChunk >= 0) {
  console.log(`  *** FIRST GAP at chunk ${firstGapChunk} (${firstGapChunk * 50}ms) ***`);
}

const timeline2 = traceEntries.map(e => e.voiced ? "V" : e.reason === "quiet" ? "Q" : "N").join("");
console.log(`\n  Timeline (V=voiced, Q=quiet, N=no_pitch):`);
for (let i = 0; i < timeline2.length; i += 80) {
  const chunk = timeline2.slice(i, i + 80);
  const startMs = (i * 50);
  console.log(`    ${String(startMs).padStart(5)}ms: ${chunk}`);
}

// ─── Test 5: Ring buffer boundary check ───

console.log("\n═══════════════════════════════════════════════");
console.log("TEST 5: Ring buffer boundary - check for corruption at wrap point");
console.log("═══════════════════════════════════════════════\n");

ringBuffer = new Float32Array(ringCapacity);
ringLen = 0;

// Fill ring buffer to capacity, then send more chunks
const testSine = generateSine(220, SAMPLE_RATE, 2.0); // 2 seconds
const chunks = [];
for (let i = 0; i < testSine.length; i += chunkSize) {
  chunks.push(testSine.subarray(i, Math.min(i + chunkSize, testSine.length)));
}

let wrapOccurred = false;
let preWrapPitch = null;
let postWrapPitch = null;

for (let c = 0; c < chunks.length; c++) {
  const prevRingLen = ringLen;
  appendToRingBuffer(chunks[c]);

  if (ringLen < windowSize) continue;

  // Detect wrap point
  if (prevRingLen + chunks[c].length > ringCapacity && !wrapOccurred) {
    wrapOccurred = true;
    console.log(`  Ring buffer wrapped at chunk ${c} (ringLen before: ${prevRingLen})`);
  }

  const windowStart = ringLen - windowSize;
  const window = ringBuffer.subarray(windowStart, ringLen);
  const pitch = detectPitch(window, SAMPLE_RATE);
  const intensity = computeIntensity(window);

  if (wrapOccurred && postWrapPitch === null && pitch !== null) {
    postWrapPitch = pitch;
    console.log(`  First pitch AFTER wrap: ${pitch.toFixed(2)} Hz, intensity: ${intensity.toFixed(1)} dB`);
  }
  if (!wrapOccurred && pitch !== null) {
    preWrapPitch = pitch;
  }
}
if (preWrapPitch !== null) {
  console.log(`  Last pitch BEFORE wrap: ${preWrapPitch.toFixed(2)} Hz`);
}
if (preWrapPitch && postWrapPitch) {
  const drift = Math.abs(postWrapPitch - preWrapPitch);
  console.log(`  Drift across wrap: ${drift.toFixed(2)} Hz ${drift > 5 ? "*** SIGNIFICANT ***" : "(OK)"}`);
}

console.log("\n═══════════════════════════════════════════════");
console.log("DONE");
console.log("═══════════════════════════════════════════════");
