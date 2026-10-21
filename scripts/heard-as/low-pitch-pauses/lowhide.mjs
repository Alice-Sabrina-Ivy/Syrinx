// lowhide.mjs — the pre-registered low-voice hide of
// measurements/heard-as-low-pitch-and-pauses-2026-10-21.md "Addendum: low-voice hide":
// candidate rules L1 (low tail of the posted pitch) and L2 (lost voicing at a
// low pitch), each on top of the shipped panel (analyze.mjs variant H1+H3),
// simulated over run.mjs records exactly as analyze.mjs simulates the panel.
//
//   node lowhide.mjs --runs=<run.0.jsonl,run.1.jsonl> --out=<dir> --split=dev
//       every grid cell on dev; applies the selection rule and writes
//       <dir>/selection.json (refuses to overwrite it)
//   node lowhide.mjs --runs=… --out=<dir> --split=test
//       the cell selection.json names, ONCE, on held-out; writes <dir>/heldout.json
//       (refuses to overwrite it)
//
// The candidate rule is applied in an aggregator wrapper: the shipped
// aggregator's estimate(); if it shows a reading, the pooled posted voiced F0
// values (the frames the pooled median uses) and the posted frames inside the
// scored windows' spans are recomputed here (the median is checked equal to the
// aggregator's on every call) and the rule may hide it ("outside").

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VARIANTS, simulate } from "./analyze.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { createHeardAsAggregator, ML_WINDOW_MS } = await import(pathToFileURL(path.join(repo, "src/ml/heard-as.js")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const BASE = VARIANTS["H1+H3"];
const WIN_MS = 8000;
const PH = [0, 500, 1000, 1500];

// ---------------------------------------------------------------- grid
const CELLS = [];
for (const q of [10, 20]) for (const T of [76, 77, 78, 79, 80]) CELLS.push({ name: `L1 q${q} T${T}`, fam: "L1", q, T });
for (const M of [95, 100, 110]) for (const V of [0.30, 0.35, 0.40, 0.45, 0.50]) CELLS.push({ name: `L2 M${M} V${V.toFixed(2)}`, fam: "L2", M, V });

function fires(c, st) {
  if (c.fam === "L1") return st.f0s[Math.floor(c.q * (st.f0s.length - 1) / 100)] < c.T;
  return st.median < c.M && st.voicedShare < c.V;
}

function makeAggFor(cell) {
  return (opts) => {
    const agg = createHeardAsAggregator(opts);
    const W = [], F = [];
    let last = null;
    function stats(now) {
      const ends = W.filter((t) => t > now - WIN_MS && t <= now);
      const spans = [];
      for (const b of ends) { const a = b - ML_WINDOW_MS; const l = spans[spans.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else spans.push([a, b]); }
      const f0s = []; let vMs = 0, allMs = 0, k = 0;
      for (const [ms, f0, dt] of F) {
        if (ms < spans[0][0]) continue;
        while (k < spans.length && spans[k][1] < ms) k++;
        if (k >= spans.length) break;
        if (ms >= spans[k][0]) { allMs += dt; if (f0 > 0) { f0s.push(f0); vMs += dt; } }
      }
      f0s.sort((x, y) => x - y);
      const n = f0s.length, h = n >> 1;
      return { f0s, median: n % 2 ? f0s[h] : (f0s[h - 1] + f0s[h]) / 2, voicedShare: allMs > 0 ? vMs / allMs : 0 };
    }
    return {
      addPitch(p) {
        agg.addPitch(p);
        const gap = last === null ? 25 : Math.max(p.audioMs - last, 0);
        last = p.audioMs;
        F.push([p.audioMs, typeof p.f0 === "number" && p.f0 > 0 ? p.f0 : 0, Math.min(gap, 100)]);
      },
      addWindow(w) { const ok = agg.addWindow(w); if (ok) W.push(w.audioMs); return ok; },
      aggregate: (now) => agg.aggregate(now),
      estimate(now, vs) {
        const e = agg.estimate(now, vs);
        if (e.hidden || !cell) return e;
        const st = stats(now);
        if (Math.abs(Math.log(st.median) - e.lnF0) > 1e-9) throw new Error(`replica median ${st.median} != ${Math.exp(e.lnF0)} at ${now}`);
        return fires(cell, st) ? { hidden: "outside:lowVoice" } : e;
      },
    };
  };
}
const variantFor = (cell) => ({ ...BASE, makeAgg: makeAggFor(cell) });

// ---------------------------------------------------------------- streams + groups
function groupOf(s) {
  const sx = s.sex === "f" ? "W" : "M";
  if (s.set === "libri") {
    if (s.voice === "w75") return `w75.${sx}`;
    if (s.voice === "w90" && s.pause === "pnat") return `w90.${sx}`;
    if (s.voice === "w185" && s.pause === "pnat") return `w185.${sx}`;
    if (s.voice === "nat" && (s.pause === "p0" || s.pause === "pnat")) return `libri.${sx}`;
    return null;
  }
  return `${s.set}.${sx}`; // ptdb / fda / hil
}
// (b) and (c) groups judged on held-out; on dev only the LibriSpeech ones exist
const B_GROUPS = ["w90.W", "w90.M", "libri.M", "ptdb.M", "fda.M"];
const C_GROUPS = ["libri.W", "ptdb.W", "fda.W", "w185.W", "w185.M"];
const REPORTED = ["hil.M", "hil.W"];

function refMed8(s) {
  if (!s.ref) return null;
  const ref = new Float32Array(readFileSync(s.ref).buffer.slice(0)); const hop = s.refHopMs ?? 5;
  return (t) => {
    const v = [];
    for (let i = Math.max(0, Math.floor((t - WIN_MS) / hop)); i <= Math.min(ref.length - 1, Math.floor(t / hop)); i++) if (ref[i] > 0) v.push(ref[i]);
    if (!v.length) return null;
    v.sort((x, y) => x - y); const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  };
}

// per stream: the baseline's samples once, then each cell's
function evalStream(s, cells) {
  const lead = s.leadMs ?? 1000, end = s.speechSpans[s.speechSpans.length - 1][1] + 1000;
  const vis = (x) => x.t >= lead && x.t <= end;
  const isW75 = s.set === "libri" && s.voice === "w75";
  const rm = isW75 ? refMed8(s) : null;
  const below = new Map();
  const base = PH.map((ph) => simulate(s, BASE, ph).samples);
  if (rm) for (const x of base[0]) if (vis(x)) { const r = rm(x.t); below.set(x.t, r !== null && r < 81); }
  const summarize = (runs) => {
    let shown = 0, n = 0, low = 0, changes = 0;
    for (const sm of runs) {
      const v = sm.filter(vis);
      n += v.length;
      for (let i = 0; i < v.length; i++) {
        if (v[i].shown) { shown++; if (below.get(v[i].t)) low++; }
        if (i && v[i].shown !== v[i - 1].shown) changes++;
      }
    }
    return { share: shown / n, low, changes, minutes: n * 0.25 / 60 };
  };
  const out = { id: s.id, group: groupOf(s), split: s.split, base: summarize(base), cells: {} };
  for (const c of cells) {
    const runs = PH.map((ph) => simulate(s, variantFor(c), ph).samples);
    // (d): a reading only where the baseline shows one, with the same eta
    // newShown (reported, not the bar): shown where the baseline shows nothing at all
    let newer = 0, hid = 0, newShown = 0;
    runs.forEach((sm, p) => sm.forEach((x, i) => {
      const b = base[p][i];
      if (x.shown && !(b.shown && b.eta === x.eta)) newer++;
      if (x.shown && !b.shown) newShown++;
      if (b.shown && !x.shown && vis(x)) hid++;
    }));
    out.cells[c.name] = { ...summarize(runs), newer, hid, newShown };
  }
  return out;
}

function loadStreams(split) {
  const rows = [];
  for (const p of arg("runs", "").split(",")) for (const l of readFileSync(p, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const s = JSON.parse(l);
    if (s.split !== split || !groupOf(s)) continue;
    rows.push(s);
  }
  return rows;
}

// group summaries + the bar for one cell
function judge(results, cname, groupsPresent) {
  const G = {};
  for (const r of results) {
    const g = (G[r.group] ??= { n: 0, base: 0, cand: 0, lowBase: 0, lowCand: 0, chBase: 0, chCand: 0, min: 0, newer: 0, hid: 0, newShown: 0 });
    const c = r.cells[cname];
    g.n++; g.base += r.base.share; g.cand += c.share; g.lowBase += r.base.low; g.lowCand += c.low;
    g.chBase += r.base.changes; g.chCand += c.changes; g.min += r.base.minutes; g.newer += c.newer; g.hid += c.hid; g.newShown += c.newShown;
  }
  for (const g of Object.values(G)) { g.base = 100 * g.base / g.n; g.cand = 100 * g.cand / g.n; g.drop = g.base - g.cand; }
  const red = (k) => (G[k] && G[k].lowBase ? 100 * (1 - G[k].lowCand / G[k].lowBase) : null);
  const a = { W: red("w75.W"), M: red("w75.M") };
  const res = { a, pass: {} };
  res.pass.a = a.W !== null && a.M !== null && a.W >= 80 && a.M >= 80;
  const bG = B_GROUPS.filter((k) => groupsPresent.has(k)), cG = C_GROUPS.filter((k) => groupsPresent.has(k));
  res.bMaxDrop = Math.max(...bG.map((k) => G[k].drop));
  res.pass.b = bG.every((k) => G[k].drop <= 2.0);
  res.pass.c = cG.every((k) => Math.abs(G[k].drop) <= 0.5);
  res.pass.d = Object.values(G).every((g) => g.newer === 0);
  res.ok = res.pass.a && res.pass.b && res.pass.c && res.pass.d;
  res.G = G;
  return res;
}

function printCell(cname, j) {
  const f = (x) => (x === null ? "n/a" : x.toFixed(1));
  console.log(`${cname.padEnd(16)} (a) W ${f(j.a.W)} % M ${f(j.a.M)} % | (b) max drop ${j.bMaxDrop.toFixed(2)} | ${Object.entries(j.pass).map(([k, v]) => `${k}:${v ? "ok" : "FAIL"}`).join(" ")} => ${j.ok ? "ELIGIBLE" : "no"}`);
}
function printGroups(j) {
  console.log("  group      streams  shown % base -> cand (drop)  below-81 shown base -> cand  changes/min base -> cand  hidden samples  new readings (d) / shown where base shows none");
  for (const [k, g] of Object.entries(j.G).sort()) {
    console.log(`  ${k.padEnd(10)} ${String(g.n).padStart(4)}   ${g.base.toFixed(2)} -> ${g.cand.toFixed(2)} (${g.drop.toFixed(2)})   ${g.lowBase} -> ${g.lowCand}   ${(g.chBase / g.min).toFixed(2)} -> ${(g.chCand / g.min).toFixed(2)}   ${g.hid}   ${g.newer} / ${g.newShown}`);
  }
}

// ---------------------------------------------------------------- main
const OUT = arg("out", ".");
const SPLIT = arg("split", "");
if (SPLIT !== "dev" && SPLIT !== "test") throw new Error("--split=dev|test");
mkdirSync(OUT, { recursive: true });
const SEL = path.join(OUT, "selection.json");
if (SPLIT === "dev") {
  if (existsSync(SEL)) throw new Error(`${SEL} exists: the dev selection is written once`);
  const streams = loadStreams("dev");
  const results = streams.map((s) => evalStream(s, CELLS));
  const present = new Set(results.map((r) => r.group));
  const J = CELLS.map((c) => ({ c, j: judge(results, c.name, present) }));
  console.log(`dev: ${streams.length} streams; groups ${[...present].sort().join(", ")}`);
  for (const { c, j } of J) printCell(c.name, j);
  for (const { c, j } of J) { console.log(`
${c.name}`); printGroups(j); }
  const elig = J.filter((x) => x.j.ok);
  let pick = null;
  if (elig.length) {
    const minA = (x) => Math.min(x.j.a.W, x.j.a.M);
    const best = Math.max(...elig.map(minA));
    const near = elig.filter((x) => minA(x) >= best - 2);
    near.sort((x, y) => x.j.bMaxDrop - y.j.bMaxDrop || (x.c.fam === y.c.fam ? 0 : x.c.fam === "L1" ? -1 : 1) || (x.c.T ?? x.c.M) - (y.c.T ?? y.c.M) || (x.c.q ?? x.c.V) - (y.c.q ?? y.c.V));
    pick = near[0].c;
  }
  writeFileSync(SEL, JSON.stringify({ written: new Date().toISOString(), pick, eligible: elig.map((x) => x.c.name), dev: Object.fromEntries(J.map(({ c, j }) => [c.name, { a: j.a, bMaxDrop: j.bMaxDrop, pass: j.pass, G: j.G }])) }, null, 1));
  console.log(pick ? `\nPICK: ${pick.name}` : "\nno eligible cell: FAIL");
  if (pick) printGroups(J.find((x) => x.c.name === pick.name).j);
} else {
  const sel = JSON.parse(readFileSync(SEL, "utf8"));
  if (!sel.pick) throw new Error("selection.json names no pick");
  const HO = path.join(OUT, "heldout.json");
  if (existsSync(HO)) throw new Error(`${HO} exists: the held-out look is taken once`);
  const streams = loadStreams("test");
  const results = streams.map((s) => evalStream(s, [sel.pick]));
  const present = new Set(results.map((r) => r.group));
  const j = judge(results, sel.pick.name, present);
  writeFileSync(HO, JSON.stringify({ written: new Date().toISOString(), pick: sel.pick, a: j.a, pass: j.pass, ok: j.ok, G: j.G }, null, 1));
  console.log(`held-out: ${streams.length} streams; groups ${[...present].sort().join(", ")}`);
  printCell(sel.pick.name, j);
  printGroups(j);
  console.log(j.ok ? "VERDICT: PASS" : "VERDICT: FAIL");
}
