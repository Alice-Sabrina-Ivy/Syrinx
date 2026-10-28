// pitch-diff.mjs — posted pitch under a condition vs c0 on the same stream:
// voiced share, frames voiced in both with an octave-class disagreement
// (ratio < 0.6 = down, > 1.6 = up), frames voiced in only one, hidden share.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const root = path.join(repo, "build/resonance-mobile/audit/pitch");
const conds = (process.argv[2] ?? "g10,g20,g30,lp7k,lp6k,lp5k,hs6,hp200").split(",");
console.log("| cond | sex | streams | voiced (c0 → cond) | octave down | octave up | voiced only in c0 | only in cond | hidden of voiced |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const c of conds) {
  if (!existsSync(path.join(root, c))) continue;
  for (const sex of ["m", "f"]) {
    let n = 0, v0 = 0, v1 = 0, dn = 0, up = 0, both = 0, o0 = 0, o1 = 0, hid = 0, files = 0;
    for (const f of readdirSync(path.join(root, c))) {
      if (!existsSync(path.join(root, "c0", f))) continue;
      const a = JSON.parse(readFileSync(path.join(root, "c0", f), "utf8")), b = JSON.parse(readFileSync(path.join(root, c, f), "utf8"));
      if (b.sex !== sex) continue;
      files++;
      const A = a.byChunk.flat(), B = b.byChunk.flat();
      const m = Math.min(A.length, B.length);
      for (let i = 0; i < m; i++) {
        n++;
        const x = A[i], y = B[i];
        if (x[0]) v0++;
        if (y[0]) { v1++; if (y[3] === 0) hid++; }
        if (x[0] && y[0]) { both++; const r = y[1] / x[1]; if (r < 0.6) dn++; else if (r > 1.6) up++; }
        else if (x[0]) o0++; else if (y[0]) o1++;
      }
    }
    const p = (x, d) => (100 * x / d).toFixed(2) + " %";
    console.log(`| ${c} | ${sex} | ${files} | ${p(v0, n)} → ${p(v1, n)} | ${p(dn, both)} | ${p(up, both)} | ${p(o0, n)} | ${p(o1, n)} | ${p(hid, v1)} |`);
  }
}
