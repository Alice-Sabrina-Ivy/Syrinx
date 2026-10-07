// pitch-only-warning-test.js — src/ml/pitch-only-warning.js: the "Likely
// heard as" panel's live warning when pitch moved a lot more than resonance
// since the session's start (rule (a) of the pre-registered study,
// measurements/heard-as-pitch-only-warning-2026-10-07.md): references, the
// thresholds, mirror symmetry, the K-consecutive run, clearing, resets, the
// panel wiring, and a golden replay of public sessions against the study's
// own (Python) rule.
//
//   node tests/ml/pitch-only-warning-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPitchOnlyWarning, pitchOnlyCondition, PITCH_ONLY_WARNING as C, PITCH_ONLY_TEXT,
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
const lnAt = (st) => P0 + st * ST;
const snap = (o = {}) => ({ u: 0.2, startU: 0.2, fill: 1, verdict: "score", sinceResumeS: 10, ...o });

// A warning with its start reference built the way the app builds it:
// voiced frames at BASE_F0 between a fill >= 1 snapshot (t = 10 s) and the
// startU snapshot (t = 22 s), then one later frame that freezes P0.
function primed({ K = C.consecutive, f0 = BASE_F0 } = {}) {
  const w = createPitchOnlyWarning({ ...C, consecutive: K });
  w.noteResonance(snap({ fill: 0.5, startU: null }), 5000);
  w.noteResonance(snap({ fill: 1, startU: null }), 10000);
  for (let t = 10000; t <= 22000; t += 25) w.addPitch({ audioMs: t, f0 });
  w.noteResonance(snap(), 22000);
  w.addPitch({ audioMs: 22025, f0 });
  return w;
}

console.log("1. silence before the references exist");
{
  const w = createPitchOnlyWarning({ ...C, consecutive: 1 });
  const big = lnAt(8);
  let any = false;
  // nothing at all yet
  any ||= w.update({ lnF0: big, resonance: snap({ startU: null }) });
  w.noteResonance(snap({ fill: 0.6, startU: null }), 4000);
  for (let t = 4000; t < 9000; t += 25) w.addPitch({ audioMs: t, f0: 120 });
  any ||= w.update({ lnF0: big, resonance: snap({ fill: 0.6, startU: null }) });
  w.noteResonance(snap({ fill: 1, startU: null }), 9000);
  for (let t = 9000; t <= 21000; t += 25) w.addPitch({ audioMs: t, f0: 120 });
  any ||= w.update({ lnF0: big, resonance: snap({ startU: null }) });  // startU not set yet
  check("no warning while startU is null (P0 not defined yet)", !any && w.pitchStart() === null);
  w.noteResonance(snap(), 21000);
  check("P0 exists once startU is set", w.pitchStart() !== null && Math.abs(w.pitchStart() - Math.log(120)) < 1e-12);
  check("no warning while the panel is hidden (lnF0 null)", w.update({ lnF0: null, resonance: snap() }) === false);
  check("no warning while the resonance fill is < 1", w.update({ lnF0: big, resonance: snap({ fill: 0.99 }) }) === false);
  check("no warning without a resonance snapshot", w.update({ lnF0: big, resonance: null }) === false);
  check("fires once everything is known (K = 1)", w.update({ lnF0: big, resonance: snap() }) === true);
}

console.log("2. the pitch start P0");
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
  check("frames after startU never change P0", Math.abs(w.pitchStart() - Math.log(med)) < 1e-12);
  // the start window's boundaries are inclusive
  const b = createPitchOnlyWarning();
  b.noteResonance(snap({ fill: 1, startU: null }), 1000);
  for (let k = 0; k < 20; k++) b.addPitch({ audioMs: 1000 + k * 50, f0: 150 });   // 1000 .. 1950
  b.addPitch({ audioMs: 2000, f0: 150 });                                        // == t_start: counts
  b.noteResonance(snap(), 2000);
  b.addPitch({ audioMs: 2025, f0: 150 });
  check("start window includes both ends (21 frames -> defined)", b.pitchStart() !== null);
  // fewer than 20 voiced frames -> null, no warning
  const few = createPitchOnlyWarning({ ...C, consecutive: 1 });
  few.noteResonance(snap({ fill: 1, startU: null }), 1000);
  for (let k = 0; k < 19; k++) few.addPitch({ audioMs: 1000 + k * 25, f0: 150 });
  for (let k = 19; k < 400; k++) few.addPitch({ audioMs: 1000 + k * 25, f0: null });
  few.noteResonance(snap(), 11000);
  few.addPitch({ audioMs: 11025, f0: 150 });
  check("fewer than 20 voiced frames -> P0 null, never warns", few.pitchStart() === null && few.update({ lnF0: Math.log(300), resonance: snap() }) === false);
  // the module stores only what addPitch is given: the hook feeds POSTED
  // values (msg.voiced && msg.pitch), never painted / held ones — checked in
  // the wiring section below.
}

console.log("3. threshold boundaries");
{
  const at = (st, du) => pitchOnlyCondition({ lnF0: lnAt(st), p0: P0, u: 0.3 + du, startU: 0.3 });
  check("|dP| = 4.00 st with |du| = 0.60 fires", at(4, 0.6) === true);
  check("|dP| = 3.99 st does not", at(3.99, 0.3) === false);
  check("|du| = 0.61 does not", at(6, 0.61) === false);
  check("thresholds are the pre-registered X 4 st, Y 0.6 u", C.minPitchSt === 4 && C.maxResonanceU === 0.6);
  check("K = 2 consecutive updates (the flagged deviation from K = 1)", C.consecutive === 2);
}

console.log("4. mirror symmetry");
{
  const pairs = [[[6, 0.3], [-6, -0.3]], [[6, -0.3], [-6, 0.3]], [[4, 0.6], [-4, -0.6]], [[3.99, 0], [-3.99, 0]], [[9, 0.61], [-9, -0.61]], [[12, 0.1], [-12, -0.1]]];
  let ok = true, detail = "";
  for (const [[a, da], [b, db]] of pairs) {
    const x = pitchOnlyCondition({ lnF0: lnAt(a), p0: P0, u: 0.4 + da, startU: 0.4 });
    const y = pitchOnlyCondition({ lnF0: lnAt(b), p0: P0, u: 0.4 + db, startU: 0.4 });
    if (x !== y) { ok = false; detail = `(${a}, ${da}) ${x} vs (${b}, ${db}) ${y}`; }
  }
  check("(+X st, +Y u) and (−X st, −Y u) — and the cross pairs — decide identically", ok, detail);
  // through the stateful module, raised vs lowered voices
  const up = primed({ K: 1 }), down = primed({ K: 1 });
  check("raised and lowered pitch-only changes both warn", up.update({ lnF0: lnAt(6), resonance: snap({ u: 0.5 }) }) && down.update({ lnF0: lnAt(-6), resonance: snap({ u: -0.1 }) }));
  check("the text names no direction, target or percent", !/%|higher|lower|mascul|femin|\bman\b|\bwoman\b|target/i.test(PITCH_ONLY_TEXT));
}

console.log("5. K consecutive updates");
{
  const w = primed();
  const hit = { lnF0: lnAt(6), resonance: snap() };
  check("K = 2: one qualifying update shows nothing", w.update(hit) === false);
  check("K = 2: the second consecutive one shows it", w.update(hit) === true);
  const ineligible = [
    ["panel hidden", { lnF0: null, resonance: snap() }],
    ["verdict sustained", { lnF0: lnAt(6), resonance: snap({ verdict: "sustained" }) }],
    ["sinceResumeS < 2", { lnF0: lnAt(6), resonance: snap({ sinceResumeS: 1.9 }) }],
    ["fill < 1", { lnF0: lnAt(6), resonance: snap({ fill: 0.9 }) }],
  ];
  for (const [name, u] of ineligible) {
    const v = primed();
    v.update(hit);
    const mid = v.update(u);
    const after = v.update(hit);
    check(`an ineligible update between two qualifying ones restarts the run (${name})`, mid === false && after === false && v.update(hit) === true);
  }
}

console.log("6. clearing");
{
  const w = primed();
  const hit = { lnF0: lnAt(-7), resonance: snap() };
  w.update(hit); w.update(hit);
  check("shown after two qualifying updates", w.isOn());
  check("cleared on the first update where the condition fails (resonance moved too)", w.update({ lnF0: lnAt(-7), resonance: snap({ u: 0.2 - 0.9 }) }) === false && !w.isOn());
  check("returns only after K new qualifying updates", w.update(hit) === false && w.update(hit) === true);
  check("cleared when the panel hides", w.update({ lnF0: null, resonance: snap() }) === false && !w.isOn());
  check("cleared when pitch comes back near the start", (w.update(hit), w.update(hit), w.update({ lnF0: lnAt(-1), resonance: snap() }) === false));
}

console.log("7. resets");
{
  const hit = { lnF0: lnAt(6), resonance: snap() };
  const a = primed();
  a.update(hit); a.update(hit);
  a.noteResonance(null);                                    // overload back-off
  check("resonance overload: P0 and the warning dropped", a.pitchStart() === null && !a.isOn() && a.update(hit) === false);
  const b = primed();
  b.update(hit); b.update(hit);
  b.noteResonance(snap({ fill: 0, u: null, startU: null }), 40000);   // fresh engine posts again
  check("resonance restart (startU back to null): P0 and the warning dropped", b.pitchStart() === null && !b.isOn());
  // the new engine's start becomes the new reference
  b.noteResonance(snap({ fill: 1, startU: null }), 45000);
  for (let t = 45000; t <= 57000; t += 25) b.addPitch({ audioMs: t, f0: 200 });
  b.noteResonance(snap(), 57000);
  b.addPitch({ audioMs: 57025, f0: 200 });
  check("…and the restarted cue's start window gives the new P0", Math.abs(b.pitchStart() - Math.log(200)) < 1e-12);
  const c = primed();
  c.update(hit); c.update(hit);
  c.reset();
  check("stop / start listening resets everything", c.pitchStart() === null && !c.isOn() && c.update(hit) === false);
  const d = primed();
  d.update(hit);                       // one qualifying update, then the panel is switched off
  d.resetRun();
  check("panel off and on: a stale run is not reused (P0 kept)", d.update(hit) === false && d.pitchStart() !== null && d.update(hit) === true);
}

console.log("8. wiring");
{
  const panel = readFileSync(path.join(here, "../../src/components/HeardAsPanel.jsx"), "utf8");
  const hook = readFileSync(path.join(here, "../../src/audio/useAudioPipeline.js"), "utf8");
  const iText = panel.indexOf("{PITCH_ONLY_TEXT}");
  const iShown = panel.indexOf("data-heard-as-shares");
  const iCaveat = panel.indexOf("data-heard-as-caveat");
  const slotOpen = panel.lastIndexOf("<p", iText);
  check("the panel renders the warning text exactly once", iText > 0 && panel.indexOf("{PITCH_ONLY_TEXT}", iText + 1) === -1);
  check("…inside the shown-estimate block (after the axis, before the caveat)", iText > iShown && iText < iCaveat && iShown > 0);
  check("…in the extra note slot [data-heard-as-note=\"extra\"]", /data-heard-as-note="extra"[^>]*data-pitch-only="1"/.test(panel.slice(slotOpen, iText)));
  check("…only when the panel's update said so (view.pitchOnly)", /\{view\.pitchOnly \? \(/.test(panel.slice(iShown, iText)));
  check("hidden panel updates go to the warning as lnF0 null", (panel.match(/warn\(null\)/g) ?? []).length >= 3 && /pitchOnly: warn\(e\.lnF0\)/.test(panel));
  check("switching the panel off drops the run", /warning\?\.resetRun\(\)/.test(panel));
  check("the hook feeds POSTED voiced pitch (msg.voiced && msg.pitch), not painted / held values",
    /pitchOnlyRef\.current\.addPitch\(\{ audioMs: msg\.contextTime \* 1000, f0: msg\.voiced && msg\.pitch > 0 \? msg\.pitch : null \}\)/.test(hook));
  check("the hook feeds every resonance state, null on overload, and resets on start / stop",
    /pitchOnlyRef\.current\.noteResonance\(msg, audioClockRef\.current\)/.test(hook) && /pitchOnlyRef\.current\.noteResonance\(null\)/.test(hook)
    && (hook.match(/pitchOnlyRef\.current\.reset\(\)/g) ?? []).length >= 2);
}

console.log("9. golden replay (public sessions, the study's own rule)");
{
  const G = JSON.parse(readFileSync(path.join(here, "fixtures/pitch-only-golden.json"), "utf8"));
  check("fixture rule matches the module (X 4 st, Y 0.6 u, P8)", G.rule.X === C.minPitchSt && G.rule.Y === C.maxResonanceU && G.rule.pitch === "P8");
  const replay = (s, K) => {
    const w = createPitchOnlyWarning({ ...C, consecutive: K });
    const { t0Ms, stepMs, f0 } = s.pitch;
    let i = 0, on = "", p0 = null;
    for (const [t, lnF0, u, startU, fill, verdict, sinceResumeS] of s.ticks) {
      while (i < f0.length && t0Ms + i * stepMs <= t) { w.addPitch({ audioMs: t0Ms + i * stepMs, f0: f0[i] }); i++; }
      const r = { u, startU, fill, verdict, sinceResumeS };
      w.noteResonance(r, t);
      on += w.update({ lnF0, resonance: r }) ? "1" : "0";
      if (w.pitchStart() !== null) p0 = w.pitchStart();
    }
    return { on, p0 };
  };
  const onShare = (on, elig) => { let n = 0, k = 0; for (let i = 0; i < on.length; i++) if (elig[i] === "1") { n++; if (on[i] === "1") k++; } return n ? k / n : 0; };
  for (const s of G.sessions) {
    const r1 = replay(s, 1), r2 = replay(s, 2);
    const p0ok = s.expect.p0 === null ? r2.p0 === null : r2.p0 !== null && Math.abs(r2.p0 - s.expect.p0) < 1e-12;
    check(`${s.key}: P0 = the study's value`, p0ok, `${r2.p0} vs ${s.expect.p0}`);
    check(`${s.key}: K = 1 timeline = the study's rule, tick for tick`, r1.on === s.expect.on1, `\n      js ${r1.on}\n      py ${s.expect.on1}`);
    check(`${s.key}: K = 2 timeline = the study's rule, tick for tick`, r2.on === s.expect.on2, `\n      js ${r2.on}\n      py ${s.expect.on2}`);
    const ts = s.ticks.map((x) => x[0]);
    const after = (lo, hi, on) => ts.some((t, i) => t > lo && t <= hi && on[i] === "1");
    if (s.kind === "pitch") {
      const persist = ts.map((t, i) => [t, i]).filter(([t, i]) => t >= s.tShiftMs + 10000 && s.expect.elig[i] === "1");
      const share = persist.filter(([, i]) => r2.on[i] === "1").length / Math.max(1, persist.length);
      check(`${s.key} (${s.sex}, pitch only): on within 10 s of the shift (K = 2) and persists (${(100 * share).toFixed(0)} % of later eligible updates)`,
        after(s.tShiftMs, s.tShiftMs + 10000, r2.on) && share >= 0.8 && !after(-Infinity, s.tShiftMs, r2.on));
    } else if (s.kind === "together") {
      check(`${s.key} (${s.sex}, together): K = 1 flashes right after the shift, K = 2 never shows it`,
        after(s.tShiftMs, s.tShiftMs + 10000, r1.on) && !r2.on.includes("1"));
    } else if (s.kind === "resonance") {
      check(`${s.key} (${s.sex}, resonance only): never on`, !r2.on.includes("1"));
    } else if (s.kind === "natural") {
      const sh = onShare(r2.on, s.expect.elig);
      check(`${s.key} (${s.sex}, natural reading): on for <= 5 % of eligible updates (${(100 * sh).toFixed(1)} %)`, sh <= 0.05);
    }
  }
  const kinds = G.sessions.map((s) => `${s.kind}:${s.sex}`);
  check("golden set covers pitch-only / together / resonance-only / natural for both sexes",
    ["pitch", "together", "resonance", "natural"].every((k) => kinds.includes(`${k}:m`) && kinds.includes(`${k}:f`)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
