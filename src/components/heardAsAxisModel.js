// heardAsAxisModel.js — the "Likely heard as" panel's man <-> woman bar.
// Pure, so the layout numbers and every word the panel shows are unit-tested
// (tests/ml/heard-as-axis-test.js) — including that a mirrored estimate gives
// a mirrored bar and the same words with "man" and "woman" swapped (gender
// symmetry).
//
// The scale is the TWO-WAY share (src/ml/heard-as.js `s`: listeners who would
// answer "man" if they had to choose, unsure listeners counted half each
// way), in tenths, rounded OUTWARD to tenths like the words ("about A–B in 10
// would say man · about C–D in 10 would say woman", C = 10 − B, D = 10 − A).
//
// SPLIT BAR (user decision 2026-10-20; it replaced the 2026-10-07 axis with a
// shaded range and a ring): one bar of ten tenths of listeners, "would say
// man" filling from the LEFT (the cue strip's orientation), "would say woman"
// from the RIGHT. The solid left part is the low end of "would say man"
// (A tenths), the solid right part the low end of "would say woman" (C
// tenths), and the part between them (B − A tenths, the range's width) is
// striped: it could go either way. No best-guess mark is drawn (review
// 2026-10-20: a mark at the split point s sat over the end word of the answer
// FEWER listeners would give — "would say man" for a voice most would call a
// woman — so it read backwards; the user had made it optional). `guess` (s,
// unrounded, always inside the striped part) stays in the model for the
// checks only (data-split-guess). A range spanning ≥ WIDE_SHARE_TENTHS (8)
// tenths is "can't tell yet" (mostly stripes; no unsure line). The unsure /
// neither share is a text line: the share at the best guess rounded to the
// nearest tenth ("about N in 10", "fewer than 1 in 10"), left out while it is
// "can't tell yet". (Until review round 2 it was the range's outward-rounded
// min…peak, which read "about 0–5 in 10" on most readings of typical voices —
// measurements/heard-as-panel-review-2-2026-10-07.md §4.) The range and
// unsure words are the 2026-10-07 axis's, unchanged
// (tests/ml/fixtures/heard-as-axis-words-golden.json).

import { formatShare, shareTenths, isWideShare } from "../ml/heard-as.js";

/** The unsure / neither share at the best guess, rounded to the nearest tenth. */
export function unsureWords(u) {
  const n = Math.round(10 * u);
  return n <= 0 ? "fewer than 1 in 10" : `about ${n} in 10`;
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
 * -> { man, woman, guess, wide, manTenths, womanTenths, rangeText, unsureText, srText }
 *    man / woman: widths of the solid parts as fractions of the bar (man from
 *    the LEFT end, woman from the RIGHT end); the striped part is the rest.
 *    guess: the best guess s as a fraction from the LEFT end, 0…1 (not
 *    drawn; for the checks).
 *    unsureText is null while wide (the panel leaves the line out).
 */
export function heardAsAxis(shares) {
  const manRange = [shares.sLow, shares.sHigh];
  const womanRange = [1 - shares.sHigh, 1 - shares.sLow];
  const [a, b] = shareTenths(manRange);      // "a–b in 10 would say man"
  const [c, d] = shareTenths(womanRange);    // "c–d in 10 would say woman" (= 10−b … 10−a)
  const wide = isWideShare(manRange);
  const guess = Math.min(1, Math.max(0, shares.s));
  const man = formatShare(manRange), woman = formatShare(womanRange);
  const rangeText = wide
    ? "Can't tell yet — the range covers most of the scale"
    : `${cap(man)} would say man · ${woman} would say woman`;
  const unsureText = wide ? null : `${cap(unsureWords(shares.centre.unsure))} might be unsure or say neither`;
  const scale = "Bar of listeners in tenths: would say man fills from the left, would say woman from the right, and the striped part between could go either way.";
  const srText = wide
    ? `${scale} Can't tell yet: the range covers most of the scale — ${man} would say man, ${woman} would say woman.`
    : `${scale} ${cap(man)} would say man, ${woman} would say woman.`;
  return {
    man: a / 10,
    woman: c / 10,
    guess,
    wide,
    manTenths: [a, b],
    womanTenths: [c, d],
    rangeText,
    unsureText,
    srText,
  };
}
