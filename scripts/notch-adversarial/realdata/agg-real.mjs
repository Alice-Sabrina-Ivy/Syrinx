// agg-real.mjs — tables + per-stream strict-rule check for realeval.mjs shards
// (2026-10-05).
//   node scripts/notch-adversarial/realdata/agg-real.mjs DIR|FILE [...] [--vars=B,R8,V4] [--base=B] [--fails=N]
// Strict rule vs the base (bc42ad0), per STREAM (every real clip / mix is a cell):
//   noise / vin (noise present from t = 0): notch whenever the base notched, no
//     later than max(6 s, base + 0.3 s); painted FV (noise: whole clip; vin:
//     lead and tail) <= base + 2 pp
//   gated (source switching on at 2 s): notch whenever the base notched, no
//     later than max(21 s, base + 0.3 s) after switch-on; painted FV from
//     switch-on + 21 s <= base + 2 pp
//   voice side (vin program, held): reported, not part of the interferer rule
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const rows = [];
for (const d of pos) {
  const files = statSync(d).isDirectory() ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => path.join(d, f)) : [d];
  for (const f of files) rows.push(...JSON.parse(readFileSync(f)));
}
const vars = args.vars ? args.vars.split(",") : Object.keys(rows[0].v);
const base = args.base || "B";
const mean = (xs) => { const ys = xs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null; };
const f1 = (x) => (x === null ? "-" : x.toFixed(1));
const GROUP = {
  noise: (r) => r.label + (r.flags?.includes("r8_pattern") ? " (r8_pattern)" : ""),
  gated: (r) => `period ${r.period_s} s, off ${r.off_s} s`,
  vin: (r) => `${r.voice_kind} ${r.snr_db >= 0 ? "+" : ""}${r.snr_db} dB`,
  held: (r) => `gap ${r.gap_s} s`,
};
const COLS = {
  noise: [["promo", "promo"], ["pfv", "pFV"], ["pfv20", "pFV>20s"]],
  gated: [["promo", "promo"], ["pfvAll", "pFV all"], ["pfv", "pFV>21s"]],
  vin: [["promo", "promo"], ["pfvLead", "lead pFV"], ["pfvTail", "tail pFV"], ["pok", "voice pOK"], ["ok", "voice OK"], ["hok", "hold pOK"], ["pfvProg", "prog pFV"]],
  held: [["pok", "hold pOK"], ["ok", "hold OK"], ["promoV", "promo@voice"]],
};
function check(r, v) {
  const b = r.v[base], c = r.v[v], f = [];
  if (r.set === "held") return f;
  const lim = r.set === "gated" ? 21 : 6;
  if (b.promo !== null) {
    if (c.promo === null) f.push(`never notched (base ${b.promo})`);
    else if (c.promo > Math.max(lim, b.promo + 0.3)) f.push(`late ${c.promo} vs ${b.promo}`);
  }
  const keys = r.set === "noise" ? ["pfv"] : r.set === "gated" ? ["pfv"] : ["pfvLead", "pfvTail"];
  for (const k of keys) if (c[k] != null && b[k] != null && c[k] > b[k] + 2) f.push(`${k} ${c[k]} vs ${b[k]}`);
  return f;
}
for (const set of ["noise", "gated", "vin", "held"]) {
  const rs = rows.filter((r) => r.set === set);
  if (!rs.length) continue;
  const groups = {};
  for (const r of rs) (groups[GROUP[set](r)] ??= []).push(r);
  groups["ALL"] = rs;
  console.log(`\n== ${set} (${rs.length} streams): ${COLS[set].map((c) => c[1]).join(" / ")}  (promo: mean over notched [never])`);
  console.log("group".padEnd(34) + "n".padStart(5) + vars.map((v) => v.padStart(44)).join(""));
  for (const [g, gr] of Object.entries(groups)) {
    console.log(g.padEnd(34) + String(gr.length).padStart(5) + vars.map((v) => COLS[set].map(([k]) => {
      const xs = gr.map((r) => r.v[v][k]);
      if (k.startsWith("promo")) return `${f1(mean(xs))}[${xs.filter((x) => x === null).length}]`;
      return f1(mean(xs));
    }).join("/").padStart(44)).join(""));
  }
  for (const v of vars) {
    if (v === base || set === "held") continue;
    const bad = rs.map((r) => [r, check(r, v)]).filter(([, f]) => f.length);
    const better = rs.filter((r) => { const b = r.v[base], c = r.v[v]; return (b.promo === null && c.promo !== null) || (b.promo !== null && c.promo !== null && c.promo < b.promo - 1); }).length;
    console.log(`  ${v}: ${bad.length}/${rs.length} streams fail the rule vs ${base}; ${better} notched earlier / where ${base} never did`);
    if (args.fails) for (const [r, f] of bad.slice(0, +args.fails)) console.log(`     ${r.id} ${r.sr}: ${f.join("; ")}`);
  }
}
