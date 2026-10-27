// drawings.js — line drawings for the guided exercises' cards (W1, R1, R2, R3).
// Pure data: every drawing is a 160 × 120 viewBox and a list of parts { kind, d }, where d
// is SVG path data in absolute commands only. The app draws the parts with one rule per
// kind: line = the outline, accent = what the card is about (the moving or active part),
// ghost = a dashed outline of the other position, accentFill = a faint fill inside an
// accent shape. No text inside a drawing: the card puts a caption under it. Where a part
// moves, its shape says so too (an arrow, or a dashed outline of the other position), so
// the drawing still reads when colour is gone.
//
//   straw       Side view of the lower face, facing right: nose, lips pursed and sealed
//               round a drinking straw; an arrow along the straw shows the air going out (W1).
//   lipBuzz     Front view of the lower face: loosely closed lips, the line between them
//               wavy (a lip trill); two fingertips resting on the cheeks beside the corners
//               of the mouth (W1).
//   fingertips  Side profile of head and neck, facing right; two fingertips resting lightly
//               on the front of the neck at mid-height. Smooth neck, no bump drawn (R1, R2).
//   boxUp       The same profile; the voice box (filled) raised, a dashed outline at its
//               resting place just below and an arrow pointing up (R1 swallow, R2 little dog).
//   boxDown     The same profile; the voice box lowered, the dashed resting place just above
//               and an arrow pointing down (R1 yawn, R2 big dog).
//   bright      Cut-away side view of the mouth, facing right: nose and chin, hard palate,
//               soft palate raised against the back of the throat, front teeth; the tongue
//               (filled) high and forward as for "ee", its tip behind the lower front teeth
//               and its highest point under the front of the hard palate; lips thin, close to
//               the teeth (slightly spread); a dashed outline of the "oh" tongue (R3).
//   dark        The same view and outline: the tongue lower and further back as for "oh"
//               (not pulled back hard), lips rounded and forward; a dashed outline of the
//               "ee" tongue (R3).

export const DRAWING_KINDS = Object.freeze(["line", "accent", "ghost", "accentFill"]);

const VIEW = "0 0 160 120";

// head-and-neck profile shared by fingertips, boxUp and boxDown
const PROFILE =
  "M 46 118 L 46 92 C 46 80 38 72 36 60 C 32 36 44 6 70 6 C 88 6 98 16 100 28 " +
  "L 101 34 C 104 38 108 42 110 46 C 111 48 109 50 105 50 L 104 52 " +
  "C 106 53 106 55 104 56 L 102 57 C 104 58 104 60 102 61 " +
  "C 102 64 102 66 98 68 C 94 70 86 70 82 72 C 80 80 80 100 82 118";
const EAR = "M 58 32 C 51 32 51 46 58 46";

// the voice box: a small rounded shape whose top is at y, just behind the front of the neck
const box = (y) =>
  `M 63 ${y + 3} C 63 ${y} 65 ${y} 67 ${y} L 71 ${y} C 73 ${y} 75 ${y} 75 ${y + 3} ` +
  `L 75 ${y + 6} C 75 ${y + 9} 73 ${y + 9} 71 ${y + 9} L 67 ${y + 9} ` +
  `C 65 ${y + 9} 63 ${y + 9} 63 ${y + 6} Z`;
const BOX_REST = 85;
const BOX_UP = 72;
const BOX_DOWN = 98;

// mouth cut-away shared by bright and dark
const NOSE = "M 98 2 C 104 10 114 18 120 26 C 123 30 120 33 114 33 L 110 33";
const CHIN = "M 110 82 C 113 90 112 98 104 104 C 94 110 76 110 68 110 C 64 110 62 113 62 118";
const PALATE = "M 34 36 C 50 24 80 22 94 32 C 96 34 97 36 98 38";
const VELUM = "M 34 36 C 26 35 15 33 7 31";
const PHARYNX = "M 6 18 L 6 118";
const UPPER_TOOTH = "M 98 38 C 103 41 106 48 106 56 L 101 56 C 100 50 98 45 94 40";
const LOWER_TOOTH = "M 101 60 L 106 60 C 106 68 104 76 100 82 L 95 80 C 98 74 100 67 101 60 Z";

// the upper contour of each tongue, tip to root; drawn dashed in the other picture
const TONGUE_EE_TOP = "M 96 67 C 94 58 90 40 80 32 C 68 27 48 31 38 44 C 33 54 32 90 34 118";
const TONGUE_OH_TOP = "M 95 76 C 88 70 76 62 62 56 C 50 51 38 50 30 58 C 23 66 22 90 24 118";
const TONGUE_FLOOR = " L 50 118 C 60 104 78 94 92 84 Z";
const TONGUE_EE = TONGUE_EE_TOP + TONGUE_FLOOR;
const TONGUE_OH = TONGUE_OH_TOP + TONGUE_FLOOR;
const MOUTH = [
  { kind: "line", d: NOSE },
  { kind: "line", d: CHIN },
  { kind: "line", d: PALATE },
  { kind: "line", d: VELUM },
  { kind: "line", d: PHARYNX },
  { kind: "line", d: UPPER_TOOTH },
  { kind: "line", d: LOWER_TOOTH },
];

export const DRAWINGS = Object.freeze({
  straw: {
    viewBox: VIEW,
    parts: [
      // nose, upper lip pursed onto the straw
      { kind: "line", d: "M 66 2 C 72 14 84 26 94 34 C 99 38 97 43 90 43 L 82 43 C 84 47 90 50 90 54 C 90 57 88 58 86 58" },
      // lower lip from the straw, then chin and under the jaw
      { kind: "line", d: "M 86 66 C 88 66 90 67 90 70 C 90 74 86 77 80 79 C 86 84 90 94 84 102 C 78 108 64 110 50 110" },
      // the straw, from just inside the lips
      { kind: "line", d: "M 80 58 L 156 58 L 156 66 L 80 66" },
      // air going out along it
      { kind: "accent", d: "M 100 50 L 140 50" },
      { kind: "accent", d: "M 135 46 L 140 50 L 135 54" },
    ],
  },

  lipBuzz: {
    viewBox: VIEW,
    parts: [
      // base of the nose
      { kind: "line", d: "M 70 32 C 74 36 86 36 90 32" },
      // the lower face, broken where the fingers lie in front of it
      { kind: "line", d: "M 24 12 C 24 37.5 29 59.2 37.2 75.4" },
      { kind: "line", d: "M 48.7 92.5 C 57.8 102.5 68.6 108 80 108 C 91.4 108 102.2 102.5 111.3 92.5" },
      { kind: "line", d: "M 122.8 75.4 C 131 59.2 136 37.5 136 12" },
      // upper and lower lip
      { kind: "line", d: "M 54 62 C 62 54 70 50 75 52 C 78 53 79 54 80 54 C 81 54 82 53 85 52 C 90 50 98 54 106 62" },
      { kind: "line", d: "M 54 62 C 62 72 72 75 80 75 C 88 75 98 72 106 62" },
      // the line between them, wavy: the lips flapping
      { kind: "accent", d: "M 56 62 Q 59 59 62 62 T 68 62 T 74 62 T 80 62 T 86 62 T 92 62 T 98 62 T 104 62" },
      // fingertips resting on the cheeks beside the corners of the mouth
      { kind: "line", d: "M 30 118 L 43.7 70 C 45 64 53.5 66 52.3 72 L 38.5 118" },
      { kind: "line", d: "M 130 118 L 116.3 70 C 115 64 106.5 66 107.7 72 L 121.5 118" },
    ],
  },

  fingertips: {
    viewBox: VIEW,
    parts: [
      { kind: "line", d: PROFILE },
      { kind: "line", d: EAR },
      // two fingertips from the lower right, resting on the front of the neck
      { kind: "accent", d: "M 158 105 L 86 84 C 80 82 78 90 84 92 L 156 113" },
      { kind: "accent", d: "M 158 117 L 86 96 C 80 94 78 102 84 104 L 136 119.5" },
    ],
  },

  boxUp: {
    viewBox: VIEW,
    parts: [
      { kind: "line", d: PROFILE },
      { kind: "line", d: EAR },
      { kind: "ghost", d: box(BOX_REST) },
      { kind: "accentFill", d: box(BOX_UP) },
      { kind: "accent", d: box(BOX_UP) },
      { kind: "accent", d: "M 55 100 L 55 74" },
      { kind: "accent", d: "M 51 79 L 55 74 L 59 79" },
    ],
  },

  boxDown: {
    viewBox: VIEW,
    parts: [
      { kind: "line", d: PROFILE },
      { kind: "line", d: EAR },
      { kind: "ghost", d: box(BOX_REST) },
      { kind: "accentFill", d: box(BOX_DOWN) },
      { kind: "accent", d: box(BOX_DOWN) },
      { kind: "accent", d: "M 55 81 L 55 107" },
      { kind: "accent", d: "M 51 102 L 55 107 L 59 102" },
    ],
  },

  bright: {
    viewBox: VIEW,
    parts: [
      ...MOUTH,
      { kind: "ghost", d: TONGUE_OH_TOP },
      { kind: "accentFill", d: TONGUE_EE },
      { kind: "accent", d: TONGUE_EE },
      // lips thin and slightly spread, close to the teeth
      { kind: "accent", d: "M 110 33 C 113 40 116 48 115 53 C 114 56 110 57 106 57" },
      { kind: "accent", d: "M 106 63 C 110 63 115 63 115 67 C 115 72 112 78 110 82" },
    ],
  },

  dark: {
    viewBox: VIEW,
    parts: [
      ...MOUTH,
      { kind: "ghost", d: TONGUE_EE_TOP },
      { kind: "accentFill", d: TONGUE_OH },
      { kind: "accent", d: TONGUE_OH },
      // lips rounded and forward
      { kind: "accent", d: "M 110 33 C 115 40 127 45 127 52 C 127 56 123 57 118 57" },
      { kind: "accent", d: "M 118 63 C 123 63 127 65 127 69 C 127 76 117 79 110 82" },
    ],
  },
});
