// cpu-micro.mjs — per-frame cost of the post-decode refiners (pitch-refine.js)
// vs the production detector.candidates(), on the same 80 ms frames of a
// synthetic held vowel; best of 7 timed passes of 2 000 frames each (the
// whole-chain timing in cpu.mjs is too noisy on a shared desktop).
import { createBoersmaAC } from "../../src/dsp/boersma-ac.js";
import { createRefiner } from "./pitch-refine.js";
import { synth } from "./lib.mjs";
const N = 1280;
const sig = synth({ sr: 16000, dur: 2.2, f0: 180, jitter: 0.005, shimmer: 0.03, snrDb: 30 });
const frames = []; for (let s = N; s <= sig.x.length; s += 16) frames.push(sig.x.subarray(s - N, s));
const det = createBoersmaAC(16000, N);
const ref = { sinc: createRefiner(16000, N, "sinc"), sub40: createRefiner(16000, N, "sub40") };
function time(fn) {
  let best = Infinity;
  for (let r = 0; r < 7; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 2000; i++) fn(frames[i % frames.length]);
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6 / 2000);
  }
  return best;
}
const c = time((f) => det.candidates(f));
console.log(`candidates() ${c.toFixed(4)} ms/frame`);
for (const [k, fn] of Object.entries(ref)) console.log(`refine ${k} ${time((f) => fn(f, 180)).toFixed(4)} ms/frame`);
