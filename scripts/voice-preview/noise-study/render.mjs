// render.mjs — Voice Shaper noise study, step 3 (measurements/voice-shaper-noise-2026-10-25.md):
// for each mixture of a set and each candidate (audio stage | track stage), the engine input and
// the F0 track, the REAL Voice Shaper engine (PreviewEngine, committed WORLD module, SIMD build)
// renders three cells, scored against the reference (the clean recording through the same chain,
// "none|posted") at the same cell. Writes one JSON line per (mixture, candidate, cell) to
// <data>/res/<set>/<tag>-<shard>.jsonl and each render at 16 kHz (16-bit WAV) to
// <data>/render/<set>/<cand slug>/ for score.py (PESQ-WB, ESTOI, DNSMOS).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/noise-study/render.mjs
//        --data=build/vsn/data --set=dev --cands="none|posted,rnn|posted,..." --tag=t1 --shard=i/N
//        [--snr=0,5,10,20,clean] [--cells=all|0] [--nowav] [--nspeech=N (sex-balanced subset)] [--draw=0|1]
//
// Audio stages (any may end in +pre: denoised together with the 2 s pre-roll; or in @<dB>: an attenuation limit, mixing the recording back in): none | rnn (the fork's RNNoise 0.2 module) | mmse:<noise>:<alpha>:<gminDb>:<beta>[:<theta>[:<agg>]]
// (scripts/voice-preview/noise-study/mmse.js) | ext:<name> (precomputed: <data>/den/<name>/<set>/<id>.f32).
// Optional third field, a post-analysis stage: wsub:<over>:<floorDb>[:<theta>] (see postStage).
// Track stages: posted | oracle (the clean recording's posted track — diagnostic only) | vad:<theta> | rew (as re, warmed with the pre-roll: the denoised one when the audio stage ends in +pre) | re (the real pitch worker re-run, fresh, over the stage's
// audio) | re+vad:<theta>.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { PreviewEngine, resampleClip } from "../../../src/voice-preview/engine/preview.js";
import { createWorld } from "../../../src/voice-preview/engine/world.js";
import { pitchStats, pitchLimits } from "../../../src/voice-preview/controls.js";
import { denoiseMmse } from "./mmse.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const DATA = path.resolve(args.data ?? "build/vsn/data");
const SET = args.set ?? "dev";
const TAG = args.tag ?? "run";
const [SHARD, NSHARD] = (args.shard ?? "0/1").split("/").map(Number);
const CANDS = (args.cands ?? "none|posted").split(",").map((c) => { const [audio, track, post] = c.split("|"); return { audio, track, post: post ?? null, name: c }; });
const SNRS = (args.snr ?? "0,5,10,20,clean").split(",");
const CELLS_ALL = args.cells === "0" ? [[0, 0]] : [[0, 0], [4, 10], [-4, -10]];
const slug = (s) => s.replace(/[|:]/g, "_").replace(/[^A-Za-z0-9_.+-]/g, "");

const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
function writeWav16(p, x, sr) {
  const n = x.length, b = Buffer.alloc(44 + 2 * n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
  writeFileSync(p, b);
}

// ---- WORLD (SIMD build, as the app picks on desktop and the phones measured) ----
const WASM_DIR = path.join(REPO, "src/voice-preview/wasm");
const { default: factory } = await import(pathToFileURL(path.join(WASM_DIR, "vp_world.mjs")).href);
const mod = await factory({ locateFile: () => pathToFileURL(path.join(WASM_DIR, "simd/vp_world.wasm")).href });
const engine = new PreviewEngine(createWorld(mod));

// ---- RNNoise (the fork's module, unchanged; its one import re-pointed at this tree's engine) ----
let rnn = null;
async function getRnn() {
  if (rnn) return rnn;
  const src = path.join(REPO, "build/vsn/cand/rnn/src/voice-preview/denoise.js");
  const dst = path.join(REPO, "build/vsn/cand/rnn/denoise.mjs");
  writeFileSync(dst, readFileSync(src, "utf8").replace('from "./engine/preview.js"', `from ${JSON.stringify(pathToFileURL(path.join(REPO, "src/voice-preview/engine/preview.js")).href)}`));
  const D = await import(pathToFileURL(dst).href);
  const inst = D.createRnnoise(readFileSync(path.join(REPO, "build/vsn/cand/rnn/src/voice-preview/rnnoise/rnnoise.wasm")));
  rnn = (pcm, sr) => D.denoiseClip(inst, pcm, sr);
  return rnn;
}

// ---- the real pitch worker, plain (no detector), for the "re" track ----
let PW = null;
async function retrack(pcm, sr, C) {
  if (!PW) {
    const P = { posts: [], postMessage(m) { this.posts.push(m); } };
    globalThis.self = P;
    await import(pathToFileURL(path.join(REPO, "src/dsp/pitch-worker.js")).href);
    PW = P;
  }
  const P = PW;
  globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: sr } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  const nk = Math.floor(pcm.length / C);
  const out = new Float32Array(nk);
  const flush = 4;
  for (let k = 0; k < nk + flush; k++) {
    const a = k < nk ? Float32Array.from(pcm.subarray(k * C, (k + 1) * C)) : new Float32Array(C);
    pp.onmessage({ data: { buffer: a.buffer, contextTime: (k + 1) * C / sr } });
  }
  for (const m of P.posts) {
    if (m.type !== "pitch") continue;
    const kk = Math.round(m.contextTime * sr / C) - 1;
    if (kk >= 0 && kk < nk) out[kk] = m.pitch > 0 ? m.pitch : 0;
  }
  return out;
}

// ---- stages ----
let preRoll = null; // the current mixture's pre-roll (capture before Record)
const audioCache = new Map();
async function audioStage(spec, mix, pcm, pre) {
  const key = `${spec}::${mix.id}`;
  if (audioCache.has(key)) return audioCache.get(key);
  let y;
  const t0 = performance.now();
  if (spec.endsWith("+pre")) {
    const base = spec.slice(0, -4);
    const cat = new Float32Array(pre.length + pcm.length); cat.set(pre); cat.set(pcm, pre.length);
    const { y: e } = await audioStage(base, { ...mix, id: `${mix.id}#cat`, vadP: null }, cat, null);
    y = e.slice(pre.length);
    y.denoisedPre = e.slice(0, pre.length);
  } else if (spec.includes("@")) {
    // attenuation limit: (1 - a) x enhanced + a x recording, a = 10^(-lim/20)
    const [base, lim] = spec.split("@");
    const { y: e } = await audioStage(base, mix, pcm, pre);
    const a = 10 ** (-Number(lim) / 20);
    y = new Float32Array(pcm.length);
    for (let i = 0; i < y.length; i++) y[i] = (1 - a) * e[i] + a * pcm[i];
  } else if (spec === "none") y = pcm;
  else if (spec === "rnn") y = (await getRnn())(pcm, mix.rate);
  else if (spec.startsWith("mmse:")) {
    const [, noise, alpha, gminDb, beta, theta, agg] = spec.split(":");
    y = denoiseMmse(pcm, mix.rate, { noise, alpha: +alpha, gminDb: +gminDb, beta: +beta, theta: theta ? +theta : 0.3, agg: agg || "mean", vadP: mix.vadP, chunk: mix.chunk, pre });
  } else if (spec.startsWith("ext:")) {
    y = readF32(path.join(DATA, "den", spec.slice(4), SET, `${mix.id}.f32`));
    if (y.length !== pcm.length) throw new Error(`${spec} ${mix.id}: length ${y.length} vs ${pcm.length}`);
  } else throw new Error(`unknown audio stage ${spec}`);
  const ms = performance.now() - t0;
  for (const k of audioCache.keys()) if (!k.endsWith(`::${mix.id}`)) audioCache.delete(k); // one mixture at a time
  audioCache.set(key, { y, ms });
  return { y, ms };
}

async function trackStage(spec, mix, audio, clean) {
  if (spec === "oracle") return Float32Array.from(clean.track);
  const gate = (tr, th) => tr.map((v, k) => (mix.vadP[k] != null && mix.vadP[k] < th ? 0 : v));
  if (spec === "posted") return Float32Array.from(mix.track);
  if (spec.startsWith("vad:")) return Float32Array.from(gate(mix.track, +spec.slice(4)));
  if (spec === "re") return retrack(audio, mix.rate, mix.chunk);
  if (spec === "rew") {
    // re-track warmed with the (denoised, when the audio stage kept it) pre-roll, recording part kept
    const p = audio.denoisedPre ?? preRoll;
    const cat = new Float32Array(p.length + audio.length); cat.set(p); cat.set(audio, p.length);
    return (await retrack(cat, mix.rate, mix.chunk)).slice(p.length / mix.chunk);
  }
  if (spec.startsWith("re+vad:")) return Float32Array.from(gate(Array.from(await retrack(audio, mix.rate, mix.chunk)), +spec.slice(7)));
  throw new Error(`unknown track stage ${spec}`);
}

// ---- post-analysis stage: in WORLD's own domain ----
// wsub:<over>:<floorDb>[:<theta>] — the noise envelope N (mean CheapTrick envelope over WORLD frames in
// chunks the detector scores below theta, with two chunks of margin) is subtracted from the
// envelope, sp' = max(sp - over x N, floor x sp), and from the aperiodic part,
// ap' = max(ap x sp - over x N, floor x ap x sp) / sp'. The finish step's loudness reference is
// scaled to the clip's estimated speech power so the result is not matched to voice + noise.
function postStage(spec, mix, audio) {
  const [kind, over, floorDb, theta] = spec.split(":");
  if (kind !== "wsub") throw new Error(`unknown post stage ${spec}`);
  const S = engine.session, W = S.W, nf = S.nf, nb = S.nb;
  const th = theta ? +theta : 0.3, ov = +over, fl = 10 ** (+floorDb / 10);
  const C = mix.chunk, nk = mix.vadP.length;
  const quiet = (k) => { for (let d = -2; d <= 2; d++) { const v = mix.vadP[k + d]; if (k + d >= 0 && k + d < nk && !(v != null && v < th)) return false; } return true; };
  const H = W.heap(), sp = S.psp >> 3, ap = S.pap >> 3;
  const N = new Float64Array(nb); let cnt = 0;
  for (let i = 0; i < nf; i++) {
    const k = Math.floor(i * S.fp / 1000 * mix.rate / C);
    if (k < nk && quiet(k)) { for (let b = 0; b < nb; b++) N[b] += H[sp + i * nb + b]; cnt++; }
  }
  if (cnt < 20) return; // under 0.1 s of no-voice frames: leave the analysis as it is
  for (let b = 0; b < nb; b++) N[b] = N[b] / cnt * ov;
  let pTot = 0, pClean = 0;
  for (let i = 0; i < nf; i++) {
    for (let b = 0; b < nb; b++) {
      const j = i * nb + b, s0 = H[sp + j], a0 = H[ap + j];
      const s1 = Math.max(s0 - N[b], fl * s0);
      const aper = Math.max(a0 * s0 - N[b], fl * a0 * s0);
      H[sp + j] = s1;
      H[ap + j] = Math.min(1, aper / s1);
      pTot += s0; pClean += s1;
    }
  }
  const k = Math.sqrt(pClean / pTot);
  engine.x = Float32Array.from(engine.x, (v) => v * k);
}

// ---- metrics at the engine rate ----
function frameRms(x, F) { const n = Math.floor(x.length / F); const e = new Float64Array(n); for (let f = 0; f < n; f++) { let s = 0; for (let i = f * F; i < (f + 1) * F; i++) s += x[i] * x[i]; e[f] = Math.sqrt(s / F); } return e; }
const NFFT = 2048;
const TW = (() => { const c = new Float64Array(NFFT / 2), s = new Float64Array(NFFT / 2); for (let k = 0; k < NFFT / 2; k++) { c[k] = Math.cos(-2 * Math.PI * k / NFFT); s[k] = Math.sin(-2 * Math.PI * k / NFFT); } return { c, s }; })();
function fftRe(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const step = n / len, half = len >> 1; for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) { const c = TW.c[k * step], s = TW.s[k * step], p = i + k, q = p + half; const vr = re[q] * c - im[q] * s, vi = re[q] * s + im[q] * c; re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi; } }
}
/** Log power spectrum (dB) of the 20 ms Hann frame at k0, bins 100 Hz .. 16 kHz: { lo (100-8000), hi (8000-16000) }. */
function logSpec(x, k0, F, sr) {
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  for (let i = 0; i < F; i++) re[i] = x[k0 + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / F));
  fftRe(re, im);
  const b = (hz) => Math.round(hz / sr * NFFT);
  const db = (k) => 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
  const lo = [], hi = [];
  for (let k = b(100); k < b(8000); k++) lo.push(db(k));
  for (let k = b(8000); k < b(16000); k++) hi.push(db(k));
  return { lo, hi };
}
const refSpecCache = new WeakMap();
function score(ref, y, mask, sr) {
  const F = Math.round(0.02 * sr);
  let rs = refSpecCache.get(ref);
  if (!rs) { rs = mask.map((m, f) => (m === 2 ? logSpec(ref, f * F, F, sr) : null)); refSpecCache.set(ref, rs); }
  let lsd = 0, n = 0, lsdHi = 0, nHi = 0;
  const pe = [];
  for (let f = 0; f < mask.length; f++) {
    if (mask[f] === 2) {
      const A = rs[f], B = logSpec(y, f * F, F, sr);
      let mx = -Infinity; for (const v of A.lo) if (v > mx) mx = v;
      const fl = mx - 40; let d = 0;
      for (let i = 0; i < A.lo.length; i++) d += (Math.max(A.lo[i], fl) - Math.max(B.lo[i], fl)) ** 2;
      lsd += Math.sqrt(d / A.lo.length); n++;
      const flh = mx - 60; let dh = 0;
      for (let i = 0; i < A.hi.length; i++) dh += (Math.max(A.hi[i], flh) - Math.max(B.hi[i], flh)) ** 2;
      lsdHi += Math.sqrt(dh / Math.max(1, A.hi.length)); nHi++;
    } else if (mask[f] === 0) pe.push(frameRms(y.subarray(f * F, (f + 1) * F), F)[0]);
  }
  const act = frameRms(ref, F).filter((_, f) => mask[f] === 2);
  const actRms = Math.sqrt(act.reduce((t, v) => t + v * v, 0) / Math.max(1, act.length));
  const pr = pe.length ? Math.sqrt(pe.reduce((t, v) => t + v * v, 0) / pe.length) : null;
  return { lsd: lsd / Math.max(1, n), lsdHi: lsdHi / Math.max(1, nHi), pauseDb: pr == null ? null : 20 * Math.log10(pr / actRms + 1e-9) };
}
function trackScore(tr, ref) {
  let fa = 0, refUv = 0, miss = 0, refV = 0, gross = 0, both = 0;
  for (let k = 0; k < ref.length; k++) {
    const r = ref[k] > 0, c = tr[k] > 0;
    if (!r) { refUv++; if (c) fa++; } else { refV++; if (!c) miss++; else { both++; if (Math.abs(1200 * Math.log2(tr[k] / ref[k])) > 50) gross++; } }
  }
  return { fa: refUv ? fa / refUv : 0, miss: refV ? miss / refV : 0, gross: both ? gross / both : 0 };
}

// ---- main ----
const mixDir = path.join(DATA, "mix", SET);
const all = readdirSync(mixDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(mixDir, f), "utf8")));
const bySpeech = new Map();
for (const m of all) { if (!bySpeech.has(m.speech.id)) bySpeech.set(m.speech.id, []); bySpeech.get(m.speech.id).push(m); }
let pool = [...bySpeech.keys()].sort();
if (args.nspeech) {
  // a sex-balanced subset: the first n/2 women and n/2 men in id order
  const n = Number(args.nspeech);
  const sexOf = (id) => bySpeech.get(id)[0].speech.sex;
  pool = [...pool.filter((id) => sexOf(id) === "f").slice(0, n / 2), ...pool.filter((id) => sexOf(id) === "m").slice(0, n / 2)];
}
const speechIds = pool.filter((_, i) => i % NSHARD === SHARD);
const resDir = path.join(DATA, "res", SET); mkdirSync(resDir, { recursive: true });
const resFile = path.join(resDir, `${TAG}-${SHARD}.jsonl`);
const done = new Set();
if (existsSync(resFile)) for (const l of readFileSync(resFile, "utf8").split("\n")) if (l) { const r = JSON.parse(l); done.add(`${r.mix}|${r.cand}`); }
const cellKey = (st, pct) => `${st >= 0 ? "p" : "m"}${Math.abs(st)}_${pct >= 0 ? "p" : "m"}${Math.abs(pct)}`;

let count = 0; const T0 = Date.now();
for (const sid of speechIds) {
  const mixes = bySpeech.get(sid);
  const clean = mixes.find((m) => m.snr === null);
  const cleanPcm = readF32(path.join(mixDir, `${clean.id}.f32`));
  const sr = clean.rate;
  const lim = pitchLimits(pitchStats(Float32Array.from(clean.track)).p5Hz);
  const cells = CELLS_ALL.map(([st, pct]) => [st > 0 ? Math.min(st, lim.stMax) : st < 0 ? Math.max(st, lim.stMin) : 0, pct]);
  // speech / pause mask from the clean recording (20 ms frames): 2 speech, 0 pause, 1 neither
  const F = Math.round(0.02 * sr);
  const ce = frameRms(cleanPcm, F); const cmax = Math.max(...ce);
  const mask = Array.from(ce, (v) => (v > 0.05 * cmax ? 2 : v < 0.003 * cmax ? 0 : 1));
  // reference renders
  engine.analyse(cleanPcm, sr, Float32Array.from(clean.track));
  const refR = cells.map(([st, pct]) => engine.render(st, pct).pcm);
  const rate = engine.rate;
  if (!args.nowav) {
    const rd = path.join(DATA, "render", SET, "ref"); mkdirSync(rd, { recursive: true });
    cells.forEach(([st, pct], i) => { const p = path.join(rd, `${sid}.${cellKey(...CELLS_ALL[i])}.wav`); if (!existsSync(p)) writeWav16(p, resampleClip(refR[i], rate, 16000), 16000); });
  }
  for (const mix of mixes) {
    const want = mix.snr === null ? "clean" : String(mix.snr);
    if (!SNRS.includes(want)) continue;
    if (args.draw !== undefined && mix.snr !== null && !mix.id.endsWith(`_${args.draw}`)) continue;
    const pcm = readF32(path.join(mixDir, `${mix.id}.f32`));
    const pre = existsSync(path.join(mixDir, `${mix.id}.pre.f32`)) ? readF32(path.join(mixDir, `${mix.id}.pre.f32`)) : null;
    preRoll = pre;
    for (const cand of CANDS) {
      if (done.has(`${mix.id}|${cand.name}`)) continue;
      const A = await audioStage(cand.audio, mix, pcm, pre);
      const t1 = performance.now();
      const tr = await trackStage(cand.track, mix, A.y, clean);
      const trackMs = performance.now() - t1;
      const t2 = performance.now();
      engine.analyse(A.y, sr, tr);
      if (cand.post) postStage(cand.post, mix, A.y);
      const anaMs = performance.now() - t2;
      const ts = trackScore(tr, clean.track);
      const cs = slug(cand.name);
      const wd = path.join(DATA, "render", SET, cs); if (!args.nowav) mkdirSync(wd, { recursive: true });
      const rows = [];
      cells.forEach(([st, pct], i) => {
        const y = engine.render(st, pct).pcm;
        const s = score(refR[i], y, mask, rate);
        const ck = cellKey(...CELLS_ALL[i]);
        if (!args.nowav) writeWav16(path.join(wd, `${mix.id}.${ck}.wav`), resampleClip(y, rate, 16000), 16000);
        rows.push(JSON.stringify({ mix: mix.id, speech: sid, sex: mix.speech.sex, source: mix.speech.source, snr: mix.snr, noise: mix.noise?.class ?? null,
          cand: cand.name, cell: ck, st, pct, ...s, ...ts, audioMs: A.ms, trackMs, anaMs }));
      });
      appendFileSync(resFile, rows.join("\n") + "\n");
    }
    count++;
    if (count % 20 === 0) console.log(`[${SHARD}/${NSHARD}] ${count} mixtures, ${((Date.now() - T0) / count / 1000).toFixed(2)} s/mix`);
  }
}
console.log(`[${SHARD}/${NSHARD}] done ${count}`);
