// training-direction-test.js — the training-direction setting and the
// targets computed from it (src/utils/trainingDirection.js), plus
// direction-aware session stats (src/utils/sessionStats.js).
//
//   node tests/data/training-direction-test.js

import {
  TRAINING_DIRECTIONS,
  PITCH_TARGETS,
  F2_TARGETS,
  isTrainingDirection,
  directionLabel,
  pitchTargetFor,
  f2TargetFor,
  weightTargetFor,
  inTarget,
  bandForDisplay,
  formatTarget,
  directionAt,
  appendDirection,
  directionsUsed,
  loadTrainingDirection,
  saveTrainingDirection,
} from "../../src/utils/trainingDirection.js";
import { computeSummaryStats } from "../../src/utils/sessionStats.js";
import { PITCH_DISPLAY_RANGE, F2_DISPLAY_RANGE } from "../../src/utils/constants.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// 1. The four choices, in the order the question lists them.
{
  check("four directions", TRAINING_DIRECTIONS.length === 4);
  check("ids in order", TRAINING_DIRECTIONS.map((d) => d.id).join() === "feminine,masculine,androgynous,exploring");
  check("labels", directionLabel("feminine") === "More feminine" && directionLabel("masculine") === "More masculine"
    && directionLabel("androgynous") === "Androgynous or in between" && directionLabel("exploring") === "Just exploring");
  check("validation", isTrainingDirection("masculine") && !isTrainingDirection(null) && !isTrainingDirection("female")
    && !isTrainingDirection(undefined) && !isTrainingDirection(""));
  check("unknown direction has no label", directionLabel("x") === null);
}

// 2. Pitch targets: literature bands, every direction except exploring.
{
  const f = pitchTargetFor("feminine"), m = pitchTargetFor("masculine"), a = pitchTargetFor("androgynous");
  check("feminine 165–255 Hz", f.low === 165 && f.high === 255);
  check("masculine 85–155 Hz", m.low === 85 && m.high === 155);
  check("androgynous 145–175 Hz", a.low === 145 && a.high === 175);
  check("exploring: no target", pitchTargetFor("exploring") === null);
  check("not chosen: no target", pitchTargetFor(null) === null);
  check("androgynous zone overlaps both typical ranges", a.low < m.high && a.high > f.low);
  check("all bands inside the display range", Object.values(PITCH_TARGETS).every(
    (t) => t.low >= PITCH_DISPLAY_RANGE.low && t.high <= PITCH_DISPLAY_RANGE.high));
  check("150 Hz: masculine yes, feminine no, androgynous yes",
    inTarget(150, m) === true && inTarget(150, f) === false && inTarget(150, a) === true);
  check("200 Hz: feminine only", inTarget(200, f) && !inTarget(200, m) && !inTarget(200, a));
  check("band edges inclusive", inTarget(165, f) && inTarget(255, f) && inTarget(85, m) && inTarget(155, m));
  check("no target -> null (neutral), whatever the value", inTarget(200, null) === null);
  check("no value -> null", inTarget(null, f) === null && inTarget(NaN, f) === null);
}

// 3. F2 targets: open-ended bounds.
{
  check("feminine F2 >= 1375", inTarget(1375, f2TargetFor("feminine")) && inTarget(3000, f2TargetFor("feminine"))
    && !inTarget(1300, f2TargetFor("feminine")));
  check("masculine F2 <= 1575", inTarget(900, f2TargetFor("masculine")) && inTarget(1575, f2TargetFor("masculine"))
    && !inTarget(1600, f2TargetFor("masculine")));
  check("androgynous F2 1375–1575", inTarget(1500, f2TargetFor("androgynous")) && !inTarget(1300, f2TargetFor("androgynous"))
    && !inTarget(1700, f2TargetFor("androgynous")));
  check("exploring: no F2 target", f2TargetFor("exploring") === null);
  const fb = bandForDisplay(F2_TARGETS.feminine, F2_DISPLAY_RANGE);
  check("open top drawn to the axis top", fb.low === 1375 && fb.high === F2_DISPLAY_RANGE.high);
  const mb = bandForDisplay(F2_TARGETS.masculine, F2_DISPLAY_RANGE);
  check("open bottom drawn from the axis bottom", mb.low === F2_DISPLAY_RANGE.low && mb.high === 1575);
  check("no target -> no band", bandForDisplay(null, F2_DISPLAY_RANGE) === null);
  check("band clipped to the axis", bandForDisplay({ low: 50, high: 120 }, PITCH_DISPLAY_RANGE).low === 75);
  check("formatTarget", formatTarget(PITCH_TARGETS.feminine) === "165–255 Hz"
    && formatTarget(F2_TARGETS.feminine) === "≥ 1375 Hz" && formatTarget(F2_TARGETS.masculine) === "≤ 1575 Hz"
    && formatTarget(null) === null);
}

// 4. Vocal-weight side.
{
  check("weight: feminine -> lighter, masculine -> heavier",
    weightTargetFor("feminine") === "lighter" && weightTargetFor("masculine") === "heavier");
  check("weight: androgynous / exploring / none -> no target",
    weightTargetFor("androgynous") === null && weightTargetFor("exploring") === null && weightTargetFor(null) === null);
}

// 5. Direction log.
{
  let log = appendDirection([], 0, "feminine");
  log = appendDirection(log, 5000, "feminine");          // repeat: ignored
  check("repeat direction not logged", log.length === 1);
  log = appendDirection(log, 12000.4, "exploring");
  log = appendDirection(log, 20000, "bogus");            // invalid: ignored
  check("change logged, invalid ignored", log.length === 2 && log[1].atMs === 12000);
  check("directionAt before/at/after the change", directionAt(log, 0) === "feminine"
    && directionAt(log, 11999) === "feminine" && directionAt(log, 12000) === "exploring" && directionAt(log, 99999) === "exploring");
  check("directionAt with no log -> null", directionAt(null, 10) === null && directionAt([], 10) === null);
  check("directionsUsed in first-use order",
    directionsUsed(appendDirection(appendDirection(log, 30000, "feminine"), 40000, "masculine")).join() === "feminine,exploring,masculine");
  check("starting with no direction -> empty log", appendDirection([], 0, null).length === 0);
}

// 6. Persistence through a Dexie-like settings table.
{
  const rows = new Map();
  const table = {
    get: async (id) => rows.get(id),
    update: async (id, patch) => { if (!rows.has(id)) return 0; rows.set(id, { ...rows.get(id), ...patch }); return 1; },
    put: async (row) => { rows.set(row.id, row); return row.id; },
  };
  check("nothing saved -> null", (await loadTrainingDirection(table)) === null);
  check("save creates the row", (await saveTrainingDirection(table, "androgynous")) === true
    && rows.get("default").trainingDirection === "androgynous");
  rows.set("default", { ...rows.get("default"), recordAudio: true });
  await saveTrainingDirection(table, "masculine");
  check("save updates in place, keeps other settings",
    rows.get("default").trainingDirection === "masculine" && rows.get("default").recordAudio === true);
  check("load returns the last choice", (await loadTrainingDirection(table)) === "masculine");
  check("invalid choice not saved", (await saveTrainingDirection(table, "female")) === false
    && rows.get("default").trainingDirection === "masculine");
  rows.set("default", { id: "default", trainingDirection: "something-old" });
  check("unknown stored value -> null (asks without preselection)", (await loadTrainingDirection(table)) === null);
  const broken = { get: async () => { throw new Error("blocked"); }, update: async () => { throw new Error("blocked"); }, put: async () => {} };
  check("storage blocked: load -> null", (await loadTrainingDirection(broken)) === null);
  check("storage blocked: save -> false, no throw", (await saveTrainingDirection(broken, "feminine")) === false);
}

// 7. Session stats against the direction(s) in effect.
{
  const fr = (f0, f2, timestampMs) => ({ voiced: true, f0, f2, f1: 500, f3: 2700, intensity: -30, spectralTilt: 5, hnr: 15, timestampMs });
  const frames = [fr(120, 1300, 0), fr(150, 1500, 100), fr(170, 1500, 200), fr(200, 1700, 300), fr(240, 2000, 400)];
  const pct = (dir) => computeSummaryStats(frames, { directionLog: [{ atMs: 0, direction: dir }] });
  const f = pct("feminine"), m = pct("masculine"), a = pct("androgynous"), x = pct("exploring");
  check("feminine: 3 of 5 in 165–255 Hz", f.pctTimeInPitchTarget === 60, `${f.pctTimeInPitchTarget}`);
  check("masculine: 2 of 5 in 85–155 Hz", m.pctTimeInPitchTarget === 40, `${m.pctTimeInPitchTarget}`);
  check("androgynous: 2 of 5 in 145–175 Hz", a.pctTimeInPitchTarget === 40, `${a.pctTimeInPitchTarget}`);
  check("exploring: no in-target figures", x.pctTimeInPitchTarget === null && x.pctTimeInResonanceTarget === null);
  check("F2 feminine >= 1375: 4 of 5", f.pctTimeInResonanceTarget === 80, `${f.pctTimeInResonanceTarget}`);
  check("F2 masculine <= 1575: 3 of 5", m.pctTimeInResonanceTarget === 60, `${m.pctTimeInResonanceTarget}`);
  check("F2 androgynous 1375–1575: 2 of 5", a.pctTimeInResonanceTarget === 40, `${a.pctTimeInResonanceTarget}`);
  const mixed = computeSummaryStats(frames, { directionLog: [{ atMs: 0, direction: "masculine" }, { atMs: 250, direction: "feminine" }] });
  // 120,150 -> masculine in; 170 -> masculine out; 200,240 -> feminine in = 4/5
  check("changed mid-session: each frame vs its own target", mixed.pctTimeInPitchTarget === 80, `${mixed.pctTimeInPitchTarget}`);
  const partly = computeSummaryStats(frames, { directionLog: [{ atMs: 0, direction: "exploring" }, { atMs: 250, direction: "feminine" }] });
  check("exploring frames don't count either way", partly.pctTimeInPitchTarget === 100, `${partly.pctTimeInPitchTarget}`);
  const legacy = computeSummaryStats(frames);
  check("no direction log -> no assumed target", legacy.pctTimeInPitchTarget === null && legacy.pctTimeInResonanceTarget === null);
  check("other stats unaffected by direction", legacy.medianF0 === f.medianF0 && legacy.avgF2 === m.avgF2);
}

console.log(failures === 0 ? "\nAll training-direction checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
