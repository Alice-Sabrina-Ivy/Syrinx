// faster-eval.mjs — score the pre-registered candidates of the resonance
// responsiveness study (measurements/resonance-faster-prereg-2026-10-26.md).
//
//   node scripts/resonance/faster-eval.mjs --runs=<bins jsonl,...> [--trail-runs=B-t70:<jsonl,...>;B-t50:<...>]
//        [--cands=all|S0,R-...] [--posted=S0|E-ewm2.5] [--json=<out.json>] [--budget]
//
// Cue-only candidates are replayed over the logged bins of each stream
// (faster.mjs bins): admitted flags and the cue's voiced clock (dropped bins'
// voiced time taken out) exactly as resonanceCue.js, the bin count at each
// 0.2 s post. The replay of the candidate the runs' code shipped (--posted,
// default S0; E-ewm2.5 for runs of the code since 2026-10-26) must equal the
// logged posted u on every post (checked; the run aborts otherwise). Bin-level candidates (B-*) read the
// posted u of their own bins run. Row: cueStripModel.js on each post.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const CS = await imp("src/components/cueStripModel.js");
const { VTLN_CLAMP_EDGE } = await imp("src/resonance/resonanceCue.js");
const { CANDIDATES, FAMILY_ORDER } = await imp("scripts/resonance/faster-candidates.mjs");
const REF = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8")).vtln;
const GAP = REF.womenMedian - REF.menMedian;
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const WORDS = new Set(["about where you started", "brighter than your start", "darker than your start"]);
const CHS = 0.025, SEGS = 18;
const readJsonl = (list) => list.split(",").filter(Boolean).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

const recs = readJsonl(arg("runs", ""));
const byId = new Map(recs.map((r) => [r.id, r]));
for (const r of recs) if (r.nbResets.length) throw new Error(`${r.id}: narrowband turned on (not handled)`);
const trailRuns = Object.fromEntries(arg("trail-runs", "").split(";").filter(Boolean).map((s) => { const [n, f] = s.split(":"); return [n, new Map(readJsonl(f).map((r) => [r.id, r]))]; }));
let cands = arg("cands", "all") === "all" ? Object.keys(CANDIDATES) : arg("cands", "").split(",");
cands = [...cands, ...Object.keys(trailRuns)];

// ---- per stream, per candidate: the post series
const P_ = { k: 0, c: 1, u: 2, raw: 3, uPlain: 4, shownStartU: 5, startU: 6, fill: 7, voicedS: 8, verdict: 9, since: 10, nbOn: 11, nbDec: 12, voiced: 13, holding: 14 };
function rowOf(p, u, raw) {
  const snap = { u, raw, fill: p[P_.fill], voicedS: p[P_.voicedS], verdict: VERD[p[P_.verdict]], sinceResumeS: p[P_.since],
    narrowband: { on: !!p[P_.nbOn], decided: !!p[P_.nbDec] }, shownStartU: p[P_.shownStartU], startU: p[P_.startU] };
  const state = CS.resonanceRowState({ workerStatus: "ready", snap, voiced: !!p[P_.voiced], holding: !!p[P_.holding] });
  const drawn = CS.dotOpacity(state) !== null && u != null;
  return { state, drawn, hdr: CS.resonanceHeader(state, snap) };
}
let replayMs = {};
function replay(rec, name) {
  const t0 = performance.now();
  const ro = CANDIDATES[name].make(REF);
  const out = [];
  let bi = 0, last = null, dropped = 0;
  for (const p of rec.posts) {
    while (bi < p[P_.c]) {
      const [, stamp, v, adm] = rec.bins[bi++];
      const delta = last === null ? 0 : Math.max(0, stamp - last);
      last = stamp;
      if (!adm) dropped += delta;
      else ro.add(stamp - dropped, v);
    }
    const s = ro.snapshot();
    const dec = !!p[P_.nbDec];
    out.push({ u: dec ? s.u : null, raw: dec ? s.raw : null, restarts: s.restarts ?? 0 });
  }
  replayMs[name] = (replayMs[name] ?? 0) + performance.now() - t0;
  return out;
}
const cache = new Map();
function series(id, name) {
  const key = `${id}|${name}`;
  if (cache.has(key)) return cache.get(key);
  let rec = byId.get(id), vals;
  if (trailRuns[name]) {
    rec = trailRuns[name].get(id);
    if (!rec) throw new Error(`${name}: ${id} missing`);
    vals = rec.posts.map((p) => ({ u: p[P_.u], raw: p[P_.raw], restarts: 0 }));
  } else vals = replay(rec, name);
  const s = rec.posts.map((p, i) => {
    const { u, raw } = vals[i];
    const row = rowOf(p, u, raw);
    return { k: p[P_.k], t: (p[P_.k] + 1) * CHS, u, raw, uPlain: p[P_.uPlain], ...row, restarts: vals[i].restarts };
  });
  cache.set(key, s);
  return s;
}

// exactness: the posted candidate's replay == posted u; R-s1.5-j0.6-n4 == S0
const POSTED = arg("posted", "S0");
let exN = 0, exBad = 0, rN = 0, rBad = 0;
for (const r of recs) {
  const s = series(r.id, "S0"), sp = series(r.id, POSTED);
  r.posts.forEach((p, i) => { exN++; if (sp[i].u !== p[P_.u]) exBad++; });
  if (CANDIDATES["R-s1.5-j0.6-n4"]) { const s2 = series(r.id, "R-s1.5-j0.6-n4"); s.forEach((x, i) => { rN++; if (x.u !== s2[i].u) rBad++; }); }
}
console.log(`exactness: ${POSTED} replay = posted u on ${exN - exBad}/${exN} posts; R-s1.5-j0.6-n4 = S0 on ${rN - rBad}/${rN}`);
if (exBad) throw new Error(`${POSTED} replay differs from the posted u`);
const wk = recs.filter((r) => r.worker);
if (wk.length) console.log(`real worker = replica: ${wk.reduce((a, r) => a + r.worker.checked - r.worker.mismatch, 0)}/${wk.reduce((a, r) => a + r.worker.checked, 0)} posts (${wk.length} streams)`);

// ---- events
const events = [];
for (const r of recs.filter((x) => x.kind === "sw")) {
  const [A, B] = r.seq;
  const size = B.startsWith("U05") || B.startsWith("D05") ? 0.5 : 1.0;
  const mode = B.endsWith("m") ? "moves" : "kept";
  const up1 = B.startsWith("U");
  events.push({ id: r.id, reader: r.reader, sex: r.sex, size, mode, dir: up1 ? "up" : "down", tj: r.joins[0], old: `${r.reader}__${A}`, nw: `${r.reader}__${B}` });
  events.push({ id: r.id, reader: r.reader, sex: r.sex, size, mode, dir: up1 ? "down" : "up", tj: r.joins[1], old: `${r.reader}__${B}`, nw: `${r.reader}__${A}` });
}
function eventTimes(e, name) {
  const S = series(e.id, name), O = series(e.old, name), N = series(e.nw, name);
  let t50 = null, t90 = null;
  for (let i = 0; i < S.length; i++) {
    const x = S[i];
    if (x.t <= e.tj + 1e-9 || x.t > e.tj + SEGS + 1e-9) continue;
    if (O[i].k !== x.k || N[i].k !== x.k) throw new Error("post grids differ");
    if (!x.drawn || x.u == null || O[i].u == null || N[i].u == null || N[i].u === O[i].u) continue;
    const p = (x.u - O[i].u) / (N[i].u - O[i].u);
    if (t50 === null && p >= 0.5) t50 = x.t - e.tj;
    if (t90 === null && p >= 0.9) t90 = x.t - e.tj;
  }
  return { t50: t50 ?? SEGS, t90: t90 ?? SEGS, c50: t50 === null, c90: t90 === null };
}
const CELLS = [];
for (const size of [0.5, 1.0]) for (const dir of ["up", "down"]) for (const sex of ["m", "f"]) for (const T of ["t50", "t90"]) CELLS.push({ size, dir, sex, T });
function targets(name) {
  const per = events.map((e) => ({ e, ...eventTimes(e, name) }));
  const cells = CELLS.map((c) => {
    const xs = per.filter((x) => x.e.size === c.size && x.e.dir === c.dir && x.e.sex === c.sex);
    return { ...c, n: xs.length, med: med(xs.map((x) => x[c.T])), cens: xs.filter((x) => x[c.T === "t50" ? "c50" : "c90"]).length };
  });
  const byMode = {};
  for (const mode of ["kept", "moves"]) for (const dir of ["up", "down"]) for (const T of ["t50", "t90"]) {
    const xs = per.filter((x) => x.e.size === 1.0 && x.e.mode === mode && x.e.dir === dir);
    byMode[`${mode}-${dir}-${T}`] = med(xs.map((x) => x[T]));
  }
  return { cells, byMode };
}

// ---- guards on the long streams
const longs = recs.filter((r) => r.kind === "long");
function guards(name) {
  const out = {};
  for (const sex of ["m", "f"]) {
    const L = longs.filter((r) => r.sex === sex);
    const sds = [], errs = [], firsts = [], dus = [];
    let words = 0, falseW = 0, about = 0, live = 0, restarts = 0, durS = 0;
    for (const r of L) {
      const S = series(r.id, name);
      const lrVals = r.bins.filter((b) => b[3] && b[2] != null).map((b) => (b[2] - REF.menMedian) / GAP);
      const lr = med(lrVals);
      const drawnU = S.filter((x) => x.drawn).map((x) => x.u);
      sds.push(sd(drawnU));
      for (const u of drawnU) errs.push(Math.abs(u - lr));
      let prev = null;
      for (const x of S) { if (x.drawn) { if (prev !== null) dus.push(Math.abs(x.u - prev)); prev = x.u; } }
      const f = S.find((x) => x.drawn);
      firsts.push(f ? f.t : null);
      for (const x of S) {
        if ((x.state === "live" || x.state === "holding") && WORDS.has(x.hdr)) {
          words++;
          if (x.hdr !== "about where you started") falseW++;
          else about++;
        }
        if (x.state === "live" || x.state === "holding") live++;
      }
      restarts += S[S.length - 1].restarts;
      durS += r.n * CHS;
    }
    out[sex] = {
      jitterSD: med(sds), errMed: med(errs), errQ90: q(errs, 0.9), firstReading: med(firsts),
      falseWords: words ? (100 * falseW) / words : null, aboutShare: live ? (100 * about) / live : null,
      dUq90: q(dus, 0.9), restartsPerMin: restarts / (durS / 60),
    };
  }
  return out;
}
// G6 / G7: uPlain and drawn identical to S0 on every post of every stream
function identity(name) {
  let plain = 0, drawn = 0, n = 0;
  for (const r of recs) {
    const a = series(r.id, "S0"), b = series(r.id, name);
    for (let i = 0; i < a.length; i++) { n++; if (a[i].uPlain !== b[i].uPlain) plain++; if (a[i].drawn !== b[i].drawn) drawn++; }
  }
  return { n, plainDiff: plain, drawnDiff: drawn };
}

const res = {};
for (const name of cands) {
  res[name] = { targets: targets(name), guards: guards(name), identity: identity(name), family: trailRuns[name] ? "B" : CANDIDATES[name].family };
}
const base = res.S0;
for (const [name, R] of Object.entries(res)) {
  const ratios = R.targets.cells.map((c, i) => c.med / base.targets.cells[i].med);
  R.score = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const g = R.guards, b = base.guards;
  const pass = {};
  for (const sex of ["m", "f"]) {
    pass[`G1-${sex}`] = g[sex].jitterSD <= b[sex].jitterSD * 1.05;
    pass[`G2-${sex}`] = g[sex].falseWords <= b[sex].falseWords + 1.0;
    pass[`G3-${sex}`] = g[sex].errMed <= b[sex].errMed + 0.01 && g[sex].errQ90 <= b[sex].errQ90 + 0.01;
    pass[`G4-${sex}`] = g[sex].firstReading <= b[sex].firstReading + 0.05;
  }
  pass.G6 = R.identity.plainDiff === 0;
  pass.G7 = R.family === "B" ? true : R.identity.drawnDiff === 0;
  R.pass = pass;
  R.allPass = Object.values(pass).every(Boolean);
  R.restartsPerMin = (g.m.restartsPerMin + g.f.restartsPerMin) / 2;
}
// replay cost per audio second (the readout's own share; G5 adds it to the chain's)
const audioS = recs.reduce((a, r) => a + r.n * CHS, 0);
for (const name of Object.keys(replayMs)) if (res[name]) res[name].readoutMsPerAudioS = replayMs[name] / audioS;

const order = (n) => FAMILY_ORDER.indexOf(res[n].family);
const elig = Object.keys(res).filter((n) => n !== "S0" && n !== "P" && res[n].allPass && res[n].score <= 0.9);
elig.sort((a, b) => res[a].score - res[b].score);
let pick = null;
if (elig.length) {
  const best = res[elig[0]].score;
  const tie = elig.filter((n) => res[n].score <= best + 0.02);
  tie.sort((a, b) => res[a].restartsPerMin - res[b].restartsPerMin || order(a) - order(b));
  pick = tie[0];
}

// ---- print
const f2 = (x, d = 2) => (x == null ? "—" : x.toFixed(d));
const cellHdr = CELLS.map((c) => `${c.size}${c.dir === "up" ? "↑" : "↓"}${c.sex}${c.T.slice(1)}`);
console.log(`\n${events.length} events, ${longs.length} long streams`);
console.log(["cand", "score", ...cellHdr].join("\t"));
for (const [n, R] of Object.entries(res)) console.log([n, f2(R.score), ...R.targets.cells.map((c) => f2(c.med, 1) + (c.cens ? `(${c.cens}c)` : ""))].join("\t"));
console.log("\ncand\tG1 sd m/f\tG2 false% m/f\tG3 med m/f\tG3 q90 m/f\tG4 first m/f\tdU q90 m/f\tabout% m/f\trestarts/min m/f\tuPlain≠\tdrawn≠\tpass");
for (const [n, R] of Object.entries(res)) {
  const g = R.guards;
  console.log([n, `${f2(g.m.jitterSD, 3)}/${f2(g.f.jitterSD, 3)}`, `${f2(g.m.falseWords, 1)}/${f2(g.f.falseWords, 1)}`, `${f2(g.m.errMed, 3)}/${f2(g.f.errMed, 3)}`,
    `${f2(g.m.errQ90, 3)}/${f2(g.f.errQ90, 3)}`, `${f2(g.m.firstReading, 1)}/${f2(g.f.firstReading, 1)}`, `${f2(g.m.dUq90, 3)}/${f2(g.f.dUq90, 3)}`,
    `${f2(g.m.aboutShare, 1)}/${f2(g.f.aboutShare, 1)}`, `${f2(g.m.restartsPerMin)}/${f2(g.f.restartsPerMin)}`, R.identity.plainDiff, R.identity.drawnDiff,
    R.allPass ? "PASS" : Object.entries(R.pass).filter(([, v]) => !v).map(([k]) => k).join(",")].join("\t"));
}
console.log(`\neligible (all guards, score <= 0.90): ${elig.map((n) => `${n} ${f2(res[n].score)}`).join(", ") || "none"}`);
console.log(`pick: ${pick ?? "none"}`);
if (arg("json", "")) writeFileSync(arg("json", ""), JSON.stringify({ res, pick, elig, cellHdr, exactness: { exN, exBad, rN, rBad } }, null, 1));
