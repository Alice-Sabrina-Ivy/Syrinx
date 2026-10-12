// pitch-only-warning-test.js — src/ml/pitch-only-warning.js: the "Likely
// heard as" panel's live warning when pitch moved a lot more than resonance
// since the session's start. Rule A40+KP8-3+DS10, adopted by user override
// 2026-10-12 (measurements/heard-as-pitch-only-warning-2026-10-07.md §8.6):
// the references (S0's start P0, the A40 reference and its freeze), the
// thresholds, KP8's reader-variability threshold, the DS10 "the drawn share
// moved too" gate, mirror symmetry, the K-consecutive run, clearing, resets,
// the panel wiring, and a golden replay of public sessions at the app cadence
// against the study's own scored strings.
//
//   node tests/ml/pitch-only-warning-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPitchOnlyWarning, pitchOnlyCondition, PITCH_ONLY_WARNING as C, S0_CONFIG, PITCH_ONLY_TEXT,
} from "../../src/ml/pitch-only-warning.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

const ST = Math.LN2 / 12;           // ln-units per semitone
const BASE_F0 = 120;
const P0 = Math.log(BASE_F0);
const lnAt = (st, p0 = P0) => p0 + st * ST;
const snap = (o = {}) => ({ u: 0.2, startU: 0.2, fill: 1, verdict: "score", sinceResumeS: 10, ...o });
const T_FILL = 10000, T_START = 22000;
const START_SHARE = 0.5;

// A warning with its references built the way the app builds them: a fill
// < 1 snapshot (5 s), the fill >= 1 snapshot (t_fill = 10 s), voiced frames
// at f0 through the start window, five shown panel updates inside it (the
// drawn share `startShare`; their dP back-fill KP8's history with 0 st), the
// startU snapshot (t_start = 22 s) and one later frame. Later updates go
// through `at()`, which stamps them 2 s apart from 24 s on.
function primed({ cfg = {}, f0 = BASE_F0, startShare = START_SHARE, startUpdates = 5 } = {}) {
  const w = createPitchOnlyWarning({ ...C, ...cfg });
  w.noteResonance(snap({ fill: 0.5, startU: null }), 5000);
  w.noteResonance(snap({ fill: 1, startU: null }), T_FILL);
  let k = 0;
  for (let t = T_FILL; t <= T_START; t += 25) {
    w.addPitch({ audioMs: t, f0 });
    if (k < startUpdates && t >= 12000 && (t - 12000) % 2000 === 0) {
      w.update({ lnF0: Math.log(f0), resonance: snap({ startU: null }), share: startShare, audioMs: t });
      k++;
    }
  }
  w.noteResonance(snap(), T_START);
  w.addPitch({ audioMs: T_START + 25, f0 });
  let now = T_START;
  const at = (u) => w.update({ resonance: snap(), share: null, ...u, audioMs: (now += 2000) });
  return { w, at, now: () => now };
}
const HIT = { lnF0: lnAt(6), share: 0.75 };   // 6 st, resonance unchanged, drawn share moved 25 points
const HIDDEN = { lnF0: null };

console.log("1. silence before the references exist");
{
  const w = createPitchOnlyWarning({ ...C, consecutive: 1 });
  const big = lnAt(8);
  let any = false;
  any ||= w.update({ lnF0: big, resonance: snap({ startU: null }), share: 0.9, audioMs: 1000 });
  w.noteResonance(snap({ fill: 0.6, startU: null }), 4000);
  for (let t = 4000; t < 9000; t += 25) w.addPitch({ audioMs: t, f0: 120 });
  any ||= w.update({ lnF0: big, resonance: snap({ fill: 0.6, startU: null }), share: 0.9, audioMs: 9000 });
  w.noteResonance(snap({ fill: 1, startU: null }), 9000);
  for (let t = 9000; t <= 21000; t += 25) {
    w.addPitch({ audioMs: t, f0: 120 });
    if (t % 2000 === 0) any ||= w.update({ lnF0: Math.log(120), resonance: snap({ startU: null }), share: 0.5, audioMs: t });
  }
  any ||= w.update({ lnF0: big, resonance: snap({ startU: null }), share: 0.9, audioMs: 21000 });  // startU not set yet
  check("no warning while startU is null (no reference yet)", !any && w.pitchStart() === null);
  w.noteResonance(snap(), 21000);
  w.addPitch({ audioMs: 21025, f0: 120 });
  check("S0's start P0 exists once startU is set", w.pitchStart() !== null && Math.abs(w.pitchStart() - Math.log(120)) < 1e-12);
  check("no warning while the panel is hidden (lnF0 null)", w.update({ lnF0: null, resonance: snap(), audioMs: 23000 }) === false);
  check("no warning while the resonance fill is < 1", w.update({ lnF0: big, resonance: snap({ fill: 0.99 }), share: 0.9, audioMs: 25000 }) === false);
  check("no warning without a resonance snapshot", w.update({ lnF0: big, resonance: null, share: 0.9, audioMs: 27000 }) === false);
  check("no warning without the audio clock (reference unknown)", w.update({ lnF0: big, resonance: snap(), share: 0.9, audioMs: null }) === false);
  check("no warning without the drawn share (DS10)", w.update({ lnF0: big, resonance: snap(), share: null, audioMs: 29000 }) === false);
  check("fires once everything is known (K = 1)", w.update({ lnF0: big, resonance: snap(), share: 0.9, audioMs: 31000 }) === true);
}

console.log("2. S0's start P0 (pitchStart)");
{
  // median of voiced frames in [t_fill, t_start]; unvoiced / null / zero excluded
  const w = createPitchOnlyWarning();
  for (let t = 0; t < 5000; t += 25) w.addPitch({ audioMs: t, f0: 300 });            // before the window
  w.noteResonance(snap({ fill: 1, startU: null }), 5000);
  const vals = [];
  for (let k = 0; k < 41; k++) {
    const t = 5000 + k * 25;
    if (k % 4 === 1) w.addPitch({ audioMs: t, f0: null });
    else if (k % 4 === 2) w.addPitch({ audioMs: t, f0: 0 });
    else { const f = 100 + k; w.addPitch({ audioMs: t, f0: f }); vals.push(f); }
  }
  w.noteResonance(snap(), 6000);
  for (let t = 6025; t < 30000; t += 25) w.addPitch({ audioMs: t, f0: 400 });     // after t_start
  vals.sort((a, b) => a - b);
  const h = vals.length >> 1;
  const med = vals.length % 2 ? vals[h] : (vals[h - 1] + vals[h]) / 2;
  check("P0 = ln median of the voiced frames in the start window (unvoiced, null and 0 excluded; earlier frames ignored)",
    Math.abs(w.pitchStart() - Math.log(med)) < 1e-12, `${Math.exp(w.pitchStart())} vs ${med}`);
  w.update({ lnF0: Math.log(400), resonance: snap(), share: 0.5, audioMs: 30000 });
  check("frames after startU never change P0", Math.abs(w.pitchStart() - Math.log(med)) < 1e-12);
  const b = createPitchOnlyWarning();
  b.noteResonance(snap({ fill: 1, startU: null }), 1000);
  for (let k = 0; k < 20; k++) b.addPitch({ audioMs: 1000 + k * 50, f0: 150 });   // 1000 .. 1950
  b.addPitch({ audioMs: 2000, f0: 150 });                                        // == t_start: counts
  b.noteResonance(snap(), 2000);
  b.addPitch({ audioMs: 2025, f0: 150 });
  check("start window includes both ends (21 frames -> defined)", b.pitchStart() !== null);
  // fewer than 20 voiced frames -> null, no warning (A40 needs S0's P0 too)
  const few = createPitchOnlyWarning({ ...C, consecutive: 1, kp8: null, ds: null });
  few.noteResonance(snap({ fill: 1, startU: null }), 1000);
  for (let k = 0; k < 19; k++) few.addPitch({ audioMs: 1000 + k * 25, f0: 150 });
  for (let k = 19; k < 400; k++) few.addPitch({ audioMs: 1000 + k * 25, f0: null });
  few.noteResonance(snap(), 11000);
  for (let t = 11025; t < 60000; t += 25) few.addPitch({ audioMs: t, f0: 150 });  // plenty later: still no reference
  check("fewer than 20 voiced frames in the start window -> P0 null, never warns (even with frames later)",
    few.pitchStart() === null && few.update({ lnF0: Math.log(300), resonance: snap(), share: 0.9, audioMs: 61000 }) === false);
}

console.log("3. the A40 reference: grows to t_fill + 40 s, then frozen");
{
  const cfg = { ...C, consecutive: 1, kp8: null, ds: null };   // the reference alone
  // start window 120 Hz (481 frames), then 150 Hz to t_fill + 40 s (1120 frames), then 400 Hz
  const w = createPitchOnlyWarning(cfg);
  w.noteResonance(snap({ fill: 1, startU: null }), T_FILL);
  for (let t = T_FILL; t <= T_START; t += 25) w.addPitch({ audioMs: t, f0: 120 });
  w.noteResonance(snap(), T_START);
  for (let t = T_START + 25; t <= 30000; t += 25) w.addPitch({ audioMs: t, f0: 150 });
  check("before t_start: no reference, no warning", w.update({ lnF0: lnAt(9), resonance: snap(), audioMs: T_START - 1 }) === false);
  // at 30 s: frames in [10, 30] s = 481 x 120 + 320 x 150 -> median 120
  check("growing: at t = 30 s the reference is the median of [t_fill, 30 s] (120 Hz): +4 st from 120 Hz warns, +3.9 st does not",
    w.update({ lnF0: lnAt(4, Math.log(120)), resonance: snap(), audioMs: 30000 }) === true
    && w.update({ lnF0: lnAt(3.9, Math.log(120)), resonance: snap(), audioMs: 30000 }) === false);
  for (let t = 30025; t <= T_FILL + 40000; t += 25) w.addPitch({ audioMs: t, f0: 150 });
  for (let t = T_FILL + 40025; t <= 80000; t += 25) w.addPitch({ audioMs: t, f0: 400 });
  // at 60 s: [10, 50] s = 481 x 120 + 1120 x 150 -> 150; the 400 Hz frames after 50 s do not count
  check("frozen at t_fill + 40 s: the reference is 150 Hz (+4 st from 150 warns)", w.update({ lnF0: lnAt(4, Math.log(150)), resonance: snap(), audioMs: 60000 }) === true);
  check("…120 Hz + 4 st (0.1 st from 150 Hz) no longer warns", w.update({ lnF0: lnAt(4, Math.log(120)), resonance: snap(), audioMs: 62000 }) === false);
  for (let t = 80025; t <= 120000; t += 25) w.addPitch({ audioMs: t, f0: 400 });
  check("frames after the freeze never move it", w.update({ lnF0: lnAt(4, Math.log(150)), resonance: snap(), audioMs: 121000 }) === true
    && w.update({ lnF0: Math.log(400), resonance: snap(), audioMs: 123000 }) === true);
  check("pitchStart() stays S0's start P0 (120 Hz)", Math.abs(w.pitchStart() - Math.log(120)) < 1e-12);
  // The end t_fill + 40 s is inclusive: 21 frames at 100 Hz in a short start window, 21 at 200 Hz ending exactly at
  // t_fill + 40 s, one 300 Hz frame after it -> median of 42 = 150 Hz (100 Hz if the last 200 Hz frame were left out).
  const b = createPitchOnlyWarning(cfg);
  b.noteResonance(snap({ fill: 1, startU: null }), 10000);
  for (let k = 0; k <= 20; k++) b.addPitch({ audioMs: 10000 + k * 25, f0: 100 });   // 10000 .. 10500
  b.noteResonance(snap(), 10500);
  for (let k = 0; k <= 20; k++) b.addPitch({ audioMs: 49500 + k * 25, f0: 200 });   // 49500 .. 50000
  b.addPitch({ audioMs: 50025, f0: 300 });
  check("the end t_fill + 40 s is inclusive (median 150 Hz: +4 st from 150 warns, +4 st from 100 does not)",
    b.update({ lnF0: lnAt(4, Math.log(150)), resonance: snap(), audioMs: 60000 }) === true
    && b.update({ lnF0: lnAt(4, Math.log(100)), resonance: snap(), audioMs: 62000 }) === false);
  // A start window longer than 40 s: the reference is never shorter than S0's
  const c = createPitchOnlyWarning(cfg);
  c.noteResonance(snap({ fill: 1, startU: null }), 10000);
  for (let t = 10000; t <= 30000; t += 25) c.addPitch({ audioMs: t, f0: 120 });
  for (let t = 30025; t <= 70000; t += 25) c.addPitch({ audioMs: t, f0: 160 });
  c.noteResonance(snap(), 70000);
  c.addPitch({ audioMs: 70025, f0: 160 });
  check("t_start later than t_fill + 40 s: the reference is S0's whole start window (= S0's P0)",
    c.update({ lnF0: lnAt(4, c.pitchStart()), resonance: snap(), audioMs: 72000 }) === true
    && c.update({ lnF0: lnAt(3.9, c.pitchStart()), resonance: snap(), audioMs: 74000 }) === false);
  // S0 configuration: the reference is S0's P0 and never grows
  const s = createPitchOnlyWarning({ ...S0_CONFIG, consecutive: 1 });
  s.noteResonance(snap({ fill: 1, startU: null }), T_FILL);
  for (let t = T_FILL; t <= T_START; t += 25) s.addPitch({ audioMs: t, f0: 120 });
  s.noteResonance(snap(), T_START);
  for (let t = T_START + 25; t <= 60000; t += 25) s.addPitch({ audioMs: t, f0: 150 });
  check("S0_CONFIG keeps the old fixed start reference", s.update({ lnF0: lnAt(4, Math.log(120)), resonance: snap(), audioMs: 62000 }) === true);
}

console.log("4. threshold boundaries and constants");
{
  const at = (st, du, X) => pitchOnlyCondition({ lnF0: lnAt(st), p0: P0, u: 0.3 + du, startU: 0.3, X });
  check("|dP| = 4.00 st with |du| = 0.60 fires", at(4, 0.6) === true);
  check("|dP| = 3.99 st does not", at(3.99, 0.3) === false);
  check("|du| = 0.61 does not", at(6, 0.61) === false);
  check("at a raised threshold X = 6 st: 5.99 does not, 6.00 does", at(5.99, 0, 6) === false && at(6, 0, 6) === true);
  check("the adopted constants: X 4 st floor, Y 0.6 u, K 2, A40, KP8 k 3 after 5 values, DS 10 points",
    C.minPitchSt === 4 && C.maxResonanceU === 0.6 && C.consecutive === 2 && C.ref === "A40" && C.growMs === 40000
    && C.kp8 === 3 && C.kp8MinHistory === 5 && C.ds === 10 && C.maxHiddenUpdates === 5 && C.minStartFrames === 20);
  check("S0_CONFIG = the same with a fixed reference, fixed X and no share gate",
    S0_CONFIG.ref === "S0" && S0_CONFIG.kp8 === null && S0_CONFIG.ds === null && S0_CONFIG.consecutive === 2 && S0_CONFIG.minPitchSt === 4);
}

console.log("5. KP8: the threshold follows this reader's own variability");
{
  const cfg = { consecutive: 1, ds: null };
  // no start-window updates: an empty history
  const quiet = (p, sts) => { for (const s of sts) p.at({ lnF0: lnAt(s), resonance: snap({ u: 2 }) }); };  // resonance moved: never fires
  const a = primed({ cfg, startUpdates: 0 });
  quiet(a, [2, -2, 2, -2]);                                 // 4 quiet values (RMS 2)
  check("fewer than 5 quiet values: X = 4 st (5 st warns)", a.at({ lnF0: lnAt(5) }) === true);
  const b = primed({ cfg, startUpdates: 0 });
  quiet(b, [2, -2, 2, -2, 2]);                              // 5 quiet values, RMS 2 -> X = 6 st
  check("5 quiet values of ±2 st: X = 3 x 2 = 6 st (5 st does not warn …", b.at({ lnF0: lnAt(5) }) === false);
  // that 5 st update was below X = 6, so it joined the history: RMS sqrt((5*4 + 25)/6) = 2.74 -> X 8.2 st
  check("… and, quiet at 6 st, joins the history: X grows to 3 x 2.74 = 8.2 st (8.3 warns, 8.1 does not)",
    b.at({ lnF0: lnAt(8.3) }) === true && b.at({ lnF0: lnAt(8.1) }) === false);
  const c = primed({ cfg, startUpdates: 0 });
  quiet(c, [0.5, -0.5, 0.5, -0.5, 0.5, -0.5]);              // steady reader: 3 x 0.5 = 1.5 < 4
  check("a steady reader keeps the 4 st floor (4.0 warns)", c.at({ lnF0: lnAt(4) }) === true);
  const d = primed({ cfg, startUpdates: 0 });
  quiet(d, [2, -2, 2, -2]);
  d.at({ lnF0: lnAt(9), resonance: snap({ u: 2 }) });       // |dP| 9 >= X 4: not quiet, not added
  check("an update at or above the threshold is not added to the history", d.at({ lnF0: lnAt(5) }) === true);
  const e = primed({ cfg, startUpdates: 0 });
  quiet(e, [2, -2, 2, -2]);
  for (let i = 0; i < 3; i++) e.at(HIDDEN);                 // hidden updates add nothing
  check("hidden-panel updates are not added to the history", e.at({ lnF0: lnAt(5) }) === true);
  // back-fill: shown updates before t_start count against S0's P0 once it is known
  const f = createPitchOnlyWarning({ ...C, ...cfg });
  f.noteResonance(snap({ fill: 1, startU: null }), T_FILL);
  let k = 0;
  for (let t = T_FILL; t <= T_START; t += 25) {
    f.addPitch({ audioMs: t, f0: BASE_F0 });
    if (t >= 12000 && (t - 12000) % 2000 === 0 && k < 5) { f.update({ lnF0: lnAt(k % 2 ? -2 : 2), resonance: snap({ startU: null }), audioMs: t }); k++; }
  }
  f.noteResonance(snap(), T_START);
  f.addPitch({ audioMs: T_START + 25, f0: BASE_F0 });
  const f2 = primed({ cfg, startUpdates: 0 });
  check("five ±2 st updates before t_start are back-filled against S0's P0: X = 6 st at the first update with a reference (5 st does not warn; without them it does)",
    f.update({ lnF0: lnAt(5), resonance: snap(), audioMs: 24000 }) === false && f2.at({ lnF0: lnAt(5) }) === true);
  const g = primed({ cfg: { ...cfg, kp8: null }, startUpdates: 0 });
  quiet(g, [2, -2, 2, -2, 2, -2]);
  check("kp8 null: the fixed 4 st threshold", g.at({ lnF0: lnAt(4) }) === true);
}

console.log("6. DS10: the drawn share must have moved too");
{
  const cfg = { consecutive: 1, kp8: null };
  const a = primed({ cfg, startShare: 0.5 });
  check("pitch moved, share moved 12.5 points up: warns", a.at({ lnF0: lnAt(6), share: 0.625 }) === true);
  check("share moved 12.5 points down: warns (either direction)", a.at({ lnF0: lnAt(6), share: 0.375 }) === true);
  check("share moved 6.25 points: no warning", a.at({ lnF0: lnAt(6), share: 0.5625 }) === false);
  check("share unknown (null): no warning", a.at({ lnF0: lnAt(6), share: null }) === false);
  // the start share is the MEDIAN over the shown updates in [t_fill, t_start]
  const b = createPitchOnlyWarning({ ...C, ...cfg });
  b.noteResonance(snap({ fill: 1, startU: null }), T_FILL);
  b.update({ lnF0: P0, resonance: snap({ startU: null }), share: 0.9, audioMs: T_FILL - 1 });     // before t_fill: ignored
  const shares = [0.2, 0.3, 0.9];
  let k = 0;
  for (let t = T_FILL; t <= T_START; t += 25) {
    b.addPitch({ audioMs: t, f0: BASE_F0 });
    if ((t === T_FILL || t === 16000) && k < 2) b.update({ lnF0: P0, resonance: snap({ startU: null }), share: shares[k++], audioMs: t });
    if (t === 18000) b.update({ lnF0: null, resonance: snap({ startU: null }), share: 0.9, audioMs: t });   // hidden: ignored
  }
  b.noteResonance(snap(), T_START);
  b.update({ lnF0: P0, resonance: snap(), share: shares[2], audioMs: T_START });   // at t_start itself: counts (both ends do)
  b.addPitch({ audioMs: T_START + 25, f0: BASE_F0 });
  check("start share = median of the shown start-window updates (0.3; hidden / earlier ones ignored): 0.41 warns, 0.39 does not",
    b.update({ lnF0: lnAt(6), resonance: snap(), share: 0.41, audioMs: 24000 }) === true
    && b.update({ lnF0: lnAt(6), resonance: snap(), share: 0.39, audioMs: 26000 }) === false);
  b.update({ lnF0: P0, resonance: snap(), share: 0.0, audioMs: 28000 });                        // after t_start: ignored
  check("updates after t_start do not change the start share", b.update({ lnF0: lnAt(6), resonance: snap(), share: 0.41, audioMs: 30000 }) === true);
  const z = primed({ cfg, startShare: 0 });
  check("exactly 10 points counts (start share 0, drawn 0.1)", z.at({ lnF0: lnAt(6), share: 0.1 }) === true);
  const c = primed({ cfg, startUpdates: 0 });
  check("no shown update in the start window: no start share, never warns", c.at({ lnF0: lnAt(9), share: 0.99 }) === false);
  const d = primed({ cfg: { consecutive: 1, kp8: null, ds: null }, startUpdates: 0 });
  check("ds null: no share gate", d.at({ lnF0: lnAt(6), share: null }) === true);
}

console.log("7. mirror symmetry");
{
  const pairs = [[[6, 0.3], [-6, -0.3]], [[6, -0.3], [-6, 0.3]], [[4, 0.6], [-4, -0.6]], [[3.99, 0], [-3.99, 0]], [[9, 0.61], [-9, -0.61]], [[12, 0.1], [-12, -0.1]]];
  let ok = true, detail = "";
  for (const [[a, da], [b, db]] of pairs) {
    const x = pitchOnlyCondition({ lnF0: lnAt(a), p0: P0, u: 0.4 + da, startU: 0.4 });
    const y = pitchOnlyCondition({ lnF0: lnAt(b), p0: P0, u: 0.4 + db, startU: 0.4 });
    if (x !== y) { ok = false; detail = `(${a}, ${da}) ${x} vs (${b}, ${db}) ${y}`; }
  }
  check("(+X st, +Y u) and (−X st, −Y u) — and the cross pairs — decide identically", ok, detail);
  // the stateful module (A40 reference, KP8 history, DS10 share, K, hides) on random sessions and their mirror images
  // (pitch, resonance and share reflected about their start values) gives the same timeline
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const session = () => {
    const frames = [], updates = [];
    for (let t = T_FILL; t <= 150000; t += 25) {
      const st = t < 60000 ? (rnd() - 0.5) * 3 : (t < 90000 ? 7 : 2) + (rnd() - 0.5) * 3;
      frames.push([t, rnd() < 0.3 ? null : st]);
      if (t % 2000 === 0) {
        const hide = rnd() < 0.15;
        const du = (rnd() - 0.5) * 1.4, ds = (rnd() - 0.5) * 0.4 + (t > 60000 ? 0.15 : 0);
        const st2 = t < 60000 ? (rnd() - 0.5) * 6 : (t < 90000 ? 7 : 3) + (rnd() - 0.5) * 4;
        updates.push([t, hide, st2, du, ds]);
      }
    }
    return { frames, updates };
  };
  const play = ({ frames, updates }, sign) => {
    const w = createPitchOnlyWarning();
    w.noteResonance({ u: 0.4, startU: null, fill: 1, verdict: "score", sinceResumeS: 9 }, T_FILL);
    const out = []; let k = 0;
    for (const [t, st] of frames) {
      w.addPitch({ audioMs: t, f0: st === null ? null : BASE_F0 * Math.exp(sign * st * ST) });
      if (t === T_START) w.noteResonance({ u: 0.4, startU: 0.4, fill: 1, verdict: "score", sinceResumeS: 9 }, t);
      while (k < updates.length && updates[k][0] === t) {
        const [, hide, st2, du, ds] = updates[k++];
        const res = { u: 0.4 + sign * du, startU: t >= T_START ? 0.4 : null, fill: 1, verdict: "score", sinceResumeS: 9 };
        out.push(w.update({ lnF0: hide ? null : P0 + sign * st2 * ST, resonance: res, share: hide ? null : 0.5 + sign * ds, audioMs: t }) ? "1" : "0");
      }
    }
    return out.join("");
  };
  let same = true, onCount = 0, n = 0;
  for (let rep = 0; rep < 20; rep++) {
    const S = session();
    const up = play(S, 1), down = play(S, -1);
    if (up !== down) same = false;
    onCount += [...up].filter((c) => c === "1").length; n += up.length;
  }
  check(`20 random sessions and their mirror images: identical timelines (warning on ${onCount} of ${n} updates)`, same && onCount > 0 && onCount < n);
  const up = primed({ cfg: { consecutive: 1 } }), down = primed({ cfg: { consecutive: 1 } });
  check("raised and lowered pitch-only changes both warn", up.at({ lnF0: lnAt(6), share: 0.75, resonance: snap({ u: 0.5 }) }) && down.at({ lnF0: lnAt(-6), share: 0.25, resonance: snap({ u: -0.1 }) }));
  check("the text names no direction, target or percent", !/%|higher|lower|mascul|femin|\bman\b|\bwoman\b|target/i.test(PITCH_ONLY_TEXT));
}

console.log("8. K consecutive updates");
{
  const p = primed();
  check("K = 2: one qualifying update shows nothing", p.at(HIT) === false);
  check("K = 2: the second consecutive one shows it", p.at(HIT) === true);
  const ineligible = [
    ["verdict sustained", { ...HIT, resonance: snap({ verdict: "sustained" }) }],
    ["sinceResumeS < 2", { ...HIT, resonance: snap({ sinceResumeS: 1.9 }) }],
    ["fill < 1", { ...HIT, resonance: snap({ fill: 0.9 }) }],
    ["share not moved", { ...HIT, share: START_SHARE }],
  ];
  for (const [name, u] of ineligible) {
    const v = primed();
    v.at(HIT);
    const mid = v.at(u);
    const after = v.at(HIT);
    check(`an update that fails between two qualifying ones restarts the run (${name})`, mid === false && after === false && v.at(HIT) === true);
  }
  const h = primed();
  h.at(HIT);
  const hid = h.at(HIDDEN);
  check("a hidden-panel update between two qualifying ones is neutral: nothing shown, run kept", hid === false && h.at(HIT) === true);
}

console.log("9. clearing");
{
  const p = primed();
  const hit = { lnF0: lnAt(-7), share: 0.25 };
  p.at(hit); p.at(hit);
  check("shown after two qualifying updates", p.w.isOn());
  check("cleared on the first update where the condition fails (resonance moved too)", p.at({ ...hit, resonance: snap({ u: 0.2 - 0.9 }) }) === false && !p.w.isOn());
  check("returns only after K new qualifying updates", p.at(hit) === false && p.at(hit) === true);
  check("nothing shown while the panel is hidden", p.at(HIDDEN) === false && !p.w.isOn() && p.w.held());
  check("on -> hidden ('Keep talking') -> shown: back at once if the condition still holds", p.at(hit) === true && p.w.isOn());
  check("on -> hidden -> shown but the condition fails: cleared", (p.at(HIDDEN), p.at({ lnF0: lnAt(-1), share: 0.25 }) === false && !p.w.held()));
  check("cleared when pitch comes back near the start", (p.at(hit), p.at(hit), p.at({ lnF0: lnAt(-1), share: 0.25 }) === false));
  check("cleared when the drawn share comes back near the start", (p.at(hit), p.at(hit), p.at({ ...hit, share: 0.45 }) === false));
  const a = primed(); a.at(HIT); a.at(HIT);
  for (let i = 0; i < C.maxHiddenUpdates; i++) a.at(HIDDEN);
  check(`kept through ${C.maxHiddenUpdates} hidden updates in a row (~10 s)`, a.w.held() && a.at(HIT) === true);
  const b = primed(); b.at(HIT); b.at(HIT);
  for (let i = 0; i <= C.maxHiddenUpdates; i++) b.at(HIDDEN);
  check(`dropped after more than ${C.maxHiddenUpdates} hidden updates in a row: needs K new ones`, !b.w.held() && b.at(HIT) === false && b.at(HIT) === true);
  const c = primed(); c.at(HIT); c.at(HIT);
  c.at(HIDDEN);
  check("a hide on the resonance side (sustained) while shown still clears", c.at({ ...HIT, resonance: snap({ verdict: "sustained" }) }) === false && !c.w.held());
}

console.log("10. resets");
{
  const a = primed();
  a.at(HIT); a.at(HIT);
  a.w.noteResonance(null);                                  // overload back-off
  check("resonance overload: references and the warning dropped", a.w.pitchStart() === null && !a.w.isOn() && a.at(HIT) === false);
  const b = primed();
  for (const s of [3, -3, 3, -3, 3]) b.at({ lnF0: lnAt(s), share: 0.75, resonance: snap({ u: 2 }) });  // with the 5 start zeros: X 6.4 st
  b.at({ ...HIT, lnF0: lnAt(8) }); b.at({ ...HIT, lnF0: lnAt(8) });
  check("(before the restart: 8 st shown, 5 st held back by KP8)", b.w.isOn() && b.at({ ...HIT, lnF0: lnAt(5) }) === false);
  b.w.noteResonance(snap({ fill: 0, u: null, startU: null }), 40000);   // fresh engine posts again
  check("resonance restart (startU back to null): references and the warning dropped", b.w.pitchStart() === null && !b.w.isOn());
  // the new engine's start becomes the new reference; the KP8 history and the start share start over
  b.w.noteResonance(snap({ fill: 1, startU: null }), 45000);
  for (let t = 45000; t <= 57000; t += 25) {
    b.w.addPitch({ audioMs: t, f0: 200 });
    if (t === 50000) b.w.update({ lnF0: Math.log(200), resonance: snap({ startU: null }), share: 0.2, audioMs: t });
  }
  b.w.noteResonance(snap(), 57000);
  b.w.addPitch({ audioMs: 57025, f0: 200 });
  check("…the restarted cue's start window gives the new P0", Math.abs(b.w.pitchStart() - Math.log(200)) < 1e-12);
  const at200 = (st, share, t) => b.w.update({ lnF0: lnAt(st, Math.log(200)), resonance: snap(), share, audioMs: t });
  check("…the old KP8 history is gone (5 st from the new start warns again, K = 2) and the start share is the new one (0.2)",
    at200(5, 0.4, 59000) === false && at200(5, 0.4, 61000) === true && at200(5, 0.25, 63000) === false);
  const c = primed();
  c.at(HIT); c.at(HIT);
  c.w.reset();
  check("stop / start listening resets everything", c.w.pitchStart() === null && !c.w.isOn() && c.at(HIT) === false);
  const d = primed();
  for (const s of [3.5, -3.5, 3.5, -3.5, 3.5]) d.at({ lnF0: lnAt(s), share: 0.75, resonance: snap({ u: 2 }) });  // X 7.4 st
  d.at({ lnF0: lnAt(8), share: 0.75 });   // one qualifying update, then the panel is switched off
  d.w.resetRun();
  check("panel off and on: a stale run is not reused; references, KP8 history and start share kept",
    d.at({ lnF0: lnAt(8), share: 0.75 }) === false && d.w.pitchStart() !== null && d.at({ lnF0: lnAt(8), share: 0.75 }) === true
    && d.at({ lnF0: lnAt(6), share: 0.75 }) === false && d.at({ lnF0: lnAt(8), share: 0.55 }) === false);
}

console.log("11. wiring");
{
  const panel = readFileSync(path.join(here, "../../src/components/HeardAsPanel.jsx"), "utf8");
  const hook = readFileSync(path.join(here, "../../src/audio/useAudioPipeline.js"), "utf8");
  const iText = panel.indexOf("{PITCH_ONLY_TEXT}");
  const iShown = panel.indexOf("data-heard-as-shares=");
  const iAxis = panel.indexOf("<HeardAsAxis axis={view.axis} />");
  const iRange = panel.indexOf("data-heard-as-range=");
  const iCaveat = panel.indexOf("data-heard-as-caveat");
  const slotOpen = panel.lastIndexOf("<p", iText);
  const iLive = panel.indexOf("data-heard-as-live=\"\"");
  check("the panel renders the visible warning once and the live-region copy once",
    iText > 0 && (panel.match(/\{PITCH_ONLY_TEXT\}/g) ?? []).length === 1 && /\{liveOn \? PITCH_ONLY_TEXT : ""\}/.test(panel));
  check("…inside the shown-estimate block, directly under the axis (before the range line)", iShown > 0 && iAxis > iShown && iText > iAxis && iText < iRange && iRange < iCaveat);
  check("…in its own note slot [data-heard-as-note=\"pitch-only\"], plain text (no role on the visible note)",
    /data-heard-as-note="pitch-only"[^>]*data-pitch-only="1"/.test(panel.slice(slotOpen, iText)) && !/role=/.test(panel.slice(slotOpen, iText)));
  check("…only when the panel's update said so (view.pitchOnly)", /\{view\.pitchOnly && \(/.test(panel.slice(iAxis, iText)));
  check("at most one note: extraNote is left out while the warning is on, and the old conflict note is gone (user decision 2026-10-07)",
    /\{!view\.pitchOnly && extraNote != null/.test(panel) && !/view\.conflict|conflictNote|data-heard-as-note="conflict"/.test(panel));
  check("an always-mounted polite live region (outside the shown block) carries the warning for screen readers",
    iLive > 0 && /className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-heard-as-live=""/.test(panel)
    && panel.lastIndexOf(")}", iLive) > panel.indexOf("data-heard-as-legend") && iLive < iCaveat);
  check("no opacity dimming of the estimate (stale = 'Older reading' text)", !/opacity: view\.ageMs/.test(panel) && /Older reading/.test(panel));
  check("every update passes lnF0, the resonance snapshot, the drawn share and the hook's audio clock (DS10 / A40 inputs, as the study's harness)",
    /const warn = \(lnF0, share = null\) => warning\?\.update\(\{\s*lnF0, resonance: resonanceRef\?\.current \?\? null, share, audioMs: audioClockRef\?\.current \?\? null,\s*\}\) === true;/.test(panel));
  check("the share passed is the one the axis draws (heardAsShares(…).s, the same object as heardAsAxis(shares))",
    /const shares = heardAsShares\(e\.meterLogit, e\.lnF0\);\s*const pitchOnly = warn\(e\.lnF0, shares\.s\);/.test(panel) && /axis: heardAsAxis\(shares\)/.test(panel));
  check("hidden panel updates go to the warning as lnF0 null (no share)", (panel.match(/hide\("/g) ?? []).length >= 2 && /const hide = \(why\) => \{ warn\(null\);/.test(panel));
  check("switching the panel off drops the run", /warning\?\.resetRun\(\)/.test(panel));
  check("a resonance worker error drops the stale snapshot like an overload (cue row, warning)",
    /if \(msg\.status === "overloaded" \|\| msg\.status === "error"\) \{\s*resonanceRef\.current = null;\s*pitchOnlyRef\.current\.noteResonance\(null\);/.test(hook));
  check("the hook feeds POSTED voiced pitch (msg.voiced && msg.pitch), not painted / held values",
    /pitchOnlyRef\.current\.addPitch\(\{ audioMs: msg\.contextTime \* 1000, f0: msg\.voiced && msg\.pitch > 0 \? msg\.pitch : null \}\)/.test(hook));
  check("the hook feeds every resonance state, null on overload, and resets on start / stop",
    /pitchOnlyRef\.current\.noteResonance\(msg, audioClockRef\.current\)/.test(hook) && /pitchOnlyRef\.current\.noteResonance\(null\)/.test(hook)
    && (hook.match(/pitchOnlyRef\.current\.reset\(\)/g) ?? []).length >= 2);
}

console.log("12. golden replay (public sessions at the app cadence, the study's own scored strings)");
{
  const G = JSON.parse(readFileSync(path.join(here, "fixtures/pitch-only-golden.json"), "utf8"));
  const { name: ruleName, ...ruleCfg } = G.rule;
  check("fixture rule = the module's constants (A40+KP8-3+DS10)", ruleName === "A40+KP8-3+DS10" && JSON.stringify(ruleCfg) === JSON.stringify({ ...C }));
  const decode = (s) => {
    const ev = []; let i = 0;
    for (const t of s.ev) {
      if (typeof t === "number") { for (let k = 0; k < t; k++, i++) ev.push(["p", s.tx[i] ?? s.t0 + i * 25, s.pf[i]]); }
      else ev.push(t);
    }
    return ev;
  };
  const drive = (cfg, ev) => {
    const w = createPitchOnlyWarning(cfg);
    let res = null; const on = [], held = [];
    for (const e of ev) {
      if (e[0] === "p") w.addPitch({ audioMs: e[1], f0: e[2] > 0 ? e[2] : null });
      else if (e[0] === "r") { res = { u: e[1], startU: e[2], fill: e[3], verdict: e[4], sinceResumeS: e[5] }; w.noteResonance(res, e[6]); }
      else if (e[0] === "u") { on.push(w.update({ lnF0: e[2], resonance: res, share: e[3], audioMs: e[4] }) ? "1" : "0"); held.push(w.held() ? "1" : "0"); }
    }
    return { on: on.join(""), held: held.join(""), p0: w.pitchStart() };
  };
  const ones = (s) => [...s].filter((c) => c === "1").length;
  const parts = { noA40: 0, noKP8: 0, noDS10: 0 };
  let back = 0;
  for (const s of G.sessions) {
    const ev = decode(s);
    const r = drive(C, ev), r0 = drive(S0_CONFIG, ev);
    check(`${s.key} @${s.phase} ms (${s.sex}, ${s.kind}): the adopted rule = the study's string, update for update (${ones(r.on)} on)`,
      r.on === s.expect.on, `\n      js    ${r.on}\n      study ${s.expect.on}`);
    check(`${s.key} @${s.phase} ms: S0_CONFIG = the study's S0 string (= the old module live) (${ones(r0.on)} on)`, r0.on === s.expect.onS0);
    check(`${s.key} @${s.phase} ms: S0's start P0 = the fixture's`, s.expect.p0 === null ? r.p0 === null : Math.abs(r.p0 - s.expect.p0) < 1e-12);
    if (drive({ ...C, ref: "S0" }, ev).on !== r.on) parts.noA40++;
    if (drive({ ...C, kp8: null }, ev).on !== r.on) parts.noKP8++;
    if (drive({ ...C, ds: null }, ev).on !== r.on) parts.noDS10++;
    const hidden = ev.filter((e) => e[0] === "u").map((e) => e[2] === null);
    for (let i = 1; i < r.on.length; i++) if (hidden[i - 1] && r.on[i] === "1" && r.on[i - 1] === "0" && r.held[i - 1] === "1") back++;
    if (s.kind === "together" || s.kind === "resonance") check(`${s.key} (${s.sex}, ${s.kind}): never on under the adopted rule`, !r.on.includes("1"));
    if (s.kind === "natural") check(`${s.key} (${s.sex}, natural reading): no more false alarms than S0`, ones(r.on) <= ones(r0.on));
  }
  check(`the fixture exercises each part: dropping A40 / KP8 / DS10 changes ${parts.noA40} / ${parts.noKP8} / ${parts.noDS10} sessions`,
    parts.noA40 > 0 && parts.noKP8 > 0 && parts.noDS10 > 0);
  check(`…and the hold through brief hides (${back} updates back at once after a hide)`, back >= 2);
  const kinds = G.sessions.map((s) => `${s.kind}:${s.sex}`);
  check("golden set covers pitch-only / together / resonance-only / natural for both sexes, and more than one panel phase",
    ["pitch", "together", "resonance", "natural"].every((k) => kinds.includes(`${k}:m`) && kinds.includes(`${k}:f`))
    && new Set(G.sessions.map((s) => s.phase)).size >= 3);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
