// heard-as-dome-test.js — src/components/heardAsDome.js: the "Likely heard as"
// dome (owner's choice 2026-10-25; three parts adding to 10 and a bracket,
// user decision 2026-10-26). Checks the drawing numbers — the words and tenths
// are heardAsAxisModel.js's (tests/ml/heard-as-axis-test.js): ten segments
// from the left foot ("would say man") to the right foot ("would say woman"),
// on the two radii, 2 px apart, the middle boundary at the top; the segment
// kinds are exactly the tenths in the words (man from the left, woman from the
// right, unsure between; all striped when split) and mirror with the
// estimate; the bracket sits just outside the arc with its ends on segment
// boundaries; the sentence's two lines are the sentence word for word; and
// the panel wires them as described (sentence after the pitch-only note in
// the DOM, no transition on the dome).
//
//   node tests/ml/heard-as-dome-test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heardAsShares } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { heardAsAxis, sayText, WIDE_TEXT } from "../../src/components/heardAsAxisModel.js";
import { DOME, DOME_PATHS, domeKinds, domeLines, domeBracketPath, UNSURE_WORDS, BRACKET_WORDS } from "../../src/components/heardAsDome.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const LN = Math.log(150);
const sharesAt = (eta, f0 = 150) => heardAsShares((eta - C.a - C.bLnF0 * Math.log(f0)) / C.bMeter, Math.log(f0));
void LN;

// M x y A R R 0 0 1 x y L x y A r r 0 0 0 x y Z -> the four corners
function corners(d) {
  const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
  // M(2) A(R R 0 0 1 x y = 7) L(2) A(r r 0 0 0 x y = 7)
  return { o0: [n[0], n[1]], R: n[2], o1: [n[7], n[8]], i1: [n[9], n[10]], r: n[11], i0: [n[16], n[17]] };
}
const rad = ([x, y]) => Math.hypot(x - DOME.cx, y - DOME.cy);
const ang = ([x, y]) => (Math.atan2(DOME.cy - y, x - DOME.cx) * 180) / Math.PI;

console.log("geometry");
{
  check("ten segments", DOME_PATHS.length === 10);
  const cs = DOME_PATHS.map(corners);
  check("every corner on its radius (outer R, inner r; ±0.02 px)",
    cs.every((c) => c.R === DOME.R && c.r === DOME.r && [c.o0, c.o1].every((p) => Math.abs(rad(p) - DOME.R) < 0.02) && [c.i0, c.i1].every((p) => Math.abs(rad(p) - DOME.r) < 0.02)));
  check("left foot = tenth 0 (would say man), right foot = tenth 9 (would say woman), both on the base line",
    Math.abs(cs[0].o0[0] - (DOME.cx - DOME.R)) < 0.02 && cs[0].o0[1] === DOME.cy && cs[0].i0[1] === DOME.cy
    && Math.abs(cs[9].o1[0] - (DOME.cx + DOME.R)) < 0.02 && cs[9].o1[1] === DOME.cy && cs[9].i1[1] === DOME.cy);
  let order = true, gaps = true, gapDetail = "";
  for (let i = 0; i < 10; i++) {
    const c = cs[i];
    if (!(ang(c.o0) > ang(c.o1) && ang(c.i0) > ang(c.i1))) order = false;   // drawn left to right
    if (i < 9) {
      const n = cs[i + 1];
      const go = Math.hypot(c.o1[0] - n.o0[0], c.o1[1] - n.o0[1]), gi = Math.hypot(c.i1[0] - n.i0[0], c.i1[1] - n.i0[1]);
      if (Math.abs(go - DOME.gap) > 0.05 || Math.abs(gi - DOME.gap) > 0.05) { gaps = false; gapDetail ||= `${i}|${i + 1}: ${go.toFixed(2)} / ${gi.toFixed(2)}`; }
    }
  }
  check("segments run left to right (man foot to woman foot), 18° each", order);
  check(`${DOME.gap} px of panel between every two neighbours, at both radii`, gaps, gapDetail);
  const mid = (cs[4].o1[0] + cs[5].o0[0]) / 2;
  check("the 5 | 5 boundary is at the top, under the middle tick", Math.abs(mid - DOME.cx) < 0.02 && DOME.tickBottom < DOME.cy - DOME.R);
  check("the dome fits its viewBox", cs.every((c) => [c.o0, c.o1, c.i0, c.i1].every(([x, y]) => x >= 0 && x <= DOME.w && y >= 0 && y <= DOME.h)) && DOME.cy - DOME.R > 0);
}

console.log("\nsegment kinds = the tenths in the words");
{
  let ok = true, detail = "";
  for (const f0 of [110, 150, 210]) for (let k = -140; k <= 140; k++) {
    const ax = heardAsAxis(sharesAt(k / 20, f0)), kinds = domeKinds(ax), t = ax.tenths;
    const want = ax.split ? Array(10).fill("split") : [...Array(t.man).fill("man"), ...Array(t.unsure).fill("unsure"), ...Array(t.woman).fill("woman")];
    const count = (x) => kinds.filter((y) => y === x).length;
    const good = kinds.length === 10 && kinds.join() === want.join()
      && (ax.split || (count("man") === t.man && count("unsure") === t.unsure && count("woman") === t.woman));
    if (!good) { ok = false; detail ||= `f0 ${f0} eta ${k / 20}: ${kinds.join()} vs ${want.join()}`; }
  }
  check("eta -7..7 at 110 / 150 / 210 Hz: deep = tenths.man from the left, light = tenths.woman from the right, grey = tenths.unsure between; all striped when split", ok, detail);
  let sym = true;
  for (let k = 1; k <= 140; k++) {
    const A = domeKinds(heardAsAxis(sharesAt(k / 20))), B = domeKinds(heardAsAxis(sharesAt(-k / 20)));
    const swap = (x) => (x === "man" ? "woman" : x === "woman" ? "man" : x);
    if (A.join() !== B.slice().reverse().map(swap).join()) { sym = false; break; }
  }
  check("gender symmetry: a mirrored estimate gives the mirrored dome (man <-> woman)", sym);
  const mid = domeKinds(heardAsAxis(sharesAt(0)));
  check("eta 0 ('Could go either way'): all ten striped", mid.every((x) => x === "split"), mid.join());
  const one = domeKinds(heardAsAxis(sharesAt(-1.5)));
  check("eta -1.5 (1 / 2 / 7): man, unsure, unsure, then seven woman", one.join() === ["man", "unsure", "unsure", ...Array(7).fill("woman")].join(), one.join());
}

console.log("\nthe bracket");
{
  const angAt = (b) => 180 - 18 * b;
  const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
  check("no bracket when split (null path)", domeBracketPath(null) === null && heardAsAxis(sharesAt(0)).bracket === null);
  let ok = true, detail = "";
  for (let lo = 0; lo < 10; lo++) for (let hi = lo + 1; hi <= 10; hi++) {
    const d = domeBracketPath([lo, hi]), n = nums(d);
    // M cap-in L cap-out M arc-start A bR bR 0 large 1 arc-end M cap-in L cap-out
    const pts = [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]], [n[11], n[12]], [n[13], n[14]], [n[15], n[16]]];
    const radii = [DOME.bCapIn, DOME.bCapOut, DOME.bR, DOME.bR, DOME.bCapIn, DOME.bCapOut];
    const angs = [lo, lo, lo, hi, hi, hi].map(angAt);
    const good = n[6] === DOME.bR && n[7] === DOME.bR && n[8] === 0 && n[9] === 0 && n[10] === 1 && n.length === 17
      && pts.every((p, i) => Math.abs(rad(p) - radii[i]) < 0.02 && Math.abs(ang(p) - angs[i]) < 0.02)
      && pts.every(([x, y]) => x >= 0 && x <= DOME.w && y >= 0 && y <= DOME.h);
    if (!good) { ok = false; detail ||= `${lo}-${hi}: ${d}`; }
  }
  check("every [lo, hi]: an arc at radius bR from boundary lo to boundary hi (left to right) with radial caps at both ends, all inside the viewBox", ok, detail);
  check("just outside the dome: a gap between the outer edge and the bracket's stroke, caps never touch the segments, the middle tick above the bracket",
    DOME.bR - DOME.bW / 2 - DOME.R >= 2 && DOME.bCapIn > DOME.R + 1 && DOME.tickBottom < DOME.cy - (DOME.bR + DOME.bW / 2) && DOME.tickBottom < DOME.cy - DOME.bCapOut && DOME.tickTop >= 0);
  let contains = true, cDetail = "";
  for (const f0 of [110, 150, 210]) for (let k = -140; k <= 140; k++) {
    const ax = heardAsAxis(sharesAt(k / 20, f0));
    if (ax.split) continue;
    const edge = ax.side === "man" ? ax.tenths.man : 10 - ax.tenths.woman;
    if (!(ax.bracket[0] <= edge && edge <= ax.bracket[1])) { contains = false; cDetail ||= `eta ${k / 20}: ${ax.bracket} edge ${edge}`; }
  }
  check("the bracket contains the bigger side's drawn edge (eta -7..7, three F0s)", contains, cDetail);
}

console.log("\nthe sentence on two lines");
{
  let ok = true, detail = "";
  const texts = new Set([WIDE_TEXT]);
  for (let i = 0; i <= 1000; i++) for (const w of [false, true]) texts.add(sayText(i / 1000, w));
  for (const t of texts) {
    const l = domeLines(t);
    if (l.join(" ") !== t || l.length !== 2 || !l[1].startsWith("listeners ") || l[0].length >= l[1].length) { ok = false; detail ||= `${t} -> ${JSON.stringify(l)}`; }
  }
  check(`every sentence the panel can show (${texts.size}): two lines, joined with one space = the sentence, the shorter first, the second from "listeners"`, ok, detail);
  check("the mockup's break", JSON.stringify(domeLines("About 6 in 10 listeners would say woman")) === JSON.stringify(["About 6 in 10", "listeners would say woman"])
    && JSON.stringify(domeLines(WIDE_TEXT)) === JSON.stringify(["Could go either way —", "listeners would be split"]));
  check("a text without 'listeners' stays one line, unchanged", JSON.stringify(domeLines("Nearly all would say man")) === JSON.stringify(["Nearly all would say man"]));
  check("key words for the grey part and the bracket", UNSURE_WORDS === "unsure or neither" && BRACKET_WORDS === "likely range");
}

console.log("\npanel wiring");
{
  const panel = readFileSync(fileURLToPath(new URL("../../src/components/HeardAsPanel.jsx", import.meta.url)), "utf8");
  const iNote = panel.indexOf("{PITCH_ONLY_TEXT}"), iRange = panel.indexOf("data-heard-as-range="), iUnsure = panel.indexOf("data-heard-as-unsure=");
  check("the sentence overlay comes after the pitch-only note and before the unsure line (screen readers: description, note, sentence — as with the bar)",
    iNote > 0 && iRange > iNote && iUnsure > iRange);
  check("the sentence is drawn as the model's words on domeLines' two lines", /\{domeLines\(view\.axis\.rangeText\)\.map\(/.test(panel));
  check("the dome draws DOME_PATHS (shown and empty) with the bar's role img label", (panel.match(/DOME_PATHS/g) ?? []).length >= 3 && panel.includes('role="img" aria-label={axis.srText}'));
  const dome = panel.slice(panel.indexOf("const DOME_BOX"), panel.indexOf("export function HeardAsPanel("));
  check("no transition / animation on the dome (segments jump between tenths; main-thread budget)", !/transition|animate/.test(dome.replace(/\/\/.*$/gm, "")));
  check("hooks: data-heard-as-axis with wide / split / split-man / split-woman / split-guess / tenths-*, data-split-bar, data-split-part, data-bracket(-lo / -hi / -side), data-axis-ends, data-axis-key, data-heard-as-axis-empty",
    ["data-heard-as-axis=\"\"", "data-axis-wide=", "data-axis-split=", "data-split-man=", "data-split-woman=", "data-split-guess=", "data-tenths-man=", "data-tenths-unsure=", "data-tenths-woman=",
      "data-split-bar=\"\"", "data-split-part={k}", "data-bracket=\"\"", "data-bracket-lo=", "data-bracket-hi=", "data-bracket-side=", "data-axis-ends=\"\"", "data-axis-key={kind}", "data-heard-as-axis-empty=\"\""].every((h) => dome.includes(h)));
  check("the striped key ('could go either way') only on split readings, in the grey key's slot; the bracket's keys kept invisible there",
    !panel.includes("EITHER_WORDS") && !panel.includes('key("either")') && /\{split\s*\? <span[^>]*data-axis-item="split">\{key\("split"\)\}\{SPLIT_WORDS\}/.test(panel)
    && panel.includes('<BracketKey where="key" hide={split} />') && panel.includes('<BracketKey where="legend" hide={split} />') && panel.includes("<DomeKey split={axis.split} />"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
