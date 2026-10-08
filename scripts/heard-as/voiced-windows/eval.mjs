// eval.mjs — metrics of measurements/heard-as-voiced-windows-2026-10-08.md
// from run.mjs outputs.
//
//   node eval.mjs --runs=<run.0.jsonl,run.1.jsonl> --pov=<pov_stimuli.csv> --out=<dir> --phase=select|all
//
// select: dev-talker whisper logit share (B1) of every variant + the classified
//         windows each variant excludes on the dev-clean readers -> <out>/selection.json
//         (written before any guard number is computed).
// all:    every pre-registered number (Part A, B1/B2, G1-G5, the descriptive
//         tables) for the head, every variant and the selection -> <out>/results.json
//         + a text report on stdout.
// Live panel = src/ml/heard-as.js + the shipped constants, updates every 2 s
// of audio, the 250 ms held-note check, display sampled every 250 ms
// (scripts/heard-as/hop-study.mjs convention).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { createHeardAsAggregator, heardAsShares, isWideShare, ML_WINDOW_MS } = await import(pathToFileURL(path.join(repo, "src/ml/heard-as.js")).href);
const { HEARD_AS_CALIBRATION: C } = await import(pathToFileURL(path.join(repo, "src/ml/heardAsCalibration.js")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = arg("out", "."), PHASE = arg("phase", "all");
mkdirSync(OUT, { recursive: true });

export const VARIANTS = {
  head: {},
  V25: { logitMinVoicedMs: 25 }, V100: { logitMinVoicedMs: 100 }, V200: { logitMinVoicedMs: 200 },
  R75: { logitMinRunMs: 75 }, R150: { logitMinRunMs: 150 },
};
const CAND = ["V25", "V100", "V200", "R75", "R150"];
// the pre-registered tie order: V before R, then the smaller threshold
const ORDER = ["V25", "V100", "V200", "R75", "R150"];

const streams = [];
for (const p of arg("runs", "").split(",")) for (const l of readFileSync(p, "utf8").split("\n")) if (l.trim()) streams.push(JSON.parse(l));
const by = (set) => streams.filter((s) => s.set === set);

// --- the rule, mirrored (checked against heard-as.js on every shown update) ---
function qualifies(frames, endMs, v) {
  const minV = v.logitMinVoicedMs ?? 0, minR = v.logitMinRunMs ?? 0;
  if (!(minV > 0) && !(minR > 0)) return true;
  let voiced = 0, run = 0, best = 0, first = true;
  for (const f of frames) {
    if (f.ms < endMs - ML_WINDOW_MS) continue;
    if (f.ms > endMs) break;
    if (f.f0 > 0) { voiced += f.dt; run = !first && f.gap <= 100 ? run + f.dt : f.dt; if (run > best) best = run; } else run = 0;
    first = false;
  }
  return voiced >= minV && best >= minR;
}
function framesOf(s) {
  let last = null;
  return s.pitch.map(([ms, f0]) => { const gap = last === null ? 25 : Math.max(ms - last, 0); last = ms; return { ms, f0: f0 > 0 ? f0 : 0, dt: Math.min(gap, 100), gap }; });
}

/** Live panel on one stream / arm / variant -> { samples: [{ t, update, shown, reason, s, eta, wide, pooled, pooledW }] } */
function simulate(s, arm, vname, { whisperSpans = null } = {}) {
  const v = VARIANTS[vname];
  const agg = createHeardAsAggregator(v);
  const A = s.arms[arm];
  const frames = framesOf(s);
  const ev = [];
  for (const [ms, f0] of s.pitch) ev.push([ms, 0, f0]);
  for (const w of A.windows) ev.push([w[0], 1, w]);
  for (const t of A.ticks) ev.push([t[0], 2, t[1]]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const endMs = s.durS * 1000;
  const isWhisper = (endW) => {
    if (!whisperSpans) return false;
    let inside = 0;
    for (const [a, b] of whisperSpans) inside += Math.max(0, Math.min(b, endW) - Math.max(a, endW - ML_WINDOW_MS));
    return inside >= 0.9 * ML_WINDOW_MS;
  };
  let k = 0, voiceState = null, cur = { shown: false, reason: "listening" };
  const samples = [];
  for (let now = 250; now <= endMs + 1e-6; now += 250) {
    while (k < ev.length && ev[k][0] <= now) {
      const [ms, type, x] = ev[k++];
      if (type === 0) agg.addPitch({ audioMs: ms, f0: x });
      else if (type === 1) agg.addWindow({ audioMs: ms, logit: x[2] ? s.logits[ms] : null, mode: x[1], classified: !!x[2] });
      else voiceState = x;
    }
    const update = now % C.updateMs === 0;
    if (update || (cur.shown && voiceState === "sustained")) {
      const e = agg.estimate(now, voiceState);
      if (e.hidden) cur = { shown: false, reason: e.hidden };
      else {
        const sh = heardAsShares(e.meterLogit, e.lnF0);
        // the pooled logits, independently: classified windows in (now - 8 s, now] that qualify
        let sum = 0, n = 0, nW = 0;
        for (const w of A.windows) {
          if (!w[2] || w[1] !== "gated" || w[0] <= now - C.windowMs || w[0] > now) continue;
          if (!qualifies(frames, w[0], v)) continue; // frames after the window end are never read
          sum += s.logits[w[0]]; n++; if (isWhisper(w[0])) nW++;
        }
        if (Math.abs(sum / n - e.meterLogit) > 1e-9) throw new Error(`${s.id} ${arm} ${vname} t=${now}: pooled mean ${sum / n} != meterLogit ${e.meterLogit}`);
        cur = { shown: true, reason: "", s: sh.s, eta: sh.eta, wide: isWideShare([sh.sLow, sh.sHigh]), pooled: n, pooledW: nW };
      }
    }
    samples.push({ t: now, update, ...cur });
  }
  return samples;
}

/** Whole-stimulus aggregate (Palette) */
function wholeStimulus(s, arm, vname) {
  const agg = createHeardAsAggregator({ windowMs: Infinity, minVoicedMs: 0, minWindows: 0, ...VARIANTS[vname] });
  for (const [ms, f0] of s.pitch) agg.addPitch({ audioMs: ms, f0 });
  for (const w of s.arms[arm].windows) agg.addWindow({ audioMs: w[0], logit: w[2] ? s.logits[w[0]] : null, mode: w[1], classified: !!w[2] });
  const g = agg.aggregate(Infinity);
  if (g.meterLogit === null || g.lnF0 === null) return null;
  const sh = heardAsShares(g.meterLogit, g.lnF0);
  return { s: 100 * sh.s, eta: sh.eta, nClassified: g.nClassified };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
const pct = (num, den) => (den ? (100 * num) / den : NaN);
const SEXES = ["f", "m"];

// ---------- B1: whisper logit share ----------
function whisperShare(vname, filt) {
  const out = {};
  for (const sex of SEXES) {
    let pooled = 0, pooledW = 0, updates = 0;
    for (const s of by("whis").filter((x) => x.sex === sex && filt(x))) {
      for (const q of simulate(s, "S", vname, { whisperSpans: s.whisper })) {
        if (!q.update || !q.shown) continue;
        updates++; pooled += q.pooled; pooledW += q.pooledW;
      }
    }
    out[sex] = { share: pct(pooledW, pooled), pooled, pooledW, updates };
  }
  return out;
}
// classified windows a variant excludes over whole streams (the selection's tie-break)
function excluded(vname, set) {
  let n = 0, tot = 0;
  for (const s of by(set)) {
    const frames = framesOf(s);
    for (const w of s.arms.S.windows) if (w[2] && w[1] === "gated") { tot++; if (!qualifies(frames, w[0], VARIANTS[vname])) n++; }
  }
  return { excluded: n, classified: tot };
}

const unph = (x) => !x.phonated;
const sel = {};
for (const v of ["head", ...CAND]) sel[v] = { devB1: whisperShare(v, (x) => unph(x) && x.split === "dev"), r1devExcluded: v === "head" ? { excluded: 0 } : excluded(v, "r1dev") };
const ok = CAND.filter((v) => sel[v].devB1.f.share <= 5 && sel[v].devB1.m.share <= 5);
let selected;
if (ok.length) selected = [...ok].sort((a, b) => sel[a].r1devExcluded.excluded - sel[b].r1devExcluded.excluded || ORDER.indexOf(a) - ORDER.indexOf(b))[0];
else selected = [...CAND].sort((a, b) => Math.max(sel[a].devB1.f.share, sel[a].devB1.m.share) - Math.max(sel[b].devB1.f.share, sel[b].devB1.m.share) || ORDER.indexOf(a) - ORDER.indexOf(b))[0];
const selPath = path.join(OUT, "selection.json");
if (PHASE === "select" || !existsSync(selPath)) {
  writeFileSync(selPath, JSON.stringify({ written: new Date().toISOString(), qualifying: ok, selected, table: sel }, null, 1));
  console.log("dev B1 (unphonated dev talkers; % of pooled logits from whisper windows) and dev-clean classified windows excluded:");
  for (const v of ["head", ...CAND]) console.log(`  ${v.padEnd(5)} W ${sel[v].devB1.f.share.toFixed(2)} % (${sel[v].devB1.f.updates} upd)  M ${sel[v].devB1.m.share.toFixed(2)} % (${sel[v].devB1.m.updates} upd)  excluded ${sel[v].r1devExcluded.excluded}`);
  console.log(`qualifying: ${ok.join(", ") || "none"}; SELECTED: ${selected} -> ${selPath}`);
  if (PHASE === "select") process.exit(0);
}
const SELECTED = JSON.parse(readFileSync(selPath, "utf8")).selected;

// ---------- everything ----------
const R = { selected: SELECTED, B1: {}, B1test: {}, B1phon: {}, B2: {}, readers: {}, partA: {}, pov: {}, chanx: {}, palone: {}, synth: {} };
for (const v of ["head", ...CAND]) {
  R.B1[v] = whisperShare(v, unph);
  R.B1test[v] = whisperShare(v, (x) => unph(x) && x.split === "test");
  R.B1phon[v] = whisperShare(v, (x) => x.phonated);
}
// B2: paired arms
for (const v of ["head", ...CAND]) {
  R.B2[v] = {};
  for (const sex of SEXES) {
    const d = []; let shW = 0, shS = 0, nW = 0, nS = 0;
    for (const s of by("whis").filter((x) => x.sex === sex && unph(x))) {
      const sil = streams.find((x) => x.id === `whissil.${s.speaker}`);
      const a = simulate(s, "S", v), b = simulate(sil, "S", v);
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        nW++; nS++; shW += a[i].shown; shS += b[i].shown;
        if (a[i].update && a[i].shown && b[i].shown) d.push(100 * Math.abs(a[i].s - b[i].s));
      }
    }
    R.B2[v][sex] = { meanAbsDs: mean(d), n: d.length, shownWhisper: pct(shW, nW), shownSilence: pct(shS, nS) };
  }
}
// readers: shown share, first estimate, can't tell yet; Part A (S vs P); G2 (variant vs head)
function readerStats(set, arm, v) {
  const res = {};
  for (const sex of SEXES) {
    let sh = 0, n = 0, wide = 0; const first = [];
    for (const s of by(set).filter((x) => x.sex === sex)) {
      const q = simulate(s, arm, v);
      const f = q.find((x) => x.shown); first.push(f ? f.t / 1000 : s.durS);
      for (const x of q) { n++; if (x.shown) { sh++; if (x.wide) wide++; } }
    }
    res[sex] = { shown: pct(sh, n), cantTell: pct(wide, sh), firstMedianS: median(first) };
  }
  return res;
}
function pairedUpdates(set, armA, vA, armB, vB, f) {
  const res = {};
  for (const sex of SEXES) {
    const d = [];
    for (const s of by(set).filter((x) => x.sex === sex)) {
      const a = simulate(s, armA, vA), b = simulate(s, armB, vB);
      for (let i = 0; i < a.length; i++) if (a[i].update && a[i].shown && b[i].shown) d.push(f(a[i], b[i]));
    }
    res[sex] = { mean: mean(d), n: d.length };
  }
  return res;
}
for (const set of ["r1dev", "r1"]) {
  R.readers[set] = { P: readerStats(set, "P", "head") };
  for (const v of ["head", ...CAND]) R.readers[set][v] = readerStats(set, "S", v);
  R.partA[set] = { dEtaSminusP: pairedUpdates(set, "S", "head", "P", "head", (a, b) => a.eta - b.eta) };
  R.partA[set].dEtaSelMinusP = pairedUpdates(set, "S", SELECTED, "P", "head", (a, b) => a.eta - b.eta);
  for (const v of CAND) R.readers[set][`${v}_dsVsHead`] = pairedUpdates(set, "S", v, "S", "head", (a, b) => 100 * Math.abs(a.s - b.s));
}
// Palette
const rows = {};
{
  const lines = readFileSync(arg("pov", ""), "utf8").split(/\r?\n/).filter(Boolean);
  const hdr = lines[0].split(",");
  for (const l of lines.slice(1)) { const c = l.split(","); const r = Object.fromEntries(hdr.map((h, i) => [h, c[i]])); rows[r.key] = 100 * (Number(r["ALL-Man"]) / 100 + 0.5 * (Number(r["ALL-OtherGender"]) + Number(r["ALL-no"])) / 100); }
}
function povCompare(armA, vA, armB, vB) {
  const res = {};
  for (const grp of ["all", "man", "woman"]) {
    const d = [], eA = [], eB = []; let lostA = 0, lostB = 0, n = 0;
    for (const s of by("pov")) {
      const y = rows[s.key];
      const g = y >= 50 ? "man" : "woman";
      if (grp !== "all" && g !== grp) continue;
      n++;
      const a = wholeStimulus(s, armA, vA), b = wholeStimulus(s, armB, vB);
      if (!a) lostA++; if (!b) lostB++;
      if (!a || !b) continue;
      d.push(Math.abs(a.s - b.s)); eA.push(Math.abs(a.s - y)); eB.push(Math.abs(b.s - y));
    }
    res[grp] = { n, mae: mean(d), errA: mean(eA), errB: mean(eB), lostA, lostB };
  }
  return res;
}
R.pov.SvsP = povCompare("S", "head", "P", "head");
for (const v of CAND) R.pov[`${v}vsHead`] = povCompare("S", v, "S", "head");
R.pov.selVsP = povCompare("S", SELECTED, "P", "head");
// chanx: per condition per sex, samples from 3 s after onset to 1 s after the end
const conds = [...new Set(by("chanx").map((s) => s.cond))];
for (const v of ["head", ...CAND]) {
  R.chanx[v] = {};
  for (const c of conds) {
    R.chanx[v][c] = {};
    for (const sex of SEXES) {
      let sh = 0, n = 0;
      for (const s of by("chanx").filter((x) => x.cond === c && x.sex === sex)) {
        const lo = (s.lead_s + 3) * 1000, hi = (s.lead_s + s.voice_s + 1) * 1000;
        for (const q of simulate(s, "S", v)) if (q.t >= lo && q.t <= hi) { n++; sh += q.shown; }
      }
      R.chanx[v][c][sex] = pct(sh, n);
    }
  }
}
// music alone
for (const v of ["head", ...CAND]) {
  R.palone[v] = {};
  for (const s of by("palone")) {
    const q = simulate(s, "S", v);
    const key = `${s.kind}${s.db}`;
    (R.palone[v][key] ??= []).push(pct(q.filter((x) => x.shown).length, q.length));
  }
}
// synthetic hide rules: identical state + reason at every sample (and P for reference)
for (const v of CAND) {
  R.synth[v] = {};
  for (const s of by("synth")) {
    const a = simulate(s, "S", "head"), b = simulate(s, "S", v);
    R.synth[v][s.id] = a.every((x, i) => x.shown === b[i].shown && x.reason === b[i].reason) ? "identical" : "DIFFERENT";
  }
}
R.synth.headStates = Object.fromEntries(by("synth").map((s) => [s.id, [...new Set(simulate(s, "S", "head").map((x) => (x.shown ? "shown" : x.reason)))]]));
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(R, null, 1));
console.log(`-> ${path.join(OUT, "results.json")} (selected ${SELECTED})`);
