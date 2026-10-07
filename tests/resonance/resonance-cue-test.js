// resonance-cue-test.js — src/resonance/resonanceCue.js: the Dashboard's
// gated spectral-warp readout.
//
//   node tests/resonance/resonance-cue-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createResonanceCue, VTLN_CLAMP_EDGE } from "../../src/resonance/resonanceCue.js";
import { createReadout } from "../../src/resonance-lab/readout.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reference = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8"));
const G = reference.vtln.womenMedian - reference.vtln.menMedian;

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

// deterministic pseudo-random bin values around a level
function* values(level, seed = 1) {
  let s = seed;
  for (;;) { s = (s * 16807) % 2147483647; yield level + ((s / 2147483647) - 0.5) * 0.02; }
}

console.log("resonanceCue — ungated equals the lab readout");
{
  const cue = createResonanceCue({ reference, gate: false });
  const ro = createReadout({ agg: "median", horizonS: 5, ref: reference.vtln });
  const v = values(0.03);
  let ok = true;
  for (let i = 0; i < 120; i++) {
    const stamp = i * 0.12;
    const x = i % 7 === 3 ? null : v.next().value;
    cue.onStamped(i * 0.15, stamp, x);
    ro.add(stamp, x);
    const a = cue.snapshot(), b = ro.snapshot();
    if (a.raw !== b.raw || a.n !== b.n || a.fill !== b.fill || a.voicedS !== b.voicedS) ok = false;
  }
  check("every step: raw / n / fill / voicedS identical", ok);
  const s = cue.snapshot();
  check("u in reference units", Math.abs(s.u - (s.raw - reference.vtln.menMedian) / G) < 1e-15);
}

console.log("resonanceCue — startU and clamp");
{
  const cue = createResonanceCue({ reference, gate: false });
  let firstAt = null, fullAt = null;
  const us = [];
  for (let i = 0; i < 300; i++) {
    cue.onStamped(i * 0.15, i * 0.1, 0.02 + 0.03 * Math.sin(i / 7));
    const s = cue.snapshot();
    if (fullAt === null && s.fill >= 1) fullAt = i;
    if (fullAt !== null && s.startU === null) us.push(s.u);
    if (firstAt === null && s.startU !== null) firstAt = { i, startU: s.startU, startProgress: s.startProgress, u: s.u };
  }
  const med = (a) => { const q = [...a].sort((x, y) => x - y), h = q.length >> 1; return q.length % 2 ? q[h] : (q[h - 1] + q[h]) / 2; };
  check("startU null until 12 s of admitted voiced speech after the first fill", firstAt && fullAt !== null && Math.abs((firstAt.i - fullAt) * 0.1 - 12) < 0.15,
    JSON.stringify({ fullAt, firstAt }));
  check("startU = the median of the readouts over that span (not the first readout)",
    firstAt && Math.abs(firstAt.startU - med([...us, firstAt.u])) < 1e-12 && firstAt.startU !== us[0] && firstAt.startProgress === 1);
  check("startU then held for the session", cue.snapshot().startU === firstAt.startU);
  const hi = createResonanceCue({ reference, gate: false });
  for (let i = 0; i < 10; i++) hi.onStamped(i * 0.15, i * 0.1, 0.24);
  check("clamp +1 at the vtln ceiling", hi.snapshot().clamp === 1 && hi.snapshot().raw >= VTLN_CLAMP_EDGE);
  const lo = createResonanceCue({ reference, gate: false });
  for (let i = 0; i < 10; i++) lo.onStamped(i * 0.15, i * 0.1, -0.24);
  check("clamp -1 at the vtln floor", lo.snapshot().clamp === -1);
  const mid = createResonanceCue({ reference, gate: false });
  for (let i = 0; i < 10; i++) mid.onStamped(i * 0.15, i * 0.1, 0.2394);
  check("no clamp just inside", mid.snapshot().clamp === 0);
}

console.log("resonanceCue — gating by the utterance gate");
// Drive the gate with pitch hints (25 ms apart) and decide once per chunk.
function drive(cue, { t0, dur, voiced, pitchOf }, binsEvery = 0.15, stampStart = 0) {
  let stamp = stampStart;
  const verdicts = [];
  let nextBin = t0;
  for (let t = t0; t < t0 + dur - 1e-9; t += 0.025) {
    const v = voiced(t);
    cue.notePitchHint({ voiced: v, pitch: v ? pitchOf(t) : null, contextTime: t });
    verdicts.push(cue.noteChunk(t));
    if (v) stamp += 0.025;
    if (t >= nextBin) { cue.onStamped(t, stamp, 0.05); nextBin += binsEvery; }
  }
  return { stamp, verdicts };
}
{
  // Running speech: syllables of 200 ms voiced / 80 ms unvoiced, pitch moving.
  const cue = createResonanceCue({ reference });
  const speech = (t) => (t % 0.28) < 0.2;
  const r1 = drive(cue, { t0: 0, dur: 6, voiced: speech, pitchOf: (t) => 150 * Math.pow(2, Math.sin(t * 7) / 6) });
  const s1 = cue.snapshot();
  check("running speech: most bins admitted", s1.binsAdmitted > 0.8 * (s1.binsAdmitted + s1.binsDropped),
    `${s1.binsAdmitted} admitted, ${s1.binsDropped} dropped`);
  check("running speech: verdicts include score", r1.verdicts.includes("score"));
  // A held note: 3 s fully voiced at a fixed pitch.
  const before = s1.binsAdmitted;
  const r2 = drive(cue, { t0: 6, dur: 3, voiced: () => true, pitchOf: () => 220 }, 0.15, r1.stamp);
  const s2 = cue.snapshot();
  const firstSus = r2.verdicts.indexOf("sustained");
  check("held note: gate says sustained", firstSus >= 0 && firstSus * 0.025 < 1.6, `first at ${(firstSus * 0.025).toFixed(2)} s`);
  check("held note: at most ~1.2 s of bins admitted before the gate fires", s2.binsAdmitted - before <= 8,
    `${s2.binsAdmitted - before} admitted during the hold`);
  check("held note: its voiced time does not age the readout (voiced clock advanced <= 1.2 s)", s2.voicedS - s1.voicedS <= 1.25,
    `${(s2.voicedS - s1.voicedS).toFixed(2)} s`);
  // silence after the hold: tail bins (stamped late) stay dropped
  const atEnd = s2.binsAdmitted;
  drive(cue, { t0: 9, dur: 1, voiced: () => false, pitchOf: () => 0 }, 0.15, r2.stamp);
  check("tail of a held note never enters (latched until a new utterance)", cue.snapshot().binsAdmitted === atEnd);
  // a new utterance re-admits
  drive(cue, { t0: 10, dur: 3, voiced: speech, pitchOf: (t) => 140 * Math.pow(2, Math.sin(t * 9) / 5) }, 0.15, r2.stamp);
  check("new running speech is admitted again", cue.snapshot().binsAdmitted > atEnd + 5);
  check("warming at each onset drops bins", cue.snapshot().binsDropped > s2.binsDropped);
}

console.log("resonanceCue — back after a long pause (idle -> speech)");
{
  const cue = createResonanceCue({ reference, gate: false });
  // 8 s of one voice (bins every 0.15 s, 0.1 s voiced each)
  let te = 0, st = 0;
  for (; te < 8; te += 0.15) { st += 0.1; cue.onStamped(te, st, 0.06); }
  const a = cue.snapshot();
  check("continuous speech: sinceResumeS grows with admitted voiced time", a.sinceResumeS > 4 && a.resumes === 0, JSON.stringify(a));
  // 9 s of silence: no bins, then speech -> no reset (gap < IDLE_RESET_S)
  te += 9;
  cue.onStamped(te, st += 0.1, -0.06);
  check("a 9 s pause does not count as a resume", cue.snapshot().resumes === 0);
  // 12 s of silence, then a different voice
  te += 12;
  cue.onStamped(te, st += 0.1, -0.06);
  const b = cue.snapshot();
  check("after >= 10 s without an admitted bin: sinceResumeS restarts", b.resumes === 1 && b.sinceResumeS <= 0.1 + 1e-9, JSON.stringify(b));
  check("the readout itself is not reset (still holds the earlier voice)", b.u > 0.5);
  for (let i = 0; i < 25; i++) { te += 0.15; cue.onStamped(te, st += 0.1, -0.06); }
  check("~2 s of new speech later sinceResumeS >= 2 (the strip goes live again)", cue.snapshot().sinceResumeS >= 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
