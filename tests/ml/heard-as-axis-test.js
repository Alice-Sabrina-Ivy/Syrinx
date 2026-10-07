// heard-as-axis-test.js — src/components/heardAsAxisModel.js: the "Likely
// heard as" panel's single man <-> woman axis (orientation, range rounding,
// best guess, "can't tell yet", words, screen-reader text) and its gender
// symmetry (a mirrored estimate gives a mirrored axis and the same words with
// man / woman swapped).
//
//   node tests/ml/heard-as-axis-test.js

import { heardAsShares, shareTenths, formatShare } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { heardAsAxis, AXIS_ENDS, unsureWords } from "../../src/components/heardAsAxisModel.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// shares at a chosen eta (F0 fixed at 150 Hz; meter logit solved for it)
const LN = Math.log(150);
const sharesAt = (eta) => heardAsShares((eta - C.a - C.bLnF0 * LN) / C.bMeter, LN);
const ETAS = [-4.5, -3.2, -2.6, -1.9, -1.2, -0.4, 0, 0.4, 1.2, 1.9, 2.6, 3.2, 4.5];

console.log("orientation and geometry");
{
  const man = heardAsAxis(sharesAt(3.5)), woman = heardAsAxis(sharesAt(-3.5));
  check("ends: would say man on the left, would say woman on the right", AXIS_ENDS.left === "would say man" && AXIS_ENDS.right === "would say woman");
  check("a man-leaning estimate sits left of the middle, a woman-leaning one right", man.dot < 0.5 && woman.dot > 0.5, `${man.dot} / ${woman.dot}`);
  let ok = true, detail = "";
  for (const e of ETAS) {
    const sh = sharesAt(e), ax = heardAsAxis(sh);
    const [a, b] = shareTenths([sh.sLow, sh.sHigh]);
    const good = near(ax.lo, (10 - b) / 10) && near(ax.hi, (10 - a) / 10) && ax.lo <= ax.hi
      && ax.lo >= 0 && ax.hi <= 1 && near(ax.dot, 1 - sh.s)
      && ax.dot >= ax.lo - 1e-9 && ax.dot <= ax.hi + 1e-9
      && Number.isInteger(Math.round(ax.lo * 10)) && near(ax.lo * 10, Math.round(ax.lo * 10)) && near(ax.hi * 10, Math.round(ax.hi * 10));
    if (!good) { ok = false; detail = `eta ${e}: lo ${ax.lo} hi ${ax.hi} dot ${ax.dot}`; }
  }
  check("range = the two-way range rounded outward to tenths, from the man end; dot = 1 − s inside it", ok, detail);
  let mono = true, prev = -1;
  for (const e of [...ETAS].sort((x, y) => y - x)) { const d = heardAsAxis(sharesAt(e)).dot; if (d <= prev) mono = false; prev = d; }
  check("dot moves right as fewer would say man", mono);
}

console.log("\ncan't tell yet");
{
  const mid = heardAsAxis(sharesAt(0));
  check("eta 0: range covers most of the scale -> wide", mid.wide && mid.hi - mid.lo >= 0.8 - 1e-9, `${mid.lo}–${mid.hi}`);
  check("wide: says 'Can't tell yet', no 'in 10' precision in the visible range line", /^Can't tell yet/.test(mid.rangeText) && !mid.rangeText.includes("in 10"));
  const clear = heardAsAxis(sharesAt(3.5));
  check("eta 3.5: not wide, range line gives both sides in tenths", !clear.wide && /^About \d+–\d+ in 10 would say man · about \d+–\d+ in 10 would say woman$/.test(clear.rangeText), clear.rangeText);
  let consistent = true;
  for (const e of ETAS) { const ax = heardAsAxis(sharesAt(e)); if (ax.wide !== (ax.manTenths[1] - ax.manTenths[0] >= 8)) consistent = false; }
  check("wide exactly when the rounded range spans ≥ 8 tenths", consistent);
}

console.log("\nwords");
{
  let noPct = true, noVerdict = true, unsureOk = true, unsureDetail = "";
  for (const e of ETAS) {
    const sh = sharesAt(e), ax = heardAsAxis(sh);
    for (const t of [ax.rangeText, ax.unsureText ?? "", ax.srText]) {
      if (t.includes("%")) noPct = false;
      if (/likely (a )?(man|woman)|\bis a (man|woman)|sounds like a/i.test(t)) noVerdict = false;
    }
    const n = Math.round(10 * sh.centre.unsure);
    const want = ax.wide ? null : n === 0 ? "Fewer than 1 in 10 might be unsure or say neither" : `About ${n} in 10 might be unsure or say neither`;
    if (ax.unsureText !== want) { unsureOk = false; unsureDetail = `eta ${e}: ${ax.unsureText} vs ${want}`; }
  }
  check("no '%' anywhere", noPct);
  check("no verdict wording", noVerdict);
  check("unsure line = the share at the best guess, nearest tenth ('About N in 10' / 'Fewer than 1 in 10'); left out when wide", unsureOk, unsureDetail);
  check("unsureWords: 0.04 -> fewer than 1, 0.05 -> about 1, 0.42 -> about 4", unsureWords(0.04) === "fewer than 1 in 10" && unsureWords(0.05) === "about 1 in 10" && unsureWords(0.42) === "about 4 in 10");
  for (const e of [3.5, -3.5]) {
    const t = heardAsAxis(sharesAt(e)).unsureText;
    check(`typical voice (eta ${e}): unsure line is small, not 'up to 5 in 10' (${t})`, t !== null && !/[–-]\s*5 in 10|[3-9] in 10/.test(t) && /^(Fewer than 1|About 1) in 10/.test(t), t);
  }
  check("the old outward-rounded range is gone (it read 'About 0–5 in 10' on typical voices)", !/–/.test(heardAsAxis(sharesAt(2.6)).unsureText ?? ""), formatShare(sharesAt(2.6).unsure));
  const ax = heardAsAxis(sharesAt(2.6));
  check("screen-reader text names the scale, the range and the best guess",
    ax.srText.includes("would say man, on the left") && ax.srText.includes("Shaded range:") && /Best guess: about \d+ in 10 man, \d+ in 10 woman/.test(ax.srText), ax.srText);
  const w = heardAsAxis(sharesAt(0));
  check("screen-reader text says can't tell yet when wide; no unsure line then", w.srText.includes("Can't tell yet") && !w.srText.includes("Best guess") && w.unsureText === null);
}

console.log("\ngender symmetry (mirrored estimate -> mirrored axis, same words)");
{
  // mirror: s -> 1 − s, sLow <-> 1 − sHigh; the unsure share is symmetric in s
  let geo = true, words = true, detail = "";
  for (const e of ETAS.filter((x) => x > 0)) {
    const A = heardAsAxis(sharesAt(e)), B = heardAsAxis(sharesAt(-e));
    if (!(near(A.dot, 1 - B.dot, 1e-9) && near(A.lo, 1 - B.hi, 1e-9) && near(A.hi, 1 - B.lo, 1e-9) && A.wide === B.wide)) { geo = false; detail = `eta ±${e}`; }
    const reorder = (t) => t.replace(/^(About .*?) would say man · (about .*?) would say woman$/, (m, p, q) => `${p.replace(/^A/, "a")}|${q}`);
    const rA = reorder(A.rangeText).split("|"), rB = reorder(B.rangeText).split("|");
    const rangeMirror = A.wide ? A.rangeText === B.rangeText : (rA[0] === rB[1] && rA[1] === rB[0]);
    if (!rangeMirror || A.unsureText !== B.unsureText) { words = false; detail = `${A.rangeText} / ${B.rangeText}`; }
    if (!A.wide) {
      const midA = A.srText.match(/Best guess: about (\d+) in 10 man, (\d+) in 10 woman/), midB = B.srText.match(/Best guess: about (\d+) in 10 man, (\d+) in 10 woman/);
      if (!(midA && midB && midA[1] === midB[2] && midA[2] === midB[1])) { words = false; detail = `${A.srText} / ${B.srText}`; }
    }
  }
  check("positions mirror about the middle and 'can't tell' agrees", geo, detail);
  check("range, unsure and best-guess words mirror (man <-> woman), identical template", words, detail);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
