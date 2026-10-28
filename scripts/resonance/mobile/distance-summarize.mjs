// distance-summarize.mjs — per condition × gate × sex, summarize.mjs's metrics
// plus the SHORT-EXCURSION metric (distance / room area, 2026-10-28).
//
//   node scripts/resonance/mobile/distance-summarize.mjs --runs=<cond dir>[,...]
//        --base=build/resonance-mobile/runs/clean --base-exc=build/resonance-mobile/distance/runs/clean-exc
//        [--gate=on|off|both] [--json=<out.json>] [--md] [--readers]
//
// Short excursion (exc streams N -> X (d s) -> N, X in U10 / D10, onset 18 s):
//   pre   = median shown u of the DRAWN posts in the 1 s before the onset (3 s if none)
//   peak  = the drawn u furthest in the excursion's direction among posts in
//           (onset, onset + d + 3 s]; disp = peak - pre, signed so + = the right
//           direction (0 when nothing is drawn in the window — counted as "blank")
//   ratio = disp(condition) / disp(clean base) per reader, X and d; the table gives the
//           median over readers (U10 and D10 pooled, 12 values per sex and d) and the
//           median clean disp. tPeak = time from the onset to the peak. In brackets: the
//           ratio of the medians (median disp under the condition / median clean disp).
// bias IQR: quartiles over readers of the per-reader N-control bias.
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const S_ = await import(pathToFileURL(path.join(here, "summarize.mjs")).href);
const { loadRuns, postSeries, summarize } = S_;
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);

export function excursion(rec) {
  const S = postSeries(rec);
  const on = rec.joins[0], off = rec.joins[1], dir = rec.seq[1].startsWith("U") ? 1 : -1;
  let preW = S.filter((x) => x.drawn && x.t > on - 1 && x.t <= on).map((x) => x.u);
  if (!preW.length) preW = S.filter((x) => x.drawn && x.t > on - 3 && x.t <= on).map((x) => x.u);
  const pre = med(preW);
  const W = S.filter((x) => x.drawn && x.t > on && x.t <= off + 3);
  if (pre == null) return { pre: null, disp: null, tPeak: null, blank: false, nW: W.length };
  if (!W.length) return { pre, disp: 0, tPeak: null, blank: true, nW: 0 };
  let best = W[0];
  for (const x of W) if (dir * (x.u - best.u) > 0) best = x;
  // shown displacement at the end of the excursion (last drawn post at or before the offset)
  const atOff = W.filter((x) => x.t <= off + 1e-9).pop();
  return { pre, disp: dir * (best.u - pre), tPeak: best.t - on, blank: false, nW: W.length, dispAtOff: atOff ? dir * (atOff.u - pre) : 0 };
}

export function excSummary(recs, baseRecs) {
  const B = new Map(baseRecs.map((r) => [r.id, excursion(r)]));
  const rows = recs.map((r) => ({ id: r.id, reader: r.reader, sex: r.sex, X: r.seq[1], d: r.excS ?? (r.joins[1] - r.joins[0]), ...excursion(r) }))
    .map((x) => { const b = B.get(x.id); return { ...x, base: b?.disp ?? null, ratio: b?.disp > 0.05 && x.disp != null ? x.disp / b.disp : null, ratioOff: b?.dispAtOff > 0.05 && x.dispAtOff != null ? x.dispAtOff / b.dispAtOff : null }; });
  const per = {};
  for (const sex of ["m", "f"]) {
    per[sex] = {};
    for (const d of [...new Set(rows.map((x) => x.d))].sort((a, b) => a - b)) {
      const R = rows.filter((x) => x.sex === sex && x.d === d);
      per[sex][d] = {
        n: R.length, ratio: med(R.map((x) => x.ratio)), ratioQ1: q(R.map((x) => x.ratio), 0.25), ratioQ3: q(R.map((x) => x.ratio), 0.75),
        ratioUp: med(R.filter((x) => x.X.startsWith("U")).map((x) => x.ratio)), ratioDown: med(R.filter((x) => x.X.startsWith("D")).map((x) => x.ratio)),
        ratioOff: med(R.map((x) => x.ratioOff)),
        disp: med(R.map((x) => x.disp)), base: med(R.map((x) => x.base)), tPeak: med(R.map((x) => x.tPeak)), blank: R.filter((x) => x.blank).length,
      };
    }
  }
  return { per, rows };
}

const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pc = (x) => (x == null ? "—" : (100 * x).toFixed(1));
const tc = (e) => (e.n ? `${f(e.med, 1)}${e.cens ? `(${e.cens}c)` : ""}` : "—");
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const dirs = arg("runs", "").split(",").filter(Boolean).map((d) => path.resolve(d));
  const baseAll = loadRuns(path.resolve(arg("base", "build/resonance-mobile/runs/clean")));
  const baseExcDir = path.resolve(arg("base-exc", "build/resonance-mobile/distance/runs/clean-exc"));
  const baseExc = existsSync(baseExcDir) ? loadRuns(baseExcDir) : [];
  const gates = arg("gate", "both") === "both" ? ["on", "off"] : [arg("gate", "both")];
  const out = {}, lines = [];
  for (const d of dirs) {
    const all = loadRuns(d);
    for (const g of gates) {
      const recs = all.filter((r) => r.gate === g);
      if (!recs.length) continue;
      const cond = recs[0].cond;
      const kinds = arg("kinds", "ctl,sw").split(",");
      const main = recs.filter((r) => r.kind !== "exc" && kinds.includes(r.kind)), exc = recs.filter((r) => r.kind === "exc");
      const ids = new Set(main.map((r) => r.id));
      const base = baseAll.filter((r) => r.gate === g && ids.has(r.id) && (r.hintDelay ?? 0) === 0);
      const s = main.length ? summarize(main, base.length ? base : null) : null;
      const eids = new Set(exc.map((r) => r.id));
      const e = exc.length ? excSummary(exc, baseExc.filter((r) => r.gate === g && eids.has(r.id))) : null;
      // bias IQR, sens ratio IQR
      const iq = {};
      if (s) for (const sex of ["m", "f"]) {
        const R = s.perReader.filter((x) => x.sex === sex);
        iq[sex] = { biasQ1: q(R.map((x) => x.bias), 0.25), biasQ3: q(R.map((x) => x.bias), 0.75), sensQ1: q(R.map((x) => x.sensRatio), 0.25), sensQ3: q(R.map((x) => x.sensRatio), 0.75) };
      }
      // pitch / level stats of the exc streams too (when there is no main set)
      out[`${cond}|${g}`] = { cond, gate: g, pert: recs[0].pert, per: s?.per ?? null, perReader: s?.perReader ?? null, iq, exc: e?.per ?? null, excRows: e?.rows ?? null };
      for (const sex of ["m", "f"]) {
        const p = s?.per?.[sex], E = e?.per?.[sex] ?? {};
        if (!p && !e) continue;
        const ex = (dd) => (E[dd] ? `${f(E[dd].ratio)}${E[dd].blank ? `(${E[dd].blank}b)` : ""}` : "—");
        lines.push([cond, g, sex, p ? f(p.medUN) : "—", p ? `${f(p.bias)} [${f(iq[sex].biasQ1)}, ${f(iq[sex].biasQ3)}]` : "—", p ? f(p.sensRatio) : "—",
          ex(3), ex(5), ex(8), E[5] ? f(E[5].base) : "—",
          p ? `${tc(p.t50up)}/${tc(p.t50down)}` : "—", p ? `${tc(p.t90up)}/${tc(p.t90down)}` : "—", p ? f(p.admPerS) : "—",
          p ? pc(p.voicedShare) : "—", p ? pc(p.hiddenShare) : "—", p ? pc(p.drawnShare) : "—", p ? f(p.nbFinalF, 1) : "—", p ? p.nbOnStreams : "—",
          p ? `${f(p.levelOut, 1)}/${f(p.voicedRms, 1)}` : "—"].join(" | "));
      }
      if (process.argv.includes("--readers") && s) {
        console.log(`\n${cond} gate ${g}`);
        for (const x of s.perReader) console.log([x.reader, x.sex, f(x.medUN), f(x.bias), f(x.sens), f(x.sensRatio), f(x.admPerS), f(x.voicedRms, 1)].join("\t"));
        if (e) for (const x of e.rows) console.log(["  exc", x.id, f(x.pre), f(x.disp), f(x.base), f(x.ratio), f(x.tPeak, 1), x.blank ? "blank" : ""].join("\t"));
      }
    }
  }
  console.log("| cond | gate | sex | medU N | bias [IQR] | sens ratio | exc peak ratio 3 s | 5 s | 8 s | clean peak 5 s (u) | T50 ↑/↓ | T90 ↑/↓ | adm/s | voiced % | hidden % | drawn % | nbF | nbOn | active / voiced-hop RMS dBFS |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const l of lines) console.log(`| ${l} |`);
  if (arg("json", "")) writeFileSync(arg("json", ""), JSON.stringify(out, null, 1));
}
