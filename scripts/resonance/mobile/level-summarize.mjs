// level-summarize.mjs — the level / noise / voice-gate area's tables
// (mobile resonance diagnosis, 2026-10-28).
//
//   node scripts/resonance/mobile/level-summarize.mjs --runs=<cond dir>[,...]
//        [--base=build/resonance-mobile/runs/clean,build/resonance-mobile/level/g0]
//        [--json=<out.json>] [--md=<out.md>]
//
// Per condition x gate x sex:
//   * summarize.mjs's metrics on the ctl / sw / long streams (exc streams left
//     out, so the numbers are comparable with the clean table), against the base
//     run of the same gate and stream ids;
//   * the SHORT-EXCURSION metric on the exc streams (level-run.mjs: N 0-18 s,
//     U10 / D10 for D = 3 / 5 / 8 s, N after): u0 = the last DRAWN post at
//     t <= 18 s; peak = max over drawn posts with 18 < t <= 18 + D + 3 of the
//     displacement in the change's direction (u - u0 for U10, u0 - u for D10);
//     no drawn post in the window = 0 (counted, "nd"). ratio = peak / the clean
//     run's peak for the same reader, excursion and gate; median over readers
//     (and over the two directions: 12 per sex per D); also the absolute peak,
//     and reach = peak / this condition's steady step (medU(V) - medU(N), same
//     reader), which separates "slower" (reach falls) from "smaller steady
//     sensitivity" (reach kept, ratio falls with the steady ratio).
//   * floor = the same peak measured on the N control (no change) over the
//     same window: what an unchanged voice's meter wanders in that time.
//   * the voiced 25 ms RMS (dBFS, the diag's inputRms scale) at the clean run's
//     voiced hops (levelQ.ref) and at this condition's own voiced hops
//     (levelQ.own): median over readers of the N control's q10 / q50 / q90.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SM = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/summarize.mjs")).href);
const { loadRuns, postSeries, summarize } = SM;
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
/** loadRuns with duplicate (id, gate) records dropped (first kept). */
export function loadDedup(dir) { const seen = new Set(); return loadRuns(dir).filter((r) => { const k = `${r.id}|${r.gate}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

export function excPeak(S, joins, D, dir, tail = 3) {
  const t0 = joins[0], t1 = t0 + D + tail, sg = dir === "U10" ? 1 : -1;
  let u0 = null;
  for (const x of S) { if (x.t > t0 + 1e-9) break; if (x.drawn && x.u != null) u0 = x.u; }
  if (u0 == null) return { u0: null, peak: null, tPeak: null, nd: true };
  let peak = null, tPeak = null, any = false;
  for (const x of S) {
    if (x.t <= t0 + 1e-9 || x.t > t1 + 1e-9) continue;
    if (!x.drawn || x.u == null) continue;
    any = true;
    const d = sg * (x.u - u0);
    if (peak == null || d > peak) { peak = d; tPeak = x.t - t0; }
  }
  return { u0, peak: any ? peak : 0, tPeak, nd: !any };
}
const P_U = 2, P_FILL = 7;
function medUctl(rec) { const v = rec.posts.filter((p) => p[P_U] != null && p[P_FILL] >= 1).map((p) => p[P_U]); return med(v); }

export function excursions(recs, baseRecs) {
  const byId = new Map(recs.map((r) => [r.id, r])), bById = new Map((baseRecs ?? []).map((r) => [r.id, r]));
  const out = [];
  for (const r of recs.filter((x) => x.kind === "exc")) {
    const dir = r.seq[1], D = r.excD;
    const S = postSeries(r);
    const e = excPeak(S, r.joins, D, dir);
    const b = bById.get(r.id);
    const be = b ? excPeak(postSeries(b), b.joins, D, dir) : null;
    // the N control of the same condition over the same window (no change)
    const nc = byId.get(`${r.reader}__N`);
    const fl = nc ? excPeak(postSeries(nc), r.joins, D, dir) : null;
    const nV = byId.get(`${r.reader}__${dir}`), nN = nc;
    const step = nV && nN ? (dir === "U10" ? 1 : -1) * (medUctl(nV) - medUctl(nN)) : null;
    const bV = bById.get(`${r.reader}__${dir}`), bN = bById.get(`${r.reader}__N`);
    const bstep = bV && bN ? (dir === "U10" ? 1 : -1) * (medUctl(bV) - medUctl(bN)) : null;
    out.push({ id: r.id, reader: r.reader, sex: r.sex, dir, D, ...e, base: be, floor: fl?.peak ?? null,
      ratio: e.peak != null && be?.peak ? e.peak / be.peak : null, step, reach: e.peak != null && step ? e.peak / step : null,
      bstep, breach: be?.peak != null && bstep ? be.peak / bstep : null });
  }
  return out;
}
export function excTable(ex) {
  const rows = {};
  for (const sex of ["m", "f"]) for (const D of [3, 5, 8]) {
    const xs = ex.filter((e) => e.sex === sex && e.D === D);
    rows[`${sex}|${D}`] = {
      n: xs.length, nd: xs.filter((e) => e.nd).length,
      peak: med(xs.map((e) => e.peak)), basePeak: med(xs.map((e) => e.base?.peak)), ratio: med(xs.map((e) => e.ratio)),
      ratioUp: med(xs.filter((e) => e.dir === "U10").map((e) => e.ratio)), ratioDown: med(xs.filter((e) => e.dir === "D10").map((e) => e.ratio)),
      reach: med(xs.map((e) => e.reach)), baseReach: med(xs.map((e) => e.breach)), floor: med(xs.map((e) => e.floor)),
      tPeak: med(xs.map((e) => e.tPeak)),
      vis: xs.length ? xs.filter((e) => (e.peak ?? 0) >= 0.5).length / xs.length : null,
      baseVis: xs.length ? xs.filter((e) => (e.base?.peak ?? 0) >= 0.5).length / xs.length : null,
    };
  }
  return rows;
}
function levelRows(recs) {
  const R = {};
  for (const sex of ["m", "f"]) {
    const N = recs.filter((r) => r.kind === "ctl" && r.variant === "N" && r.sex === sex && r.levelQ);
    R[sex] = {
      ref: { q10: med(N.map((r) => r.levelQ.ref?.q10)), q50: med(N.map((r) => r.levelQ.ref?.q50)), q90: med(N.map((r) => r.levelQ.ref?.q90)) },
      own: { q10: med(N.map((r) => r.levelQ.own?.q10)), q50: med(N.map((r) => r.levelQ.own?.q50)), q90: med(N.map((r) => r.levelQ.own?.q90)) },
      refRange: [Math.min(...N.map((r) => r.levelQ.ref?.q50 ?? Infinity)), Math.max(...N.map((r) => r.levelQ.ref?.q50 ?? -Infinity))],
    };
  }
  return R;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const dirs = arg("runs", "").split(",").filter(Boolean); // "a+b" merges dirs into one condition
  const baseDirs = arg("base", "build/resonance-mobile/runs/clean,build/resonance-mobile/level/g0").split(",").map((d) => path.resolve(repo, d));
  const baseAll = baseDirs.filter(existsSync).flatMap(loadDedup);
  const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
  const pc = (x) => (x == null ? "—" : (100 * x).toFixed(1));
  const tc = (e) => (e.n ? `${f(e.med, 1)}${e.cens ? `(${e.cens}c)` : ""}` : "—");
  const out = {};
  const main = [], exr = [], lvl = [];
  for (const d of dirs) {
    const all = d.split("+").flatMap((x) => loadDedup(path.resolve(repo, x)));
    if (!all.length) continue;
    for (const g of ["on", "off"]) {
      const recs = all.filter((r) => r.gate === g);
      if (!recs.length) continue;
      const cond = (recs.find((r) => r.kind !== "exc") ?? recs[0]).cond;
      // pooled shares need the same stream set in every condition: ctl + sw only (--std-kinds); the long
      // stream (150 s, only some conditions) is summarised separately (sL)
      const stdKinds = arg("std-kinds", "ctl,sw").split(",");
      const std = recs.filter((r) => stdKinds.includes(r.kind));
      const withL = recs.filter((r) => r.kind === "long" || r.kind === "ctl");
      const ids = new Set(recs.map((r) => r.id));
      const base = baseAll.filter((r) => r.gate === g && ids.has(r.id));
      const bstd = base.filter((r) => r.kind !== "exc");
      // the exc metric needs the N / U10 / D10 controls of both this condition and the base
      const ctlBase = baseAll.filter((r) => r.gate === g && r.kind === "ctl");
      const s = std.length ? summarize(std, bstd.length ? bstd.filter((r) => stdKinds.includes(r.kind)) : null) : null;
      const sL = recs.some((r) => r.kind === "long") ? summarize(withL, base.filter((r) => r.kind === "long" || r.kind === "ctl")) : null;
      const readersHere = new Set(recs.map((r) => r.reader));
      const condCtl = recs.some((r) => r.kind === "ctl") ? recs.filter((r) => r.kind === "ctl") : ctlBase.filter((r) => readersHere.has(r.reader)); // g0: exc only, controls = clean
      const ex = excursions(recs.filter((r) => r.kind === "exc").concat(condCtl), base.filter((r) => r.kind === "exc").concat(ctlBase));
      const et = excTable(ex);
      const lv = levelRows(recs.some((r) => r.kind === "ctl") ? recs : []);
      out[`${cond}|${g}`] = { cond, gate: g, pert: recs[0].pert, per: s?.per ?? null, perReader: s?.perReader ?? null, events: s?.events ?? null, exc: ex, excTable: et, level: lv };
      for (const sex of ["m", "f"]) {
        if (s && s.per[sex].streams) main.push({ cond, g, sex, ...s.per[sex], medUL: sL?.per[sex].medUL ?? null, biasL: sL?.per[sex].biasL ?? null, sdL: sL?.per[sex].sdL ?? null });
        for (const D of [3, 5, 8]) exr.push({ cond, g, sex, D, ...et[`${sex}|${D}`] });
        if (recs.some((r) => r.kind === "ctl")) lvl.push({ cond, g, sex, ...lv[sex], levelOut: s?.per[sex].levelOut });
      }
    }
  }
  const lines = [];
  const P = (s) => { lines.push(s); console.log(s); };
  P("\n### Standard metrics (ctl / sw / long), vs clean of the same gate\n");
  P("| cond | gate | sex | medU N | bias | sens | sens/clean | T50 ↑/↓ | T90 ↑/↓ | tAbs0.5 | firstPos | firstDrawn | adm/s | voiced% | hid% | warm% | sust% | drawn% | nbF | nbOn | long medU / bias / SD |");
  P("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of main) P(`| ${r.cond} | ${r.g} | ${r.sex} | ${f(r.medUN)} | ${f(r.bias)} | ${f(r.sens)} | ${f(r.sensRatio)} | ${tc(r.t50up)}/${tc(r.t50down)} | ${tc(r.t90up)}/${tc(r.t90down)} | ${tc(r.tAbs)} | ${f(r.firstPos, 1)} | ${f(r.firstDrawn, 1)} | ${f(r.admPerS)} | ${pc(r.voicedShare)} | ${pc(r.hiddenShare)} | ${pc(r.verdict.warming)} | ${pc(r.verdict.sustained)} | ${pc(r.drawnShare)} | ${f(r.nbFinalF, 1)} | ${r.nbOnStreams} | ${f(r.medUL)} / ${f(r.biasL)} / ${f(r.sdL, 3)} |`);
  P("\n### Short excursions (N → U10/D10 for D s → N, start 18 s), peak displacement of the drawn u within D + 3 s\n");
  P("| cond | gate | sex | D s | n (nd) | peak u | clean peak u | ratio | ratio ↑ / ↓ | moved ≥ 0.5 u (clean) | reach (peak/steady step) | clean reach | floor (N ctl) | t peak s |");
  P("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of exr) if (r.n) P(`| ${r.cond} | ${r.g} | ${r.sex} | ${r.D} | ${r.n}${r.nd ? ` (${r.nd})` : ""} | ${f(r.peak)} | ${f(r.basePeak)} | ${f(r.ratio)} | ${f(r.ratioUp)} / ${f(r.ratioDown)} | ${pc(r.vis)} % (${pc(r.baseVis)}) | ${f(r.reach)} | ${f(r.baseReach)} | ${f(r.floor)} | ${f(r.tPeak, 1)} |`);
  P("\n### Levels (N control, median over readers): voiced 25 ms RMS dBFS q10 / q50 / q90 at the clean run's voiced hops (ref) and at this run's own voiced hops (own); active level 0-8 kHz\n");
  P("| cond | sex | ref q10 / q50 / q90 | ref q50 range over readers | own q10 / q50 / q90 | active |");
  P("|---|---|---|---|---|---|");
  for (const r of lvl) if (r.g === "on") P(`| ${r.cond} | ${r.sex} | ${f(r.ref.q10, 1)} / ${f(r.ref.q50, 1)} / ${f(r.ref.q90, 1)} | ${f(r.refRange[0], 1)} … ${f(r.refRange[1], 1)} | ${f(r.own.q10, 1)} / ${f(r.own.q50, 1)} / ${f(r.own.q90, 1)} | ${f(r.levelOut, 1)} |`);
  P("\n### Compact: one row per condition x gate x sex\n");
  P("| cond | gate | sex | voiced RMS q50 | voiced % | hid % | adm/s | warm % | firstDrawn s | T50 ↑/↓ s | drawn % | bias u | sens ratio | 3 s exc peak u (moved ≥ 0.5) | 5 s exc peak u (moved ≥ 0.5) | 8 s exc peak u | nbF dB |");
  P("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of main) {
    const L = lvl.find((x) => x.cond === r.cond && x.g === r.g && x.sex === r.sex);
    const e = (D) => exr.find((x) => x.cond === r.cond && x.g === r.g && x.sex === r.sex && x.D === D);
    const ec = (D) => { const x = e(D); return x?.n ? `${f(x.peak)} (${pc(x.vis)} %)` : "—"; };
    P(`| ${r.cond} | ${r.g} | ${r.sex} | ${f(L?.ref?.q50, 1)} | ${pc(r.voicedShare)} | ${pc(r.hiddenShare)} | ${f(r.admPerS)} | ${pc(r.verdict.warming)} | ${f(r.firstDrawn, 1)} | ${tc(r.t50up)}/${tc(r.t50down)} | ${pc(r.drawnShare)} | ${f(r.bias)} | ${f(r.sensRatio)} | ${ec(3)} | ${ec(5)} | ${e(8)?.n ? f(e(8).peak) : "—"} | ${f(r.nbFinalF, 1)} |`);
  }
  if (arg("json", "")) writeFileSync(path.resolve(repo, arg("json", "")), JSON.stringify(out, null, 1));
  if (arg("md", "")) writeFileSync(path.resolve(repo, arg("md", "")), lines.join("\n") + "\n");
}
