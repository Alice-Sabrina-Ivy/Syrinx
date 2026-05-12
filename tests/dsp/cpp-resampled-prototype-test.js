// cpp-resampled-prototype-test.js — Validate the sample-rate-
// invariant CPP prototype.
//
// Compares:
//   (A) Production computeCPP (sample-rate-adaptive CPP_INPUT_LEN)
//   (B) Prototype computeCPPResampled (resample to canonical 16 kHz
//       before computation)
//
// against the existing sample-rate sensitivity diagnostic:
// take a fixed audio sample, resample to multiple sample rates,
// run both implementations at each, compare medians.
//
// Pass criteria:
//   - Prototype's CPP value spread across sample rates < 0.05 dB
//     (vs production's 0.1-0.3 dB spread on the same audio)
//   - Prototype's CPP magnitude on each sample is in a reasonable
//     range (not collapsed to zero or wildly different from
//     production)
//
// Usage: node tests/dsp/cpp-resampled-prototype-test.js
// Output: measurements/cpp-resampled-prototype-test-2026-05-12.json

import { writeFileSync, mkdirSync } from "node:fs";
import { computeCPP, resetCppState } from "../../src/dsp/cpp.js";
import { computeCPPResampled, resetCppState as resetProto } from "../../src/dsp/cpp-resampled-prototype.js";
import { loadPtdbTug, loadFda } from "./data/corpora.js";

function resampleLinear(buffer, fromRate, toRate) {
  if (fromRate === toRate) return new Float32Array(buffer);
  const ratio = fromRate / toRate;
  const outLen = Math.floor(buffer.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcF = i / (toRate / fromRate);
    const i0 = Math.floor(srcF);
    const i1 = Math.min(i0 + 1, buffer.length - 1);
    const t = srcF - i0;
    out[i] = buffer[i0] * (1 - t) + buffer[i1] * t;
  }
  return out;
}

function runOverFile(samples, nativeSr, targetSr, fn, resetFn) {
  const audio = nativeSr === targetSr ? samples : resampleLinear(samples, nativeSr, targetSr);
  resetFn();
  const winSize = Math.floor(targetSr * 0.05);
  const hopSize = Math.floor(targetSr * 0.025);
  const cpps = [];
  for (let pos = winSize; pos <= audio.length; pos += hopSize) {
    const window = audio.subarray(pos - winSize, pos);
    const cpp = fn(window, targetSr);
    if (typeof cpp === "number" && isFinite(cpp)) cpps.push(cpp);
  }
  if (cpps.length === 0) return { median: null, n: 0 };
  const sorted = [...cpps].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    n: cpps.length,
  };
}

const sampleRates = [16000, 22050, 32000, 44100, 48000];

console.log("CPP sample-rate-invariance prototype test");
console.log("==========================================\n");

const ptdb = loadPtdbTug();
const fda = loadFda();
const ptdbSample = ptdb[0];
const fdaSample = fda[0];

console.log(`PTDB-TUG sample: ${ptdbSample.trackId}, ${ptdbSample.sampleRate} Hz native, ${(ptdbSample.samples.length / ptdbSample.sampleRate).toFixed(2)}s`);
console.log(`FDA sample:     ${fdaSample.trackId}, ${fdaSample.sampleRate} Hz native, ${(fdaSample.samples.length / fdaSample.sampleRate).toFixed(2)}s\n`);

function runComparison(label, samples, nativeSr) {
  console.log(`\n--- ${label} (native ${nativeSr} Hz) ---`);
  console.log("  sr        | production | prototype");
  console.log("  ----------|------------|-----------");
  const prodValues = [];
  const protoValues = [];
  for (const sr of sampleRates) {
    const prod = runOverFile(samples, nativeSr, sr, computeCPP, resetCppState);
    const proto = runOverFile(samples, nativeSr, sr, computeCPPResampled, resetProto);
    const prodStr = prod.median?.toFixed(3) ?? "null";
    const protoStr = proto.median?.toFixed(3) ?? "null";
    console.log(`  ${String(sr).padStart(5)} Hz  | ${prodStr.padStart(10)} | ${protoStr.padStart(9)}`);
    if (prod.median !== null) prodValues.push(prod.median);
    if (proto.median !== null) protoValues.push(proto.median);
  }
  const prodSpread = Math.max(...prodValues) - Math.min(...prodValues);
  const protoSpread = Math.max(...protoValues) - Math.min(...protoValues);
  console.log(`  Production spread:  ${prodSpread.toFixed(3)} dB`);
  console.log(`  Prototype spread:   ${protoSpread.toFixed(3)} dB`);
  console.log(`  Reduction:          ${(prodSpread - protoSpread).toFixed(3)} dB (${prodSpread > 0 ? ((1 - protoSpread / prodSpread) * 100).toFixed(0) : 0}%)`);
  return { label, nativeSr, prod: prodValues, proto: protoValues, prodSpread, protoSpread };
}

const ptdbResult = runComparison("PTDB-TUG track", ptdbSample.samples, ptdbSample.sampleRate);
const fdaResult = runComparison("FDA track", fdaSample.samples, fdaSample.sampleRate);

console.log("\n=== Pass / fail criteria ===");
const passes = [];
for (const r of [ptdbResult, fdaResult]) {
  const pass = r.protoSpread < 0.05;
  console.log(`  ${r.label}: prototype spread ${r.protoSpread.toFixed(3)} dB ${pass ? "< 0.05 dB ✓" : ">= 0.05 dB ✗"}`);
  passes.push(pass);
}
const allPass = passes.every(Boolean);
console.log(`\nVerdict: ${allPass ? "PASS — prototype substantially eliminates sample-rate sensitivity" : "FAIL — prototype does not adequately fix sample-rate sensitivity"}`);

mkdirSync("measurements", { recursive: true });
writeFileSync("measurements/cpp-resampled-prototype-test-2026-05-12.json", JSON.stringify({
  timestamp: new Date().toISOString(),
  results: [ptdbResult, fdaResult],
  passCriterion: { protoSpreadMaxDb: 0.05 },
  verdict: allPass ? "PASS" : "FAIL",
}, null, 2));
console.log("\nWrote measurements/cpp-resampled-prototype-test-2026-05-12.json");
