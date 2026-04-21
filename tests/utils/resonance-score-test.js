// resonance-score-test.js — Tests for vowelResonanceScore().
//
// Usage: node tests/utils/resonance-score-test.js
//
// Follows the same pattern as tests/dsp/accuracy-test.js: plain Node script
// with assertions. Exits non-zero on any failure.

import {
  vowelResonanceScore,
  VOWELS,
  RESONANCE_SCORE_TARGET,
  RESONANCE_MALE_CEILING,
  GATE_DISTANCE_HZ,
} from "../../src/utils/resonanceScore.js";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

function near(a, b, eps = 1.5) {
  return Math.abs(a - b) <= eps;
}

console.log("vowelResonanceScore — reference points");

// Each vowel's male anchor should score 0; female anchor should score 100.
// Note: we don't test the geometric midpoint here because the Hillenbrand
// vowel clouds overlap — a midpoint of /EE/ for example is closer to
// female /IH/ than to either /EE/ anchor, so it correctly reclassifies.
// That reclassification is the desired behavior: score what's being
// produced acoustically, not what was intended.
for (const v of VOWELS) {
  const m = vowelResonanceScore(v.maleF1, v.maleF2);
  check(
    `male /${v.label}/ anchor → score 0`,
    m !== null && near(m.score, 0) && m.vowel.label === v.label,
    m === null ? "got null" : `got score=${m.score.toFixed(1)} vowel=${m.vowel.label}`,
  );

  const f = vowelResonanceScore(v.femaleF1, v.femaleF2);
  check(
    `female /${v.label}/ anchor → score 100`,
    f !== null && near(f.score, 100) && f.vowel.label === v.label,
    f === null ? "got null" : `got score=${f.score.toFixed(1)} vowel=${f.vowel.label}`,
  );
}

// For a spatially-isolated back vowel (/OO/ has no anchor intruding on its
// male→female segment), the geometric midpoint DOES score ~50.
{
  const v = VOWELS.find((x) => x.label === "OO");
  const midF1 = (v.maleF1 + v.femaleF1) / 2;
  const midF2 = (v.maleF2 + v.femaleF2) / 2;
  const mid = vowelResonanceScore(midF1, midF2);
  check(
    `isolated midpoint /OO/ → score ~50`,
    mid !== null && near(mid.score, 50, 3),
    mid === null ? "got null" : `got score=${mid.score.toFixed(1)}`,
  );
}

// Score is bounded [0, 100] for any reasonable in-bounds input.
{
  const samples = [
    [400, 1500], [500, 2200], [700, 1800], [800, 1200], [600, 1000],
  ];
  let allBounded = true;
  for (const [f1, f2] of samples) {
    const r = vowelResonanceScore(f1, f2);
    if (r !== null && (r.score < 0 || r.score > 100)) {
      allBounded = false;
    }
  }
  check("all sample scores bounded in [0, 100]", allBounded);
}

console.log("\nvowelResonanceScore — off-axis gating");

// A point far from any reference should gate (return null). Pick somewhere
// clearly outside all Hillenbrand clusters.
const wayOff = vowelResonanceScore(1200, 3600);
check(
  "far-off point (1200, 3600) → gated (null)",
  wayOff === null,
  wayOff === null ? "" : `got score=${wayOff.score.toFixed(1)}`,
);

const wayOff2 = vowelResonanceScore(200, 500);
check(
  "far-off point (200, 500) → gated (null)",
  wayOff2 === null,
  wayOff2 === null ? "" : `got score=${wayOff2.score.toFixed(1)}`,
);

// Perpendicular-off-axis points near a vowel's midpoint should NOT hit 100.
// This is the key bug the fix addresses: old code projected onto the
// male→female axis, so off-axis points would still clamp to 100.
//
// Take /IH/ (male 427/2034, female 483/2365). The male→female vector is
// mostly +F2. A point at F1=450, F2=3000 is "past" female on the F2 axis
// but has to have the score bounded because F2=3000 is not actually near
// female /IH/.
const farOnAxis = vowelResonanceScore(450, 3000);
check(
  "projected-past-female point → gated or bounded (< 100)",
  farOnAxis === null || farOnAxis.score < 95,
  farOnAxis === null ? "gated ✓" : `got score=${farOnAxis.score.toFixed(1)}`,
);

// Perpendicular offset from /IH/ male anchor — old code gave ~100 here.
// We expect either gated or a score pulled toward 50 (equidistant).
const perpOff = vowelResonanceScore(700, 2500);
check(
  "off-axis transient (700, 2500) → does not score 100",
  perpOff === null || perpOff.score < 90,
  perpOff === null ? "gated ✓" : `got score=${perpOff.score.toFixed(1)}`,
);

console.log("\nvowelResonanceScore — 'hello test' male-voice realistic frames");

// Realistic male /ɛ/ (the vowel in "hello"/"test"): near male /EH/ ref
// (580, 1799). Score should be near 0, not near 100.
const maleEH = vowelResonanceScore(590, 1810);
check(
  "male /EH/ (590, 1810) → score < 20 (near male anchor)",
  maleEH !== null && maleEH.score < 20 && maleEH.vowel.label === "EH",
  maleEH === null ? "got null" : `got score=${maleEH.score.toFixed(1)} vowel=${maleEH.vowel.label}`,
);

// Male /oʊ/ in "hello": near male /OH/ ref (497, 910). Score near 0.
const maleOH = vowelResonanceScore(500, 920);
check(
  "male /OH/ (500, 920) → score < 20",
  maleOH !== null && maleOH.score < 20,
  maleOH === null ? "got null" : `got score=${maleOH.score.toFixed(1)} vowel=${maleOH.vowel.label}`,
);

// Feminine /ɛ/: near female /EH/ (731, 2058). Score near 100.
const femaleEH = vowelResonanceScore(720, 2050);
check(
  "female /EH/ (720, 2050) → score > 80 (near female anchor)",
  femaleEH !== null && femaleEH.score > 80,
  femaleEH === null ? "got null" : `got score=${femaleEH.score.toFixed(1)}`,
);

// Boundary-case: pick a point in an empty region of F1/F2 space that's
// close enough to one anchor to be accepted, and another that's far from all.
// (250, 3500) is in the upper-left extremity — no reference anchors nearby.
const justOutside = vowelResonanceScore(250, 3500);
check(
  `F1=250 F2=3500 (empty region) → rejected (null)`,
  justOutside === null,
  justOutside === null ? "" : `got score=${justOutside?.score.toFixed(1)}`,
);

// A point 50 Hz off male /OO/ (378, 997) → close to an anchor, accepted.
const nearLimit = vowelResonanceScore(378 + 50, 997);
check(
  `point 50Hz from male /OO/ anchor → accepted`,
  nearLimit !== null,
  nearLimit === null ? "got null (expected accepted)" : `got score=${nearLimit.score.toFixed(1)}`,
);

console.log("\nvowelResonanceScore — null input handling");

check(
  "null f1 → null",
  vowelResonanceScore(null, 2000) === null,
);
check(
  "null f2 → null",
  vowelResonanceScore(500, null) === null,
);
check(
  "both null → null",
  vowelResonanceScore(null, null) === null,
);
check(
  "undefined → null",
  vowelResonanceScore(undefined, undefined) === null,
);

console.log("\nconstants sanity");

check(
  `RESONANCE_SCORE_TARGET (${RESONANCE_SCORE_TARGET}) in (50, 100)`,
  RESONANCE_SCORE_TARGET > 50 && RESONANCE_SCORE_TARGET < 100,
);
check(
  `RESONANCE_MALE_CEILING (${RESONANCE_MALE_CEILING}) in (0, 50)`,
  RESONANCE_MALE_CEILING > 0 && RESONANCE_MALE_CEILING < 50,
);
check(
  `GATE_DISTANCE_HZ (${GATE_DISTANCE_HZ}) is reasonable (100-500)`,
  GATE_DISTANCE_HZ >= 100 && GATE_DISTANCE_HZ <= 500,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
