// overload-guard-test.js — src/resonance/overloadGuard.js: the resonance
// worker's CPU guard judges a trailing window after a warm-up, never the
// cold first chunk, and backs off instead of switching the cue off for good.
//
//   node tests/resonance/overload-guard-test.js

import { createOverloadGuard, OVERLOAD_DEFAULTS } from "../../src/resonance/overloadGuard.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const CH = 0.025; // one 25 ms capture chunk
// Feeds `seconds` of chunks costing msOf(i) each; returns every result.
function feed(g, seconds, msOf) {
  const out = [];
  const n = Math.round(seconds / CH);
  for (let i = 0; i < n; i++) out.push(g.add(msOf(i), CH));
  return out;
}

console.log("defaults");
check("warm-up 3 s, window 10 s, judge from 5 s, trip above 500 ms/s, back-off 20 s doubling to 160 s",
  OVERLOAD_DEFAULTS.warmupS === 3 && OVERLOAD_DEFAULTS.windowS === 10 && OVERLOAD_DEFAULTS.minJudgeS === 5
  && OVERLOAD_DEFAULTS.overMsPerS === 500 && OVERLOAD_DEFAULTS.backoffS === 20 && OVERLOAD_DEFAULTS.maxBackoffS === 160);

console.log("\ncold start never trips");
{
  // The reviewer's case: a 20 ms first chunk (800 ms/s), then 2 ms chunks (80 ms/s).
  const g = createOverloadGuard();
  const r = feed(g, 60, (i) => (i === 0 ? 20 : 2));
  check("20 ms first chunk then 2 ms chunks: never overloaded", !r.includes("overloaded"));
  check("trailing rate = the steady rate (the cold chunk is not counted)", Math.abs(g.rate() - 80) < 1e-9, String(g.rate()));
  // A slow phone: the first 3 s at 900 ms/s (JIT), then 200 ms/s.
  const p = createOverloadGuard();
  const rp = feed(p, 60, (i) => (i * CH < 3 ? 22.5 : 5));
  check("3 s of 900 ms/s warm-up then 200 ms/s: never overloaded", !rp.includes("overloaded"));
}

console.log("\nsustained overload trips, backs off, resumes");
{
  const g = createOverloadGuard();
  const r = feed(g, 12, () => 15); // 600 ms/s
  const at = r.indexOf("overloaded");
  check("600 ms/s trips once the window holds 5 s (after the 3 s warm-up)", at >= 0 && Math.abs((at + 1) * CH - 8) < 0.05, `at ${((at + 1) * CH).toFixed(3)} s`);
  check("paused right after tripping", r[at + 1] === "paused" && g.paused());
  // back-off of 20 s of audio counted from the trip
  const after = r.length - at - 1;
  const r2 = feed(g, 20 - after * CH + CH, () => 0);
  check("'resume' after 20 s of audio", r2[r2.length - 1] === "resume" && r2.slice(0, -1).every((x) => x === "paused"), r2.slice(-3).join(","));
  check("after resuming it warms up again (no instant re-trip)", feed(g, 3, () => 15).every((x) => x === "ok"));
  const r3 = feed(g, 20, () => 15);
  const at3 = r3.indexOf("overloaded");
  check("a second overload trips again", at3 >= 0 && g.overloads() === 2);
  const r4 = feed(g, 60, () => 0);
  const resumeAt = r4.indexOf("resume");
  check("the second back-off is twice as long (40 s)", Math.abs((resumeAt + 1) * CH + (r3.length - at3 - 1) * CH - 40) < 0.05,
    `${((resumeAt + 1) * CH + (r3.length - at3 - 1) * CH).toFixed(2)} s`);
}

console.log("\na short spike inside an otherwise fine stream");
{
  const g = createOverloadGuard();
  // 30 s at 100 ms/s with a 2 s spike at 1500 ms/s: the 10 s mean peaks at
  // (8 * 100 + 2 * 1500) / 10 = 380 -> no trip.
  const r = feed(g, 30, (i) => (i * CH >= 15 && i * CH < 17 ? 37.5 : 2.5));
  check("a 2 s spike does not trip a 10 s window", !r.includes("overloaded"));
  const g2 = createOverloadGuard();
  // a 6 s spike at 1500 ms/s: (4 * 100 + 6 * 1500) / 10 = 940 -> trips, then recovers
  const r2 = feed(g2, 60, (i) => (i * CH >= 15 && i * CH < 21 ? 37.5 : 2.5));
  check("a 6 s spike trips and the guard resumes later in the session", r2.includes("overloaded") && r2.includes("resume"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
