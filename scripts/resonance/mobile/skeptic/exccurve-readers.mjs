import path from "node:path"; import fs from "node:fs"; import { pathToFileURL } from "node:url";
import { fileURLToPath as toPath } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../../..");
const { postSeries } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/summarize.mjs")).href);
const { excPeak, loadDedup } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/level-summarize.mjs")).href);
const base = path.join(repo, "build/resonance-mobile/level");
const dirs = fs.readdirSync(base).filter((d) => /^g/.test(d));
const rows = [];
for (const d of dirs) for (const r of loadDedup(path.join(base, d)).filter((x) => x.kind === "exc" && [3, 5].includes(x.excD))) {
  const [t0, t1] = r.joins; const nAdm = r.bins.filter((b) => b[3] && b[2] != null && b[5] > t0 && b[5] <= t1).length;
  const e = excPeak(postSeries(r), r.joins, r.excD, r.seq[1]); if (e.peak == null) continue;
  rows.push({ cond: d, gate: r.gate, reader: r.reader, D: r.excD, dir: r.seq[1], nAdm, peak: e.peak });
}
console.log("conds", dirs.length, "records", rows.length);
for (const [lo, hi] of [[0, 3], [4, 7], [8, 13], [14, 17], [18, 19], [20, 60]]) {
  const xs = rows.filter((x) => x.nAdm >= lo && x.nAdm <= hi);
  const by = {}; for (const x of xs) { const k = `${x.reader}/${x.D}s`; by[k] = (by[k] ?? 0) + 1; }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`${lo}-${hi}: n ${xs.length}, distinct reader-windows ${Object.keys(by).length}, moved>=0.5 ${(100 * xs.filter((x) => x.peak >= 0.5).length / xs.length).toFixed(0)}% | ${top}`);
}
