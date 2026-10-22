// vocal-weight-level-test.js — src/audio/vocal-weight-level.js: the cue
// strip's ~5 s vocal-weight level (median of the last 20 voiced emits).
//
//   node tests/audio/vocal-weight-level-test.js

import { createWeightLevel, WEIGHT_LEVEL_EMITS } from "../../src/audio/vocal-weight-level.js";
import { VocalWeightBaseline } from "../../src/audio/vocal-weight-baseline.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

check("20 emits = ~5 s of voiced content at the 250 ms emit cadence", WEIGHT_LEVEL_EMITS === 20);
const L = createWeightLevel();
check("empty -> null", L.cpp() === null && L.size() === 0);
L.push(10); L.push(NaN); L.push(null); L.push(12);
check("non-finite values are ignored; even count -> mean of the middle two", L.size() === 2 && L.cpp() === 11);
for (let i = 0; i < 30; i++) L.push(i);
check("keeps the last 20", L.size() === 20 && L.cpp() === 19.5);
L.clear();
check("clear()", L.size() === 0 && L.cpp() === null);

// One outlier emit barely moves the level; the per-emit value jumps.
const base = new VocalWeightBaseline();
let s = 7;
const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
for (let i = 0; i < 200 && !base.ready(); i++) base.accumulate({ time: i * 250, cpp: 12 + 0.6 * rnd() });
check("baseline ready", base.ready());
const lv = createWeightLevel();
for (let i = 0; i < 20; i++) lv.push(12 + 0.6 * rnd());
const before = base.sigmaDelta(lv.cpp());
lv.push(15); // one 1-s aggregate far off
const after = base.sigmaDelta(lv.cpp());
check("one outlying emit moves the 5 s level by < 0.3 σ (it would move a single-emit dot by > 5 σ)",
  Math.abs(after - before) < 0.3 && Math.abs(base.sigmaDelta(15)) > 5, `${before.toFixed(2)} -> ${after.toFixed(2)}`);
// A sustained change shows within the 5 s horizon.
for (let i = 0; i < 11; i++) lv.push(13 + 0.6 * rnd());
check("a sustained change (+1 dB) shows once it fills half the window", base.sigmaDelta(lv.cpp()) > base.sigmaDelta(12.6));
check("sigmaDelta(median CPP) = median of the per-emit sigmaDeltas (linear map)", (() => {
  const vals = [11.2, 12.9, 12.1, 13.4, 11.8];
  const l = createWeightLevel(); vals.forEach((v) => l.push(v));
  const sd = vals.map((v) => base.sigmaDelta(v)).sort((a, b) => a - b);
  return Math.abs(base.sigmaDelta(l.cpp()) - sd[2]) < 1e-12;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
