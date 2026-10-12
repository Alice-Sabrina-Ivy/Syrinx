// summarize.mjs — statistics for a timing result file (§P5): for every
// (platform, block, engine, build, front end, frame period, rate, length), the median,
// p90 (linear interpolation between order statistics, numpy's default) and minimum of
// C0, cold G1, G2 and warm G1 — pooled over clips and per clip — in seconds per phrase
// and ms per second of audio, plus the WebAssembly memory size.
//   node scripts/voice-preview/timing/summarize.mjs <result.json> [--json=out.json]
import { readFileSync, writeFileSync } from "node:fs";

export function quantile(v, q) {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}
const stat = (v) => ({ n: v.length, median: quantile(v, 0.5), p90: quantile(v, 0.9), min: Math.min(...v) });

export function summarize(res) {
  const groups = new Map();
  for (const r of res.runs) {
    if (r.error) continue;
    const key = [r.block, r.engine, r.ready?.build || "js", r.fe, `fp${r.fp}`, r.rate, `${r.length}s`].join(" ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, rs] of groups) {
    const L = rs[0].length;
    const q = (pick) => {
      const all = rs.flatMap(pick);
      const perClip = {};
      for (const c of [...new Set(rs.map((r) => r.clip))]) perClip[c] = stat(rs.filter((r) => r.clip === c).flatMap(pick));
      return { ...stat(all), msPerSecond: quantile(all, 0.5) / L, worstClipP90: Math.max(...Object.values(perClip).map((s) => s.p90)), perClip };
    };
    out.push({
      key, runs: rs.length,
      c0: q((r) => [r.c0]),
      g1cold: q((r) => [r.g1cold.ms]),
      g2: q((r) => r.g2.map((g) => g.ms)),
      g1warm: q((r) => r.g1warm.map((g) => g.ms)),
      memBytes: Math.max(...rs.map((r) => r.memBytes || 0)),
      stagesColdMedian: Object.fromEntries(Object.keys(rs[0].g1cold.stages).map((k) => [k, quantile(rs.map((r) => r.g1cold.stages[k]), 0.5)])),
    });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("summarize.mjs")) {
  const res = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const s = summarize(res);
  const f = (v) => (v / 1000).toFixed(3);
  console.log(`${res.meta?.userAgent || ""}\n${"group".padEnd(44)} runs   C0 med  G1cold med/p90  (ms/s)   G2 med/p90  (ms/s)   G1warm med   mem MB`);
  for (const g of s) {
    console.log(`${g.key.padEnd(44)} ${String(g.runs).padStart(4)}  ${f(g.c0.median)} s  ${f(g.g1cold.median)}/${f(g.g1cold.p90)} s (${g.g1cold.msPerSecond.toFixed(0)})` +
      `  ${f(g.g2.median)}/${f(g.g2.p90)} s (${g.g2.msPerSecond.toFixed(0)})  ${f(g.g1warm.median)} s  ${(g.memBytes / 1048576).toFixed(1)}`);
  }
  const j = process.argv.find((a) => a.startsWith("--json="));
  if (j) writeFileSync(j.slice(7), JSON.stringify(s, null, 1));
}
