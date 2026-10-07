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
  cueResonanceRef,
  cueSummary,
  dotColor,
  dotHollow,
  pitchCueWord,
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
  RESONANCE_TRAIL,
  CUES,
} from "../../src/components/cueStripModel.js";
import { COLORS, CUE_AXES, statusColor } from "../../src/utils/constants.js";
import { PITCH_TARGETS, pitchStatus, pitchTargetFor, resonanceU } from "../../src/utils/trainingDirection.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SPK = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8")).vtln;
const CUE_BANDS = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/cue-bands.json"), "utf8"));
// What the strip draws with: u units from the per-speaker medians, bands
// from the readout distribution, the per-speaker bands for androgynous.
const REF = cueResonanceRef(SPK, CUE_BANDS);

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
  check("cueResonanceRef: u units unchanged (per-speaker medians), bands from cue-bands.json, speaker bands kept",
    REF.menMedian === SPK.menMedian && REF.womenMedian === SPK.womenMedian && REF.men === CUE_BANDS.men && REF.speakerBands.women === SPK.women);
  check("cueResonanceRef without cue bands = the per-speaker reference", cueResonanceRef(SPK, null) === SPK);
  check("resonance bands = cue-bands.json q10–q90, tick at the typical speaker (u 0 / 1)",
    near(r.men.x0, axisPos("resonance", resonanceU(REF, REF.men.q10)).x) && near(r.men.x1, axisPos("resonance", resonanceU(REF, REF.men.q90)).x)
    && near(r.women.x0, axisPos("resonance", resonanceU(REF, REF.women.q10)).x) && near(r.women.x1, axisPos("resonance", resonanceU(REF, REF.women.q90)).x)
    && near(r.men.xm, axisPos("resonance", 0).x) && near(r.women.xm, axisPos("resonance", 1).x));
  check("resonance band values in u (readout distribution: men −0.58…0.48, women 0.57…1.39)",
    near(resonanceU(REF, REF.men.q10), -0.582, 2e-3) && near(resonanceU(REF, REF.men.q90), 0.480, 2e-3)
    && near(resonanceU(REF, REF.women.q10), 0.574, 2e-3) && near(resonanceU(REF, REF.women.q90), 1.390, 2e-3),
    [REF.men.q10, REF.men.q90, REF.women.q10, REF.women.q90].map((v) => resonanceU(REF, v).toFixed(3)).join(" "));
  check("resonance bands are wider than the per-speaker-median bands on both sides (they describe single readings)",
    resonanceU(REF, REF.men.q90) - resonanceU(REF, REF.men.q10) > resonanceU(SPK, SPK.men.q90) - resonanceU(SPK, SPK.men.q10)
    && resonanceU(REF, REF.women.q90) - resonanceU(REF, REF.women.q10) > 0.8);
  check("weight has no population bands", bandsFor("weight") === null);
}

console.log("\ndirection highlight");
{
  const expect = {
    pitch: { feminine: [165, 255], masculine: [85, 155], androgynous: [145, 175] },
    resonance: {
      feminine: [resonanceU(REF, REF.women.q10), resonanceU(REF, REF.women.q90)],
      masculine: [resonanceU(REF, REF.men.q10), resonanceU(REF, REF.men.q90)],
      // the gap between typical men's and women's readings (per-speaker bands)
      androgynous: [resonanceU(SPK, SPK.men.q90), resonanceU(SPK, SPK.women.q10)],
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
  check("off target is also HOLLOW (not colour alone); in / beyond / no target are filled",
    dotHollow("pitch", { pitchLevel: 120, direction: "feminine" }) && dotHollow("pitch", { pitchLevel: 200, direction: "masculine" })
    && dotHollow("pitch", { pitchLevel: 200, direction: "androgynous" })
    && !dotHollow("pitch", { pitchLevel: 200, direction: "feminine" }) && !dotHollow("pitch", { pitchLevel: 280, direction: "feminine" })
    && !dotHollow("pitch", { pitchLevel: 120, direction: null }) && !dotHollow("resonance", { pitchLevel: 120, direction: "feminine" }));
  check("pitch word: same words in every direction",
    pitchCueWord(120, "feminine") === "↑ higher" && pitchCueWord(200, "masculine") === "↓ lower"
    && pitchCueWord(200, "feminine") === "in target" && pitchCueWord(120, "masculine") === "in target"
    && pitchCueWord(130, "androgynous") === "↑ higher" && pitchCueWord(190, "androgynous") === "↓ lower"
    && pitchCueWord(280, "feminine") === null && pitchCueWord(80, "masculine") === null
    && pitchCueWord(150, "exploring") === null && pitchCueWord(null, "feminine") === null);
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
  check("resonance trail: 15 samples, one every 8 ticks (2 s, ~30 s)", RESONANCE_TRAIL.n === 15 && RESONANCE_TRAIL.everyTicks === 8);
  const rt = createTrail(RESONANCE_TRAIL.n, RESONANCE_TRAIL.everyTicks);
  for (let i = 0; i < 8 * 20; i++) rt.tick("live", i);
  check("slow trail keeps one sample per 8 live ticks, last 15", rt.points().length === 15 && rt.points()[14] === 152 && rt.points()[13] === 144,
    JSON.stringify(rt.points()));
}

console.log("\nrow states");
{
  check("pitch: live / holding / idle",
    pitchRowState({ voiced: true, pitchLevel: 180 }) === "live" && pitchRowState({ voiced: false, holding: true }) === "holding"
    && pitchRowState({ voiced: false, holding: false }) === "idle");
  const snap = (o) => ({ u: 0.8, raw: 0.03, fill: 1, voicedS: 6, verdict: "score", ...o });
  const R = (o) => resonanceRowState({ workerStatus: "ready", voiced: true, holding: false, snap: snap({}), ...o });
  check("resonance: starting (worker loading / no state yet)", resonanceRowState({ workerStatus: "loading" }) === "starting" && R({ snap: null }) === "starting");
  check("resonance: unavailable on error; paused while the worker backs off (overloaded)", R({ workerStatus: "error" }) === "unavailable" && R({ workerStatus: "overloaded" }) === "paused");
  check("resonance: settling again after a long pause until 2 s of new speech", R({ snap: snap({ sinceResumeS: 0.8 }) }) === "settling" && R({ snap: snap({ sinceResumeS: 2.4 }) }) === "live");
  check("resonance: idle without voice", R({ voiced: false, holding: false }) === "idle");
  check("resonance: sustained on a held note", R({ snap: snap({ verdict: "sustained" }) }) === "sustained");
  check("resonance: warming below 2 s voiced", R({ snap: snap({ voicedS: 1.2, fill: 0.24 }) }) === "warming");
  check("resonance: settling 2–5 s", R({ snap: snap({ voicedS: 3, fill: 0.6 }) }) === "settling");
  check("resonance: holding after voice", R({ voiced: false, holding: true }) === "holding");
  check("resonance: live", R({}) === "live");
  const W = (vw, o = {}) => weightRowState({ vocalWeight: vw, voiced: true, holding: false, ...o });
  check("weight: calibrating until the baseline locks", W({ baselineReady: false, baselineProgress: 0.4 }) === "calibrating");
  check("weight: live / holding / idle (on the ~5 s level, sigmaLevel)",
    W({ baselineReady: true, sigmaLevel: 0.7 }) === "live" && W({ baselineReady: true, sigmaLevel: 0.7 }, { voiced: false, holding: true }) === "holding"
    && W({ baselineReady: true, sigmaLevel: 0.7 }, { voiced: false, holding: false }) === "idle"
    && W({ baselineReady: true, sigmaDelta: 0.7, sigmaLevel: null }) === "holding");
  check("dot opacity per state", dotOpacity("live") === 1 && dotOpacity("holding") === 0.5 && dotOpacity("settling") === 0.45
    && dotOpacity("idle") === null && dotOpacity("warming") === null && dotOpacity("calibrating") === null && dotOpacity("starting") === null);
  check("resonance header words", resonanceHeader("sustained") === "needs running speech" && resonanceHeader("warming") === "keep talking…"
    && resonanceHeader("unavailable") === "unavailable on this device" && resonanceHeader("paused") === "paused — device busy"
    && resonanceHeader("live", snap({})) === "finding your start…"
    && resonanceHeader("live", snap({ raw: 0.24, u: 2.6 })) === "beyond the scale");
  check("resonance header: change from your start, 0.3 u deadband (the same both ways)",
    resonanceHeader("live", snap({ u: 0.9, startU: 0.7 })) === "about where you started"
    && resonanceHeader("live", snap({ u: 1.1, startU: 0.7 })) === "brighter than your start"
    && resonanceHeader("live", snap({ u: 0.3, startU: 0.7 })) === "darker than your start"
    && resonanceHeader("holding", snap({ u: 0.3, startU: 0.7 })) === "darker than your start");
  check("weight header words", weightHeader("calibrating", { baselineProgress: 0.4, cpp: 12 }) === "Calibrating 40 %"
    && weightHeader("live", { sigmaLevel: 1.24 }) === "1.2 σ lighter than your start"
    && weightHeader("live", { sigmaLevel: -0.8 }) === "0.8 σ heavier than your start"
    && weightHeader("live", { sigmaLevel: 0.2, sigmaDelta: 2 }) === "about where you started"
    && weightHeader("idle", { sigmaLevel: 0.5 }) === "—");
  check("screen-reader summaries name the value and the target",
    cueSummary("pitch", { state: "live", direction: "feminine", pitchLevel: 168 }) === "Pitch level 168 Hz, inside your target 165 to 255 Hz."
    && cueSummary("pitch", { state: "live", direction: "masculine", pitchLevel: 180 }) === "Pitch level 180 Hz, above your target 85 to 155 Hz."
    && cueSummary("pitch", { state: "live", direction: null, pitchLevel: 180 }) === "Pitch level 180 Hz."
    && cueSummary("pitch", { state: "idle" }) === "Pitch: no voice right now.");
  check("screen-reader: resonance position against the bands + change",
    cueSummary("resonance", { state: "live", snap: snap({ u: 0.52, startU: 0.1 }), vtlnRef: REF }) === "Resonance (approximate): between the typical men's and women's bands, brighter than your start."
    && cueSummary("resonance", { state: "warming", snap: snap({}) , vtlnRef: REF }) === "Resonance (approximate): keep talking…");
  check("screen-reader: weight", cueSummary("weight", { state: "live", vocalWeight: { sigmaLevel: 0.9 } }) === "Vocal weight: 0.9 σ lighter than your start.");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
