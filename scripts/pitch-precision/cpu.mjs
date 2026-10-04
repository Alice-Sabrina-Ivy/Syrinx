// cpu.mjs — pitch-worker CPU per 25 ms chunk, alternating src trees on the
// same 120 s of session audio (Alice-heavy span of 2026-05-07), untapped
// (run with SO_TAP=0). Usage: node --import <register> scripts/pitch-precision/cpu.mjs src build/prec/trees/sinc/src ...
import { loadSrc, runWorkers } from "../session-oracle/lib/chain.mjs";
import { readWav } from "../session-oracle/lib/wav.mjs";
const trees = process.argv.slice(2);
const { samples, sr } = readWav("C:/Coding Projects/private-session/sessions/2026-05-07/session.wav");
const clip = samples.subarray(600 * sr, 720 * sr);
const S = [];
for (const t of trees) S.push(await loadSrc(t));
const res = Object.fromEntries(trees.map((t) => [t, []]));
for (let i = 0; i < trees.length; i++) runWorkers(S[i], clip.subarray(0, 20 * sr), sr); // JIT warm-up
const REPS = +(process.env.REPS ?? 5);
for (let rep = 0; rep < REPS; rep++) {
  for (let i = 0; i < trees.length; i++) {
    const W = runWorkers(S[i], clip, sr);
    res[trees[i]].push(W.cpu.pitchMsPerChunk);
  }
}
for (const t of trees) console.log(t, res[t].map((x) => x.toFixed(4)).join(" "), "min", Math.min(...res[t]).toFixed(4), "median", [...res[t]].sort((a, b) => a - b)[res[t].length >> 1].toFixed(4));
