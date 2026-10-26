// shown-ewm-test.js — src/resonance/resonanceCue.js shows the recency-weighted
// median of the 5 s voiced window (2026-10-26, owner decision: the study's
// candidate E-ewm2.5, measurements/resonance-faster-2026-10-26.md §6).
//
//   node tests/resonance/shown-ewm-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as RC from "../../src/resonance/resonanceCue.js";
import { createReadout } from "../../src/resonance-lab/readout.js";
import { warningU } from "../../src/ml/pitch-only-warning.js";
import { CANDIDATES } from "../../scripts/resonance/faster-candidates.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const reference = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8"));
const fx = JSON.parse(readFileSync(path.join(here, "fixtures/switch-up-bins.json"), "utf8"));
const REF = reference.vtln;
const G = REF.womenMedian - REF.menMedian;
const { createResonanceCue, weightedMedian, SHOWN_HALF_LIFE_S } = RC;

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
function* noise(seed = 7) {
  let s = seed;
  for (;;) { s = (s * 16807) % 2147483647; yield s / 2147483647 - 0.5; }
}

console.log("weightedMedian");
check("equal weights, odd count = the median", weightedMedian([3, 1, 2], [1, 1, 1]) === 2);
check("equal weights, even count = the lower middle value (no averaging)", weightedMedian([4, 1, 3, 2], [1, 1, 1, 1]) === 2);
check("a heavy value wins", weightedMedian([1, 2, 3], [1, 1, 10]) === 3 && weightedMedian([1, 2, 3], [10, 1, 1]) === 1);
check("cumulative weight exactly half: the lower value", weightedMedian([5, 1], [1, 1]) === 1 && weightedMedian([1, 5], [3, 3]) === 1);
check("ties in value: that value whatever the weights", weightedMedian([2, 7, 2, 2], [0.1, 5, 0.1, 0.1]) === 7 && weightedMedian([2, 7, 2], [3, 1, 3]) === 2);
check("single bin", weightedMedian([0.0123], [0.5]) === 0.0123);
check("all values equal", weightedMedian([0.05, 0.05, 0.05, 0.05], [1, 0.5, 0.25, 0.125]) === 0.05);
check("input order does not matter", weightedMedian([3, 9, 1, 5, 7], [1, 2, 3, 4, 5]) === weightedMedian([7, 5, 1, 9, 3], [5, 4, 3, 2, 1]));

console.log("constants");
check("SHOWN_HALF_LIFE_S = 2.5 s of voiced time", SHOWN_HALF_LIFE_S === 2.5);
check("RESTART unchanged (1.5 s, 0.6 u, 4)", RC.RESTART.shortS === 1.5 && RC.RESTART.jumpU === 0.6 && RC.RESTART.confirmN === 4);

// [te, snapshot] after every bin, ungated
function run(bins, opts = {}) {
  const cue = createResonanceCue({ reference, gate: false, ...opts });
  return bins.map(([te, st, v]) => { cue.onStamped(te, st, v); return [te, cue.snapshot()]; });
}
// bins every 0.15 s of audio, 0.1 s of voiced time apart; level a, then b from tStep
function stepBins(a, b, tStep, n, amp = 0.004, seed = 3) {
  const z = noise(seed);
  return Array.from({ length: n }, (_, i) => [i * 0.15, i * 0.1, (i * 0.15 >= tStep ? b : a) + amp * z.next().value]);
}
const halfway = (out, a, b, tStep) => {
  const mid = ((a + b) / 2 - REF.menMedian) / G, up = b > a;
  const hit = out.find(([t, s]) => t >= tStep && s.u !== null && (up ? s.u >= mid : s.u <= mid));
  return hit ? hit[0] - tStep : Infinity;
};

console.log("shown readout — a step change");
for (const [a, b, label] of [[REF.menMedian, REF.menMedian + 0.4 * G, "up 0.4 u"], [REF.menMedian + 0.4 * G, REF.menMedian, "down 0.4 u"],
  [REF.menMedian, REF.menMedian + 1.0 * G, "up 1.0 u"]]) {
  const bins = stepBins(a, b, 15, 300);
  const tE = halfway(run(bins), a, b, 15);
  const tS0 = halfway(run(bins, { halfLifeS: null }), a, b, 15);
  const tP = halfway(run(bins, { restart: null }), a, b, 15);
  // a step ≥ RESTART.jumpU fires the restart, which already shows the short window: no later there
  const big = Math.abs(b - a) >= RC.RESTART.jumpU * G;
  check(`${label}: halfway ${big ? "no later than" : "sooner than"} the 2026-10-21 readout (median shown)`, big ? tE <= tS0 : tE < tS0, `${tE.toFixed(2)} vs ${tS0.toFixed(2)} s`);
  check(`${label}: halfway sooner than the plain 5 s median`, tE < tP, `${tE.toFixed(2)} vs ${tP.toFixed(2)} s`);
}

console.log("shown readout — an unchanged voice");
{
  const z = noise(11);
  const bins = Array.from({ length: 900 }, (_, i) => [i * 0.15, i * 0.1, REF.menMedian + 0.5 * G + 0.15 * G * z.next().value]);
  const e = run(bins), m = run(bins, { halfLifeS: null });
  const d = e.map(([, s], i) => (s.u === null ? 0 : Math.abs(s.u - m[i][1].u))).slice(60);
  const mean = d.reduce((x, y) => x + y, 0) / d.length, mx = Math.max(...d);
  const meanU = e.slice(60).reduce((x, [, s]) => x + s.u, 0) / (e.length - 60);
  check("within 0.03 u of the median on average, 0.10 u at most (bins ±0.075 u)", mean < 0.03 && mx < 0.1, `mean ${mean.toFixed(4)}, max ${mx.toFixed(4)}`);
  check("centred on the voice's level", Math.abs(meanU - 0.5) < 0.01, meanU.toFixed(4));
  check("every shown value is one of the window's bins", e.every(([, s]) => s.raw === null || bins.some((b) => b[2] === s.raw)));
}

console.log("shown readout = the study's candidate E-ewm2.5 (faster-candidates.mjs)");
{
  for (const [name, bins] of [["switch", fx.switch], ["brighter", fx.brighter], ["step", stepBins(REF.menMedian, REF.menMedian + 1.0 * G, 15, 300)]]) {
    const ro = CANDIDATES["E-ewm2.5"].make(REF), s0 = CANDIDATES.S0.make(REF);
    const out = run(bins), out0 = run(bins, { halfLifeS: null });
    let same = true, same0 = true;
    bins.forEach(([, st, v], i) => {
      ro.add(st, v); s0.add(st, v);
      const a = ro.snapshot(), b = s0.snapshot();
      if (a.raw !== out[i][1].raw || a.u !== out[i][1].u || a.restarts !== out[i][1].restarts) same = false;
      if (b.raw !== out0[i][1].raw || b.u !== out0[i][1].u) same0 = false;
    });
    check(`${name}: raw / u / restarts bit-identical to E-ewm2.5, every bin`, same);
    check(`${name}: halfLifeS null = the study's S0, every bin`, same0);
  }
}

console.log("only the shown value changes; the pitch-only warning's input is unchanged");
{
  const now = run(fx.switch), s0 = run(fx.switch, { halfLifeS: null }), plain = run(fx.switch, { restart: null });
  const ro = createReadout({ agg: "median", horizonS: 5, ref: REF });
  let same = true, warn = true, lab = true, differs = 0;
  for (let i = 0; i < now.length; i++) {
    const a = now[i][1], b = s0[i][1], p = plain[i][1];
    ro.add(fx.switch[i][1], fx.switch[i][2]);
    for (const f of ["uPlain", "fill", "voicedS", "n", "startU", "shownStartU", "startProgress", "sinceResumeS", "binsAdmitted", "binsDropped", "restarts"]) if (a[f] !== b[f]) same = false;
    if ((a.u === null) !== (b.u === null)) same = false;
    if (warningU(a) !== warningU(b) || warningU(a) !== p.u || warningU(a) !== a.uPlain) warn = false;
    if (a.uPlain !== ro.snapshot().u) lab = false;
    if (a.u !== b.u) differs++;
  }
  check("every plain field and the restart count identical to S0, u present exactly when it was", same);
  check("warningU (uPlain) identical to S0's and to the plain 5 s median", warn);
  check("uPlain = the lab's median readout", lab);
  check("the shown u does change", differs > 0, `${differs} of ${now.length} bins`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
