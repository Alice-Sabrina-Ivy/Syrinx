// heardAsAxisModel.js — the "Likely heard as" panel's single man <-> woman
// axis (2026-10-07 user decision: one axis with a shaded range, replacing the
// three bracket rows). Pure, so the layout numbers and every word the panel
// shows are unit-tested (tests/ml/heard-as-axis-test.js) — including that a
// mirrored estimate gives a mirrored axis and the same words with "man" and
// "woman" swapped (gender symmetry).
//
// The axis is the TWO-WAY share (src/ml/heard-as.js `s`: listeners who would
// answer "man" if they had to choose, unsure listeners counted half each
// way). Orientation as the cue strip: the typically-men end on the LEFT —
// position x = 1 − s (0 = all would say man, 1 = all would say woman), ticks
// in tenths. The shaded range is the calibration's ~80 % range
// [sLow, sHigh] rounded OUTWARD to tenths (the same rounding as the text, so
// band and words agree); the dot is the middle guess s, unrounded. A range
// spanning ≥ WIDE_SHARE_TENTHS (8) tenths is "can't tell yet": the panel dims
// the band and drops the dot. The unsure / neither share is a text line, not
// a third bar.

import { formatShare, shareTenths, isWideShare } from "../ml/heard-as.js";

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export const AXIS_ENDS = Object.freeze({ left: "would say man", right: "would say woman" });

/**
 * shares: the object heardAsShares() returns (uses s, sLow, sHigh, unsure).
 * -> { lo, hi, dot, wide, manTenths, womanTenths, rangeText, unsureText, srText }
 *    lo / hi / dot are axis fractions from the LEFT (man) end, 0…1.
 */
export function heardAsAxis(shares) {
  const manRange = [shares.sLow, shares.sHigh];
  const womanRange = [1 - shares.sHigh, 1 - shares.sLow];
  const [a, b] = shareTenths(manRange);      // "a–b in 10 would say man"
  const [c, d] = shareTenths(womanRange);    // "c–d in 10 would say woman" (= 10−b … 10−a)
  const wide = isWideShare(manRange);
  const dot = Math.min(1, Math.max(0, 1 - shares.s));
  const man = formatShare(manRange), woman = formatShare(womanRange);
  const rangeText = wide
    ? "Can't tell yet — the range covers most of the scale"
    : `${cap(man)} would say man · ${woman} would say woman`;
  const unsureText = `${cap(formatShare(shares.unsure))} might be unsure or say neither`;
  const midMan = Math.round(10 * shares.s), midWoman = 10 - midMan;
  const scale = "Scale from would say man, on the left, to would say woman, on the right, in tenths of listeners.";
  const srText = wide
    ? `${scale} Can't tell yet: the range covers most of the scale — ${man} would say man, ${woman} would say woman.`
    : `${scale} Shaded range: ${man} would say man, ${woman} would say woman. Middle guess: about ${midMan} in 10 man, ${midWoman} in 10 woman.`;
  return {
    lo: c / 10,
    hi: d / 10,
    dot,
    wide,
    manTenths: [a, b],
    womanTenths: [c, d],
    rangeText,
    unsureText,
    srText,
  };
}
