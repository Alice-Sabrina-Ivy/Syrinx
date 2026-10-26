// heard-as-dome-test.js — src/components/heardAsDome.js: the "Likely heard as"
// dome (owner's choice 2026-10-25; the split bar bent into a semicircle of ten
// tenth-segments). Checks the drawing numbers only — the words and tenths are
// heardAsAxisModel.js's (tests/ml/heard-as-axis-test.js): ten segments from the
// left foot ("would say man") to the right foot ("would say woman"), on the
// two radii, 2 px apart, the middle boundary at the top; the segment kinds
// match the model's solid / striped tenths in every state (and mirror with the
// estimate); the sentence's two lines are the sentence word for word; and the
// panel wires them as described (sentence after the pitch-only note in the
// DOM, no transition on the dome).
//
//   node tests/ml/heard-as-dome-test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heardAsShares } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { heardAsAxis, sayText, WIDE_TEXT } from "../../src/components/heardAsAxisModel.js";
import { DOME, DOME_PATHS, domeKinds, domeLines, EITHER_WORDS } from "../../src/components/heardAsDome.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const LN = Math.log(150);
const sharesAt = (eta) => heardAsShares((eta - C.a - C.bLnF0 * LN) / C.bMeter, LN);

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

console.log("\nsegment kinds = the model's tenths");
{
  let ok = true, detail = "";
  for (let k = -140; k <= 140; k++) {
    const ax = heardAsAxis(sharesAt(k / 20)), kinds = domeKinds(ax);
    const a = ax.manTenths[0], c = ax.womanTenths[0], width = ax.manTenths[1] - ax.manTenths[0];
    const want = [...Array(a).fill("man"), ...Array(width).fill("either"), ...Array(c).fill("woman")];
    if (kinds.length !== 10 || want.length !== 10 || kinds.join() !== want.join()) { ok = false; detail ||= `eta ${k / 20}: ${kinds.join()} vs ${want.join()}`; }
  }
  check("eta -7..7: deep tenths = A from the left, light = C from the right, striped = the range's width between", ok, detail);
  let sym = true;
  for (let k = 1; k <= 140; k++) {
    const A = domeKinds(heardAsAxis(sharesAt(k / 20))), B = domeKinds(heardAsAxis(sharesAt(-k / 20)));
    const swap = (x) => (x === "man" ? "woman" : x === "woman" ? "man" : x);
    if (A.join() !== B.slice().reverse().map(swap).join()) { sym = false; break; }
  }
  check("gender symmetry: a mirrored estimate gives the mirrored dome (man <-> woman)", sym);
  const wide = domeKinds(heardAsAxis(sharesAt(0)));
  check("wide ('Could go either way'): mostly stripes (>= 8 tenths)", wide.filter((x) => x === "either").length >= 8, wide.join());
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
  check("key word for the stripes", EITHER_WORDS === "could go either way");
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
  check("hooks kept: data-heard-as-axis with wide / split-man / split-woman / split-guess, data-split-bar, data-split-part, data-axis-ends, data-axis-key, data-heard-as-axis-empty",
    ["data-heard-as-axis=\"\"", "data-axis-wide=", "data-split-man=", "data-split-woman=", "data-split-guess=", "data-split-bar=\"\"", "data-split-part={k}", "data-axis-ends=\"\"", "data-axis-key={kind}", "data-heard-as-axis-empty=\"\""].every((h) => dome.includes(h)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
