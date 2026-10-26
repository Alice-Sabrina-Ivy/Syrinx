// heard-as-axis-test.js — src/components/heardAsAxisModel.js: the "Likely
// heard as" panel's numbers and words. Since the user decision of 2026-10-26
// ("3 parts, add to 10"; the range as a bracket): the three-way shares at the
// best guess (heardAsShares().centre) as whole tenths that sum to 10 (largest
// remainder, mirror-symmetric, deterministic); the sentence names the bigger
// side with its tenths; the line under it names the rest so the stated
// numbers add up to 10; split ("Could go either way") when the two-way range
// is wide or the sides differ by <= 1 tenth; the bracket = where the bigger
// side's edge could fall, rounded outward to tenth boundaries, containing the
// drawn edge; screen-reader text = the dome's own description; frozen words
// (tests/ml/fixtures/heard-as-axis-words-golden.json, regenerated for the
// 2026-10-26 decision); gender symmetry (a mirrored estimate gives mirrored
// tenths / bracket and the same words with man / woman swapped).
//
//   node tests/ml/heard-as-axis-test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heardAsShares, shareTenths } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { heardAsAxis, AXIS_ENDS, unsureWords, shortReason, UNVOICED_SHARE, quickCheck, WIDE_TEXT, BAR_DESCRIPTION, SPLIT_DESCRIPTION, threeTenths, sayText, restText } from "../../src/components/heardAsAxisModel.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

// shares at a chosen eta (F0 fixed at 150 Hz; meter logit solved for it)
const LN = Math.log(150);
const sharesAt = (eta, f0 = 150) => heardAsShares((eta - C.a - C.bLnF0 * Math.log(f0)) / C.bMeter, Math.log(f0));
const GRID = Array.from({ length: 281 }, (_, k) => (k - 140) / 20);
const panelSrc = readFileSync(fileURLToPath(new URL("../../src/components/HeardAsPanel.jsx", import.meta.url)), "utf8");
const swapSide = (t) => t?.replace(/would say (man|woman)\b/g, (m, w) => `would say ${w === "man" ? "woman" : "man"}`);
void LN;

console.log("three parts adding to 10 (threeTenths)");
{
  let sum = true, near = true, sym = true, det = true, detail = "";
  // a dense grid of three-way shares, incl. exact ties
  const pts = [];
  for (let m = 0; m <= 100; m++) for (let u = 0; u <= 100 - m; u++) pts.push([m / 100, u / 100, (100 - m - u) / 100]);
  for (let i = 0; i < 4000; i++) { const a = Math.random(), b = Math.random() * (1 - a); pts.push([a, b, 1 - a - b]); }
  pts.push([0.35, 0.3, 0.35], [0.45, 0.1, 0.45], [0.25, 0.5, 0.25], [0.15, 0.7, 0.15], [1 / 3, 1 / 3, 1 / 3]);
  for (const [man, unsure, woman] of pts) {
    const t = threeTenths({ man, unsure, woman }), r = threeTenths({ man: woman, unsure, woman: man });
    if (t.man + t.unsure + t.woman !== 10 || [t.man, t.unsure, t.woman].some((x) => !Number.isInteger(x) || x < 0)) { sum = false; detail ||= `${[man, unsure, woman]} -> ${JSON.stringify(t)}`; }
    // (one exception, by the symmetric tie rule: man and woman both exactly x.5 tenths and unsure a whole
    // number of tenths — the missing tenth can only go to unsure; the calibration's unsure floor (0.02)
    // keeps real readings away from it only when unsure is 0, so it is skipped here for every whole unsure)
    const halfTie = Math.abs(10 * man - Math.floor(10 * man) - 0.5) < 1e-9 && Math.abs(10 * woman - Math.floor(10 * woman) - 0.5) < 1e-9;
    if (!halfTie && [[t.man, man], [t.unsure, unsure], [t.woman, woman]].some(([x, v]) => x < Math.floor(10 * v + 1e-9) || x > Math.ceil(10 * v - 1e-9))) { near = false; detail ||= `${[man, unsure, woman]} -> ${JSON.stringify(t)}`; }
    if (r.man !== t.woman || r.woman !== t.man || r.unsure !== t.unsure) { sym = false; detail ||= `mirror ${[man, unsure, woman]}`; }
    if (JSON.stringify(threeTenths({ man, unsure, woman })) !== JSON.stringify(t)) det = false;
  }
  check(`every split (${pts.length}): whole tenths, sum exactly 10`, sum, detail);
  check("each part is its share's floor or ceiling (largest remainder; except the exact half-tenth man / woman tie, whose missing tenth goes to unsure)", near, detail);
  check("mirror-symmetric: swapping man and woman swaps their tenths exactly, unsure unchanged", sym, detail);
  check("deterministic", det);
  check("largest remainder: 0.824 / 0.151 / 0.024 -> 8 / 2 / 0; 0.38 / 0.38 / 0.24 -> man / woman tie keeps them equal",
    JSON.stringify(threeTenths({ man: 0.824, unsure: 0.151, woman: 0.025 })) === JSON.stringify({ man: 8, unsure: 2, woman: 0 })
    && (() => { const t = threeTenths({ man: 0.38, unsure: 0.24, woman: 0.38 }); return t.man === t.woman && t.man + t.unsure + t.woman === 10; })());
  check("tie rules: 0.35 / 0.30 / 0.35 -> 3 / 4 / 3 (one missing tenth goes to unsure); 0.45 / 0.10 / 0.45 -> 4 / 2 / 4; 0.25 / 0.5 / 0.25 -> 2 / 6 / 2; 0.16 / 0.68 / 0.16 -> 2 / 6 / 2 (two missing tenths go to man and woman)",
    JSON.stringify(threeTenths({ man: 0.35, unsure: 0.3, woman: 0.35 })) === JSON.stringify({ man: 3, unsure: 4, woman: 3 })
    && JSON.stringify(threeTenths({ man: 0.45, unsure: 0.1, woman: 0.45 })) === JSON.stringify({ man: 4, unsure: 2, woman: 4 })
    && JSON.stringify(threeTenths({ man: 0.25, unsure: 0.5, woman: 0.25 })) === JSON.stringify({ man: 2, unsure: 6, woman: 2 })
    && JSON.stringify(threeTenths({ man: 0.16, unsure: 0.68, woman: 0.16 })) === JSON.stringify({ man: 2, unsure: 6, woman: 2 }),
    [[0.35, 0.3], [0.45, 0.1], [0.25, 0.5]].map(([a, b]) => JSON.stringify(threeTenths({ man: a, unsure: b, woman: 1 - a - b }))).join(" "));
}

console.log("\nthe axis: tenths = the centre shares, words = the drawing");
{
  let ok = true, detail = "";
  for (const f0 of [100, 150, 220]) for (const e of GRID) {
    const sh = sharesAt(e, f0), ax = heardAsAxis(sh), t = ax.tenths;
    const want = threeTenths(sh.centre);
    let good = JSON.stringify(t) === JSON.stringify(want) && ax.man === t.man / 10 && ax.woman === t.woman / 10;
    // split rule
    const [a, b] = shareTenths([sh.sLow, sh.sHigh]);
    const wide = b - a >= 8, split = wide || Math.abs(t.man - t.woman) <= 1;
    good &&= ax.wide === wide && ax.split === split;
    if (split) good &&= ax.rangeText === WIDE_TEXT && ax.unsureText === null && ax.side === null && ax.bracket === null;
    else {
      const side = t.man > t.woman ? "man" : "woman", other = side === "man" ? "woman" : "man", n = t[side];
      good &&= ax.side === side && ax.rangeText === (n >= 10 ? `Nearly all listeners would say ${side}` : `About ${n} in 10 listeners would say ${side}`);
      // the numbers stated add up to 10 ("fewer than 1" = 0)
      const nums = [...`${ax.rangeText} ${ax.unsureText}`.replace("Nearly all", "About 10 in 10").replace(/Fewer than 1 in 10/, "About 0 in 10").matchAll(/(\d+) in 10/g)].map((m) => Number(m[1]));
      const stated = nums.reduce((x, y) => x + y, 0);
      good &&= stated === 10 && nums.length === (t[other] >= 1 ? 3 : 2);
      good &&= ax.unsureText.startsWith(t.unsure ? `About ${t.unsure} in 10 unsure or neither` : "Fewer than 1 in 10 unsure or neither");
      good &&= t[other] >= 1 ? ax.unsureText.endsWith(`\u00a0· about ${t[other]} in 10 would say ${other}`) : !ax.unsureText.includes("·");
      // the bracket: tenth boundaries, contains the drawn edge, = the side's range rounded outward
      const [lo, hi] = ax.bracket, edge = side === "man" ? t.man : 10 - t.woman;
      const [rl, rh] = side === "man" ? shareTenths(sh.man) : shareTenths(sh.woman).map((x) => 10 - x).reverse();
      good &&= Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi <= 10 && lo < hi && lo <= edge && edge <= hi
        && lo === Math.min(rl, edge) && hi === Math.max(rh, edge);
    }
    if (!good) { ok = false; detail ||= `f0 ${f0} eta ${e}: ${JSON.stringify(ax)}`; }
  }
  check("eta -7..7 at 100 / 150 / 220 Hz: tenths = threeTenths(centre); split = wide or sides within 1; sentence = the bigger side's drawn tenths; the stated numbers add up to 10; the bracket on tenth boundaries contains the drawn edge (the side's range rounded outward)", ok, detail);
  check("ends: would say man on the left, would say woman on the right", AXIS_ENDS.left === "would say man" && AXIS_ENDS.right === "would say woman");
  const w = heardAsAxis(sharesAt(-1.5));
  check("example eta -1.5: 1 / 2 / 7, 'About 7 in 10 listeners would say woman', 'About 2 in 10 unsure or neither · about 1 in 10 would say man', bracket 0–9",
    JSON.stringify(w.tenths) === JSON.stringify({ man: 1, unsure: 2, woman: 7 }) && w.rangeText === "About 7 in 10 listeners would say woman"
    && w.unsureText === "About 2 in 10 unsure or neither\u00a0· about 1 in 10 would say man" && w.bracket.join() === "0,9", JSON.stringify(w));
  const m = heardAsAxis(sharesAt(4));
  check("example eta 4: 10 / 0 / 0, 'Nearly all listeners would say man', 'Fewer than 1 in 10 unsure or neither', bracket 7–10",
    m.rangeText === "Nearly all listeners would say man" && m.unsureText === "Fewer than 1 in 10 unsure or neither" && m.bracket.join() === "7,10", JSON.stringify(m));
  check("example eta 0: split, no line under it, no bracket", heardAsAxis(sharesAt(0)).split && heardAsAxis(sharesAt(0)).unsureText === null && heardAsAxis(sharesAt(0)).bracket === null);
  check("sayText / restText: sides within 1 tenth are split even when not wide (4 / 2 / 4, 4 / 3 / 3), 6 / 2 / 2 is not",
    sayText({ man: 4, unsure: 2, woman: 4 }, false) === WIDE_TEXT && sayText({ man: 4, unsure: 3, woman: 3 }, false) === WIDE_TEXT
    && restText({ man: 4, unsure: 3, woman: 3 }, false) === null && sayText({ man: 6, unsure: 2, woman: 2 }, false) === "About 6 in 10 listeners would say man"
    && restText({ man: 6, unsure: 2, woman: 2 }, false) === "About 2 in 10 unsure or neither\u00a0· about 2 in 10 would say woman");
  check("unsureWords: 0 -> fewer than 1, 1 -> about 1, 4 -> about 4", unsureWords(0) === "fewer than 1 in 10" && unsureWords(1) === "about 1 in 10" && unsureWords(4) === "about 4 in 10");
}

console.log("\nwords (frozen 2026-10-26)");
{
  const golden = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/heard-as-axis-words-golden.json", import.meta.url)), "utf8"));
  let same = 0, detail = "";
  for (const [eta, rangeText, unsureText, m, u, w, wide, split, blo, bhi] of golden.rows) {
    const ax = heardAsAxis(sharesAt(eta));
    const got = [ax.rangeText, ax.unsureText, ax.tenths.man, ax.tenths.unsure, ax.tenths.woman, ax.wide ? 1 : 0, ax.split ? 1 : 0, ax.bracket?.[0] ?? null, ax.bracket?.[1] ?? null];
    const want = [rangeText, unsureText, m, u, w, wide, split, blo, bhi];
    if (got.every((v, i) => v === want[i])) same++;
    else if (!detail) detail = `eta ${eta}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`;
  }
  check(`sentence, line under it, tenths, wide / split and bracket identical on all ${golden.rows.length} frozen estimates`, same === golden.rows.length && golden.rows.length === 281, detail);
}

console.log("\nwords: no percentages, no verdicts, 'Can't tell yet' only for no reading yet");
{
  let noPct = true, noVerdict = true, noCantTell = true;
  for (const e of GRID) {
    const ax = heardAsAxis(sharesAt(e));
    for (const t of [ax.rangeText, ax.unsureText ?? "", ax.srText]) {
      if (t.includes("%")) noPct = false;
      if (/likely (a )?(man|woman)|\bis a (man|woman)|sounds like a/i.test(t)) noVerdict = false;
      if (/can.t tell/i.test(t)) noCantTell = false;
    }
  }
  check("no '%' anywhere", noPct);
  check("no verdict wording", noVerdict);
  check("no shown reading says 'Can't tell yet'", noCantTell);
  check("'Can't tell yet' stays only for no reading yet: the panel's 'short' reason starts with it",
    panelSrc.includes(`\n  short: () => "Can't tell yet — keep talking, it needs a few seconds of running speech",`));
  const q = (w) => `${String.fromCharCode(92)}u201c${w}${String.fromCharCode(92)}u201d`;
  check("the panel's 'More' text names the split state by its words", panelSrc.includes(`Some voices get ${q("Could go either way")} most of the time.`) && !panelSrc.includes(q("Can't tell yet")));
  check("the 'More' text describes the three parts and the bracket (no 'striped part' = 'could go either way' range)",
    panelSrc.includes("tenths of listeners that add up to 10") && panelSrc.includes("The thin bracket outside the arc") && !panelSrc.includes("The striped part of the arc is the range"));
  check("WIDE_TEXT unchanged", WIDE_TEXT === "Could go either way — listeners would be split");
}

console.log("\nscreen-reader text");
{
  check("one sentence describing the three parts and the bracket; the visible sentence is not repeated",
    BAR_DESCRIPTION === "Arc of ten tenths of listeners: would say man fills from the left end, would say woman from the right end, unsure or neither in grey between, and a thin bracket outside the arc marks the likely range of the larger part's edge."
    && (BAR_DESCRIPTION.match(/\. |\.$/g) ?? []).length === 1);
  check("split readings get their own one-sentence label (no grey, no bracket drawn there)",
    SPLIT_DESCRIPTION === "Arc of ten tenths of listeners, striped as a whole: listeners would be split between would say man and would say woman."
    && !/grey|bracket/.test(SPLIT_DESCRIPTION) && (SPLIT_DESCRIPTION.match(/\. |\.$/g) ?? []).length === 1);
  let once = true, onceDetail = "";
  for (const e of GRID) {
    const a = heardAsAxis(sharesAt(e));
    if (a.srText !== (a.split ? SPLIT_DESCRIPTION : BAR_DESCRIPTION) || /in 10|Nearly all/.test(a.srText)) { once = false; onceDetail ||= `eta ${e}`; }
  }
  check("eta -7..7: the label is the description only — BAR_DESCRIPTION, SPLIT_DESCRIPTION when split", once, onceDetail);
  check("the panel labels the dome with srText and shows the sentence as plain visible text (not aria-hidden)",
    panelSrc.includes('role="img" aria-label={axis.srText}') && /data-heard-as-range=""[^>]*>\s*\{domeLines\(view\.axis\.rangeText\)/.test(panelSrc)
    && !/data-heard-as-range=""[^>]*aria-hidden/.test(panelSrc));
}

console.log("\ngender symmetry (mirrored estimate -> mirrored tenths and bracket, same words with man / woman swapped)");
{
  let ok = true, detail = "";
  for (const f0 of [120, 150, 200]) for (const e of GRID.filter((x) => x > 0)) {
    const A = heardAsAxis(sharesAt(e, f0)), B = heardAsAxis(sharesAt(-e, f0));
    const good = A.tenths.man === B.tenths.woman && A.tenths.woman === B.tenths.man && A.tenths.unsure === B.tenths.unsure
      && A.wide === B.wide && A.split === B.split
      && (A.split ? A.rangeText === B.rangeText && B.bracket === null && A.bracket === null
        : swapSide(A.rangeText) === B.rangeText && swapSide(A.unsureText) === B.unsureText && A.bracket[0] === 10 - B.bracket[1] && A.bracket[1] === 10 - B.bracket[0]);
    if (!good) { ok = false; detail ||= `f0 ${f0} eta ±${e}: ${JSON.stringify([A, B])}`; }
  }
  check("eta ±0.05…±7 at 120 / 150 / 200 Hz: tenths swap, bracket mirrors (lo <-> 10 − hi), words swap man <-> woman", ok, detail);
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

console.log("\nthe 250 ms check (2026-10-21, H3)");
check("no reading shown -> look for the first one (never a full update: the pitch-only warning is not fed)",
  quickCheck(false, null) === "first" && quickCheck(false, "speaking") === "first" && quickCheck(false, "sustained") === "first");
check("a reading shown -> a full update only when a held note starts, else nothing (the 2 s timer updates it)",
  quickCheck(true, "sustained") === "update" && quickCheck(true, null) === null && quickCheck(true, "speaking") === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
