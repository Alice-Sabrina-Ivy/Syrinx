// channel-report.mjs — per condition and sex: bias vs clean (median, IQR over
// readers), steady-state sensitivity ratio, T50 / T90, the short-excursion peak
// ratio, narrowband F, pitch voicing / gate side effects (channel area of the
// mobile resonance diagnosis, 2026-10-28).
//
//   node scripts/resonance/mobile/channel-report.mjs [--root=build/resonance-mobile/channel/runs]
//        [--base=build/resonance-mobile/runs/clean] [--conds=a,b] [--json=<file>] [--md=<file>]
//
// Short-excursion metric (exc streams of channel-run.mjs): u0 = the shown u of
// the last drawn post at t <= 18 s; peak = max over drawn posts with
// 18 < t <= 18 + d + 3 s of (u - u0) for an up excursion (U10), (u0 - u) for a
// down one (D10). Ratio = peak under the condition / peak in the clean run of
// the same reader, direction and d (channel/runs/clean). Per sex: the median
// over readers (6 per direction; "pooled" = both directions, 12).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, loadRuns, postSeries } from "./summarize.mjs";
import { byName, CONDS, gainDb, bandGainDb } from "./channel-conds.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const ROOT = path.resolve(repo, arg("root", "build/resonance-mobile/channel/runs"));
const BASE = path.resolve(repo, arg("base", "build/resonance-mobile/runs/clean"));
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const RATIO_MIN_BASE = 0.25; // per-reader ratios only where the clean peak is >= 0.25 u (a 3 s excursion often barely moves the clean meter)
const loadExc = (dir) => existsSync(dir) ? readdirSync(dir).filter((f) => /^exc-.*\.jsonl$/.test(f))
  .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })) : [];

export function excMetric(rec) {
  const S = postSeries(rec), [t0, t1] = rec.joins, d = t1 - t0, sgn = rec.seq[1].startsWith("U") ? 1 : -1;
  const before = S.filter((x) => x.t <= t0 + 1e-9 && x.u != null);
  const pre = [...before].reverse().find((x) => x.drawn) ?? before[before.length - 1];
  if (!pre) return { id: rec.id, u0: null, peak: null };
  const W = S.filter((x) => x.t > t0 + 1e-9 && x.t <= t1 + 3 + 1e-9 && x.drawn && x.u != null);
  let peak = null, tPeak = null;
  for (const x of W) { const v = sgn * (x.u - pre.u); if (peak === null || v > peak) { peak = v; tPeak = x.t - t0; } }
  const atEnd = W.filter((x) => x.t <= t1 + 1e-9).pop();
  return { id: rec.id, reader: rec.reader, sex: rec.sex, dir: sgn > 0 ? "up" : "down", d, u0: pre.u, peak, tPeak, endDisp: atEnd ? sgn * (atEnd.u - pre.u) : null, nDrawn: W.length };
}

/** T50 / T90 of the excursion's onset (8 s excursions): faster-eval's method, old = this condition's N control, new = its U10 / D10 control, window 18 < t <= 18 + d (censored = d). */
function onsetTimes(excRecs, ctlRecs) {
  const C = new Map(ctlRecs.filter((r) => r.kind === "ctl").map((r) => [r.id, postSeries(r)]));
  const ev = [];
  for (const r of excRecs.filter((x) => x.joins[1] - x.joins[0] === 8)) {
    const S = postSeries(r), O = C.get(`${r.reader}__N`), N = C.get(`${r.reader}__${r.seq[1]}`);
    if (!O || !N) continue;
    const t0 = r.joins[0], d = r.joins[1] - t0, up = r.seq[1].startsWith("U");
    let t50 = null, t90 = null;
    for (let i = 0; i < S.length && i < O.length && i < N.length; i++) {
      const x = S[i];
      if (x.t <= t0 + 1e-9 || x.t > t0 + d + 1e-9) continue;
      if (O[i].k !== x.k || N[i].k !== x.k) throw new Error("post grids differ");
      if (!x.drawn || x.u == null || O[i].u == null || N[i].u == null || N[i].u === O[i].u) continue;
      const p = (x.u - O[i].u) / (N[i].u - O[i].u);
      if (t50 === null && p >= 0.5) t50 = x.t - t0;
      if (t90 === null && p >= 0.9) t90 = x.t - t0;
    }
    ev.push({ sex: r.sex, dir: up ? "up" : "down", t50: t50 ?? d, t90: t90 ?? d, c50: t50 === null, c90: t90 === null });
  }
  const out = {};
  for (const sex of ["m", "f"]) {
    out[sex] = {};
    for (const dir of ["up", "down", "all"]) {
      const xs = ev.filter((e) => e.sex === sex && (dir === "all" || e.dir === dir));
      out[sex][dir] = { n: xs.length, t50: med(xs.map((e) => e.t50)), t90: med(xs.map((e) => e.t90)), c50: xs.filter((e) => e.c50).length, c90: xs.filter((e) => e.c90).length };
    }
  }
  return out;
}

export function condReport(cond, recs, excRecs, baseRecs, baseExc) {
  const g = recs.filter((r) => r.gate === "on");
  const ids = new Set(g.map((r) => r.id));
  const base = baseRecs.filter((r) => r.gate === "on" && ids.has(r.id) && (r.hintDelay ?? 0) === 0);
  const s = summarize(g, base);
  // narrowband F by variant (controls)
  const nbBy = {};
  for (const r of g.filter((x) => x.kind === "ctl")) (nbBy[`${r.sex}|${r.variant}`] ??= []).push(r.nbFinal?.f ?? null);
  const nbOnAny = { m: 0, f: 0 }, nbOnN = { m: 0, f: 0 };
  for (const r of g) if (r.nbResets.length || r.posts.some((p) => p[11])) nbOnAny[r.sex]++;
  // excursions
  const E = excRecs.filter((r) => r.gate === "on").map(excMetric);
  const BE = new Map(baseExc.filter((r) => r.gate === "on").map(excMetric).map((x) => [x.id, x]));
  const exc = {};
  for (const sex of ["m", "f"]) {
    exc[sex] = {};
    for (const d of [3, 5, 8]) {
      const row = {};
      for (const dir of ["up", "down", "pooled"]) {
        const xs = E.filter((x) => x.sex === sex && x.d === d && (dir === "pooled" || x.dir === dir));
        const ratios = xs.map((x) => { const b = BE.get(x.id); return b && b.peak >= RATIO_MIN_BASE && x.peak != null ? x.peak / b.peak : null; });
        row[dir] = { n: xs.length, nRatio: ratios.filter((x) => x != null).length, peak: med(xs.map((x) => x.peak)), basePeak: med(xs.map((x) => BE.get(x.id)?.peak ?? null)),
          ratio: med(ratios), ratioQ1: q(ratios, 0.25), ratioQ3: q(ratios, 0.75), tPeak: med(xs.map((x) => x.tPeak)), endDisp: med(xs.map((x) => x.endDisp)),
          ratioOfMed: (() => { const a = med(xs.map((x) => x.peak)), b = med(xs.map((x) => BE.get(x.id)?.peak ?? null)); return a != null && b ? a / b : null; })() };
      }
      exc[sex][d] = row;
    }
    // overall swing: the sum of the peaks of all of this sex's excursions (both directions, 3 / 5 / 8 s) over the clean sum, same streams
    const xs = E.filter((x) => x.sex === sex && x.peak != null && BE.get(x.id)?.peak != null);
    exc[sex].swing = { n: xs.length, ratio: xs.length ? xs.reduce((a, x) => a + Math.max(0, x.peak), 0) / xs.reduce((a, x) => a + Math.max(0, BE.get(x.id).peak), 0) : null,
      meanDiff: xs.length ? xs.reduce((a, x) => a + x.peak - BE.get(x.id).peak, 0) / xs.length : null,
      shortRatio: (() => { const s3 = xs.filter((x) => x.d <= 5); return s3.length ? s3.reduce((a, x) => a + Math.max(0, x.peak), 0) / s3.reduce((a, x) => a + Math.max(0, BE.get(x.id).peak), 0) : null; })() };
  }
  const onset = onsetTimes(excRecs.filter((r) => r.gate === "on"), g);
  const per = {};
  for (const sex of ["m", "f"]) {
    const P = s.per[sex], R = s.perReader.filter((x) => x.sex === sex);
    per[sex] = {
      bias: P.bias, biasQ1: q(R.map((x) => x.bias), 0.25), biasQ3: q(R.map((x) => x.bias), 0.75), biasMin: q(R.map((x) => x.bias), 0), biasMax: q(R.map((x) => x.bias), 1),
      medUN: P.medUN, sens: P.sens, sensRatio: P.sensRatio, sensRatioQ1: q(R.map((x) => x.sensRatio), 0.25), sensRatioQ3: q(R.map((x) => x.sensRatio), 0.75),
      t50up: P.t50up, t50down: P.t50down, t90up: P.t90up, t90down: P.t90down, t50: P.t50, t90: P.t90, tAbs: P.tAbs,
      firstDrawn: P.firstDrawn, firstPos: P.firstPos, admPerS: P.admPerS,
      voicedShare: P.voicedShare, hiddenShare: P.hiddenShare, drawnShare: P.drawnShare, warm: P.verdict.warming, sust: P.verdict.sustained,
      nbF_N: med(nbBy[`${sex}|N`] ?? []), nbF_U10: med(nbBy[`${sex}|U10`] ?? []), nbF_D10: med(nbBy[`${sex}|D10`] ?? []),
      nbF_N_min: q(nbBy[`${sex}|N`] ?? [], 0), nbF_N_max: q(nbBy[`${sex}|N`] ?? [], 1),
      nbOnStreams: nbOnAny[sex], streams: g.filter((r) => r.sex === sex).length,
      levelOut: P.levelOut, levelIn: P.levelIn, voicedRms: P.voicedRms,
      perReader: R.map((x) => ({ reader: x.reader, bias: x.bias, sensRatio: x.sensRatio, nbF: x.nbFinalF })),
    };
  }
  const pert = byName[cond]?.pert ?? [];
  const g1k = pert.length ? gainDb(pert, 1000) : 0;
  const resp = pert.length ? Object.fromEntries([250, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000].map((f) => [f, +(gainDb(pert, f) - g1k).toFixed(2)])) : null;
  const dFpred = pert.length ? bandGainDb(pert, 4500, 6500) - bandGainDb(pert, 2500, 3500) : 0;
  return { cond, desc: byName[cond]?.desc ?? "clean", resp, dFpred, per, exc, onset, events: s.events.length };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const baseRecs = loadRuns(BASE);
  const baseExc = loadExc(path.join(ROOT, "clean"));
  const want = arg("conds", "") ? arg("conds", "").split(",") : CONDS.map((c) => c.name);
  const out = [];
  // clean itself (excursion peaks absolute)
  out.push(condReport("clean", baseRecs.filter((r) => r.gate === "on" && r.kind !== "long"), baseExc, baseRecs, baseExc));
  for (const c of want) {
    const dir = path.join(ROOT, c);
    if (!existsSync(dir)) continue;
    const recs = loadRuns(dir), exc = loadExc(dir);
    if (!recs.length) continue;
    out.push({ ...condReport(c, recs, exc, baseRecs, baseExc), complete: { runs: recs.length, exc: exc.length } });
  }
  const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : (x > 0 && d > 0 ? "+" : "") + x.toFixed(d));
  const g = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
  const tc = (e) => (e && e.n ? `${g(e.med, 1)}${e.cens ? `(${e.cens}c)` : ""}` : "—");
  const oc = (e, T) => (e && e.n ? `${g(e[T], 1)}${e[T === "t50" ? "c50" : "c90"] ? `(${e[T === "t50" ? "c50" : "c90"]}c)` : ""}` : "—");
  const pc = (x) => (x == null ? "—" : (100 * x).toFixed(1));
  const lines = [];
  lines.push("| cond | sex | n | bias [IQR] | sens/clean [IQR] | T50 ↑/↓ | T90 ↑/↓ | onset8 T50 ↑/↓ | onset8 T90 ↑/↓ | exc peak ratio 3/5/8 s (pooled, med of readers) | exc peak u 3/5/8 s | swing all / ≤5 s | nbF N (U10/D10) | nbOn | dF pred | voiced% | hid% | drawn% | firstDrawn |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of out) for (const sex of ["m", "f"]) {
    const P = r.per[sex], X = r.exc[sex];
    lines.push(`| ${r.cond} | ${sex} | ${r.complete ? `${r.complete.runs}+${r.complete.exc}` : "base"} | ${f(P.bias)} [${f(P.biasQ1)}, ${f(P.biasQ3)}] | ${g(P.sensRatio)} [${g(P.sensRatioQ1)}, ${g(P.sensRatioQ3)}] | ${tc(P.t50up)}/${tc(P.t50down)} | ${tc(P.t90up)}/${tc(P.t90down)} | ${oc(r.onset[sex].up, "t50")}/${oc(r.onset[sex].down, "t50")} | ${oc(r.onset[sex].up, "t90")}/${oc(r.onset[sex].down, "t90")} | ${[3, 5, 8].map((d) => g(X[d].pooled.ratio)).join(" / ")} | ${[3, 5, 8].map((d) => g(X[d].pooled.peak)).join(" / ")} | ${g(X.swing.ratio)} / ${g(X.swing.shortRatio)} | ${g(P.nbF_N, 1)} (${g(P.nbF_U10, 1)}/${g(P.nbF_D10, 1)}) | ${P.nbOnStreams}/${P.streams} | ${g(r.dFpred, 1)} | ${pc(P.voicedShare)} | ${pc(P.hiddenShare)} | ${pc(P.drawnShare)} | ${g(P.firstDrawn, 1)} |`);
  }
  console.log(lines.join("\n"));
  if (arg("json", "")) writeFileSync(arg("json", ""), JSON.stringify(out, null, 1));
  if (arg("md", "")) writeFileSync(arg("md", ""), lines.join("\n") + "\n");
}
