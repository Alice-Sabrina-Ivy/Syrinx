// generate-pathological-stimuli.js — Build the four pathological stimuli the
// octave-lock investigation needs to test for deeper-than-9-frame lock states.
// Each fixture has a stress section followed by a long steady-at-400 Hz
// recovery section so the diagnostic can measure how many frames it takes
// for the HMM to escape any lock the stress induced.
//
// Usage: node scripts/generate-pathological-stimuli.js
// Outputs: tests/audio/fixtures/path-{burst,boundary,longwalk,humandrag}-then-400.wav

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "tests", "audio", "fixtures");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const SR = 16000;
const RECOVERY_SEC = 6;          // long enough to measure recovery cleanly
const RECOVERY_F = 400;          // steady frequency for recovery section
const F_LOW = 100;
const F_HIGH = 400;

// Deterministic PRNG so all four fixtures are reproducible byte-identical.
function makePrng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function writeWav(name, freqAt, totalSec) {
  const N = Math.round(SR * totalSec);
  const samples = new Int16Array(N);
  let phase = 0;
  for (let i = 0; i < N; i++) {
    const tSec = i / SR;
    const f = freqAt(tSec);
    phase += (2 * Math.PI * f) / SR;
    let s = Math.sin(phase);
    const rampN = Math.floor(SR * 0.005);
    let env = 1;
    if (i < rampN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / rampN);
    else if (i > N - rampN) env = 0.5 - 0.5 * Math.cos((Math.PI * (N - i)) / rampN);
    const v = s * env * 0.3 * 32767;
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
  }
  const dataSize = N * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < N; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  const path = join(OUT_DIR, name);
  writeFileSync(path, buf);
  console.log(`  ${name}: ${totalSec.toFixed(1)} s`);
}

// ---------------------------------------------------------------------------
//  1. Burst — 8 rapid sweeps in sequence, no rest between.
// ---------------------------------------------------------------------------
{
  const SWEEP_CYCLE_SEC = 0.5;
  const N_CYCLES = 8;
  const BURST_SEC = SWEEP_CYCLE_SEC * N_CYCLES;
  const total = BURST_SEC + RECOVERY_SEC;
  writeWav("path-burst-then-400.wav", (t) => {
    if (t >= BURST_SEC) return RECOVERY_F;
    const ct = (t % SWEEP_CYCLE_SEC) / SWEEP_CYCLE_SEC;
    const tri = ct < 0.5 ? 1 - 2 * ct : 2 * ct - 1;
    return F_LOW + (F_HIGH - F_LOW) * tri;
  }, total);
}

// ---------------------------------------------------------------------------
//  2. Boundary — sine-modulated pitch oscillating around 200 Hz with
//     amplitude that crosses the half-octave boundary.
// ---------------------------------------------------------------------------
{
  const STRESS_SEC = 4;
  const total = STRESS_SEC + RECOVERY_SEC;
  // 5 Hz LFO modulating between ~140 and ~280 Hz (crosses the 200 Hz half-
  // octave point of the recovery target).
  writeWav("path-boundary-then-400.wav", (t) => {
    if (t >= STRESS_SEC) return RECOVERY_F;
    return 200 + 70 * Math.sin(2 * Math.PI * 5 * t);
  }, total);
}

// ---------------------------------------------------------------------------
//  3. Long walk — 30 s of random walk in [100, 400] Hz at 30 Hz step rate.
// ---------------------------------------------------------------------------
{
  const STRESS_SEC = 30;
  const total = STRESS_SEC + RECOVERY_SEC;
  const STEP_DUR = 1 / 30;
  const MAX_STEP = 80;
  const rand = makePrng(424242);
  let curF = 250;
  let stepTimer = 0;
  let lastT = 0;
  writeWav("path-longwalk-then-400.wav", (t) => {
    if (t >= STRESS_SEC) return RECOVERY_F;
    stepTimer += t - lastT;
    lastT = t;
    if (stepTimer >= STEP_DUR) {
      const dF = (rand() * 2 - 1) * MAX_STEP;
      curF += dF;
      if (curF < F_LOW) curF = F_LOW + (F_LOW - curF);
      if (curF > F_HIGH) curF = F_HIGH - (curF - F_HIGH);
      stepTimer = 0;
    }
    return curF;
  }, total);
}

// ---------------------------------------------------------------------------
//  4. Human-drag — emulates an aggressive slider drag: variable speed,
//     occasional pauses, direction reversals, biased toward octave-confusable
//     transitions across 200 Hz.
// ---------------------------------------------------------------------------
{
  const STRESS_SEC = 20;
  const total = STRESS_SEC + RECOVERY_SEC;
  const rand = makePrng(987654);
  // Build a sequence of segments: each segment is a target freq + duration +
  // approach speed. Slow segments (pauses) use long durations and small
  // freq changes; fast segments use short durations and big jumps.
  const segs = [];
  let curF = 250;
  let total_t = 0;
  while (total_t < STRESS_SEC) {
    const isPause = rand() < 0.15;       // 15% pauses
    const dur = isPause
      ? 0.3 + rand() * 0.5               // 300–800 ms pauses
      : 0.05 + rand() * 0.25;            // 50–300 ms fast slides
    const targetF = isPause
      ? curF + (rand() - 0.5) * 20       // tiny drift during pause
      : F_LOW + rand() * (F_HIGH - F_LOW); // slide to anywhere
    segs.push({ start: total_t, end: total_t + dur, fromF: curF, toF: targetF });
    curF = targetF;
    total_t += dur;
  }
  writeWav("path-humandrag-then-400.wav", (t) => {
    if (t >= STRESS_SEC) return RECOVERY_F;
    // Find current segment.
    for (const s of segs) {
      if (t >= s.start && t < s.end) {
        const u = (t - s.start) / (s.end - s.start);
        return s.fromF + (s.toF - s.fromF) * u;
      }
    }
    return curF;
  }, total);
}

console.log("done.");
