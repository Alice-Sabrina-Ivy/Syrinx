// Excursion peak vs the same condition's N-control wander ("floor") over the same window.
import path from "node:path"; import { pathToFileURL } from "node:url";
import { fileURLToPath as toPath } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../../..");
const { postSeries } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/summarize.mjs")).href);
const { excPeak, loadDedup } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/level-summarize.mjs")).href);
const [condDirs, baseExc, baseCtl] = process.argv.slice(2);
const load = (ds) => ds.split(",").flatMap((d) => loadDedup(path.resolve(repo, d))).filter((r) => r.gate === "on");
const C = load(condDirs), BE = load(baseExc), BC = load(baseCtl);
const idx = (rs) => new Map(rs.map((r) => [r.id, r]));
const ci = idx(C), bei = idx(BE), bci = idx(BC);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const rows = [];
for (const r of C.filter((x) => x.kind === "exc")) {
  const D = r.excD, dir = r.seq[1];
  const pk = excPeak(postSeries(r), r.joins, D, dir).peak;
  const n = ci.get(`${r.reader}__N`); const fl = n ? excPeak(postSeries(n), r.joins, D, dir).peak : null;
  const b = bei.get(r.id); const bpk = b ? excPeak(postSeries(b), b.joins, D, dir).peak : null;
  const bn = bci.get(`${r.reader}__N`); const bfl = bn ? excPeak(postSeries(bn), r.joins, D, dir).peak : null;
  rows.push({ sex: r.sex, D, dir, reader: r.reader, pk, fl, bpk, bfl });
}
for (const sex of ["m", "f"]) for (const D of [3, 5, 8]) for (const dir of ["U10", "D10", "all"]) {
  const xs = rows.filter((x) => x.sex === sex && x.D === D && (dir === "all" || x.dir === dir));
  const r1 = med(xs.filter((x) => x.bpk >= 0.25).map((x) => x.pk / x.bpk));
  const r2 = med(xs.filter((x) => x.bpk - x.bfl >= 0.25).map((x) => (x.pk - x.fl) / (x.bpk - x.bfl)));
  console.log(`${sex} D${D} ${dir} n${xs.length}: peak ${med(xs.map(x=>x.pk))?.toFixed(2)} floor ${med(xs.map(x=>x.fl))?.toFixed(2)} | base peak ${med(xs.map(x=>x.bpk))?.toFixed(2)} floor ${med(xs.map(x=>x.bfl))?.toFixed(2)} | ratio ${r1?.toFixed(2)} net-ratio ${r2?.toFixed(2)}`);
}
