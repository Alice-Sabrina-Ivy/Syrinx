// display-hook-test.js — drives the REAL useAudioPipeline hook
// (handleAnalysisResult with the real pitchGate / pitchSmoothing /
// pitchPaintGate) frame by frame, so a change to the hook's wiring of the
// display chain is caught here and not only by the session-oracle replay.
// The paint-gate test's chain() is a hand-written copy of that wiring;
// review of bd89dc1 showed mutations of the hook itself (unconditional
// median restart, dropping the raw-agreement argument) passed it.
//
// Loads the hook in Node with the session oracle's module hooks: "react"
// -> scripts/session-oracle/lib/react-mock.mjs (a single-render mock whose
// refs/state stay alive), extensionless imports -> .js/.jsx.
// measurements/pitch-display-reacquire-2026-10-04.md §10.
//
// Usage: node tests/audio/display-hook-test.js

import { register } from "node:module";

register(new URL("../../scripts/session-oracle/lib/hooks.mjs", import.meta.url));
const { M } = await import(new URL("../../scripts/session-oracle/lib/react-mock.mjs", import.meta.url).href);
const HOOK = new URL("../../src/audio/useAudioPipeline.js", import.meta.url).href;

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

// One fresh hook instance per sequence (module re-evaluated, so no state
// leaks between cases). Inputs per frame: a number = fresh detection (loud,
// confidence 0.8); "q" = quiet pitchless frame (-70 dB); "l" = loud
// pitchless frame (-38 dB, the pitch-hold bridge). Returns the value the
// trace painted on each frame (0 = gap).
let gen = 0;
async function run(seq) {
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(`${HOOK}?g=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
  const latest = M.refs.find((r) => r.current && typeof r.current === "object" &&
    "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  if (!latest || !har) throw new Error("hook refs not found — did useAudioPipeline's ref layout change?");
  let t = 1e6;
  return seq.map((x) => {
    t += 25;
    let intensity, pitch = null, confidence;
    if (typeof x === "number") { intensity = -28; pitch = x; confidence = 0.8; }
    else if (x === "q") { intensity = -70; confidence = 0.2; }
    else { intensity = -38; confidence = 0.3; }
    latest.current = { pitch, confidence, voiced: pitch !== null, ts: t };
    har.current({ intensity, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: t });
    const trace = api.pitchTraceRef.current;
    const e = trace[trace.length - 1];
    return e && e.time === Math.round(t) && e.pitch !== null ? e.pitch : 0;
  });
}

const rep = (v, n) => Array(n).fill(v);
const st = (f, s) => f * Math.pow(2, s / 12);
const firstIndex = (arr, pred) => arr.findIndex(pred);
const near = (a, b) => Math.abs(a - b) < 1e-6;

console.log("register switch after a short gap (re-acquisition)");
for (const [label, from, to] of [["up 110→225", 110, 225], ["down 225→110", 225, 110], ["up 11 st", 110, st(110, 11)]]) {
  for (const g of ["q", "l"]) {
    const out = (await run([...rep(from, 30), g, g, ...rep(to, 12)])).slice(32);
    const i = firstIndex(out, (v) => near(v, to));
    check(`${label} after 2×${g === "q" ? "quiet" : "held"} gap paints by the 4th frame and stays`,
      i >= 0 && i <= 3 && out.slice(i).every((v) => near(v, to)), out.map((v) => Math.round(v)).join(","));
  }
}

console.log("\nregister switch inside a word (no gap)");
{
  const out = (await run([...rep(110, 30), ...rep(225, 12)])).slice(30);
  const i = firstIndex(out, (v) => near(v, 225));
  // The median-3 still shows the old register on the first new frame
  // (index 0); the smoothed value turns on index 1, and EXCURSION_SUSTAIN 7
  // accepts the 7th off-level smoothed frame (index 7). Index 8 would mean
  // the mid-word wait regressed to 8 frames.
  check("mid-word switch paints after the 7-frame off-level wait (index 7)", i === 7, out.map((v) => Math.round(v)).join(","));
}

console.log("\none-frame flips and outliers after a short gap never paint");
for (const g of ["q", "l"]) {
  const gl = g === "q" ? "quiet" : "held";
  for (const [name, word, blip] of [["octave-up flip", 110, 220], ["octave-down flip", 225, 112.5], ["on-level outlier 150", 110, 150], ["on-level outlier 165", 110, 165]]) {
    const out = (await run([...rep(word, 30), g, g, blip, ...rep(word, 8)])).slice(32);
    check(`${name} after 2×${gl} gap is never painted`, out.every((v) => !near(v, blip)), out.map((v) => Math.round(v)).join(","));
  }
}

console.log("\nshort octave lock right after a gap never anchors the display");
for (const g of ["q", "l"]) {
  const gl = g === "q" ? "quiet" : "held";
  // A 3-frame lock restarts the median on the locked value, so the 4th
  // smoothed frame is still the lock while the raw pitch is already back:
  // only the raw-agreement check (push(..., { raw })) keeps the gate from
  // accepting the lock as a new register.
  for (const [name, word, lock] of [["octave-up lock", 110, 220], ["octave-down lock", 225, 112.5]]) {
    const out = (await run([...rep(word, 30), g, g, lock, lock, lock, ...rep(word, 10)])).slice(32);
    check(`3-frame ${name} after 2×${gl} gap is never painted`, out.every((v) => !near(v, lock)), out.map((v) => Math.round(v)).join(","));
  }
}

console.log("\nevery painted value is a real detection (random sequences)");
{
  // Deterministic LCG; words at a few registers, 1-5 frame quiet/held gaps,
  // 1-3 frame octave and x1.5 blips. The df497b9 median restart painted
  // averages of two detections here; the trace must only ever show a value
  // the worker actually posted.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let bad = 0, paintedTotal = 0, example = "";
  for (let s = 0; s < 80; s++) {
    const seq = [];
    let f = pick([110, 130, 220, 250]);
    for (let w = 0; w < 6; w++) {
      const len = 6 + Math.floor(rnd() * 20);
      for (let k = 0; k < len; k++) {
        const r = rnd();
        if (r < 0.06) seq.push(f * pick([2, 0.5, 1.5]));
        else seq.push(f * Math.pow(2, (rnd() - 0.5) * 0.4 / 12));
      }
      const gl = 1 + Math.floor(rnd() * 5), gk = pick(["q", "l"]);
      for (let k = 0; k < gl; k++) seq.push(gk);
      if (rnd() < 0.5) f = pick([110, 130, 220, 250]);
    }
    const posted = seq.filter((x) => typeof x === "number");
    const out = await run(seq);
    for (const v of out) {
      if (v === 0) continue;
      paintedTotal++;
      if (!posted.some((p) => near(p, v))) { bad++; if (!example) example = `seq ${s}: painted ${v.toFixed(2)}`; }
    }
  }
  check(`no painted value outside the posted detections (${paintedTotal} painted frames)`, bad === 0 && paintedTotal > 1000, example);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
