// held-painted.mjs — the notch work's synthetic held-note suite
// (scripts/notch-adversarial/scenarios.mjs heldScenarios) scored on the
// PAINTED trace of the real display hook (2026-10-06, pitch-hold bridge
// rework). held.mjs scores the posted pitch only, so a display-only change is
// identical there by construction; here the REAL pitch + DSP workers of one
// src tree (--worker) run once per scenario (session-oracle lib/chain.mjs,
// which hands the DSP worker's cpp / hnr / tilt to the hook as production
// does) and the REAL handleAnalysisResult of every --trees tree is driven
// over the same frames.
// Metrics per scenario: worker = % of hold frames (hold a + 0.3 s .. b - 0.1 s,
// frame centre) whose posted pitch is within 8 % of the truth (held.mjs);
// per tree: painted = the same at the display alignment (frame centre - L
// hops - 30 ms) on the live trace, paintF = on the trace as it stands at the
// end of the stream (differs only for a display that fills entries late).
//
//   node --import ./scripts/realnoise-fv/lib/register.mjs scripts/realnoise-fv/held-painted.mjs \
//     --worker=<tree>/src --trees=base=<tree>/src,cand=<tree>/src [--sr=16000,48000] [--shard=i/n] [--family=..]
//     [--suite=held|lowband] --out=F
// --suite=lowband (fix round 2026-10-06): scenarios.mjs lowBandScenarios(),
// held notes at 80-120 Hz built to make the detector drop frames.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { heldScenarios, lowBandScenarios } from "../notch-adversarial/scenarios.mjs";
import { loadSrc, runWorkers, buildFrames, driveHook } from "../session-oracle/lib/chain.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const S = await loadSrc(args.worker ?? "src");
const trees = (args.trees ?? "base=src").split(",").map((p) => {
  const [name, path] = p.split("="); return { name, hookPath: resolve(path, "audio/useAudioPipeline.js") };
});
const SRS = (args.sr || "16000,48000").split(",").map(Number);
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
let list = args.suite === "lowband" ? lowBandScenarios() : heldScenarios();
if (args.family) list = list.filter((s) => args.family.split(",").includes(s.family));
const jobs = [];
for (const sc of list) for (const sr of SRS) jobs.push([sc, sr]);
const mine = jobs.filter((_, i) => i % shN === shI);
const rows = [];
const t0 = Date.now();
for (const [sc, sr] of mine) {
  const { x, truthAt } = sc.build(sr);
  const W = runWorkers(S, x, sr);
  const hop = W.C / W.sr;
  const inHold = (t) => sc.holds.some(([a, b]) => t >= a + 0.3 && t <= b - 0.1);
  let wn = 0, wok = 0;
  for (let k = 0; k < W.n; k++) {
    const t = (k + 1) * hop - 0.040;
    if (!inHold(t)) continue;
    const f = truthAt(t);
    if (!(f > 0)) continue;
    wn++;
    if (W.col.post[k] > 0 && Math.abs(W.col.post[k] / f - 1) < 0.08) wok++;
  }
  const frames = buildFrames(W);
  const row = { name: sc.name, family: sc.family, sr, worker: wn ? +(100 * wok / wn).toFixed(3) : null, v: {} };
  for (const tr of trees) {
    const D = await driveHook(tr.hookPath, frames, W.n);
    let n = 0, ok = 0, okF = 0;
    for (let k = 0; k < W.n; k++) {
      const t = (k + 1) * hop - 0.040 - W.L * hop - 0.030;
      if (!inHold(t)) continue;
      const f = truthAt(t);
      if (!(f > 0)) continue;
      n++;
      if (D.paint[k] > 0 && Math.abs(D.paint[k] / f - 1) < 0.08) ok++;
      if (D.paintF[k] > 0 && Math.abs(D.paintF[k] / f - 1) < 0.08) okF++;
    }
    row.v[tr.name] = { painted: n ? +(100 * ok / n).toFixed(3) : null, paintF: n ? +(100 * okF / n).toFixed(3) : null, n };
  }
  rows.push(row);
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));
console.log(`held-painted ${shI}/${shN}: ${rows.length} rows ${((Date.now() - t0) / 1000).toFixed(0)} s`);
