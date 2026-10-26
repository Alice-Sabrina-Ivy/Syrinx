// heard-as-axis-test.js — src/components/heardAsAxisModel.js: the "Likely
// heard as" panel's man <-> woman split bar (orientation, the solid parts =
// the low ends of the range rounded outward to tenths, the best guess s kept
// for the checks — not drawn since the 2026-10-20 review —, the wide state
// "Could go either way" (user decision 2026-10-21; it said "Can't tell yet",
// now only the panel's "no reading yet" reason), words, screen-reader text
// (the bar's own description only — the visible sentence is read once),
// the one-side sentence at the panel's own best guess (user decisions
// 2026-10-21: "About N in 10 listeners would say man", N = the best guess s
// for the side it favours rounded to a whole tenth, an exact .5 toward 5;
// briefly the middle of the range before that), that its unsure words and
// tenths are the 2026-10-07 axis's
// (tests/ml/fixtures/heard-as-axis-words-golden.json, frozen before the
// 2026-10-20 split bar; only its range line regenerated 2026-10-21 — the wide
// rows' for "Could go either way", the others' for the one-side sentence,
// twice: middle of the range, then best guess; its last two columns, the old
// screen-reader best-guess words, are no longer used), and its gender
// symmetry (a mirrored estimate gives a mirrored bar and the same words with
// man / woman swapped).
//
//   node tests/ml/heard-as-axis-test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heardAsShares, shareTenths, formatShare } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { heardAsAxis, AXIS_ENDS, unsureWords, shortReason, UNVOICED_SHARE, quickCheck, WIDE_TEXT, BAR_DESCRIPTION, guessTenths, sayText } from "../../src/components/heardAsAxisModel.js";

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

console.log("\nwords (frozen at 119bb48; the range line as of 2026-10-21: 'Could go either way' and the one-side sentence)");
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
  const clear = heardAsAxis(sharesAt(2.6));
  check("eta 2.6: not wide, range line gives one side, one number", !clear.wide && !clear.split && /^About \d in 10 listeners would say man$/.test(clear.rangeText), clear.rangeText);
  let consistent = true;
  for (const e of ETAS) { const ax = heardAsAxis(sharesAt(e)); if (ax.wide !== (ax.manTenths[1] - ax.manTenths[0] >= 8)) consistent = false; }
  check("wide exactly when the rounded range spans ≥ 8 tenths", consistent);
}

console.log("\none side, the panel's own best guess (user decisions 2026-10-21)");
{
  // The rule: N = 10·max(s, 1 − s) to the nearest whole tenth, an exact .5
  // toward 5; the side s favours; N 5 -> "Could go either way"; N 10 -> "Nearly all".
  const g = (s) => { const t = guessTenths(s); return `${t.n} ${t.side}`; };
  check("guessTenths: 0.94 -> 9 man, 0.06 -> 9 woman, 0.90 -> 9, 0.84 -> 8, 0.951 -> 10, 0.62 -> 6 man, 0.38 -> 6 woman",
    g(0.94) === "9 man" && g(0.06) === "9 woman" && g(0.9) === "9 man" && g(0.84) === "8 man" && g(0.951) === "10 man" && g(0.62) === "6 man" && g(0.38) === "6 woman",
    [0.94, 0.06, 0.9, 0.84, 0.951, 0.62, 0.38].map(g).join(", "));
  check("an exact .5 rounds toward 5: 0.85 -> 8, 0.15 -> 8 woman, 0.95 -> 9, 0.75 -> 7, 0.55 / 0.45 -> 5; just past it rounds up: 0.8501 -> 9, 0.5501 -> 6",
    g(0.85) === "8 man" && g(0.15) === "8 woman" && g(0.95) === "9 man" && g(1 - 0.95) === "9 woman" && g(0.75) === "7 man" && guessTenths(0.55).n === 5 && guessTenths(0.45).n === 5
    && g(0.8501) === "9 man" && g(0.5501) === "6 man", [0.85, 0.15, 0.95, 0.05, 0.75, 0.55, 0.45, 0.8501, 0.5501].map(g).join(", "));
  let rule = true, ruleDetail = "";
  for (let i = 0; i <= 2000; i++) {
    const s = i / 2000, k = 10 * Math.max(s, 1 - s), { n, side } = guessTenths(s), m = guessTenths(1 - s);
    const tie = Math.abs(k - Math.floor(k) - 0.5) < 1e-9;
    const ok = Number.isInteger(n) && n >= 5 && n <= 10 && Math.abs(n - k) <= 0.5 + 1e-9 && (tie ? n === Math.floor(k) : n === Math.round(k))
      && side === (s > 0.5 ? "man" : "woman") && m.n === n && (s === 0.5 || m.side !== side);
    if (!ok) { rule = false; ruleDetail ||= `s ${s} -> ${n} ${side}`; }
  }
  check("every s 0…1 (step 0.0005): the nearest whole tenth on the favoured side, an exact .5 toward 5, 5…10, mirror-symmetric", rule, ruleDetail);
  check("sayText: best guess 0.94 -> 'About 9 in 10 listeners would say man'; 0.06 -> '… woman'; 0.97 -> 'Nearly all listeners would say man'",
    sayText(0.94, false) === "About 9 in 10 listeners would say man" && sayText(0.06, false) === "About 9 in 10 listeners would say woman"
    && sayText(0.97, false) === "Nearly all listeners would say man" && sayText(0.03, false) === "Nearly all listeners would say woman");
  check("a best guess that rounds to 5 (0.45 <= s <= 0.55, both ends included) says 'Could go either way'; 0.56 / 0.44 do not",
    [0.45, 0.47, 0.5, 0.53, 0.55].every((s) => sayText(s, false) === WIDE_TEXT)
    && sayText(0.56, false) === "About 6 in 10 listeners would say man" && sayText(0.44, false) === "About 6 in 10 listeners would say woman");
  check("wide stays 'Could go either way' whatever its best guess (0.05, 0.5, 0.97)",
    [0.05, 0.5, 0.97].every((s) => sayText(s, true) === WIDE_TEXT));
  const mid5 = heardAsAxis({ s: 0.5, sLow: 0.35, sHigh: 0.65, centre: { unsure: 0.3 } });
  check("non-wide, best guess 5 (s 0.5, tenths 3–7): split, the unsure line kept, bar unchanged",
    !mid5.wide && mid5.split && mid5.rangeText === WIDE_TEXT && mid5.unsureText === "About 3 in 10 might be unsure or say neither" && mid5.man === 0.3 && mid5.woman === 0.3, JSON.stringify(mid5));
  const lean = heardAsAxis({ s: 0.58, sLow: 0.35, sHigh: 0.75, centre: { unsure: 0.3 } });
  check("non-wide, best guess 0.58 (tenths 3–8; their middle 5.5 said 'Could go either way'): 'About 6 in 10 listeners would say man'",
    !lean.wide && !lean.split && lean.rangeText === "About 6 in 10 listeners would say man", lean.rangeText);
  // The user's report: typical voices read about a tenth low with the middle of the range.
  const typ = [[2.8, "About 9 in 10 listeners would say man", "6–10"], [2.2, "About 9 in 10 listeners would say man", "4–10"],
    [1.6, "About 8 in 10 listeners would say man", "3–10"], [-1.9, "About 9 in 10 listeners would say woman", "0–6"]];
  check("typical readings say the best guess, not the middle of the range: eta 2.8 (s 0.94, man 6–10, middle 8) -> About 9; 2.2 (s 0.90, 4–10, middle 7) -> About 9; 1.6 (s 0.83, 3–10, middle 6) -> About 8; -1.9 (s 0.13, man 0–6, middle 7 woman) -> About 9 woman",
    typ.every(([e, want, t]) => { const ax = heardAsAxis(sharesAt(e)); return ax.rangeText === want && ax.manTenths.join("–") === t; }),
    typ.map(([e]) => heardAsAxis(sharesAt(e)).rangeText).join(" | "));
  let oneSide = true, oneDetail = "";
  for (let k = -140; k <= 140; k++) {
    const sh = sharesAt(k / 20), ax = heardAsAxis(sh), t = ax.rangeText, { n, side } = guessTenths(sh.s);
    const [lo, hi] = side === "man" ? ax.manTenths : ax.womanTenths;
    const ok = ax.split ? t === WIDE_TEXT && ax.wide
      : /^(About [6-9] in 10|Nearly all) listeners would say (man|woman)$/.test(t) && !t.includes(" · ") && !t.includes("–")
        && t === (n >= 10 ? `Nearly all listeners would say ${side}` : `About ${n} in 10 listeners would say ${side}`)
        && n === Math.round(10 * Math.max(sh.s, 1 - sh.s)) && n >= lo && n <= hi && side === (ax.manTenths[0] + ax.manTenths[1] > 10 ? "man" : "woman");
    if (!ok) { oneSide = false; oneDetail ||= `eta ${k / 20}: ${t}`; }
  }
  check("eta -7..7: every non-split line is one side, the best guess s to the nearest tenth ('About N in 10' / 'Nearly all'), inside the bar's striped tenths, the side the bar leans to; no second half, no range; split only when wide (inside the tested range a best guess of 5 is always wide)", oneSide, oneDetail);
  const ex = (e) => heardAsAxis(sharesAt(e)).rangeText;
  check("old wording gone: no 'nearly all would say' / 'fewer than 1 in 10 would say' / ' · about' / a range, at the ends or the middle",
    [-7, -5, -3.5, -2.5, 2.5, 3.5, 5, 7].every((e) => !/nearly all would say|fewer than 1 in 10 would say| · about|\d–\d/i.test(ex(e))), [-7, 7].map(ex).join(" | "));
  const panelSrc = readFileSync(fileURLToPath(new URL("../../src/components/HeardAsPanel.jsx", import.meta.url)), "utf8");
  // Since the dome (2026-10-25) the sentence sits inside the arc, so the line says "inside the arc" (it said "under the bar").
  check("the 'More' text says the sentence is the best guess, halfway values toward 5, inside the striped part (no 'middle of that range')",
    panelSrc.includes("The sentence inside the arc gives the panel&apos;s best guess for the side more listeners would choose, rounded to a whole tenth (halfway values toward 5 in 10); the best guess always lies inside the striped part.")
    && !panelSrc.includes("gives the middle of that range"));
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
  check("screen-reader text is the bar's own description (man from the left, woman from the right, striped between), not the visible sentence — no best guess (none is drawn)",
    ax.srText === BAR_DESCRIPTION && BAR_DESCRIPTION === "Bar of listeners in tenths: would say man fills from the left, would say woman from the right, and the striped part between could go either way."
    && ax.rangeText === "About 9 in 10 listeners would say man" && !ax.srText.includes(ax.rangeText), ax.srText);
  let once = true, onceDetail = "";
  for (let k = -140; k <= 140; k++) {
    const a = heardAsAxis(sharesAt(k / 20));
    if (a.srText !== BAR_DESCRIPTION || a.srText.includes(a.rangeText) || /in 10|Nearly all|listeners would/.test(a.srText)) { once = false; onceDetail ||= `eta ${k / 20}: ${a.srText}`; }
  }
  check("eta -7..7: the bar's label never repeats the sentence (it was 'the bar. <sentence>.', so screen readers read the sentence twice: label, then the visible line)", once, onceDetail);
  for (const e of [6, -6]) {
    const t = heardAsAxis(sharesAt(e)).srText;
    check(`screen-reader text at eta ${e} uses the end words, no '0 in 10' / '10 in 10'`, !/\b(0|10) in 10/.test(t), t);
  }
  const w = heardAsAxis(sharesAt(0));
  check("wide: the bar's label is the same description (the visible 'Could go either way' is read from the line itself; not 'Can't tell yet', no hidden ranges); no unsure line then",
    w.srText === BAR_DESCRIPTION && w.rangeText === WIDE_TEXT && !/in 10/.test(w.srText) && !w.srText.includes("Can't tell") && !w.srText.includes("Best guess") && w.unsureText === null, w.srText);
  const panelSrc = readFileSync(fileURLToPath(new URL("../../src/components/HeardAsPanel.jsx", import.meta.url)), "utf8");
  // Since the dome (2026-10-25) the sentence is drawn on two lines inside it (heardAsDome.js domeLines: joined with one
  // space they are the sentence word for word — tests/ml/heard-as-dome-test.js).
  check("the panel labels the bar with srText and shows the sentence as plain visible text (not aria-hidden)",
    panelSrc.includes('role="img" aria-label={axis.srText}') && /data-heard-as-range=""[^>]*>\s*\{domeLines\(view\.axis\.rangeText\)/.test(panelSrc)
    && !/data-heard-as-range=""[^>]*aria-hidden/.test(panelSrc));
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
