// cmp-vars.mjs — per-cell identity of variants across any suite's shards
// (2026-10-05 follow-up): how many cells have EVERY metric identical between
// two variants, and the differing cells.
//   node scripts/notch-adversarial/cmp-vars.mjs DIR|FILE [...] [--pairs=SRC:B,V14:B,SRC:V14] [--list=N]
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const pairs = (args.pairs || "SRC:B,V14:B,SRC:V14").split(",").map((p) => p.split(":"));
for (const d of pos) {
  const files = statSync(d).isDirectory() ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => path.join(d, f)) : [d];
  const rows = files.flatMap((f) => { const j = JSON.parse(readFileSync(f)); return Array.isArray(j) ? j : j.rows ?? []; }).filter((r) => r && r.v);
  const label = (r) => Object.entries(r).filter(([k]) => k !== "v").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ").slice(0, 160);
  const out = [];
  for (const [a, b] of pairs) {
    const rs = rows.filter((r) => r.v[a] && r.v[b]);
    const diff = rs.filter((r) => JSON.stringify(r.v[a]) !== JSON.stringify(r.v[b]));
    out.push(`${a} vs ${b}: ${rs.length - diff.length}/${rs.length} identical`);
    if (args.list) for (const r of diff.slice(0, +args.list)) console.log(`   [${a}!=${b}] ${label(r)}  ${a}=${JSON.stringify(r.v[a])}  ${b}=${JSON.stringify(r.v[b])}`);
  }
  console.log(`${d}: ${out.join("; ")}`);
}
