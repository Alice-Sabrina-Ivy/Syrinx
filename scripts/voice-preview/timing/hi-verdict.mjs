// hi-verdict.mjs — the rules of § Addition 2026-10-12 (A3, A6, A7) of
// measurements/voice-preview-spike-2026-10-12.md applied to the desktop Chrome timing of the new
// rates. Input: analyze.mjs --by-clipset=1 --json output for the A5 run (run-desktop.mjs --plans).
//
//   node scripts/voice-preview/timing/hi-verdict.mjs <analysis.json> [--json=FILE]
//
// A6, phone inclusion (per new rate, per engine): desktop Chrome, 5 s, both clip sets, all four §P6
//   conditions at x2.0 (2.0 x median cold G1 <= 3 s, 2.0 x worst-clip p90 cold G1 <= 3 s,
//   2.0 x median G2 <= 1 s, 2.0 x worst-clip p90 G2 <= 1 s; C0 excess over 3 s added to cold G1).
//   Pass on both sets -> timed on the phone; otherwise "predicted fail". The margin "passes up to
//   xN" is the smallest of 3 s / G1 median, 3 s / G1 p90, 1 s / G2 median, 1 s / G2 p90 over both sets.
// A3, 44.1 kHz: WORLD SIMD F-S 5 s with 44.1 kHz input, per clip set, cold G1 median and worst-clip
//   p90 and G2 median and worst-clip p90 each <= the 48 kHz value x 1.05.
// A7, phone estimate for each included new rate: phone time per run = 2.0 x the mean desktop
//   compute per run (C0 + cold G1 + 20 x G2 + 5 x warm G1) + 2.5 s, plus 60 s idle per block;
//   blocks: P1 WORLD 5 s (one per clip set, 40 runs each), P1 PSOLA 5 s (the same, only if PSOLA
//   is included at that rate), P2 WORLD 3 s + 8 s (pre-registered, 80 runs), P3 WORLD non-SIMD 5 s
//   (pre-registered, 40 runs). Also at x3.0, for scale.
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=")));
const A = JSON.parse(readFileSync(process.argv[2], "utf8")).groups;
const SETS = ["timing", "timing-speech"];
const NEW = [48000, 32000];
const find = (o) => A.find((g) => Object.entries(o).every(([k, v]) => g[k] === v));
const sec = (ms) => (ms / 1000).toFixed(2);

function cond(g, k = 2) {
  const excess = Math.max(0, g.c0.median * k - 3000);
  const v = { g1med: g.g1cold.median * k + excess, g1p90: g.g1cold.worstClipP90 * k + excess, g2med: g.g2.median * k, g2p90: g.g2.worstClipP90 * k };
  const c = { g1med: v.g1med <= 3000, g1p90: v.g1p90 <= 3000, g2med: v.g2med <= 1000, g2p90: v.g2p90 <= 1000 };
  return { k, values: v, conditions: c, pass: Object.values(c).every(Boolean), maxFactor: g.maxFactor };
}

const out = { inclusion: {}, check441: {}, estimate: {} };
console.log("A6 inclusion at x2.0 (desktop Chrome, 5 s): conditions G1 med / G1 p90 / G2 med / G2 p90; margin");
for (const engine of ["world", "psola"]) {
  for (const rate of NEW) {
    const per = {};
    for (const clipset of SETS) {
      const g = find({ engine, rate, length: 5, clipset, fe: "S", fp: 5, ...(engine === "world" ? { build: "simd" } : {}) });
      if (!g) { per[clipset] = null; continue; }
      per[clipset] = { ...cond(g, 2), c0: g.c0.median, g1med: g.g1cold.median, g1p90: g.g1cold.worstClipP90, g2med: g.g2.median, g2p90: g.g2.worstClipP90, nRuns: g.nRuns };
    }
    const ok = SETS.every((s) => per[s] && per[s].pass);
    const margin = Math.min(...SETS.filter((s) => per[s]).map((s) => per[s].maxFactor));
    out.inclusion[`${engine} ${rate}`] = { included: ok, marginX: margin, per };
    console.log(`${engine.padEnd(5)} ${rate}: ${ok ? "TIMED ON THE PHONE" : "predicted fail"}, passes up to x${margin.toFixed(1)}`);
    for (const s of SETS) {
      const p = per[s];
      if (!p) { console.log(`   ${s}: no data`); continue; }
      console.log(`   ${s.padEnd(14)} desktop G1 ${sec(p.g1med)} (p90 ${sec(p.g1p90)}), G2 ${sec(p.g2med)} (p90 ${sec(p.g2p90)}); x2.0: ` +
        `${sec(p.values.g1med)} ${p.conditions.g1med ? "ok" : "FAIL"} / ${sec(p.values.g1p90)} ${p.conditions.g1p90 ? "ok" : "FAIL"} / ` +
        `${sec(p.values.g2med)} ${p.conditions.g2med ? "ok" : "FAIL"} / ${sec(p.values.g2p90)} ${p.conditions.g2p90 ? "ok" : "FAIL"}; up to x${p.maxFactor.toFixed(1)} (${p.nRuns} runs)`);
    }
  }
}

console.log("\nA3 check: 44.1 kHz input vs 48 kHz (WORLD SIMD F-S 5 s), each <= 48 kHz x 1.05");
let pass441 = true;
for (const clipset of SETS) {
  const a = find({ engine: "world", build: "simd", rate: 44100, length: 5, clipset: `${clipset}-44k`, fe: "S", fp: 5 });
  const b = find({ engine: "world", build: "simd", rate: 48000, length: 5, clipset, fe: "S", fp: 5 });
  if (!a || !b) { console.log(`   ${clipset}: missing data`); pass441 = false; continue; }
  const q = { g1med: [a.g1cold.median, b.g1cold.median], g1p90: [a.g1cold.worstClipP90, b.g1cold.worstClipP90], g2med: [a.g2.median, b.g2.median], g2p90: [a.g2.worstClipP90, b.g2.worstClipP90] };
  const r = Object.fromEntries(Object.entries(q).map(([k, [x, y]]) => [k, { at441: x, at48: y, ratio: x / y, pass: x <= 1.05 * y }]));
  const ok = Object.values(r).every((v) => v.pass);
  pass441 &&= ok;
  out.check441[clipset] = { pass: ok, ...r };
  console.log(`   ${clipset.padEnd(14)} ${Object.entries(r).map(([k, v]) => `${k} ${sec(v.at441)}/${sec(v.at48)} s (x${v.ratio.toFixed(3)} ${v.pass ? "ok" : "FAIL"})`).join(", ")} -> ${ok ? "PASS" : "FAIL"}`);
}
out.check441.pass = pass441;
console.log(`   44.1 kHz behaves like 48 kHz within 5 %: ${pass441 ? "yes" : "NO"}`);

console.log("\nA7 phone estimate for each included new rate (phone run = k x desktop compute + 2.5 s; 60 s idle per block)");
for (const rate of NEW) {
  if (!out.inclusion[`world ${rate}`]?.included) { console.log(`   ${rate}: not in the phone matrix`); continue; }
  const blocks = [];
  const add = (name, groups) => {
    const runs = groups.reduce((a, g) => a + g.nRuns, 0);
    const mean = groups.reduce((a, g) => a + g.runComputeMeanMs * g.nRuns, 0) / runs;
    blocks.push({ name, runs, meanComputeS: mean / 1000 });
  };
  for (const s of SETS) add(`P1 WORLD 5 s ${s}`, [find({ engine: "world", build: "simd", rate, length: 5, clipset: s, fe: "S", fp: 5 })]);
  if (out.inclusion[`psola ${rate}`]?.included) for (const s of SETS) add(`P1 PSOLA 5 s ${s}`, [find({ engine: "psola", rate, length: 5, clipset: s, fe: "S", fp: 5 })]);
  add("P2 WORLD 3 s + 8 s", [3, 8].map((L) => find({ engine: "world", build: "simd", rate, length: L, clipset: "timing", fe: "S", fp: 5 })));
  add("P3 WORLD non-SIMD 5 s", [find({ engine: "world", build: "nosimd", rate, length: 5, clipset: "timing", fe: "S", fp: 5 })]);
  const est = (k) => blocks.reduce((t, b) => t + 60 + b.runs * (k * b.meanComputeS + 2.5), 0) / 60;
  const runs = blocks.reduce((a, b) => a + b.runs, 0);
  out.estimate[rate] = { runs, blocks, minAt2: est(2), minAt3: est(3) };
  console.log(`   ${rate}: ${runs} runs, ~${est(2).toFixed(0)} min at x2.0 (${est(3).toFixed(0)} min at x3.0); ${blocks.map((b) => `${b.name} ${b.runs} x ${b.meanComputeS.toFixed(1)} s`).join("; ")}`);
}
const base2 = 300, base3 = 413;
const add2 = Object.values(out.estimate).reduce((a, e) => a + e.minAt2, 0), add3 = Object.values(out.estimate).reduce((a, e) => a + e.minAt3, 0);
out.total = { minAt2: base2 + add2, minAt3: base3 + add3, budgetMin: 1.5 * (base2 + add2), note: "16 / 22.05 / 24 kHz share from the addition (A7): 300 min at x2.0, 413 min at x3.0" };
console.log(`   total with 16 / 22.05 / 24 kHz (300 min at x2.0, 413 at x3.0): ~${out.total.minAt2.toFixed(0)} min at x2.0, ~${out.total.minAt3.toFixed(0)} min at x3.0; budget 1.5 x = ${out.total.budgetMin.toFixed(0)} min`);
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
