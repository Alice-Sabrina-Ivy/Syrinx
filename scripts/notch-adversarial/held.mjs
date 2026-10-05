// held.mjs — held-note side of the round-1 adversarial suite (real worker).
//   node scripts/notch-adversarial/held.mjs --variants=B,H,C1 --sr=16000,48000 --shard=i/n --out=F [--family=..] [--match=..]
import { writeFileSync } from "node:fs";
import { heldScenarios } from "./scenarios.mjs";
import { runWorker, displayed, parseArgs } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";

const args = parseArgs();
const VARS = (args.variants || "B").split(",");
const SRS = (args.sr || "16000").split(",").map(Number);
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
let list = heldScenarios();
if (args.family) list = list.filter((s) => args.family.split(",").includes(s.family));
if (args.match) list = list.filter((s) => s.name.includes(args.match));
const jobs = [];
for (const sc of list) for (const sr of SRS) jobs.push([sc, sr]);
const mine = jobs.filter((_, i) => i % shN === shI);
const near = (f, lo, hi) => [1, 2, 3].some((k) => f >= k * lo * 0.96 && f <= k * hi * 1.04);
const rows = [];
for (const [sc, sr] of mine) {
  const { x, truthAt } = sc.build(sr);
  const row = { name: sc.name, family: sc.family, sr, v: {} };
  for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], x, sr);
    const disp = displayed(msgs);
    let n = 0, ok = 0, dok = 0, promo = null;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (promo === null && m.nf && m.nf.some((f) => sc.promoF.some(([lo, hi]) => near(f, lo, hi)))) promo = +m.t.toFixed(2);
      if (!sc.holds.some(([a, b]) => m.t >= a + 0.3 && m.t <= b - 0.1)) continue;
      const f = truthAt(m.t);
      if (!(f > 0)) continue;
      n++;
      if (m.pitch > 0 && Math.abs(m.pitch / f - 1) < 0.08) ok++;
      if (disp[i] > 0 && Math.abs(disp[i] / f - 1) < 0.08) dok++;
    }
    row.v[vn] = { ok: +(100 * ok / n).toFixed(2), painted: +(100 * dok / n).toFixed(2), promo };
  }
  rows.push(row);
  console.log(`${sc.name.padEnd(48)} ${sr} ` + VARS.map((vn) => `${vn}:${row.v[vn].ok}/${row.v[vn].promo ?? "-"}`).join(" "));
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));
