// pitch-only-warning-test.js — src/ml/pitch-only-warning.js: the "Likely
// heard as" panel's live warning when pitch moved a lot more than resonance
// since the session's start. Rule A40+KP8-3+DS10, adopted by user override
// 2026-10-12 (measurements/heard-as-pitch-only-warning-2026-10-07.md §8.6),
// with KS-Q5 for a panel switched on late and a bounded pitch buffer (user
// decision 2026-10-13, §8.9): the references (S0's start P0, the A40
// reference and its freeze), the thresholds, KP8's reader-variability
// threshold, the DS10 "the drawn share moved too" gate, mirror symmetry, the
// K-consecutive run, clearing, resets, the panel wiring, a golden replay of
// public sessions at the app cadence against the study's own scored strings,
// identity with the shipped module (2a1f4022…) whenever the panel is on from
// the start, the late-switch-on path against the round-2 harness on public
// late-panel streams and synthetic cases, and the bound on retained frames.
//
//   node tests/ml/pitch-only-warning-test.js
//
// Mutation check (§8.9 (f) 4): PITCH_ONLY_WARNING_MODULE=<path> runs every
// check against another copy of the module (e.g. the shipped one); the last
// line lists the check groups that failed.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSession, eventsFor, drive, SCENARIOS } from "../../scripts/heard-as/pitch-only/warning_bound_sim.mjs";
import { callsFor, play } from "../../scripts/heard-as/pitch-only/late_synthetic.mjs";
import { HEARD_AS_CALIBRATION } from "../../src/ml/heardAsCalibration.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODULE = process.env.PITCH_ONLY_WARNING_MODULE
  ? path.resolve(process.env.PITCH_ONLY_WARNING_MODULE) : path.join(here, "../../src/ml/pitch-only-warning.js");
const {
  createPitchOnlyWarning, pitchOnlyCondition, PITCH_ONLY_WARNING: C, S0_CONFIG, PITCH_ONLY_TEXT,
} = await import(pathToFileURL(MODULE).href);
// The shipped module (2026-10-12, sha256 2a1f4022…), byte for byte: the comparison module of the identity checks.
const SHIPPED_PATH = path.join(here, "fixtures/pitch-only-warning-shipped-2a1f4022.js");
const SH = await import(pathToFileURL(SHIPPED_PATH).href);
if (process.env.PITCH_ONLY_WARNING_MODULE) console.log(`(module under test: ${MODULE})`);

let passed = 0, failed = 0, group = "rule";
const failedGroups = {};
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS [${group}] ${name}`); }
  else { failed++; failedGroups[group] = (failedGroups[group] ?? 0) + 1; console.log(`  FAIL [${group}] ${name}${detail ? `  (${detail})` : ""}`); }
}
// A section that throws (e.g. a module without retained()) fails its group instead of stopping the run.
function section(g, title, fn) {
  group = g;
  console.log(title);
  try { fn(); } catch (e) { check(`(the section threw: ${e?.message ?? e})`, false); }
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
function primed({ cfg = {}, f0 = BASE_F0, startShare = START_SHARE, startUpdates = 5, make = createPitchOnlyWarning } = {}) {
  const w = make({ ...C, ...cfg });
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

section("rule", "1. silence before the references exist", () => {
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
});

section("rule", "2. S0's start P0 (pitchStart)", () => {
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
});

section("rule", "3. the A40 reference: grows to t_fill + 40 s, then frozen", () => {
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
});

section("rule", "4. threshold boundaries and constants", () => {
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
});

section("rule", "5. KP8: the threshold follows this reader's own variability", () => {
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
});

section("rule", "6. DS10: the drawn share must have moved too", () => {
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
  // (Until 2026-10-13 this was "never warns". With KS-Q5 the gate fails only while the fallback share is collected;
  // section 14 checks that it warns after that.)
  check("no shown update in the start window (panel on late): no start share, no warning at the first update after it",
    c.at({ lnF0: lnAt(9), share: 0.99 }) === false);
  const d = primed({ cfg: { consecutive: 1, kp8: null, ds: null }, startUpdates: 0 });
  check("ds null: no share gate", d.at({ lnF0: lnAt(6), share: null }) === true);
});

section("rule", "7. mirror symmetry", () => {
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
});

section("rule", "8. K consecutive updates", () => {
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
});

section("rule", "9. clearing", () => {
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
});

section("rule", "10. resets", () => {
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
});

section("wiring", "11. wiring", () => {
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
  // The "More" list (§8.9 (e)): the late line replaces "turn it on before you start talking"; the false-alarm line is
  // replaced; the misses line and the warning text are unchanged. The two new strings, copied verbatim from the
  // measurement note's §8.9 "Decisions 2026-10-13" (the review's three wording changes; the test does not read
  // measurements/: CI skips Markdown-only pushes).
  const NOTE_LATE = "You can turn this panel on at any time. If you turn it on after you've started talking, the note about pitch-only changes still compares with how you sounded at the start, but it needs about 20 seconds of readings before it can appear. In a test on about 70 other people with the panel turned on half a minute to two minutes in, it then caught about 9 in 10 pitch-only changes in men's voices and about 3 in 4 in women's voices within 10 seconds — about as many as in the same test with the panel on from the start. If the panel is on from your first few seconds of listening but shows no reading during roughly your first half-minute to a minute (for example while it is still downloading, or while you are on another tab), the note may not appear until you stop and start listening again.";
  const NOTE_FALSE_ALARM = "The note about pitch-only changes can also appear when you haven't deliberately changed your voice, if your pitch varies a lot as you talk. In tests on 192 people reading aloud that happened on about 3 to 4 in 1,000 updates for men's voices and almost never for women's, also when the panel was turned on later. Some expressive speakers see it much more often — up to about 1 in 6 updates where the panel showed an estimate, for one man whose pitch rose a long way in a few places.";
  const constant = (name) => { const m = panel.match(new RegExp(`export const ${name} =\\s*"([^"]*)";`)); return m ? m[1] : null; };
  const lateText = constant("PITCH_ONLY_LATE_TEXT"), faText = constant("PITCH_ONLY_FALSE_ALARM_TEXT");
  check("PITCH_ONLY_LATE_TEXT is the note's §8.9 wording (Decisions 2026-10-13), verbatim", lateText === NOTE_LATE, lateText?.slice(0, 60));
  check("PITCH_ONLY_FALSE_ALARM_TEXT is the note's §8.9 wording (Decisions 2026-10-13), verbatim", faText === NOTE_FALSE_ALARM, faText?.slice(0, 60));
  check("the 'turn it on before you start talking' line is gone (PITCH_ONLY_START_TEXT and its item)",
    !/PITCH_ONLY_START_TEXT|data-heard-as-pitch-only-start/.test(panel));
  check("the 'More' list carries the late line, the misses line and the false-alarm line",
    /<li data-heard-as-pitch-only-late="">\{PITCH_ONLY_LATE_TEXT\}<\/li>/.test(panel) && /<li data-heard-as-pitch-only-misses="">\{PITCH_ONLY_MISSES_TEXT\}<\/li>/.test(panel)
    && /<li data-heard-as-pitch-only-false-alarms="">\{PITCH_ONLY_FALSE_ALARM_TEXT\}<\/li>/.test(panel));
  check("the misses line and the warning text are unchanged", constant("PITCH_ONLY_MISSES_TEXT") === "The note about pitch-only changes doesn't catch every change: in tests on about 70 people it caught about 85 in 100 pitch-only changes within 10 seconds and about 90 in 100 within 15 seconds, and fewer for some voices — so no note doesn't mean the guess is right."
    && PITCH_ONLY_TEXT === "Your pitch has moved a lot more than your resonance since you started — this guess can be far off, in either direction, when only pitch changes.");
  check("the hook feeds the warning from the start of listening, panel on or off (addPitch outside the ML-worker branch)",
    hook.indexOf("pitchOnlyRef.current.addPitch(") > hook.indexOf("if (resonanceWorkerRef.current) resonanceWorkerRef.current.postMessage(hint);"));
  check("a resonance worker error drops the stale snapshot like an overload (cue row, warning)",
    /if \(msg\.status === "overloaded" \|\| msg\.status === "error"\) \{\s*resonanceRef\.current = null;\s*pitchOnlyRef\.current\.noteResonance\(null\);/.test(hook));
  check("the hook feeds POSTED voiced pitch (msg.voiced && msg.pitch), not painted / held values",
    /pitchOnlyRef\.current\.addPitch\(\{ audioMs: msg\.contextTime \* 1000, f0: msg\.voiced && msg\.pitch > 0 \? msg\.pitch : null \}\)/.test(hook));
  check("the hook feeds every resonance state, null on overload, and resets on start / stop",
    /pitchOnlyRef\.current\.noteResonance\(msg, audioClockRef\.current\)/.test(hook) && /pitchOnlyRef\.current\.noteResonance\(null\)/.test(hook)
    && (hook.match(/pitchOnlyRef\.current\.reset\(\)/g) ?? []).length >= 2);
});

section("golden", "12. golden replay (public sessions at the app cadence, the study's own scored strings)", () => {
  const G = JSON.parse(readFileSync(path.join(here, "fixtures/pitch-only-golden.json"), "utf8"));
  const { name: ruleName, ...ruleCfg } = G.rule;
  // The fixture records the §8.6 rule's constants; the module's late-switch-on constants (late, maxStartVoicedMs; §8.9)
  // never act on these panel-on-from-the-start streams and are checked in section 14.
  check("fixture rule = the module's constants (A40+KP8-3+DS10)", ruleName === "A40+KP8-3+DS10"
    && JSON.stringify(ruleCfg) === JSON.stringify(Object.fromEntries(Object.keys(ruleCfg).map((k) => [k, C[k]]))));
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
});

// ---------------------------------------------------------------------------------------------------------------
// §8.9 (f): identity with the shipped module, the late-switch-on path, the bound on retained frames.

const sameOut = (a, b) => a.on === b.on && a.held === b.held && a.p0.length === b.p0.length && a.p0.every((v, i) => Object.is(v, b.p0[i]));
const firstDiff = (a, b) => {
  for (let i = 0; i < Math.max(a.on.length, b.on.length); i++) {
    if (a.on[i] !== b.on[i] || a.held[i] !== b.held[i] || !Object.is(a.p0[i], b.p0[i])) return `update ${i}: on ${a.on[i]}/${b.on[i]} held ${a.held[i]}/${b.held[i]} p0 ${a.p0[i]}/${b.p0[i]}`;
  }
  return "";
};
// The golden fixture's streams as calls (["p", t, f0], ["r", snap, clock], ["u", lnF0, share, clock]).
function goldenCalls(s) {
  const calls = []; let i = 0;
  for (const t of s.ev) {
    if (typeof t === "number") { for (let k = 0; k < t; k++, i++) calls.push(["p", s.tx[i] ?? s.t0 + i * 25, s.pf[i] > 0 ? s.pf[i] : null]); }
    else if (t[0] === "r") calls.push(["r", { u: t[1], startU: t[2], fill: t[3], verdict: t[4], sinceResumeS: t[5] }, t[6]]);
    else if (t[0] === "u") calls.push(["u", t[2], t[3], t[4]]);
  }
  return calls;
}
// Deterministic sessions with the panel on from the start, each with an optional twist.
function synthOn0(seed, { hiddenRun = null, restartAt = null, nullSnapAt = null, fewStart = false } = {}) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const calls = [];
  let epoch = 0, fillAt = 10000, startAt = 22000;
  for (let t = 25; t <= 150000; t += 25) {
    const st = t < 60000 ? (rnd() - 0.5) * 3 : (t < 90000 ? 7 : 2) + (rnd() - 0.5) * 3;
    const voiced = fewStart && t >= fillAt && t <= startAt ? rnd() < 0.002 : rnd() >= 0.3;
    calls.push(["p", t, voiced ? BASE_F0 * Math.exp(st * ST) : null]);
    if (restartAt !== null && t === restartAt) { epoch = t; fillAt = t + 5000; startAt = t + 17000; }
    if (nullSnapAt !== null && t === nullSnapAt) calls.push(["r", null, t]);
    else if (t % 200 === 0) {
      const res = { u: 0.4 + (rnd() - 0.5) * 0.6, startU: t >= startAt ? 0.4 : null, fill: Math.min(1, (t - epoch) / (fillAt - epoch)), verdict: "score", sinceResumeS: (t - epoch) / 1000 };
      calls.push(["r", res, t]);
    }
    if (t % 2000 === 0) {
      const hide = (hiddenRun && t >= hiddenRun[0] && t < hiddenRun[1]) || rnd() < 0.15;
      const st2 = t < 60000 ? (rnd() - 0.5) * 6 : (t < 90000 ? 7 : 3) + (rnd() - 0.5) * 4;
      calls.push(["u", hide ? null : P0 + st2 * ST, hide ? null : 0.5 + (rnd() - 0.5) * 0.4 + (t > 60000 ? 0.15 : 0), t]);
    }
  }
  return calls;
}
// play() of late_synthetic.mjs drives ["p"|"r"|"u"] calls; a null snapshot is passed as is.
// For warning_bound_sim.mjs's drive(): a warning that records on/off and held() after, pitchStart() before, each update.
function recorder(w) {
  const on = [], held = [], p0 = [];
  const x = { addPitch: (a) => w.addPitch(a), noteResonance: (a, b) => w.noteResonance(a, b),
    update: (u) => { p0.push(w.pitchStart()); const o = w.update(u); on.push(o ? "1" : "0"); held.push(w.held() ? "1" : "0"); return o; } };
  return { x, out: () => ({ on: on.join(""), held: held.join(""), p0 }) };
}

section("identity", "13. identity with the shipped module (2a1f4022…) whenever the panel is on from the start (§8.9 (a), (f) 1)", () => {
  const text = readFileSync(SHIPPED_PATH, "utf8").replace(/\r\n/g, "\n");
  check("the comparison module is the shipped module byte for byte (sha256 2a1f4022…)",
    createHash("sha256").update(text).digest("hex") === "2a1f4022db77599731cfcf6de4d42758d531239188bce20ddfdf991a868e658f");
  const G = JSON.parse(readFileSync(path.join(here, "fixtures/pitch-only-golden.json"), "utf8"));
  let n = 0, bad = [];
  for (const s of G.sessions) {
    const calls = goldenCalls(s);
    const a = play(createPitchOnlyWarning(), calls), b = play(SH.createPitchOnlyWarning(), calls);
    n += a.on.length;
    if (!sameOut(a, b)) bad.push(`${s.key}@${s.phase}: ${firstDiff(a, b)}`);
    const a0 = play(createPitchOnlyWarning(S0_CONFIG), calls), b0 = play(SH.createPitchOnlyWarning(SH.S0_CONFIG), calls);
    if (!sameOut(a0, b0)) bad.push(`${s.key}@${s.phase} S0: ${firstDiff(a0, b0)}`);
  }
  check(`golden streams (${G.sessions.length} session-phases, ${n} updates): on/off, held() and pitchStart() equal the shipped module's (and S0_CONFIG's)`,
    bad.length === 0, bad.slice(0, 3).join(" | "));
  const cases = [
    ["plain", {}], ["a long hidden run (40-70 s)", { hiddenRun: [40000, 70000] }], ["hidden through the start window", { hiddenRun: [0, 30000] }],
    ["a cue restart at 100 s", { restartAt: 100000 }], ["a null snapshot (overload) at 80 s", { nullSnapAt: 80000 }],
    ["a null P0 (fewer than 20 voiced start frames)", { fewStart: true }],
  ];
  for (const [name, opt] of cases) {
    let ok = true, d = "", on = 0, total = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const calls = synthOn0(seed * 7919, opt);
      const a = play(createPitchOnlyWarning(), calls), b = play(SH.createPitchOnlyWarning(), calls);
      on += [...a.on].filter((c) => c === "1").length; total += a.on.length;
      if (!sameOut(a, b)) { ok = false; d = `seed ${seed}: ${firstDiff(a, b)}`; break; }
    }
    check(`synthetic, panel on from the start, ${name}: equal to the shipped module (8 sessions, warning on ${on} of ${total})`, ok, d);
  }
  // A 1 h session with the panel on from the start (warning_bound_sim.mjs).
  const S = buildSession({ hours: 1 }), ev = eventsFor(S, SCENARIOS.on0);
  const A = recorder(createPitchOnlyWarning()), B = recorder(SH.createPitchOnlyWarning());
  drive(A.x, S, ev); drive(B.x, S, ev);
  check(`a simulated 1 h session, panel on from the start: equal to the shipped module (${A.out().on.length} updates)`, sameOut(A.out(), B.out()), firstDiff(A.out(), B.out()));
});

section("late", "14. late switch-on: KS-Q5 against the round-2 harness (§8.9 (b), (f) 2)", () => {
  const L = C.late;
  check("the late-switch-on constants: the panel's pooling and hide rules (HEARD_AS_CALIBRATION), Q5 20 s / 5 shares, cap 180 s of voiced frames",
    !!L && L.updateMs === HEARD_AS_CALIBRATION.updateMs && L.updateMs === 2000 && L.seedWindowMs === HEARD_AS_CALIBRATION.windowMs && L.seedWindowMs === 8000
    && L.seedMinVoicedMs === 3000 && L.seedFreshMs === 5000 && L.seedLnF0[0] === Math.log(81.0) && L.seedLnF0[1] === Math.log(293.1)
    && L.windowMs === 20000 && L.minShares === 5 && C.maxStartVoicedMs === 180000 && S0_CONFIG.late === null, JSON.stringify(L));
  // section 6's late panel: no start share; the fallback share closes after 20 s of quiet shown updates
  const c = primed({ cfg: { consecutive: 1, kp8: null }, startUpdates: 0 });
  const early = [];
  for (let i = 0; i < 12; i++) early.push(c.at({ lnF0: lnAt(0.5 * (i % 2)), share: 0.5 }));   // 24 .. 46 s, quiet: closes at 46 s
  check("section 6's late panel: no warning while the fallback share is collected, then a pitch-only change warns (KS-Q5)",
    early.every((o) => o === false) && c.at({ lnF0: lnAt(9), share: 0.99 }) === true);
  // the public late-panel fixture
  const F = JSON.parse(readFileSync(path.join(here, "fixtures/pitch-only-late.json"), "utf8"));
  const decodeCalls = (s, P) => {
    const fb = Buffer.from(s.frames.f0, "base64");
    const vf = new Float64Array(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength));
    const frames = []; let v = false, vi = 0, i = 0;
    for (const n of s.frames.runs) { for (let k = 0; k < n; k++, i++) frames.push([s.frames.tx[i] ?? s.frames.t0 + 25 * i, v ? vf[vi++] : null]); v = !v; }
    const clk = s.streams[P.stream];
    const rAt = new Map(s.res.map((x, k) => [x[0], k]));
    const N = s.frames.n + s.res.length, calls = [];
    let fi = 0, ui = 0;
    for (let pos = 0; pos <= N; pos++) {
      while (ui < P.U.length && P.U[ui][0] === pos) { const u = P.U[ui++]; calls.push(["u", u[1], u[2], u[3]]); }
      if (pos === N) break;
      if (rAt.has(pos)) { const x = s.res[rAt.get(pos)]; calls.push(["r", { type: "state", u: x[1], startU: x[2], fill: x[3], verdict: x[4], sinceResumeS: x[5] }, clk[rAt.get(pos)]]); }
      else { const f = frames[fi++]; calls.push(["p", f[0], f[1]]); }
    }
    return calls;
  };
  const expand = (e) => { const n = e.on.length, p0 = new Array(n); let k = 0; for (let i = 0; i < n; i++) { while (k + 1 < e.p0.length && e.p0[k + 1][0] <= i) k++; p0[i] = e.p0[k][1]; } return { on: e.on, held: e.held, p0 }; };
  const hits = new Set();
  for (const s of F.sessions) for (const P of s.panels) {
    const calls = decodeCalls(s, P), want = expand(P.expect);
    const got = play(createPitchOnlyWarning(), calls);
    const ons = [...want.on].filter((x) => x === "1").length;
    check(`${s.key} ${P.name} (${s.sex === "m" ? "man" : "woman"}): on/off, held() and pitchStart() = the harness's KS-Q5 (${ons} of ${want.on.length} on)`, sameOut(got, want), firstDiff(got, want));
    if (s.tshiftS !== null) {
      const ut = calls.filter((x) => x[0] === "u").map((x) => x[3]);
      if ([...want.on].some((x, i) => x === "1" && ut[i] > s.tshiftS * 1000 && ut[i] <= s.tshiftS * 1000 + 10000)) hits.add(`${s.sex}:${P.name.slice(0, P.name.indexOf("p"))}`);
    }
  }
  check(`the fixture holds a male-base and a female-base pitch-only hit at T30, T60 and T120 (${[...hits].sort().join(", ")})`,
    ["T30", "T60", "T120"].every((T) => hits.has(`m:${T}`) && hits.has(`f:${T}`)));
  const byKey = Object.fromEntries(F.sessions.map((s) => [s.key, s]));
  check("…natL_ls3792 at T120, hcsL_ls2473_PO's T120p450 with no warning (the Q5 window never closes), a natural woman with none",
    byKey.natL_ls3792?.panels.filter((P) => P.name.startsWith("T120")).length === 4
    && byKey.hcsL_ls2473_PO?.panels.some((P) => P.name === "T120p450" && !P.expect.on.includes("1"))
    && byKey.natL_ls1474?.sex === "f" && byKey.natL_ls1474.panels.every((P) => !P.expect.on.includes("1")));
  check("…panels where three K-seed rules change the output (§8.9 review fixes): the seed's F0 range check (hcsL_mlspo3492_PO "
    + "T30p1500 / T120p1500), copying the shadow's pending values (hcsL_ls2853_PO T30p1500, hcsL_ls2694_PO T30p0), its back-fill (hcsL_ls2853_PO T60p1500)",
    ["T30p1500", "T120p1500"].every((n) => byKey.hcsL_mlspo3492_PO?.panels.some((P) => P.name === n))
    && ["T30p1500", "T60p1500"].every((n) => byKey.hcsL_ls2853_PO?.panels.some((P) => P.name === n))
    && byKey.hcsL_ls2694_PO?.panels.some((P) => P.name === "T30p0"));
  // the synthetic cases (late_synthetic.mjs; expected values from the harness)
  for (const c2 of F.synthetic) {
    const calls = callsFor(c2.spec), want = expand(c2.expect);
    const got = play(createPitchOnlyWarning(), calls);
    check(`synthetic ${c2.name}: = the harness's KS-Q5 (first warning ${c2.expect.firstWarningMs === null ? "never" : `${c2.expect.firstWarningMs / 1000} s`})`, sameOut(got, want), firstDiff(got, want));
  }
  const firstAt = (spec, mod) => { const calls = callsFor(spec), o = play(mod, calls).on, i = o.indexOf("1"); return i < 0 ? null : calls.filter((x) => x[0] === "u")[i][3]; };
  const syn = Object.fromEntries(F.synthetic.map((x) => [x.name, x.spec]));
  check("§8.6's repro, panel on from 0 / 10 / 19 s: first warning at 62 s, as the shipped module",
    ["repro_on0", "repro_on10", "repro_on19"].every((k) => firstAt(syn[k], createPitchOnlyWarning()) === 62000 && firstAt(syn[k], SH.createPitchOnlyWarning()) === 62000));
  check("…on from 22 / 30 s: the shipped module never warns, KS-Q5 warns at 62 s",
    ["repro_on22", "repro_on30"].every((k) => firstAt(syn[k], SH.createPitchOnlyWarning()) === null && firstAt(syn[k], createPitchOnlyWarning()) === 62000));
  check("the limit that remains: on from the start but hidden through the start window — no warning",
    firstAt(syn.early_hidden, createPitchOnlyWarning()) === null);
  // The K-seed's rules, each changing the output of one synthetic case (§8.9 review fixes; values from the harness).
  const fw = (k) => F.synthetic.find((x) => x.name === k)?.expect.firstWarningMs;
  check("K-seed cases: held notes while the panel is off are not seeded (warns at 132 s), the same notes spoken are (never warns)",
    fw("seed_sustained") === 132000 && fw("seed_spoken") === null);
  check("…a stale burst (newest frame over 5 s old) is not shown (warns), a 100 ms stall's spacing counts (never), the first frame counts 25 ms (never),"
    + " a frame exactly 8 s back is outside the window (never), the ring is kept across a cue restart (never)",
    fw("seed_fresh") === 132000 && fw("seed_gap") === null && fw("seed_first") === null && fw("seed_edge") === null && fw("seed_restart") === null);
});

// Calls of a session with no t_start (the cue fills at fillMs and never sets its start): a frame every frameMs,
// voiced at 150 Hz where voicedAt(t), a resonance state at each 200 ms boundary, panel updates at each 2 s boundary
// when panelOn (shown at 150 Hz while voiced). Frame times are i * frameMs (24.988662 ms = 1,102-sample chunks at
// 44.1 kHz).
function noStartCalls({ frameMs = 25, endMs = 400000, fillMs = 10000, panelOn = false, voicedAt = () => true } = {}) {
  const calls = [];
  for (let i = 1, prev = 0; i * frameMs <= endMs; i++) {
    const t = i * frameMs, v = voicedAt(t);
    calls.push(["p", t, v ? 150 : null]);
    if (Math.floor(t / 200) > Math.floor(prev / 200))
      calls.push(["r", { type: "state", u: 0.2, startU: null, fill: Math.min(1, t / fillMs), verdict: "score", sinceResumeS: t / 1000 }, t]);
    if (panelOn && Math.floor(t / 2000) > Math.floor(prev / 2000)) calls.push(["u", v ? Math.log(150) : null, v ? 0.3 : null, t]);
    prev = t;
  }
  return calls;
}
// The reviewer's pause case (§8.9 review fixes): panel on from the start; 9 s of speech (the cue fills), a 200 s
// pause, 90 s of speech (the cue sets its start), a +8 st pitch-only shift for 30 s, 60 s of speech. A simple cue:
// fill = admitted voiced speech / 5 s, startU once 17 s are admitted; the panel's estimate is the ln median of the
// voiced frames of the last 8 s, hidden below 3 s voiced; its drawn share moves 25 points during the shift.
function pauseCalls(seed = 1, pauseS = 200) {
  let x = seed;
  const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  const calls = [], recent = [];
  let t = 0, adm = 0, startU = null, verdict = "silent", nextRes = 0, nextUpd = 0, shiftSt = 0, bias = 0;
  const frame = (f0) => {
    t += 25;
    calls.push(["p", t, f0 > 0 ? f0 : null]);
    recent.push([t, f0]);
    while (recent.length && recent[0][0] <= t - 8000) recent.shift();
    if (f0 > 0 && verdict === "score") adm += 0.025;
    if (adm >= 17 && startU === null) startU = 0.2;
    if (t >= nextRes) {
      nextRes = t + 200;
      calls.push(["r", { type: "state", u: 0.2 + 0.05 * Math.sin(t / 3000), startU, fill: Math.min(1, adm / 5), verdict, sinceResumeS: 10 }, t]);
    }
    if (t >= nextUpd) {
      nextUpd += 2000;
      const v = recent.filter((r) => r[1] > 0).map((r) => r[1]).sort((a, b) => a - b);
      const ok = v.length * 25 >= 3000, h = v.length >> 1;
      calls.push(["u", ok ? Math.log(v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2) : null, ok ? 0.3 + bias + 0.03 * Math.sin(t / 7000) : null, t]);
    }
  };
  const speech = (s, st = 0) => {
    shiftSt = st; bias = st ? 0.25 : 0;
    const end = t + s * 1000;
    while (t < end) {
      verdict = "score";
      const vLen = Math.round((100 + rnd() * 400) / 25), gLen = Math.round((40 + rnd() * 160) / 25);
      for (let k = 0; k < vLen && t < end; k++) frame(120 * 2 ** ((shiftSt + 1.2 * Math.sin(t / 47000) + (rnd() - 0.5) * 0.6) / 12));
      verdict = "pause";
      for (let k = 0; k < gLen && t < end; k++) frame(0);
    }
  };
  speech(9);
  verdict = "silent";
  for (const end = t + pauseS * 1000; t < end;) frame(0);
  speech(90); speech(30, 8); speech(60);
  return calls;
}

section("bound", "15. retained pitch frames are bounded (§8.9 2, (c), (f) 3; 2c' since the review fixes)", () => {
  const BOUND = 7521, RING = 321, CAP = 7200;   // (c) asked for <= 7,522; 2c' gives 7,200 buffered + 321 in the ring
  const S = buildSession({ hours: 1 });
  const E = Math.max(S.startMs, S.fillMs + 40000);
  for (const [sc, cfg] of Object.entries(SCENARIOS)) {
    const w = createPitchOnlyWarning();
    let over = 0, overAfter = 0, ringAfterEarly = 0, maxTot = 0, firstU = null;
    drive(w, S, eventsFor(S, cfg), (kind, i) => {
      const r = w.retained(), tot = r.a40Frames + r.ringFrames;
      maxTot = Math.max(maxTot, tot);
      if (tot > BOUND || r.a40Frames > CAP) over++;
      if (S.t[i] > E && (r.a40Frames !== 0 || tot > RING)) overAfter++;
      if (kind === "u" && firstU === null) firstU = S.t[i];
      if (firstU !== null && firstU < S.fillMs && r.ringFrames !== 0) ringAfterEarly++;
    });
    check(`1 h, panel ${sc === "off" ? "off throughout" : sc === "on0" ? "on from the start" : "switched on at 30 min"}: retained() <= ${BOUND} after every call (max ${maxTot}),`
      + ` 0 A40 frames and <= ${RING} in all once A40 is final${sc === "on0" ? ", no ring once the first update came before t_fill" : ""}`,
    over === 0 && overAfter === 0 && ringAfterEarly === 0 && (sc !== "on0" || firstU < S.fillMs), `${over} / ${overAfter} / ${ringAfterEarly}`);
  }
  // t_start never comes, held notes (every frame voiced; (f) 3 as written): the buffer holds no frame past
  // t_fill + 180 s and at most 7,200 frames, and is then emptied; no reference, no warning. Also at the 44.1 kHz
  // chunk spacing (1,102 samples = 24.989 ms), where the first cap (t_fill + 180 s of audio) let 7,204 in.
  for (const [frameMs, label] of [[25, "25 ms frames"], [1102000 / 44100, "24.989 ms frames (44.1 kHz)"]]) {
    for (const panelOn of [false, true]) {
      const calls = noStartCalls({ frameMs, panelOn });
      const w = createPitchOnlyWarning();
      let tFill = null, voicedIn = 0, mx = 0, bad = 0, emptied = true, ons = 0;
      const p0s = new Set();
      for (const c of calls) {
        if (c[0] === "p") w.addPitch({ audioMs: c[1], f0: c[2] });
        else if (c[0] === "r") { w.noteResonance(c[1], c[2]); if (tFill === null && c[1].fill >= 1) tFill = c[2]; }
        else { p0s.add(w.pitchStart()); if (w.update({ lnF0: c[1], resonance: null, share: c[2], audioMs: c[3] })) ons++; }
        const tm = c[0] === "u" ? c[3] : c[c[0] === "p" ? 1 : 2];
        if (c[0] === "p" && c[2] > 0 && tFill !== null && tm <= tFill + 180000) voicedIn++;
        const r = w.retained();
        mx = Math.max(mx, r.a40Frames);
        if (r.a40Frames > voicedIn + 81 || r.a40Frames > CAP || r.ringFrames > RING) bad++;   // (+ the 2 s pre-buffer before t_fill)
        if (tFill !== null && tm > tFill + 180000 && r.a40Frames !== 0) emptied = false;
      }
      check(`t_start never comes, held notes, ${label}, panel ${panelOn ? "on from the start" : "off"}: no frame past t_fill + 180 s is kept,`
        + ` at most ${CAP} (max ${mx}), emptied then, pitchStart() null, no warning`,
      tFill !== null && bad === 0 && emptied && mx >= CAP - 4 && w.pitchStart() === null && ons === 0
        && (!panelOn || (p0s.size === 1 && p0s.has(null))), `${bad} ${emptied} ${mx} ${ons}`);
    }
  }
  // t_start never comes, speech with pauses: pauses do not count, so the buffer keeps voiced frames past t_fill + 180 s,
  // never more than 7,200; it is emptied when the 7,201st voiced frame since t_fill arrives; no reference, no warning.
  {
    const N = buildSession({ hours: 0.25, startMs: null });
    for (const [sc, cfg] of [["off", SCENARIOS.off], ["on from the start", SCENARIOS.on0]]) {
      const w = createPitchOnlyWarning();
      let voiced = 0, bad = 0, keptPast = false, giveUpAt = null, ons = 0;
      const p0s = new Set();
      drive(w, N, eventsFor(N, cfg), (kind, i) => {
        const tm = N.t[i], r = w.retained();
        if (kind === "p" && N.f0[i] > 0 && tm >= N.fillMs) {
          voiced++;
          if (voiced === CAP + 1) giveUpAt = tm;
          if (voiced <= CAP && tm > N.fillMs && r.a40Frames !== voiced) bad++;   // (the frame at t_fill comes before its snapshot)
        }
        if (giveUpAt !== null && r.a40Frames !== 0) bad++;
        if (r.a40Frames > CAP || r.ringFrames > RING) bad++;
        if (tm > N.fillMs + 180000 && r.a40Frames > 0) keptPast = true;
        if (kind === "u") { p0s.add(w.pitchStart()); if (w.isOn()) ons++; }
      });
      check(`t_start never comes, speech with pauses (panel ${sc}): frames kept past t_fill + 180 s, never more than ${CAP},`
        + ` emptied at the ${CAP + 1}st voiced frame (${giveUpAt === null ? "never" : `${(giveUpAt / 1000).toFixed(1)} s`}), pitchStart() null, no warning`,
      bad === 0 && keptPast && giveUpAt !== null && w.pitchStart() === null && ons === 0 && (sc === "off" || (p0s.size === 1 && p0s.has(null))), `${bad}`);
    }
  }
  // A long pause after the cue fills (the review's case; §8.9 "Decisions 2026-10-13" (h6) 1): t_start comes ~280 s
  // after t_fill; the start is kept (silence does not count) and the outputs are the shipped module's at every update
  // — it warns, first after the shift (which starts at 299 s: 9 s of speech, the 200 s pause, 90 s of speech).
  {
    let ok = true, d = "";
    const firsts = [];
    for (const seed of [1, 2, 3]) {
      const calls = pauseCalls(seed);
      const a = play(createPitchOnlyWarning(), calls), b = play(SH.createPitchOnlyWarning(), calls);
      const ut = calls.filter((c) => c[0] === "u").map((c) => c[3]), i = a.on.indexOf("1");
      firsts.push(i < 0 ? null : ut[i]);
      if (!sameOut(a, b) || i < 0 || ut[i] <= 299000) { ok = false; d = `seed ${seed}: ${firstDiff(a, b) || (i < 0 ? "never warns" : `first warning at ${ut[i]} ms, before the shift`)}`; break; }
    }
    check(`a 200 s pause after the cue fills, panel on from the start: the same outputs as the shipped module at every update, which warns after the shift (first at ${firsts.map((x) => (x === null ? "never" : `${x / 1000} s`)).join(" / ")})`, ok, d);
  }
  // t_start at t_fill + 170 s: within the cap — the same outputs as the shipped module
  {
    const N = buildSession({ hours: 0.25, startMs: 180000 });
    const ev = eventsFor(N, SCENARIOS.on0);
    const A = recorder(createPitchOnlyWarning()), B = recorder(SH.createPitchOnlyWarning());
    drive(A.x, N, ev);
    drive(B.x, N, ev);
    const a = A.out(), b = B.out();
    check(`t_start at t_fill + 170 s, panel on from the start: the same outputs as the shipped module (${a.on.length} updates, P0 known)`,
      sameOut(a, b) && a.p0[a.p0.length - 1] !== null, firstDiff(a, b));
    const w = createPitchOnlyWarning();
    let mx = 0;
    drive(w, N, eventsFor(N, SCENARIOS.off), () => { const r = w.retained(); mx = Math.max(mx, r.a40Frames + r.ringFrames); });
    check(`…and with the panel off its buffer stays within the bound (max ${mx} frames)`, mx <= BOUND && mx > 4000);
  }
});

const groups = ["rule", "wiring", "golden", "identity", "late", "bound"];
console.log(`\n${passed} passed, ${failed} failed`);
console.log(`groups: ${groups.map((g) => `${g} ${failedGroups[g] ? `FAIL (${failedGroups[g]})` : "ok"}`).join(", ")}`);
process.exit(failed === 0 ? 0 : 1);
