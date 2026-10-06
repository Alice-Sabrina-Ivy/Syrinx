// afterspeech.mjs — painted false voicing on REAL noise after and between
// real speech (pitch-hold bridge rework, review fix round 2026-10-06). The
// voice-in-noise mixes' noise segments all lie within seconds of speech and
// the noise-only clips contain no speech at all; a live session is neither.
// The REAL pitch + DSP workers of one src tree (--worker) run once per
// condition; the REAL handleAnalysisResult of every --trees tree is driven
// over the same frames (lib/chain.mjs).
//
// Conditions per noise clip (>= --min-dur s, first 90 s):
//   C0  noise only;
//   C1  one PTDB-TUG sentence at t = 1 s, then noise;
//   C2  a PTDB-TUG sentence every 15 s (a session with pauses).
// Sentences: the notch corpora's PTDB-TUG voice clips (3-7 s), alternating
// male / female, mixed at --snr dB (noise RMS vs the sentence's active RMS).
// Scored hops: noise-only display hops >= 0.5 s from any sentence, binned by
// the time since the last sentence ended ("pre" = no sentence yet); plus the
// sentence hops painted (sanity). Output: one JSON row per clip.
//
//   node --import ./scripts/realnoise-fv/lib/register.mjs scripts/realnoise-fv/afterspeech.mjs \
//     --worker=<tree>/src --trees=base=<tree>/src,cand=<tree>/src [--every=3] [--snr=10] [--min-dur=60]
//     [--split=tune|held|all] [--shard=i/n] --out=F
//   python scripts/realnoise-fv/afterspeech.py F [F ...]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataRoot, noiseSet, splitOf } from "./lib/sets.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
dataRoot(args);
const { loadIndex, readClip } = await import("../notch-adversarial/realdata/realdata.mjs");
const { loadSrc, runWorkers, buildFrames, driveHook } = await import("../session-oracle/lib/chain.mjs");
const S = await loadSrc(args.worker ?? "src");
const trees = (args.trees ?? "base=src").split(",").map((p) => {
  const [name, path] = p.split("="); return { name, hookPath: resolve(path, "audio/useAudioPipeline.js") };
});
const SR = 16000, SNR = Number(args.snr ?? 10), EVERY = Number(args.every ?? 3), MAXS = 90;
const MIN_DUR = Number(args["min-dur"] ?? 60), SPLIT = args.split ?? "all";
let clips = noiseSet(loadIndex).filter((r) => r.dur >= MIN_DUR && (SPLIT === "all" || splitOf(r.id) === SPLIT));
clips = clips.filter((_, i) => i % EVERY === 0);
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const mine = clips.map((r, i) => [r, i]).filter((_, j) => j % shN === shI);
const voices = loadIndex("voice", { source: "ptdb" }).filter((r) => r.dur >= 3 && r.dur <= 7);
const vF = voices.filter((r) => r.gender === "f"), vM = voices.filter((r) => r.gender === "m");
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / Math.max(1, x.length)); };
function activeRms(x) { // RMS over the 25 ms blocks within 40 dB of the loudest block
  const B = 400, e = [];
  for (let i = 0; i + B <= x.length; i += B) e.push(rms(x.subarray(i, i + B)));
  const mx = Math.max(...e); const a = e.filter((v) => v > mx * 0.01);
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
}
function mix(noise, starts, vlist) {
  const y = Float32Array.from(noise); const nr = rms(noise); const spans = [];
  starts.forEach((t0, j) => {
    const v = readClip(vlist[j % vlist.length].path); const g = nr * Math.pow(10, SNR / 20) / activeRms(v);
    const o = Math.round(t0 * SR); if (o + v.length > y.length) return;
    for (let i = 0; i < v.length; i++) y[o + i] += g * v[i];
    spans.push([t0, t0 + v.length / SR]);
  });
  return { y, spans };
}
const BINS = [["pre", -Infinity, 0], ["0-5", 0, 5], ["5-10", 5, 10], ["10-20", 10, 20], ["20-40", 20, 40], ["40+", 40, Infinity]];
const rows = [];
const t0 = Date.now();
for (const [r, ci] of mine) {
  let noise = readClip(r.path); if (noise.length > MAXS * SR) noise = noise.subarray(0, MAXS * SR);
  const dur = noise.length / SR;
  const vl = ci % 2 ? vF.slice(ci % 7) : vM.slice(ci % 7);
  const conds = {
    C0: { y: noise, spans: [] },
    C1: mix(noise, [1], vl),
    C2: mix(noise, Array.from({ length: Math.floor((dur - 8) / 15) + 1 }, (_, j) => 1 + 15 * j), vl),
  };
  const row = { id: r.id, label: r.label, source: r.source, split: splitOf(r.id), dur, c: {} };
  for (const [cn, { y, spans }] of Object.entries(conds)) {
    const W = runWorkers(S, y, SR); const hop = W.C / SR;
    const frames = buildFrames(W);
    const D = {}; for (const tr of trees) D[tr.name] = await driveHook(tr.hookPath, frames, W.n);
    const bins = {}; const voice = { n: 0 };
    for (const tr of trees) voice[tr.name] = 0;
    for (let k = 0; k < W.n; k++) {
      if (!Number.isFinite(W.col.inten[k])) continue;
      const t = (k + 1) * hop - 0.040 - W.L * hop - 0.030; // display alignment
      if (spans.some(([a, b]) => t >= a && t <= b)) {
        voice.n++; for (const tr of trees) if (D[tr.name].paint[k] > 0) voice[tr.name]++;
        continue;
      }
      if (spans.some(([a, b]) => t >= a - 0.5 && t <= b + 0.5)) continue;
      const ends = spans.filter(([, b]) => b < t).map(([, b]) => b);
      const since = ends.length ? t - Math.max(...ends) : -1;
      const key = BINS.find(([, lo, hi]) => (since < 0 ? lo === -Infinity : since >= lo && since < hi))[0];
      const b = (bins[key] ??= { n: 0 });
      b.n++; for (const tr of trees) if (D[tr.name].paint[k] > 0) b[tr.name] = (b[tr.name] ?? 0) + 1;
    }
    row.c[cn] = { bins, spans, voice };
  }
  rows.push(row);
  if (args.out) writeFileSync(args.out, JSON.stringify({ trees: trees.map((t) => t.name), snr: SNR, rows }));
}
console.log(`afterspeech ${shI}/${shN}: ${rows.length} clips ${((Date.now() - t0) / 1000).toFixed(0)} s`);
