// switch-restart-test.js — src/resonance/resonanceCue.js follows a change of
// resonance in ~3 s (the restart, 2026-10-21;
// measurements/resonance-switch-asymmetry-2026-10-21.md).
//
// Fixture (tests/resonance/fixtures/switch-up-bins.json, written by
// scripts/resonance/switch-fixture.mjs): the admitted vtln bins of one
// LibriSpeech dev-clean reader through the real chain, darker for 18 s then
// brighter (the up switch), and the same audio all brighter (the control).
// The row has settled when the shown u stays within 0.3 u of the control's.
// The plain 5 s median (the readout before 2026-10-21) takes 5.7 s here, so
// the settle check fails on the old code.
//
//   node tests/resonance/switch-restart-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as RC from "../../src/resonance/resonanceCue.js";
import { createReadout } from "../../src/resonance-lab/readout.js";
import * as PW from "../../src/ml/pitch-only-warning.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const reference = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8"));
const fx = JSON.parse(readFileSync(path.join(here, "fixtures/switch-up-bins.json"), "utf8"));

const { createResonanceCue } = RC;
const RESTART = RC.RESTART ?? {}; // (namespace import: on the old module the checks fail instead of the import)

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

// [te, snapshot] after every bin (ungated: the fixture holds admitted bins only)
function run(bins, opts = {}) {
  const cue = createResonanceCue({ reference, gate: false, ...opts });
  return bins.map(([te, st, v]) => { cue.onStamped(te, st, v); return [te, cue.snapshot()]; });
}
// s of audio after the join until |u − control u| <= tol for good
function settle(sw, ctl, tol = 0.3) {
  const pts = sw.filter(([t]) => t > fx.joinS && t <= fx.endS);
  let ci = 0, cu = null, lastBad = null;
  for (const [t, s] of pts) {
    while (ci < ctl.length && ctl[ci][0] <= t) { cu = ctl[ci][1].u; ci++; }
    if (s.u == null || cu == null) continue;
    if (Math.abs(s.u - cu) > tol) lastBad = t;
  }
  const first = pts.find(([t]) => lastBad === null || t > lastBad);
  return first ? first[0] - fx.joinS : fx.endS - fx.joinS;
}

console.log("resonanceCue restart — the up switch settles");
const now = { sw: run(fx.switch), ctl: run(fx.brighter) };
const old = { sw: run(fx.switch, { restart: null }), ctl: run(fx.brighter, { restart: null }) };
const tNow = settle(now.sw, now.ctl), tOld = settle(old.sw, old.ctl);
check("pick: shortS 1.5 s, jumpU 0.6 u, confirmN 4", RESTART.shortS === 1.5 && RESTART.jumpU === 0.6 && RESTART.confirmN === 4);
check("darker → brighter settles within 3.5 s of audio", tNow <= 3.5, `${tNow.toFixed(2)} s; plain 5 s median ${tOld.toFixed(2)} s`);
check("the plain 5 s median (restart: null) still takes > 5 s on this fixture", tOld > 5, `${tOld.toFixed(2)} s`);
const swRestarts = now.sw[now.sw.length - 1][1].restarts;
check("the switch restarts the readout at least once", swRestarts >= 1, `${swRestarts}`);

console.log("resonanceCue restart — only the shown value changes");
{
  let same = true;
  for (let i = 0; i < now.sw.length; i++) {
    const a = now.sw[i][1], b = old.sw[i][1];
    if (a.fill !== b.fill || a.voicedS !== b.voicedS || a.n !== b.n || a.startU !== b.startU || a.startProgress !== b.startProgress
      || a.sinceResumeS !== b.sinceResumeS || a.binsAdmitted !== b.binsAdmitted || (a.u === null) !== (b.u === null)) same = false;
  }
  check("fill / voicedS / n / startU / sinceResumeS / bins identical, u present exactly when it was", same);
  // every shown value is a median of admitted bins: a bin value or the mean of two
  const vals = fx.switch.map((b) => b[2]);
  const set = new Set(vals);
  const isMed = (r) => set.has(r) || vals.some((a) => set.has(2 * r - a) || vals.some((b) => (a + b) / 2 === r));
  const changed = now.sw.filter(([, s], i) => s.raw !== old.sw[i][1].raw).map(([, s]) => s.raw);
  check("values that differ from the plain median are medians of admitted bins", changed.length > 0 && changed.every(isMed), `${changed.length} differ`);
}

console.log("the pitch-only warning keeps the plain 5 s median");
{
  // uPlain = what u was before the restart (restart: null), at every bin
  let same = true, differs = 0;
  for (let i = 0; i < now.sw.length; i++) {
    const a = now.sw[i][1], b = old.sw[i][1];
    if (a.uPlain !== b.u) same = false;
    if (a.u !== a.uPlain) differs++;
  }
  check("snapshot uPlain equals the restart: null cue's u at every bin (and differs from the shown u somewhere)", same && differs > 0,
    `${differs} bins differ`);
  const wU = PW.warningU ?? ((r) => r.u);
  check("the warning reads uPlain, and u on a snapshot recorded without it",
    wU({ u: 2, uPlain: 0.1 }) === 0.1 && wU({ u: 0.3 }) === 0.3 && wU({ u: 2, uPlain: null }) === null);
  const r = { u: 2, uPlain: 0.1, startU: 0, fill: 1, verdict: "score", sinceResumeS: 5 };
  check("eligibility follows uPlain (shown u null, plain known → eligible; plain null → not)",
    PW.pitchOnlyEligible({ lnF0: Math.log(200), p0: Math.log(120), resonance: { ...r, u: null } }) === true
    && PW.pitchOnlyEligible({ lnF0: Math.log(200), p0: Math.log(120), resonance: { ...r, uPlain: null } }) === false);
}

console.log("resonanceCue restart: null — the plain 5 s median");
{
  const ro = createReadout({ agg: "median", horizonS: 5, ref: reference.vtln });
  let ok = true;
  for (let i = 0; i < fx.switch.length; i++) {
    const [, st, v] = fx.switch[i];
    ro.add(st, v);
    if (old.sw[i][1].raw !== ro.snapshot().raw) ok = false;
  }
  check("restart: null equals readout.js's median value for value", ok);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
