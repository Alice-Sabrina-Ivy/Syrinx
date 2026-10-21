// heardAsAxisModel.js — the "Likely heard as" panel's man <-> woman bar.
// Pure, so the layout numbers and every word the panel shows are unit-tested
// (tests/ml/heard-as-axis-test.js) — including that a mirrored estimate gives
// a mirrored bar and the same words with "man" and "woman" swapped (gender
// symmetry).
//
// The scale is the TWO-WAY share (src/ml/heard-as.js `s`: listeners who would
// answer "man" if they had to choose, unsure listeners counted half each
// way), in tenths: the range [sLow, sHigh] rounded OUTWARD to tenths, A–B
// "would say man" (and C–D = 10 − B … 10 − A "would say woman").
//
// THE SENTENCE (user decision 2026-10-21: the both-sides form "About A–B in
// 10 would say man · about C–D in 10 would say woman" read as confusing): ONE
// side, the MIDDLE of that range — "About N in 10 listeners would say man",
// N = (A + B) / 2 rounded to a whole tenth (middleTenths), the side whose
// middle is above 5 in 10. The middle of the tenths the bar draws, so N is the
// middle of its striped part. "Could go either way — listeners would be
// split" when the range is wide (as before) OR its middle rounds to 5 (never
// happens inside the tested range today: there every such reading is wide).
// Words only: heardAsShares, the calibration and the bar are unchanged.
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
// tenths is "could go either way" (mostly stripes; no unsure line; it said
// "Can't tell yet" until user decision 2026-10-21 (1): waiting does not help a
// voice whose reading sits in the middle — "Can't tell yet" is now only the
// panel's words before a reading exists, HeardAsPanel.jsx). The unsure /
// neither share is a text line: the share at the best guess rounded to the
// nearest tenth ("about N in 10", "fewer than 1 in 10"), left out while it is
// "could go either way". (Until review round 2 it was the range's outward-rounded
// min…peak, which read "about 0–5 in 10" on most readings of typical voices —
// measurements/heard-as-panel-review-2-2026-10-07.md §4.) The unsure words and
// the tenths are the 2026-10-07 axis's, unchanged; the range line is the
// 2026-10-21 one-side sentence (tests/ml/fixtures/heard-as-axis-words-golden.json).

import { shareTenths, isWideShare } from "../ml/heard-as.js";

/** The unsure / neither share at the best guess, rounded to the nearest tenth. */
export function unsureWords(u) {
  const n = Math.round(10 * u);
  return n <= 0 ? "fewer than 1 in 10" : `about ${n} in 10`;
}

/** The range line of a shown reading that spans most of the scale (wide), or
 * whose middle rounds to 5 in 10. */
export const WIDE_TEXT = "Could go either way — listeners would be split";

/**
 * The middle of a range of a…b tenths (integers), rounded to a whole tenth.
 * Rounding rule: an exact .5 rounds TOWARD 5 — the less extreme value — so
 * the sentence never overstates (7.5 -> 7, 8.5 -> 8, 9.5 -> 9; 2.5 -> 3).
 * Mirror-symmetric: middleTenths(10 − b, 10 − a) = 10 − middleTenths(a, b).
 */
export function middleTenths(a, b) {
  const twice = a + b;
  if (twice % 2 === 0) return twice / 2;
  return twice > 10 ? (twice - 1) / 2 : (twice + 1) / 2;
}

/** The one-side sentence for a range of a…b tenths "would say man". */
export function sayText(a, b, wide) {
  const n = middleTenths(a, b);
  if (wide || n === 5) return WIDE_TEXT;
  const side = n > 5 ? "man" : "woman", k = n > 5 ? n : 10 - n;
  return `${k >= 10 ? "Nearly all" : `About ${k} in 10`} listeners would say ${side}`;
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

// What the panel's 250 ms check does. With a reading shown: a full update
// ("update", which also feeds the pitch-only warning) only when a held note
// has started, so the reading hides at once. With none shown: "first" — ask
// estimate() and show a reading as soon as there is one, never feeding the
// warning (2026-10-21, H3 of measurements/heard-as-low-pitch-and-pauses-2026-10-21.md).
export function quickCheck(shown, voiceState) {
  if (shown) return voiceState === "sustained" ? "update" : null;
  return "first";
}

export const AXIS_ENDS = Object.freeze({ left: "would say man", right: "would say woman" });

/**
 * shares: the object heardAsShares() returns (uses s, sLow, sHigh, unsure).
 * -> { man, woman, guess, wide, split, manTenths, womanTenths, rangeText, unsureText, srText }
 *    man / woman: widths of the solid parts as fractions of the bar (man from
 *    the LEFT end, woman from the RIGHT end); the striped part is the rest.
 *    guess: the best guess s as a fraction from the LEFT end, 0…1 (not
 *    drawn; for the checks).
 *    split: the range line says "Could go either way" (wide, or the middle
 *    rounds to 5 in 10).
 *    unsureText is null while wide (the panel leaves the line out); a reading
 *    that is split but not wide keeps it.
 */
export function heardAsAxis(shares) {
  const manRange = [shares.sLow, shares.sHigh];
  const womanRange = [1 - shares.sHigh, 1 - shares.sLow];
  const [a, b] = shareTenths(manRange);      // "a–b in 10 would say man"
  const [c, d] = shareTenths(womanRange);    // "c–d in 10 would say woman" (= 10−b … 10−a)
  const wide = isWideShare(manRange);
  const guess = Math.min(1, Math.max(0, shares.s));
  const rangeText = sayText(a, b, wide);
  const split = rangeText === WIDE_TEXT;
  const unsureText = wide ? null : `${cap(unsureWords(shares.centre.unsure))} might be unsure or say neither`;
  const scale = "Bar of listeners in tenths: would say man fills from the left, would say woman from the right, and the striped part between could go either way.";
  const srText = `${scale} ${rangeText}.`; // the visible sentence, word for word
  return {
    man: a / 10,
    woman: c / 10,
    guess,
    wide,
    split,
    manTenths: [a, b],
    womanTenths: [c, d],
    rangeText,
    unsureText,
    srText,
  };
}
