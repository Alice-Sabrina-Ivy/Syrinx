// candidates.mjs — the pre-registered bar of
// measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §6.2–6.3 for the
// candidates H1 / H2 / H3 and their combinations (analyze.mjs VARIANTS),
// each against the shipped panel on the same streams.
//
//   node candidates.mjs --runs=<run.0.jsonl,run.1.jsonl> --out=<dir> --split=dev
//       every candidate on the dev readers (LibriSpeech test-clean); applies the
//       selection rule and writes <dir>/selection.json (refuses to overwrite it)
//   node candidates.mjs --runs=… --out=<dir> --split=test --variant=<pick>
//       the pick ONCE on the held-out readers (dev-clean); refuses unless
//       <dir>/selection.json names <pick>; writes <dir>/heldout.<pick>.json
//
// Bar (per sex; a stream's time = the mean over the four 2 s-timer phases,
// "never" = no phase reaches it, medians count "never" as +inf):
//   (i)  natural readers, natural pauses (pnat): median first reading and
//        median informative reading (streams whose shipped settled reading is
//        informative) <= 0.7 x shipped; mean informative share > shipped.
//   (ii) WORLD 75 Hz pnat: streams with no reading <= floor(2/3 x shipped);
//        WORLD 90 Hz pnat: mean shown share >= shipped + 10 pp.
//   (iii, live) natural readers, all pause conditions pooled, 250 ms display
//        samples over the four phases: where both show a reading, mean
//        (eta candidate − eta shipped) within ±0.225 logit; readings only the
//        candidate shows: share informative on the other side of the stream's
//        settled eta <= the shipped shown readings' share + 2 pp.
//   (v)  continuous reading (p0): mean shown share >= shipped − 0.5 pp and
//        median first reading not later (reported on dev, judged on held-out).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { VARIANTS, simulate, settled, streamMetrics } from "./analyze.mjs";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = arg("out", ".");
const SPLIT = arg("split", "");
if (SPLIT !== "dev" && SPLIT !== "test") throw new Error("--split=dev|test");
mkdirSync(OUT, { recursive: true });
const SEL = path.join(OUT, "selection.json");

let names;
if (SPLIT === "dev") {
  if (existsSync(SEL)) throw new Error(`${SEL} exists: the selection is made once`);
  names = Object.keys(VARIANTS).filter((n) => n !== "shipped");
} else {
  const pick = arg("variant", "");
  if (!existsSync(SEL)) throw new Error("no selection.json: run --split=dev first");
  const sel = JSON.parse(readFileSync(SEL, "utf8"));
  if (!sel.pick || sel.pick !== pick) throw new Error(`selection.json picks ${sel.pick}, not ${pick}`);
  if (existsSync(path.join(OUT, `heldout.${pick}.json`))) throw new Error("the held-out run is made once");
  names = [pick];
}

const PH = [0, 500, 1000, 1500];
const PAUSES = ["p0", "p0.3", "p0.6", "p1.0", "p1.5", "p2.5", "pnat"];
const want = (s) => s.family === "libri" && s.split === SPLIT;

// ---- load the split's LibriSpeech streams
const streams = [];
for (const p of arg("runs", "").split(",")) {
  for (const l of readFileSync(p, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const s = JSON.parse(l);
    if (want(s)) streams.push(s);
  }
}
console.log(`${streams.length} ${SPLIT} streams; variants: ${names.join(", ")}`);

const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const tmed = (rs, k) => median(rs.map((r) => r[k] ?? Infinity));

// ---- per stream: summary metrics per variant + paired display samples
const M = { shipped: [] };
for (const n of names) M[n] = [];
const live = {}; // live[variant][sex] = { both: [d], onlyN, onlyOpp, onlyAbs: [], shipN, shipOpp, shipAbs: [] }
for (const n of names) live[n] = { f: null, m: null };
const L0 = () => ({ both: [], onlyN: 0, onlyOpp: 0, onlyAbs: [], shipN: 0, shipOpp: 0, shipAbs: [], lostN: 0 });
for (const n of names) { live[n].f = L0(); live[n].m = L0(); }

let k = 0;
for (const s of streams) {
  const base = streamMetrics(s, "shipped");
  M.shipped.push(base);
  for (const n of names) M[n].push(streamMetrics(s, n));
  if (s.voice === "nat" && PAUSES.includes(s.pause)) {
    const st = settled(s);
    const lead = s.leadMs ?? 1000, speechEnd = s.speechSpans[s.speechSpans.length - 1][1];
    const inVis = (x) => x.t >= lead && x.t <= speechEnd + 1000;
    const opp = (x) => st && x.shown && !x.wide && Math.sign(x.eta) !== Math.sign(st.eta);
    for (const ph of PH) {
      const a = simulate(s, VARIANTS.shipped, ph).samples;
      for (const n of names) {
        const b = simulate(s, VARIANTS[n], ph).samples;
        const L = live[n][s.sex];
        for (let i = 0; i < a.length; i++) {
          const x = a[i], y = b[i];
          if (x.t !== y.t) throw new Error("sample grids differ");
          if (!inVis(x)) continue;
          if (x.shown) { L.shipN++; if (opp(x)) L.shipOpp++; if (st) L.shipAbs.push(Math.abs(x.eta - st.eta)); }
          if (x.shown && y.shown) L.both.push(y.eta - x.eta);
          else if (y.shown) { L.onlyN++; if (opp(y)) L.onlyOpp++; if (st) L.onlyAbs.push(Math.abs(y.eta - st.eta)); }
          else if (x.shown) L.lostN++;
        }
      }
    }
  }
  if (++k % 50 === 0) console.log(`  ${k} / ${streams.length}`);
}

// ---- the bar
function bar(n) {
  const out = { variant: n, changes: VARIANTS[n].changes, sex: {} };
  for (const sx of ["f", "m"]) {
    const sel = (rows, voice, pause) => rows.filter((r) => r.sex === sx && r.voice === voice && r.pause === pause);
    const r = {};
    // (i)
    const bN = sel(M.shipped, "nat", "pnat"), cN = sel(M[n], "nat", "pnat");
    const infIds = new Set(bN.filter((x) => x.settled && !x.settled.wide).map((x) => x.id));
    r.i = {
      n: bN.length, nInfSettled: infIds.size,
      firstShipped: tmed(bN, "tFirst"), firstCand: tmed(cN, "tFirst"),
      infShipped: tmed(bN.filter((x) => infIds.has(x.id)), "tInf"), infCand: tmed(cN.filter((x) => infIds.has(x.id)), "tInf"),
      infShareShipped: mean(bN.map((x) => x.shareInf)), infShareCand: mean(cN.map((x) => x.shareInf)),
      shownShipped: mean(bN.map((x) => x.shareShown)), shownCand: mean(cN.map((x) => x.shareShown)),
      neverInfShipped: bN.filter((x) => infIds.has(x.id) && x.tInf === null).length,
      neverInfCand: cN.filter((x) => infIds.has(x.id) && x.tInf === null).length,
    };
    r.i.firstTarget = 0.7 * r.i.firstShipped; r.i.infTarget = 0.7 * r.i.infShipped;
    r.i.pass = r.i.firstCand <= r.i.firstTarget + 1e-9 && r.i.infCand <= r.i.infTarget + 1e-9 && r.i.infShareCand > r.i.infShareShipped;
    // (ii)
    const b75 = sel(M.shipped, "w75", "pnat"), c75 = sel(M[n], "w75", "pnat");
    const b90 = sel(M.shipped, "w90", "pnat"), c90 = sel(M[n], "w90", "pnat");
    r.ii = {
      never75Shipped: b75.filter((x) => x.tFirst === null).length, never75Cand: c75.filter((x) => x.tFirst === null).length, n75: b75.length,
      shown75Shipped: mean(b75.map((x) => x.shareShown)), shown75Cand: mean(c75.map((x) => x.shareShown)),
      first75Shipped: tmed(b75, "tFirst"), first75Cand: tmed(c75, "tFirst"),
      shown90Shipped: mean(b90.map((x) => x.shareShown)), shown90Cand: mean(c90.map((x) => x.shareShown)),
      first90Shipped: tmed(b90, "tFirst"), first90Cand: tmed(c90, "tFirst"),
    };
    r.ii.never75Target = Math.floor((2 / 3) * r.ii.never75Shipped + 1e-9);
    r.ii.pass = r.ii.never75Cand <= r.ii.never75Target && r.ii.shown90Cand >= r.ii.shown90Shipped + 0.10 - 1e-12;
    // (iii) live
    const L = live[n][sx];
    r.iii = {
      bothN: L.both.length, meanDiff: mean(L.both), maxAbsDiff: L.both.reduce((a, d) => Math.max(a, Math.abs(d)), 0),
      shareBothChanged: L.both.filter((d) => Math.abs(d) > 1e-12).length / Math.max(1, L.both.length),
      onlyN: L.onlyN, onlyOppShare: L.onlyN ? L.onlyOpp / L.onlyN : 0, shipN: L.shipN, shipOppShare: L.shipOpp / Math.max(1, L.shipN),
      onlyAbsMean: mean(L.onlyAbs), shipAbsMean: mean(L.shipAbs), lostN: L.lostN,
    };
    r.iii.pass = Math.abs(r.iii.meanDiff ?? 0) <= 0.225 && r.iii.onlyOppShare <= r.iii.shipOppShare + 0.02 + 1e-12;
    // (v)
    const b0 = sel(M.shipped, "nat", "p0"), c0 = sel(M[n], "nat", "p0");
    r.v = {
      shownShipped: mean(b0.map((x) => x.shareShown)), shownCand: mean(c0.map((x) => x.shareShown)),
      firstShipped: tmed(b0, "tFirst"), firstCand: tmed(c0, "tFirst"),
    };
    r.v.pass = r.v.shownCand >= r.v.shownShipped - 0.005 - 1e-12 && r.v.firstCand <= r.v.firstShipped + 1e-9;
    // every pause condition + WORLD (reported)
    r.other = {};
    for (const [voice, pause] of [...PAUSES.map((p) => ["nat", p]), ["w75", "p0"], ["w75", "pnat"], ["w90", "p0"], ["w90", "pnat"], ["w185", "p0"], ["w185", "pnat"], ["w1", "pnat"]]) {
      const b = sel(M.shipped, voice, pause), c = sel(M[n], voice, pause);
      if (!b.length) continue;
      r.other[`${voice}/${pause}`] = {
        n: b.length,
        first: [tmed(b, "tFirst"), tmed(c, "tFirst")], inf: [tmed(b, "tInf"), tmed(c, "tInf")],
        never: [b.filter((x) => x.tFirst === null).length, c.filter((x) => x.tFirst === null).length],
        shown: [mean(b.map((x) => x.shareShown)), mean(c.map((x) => x.shareShown))],
        informative: [mean(b.map((x) => x.shareInf)), mean(c.map((x) => x.shareInf))],
        cantTell: [mean(b.map((x) => x.shareShown - x.shareInf)), mean(c.map((x) => x.shareShown - x.shareInf))],
        shownAfterFirst: [mean(b.map((x) => x.shareShownAfterFirst).filter((v) => v !== null)), mean(c.map((x) => x.shareShownAfterFirst).filter((v) => v !== null))],
      };
    }
    // update stream the pitch-only warning sees (2 s updates, phase 0): shown updates per min, first shown update
    const upd = (rows) => {
      let shownU = 0, mins = 0; const firsts = [];
      for (const x of rows) { shownU += x.updates.filter((u) => u.shown).length; mins += x.spanS / 60; const f = x.updates.find((u) => u.shown); firsts.push(f ? f.t / 1000 : Infinity); }
      return { shownPerMin: shownU / mins, firstShownUpdate: median(firsts) };
    };
    r.warningFeed = { shipped: upd(bN), cand: upd(cN) };
    r.improveInf = r.i.infShipped - r.i.infCand;
    r.eligible = r.i.pass && r.ii.pass && r.iii.pass;
    out.sex[sx] = r;
  }
  out.eligible = out.sex.f.eligible && out.sex.m.eligible;
  out.minImproveInf = Math.min(out.sex.f.improveInf, out.sex.m.improveInf);
  return out;
}

const res = names.map(bar);
const f2 = (x) => x === null || x === undefined ? "—" : !Number.isFinite(x) ? "never" : x.toFixed(2);
const pc = (x) => x === null || x === undefined ? "—" : (100 * x).toFixed(1);
for (const r of res) {
  console.log(`\n== ${r.variant} (changes ${r.changes}) eligible=${r.eligible} (dev selection uses i, ii, iii)`);
  for (const sx of ["f", "m"]) {
    const q = r.sex[sx];
    console.log(`  ${sx === "f" ? "W" : "M"}  (i) first ${f2(q.i.firstShipped)} -> ${f2(q.i.firstCand)} (<= ${f2(q.i.firstTarget)}); informative ${f2(q.i.infShipped)} -> ${f2(q.i.infCand)} (<= ${f2(q.i.infTarget)}); inf share ${pc(q.i.infShareShipped)} -> ${pc(q.i.infShareCand)}  ${q.i.pass ? "PASS" : "FAIL"}`);
    console.log(`     (ii) 75 Hz never ${q.ii.never75Shipped} -> ${q.ii.never75Cand} (<= ${q.ii.never75Target}); 90 Hz shown ${pc(q.ii.shown90Shipped)} -> ${pc(q.ii.shown90Cand)} (>= ${pc(q.ii.shown90Shipped + 0.1)})  ${q.ii.pass ? "PASS" : "FAIL"}`);
    console.log(`     (iii) both ${q.iii.bothN}: mean d eta ${q.iii.meanDiff?.toFixed(4)} (max |d| ${q.iii.maxAbsDiff.toFixed(3)}); only-candidate ${q.iii.onlyN}: opposite ${pc(q.iii.onlyOppShare)} vs shipped ${pc(q.iii.shipOppShare)} (+2); |eta-settled| ${f2(q.iii.onlyAbsMean)} vs ${f2(q.iii.shipAbsMean)}  ${q.iii.pass ? "PASS" : "FAIL"}`);
    console.log(`     (v) p0 shown ${pc(q.v.shownShipped)} -> ${pc(q.v.shownCand)}; first ${f2(q.v.firstShipped)} -> ${f2(q.v.firstCand)}  ${q.v.pass ? "PASS" : "FAIL"}`);
  }
}

if (SPLIT === "dev") {
  const elig = res.filter((r) => r.eligible);
  elig.sort((a, b) => a.changes - b.changes || b.minImproveInf - a.minImproveInf);
  const pick = elig.length ? elig[0].variant : null;
  const sel = {
    rule: "measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §6.2: eligible = (i), (ii) and the live parts of (iii) pass on dev for women and men; fewest changes; ties -> larger min-over-sexes improvement in median time to an informative reading",
    madeAt: new Date().toISOString(), split: "dev (LibriSpeech test-clean)", pick,
    eligible: elig.map((r) => r.variant), results: res,
  };
  writeFileSync(SEL, JSON.stringify(sel, null, 1));
  console.log(`\nselection: ${pick ?? "none eligible"} -> ${SEL}`);
} else {
  writeFileSync(path.join(OUT, `heldout.${names[0]}.json`), JSON.stringify({ madeAt: new Date().toISOString(), split: "test (LibriSpeech dev-clean, held-out)", results: res }, null, 1));
  console.log(`\nheld-out -> ${path.join(OUT, `heldout.${names[0]}.json`)}`);
}
