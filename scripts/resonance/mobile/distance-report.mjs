// distance-report.mjs — the distance / room area's tables: every condition run (full
// chain in <root>/runs, clean-pitch attribution in <root>/cp), the impulse responses'
// direct-to-reverberant ratios, and the phone conditions relative to a boom-mic proxy.
//
//   node scripts/resonance/mobile/distance-report.mjs [--root=build/resonance-mobile/distance]
//        [--boom=boom-a90__c,an-a60-dir__c] [--out=<root>/report.json]
// Prints markdown tables. Relative to a boom proxy B (both in clean-pitch mode, same reader):
//   dBias = bias(phone) - bias(B); sens ratio = sens(phone) / sens(B);
//   exc ratio = median over readers / X of disp(phone) / disp(B) (pooled 3 / 5 / 8 s).
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const root = path.resolve(repo, arg("root", "build/resonance-mobile/distance"));
const { loadRuns, summarize, streamMetrics } = await import(pathToFileURL(path.join(here, "summarize.mjs")).href);
const { excursion, excSummary } = await import(pathToFileURL(path.join(here, "distance-summarize.mjs")).href);
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
// 90 % bootstrap interval of the median over readers (resampling readers; seeded)
function bootMed(groups, B = 2000) {
  const G = groups.filter((x) => x.length);
  if (G.length < 2) return [null, null];
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
  const m = [];
  for (let b = 0; b < B; b++) { const pool = []; for (let i = 0; i < G.length; i++) pool.push(...G[Math.floor(rnd() * G.length)]); m.push(med(pool)); }
  return [q(m, 0.05), q(m, 0.95)];
}
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : (x >= 0 && d === 2 ? "+" : "") + x.toFixed(d));
const g = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pc = (x) => (x == null ? "—" : (100 * x).toFixed(1));

const baseMain = loadRuns(path.join(repo, "build/resonance-mobile/runs/clean"));
const baseExc = loadRuns(path.join(root, "runs/clean-exc"));
const CONDS = JSON.parse(readFileSync(path.join(root, "conds.json"), "utf8"));
const rirInfo = (cond) => {
  const name = CONDS[cond]?.ir ?? null;
  if (!name) return null;
  const p = path.join(root, "rir", `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};
const tc = (e) => (e?.n ? `${g(e.med, 1)}${e.cens ? `(${e.cens}c)` : ""}` : "—");

function condStats(dir, gate) {
  const all = loadRuns(dir).filter((r) => r.gate === gate);
  if (!all.length) return null;
  const main = all.filter((r) => r.kind === "ctl" || r.kind === "sw"), exc = all.filter((r) => r.kind === "exc");
  const ids = new Set(main.map((r) => r.id)), eids = new Set(exc.map((r) => r.id));
  const s = summarize(main, baseMain.filter((r) => r.gate === gate && ids.has(r.id) && (r.hintDelay ?? 0) === 0));
  const e = excSummary(exc, baseExc.filter((r) => r.gate === gate && eids.has(r.id)));
  const out = {};
  for (const sex of ["m", "f"]) {
    const R = s.perReader.filter((x) => x.sex === sex), E = e.rows.filter((x) => x.sex === sex);
    if (!R.length) continue;
    const exd = (d) => { const Z = E.filter((x) => x.d === d); return { ratio: med(Z.map((x) => x.ratio)), rom: med(Z.map((x) => x.disp)) / med(Z.map((x) => x.base)), blank: Z.filter((x) => x.blank).length, n: Z.length }; };
    const p = s.per[sex];
    out[sex] = {
      n: R.length, bias: p.bias, biasQ1: q(R.map((x) => x.bias), 0.25), biasQ3: q(R.map((x) => x.bias), 0.75), sensRatio: p.sensRatio,
      sensQ1: q(R.map((x) => x.sensRatio), 0.25), sensQ3: q(R.map((x) => x.sensRatio), 0.75),
      exc3: exd(3), exc5: exd(5), exc8: exd(8), excAll: { ratio: med(E.map((x) => x.ratio)), q1: q(E.map((x) => x.ratio), 0.25), q3: q(E.map((x) => x.ratio), 0.75),
        ci: bootMed([...new Set(E.map((x) => x.reader))].map((rd) => E.filter((x) => x.reader === rd).map((x) => x.ratio).filter((v) => v != null))) },
      biasCI: bootMed(R.map((x) => [x.bias].filter((v) => v != null))), sensCI: bootMed(R.map((x) => [x.sensRatio].filter((v) => v != null))),
      nDarker: R.filter((x) => x.bias != null && x.bias < 0).length, nSensBelow1: R.filter((x) => x.sensRatio != null && x.sensRatio < 1).length,
      nSensBelow09: R.filter((x) => x.sensRatio != null && x.sensRatio < 0.9).length,
      t50up: p.t50up, t50down: p.t50down, t90up: p.t90up, t90down: p.t90down, tAbs: p.tAbs, adm: p.admPerS, voiced: p.voicedShare, hidden: p.hiddenShare,
      drawn: p.drawnShare, nbF: p.nbFinalF, nbOn: p.nbOnStreams, level: p.levelOut, voicedRms: p.voicedRms, firstDrawn: p.firstDrawn,
    };
  }
  return { out, perReader: s.perReader, excRows: e.rows };
}

const rows = [];
const store = {};
for (const [mode, sub] of [["full", "runs"], ["cp", "cp"]]) {
  const d = path.join(root, sub);
  if (!existsSync(d)) continue;
  for (const cond of readdirSync(d).filter((c) => c !== "clean-exc" && existsSync(path.join(d, c)) && readdirSync(path.join(d, c)).some((x) => /^runs-/.test(x))).sort()) {
    for (const gate of ["on", "off"]) {
      const st = condStats(path.join(d, cond), gate);
      if (!st) continue;
      store[`${mode}|${cond}|${gate}`] = st;
      const ri = rirInfo(cond);
      for (const sex of ["m", "f"]) {
        const x = st.out[sex];
        if (!x) continue;
        rows.push(`| ${mode} | ${cond} | ${gate} | ${sex} | ${x.n} | ${ri?.roomOn ? g(ri.drrDb_0_8k, 1) : "∞"} | ${f(x.bias)} [${f(x.biasQ1)}, ${f(x.biasQ3)}] (${f(x.biasCI[0])}, ${f(x.biasCI[1])}) | ${g(x.sensRatio)} (${g(x.sensCI[0])}, ${g(x.sensCI[1])}) | ${g(x.exc3.ratio)} / ${g(x.exc5.ratio)} / ${g(x.exc8.ratio)} | ${g(x.excAll.ratio)} (${g(x.excAll.ci[0])}, ${g(x.excAll.ci[1])}) | ${tc(x.t50up)}/${tc(x.t50down)} | ${tc(x.t90up)}/${tc(x.t90down)} | ${g(x.adm)} | ${pc(x.voiced)} | ${pc(x.hidden)} | ${pc(x.drawn)} | ${g(x.nbF, 1)} | ${g(x.level, 1)}/${g(x.voicedRms, 1)} |`);
      }
    }
  }
}
console.log("| mode | cond | gate | sex | readers | DRR dB (0–8 kHz) | Δu bias [IQR] (90 % boot CI of median) | sens ratio (CI) | exc peak ratio 3/5/8 s (median of per-reader ratios) | exc ratio, 3+5+8 pooled (CI) | T50 ↑/↓ | T90 ↑/↓ | adm/s | voiced % | hidden % | drawn % | nbF dB | active / voiced-hop RMS dBFS |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);

// clean reference row (same stream kinds)
{
  const s = summarize(baseMain.filter((r) => r.gate === "on" && (r.kind === "ctl" || r.kind === "sw")), null);
  console.log("\nclean (gate on, ctl + sw):", ["m", "f"].map((sex) => `${sex}: medU N ${g(s.per[sex].medUN)} sens ${g(s.per[sex].sens)} T50 ${tc(s.per[sex].t50up)}/${tc(s.per[sex].t50down)} voiced ${pc(s.per[sex].voicedShare)} drawn ${pc(s.per[sex].drawnShare)} nbF ${g(s.per[sex].nbFinalF, 1)}`).join(" | "));
  const e = excSummary(baseExc.filter((r) => r.gate === "on"), baseExc.filter((r) => r.gate === "on"));
  console.log("clean exc peak displacement (u, median over readers, U and D pooled):", ["m", "f"].map((sex) => `${sex}: 3 s ${g(e.per[sex][3].disp)} 5 s ${g(e.per[sex][5].disp)} 8 s ${g(e.per[sex][8].disp)}; tPeak ${g(e.per[sex][3].tPeak, 1)}/${g(e.per[sex][5].tPeak, 1)}/${g(e.per[sex][8].tPeak, 1)} s`).join(" | "));
}

// phone relative to the boom proxies (clean-pitch mode for both)
const booms = arg("boom", "boom-a90__c,an-a60-dir__c").split(",").filter((b) => store[`cp|${b}|on`]);
if (booms.length) {
  console.log("\n| phone (cp) | boom proxy | sex | ΔBias phone − boom (median [IQR]) | sens ratio phone / boom | exc disp ratio phone / boom (3/5/8 s pooled, median [IQR]) |");
  console.log("|---|---|---|---|---|---|");
  for (const b of booms) {
    const B = store[`cp|${b}|on`];
    for (const [k, P] of Object.entries(store)) {
      const [mode, cond, gate] = k.split("|");
      if (mode !== "cp" || gate !== "on" || booms.includes(cond)) continue;
      for (const sex of ["m", "f"]) {
        const pr = P.perReader.filter((x) => x.sex === sex), br = new Map(B.perReader.map((x) => [x.reader, x]));
        const dB = pr.map((x) => (br.get(x.reader)?.bias != null && x.bias != null ? x.bias - br.get(x.reader).bias : null));
        const sr = pr.map((x) => (br.get(x.reader)?.sens ? x.sens / br.get(x.reader).sens : null));
        const be = new Map(B.excRows.map((x) => [x.id, x]));
        const er = P.excRows.filter((x) => x.sex === sex).map((x) => { const y = be.get(x.id); return y?.disp > 0.05 && x.disp != null ? x.disp / y.disp : null; });
        if (!pr.length) continue;
        console.log(`| ${cond} | ${b} | ${sex} | ${f(med(dB))} [${f(q(dB, 0.25))}, ${f(q(dB, 0.75))}] | ${g(med(sr))} | ${g(med(er))} [${g(q(er, 0.25))}, ${g(q(er, 0.75))}] |`);
      }
    }
  }
}
// impulse responses
console.log("\n| IR | dist m | angle ° below | RT60 target | RT60 500/1k/4k realised | DRR 0–8 kHz dB | DRR 1k / 4k dB | direct path re 250 Hz, dB at 1/2/4/8 kHz | whole IR re 250 Hz, dB at 1/2/4/8 kHz |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const fn of readdirSync(path.join(root, "rir")).filter((x) => x.endsWith(".json")).sort()) {
  const j = JSON.parse(readFileSync(path.join(root, "rir", fn), "utf8"));
  const r = (x) => (x == null || !Number.isFinite(x) || x < 0.05 ? "—" : x.toFixed(2));
  console.log(`| ${j.name} | ${j.dist} | ${j.angle} | ${j.roomOn ? j.rt60Target : "anechoic"} | ${[2, 3, 5].map((b) => r(j.rt60Band[b])).join(" / ")} | ${j.roomOn ? j.drrDb_0_8k.toFixed(1) : "∞"} | ${j.roomOn ? [3, 5].map((b) => j.drrDbBand[b].toFixed(1)).join(" / ") : "—"} | ${[3, 4, 5, 6].map((b) => (j.directBandDb[b] - j.directBandDb[1]).toFixed(1)).join(" / ")} | ${[3, 4, 5, 6].map((b) => (j.totalBandDb[b] - j.totalBandDb[1]).toFixed(1)).join(" / ")} |`);
}
writeFileSync(arg("out", path.join(root, "report.json")), JSON.stringify(Object.fromEntries(Object.entries(store).map(([k, v]) => [k, v.out])), null, 1));
