// synth-chain.mjs — synthetic held notes through the REAL chain (pitch
// worker + DSP worker + handleAnalysisResult). Per 1-s window (0.25 s
// hop): truth SD (smooth contour, semitones), posted SD, painted SD,
// per-hop cents error. Usage:
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/pitch-precision/synth-chain.mjs --src=src --out=build/prec/sc_base.json [--shard=i/n]
import { writeFileSync } from "node:fs";
import { loadSrc, runWorkers, buildFrames, driveHook } from "../session-oracle/lib/chain.mjs";
import { synth, wander, rng } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const S = await loadSrc(args.src ?? "src");
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);

// condition grid
const conds = [];
const R = rng(12345);
const F0S = [82, 95, 110, 125, 145, 165, 190, 220, 250, 290, 340, 390];
const SDS = [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5];
let id = 0;
for (const f0 of F0S) for (const sd of SDS) {
  const kind = ["wander", "wander", "vib", "glide"][id % 4];
  conds.push({ id, f0, sd, kind, jitter: [0.003, 0.006, 0.01][id % 3], shimmer: [0.02, 0.04, 0.06][(id >> 1) % 3], snrDb: [40, 25, 15][(id >> 2) % 3], vowel: "aieu"[id % 4], seed: 1000 + id, sr: id % 5 === 0 ? 44100 : 48000 });
  id++;
}
const DUR = 5, PRE = 0.3, POST = 0.3;
const out = [];
for (const c of conds.filter((_, i) => i % shN === shI)) {
  let contour;
  if (c.kind === "wander") contour = wander(c.seed, c.sd * 100);
  else if (c.kind === "vib") { const w = wander(c.seed, c.sd * 50); const ext = c.sd * 100; contour = (t) => ext * Math.sin(2 * Math.PI * 5.5 * t) + w(t); }
  else { const w = wander(c.seed, c.sd * 30); contour = (t) => c.sd * 100 * 1.7 * Math.sin(2 * Math.PI * 0.35 * t) + w(t); }
  const sig = synth({ sr: c.sr, dur: DUR, f0: c.f0, contour, jitter: c.jitter, shimmer: c.shimmer, snrDb: c.snrDb, vowel: c.vowel, seed: c.seed });
  // pad with low noise (room) before / after
  const pre = Math.round(PRE * c.sr), post = Math.round(POST * c.sr);
  const x = new Float32Array(pre + sig.x.length + post);
  const nr = rng(c.seed + 7); for (let i = 0; i < x.length; i++) x[i] = 0.0005 * nr.g();
  for (let i = 0; i < sig.x.length; i++) x[pre + i] += sig.x[i];
  const W = runWorkers(S, x, c.sr);
  const D = await driveHook(S.hookPath, buildFrames(W), W.n);
  const hop = W.C / W.sr;
  // truth contour sampled at 5 ms (smooth part), in padded time
  const tTruth = [], fTruth = [];
  for (let t = 0; t < DUR; t += 0.005) { tTruth.push(t + PRE); fTruth.push(sig.fSmooth[Math.min(sig.fSmooth.length - 1, Math.round(t * c.sr))]); }
  out.push({ ...c, hop, L: W.L, post: Array.from(W.col.post), paint: Array.from(D.paint), ro: Array.from(D.ro), dec: Array.from(W.col.dec), tTruth, fTruth, pre: PRE, dur: DUR });
}
writeFileSync(args.out, JSON.stringify(out));
console.log(`done ${out.length}`);
