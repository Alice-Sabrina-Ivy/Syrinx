// cue-strip-model-test.js — src/components/cueStripModel.js: the Dashboard
// cue strip's axes, bands, direction highlight (the same in every direction),
// dot colours (only pitch judges), trail, row states and the resonance row's
// hold through pauses (2026-10-28).
//
//   node tests/audio/cue-strip-model-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  axisPos,
  bandsFor,
  createResonanceHold,
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
