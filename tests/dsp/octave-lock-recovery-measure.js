// octave-lock-recovery-measure.js — Programmatic measurement of HMM
// recovery from any wrong-octave lock state. For each fixture and α value:
//   1. Stream the WAV through detectPitch at 25 ms hop.
//   2. Identify the start of the steady-400-Hz recovery section.
//   3. Find the first frame in the recovery section where returned pitch
//      ≥ 350 Hz (correct-octave threshold).
//   4. Report frames-to-recover, plus the worst-case lock depth observed
//      anywhere in the trace (longest contiguous span of returned pitch
//      below 280 Hz with the next-locked-frame's true input ≥ 350 Hz).
//
// Each fixture has the recovery section starting at a known offset embedded
// in the filename or hardcoded below. Recovery section is steady at 400 Hz.
//
// Usage: node tests/dsp/octave-lock-recovery-measure.js [--alpha=N]

import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "../../src/dsp/dsp-worker.js");
const FIXTURE_DIR = join(__dirname, "../../tests/audio/fixtures");

const argAlpha = process.argv.slice(2).find((a) => a.startsWith("--alpha="));
const alpha = argAlpha ? parseFloat(argAlpha.slice("--alpha=".length)) : 0;

// Stress section duration (recovery starts here, runs to end of fixture).
const FIXTURES = [
  { name: "octave-step-200-then-400.wav",     stressEndSec: 2 },
  { name: "path-burst-then-400.wav",          stressEndSec: 4 },
  { name: "path-boundary-then-400.wav",       stressEndSec: 4 },
  { name: "path-longwalk-then-400.wav",       stressEndSec: 30 },
  { name: "path-humandrag-then-400.wav",      stressEndSec: 20 },
];

function loadWorker(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = { self: { postMessage() {}, onmessage: null }, performance: { now: () => 0, timeOrigin: 0 }, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
}

function readWav(path) {
  const buf = readFileSync(path);
  const sr = buf.readUInt32LE(24);
  const dataSize = buf.readUInt32LE(40);
  const N = dataSize / 2;
  const samples = new Float32Array(N);
  for (let i = 0; i < N; i++) samples[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return { samples, sr };
}

function runFixture(ctx, fixture) {
  const path = join(FIXTURE_DIR, fixture.name);
  const { samples, sr } = readWav(path);

  // Reset HMM, set α.
  ctx.self.onmessage({ data: { type: "set-pyin-alpha", alpha } });
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });

  const winN = Math.floor(sr * 50 / 1000);
  const hopN = Math.floor(sr * 25 / 1000);

  const trace = [];
  for (let i = 0; i + winN <= samples.length; i += hopN) {
    const win = samples.subarray(i, i + winN);
    const tSec = (i + winN) / sr;
    const r = ctx.detectPitch(win, sr);
    trace.push({ tSec, pitch: r });
  }

  // Recovery section: from stressEndSec onward, true input is constant 400 Hz.
  // Find first frame in recovery where pitch ≥ 350 Hz.
  const recoveryFrames = trace.filter((f) => f.tSec >= fixture.stressEndSec);
  let recoveryFrameCount = null;
  for (let i = 0; i < recoveryFrames.length; i++) {
    if (recoveryFrames[i].pitch !== null && recoveryFrames[i].pitch >= 350) {
      recoveryFrameCount = i;
      break;
    }
  }

  // Did the recovery actually stick? Check that 90%+ of the rest of the trace
  // (after recovery) is ≥ 350 Hz.
  let stuckRecovery = false;
  if (recoveryFrameCount !== null) {
    const post = recoveryFrames.slice(recoveryFrameCount);
    const inOctave = post.filter((f) => f.pitch !== null && f.pitch >= 350).length;
    if (inOctave / post.length < 0.9) stuckRecovery = true;
  }

  // Also: was there ever a wrong-octave lock during the stress section?
  // (i.e., a span of ≥ 5 consecutive frames returning < 280 Hz)
  let stressLockMax = 0;
  let curLockSpan = 0;
  for (const f of trace.filter((f) => f.tSec < fixture.stressEndSec)) {
    if (f.pitch !== null && f.pitch < 280) curLockSpan++;
    else { if (curLockSpan > stressLockMax) stressLockMax = curLockSpan; curLockSpan = 0; }
  }

  return {
    name: fixture.name,
    totalFrames: trace.length,
    recoveryFrames: recoveryFrames.length,
    framesToRecover: recoveryFrameCount,
    stuckRecovery,
    stressLockMaxSpan: stressLockMax,
  };
}

const ctx = loadWorker(16000);
console.log(`# α=${alpha}`);
console.log("# fixture                              | total | recov | frames-to-recover | stuck? | stress-lock-max");
console.log("# " + "-".repeat(112));
for (const f of FIXTURES) {
  const r = runFixture(ctx, f);
  const ftr = r.framesToRecover === null ? "NEVER" : String(r.framesToRecover);
  const stuck = r.stuckRecovery ? "YES" : "no";
  console.log(
    "  " +
    r.name.padEnd(38) +
    " | " + String(r.totalFrames).padStart(5) +
    " | " + String(r.recoveryFrames).padStart(5) +
    " | " + ftr.padStart(17) +
    " | " + stuck.padStart(6) +
    " | " + String(r.stressLockMaxSpan).padStart(15)
  );
}
