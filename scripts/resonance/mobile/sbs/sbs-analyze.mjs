// sbs-analyze.mjs — the phone-vs-headset session, analysed: same-sound
// transfer function, its prediction on public speech (which decides (a)),
// each device's shown resonance on identical sound (a cross-check with a
// measured noise band), the pause floor / display regime, runtime health, the
// own-voice steps, and the diagnosis note's §6 decision rules applied
// automatically (measurements/resonance-phone-vs-desktop-2026-10-28.md).
//
//   node scripts/resonance/mobile/sbs/sbs-analyze.mjs --session=<run folder>
//        [--a=phone --b=desktop]            (device folder names inside the session)
//        [--dev-a=<folder> --dev-b=<folder>] (two device folders from different runs)
//        [--sound=build/resonance-mobile/sbs/sound/sbs-test.wav] [--predict-only=<reader ids>] [--shards=4]
//        [--no-predict] [--no-replay] [--no-noise] [--no-hook] [--out=<dir, default <session>/analysis>]
//
// Everything runs by default (about 10 min, most of it the 12-reader prediction):
//   prediction  the phone / boom response as an FIR on 12 public readers
//               (sbs-predict.mjs, chain.mjs): bias + steady sensitivity +
//               3 / 5 / 8 s excursions, with a bootstrap CI over readers.
//               (a) is DECIDED on these, by §6's thresholds.
//   noise       each capture's test-sound span replayed 6 times through the
//               real workers with another chunk phase and level
//               (sbs-replay.mjs): the realization noise of the same-sound
//               bias / swing (2.5 sd); and the boom's capture replayed
//               through the measured response (6 times): what the response
//               predicts on the same events. The cross-check compares the
//               meter's same-sound difference with that, inside the band.
//   replay      each capture through the real workers in Node: the live meter
//               vs its own audio (the same-sound N levels and swing, and the
//               share of posts that differ by > 0.05 u).
//   hook        the real hook over the logged messages: idle causes.
//
// "a" is the device under test (the Pixel), "b" the reference (the Maxwell
// boom on the desktop). Everything is written to <out>/analysis.json and
// analysis.md inside the (gitignored) run folder: it describes the owner's
// own voice in parts, so it stays out of the repo. Results that may go into a
// public note: the test-sound response, its prediction on the public readers
// and the device diagnostics; the own-voice parts (holds, tries, placements,
// own-voice pause floor) go to the private project only (CLAUDE.md §Private
// session data).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { loadDevice } from "./sbs-load.mjs";
import { readWav, welch, thirdOctPowers, THIRD_OCT, bandEdges, db, designFir, firGainDb, quant, median, mean, linfit } from "./sbs-dsp.mjs";
import { sourceEnv, deviceEnv, findSound, alignOccurrence } from "./sbs-align.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const sgn = (x, d = 3) => (x == null ? "?" : `${x > 0 ? "+" : ""}${d === 2 ? r2(x) : r3(x)}`);
const sdOf = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); if (v.length < 2) return null; const m = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };
const { resampleClip } = await import(pathToFileURL(path.join(repo, "src/voice-preview/engine/preview.js")).href);

// ------------------------------------------------------------------ decision constants (diagnosis note §5, §6)
export const RULES = { darker: -0.15, brighter: 0.15, same: 0.1, swingDevice: 0.85, swingSame: 0.9 };
export const NOISE_K = 2.5;                       // band = 2.5 sd of the realization noise (6 realizations per device: t(5) ~ 2.57)
export const NOISE_VARIANTS = [[0, 0], [3, -6], [7, 0], [11, -3], [16, -6], [21, 0]]; // [chunk shift ms, gain dB]
export const ONSET_GUARD_MS = 300;                // a thumb dropout that starts later than this before the next voiced frame is the onset blink
export const FLOOR = { quiet: -54, dropout: -49 }; // the note's §5 step: -53.8 … -49.8 dBFS (brown), -52.4 … -50.2 (pink)

// ------------------------------------------------------------------ sound
export function loadSound(wav) {
  const man = JSON.parse(readFileSync(wav.replace(/\.wav$/, ".json"), "utf8"));
  const f32 = wav.replace(/\.wav$/, ".f32");
  let y;
  if (existsSync(f32)) { const b = readFileSync(f32); y = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); }
  else y = readWav(wav).y;
  return { man, y, env: sourceEnv(y, man.sr) };
}

// ------------------------------------------------------------------ alignment of every occurrence in every segment
export async function alignDevice(D, S) {
  const occ = [];
  D.segments.forEach((seg, si) => {
    if (!seg.sr || seg.chunks.length < 400) return;
    const dev = deviceEnv(seg);
    for (const c of findSound(dev, S.env)) occ.push({ si, coarse: c });
  });
  const out = [];
  for (const o of occ) {
    const seg = D.segments[o.si];
    const al = await alignOccurrence(seg, S.y, S.man, o.coarse, { resampleClip });
    out.push({ si: o.si, seg, ...al });
  }
  return out;
}

// ------------------------------------------------------------------ PCM spans in file time
function devSpan(occ, t0, t1) {
  const P = occ.seg.pcm;
  if (!P) return null;
  const a = Math.round((occ.fileToCt(t0) - P.startCt) * P.sr), b = Math.round((occ.fileToCt(t1) - P.startCt) * P.sr);
  if (a < 0 || b > P.y.length || b <= a) return null;
  return { y: P.y.subarray(a, b), sr: P.sr };
}
const nfftFor = (sr) => (sr >= 32000 ? 8192 : 4096);
function bandsOf(y, sr) { const W = welch(y, sr, 0, y.length, nfftFor(sr)); return { P: thirdOctPowers(W), frames: W.frames }; }
/** Active-speech frames of the source in [t0, t1): 20 ms frames within 25 dB of the span's p95. */
function activeFrames(S, t0, t1) {
  const sr = S.man.sr, F = Math.round(0.02 * sr), out = [];
  const pw = [];
  for (let s = Math.round(t0 * sr); s + F <= Math.round(t1 * sr); s += F) { let e = 0; for (let i = s; i < s + F; i++) e += S.y[i] * S.y[i]; pw.push([s / sr, e / F]); }
  const ref = quant(pw.map((x) => x[1]), 0.95), thr = ref * 10 ** -2.5;
  for (const [t, p] of pw) if (p >= thr) out.push(t);
  return out;
}
/** Band powers of y over the active frames (each frame's 4096/8192-pt spectrum around its centre). */
function maskedBands(getSpan, frames) {
  const acc = new Float64Array(THIRD_OCT.length);
  let n = 0;
  // group consecutive frames into runs, one Welch per run (>= 0.2 s)
  const runs = [];
  for (const t of frames) { const r = runs.at(-1); if (r && t - r[1] <= 0.021) r[1] = t + 0.02; else runs.push([t, t + 0.02]); }
  for (const [a, b] of runs) {
    if (b - a < 0.2) continue;
    const sp = getSpan(a, b);
    if (!sp) continue;
    const W = welch(sp.y, sp.sr, 0, sp.y.length, Math.min(nfftFor(sp.sr), 1 << Math.floor(Math.log2(sp.y.length))));
    if (!W.frames) continue;
    const P = thirdOctPowers(W);
    for (let i = 0; i < P.length; i++) acc[i] += P[i] * W.frames;
    n += W.frames;
  }
  return n ? { P: Array.from(acc, (v) => v / n), frames: n } : null;
}

/** H of one device relative to the source, per method: pink, sweep, speech (active frames of both readers). dB per band; SNR per band. */
export function deviceResponse(S, occ) {
  const m = S.man;
  const src = (t0, t1) => ({ y: S.y.subarray(Math.round(t0 * m.sr), Math.round(t1 * m.sr)), sr: m.sr });
  const floorD = devSpan(occ, ...m.floorWindow);
  if (!floorD) return null;
  const Pf = bandsOf(floorD.y, floorD.sr).P;
  const one = (t0, t1) => {
    const d = devSpan(occ, t0, t1), s = src(t0, t1);
    if (!d) return null;
    const Pd = bandsOf(d.y, d.sr).P, Ps = bandsOf(s.y, s.sr).P;
    return THIRD_OCT.map((fc, i) => ({ fc, db: db(Math.max(Pd[i] - Pf[i], 0.01 * Pd[i]) / Ps[i]), snr: Math.min(120, db(Pd[i] / Pf[i])), covered: true }));
  };
  const pink = one(m.pink[0] + 0.5, m.pink[1] - 0.5);
  const sweep = one(m.sweep.s + 0.05, m.sweep.e - 0.05);
  // the sweep covers a band only if the band lies inside [f0, f1]
  if (sweep) for (const x of sweep) { const [lo, hi] = bandEdges(x.fc); x.covered = lo >= m.sweep.f0 && hi <= m.sweep.f1; }
  let speech = null;
  const fr = m.readers.flatMap((r) => activeFrames(S, r.t0 + 0.5, r.t1 - 0.5));
  const Md = maskedBands((a, b) => devSpan(occ, a, b), fr), Ms = maskedBands((a, b) => src(a, b), fr);
  if (Md && Ms) speech = THIRD_OCT.map((fc, i) => ({ fc, db: db(Math.max(Md.P[i] - Pf[i], 0.01 * Md.P[i]) / Ms.P[i]), snr: Math.min(120, db(Md.P[i] / Pf[i])), covered: true }));
  const floorDb = THIRD_OCT.map((fc, i) => db(Pf[i]));
  return { pink, sweep, speech, floorDb };
}
/** a relative to b per band and method (dB), normalised so the 1 kHz band is 0; reliability flags. */
export function relativeResponse(Ha, Hb, { normalise = true } = {}) {
  const out = {};
  for (const k of ["pink", "sweep", "speech"]) {
    if (!Ha?.[k] || !Hb?.[k]) { out[k] = null; continue; }
    const raw = Ha[k].map((x, i) => x.db - Hb[k][i].db);
    const i1k = THIRD_OCT.indexOf(1000), off = normalise ? raw[i1k] : 0;
    out[k] = THIRD_OCT.map((fc, i) => ({ fc, db: r2(raw[i] - off), snrA: r2(Ha[k][i].snr), snrB: r2(Hb[k][i].snr), ok: Ha[k][i].snr >= 10 && Hb[k][i].snr >= 10 && Ha[k][i].covered !== false }));
  }
  // the estimate used for the FIR: speech (passes a headset's noise filter), else sweep, else pink
  const use = out.speech ? "speech" : out.sweep ? "sweep" : "pink";
  const spread = THIRD_OCT.map((fc, i) => { const v = ["pink", "sweep", "speech"].map((k) => (out[k]?.[i]?.ok ? out[k][i].db : null)).filter((x) => x != null); return v.length > 1 ? Math.max(...v) - Math.min(...v) : null; });
  return { ...out, use, spread: spread.map(r2) };
}
/** FIR (48 kHz, linear phase) from a relative response; unreliable bands (SNR < 10 dB) held from neighbours. */
export function firFromResponse(rel, { N = 1023 } = {}) {
  const H = rel[rel.use];
  if (!H) return null;
  const g = H.map((x) => (x.ok ? x.db : null));
  for (let i = 0; i < g.length; i++) if (g[i] == null) { let j = i - 1; while (j >= 0 && g[j] == null) j--; let k = i + 1; while (k < g.length && g[k] == null) k++; g[i] = j >= 0 && k < g.length ? (g[j] + g[k]) / 2 : j >= 0 ? g[j] : k < g.length ? g[k] : 0; }
  const h = designFir(THIRD_OCT, g, 48000, N);
  return { taps: Array.from(h), target: g.map(r2), achieved: THIRD_OCT.map((f) => r2(firGainDb(h, f, 48000))), from: rel.use };
}

// ------------------------------------------------------------------ levels on the test sound (clipping, quiet playback, where it came from)
/** One device's levels in its test-sound occurrence: peak and clipped share over the whole sound, active speech and pink in dBFS, min speech SNR in 0.8–5 kHz. */
export function soundLevels(S, occ, H) {
  // the whole sound, clamped to what the capture holds (a device may have started after the file's first second)
  const P = occ.seg.pcm;
  if (!P) return null;
  const tOf = (i) => occ.ctToFile(P.startCt + i / P.sr);
  const all = devSpan(occ, Math.max(0.5, tOf(0) + 0.01), Math.min(S.man.durS - 0.5, tOf(P.y.length) - 0.01));
  if (!all) return null;
  let peak = 0, clip = 0;
  for (const v of all.y) { const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.98) clip++; }
  const msq = (sp) => { if (!sp) return null; let e = 0; for (const v of sp.y) e += v * v; return e / sp.y.length; };
  const fr = S.man.readers.flatMap((r) => activeFrames(S, r.t0 + 0.5, r.t1 - 0.5));
  let e = 0, n = 0;
  for (const t of fr) { const sp = devSpan(occ, t, t + 0.02); if (sp) { for (const v of sp.y) e += v * v; n += sp.y.length; } }
  const vtln = (H?.speech ?? []).filter((x) => x.fc >= 800 && x.fc <= 5000).map((x) => x.snr);
  return { peak: r3(peak), clippedSamples: clip, clipped: peak >= 0.98, activeDbfs: r2(n ? db(e / n) : null), pinkDbfs: r2(db(msq(devSpan(occ, S.man.pink[0] + 0.5, S.man.pink[1] - 0.5)) ?? 0)), speechSnrMinDb: r2(vtln.length ? Math.min(...vtln) : null) };
}
/** Clap level (dB, the loudest 25 ms chunk after each clap onset) per device in a clap step; paired a - b. */
export function clapLevels(A, B, step) {
  if (!step?.pc1) return null;
  const one = (D) => {
    const w = devWallOfPc(D.clock);
    const seg = D.segments.find((s) => w(step.pc0) >= s.wall0 - 2000 && w(step.pc0) <= s.wall1 + 2000);
    if (!seg) return [];
    const c0 = seg.ctOfWall(w(step.pc0)) - 0.5, c1 = seg.ctOfWall(w(step.pc1)) + 1.5;
    const C = seg.chunks.filter((c) => c[1] >= c0 && c[1] <= c1).map((c) => [c[1], 10 * Math.log10(c[2] + 1e-12)]);
    if (C.length < 20) return [];
    const base = median(C.map((c) => c[1])), out = [];
    let last = -1;
    for (let i = 1; i < C.length; i++) if (C[i][1] > base + 20 && C[i - 1][1] <= base + 20 && C[i][0] - last > 0.3) { last = C[i][0]; out.push(Math.max(...C.slice(i, i + 5).map((c) => c[1]))); }
    return out;
  };
  const a = one(A), b = one(B);
  return a.length && b.length ? { a: r2(median(a)), b: r2(median(b)), aMinusB: r2(median(a) - median(b)), n: [a.length, b.length] } : null;
}

// ------------------------------------------------------------------ the shown u on the test sound
/** A post's audio time: the worker hook's chunk time, or (run with --worker-hook=0) its arrival on the page mapped to the audio clock (a few tens of ms late). */
export function postCt(D, s) {
  if (s.tm?.ct != null) return s.tm.ct;
  const seg = D.segments.find((g) => s.a >= g.wall0 - 1000 && s.a <= g.wall1 + 1000);
  return seg ? seg.ctOfWall(s.a) : null;
}
const livePosts = (D, occ) => D.rows.state.map((s) => ({ ct: postCt(D, s), u: s.u })).filter((p) => p.ct != null && p.ct >= occ.seg.ct0 - 1e-6 && p.ct <= occ.seg.ct1 + 1e-6);
/** The meter on the test sound: per reader the N level and the 3 / 5 / 8 s excursion peaks. posts: [{ ct, u }] on this occurrence's audio clock (default: the live posts). */
export function soundMetrics(S, D, occ, posts = null) {
  const tEnd = occ.ctToFile(occ.seg.ct1);
  const P = (posts ?? livePosts(D, occ)).map((p) => ({ t: occ.ctToFile(p.ct), u: p.u })).filter((p) => p.u != null && p.t >= -1 && p.t <= tEnd);
  const at = (a, b) => P.filter((p) => p.t >= a && p.t < b).map((p) => p.u);
  const readers = S.man.readers.map((r) => {
    // N level: the N stretches after the readout filled, away from the excursions' after-effect
    const nSpans = r.segs.filter((s) => s.v === "N").map((s, i) => [i === 0 ? s.s + 10 : s.s + 4, s.e]);
    const N = median(nSpans.flatMap(([a, b]) => at(a, b)));
    const ex = S.man.events.filter((e) => e.reader === r.id).map((e) => {
      const sg = e.dir === "up" ? 1 : -1;
      const pre = median(at(e.ts - 3, e.ts));
      const W = P.filter((p) => p.t > e.ts && p.t <= e.after);
      let peak = null, tPeak = null;
      for (const p of W) { const v = sg * (p.u - pre); if (peak === null || v > peak) { peak = v; tPeak = p.t - e.ts; } }
      const t50 = peak > 0 ? W.find((p) => sg * (p.u - pre) >= 0.5 * peak) : null;
      const tAbs = W.find((p) => sg * (p.u - pre) >= 0.5);
      const endLvl = median(at(e.te - 2, e.te));
      return { to: e.to, dir: e.dir, dur: e.dur, ts: e.ts, pre: r3(pre), peak: r3(peak), tPeak: r2(tPeak), t50: r2(t50 ? t50.t - e.ts : null), tAbs05: r2(tAbs ? tAbs.t - e.ts : null), endDisp: r3(endLvl != null && pre != null ? sg * (endLvl - pre) : null) };
    });
    return { id: r.id, sex: r.sex, N: r3(N), excursions: ex };
  });
  return { posts: P.length, readers };
}
export function compareSound(ma, mb) {
  const rows = [];
  for (const ra of ma.readers) {
    const rb = mb.readers.find((x) => x.id === ra.id);
    if (!rb) continue;
    const ex = ra.excursions.map((e, i) => { const f = rb.excursions[i]; return { dur: e.dur, dir: e.dir, peakA: e.peak, peakB: f.peak, ratio: r3(e.peak != null && f.peak > 0.05 ? e.peak / f.peak : null), t50A: e.t50, t50B: f.t50, dT50: r2(e.t50 != null && f.t50 != null ? e.t50 - f.t50 : null) }; });
    rows.push({ id: ra.id, sex: ra.sex, NA: ra.N, NB: rb.N, bias: r3(ra.N != null && rb.N != null ? ra.N - rb.N : null), ex });
  }
  const biases = rows.map((r) => r.bias).filter((x) => x != null);
  const longR = rows.flatMap((r) => r.ex.filter((e) => e.dur >= 8).map((e) => e.ratio)).filter((x) => x != null);
  const shortR = rows.flatMap((r) => r.ex.filter((e) => e.dur < 8).map((e) => e.ratio)).filter((x) => x != null);
  const allPeaks = rows.flatMap((r) => r.ex).filter((e) => e.peakA != null && e.peakB != null);
  const swingSum = allPeaks.length ? allPeaks.reduce((a, e) => a + Math.max(0, e.peakA), 0) / Math.max(1e-6, allPeaks.reduce((a, e) => a + Math.max(0, e.peakB), 0)) : null;
  const ratios = allPeaks.map((e) => e.ratio).filter((x) => x != null);
  return { rows, bias: r3(mean(biases)), biasPerReader: biases, swingLong: r3(median(longR)), swingShort: r3(median(shortR)), swingSum: r3(swingSum),
    events: allPeaks.length, ratioRange: ratios.length ? [r3(Math.min(...ratios)), r3(Math.max(...ratios))] : null, dT50: r2(median(rows.flatMap((r) => r.ex.map((e) => e.dT50)))) };
}

// ------------------------------------------------------------------ realization noise of the same-sound measures
/** Run fn over items with at most `conc` at once. */
async function pool(items, conc, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
function runChild(args) {
  return new Promise((res) => {
    const k = spawn(process.execPath, args, { cwd: repo, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    k.stderr.on("data", (d) => { err += d; });
    k.on("exit", (code) => res({ code, err: err.slice(-2000) }));
  });
}
/** The test-sound span of one capture replayed through the real workers once per NOISE_VARIANTS entry (child processes); soundMetrics of each. */
export async function noiseRealizations(S, D, occ, outDir, tag, { conc = 2, variants = NOISE_VARIANTS, fir = null } = {}) {
  if (!occ.seg.pcm) return null;
  mkdirSync(outDir, { recursive: true });
  const c0 = occ.fileToCt(S.man.sweep.s - 0.5), c1 = occ.fileToCt(S.man.readers.at(-1).t1 + 0.5);
  const res = await pool(variants, conc, async ([ms, g], k) => {
    const f = path.join(outDir, `${tag}-v${k}.json`);
    if (!existsSync(f)) {
      const r = await runChild(["--max-old-space-size=3072", path.join(here, "sbs-replay.mjs"), `--dev=${D.dir}`, `--seg=${occ.si}`, `--ct0=${c0}`, `--ct1=${c1}`, `--shift-ms=${ms}`, `--gain-db=${g}`, "--hints=node", `--posts-out=${f}`, ...(fir ? [`--fir=${fir}`] : [])]);
      if (r.code !== 0) return { shiftMs: ms, gainDb: g, error: r.err };
    }
    const J = JSON.parse(readFileSync(f, "utf8"));
    return { shiftMs: ms, gainDb: g, m: soundMetrics(S, D, occ, J.posts) };
  });
  return res;
}
/** The (reader, excursion) pairs whose peak exists in every metrics set given. */
function goodEvents(sets) {
  const keys = [];
  sets[0].readers.forEach((r, i) => r.excursions.forEach((e, j) => keys.push([i, j])));
  return keys.filter(([i, j]) => sets.every((m) => m.readers[i]?.excursions[j]?.peak != null));
}
const peakSum = (m, good) => good.reduce((a, [i, j]) => a + Math.max(0, m.readers[i].excursions[j].peak), 0);
/** Noise band of the same-sound bias and pooled swing from the realizations of both captures: NOISE_K x sd. */
export function noiseBand(realA, realB) {
  const mA = (realA ?? []).filter((x) => x.m).map((x) => x.m), mB = (realB ?? []).filter((x) => x.m).map((x) => x.m);
  if (mA.length < 3 || mB.length < 3) return null;
  const perReader = mA[0].readers.map((r, i) => ({ id: r.id, sdA: r3(sdOf(mA.map((m) => m.readers[i]?.N))), sdB: r3(sdOf(mB.map((m) => m.readers[i]?.N))) }));
  const ok = perReader.filter((r) => r.sdA != null && r.sdB != null);
  const sigmaBias = ok.length ? Math.sqrt(ok.reduce((a, r) => a + r.sdA ** 2 + r.sdB ** 2, 0)) / ok.length : null;
  const good = goodEvents([...mA, ...mB]);
  const rel = (M) => { const v = M.map((m) => peakSum(m, good)), mu = mean(v); return mu > 0 ? sdOf(v) / mu : null; };
  const relA = rel(mA), relB = rel(mB);
  return { realizations: [mA.length, mB.length], k: NOISE_K, sigmaBias: r3(sigmaBias), bias: r3(sigmaBias != null ? NOISE_K * sigmaBias : null),
    swing: r3(relA != null && relB != null ? NOISE_K * Math.sqrt(relA ** 2 + relB ** 2) : null), relSwingA: r3(relA), relSwingB: r3(relB), perReader, events: good.length };
}
/**
 * Does the measured response explain the meter's same-sound difference? Like for like: the boom's own
 * capture of the test sound, passed through the measured phone / boom response and replayed (realBH),
 * against the boom's capture replayed as it is (realB), on the same readers and events. Expected bias =
 * mean over readers of (mean N through the response - mean N as captured); expected swing = the ratio of
 * the mean pooled peak sums. Compared with the live same-sound bias / swing (ma vs mb) inside
 * NOISE_K x the combined sd (the live difference's realization noise + the expectation's, over its n replays).
 */
export function crossCheck(ma, mb, realA, realB, realBH) {
  const mA = (realA ?? []).filter((x) => x.m).map((x) => x.m), mB = (realB ?? []).filter((x) => x.m).map((x) => x.m), mH = (realBH ?? []).filter((x) => x.m).map((x) => x.m);
  if (!ma || !mb) return null;
  const nR = ma.readers.length;
  const good = goodEvents([ma, mb, ...mA, ...mB, ...mH]);
  const out = { readers: nR, events: good.length };
  const dLive = ma.readers.map((r, i) => (r.N != null && mb.readers[i]?.N != null ? r.N - mb.readers[i].N : null)).filter((x) => x != null);
  out.bias = r3(mean(dLive));
  out.swing = r3(good.length ? peakSum(ma, good) / Math.max(1e-6, peakSum(mb, good)) : null);
  if (mA.length < 3 || mB.length < 3) return out;
  const sdR = (M, i) => sdOf(M.map((m) => m.readers[i]?.N));
  const meanR = (M, i) => mean(M.map((m) => m.readers[i]?.N));
  // the live difference's noise (one realization of each device)
  const varLive = ma.readers.reduce((a, r, i) => a + (sdR(mA, i) ?? 0) ** 2 + (sdR(mB, i) ?? 0) ** 2, 0) / nR ** 2;
  const rel = (M) => { const v = M.map((m) => peakSum(m, good)), mu = mean(v); return mu > 0 ? sdOf(v) / mu : 0; };
  out.bandBias = r3(NOISE_K * Math.sqrt(varLive));
  out.bandSwing = r3(out.swing != null ? NOISE_K * out.swing * Math.sqrt(rel(mA) ** 2 + rel(mB) ** 2) : null);
  out.nullBiasConsistent = Math.abs(out.bias) <= out.bandBias;
  out.nullSwingConsistent = out.swing != null && out.bandSwing != null ? Math.abs(out.swing - 1) <= out.bandSwing : null;
  if (mH.length >= 3) {
    const dExp = ma.readers.map((r, i) => { const h = meanR(mH, i), b = meanR(mB, i); return h != null && b != null ? h - b : null; }).filter((x) => x != null);
    out.expBias = r3(mean(dExp));
    out.expSwing = r3(mean(mH.map((m) => peakSum(m, good))) / Math.max(1e-6, mean(mB.map((m) => peakSum(m, good)))));
    const varExp = ma.readers.reduce((a, r, i) => a + ((sdR(mH, i) ?? 0) ** 2 / mH.length) + ((sdR(mB, i) ?? 0) ** 2 / mB.length), 0) / nR ** 2;
    out.bandBiasCc = r3(NOISE_K * Math.sqrt(varLive + varExp));
    out.bandSwingCc = r3(out.swing != null ? NOISE_K * out.swing * Math.sqrt(rel(mA) ** 2 + rel(mB) ** 2 + (rel(mH) ** 2 + rel(mB) ** 2) / mH.length) : null);
    out.biasConsistent = Math.abs(out.bias - out.expBias) <= out.bandBiasCc;
    out.swingConsistent = out.swing != null && out.bandSwingCc != null ? Math.abs(out.swing - out.expSwing) <= out.bandSwingCc : null;
  }
  return out;
}

// ------------------------------------------------------------------ runtime health
export function health(D) {
  const segs = D.segments.map((s) => ({ ct0: r2(s.ct0), durS: r2(s.ct1 - s.ct0), sr: s.sr, chunkLen: s.chunkLen, holes: s.holes.length, holeS: r3(s.holes.reduce((a, h) => a + h.gapS, 0)),
    clockPpm: r2(s.clockFit.bPpm), dispatchLagMs: { p50: r2(quant(s.dispatchLag, 0.5)), p95: r2(quant(s.dispatchLag, 0.95)), max: r2(Math.max(...s.dispatchLag)) } }));
  const segOf = (ct) => D.segments.find((s) => ct >= s.ct0 - 0.5 && ct <= s.ct1 + 0.5);
  const pitchLag = D.rows.pitch.filter((p) => p[1] != null).map((p) => { const s = segOf(p[1]); return s ? p[0] - s.wallOfCt(p[1]) : null; }).filter((x) => x != null);
  const st = D.rows.state.filter((s) => s.tm);
  const hintLag = st.filter((s) => s.tm.hCt != null).map((s) => s.tm.ct - s.tm.hCt);
  const postLag = st.map((s) => { const g = segOf(s.tm.ct); return g ? s.a - g.wallOfCt(s.tm.ct) : null; }).filter((x) => x != null);
  // resonance worker busy per audio second (per worker instance)
  const byW = {};
  for (const s of st) (byW[s.wid] ??= []).push(s);
  const busy = Object.values(byW).map((a) => { const x = a.at(-1), y = a[0]; const dt = x.tm.ct - y.tm.ct; return dt > 5 ? (x.tm.busy - y.tm.busy) / dt : null; }).filter((x) => x != null);
  const vad = D.rows.wstat.filter((w) => w.type === "vad-status").map((w) => w.status);
  const status = D.rows.wstat.filter((w) => w.type === "status").map((w) => `${w.kind}:${w.status}`);
  const noDecision = D.rows.pitch.length ? D.rows.pitch.filter((p) => p[7] === -1).length / D.rows.pitch.length : null;
  const wall = D.rows.chunk.length ? (D.rows.chunk.at(-1)[0] - D.rows.chunk[0][0]) / 1000 : 0;
  const lt = D.rows.lt;
  const gum = D.rows.gum.filter((g) => g.label != null);
  return {
    segments: segs,
    pitchLagMs: { p50: r2(quant(pitchLag, 0.5)), p95: r2(quant(pitchLag, 0.95)) },
    hintLagS: { p50: r3(quant(hintLag, 0.5)), p95: r3(quant(hintLag, 0.95)), max: r3(hintLag.length ? Math.max(...hintLag) : null) },
    postLagMs: { p50: r2(quant(postLag, 0.5)), p95: r2(quant(postLag, 0.95)) },
    resonanceMsPerS: r2(median(busy)),
    framesDroppedMax: Math.max(0, ...D.rows.state.map((s) => s.framesDropped ?? 0)),
    vadStatuses: [...new Set(vad)], vadSlow: vad.includes("slow"), vadUnavailable: vad.includes("unavailable"), noDecisionShare: r3(noDecision),
    workerStatuses: [...new Set(status)], overloaded: status.some((s) => s.endsWith("overloaded")),
    longTasksPerMin: r2(wall ? lt.length / (wall / 60) : null), longTaskMsPerS: r2(wall ? lt.reduce((a, x) => a + x[1], 0) / wall : null),
    pageErrors: D.rows.err.length, queueDrops: D.drops, pcmDropped: D.pcmDropped ?? null,
    pullErrors: D.meta?.stats?.errors ?? null, reconnects: D.meta?.stats?.reconnects ?? null,
    mic: gum.map((g) => ({ label: g.label, sampleRate: g.settings?.sampleRate, channelCount: g.settings?.channelCount, ns: g.settings?.noiseSuppression, agc: g.settings?.autoGainControl, ec: g.settings?.echoCancellation, latency: g.settings?.latency })),
    trackEvents: D.rows.gum.filter((g) => g.event).map((g) => g.event),
  };
}

// ------------------------------------------------------------------ pause floor and the display regime (what the strip showed)
function resTimeline(D) {
  const tl = { state: [], dot: [] };
  for (const d of D.rows.dom) if (d[1] === 1) { if (d[2] === 0) tl.state.push([d[0], d[3]]); if (d[2] === 2) tl.dot.push([d[0], d[3]]); }
  const valueAt = (arr, w) => { let lo = 0, hi = arr.length - 1, ans = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= w) { ans = arr[m][1]; lo = m + 1; } else hi = m - 1; } return ans; };
  return { tl, valueAt };
}
/**
 * The thumb (data-dot) over one pause, from the last gated-voiced message (page wall wA) to the next (wB).
 * A run of data-dot "0" that starts >= ONSET_GUARD_MS before wB is a dropout INSIDE the pause (the
 * noisy-floor dropout starts ~0.8 s after the last voiced frame); one that starts later is the ONSET
 * blink (the rows go idle ~130 ms before the new pitch paints; the strip shows it up to ~450 ms later
 * through the 200 ms throttle and the 4 Hz tick). In pauses shorter than ~1.5 s the two cannot be told
 * apart: the regime is judged on 1.5–5 s pauses.
 */
export function pauseDisplay(valueAt, tl, wA, wB) {
  const w0 = wA + 150, w1 = wB + 450;
  let goneMs = 0, idle = false, zs = null;
  const runs = [];
  for (let w = w0; w < w1; w += 25) {
    const z = valueAt(tl.dot, w) === "0";
    if (z) { goneMs += 25; if (zs == null) zs = w; } else if (zs != null) { runs.push([zs, w]); zs = null; }
    if (valueAt(tl.state, w) === "idle") idle = true;
  }
  if (zs != null) runs.push([zs, w1]);
  const ins = runs.filter(([a]) => a <= wB - ONSET_GUARD_MS);
  return { gone: runs.length > 0, inside: ins.length > 0, onset: runs.some(([a]) => a > wB - ONSET_GUARD_MS), goneFrac: goneMs / Math.max(1, w1 - w0), idle,
    insideAfterMs: ins.length ? Math.round(ins[0][0] - wA) : null };
}
/** Gated-voiced pitch messages (what the display uses: voiced and not hidden by the voice gate), sorted audio times. */
const gatedVoicedCts = (D) => D.rows.pitch.filter((p) => p[1] != null && p[3] === 1 && p[7] !== 0).map((p) => p[1]).sort((a, b) => a - b);
/** The pause in vct (gap >= minGap) that overlaps [c0, c1] the most; null if none. */
function pauseOver(vct, c0, c1, minGap = 0.5) {
  let best = null;
  for (let i = 1; i < vct.length; i++) {
    const a = vct[i - 1], b = vct[i];
    if (b - a < minGap || b <= c0 || a >= c1) continue;
    const ov = Math.min(b, c1) - Math.max(a, c0);
    if (!best || ov > best.ov) best = { a, b, ov };
  }
  return best;
}
/** The test sound's pause probe: every device hears only its own room in the digital silences. */
export function probeDisplay(S, D, occ) {
  const { tl, valueAt } = resTimeline(D);
  const seg = occ.seg, vct = gatedVoicedCts(D);
  return S.man.probe.silences.filter((z) => occ.fileToCt(z.e) + 0.5 <= seg.ct1 && occ.fileToCt(z.s) >= seg.ct0).map((z) => {
    const ca = occ.fileToCt(z.s), cb = occ.fileToCt(z.e);
    const fl = D.rows.dsp.filter((d) => d[1] != null && d[1] >= ca + 0.1 && d[1] <= cb - 0.02 && d[2] != null).map((d) => (d[2] === -999 ? -120 : d[2]));
    const p = pauseOver(vct, ca, cb, 0.3);
    const g = p ? pauseDisplay(valueAt, tl, seg.wallOfCt(p.a), seg.wallOfCt(p.b)) : null;
    return { durS: z.e - z.s, floorDb: r2(median(fl)), found: !!p, pauseS: p ? r2(p.b - p.a) : null, ...(g ?? {}), goneFrac: g ? r2(g.goneFrac) : null };
  });
}
/** The cued "pauseN-quiet" steps (3 s of silence after a sentence): the actual pause found around the cue (the owner may start early or late). */
export function cuedSilences(D, steps) {
  const { tl, valueAt } = resTimeline(D);
  const w = devWallOfPc(D.clock), vct = gatedVoicedCts(D);
  return steps.filter((x) => /^pause\d-quiet$/.test(x.name) && x.pc1).map((x) => {
    const seg = D.segments.find((s) => w(x.pc0) >= s.wall0 - 2000 && w(x.pc0) <= s.wall1 + 2000);
    if (!seg) return { step: x.name, found: false };
    const p = pauseOver(vct, seg.ctOfWall(w(x.pc0)), seg.ctOfWall(w(x.pc1)), 1.0);
    if (!p) return { step: x.name, found: false };
    const g = pauseDisplay(valueAt, tl, seg.wallOfCt(p.a), seg.wallOfCt(p.b));
    return { step: x.name, found: true, pauseS: r2(p.b - p.a), inside: g.inside, onset: g.onset, insideAfterMs: g.insideAfterMs, goneFrac: r2(g.goneFrac) };
  });
}
/** Claps in a step: onsets in both captures, paired; residual = (PC time of the onset on a) - (on b) via each device's clock sync + audio clock map. */
export function clapResidual(A, B, step) {
  if (!step?.pc1) return null;
  const onsets = (D) => {
    const w = devWallOfPc(D.clock), pcOf = pcOfDev(D.clock);
    const seg = D.segments.find((s) => w(step.pc0) >= s.wall0 - 2000 && w(step.pc0) <= s.wall1 + 2000);
    if (!seg) return [];
    const c0 = seg.ctOfWall(w(step.pc0)) - 0.5, c1 = seg.ctOfWall(w(step.pc1)) + 1.5;
    const C = seg.chunks.filter((c) => c[1] >= c0 && c[1] <= c1).map((c) => [c[1], 10 * Math.log10(c[2] + 1e-12)]);
    if (C.length < 20) return [];
    const base = median(C.map((c) => c[1]));
    const out = [];
    let last = -1;
    for (let i = 1; i < C.length; i++) if (C[i][1] > base + 20 && C[i - 1][1] <= base + 20 && C[i][0] - last > 0.3) { out.push(pcOf(seg.wallOfCt(C[i][0]))); last = C[i][0]; }
    return out;
  };
  const a = onsets(A), b = onsets(B);
  const d = [];
  for (const x of a) { let best = null; for (const y of b) if (best == null || Math.abs(x - y) < Math.abs(x - best)) best = y; if (best != null && Math.abs(x - best) < 300) d.push(x - best); }
  return { onsetsA: a.length, onsetsB: b.length, pairs: d.length, residualMs: r2(median(d)), spreadMs: r2(d.length ? Math.max(...d) - Math.min(...d) : null) };
}
function pcOfDev(clock) { const w = devWallOfPc(clock); return (wl) => { let pc = wl; for (let i = 0; i < 3; i++) pc = wl - (w(pc) - pc); return pc; }; }
export function displayRegime(D, { ranges = null } = {}) {
  const segOf = (ct) => D.segments.find((s) => ct >= s.ct0 - 0.5 && ct <= s.ct1 + 0.5);
  const inR = (w) => !ranges || ranges.some(([a, b]) => w >= a && w < b);
  const vct = gatedVoicedCts(D);
  // pauses: runs >= 0.3 s between gated-voiced messages (within one segment)
  const pauses = [];
  for (let i = 1; i < vct.length; i++) { const g = vct[i] - vct[i - 1]; if (g >= 0.3 && g < 30) pauses.push([vct[i - 1], vct[i]]); }
  // the resonance column's timeline from the MutationObserver (state, dot)
  const { tl, valueAt } = resTimeline(D);
  const cls = { short: [], mid: [], long: [], judged: [] };
  for (const [a, b] of pauses) {
    const s = segOf(a); if (!s) continue;
    const wA = s.wallOfCt(a), wB = s.wallOfCt(b);
    if (!inR(wA + 150)) continue;
    const g = pauseDisplay(valueAt, tl, wA, wB);
    const d = b - a;
    (d < 1 ? cls.short : d < 5 ? cls.mid : cls.long).push(g);
    if (d >= 1.5 && d < 5) cls.judged.push(g);
  }
  const pct = (x, f) => (x.length ? r2((100 * x.filter(f).length) / x.length) : null);
  const sumCls = (x) => ({ n: x.length, gonePct: pct(x, (y) => y.gone), goneInsidePct: pct(x, (y) => y.inside), goneAtOnsetPct: pct(x, (y) => y.onset && !y.inside),
    goneTimePct: x.length ? r2(100 * mean(x.map((y) => y.goneFrac))) : null, idlePct: pct(x, (y) => y.idle), insideAfterMsMedian: r2(median(x.map((y) => y.insideAfterMs))) });
  // onset blinks: idle runs <= 300 ms between two non-idle states
  let blinks = 0;
  for (let i = 1; i + 1 < tl.state.length; i++) if (tl.state[i][1] === "idle" && tl.state[i + 1][0] - tl.state[i][0] <= 300 && tl.state[i - 1][1] !== "idle" && inR(tl.state[i][0])) blinks++;
  // samples: trail and streak
  const sm = D.rows.samp.filter((x) => x[9] === 1 && inR(x[0]));
  const trail = sm.map((x) => x[7]).filter((x) => x != null);
  const speakingS = sm.length * 0.25;
  // pause floor: DSP intensity of frames > 0.5 s from any gated-voiced message
  const dsp = D.rows.dsp.filter((d) => d[1] != null && d[2] != null);
  let j = 0;
  const floor = [];
  for (const d of dsp) {
    const s = segOf(d[1]); if (!s || !inR(s.wallOfCt(d[1]))) continue;
    while (j + 1 < vct.length && vct[j + 1] <= d[1]) j++;
    const near = Math.min(Math.abs(d[1] - (vct[j] ?? -1e9)), Math.abs((vct[j + 1] ?? 1e9) - d[1]));
    if (near > 0.5) floor.push(d[2] === -999 ? -120 : d[2]);
  }
  return {
    pauses: { short: sumCls(cls.short), mid: sumCls(cls.mid), long: sumCls(cls.long), judged: sumCls(cls.judged) },
    onsetBlinksPerMin: r2(speakingS ? blinks / (speakingS / 60) : null),
    trailMean: r2(mean(trail)), trailMedian: median(trail), streakDrawnPct: r2(sm.length ? (100 * sm.filter((x) => x[8] >= 3).length) / sm.length : null),
    thumbShownPct: r2(sm.length ? (100 * sm.filter((x) => x[6] === "1").length) / sm.length : null),
    floor: { n: floor.length, q10: r2(quant(floor, 0.1)), median: r2(quant(floor, 0.5)), q90: r2(quant(floor, 0.9)), below50Pct: r2(floor.length ? (100 * floor.filter((x) => x < -50).length) / floor.length : null) },
  };
}
/** The pause regime: what the screen showed in 1.5–5 s pauses decides when there are >= 3 of them; else the floor (with the note's transition band). */
export function regimeOf(floorMedian, judged) {
  const byFloor = floorMedian == null ? null : floorMedian >= FLOOR.dropout ? "dropout" : floorMedian >= FLOOR.quiet ? "near" : "quiet";
  const byScreen = judged && judged.n >= 3 && judged.goneInsidePct != null ? (judged.goneInsidePct >= 50 ? "dropout" : judged.goneInsidePct > 15 ? "near" : "quiet") : null;
  return { regime: byScreen ?? byFloor, byScreen, byFloor };
}
const REGIME_TEXT = {
  dropout: "DROPOUT regime: the thumb and the pitch number vanish ~0.8 s into each pause",
  near: `NEAR THE THRESHOLD (${FLOOR.quiet} … ${FLOOR.dropout} dBFS): the thumb flickers in pauses, sometimes vanishing, sometimes dimmed`,
  quiet: "QUIET regime: the thumb and the pitch number stay dimmed up to 5 s in a pause",
};
/** The logged posts vs what the strip showed: each data-value change of the resonance column equals the u of one of the 3 latest posts before it. */
export function postsVsDom(D) {
  const st = D.rows.state.filter((s) => s.u != null);
  const vals = D.rows.dom.filter((d) => d[1] === 1 && d[2] === 1 && d[3] !== "");
  let ok = 0, bad = 0, i = 0;
  const badEx = [];
  for (const d of vals) {
    while (i + 1 < st.length && st[i + 1].a <= d[0]) i++;
    const cand = [st[i], st[i - 1], st[i - 2]].filter(Boolean).map((s) => String(Math.round(s.u * 1000) / 1000));
    if (cand.includes(d[3])) ok++; else { bad++; if (badEx.length < 5) badEx.push({ dom: d[3], posts: cand }); }
  }
  return { checked: ok + bad, equal: ok, mismatch: bad, examples: badEx };
}

// ------------------------------------------------------------------ own-voice steps
export function devWallOfPc(clock) {
  const c = (clock ?? []).filter((x) => Number.isFinite(x?.offset)).sort((a, b) => a.pc - b.pc);
  if (!c.length) return (pc) => pc;
  if (c.length === 1) return (pc) => pc + c[0].offset;
  const f = linfit(c.map((x) => x.pc), c.map((x) => x.offset));
  return (pc) => pc + f.a + f.b * pc;
}
export function stepMetrics(D, steps) {
  const w = devWallOfPc(D.clock);
  const segAtWall = (wl) => D.segments.find((s) => wl >= s.wall0 - 2000 && wl <= s.wall1 + 2000);
  const st = D.rows.state.filter((s) => s.u != null).map((s) => ({ u: s.u, tm: { ct: postCt(D, s) } })).filter((s) => s.tm.ct != null);
  const out = {};
  for (const step of steps) {
    if (step.pc1 == null || step.pc1 - step.pc0 < 1000) continue;
    const w0 = w(step.pc0), w1 = w(step.pc1), seg = segAtWall(w0);
    if (!seg) continue;
    const c0 = seg.ctOfWall(w0), c1 = seg.ctOfWall(w1);
    const u = st.filter((s) => s.tm.ct >= c0 + 1 && s.tm.ct <= c1).map((s) => s.u);
    const tail = st.filter((s) => s.tm.ct >= c1 - 3 && s.tm.ct <= c1).map((s) => s.u);
    const all = st.filter((s) => s.tm.ct > c0 && s.tm.ct <= c1 + 2).map((s) => ({ t: s.tm.ct - c0, u: s.u }));
    out[step.name] = { n: u.length, med: r3(median(u)), tail: r3(median(tail)), all, c0, c1, seg: D.segments.indexOf(seg) };
  }
  return out;
}
export function ownVoice(ma, mb) {
  const names = Object.keys(ma).filter((k) => mb[k]);
  const holds = names.filter((n) => /^hold\d-(brighter|darker)$/.test(n));
  const swing = (m) => {
    const d = holds.map((n) => {
      const idx = Number(n.match(/^hold(\d)/)[1]), prev = m[`hold${idx - 1}-normal`] ?? m.read;
      return prev && m[n] ? (n.includes("brighter") ? 1 : -1) * ((m[n].tail ?? m[n].med) - (prev.tail ?? prev.med)) : null;
    }).filter((x) => x != null);
    return d.length ? mean(d) : null;
  };
  const tries = names.filter((n) => /^try\d-(brighter|darker)$/.test(n));
  const tryPeak = (m) => {
    const d = tries.map((n) => {
      const idx = Number(n.match(/^try(\d)/)[1]), prev = m[`try${idx - 1}-normal`] ?? m["hold8-normal"] ?? m.read;
      const sg = n.includes("brighter") ? 1 : -1;
      if (!prev || !m[n]) return null;
      const ref = prev.tail ?? prev.med;
      const w = m[n].all.filter((x) => x.t <= 5.5);
      return w.length ? Math.max(...w.map((x) => sg * (x.u - ref))) : null;
    }).filter((x) => x != null);
    return d.length ? mean(d) : null;
  };
  const sa = swing(ma), sb = swing(mb), ta = tryPeak(ma), tb = tryPeak(mb);
  const per = names.filter((n) => !n.endsWith("-set") && !n.endsWith("-quiet") && !n.includes("place") || /^place-[a-z]+$/.test(n)).map((n) => ({ step: n, a: ma[n].med, b: mb[n].med, diff: r3(ma[n].med != null && mb[n].med != null ? ma[n].med - mb[n].med : null) }));
  return { holdSwingA: r3(sa), holdSwingB: r3(sb), holdSwingRatio: r3(sa != null && sb > 0.05 ? sa / sb : null), tryPeakA: r3(ta), tryPeakB: r3(tb), tryRatio: r3(ta != null && tb > 0.05 ? ta / tb : null), readBias: per.find((p) => p.step === "read")?.diff ?? null, placements: per.filter((p) => p.step.startsWith("place-")), steps: per };
}
/** Own-voice SNR in vtln's band (0.8–5 kHz) from the PCM: active speech in the read step vs the room step. */
export function ownSnr(D, stepsM) {
  const seg = (m) => m && D.segments[m.seg];
  const band = (m, active) => {
    const s = seg(m); if (!s?.pcm) return null;
    const a = Math.round((m.c0 + 0.5 - s.pcm.startCt) * s.pcm.sr), b = Math.round((m.c1 - s.pcm.startCt) * s.pcm.sr);
    if (a < 0 || b > s.pcm.y.length || b - a < s.pcm.sr) return null;
    const y = s.pcm.y.subarray(a, b), F = Math.round(0.064 * s.pcm.sr);
    const fr = [];
    for (let i = 0; i + F <= y.length; i += F) {
      const W = welch(y, s.pcm.sr, i, i + F, 1 << Math.floor(Math.log2(F)));
      let p = 0; for (let k = 0; k < W.psd.length; k++) if (k * W.df >= 800 && k * W.df < 5000) p += W.psd[k];
      fr.push(p);
    }
    if (!fr.length) return null;
    if (!active) return db(median(fr));
    const ref = quant(fr, 0.95), act = fr.filter((p) => p >= ref * 10 ** -2.5);
    return db(mean(act));
  };
  const sp = band(stepsM.read, true), fl = band(stepsM.room, false);
  return { speechDb: r2(sp), roomDb: r2(fl), snrDb: r2(sp != null && fl != null ? sp - fl : null) };
}

// ------------------------------------------------------------------ (a): the prediction decides
/** Seeded bootstrap 95 % CI of the median over readers. */
function bootMedianCi(vals, n = 2000) {
  const v = vals.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 3) return null;
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const meds = [];
  for (let i = 0; i < n; i++) meds.push(median(Array.from(v, () => v[Math.floor(rnd() * v.length)])));
  return [r3(quant(meds, 0.025)), r3(quant(meds, 0.975))];
}
/** §6 on the predicted bias / steady sensitivity (12 public readers through the measured response). */
export function decideA(pred) {
  if (!pred || pred.bias == null || pred.sens == null) return { rule: "undecided", why: pred?.error ?? "no prediction (no transfer function, or the analysis ran with --no-predict)" };
  const b = pred.bias, s = pred.sens;
  const ciB = bootMedianCi((pred.perReader ?? []).map((x) => x.bias)), ciS = bootMedianCi((pred.perReader ?? []).map((x) => x.sens));
  let rule;
  if (b <= RULES.darker || s <= RULES.swingDevice) rule = "device";
  else if (b >= RULES.brighter) rule = "device-brighter";
  else if (Math.abs(b) <= RULES.same && s >= RULES.swingSame) rule = "not-device";
  else rule = "between";
  const crosses = (ci, ts) => ci && ts.some((t) => ci[0] < t && ci[1] > t);
  const near = crosses(ciB, [RULES.darker, -RULES.same, RULES.same, RULES.brighter]) || crosses(ciS, [RULES.swingDevice, RULES.swingSame]);
  return { rule, bias: b, sens: s, ciBias: ciB, ciSens: ciS, nearThreshold: !!near, exc: pred.summary?.all ? { exc3: pred.summary.all.exc3, exc5: pred.summary.all.exc5, exc8: pred.summary.all.exc8 } : null, n: pred.summary?.all?.n ?? null };
}
// ------------------------------------------------------------------ the verdict
const NOISE_SENS = [[10, 0.47], [20, 0.8], [30, 0.94], [40, 1]]; // pink SNR -> median sensitivity (§3, m/f pooled)
const sensFromSnr = (snr) => { if (snr == null) return null; if (snr <= NOISE_SENS[0][0]) return NOISE_SENS[0][1]; for (let i = 1; i < NOISE_SENS.length; i++) if (snr <= NOISE_SENS[i][0]) { const [a, va] = NOISE_SENS[i - 1], [b, vb] = NOISE_SENS[i]; return va + ((snr - a) / (b - a)) * (vb - va); } return 1; };
export function verdict(R) {
  const L = [];
  const ha = R.health?.a, hb = R.health?.b;
  const runtimeFlags = [];
  for (const [n, h] of [["a", ha], ["b", hb]]) {
    if (!h) continue;
    if (h.segments.some((s) => s.holes > 0)) runtimeFlags.push(`${n}: capture holes`);
    if (h.hintLagS.p95 > 0.3) runtimeFlags.push(`${n}: relay lag p95 ${h.hintLagS.p95} s`);
    if (h.vadSlow) runtimeFlags.push(`${n}: voice detector switched off as slow`);
    if (h.framesDroppedMax > 4) runtimeFlags.push(`${n}: ${h.framesDroppedMax} pitch frames reached the resonance worker after their audio (dropped)`); // 1–4 at start-up is harmless
    if (h.overloaded) runtimeFlags.push(`${n}: resonance worker overloaded`);
  }
  // ---- (a)
  const A = R.decisionA ?? decideA(R.predict);
  const ci = (c) => (c ? ` (95 % CI ${c[0]} … ${c[1]})` : "");
  if (A.rule === "undecided") L.push(`(a) UNDECIDED: ${A.why}. The same-sound meter readings below are a cross-check only; they are too noisy to decide.`);
  else {
    L.push(`(a) The phone / boom response measured on the same test sound, applied to ${A.n ?? "?"} public readers (sbs-predict): the phone path reads ${sgn(A.bias)} u${ci(A.ciBias)} and swings ${r3(A.sens)} of the boom${ci(A.ciSens)}; short excursions 3 / 5 / 8 s ${A.exc?.exc3 ?? "?"} / ${A.exc?.exc5 ?? "?"} / ${A.exc?.exc8 ?? "?"}.`);
    const why = [];
    if (A.bias <= RULES.darker) why.push(`>= ${-RULES.darker} u darker`);
    if (A.sens <= RULES.swingDevice) why.push(`swing <= ${RULES.swingDevice}`);
    if (A.rule === "device") L.push(`    -> Decision rule §6 (${why.join(" and ")}): the DEVICE / MIC PATH — the phone's microphone response ${A.bias <= RULES.darker ? "reads darker" : "compresses the swing"}.`);
    else if (A.rule === "device-brighter") L.push(`    -> The phone path reads BRIGHTER by ${r3(A.bias)} u (>= ${RULES.brighter}): a device effect, but not the darker reading that was reported; the darker reading must come from placement, noise or the reference (below).`);
    else if (A.rule === "not-device") L.push(`    -> Decision rule §6 (within +-${RULES.same} u and swing >= ${RULES.swingSame}): NOT the device / mic path; look at placement, room noise and the reference (below).`);
    else L.push(`    -> Between the rules (bias ${sgn(A.bias)} u: ${Math.abs(A.bias) > RULES.same ? `beyond +-${RULES.same} but not ${A.bias < 0 ? `<= ${RULES.darker}` : `>= ${RULES.brighter}`}` : "small"}; swing ${r3(A.sens)}: ${A.sens < RULES.swingSame ? `under ${RULES.swingSame} but above ${RULES.swingDevice}` : "full"}): a partial device effect; read the response and the placements below.`);
    if (A.nearThreshold) L.push("    (The CI crosses a decision threshold: the call is close.)");
  }
  const rel = R.response?.relative;
  if (rel?.[rel.use]) {
    const H = rel[rel.use];
    const big = H.filter((x) => x.ok && Math.abs(x.db) >= 3).map((x) => `${x.fc} Hz ${x.db > 0 ? "+" : ""}${x.db} dB`);
    L.push(`    Phone / boom response (${rel.use}, re 1 kHz): ${big.length ? big.join(", ") : "within +-3 dB in every reliable band"}.`);
    const sp = THIRD_OCT.map((fc, i) => [fc, rel.spread[i]]).filter(([fc, v]) => fc >= 800 && fc <= 5000 && v != null);
    const worst = sp.reduce((m, x) => (x[1] > (m?.[1] ?? -1) ? x : m), null);
    if (worst && worst[1] >= 3) L.push(`    !! The pink / sweep / speech estimates disagree by up to ${worst[1]} dB at ${worst[0]} Hz (vtln's band): one path processes steady sounds differently (likely the headset's noise filter${R.session?.headsetNoiseFilter ? `, set to "${R.session.headsetNoiseFilter}"` : ""}). The FIR uses the speech estimate; to check the reference, run a --protocol=sound session with the filter off.`);
  }
  const lv = R.levels;
  if (lv) {
    for (const [n, x] of [["phone", lv.a], ["boom", lv.b]]) {
      if (!x) continue;
      if (x.clipped) L.push(`    !! The ${n} CLIPPED on the test sound (peak ${x.peak}, ${x.clippedSamples} samples >= 0.98): turn the loudspeaker down and repeat the sound step.`);
      if (x.speechSnrMinDb != null && x.speechSnrMinDb < 20) L.push(`    !! The test sound was quiet against the room on the ${n} (speech SNR down to ${x.speechSnrMinDb} dB in 0.8–5 kHz): louder playback would sharpen the response.`);
    }
    if (lv.check) L.push(`    ${lv.check}`);
  }
  // the cross-check: the meter on the same sound vs what the measured response predicts on the same events
  const X = R.crossCheck;
  if (X) {
    const band = (v) => (v != null ? ` ± ${v}` : "");
    let line = `    Cross-check, the meter on the same sound (${X.readers} readers, ${X.events} excursions; noise band = ${NOISE_K} sd of ${R.noise?.band?.realizations?.join(" + ") ?? "?"} replays of each capture with another chunk phase and level): phone - boom ${sgn(X.bias)}${band(X.bandBias)} u, swing ${X.swing ?? "?"}${band(X.bandSwing)}`;
    if (X.expBias != null) {
      line += `; the measured response predicts, on these same events (the boom's capture through it, replayed), ${sgn(X.expBias)} u and swing ${X.expSwing}`;
      if (X.biasConsistent && X.swingConsistent !== false) line += ": CONSISTENT — the frequency response explains the meter's difference on the same sound.";
      else line += `: NOT consistent (${[X.biasConsistent ? null : `bias off by ${sgn(X.bias - X.expBias)} u, band ±${X.bandBiasCc}`, X.swingConsistent === false ? `swing off by ${sgn(X.swing - X.expSwing)}, band ±${X.bandSwingCc}` : null].filter(Boolean).join("; ")}): something beyond a fixed frequency response differs on the same sound (a noise filter, gain control or compression in one path, or the runtime: see the replay line).`;
    } else line += " (no like-for-like expectation: run with the noise replays).";
    L.push(line);
  } else if (R.sound?.compare) L.push(`    Cross-check: the meter on the same sound reads ${sgn(R.sound.compare.bias)} u, swing ${R.sound.compare.swingSum ?? "?"} (no noise band: run without --no-noise; on its own this is too noisy to decide anything).`);
  const rp = R.replayCheck?.a;
  if (rp) L.push(`    Replay of the phone's own capture through the real workers in Node: ${rp.reproduces ? "the live meter equals its audio replayed (the phone's runtime changes nothing)" : "the live meter DIFFERS from its audio replayed (the phone's runtime changes the value)"} — same-sound N levels within ${rp.maxAbsDN ?? "?"} u (tolerance ${rp.tol}), ${rp.over005Pct ?? "?"} % of posts differ by > 0.05 u (p95 ${rp.p95 ?? "?"}).`);
  // ---- (b) the smaller swing
  const why = [];
  const ov = R.ownVoice;
  if (ov?.holdSwingRatio != null) L.push(`(b) Own voice: held brighter / darker swing on the phone ${ov.holdSwingA} u vs boom ${ov.holdSwingB} u (ratio ${ov.holdSwingRatio}); 3 s tries ${ov.tryPeakA} vs ${ov.tryPeakB} (ratio ${ov.tryRatio}).`);
  else L.push("(b) No own-voice holds in this session.");
  if (A.sens != null && A.sens <= RULES.swingSame) why.push(`channel: the measured response predicts sensitivity ${r3(A.sens)}`);
  const snr = R.snr?.a?.snrDb;
  if (snr != null) { const s = sensFromSnr(snr); if (s < 0.9) why.push(`room noise: phone SNR ${snr} dB in 0.8–5 kHz (rough, from the note's pink-noise table: sensitivity ~${r2(s)})`); else L.push(`    Phone own-voice SNR ${snr} dB in 0.8–5 kHz: room noise does not compress the swing (>= ~25 dB).`); }
  if (runtimeFlags.length) why.push(`runtime: ${runtimeFlags.join("; ")}`);
  if (rp && !rp.reproduces) why.push("runtime: the live meter differs from the replay of its own audio");
  const shortExc = A.exc ? mean([A.exc.exc3, A.exc.exc5]) : null;
  if (shortExc != null && A.sens != null && A.sens < 0.97 && shortExc < A.sens - 0.1) why.push(`restart rule: the predicted 3 / 5 s excursions shrink more (${A.exc.exc3} / ${A.exc.exc5}) than the steady swing (${r3(A.sens)}); the fixed 0.6 u restart threshold amplifies a smaller swing`);
  L.push(`    Smaller swing — supported by: ${why.length ? why.join(" | ") : "none of channel / room noise / runtime"}.`);
  // ---- (c) pause floor and the display regime
  const da = R.display?.a;
  if (da && R.display.fromSteps) {
    const rg = regimeOf(da.floor.median, da.pauses.judged);
    const j = da.pauses.judged;
    L.push(`(c) Phone pause floor (room step + pauses of your own speech): median ${da.floor.median} dBFS (q10 ${da.floor.q10}, q90 ${da.floor.q90}), ${da.floor.below50Pct} % of pause frames below -50 dBFS.`);
    L.push(`    On screen, in ${j.n} pauses of 1.5–5 s: thumb gone INSIDE the pause in ${j.goneInsidePct ?? "-"} %${j.insideAfterMsMedian != null ? ` (a median ${j.insideAfterMsMedian} ms after the last voiced frame)` : ""}, only at the next onset (the onset blink) in ${j.goneAtOnsetPct ?? "-"} %; onset blinks ${da.onsetBlinksPerMin}/min; trail ${da.trailMean} points; streak drawn ${da.streakDrawnPct} % of listening time.`);
    L.push(`    -> ${rg.regime ? REGIME_TEXT[rg.regime] : "no regime (no pauses, no floor)"}${rg.byScreen ? " (decided by what the screen showed" + (rg.byFloor && rg.byFloor !== rg.byScreen ? `; the floor alone would say ${rg.byFloor}` : "; the floor says the same") + ")" : rg.byFloor ? " (from the floor: too few 1.5–5 s pauses on screen)" : ""}.`);
  }
  const pa = R.sound?.probeA;
  if (pa?.length && median(pa.map((x) => x.floorDb)) != null) {
    const fl = median(pa.map((x) => x.floorDb));
    const f = (P) => `inside ${P.filter((x) => x.inside).length}/${P.length}, at the next onset ${P.filter((x) => x.onset && !x.inside).length}/${P.length}`;
    L.push(`${R.display?.fromSteps ? "   " : "(c)"} Test sound's pause probe (each device hears only its room in the gaps): phone floor ${r2(fl)} dBFS (${regimeOf(fl, null).byFloor}); thumb gone ${f(pa)}${R.sound.probeB ? `; boom floor ${r2(median(R.sound.probeB.map((x) => x.floorDb)))} dBFS, ${f(R.sound.probeB)}` : ""}.`);
  }
  if (R.silences?.a?.length) {
    const fa = R.silences.a.filter((x) => x.found);
    L.push(`    The four cued 3 s silences on the phone (the actual pause found around each cue: ${fa.length}/${R.silences.a.length}): thumb gone INSIDE in ${fa.filter((x) => x.inside).length}, only at the next onset in ${fa.filter((x) => x.onset && !x.inside).length} (boom: ${R.silences.b ? `${R.silences.b.filter((x) => x.found && x.inside).length}/${R.silences.b.filter((x) => x.found).length} inside` : "-"}).`);
  }
  const db_ = R.display?.b;
  if (db_ && R.display.fromSteps) { const rb = regimeOf(db_.floor.median, db_.pauses.judged); L.push(`    Boom (desktop) pause floor: median ${db_.floor.median} dBFS; thumb gone inside ${db_.pauses.judged.goneInsidePct ?? "-"} % of ${db_.pauses.judged.n} pauses of 1.5–5 s -> ${rb.regime ?? "-"}.`); }
  if (ov?.placements?.length) L.push(`    Placements (phone - boom, own voice): ${ov.placements.map((p) => `${p.step.replace("place-", "")} ${p.diff == null ? "-" : (p.diff > 0 ? "+" : "") + p.diff}`).join(", ")}; reading as reported: ${ov.readBias ?? "-"} u.`);
  if (runtimeFlags.length === 0 && ha) L.push("Runtime: no capture holes, relay lag within 0.3 s, no slow / overloaded worker on either device.");
  else if (runtimeFlags.length) L.push(`Runtime flags: ${runtimeFlags.join("; ")}.`);
  return { rule: A.rule, decisionA: A, runtimeFlags, text: L.join("\n") };
}

// ------------------------------------------------------------------ prediction (a child process: sbs-predict.mjs)
export function runPredict(firPath, name, { only = [], shards = 4 } = {}) {
  const r = spawnSync(process.execPath, [path.join(here, "sbs-predict.mjs"), `--fir=${firPath}`, `--name=${name}`, `--shards=${shards}`, ...(only.length ? [`--only=${only.join(",")}`] : [])],
    { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`sbs-predict failed: ${(r.stderr || r.stdout).slice(-1500)}`);
  return JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/sbs/predict", name, "report.json"), "utf8"));
}

// ------------------------------------------------------------------ main
export async function analyze({ devA, devB, nameA = "phone", nameB = "desktop", session = null, soundPath, out, predict = false, predictOnly = [], shards = 4, replay = false, hook = false, noise = false, noiseConc = 2 }) {
  const S = loadSound(soundPath);
  const A = loadDevice(devA), B = devB ? loadDevice(devB) : null;
  const R = { a: nameA, b: nameB, devA, devB, session: session ? { headsetNoiseFilter: session.headsetNoiseFilter ?? null, playPcDevice: session.playPcDevice ?? null, stoppedBy: session.stoppedBy ?? null } : null, sound: {}, health: {}, display: {}, response: {}, notes: [] };
  R.health.a = health(A); if (B) R.health.b = health(B);
  const occA = await alignDevice(A, S), occB = B ? await alignDevice(B, S) : [];
  const occSum = (o) => o.map((x) => ({ seg: x.si, ct0: r3(x.ct0), k: x.k, ppm: r2((x.k - 1) * 1e6), method: x.method, coarseR: r3(x.coarse.r), envA: r3(x.env.A.ct0), envB: r3(x.env.B.ct0), envR: r3(x.env.A.r), pcmR: x.pcm ? [r3(x.pcm.A.r), r3(x.pcm.B.r)] : null,
    envVsFinalMs: r2((x.envFileToCt(S.man.durS / 2) - x.fileToCt(S.man.durS / 2)) * 1000) }));
  R.sound.occurrencesA = occSum(occA); R.sound.occurrencesB = occSum(occB);
  // same-sound comparison: the first occurrence in each (the dongle step's second occurrence of A, if any, compared too)
  if (occA.length) R.sound.a = soundMetrics(S, A, occA[0]);
  if (occB.length) R.sound.b = soundMetrics(S, B, occB[0]);
  if (R.sound.a && R.sound.b) R.sound.compare = compareSound(R.sound.a, R.sound.b);
  if (occA.length) R.sound.probeA = probeDisplay(S, A, occA[0]);
  if (occB.length) R.sound.probeB = probeDisplay(S, B, occB[0]);
  if (occA.length > 1 && R.sound.b) { R.sound.a2 = soundMetrics(S, A, occA[1]); R.sound.compare2 = compareSound(R.sound.a2, R.sound.b); R.notes.push("second occurrence on the phone (the dongle step?) compared with the boom too: compare2"); }
  // transfer function, levels
  if (occA.length && occB.length) {
    const Ha = deviceResponse(S, occA[0]), Hb = deviceResponse(S, occB[0]);
    R.levels = { a: soundLevels(S, occA[0], Ha), b: soundLevels(S, occB[0], Hb) };
    const clap = clapLevels(A, B, session?.steps?.find((x) => x.name === "claps"));
    if (clap && R.levels.a?.activeDbfs != null && R.levels.b?.activeDbfs != null) {
      R.levels.clap = clap;
      const soundAB = R.levels.a.activeDbfs - R.levels.b.activeDbfs, d = r2(soundAB - clap.aMinusB);
      R.levels.soundMinusClapDb = d;
      if (Math.abs(d) > 10) R.levels.check = `!! On the test sound the phone heard ${r2(soundAB)} dB against the boom, on the claps ${clap.aMinusB} dB: the sound seems to have come from much closer to the ${d < 0 ? "boom (the Maxwell's ear cups?)" : "phone"} than the claps. Check where it played.`;
    }
    if (Ha && Hb) {
      R.response.a = Ha; R.response.b = Hb;
      R.response.relative = relativeResponse(Ha, Hb);
      R.response.relativeRaw = relativeResponse(Ha, Hb, { normalise: false });
      const fir = firFromResponse(R.response.relative);
      if (fir) {
        mkdirSync(out, { recursive: true });
        const fp = path.join(out, `fir-${nameA}-over-${nameB}.json`);
        writeFileSync(fp, JSON.stringify(fir.taps));
        R.response.fir = { path: fp, from: fir.from, target: fir.target, achieved: fir.achieved };
        if (predict) {
          try { R.predict = runPredict(fp, `${path.basename(path.dirname(out))}-${nameA}`, { only: predictOnly, shards }); }
          catch (e) { R.predict = { error: String(e.message || e) }; R.notes.push(`prediction failed: ${R.predict.error}`); }
        }
      }
    } else R.notes.push("no PCM in one capture: no transfer function (run with --pcm=1)");
  }
  R.decisionA = decideA(R.predict);
  // the realization noise of the same-sound measures, and the like-for-like cross-check (the boom's capture through the measured response)
  if (noise && occA.length && occB.length && occA[0].seg.pcm && occB[0].seg.pcm) {
    const nd = path.join(out, "noise");
    mkdirSync(nd, { recursive: true });
    const ra = await noiseRealizations(S, A, occA[0], nd, nameA, { conc: noiseConc });
    const rb = await noiseRealizations(S, B, occB[0], nd, nameB, { conc: noiseConc });
    let rh = null;
    if (R.response.fir?.target) {
      const srB = occB[0].seg.sr, tf = path.join(nd, `fir-${nameA}-over-${nameB}-${srB}.json`);
      writeFileSync(tf, JSON.stringify(Array.from(designFir(THIRD_OCT, R.response.fir.target, srB, 1023))));
      rh = await noiseRealizations(S, B, occB[0], nd, `${nameB}-through-response`, { conc: noiseConc, fir: tf });
    }
    const slim = (r) => r?.map(({ m, ...x }) => ({ ...x, N: m?.readers.map((q) => q.N) ?? null })) ?? null;
    R.noise = { a: slim(ra), b: slim(rb), bThroughResponse: slim(rh), band: noiseBand(ra, rb), raw: { a: ra, b: rb, bh: rh } };
    R.crossCheck = crossCheck(R.sound.a, R.sound.b, ra, rb, rh);
  } else if (R.sound.a && R.sound.b) R.crossCheck = crossCheck(R.sound.a, R.sound.b, null, null, null);
  // display + floor (own-voice part of the session when there is one)
  const stepsAll = session?.steps ?? [];
  const wallRanges = (D) => { const w = devWallOfPc(D.clock); const sp = stepsAll.filter((s) => s.pc1 && !/sound|setup|place$|plug/.test(s.name)); return sp.length ? sp.map((s) => [w(s.pc0), w(s.pc1)]) : null; };
  R.display.a = displayRegime(A, { ranges: wallRanges(A) }); if (B) R.display.b = displayRegime(B, { ranges: wallRanges(B) });
  R.display.fromSteps = !!wallRanges(A) && stepsAll.some((s) => s.name === "room" || /^read|^hold|^pause/.test(s.name));
  R.display.postsVsDomA = postsVsDom(A); if (B) R.display.postsVsDomB = postsVsDom(B);
  if (stepsAll.length && B) {
    const ma = stepMetrics(A, stepsAll), mb = stepMetrics(B, stepsAll);
    R.ownVoice = ownVoice(ma, mb);
    R.snr = { a: ownSnr(A, ma), b: ownSnr(B, mb) };
    R.claps = Object.fromEntries(["claps", "claps-end"].map((n) => [n, clapResidual(A, B, stepsAll.find((x) => x.name === n))]));
    R.silences = { a: cuedSilences(A, stepsAll), b: cuedSilences(B, stepsAll) };
    R.steps = { a: Object.fromEntries(Object.entries(ma).map(([k, v]) => [k, { n: v.n, med: v.med, tail: v.tail }])), b: Object.fromEntries(Object.entries(mb).map(([k, v]) => [k, { n: v.n, med: v.med, tail: v.tail }])) };
  }
  if (replay) {
    const { replayDevice } = await import("./sbs-replay.mjs");
    R.replay = {}; R.replayCheck = {};
    for (const [n, D, occ] of [["a", A, occA[0]], ["b", B, occB[0]]]) {
      if (!D || !D.segments.some((s) => s.pcm)) continue;
      const { hintsBy, chunksCt, rep, ...sum } = await replayDevice(D, { hints: "node" });
      R.replay[n] = sum;
      // the live meter vs its own audio replayed, on the same-sound measures (when the replayed segment holds the test sound)
      if (occ && sum.seg === occ.si) {
        const live = n === "a" ? R.sound.a : R.sound.b, rm = soundMetrics(S, D, occ, rep.map((r) => ({ ct: r.ct, u: r.u })));
        const dN = live.readers.map((r, i) => (r.N != null && rm.readers[i]?.N != null ? r.N - rm.readers[i].N : null)).filter((x) => x != null);
        const sd = R.noise?.band?.perReader?.map((x) => (n === "a" ? x.sdA : x.sdB)).filter((x) => x != null) ?? [];
        const tol = r3(sd.length ? Math.max(0.05, NOISE_K * Math.max(...sd)) : 0.05);
        const maxAbsDN = dN.length ? r3(Math.max(...dN.map(Math.abs))) : null;
        const over = sum.du.over005 != null ? r2(100 * sum.du.over005) : null;
        R.replayCheck[n] = { dN: dN.map(r3), maxAbsDN, tol, over005Pct: over, p95: r3(sum.du.p95), reproduces: maxAbsDN != null && maxAbsDN <= tol && (over == null || over <= 10) };
      }
    }
  }
  if (hook) {
    R.hook = {};
    for (const [n, dir] of [["a", devA], ["b", devB]]) {
      if (!dir) continue;
      const r = spawnSync(process.execPath, ["--import", "./scripts/session-oracle/lib/register.mjs", path.join(here, "sbs-hook.mjs"), `--dev=${dir}`], { cwd: repo, encoding: "utf8", env: { ...process.env, SO_TAP: "0" }, maxBuffer: 64 * 1024 * 1024 });
      R.hook[n] = r.status === 0 ? JSON.parse(r.stdout.trim().split("\n").pop()) : { error: (r.stderr || r.stdout).slice(-500) };
    }
  }
  R.verdict = verdict(R);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "analysis.json"), JSON.stringify(R, (k, v) => (k === "taps" || k === "raw" ? undefined : v), 1));
  writeFileSync(path.join(out, "analysis.md"), report(R));
  return R;
}

export function report(R) {
  const L = [];
  const f = (x) => (x == null ? "—" : String(x));
  L.push(`# Phone vs headset — ${R.a} vs ${R.b}`);
  L.push("");
  L.push("## Verdict");
  L.push("```");
  L.push(R.verdict.text);
  L.push("```");
  if (R.response.relative) {
    const rel = R.response.relative;
    L.push("", `## Same-sound response, ${R.a} / ${R.b} (dB re 1 kHz; ✗ = SNR < 10 dB in a capture)`, "", "| band Hz | pink | sweep | speech | spread |", "|---|---|---|---|---|");
    THIRD_OCT.forEach((fc, i) => L.push(`| ${fc} | ${["pink", "sweep", "speech"].map((k) => rel[k] ? `${f(rel[k][i].db)}${rel[k][i].ok ? "" : " ✗"}` : "—").join(" | ")} | ${f(rel.spread[i])} |`));
    if (R.response.fir) L.push("", `FIR (from ${R.response.fir.from}): ${R.response.fir.path}`);
  }
  if (R.levels) L.push("", "## Levels on the test sound", "", "```", JSON.stringify(R.levels, null, 1), "```");
  if (R.predict) L.push("", "## Prediction on the public readers (the phone/boom response as an FIR) — decides (a)", "", "```", JSON.stringify({ decision: R.decisionA, summary: R.predict.summary ?? R.predict }, null, 1).slice(0, 4000), "```");
  if (R.sound.compare) {
    const C = R.sound.compare;
    L.push("", "## Shown resonance on the same sound (cross-check)", "", `bias ${f(C.bias)} u · swing 8 s ${f(C.swingLong)} · 3 / 5 s ${f(C.swingShort)} · peak sum ${f(C.swingSum)} · ΔT50 ${f(C.dT50)} s · noise band ±${f(R.crossCheck?.bandBias)} u / ±${f(R.crossCheck?.bandSwing)}`, "",
      "| reader | N a | N b | bias | excursion peaks a / b (ratio) |", "|---|---|---|---|---|");
    for (const r of C.rows) L.push(`| ${r.id} (${r.sex}) | ${f(r.NA)} | ${f(r.NB)} | ${f(r.bias)} | ${r.ex.map((e) => `${e.dur} s ${e.dir}: ${f(e.peakA)} / ${f(e.peakB)} (${f(e.ratio)})`).join("; ")} |`);
    if (R.crossCheck) L.push("", "Cross-check (like for like):", "", "```", JSON.stringify(R.crossCheck, null, 1), "```");
    if (R.noise) L.push("", "Realizations (N per reader, each replay):", "", "```", JSON.stringify({ band: R.noise.band, a: R.noise.a, b: R.noise.b, bThroughResponse: R.noise.bThroughResponse }, null, 1), "```");
  }
  for (const k of ["a", "b"]) {
    const h = R.health[k]; if (!h) continue;
    L.push("", `## Runtime — ${R[k]}`, "", "```", JSON.stringify(h, null, 1), "```");
    const d = R.display[k];
    if (d) L.push("", `## Display / pause floor — ${R[k]}`, "", "```", JSON.stringify(d, null, 1), "```");
  }
  if (R.ownVoice) L.push("", "## Own voice (private: never into a public note)", "", "```", JSON.stringify({ ...R.ownVoice, snr: R.snr, silences: R.silences }, null, 1), "```");
  if (R.replay) L.push("", "## Node replay of the logged capture", "", "```", JSON.stringify({ replay: R.replay, check: R.replayCheck }, null, 1), "```");
  if (R.hook) L.push("", "## Hook replay (idle causes)", "", "```", JSON.stringify(R.hook, null, 1), "```");
  L.push("", "## Alignment", "", "```", JSON.stringify({ A: R.sound.occurrencesA, B: R.sound.occurrencesB, postsVsDomA: R.display.postsVsDomA, postsVsDomB: R.display.postsVsDomB }, null, 1), "```");
  if (R.notes.length) L.push("", "## Notes", "", ...R.notes.map((n) => `- ${n}`));
  return L.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const sdir = arg("session", "");
  const session = sdir && existsSync(path.join(sdir, "session.json")) ? JSON.parse(readFileSync(path.join(sdir, "session.json"), "utf8")) : null;
  const nameA = arg("a", "phone"), nameB = arg("b", "desktop");
  const devA = arg("dev-a", "") || (sdir ? path.join(sdir, nameA) : "");
  const devB = arg("dev-b", "") || (sdir && existsSync(path.join(sdir, nameB)) ? path.join(sdir, nameB) : "");
  const out = path.resolve(arg("out", sdir ? path.join(sdir, "analysis") : path.join(path.dirname(devA), "analysis")));
  mkdirSync(out, { recursive: true });
  const off = (k) => process.argv.includes(`--no-${k}`);
  const R = await analyze({ devA, devB: devB || null, nameA, nameB, session, out, soundPath: path.resolve(repo, arg("sound", "build/resonance-mobile/sbs/sound/sbs-test.wav")),
    predict: !off("predict"), predictOnly: arg("predict-only", "").split(",").filter(Boolean), shards: Number(arg("shards", "4")), replay: !off("replay"), hook: !off("hook"), noise: !off("noise") });
  console.log(R.verdict.text);
  console.log(`\nwritten: ${path.join(out, "analysis.md")}`);
  process.exit(0);
}
