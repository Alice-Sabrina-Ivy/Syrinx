// results-test.js — what the guided exercises measure and save (src/exercises/results.js,
// src/exercises/store.js). docs/guided-exercises-design.md §8.
//   - "Count on your target": the median pitch LEVEL and the in-band share follow the
//     session statistics' own rule (computeSummaryStats on the same frames); no band for
//     "Just exploring" or no goal; under 3 s of voice nothing is reported; unvoiced and
//     silence-gated frames never count.
//   - The frame log keeps the frames in the session-statistics shape.
//   - Saved rows are sanitised (direction, feel, sessionId); store helpers against a fake
//     Dexie table: save, update, last done per lesson, recent rows; a blocked table never throws.
//
//   node tests/exercises/results-test.js
import { countResult, createFrameLog, resultRow, MIN_VOICED_S, isImportableResult, resultKey } from "../../src/exercises/results.js";
import { saveResult, updateResult, lastDoneByLesson, recentResults } from "../../src/exercises/store.js";
import { computeSummaryStats } from "../../src/utils/sessionStats.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

// frames at 25 ms: `spec` = [[seconds, hz | null], …] in order
function frames(spec) {
  const out = [];
  let t = 0;
  for (const [s, hz] of spec) {
    for (let i = 0; i < Math.round(s / 0.025); i++) {
      out.push({ timestampMs: t, voiced: hz != null, f0: hz });
      t += 25;
    }
  }
  return out;
}

console.log("count result");
{
  const f = frames([[3, 180], [1, null], [2, 140]]);
  const r = countResult(f, "feminine");
  const stats = computeSummaryStats(f, { directionLog: [{ atMs: 0, direction: "feminine" }] });
  check("in-band share = the session statistics' figure on the same frames", r.inBandPct === stats.pctTimeInPitchTarget, `${r.inBandPct} vs ${stats.pctTimeInPitchTarget}`);
  check("…3 s at 180 Hz in the 165–255 band, 2 s at 140 below it: about 65 % (the level takes ~0.75 s to follow)", r.inBandPct >= 60 && r.inBandPct <= 68, String(r.inBandPct));
  check("median level is the level (180 Hz, the larger part)", r.levelHz === 180, String(r.levelHz));
  check("voiced time from voiced frames only", r.voicedS === 5, String(r.voicedS));
}
{
  const f = frames([[4, 120]]);
  check("masculine band 85–155: all in", countResult(f, "masculine").inBandPct === 100);
  check("androgynous band 145–175: none in", countResult(f, "androgynous").inBandPct === 0);
  check("exploring: a level, no band share", countResult(f, "exploring").inBandPct === null && countResult(f, "exploring").levelHz === 120);
  check("no goal: a level, no band share", countResult(f, null).inBandPct === null);
}
check(`under ${MIN_VOICED_S} s of voice: nothing reported`, countResult(frames([[2.9, 200], [5, null]]), "feminine") === null);
check("no frames: nothing reported", countResult([], "feminine") === null);
{
  // the level is a 1.5 s running median: a short excursion doesn't move it
  const f = frames([[2, 200], [0.3, 400], [2, 200]]);
  check("a 0.3 s excursion does not change the level", countResult(f, "feminine").levelHz === 200);
}

console.log("\nframe log");
{
  const log = createFrameLog();
  log.push({ voiced: true, f0: 200 }, 10);
  log.push({ voiced: true, f0: null }, 35);   // voiced flag without a pitch: unvoiced
  log.push({ voiced: false, f0: null }, 60);
  log.push({ voiced: true, f0: 210 }, 85);
  check("voiced seconds count frames with a pitch", Math.abs(log.voicedSeconds() - 0.05) < 1e-9);
  check("frames() in the statistics shape", JSON.stringify(log.frames()) === JSON.stringify([
    { timestampMs: 10, voiced: true, f0: 200 }, { timestampMs: 35, voiced: false, f0: null },
    { timestampMs: 60, voiced: false, f0: null }, { timestampMs: 85, voiced: true, f0: 210 }]));
  log.clear();
  check("clear()", log.length === 0 && log.voicedSeconds() === 0);
}

console.log("\nsaved rows");
{
  const r = resultRow({ exerciseId: "P6", startedAt: 1, endedAt: 2, direction: "sideways", sessionId: "x", feel: "great", results: { levelHz: 180 } });
  check("unknown direction / feel / non-numeric sessionId become null", r.direction === null && r.feel === null && r.sessionId === null && r.results.levelHz === 180);
  const r2 = resultRow({ exerciseId: "R3", startedAt: 1, endedAt: 2, direction: "masculine", sessionId: 7, feel: "strained" });
  check("valid fields kept, no results = {}", r2.direction === "masculine" && r2.sessionId === 7 && r2.feel === "strained" && JSON.stringify(r2.results) === "{}");
  check("no audio fields", !Object.keys(r2).some((k) => /audio|pcm|blob/i.test(k)));
  check("importable: string id + numeric startedAt", isImportableResult(r2) && !isImportableResult({ exerciseId: "P6" }) && !isImportableResult({ startedAt: 1 }));
  check("key", resultKey(r2) === "R3@1");
}

console.log("\nstore");
function fakeTable() {
  const rows = new Map();
  let next = 1;
  return {
    rows,
    async add(row) { const id = next++; rows.set(id, { ...row, id }); return id; },
    async update(id, patch) { if (!rows.has(id)) return 0; rows.set(id, { ...rows.get(id), ...patch }); return 1; },
    orderBy() { return { each: async (fn) => { [...rows.values()].sort((a, b) => a.startedAt - b.startedAt).forEach(fn); } }; },
    where() { return { equals: (v) => ({ toArray: async () => [...rows.values()].filter((r) => r.exerciseId === v) }) }; },
  };
}
{
  const t = fakeTable();
  const a = await saveResult(t, { exerciseId: "P6", startedAt: 100, endedAt: 200, direction: "feminine", results: { levelHz: 170 } });
  const b = await saveResult(t, { exerciseId: "P6", startedAt: 300, endedAt: 400, direction: "feminine", results: { levelHz: 175 } });
  await saveResult(t, { exerciseId: "R1", startedAt: 250, endedAt: 260 });
  check("save returns ids", a === 1 && b === 2);
  check("update the feel", (await updateResult(t, b, { feel: "easy" })) === true && t.rows.get(b).feel === "easy");
  const last = await lastDoneByLesson(t);
  check("last done per lesson = the newest startedAt", last.P6 === 300 && last.R1 === 250);
  const recent = await recentResults(t, "P6", 5, b);
  check("recent rows, newest first, the current run left out", recent.length === 1 && recent[0].id === a);
}
{
  const broken = { add: async () => { throw new Error("blocked"); }, update: async () => { throw new Error("blocked"); },
    orderBy: () => { throw new Error("blocked"); }, where: () => { throw new Error("blocked"); } };
  const origError = console.error;
  console.error = () => {};
  const ok = (await saveResult(broken, { exerciseId: "P6", startedAt: 1 })) === null && (await updateResult(broken, 1, {})) === false
    && JSON.stringify(await lastDoneByLesson(broken)) === "{}" && (await recentResults(broken, "P6")).length === 0;
  console.error = origError;
  check("blocked storage: nothing throws (the lesson still runs)", ok);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
