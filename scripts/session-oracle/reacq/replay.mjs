// replay.mjs — drive the REAL main-thread hook (useAudioPipeline.js
// handleAnalysisResult) of a chosen src tree over CACHED worker outputs
// (cache.mjs). Output formats match run.mjs (sessions -> analyze.py) and
// corpus.mjs (corpus -> corpus.mjs --report).
// Usage: node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/reacq/replay.mjs
//   --src=build/trees/reacq-var/src --tag=T [--pgv='{"reacquireSustain":3}']
//   --set=sessions [--sessions=..] [--refs=build/session-oracle/refs]
//   --set=corpus --corpus=fda|ptdb|hil|voc
//   --set=group --group=G         (every cached stream in cache/G -> build/reacq/out/G/T/*.f32)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { M } from "../lib/react-mock.mjs";
import { DET_COLS, DISP_COLS, tenthPercentile } from "../lib/chain.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const CACHE = resolve(args.cache ?? "build/reacq/cache");
const SRC = resolve(args.src ?? "build/trees/reacq-var/src");
const TAG = args.tag ?? "var";
globalThis.__PGV = args.pgv ? JSON.parse(args.pgv) : {};
const HOOK = resolve(SRC, "audio/useAudioPipeline.js");

export function loadCache(dir, name) {
  const meta = JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8"));
  const raw = readFileSync(resolve(dir, `${name}.bin`));
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const c = {}; meta.cols.forEach((nm, i) => { c[nm] = all.subarray(i * meta.n, (i + 1) * meta.n); });
  return { meta, c };
}

function buildFrames(meta, c, { mask = null, floorDb = null } = {}) {
  const n = meta.n, C = meta.C, sr = meta.sr;
  const frames = [];
  let last = { pitch: null, confidence: null, ts: 0, amb: null };
  for (let k = 0; k < n; k++) {
    const now = (k + 1) * C / sr * 1000;
    if (!Number.isNaN(c.msgPitch[k])) {
      const kk = c.msgKK ? c.msgKK[k] : -1;
      const amb = kk >= 0 && c.ambH ? { h: c.ambH[kk], d: c.ambD[kk] } : null;
      last = { pitch: c.msgPitch[k] > 0 ? c.msgPitch[k] : null, confidence: c.msgConf[k], ts: now, amb };
    }
    if (Number.isNaN(c.inten[k])) continue;
    let f = { k, now, intensity: c.inten[k], pitch: last.pitch, confidence: last.confidence, ts: last.ts, amb: last.amb };
    if (mask && !mask[k]) f = { k, now, intensity: floorDb, pitch: null, confidence: 0.2, ts: now, amb: null };
    frames.push(f);
  }
  return frames;
}

const LOGC = ["code", "armed", "offLen", "level", "onStreak", "psg"];
let hookGen = 0;
async function driveHook(frames, n, { log = false } = {}) {
  M.refs = []; M.effects = []; M.state = null;
  globalThis.__SMGAP = 0; globalThis.__SMPREV = 0;
  const L = log ? Object.fromEntries(LOGC.map((k) => [k, new Float32Array(n)])) : null;
  globalThis.__PGLOG = L;
  const mod = await import(pathToFileURL(HOOK).href + `?rq=${++hookGen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* browser-only effects */ } }
  const latest = M.refs.find((r) => r.current && typeof r.current === "object" && "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  if (!latest || !har) throw new Error("could not locate latestPitchRef / handleAnalysisResultRef");
  const out = { msg: new Float32Array(n), paint: new Float32Array(n), brk: new Uint8Array(n), ro: new Float32Array(n), style: new Uint8Array(n), rec: new Float32Array(n), sm: new Float32Array(n) };
  let rec = null;
  api.frameCallbackRef.current = (f) => { rec = f; };
  const tr = api.pitchTraceRef;
  for (const f of frames) {
    latest.current = { pitch: f.pitch, confidence: f.confidence, voiced: f.pitch !== null, ts: f.ts, amb: f.amb };
    rec = null; globalThis.__PGK = f.k;
    har.current({ intensity: f.intensity, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: f.now });
    const T = tr.current; const lastE = T[T.length - 1]; const now = Math.round(f.now);
    const painted = lastE && lastE.time === now && lastE.pitch !== null ? lastE.pitch : 0;
    out.msg[f.k] = f.pitch ?? 0;
    out.paint[f.k] = painted;
    const prev = T[T.length - 2];
    if (painted > 0 && prev && prev.time === now && prev.pitch === null) out.brk[f.k] = 1;
    const s = M.state;
    out.ro[f.k] = s.pitch ?? 0;
    out.style[f.k] = s.voiced ? 2 : s.holding ? 1 : 0;
    out.rec[f.k] = rec && rec.voiced && rec.f0 !== null ? rec.f0 : 0;
  }
  globalThis.__PGLOG = null;
  return { out, log: L };
}

function aliceMask(meta, spk) {
  const m = new Uint8Array(meta.n), hop = meta.C / meta.sr;
  for (let k = 0; k < meta.n; k++) {
    const t = (k + 1) * hop - meta.L * hop - 0.040;
    const i = Math.round((t - spk.t0) / spk.dt);
    if (i >= 0 && i < spk.spk.length && spk.spk[i] === 1) m[k] = 1;
  }
  return m;
}

function writeTable(dir, name, n, cols, names, meta) {
  mkdirSync(dir, { recursive: true });
  const tbl = new Float32Array(n * names.length);
  names.forEach((c, i) => tbl.set(cols[c], i * n));
  writeFileSync(resolve(dir, `${name}.hops.f32`), Buffer.from(tbl.buffer));
  writeFileSync(resolve(dir, `${name}.meta.json`), JSON.stringify({ ...meta, cols: names }, null, 1));
}

const t0 = Date.now();
if (args.set === "sessions") {
  const REFS = args.refs ? resolve(args.refs) : resolve("build/session-oracle/refs");
  const OUT = resolve(args.out ?? "build/session-oracle/runs", TAG);
  for (const s of (args.sessions ?? "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",")) {
    const { meta, c } = loadCache(resolve(CACHE, "sessions"), s);
    const { out: D, log } = await driveHook(buildFrames(meta, c), meta.n, { log: true });
    const cols = { ...D }; for (const k of DET_COLS) cols[k] = c[k]; cols.inten = c.inten;
    const names = [...DET_COLS, ...DISP_COLS];
    for (const k of LOGC) { cols[`g_${k}`] = log[k]; names.push(`g_${k}`); }
    cols.sm = D.sm;
    if (c.ambH) {
      const mh = new Float32Array(meta.n).fill(NaN), md = new Float32Array(meta.n).fill(NaN);
      for (const f of buildFrames(meta, c)) if (f.amb) { mh[f.k] = f.amb.h; md[f.k] = f.amb.d; }
      cols.ambH = mh; cols.ambD = md; names.push("ambH", "ambD");
    }
    { const mc = new Float32Array(meta.n).fill(NaN); for (const f of buildFrames(meta, c)) mc[f.k] = f.confidence ?? NaN; cols.mconf = mc; names.push("mconf"); }
    const spkF = resolve(REFS, `${s}.spk.json`);
    if (existsSync(spkF)) {
      const spk = JSON.parse(readFileSync(spkF, "utf8"));
      const { out: DA, log: LA } = await driveHook(buildFrames(meta, c, { mask: aliceMask(meta, spk), floorDb: tenthPercentile(c.inten) }), meta.n, { log: true });
      cols.paintA = DA.paint; cols.roA = DA.ro; cols.styleA = DA.style; cols.brkA = DA.brk;
      names.push("paintA", "roA", "styleA", "brkA");
      for (const k of LOGC) { cols[`gA_${k}`] = LA[k]; names.push(`gA_${k}`); }
    }
    writeTable(OUT, s, meta.n, cols, names, { name: s, nHops: meta.n, hop: meta.C, sr: meta.sr, hopS: meta.C / meta.sr, lookback: meta.L, cpu: meta.cpu, tap: true, src: SRC, pgv: globalThis.__PGV, replay: true });
    console.log(`${TAG} ${s}: ${(Date.now() - t0) / 1000}s`);
  }
} else if (args.set === "corpus") {
  const CATS = ["correct", "down2", "down3", "up2", "up3", "null", "other"];
  const BANDS = [["75-125", 75, 125], ["125-160", 125, 160], ["160-200", 160, 200], ["200-300", 200, 300], ["300-400", 300, 400], [">=400", 400, 1e9], ["<160", 0, 160], ["all<400", 0, 400], ["all", 0, 1e9]];
  const cls = (f, r) => {
    if (!(f > 0)) return "null";
    const q = f / r;
    if (Math.abs(q - 1) < 0.05) return "correct";
    if (Math.abs(q - 0.5) <= 0.05) return "down2";
    if (Math.abs(q - 1 / 3) <= 0.0333) return "down3";
    if (Math.abs(q - 2) <= 0.2) return "up2";
    if (Math.abs(q - 3) <= 0.3 || Math.abs(q - 4) <= 0.4) return "up3";
    return "other";
  };
  const res = {};
  const add = (st, g, r, cc) => {
    for (const [bn, lo, hi] of BANDS) {
      if (r < lo || r >= hi) continue;
      const a = res[`${st}|${g}|${bn}`] ??= Object.fromEntries(["n", ...CATS].map((x) => [x, 0]));
      a.n++; a[cc]++;
    }
  };
  // extra event metrics per group: painted octave-class steps (as rendered:
  // brk counts) and wrong-octave painted runs
  const ev = {};
  const dir = resolve(CACHE, "corpus", args.corpus);
  const names = readdirSync(dir).filter((x) => x.endsWith(".json")).map((x) => x.slice(0, -5)).sort();
  for (const nm of names) {
    const { meta, c } = loadCache(dir, nm);
    const { out: D } = await driveHook(buildFrames(meta, c), meta.n);
    const hop = meta.C / meta.sr;
    const refAt = (tSec) => { const i = Math.round((tSec * 1000 - meta.off) / meta.refHopMs); return i >= 0 && i < meta.ref.length ? meta.ref[i] : 0; };
    for (const g of meta.groups) {
      const e = ev[g] ??= { brk: 0, paintMin: 0, upRuns: 0, dnRuns: 0, vmin: 0 };
      let upOn = false, dnOn = false;
      for (let k = 0; k < meta.n; k++) {
        const rw = refAt((k + 1) * hop - 0.040);
        if (rw > 0) { add("dec", g, rw, cls(c.dec[k], rw)); add("post", g, rw, cls(c.post[k], rw)); }
        const rd = refAt((k + 1) * hop - 0.040 - meta.L * hop - 0.030);
        if (rd > 0) { add("paint", g, rd, cls(D.paint[k], rd)); add("ro", g, rd, cls(D.ro[k], rd)); }
        e.brk += D.brk[k]; if (D.paint[k] > 0) e.paintMin += hop / 60;
        const p = D.paint[k];
        if (!(p > 0)) { upOn = dnOn = false; }
        if (!(rd > 0)) continue;
        e.vmin += hop / 60;
        if (!(p > 0)) continue;
        const q = p / rd, u = q > 1.5, dn = q < 0.67;
        if (u && !upOn) e.upRuns++;
        if (dn && !dnOn) e.dnRuns++;
        upOn = u; dnOn = dn;
      }
    }
  }
  const od = resolve(args.out ?? "build/session-oracle/corpus", TAG);
  mkdirSync(od, { recursive: true });
  writeFileSync(resolve(od, `${args.corpus}.json`), JSON.stringify(res));
  writeFileSync(resolve(od, `${args.corpus}.events.ev`), JSON.stringify(ev));
  console.log(`${TAG} corpus ${args.corpus}: ${names.length} tracks ${(Date.now() - t0) / 1000}s`);
} else if (args.set === "group") {
  const dir = resolve(CACHE, args.group);
  const od = resolve("build/reacq/out", args.group, TAG);
  const names = readdirSync(dir).filter((x) => x.endsWith(".json")).map((x) => x.slice(0, -5)).sort();
  for (const nm of names) {
    const { meta, c } = loadCache(dir, nm);
    const { out: D } = await driveHook(buildFrames(meta, c), meta.n);
    const cols = { ...D, post: c.post, inten: c.inten };
    writeTable(od, nm, meta.n, cols, ["post", "inten", "msg", "paint", "brk", "ro", "style", "rec"], { name: nm, nHops: meta.n, hopS: meta.C / meta.sr, lookback: meta.L, pgv: globalThis.__PGV });
  }
  console.log(`${TAG} group ${args.group}: ${names.length} streams ${(Date.now() - t0) / 1000}s`);
}
