// matrix.js — the pre-registered timing matrix (§P5 of
// measurements/voice-preview-spike-2026-10-12.md), shared by the page and the Node analysis.
//
// One run = one fresh Worker: C0 (module load), cold G1 (analysis + first render at
// +2 st / x1.03), 20 x G2 (the 10 settings below, twice), 5 x warm G1.
// Blocks (desktop Chrome covers all; Firefox world-auto, world-nosimd, psola at 5 s):
//   world-auto    WORLD, build chosen by feature detection, selected front end, every length
//   world-nosimd  WORLD, non-SIMD build, selected front end, 5 s
//   psola         PSOLA, selected front end, 5 s
//   fe-other      WORLD, each other front end, 5 s
//   fp10          WORLD, selected front end, 10 ms frames, 5 s
// Order: repeat-major; within a repeat every block's (length, rate, clip) list is rotated by
// the repeat index, so rates and clips interleave and drift spreads across them.

export const FIRST = Object.freeze({ st: 2, a: 1.03 });
export const G2_SETTINGS = Object.freeze([
  [2, 1.03], [-2, 0.97], [4, 1.0], [-4, 1.0], [0, 1.06], [0, 0.94], [6, 1.12], [-6, 0.88], [9, 1.15], [-9, 0.87],
]);
export const G2_CYCLES = 2;
export const WARM_G1 = 5;
export const FRONT_ENDS = ["H", "D", "S", "L"];
export const ALL_BLOCKS = ["world-auto", "world-nosimd", "psola", "fe-other", "fp10"];

export function buildMatrix({
  runs = 10, fe = "L", blocks = ALL_BLOCKS, rates = [24000, 22050, 16000], lengths = [3, 5, 8],
  clips = ["M01", "M02", "F01", "F02"],
} = {}) {
  const five = lengths.includes(5) ? [5] : lengths;
  const spec = [];
  for (const b of blocks) {
    if (b === "world-auto") spec.push({ block: b, engine: "world", build: "auto", fes: [fe], fp: 5, lengths });
    else if (b === "world-nosimd") spec.push({ block: b, engine: "world", build: "nosimd", fes: [fe], fp: 5, lengths: five });
    else if (b === "psola") spec.push({ block: b, engine: "psola", build: "auto", fes: [fe], fp: 5, lengths: five });
    else if (b === "fe-other") spec.push({ block: b, engine: "world", build: "auto", fes: FRONT_ENDS.filter((f) => f !== fe), fp: 5, lengths: five });
    else if (b === "fp10") spec.push({ block: b, engine: "world", build: "auto", fes: [fe], fp: 10, lengths: five });
    else throw new Error(`unknown block ${b}`);
  }
  const out = [];
  for (let rep = 0; rep < runs; rep++) {
    for (const s of spec) {
      for (const f of s.fes) {
        const combos = [];
        for (const length of s.lengths) for (const rate of rates) for (const clip of clips) combos.push({ length, rate, clip });
        const k = rep % combos.length;
        for (const c of [...combos.slice(k), ...combos.slice(0, k)]) {
          out.push({ i: out.length, rep, block: s.block, engine: s.engine, build: s.build, fe: f, fp: s.fp, ...c });
        }
      }
    }
  }
  return out;
}

/** The browser-vs-Node identity cases (§P3 cross-engine check): 3 cells each, per build. The
 * next three (added after review, 2026-10-12) cover the gate configuration: F-S (the posted
 * track, mapped, + StoneMask) at 24 and 22.05 kHz, and PSOLA with F-S. The last two (§ Addition
 * 2026-10-12, A4) are WORLD F-S at the new rates: 48 kHz on M01 (no resampling) and 32 kHz on
 * F02. 8 cases x 3 cells x 2 builds = 48 outputs. */
export const IDENTITY_CASES = Object.freeze([
  { clip: "M01", length: 5, rate: 16000, fe: "L", engine: "world" },
  { clip: "F01", length: 5, rate: 24000, fe: "H", engine: "world" },
  { clip: "M01", length: 5, rate: 16000, fe: "L", engine: "psola" },
  { clip: "F01", length: 5, rate: 24000, fe: "S", engine: "world" },
  { clip: "M02", length: 5, rate: 22050, fe: "S", engine: "world" },
  { clip: "F02", length: 5, rate: 24000, fe: "S", engine: "psola" },
  { clip: "M01", length: 5, rate: 48000, fe: "S", engine: "world" },
  { clip: "F02", length: 5, rate: 32000, fe: "S", engine: "world" },
]);
export const IDENTITY_CELLS = Object.freeze([[2, 1.03], [-2, 0.97], [0, 1.0]]);

/** The page's configuration from its query string (shared with the Node driver). */
export function cfgFromParams(qs) {
  const list = (k, d, f = (v) => v) => (qs.get(k) ? qs.get(k).split(",").filter(Boolean).map(f) : d);
  return {
    mode: qs.get("mode") || "timing",
    runs: Number(qs.get("runs") || 10),
    fe: qs.get("fe") || "L",
    blocks: list("blocks", ALL_BLOCKS),
    rates: list("rates", [24000, 22050, 16000], Number),
    lengths: list("lengths", [3, 5, 8], Number),
    clips: list("clips", ["M01", "M02", "F01", "F02"]),
    run: qs.get("run") === null ? null : Number(qs.get("run")),
    builds: list("builds", ["simd", "nosimd"]),
    // clip folder under VP_CACHE/clips: "timing" (pre-registered) or "timing-speech"
    clipset: /^[\w-]+$/.test(qs.get("clipset") || "") ? qs.get("clipset") : "timing",
  };
}
