// agg-held.mjs — family tables + strict-rule check for held.mjs shards.
//   node scripts/notch-adversarial/agg-held.mjs DIR [--vars=B,H,C1] [--base=B] [--by=family|family+sr|sub] [--worse]
// Cells: % of hold frames reported at pitch (|p/f0-1| < 0.08), (# runs where a
// notch promoted onto the voice), painted % in the display replay after "|".
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const rows = [];
// several DIRs: rows of the same scenario + rate are merged (later DIRs win
// per variant), so variants run separately can be compared
const byKey = new Map();
for (const d of pos) for (const f of readdirSync(d).filter((f) => f.endsWith(".json"))) for (const r of JSON.parse(readFileSync(path.join(d, f)))) {
  const k = `${r.name} ${r.sr}`;
  if (byKey.has(k)) Object.assign(byKey.get(k).v, r.v); else { byKey.set(k, r); rows.push(r); }
}
const vars = args.vars ? args.vars.split(",") : Object.keys(rows[0].v);
// only scenarios every listed variant ran (e.g. one variant at 16 kHz only)
for (let i = rows.length - 1; i >= 0; i--) if (!vars.every((v) => rows[i].v[v]) || (args.sr && String(rows[i].sr) !== args.sr)) rows.splice(i, 1);
const base = args.base || "B";
const by = args.by || "family";
// sub-family: repeat families split by breath length
const sub = (r) => {
  if (r.family === "repeat" || r.family === "repeatnoisy") return `${r.family} ${r.name.match(/breath([\d.]+)s/)[1]}s`;
  return r.family;
};
const gk = (r) => by === "family+sr" ? `${r.family} ${r.sr}` : by === "sub" ? sub(r) : by === "sub+sr" ? `${sub(r)} ${r.sr}` : r.family;
const groups = {};
for (const r of rows) (groups[gk(r)] ??= []).push(r);
const m = (xs) => (xs.reduce((a, b) => a + b, 0) / xs.length);
console.log("group".padEnd(26) + "n".padStart(5) + vars.map((v) => v.padStart(22)).join(""));
const fails = {};
for (const [g, gr] of Object.entries(groups).sort()) {
  const bOk = m(gr.map((r) => r.v[base].ok));
  console.log(g.padEnd(26) + String(gr.length).padStart(5) + vars.map((v) => {
    const ok = m(gr.map((r) => r.v[v].ok)), pr = gr.filter((r) => r.v[v].promo !== null && r.v[v].promo < 1e9).length, pa = m(gr.map((r) => r.v[v].painted));
    if (v !== base && ok < bOk - 0.05) (fails[v] ??= []).push(`${g} ${ok.toFixed(2)} < ${bOk.toFixed(2)}`);
    return `${ok.toFixed(1)} (${pr}) |${pa.toFixed(1)}`.padStart(22);
  }).join(""));
}
const all = vars.map((v) => m(rows.map((r) => r.v[v].ok)).toFixed(2));
console.log("ALL".padEnd(26) + String(rows.length).padStart(5) + all.map((x) => x.padStart(22)).join(""));
for (const v of vars) if (v !== base) console.log(`  ${v}: ${fails[v]?.length ?? 0} groups below ${base}${fails[v] ? ": " + fails[v].join("; ") : ""}`);
if (args.worse) for (const v of vars) {
  if (v === base) continue;
  const w = rows.filter((r) => r.v[v].ok < r.v[base].ok - 1).sort((a, b) => (a.v[v].ok - a.v[base].ok) - (b.v[v].ok - b.v[base].ok));
  console.log(`\n${v}: ${w.length} scenarios > 1 pp below ${base}`);
  for (const r of w.slice(0, 30)) console.log(`   ${r.name} ${r.sr}: ${r.v[v].ok} vs ${r.v[base].ok} (promo ${r.v[v].promo} vs ${r.v[base].promo})`);
}
