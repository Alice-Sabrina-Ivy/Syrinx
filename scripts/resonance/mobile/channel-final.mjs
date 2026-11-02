// channel-final.mjs — cross-condition views of the channel report (mobile
// resonance diagnosis, channel area, 2026-10-28):
//   1. narrowband F change vs bias across conditions (could F flag a phone channel?)
//   2. the LTAS projection prediction (channel-ltas.py: a x clean sensitivity) vs the measured bias
//   3. the split arms (channel-split.mjs): bias via vtln alone vs via the pitch track alone
//   node scripts/resonance/mobile/channel-final.mjs --report=<channel-report json> [--ltas=<ltas.json>] [--split=<dir>]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const R = JSON.parse(readFileSync(arg("report", "build/resonance-mobile/channel/report.json"), "utf8"));
const ltasP = arg("ltas", "build/resonance-mobile/channel/ltas/ltas.json");
const LT = existsSync(ltasP) ? JSON.parse(readFileSync(ltasP, "utf8")) : null;
const splitDir = arg("split", "build/resonance-mobile/channel/split");
const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) / 2, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(d));
const clean = R.find((r) => r.cond === "clean");
const conds = R.filter((r) => r.cond !== "clean");
const sens0 = { m: clean.per.m.sens, f: clean.per.f.sens };

console.log("## F change vs bias, and LTAS-projection prediction vs bias");
console.log("| cond | sex | bias | dF (N ctl, median) | dF pred (flat spectrum) | LTAS pred bias |");
console.log("|---|---|---|---|---|---|");
const rows = { m: [], f: [] };
for (const r of conds) for (const sex of ["m", "f"]) {
  const P = r.per[sex], dF = P.nbF_N != null ? P.nbF_N - clean.per[sex].nbF_N : null;
  const lt = LT?.conds.find((c) => c.cond === r.cond);
  const pred = lt ? lt[`a_${sex}`] * sens0[sex] : null;
  rows[sex].push({ cond: r.cond, bias: P.bias, dF, pred });
  console.log(`| ${r.cond} | ${sex} | ${f(P.bias)} | ${f(dF, 1)} | ${f(r.dFpred, 1)} | ${f(pred)} |`);
}
for (const sex of ["m", "f"]) {
  const xs = rows[sex].filter((x) => x.bias != null && x.dF != null);
  const ps = rows[sex].filter((x) => x.bias != null && x.pred != null);
  console.log(`${sex}: corr(dF, bias) = ${corr(xs.map((x) => x.dF), xs.map((x) => x.bias)).toFixed(2)} over ${xs.length} conditions; corr(LTAS pred, bias) = ${corr(ps.map((x) => x.pred), ps.map((x) => x.bias)).toFixed(2)}`);
}
// reader spread of clean F vs the channel shifts
{
  const all = clean.per.m.perReader.concat(clean.per.f.perReader).map((x) => x.nbF).filter(Number.isFinite);
  const m = all.reduce((a, b) => a + b, 0) / all.length, sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / all.length);
  console.log(`clean N-control F over the 12 readers: ${Math.min(...all).toFixed(1)} .. ${Math.max(...all).toFixed(1)} dB, SD ${sd.toFixed(1)} dB`);
}

if (existsSync(splitDir)) {
  console.log("\n## Split: bias via vtln alone (perturbed audio, clean pitch) vs via the pitch track alone (clean audio, perturbed pitch)");
  console.log("| cond | sex | full bias | vtln-only bias | pitch-only bias | full sens/clean | vtln-only sens/clean |");
  console.log("|---|---|---|---|---|---|---|");
  // clean medU per stream from the base summary (per reader N / U10 / D10) is in the report's perReader only for N; recompute from split's own clean? use the report's clean per-reader medUN and sens
  const base = new Map(clean.per.m.perReader.concat(clean.per.f.perReader).map((x) => [x.reader, x]));
  const cleanMed = JSON.parse(readFileSync(arg("clean-medu", "build/resonance-mobile/channel/clean-medu.json"), "utf8"));
  for (const file of readdirSync(splitDir).filter((x) => x.endsWith(".jsonl"))) {
    const cond = file.replace(/\.jsonl$/, ""), rr = R.find((r) => r.cond === cond);
    const L = readFileSync(path.join(splitDir, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const sex of ["m", "f"]) {
      const by = (arm, V) => new Map(L.filter((x) => x.sex === sex && x.arm === arm && x.variant === V).map((x) => [x.reader, x.medU]));
      const readers = [...new Set(L.filter((x) => x.sex === sex).map((x) => x.reader))];
      const bias = (arm) => med(readers.map((rd) => { const v = by(arm, "N").get(rd), c = cleanMed[`${rd}__N`]; return v != null && c != null ? v - c : null; }));
      const sensR = (arm) => med(readers.map((rd) => { const u = by(arm, "U10").get(rd), d = by(arm, "D10").get(rd), cu = cleanMed[`${rd}__U10`], cd = cleanMed[`${rd}__D10`]; return u != null && d != null && cu != null && cd != null ? (u - d) / (cu - cd) : null; }));
      console.log(`| ${cond} | ${sex} | ${f(rr?.per[sex].bias)} | ${f(bias("vtln"))} | ${f(bias("pitch"))} | ${rr ? rr.per[sex].sensRatio.toFixed(2) : "—"} | ${sensR("vtln")?.toFixed(2) ?? "—"} |`);
    }
  }
  void base;
}
