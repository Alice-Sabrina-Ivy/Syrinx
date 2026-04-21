// resonanceScore.js — Vowel-normalized gendered resonance score.
//
// Raw F1/F2 is dominated by vowel identity: F2 for "ee" ≈ 2300 Hz, F2 for "oo"
// ≈ 800 Hz for the same speaker. A single target band over F2 therefore
// conflates "which vowel are you saying" with "how feminine is your voice."
//
// Approach: classify to the nearest reference point (male or female anchor
// of any Hillenbrand 1995 vowel), then score as the normalized distance
// between the two anchors for that vowel. Points that aren't close to *any*
// reference (consonant transitions, noise, non-vowel frames) are gated out
// and return null instead of producing a spurious score.
//
// References: Hillenbrand et al. 1995 adult means, General American English.

const REFERENCE_VOWELS = [
  { label: "EE", word: "beet",   maleF1: 342, maleF2: 2322, femaleF1: 437, femaleF2: 2761 },
  { label: "IH", word: "bit",    maleF1: 427, maleF2: 2034, femaleF1: 483, femaleF2: 2365 },
  { label: "EH", word: "bet",    maleF1: 580, maleF2: 1799, femaleF1: 731, femaleF2: 2058 },
  { label: "AE", word: "bat",    maleF1: 588, maleF2: 1952, femaleF1: 669, femaleF2: 2349 },
  { label: "AH", word: "bot",    maleF1: 768, maleF2: 1333, femaleF1: 936, femaleF2: 1551 },
  { label: "AW", word: "bought", maleF1: 652, maleF2: 997,  femaleF1: 781, femaleF2: 1136 },
  { label: "OH", word: "boat",   maleF1: 497, maleF2: 910,  femaleF1: 555, femaleF2: 1035 },
  { label: "UU", word: "book",   maleF1: 469, maleF2: 1122, femaleF1: 519, femaleF2: 1225 },
  { label: "OO", word: "boot",   maleF1: 378, maleF2: 997,  femaleF1: 459, femaleF2: 1105 },
  { label: "UH", word: "but",    maleF1: 623, maleF2: 1200, femaleF1: 753, femaleF2: 1426 },
];

export const VOWELS = REFERENCE_VOWELS;

// Score thresholds
export const RESONANCE_SCORE_TARGET = 70; // ≥ this = in feminine target
export const RESONANCE_MALE_CEILING = 30; // ≤ this = solidly male range

// Gating: if the nearest reference point (male or female anchor of any vowel)
// is farther than this in (F1,F2) Euclidean space, the frame isn't reliably
// on any vowel — emit null so the trace can gap instead of inventing a score.
export const GATE_DISTANCE_HZ = 300;

// Compute the score for a given (f1, f2):
//   - pick the vowel whose nearest anchor (male or female) is closest
//   - score = 100 * d_male / (d_male + d_female), so
//       at male anchor → 0, at female anchor → 100, off-axis → ~50
//   - gate: if the nearest anchor is > GATE_DISTANCE_HZ away, return null
//
// Returns { score, vowel } or null.
export function vowelResonanceScore(f1, f2) {
  if (f1 == null || f2 == null) return null;

  let bestVowel = null;
  let bestScore = 0;
  let bestNearest = Infinity;

  for (const v of VOWELS) {
    const dmSq = (f1 - v.maleF1) ** 2 + (f2 - v.maleF2) ** 2;
    const dfSq = (f1 - v.femaleF1) ** 2 + (f2 - v.femaleF2) ** 2;
    const nearestSq = Math.min(dmSq, dfSq);
    if (nearestSq < bestNearest) {
      bestNearest = nearestSq;
      const dm = Math.sqrt(dmSq);
      const df = Math.sqrt(dfSq);
      // Guard against both distances being ~0 (same point).
      const denom = dm + df;
      bestScore = denom > 0 ? (dm / denom) * 100 : 50;
      bestVowel = v;
    }
  }

  if (bestVowel === null) return null;
  if (Math.sqrt(bestNearest) > GATE_DISTANCE_HZ) return null;

  return { score: bestScore, vowel: bestVowel };
}
