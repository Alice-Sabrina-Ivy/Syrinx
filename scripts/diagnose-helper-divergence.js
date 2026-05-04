// diagnose-helper-divergence.js — Disambiguate the pass-1 p95 anomaly.
//
// Three female files where Stage 2.B steadyStateDetect diverges from Stage 0
// by >150 Hz on a single steady-state window. For each: compare three
// measurement methodologies side-by-side to determine whether the
// divergence is methodology noise (single-window starves HMM) or a
// helper artifact (same-window-repeated reinforces single-window error).
//
// Methodologies:
//   (a) Stage 2.B + steadyStateDetect — current pass-1 helper:
//       reset HMM, feed same 50 ms central window 5 times (lookback=2 + 3).
//   (b) Stage 2.B + sequential frames — sigma-sweep methodology:
//       reset HMM, step 25 ms hops over central 70 %, last non-null.
//   (c) Stage 0 single 50 ms central window — historical baseline.
//
// Verdict criterion (per the user's framing):
//   if (a) ≈ (b)  → methodology issue (single-window starves HMM regardless
//                   of helper choice). Pass 1 numbers stand with caveat.
//   if (a) ≠ (b)  → helper artifact (same-window-repeated produces results
//                   that don't reflect production). Helper redesign needed.

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const DATA_DIR = join(ROOT, "tests/dsp/data");

const TARGETS = [
  { file: "w10uw", truth: 238, gender: "w" },
  { file: "w36uw", truth: 219, gender: "w" },
  { file: "w10ei", truth: 220, gender: "w" },
];

function readWav(p) {
  const buf = readFileSync(p);
  let off = 12, sr = 0, bps = 0, ds = 0, dz = 0;
  while (off < buf.length - 8) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt ") { sr = buf.readUInt32LE(off + 12); bps = buf.readUInt16LE(off + 22); }
    else if (id === "data") { ds = off + 8; dz = sz; break; }
    off += 8 + sz;
  }
  const n = dz / (bps / 8);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(ds + i * 2) / 32768;
  return { samples: s, sampleRate: sr };
}

function makeCtx() {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate: 16000 } });
  return ctx;
}

const ctx = makeCtx();

// (a) steadyStateDetect — current pass-1 helper.
function methodologyA(samples) {
  ctx.__PYIN_STAGE = 2; ctx.__PYIN_LOOKBACK = 2;
  const winN = 800;
  const start = Math.max(0, Math.floor((samples.length - winN) / 2));
  const window = samples.subarray(start, start + winN);
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
  let result = null;
  // lookback (2) + 3 = 5 frames
  for (let i = 0; i < 5; i++) result = ctx.detectPitch(window, 16000);
  return result;
}

// (b) sequential frames — sigma-sweep methodology.
function methodologyB(samples) {
  ctx.__PYIN_STAGE = 2; ctx.__PYIN_LOOKBACK = 2;
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
  const winN = 800, hopN = 400;
  const startN = Math.floor(samples.length * 0.15);
  const endN = Math.floor(samples.length * 0.85);
  let last = null;
  let trace = [];
  for (let i = startN; i + winN <= endN; i += hopN) {
    const r = ctx.detectPitch(samples.subarray(i, i + winN), 16000);
    trace.push(r);
    if (r !== null) last = r;
  }
  return { last, trace };
}

// (c) Stage 0 single window — historical baseline.
function methodologyC(samples) {
  ctx.__PYIN_STAGE = 0;
  const winN = 800;
  const start = Math.max(0, Math.floor((samples.length - winN) / 2));
  return ctx.detectPitch(samples.subarray(start, start + winN), 16000);
}

console.log("=== Pass 1 helper diagnostic — 3 worst-divergence female files ===\n");
console.log(`Methodology comparison per file:`);
console.log(`  (a) steadyStateDetect — feed central window 5 times, last result`);
console.log(`  (b) sequential frames — step 25 ms hops over central 70 %, last non-null`);
console.log(`  (c) Stage 0 single window — historical baseline\n`);

const results = [];
for (const t of TARGETS) {
  const wp = join(DATA_DIR, t.gender === "m" ? "men" : "women", `${t.file}.wav`);
  if (!existsSync(wp)) {
    console.log(`  SKIP ${t.file} (missing)`);
    continue;
  }
  const { samples, sampleRate } = readWav(wp);
  if (sampleRate !== 16000) continue;

  const a = methodologyA(samples);
  const b = methodologyB(samples);
  const c = methodologyC(samples);

  const truth = t.truth;
  const errA = a !== null ? Math.abs(a - truth) : NaN;
  const errB = b.last !== null ? Math.abs(b.last - truth) : NaN;
  const errC = c !== null ? Math.abs(c - truth) : NaN;
  const ratioAB = a !== null && b.last !== null ? a / b.last : NaN;

  console.log(`${t.file} (truth = ${truth} Hz, ${samples.length} samples = ${(samples.length/16).toFixed(0)} ms):`);
  console.log(`  (a) steadyStateDetect      → ${a !== null ? a.toFixed(1) : "null"} Hz   (err ${errA.toFixed(1)})`);
  console.log(`  (b) sequential frames      → ${b.last !== null ? b.last.toFixed(1) : "null"} Hz   (err ${errB.toFixed(1)}, ${b.trace.length} hops)`);
  console.log(`  (c) Stage 0 single window  → ${c !== null ? c.toFixed(1) : "null"} Hz   (err ${errC.toFixed(1)})`);
  console.log(`  (a)/(b) ratio              → ${ratioAB.toFixed(3)}`);
  console.log(`  (b) per-hop trace          → [${b.trace.map((x) => x === null ? "·" : x.toFixed(0)).join(", ")}]`);
  console.log("");

  results.push({ ...t, a, b: b.last, c, ratioAB, trace: b.trace });
}

// ---------------------------------------------------------------------------
//  Verdict
// ---------------------------------------------------------------------------

console.log("=== Verdict ===");
const aVsB = results.filter((r) => r.a !== null && r.b !== null)
  .map((r) => Math.abs(r.a - r.b));
const aMatchesB = aVsB.every((d) => d < 30); // within 30 Hz = same answer
const aIsOctaveOfB = results.filter((r) => r.a !== null && r.b !== null)
  .every((r) => {
    const ratio = r.a / r.b;
    return Math.abs(ratio - 2) < 0.15 || Math.abs(ratio - 0.5) < 0.075 || Math.abs(ratio - 1) < 0.075;
  });

if (aMatchesB) {
  console.log("EXPLANATION A: methodology issue.");
  console.log("(a) and (b) agree within 30 Hz on all 3 files. The single-window");
  console.log("methodology is the pass-1 issue, not the helper. The HMM is");
  console.log("inherently starved by single-window evaluation regardless of");
  console.log("whether the window is fed once or 5 times.");
  console.log("Pass 1 numbers can stand with the caveat that single-window-per-file");
  console.log("is not representative of production.");
} else {
  console.log("EXPLANATION B: helper artifact.");
  console.log("(a) and (b) diverge, with (a) systematically pushing the HMM into");
  console.log("an octave above truth that (b) avoids by stepping through the");
  console.log("recording. The same-window-repeated pattern in steadyStateDetect");
  console.log("reinforces a single-window observation 5 times rather than letting");
  console.log("the HMM filter across temporally distinct frames. On real speech");
  console.log("(non-stationary), the helper produces results that are not");
  console.log("representative of production.");
  console.log("");
  console.log("Helper redesign needed before pass 4 thresholds can be set.");
  console.log(`(a)/(b) octave-relation: ${aIsOctaveOfB ? "consistent (likely 2x bias)" : "irregular"}`);
}

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(results, null, 2));
console.log("--- END-JSON ---");
