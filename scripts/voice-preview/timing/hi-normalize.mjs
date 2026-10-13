// hi-normalize.mjs — the addition's desktop margins (A5 / A6 of
// measurements/voice-preview-spike-2026-10-12.md) with the machine load taken out (review of the
// addition, 2026-10-13). Reported only: the A6 rule used A5 as measured, and its verdict stands.
//
// A5 ran on a busy desktop: its 24 kHz anchor (the same gate cells as the earlier matrices) took
// longer than in the earlier runs. Within one run every configuration shared the load, so the
// ratio of a cell to the in-run 24 kHz anchor (same clip set, same statistic) carries over; times
// that ratio, the earlier runs' 24 kHz value puts the cell on the earlier runs' load level:
//   normalised = A5 cell / A5 24 kHz anchor x earlier 24 kHz (per clip set and per statistic:
//                cold G1 median, worst-clip p90 cold G1, G2 median, worst-clip p90 G2)
// and "passes up to xN" = min(3 s / G1 median, 3 s / G1 p90, 1 s / G2 median, 1 s / G2 p90)
// (C0 is 0.02-0.04 s: no module-load excess at any factor considered here).
// Optional --retime: another run with the 24 kHz anchor (e.g. at light load) is reported as
// measured and normalised the same way.
//
//   node scripts/voice-preview/timing/hi-normalize.mjs --hi=<A5 analysis.json> --pre=<earlier
//        pre-registered analysis.json> --speech=<earlier speech-dense analysis.json>
//        [--hiSkip=<A5 analysis with --skip-reps>] [--retime=<analysis.json>[,...]] [--json=out.json]
// All inputs are analyze.mjs --json output; --hi, --hiSkip and --retime with --by-clipset=1.
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const load = (f) => JSON.parse(readFileSync(f, "utf8")).groups;
const HI = load(args.hi);
const EARLY = { timing: load(args.pre), "timing-speech": load(args.speech) };
const SKIP = args.hiSkip ? load(args.hiSkip) : null;
const RETIME = args.retime ? args.retime.split(",").map((f) => ({ file: f, groups: load(f) })) : [];
const SETS = ["timing", "timing-speech"];
const SETNAME = { timing: "pre-registered", "timing-speech": "speech-dense" };
const STATS = [["g1med", (g) => g.g1cold.median, 3000], ["g1p90", (g) => g.g1cold.worstClipP90, 3000], ["g2med", (g) => g.g2.median, 1000], ["g2p90", (g) => g.g2.worstClipP90, 1000]];
const find = (A, o) => A.find((g) => Object.entries(o).every(([k, v]) => (k === "clipset" && v === "timing" ? (g.clipset ?? "timing") === v : g[k] === v)));
const cell = (A, engine, rate, clipset) => find(A, { engine, rate, length: 5, fe: "S", fp: 5, clipset, ...(engine === "world" ? { build: "simd" } : {}) });
const earlyCell = (clipset) => EARLY[clipset].find((g) => g.engine === "world" && g.build === "simd" && g.fe === "S" && g.fp === 5 && g.rate === 24000 && g.length === 5);
const vals = (g) => Object.fromEntries(STATS.map(([k, f]) => [k, f(g)]));
const margin = (v) => Math.min(...STATS.map(([k, , lim]) => lim / v[k]));
const sec = (ms) => (ms / 1000).toFixed(2);

const out = { anchors: {}, cells: [], retime: [] };
console.log("24 kHz anchor (WORLD SIMD F-S 5 s): A5 in-run vs the earlier runs, and the load factor (earlier / A5) per statistic");
for (const s of SETS) {
  const a = vals(cell(HI, "world", 24000, s)), e = vals(earlyCell(s));
  const f = Object.fromEntries(STATS.map(([k]) => [k, e[k] / a[k]]));
  out.anchors[s] = { a5: a, earlier: e, factor: f };
  console.log(`  ${SETNAME[s].padEnd(15)} A5 ${STATS.map(([k]) => sec(a[k])).join(" / ")} s; earlier ${STATS.map(([k]) => sec(e[k])).join(" / ")} s; factor ${STATS.map(([k]) => f[k].toFixed(3)).join(" / ")}`);
}

console.log("\nCells, 5 s: ratio to the in-run 24 kHz anchor (G1 med / G1 p90 / G2 med / G2 p90); passes up to: as measured in A5 -> normalised to the earlier runs' load" + (SKIP ? " | A5 without the skipped repeats" : ""));
for (const [engine, rates] of [["world", [48000, 44100, 32000, 24000]], ["psola", [48000, 32000]]]) {
  for (const rate of rates) {
    for (const s of SETS) {
      const cs = rate === 44100 ? `${s}-44k` : s;
      const g = cell(HI, engine, rate, cs);
      if (!g) continue;
      const v = vals(g), an = out.anchors[s];
      const ratio = Object.fromEntries(STATS.map(([k]) => [k, v[k] / an.a5[k]]));
      const norm = Object.fromEntries(STATS.map(([k]) => [k, v[k] * an.factor[k]]));
      const gs = SKIP ? cell(SKIP, engine, rate, cs) : null;
      const row = { engine, rate, clipset: cs, a5: v, ratioToAnchor: ratio, normalised: norm, marginA5: margin(v), marginNormalised: margin(norm), marginSkip: gs ? margin(vals(gs)) : null, skip: gs ? vals(gs) : null };
      out.cells.push(row);
      console.log(`  ${`${engine} ${rate} ${SETNAME[s]}`.padEnd(30)} ratio ${STATS.map(([k]) => ratio[k].toFixed(2)).join(" / ")}; normalised ${STATS.map(([k]) => sec(norm[k])).join(" / ")} s;` +
        ` x${row.marginA5.toFixed(2)} -> x${row.marginNormalised.toFixed(2)}${gs ? ` | x${row.marginSkip.toFixed(2)} (${STATS.map(([k]) => sec(row.skip[k])).join(" / ")} s)` : ""}`);
    }
  }
}

for (const { file, groups } of RETIME) {
  console.log(`\nRe-time ${file}: as measured (G1 med / G1 p90 / G2 med / G2 p90), ratio to its own 24 kHz anchor, passes up to as measured -> normalised to the earlier runs' load`);
  for (const s of SETS) {
    const an = cell(groups, "world", 24000, s);
    if (!an) continue;
    const av = vals(an), e = out.anchors[s].earlier;
    for (const rate of [48000, 32000, 24000]) {
      const g = cell(groups, "world", rate, s);
      if (!g) continue;
      const v = vals(g);
      const ratio = Object.fromEntries(STATS.map(([k]) => [k, v[k] / av[k]]));
      const norm = Object.fromEntries(STATS.map(([k]) => [k, ratio[k] * e[k]]));
      out.retime.push({ file, rate, clipset: s, nRuns: g.nRuns, measured: v, ratioToAnchor: ratio, marginMeasured: margin(v), marginNormalised: margin(norm), loadBusyPct: g.loadBusyPct?.median ?? null });
      console.log(`  world ${rate} ${SETNAME[s].padEnd(15)} ${g.nRuns} runs, machine ${g.loadBusyPct ? g.loadBusyPct.median.toFixed(0) : "?"} % busy: ${STATS.map(([k]) => sec(v[k])).join(" / ")} s; ratio ${STATS.map(([k]) => ratio[k].toFixed(2)).join(" / ")}; x${margin(v).toFixed(2)} -> x${margin(norm).toFixed(2)}`);
    }
  }
}
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
