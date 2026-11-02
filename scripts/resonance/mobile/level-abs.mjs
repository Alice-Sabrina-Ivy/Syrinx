// level-abs.mjs — the level area's per-reader view against ABSOLUTE level:
// every (reader, condition) point of the gain series, binned by the reader's
// voiced 25 ms RMS median (dBFS, at the clean run's voiced hops, N control).
//
//   node scripts/resonance/mobile/level-abs.mjs --runs=<cond dir>[,...] [--bin=5] [--json=<out>]
//
// Per point (reader x condition x gate): adm/s and its ratio to the reader's
// clean adm/s, firstDrawn (N control), T50 (median of the reader's 4 switch
// events, censored = 18 s), drawn %, hid % (voiced hops the gate hides),
// voiced % (pitch), the short-excursion ratio (median of the reader's 6
// excursions vs clean), the steady sensitivity ratio and the N-control bias.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const { loadRuns, summarize, streamMetrics } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/summarize.mjs")).href);
const { excursions, loadDedup } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/level-summarize.mjs")).href);
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);

const dirs = arg("runs", "").split(",").filter(Boolean); // "a+b" merges two dirs into one condition
const baseDirs = ["build/resonance-mobile/runs/clean", "build/resonance-mobile/level/g0"].map((d) => path.resolve(repo, d));
const baseAll = baseDirs.filter(existsSync).flatMap(loadDedup);
const pts = [];
for (const d of dirs) {
  const all = d.split("+").flatMap((x) => loadDedup(path.resolve(repo, x)));
  for (const g of ["on", "off"]) {
    const recs = all.filter((r) => r.gate === g);
    if (!recs.length) continue;
    const std = recs.filter((r) => r.kind !== "exc"), base = baseAll.filter((r) => r.gate === g);
    const ids = new Set(std.map((r) => r.id));
    const s = summarize(std, base.filter((r) => ids.has(r.id) && r.kind !== "exc"));
    const ex = excursions(recs.filter((r) => r.kind === "exc" || r.kind === "ctl"), base.filter((r) => r.kind === "exc" || r.kind === "ctl"));
    const bm = new Map(base.filter((r) => r.kind === "ctl" && r.variant === "N").map((r) => [r.reader, streamMetrics(r)]));
    for (const pr of s.perReader) {
      const nrec = recs.find((r) => r.id === `${pr.reader}__N`);
      const rs = recs.filter((r) => r.reader === pr.reader && r.kind !== "exc");
      const sumP = (f) => rs.reduce((a, r) => a + f(r.pitchStats), 0);
      const M = rs.map(streamMetrics);
      const ev = s.events.filter((e) => e.reader === pr.reader);
      const bN = bm.get(pr.reader);
      pts.push({
        cond: recs.find((r) => r.kind !== "exc")?.cond ?? recs[0].cond, pert: recs.find((r) => r.kind !== "exc")?.pert ?? [], gate: g, reader: pr.reader, sex: pr.sex,
        lvl: nrec?.levelQ?.ref?.q50 ?? null, lvlOwn: nrec?.levelQ?.own?.q50 ?? null,
        adm: pr.admPerS, admRatio: pr.admPerS != null && bN ? pr.admPerS / bN.admPerS : null,
        firstDrawn: pr.firstDrawn, t50: med(ev.map((e) => e.t50)), cens: ev.filter((e) => e.c50).length,
        drawn: M.reduce((a, x) => a + x.drawn, 0) / Math.max(1, M.reduce((a, x) => a + x.posts, 0)),
        hid: sumP((p) => p.hidden) / Math.max(1, sumP((p) => p.voiced)), voiced: sumP((p) => p.voiced) / Math.max(1, sumP((p) => p.hops)),
        excRatio: med(ex.filter((e) => e.reader === pr.reader).map((e) => e.ratio)), sensRatio: pr.sensRatio, bias: pr.bias,
      });
    }
  }
}
// readers' clean level from any gain-only condition (ref hops: exactly clean + gain)
const lvl0 = new Map();
for (const p of pts) { const pr = p.pert; if (p.lvl != null && pr && pr.length === 1 && pr[0].type === 'gain') lvl0.set(p.reader, p.lvl - pr[0].db); else if (p.lvl != null && pr && pr.length === 0) lvl0.set(p.reader, p.lvl); }
for (const p of pts) if (p.lvl == null && (!p.pert || p.pert.length === 0) && lvl0.has(p.reader)) p.lvl = lvl0.get(p.reader);
const bw = Number(arg("bin", "5"));
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pc = (x) => (x == null ? "—" : (100 * x).toFixed(0));
console.log(`\n### Per reader x condition, binned by the reader's voiced 25 ms RMS median (dBFS; ${bw} dB bins), medians\n`);
console.log("| gate | voiced RMS bin | points (m/f) | adm/s ratio | firstDrawn s | T50 s (cens) | drawn % | hid % | voiced % | exc ratio | sens ratio | bias u |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const g of ["on", "off"]) {
  const P = pts.filter((p) => p.gate === g && p.lvl != null);
  const bins = [...new Set(P.map((p) => Math.floor(p.lvl / bw) * bw))].sort((a, b) => b - a);
  for (const b of bins) {
    const xs = P.filter((p) => Math.floor(p.lvl / bw) * bw === b);
    console.log(`| ${g} | ${b} … ${b + bw} | ${xs.length} (${xs.filter((p) => p.sex === "m").length}/${xs.filter((p) => p.sex === "f").length}) | ${f(med(xs.map((p) => p.admRatio)))} | ${f(med(xs.map((p) => p.firstDrawn)), 1)} | ${f(med(xs.map((p) => p.t50)), 1)} (${xs.reduce((a, p) => a + p.cens, 0)}) | ${pc(med(xs.map((p) => p.drawn)))} | ${pc(med(xs.map((p) => p.hid)))} | ${pc(med(xs.map((p) => p.voiced)))} | ${f(med(xs.map((p) => p.excRatio)))} | ${f(med(xs.map((p) => p.sensRatio)))} | ${f(med(xs.map((p) => p.bias)))} |`);
  }
}
if (process.argv.includes("--points")) {
  console.log("\ncond\tgate\treader\tsex\tlvl\tadmRatio\tfirstDrawn\tt50\tcens\tdrawn\thid\tvoiced\texcRatio\tsensRatio\tbias");
  for (const p of pts) console.log([p.cond, p.gate, p.reader, p.sex, f(p.lvl, 1), f(p.admRatio), f(p.firstDrawn, 1), f(p.t50, 1), p.cens, pc(p.drawn), pc(p.hid), pc(p.voiced), f(p.excRatio), f(p.sensRatio), f(p.bias)].join("\t"));
}
if (arg("json", "")) writeFileSync(path.resolve(repo, arg("json", "")), JSON.stringify(pts, null, 1));
