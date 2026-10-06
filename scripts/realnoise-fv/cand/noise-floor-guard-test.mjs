// noise-floor-guard-test.mjs — contracts of the CANDIDATE learned-background
// voicing veto (scripts/realnoise-fv/cand/noise-floor-guard.js, not adopted)
// end-to-end through the REAL pitch worker of a candidate tree, each compared
// with the same worker run with the guard off (init { floorGuard: false }). Real-noise corpus numbers come from
// scripts/realnoise-fv/ (measurements/realnoise-false-voicing-attribution-
// 2026-10-05.md); this file guards the module's promises:
//   (a) a steady background whose weak, wandering hum makes the detector
//       flicker into voicing stops posting voice once learned — and the
//       guard fails open for the stream's first 2 s
//   (b) a voice that starts over that background keeps every frame
//   (c) the voice never becomes its own background: a note sung from the
//       stream start, a 30 s hold, repeated same-pitch holds with 0.15 s and
//       0.5 s breaths lose no frame to the guard (the notch's own held-note
//       limits are not this module's to fix, only not to worsen)
//   (d) the module alone: warm-up, debounce, learning only from frames the
//       worker called unvoiced before this guard, anchoring only by frames
//       unvoiced before the harmonic guard
//
// Usage (repo root): python scripts/realnoise-fv/mktree.py fg
//                    node scripts/realnoise-fv/cand/noise-floor-guard-test.mjs [--src=build/rnfv-trees/fg/src]
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const SRC = resolve((process.argv.find((a) => a.startsWith("--src=")) ?? "--src=build/rnfv-trees/fg/src").slice(6));
const { createNoiseFloorGuard, NOISE_FLOOR_GUARD_DEFAULTS: D } = await import(pathToFileURL(resolve(SRC, "dsp/noise-floor-guard.js")).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const SR = 16000, C = 400;
const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
await import(pathToFileURL(resolve(SRC, "dsp/pitch-worker.js")).href);
const H = globalThis.self.onmessage;

function runWorker(x, floorGuard = true) {
  posts.length = 0;
  H({ data: { type: "init", inputSampleRate: SR, ...(floorGuard ? {} : { floorGuard: false }) } });
  const port = {};
  H({ data: { type: "audioPort", port } });
  for (let c = 0; c + C <= x.length; c += C) {
    port.onmessage({ data: { buffer: Float32Array.from(x.subarray(c, c + C)).buffer, contextTime: (c + C) / SR } });
  }
  return posts.filter((p) => p.type === "pitch").map((p) => ({ t: p.contextTime - 0.04, pitch: p.pitch }));
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Steady background: low-passed noise plus a weak 8-harmonic hum whose
// fundamental random-walks +-3 % (the notch's 3 Hz association loses it).
// The detector's voicing flickers on it (~60 % of frames posted without the
// guard), the realistic case: between flickers the worker calls it unvoiced.
function background(dur, { f0 = 105, hum = 0.005, nz = 0.05, seed = 3 } = {}) {
  const r = mulberry(seed), n = Math.round(dur * SR), x = new Float32Array(n);
  let ph = 0, dev = 0, dv = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    if (i % 160 === 0) { dv = 0.9 * dv + 0.1 * (r() - 0.5) * 0.02; dev = Math.max(-0.03, Math.min(0.03, dev + dv)); }
    ph += 2 * Math.PI * f0 * (1 + dev) / SR;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(h * ph + h * 0.7) / h;
    lp = 0.7 * lp + 0.3 * (r() - 0.5);
    x[i] = hum * s + nz * lp;
  }
  return x;
}

// Voice: harmonic source (-9 dB/oct) with 5.5 Hz vibrato and slow wander;
// segs = [[t0, t1]] phonated spans (50 ms ramps), f0 Hz.
function voice(dur, segs, { f0 = 150, amp = 0.12, vib = 25, seed = 9 } = {}) {
  const r = mulberry(seed), n = Math.round(dur * SR), x = new Float32Array(n);
  let ph = 0, w = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    w = 0.999 * w + 0.002 * (r() - 0.5);
    const f = f0 * Math.pow(2, (vib * Math.sin(2 * Math.PI * 5.5 * t) + 600 * w) / 1200);
    ph += 2 * Math.PI * f / SR;
    let env = 0;
    for (const [a, b] of segs) if (t >= a && t <= b) env = Math.min(1, (t - a) / 0.05, (b - t) / 0.05);
    if (env <= 0) continue;
    let s = 0;
    for (let h = 1; h <= 20 && h * f < 7000; h++) s += Math.sin(h * ph) * Math.pow(h, -1.5);
    x[i] = amp * env * s;
  }
  return x;
}
const mix = (...xs) => { const n = Math.max(...xs.map((x) => x.length)), y = new Float32Array(n); for (const x of xs) for (let i = 0; i < x.length; i++) y[i] += x[i]; return y; };
const voicedFrac = (m, a, b) => { const s = m.filter((q) => q.t >= a && q.t < b); return s.filter((q) => q.pitch > 0).length / Math.max(1, s.length); };
const atPitch = (m, a, b, f0) => { const s = m.filter((q) => q.t >= a && q.t < b); return s.filter((q) => q.pitch > 0 && Math.abs(q.pitch / f0 - 1) < 0.12).length / Math.max(1, s.length); };
const pct = (v) => `${(100 * v).toFixed(1)} %`;

console.log("\n(a) steady background with a flickering hum, noise only (30 s)");
{
  const x = background(30);
  const m = runWorker(x), m0 = runWorker(x, false);
  const late = voicedFrac(m, 6, 30), late0 = voicedFrac(m0, 6, 30);
  console.log(`    posted voiced 6-30 s: guard ${pct(late)}, off ${pct(late0)}`);
  check("the detector voices this background (guard off, 6-30 s >= 30 %)", late0 >= 0.3, pct(late0));
  check("the guard fails open for the first 2 s", voicedFrac(m, 0, 1.95) === voicedFrac(m0, 0, 1.95));
  check("once the background is learned it posts <= 5 % (6-30 s)", late <= 0.05, pct(late));
}

console.log("\n(b) a voice over that background (voice 8-18 s)");
{
  const x = mix(background(22), voice(22, [[8, 18]]));
  const v = atPitch(runWorker(x), 8.3, 17.9, 150), v0 = atPitch(runWorker(x, false), 8.3, 17.9, 150);
  console.log(`    voice frames near pitch: guard ${pct(v)}, off ${pct(v0)}`);
  check("voice over the learned background keeps every frame (= guard off)", v >= v0, `${pct(v)} vs ${pct(v0)}`);
}

console.log("\n(c) the voice never becomes its own background");
{
  const same = (name, x, segs) => {
    const a = runWorker(x), b = runWorker(x, false);
    const fa = segs.map(([s0, s1]) => atPitch(a, s0, s1, 150)), fb = segs.map(([s0, s1]) => atPitch(b, s0, s1, 150));
    check(name, fa.every((v, i) => v >= fb[i]), `guard ${fa.map(pct).join(" / ")} vs off ${fb.map(pct).join(" / ")}`);
  };
  same("note sung from 0.15 s for 14 s, no background ever heard", voice(14, [[0.15, 14]]), [[0.5, 13.8]]);
  same("note held 30 s over the learned background", mix(background(34), voice(34, [[3, 33]])), [[3.3, 32.8]]);
  const s1 = []; for (let t = 1; t < 31; t += 3.15) s1.push([t, t + 3]);
  same("10 same-pitch holds, 0.15 s breaths", voice(32, s1), s1.map(([a, b]) => [a + 0.3, b - 0.1]));
  const s2 = []; for (let t = 4; t < 34; t += 3.5) s2.push([t, t + 3]);
  same("9 same-pitch holds, 0.5 s breaths, over the learned background", mix(background(36), voice(36, s2)), s2.map(([a, b]) => [a + 0.3, b - 0.1]));
}

console.log("\n(d) module contracts");
{
  const g = createNoiseFloorGuard(SR, { lagFrames: 0 });
  const buf = new Float32Array(1280);
  const r = mulberry(5);
  const fill = (amp, f) => { for (let i = 0; i < buf.length; i++) buf[i] = amp * (r() - 0.5) + (f ? 0.1 * Math.sin(2 * Math.PI * f * i / SR) : 0); };
  let open = true;
  for (let k = 0; k < D.warmFrames; k++) { fill(0.01, 0); g.observe(buf); g.decided(false); open = g.check(200) && open; }
  check("fails open during warm-up", open);
  const verdicts = [];
  for (let k = 0; k < D.debounce + 1; k++) { fill(0.01, 0); g.observe(buf); g.decided(true); verdicts.push(g.check(200)); }
  check(`background-only frames are vetoed after ${D.debounce} consecutive failures`,
    verdicts.slice(0, D.debounce - 1).every(Boolean) && !verdicts[D.debounce - 1], JSON.stringify(verdicts));
  fill(0.01, 200); g.observe(buf); g.decided(true);
  check("a harmonic rising >= excessDb above the background passes", g.check(200));
  const g2 = createNoiseFloorGuard(SR, { lagFrames: 0 });
  open = true;
  for (let k = 0; k < 200; k++) { fill(0.01, 200); g2.observe(buf); g2.decided(true); open = g2.check(200) && open; }
  check("a stream voiced throughout never learns a background (always open)", open);
  // frames this guard vetoes are reported as voiced-before-the-guard, so a
  // vetoed run can never teach the background (no self-reinforcement)
  const g3 = createNoiseFloorGuard(SR, { lagFrames: 0 });
  for (let k = 0; k < D.warmFrames; k++) { fill(0.01, 0); g3.observe(buf); g3.decided(false); g3.check(200); }
  let vetoes = 0;
  for (let k = 0; k < 100; k++) { fill(0.01, 0); g3.observe(buf); g3.decided(true); if (!g3.check(200)) vetoes++; }
  fill(0.01, 200); g3.observe(buf); g3.decided(true);
  check("after a long vetoed run, a harmonic above the ORIGINAL background still passes", g3.check(200) && vetoes > 90, `vetoes ${vetoes}`);
  // background windows made only of frames the HARMONIC GUARD removed (not
  // the tracker) never anchor the floor: the guard stays open
  const g4 = createNoiseFloorGuard(SR, { lagFrames: 0 });
  open = true;
  for (let k = 0; k < 200; k++) { fill(0.01, 0); g4.observe(buf); g4.decided(false, false); open = g4.check(200) && open; }
  check("windows only the harmonic guard called unvoiced never anchor the floor (always open)", open);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
