// agg-noise.mjs — tables from fda.mjs shards (2026-10-04 suite).
//   node scripts/notch-adversarial/agg-noise.mjs DIR [--vars=B,N2] [--changed]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=")));
const rows = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) rows.push(...JSON.parse(readFileSync(path.join(dir, f))));
const vars = args.vars ? args.vars.split(",") : Object.keys(rows[0].v);
const P = (x) => (x === null || x === undefined ? "-" : String(x));
for (const part of ["nonly", "start", "midsp", "midpa"]) {
  const rs = rows.filter((r) => r.part === part);
  if (!rs.length) continue;
  console.log(`\n== ${part}`);
  if (part === "nonly") {
    console.log("class".padEnd(26), vars.map((v) => `${v} fv0/p0|fv/p|promo`.padStart(30)).join(""));
    for (const r of rs.sort((a, b) => (a.nz + a.lead).localeCompare(b.nz + b.lead))) {
      const cells = vars.map((v) => { const c = r.v[v]; return `${c.fv0}/${c.painted0}|${c.fv}/${c.painted}|${P(c.promo)}`.padStart(30); });
      if (args.changed && vars.every((v) => JSON.stringify(r.v[v]) === JSON.stringify(r.v[vars[0]]))) continue;
      console.log(`${r.nz}${r.lead ? "+0.1sZeros" : ""}`.padEnd(26), cells.join(""));
    }
    continue;
  }
  // average over offsets per (nz, snr)
  const groups = {};
  for (const r of rs) (groups[`${r.nz} ${r.snr}`] ??= []).push(r);
  const fields = part === "start" ? ["correct", "gapFV", "promo"] : part === "midsp" ? ["correct", "gapFV", "promo"] : ["pauseFV", "correct", "gapFV", "promo"];
  console.log("cell".padEnd(22), vars.map((v) => `${v} ${fields.join("/")}`.padStart(30)).join(""));
  for (const [k, g] of Object.entries(groups).sort()) {
    const cells = vars.map((v) => fields.map((f) => {
      const xs = g.map((r) => r.v[v][f]).filter((x) => x !== null && x !== undefined);
      return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-";
    }).join("/").padStart(30));
    console.log(k.padEnd(22), cells.join(""));
  }
  const tot = vars.map((v) => fields.slice(0, -1).map((f) => (rs.reduce((a, r) => a + r.v[v][f], 0) / rs.length).toFixed(1)).join("/").padStart(30));
  console.log("MEAN".padEnd(22), tot.join(""));
}
