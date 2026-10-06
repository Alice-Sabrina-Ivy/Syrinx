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
  // (2026-10-06) painted FV after the note, where the rows carry it
  const pfvW = rows.filter((r) => r.v[v].pfv != null && r.v[v].pfv > r.v[base].pfv + 2);
  const fail = rows.filter((r) => late.includes(r) || fvW.includes(r) || pfvW.includes(r));
  const worst = (k) => Math.max(0, ...rows.map((r) => (r.v[v][k] ?? 0) - (r.v[base][k] ?? 0)));
  const wl = Math.max(0, ...rows.filter((r) => r.v[base].promo !== null).map((r) => (r.v[v].promo ?? Infinity) - r.v[base].promo));
  console.log(`${v.padEnd(5)} promo mean ${mean(rows.map((r) => r.v[v].promo))} [never ${rows.filter((r) => r.v[v].promo === null).length}]  FV mean ${mean(rows.map((r) => r.v[v].fv))}  later than ${base}: ${late.length}/${rows.length}  FV > ${base}+2: ${fvW.length}  pFV > ${base}+2: ${pfvW.length}  FAIL ${fail.length}/${rows.length} (worst: +${wl.toFixed(2)} s, FV +${worst("fv").toFixed(1)} pp, pFV +${worst("pfv").toFixed(1)} pp)`);
  if (v !== base) for (const r of fail.slice(0, 12)) console.log(`     ${r.hf ?? 120} Hz hum${r.wsd != null ? ` wob ${r.wsd} c` : ""} ${r.noteF} Hz ${r.D} s ${r.end} lvl ${r.lvl} ${r.sr}: ${r.v[v].promo} vs ${r.v[base].promo} (FV ${r.v[v].fv} vs ${r.v[base].fv}${r.v[v].pfv != null ? `, pFV ${r.v[v].pfv} vs ${r.v[base].pfv}` : ""})`);
}
