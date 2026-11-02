// audit-filters.mjs — phone-vs-desktop resonance audit: what a microphone /
// placement response does to the cue, per reader, against the clean run
// (audit-chain.mjs records, gate on, schedule imm). For each condition and
// reader on the L stream (the reader's 150 s of reading):
//   dF   median narrowband F (posts >= 10 s; the 4.5-6.5 vs 2.5-3.5 kHz voiced
//        energy ratio the resonance worker already posts as narrowband.f) minus c0's
//   du   median shown u (posts >= 30 s) minus c0's (negative = darker)
//   bins admitted vtln bins / min, relative to c0
// and, where the N / U10 controls exist, the sensitivity ratio
// (U10 - N)_cond / (U10 - N)_c0 (median shown u at t >= 10 s on each control).
// Also prints the pooled least-squares slope du / dF (u per dB of F) per sex,
// the calibration a phone reading of narrowband.f could be read against.
//   node scripts/resonance/mobile/audit-filters.mjs [--conds=lp7k,lp6k,...] [--root=build/resonance-mobile/audit]
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const ROOT = path.resolve(repo, arg("root", "build/resonance-mobile/audit"));
const conds = arg("conds", "lp7k,lp6k,lp5k,lp4k,hs6,hs12,hp200,g10,g20,g30").split(",");
const T = (k) => (k + 1) * 0.025;
const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const f = (x, d = 2) => (x == null ? "–" : x.toFixed(d));

function load(cond, gate = "on") {
  const file = path.join(ROOT, "chain", `${cond}__imm__g${gate}.jsonl`);
  if (!existsSync(file)) return null;
  const m = new Map();
  for (const l of readFileSync(file, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); m.set(r.id, r); }
  return m;
}
function stats(rec) {
  const P = rec.posts.filter((p) => typeof p[1] !== "string");
  const last = P[P.length - 1];
  return {
    F: med(P.filter((p) => T(p[0]) >= 10).map((p) => p[11])),
    nbOn: P.filter((p) => p[9] === 1).length / Math.max(1, P.length),
    u30: med(P.filter((p) => T(p[0]) >= 30 && p[1] != null).map((p) => p[1])),
    u10: med(P.filter((p) => T(p[0]) >= 10 && p[1] != null).map((p) => p[1])),
    bins: last ? last[13] / (rec.nC * 0.025 / 60) : null,
  };
}

const base = load("c0");
const out = [];
console.log("| cond | sex | readers | ΔF dB median (min..max) | Δu median (min..max) | bins/min vs c0 | sensitivity (U10−N) vs c0 | NB notice on (max share of posts) |");
console.log("|---|---|---|---|---|---|---|---|");
const pairs = { m: [], f: [] };
for (const c of conds) {
  const run = load(c);
  if (!run) continue;
  for (const sex of ["m", "f"]) {
    const dF = [], du = [], br = [], sens = [], on = [];
    for (const [id, r] of run) {
      if (r.sex !== sex) continue;
      const b = base.get(id);
      if (!b) continue;
      const s = stats(r), s0 = stats(b);
      if (r.stream === "L") {
        if (s.F != null && s0.F != null) dF.push(s.F - s0.F);
        if (s.u30 != null && s0.u30 != null) du.push(s.u30 - s0.u30);
        if (s.F != null && s0.F != null && s.u30 != null && s0.u30 != null && !c.startsWith("g")) pairs[sex].push([s.F - s0.F, s.u30 - s0.u30]);
        if (s.bins != null && s0.bins) br.push(s.bins / s0.bins);
        on.push(s.nbOn);
      }
      if (r.stream === "N") {
        const u = run.get(id.replace(/__N$/, "__U10")), u0 = base.get(id.replace(/__N$/, "__U10"));
        if (u && u0) {
          const a = stats(u).u10 - s.u10, a0 = stats(u0).u10 - s0.u10;
          if (Number.isFinite(a) && Number.isFinite(a0) && a0 !== 0) sens.push(a / a0);
        }
      }
    }
    if (!du.length) continue;
    const row = { cond: c, sex, n: du.length, dF: med(dF), dFmin: Math.min(...dF), dFmax: Math.max(...dF), du: med(du), duMin: Math.min(...du), duMax: Math.max(...du),
      binsRatio: med(br), sens: med(sens), sensN: sens.length, nbOnMax: Math.max(...on) };
    out.push(row);
    console.log(`| ${c} | ${sex} | ${row.n} | ${f(row.dF, 1)} (${f(row.dFmin, 1)}..${f(row.dFmax, 1)}) | ${f(row.du)} (${f(row.duMin)}..${f(row.duMax)}) | ${f(row.binsRatio)} | ${row.sensN ? `${f(row.sens)} (n ${row.sensN})` : "–"} | ${(100 * row.nbOnMax).toFixed(0)} % |`);
  }
}
for (const sex of ["m", "f"]) {
  const P = pairs[sex];
  if (P.length < 3) continue;
  const mx = P.reduce((a, p) => a + p[0], 0) / P.length, my = P.reduce((a, p) => a + p[1], 0) / P.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of P) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  console.log(`slope du/dF (${sex}, filter conditions, ${P.length} reader-conditions): ${f(sxy / sxx, 3)} u per dB, r ${f(sxy / Math.sqrt(sxx * syy), 2)}`);
}
writeFileSync(path.join(ROOT, "filters.json"), JSON.stringify(out, null, 1));
