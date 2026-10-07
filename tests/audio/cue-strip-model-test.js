// cue-strip-model-test.js — src/components/cueStripModel.js: the Dashboard
// cue strip's axes, bands, direction highlight (the same in every direction),
// dot colours (only pitch judges), trail and row states.
//
//   node tests/audio/cue-strip-model-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  axisPos,
  bandsFor,
  createTrail,
  dotColor,
  dotOpacity,
  highlightFor,
  pitchRowState,
  resonanceClamp,
  resonanceHeader,
  resonanceRowState,
  targetRangeFor,
  weightHeader,
  weightRowState,
  trailOpacity,
  HIGHLIGHT_STYLE,
  TRAIL_LEN,
  TRAIL_EVERY_MS,
  CUES,
} from "../../src/components/cueStripModel.js";
import { COLORS, CUE_AXES, statusColor } from "../../src/utils/constants.js";
import { PITCH_TARGETS, pitchStatus, pitchTargetFor, resonanceU } from "../../src/utils/trainingDirection.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REF = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8")).vtln;

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

console.log("axes");
check("pitch axis: log 75–320 Hz", CUE_AXES.pitch.min === 75 && CUE_AXES.pitch.max === 320 && CUE_AXES.pitch.log);
check("pitch: 75 -> left end, 320 -> right end", near(axisPos("pitch", 75).x, 0) && near(axisPos("pitch", 320).x, 1));
check("pitch: log scale (geometric middle at x 0.5)", near(axisPos("pitch", Math.sqrt(75 * 320)).x, 0.5));
check("pitch: below 75 Hz pinned left with a chevron", axisPos("pitch", 60).x === 0 && axisPos("pitch", 60).beyond === -1);
check("pitch: above 320 Hz pinned right", axisPos("pitch", 380).x === 1 && axisPos("pitch", 380).beyond === 1);
check("resonance axis: u −1.0…2.2 (the lab's U_MIN / U_MAX)", CUE_AXES.resonance.min === -1 && CUE_AXES.resonance.max === 2.2);
check("resonance: u 0 (typical man) left of u 1 (typical woman)", axisPos("resonance", 0).x < axisPos("resonance", 1).x);
check("resonance: a vtln clamp pins the dot even inside the axis", axisPos("resonance", 1.0, { clamp: 1 }).x === 1 && axisPos("resonance", 1.0, { clamp: 1 }).beyond === 1);
check("resonance clamp flag at ±0.2395", resonanceClamp({ raw: 0.24 }) === 1 && resonanceClamp({ raw: -0.2396 }) === -1 && resonanceClamp({ raw: 0.2 }) === 0 && resonanceClamp(null) === 0);
check("weight axis: −3 (heavier, left) … +3 (lighter, right)", near(axisPos("weight", -3).x, 0) && near(axisPos("weight", 3).x, 1) && near(axisPos("weight", 0).x, 0.5));
check("weight: lighter (σ > 0) is right of your start", axisPos("weight", 1.2).x > 0.5);
check("null values -> no position", axisPos("pitch", null) === null && axisPos("resonance", NaN) === null);

console.log("\nbands");
{
  const p = bandsFor("pitch");
  check("pitch bands = PITCH_TARGETS masculine / feminine (typical adult speakers)",
    near(p.men.x0, axisPos("pitch", PITCH_TARGETS.masculine.low).x) && near(p.men.x1, axisPos("pitch", PITCH_TARGETS.masculine.high).x)
    && near(p.women.x0, axisPos("pitch", PITCH_TARGETS.feminine.low).x) && near(p.women.x1, axisPos("pitch", PITCH_TARGETS.feminine.high).x));
  const r = bandsFor("resonance", REF);
  check("resonance bands = reference.json q10–q90, q50 tick",
    near(r.men.x0, axisPos("resonance", resonanceU(REF, REF.men.q10)).x) && near(r.men.x1, axisPos("resonance", resonanceU(REF, REF.men.q90)).x)
    && near(r.women.x0, axisPos("resonance", resonanceU(REF, REF.women.q10)).x) && near(r.women.x1, axisPos("resonance", resonanceU(REF, REF.women.q90)).x)
    && near(r.men.xm, axisPos("resonance", 0).x) && near(r.women.xm, axisPos("resonance", 1).x));
  check("resonance band values in u (men −0.53…0.29, women 0.65…1.55)",
    near(resonanceU(REF, REF.men.q10), -0.530, 1e-3) && near(resonanceU(REF, REF.men.q90), 0.288, 1e-3)
    && near(resonanceU(REF, REF.women.q10), 0.654, 1e-3) && near(resonanceU(REF, REF.women.q90), 1.549, 1e-3));
  check("weight has no population bands", bandsFor("weight") === null);
}

console.log("\ndirection highlight");
{
  const expect = {
    pitch: { feminine: [165, 255], masculine: [85, 155], androgynous: [145, 175] },
    resonance: {
      feminine: [resonanceU(REF, REF.women.q10), resonanceU(REF, REF.women.q90)],
      masculine: [resonanceU(REF, REF.men.q10), resonanceU(REF, REF.men.q90)],
      androgynous: [resonanceU(REF, REF.men.q90), resonanceU(REF, REF.women.q10)],
    },
    weight: { feminine: [0.5, 3], masculine: [-3, -0.5], androgynous: null },
  };
  for (const cue of CUES) {
    for (const dir of ["feminine", "masculine", "androgynous"]) {
      const h = highlightFor(cue, dir, REF);
      const e = expect[cue][dir];
      check(`${cue} / ${dir}: ${e ? `${e[0].toFixed(3)}–${e[1].toFixed(3)}` : "none"}`,
        e === null ? h === null : h && near(h.low, e[0]) && near(h.high, e[1]));
    }
    check(`${cue}: no highlight for exploring / unanswered`, highlightFor(cue, "exploring", REF) === null && highlightFor(cue, null, REF) === null);
    // Symmetry: the highlight is one element + one style for every direction.
    const hs = ["feminine", "masculine", "androgynous"].map((d) => highlightFor(cue, d, REF)).filter(Boolean);
    const strip = ({ low, high, x0, x1, ...rest }) => { void low; void high; void x0; void x1; return JSON.stringify(rest); };
    check(`${cue}: identical highlight style in every direction (deep-equal minus the range)`,
      hs.length >= 2 && hs.every((h) => strip(h) === strip(hs[0])) && hs.every((h) => h.style === HIGHLIGHT_STYLE));
  }
  check("highlight style = the pitch trace's target band colours",
    HIGHLIGHT_STYLE.fill === COLORS.targetBand && HIGHLIGHT_STYLE.stroke === COLORS.targetBandBorder);
  check("target ranges come from the shared helpers", JSON.stringify(targetRangeFor("pitch", "feminine")) === JSON.stringify({ low: 165, high: 255 }));
}

console.log("\ndot colours: only pitch judges");
{
  let ok = true;
  for (const dir of [null, "feminine", "masculine", "androgynous", "exploring"]) {
    for (const lvl of [null, 70, 100, 150, 160, 200, 300]) {
      if (dotColor("pitch", { pitchLevel: lvl, direction: dir }) !== statusColor(pitchStatus(lvl, pitchTargetFor(dir)))) ok = false;
      if (dotColor("resonance", { pitchLevel: lvl, direction: dir }) !== COLORS.neutralTrace) ok = false;
      if (dotColor("weight", { pitchLevel: lvl, direction: dir }) !== COLORS.neutralTrace) ok = false;
    }
  }
  check("pitch = statusColor(pitchStatus(level, target)); resonance & weight always neutral", ok);
  check("beyond the band in the direction of travel is neutral (not red)",
    dotColor("pitch", { pitchLevel: 280, direction: "feminine" }) === COLORS.neutralTrace
    && dotColor("pitch", { pitchLevel: 80, direction: "masculine" }) === COLORS.neutralTrace);
}

console.log("\ntrail");
{
  check("8 samples every 250 ms (~2 s)", TRAIL_LEN === 8 && TRAIL_EVERY_MS === 250);
  const t = createTrail();
  for (let i = 0; i < 12; i++) t.tick("live", i);
  check("keeps the last 8 live samples", JSON.stringify(t.points()) === JSON.stringify([4, 5, 6, 7, 8, 9, 10, 11]));
  t.tick("holding", 99);
  check("frozen while holding (no stale padding)", t.points().length === 8 && !t.points().includes(99));
  t.tick("settling", 98); t.tick("warming", 97);
  check("frozen in non-live states", !t.points().includes(98) && !t.points().includes(97));
  t.tick("idle", null);
  check("cleared when the row goes idle", t.points().length === 0);
  for (let i = 0; i < 5; i++) t.tick("live", i);
  t.tick("sustained", 3);
  check("cleared on a change into 'sustained'", t.points().length === 0);
  t.tick("sustained", 3);
  t.tick("live", 7);
  check("cleared on a change out of 'sustained', then samples again", JSON.stringify(t.points()) === "[7]");
  t.tick("live", null);
  check("null values are not sampled", t.points().length === 1);
  check("trail opacity 0.12 (oldest) -> 0.45 (newest)", near(trailOpacity(0, 8), 0.12) && near(trailOpacity(7, 8), 0.45));
}

console.log("\nrow states");
{
  check("pitch: live / holding / idle",
    pitchRowState({ voiced: true, pitchLevel: 180 }) === "live" && pitchRowState({ voiced: false, holding: true }) === "holding"
    && pitchRowState({ voiced: false, holding: false }) === "idle");
  const snap = (o) => ({ u: 0.8, raw: 0.03, fill: 1, voicedS: 6, verdict: "score", ...o });
  const R = (o) => resonanceRowState({ workerStatus: "ready", voiced: true, holding: false, snap: snap({}), ...o });
  check("resonance: starting (worker loading / no state yet)", resonanceRowState({ workerStatus: "loading" }) === "starting" && R({ snap: null }) === "starting");
  check("resonance: unavailable (error / overloaded)", R({ workerStatus: "error" }) === "unavailable" && R({ workerStatus: "overloaded" }) === "unavailable");
  check("resonance: idle without voice", R({ voiced: false, holding: false }) === "idle");
  check("resonance: sustained on a held note", R({ snap: snap({ verdict: "sustained" }) }) === "sustained");
  check("resonance: warming below 2 s voiced", R({ snap: snap({ voicedS: 1.2, fill: 0.24 }) }) === "warming");
  check("resonance: settling 2–5 s", R({ snap: snap({ voicedS: 3, fill: 0.6 }) }) === "settling");
  check("resonance: holding after voice", R({ voiced: false, holding: true }) === "holding");
  check("resonance: live", R({}) === "live");
  const W = (vw, o = {}) => weightRowState({ vocalWeight: vw, voiced: true, holding: false, ...o });
  check("weight: calibrating until the baseline locks", W({ baselineReady: false, baselineProgress: 0.4 }) === "calibrating");
  check("weight: live / holding / idle",
    W({ baselineReady: true, sigmaDelta: 0.7 }) === "live" && W({ baselineReady: true, sigmaDelta: 0.7 }, { voiced: false, holding: true }) === "holding"
    && W({ baselineReady: true, sigmaDelta: 0.7 }, { voiced: false, holding: false }) === "idle");
  check("dot opacity per state", dotOpacity("live") === 1 && dotOpacity("holding") === 0.5 && dotOpacity("settling") === 0.45
    && dotOpacity("idle") === null && dotOpacity("warming") === null && dotOpacity("calibrating") === null && dotOpacity("starting") === null);
  check("resonance header words", resonanceHeader("sustained") === "needs running speech" && resonanceHeader("warming") === "keep talking…"
    && resonanceHeader("unavailable") === "unavailable on this device" && resonanceHeader("live", snap({})) === "last ~5 s of speech"
    && resonanceHeader("live", snap({ raw: 0.24, u: 2.6 })) === "beyond the scale");
  check("weight header words", weightHeader("calibrating", { baselineProgress: 0.4, cpp: 12 }) === "Calibrating 40 %"
    && weightHeader("live", { sigmaDelta: 1.24 }) === "1.2 σ lighter than your start"
    && weightHeader("live", { sigmaDelta: -0.8 }) === "0.8 σ heavier than your start"
    && weightHeader("idle", { sigmaDelta: 0.5 }) === "—");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
