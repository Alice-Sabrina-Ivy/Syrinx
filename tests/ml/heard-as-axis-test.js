// heard-as-axis-test.js — src/components/heardAsAxisModel.js: the "Likely
// heard as" panel's man <-> woman split bar (orientation, the solid parts =
// the low ends of the range rounded outward to tenths, the best guess s kept
// for the checks — not drawn since the 2026-10-20 review —, the wide state
// "Could go either way" (user decision 2026-10-21; it said "Can't tell yet",
// now only the panel's "no reading yet" reason), words, screen-reader text),
// the one-side sentence at the middle of the range (user decision
// 2026-10-21: "About N in 10 listeners would say man", an exact .5 toward 5),
// that its unsure words and tenths are the 2026-10-07 axis's
// (tests/ml/fixtures/heard-as-axis-words-golden.json, frozen before the
// 2026-10-20 split bar; only its range line regenerated 2026-10-21 — the wide
// rows' for "Could go either way", the others' for the one-side sentence; its
// last two columns, the old screen-reader best-guess words, are no longer
// used), and its gender
// symmetry (a mirrored estimate gives a mirrored bar and the same words with
// man / woman swapped).
//
//   node tests/ml/heard-as-axis-test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heardAsShares, shareTenths, formatShare } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { heardAsAxis, AXIS_ENDS, unsureWords, shortReason, UNVOICED_SHARE, quickCheck, WIDE_TEXT, middleTenths, sayText } from "../../src/components/heardAsAxisModel.js";

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

console.log("orientation and geometry (split bar)");
{
  const man = heardAsAxis(sharesAt(3.5)), woman = heardAsAxis(sharesAt(-3.5));
  check("ends: would say man on the left, would say woman on the right", AXIS_ENDS.left === "would say man" && AXIS_ENDS.right === "would say woman");
  check("a man-leaning estimate fills mostly from the left (deep), a woman-leaning one from the right (light)",
    man.man > 0.5 && man.woman === 0 && woman.woman > 0.5 && woman.man === 0 && man.guess > 0.5 && woman.guess < 0.5, JSON.stringify([man.man, man.woman, woman.man, woman.woman]));
  let ok = true, detail = "";
  for (const e of ETAS) {
    const sh = sharesAt(e), ax = heardAsAxis(sh);
    const [a, b] = shareTenths([sh.sLow, sh.sHigh]);
    const [c] = shareTenths([1 - sh.sHigh, 1 - sh.sLow]);
    const either = 1 - ax.man - ax.woman;
    const good = near(ax.man, a / 10) && near(ax.woman, c / 10) && near(ax.woman, (10 - b) / 10)
      && near(either, (b - a) / 10) && either >= -1e-9 && ax.man >= 0 && ax.woman >= 0
      && near(ax.guess, sh.s) && ax.guess >= ax.man - 1e-9 && ax.guess <= 1 - ax.woman + 1e-9
      && near(ax.man * 10, Math.round(ax.man * 10)) && near(ax.woman * 10, Math.round(ax.woman * 10));
    if (!good) { ok = false; detail = `eta ${e}: man ${ax.man} woman ${ax.woman} guess ${ax.guess}`; }
  }
  check("solid parts = the low ends of the two-way range rounded outward to tenths (man from the left, woman from the right); striped = the range's width; guess = s inside the stripes", ok, detail);
  let mono = true, prev = -1;
  for (const e of [...ETAS].sort((x, y) => x - y)) { const g = heardAsAxis(sharesAt(e)).guess; if (g <= prev) mono = false; prev = g; }
  check("best guess s (data-split-guess, not drawn) grows as more would say man", mono);
}

console.log("\nwords (frozen at 550c959; the range line as of 2026-10-21: 'Could go either way' and the one-side sentence)");
{
  const golden = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/heard-as-axis-words-golden.json", import.meta.url)), "utf8"));
  let same = 0, detail = "";
  for (const [eta, rangeText, unsureText, a, b, c, d, wide] of golden.rows) {
    const sh = sharesAt(eta), ax = heardAsAxis(sh);
    const got = [ax.rangeText, ax.unsureText, ...ax.manTenths, ...ax.womanTenths, ax.wide ? 1 : 0];
    const want = [rangeText, unsureText, a, b, c, d, wide];
    if (got.every((v, i) => v === want[i])) same++;
    else if (!detail) detail = `eta ${eta}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`;
  }
  check(`range line, unsure line, tenths and "could go either way" identical on all ${golden.rows.length} frozen estimates`, same === golden.rows.length && golden.rows.length === 281, detail);
}

console.log("\ncould go either way (a shown reading in the middle; user decision 2026-10-21)");
{
  const mid = heardAsAxis(sharesAt(0));
  check("eta 0: range covers most of the scale -> wide (the bar mostly striped)", mid.wide && 1 - mid.man - mid.woman >= 0.8 - 1e-9, `${mid.man} / ${mid.woman}`);
  check("wide: says exactly 'Could go either way — listeners would be split', no 'in 10' precision in the visible range line",
    WIDE_TEXT === "Could go either way — listeners would be split" && mid.rangeText === WIDE_TEXT && !mid.rangeText.includes("in 10"), mid.rangeText);
  let noCantTell = true, cantDetail = "";
  for (let k = -140; k <= 140; k++) {
    const ax = heardAsAxis(sharesAt(k / 20));
    for (const t of [ax.rangeText, ax.unsureText ?? "", ax.srText]) if (/can.t tell/i.test(t)) { noCantTell = false; cantDetail ||= `eta ${k / 20}: ${t}`; }
  }
  check("no shown reading says 'Can't tell yet' (range line, unsure line, screen-reader text; eta -7..7)", noCantTell, cantDetail);
  const panelSrc = readFileSync(fileURLToPath(new URL("../../src/components/HeardAsPanel.jsx", import.meta.url)), "utf8");
  check("'Can't tell yet' stays only for no reading yet: the panel's 'short' reason starts with it",
    panelSrc.includes(`\n  short: () => "Can't tell yet — keep talking, it needs a few seconds of running speech",`));
  const q = (w) => `${String.fromCharCode(92)}u201c${w}${String.fromCharCode(92)}u201d`; // the source's escaped quotes
  check("the panel's 'More' text names the wide state by its new words",
    panelSrc.includes(`Some voices get ${q("Could go either way")} most of the time.`) && !panelSrc.includes(q("Can't tell yet")));
  const clear = heardAsAxis(sharesAt(3.5));
  check("eta 3.5: not wide, range line gives one side, one number", !clear.wide && !clear.split && /^About \d in 10 listeners would say man$/.test(clear.rangeText), clear.rangeText);
  let consistent = true;
  for (const e of ETAS) { const ax = heardAsAxis(sharesAt(e)); if (ax.wide !== (ax.manTenths[1] - ax.manTenths[0] >= 8)) consistent = false; }
  check("wide exactly when the rounded range spans ≥ 8 tenths", consistent);
}

console.log("\none side, the middle of the range (user decision 2026-10-21)");
{
  // The rounding rule: an exact .5 goes toward 5 (never overstates).
  check("middleTenths: 5–10 -> 7, 7–10 -> 8, 9–10 -> 9, 6–10 -> 8, 3–10 -> 6; mirrored 0–5 -> 3, 0–1 -> 1",
    middleTenths(5, 10) === 7 && middleTenths(7, 10) === 8 && middleTenths(9, 10) === 9 && middleTenths(6, 10) === 8 && middleTenths(3, 10) === 6
    && middleTenths(0, 5) === 3 && middleTenths(0, 1) === 1);
  let rule = true, ruleDetail = "";
  for (let a = 0; a <= 10; a++) for (let b = a; b <= 10; b++) {
    const n = middleTenths(a, b), mid = (a + b) / 2;
    const ok = Number.isInteger(n) && Math.abs(n - mid) <= 0.5 && Math.abs(n - 5) <= Math.abs(mid - 5) && n >= a && n <= b
      && middleTenths(10 - b, 10 - a) === 10 - n && (mid % 1 === 0 ? n === mid : Math.abs(n - 5) < Math.abs(mid - 5));
    if (!ok) { rule = false; ruleDetail ||= `${a}–${b} -> ${n}`; }
  }
  check("every a–b: nearest whole tenth to the middle, an exact .5 toward 5 (never more extreme than the middle), inside a–b, mirror-symmetric", rule, ruleDetail);
  check("the user's example range 5–10 'would say man' -> 'About 7 in 10 listeners would say man' (7.5 rounds toward 5)",
    sayText(5, 10, false) === "About 7 in 10 listeners would say man" && sayText(0, 5, false) === "About 7 in 10 listeners would say woman");
  check("the side is the one above 5 in 10: 0–3 -> about 8 in 10 would say woman; 7–10 -> about 8 in 10 would say man",
    sayText(0, 3, false) === "About 8 in 10 listeners would say woman" && sayText(7, 10, false) === "About 8 in 10 listeners would say man");
  check("a middle that rounds to 5 (not wide) says 'Could go either way' too: 3–7, 4–5, 2–9, 5–5",
    [[3, 7], [4, 5], [2, 9], [5, 5]].every(([a, b]) => sayText(a, b, false) === WIDE_TEXT));
  check("wide stays 'Could go either way' whatever its middle (0–10, 2–10, 0–8)",
    [[0, 10], [2, 10], [0, 8]].every(([a, b]) => sayText(a, b, true) === WIDE_TEXT));
  const mid5 = heardAsAxis({ s: 0.5, sLow: 0.35, sHigh: 0.65, centre: { unsure: 0.3 } });
  check("non-wide, middle 5 (tenths 3–7): split, the unsure line kept, bar unchanged",
    !mid5.wide && mid5.split && mid5.rangeText === WIDE_TEXT && mid5.unsureText === "About 3 in 10 might be unsure or say neither" && mid5.man === 0.3 && mid5.woman === 0.3, JSON.stringify(mid5));
  let oneSide = true, oneDetail = "";
  for (let k = -140; k <= 140; k++) {
    const ax = heardAsAxis(sharesAt(k / 20));
    const t = ax.rangeText, manSide = ax.manTenths[0] + ax.manTenths[1] > 10;
    const ok = ax.split ? t === WIDE_TEXT && ax.wide
      : /^About [6-9] in 10 listeners would say (man|woman)$/.test(t) && !t.includes(" · ") && !t.includes("–")
        && t.endsWith(manSide ? "would say man" : "would say woman")
        && t.includes(` ${manSide ? middleTenths(...ax.manTenths) : middleTenths(...ax.womanTenths)} in 10`);
    if (!ok) { oneSide = false; oneDetail ||= `eta ${k / 20}: ${t}`; }
  }
  check("eta -7..7: every non-split line is one side, 'About N in 10 listeners would say …' (N 6–9, the middle of the bar's range, the side above 5), no second half, no range; split only when wide (inside the tested range a middle of 5 is always wide)", oneSide, oneDetail);
  const ex = (e) => heardAsAxis(sharesAt(e)).rangeText;
  check("old wording gone: no 'nearly all would say' / 'fewer than 1 in 10 would say' / ' · about' / a range, at the ends or the middle",
    [-7, -5, -3.5, -2.5, 2.5, 3.5, 5, 7].every((e) => !/nearly all would say|fewer than 1 in 10 would say| · about|\d–\d/i.test(ex(e))), [-7, 7].map(ex).join(" | "));
  const panelSrc = readFileSync(fileURLToPath(new URL("../../src/components/HeardAsPanel.jsx", import.meta.url)), "utf8");
  check("the 'More' text says the sentence is the middle of the range, halfway values toward 5",
    panelSrc.includes("The sentence under the bar gives the middle of that range, rounded to a whole tenth (halfway values toward 5 in 10), for the side more listeners would choose."));
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
  check("screen-reader text names the bar (man from the left, woman from the right, striped between) and then the visible sentence word for word — no best guess (none is drawn)",
    ax.srText === `Bar of listeners in tenths: would say man fills from the left, would say woman from the right, and the striped part between could go either way. ${ax.rangeText}.`
    && ax.rangeText === "About 7 in 10 listeners would say man", ax.srText);
  for (const e of [6, -6]) {
    const t = heardAsAxis(sharesAt(e)).srText;
    check(`screen-reader text at eta ${e} uses the end words, no '0 in 10' / '10 in 10'`, !/\b(0|10) in 10/.test(t), t);
  }
  const w = heardAsAxis(sharesAt(0));
  check("screen-reader text says the visible 'Could go either way — listeners would be split' when wide (not 'Can't tell yet', no hidden ranges); no unsure line then",
    w.srText.endsWith(` ${WIDE_TEXT}.`) && !/in 10/.test(w.srText) && !w.srText.includes("Can't tell") && !w.srText.includes("Best guess") && w.unsureText === null, w.srText);
}

console.log("\nhide reason: 'short' vs 'unvoiced' (whisper gets its own words, 2026-10-07 UX review)");
{
  const mw = C.minWindows;
  check("other reasons pass through", shortReason({ hidden: "stale" }, mw) === "stale" && shortReason({ hidden: "sustained" }, mw) === "sustained" && shortReason({ hidden: "outside" }, mw) === "outside");
  check("few windows yet (utterance start) -> short", shortReason({ hidden: "short", nWindows: mw - 1, voicedMs: 0 }, mw) === "short");
  check("enough windows, speech-like voicing still filling (40 %) -> short", shortReason({ hidden: "short", nWindows: 14, voicedMs: 0.4 * (150 * 14 + 600) }, mw) === "short");
  check("whisper: many scored windows, almost no voiced pitch -> unvoiced", shortReason({ hidden: "short", nWindows: 53, voicedMs: 300 }, mw) === "unvoiced");
  check(`the split sits at ${UNVOICED_SHARE * 100} % of the scored span`, shortReason({ hidden: "short", nWindows: 20, voicedMs: 0.099 * 3600 }, mw) === "unvoiced" && shortReason({ hidden: "short", nWindows: 20, voicedMs: 0.101 * 3600 }, mw) === "short");
}

console.log("\ngender symmetry (mirrored estimate -> mirrored bar, same words)");
{
  // mirror: s -> 1 − s, sLow <-> 1 − sHigh; the unsure share is symmetric in s
  let geo = true, words = true, detail = "";
  for (const e of ETAS.filter((x) => x > 0)) {
    const A = heardAsAxis(sharesAt(e)), B = heardAsAxis(sharesAt(-e));
    if (!(near(A.guess, 1 - B.guess, 1e-9) && near(A.man, B.woman, 1e-9) && near(A.woman, B.man, 1e-9) && A.wide === B.wide)) { geo = false; detail = `eta ±${e}`; }
    const swap = (t) => t.replace(/would say (man|woman)$/, (m, w) => `would say ${w === "man" ? "woman" : "man"}`);
    const rangeMirror = A.split === B.split && (A.split ? A.rangeText === B.rangeText : swap(A.rangeText) === B.rangeText && A.rangeText !== B.rangeText);
    if (!rangeMirror || A.unsureText !== B.unsureText) { words = false; detail = `${A.rangeText} / ${B.rangeText}`; }
  }
  check("deep and light parts swap, the best guess mirrors about the middle and 'can't tell' agrees", geo, detail);
  check("range and unsure words mirror (man <-> woman), identical template", words, detail);
}

console.log("\nthe 250 ms check (2026-10-21, H3)");
check("no reading shown -> look for the first one (never a full update: the pitch-only warning is not fed)",
  quickCheck(false, null) === "first" && quickCheck(false, "speaking") === "first" && quickCheck(false, "sustained") === "first");
check("a reading shown -> a full update only when a held note starts, else nothing (the 2 s timer updates it)",
  quickCheck(true, "sustained") === "update" && quickCheck(true, null) === null && quickCheck(true, "speaking") === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
