// held.mjs — the notch work's synthetic held-note suite
// (scripts/notch-adversarial/scenarios.mjs, 1 196 scenarios x 16 / 48 kHz)
// run on any src trees, worker level. Same metric as
// scripts/notch-adversarial/held.mjs: % of hold frames whose POSTED pitch is
// within 8 % of the truth; promo = first notch on k x the note (k = 1..3).
// Rows are agg-held.mjs-compatible (variant name = tree name).
//
//   node scripts/realnoise-fv/held.mjs --trees=base=src,c1=build/rnfv-trees/c1/src
//        [--sr=16000,48000] [--shard=i/n] [--out=F] [--family=..]
import { writeFileSync } from "node:fs";
import { heldScenarios } from "../notch-adversarial/scenarios.mjs";
import { parseTrees, loadWorkers, runWorker } from "./lib/worker.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const trees = parseTrees(args.trees ?? "base=src");
const H = await loadWorkers(trees);
const SRS = (args.sr || "16000,48000").split(",").map(Number);
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
let list = heldScenarios();
if (args.family) list = list.filter((s) => args.family.split(",").includes(s.family));
const jobs = [];
for (const sc of list) for (const sr of SRS) jobs.push([sc, sr]);
const mine = jobs.filter((_, i) => i % shN === shI);
const near = (f, lo, hi) => [1, 2, 3].some((k) => f >= k * lo * 0.96 && f <= k * hi * 1.04);
const rows = [];
for (const [sc, sr] of mine) {
  const { x, truthAt } = sc.build(sr);
  const row = { name: sc.name, family: sc.family, sr, v: {} };
  for (const t of trees) {
    const msgs = runWorker(H[t.name], x, sr);
    let n = 0, ok = 0, promo = null;
    for (const m of msgs) {
      if (promo === null && m.nf && m.nf.some((f) => sc.promoF.some(([lo, hi]) => near(f, lo, hi)))) promo = +m.t.toFixed(2);
      if (!sc.holds.some(([a, b]) => m.t >= a + 0.3 && m.t <= b - 0.1)) continue;
      const f = truthAt(m.t);
      if (!(f > 0)) continue;
      n++;
      if (m.pitch > 0 && Math.abs(m.pitch / f - 1) < 0.08) ok++;
    }
    row.v[t.name] = { ok: +(100 * ok / n).toFixed(2), painted: 0, promo };
  }
  rows.push(row);
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));
console.log(`held ${shI}/${shN}: ${rows.length} rows`);
