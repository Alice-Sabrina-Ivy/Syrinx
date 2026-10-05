// noise-fv.mjs — noise-only false voicing through the REAL production chain
// (lib/chain.mjs: pitch worker incl. notch / ghost veto / above-range null /
// harmonic guard, DSP worker, handleAnalysisResult), 2026-10-04 low-register
// voicing pass (measurements/pitch-low-register-voicing-2026-10-04.md).
// Every committed noise-synth class (+ babble and the resonant Q5 / Q2
// variants of voicing-robustness-shootout.js), 30 s at RMS 0.03 (the
// shootout's ambient scale), 16 kHz. Reports % of hops the worker POSTED
// voiced and % of display hops PAINTED. --seeds=N repeats every seeded
// class with N generator seeds (the default seed, then 1000+i) and pools
// them — at 30 s x 1 seed one painted blip is ~1.4 %, too coarse to rank
// variants (mains-complex is unseeded and runs once).
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/noise-fv.mjs \
//        [--src=src] [--tag=head] [--sec=30] [--scale=0.03] [--seeds=1] [--out=build/session-oracle/noisefv]
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc, runWorkers, buildFrames, driveHook } from "./lib/chain.mjs";
import { SR, NOISE_TYPES, babble } from "../noise-synth.js";
import { loadAllCorpora } from "../../tests/dsp/data/corpora.js";
import { resampleLinear } from "../../tests/dsp/swift-f0-adapter.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SEC = Number(args.sec ?? 30), SCALE = Number(args.scale ?? 0.03), SEEDS = Number(args.seeds ?? 1);
const S = await loadSrc(args.src ?? "src");
const corpora = loadAllCorpora();
const hillSrc = corpora.filter((t) => t.corpus === "hillenbrand").slice(0, 40).filter((_, i) => i % 5 === 0)
  .map((t) => (t.sampleRate === SR ? t.samples : resampleLinear(t.samples, t.sampleRate, SR)));
const names = [...Object.keys(NOISE_TYPES), "babble", "resonant-noise-q5", "resonant-noise-q2"];
const res = {};
for (const nz of names) {
  let posted = 0, nPost = 0, painted = 0, nHop = 0;
  const nSeeds = nz === "mains-complex" ? 1 : SEEDS;
  for (let si = 0; si < nSeeds; si++) {
    const seed = si === 0 ? undefined : 1000 + si; // undefined = the generator's default seed
    let sig;
    if (nz === "babble") sig = babble(SEC * SR, hillSrc, seed);
    else if (nz === "resonant-noise-q5") sig = NOISE_TYPES["resonant-noise"](SEC * SR, seed ?? 11, 330, 5);
    else if (nz === "resonant-noise-q2") sig = NOISE_TYPES["resonant-noise"](SEC * SR, seed ?? 11, 330, 2);
    else sig = NOISE_TYPES[nz](SEC * SR, seed);
    sig = Float32Array.from(sig, (x) => x * SCALE);
    const W = runWorkers(S, sig, SR);
    const D = await driveHook(S.hookPath, buildFrames(W), W.n);
    for (let k = 0; k < W.n; k++) { if (!Number.isNaN(W.msgPitch[k])) { nPost++; if (W.msgPitch[k] > 0) posted++; } if (D.paint[k] > 0) painted++; }
    nHop += W.n;
  }
  res[nz] = { posted: 100 * posted / nPost, painted: 100 * painted / nHop };
  console.log(`${nz.padEnd(18)} posted ${res[nz].posted.toFixed(2).padStart(6)} %  painted ${res[nz].painted.toFixed(2).padStart(6)} %`);
}
const out = resolve(args.out ?? "build/session-oracle/noisefv");
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, `${args.tag ?? "head"}.json`), JSON.stringify(res));
