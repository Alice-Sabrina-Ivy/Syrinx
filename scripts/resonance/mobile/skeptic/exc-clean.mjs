import path from "node:path";
import { fileURLToPath as toPath } from "node:url";
import { pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../../..");
const { postSeries } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/summarize.mjs")).href);
const { excPeak, loadDedup } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/level-summarize.mjs")).href);
const dir = process.argv[2], gate = process.argv[3] ?? "on";
const recs = loadDedup(path.resolve(repo, dir)).filter((r) => r.gate === gate);
const byId = new Map(recs.map(r=>[r.id,r]));
const rows = [];
for (const r of recs.filter((x) => x.kind === "exc")) {
  const [t0, t1] = r.joins;
  const nAdm = r.bins.filter((b) => b[3] && b[2] != null && b[5] > t0 && b[5] <= t1).length;
  const nAll = r.bins.filter((b) => b[5] > t0 && b[5] <= t1).length;
  const e = excPeak(postSeries(r), r.joins, r.excD, r.seq[1]);
  const nc = byId.get(`${r.reader}__N`);
  const fl = nc ? excPeak(postSeries(nc), r.joins, r.excD, r.seq[1]) : null;
  rows.push({ reader: r.reader, sex: r.sex, dir: r.seq[1], D: r.excD, nAdm, nAll, peak: e.peak, tPeak: e.tPeak, u0: e.u0, floor: fl?.peak });
}
rows.sort((a,b)=> a.sex.localeCompare(b.sex) || a.D-b.D || a.reader.localeCompare(b.reader) || a.dir.localeCompare(b.dir));
for (const x of rows) console.log([x.sex, x.D, x.reader, x.dir, x.nAdm, x.nAll, x.peak?.toFixed(2), x.tPeak?.toFixed(1), x.u0?.toFixed(2), x.floor?.toFixed(2)].join("\t"));
