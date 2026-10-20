// noise-qf.mjs — noise-only false voicing of the baseline and every
// quiet-floor candidate through the REAL chain (lib.mjs), the classes and
// seeds of scripts/session-oracle/noise-fv.mjs (every committed noise-synth
// class + babble + resonant Q5 / Q2; 30 s at 16 kHz; seeded classes pooled
// over --seeds generator seeds, mains-complex once), at several RMS scales:
// 0.03 (about −30 dB, the committed scale — no floor acts there, so it must
// be unchanged) and quiet-room scales (measurements/pitch-quiet-floor-
// 2026-10-20.md §4). Reports % of pitch messages posted voiced and % of
// display hops painted.
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/quiet-floor/noise-qf.mjs \
//        [--scales=0.03,0.001,0.000316,0.0001] [--seeds=3] [--sec=30] [--trees=build/trees]
//        [--classes=a,b] [--out=build/quiet-floor/noise.json]
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { SR, NOISE_TYPES, babble } from "../noise-synth.js";
import { loadAllCorpora } from "../../tests/dsp/data/corpora.js";
import { resampleLinear } from "../../tests/dsp/swift-f0-adapter.js";
import { ALL_CANDS, loadTrees, runAll } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SEC = Number(args.sec ?? 30), SEEDS = Number(args.seeds ?? 3);
const SCALES = (args.scales ?? "0.03,0.001,0.000316,0.0001").split(",").map(Number);
const CANDS = ALL_CANDS;
const T = await loadTrees(resolve(args.trees ?? "build/trees"), CANDS);
const corpora = loadAllCorpora();
const hillSrc = corpora.filter((t) => t.corpus === "hillenbrand").slice(0, 40).filter((_, i) => i % 5 === 0)
  .map((t) => (t.sampleRate === SR ? t.samples : resampleLinear(t.samples, t.sampleRate, SR)));
const names = args.classes ? args.classes.split(",") : [...Object.keys(NOISE_TYPES), "babble", "resonant-noise-q5", "resonant-noise-q2"];
const res = {};
for (const scale of SCALES) for (const nz of names) {
  const acc = {};
  const nSeeds = nz === "mains-complex" ? 1 : SEEDS;
  for (let si = 0; si < nSeeds; si++) {
    const seed = si === 0 ? undefined : 1000 + si; // as noise-fv.mjs
    let sig;
    if (nz === "babble") sig = babble(SEC * SR, hillSrc, seed);
    else if (nz === "resonant-noise-q5") sig = NOISE_TYPES["resonant-noise"](SEC * SR, seed ?? 11, 330, 5);
    else if (nz === "resonant-noise-q2") sig = NOISE_TYPES["resonant-noise"](SEC * SR, seed ?? 11, 330, 2);
    else sig = NOISE_TYPES[nz](SEC * SR, seed);
    sig = Float32Array.from(sig, (x) => x * scale);
    const R = await runAll(T, sig, SR, CANDS);
    for (const c of ["base", ...CANDS]) {
      const { W, D } = R[c];
      const a = acc[c] ??= { nMsg: 0, posted: 0, nHop: 0, painted: 0 };
      for (let k = 0; k < W.n; k++) { if (!Number.isNaN(W.msgPitch[k])) { a.nMsg++; a.posted += W.msgPitch[k] > 0; } if (D.paint[k] > 0) a.painted++; }
      a.nHop += W.n;
    }
  }
  const key = `${scale}|${nz}`;
  res[key] = Object.fromEntries(Object.entries(acc).map(([c, a]) => [c, { posted: 100 * a.posted / a.nMsg, painted: 100 * a.painted / a.nHop }]));
  console.log(`${String(scale).padEnd(8)} ${nz.padEnd(18)} ` + ["base", ...CANDS].map((c) => `${c} ${res[key][c].posted.toFixed(1)}/${res[key][c].painted.toFixed(1)}`).join("  "));
}
const out = resolve(args.out ?? "build/quiet-floor/noise.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(res));
