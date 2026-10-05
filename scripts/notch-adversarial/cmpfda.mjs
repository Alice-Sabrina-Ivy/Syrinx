// cmpfda.mjs DIR... — count cells where variant A and B differ (fda.mjs rows)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const [A, B, ...dirs] = process.argv.slice(2);
let n = 0, diff = 0;
for (const d of dirs) for (const f of readdirSync(d).filter((f) => f.endsWith(".json"))) for (const r of JSON.parse(readFileSync(path.join(d, f)))) {
  n++; if (JSON.stringify(r.v[A]) !== JSON.stringify(r.v[B])) { diff++; console.log("DIFF", r.part, r.nz, r.snr ?? r.lead, JSON.stringify(r.v[A]), JSON.stringify(r.v[B])); }
}
console.log(`${A} vs ${B}: ${diff} of ${n} cells differ`);
