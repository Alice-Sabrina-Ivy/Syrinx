// heardAsDome.js — the "Likely heard as" DOME (owner's choice 2026-10-25: the
// "Twin columns" meters with the "Gauges" mockup's Likely-heard-as panel). It
// replaced the 2026-10-20 split bar as the panel's drawing; the model —
// numbers, words, screen-reader text — is still heardAsAxisModel.js,
// unchanged. Pure numbers only (no React), so tests/ml/heard-as-dome-test.js
// checks them in Node.
//
// A semicircle from "would say man" (LEFT foot) to "would say woman" (RIGHT
// foot) made of ten tenth-segments of listeners, in the cue strip's / split
// bar's orientation: the man tenths solid deep indigo from the left (the low
// end of "would say man", A tenths = axis.man · 10), the woman tenths solid
// light indigo from the right (the low end of "would say woman", C tenths =
// axis.woman · 10), the tenths between them striped (could go either way, the
// range's width). 2 px of panel show between two segments; a small tick above
// the top marks the middle (5 in 10). The panel's sentence sits centred inside
// the dome, on two lines (domeLines).
//
// Geometry: viewBox DOME.w × DOME.h, centre (cx, cy) on the base line, outer
// radius R, inner radius r — the mockup's 144 / 118 (its 392-px-wide drawing
// had 52 px of margin each side; here the box is the dome, 300 px at most).

export const DOME = Object.freeze({ w: 300, h: 157, cx: 150, cy: 156, R: 144, r: 118, gap: 2, tickTop: 3, tickBottom: 9 });

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
 * "man" for the first A (= axis.man · 10), "woman" for the last C
 * (= axis.woman · 10), "either" between. */
export function domeKinds(axis) {
  const a = Math.round(axis.man * 10), c = Math.round(axis.woman * 10);
  return Array.from({ length: 10 }, (_, i) => (i < a ? "man" : i >= 10 - c ? "woman" : "either"));
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

/** The words beside the striped key under the dome (the end words are
 * heardAsAxisModel.js's AXIS_ENDS). */
export const EITHER_WORDS = "could go either way";
