// faster-budget.mjs — where the resonance dot's delay comes from (the latency
// budget of measurements/resonance-faster-2026-10-26.md), on the shipped
// chain (S0), from the logged bins / posts of faster.mjs bins.
//
//   node scripts/resonance/faster-budget.mjs --runs=<bins jsonl,...> [--size=1.0]
//
// Per switch event (as faster-eval.mjs: p = progress from the old variant's
// control to the new one's at the same moment), T50 / T90 at each stage:
//   bin       the vtln bins themselves (each = ~1 s of voiced frames, vtln's
//             trailing sum), a 5-bin running median, at the bin's end time te
//   all       a 5 s voiced median of every bin (no utterance gate), at te
//   gated     the same over the admitted bins only (the cue's plain readout), at te
//   restart   the shipped shown readout (S0, with the restart rule), at te
//   posted    S0 on the worker's 0.2 s posts, drawn posts only (faster-eval.mjs)
// plus the bins' resolve delay (when a bin is stamped − te), the UI's
// arithmetic (250 ms tick, 200 ms ease-out thumb) and the header's words.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const CS = await imp("src/components/cueStripModel.js");
const { createRestartReadout } = await imp("src/resonance/resonanceCue.js");
const REF = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8")).vtln;
const GAP = REF.womenMedian - REF.menMedian;
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const CHS = 0.025, SEGS = 18;
const recs = arg("runs", "").split(",").filter(Boolean).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const byId = new Map(recs.map((r) => [r.id, r]));
const SIZE = Number(arg("size", "1.0"));
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const toU = (s) => (s - REF.menMedian) / GAP;
const median = (v) => { const a = [...v].sort((x, y) => x - y), h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };

// per stream, per stage: [te, u] after each bin
const stageCache = new Map();
function stage(id, name) {
  const key = id + "|" + name;
  if (stageCache.has(key)) return stageCache.get(key);
  const r = byId.get(id);
  const out = [];
  if (name === "bin") {
    const last = [];
    for (const [te, , v] of r.bins) { if (v == null) continue; last.push(toU(v)); if (last.length > 5) last.shift(); out.push([te, median(last)]); }
  } else if (name === "all") {
    let items = [];
    for (const [te, stamp, v] of r.bins) {
      if (v == null) continue;
      items.push([stamp, toU(v)]); items = items.filter((x) => x[0] > stamp - 5);
      out.push([te, median(items.map((x) => x[1]))]);
    }
  } else {
    const ro = createRestartReadout({ ref: REF, restart: name === "gated" ? null : undefined });
    let last = null, dropped = 0;
    for (const [te, stamp, v, adm] of r.bins) {
      const d = last === null ? 0 : Math.max(0, stamp - last); last = stamp;
      if (!adm) { dropped += d; continue; }
      if (ro.add(stamp - dropped, v)) out.push([te, ro.snapshot().u]);
    }
  }
  stageCache.set(key, out);
  return out;
}
const at = (arr, t) => { let lo = 0, hi = arr.length - 1, ans = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= t + 1e-9) { ans = arr[m][1]; lo = m + 1; } else hi = m - 1; } return ans; };

const events = [];
for (const r of recs.filter((x) => x.kind === "sw")) {
  const [A, B] = r.seq;
  const size = B.startsWith("U05") || B.startsWith("D05") ? 0.5 : 1.0;
  if (size !== SIZE) continue;
  const up1 = B.startsWith("U");
  events.push({ id: r.id, sex: r.sex, dir: up1 ? "up" : "down", tj: r.joins[0], old: `${r.reader}__${A}`, nw: `${r.reader}__${B}`, first: true });
  events.push({ id: r.id, sex: r.sex, dir: up1 ? "down" : "up", tj: r.joins[1], old: `${r.reader}__${B}`, nw: `${r.reader}__${A}`, first: false });
}
function tStage(e, name) {
  const S = stage(e.id, name), O = stage(e.old, name), N = stage(e.nw, name);
  let t50 = null, t90 = null;
  for (const [te, u] of S) {
    if (te <= e.tj || te > e.tj + SEGS) continue;
    const o = at(O, te), n = at(N, te);
    if (o == null || n == null || n === o) continue;
    const p = (u - o) / (n - o);
    if (t50 === null && p >= 0.5) t50 = te - e.tj;
    if (t90 === null && p >= 0.9) t90 = te - e.tj;
  }
  return [t50 ?? SEGS, t90 ?? SEGS];
}
// posted (drawn) S0 and the words
function postSeries(id) {
  const r = byId.get(id);
  return r.posts.map((p) => {
    const snap = { u: p[2], raw: p[3], fill: p[7], voicedS: p[8], verdict: VERD[p[9]], sinceResumeS: p[10], narrowband: { on: !!p[11], decided: !!p[12] }, shownStartU: p[5], startU: p[6] };
    const state = CS.resonanceRowState({ workerStatus: "ready", snap, voiced: !!p[13], holding: !!p[14] });
    return { t: (p[0] + 1) * CHS, u: p[2], drawn: CS.dotOpacity(state) !== null && p[2] != null, hdr: CS.resonanceHeader(state, snap), state };
  });
}
function tPosted(e) {
  const S = postSeries(e.id), O = postSeries(e.old), N = postSeries(e.nw);
  let t50 = null, t90 = null, word = null;
  const want = e.dir === "up" ? "brighter than your start" : "darker than your start";
  for (let i = 0; i < S.length; i++) {
    const x = S[i];
    if (x.t <= e.tj || x.t > e.tj + SEGS) continue;
    if (word === null && x.hdr === want) word = x.t - e.tj;
    if (!x.drawn || O[i].u == null || N[i].u == null || N[i].u === O[i].u) continue;
    const p = (x.u - O[i].u) / (N[i].u - O[i].u);
    if (t50 === null && p >= 0.5) t50 = x.t - e.tj;
    if (t90 === null && p >= 0.9) t90 = x.t - e.tj;
  }
  return { t: [t50 ?? SEGS, t90 ?? SEGS], word };
}

const STAGES = ["bin", "all", "gated", "restart"];
const rows = [];
for (const sex of ["f", "m"]) for (const dir of ["up", "down"]) {
  const E = events.filter((e) => e.sex === sex && e.dir === dir);
  const row = { sex, dir, n: E.length };
  for (const s of STAGES) { const ts = E.map((e) => tStage(e, s)); row[s] = [med(ts.map((t) => t[0])), med(ts.map((t) => t[1]))]; }
  const P = E.map(tPosted);
  row.posted = [med(P.map((x) => x.t[0])), med(P.map((x) => x.t[1]))];
  const W = P.filter((x, i) => E[i].first).map((x) => x.word);
  row.word = [med(W.map((w) => w ?? SEGS)), W.filter((w) => w === null).length, W.length];
  rows.push(row);
}
// resolve delay
const res = { f: [], m: [] };
for (const r of recs) for (const b of r.bins) if (b[3]) res[r.sex].push(b[5] - b[0]);
// UI: 250 ms tick (uniform wait), 200 ms ease-out = cubic-bezier(0, 0, 0.58, 1)
function bez(p1x, p1y, p2x, p2y, frac) {
  // progress y reached at time x: solve on the curve parameter
  const B = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  for (let i = 0; i <= 10000; i++) { const t = i / 10000; if (B(t, p1y, p2y) >= frac) return B(t, p1x, p2x); }
  return 1;
}
const f2 = (x, d = 2) => (x == null ? "—" : x.toFixed(d));
console.log(`size ${SIZE} u: ${events.length} events`);
console.log("sex dir n | bin T50/T90 | all | gated | restart | posted(drawn) | header word after join 1: median (never/of)");
for (const r of rows) console.log(`${r.sex} ${r.dir} ${r.n} | ${STAGES.map((s) => `${f2(r[s][0], 1)}/${f2(r[s][1], 1)}`).join(" | ")} | ${f2(r.posted[0], 1)}/${f2(r.posted[1], 1)} | ${f2(r.word[0], 1)} (${r.word[1]}/${r.word[2]})`);
console.log(`bin resolve delay (stamp − te), admitted bins: women median ${f2(med(res.f), 3)} q90 ${f2(q(res.f, 0.9), 3)} s, men median ${f2(med(res.m), 3)} q90 ${f2(q(res.m, 0.9), 3)} s`);
console.log(`UI: tick 250 ms -> mean wait 125 ms (max 250); thumb 200 ms ease-out: 50 % at ${(200 * bez(0, 0, 0.58, 1, 0.5)).toFixed(0)} ms, 90 % at ${(200 * bez(0, 0, 0.58, 1, 0.9)).toFixed(0)} ms`);
console.log(`U1 (100 ms thumb): 50 % at ${(100 * bez(0, 0, 0.58, 1, 0.5)).toFixed(0)} ms, 90 % at ${(100 * bez(0, 0, 0.58, 1, 0.9)).toFixed(0)} ms; U2 (125 ms tick): mean wait 62.5 ms; U3 (0.1 s post): mean wait 0.05 s instead of 0.1 s`);
