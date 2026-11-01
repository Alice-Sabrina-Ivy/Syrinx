// cue-strip-model-test.js — src/components/cueStripModel.js: the Dashboard
// cue strip's axes, bands, direction highlight (the same in every direction),
// dot colours (only pitch judges), trail, row states and the resonance row's
// hold through pauses (2026-10-28) and the narrower hold candidates K1–K5
// (2026-11-01, measurements/resonance-row-hold-narrow-2026-11-01.md §3).
//
//   node tests/audio/cue-strip-model-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  axisPos,
  bandsFor,
  createResonanceHold,
  createQuietOnsetBridge,
  createVoiceArmedBridge,
  createVoiceHold,
  createVoiceHoldRef,
  createQuietPauseHold,
  holdQuantile,
  holdMedian,
  RESONANCE_HOLD_CANDIDATES,
  createTrail,
  cueResonanceRef,
  cueRowStates,
  cueSummary,
  dotColor,
  dotHollow,
  pitchCueWord,
  dotOpacity,
  highlightFor,
  pitchRowState,
  resonanceClamp,
  resonanceHeader,
  shownStart,
  resonanceRowState,
  targetRangeFor,
  rowValue,
  trailOpacity,
  HIGHLIGHT_STYLE,
  TRAIL_LEN,
  TRAIL_EVERY_MS,
  RESONANCE_TRAIL,
  RESONANCE_HOLD_MS,
  CUES,
  NARROWBAND_NOTICE,
  NARROWBAND_INFO,
} from "../../src/components/cueStripModel.js";
import { COLORS, CUE_AXES, SILENCE_HOLD_MS, statusColor } from "../../src/utils/constants.js";
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
// The clarity row is hidden since 2026-10-11 (user decision; the clarity
// study failed, measurements/clarity-cue-2026-10-08.md): two cues, no
// clarity / weight axis.
check("two cues: pitch, resonance (no clarity / weight row)", CUES.join() === "pitch,resonance" && CUE_AXES.clarity === undefined && CUE_AXES.weight === undefined);
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
    }
  }
  check("pitch = statusColor(pitchStatus(level, target)); resonance always neutral", ok);
  check("off target is also HOLLOW (not colour alone), past the band included; in / no target are filled",
    dotHollow("pitch", { pitchLevel: 120, direction: "feminine" }) && dotHollow("pitch", { pitchLevel: 200, direction: "masculine" })
    && dotHollow("pitch", { pitchLevel: 200, direction: "androgynous" }) && dotHollow("pitch", { pitchLevel: 280, direction: "feminine" })
    && !dotHollow("pitch", { pitchLevel: 200, direction: "feminine" })
    && !dotHollow("pitch", { pitchLevel: 120, direction: null }) && !dotHollow("resonance", { pitchLevel: 120, direction: "feminine" }));
  check("pitch word: same words in every direction",
    pitchCueWord(120, "feminine") === "↑ higher" && pitchCueWord(200, "masculine") === "↓ lower"
    && pitchCueWord(200, "feminine") === "on target" && pitchCueWord(120, "masculine") === "on target"
    && pitchCueWord(130, "androgynous") === "↑ higher" && pitchCueWord(190, "androgynous") === "↓ lower"
    && pitchCueWord(280, "feminine") === "↓ lower" && pitchCueWord(80, "masculine") === "↑ higher"
    && pitchCueWord(150, "exploring") === null && pitchCueWord(null, "feminine") === null);
  // User decision 2026-10-19: only the band is on target — past it in the
  // direction of travel looks and reads like any other off-target level
  // on that side. Fails on the old rule (neutral, filled, no word).
  check("past the band in the direction of travel is off target (red, hollow, the side's word)",
    dotColor("pitch", { pitchLevel: 280, direction: "feminine" }) === COLORS.outOfTarget
    && dotColor("pitch", { pitchLevel: 80, direction: "masculine" }) === COLORS.outOfTarget
    && dotHollow("pitch", { pitchLevel: 80, direction: "masculine" })
    && pitchCueWord(280, "feminine") === pitchCueWord(200, "masculine")
    && pitchCueWord(80, "masculine") === pitchCueWord(120, "feminine"));
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
  const nt = createTrail();
  for (let i = 0; i < 5; i++) nt.tick("live", i);
  nt.tick("narrowband", 3);
  check("cleared on a change into 'narrowband' (no trail while paused)", nt.points().length === 0);
  nt.tick("narrowband", 3);
  nt.tick("warming", null); nt.tick("live", 6);
  check("cleared on the way out of 'narrowband', then samples again", JSON.stringify(nt.points()) === "[6]");
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
  check("resonance: restarting while it recovers; reload after a failed load (not 'on this device')",
    R({ workerStatus: "restarting" }) === "restarting" && R({ workerStatus: "reload" }) === "reload"
    && resonanceRowState({ workerStatus: "reload", snap: null }) === "reload"
    && resonanceHeader("restarting") === "restarting…" && resonanceHeader("reload") === "unavailable — reload the page");
  check("resonance: settling again after a long pause until 2 s of new speech", R({ snap: snap({ sinceResumeS: 0.8 }) }) === "settling" && R({ snap: snap({ sinceResumeS: 2.4 }) }) === "live");
  check("resonance: idle without voice", R({ voiced: false, holding: false }) === "idle");
  check("resonance: sustained on a held note", R({ snap: snap({ verdict: "sustained" }) }) === "sustained");
  check("resonance: warming below 2 s voiced", R({ snap: snap({ voicedS: 1.2, fill: 0.24 }) }) === "warming");
  check("resonance: settling 2–5 s", R({ snap: snap({ voicedS: 3, fill: 0.6 }) }) === "settling");
  check("resonance: holding after voice", R({ voiced: false, holding: true }) === "holding");
  check("resonance: live", R({}) === "live");
  // Both rows read the pitch display's flags (pitchVoiced / pitchHolding:
  // what the voice gate leaves), never the raw voiced / holding (2026-10-21).
  const C = (o) => cueRowStates({ workerStatus: "ready", snap: snap({}), pitchLevel: 180, ...o });
  check("cueRowStates: both rows from pitchVoiced / pitchHolding",
    C({ pitchVoiced: true }).pitch === "live" && C({ pitchVoiced: true }).resonance === "live"
    && C({ pitchVoiced: false, pitchHolding: true }).pitch === "holding" && C({ pitchVoiced: false, pitchHolding: true }).resonance === "holding"
    && C({ pitchVoiced: false, pitchHolding: false }).resonance === "idle" && C({ pitchVoiced: false, pitchHolding: false }).pitch === "idle");
  check("cueRowStates: the raw voiced / holding are ignored (the gate hid the pitch: both rows idle)",
    C({ voiced: true, holding: true, pitchVoiced: false, pitchHolding: false }).resonance === "idle"
    && C({ voiced: true, holding: true, pitchVoiced: false, pitchHolding: false }).pitch === "idle");
  check("cueRowStates: without the reference only the worker's own state shows",
    C({ pitchVoiced: true, hasRef: false }).resonance === "starting" && C({ pitchVoiced: true, hasRef: false, workerStatus: "error" }).resonance === "unavailable");
  const nb = (on, decided = true) => snap({ narrowband: { n: 400, decided, on, f: on ? -45 : -6 } });
  check("resonance: narrowband while the detector is on (live, idle, holding, held note alike)",
    R({ snap: nb(true) }) === "narrowband" && R({ snap: nb(true), voiced: false, holding: false }) === "narrowband"
    && R({ snap: nb(true), voiced: false, holding: true }) === "narrowband"
    && R({ snap: { ...nb(true), verdict: "sustained" } }) === "narrowband");
  check("resonance: detector off / absent leaves the states as they were",
    R({ snap: nb(false) }) === "live" && R({ snap: snap({ narrowband: null }) }) === "live"
    && R({ snap: { ...nb(false), voicedS: 1.2, fill: 0.24 } }) === "warming");
  // 2026-10-19 review: no position before the detector can decide (the
  // worker also withholds u; this keeps the row from drawing one regardless).
  check("resonance: warming (no dot) while the detector is undecided, even with a readout",
    R({ snap: nb(false, false) }) === "warming" && R({ snap: { ...nb(false, false), voicedS: 2.5, fill: 0.5 } }) === "warming"
    && dotOpacity("warming") === null
    && R({ snap: nb(false, false), voiced: false, holding: false }) === "idle");
  check("resonance: worker errors / back-off / start-up still win over narrowband",
    R({ workerStatus: "error", snap: nb(true) }) === "unavailable" && R({ workerStatus: "overloaded", snap: nb(true) }) === "paused"
    && R({ workerStatus: "restarting", snap: nb(true) }) === "restarting" && R({ workerStatus: "loading", snap: nb(true) }) === "starting");
  check("narrowband: no dot, the plan's notice and info text, screen-reader sentence; pitch row unaffected",
    dotOpacity("narrowband") === null
    && NARROWBAND_NOTICE === "Phone-quality audio — paused" && resonanceHeader("narrowband", nb(true)) === NARROWBAND_NOTICE
    && NARROWBAND_INFO === "Your microphone sound is cut off above about 4 kHz, as on a phone call or a narrowband Bluetooth headset. Resonance readings need the fuller sound, so they are paused. Pitch still works. A wired or wideband microphone fixes this."
    && cueSummary("resonance", { state: "narrowband", snap: nb(true), vtlnRef: REF }) === "Resonance (approximate): paused, phone-quality audio — the sound is cut off above about 4 kHz. Pitch still works."
    && pitchRowState({ voiced: true, pitchLevel: 180, snap: nb(true) }) === "live");
  check("dot opacity per state", dotOpacity("live") === 1 && dotOpacity("holding") === 0.5 && dotOpacity("settling") === 0.45
    && dotOpacity("idle") === null && dotOpacity("warming") === null && dotOpacity("starting") === null);
  check("resonance header words", resonanceHeader("sustained") === "needs running speech" && resonanceHeader("warming") === "keep talking…"
    && resonanceHeader("unavailable") === "unavailable on this device" && resonanceHeader("paused") === "paused — device busy"
    && resonanceHeader("live", snap({})) === "finding your start…"
    && resonanceHeader("live", snap({ raw: 0.24, u: 2.6 })) === "beyond the scale");
  check("resonance header: change from your start, 0.3 u deadband (the same both ways)",
    resonanceHeader("live", snap({ u: 0.9, startU: 0.7 })) === "about where you started"
    && resonanceHeader("live", snap({ u: 1.1, startU: 0.7 })) === "brighter than your start"
    && resonanceHeader("live", snap({ u: 0.3, startU: 0.7 })) === "darker than your start"
    && resonanceHeader("holding", snap({ u: 0.3, startU: 0.7 })) === "darker than your start");
  check("resonance header: the shown start (shownStartU) before startU is set, startU once set; an old post without it uses startU",
    resonanceHeader("live", snap({ u: 0.9, startU: null, shownStartU: 0.7 })) === "about where you started"
    && resonanceHeader("live", snap({ u: 1.1, startU: null, shownStartU: 0.7 })) === "brighter than your start"
    && resonanceHeader("live", snap({ u: 0.3, startU: null, shownStartU: 0.7 })) === "darker than your start"
    && resonanceHeader("live", snap({ u: 0.9, startU: null, shownStartU: null })) === "finding your start…"
    && resonanceHeader("live", snap({ u: 1.1, startU: 0.7, shownStartU: 0.7 })) === "brighter than your start"
    && shownStart(snap({ startU: 0.7 })) === 0.7 && shownStart(snap({ startU: null, shownStartU: 0.4 })) === 0.4 && shownStart(null) === null);
  check("screen-reader summaries name the value and the target",
    cueSummary("pitch", { state: "live", direction: "feminine", pitchLevel: 168 }) === "Pitch level 168 Hz, on target (165 to 255 Hz)."
    && cueSummary("pitch", { state: "live", direction: "masculine", pitchLevel: 180 }) === "Pitch level 180 Hz, above your target 85 to 155 Hz."
    && cueSummary("pitch", { state: "live", direction: "feminine", pitchLevel: 280 }) === "Pitch level 280 Hz, above your target 165 to 255 Hz."
    && cueSummary("pitch", { state: "live", direction: "masculine", pitchLevel: 80 }) === "Pitch level 80 Hz, below your target 85 to 155 Hz."
    && cueSummary("pitch", { state: "live", direction: null, pitchLevel: 180 }) === "Pitch level 180 Hz."
    && cueSummary("pitch", { state: "idle" }) === "Pitch: no voice right now.");
  check("screen-reader: resonance position against the bands + change",
    cueSummary("resonance", { state: "live", snap: snap({ u: 0.52, startU: 0.1 }), vtlnRef: REF }) === "Resonance (approximate): between the typical men's and women's bands, brighter than your start."
    && cueSummary("resonance", { state: "warming", snap: snap({}) , vtlnRef: REF }) === "Resonance (approximate): keep talking…"
    && cueSummary("resonance", { state: "idle", snap: snap({}), vtlnRef: REF }) === "Resonance (approximate): no voice right now."
    && resonanceHeader("idle") === "—");
  check("row values: pitch level / resonance u; nothing for an unknown cue (no clarity row)",
    rowValue("pitch", { pitchLevel: 180 }) === 180 && rowValue("resonance", { snap: { u: 0.4 } }) === 0.4
    && rowValue("clarity", { vocalWeight: { sigmaLevel: 0.9 } }) === null);
  check("screen-reader: no sentence for an unknown cue (no clarity row; matches rowValue)",
    cueSummary("clarity", { state: "live" }) === null
    && cueSummary("clarity", { state: "warming", snap: snap({}), vtlnRef: REF }) === null
    && cueSummary("weight", { state: "live", snap: snap({ u: 0.52, startU: 0.1 }), vtlnRef: REF }) === null);
  check("screen-reader: no '….' after a header that ends in an ellipsis",
    cueSummary("resonance", { state: "live", snap: snap({ u: 0.52, startU: null }), vtlnRef: REF }) === "Resonance (approximate): between the typical men's and women's bands, finding your start…");
}

// The resonance row's hold (owner decision 2026-10-28; measurements/
// resonance-row-hold-2026-10-28.md): up to 5 s after the strip last saw
// shown voice the row keeps its position (dimmed) whatever the pause's noise
// floor, so pauses and the onset blink no longer clear its trail. A replay of
// the CueStrip tick: hold.tick at each 250 ms tick, cueRowStates with the
// tick's resonanceHold, the trails' tick.
console.log("\nresonance row hold");
{
  check("hold = the pitch readout's silence hold (5 s)", RESONANCE_HOLD_MS === SILENCE_HOLD_MS && RESONANCE_HOLD_MS === 5000);
  const h = createResonanceHold();
  check("no hold before any shown voice", h.tick(false, 0) === false && h.tick(false, 1000) === false);
  check("held on the voiced tick and up to 5 s after it",
    h.tick(true, 2000) === true && h.tick(false, 2250) === true && h.tick(false, 7000) === true);
  check("released once more than 5 s have passed", h.tick(false, 7250) === false && h.tick(false, 9000) === false);
  check("a new voiced tick re-arms it", h.tick(true, 9250) === true && h.tick(false, 14250) === true && h.tick(false, 14500) === false);
  h.clear();
  check("clear() forgets the last voice", h.tick(false, 14600) === false);

  const snap = (o) => ({ u: 0.8, raw: 0.03, fill: 1, voicedS: 6, verdict: "score", ...o });
  const C = (o) => cueRowStates({ workerStatus: "ready", snap: snap({}), pitchLevel: null, pitchVoiced: false, pitchHolding: false, ...o });
  check("held: an idle row shows the dimmed thumb (holding)", C({}).resonance === "idle" && C({ resonanceHold: true }).resonance === "holding"
    && dotOpacity(C({ resonanceHold: true }).resonance) === 0.5);
  check("held: settling and 'needs running speech' as in a quiet pause",
    C({ resonanceHold: true, snap: snap({ voicedS: 3, fill: 0.6 }) }).resonance === "settling"
    && C({ resonanceHold: true, snap: snap({ sinceResumeS: 0.5 }) }).resonance === "settling"
    && C({ resonanceHold: true, snap: snap({ verdict: "sustained" }) }).resonance === "sustained");
  check("held: never 'keep talking…' — a row with no position stays idle",
    C({ resonanceHold: true, snap: snap({ voicedS: 1.2, fill: 0.24 }) }).resonance === "idle"
    && C({ resonanceHold: true, snap: snap({ u: null }) }).resonance === "idle"
    && C({ resonanceHold: true, snap: snap({ narrowband: { decided: false, on: false } }) }).resonance === "idle"
    && C({ pitchHolding: true, snap: snap({ voicedS: 1.2, fill: 0.24 }) }).resonance === "warming");
  check("held: the worker's own states and the notice come first, unchanged",
    C({ resonanceHold: true, workerStatus: "error" }).resonance === "unavailable" && C({ resonanceHold: true, workerStatus: "overloaded" }).resonance === "paused"
    && C({ resonanceHold: true, workerStatus: "loading" }).resonance === "starting" && C({ resonanceHold: true, snap: null }).resonance === "starting"
    && C({ resonanceHold: true, hasRef: false }).resonance === "starting" && C({ resonanceHold: true, workerStatus: "reload" }).resonance === "reload"
    && C({ resonanceHold: true, snap: snap({ narrowband: { decided: true, on: true } }) }).resonance === "narrowband");
  {
    // Only where the plain rule says idle: every other input gives the same states.
    let same = true, n = 0;
    const snaps = [snap({}), snap({ voicedS: 1, fill: 0.2 }), snap({ verdict: "sustained" }), snap({ fill: 0.5, voicedS: 3 }), snap({ sinceResumeS: 1 }), snap({ u: null }), null];
    for (const pitchVoiced of [false, true]) for (const pitchHolding of [false, true]) for (const sn of snaps) {
      for (const workerStatus of ["ready", "loading", "error", "overloaded"]) for (const pitchLevel of [null, 180]) {
        const a = cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap: sn, workerStatus });
        const b = cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap: sn, workerStatus, resonanceHold: true });
        n++;
        if (a.pitch !== b.pitch || (a.resonance !== "idle" && a.resonance !== b.resonance)) same = false;
      }
    }
    check(`the hold changes the resonance row only where it would be idle, never the pitch row (${n} input sets)`, same);
  }
  check("summary and header while held read as in a quiet pause",
    cueSummary("resonance", { state: C({ resonanceHold: true, snap: snap({ u: 0.52, startU: 0.1 }) }).resonance, snap: snap({ u: 0.52, startU: 0.1 }), vtlnRef: REF })
      === "Resonance (approximate): between the typical men's and women's bands, brighter than your start."
    && resonanceHeader("holding", snap({ u: 0.3, startU: 0.7 })) === "darker than your start");

  // The strip over time: the CueStrip tick (hold, states, trails), one frame
  // per 250 ms tick.
  const strip = (frames, { held = true } = {}) => {
    const hold = createResonanceHold();
    const tr = { pitch: createTrail(), resonance: createTrail(RESONANCE_TRAIL.n, RESONANCE_TRAIL.everyTicks) };
    const out = [];
    frames.forEach((f, i) => {
      const t = i * 250;
      const resonanceHold = held ? hold.tick(!!f.pitchVoiced, t) : false;
      const inputs = { pitchLevel: f.pitchVoiced || f.pitchHolding ? 180 : null, workerStatus: "ready", ...f, snap: snap(f.snap ?? {}), resonanceHold };
      const st = cueRowStates(inputs);
      out.push({ t, st, rTrail: tr.resonance.tick(st.resonance, rowValue("resonance", inputs)).length, pTrail: tr.pitch.tick(st.pitch, rowValue("pitch", inputs)).length });
    });
    return out;
  };
  const speech = (s) => Array.from({ length: Math.round(s * 4) }, () => ({ pitchVoiced: true }));
  const noisyPause = (s) => Array.from({ length: Math.round(s * 4) }, () => ({ pitchVoiced: false, pitchHolding: false }));
  const quietPause = (s) => Array.from({ length: Math.round(s * 4) }, () => ({ pitchVoiced: false, pitchHolding: true }));
  {
    const fr = [...speech(20), ...noisyPause(3), ...speech(4)];
    const A = strip(fr), B = strip(fr, { held: false });
    check("a 3 s pause that hears the room: the row holds throughout (thumb drawn)", A.slice(80, 92).every((x) => x.st.resonance === "holding"));
    check("…and the trail is kept, then grows on", A[91].rTrail === A[79].rTrail && A[79].rTrail >= 9 && A[A.length - 1].rTrail > A[79].rTrail,
      `${A[79].rTrail} -> ${A[91].rTrail} -> ${A[A.length - 1].rTrail}`);
    check("the plain rule (no hold) goes idle and clears it", B.slice(80, 92).every((x) => x.st.resonance === "idle") && B[91].rTrail === 0);
    check("the pitch row is the same with and without the hold", A.every((x, i) => x.st.pitch === B[i].st.pitch && x.pTrail === B[i].pTrail));
  }
  {
    const fr = [...speech(20), ...noisyPause(8)];
    const A = strip(fr);
    // last voiced tick t = 19.75 s: held through 24.75 s, idle from 25.0 s
    check("after 5 s without shown voice the row goes idle and the trail clears, as before",
      A[99].st.resonance === "holding" && A[99].rTrail > 0 && A[100].st.resonance === "idle" && A[100].rTrail === 0
      && A.slice(100).every((x) => x.st.resonance === "idle"));
  }
  {
    // The onset blink: a quiet pause (the hook's silence hold), then one
    // tick with both flags false before the resumed speech paints.
    const fr = [...speech(20), ...quietPause(1.5), { pitchVoiced: false, pitchHolding: false }, ...speech(4)];
    const A = strip(fr), B = strip(fr, { held: false });
    check("the onset blink no longer clears the trail (holding, not idle)", A[86].st.resonance === "holding" && A[86].rTrail === A[85].rTrail && A[86].rTrail >= 9);
    check("without the hold the blink is idle and clears it", B[86].st.resonance === "idle" && B[86].rTrail === 0);
  }
  {
    const nbSnap = { narrowband: { decided: true, on: true, n: 400, f: -45 } };
    const A = strip([...speech(20), { pitchVoiced: true, snap: nbSnap }, ...speech(2)]);
    check("held or not, a change into 'phone-quality audio' still clears the trail", A[80].st.resonance === "narrowband" && A[80].rTrail === 0);
    const S2 = strip([...speech(20), { pitchVoiced: false, pitchHolding: false, snap: { verdict: "sustained" } }, ...speech(2)]);
    check("held or not, a change into 'needs running speech' still clears the trail", S2[80].st.resonance === "sustained" && S2[80].rTrail === 0);
  }
}

// The narrower hold candidates K1–K5 (2026-11-01, pre-registered;
// measurements/resonance-row-hold-narrow-2026-11-01.md §3, whose code blocks
// are normative). Expected flags below are worked out by hand from those
// code blocks, tick by tick (t in ms, 250 ms ticks).
console.log("\nnarrower hold candidates K1–K5");
{
  const SNAP = (o = {}) => ({ u: 0.8, raw: 0.03, fill: 1, voicedS: 6, verdict: "score", sinceResumeS: 100, narrowband: { decided: true, on: false }, ...o });
  // one tick: the defaults are a quiet room tick (-60 dBFS, no shown voice, no hold)
  const tk = (f, t, o = {}) => f.tick({ pitchVoiced: false, pitchHolding: false, pitchLevel: null, intensity: -60, snap: SNAP(), workerStatus: "ready", hasRef: true, ...o }, t);
  const V = (x = -30, o = {}) => ({ pitchVoiced: true, pitchLevel: 180, intensity: x, ...o }); // shown voice at x dBFS
  const run = (f, seq) => seq.map(([t, o]) => tk(f, t, o));
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const show = (a) => a.map((x) => (x ? 1 : 0)).join("");
  const room = (t0, n, o = {}) => Array.from({ length: n }, (_, i) => [t0 + 250 * i, o]);

  check("the round's five candidates, by name", Object.keys(RESONANCE_HOLD_CANDIDATES).join(",") === "K1,K2,K3,K4,K5"
    && RESONANCE_HOLD_CANDIDATES.K1 === createQuietOnsetBridge && RESONANCE_HOLD_CANDIDATES.K5 === createQuietPauseHold);
  check("quantile / median as §3.1", holdQuantile([5, 1, 3, 2, 4], 0.2) === 1.8 && holdQuantile([7], 0.2) === 7 && holdQuantile([1, 2], 0.5) === 1.5
    && holdMedian([3, 1, 2]) === 2 && holdMedian([4, 1, 3, 2]) === 2.5);

  // ---- K1 QB
  {
    const f = createQuietOnsetBridge();
    const got = run(f, [[0, V()], [250, { pitchHolding: true }], [500, {}], [750, { intensity: -35 }], [1000, { intensity: -35 }]]);
    check("K1: armed by a quiet hold tick within 5 s of voice; bridges +250 / +500 ms, not +750", eq(got, [false, true, true, true, false]), show(got));
    const one = (o, t = 250) => { const g = createQuietOnsetBridge(); tk(g, 0, V()); return [tk(g, t, o), tk(g, t + 250, {})]; };
    check("K1: no hold flag -> not armed", eq(one({}), [false, false]));
    check("K1: a shown-voice tick never arms (even holding and quiet)", eq(one({ pitchVoiced: true, pitchHolding: true }), [false, false]));
    check("K1: the level must be below -50 dBFS (-50 itself does not arm)", eq(one({ pitchHolding: true, intensity: -50 }), [false, false])
      && eq(one({ pitchHolding: true, intensity: -50.001 }), [true, true]));
    check("K1: digital silence (-Infinity) counts as quiet", eq(one({ pitchHolding: true, intensity: -Infinity }), [true, true]));
    check("K1: within 5 s of shown voice (5000 ms arms, 5250 does not)", one({ pitchHolding: true }, 5000)[0] === true && one({ pitchHolding: true }, 5250)[0] === false);
    { const g = createQuietOnsetBridge(); check("K1: no shown voice yet -> never armed", tk(g, 250, { pitchHolding: true }) === false); }
    for (const bad of [null, undefined, NaN]) {
      const g = createQuietOnsetBridge();
      tk(g, 0, V()); const a = tk(g, 250, { pitchHolding: true });
      const b = tk(g, 375, { intensity: bad });
      const c = tk(g, 500, {}), d = tk(g, 750, { pitchHolding: true });
      check(`K1: intensity ${bad} resets it (answers false, forgets the arm and the voice)`, a && !b && !c && !d);
    }
    {
      const g = createQuietOnsetBridge();
      tk(g, 0, V()); tk(g, 250, { pitchHolding: true });
      const a = tk(g, 500, { workerStatus: "loading" }), b = tk(g, 600, {}), c = tk(g, 1000, {});
      const h = createQuietOnsetBridge();
      tk(h, 0, V(-30, { workerStatus: "overloaded" }));
      check("K1: a worker that is not ready answers false and changes nothing (no reset, no voice counted)", !a && b && !c && tk(h, 250, { pitchHolding: true }) === false);
    }
  }

  // ---- K2 VB: 16 room ticks fill the floor ring (q20 = -60), then voice at 4000 ms
  const RING = room(0, 16);
  {
    const f = createVoiceArmedBridge();
    const got = run(f, [...RING, [4000, V(-45)], [4250, {}], [4500, {}], [4750, {}]]);
    check("K2: the room ticks answer false; a voiced tick >= floor + 10 dB arms; +250 / +500 bridged, +750 not",
      eq(got.slice(0, 16), Array(16).fill(false)) && eq(got.slice(16), [true, true, true, false]), show(got));
    const one = (o, ring = RING) => { const g = createVoiceArmedBridge(); run(g, ring); return [tk(g, 4000, o), tk(g, 4250, {})]; };
    check("K2: margin exactly 10 dB arms, 9.99 dB does not", eq(one(V(-50)), [true, true]) && eq(one(V(-50.01)), [false, false]));
    check("K2: verdict score or pause arms; warming / sustained / silent do not",
      one(V(-45, { snap: SNAP({ verdict: "pause" }) }))[1] && !one(V(-45, { snap: SNAP({ verdict: "warming" }) }))[1]
      && !one(V(-45, { snap: SNAP({ verdict: "sustained" }) }))[1] && !one(V(-45, { snap: SNAP({ verdict: "silent" }) }))[1]);
    check("K2: fewer than 16 tick levels -> no floor -> not armed", eq(one(V(-30), room(0, 14)), [false, false]));
    check("K2: not voiced -> not armed (a loud room tick)", eq(one({ intensity: -30 }), [false, false]));
    {
      // own at 4000; the plain rule holding (not idle) through 10000; idle after
      const mk = (last) => { const g = createVoiceArmedBridge(); run(g, [...RING, [4000, V(-45)], ...room(4250, (last - 4250) / 250 + 1, { pitchHolding: true })]); return tk(g, last + 250, {}); };
      check("K2: armed for 6 s after the own-voice tick (bridge at +6000 ms yes, +6250 no)", mk(9750) === true && mk(10000) === false);
    }
    {
      const g = createVoiceArmedBridge();
      run(g, [...RING, [4000, V(-45)]]);
      const got2 = run(g, [[4250, V(-45, { snap: null })], [4500, V(-45, { snap: null })], [4750, {}]]);
      check("K2: a 'starting' plain row (no snapshot) does not count as not idle", eq(got2, [true, true, false]), show(got2));
    }
    {
      const g = createVoiceArmedBridge();
      run(g, RING); tk(g, 4000, V(-45));
      const a = tk(g, 4100, { intensity: null }); const b = tk(g, 4250, {});
      const c = run(g, [...room(4500, 15), [8250, V(-45)]]).pop();
      check("K2: null intensity resets (the ring too: 15 new room ticks + the voice are 16 levels again)", !a && !b && c === true);
    }
  }

  // ---- K3 VH
  {
    const holdRun = (own, lastT) => { const g = createVoiceHold(); run(g, RING); for (const t of own) tk(g, t, V(-45)); const out = []; for (let t = own[own.length - 1] + 250; t <= lastT; t += 250) out.push([t, tk(g, t, {})]); return out; };
    const until = (r) => { let u = null; for (const [t, x] of r) { if (x) u = t; else break; } return u; };
    const r1 = holdRun([4000], 6000), r3 = holdRun([4000, 4250, 4500], 9000), r6 = holdRun([4000, 4250, 4500, 4750, 5000, 5250], 12000);
    check("K3: one own-voice tick holds 1 s (through 5000 ms, not 5250)", until(r1) === 5000, `${until(r1)}`);
    check("K3: three own-voice ticks hold 3 s (through 7500 ms, not 7750)", until(r3) === 7500, `${until(r3)}`);
    check("K3: six own-voice ticks hold the 5 s cap (through 10250 ms, not 10500)", until(r6) === 10250, `${until(r6)}`);
    const g = createVoiceHold(); run(g, RING); tk(g, 4000, V(-45)); run(g, room(4250, 19)); // to 8750
    const a = createVoiceHold(); run(a, RING); tk(a, 4000, V(-45)); run(a, room(4250, 18)); // to 8500
    const b9000 = tk(g, 9000, V(-45)), r = [9250, 9500, 9750, 10000, 10250].map((t) => tk(g, t, {}));
    const b8750 = tk(a, 8750, V(-45)), s = [9000, 9250, 9500, 9750, 10000, 10250, 10500, 10750, 11000].map((t) => tk(a, t, {}));
    check("K3: the evidence window is the last 5 s (an own tick exactly 5 s earlier no longer counts)",
      b9000 && eq(r, [true, true, true, true, false]) && b8750 && eq(s, [true, true, true, true, true, true, true, true, false]), `${show(r)} ${show(s)}`);
    const c = createVoiceHold(); run(c, RING); tk(c, 4000, V(-45));
    const nul = tk(c, 4250, { intensity: null });
    check("K3: null intensity ends the hold (reset)", !nul && !tk(c, 4500, {}));
  }

  // ---- K4 VHR: 8 loud shown ticks (-40) set the own-loudness reference
  {
    const LOUD = Array.from({ length: 8 }, (_, i) => [4000 + 250 * i, V(-40)]);
    const g = createVoiceHoldRef();
    const got = run(g, [...RING, ...LOUD, [6000, {}], [6250, {}], [6500, {}], [6750, {}], [7000, {}]]);
    check("K4: own only once 8 loud ticks are in (the 8th, current one included), then K3's hold (1 tick: 1 s)",
      eq(got.slice(16, 23), Array(7).fill(false)) && eq(got.slice(23), [true, true, true, true, true, false]), show(got.slice(16)));
    const probe = (x) => { const h = createVoiceHoldRef(); run(h, [...RING, ...LOUD, ...room(6000, 28)]); return [tk(h, 13000, V(x)), tk(h, 13250, {})]; };
    check("K4: within 6 dB of the reference (-46 dBFS own, -47 not)", eq(probe(-46), [true, true]) && eq(probe(-47), [false, false]), `${show(probe(-46))} ${show(probe(-47))}`);
    const old = createVoiceHoldRef(); run(old, [...RING, ...LOUD, ...room(6000, 240)]); // to 65750
    check("K4: the reference counts the last 60 s only (8 loud ticks 60.25 s ago no longer make one)", tk(old, 66000, V(-45)) === false && tk(old, 66250, {}) === false);
    const k3 = createVoiceHold(); run(k3, [...RING, ...LOUD.slice(0, 1)]);
    check("K4 vs K3: the same first loud tick is own for K3 (no reference needed)", tk(k3, 4250, {}) === true);
  }

  // ---- K5 QP
  {
    const f = createQuietPauseHold();
    const seq = [[0, V()], [250, V()], [500, V()],
      [750, { pitchHolding: true, intensity: -45 }], // quiet (<= -38) with the hook's hold: support
      [1000, { intensity: -45 }],                     // the second quiet tick in a row: support
      [1250, { intensity: -32 }],                     // one loud tick: bridged
      [1500, { intensity: -45 }],                     // quiet, but the tick before was loud: bridge only
      [1750, { intensity: -45 }],                     // two quiet in a row: support again
      [2000, { intensity: -32 }], [2250, { intensity: -32 }], // two loud: bridged, then
      [2500, { intensity: -45 }],                     // released for one tick
      [2750, { intensity: -45 }],                     // re-engaged
      ...room(3000, 10, { intensity: -45 }),          // to 5250
      [5500, { intensity: -45 }],                     // 5000 ms after the last shown voice: still
      [5750, { intensity: -45 }]];                    // > 5 s: never
    const got = run(f, seq);
    const want = [false, false, false, true, true, true, true, true, true, true, false, true, ...Array(10).fill(true), true, false];
    check("K5: support, bridge, release after two loud ticks, re-engage, 5 s cap", eq(got, want), `${show(got)} vs ${show(want)}`);
    check("K5: -38 dBFS is 8 dB below a -30 voice (support); -37.9 is not quiet",
      (() => { const g = createQuietPauseHold(); tk(g, 0, V()); return tk(g, 250, { pitchHolding: true, intensity: -38 }); })()
      && !(() => { const g = createQuietPauseHold(); tk(g, 0, V()); return tk(g, 250, { pitchHolding: true, intensity: -37.9 }); })());
    // 8 shown ticks at -30 (0–1750 ms), 6 at -20 (2000–3250): the last 2 s of
    // shown voice (from 1250 ms) are 3 x -30 + 6 x -20, median -20 (all 14: -30)
    const w = (x) => { const g = createQuietPauseHold(); run(g, Array.from({ length: 14 }, (_, i) => [250 * i, V(i < 8 ? -30 : -20)])); return tk(g, 3500, { pitchHolding: true, intensity: x }); };
    check("K5: the voice level is the median of the last 2 s of shown voice (-29 quiet against -20, -27 not)", w(-29) === true && w(-27) === false);
    const s = createQuietPauseHold(); tk(s, 0, V());
    check("K5: shown-voice ticks are never support (a quiet voiced tick)", tk(s, 250, V(-60)) === false && tk(s, 500, V(-60)) === false);
    const n = createQuietPauseHold(); tk(n, 0, V()); tk(n, 250, { pitchHolding: true, intensity: -45 });
    check("K5: null intensity resets", tk(n, 300, { intensity: null }) === false && tk(n, 500, { pitchHolding: true, intensity: -45 }) === false);
  }

  // ---- every candidate: the row differs from the plain rule only where it says idle,
  // never shows "warming", never touches the pitch row (random tick sequences)
  {
    let seed = 20261101;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const snaps = [SNAP(), SNAP({ verdict: "pause" }), SNAP({ verdict: "sustained" }), SNAP({ voicedS: 1.2, fill: 0.2 }), SNAP({ fill: 0.5, voicedS: 3 }),
      SNAP({ sinceResumeS: 1 }), SNAP({ u: null }), SNAP({ narrowband: { decided: false, on: false } }), SNAP({ narrowband: { decided: true, on: true } }), null];
    for (const [name, make] of Object.entries(RESONANCE_HOLD_CANDIDATES)) {
      const f = make();
      let n = 0, held = 0, bad = [];
      let fl = { pitchVoiced: false, pitchHolding: false }, sn = SNAP();
      for (let i = 0; i < 6000; i++) {
        const t = 250 * i + Math.floor(rnd() * 150);
        if (rnd() < 0.15) fl = { pitchVoiced: rnd() < 0.5, pitchHolding: rnd() < 0.5 };
        if (rnd() < 0.02) sn = pick(snaps);
        const r = rnd();
        const intensity = r < 0.01 ? null : r < 0.015 ? NaN : r < 0.03 ? -Infinity : -100 + 80 * rnd();
        const inp = { ...fl, pitchLevel: fl.pitchVoiced && rnd() < 0.9 ? 180 : null, intensity, snap: sn, workerStatus: rnd() < 0.95 ? "ready" : pick(["loading", "error", "overloaded"]), hasRef: rnd() < 0.98 };
        const flag = f.tick(inp, t);
        const a = cueRowStates(inp), b = cueRowStates({ ...inp, resonanceHold: flag });
        n++; if (b.resonance !== a.resonance) held++;
        if (a.pitch !== b.pitch || (a.resonance !== "idle" && b.resonance !== a.resonance) || (b.resonance !== a.resonance && b.resonance === "warming")
          || rowValue("resonance", { snap: sn }) !== rowValue("resonance", { snap: sn })) bad.push(i);
      }
      check(`${name}: on ${n} random ticks the row differs only where the plain rule says idle, never 'warming', the pitch row unchanged (${held} held)`, bad.length === 0 && held > 0, `first bad tick ${bad[0]}`);
    }
  }

  // ---- the strip over time (the CueStrip tick: candidate, states, trails)
  {
    const stripK = (make, frames) => {
      const f = make ? make() : null;
      const tr = { pitch: createTrail(), resonance: createTrail(RESONANCE_TRAIL.n, RESONANCE_TRAIL.everyTicks) };
      return frames.map((fr, i) => {
        const t = i * 250;
        const inp = { pitchLevel: fr.pitchVoiced || fr.pitchHolding ? 180 : null, workerStatus: "ready", hasRef: true, intensity: -30, pitchVoiced: false, pitchHolding: false, ...fr, snap: SNAP(fr.snap ?? {}) };
        const resonanceHold = f ? f.tick(inp, t) : false;
        const st = cueRowStates({ ...inp, resonanceHold });
        return { st, rTrail: tr.resonance.tick(st.resonance, rowValue("resonance", inp)).length, pTrail: tr.pitch.tick(st.pitch, rowValue("pitch", inp)).length };
      });
    };
    const rep = (n, fr) => Array.from({ length: n }, () => ({ ...fr }));
    // speech with short quiet pauses (the hook's own hold), so the floor ring hears the room
    const talk = (secs) => Array.from({ length: secs / 4 }, () => [...rep(4, { pitchHolding: true, intensity: -60 }), ...rep(12, { pitchVoiced: true, intensity: -30 })]).flat();
    const quietP = (n) => rep(n, { pitchHolding: true, intensity: -60 });
    const noisyP = (n) => [...rep(3, { pitchHolding: true, intensity: -45 }), ...rep(n - 3, { intensity: -45 })];
    const speech = (n) => rep(n, { pitchVoiced: true, intensity: -30 });
    const names = Object.keys(RESONANCE_HOLD_CANDIDATES);
    const S = (fr) => ({ BASE: stripK(null, fr), ...Object.fromEntries(names.map((k) => [k, stripK(RESONANCE_HOLD_CANDIDATES[k], fr)])) });
    {
      const fr = [...talk(20), ...quietP(6), { intensity: -35 }, ...speech(8)];
      const A = S(fr), b = 86; // the blink tick
      check("onset blink after a quiet pause: BASE goes idle and clears the trail", A.BASE[b].st.resonance === "idle" && A.BASE[b].rTrail === 0 && A.BASE[b - 1].rTrail >= 5);
      for (const k of names) check(`onset blink: ${k} holds the blink tick and keeps the trail`, A[k][b].st.resonance === "holding" && A[k][b].rTrail === A[k][b - 1].rTrail, `${A[k][b].st.resonance} ${A[k][b].rTrail}`);
    }
    {
      const fr = [...talk(20), ...noisyP(12), ...speech(8)];
      const A = S(fr);
      const kept = (k) => A[k].slice(80, 92).every((x) => x.st.resonance === "holding") && A[k][91].rTrail === A[k][79].rTrail;
      check("noisy 3 s pause: BASE holds its own ~0.75 s, then idle clears the trail", A.BASE[83].st.resonance === "idle" && A.BASE[91].rTrail === 0);
      check("noisy 3 s pause: K1 (quiet holds only) as BASE", A.K1[83].st.resonance === "idle" && A.K1[91].rTrail === 0);
      check("noisy 3 s pause: K2 bridges two ticks after BASE's hold, then idle", A.K2[83].st.resonance === "holding" && A.K2[84].st.resonance === "holding" && A.K2[85].st.resonance === "idle" && A.K2[91].rTrail === 0);
      for (const k of ["K3", "K4", "K5"]) check(`noisy 3 s pause: ${k} holds throughout and keeps the trail`, kept(k), A[k].slice(80, 92).map((x) => x.st.resonance[0]).join(""));
    }
    {
      const fr = [...talk(20), ...noisyP(40)];
      const A = S(fr); // last shown voice at tick 79 (19.75 s)
      for (const k of names) check(`expiry: ${k} is idle with an empty trail once the hold ends (from 25.0 s on)`, A[k].slice(100).every((x) => x.st.resonance === "idle" && x.rTrail === 0));
    }
    {
      const fr = [...talk(20), ...quietP(2), { intensity: -35, snap: { voicedS: 1.2, fill: 0.2 } }, ...rep(4, { intensity: -45, snap: { voicedS: 1.2, fill: 0.2 } })];
      const A = S(fr);
      for (const k of names) check(`never 'keep talking…': ${k} with no position stays idle`, A[k].every((x) => x.st.resonance !== "warming"));
    }
    {
      const nb = { narrowband: { decided: true, on: true, n: 400, f: -45 } };
      for (const k of names) {
        const A = stripK(RESONANCE_HOLD_CANDIDATES[k], [...talk(20), { pitchVoiced: true, intensity: -30, snap: nb }, ...speech(2)]);
        const B = stripK(RESONANCE_HOLD_CANDIDATES[k], [...talk(20), { pitchVoiced: true, intensity: -30, snap: { verdict: "sustained" } }, ...speech(2)]);
        const C = stripK(RESONANCE_HOLD_CANDIDATES[k], [...talk(20), ...quietP(1), { intensity: -35, snap: { verdict: "sustained" } }, ...speech(2)]);
        check(`${k}: changes into 'phone-quality audio' / 'needs running speech' still clear the trail (held or not)`,
          A[80].st.resonance === "narrowband" && A[80].rTrail === 0 && B[80].st.resonance === "sustained" && B[80].rTrail === 0
          && C[81].st.resonance === "sustained" && C[81].rTrail === 0, `${C[81].st.resonance} ${C[81].rTrail}`);
      }
    }
    {
      const fr = [...talk(20), ...quietP(6), { intensity: -35 }, ...speech(8), ...noisyP(30), ...speech(4)];
      const A = S(fr);
      for (const k of names) check(`${k}: the pitch row and its trail are BASE's at every tick`, A[k].every((x, i) => x.st.pitch === A.BASE[i].st.pitch && x.pTrail === A.BASE[i].pTrail));
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
