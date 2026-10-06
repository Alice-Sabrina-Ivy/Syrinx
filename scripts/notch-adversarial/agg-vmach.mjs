// agg-vmach.mjs — vmach.mjs shards (2026-10-06 fix round): per variant, the
// strict rule vs the base per LINE (every line the base notched, notched no
// later than max(6 s, base + 0.3 s)) and painted FV <= base + 2 pp, with the
// worst lateness and the painted-FV cost, by part / f0.
//   node scripts/notch-adversarial/agg-vmach.mjs DIR [...] [--base=B] [--fails=N]
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
const A = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const rows = [];
for (const d of argv.filter((a) => !a.startsWith("--"))) {
  const files = statSync(d).isDirectory() ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => path.join(d, f)) : [d];
  for (const f of files) rows.push(...JSON.parse(readFileSync(f)));
}
const base = A.base || "B", vars = Object.keys(rows[0].v);
const fails = (r, v) => {
  const b = r.v[base], c = r.v[v], f = [];
  b.promo.forEach((tb, k) => {
    if (tb === null) return;
    const tc = c.promo[k];
    if (tc === null || tc > Math.max(6, tb + 0.3)) f.push(`line ${k + 1}: ${tc ?? "never"} vs ${tb}`);
  });
  if (c.pfv > b.pfv + 2) f.push(`pFV ${c.pfv} vs ${b.pfv}`);
  return f;
};
const mean = (xs) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
const groups = {};
for (const r of rows) {
  (groups[`${r.part} ${r.sr}`] ??= []).push(r);
  (groups[`${r.part} f0 ${r.f0}`] ??= []).push(r);
  (groups.ALL ??= []).push(r);
}
console.log(`${rows.length} cells. Per group: painted FV mean per variant; cells failing the strict rule vs ${base}`);
console.log("group".padEnd(18) + "n".padStart(5) + vars.map((v) => v.padStart(20)).join(""));
for (const [g, rs] of Object.entries(groups)) {
  console.log(g.padEnd(18) + String(rs.length).padStart(5) + vars.map((v) => `${mean(rs.map((r) => r.v[v].pfv))}${v === base ? "" : ` [${rs.filter((r) => fails(r, v).length).length}]`}`.padStart(20)).join(""));
}
for (const v of vars) {
  if (v === base) continue;
  const bad = rows.filter((r) => fails(r, v).length);
  const late = Math.max(0, ...rows.flatMap((r) => r.v[base].promo.map((tb, k) => (tb === null ? 0 : (r.v[v].promo[k] ?? 30) - tb))));
  const dp = Math.max(0, ...rows.map((r) => r.v[v].pfv - r.v[base].pfv));
  console.log(`\n${v}: ${bad.length}/${rows.length} cells fail; worst +${late.toFixed(2)} s late, painted FV +${dp.toFixed(1)} pp`);
  if (A.fails) for (const r of bad.slice(0, +A.fails)) console.log(`   ${r.part} ${r.f0} Hz ${r.fm}${r.nz ? " +noise" : ""}${r.T1 !== undefined ? ` ramp -${r.dB} dB from ${r.T1} s over ${r.R} s` : ""} ${r.sr}: ${fails(r, v).join("; ")}`);
}
