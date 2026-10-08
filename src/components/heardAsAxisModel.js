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
// band and words agree); the ring is the single best guess s, unrounded (the
// range is symmetric in logit, so on this scale the best guess often sits
// near one end of the band — it is drawn small and hollow so the range reads
// first; review round 2). A range spanning ≥ WIDE_SHARE_TENTHS (8) tenths is
// "can't tell yet": the panel draws the band dashed and drops the ring. The
// unsure / neither share is a text line, not a third bar: the share at the
// best guess rounded to the nearest tenth ("about N in 10", "fewer than 1 in
// 10"), left out while it is "can't tell yet". (Until review round 2 it was
// the range's outward-rounded min…peak, which read "about 0–5 in 10" on most
// readings of typical voices — measurements/heard-as-panel-review-2-2026-10-07.md §4.)

import { formatShare, shareTenths, isWideShare } from "../ml/heard-as.js";

/** The unsure / neither share at the best guess, rounded to the nearest tenth. */
export function unsureWords(u) {
  const n = Math.round(10 * u);
  return n <= 0 ? "fewer than 1 in 10" : `about ${n} in 10`;
}

/**
 * The single best guess (two-way share "man" s) in words for screen readers,
 * worded like formatShare: never "0 in 10" or "10 in 10" ("fewer than 1 in 10"
 * / "nearly all" at the ends), so it is no sharper than the visible range
 * (2026-10-07 UX review). -> [man words, woman words]; mirrored for 1 − s.
 */
export function bestGuessWords(s) {
  if (s < 0.05) return ["fewer than 1 in 10", "nearly all"];
  if (s > 0.95) return ["nearly all", "fewer than 1 in 10"];
  const n = Math.min(9, Math.max(1, Math.round(10 * s)));
  return [`about ${n} in 10`, `about ${10 - n} in 10`];
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// "short" splits in two for the words the panel shows (2026-10-07 UX review:
// continuous whisper read "Keep talking" forever). The speech detector
// scores whisper, so a whisperer has plenty of scored windows but almost no
// posted voiced pitch in them; at the start of ordinary speech it is the
// window count / voiced time that is still filling. "unvoiced" = at least
// minWindows scored windows whose voiced pitch covers under UNVOICED_SHARE
// of their span (150 ms per decision + one 600 ms window tail): unphonated
// whisper posts 0-8 % voiced, running speech ~40-60 %
// (measurements/whisper-voicing-2026-10-07.md;
// measurements/heard-as-voiced-windows-2026-10-08.md checks the split).
export const UNVOICED_SHARE = 0.1;
export function shortReason(e, minWindows) {
  if (e?.hidden !== "short") return e?.hidden ?? null;
  const span = 150 * (e.nWindows ?? 0) + 600;
  return (e.nWindows ?? 0) >= minWindows && (e.voicedMs ?? 0) < UNVOICED_SHARE * span ? "unvoiced" : "short";
}

export const AXIS_ENDS = Object.freeze({ left: "would say man", right: "would say woman" });

/**
 * shares: the object heardAsShares() returns (uses s, sLow, sHigh, unsure).
 * -> { lo, hi, dot, wide, manTenths, womanTenths, rangeText, unsureText, srText }
 *    unsureText is null while wide (the panel leaves the line out).
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
  const unsureText = wide ? null : `${cap(unsureWords(shares.centre.unsure))} might be unsure or say neither`;
  const [midMan, midWoman] = bestGuessWords(shares.s);
  const scale = "Scale from would say man, on the left, to would say woman, on the right, in tenths of listeners.";
  const srText = wide
    ? `${scale} Can't tell yet: the range covers most of the scale — ${man} would say man, ${woman} would say woman.`
    : `${scale} Shaded range: ${man} would say man, ${woman} would say woman. Best guess: ${midMan} would say man, ${midWoman} would say woman.`;
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
