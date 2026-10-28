// Skeptic check: is the shown readout linear in the bin values? Replays the
// shipped createRestartReadout (E-ewm2.5 + restart) over the LOGGED bins of a
// run, with every bin value compressed toward the reader's pre-change median:
// v' = m + k (v - m). A linear readout gives peak(k) = k peak(1).
import path from "node:path"; import { pathToFileURL } from "node:url";
import { fileURLToPath as toPath } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../../..");
const { createRestartReadout, RESTART } = await import(pathToFileURL(path.join(repo, "src/resonance/resonanceCue.js")).href);
const { postSeries } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/summarize.mjs")).href);
const { loadDedup } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/level-summarize.mjs")).href);
const REF = (await import(pathToFileURL(path.join(repo, "public/resonance-lab/reference.json")).href, { with: { type: "json" } })).default.vtln;
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const dir = arg("runs", "build/resonance-mobile/level/g0"), gate = arg("gate", "on");
const ks = arg("k", "1,0.85,0.7,0.6,0.5").split(",").map(Number);
const restartArg = arg("restart", "on");
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
function replay(rec, k, m, restart = RESTART) {
  const ro = createRestartReadout({ ref: REF, restart });
  let last = null, dropped = 0, bi = 0; const out = new Map();
  const B = rec.bins; const P = rec.posts;
  for (const p of P) {
    while (bi < B.length && B[bi][4] <= p[0]) {
      const [te, st, v, adm] = B[bi]; const delta = last === null ? 0 : Math.max(0, st - last); last = st;
      if (!adm) dropped += delta; else ro.add(st - dropped, v == null ? null : m + k * (v - m));
      bi++;
    }
    out.set(p[0], ro.snapshot().u);
  }
  return out;
}
const recs = loadDedup(path.resolve(repo, dir)).filter((r) => r.gate === gate);
// validation k=1 vs logged posts
let mis = 0, tot = 0;
for (const r of recs.slice(0, 40)) { const o = replay(r, 1, 0); for (const p of r.posts) { tot++; const a = o.get(p[0]), b = p[2]; if (!(a === b || (a == null && b == null) || Math.abs(a - b) < 1e-12)) mis++; } }
console.log(`validation (k=1, shipped restart): ${tot - mis}/${tot} posts equal`);
const rows = [];
for (const r of recs.filter((x) => x.kind === "exc" || x.kind === "sw")) {
  const t0 = r.joins[0], D = r.kind === "exc" ? r.excD : 18;
  const dir = r.seq[1], sg = dir.startsWith("U") ? 1 : -1;
  const m = med(r.bins.filter((b) => b[3] && b[2] != null && b[5] < t0).map((b) => b[2]));
  const S = postSeries(r);
  const res = {};
  for (const k of ks) {
    const o = replay(r, k, m, restartArg === "on" ? RESTART : null);
    let u0 = null; for (const x of S) { if (x.t > t0 + 1e-9) break; const u = o.get(x.k); if (x.drawn && u != null) u0 = u; }
    let peak = 0, t50 = null;
    const tEnd = t0 + D + (r.kind === "exc" ? 3 : 0);
    // final level for sw: median of drawn u over last 4 s of the segment
    for (const x of S) { if (x.t <= t0 + 1e-9 || x.t > tEnd + 1e-9) continue; const u = o.get(x.k); if (!x.drawn || u == null) continue; const d = sg * (u - u0); if (d > peak) peak = d; }
    res[k] = { peak, u0 };
    if (r.kind === "sw") {
      const fin = med(S.filter((x) => x.t > t0 + D - 4 && x.t <= t0 + D && x.drawn).map((x) => o.get(x.k)));
      const step = sg * (fin - u0);
      for (const x of S) { if (x.t <= t0 + 1e-9 || x.t > t0 + D) continue; const u = o.get(x.k); if (!x.drawn || u == null) continue; if (t50 === null && sg * (u - u0) >= 0.5 * step) { t50 = x.t - t0; break; } }
      res[k].t50 = t50; res[k].step = step;
    }
  }
  rows.push({ id: r.id, reader: r.reader, sex: r.sex, kind: r.kind, D, dir, res });
}
for (const sex of ["m", "f"]) for (const D of [3, 5, 8, 18]) {
  const xs = rows.filter((x) => x.sex === sex && x.D === D);
  if (!xs.length) continue;
  const line = ks.map((k) => {
    const rat = med(xs.filter((x) => x.res[1].peak >= 0.25).map((x) => x.res[k].peak / x.res[1].peak));
    const sumR = xs.reduce((a, x) => a + x.res[k].peak, 0) / xs.reduce((a, x) => a + x.res[1].peak, 0);
    const vis = xs.filter((x) => x.res[k].peak >= 0.5 * k).length;
    let extra = "";
    if (D === 18) extra = ` T50 ${med(xs.map((x) => x.res[k].t50 ?? 18)).toFixed(2)}s step ${med(xs.map((x) => x.res[k].step)).toFixed(2)}`;
    return `k${k}: medRatio ${rat?.toFixed(2)} sumRatio ${sumR.toFixed(2)} (/k ${(sumR / k).toFixed(2)}) moved>=0.5k ${vis}/${xs.length}${extra}`;
  }).join(" | ");
  console.log(`${sex} D=${D} n=${xs.length}: ${line}`);
}
