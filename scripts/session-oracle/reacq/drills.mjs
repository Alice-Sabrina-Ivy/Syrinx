// drills.mjs — frame-level synthetic drills through the REAL hook
// (useAudioPipeline.js handleAnalysisResult of --src, parametric gate config
// via --pgv). Each hop = one worker message; truth known per hop. Displayed
// value at hop i is scored against truth at hop i-1 (median-3 centre).
// Adapted from the 2026-10-03 display workstream's drills.mjs (which ran a
// replay mirror); adds in-word (no-gap) register switches, held notes.
// Usage: node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/reacq/drills.mjs
//   --variants='name=JSON;name=JSON' [--src=build/trees/reacq-var/src] [--trials=40] [--out=f.json]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { M } from "../lib/react-mock.mjs";

const A = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/s); return m ? [m[1], m[2]] : [a, "1"]; }));
const SRC = resolve(A.src ?? "build/trees/reacq-var/src");
const HOOK = resolve(SRC, "audio/useAudioPipeline.js");
const VARS = (A.variants ?? "prod={}").split(";").map((s) => { const i = s.indexOf("="); return [s.slice(0, i), JSON.parse(s.slice(i + 1))]; });
const TRIALS = Number(A.trials ?? 40);
let fakeNow = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => (fakeNow += 1000), timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });

let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const st = (f, s) => f * 2 ** (s / 12);

function word(hz, ms, tag, err = {}) {
  const n = Math.round(ms / 25), out = [];
  const drift = (rnd() - 0.5) * 4;
  let onsetLow = err.onsetLow && tag === "T" && rnd() < err.onsetLow ? 2 + Math.floor(rnd() * 5) : 0;
  for (let i = 0; i < n; i++) {
    const truth = st(hz, drift * (i / n - 0.5)) * (1 + (rnd() - 0.5) * 0.01);
    let det = truth;
    if (onsetLow > 0) { det = truth / 2; onsetLow--; }
    out.push({ truth, det, tag });
  }
  const burst = tag === "T" ? err.tBurst : err.lBurst;
  if (burst) for (let i = 3; i < n - 1; i++) if (rnd() < burst.rate) {
    const L = burst.len[0] + Math.floor(rnd() * (burst.len[1] - burst.len[0] + 1));
    for (let k = 0; k < L && i + k < n; k++) { out[i + k].det = out[i + k].truth * burst.mul; out[i + k].burst = 1; }
    i += L;
  }
  return out;
}
const gap = (ms, loud) => Array.from({ length: Math.round(ms / 25) }, () => ({ truth: null, det: null, loud, tag: "gap" }));
function toFrames(seq) {
  return seq.map((s, c) => {
    const now = 1e6 + (c + 1) * 25;
    if (s.det === null) return { k: c, now, intensity: s.loud ? -38 : -70, pitch: null, confidence: 0.3, ts: now };
    return { k: c, now, intensity: s.inten ?? -28, pitch: s.det, confidence: s.conf ?? 0.8, ts: now };
  });
}

let gen = 0;
async function drive(frames) {
  M.refs = []; M.effects = []; M.state = null; globalThis.__SMGAP = 0; globalThis.__SMPREV = 0; globalThis.__PGLOG = null;
  const mod = await import(pathToFileURL(HOOK).href + `?dr=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* */ } }
  const latest = M.refs.find((r) => r.current && typeof r.current === "object" && "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  const n = frames.length; const painted = new Float32Array(n), readout = new Float32Array(n), brk = new Uint8Array(n);
  const tr = api.pitchTraceRef; api.frameCallbackRef.current = () => {};
  for (const f of frames) {
    latest.current = { pitch: f.pitch, confidence: f.confidence, voiced: f.pitch !== null, ts: f.ts, amb: null };
    globalThis.__PGK = f.k;
    har.current({ intensity: f.intensity, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: f.now });
    const T = tr.current; const lastE = T[T.length - 1]; const now = Math.round(f.now);
    painted[f.k] = lastE && lastE.time === now && lastE.pitch !== null ? lastE.pitch : 0;
    const prev = T[T.length - 2];
    if (painted[f.k] > 0 && prev && prev.time === now && prev.pitch === null) brk[f.k] = 1;
    readout[f.k] = M.state.pitch ?? 0;
  }
  return { painted, readout, brk };
}

function scoreSeq(seq, out, acc) {
  let wordStart = -1, firstCor = null, curTag = null;
  const endWord = () => { if (curTag) (acc.lat[curTag] ??= []).push(firstCor === null ? Infinity : firstCor * 25); curTag = null; };
  for (let i = 1; i < seq.length; i++) {
    const t = seq[i].truth, tag = seq[i].tag;
    const a = out.painted[i - 1], b = out.painted[i];
    if (a > 0) acc.ph++;
    if (a > 0 && b > 0 && !out.brk[i] && Math.abs(12 * Math.log2(b / a)) >= 12) acc.conn12++;
    if (b > 0 && a > 0 && out.brk[i]) acc.brk++;
    if (t === null) { endWord(); continue; }
    if (curTag === null || tag !== curTag) { endWord(); curTag = tag; wordStart = i; firstCor = null; }
    const tt = seq[i - 1].truth ?? t;
    const d = out.painted[i], ro = out.readout[i];
    const B = acc[tag] ??= { n: 0, cor: 0, half: 0, up: 0, blank: 0, other: 0, roWrong: 0, burstN: 0, burstPaint: 0 };
    B.n++;
    if (!(d > 0)) B.blank++;
    else { const q = d / tt; if (Math.abs(q - 1) < 0.05) { B.cor++; if (firstCor === null) firstCor = i - wordStart; } else if (Math.abs(q - 0.5) < 0.05) B.half++; else if (q > 1.5) B.up++; else B.other++; }
    if (seq[i - 1].burst) { B.burstN++; if (d > 0 && Math.abs(d / tt - 1) > 0.3) B.burstPaint++; }
    if (ro > 0 && Math.abs(ro / tt - 1) >= 0.05) B.roWrong++;
  }
  endWord();
}

const NOERR = {};
const ERR = { onsetLow: 0.3, tBurst: { rate: 0.03, len: [2, 4], mul: 0.5 }, lBurst: { rate: 0.02, len: [2, 4], mul: 2 } };
const SCEN = [];
for (const [en, err] of [["clean", NOERR], ["err", ERR]])
  for (const W of [300, 500, 800]) for (const G of [100, 200, 400]) for (const loud of [true, false])
    SCEN.push({ group: `alt${W}`, label: `alt S120<->T230 word ${W} gap ${G} ${loud ? "loud" : "quiet"} ${en}`, gen: () => {
      const seq = [...word(120, 2000, "L", err), ...gap(300, false)];
      for (let w = 0; w < 10; w++) { seq.push(...word(w % 2 ? 120 : 230, W, w % 2 ? "L" : "T", err)); seq.push(...gap(G, loud)); }
      return seq; } });
// transmasculine direction: established target, alternate down
for (const W of [300, 500]) SCEN.push({ group: "altdown", label: `alt T230->S120 first, word ${W} gap 200 loud err`, gen: () => {
  const seq = [...word(230, 2000, "T", ERR), ...gap(300, false)];
  for (let w = 0; w < 10; w++) { seq.push(...word(w % 2 ? 230 : 120, W, w % 2 ? "T" : "L", ERR)); seq.push(...gap(200, true)); }
  return seq; } });
// in-word register switches (no gap): plain, with a 2-frame confidence dip, with a 2-frame 8 dB intensity dip
for (const [dir, a, b, ta, tb] of [["up", 115, 225, "L", "T"], ["down", 225, 115, "T", "L"]])
  for (const junc of ["plain", "confdip", "intendip"])
    SCEN.push({ group: `inword_${dir}`, label: `in-word ${a}->${b} (${junc})`, gen: () => {
      const seq = [...word(a, 1500, ta)];
      for (let w = 0; w < 6; w++) {
        const x = word(a, 600, ta), y = word(b, 600, tb);
        if (junc === "confdip") { y[0].conf = 0.55; y[1].conf = 0.55; }
        if (junc === "intendip") { x[x.length - 1].inten = -36; y[0].inten = -36; }
        seq.push(...x, ...y, ...gap(300, true));
      }
      return seq; } });
for (const dur of [1500, 3000]) SCEN.push({ group: "siren", label: `siren 120-480-120 ${dur} ms`, gen: () => {
  const seq = [...word(120, 1500, "L")]; const n = dur / 25;
  for (let i = 0; i < n; i++) { const ph = i / n; const s = 24 * (ph < 0.5 ? ph * 2 : (1 - ph) * 2); const f = st(120, s); seq.push({ truth: f, det: f <= 400 ? f : null, loud: true, tag: "siren" }); }
  return seq; } });
for (const dur of [1500, 3000]) SCEN.push({ group: "siren", label: `siren 120-360-120 ${dur} ms`, gen: () => {
  const seq = [...word(120, 1500, "L")]; const n = dur / 25;
  for (let i = 0; i < n; i++) { const ph = i / n; const s = 19 * (ph < 0.5 ? ph * 2 : (1 - ph) * 2); const f = st(120, s); seq.push({ truth: f, det: f, tag: "siren" }); }
  return seq; } });
for (const [lo, hi] of [[110, 220], [220, 110]]) for (const g of [100, 200, 400, 800]) SCEN.push({ group: "glide", label: `glide ${lo}->${hi} in ${g} ms then hold 1 s`, gen: () => {
  const seq = [...word(lo, 1500, lo < 160 ? "L" : "T")]; const n = g / 25;
  for (let i = 1; i <= n; i++) { const f = st(lo, 12 * Math.log2(hi / lo) * i / n); seq.push({ truth: f, det: f, tag: "glide" }); }
  for (let i = 0; i < 40; i++) seq.push({ truth: hi, det: hi, tag: "hold" });
  return seq; } });
for (const [mul, len, base] of [[2, 2, 110], [2, 3, 110], [2, 4, 110], [3, 2, 110], [3, 3, 110], [3, 4, 110], [0.5, 2, 230], [0.5, 3, 230], [0.5, 4, 230], [2, 3, 230], [2, 4, 230]])
  SCEN.push({ group: "burst", label: `${len}-frame x${mul} bursts in ${base} Hz voice`, gen: () => {
    const tg = base < 160 ? "L" : "T";
    const seq = [...word(base, 1500, tg)];
    for (let b = 0; b < 8; b++) { const w = word(base, 600, tg); for (let k = 0; k < len; k++) { w[8 + k].det = w[8 + k].truth * mul; w[8 + k].burst = 1; } seq.push(...w); }
    return seq; } });
for (const [mul, len, base] of [[2, 5, 110], [2, 6, 110], [2, 7, 110], [2, 8, 110], [2, 11, 110], [0.5, 5, 230], [0.5, 6, 230], [0.5, 8, 230], [0.5, 11, 230]])
  SCEN.push({ group: "midlock", label: `mid-word ${len}-frame x${mul} lock in ${base} Hz voice`, gen: () => {
    const tg = base < 160 ? "L" : "T";
    const seq = [...word(base, 1500, tg)];
    for (let b = 0; b < 8; b++) { const w = word(base, 1000, tg); for (let k = 0; k < len; k++) { w[12 + k].det = w[12 + k].truth * mul; w[12 + k].burst = 1; } seq.push(...w); }
    return seq; } });
for (const [mul, len] of [[2, 2], [2, 3], [2, 6], [3, 3], [3, 6], [0.5, 3]]) for (const G of [100, 300])
  SCEN.push({ group: "onsetBurst", label: `onset x${mul} ${len}-frame lock after ${G} ms gap, ${mul < 1 ? 230 : 110} Hz`, gen: () => {
    const base = mul < 1 ? 230 : 110, tg = base < 160 ? "L" : "T";
    const seq = [...word(base, 1500, tg)];
    for (let b = 0; b < 8; b++) { seq.push(...gap(G, true)); const w = word(base, 500, tg); for (let k = 0; k < len; k++) { w[k].det = w[k].truth * mul; w[k].burst = 1; } seq.push(...w); }
    return seq; } });
// held notes with vibrato + rare 2-4-frame octave bursts
for (const base of [110, 225]) SCEN.push({ group: "held", label: `held ${base} Hz 10 s, vibrato 5.5 Hz +-0.5 st, 2-4-frame x${base < 160 ? 2 : 0.5} bursts every ~2 s`, gen: () => {
  const tg = base < 160 ? "L" : "T"; const seq = [];
  for (let i = 0; i < 400; i++) { const f = st(base, 0.5 * Math.sin(2 * Math.PI * 5.5 * i * 0.025)); seq.push({ truth: f, det: f, tag: tg }); }
  for (let b = 1; b < 5; b++) { const L = 2 + Math.floor(rnd() * 3); for (let k = 0; k < L; k++) { const s = seq[b * 80 + k]; s.det = s.truth * (base < 160 ? 2 : 0.5); s.burst = 1; } }
  return seq; } });

const results = [];
const GROUPS = A.groups ? A.groups.split(",") : null;
for (const sc of SCEN) for (const [vn, cfg] of VARS) {
  if (GROUPS && !GROUPS.includes(sc.group)) continue;
  globalThis.__PGV = cfg;
  seed = 4242; const acc = { lat: {}, conn12: 0, ph: 0, brk: 0 };
  for (let t = 0; t < TRIALS; t++) { const seq = sc.gen(); const out = await drive(toFrames(seq)); scoreSeq(seq, out, acc); }
  results.push({ sc: sc.label, group: sc.group, v: vn, acc });
}
const p = (x, n) => (n ? (100 * x / n).toFixed(1) : "-").padStart(5);
const med = (a) => { if (!a || !a.length) return "-"; const s = [...a].sort((x, y) => x - y); const m = s[s.length >> 1]; return m === Infinity ? "inf" : String(m); };
const nev = (a) => (a && a.length ? (100 * a.filter((x) => x === Infinity).length / a.length).toFixed(0) : "-");
for (const sc of SCEN) {
  console.log(`\n## ${sc.label}`);
  for (const r of results.filter((x) => x.sc === sc.label)) {
    const parts = [];
    for (const tag of ["T", "L", "siren", "glide", "hold"]) { const b = r.acc[tag]; if (!b) continue;
      parts.push(`${tag}: cor ${p(b.cor, b.n)} half ${p(b.half, b.n)} up ${p(b.up, b.n)} blank ${p(b.blank, b.n)} burstP ${p(b.burstPaint, b.burstN)} roW ${p(b.roWrong, b.n)} lat ${med(r.acc.lat[tag])} nev ${nev(r.acc.lat[tag])}%`); }
    console.log(`  ${r.v.padEnd(14)} c12 ${r.acc.conn12} brk ${r.acc.brk} | ${parts.join(" | ")}`);
  }
}
if (A.out) writeFileSync(A.out, JSON.stringify(results.map((r) => ({ ...r, acc: { ...r.acc, lat: Object.fromEntries(Object.entries(r.acc.lat).map(([k, a]) => [k, a.map((x) => (x === Infinity ? -1 : x))])) } }))));
