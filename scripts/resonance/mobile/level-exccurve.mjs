// level-exccurve.mjs — why short excursions are all-or-nothing: for every
// short-excursion record (level-run.mjs exc streams, any condition / gate),
// the number of ADMITTED vtln bins stamped while the changed voice was on
// (chunk time in (18, 18 + D] s) against the peak displacement the row drew
// (level-summarize.mjs excPeak). Pooled; per bin count: share that moved
// >= 0.5 u and the median peak.
//   node scripts/resonance/mobile/level-exccurve.mjs --runs=<dir>[,<dir>...] [--D=3,5]
import path from "node:path";
import { fileURLToPath as toPath } from "node:url";
import { pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const { postSeries } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/summarize.mjs")).href);
const { excPeak, loadDedup } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/level-summarize.mjs")).href);
const Ds = arg("D", "3,5").split(",").map(Number);
const q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const rows = [];
for (const d of arg("runs", "").split(",").filter(Boolean)) {
  for (const r of loadDedup(path.resolve(repo, d)).filter((x) => x.kind === "exc" && Ds.includes(x.excD))) {
    const [t0, t1] = r.joins;
    const nAdm = r.bins.filter((b) => b[3] && b[2] != null && b[5] > t0 && b[5] <= t1).length;
    const e = excPeak(postSeries(r), r.joins, r.excD, r.seq[1]);
    if (e.peak == null) continue;
    rows.push({ cond: r.cond, gate: r.gate, sex: r.sex, D: r.excD, nAdm, peak: e.peak });
  }
}
console.log(`records: ${rows.length}`);
console.log("| admitted bins while the changed voice was on | excursions | moved ≥ 0.5 u | median peak u | of which 3 s / 5 s |");
console.log("|---|---|---|---|---|");
const edges = [0, 4, 8, 10, 12, 14, 16, 18, 20, 25, 30, 40, 60];
for (let i = 0; i < edges.length - 1; i++) {
  const xs = rows.filter((x) => x.nAdm >= edges[i] && x.nAdm < edges[i + 1]);
  if (!xs.length) continue;
  console.log(`| ${edges[i]}–${edges[i + 1] - 1} | ${xs.length} | ${(100 * xs.filter((x) => x.peak >= 0.5).length / xs.length).toFixed(0)} % | ${q(xs.map((x) => x.peak), 0.5).toFixed(2)} | ${xs.filter((x) => x.D === 3).length} / ${xs.filter((x) => x.D === 5).length} |`);
}
