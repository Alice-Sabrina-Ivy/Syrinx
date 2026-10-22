// perf-eval.mjs — accuracy guards for resonance-cue CPU candidates
// (measurements/resonance-cue-cpu-2026-10-07.md, pre-registered).
//
//   node scripts/resonance/perf-eval.mjs --base=<tree> --cand=<tree> --configs=<configs.json>
//        [--r1=<jobs_r1.json>] [--picka=<picka jobs.json>] [--hc=<H&C jobs_sent.json>]
//        [--only=fixtures,r1stream,r1utt,picka,hc] [--out=build/resonance-cue/perf-eval.json]
//
// <tree> is a source tree root holding src/, scripts/resonance-lab/ and
// public/resonance-lab/ (the base = the head before the CPU pass, extracted
// with `git archive <rev> src scripts public/resonance-lab tests`; the
// candidate = this checkout). The base runs with no options; every entry of
// configs.json ({ name: engineOptions }) runs in the candidate tree with
// createLabEngine({ ...engineOptions }).
//
// Every item runs the PRODUCTION path: the REAL pitch worker (src/dsp/
// pitch-worker.js of the base tree, fake `self`; its posted frames are
// computed once per item and shared by every config) relayed into the lab
// engine in "frames" mode, plus the gated cue (resonanceCue.js) exactly as
// src/resonance/resonance-worker.js drives them. 48 kHz (the lab's band-
// limited x3 upsample of 16 kHz material), 1200-sample chunks, relay delay 0.
//
// Material (all public):
//   fixtures  the three committed lab fixtures (tests/resonance-lab/fixtures/)
//   r1stream  LibriSpeech test-clean r1 set (20 women, 20 men, 5 utterances
//             each; --r1 = [{key, audio: float32 16 kHz, sr, speaker, sex}]):
//             each reader's utterances concatenated into one reading stream;
//             the gated cue's u every 0.2 s of audio once full (what the dot
//             shows), time to settling (2 s admitted voiced) and live (full)
//   r1utt     the same 200 utterances one by one (+0.5 s of silence so the
//             relay drains): the ungated engine readout at the end
//   picka     PICKA grid rebuild on 20 LibriSpeech women (2 utterances x
//             F0 0/-6/-12 st x VTL 0/+1.8/+3.6 st), keys grid__<talker>-<utt>__f<F0>_v<VTL>
//   hc        Hillenbrand & Clark (2009) sentence proxy (LibriSpeech test-clean,
//             20 women + 20 men x 2 utterances x US/PE/PO/EO), keys hcs_ls-<utt>_<W|M><cond>
//
// Output: per config and item the readouts, and the pre-registered guards
// (per sex) of every config against the base, printed and written to --out.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const BASE = path.resolve(arg("base", path.resolve(here, "../..")));
const CAND = path.resolve(arg("cand", path.resolve(here, "../..")));
const CONFIGS = JSON.parse(readFileSync(arg("configs", ""), "utf8"));
const ONLY = new Set(arg("only", "fixtures,r1stream,r1utt,picka,hc").split(","));
const OUT = arg("out", path.resolve(here, "../../build/resonance-cue/perf-eval.json"));
const imp = (root, p) => import(pathToFileURL(path.join(root, p)).href);

const { upsample } = await imp(BASE, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs");
let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
await imp(BASE, "src/dsp/pitch-worker.js");
const pitchOn = self.onmessage;
const trees = {
  base: { eng: (await imp(BASE, "src/resonance-lab/lab-engine.js")).createLabEngine, cue: (await imp(BASE, "src/resonance/resonanceCue.js")).createResonanceCue },
  cand: { eng: (await imp(CAND, "src/resonance-lab/lab-engine.js")).createLabEngine, cue: (await imp(CAND, "src/resonance/resonanceCue.js")).createResonanceCue },
};
const ASSETS = path.join(BASE, "public/resonance-lab");
const vtln = JSON.parse(readFileSync(path.join(ASSETS, "vtln_warp.json"), "utf8"));
const reference = JSON.parse(readFileSync(path.join(ASSETS, "reference.json"), "utf8"));
const G = reference.vtln.womenMedian - reference.vtln.menMedian;
const uOf = (raw) => (raw === null || raw === undefined ? null : (raw - reference.vtln.menMedian) / G);

const SR = 48000, CH = 1200;
const RUNS = [["base", "base", {}], ...Object.entries(CONFIGS).map(([name, o]) => [name, "cand", o])];

function readF32(p) { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }
function readWav16(p) {
  const b = readFileSync(p);
  let off = 12, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4); const len = b.readUInt32LE(off + 4);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return x;
}
const to48 = (x16, padS = 0) => {
  const y = Float32Array.from(upsample(x16));
  if (!padS) return y;
  const z = new Float32Array(y.length + Math.round(padS * SR)); z.set(y); return z;
};

function chunksWithPosts(y) {
  pitchOn({ data: { type: "init", inputSampleRate: SR } });
  const port = {}; pitchOn({ data: { type: "audioPort", port } });
  const out = [];
  for (let s = 0; s < y.length; s += CH) {
    const e = Math.min(y.length, s + CH);
    const x = y.slice(s, e), ct = e / SR;
    sink = [];
    port.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
    out.push({ x, ct, posts: sink.filter((m) => m.type === "pitch").map((m) => ({ voiced: m.voiced, pitch: m.pitch, contextTime: m.contextTime })) });
  }
  return out;
}

// One run of the production path over pre-computed chunks + posts.
function runPath(kind, opts, chunks) {
  const T = trees[kind];
  const cue = T.cue({ reference });
  let bins = 0, nonNull = 0;
  const eng = T.eng({ sampleRate: SR, models: { vtln }, reference, pitchSource: "frames", ...opts,
    onBin: (n, te, v) => { if (n === "vtln") { bins++; if (v !== null) nonNull++; } },
    onStamped: (n, te, st, v) => { if (n === "vtln") cue.onStamped(te, st, v); } });
  let tSettling = null, tLive = null, next = 0;
  const live = []; // [t, u]
  for (const c of chunks) {
    cue.noteChunk(c.ct);
    eng.pushChunk(c.x, null, c.ct);
    for (const m of c.posts) { cue.notePitchHint(m); eng.pushPitchFrame(m.contextTime, m.voiced ? m.pitch : 0); }
    const g = cue.snapshot();
    if (tSettling === null && g.voicedS >= 2) tSettling = c.ct;
    if (tLive === null && g.fill >= 1) tLive = c.ct;
    if (g.fill >= 1 && g.u !== null && c.ct >= next) { live.push([+c.ct.toFixed(3), g.u]); next = c.ct + 0.2; }
  }
  const s = eng.snapshot();
  return { uEnd: uOf(s.finalists.vtln.raw), uGated: cue.snapshot().u, bins, nonNull, tSettling, tLive, live,
    framesDropped: s.framesDropped, forced: s.gridForcedUnvoiced };
}

const results = Object.fromEntries(RUNS.map(([n]) => [n, {}]));
function runItem(set, key, meta, y) {
  const chunks = chunksWithPosts(y);
  for (const [name, kind, opts] of RUNS) {
    (results[name][set] ??= []).push({ key, ...meta, ...runPath(kind, opts, chunks) });
  }
}

const t0 = Date.now();
const tick = (s) => process.stdout.write(s);
if (ONLY.has("fixtures")) {
  for (const n of ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"]) {
    runItem("fixtures", n, { sex: n.includes("woman") ? "f" : "m" }, to48(readWav16(path.join(BASE, "tests/resonance-lab/fixtures", `${n}.wav`)), 0.5));
  }
  tick("fixtures ");
}
const r1 = arg("r1", "") ? JSON.parse(readFileSync(arg("r1", ""), "utf8")) : [];
if (r1.length && ONLY.has("r1stream")) {
  const bySpk = new Map();
  for (const j of r1) { if (!bySpk.has(j.speaker)) bySpk.set(j.speaker, { sex: j.sex, items: [] }); bySpk.get(j.speaker).items.push(j); }
  for (const [spk, { sex, items }] of bySpk) {
    const parts = items.map((j) => readF32(j.audio));
    const x = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { x.set(p, o); o += p.length; }
    runItem("r1stream", spk, { sex, speaker: spk }, to48(x));
    tick(".");
  }
  tick(" r1stream ");
}
if (r1.length && ONLY.has("r1utt")) {
  for (const j of r1) { runItem("r1utt", j.key, { sex: j.sex, speaker: j.speaker }, to48(readF32(j.audio), 0.5)); }
  tick("r1utt ");
}
if (arg("picka", "") && ONLY.has("picka")) {
  const jobs = JSON.parse(readFileSync(arg("picka", ""), "utf8")).filter((j) => j.key.startsWith("grid__ls"));
  for (const j of jobs) {
    const m = /^grid__(ls\d+)-(.+)__f([+-]\d+)_v\+([\d.]+)$/.exec(j.key);
    const meta = { sex: "f", speaker: m[1], item: `${m[1]}-${m[2]}`, f0St: +m[3], vtlSt: +m[4] };
    runItem("picka", j.key, meta, j.sr === 48000 ? Float32Array.from(readF32(j.audio)) : to48(readF32(j.audio), 0.5));
  }
  tick("picka ");
}
if (arg("hc", "") && ONLY.has("hc")) {
  const jobs = JSON.parse(readFileSync(arg("hc", ""), "utf8")).filter((j) => !j.key.endsWith("NAT"));
  for (const j of jobs) {
    const m = /^hcs_ls-(\d+)-(.+)_([WM])(US|PE|PO|EO)$/.exec(j.key);
    const sex = m[3] === "W" ? "f" : "m";
    const fm = sex === "f" ? 0.8562 : 1.168, fp = sex === "f" ? 0.5868 : 1.7041;
    const meta = { sex, speaker: `ls${m[1]}`, item: `${m[1]}-${m[2]}`, cond: m[4],
      lfm: ["EO", "PE"].includes(m[4]) ? Math.log(fm) : 0, lfp: ["PO", "PE"].includes(m[4]) ? Math.log(fp) : 0 };
    runItem("hc", j.key, meta, to48(readF32(j.audio), 0.5));
  }
  tick("hc ");
}
console.log(`\nran ${RUNS.length} configs in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// ------------------------------------------------------------------ guards
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const SEXES = [["f", "women"], ["m", "men"]];

// item fixed-effects regression of u on (lfm, lfp): returns [R3eq, R2eq] (per ln 1.15 formant, per octave F0)
function fe(rows) {
  const by = new Map();
  for (const r of rows) { if (r.u === null) continue; if (!by.has(r.item)) by.set(r.item, []); by.get(r.item).push(r); }
  const Y = [], X1 = [], X2 = [];
  for (const g of by.values()) {
    const my = g.reduce((a, r) => a + r.u, 0) / g.length, m1 = g.reduce((a, r) => a + r.lfm, 0) / g.length, m2 = g.reduce((a, r) => a + r.lfp, 0) / g.length;
    for (const r of g) { Y.push(r.u - my); X1.push(r.lfm - m1); X2.push(r.lfp - m2); }
  }
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < Y.length; i++) { a11 += X1[i] * X1[i]; a12 += X1[i] * X2[i]; a22 += X2[i] * X2[i]; b1 += X1[i] * Y[i]; b2 += X2[i] * Y[i]; }
  const det = a11 * a22 - a12 * a12;
  const bf = (b1 * a22 - b2 * a12) / det, bp = (a11 * b2 - a12 * b1) / det;
  return [bf * Math.log(1.15), bp * Math.log(2)];
}
// pooled within-group SD of u (groups = speaker, or talker x cell)
function pooledSd(rows, keyOf) {
  const by = new Map();
  for (const r of rows) { if (r.u === null) continue; const k = keyOf(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r.u); }
  let ss = 0, dof = 0;
  for (const v of by.values()) { if (v.length < 2) continue; const m = v.reduce((a, b) => a + b, 0) / v.length; ss += v.reduce((a, b) => a + (b - m) ** 2, 0); dof += v.length - 1; }
  return Math.sqrt(ss / dof);
}
const withU = (rows) => rows.map((r) => ({ ...r, u: r.uEnd }));
function pickaRows(rows) { return withU(rows).map((r) => ({ ...r, lfm: -r.vtlSt * Math.log(2) / 12, lfp: r.f0St * Math.log(2) / 12 })); }

const report = { configs: {}, base: {} };
function paired(a, b) { // per-item |delta u| and null mismatches
  const d = [], mism = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i].uEnd, y = b[i].uEnd;
    if ((x === null) !== (y === null)) mism.push(a[i].key);
    else if (x !== null) d.push(Math.abs(x - y));
  }
  return { d, mism };
}
function liveDiffs(a, b) {
  const d = [];
  for (let i = 0; i < a.length; i++) {
    const mb = new Map(b[i].live.map(([t, u]) => [t, u]));
    for (const [t, u] of a[i].live) if (mb.has(t)) d.push(Math.abs(u - mb.get(t)));
  }
  return d;
}
const B = results.base;
function baseStats() {
  const s = {};
  if (B.r1stream) for (const [sx] of SEXES) {
    const R = B.r1stream.filter((r) => r.sex === sx);
    s[`settle_${sx}`] = [q(R.map((r) => r.tSettling), 0.5), q(R.map((r) => r.tSettling), 0.9)];
    s[`live_${sx}`] = [q(R.map((r) => r.tLive), 0.5), q(R.map((r) => r.tLive), 0.9)];
  }
  if (B.r1utt) for (const [sx] of SEXES) s[`noise_r1_${sx}`] = pooledSd(withU(B.r1utt.filter((r) => r.sex === sx)), (r) => r.speaker);
  if (B.picka) { const P = pickaRows(B.picka); s.noise_picka_f = pooledSd(P, (r) => `${r.speaker}|${r.f0St}|${r.vtlSt}`); [s.R3_picka_f, s.R2_picka_f] = fe(P); }
  if (B.hc) for (const [sx] of SEXES) [s[`R3_hc_${sx}`], s[`R2_hc_${sx}`]] = fe(withU(B.hc.filter((r) => r.sex === sx)));
  return s;
}
report.base = baseStats();
const fmt = (v, d = 3) => (v === undefined || Number.isNaN(v) ? "—" : (v >= 0 ? " " : "") + v.toFixed(d));
console.log("\nbase:", Object.entries(report.base).map(([k, v]) => `${k} ${Array.isArray(v) ? v.map((x) => x.toFixed(2)).join("/") : v.toFixed(3)}`).join("  "));
for (const [name] of RUNS.slice(1)) {
  const C = results[name];
  const g = { checks: [] };
  const chk = (label, value, ok) => { g.checks.push({ label, value, ok }); };
  for (const [sx, lab] of SEXES) {
    if (C.r1stream) {
      const d = liveDiffs(B.r1stream.filter((r) => r.sex === sx), C.r1stream.filter((r) => r.sex === sx));
      chk(`r1 live readout |du| ${lab} median`, q(d, 0.5), q(d, 0.5) <= 0.02);
      chk(`r1 live readout |du| ${lab} q95`, q(d, 0.95), q(d, 0.95) <= 0.06);
      const R = C.r1stream.filter((r) => r.sex === sx);
      const s50 = q(R.map((r) => r.tSettling), 0.5), s90 = q(R.map((r) => r.tSettling), 0.9);
      const l50 = q(R.map((r) => r.tLive), 0.5), l90 = q(R.map((r) => r.tLive), 0.9);
      const bs = report.base[`settle_${sx}`], bl = report.base[`live_${sx}`];
      chk(`time to settling ${lab} median delta s`, s50 - bs[0], s50 - bs[0] <= 1);
      chk(`time to settling ${lab} q90 delta s`, s90 - bs[1], s90 - bs[1] <= 1);
      chk(`time to live ${lab} median delta s`, l50 - bl[0], l50 - bl[0] <= 1);
      chk(`time to live ${lab} q90 delta s`, l90 - bl[1], l90 - bl[1] <= 1);
    }
    for (const set of ["r1utt", "picka", "hc"]) {
      if (!C[set]) continue;
      const a = B[set].filter((r) => r.sex === sx), b = C[set].filter((r) => r.sex === sx);
      if (!a.length) continue;
      const { d, mism } = paired(a, b);
      chk(`${set} readout |du| ${lab} median`, q(d, 0.5), q(d, 0.5) <= 0.02);
      chk(`${set} readout |du| ${lab} q95`, q(d, 0.95), q(d, 0.95) <= 0.06);
      chk(`${set} reading/null mismatches ${lab} (share)`, mism.length / a.length, mism.length / a.length <= 0.01);
    }
    if (C.r1utt) {
      const n = pooledSd(withU(C.r1utt.filter((r) => r.sex === sx)), (r) => r.speaker);
      chk(`r1 utterance noise ${lab} ratio`, n / report.base[`noise_r1_${sx}`], n / report.base[`noise_r1_${sx}`] <= 1.1);
    }
    if (C.hc) {
      const [r3, r2] = fe(withU(C.hc.filter((r) => r.sex === sx)));
      chk(`hc R3eq ${lab} delta`, r3 - report.base[`R3_hc_${sx}`], Math.abs(r3 - report.base[`R3_hc_${sx}`]) <= 0.05);
      chk(`hc R2eq ${lab} delta`, r2 - report.base[`R2_hc_${sx}`], Math.abs(r2 - report.base[`R2_hc_${sx}`]) <= 0.03);
    }
  }
  if (C.picka) {
    const P = pickaRows(C.picka);
    const n = pooledSd(P, (r) => `${r.speaker}|${r.f0St}|${r.vtlSt}`);
    chk("picka utterance noise women ratio", n / report.base.noise_picka_f, n / report.base.noise_picka_f <= 1.1);
    const [r3, r2] = fe(P);
    chk("picka R3eq women delta", r3 - report.base.R3_picka_f, Math.abs(r3 - report.base.R3_picka_f) <= 0.05);
    chk("picka R2eq women delta", r2 - report.base.R2_picka_f, Math.abs(r2 - report.base.R2_picka_f) <= 0.03);
  }
  if (C.fixtures) {
    const { d, mism } = paired(B.fixtures, C.fixtures);
    g.fixtures = { maxAbsDu: d.length ? Math.max(...d) : null, mism: mism.length };
  }
  // bit-identity across everything run (informational)
  let identical = true;
  for (const set of Object.keys(C)) for (let i = 0; i < C[set].length; i++) {
    const a = B[set][i], b = C[set][i];
    if (a.uEnd !== b.uEnd || a.bins !== b.bins || a.nonNull !== b.nonNull || a.live.length !== b.live.length || a.live.some(([t, u], k) => b.live[k][0] !== t || b.live[k][1] !== u)) identical = false;
  }
  g.identical = identical;
  g.pass = g.checks.every((c) => c.ok);
  report.configs[name] = g;
  console.log(`\n== ${name}: ${g.pass ? "PASS" : "FAIL"} all accuracy guards; bit-identical to base on every item: ${identical}${g.fixtures ? `; fixtures max |du| ${g.fixtures.maxAbsDu?.toExponential(2)}` : ""}`);
  for (const c of g.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.label.padEnd(48)} ${fmt(c.value)}`);
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ report, results }, null, 0));
console.log(`\n-> ${OUT}`);
