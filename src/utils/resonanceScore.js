// resonanceScore.js — Vowel-normalized gendered resonance score.
//
// Raw F1/F2 is dominated by vowel identity: F2 for "ee" ≈ 2300 Hz, F2 for "oo"
// ≈ 800 Hz for the same speaker. A single target band over F2 therefore
// conflates "which vowel are you saying" with "how feminine is your voice."
//
// Fix: classify which vowel is being produced (nearest reference midpoint in
// F1/F2 space), then project the point onto the male→female vector *for that
// specific vowel* and report a 0-100 scalar along that axis. The score is
// vowel-invariant: 80 means "for whatever vowel you're on, you're 80% of the
// way from the male reference to the female reference."
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

// Precompute per-vowel midpoints and male→female vectors.
const VOWELS = REFERENCE_VOWELS.map((v) => {
  const vecF1 = v.femaleF1 - v.maleF1;
  const vecF2 = v.femaleF2 - v.maleF2;
  return {
    ...v,
    midF1: (v.maleF1 + v.femaleF1) / 2,
    midF2: (v.maleF2 + v.femaleF2) / 2,
    vecF1,
    vecF2,
    vecMagSq: vecF1 * vecF1 + vecF2 * vecF2,
  };
});

// Score ≥ this is considered "in target" for feminine resonance.
export const RESONANCE_SCORE_TARGET = 70;

// Classify by nearest midpoint. Using the midpoint (vs. male or female alone)
// keeps classification stable for learners in transition — the anchor is
// equidistant from both references.
function nearestVowel(f1, f2) {
  let best = null;
  let bestDist = Infinity;
  for (const v of VOWELS) {
    const df1 = f1 - v.midF1;
    const df2 = f2 - v.midF2;
    const d = df1 * df1 + df2 * df2;
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best;
}

// Returns { score: 0-100, vowel: {label, word, ...} } or null if inputs invalid.
// Score is the clamped projection of (f1,f2) onto the male→female line for
// the nearest reference vowel: 0 = at male ref, 100 = at female ref.
export function vowelResonanceScore(f1, f2) {
  if (f1 == null || f2 == null) return null;
  const v = nearestVowel(f1, f2);
  if (!v) return null;
  const df1 = f1 - v.maleF1;
  const df2 = f2 - v.maleF2;
  const t = (df1 * v.vecF1 + df2 * v.vecF2) / v.vecMagSq;
  const score = Math.max(0, Math.min(100, t * 100));
  return { score, vowel: v };
}
