// session-stats-test.js — computeSummaryStats (src/utils/sessionStats.js).
// Plain Node script: prints pass/fail per check, exits non-zero on failure.
//
//   node tests/data/session-stats-test.js

import { computeSummaryStats } from "../../src/utils/sessionStats.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const near = (a, b, tol = 1e-9) => a != null && b != null && Math.abs(a - b) <= tol;

const frame = (f0, extra = {}) => ({
  voiced: f0 !== null, f0, f1: 500, f2: 1800, f3: 2700,
  intensity: -30, spectralTilt: 5, hnr: 15, ...extra,
});

// 1. Stray detector-limit excursions don't define the range.
{
  const frames = [];
  for (let i = 0; i < 980; i++) frames.push(frame(190 + (i % 21))); // 190..210 Hz
  for (let i = 0; i < 10; i++) frames.push(frame(75));              // octave-down strays
  for (let i = 0; i < 10; i++) frames.push(frame(400));             // octave-up strays
  const s = computeSummaryStats(frames);
  check("range ignores 2 % detector-limit strays (low)", s.pitchRangeLow >= 190 && s.pitchRangeLow < 192, `low=${s.pitchRangeLow}`);
  check("range ignores 2 % detector-limit strays (high)", s.pitchRangeHigh > 208 && s.pitchRangeHigh <= 210, `high=${s.pitchRangeHigh}`);
}

// 2. Percentiles on a known uniform set: 101 values 100..300 step 2 →
//    linear-interpolated p5 = 110, p95 = 290.
{
  const frames = [];
  for (let i = 0; i <= 100; i++) frames.push(frame(100 + 2 * i));
  frames.reverse(); // order-independent
  const s = computeSummaryStats(frames);
  check("p5 of uniform 100..300", near(s.pitchRangeLow, 110), `low=${s.pitchRangeLow}`);
  check("p95 of uniform 100..300", near(s.pitchRangeHigh, 290), `high=${s.pitchRangeHigh}`);
  check("range fields are numbers, low <= high", typeof s.pitchRangeLow === "number" && s.pitchRangeLow <= s.pitchRangeHigh);
}

// 3. Edge cases: empty, single voiced frame, all unvoiced.
{
  const empty = computeSummaryStats([]);
  check("empty session → null range", empty.pitchRangeLow === null && empty.pitchRangeHigh === null);
  const one = computeSummaryStats([frame(null), frame(222), frame(null)]);
  check("single voiced frame → low = high = its f0", one.pitchRangeLow === 222 && one.pitchRangeHigh === 222);
  const unvoiced = computeSummaryStats([frame(null), { ...frame(180), voiced: false }]);
  check("unvoiced frames excluded", unvoiced.pitchRangeLow === null && unvoiced.avgF0 === null);
}

// 4. Other stats keep their definitions (mean / median / sample stdev /
//    time-in-target / voiced duration).
{
  const f0s = [150, 170, 200, 260, 300];
  const s = computeSummaryStats([...f0s.map((f) => frame(f)), frame(null)]);
  const mean = f0s.reduce((a, b) => a + b, 0) / f0s.length;
  const sd = Math.sqrt(f0s.reduce((a, v) => a + (v - mean) ** 2, 0) / (f0s.length - 1));
  check("avgF0 unchanged (mean)", near(s.avgF0, mean));
  check("medianF0 unchanged", s.medianF0 === 200);
  check("pitchStdev unchanged (sample stdev)", near(s.pitchStdev, sd));
  check("pctTimeInPitchTarget unchanged (165–255 Hz → 2 of 5)", s.pctTimeInPitchTarget === 40);
  check("pctTimeInResonanceTarget unchanged", s.pctTimeInResonanceTarget === 100);
  check("voicedDurationSeconds unchanged (25 ms/frame)", s.voicedDurationSeconds === Math.round((5 * 25) / 1000));
}

// 5. Long session: no spread/arg-count overflow, stays fast.
{
  const frames = new Array(400000);
  for (let i = 0; i < frames.length; i++) frames[i] = frame(120 + (i % 200));
  const t0 = Date.now();
  const s = computeSummaryStats(frames);
  const ms = Date.now() - t0;
  check("400k voiced frames computes", s.pitchRangeLow != null && s.pitchRangeHigh != null, `${ms} ms`);
}

console.log(failures === 0 ? "\nAll session-stats checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
