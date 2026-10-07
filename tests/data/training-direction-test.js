// training-direction-test.js — the training-direction setting and the
// targets computed from it (src/utils/trainingDirection.js), the pitch
// level they are judged on (src/utils/pitchLevel.js), and direction-aware
// session stats (src/utils/sessionStats.js).
//
//   node tests/data/training-direction-test.js

import {
  TRAINING_DIRECTIONS,
  PITCH_TARGETS,
  isTrainingDirection,
  directionLabel,
  pitchTargetFor,
  pitchStatus,
  isOnTarget,
  bandForDisplay,
  formatTarget,
  formatOnTarget,
  directionAt,
  appendDirection,
  directionSequence,
  loadTrainingDirection,
  saveTrainingDirection,
} from "../../src/utils/trainingDirection.js";
import * as TD from "../../src/utils/trainingDirection.js";
import { createPitchLevel, pitchLevels, pitchLevelAt, PITCH_LEVEL_WINDOW_MS } from "../../src/utils/pitchLevel.js";
import { computeSummaryStats } from "../../src/utils/sessionStats.js";
import { PITCH_DISPLAY_RANGE } from "../../src/utils/constants.js";

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
  check("feminine 165–255 Hz, travelling up", f.low === 165 && f.high === 255 && f.toward === "up");
  check("masculine 85–155 Hz, travelling down", m.low === 85 && m.high === 155 && m.toward === "down");
  check("androgynous 145–175 Hz, a zone", a.low === 145 && a.high === 175 && a.toward === null);
  check("exploring: no target", pitchTargetFor("exploring") === null);
  check("not chosen: no target", pitchTargetFor(null) === null);
  check("androgynous zone overlaps both typical ranges", a.low < m.high && a.high > f.low);
  check("all bands inside the display range", Object.values(PITCH_TARGETS).every(
    (t) => t.low >= PITCH_DISPLAY_RANGE.low && t.high <= PITCH_DISPLAY_RANGE.high));
  check("150 Hz: masculine in, feminine out, androgynous in",
    pitchStatus(150, m) === "in" && pitchStatus(150, f) === "out" && pitchStatus(150, a) === "in");
  check("200 Hz: feminine in, masculine out, androgynous out",
    pitchStatus(200, f) === "in" && pitchStatus(200, m) === "out" && pitchStatus(200, a) === "out");
  check("band edges inclusive", pitchStatus(165, f) === "in" && pitchStatus(255, f) === "in"
    && pitchStatus(85, m) === "in" && pitchStatus(155, m) === "in");
  check("past the band in the direction of travel = beyond (not off target), both directions alike",
    pitchStatus(300, f) === "beyond" && pitchStatus(78, m) === "beyond");
  check("androgynous: both sides are off target", pitchStatus(120, a) === "out" && pitchStatus(220, a) === "out");
  check("on target = in or beyond", isOnTarget("in") && isOnTarget("beyond") && !isOnTarget("out") && !isOnTarget(null));
  check("no target -> null (neutral), whatever the value", pitchStatus(200, null) === null);
  check("no value -> null", pitchStatus(null, f) === null && pitchStatus(NaN, f) === null);
  check("band clipped to the axis", bandForDisplay({ low: 50, high: 120 }, PITCH_DISPLAY_RANGE).low === 75);
  check("no target -> no band", bandForDisplay(null, PITCH_DISPLAY_RANGE) === null);
  check("formatTarget", formatTarget(PITCH_TARGETS.feminine) === "165–255 Hz" && formatTarget(null) === null);
  check("formatOnTarget: open in the direction of travel", formatOnTarget(PITCH_TARGETS.feminine) === "≥ 165 Hz"
    && formatOnTarget(PITCH_TARGETS.masculine) === "≤ 155 Hz" && formatOnTarget(PITCH_TARGETS.androgynous) === "145–175 Hz");
}

// 3. No resonance (F2) or vocal-weight target in any direction (both are
//    neutral readouts — measurements/training-direction-targets-2026-10-07.md).
{
  check("no F2 / weight target helpers exported", !("f2TargetFor" in TD) && !("weightTargetFor" in TD)
    && !("F2_TARGETS" in TD) && !("WEIGHT_TARGETS" in TD));
}

// 4. Pitch level: running median of the last 1.5 s of voiced pitch.
{
  check("window 1.5 s", PITCH_LEVEL_WINDOW_MS === 1500);
  const lv = createPitchLevel();
  check("first voiced frame = its own value", lv.push(0, 200) === 200);
  check("unvoiced frame -> null", lv.push(25, null) === null);
  check("median of the window", lv.push(50, 100) === 150 && lv.push(75, 300) === 200);
  check("values older than the window drop out", lv.push(1600, 120) === 120, "only 120 is within 1.5 s");
  const pts = [{ time: 0, pitch: 100 }, { time: 500, pitch: null }, { time: 1000, pitch: 200 }, { time: 1200, pitch: 210 }];
  check("pitchLevelAt: median of voiced points in (t - 1.5 s, t]", pitchLevelAt(pts, 1200) === 200);
  check("pitchLevelAt ignores later points", pitchLevelAt(pts, 1000) === 150);
  check("pitchLevelAt: nothing voiced -> null", pitchLevelAt(pts, 9000) === null);
  check("pitchLevels: one per point", pitchLevels(pts, (p) => p.time, (p) => p.pitch).join() === "100,,150,200");
  // Intonation: a voice whose average is the androgynous zone's centre,
  // moving +-3 semitones once a second. Per frame it is in the 3.3 st zone
  // well under half the time; its level stays in the zone.
  const a = pitchTargetFor("androgynous");
  const fr = [];
  for (let t = 0; t < 6000; t += 25) fr.push({ time: t, pitch: 159 * 2 ** ((3 * Math.sin(2 * Math.PI * t / 1000)) / 12) });
  const perFrame = fr.filter((p) => pitchStatus(p.pitch, a) === "in").length / fr.length;
  const levels = pitchLevels(fr, (p) => p.time, (p) => p.pitch);
  const byLevel = levels.filter((l) => pitchStatus(l, a) === "in").length / levels.length;
  check("intonation around the zone centre: per frame mostly out, level in", perFrame < 0.6 && byLevel > 0.9,
    `per frame ${(100 * perFrame).toFixed(0)} %, level ${(100 * byLevel).toFixed(0)} %`);
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
  check("directionSequence keeps returns to an earlier direction",
    directionSequence(appendDirection(appendDirection(log, 30000, "feminine"), 40000, "masculine")).join()
      === "feminine,exploring,feminine,masculine");
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

// 7. Session stats against the direction(s) in effect, on the pitch level.
{
  // Frames 2 s apart: each frame's level is its own value.
  const fr = (f0, timestampMs) => ({ voiced: true, f0, f2: 1500, f1: 500, f3: 2700, intensity: -30, spectralTilt: 5, hnr: 15, timestampMs });
  const f0s = [120, 150, 170, 200, 240, 300, 80];
  const frames = f0s.map((f0, i) => fr(f0, i * 2000));
  const pct = (dir) => computeSummaryStats(frames, { directionLog: [{ atMs: 0, direction: dir }] });
  const f = pct("feminine"), m = pct("masculine"), a = pct("androgynous"), x = pct("exploring");
  check("feminine: 170/200/240 in + 300 beyond = 4 of 7", f.pctTimeInPitchTarget === 57, `${f.pctTimeInPitchTarget}`);
  check("masculine: 120/150 in + 80 beyond = 3 of 7", m.pctTimeInPitchTarget === 43, `${m.pctTimeInPitchTarget}`);
  check("androgynous: 150/170 = 2 of 7", a.pctTimeInPitchTarget === 29, `${a.pctTimeInPitchTarget}`);
  check("single direction: the figure covers all voiced time", f.pctVoicedWithPitchTarget === 100);
  check("exploring: no on-target figure, 0 % of voiced time had a target",
    x.pctTimeInPitchTarget === null && x.pctVoicedWithPitchTarget === 0);
  check("no resonance figure for new sessions", f.pctTimeInResonanceTarget === null && m.pctTimeInResonanceTarget === null);
  const mixed = computeSummaryStats(frames, { directionLog: [{ atMs: 0, direction: "masculine" }, { atMs: 5000, direction: "feminine" }] });
  // 120,150 -> masculine in; 170 (t=4000) -> masculine out; 200,240,300 -> feminine on; 80 -> feminine out = 5/7
  check("changed mid-session: each frame vs its own target", mixed.pctTimeInPitchTarget === 71, `${mixed.pctTimeInPitchTarget}`);
  const partly = computeSummaryStats(frames, { directionLog: [{ atMs: 0, direction: "exploring" }, { atMs: 5000, direction: "feminine" }] });
  check("exploring frames don't count either way", partly.pctTimeInPitchTarget === 75, `${partly.pctTimeInPitchTarget}`);
  check("...and the share of voiced time with a target says so", partly.pctVoicedWithPitchTarget === 57, `${partly.pctVoicedWithPitchTarget}`);
  const legacy = computeSummaryStats(frames);
  check("no direction log -> no assumed target", legacy.pctTimeInPitchTarget === null
    && legacy.pctVoicedWithPitchTarget === null && legacy.pctTimeInResonanceTarget === null);
  check("other stats unaffected by direction", legacy.medianF0 === f.medianF0 && legacy.avgF2 === m.avgF2);
  // Intonation, 25 ms frames: a feminine-target voice averaging 200 Hz with
  // peaks above 255 Hz and dips under 165 Hz is on target throughout.
  const tone = [];
  for (let t = 0; t < 8000; t += 25) tone.push(fr(200 * 2 ** ((5 * Math.sin(2 * Math.PI * t / 1300)) / 12), t));
  const s = computeSummaryStats(tone, { directionLog: [{ atMs: 0, direction: "feminine" }] });
  check("intonation peaks and dips don't count against the level", s.pctTimeInPitchTarget >= 95, `${s.pctTimeInPitchTarget}`);
  const shuffled = computeSummaryStats([...frames].reverse(), { directionLog: [{ atMs: 0, direction: "feminine" }] });
  check("frame order doesn't matter (sorted by time)", shuffled.pctTimeInPitchTarget === f.pctTimeInPitchTarget);
}

console.log(failures === 0 ? "\nAll training-direction checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
