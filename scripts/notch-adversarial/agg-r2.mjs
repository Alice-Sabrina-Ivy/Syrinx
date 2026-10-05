// agg-r2.mjs — tables + strict-rule check for r2int.mjs shards (round 2,
// 2026-10-04).
//   node scripts/notch-adversarial/agg-r2.mjs DIR|FILE [...] [--vars=B,R1,R2] [--base=B] [--fails[=N]]
// Rule vs the base (bc42ad0) in EVERY cell:
//   start-type (hum present from t = 0: masked): notch whenever base notched,
//     no later than max(6 s, base + 0.3 s); pause FV (worker and painted) over
//     the part's whole scoring window <= base + 2 pp
//   switch-type (hum switching on mid-session: step, beatpause, shared,
//     intermit): notch whenever base notched, no later than max(21 s,
//     base + 0.3 s) after switch-on; pause FV (worker and painted) from
//     switch-on + 21 s <= base + 2 pp (the accepted latency window excluded)
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
const KEYS = { step: ["sp", "shape", "lvl"], masked: ["noteF", "end", "pause", "cls", "lvl"], beatpause: ["cls", "lvl", "seed"], shared: ["vf", "hum", "hold", "br"], intermit: ["per", "off", "lvl"] };
const key = (r) => KEYS[r.part].map((k) => `${k}=${r[k]}`).join(" ") + ` ${r.sr}`;
function check(r, v) {
  const b = r.v[base], c = r.v[v], fails = [];
  const lim = r.kind === "start" ? 6 : 21;
  if (b.promo !== null) {
    if (c.promo === null) fails.push(`never notched (base ${b.promo})`);
    else if (c.promo > Math.max(lim, b.promo + 0.3)) fails.push(`late ${c.promo} vs ${b.promo}`);
  }
  const [fk, pk] = r.kind === "start" ? ["fvAll", "pfvAll"] : ["fv", "pfv"];
  if (c[fk] !== null && b[fk] !== null && c[fk] > b[fk] + 2) fails.push(`FV ${c[fk]} vs ${b[fk]}`);
  if (c[pk] !== null && b[pk] !== null && c[pk] > b[pk] + 2) fails.push(`painted FV ${c[pk]} vs ${b[pk]}`);
  return fails;
}
const mean = (xs) => { const ys = xs.filter((x) => x !== null && x !== undefined); return ys.length ? (ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(1) : "-"; };
const GROUP = { step: (r) => `${r.sp} ${r.shape}`, masked: (r) => `${r.end} pause${r.pause}`, beatpause: (r) => `${r.cls} lvl${r.lvl}`, shared: (r) => `hum${r.hum}dB ${r.hold}s/${r.br}s`, intermit: (r) => `per${r.per} off${r.off}` };
for (const part of Object.keys(KEYS)) {
  const rs = rows.filter((r) => r.part === part);
  if (!rs.length) continue;
  const groups = {};
  for (const r of rs) (groups[GROUP[part](r)] ??= []).push(r);
  const extra = part === "shared" ? "/voice" : "";
  console.log(`\n== ${part} (${rs.length} cells): promo mean [never] / FV all / painted FV all / FV scored / painted FV scored${extra}`);
  console.log("group".padEnd(26) + vars.map((v) => v.padStart(34)).join(""));
  for (const [g, gr] of Object.entries(groups).sort()) {
    const cells = vars.map((v) => {
      const never = gr.filter((r) => r.v[v].promo === null).length;
      return (`${mean(gr.map((r) => r.v[v].promo))}[${never}]/${mean(gr.map((r) => r.v[v].fvAll))}/${mean(gr.map((r) => r.v[v].pfvAll))}/${mean(gr.map((r) => r.v[v].fv))}/${mean(gr.map((r) => r.v[v].pfv))}` + (extra ? `/${mean(gr.map((r) => r.v[v].voice))}` : "")).padStart(34);
    });
    console.log(g.padEnd(26) + cells.join(""));
  }
  for (const v of vars) {
    if (v === base) continue;
    const bad = rs.map((r) => [r, check(r, v)]).filter(([, f]) => f.length);
    console.log(`  ${v}: ${bad.length}/${rs.length} cells fail the rule`);
    if (args.fails) for (const [r, f] of bad.slice(0, +(args.fails) > 1 ? +args.fails : 40)) console.log(`     ${key(r)}: ${f.join("; ")}`);
  }
}
