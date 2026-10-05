// agg-handoff.mjs DIR [--base=B] — handoff-adv.mjs shards: per variant, cells
// where the hum line promotes later than the base (> 0.3 s) or never
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const base = (process.argv.find((a) => a.startsWith("--base=")) || "--base=B").slice(7);
const rows = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) rows.push(...JSON.parse(readFileSync(path.join(dir, f))));
const vars = Object.keys(rows[0].v);
const mean = (xs) => { const y = xs.filter((x) => x !== null); return y.length ? (y.reduce((a, b) => a + b, 0) / y.length).toFixed(1) : "-"; };
for (const v of vars) {
  const late = rows.filter((r) => r.v[base].promo !== null && (r.v[v].promo === null || r.v[v].promo > r.v[base].promo + 0.3));
  const fvW = rows.filter((r) => r.v[v].fv > r.v[base].fv + 2);
  console.log(`${v.padEnd(5)} promo mean ${mean(rows.map((r) => r.v[v].promo))} [never ${rows.filter((r) => r.v[v].promo === null).length}]  FV mean ${mean(rows.map((r) => r.v[v].fv))}  later than ${base}: ${late.length}/${rows.length}  FV > ${base}+2: ${fvW.length}`);
  if (v !== base) for (const r of late.slice(0, 12)) console.log(`     ${r.noteF} Hz ${r.D} s ${r.end} lvl ${r.lvl} ${r.sr}: ${r.v[v].promo} vs ${r.v[base].promo} (FV ${r.v[v].fv} vs ${r.v[base].fv})`);
}
