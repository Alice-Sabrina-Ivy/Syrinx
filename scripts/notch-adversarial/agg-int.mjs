// agg-int.mjs — tables + strict-rule check for int.mjs shards.
//   node scripts/notch-adversarial/agg-int.mjs DIR [DIR...] [--vars=B,H,C1] [--base=B] [--fails]
// Rule (round 1): vs the base (bc42ad0) in EVERY cell
//   start: notch whenever base notched, no later than max(6 s, base + 0.3 s);
//          pause FV over [1.5 s, end] <= base + 2 pp
//   weak:  notch whenever base notched, no later than max(21 s, base + 0.3 s)
//          after switch-on; pause FV over [on + 21 s, end] <= base + 2 pp
//          (the accepted ~21 s switch-on latency window excluded)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const rows = [];
for (const d of pos) for (const f of readdirSync(d).filter((f) => f.endsWith(".json"))) rows.push(...JSON.parse(readFileSync(path.join(d, f))));
const vars = args.vars ? args.vars.split(",") : Object.keys(rows[0].v);
const base = args.base || "B";
const key = (r) => r.part === "start" ? `${r.cls} lvl${r.lvl} ${r.pat} t0=${r.t0} ${r.pre} ${r.sr}` : `${r.cls} +${r.db}dB ${r.pat} ${r.place} f${r.center} ${r.sr}`;
function check(r, v) {
  const b = r.v[base], c = r.v[v];
  const lim = r.part === "start" ? 6 : 21;
  const fails = [];
  if (b.promo !== null) {
    if (c.promo === null) fails.push("never notched");
    else if (c.promo > Math.max(lim, b.promo + 0.3)) fails.push(`late ${c.promo} vs ${b.promo}`);
  }
  const fvC = r.part === "start" ? c.fv : c.fvSS, fvB = r.part === "start" ? b.fv : b.fvSS;
  if (fvC !== null && fvB !== null && fvC > fvB + 2) fails.push(`FV ${fvC} vs ${fvB}`);
  return fails;
}
const mean = (xs) => { const ys = xs.filter((x) => x !== null && x !== undefined); return ys.length ? (ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(1) : "-"; };
for (const part of ["start", "weak", "weak2"]) {
  const rs = rows.filter((r) => r.part === part);
  if (!rs.length) continue;
  const groups = {};
  for (const r of rs) {
    const g = part === "start" ? (r.pre !== "none" ? `pre=${r.pre} t0=${r.t0 ?? "noise-only"}` : `t0=${r.t0 ?? "noise-only"}`) : `+${r.db} dB ${r.pat}`;
    (groups[g] ??= []).push(r);
  }
  console.log(`\n== ${part} (${rs.length} cells): promo mean [never] / FV / speech` + (part === "weak" ? " / FV after on+21s" : ""));
  console.log("group".padEnd(30) + vars.map((v) => v.padStart(30)).join(""));
  for (const [g, gr] of Object.entries(groups).sort()) {
    const cells = vars.map((v) => {
      const never = gr.filter((r) => r.v[v].promo === null).length;
      const s = `${mean(gr.map((r) => r.v[v].promo))}[${never}]/${mean(gr.map((r) => r.v[v].fv))}/${mean(gr.map((r) => r.v[v].sp))}` + (part === "weak" ? `/${mean(gr.map((r) => r.v[v].fvSS))}` : "");
      return s.padStart(30);
    });
    console.log(g.padEnd(30) + cells.join(""));
  }
  for (const v of vars) {
    if (v === base) continue;
    const bad = rs.map((r) => [r, check(r, v)]).filter(([, f]) => f.length);
    console.log(`  ${v}: ${bad.length}/${rs.length} cells fail the rule`);
    if (args.fails) for (const [r, f] of bad.slice(0, +(args.fails) || 40)) console.log(`     ${key(r)}: ${f.join("; ")}`);
  }
}
