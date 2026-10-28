// timing-summary.mjs — condition × sex tables of the browser timing runs
// (timing-run.mjs logs, analysed by timing-analyze.mjs), each run paired with
// the base run of the same WAV.
//
//   node scripts/resonance/mobile/timing-summary.mjs [--runs=build/resonance-mobile/timing/runs]
//        [--base=base] [--json=build/resonance-mobile/timing/summary.json] > summary.md
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const dir = path.resolve(repo, arg("runs", "build/resonance-mobile/timing/runs"));
const BASE = arg("base", "base");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const sets = [...new Set(files.map((f) => f.split("__")[1].replace(/\.json$/, "")))];
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(d));
const analysed = {};
for (const set of sets) {
  const base = path.join(dir, `${BASE}__${set}.json`);
  const runs = files.filter((x) => x.endsWith(`__${set}.json`)).map((x) => path.join(dir, x));
  const tmp = path.join(repo, `build/resonance-mobile/timing/_an_${set}.json`);
  execFileSync(process.execPath, [path.join(repo, "scripts/resonance/mobile/timing-analyze.mjs"), `--runs=${runs.join(",")}`, `--base=${base}`, `--json=${tmp}`, "--quiet"], { stdio: "inherit", maxBuffer: 1 << 28 });
  analysed[set] = JSON.parse((await import("node:fs")).readFileSync(tmp, "utf8"));
}
for (const ex of arg("extra", "").split(",").filter(Boolean)) {
  const X = JSON.parse((await import("node:fs")).readFileSync(path.resolve(repo, ex), "utf8"));
  for (const [set, v] of Object.entries(X)) if (analysed[set]) analysed[set].runs.push(...v.runs);
}
const conds = [...new Set(Object.values(analysed).flatMap((a) => a.runs.map((r) => r.cond)))];
const order = ["node-hd0", "base", "base2", "busy40", "thr4", "thr6", "aff1", "thr4aff2", "node-hd4", "node-hd12", "node-hd40", "node-hd70"];
conds.sort((a, b) => (order.indexOf(a) + 100 * (order.indexOf(a) < 0)) - (order.indexOf(b) + 100 * (order.indexOf(b) < 0)));
const byCond = (c) => Object.values(analysed).flatMap((a) => a.runs.filter((r) => r.cond === c).map((r) => ({ r, base: a.base })));
const out = { conds: {} };

let md = "";
md += "### Timing, drops and CPU per condition (both WAV sets pooled; runs: " + conds.map((c) => `${c} ${byCond(c).length}`).join(", ") + ")\n\n";
md += "| cond | main-thread lateness Σ ms/s | capture dispatch lag p99 / max ms | audio lost by capture ms | pitch msg lag med / p99 / max ms | hint lag in worker med / p99 / max chunks | state content lag med / p99 / max ms | grid forced unvoiced | frames dropped | bins dropped % | warming % posts | overloads | voice gate | res worker ms/s | pitch inferMs med / p90 | vadMs med / p90 | renderer CPU ms/s | posts/s | first position s (wall from Start) | row live s (DOM) |\n";
md += "|" + "---|".repeat(21) + "\n";
for (const c of conds) {
  const R = byCond(c).map((x) => x.r);
  out.conds[c] = {};
  if (!R[0]?.mainLatenessMs) continue; // Node chain runs: no timing
  const sum = (k) => R.map(k);
  const row = {
    late: med(sum((r) => r.mainLatenessMs.meanSumPerS)),
    disp99: med(sum((r) => r.dispatchLagMs.p99)), dispMax: Math.max(...sum((r) => r.dispatchLagMs.max)),
    lost: sum((r) => r.audio.lostAudioMs).reduce((a, b) => a + b, 0) / R.length,
    pMed: med(sum((r) => r.pitch.lagMs.med)), p99: med(sum((r) => r.pitch.lagMs.p99)), pMax: Math.max(...sum((r) => r.pitch.lagMs.max)),
    hMed: med(sum((r) => r.states.hintLagChunks.med)), h99: med(sum((r) => r.states.hintLagChunks.p99)), hMax: Math.max(...sum((r) => r.states.hintLagChunks.max)),
    cMed: med(sum((r) => r.states.lagContentMs.med)), c99: med(sum((r) => r.states.lagContentMs.p99)), cMax: Math.max(...sum((r) => r.states.lagContentMs.max)),
    forced: sum((r) => r.resonance.gridForcedUnvoiced).join("/"), fd: sum((r) => r.resonance.framesDropped).join("/"),
    bd: med(sum((r) => (100 * r.resonance.binsDropped) / (r.resonance.binsDropped + r.resonance.binsAdmitted))),
    warm: med(sum((r) => (100 * (r.states.verdicts.warming ?? 0)) / r.states.posts)),
    ov: sum((r) => r.resonance.overloads).join("/"), vad: sum((r) => r.pitch.vadFinal).join("/"),
    res: med(sum((r) => r.resonance.msPerAudioSmean)), inf: med(sum((r) => r.pitch.inferMs.med)), inf90: med(sum((r) => r.pitch.inferMs.p90)),
    vadMs: med(sum((r) => r.pitch.vadMs.med)), vad90: med(sum((r) => r.pitch.vadMs.p90)), ren: med(sum((r) => r.rendererCpuMsPerS)), pps: med(sum((r) => r.states.postsPerAudioS)),
    first: sum((r) => r.first.posWallS).map((x) => f(x, 1)).join("/"), firstDom: sum((r) => r.first.domLiveWallS).map((x) => f(x, 1)).join("/"),
  };
  out.conds[c].timing = row;
  md += `| ${c} | ${f(row.late, 0)} | ${f(row.disp99, 0)} / ${f(row.dispMax, 0)} | ${f(row.lost, 0)} | ${f(row.pMed, 0)} / ${f(row.p99, 0)} / ${f(row.pMax, 0)} | ${f(row.hMed, 1)} / ${f(row.h99, 1)} / ${f(row.hMax, 0)} | ${f(row.cMed, 0)} / ${f(row.c99, 0)} / ${f(row.cMax, 0)} | ${row.forced} | ${row.fd} | ${f(row.bd, 1)} | ${f(row.warm, 1)} | ${row.ov} | ${row.vad} | ${f(row.res, 1)} | ${f(row.inf, 2)} / ${f(row.inf90, 1)} | ${f(row.vadMs, 1)} / ${f(row.vad90, 1)} | ${f(row.ren, 0)} | ${f(row.pps, 2)} | ${row.first} | ${row.firstDom} |\n`;
}

md += "\n### Long switches (±12 % formant scale for 18 s), per sex: T50 / T90 in s after the switch — audio time (the post's newest chunk) / wall time to the post reaching the main thread / wall time to the row's value on screen (DOM); Δ = median paired difference vs base on the same event\n\n";
md += "| cond | sex | n | size u | T50 audio | T50 wall | T50 DOM | T90 audio | T90 wall | T90 DOM | ΔT50 audio | ΔT50 wall | ΔT50 DOM | ΔT90 wall |\n|" + "---|".repeat(14) + "\n";
for (const c of conds) for (const sex of ["m", "f"]) {
  const pairs = byCond(c).flatMap(({ r, base }) => r.events.map((e, i) => ({ e, b: base.events[i] })).filter((x) => x.e.kind === "long" && x.e.sex === sex));
  const g = (k) => med(pairs.map((x) => x.e[k]));
  const d = (k) => med(pairs.map((x) => (x.e[k] != null && x.b[k] != null ? x.e[k] - x.b[k] : null)));
  const row = { n: pairs.length, size: med(pairs.map((x) => Math.abs(x.e.size ?? NaN))), t50: g("t50"), t50w: g("t50Wall"), t50d: g("t50Dom"), t90: g("t90"), t90w: g("t90Wall"), t90d: g("t90Dom"), d50: d("t50"), d50w: d("t50Wall"), d50d: d("t50Dom"), d90w: d("t90Wall"), nc50: pairs.filter((x) => x.e.t50 == null).length };
  (out.conds[c].long ??= {})[sex] = row;
  md += `| ${c} | ${sex} | ${row.n}${row.nc50 ? ` (${row.nc50} nc)` : ""} | ${f(row.size)} | ${f(row.t50)} | ${f(row.t50w)} | ${f(row.t50d)} | ${f(row.t90)} | ${f(row.t90w)} | ${f(row.t90d)} | ${f(row.d50)} | ${f(row.d50w)} | ${f(row.d50d)} | ${f(row.d90w)} |\n`;
}

md += "\n### Short excursions (U10 / D10 for 3, 5, 8 s): peak displacement of the shown u during the excursion and up to 3 s after it, relative to the u just before it; ratio = median over events of cond / base on the same event (posts; DOM = the value on screen)\n\n";
md += "| cond | sex | peak 3 s | peak 5 s | peak 8 s | ratio 3 s | ratio 5 s | ratio 8 s | ratio all (posts) | ratio all (DOM) |\n|" + "---|".repeat(10) + "\n";
for (const c of conds) for (const sex of ["m", "f"]) {
  const pairs = byCond(c).flatMap(({ r, base }) => r.events.map((e, i) => ({ e, b: base.events[i] })).filter((x) => x.e.kind === "exc" && x.e.sex === sex));
  const by = (dur) => pairs.filter((x) => x.e.dur === dur);
  const pk = (dur) => med(by(dur).map((x) => x.e.peak));
  const rt = (xs, k = "peak") => med(xs.filter((x) => x.b[k] > 0.05).map((x) => x.e[k] / x.b[k]));
  const row = { p3: pk(3), p5: pk(5), p8: pk(8), r3: rt(by(3)), r5: rt(by(5)), r8: rt(by(8)), r: rt(pairs), rd: rt(pairs, "peakDom") };
  (out.conds[c].exc ??= {})[sex] = row;
  md += `| ${c} | ${sex} | ${f(row.p3)} | ${f(row.p5)} | ${f(row.p8)} | ${f(row.r3)} | ${f(row.r5)} | ${f(row.r8)} | ${f(row.r)} | ${f(row.rd)} |\n`;
}

md += "\n### Steady-state sensitivity u(U10) − u(D10) (median of the last 4 s of each 18 s segment, blocks A and E) and u trajectory vs base (|Δu| over posts matched by file time ≤ 0.1 s)\n\n";
md += "| cond | sex | sens | sens / base | bias u (median signed Δu) | |Δu| med | |Δu| p95 | |Δu| max | share |Δu| > 0.05 |\n|" + "---|".repeat(9) + "\n";
for (const c of conds) for (const sex of ["m", "f"]) {
  const R = byCond(c);
  const sens = [], ratio = [];
  for (const { r, base } of R) {
    const readers = [...new Set(r.steady.filter((s) => s.sex === sex).map((s) => s.reader))];
    for (const rd of readers) {
      const s = (x, blk) => x.steady.find((y) => y.reader === rd && y.block === blk)?.X;
      const a = s(r, "A") - s(r, "E"), b = s(base, "A") - s(base, "E");
      sens.push(a); ratio.push(a / b);
    }
  }
  const du = R.map((x) => x.r.vsBase?.duSex?.[sex]).filter(Boolean);
  const row = { bias: med(R.map((x) => x.r.vsBase?.bias?.[sex])), sens: med(sens), ratio: med(ratio), duMed: med(du.map((x) => x.med)), duP95: med(du.map((x) => x.p95)), duMax: Math.max(...du.map((x) => x.max)), frac: med(du.map((x) => x.fracGt005)) };
  (out.conds[c].steady ??= {})[sex] = row;
  md += `| ${c} | ${sex} | ${f(row.sens)} | ${f(row.ratio, 3)} | ${f(row.bias, 3)} | ${f(row.duMed, 3)} | ${f(row.duP95, 3)} | ${f(row.duMax, 3)} | ${f(row.frac, 3)} |\n`;
}
process.stdout.write(md);
if (arg("json", "")) writeFileSync(path.resolve(repo, arg("json", "")), JSON.stringify(out, null, 1));
