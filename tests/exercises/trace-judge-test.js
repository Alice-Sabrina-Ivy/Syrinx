// trace-judge-test.js — source check: PitchTrace judges against the band unless a caller
// turns it off (the guided exercises' glide cards, `judge={false}`), so the Dashboard and
// the Pitch tab, which pass no `judge`, keep their on / off-target colours.
//
//   node tests/exercises/trace-judge-test.js
import { readFileSync } from "node:fs";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const trace = src("src/components/PitchTrace.jsx");
check("PitchTrace: judge defaults to true", /\bjudge = true\b/.test(trace));
check("PitchTrace: the line and dot colours use the judged target (null when judge is off)",
  /const judged = judgeRef\.current \? target : null;/.test(trace)
  && (trace.match(/pitchStatus\(levelAt\(data, \w+\), judged\)/g) ?? []).length === 2
  && !/pitchStatus\(levelAt\(data, \w+\), target\)/.test(trace));
check("PitchTrace: the readout colour follows judge too", /pitchStatus\(pitchLevel, judge \? target : null\)/.test(trace));

// every other caller passes no judge prop (the default)
const uses = [
  ["src/components/CombinedDashboard.jsx", src("src/components/CombinedDashboard.jsx")],
  ["src/App.jsx", src("src/App.jsx")],
];
for (const [p, text] of uses) {
  const tags = text.match(/<PitchTrace\b[^>]*>/gs) ?? [];
  check(`${p}: PitchTrace used without a judge prop`, tags.length > 0 && tags.every((t) => !/\bjudge\b/.test(t)), `${tags.length} tag(s)`);
}
const ex = src("src/exercises/ExercisesView.jsx");
check("the exercises pass judge from the card (glide cards: false)", /judge=\{judge\}/.test(ex) && /card\.live\?\.judge !== false/.test(ex));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
