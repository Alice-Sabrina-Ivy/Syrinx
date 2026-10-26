// heardAsAxisModel.js — the "Likely heard as" panel's man <-> woman dome:
// its numbers and every word the panel shows. Pure, so they are unit-tested
// (tests/ml/heard-as-axis-test.js, tests/ml/heard-as-dome-test.js) —
// including that a mirrored estimate gives a mirrored dome and the same words
// with "man" and "woman" swapped (gender symmetry).
//
// THREE PARTS ADDING TO 10 (user decision 2026-10-26: "3 parts, add to 10";
// the range as a bracket). The dome and the words show ONE best guess, the
// three-way shares at the centre of the estimate (src/ml/heard-as.js
// heardAsShares().centre = { man, unsure, woman }, summing to 1), as whole
// tenths that sum to 10 (threeTenths: largest remainder, mirror-symmetric).
// The dome draws them: "would say man" (deep) from the LEFT foot, "would say
// woman" (light) from the RIGHT foot, "unsure or neither" (neutral grey)
// between — counting segments gives exactly the numbers in the words. The
// sentence names the bigger side with its drawn tenths ("About N in 10
// listeners would say woman", N 10 = "Nearly all listeners would say …");
// the line under it names the rest so the stated numbers add up to 10
// ("About U in 10 unsure or neither" / "Fewer than 1 in 10 unsure or
// neither" — the key's words — plus " · about M in 10 would say man" when
// the other side has ≥ 1 tenth). Measured in the built app: one line at
// 448 px and on desktops, two balanced lines at 360 px; the longer "… might
// be unsure or say neither · …" wrapped at 448 px too and made the panel
// 17 px taller there.
//
// THE UNCERTAINTY is drawn separately as a thin BRACKET just outside the
// dome, over where the bigger side's inner edge could fall: for woman, from
// 1 − woman_hi to 1 − woman_lo of the arc from the left (heardAsShares().woman
// = [lo, hi]); for man, from man_lo to man_hi. Rounded outward to tenths so
// its ends sit on segment boundaries, and widened if needed to contain the
// drawn edge (it always does with largest remainder; the widening is a guard
// against float ties).
//
// SPLIT: "Could go either way — listeners would be split" (WIDE_TEXT) when
// the two-way range is wide (isWideShare, ≥ 8 tenths — the rule since
// 2026-10-07) OR the two sides' tenths differ by ≤ 1. Then the whole dome is
// striped (no three-part split, no bracket) and there is no second line, so
// the drawing never contradicts the words.
//
// Display only: heard-as.js, the calibration and every number they compute
// are unchanged (CLAUDE.md hard rule 3). The pitch-only warning still gets
// heardAsShares().s from the panel, as before.
//
// Superseded (kept for the record):
// - 2026-10-20 … 2026-10-25 (split bar, then the dome): the two-way range
//   [sLow, sHigh] rounded outward to tenths, solid "would say man" from the
//   left = its low end, solid "would say woman" from the right, STRIPES
//   between labelled "could go either way" (really the estimate's
//   uncertainty); the sentence at the two-way best guess s (guessTenths, an
//   exact .5 toward 5) and a separate unsure line that was not drawn and
//   double-counted (e.g. "About 9 in 10 would say woman" + "About 2 in 10
//   might be unsure").
// - 2026-10-07: an axis with a shaded range and a ring.

import { shareTenths, isWideShare } from "../ml/heard-as.js";

/** The unsure / neither share in drawn tenths, as words. */
export function unsureWords(n) {
  return n <= 0 ? "fewer than 1 in 10" : `about ${n} in 10`;
}

/** The sentence of a shown reading that spans most of the scale (wide), or
 * whose two sides' tenths differ by at most 1: split. */
export const WIDE_TEXT = "Could go either way — listeners would be split";

const EPS = 1e-9;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The three-way shares { man, unsure, woman } (summing to 1) as whole tenths
 * that sum to 10: each share's floor, then the tenths still missing go to
 * the largest remainders. Ties: a tie between man and woman that the missing
 * tenths would break is never broken one way — one missing tenth goes to
 * unsure, two go to man and woman — and unsure wins a tie against a side.
 * So swapping man and woman swaps their tenths exactly, and the result is
 * deterministic. Each part is its share's floor or ceiling, except when man
 * and woman are both exactly x.5 tenths and unsure a whole number of tenths:
 * the missing tenth then goes to unsure (the calibration's unsure floor,
 * 0.02, keeps a real reading from having unsure exactly 0 there).
 */
export function threeTenths({ man, unsure, woman }) {
  const v = { man: 10 * man, unsure: 10 * unsure, woman: 10 * woman };
  const out = {}, rem = {};
  for (const k of ["man", "unsure", "woman"]) {
    out[k] = Math.max(0, Math.floor(v[k] + EPS));
    rem[k] = v[k] - out[k];
  }
  let k = 10 - out.man - out.unsure - out.woman;
  if (k <= 0) return out;   // already 10 (k < 0 cannot happen for shares summing to 1)
  if (Math.abs(rem.man - rem.woman) < EPS) {
    // man and woman tie: keep them equal
    if (k === 1) out.unsure += 1;
    else if (k === 2) { out.man += 1; out.woman += 1; }
    else { out.man += 1; out.woman += 1; out.unsure += 1; }
    return out;
  }
  const order = ["unsure", "man", "woman"].sort((x, y) => (rem[y] - rem[x] > EPS ? 1 : rem[x] - rem[y] > EPS ? -1 : (x === "unsure" ? -1 : y === "unsure" ? 1 : 0)));
  for (const key of order) { if (k <= 0) break; out[key] += 1; k--; }
  return out;
}

/** The sentence for drawn tenths t = { man, unsure, woman } (WIDE_TEXT when
 * wide or the sides differ by ≤ 1). */
export function sayText(t, wide) {
  if (wide || Math.abs(t.man - t.woman) <= 1) return WIDE_TEXT;
  const side = t.man > t.woman ? "man" : "woman", n = t[side];
  return `${n >= 10 ? "Nearly all" : `About ${n} in 10`} listeners would say ${side}`;
}

/** The line under the sentence: the rest, so the stated numbers add up to
 * 10 (null when split). */
export function restText(t, wide) {
  if (sayText(t, wide) === WIDE_TEXT) return null;
  const other = t.man > t.woman ? "woman" : "man";
  const u = `${cap(unsureWords(t.unsure))} unsure or neither`;
  // A no-break space before "·" so a wrapped line never starts with it
  // (2026-10-26 review: "· about 1 in 10 would say man" at 360 px).
  return t[other] >= 1 ? `${u}\u00a0· about ${t[other]} in 10 would say ${other}` : u;
}

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

// The dome's screen-reader label (the drawing's own description; the
// sentence and the line under it are read from their visible text). One
// sentence (user decision 2026-10-26: three parts and the bracket). Until
// then: "Arc of listeners in tenths: would say man fills from the left end,
// would say woman from the right end, and the striped part between could go
// either way."
// A split reading draws neither grey nor a bracket: the whole arc is striped
// (2026-10-26 review: the three-part label described parts not drawn there).
export const SPLIT_DESCRIPTION = "Arc of ten tenths of listeners, striped as a whole: listeners would be split between would say man and would say woman.";
export const BAR_DESCRIPTION = "Arc of ten tenths of listeners: would say man fills from the left end, would say woman from the right end, unsure or neither in grey between, and a thin bracket outside the arc marks the likely range of the larger part's edge.";

export const AXIS_ENDS = Object.freeze({ left: "would say man", right: "would say woman" });

/**
 * shares: the object heardAsShares() returns (uses s, sLow, sHigh, man,
 * woman, centre).
 * -> { tenths, guess, man, woman, wide, split, side, bracket, rangeText, unsureText, srText }
 *    tenths: { man, unsure, woman } whole tenths summing to 10 (threeTenths
 *    of shares.centre) — what the dome draws and the words say.
 *    guess: the two-way share s (not drawn; data-split-guess, and what the
 *    pitch-only warning is fed).
 *    man / woman: tenths.man / 10, tenths.woman / 10 (fractions of the arc,
 *    man from the LEFT foot, woman from the RIGHT foot; unsure between).
 *    split: the sentence says "Could go either way" (wide, or the sides
 *    differ by ≤ 1 tenth) — the dome is then striped as a whole, no bracket.
 *    side: the bigger side ("man" | "woman"), null when split.
 *    bracket: null when split, else [lo, hi] in tenths of the arc from the
 *    LEFT foot (0…10, integers, lo < hi) — where the bigger side's inner edge
 *    could fall; it contains the drawn edge (tenths.man for man, 10 −
 *    tenths.woman for woman).
 *    rangeText: the sentence; unsureText: the line under it (null when split).
 *    srText: the dome's own description (role img): BAR_DESCRIPTION, or
 *    SPLIT_DESCRIPTION when split.
 */
export function heardAsAxis(shares) {
  const wide = isWideShare([shares.sLow, shares.sHigh]);
  const tenths = threeTenths(shares.centre);
  const rangeText = sayText(tenths, wide);
  const split = rangeText === WIDE_TEXT;
  let side = null, bracket = null;
  if (!split) {
    side = tenths.man > tenths.woman ? "man" : "woman";
    let lo, hi, edge;
    if (side === "man") {
      [lo, hi] = shareTenths(shares.man);
      edge = tenths.man;
    } else {
      const [a, b] = shareTenths(shares.woman);
      lo = 10 - b; hi = 10 - a;
      edge = 10 - tenths.woman;
    }
    lo = Math.max(0, Math.min(lo, edge)); hi = Math.min(10, Math.max(hi, edge));
    if (hi === lo) { if (hi < 10) hi += 1; else lo -= 1; }
    bracket = [lo, hi];
  }
  return {
    tenths,
    guess: Math.min(1, Math.max(0, shares.s)),
    man: tenths.man / 10,
    woman: tenths.woman / 10,
    wide,
    split,
    side,
    bracket,
    rangeText,
    unsureText: restText(tenths, wide),
    srText: split ? SPLIT_DESCRIPTION : BAR_DESCRIPTION,
  };
}
