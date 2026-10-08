// heard-as-test.js — src/ml/heard-as.js: the experimental "Likely heard as"
// aggregation, shares, formatting and notes, against the calibration's
// test vectors (tests/ml/fixtures/heard-as-test-vectors.json).
//
//   node tests/ml/heard-as-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHeardAsAggregator,
  heardAsShares,
  heardAsEta,
  unsureShare,
  formatShare,
  shareTenths,
  outsideTestedRange,
  isWideShare,
  ML_WINDOW_MS,
} from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TV = JSON.parse(readFileSync(path.join(here, "fixtures/heard-as-test-vectors.json"), "utf8"));

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log("constants = calibration.json");
check("a / bMeter / bLnF0", C.a === TV.model.a && C.bMeter === TV.model.b && C.bLnF0 === TV.model.c);
check("halfWidth 2.25, unsure k 0.42 / floor 0.02", C.halfWidth === TV.halfWidth && C.unsureK === TV.unsure.k && C.unsureFloor === TV.unsure.f);
check("hide rules: 8 s window, 3 s voiced, 10 windows, 5 s fresh, 2 s update",
  C.windowMs === 8000 && C.minVoicedMs === 3000 && C.minWindows === 10 && C.freshMs === 5000 && C.updateMs === 2000);

console.log("\ntest vectors (4-decimal rounding in the calibration)");
for (const v of TV.vectors) {
  const r = heardAsShares(v.meter_logit, Math.log(v.f0_hz));
  const tol = 6e-5;
  const ok = near(r.eta, v.eta, tol) && near(r.s, v.s, tol) && near(r.sLow, v.s_low, tol) && near(r.sHigh, v.s_high, tol)
    && near(r.centre.man, v.man, tol) && near(r.centre.unsure, v.unsure, tol) && near(r.centre.woman, v.woman, tol)
    && near(r.man[0], v.man_low, tol) && near(r.man[1], v.man_high, tol)
    && near(r.woman[0], v.woman_low, tol) && near(r.woman[1], v.woman_high, tol);
  const wordMap = { "likely heard as a man": "man", "likely heard as a woman": "woman", "listeners would split": "split" };
  const tenthsOk = String(shareTenths(r.man)) === String(v.in_tenths.man) && String(shareTenths(r.woman)) === String(v.in_tenths.woman);
  check(`meter ${v.meter_logit}, ${v.f0_hz} Hz: eta / s / range / shares / tenths / word`, ok && tenthsOk && r.word === wordMap[v.word],
    `eta ${r.eta.toFixed(4)} man ${r.man.map((x) => x.toFixed(4))} woman ${r.woman.map((x) => x.toFixed(4))} tenths ${shareTenths(r.man)} / ${shareTenths(r.woman)}`);
}

console.log("\nshare identities");
{
  let sumOk = true, halfOk = true, monoM = true, monoF = true;
  let prev = null;
  for (let m = -8; m <= 6; m += 0.5) for (let f = 80; f <= 300; f += 10) {
    const r = heardAsShares(m, Math.log(f));
    for (const s of [r.sLow, r.s, r.sHigh]) {
      const u = unsureShare(s);
      const man = s - u / 2, woman = 1 - s - u / 2;
      if (Math.abs(man + u + woman - 1) > 1e-12) sumOk = false;
      if (Math.abs(man + u / 2 - s) > 1e-12) halfOk = false;
      if (man < -1e-12 || woman < -1e-12) sumOk = false;
    }
    if (r.man[0] > r.man[1] || r.woman[0] > r.woman[1] || r.unsure[0] > r.unsure[1]) sumOk = false;
    void prev;
  }
  // monotone: more female logit or higher F0 -> less "man"
  for (let f = 90; f <= 280; f += 10) {
    let last = Infinity;
    for (let m = -8; m <= 6; m += 0.25) { const e = heardAsEta(m, Math.log(f)); if (e >= last) monoM = false; last = e; }
  }
  for (let m = -6; m <= 6; m += 1) {
    let last = Infinity;
    for (let f = 80; f <= 300; f += 5) { const e = heardAsEta(m, Math.log(f)); if (e >= last) monoF = false; last = e; }
  }
  check("shares sum to 1 at both range ends and the centre, none negative", sumOk);
  check("man + unsure/2 = s (the fitted two-way target)", halfOk);
  check("monotonic in meterLogit (more female -> less 'man')", monoM);
  check("monotonic in lnF0 (higher -> less 'man')", monoF);
  const mid = heardAsShares(0, Math.log(147.8));
  check("unsure range includes its peak when s = 0.5 is inside the range", Math.abs(mid.unsure[1] - unsureShare(0.5)) < 1e-12);
}

console.log("\nformatting");
check("A–B", formatShare([0.4366, 0.9871]) === "about 4–10 in 10", formatShare([0.4366, 0.9871]));
check("A = B", formatShare([0.3, 0.3]) === "about 3 in 10");
check("fewer than 1 in 10", formatShare([0, 0.04]) === "fewer than 1 in 10");
check("nearly all", formatShare([0.96, 0.99]) === "nearly all");
check("0 low end", formatShare([0.0041, 0.4957]) === "about 0–5 in 10");
check("no percent sign anywhere", [[0, 0.5], [0.2, 0.7], [0, 0.01], [0.97, 1]].every((r) => !formatShare(r).includes("%")));

console.log("\nnotes");
check("wide share: 0–10 and 1–9 are wide, 4–10 and 0–5 are not",
  isWideShare([0.0, 0.99]) && isWideShare([0.15, 0.85]) && !isWideShare([0.4366, 0.9871]) && !isWideShare([0.0041, 0.4957]));
check("range note above the fit q99 (~293 Hz)", outsideTestedRange(0, Math.log(320)) === true && outsideTestedRange(0, Math.log(200)) === false);
check("range note below 81 Hz and outside the meter range", outsideTestedRange(0, Math.log(75)) && outsideTestedRange(-9, Math.log(150)) && outsideTestedRange(6, Math.log(150)));

console.log("\naggregator");
// A stream: one pitch frame every 25 ms (voiced per `voiced(t)` at f0(t)),
// a scored window every 150 ms while `scored(t)`, logit L(t).
function feed(agg, { from, to, voiced, f0, scored, logit, mode = "gated" }) {
  for (let t = from; t <= to; t += 25) {
    agg.addPitch({ audioMs: t, f0: voiced(t) ? f0(t) : null });
    if (t % 150 === 0 && scored(t)) agg.addWindow({ audioMs: t, logit: logit(t), mode });
  }
}
{
  const agg = createHeardAsAggregator();
  check("nothing scored yet -> listening", agg.estimate(0).hidden === "listening");
  feed(agg, { from: 25, to: 2000, voiced: () => true, f0: () => 200, scored: () => true, logit: () => 2 });
  const e1 = agg.estimate(2000);
  check("2 s of speech -> short (needs 3 s voiced)", e1.hidden === "short", JSON.stringify(e1));
  feed(agg, { from: 2025, to: 6000, voiced: () => true, f0: () => 200, scored: () => true, logit: () => 2 });
  const e2 = agg.estimate(6000);
  check("6 s of speech -> an estimate", !e2.hidden && near(e2.meterLogit, 2, 1e-12) && near(e2.lnF0, Math.log(200), 1e-12), JSON.stringify(e2));
  check("sustained voice state hides it", agg.estimate(6000, "sustained").hidden === "sustained");
  // trailing 8 s: older windows fall out
  feed(agg, { from: 6025, to: 16000, voiced: () => true, f0: () => 120, scored: () => true, logit: () => -4 });
  const e3 = agg.estimate(16000);
  check("trailing 8 s only (the old logit / F0 have left the span)", near(e3.meterLogit, -4, 1e-12) && near(e3.lnF0, Math.log(120), 1e-12), JSON.stringify(e3));
  // stale: no scored window for > 5 s
  feed(agg, { from: 16025, to: 21500, voiced: () => false, f0: () => 0, scored: () => false, logit: () => 0 });
  check("no scored window for > 5 s -> stale", agg.estimate(21500).hidden === "stale");
  check("4 s without a window -> still shown (aged)", !agg.estimate(20000).hidden && agg.estimate(20000).ageMs === 4100);
}
{
  // Outside the fit data: hidden with a reason (not just a note).
  const hi = createHeardAsAggregator();
  feed(hi, { from: 25, to: 8000, voiced: () => true, f0: () => 320, scored: () => true, logit: () => 3 });
  const lo = createHeardAsAggregator();
  feed(lo, { from: 25, to: 8000, voiced: () => true, f0: () => 76, scored: () => true, logit: () => -3 });
  const ml = createHeardAsAggregator();
  feed(ml, { from: 25, to: 8000, voiced: () => true, f0: () => 150, scored: () => true, logit: () => 6.5 });
  check("F0 above 293 Hz -> hidden 'outside'", hi.estimate(8000).hidden === "outside");
  check("F0 below 81 Hz -> hidden 'outside' (the same rule both ends)", lo.estimate(8000).hidden === "outside");
  check("meter logit outside −7.31…+5.72 -> hidden 'outside'", ml.estimate(8000).hidden === "outside");
}
{
  const agg = createHeardAsAggregator();
  feed(agg, { from: 25, to: 8000, voiced: () => true, f0: () => 180, scored: () => true, logit: () => 1, mode: "fallback" });
  check("fallback-mode windows are ignored", agg.estimate(8000).hidden === "listening");
  agg.addWindow({ audioMs: 8000, logit: NaN, mode: "gated" });
  check("non-finite logits are ignored", agg.estimate(8000).hidden === "listening");
}
{
  // minWindows: windows every 600 ms over 8 s of voiced speech = 13 windows, then 9
  const agg = createHeardAsAggregator();
  for (let t = 25; t <= 8000; t += 25) {
    agg.addPitch({ audioMs: t, f0: 160 });
    if (t % 900 === 0) agg.addWindow({ audioMs: t, logit: 0, mode: "gated" });
  }
  const e = agg.estimate(8000);
  check("fewer than 10 scored windows -> short", e.hidden === "short" && e.nWindows === 8, JSON.stringify(e));
}
{
  // Only frames inside a scored window count, and voiced ms = spacing (capped 100)
  const agg = createHeardAsAggregator({ minVoicedMs: 0, minWindows: 1 });
  for (let t = 25; t <= 4000; t += 25) agg.addPitch({ audioMs: t, f0: t < 2000 ? 100 : 300 });
  agg.addWindow({ audioMs: 4000, logit: 0, mode: "gated" });
  const g = agg.aggregate(4000);
  check("F0 only from frames inside the scored windows", near(g.lnF0, Math.log(300), 1e-12) && g.nVoicedFrames === ML_WINDOW_MS / 25 + 1, JSON.stringify(g));
  check("voiced ms = 25 per frame at the normal cadence", g.voicedMs === 25 * g.nVoicedFrames);
  const agg2 = createHeardAsAggregator({ minVoicedMs: 0, minWindows: 1 });
  for (let t = 50; t <= 4000; t += 50) agg2.addPitch({ audioMs: t, f0: 200 });
  agg2.addWindow({ audioMs: 4000, logit: 0, mode: "gated" });
  check("voiced ms follows the frame spacing (50 ms chunks)", agg2.aggregate(4000).voicedMs === 50 * agg2.aggregate(4000).nVoicedFrames);
  // median of an even count
  const agg3 = createHeardAsAggregator({ minVoicedMs: 0, minWindows: 1 });
  [100, 200, 300, 400].forEach((f, i) => agg3.addPitch({ audioMs: 1000 + 25 * i, f0: f }));
  agg3.addWindow({ audioMs: 1100, logit: 0, mode: "gated" });
  check("median of an even count = mean of the middle two", near(agg3.aggregate(1100).lnF0, Math.log(250), 1e-12));
}
{
  // 2026-10-07 (measurements/heard-as-cpu-2026-10-07.md): the worker classifies
  // every 450 ms; the scored windows in between arrive with classified: false.
  // They count as windows (count, spans, voiced time); only the logit mean thins.
  const full = createHeardAsAggregator(), thin = createHeardAsAggregator();
  let k = 0;
  for (let t = 25; t <= 8000; t += 25) {
    const f0 = t < 4000 ? 140 : 160;
    full.addPitch({ audioMs: t, f0 }); thin.addPitch({ audioMs: t, f0 });
    if (t % 150 === 0 && t >= 750) {
      const logit = (k % 3) - 1; // -1, 0, 1, -1, ...
      full.addWindow({ audioMs: t, logit, mode: "gated" });
      thin.addWindow(k % 3 === 0 ? { audioMs: t, logit, mode: "gated" } : { audioMs: t, logit: null, mode: "gated", classified: false });
      k++;
    }
  }
  const gf = full.aggregate(8000), gt = thin.aggregate(8000);
  check("unclassified windows count: same window count, voiced time and F0",
    gt.nWindows === gf.nWindows && gt.voicedMs === gf.voicedMs && gt.lnF0 === gf.lnF0 && gt.nVoicedFrames === gf.nVoicedFrames,
    `${gt.nWindows}/${gf.nWindows} windows, ${gt.voicedMs}/${gf.voicedMs} ms`);
  check("meterLogit = the mean of the classified windows only", gt.meterLogit === -1 && gt.nClassified === Math.ceil(gf.nWindows / 3),
    `${gt.meterLogit}, ${gt.nClassified} classified`);
  check("estimate() shown with the same counts", !thin.estimate(8000).hidden && thin.estimate(8000).nWindows === full.estimate(8000).nWindows);
  const none = createHeardAsAggregator();
  feed(none, { from: 25, to: 8000, voiced: () => true, f0: () => 180, scored: () => false });
  for (let t = 750; t <= 8000; t += 150) none.addWindow({ audioMs: t, logit: null, mode: "gated", classified: false });
  check("no classified window in the span -> hidden 'short'", none.estimate(8000).hidden === "short", JSON.stringify(none.estimate(8000)));
  check("a classified window without a finite logit is still dropped",
    !createHeardAsAggregator().addWindow({ audioMs: 1000, logit: null, mode: "gated" }));
}
{
  // a clock jump back (new capture stream) clears everything
  const agg = createHeardAsAggregator();
  feed(agg, { from: 25, to: 9000, voiced: () => true, f0: () => 200, scored: () => true, logit: () => 2 });
  agg.addPitch({ audioMs: 100, f0: 200 });
  check("a clock jump back starts afresh", agg.aggregate(9000).nWindows === 0);
}

console.log("\nvoiced windows only (measurements/heard-as-voiced-windows-2026-10-08.md)");
{
  check("shipped default: >= 200 ms of posted voiced pitch in the window's own span", C.logitMinVoicedMs === 200 && C.logitMinRunMs === 0);
  // 4 s of speech (voiced, logit -2) then 4 s of whisper (no voiced frame, logit +3), windows every 150 ms
  const mk = (opts) => {
    const a = createHeardAsAggregator(opts);
    for (let t = 25; t <= 8000; t += 25) {
      a.addPitch({ audioMs: t, f0: t <= 4000 ? 120 : 0 });
      if (t % 150 === 0 && t >= 750) a.addWindow({ audioMs: t, logit: t <= 4000 ? -2 : 3, mode: "gated" });
    }
    return a;
  };
  const on = mk({}).aggregate(8000), off = mk({ logitMinVoicedMs: 0 }).aggregate(8000);
  // windows ending after 4550 ms hold < 200 ms of voicing (the speech ends at 4000)
  const kept = []; for (let t = 750; t <= 8000; t += 150) if (t > 0 && t <= 4550) kept.push(t <= 4000 ? -2 : 3);
  const expect = kept.reduce((x, y) => x + y, 0) / kept.length;
  check("whisper windows (< 200 ms voiced in their span) leave the logit mean", off.meterLogit > on.meterLogit && near(on.meterLogit, expect, 1e-12) && on.nClassified === kept.length,
    `${off.meterLogit} -> ${on.meterLogit} (expected ${expect})`);
  check("... but still count as scored windows (count, voiced time, F0 unchanged)", on.nWindows === off.nWindows && on.voicedMs === off.voicedMs && on.lnF0 === off.lnF0 && on.nClassified < off.nClassified,
    `${on.nWindows} windows, ${on.nClassified} of ${off.nClassified} classified count`);
  // threshold: a window whose span holds exactly 7 / 8 voiced frames (175 / 200 ms)
  const edge = (n) => {
    const a = createHeardAsAggregator({ windowMs: Infinity, minVoicedMs: 0, minWindows: 0 });
    for (let t = 25; t <= 2000; t += 25) a.addPitch({ audioMs: t, f0: t > 2000 - 25 * n ? 150 : 0 });
    a.addWindow({ audioMs: 2000, logit: 1, mode: "gated" });
    return a.aggregate(2000).nClassified;
  };
  check("175 ms voiced in the span -> excluded, 200 ms -> counted", edge(7) === 0 && edge(8) === 1);
  // run variant (measured, not shipped): a 100 ms gap breaks a run
  const run = (gapMs) => {
    const a = createHeardAsAggregator({ windowMs: Infinity, minVoicedMs: 0, minWindows: 0, logitMinVoicedMs: 0, logitMinRunMs: 150 });
    let t = 1300;
    for (let i = 0; i < 4; i++) { t += 25; a.addPitch({ audioMs: t, f0: 150 }); }
    t += gapMs; a.addPitch({ audioMs: t, f0: 150 });
    t += 25; a.addPitch({ audioMs: t, f0: 150 });
    a.addWindow({ audioMs: 2000, logit: 1, mode: "gated" });
    return a.aggregate(2000).nClassified;
  };
  // 6 frames: one 150 ms run; with a 125 ms gap: 100 ms + (100 ms capped spacing + 25 ms) = 125 ms < 150
  check("run rule: one 150 ms run counts; a > 100 ms gap splits it", run(25) === 1 && run(125) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
