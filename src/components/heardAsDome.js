// heardAsDome.js — the "Likely heard as" DOME (owner's choice 2026-10-25: the
// "Twin columns" meters with the "Gauges" mockup's Likely-heard-as panel). It
// replaced the 2026-10-20 split bar as the panel's drawing; the model —
// numbers, words, screen-reader text — is heardAsAxisModel.js (three parts
// adding to 10 since 2026-10-26). Pure numbers only (no React), so tests/ml/heard-as-dome-test.js
// checks them in Node.
//
// A semicircle from "would say man" (LEFT foot) to "would say woman" (RIGHT
// foot) made of ten tenth-segments of listeners, in the cue strip's
// orientation. Since user decision 2026-10-26 ("3 parts, add to 10") the
// segments are the model's THREE PARTS (heardAsAxisModel.js threeTenths):
// "would say man" deep indigo from the left, "would say woman" light indigo
// from the right, "unsure or neither" neutral grey between — counting
// segments gives the numbers in the words. A thin BRACKET just outside the
// outer edge (domeBracketPath) spans where the bigger side's edge could fall;
// split readings ("Could go either way") stripe the whole dome and have no
// bracket. 2 px of panel show between two segments; a small tick above the
// top marks the middle (5 in 10). The panel's sentence sits centred inside
// the dome, on two lines (domeLines).
// (2026-10-25 … 2026-10-26: solid man / woman = the low ends of the two-way
// range, stripes between = "could go either way", the range's width.)
//
// Geometry: viewBox DOME.w × DOME.h, centre (cx, cy) on the base line, outer
// radius R, inner radius r — the mockup's 144 / 118 (its 392-px-wide drawing
// had 52 px of margin each side; here the box is the dome, 300 px at most).

// The bracket: radius bR (outer edge + bR − R − stroke / 2 of gap), stroke bW,
// radial end caps from bCapIn to bCapOut; the middle tick sits above it
// (tickTop … tickBottom, shortened from 3 … 9 for the bracket in 2026-10-26).
export const DOME = Object.freeze({
  w: 300, h: 157, cx: 150, cy: 156, R: 144, r: 118, gap: 2, tickTop: 0.5, tickBottom: 4.5,
  bR: 149, bW: 1.5, bCapIn: 146, bCapOut: 150,
});

const r2 = (v) => Math.round(v * 100) / 100;
const pt = (deg, rho) => {
  const t = (deg * Math.PI) / 180;
  return `${r2(DOME.cx + rho * Math.cos(t))} ${r2(DOME.cy - rho * Math.sin(t))}`;
};

/** SVG path of tenth i (0 = leftmost, the "would say man" end), 18° each,
 * trimmed by half the gap at every boundary with a neighbour (a constant-width
 * gap: the angle trimmed is gap / 2 / radius at each radius). */
export function domeSegmentPath(i) {
  const { R, r, gap } = DOME;
  const a0 = 180 - 18 * i, a1 = 180 - 18 * (i + 1);
  const dO = ((gap / 2) / R) * (180 / Math.PI), dI = ((gap / 2) / r) * (180 / Math.PI);
  const o0 = a0 - (i > 0 ? dO : 0), o1 = a1 + (i < 9 ? dO : 0);
  const n0 = a0 - (i > 0 ? dI : 0), n1 = a1 + (i < 9 ? dI : 0);
  return `M${pt(o0, R)}A${R} ${R} 0 0 1 ${pt(o1, R)}L${pt(n1, r)}A${r} ${r} 0 0 0 ${pt(n0, r)}Z`;
}

export const DOME_PATHS = Object.freeze(Array.from({ length: 10 }, (_, i) => domeSegmentPath(i)));

/** The kind of each tenth from the left, for an axis from heardAsAxis():
 * "man" for the first tenths.man, "woman" for the last tenths.woman,
 * "unsure" between; all "split" when the reading is split. */
export function domeKinds(axis) {
  if (axis.split) return Array(10).fill("split");
  const { man, woman } = axis.tenths;
  return Array.from({ length: 10 }, (_, i) => (i < man ? "man" : i >= 10 - woman ? "woman" : "unsure"));
}

/** The bracket's SVG path for [lo, hi] in tenths from the left foot (null
 * for none): an arc at radius bR from boundary lo to boundary hi, with a
 * short radial cap at each end (ends exactly on the segment boundaries). */
export function domeBracketPath(bracket) {
  if (!bracket) return null;
  const [lo, hi] = bracket;
  const { bR, bCapIn, bCapOut } = DOME;
  const a0 = 180 - 18 * lo, a1 = 180 - 18 * hi;
  const large = a0 - a1 > 180 ? 1 : 0;
  return `M${pt(a0, bCapIn)}L${pt(a0, bCapOut)}M${pt(a0, bR)}A${bR} ${bR} 0 ${large} 1 ${pt(a1, bR)}M${pt(a1, bCapIn)}L${pt(a1, bCapOut)}`;
}

/** The sentence inside the dome on two lines, broken before "listeners" (the
 * mockup's "About 6 in 10" / "listeners would say woman"; "Could go either
 * way —" / "listeners would be split") so the shorter half sits higher, where
 * the dome is narrower. Joined with one space the lines are the sentence word
 * for word (a text without "listeners" stays one line). */
export function domeLines(text) {
  const i = text.indexOf(" listeners ");
  return i > 0 ? [text.slice(0, i), text.slice(i + 1)] : [text];
}

/** The words beside the grey and bracket keys under the dome (the end words
 * are heardAsAxisModel.js's AXIS_ENDS). */
export const UNSURE_WORDS = "unsure or neither";
/** Split readings: the grey key's slot shows the stripes instead. */
export const SPLIT_WORDS = "could go either way";
export const BRACKET_WORDS = "likely range";
