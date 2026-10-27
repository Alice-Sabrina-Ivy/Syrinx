// stimuli.mjs — the takes of the take-checks measurement
// (measurements/exercise-take-checks-2026-10-27.md §1), 48 kHz mono.
//
// Positive takes (LibriSpeech, public, CC BY 4.0): per reader (sorted numeric speaker id
// per sex, sex from SPEAKERS.TXT) the reader's whole utterances of 1.5–4.0 s, in
// (chapter, utterance) order = E.
//   single  E[0..4] (up to 5 per reader)
//   double  consecutive pairs (E[0],E[1]), (E[2],E[3]), … with a 0.4 s gap, kept when the
//           speech (u1 + gap + u2) is at most 8.0 s; the first 3 that fit (up to 3 per reader)
// Each take: 0.8 s before the speech, 0.6 s after it. The stream the chain sees has 3.0 s of
// the take's background before the take (listening already on) and 0.1 s after it.
// Conditions (one pink realisation per take, seeded from the take id, scaled):
//   clean  the file's level, pink noise at -60 dBFS under the whole stream
//   quiet  the speech 20 dB lower, the same -60 dBFS floor
//   noisy  the file's level, pink noise at +10 dB SNR against the speech RMS over the speech
//          portion (u1, or u1 + gap + u2), under the whole stream
// dBFS = RMS re 1.0 (a full-scale square wave = 0 dBFS).
//
// Negative takes (no speech): 30 per class, 15 of 2.0 s then 15 of 5.0 s, seed
// 1000 * class + i + 1; 3.0 s of the same noise before, 0.1 s after.
//   n1 white noise -70 dBFS; n2 pink -45; n3 pink -30; n4 brown -30;
//   n5 a 120 Hz hum with four harmonics (120 Hz + 240 / 360 / 480 / 600 Hz, amplitudes 1/k,
//      seeded phases) at -35 dBFS over pink at -50 dBFS;
//   n6 whisper-like speech: the utterance re-made at 16 kHz with noise excitation through a
//      frame-wise LPC envelope (25 ms Hann frames, 12.5 ms hop, order 2 + 16000/1000 = 18,
//      each frame's noise scaled to the source frame's RMS, overlap-add), then scaled to the
//      source utterance's RMS; take i uses selection reader i of the list m0, w0, m1, w1, …
//      and that reader's first utterance (sorted) at least the take's length; the take is
//      the first 2.0 / 5.0 s of it, over (and after 3.0 s of) pink at -60 dBFS.
// Resampling 16 -> 48 kHz: ffmpeg's soxr (precision 28; exact 3x length, zero lag).
// Noise generators at 48 kHz: xorshift32 uniform white (as scripts/noise-synth.js), Paul
// Kellet's refined pink filter, brown = leaky integration (pole 0.9995), each with 1 s of
// discarded warm-up, normalised to unit RMS over the stream before scaling.
import { readFileSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// the resonance lab's LibriSpeech copy (its build/ cache) unless TAKE_CHECKS_LIBRI says otherwise
export const LIBRI = process.env.TAKE_CHECKS_LIBRI ?? join(dirname(fileURLToPath(import.meta.url)), "../../../build/resonance-lab/data/LibriSpeech");
export const RATE = 48000;
export const SRC_RATE = 16000;
export const PRE_S = 3.0;
export const LEAD_S = 0.8;
export const TAIL_S = 0.6;
export const GAP_S = 0.4;
export const POST_S = 0.1;
export const MAX_SPEECH_S = 8.0;
export const UTT_MIN_S = 1.5;
export const UTT_MAX_S = 4.0;
export const SINGLES_PER_READER = 5;
export const DOUBLES_PER_READER = 3;
export const CONDITIONS = ["clean", "quiet", "noisy"];
export const NEG_CLASSES = ["n1", "n2", "n3", "n4", "n5", "n6"];
export const NEG_PER_CLASS = 30;
export const SETS = { sel: "dev-clean", conf: "test-clean" };
const dbfs = (db) => 10 ** (db / 20);

// ---------- LibriSpeech inventory ----------
export function readers(split) {
  const out = [];
  for (const line of readFileSync(join(LIBRI, "SPEAKERS.TXT"), "utf8").split(/\r?\n/)) {
    if (line.startsWith(";") || !line.trim()) continue;
    const f = line.split("|").map((x) => x.trim());
    if (f.length >= 3 && f[2] === split) out.push({ spk: f[0], sex: f[1] === "F" ? "f" : "m" });
  }
  const present = new Set(readdirSync(join(LIBRI, split)));
  const list = out.filter((r) => present.has(r.spk)).sort((a, b) => Number(a.spk) - Number(b.spk));
  return { m: list.filter((r) => r.sex === "m"), f: list.filter((r) => r.sex === "f") };
}

/** FLAC STREAMINFO: sample rate and total samples (no decoding). */
export function flacInfo(path) {
  const fd = openSync(path, "r");
  const b = Buffer.alloc(42);
  readSync(fd, b, 0, 42, 0);
  closeSync(fd);
  if (b.toString("ascii", 0, 4) !== "fLaC" || (b[4] & 0x7f) !== 0) throw new Error(`no STREAMINFO first: ${path}`);
  const si = 8;
  const sr = (b[si + 10] << 12) | (b[si + 11] << 4) | (b[si + 12] >> 4);
  const total = (b[si + 13] & 0x0f) * 2 ** 32 + b.readUInt32BE(si + 14);
  return { sr, total };
}

export function utterances(split, spk) {
  const files = [];
  for (const ch of readdirSync(join(LIBRI, split, spk)).sort((a, b) => Number(a) - Number(b))) {
    const names = readdirSync(join(LIBRI, split, spk, ch)).filter((f) => f.endsWith(".flac"))
      .sort((a, b) => Number(a.split("-")[2].split(".")[0]) - Number(b.split("-")[2].split(".")[0]));
    for (const f of names) {
      const path = join(LIBRI, split, spk, ch, f);
      const { sr, total } = flacInfo(path);
      if (sr !== SRC_RATE) throw new Error(`unexpected rate ${sr}: ${path}`);
      files.push({ id: f.replace(/\.flac$/, ""), path, n16: total, dur: total / sr });
    }
  }
  return files;
}

const eligible = (u) => u.dur >= UTT_MIN_S && u.dur <= UTT_MAX_S;

/** Positive takes of one set (sel | conf), without conditions. */
export function positiveTakes(set) {
  const split = SETS[set];
  const R = readers(split);
  const takes = [];
  for (const sex of ["m", "f"]) for (const r of R[sex]) {
    const E = utterances(split, r.spk).filter(eligible);
    E.slice(0, SINGLES_PER_READER).forEach((u, i) => {
      takes.push({ set, split, sex, reader: r.spk, type: "single", idx: i, utts: [u.id], paths: [u.path], n16: [u.n16] });
    });
    let d = 0;
    for (let i = 0; i + 1 < E.length && d < DOUBLES_PER_READER; i += 2) {
      const [u1, u2] = [E[i], E[i + 1]];
      if (u1.dur + GAP_S + u2.dur > MAX_SPEECH_S + 1e-9) continue;
      takes.push({ set, split, sex, reader: r.spk, type: "double", idx: d++, utts: [u1.id, u2.id], paths: [u1.path, u2.path], n16: [u1.n16, u2.n16] });
    }
  }
  for (const t of takes) t.id = `${t.set}|${t.reader}|${t.type}|${t.idx}`;
  return { readers: R, takes };
}

/** Negative takes (30 per class). n6 needs the selection readers. */
export function negativeTakes() {
  const R = readers(SETS.sel);
  const inter = [];
  for (let i = 0; i < Math.max(R.m.length, R.f.length); i++) {
    if (R.m[i]) inter.push(R.m[i]);
    if (R.f[i]) inter.push(R.f[i]);
  }
  const takes = [];
  NEG_CLASSES.forEach((cls, ci) => {
    for (let i = 0; i < NEG_PER_CLASS; i++) {
      const takeS = i < NEG_PER_CLASS / 2 ? 2.0 : 5.0;
      const t = { set: "neg", cls, idx: i, takeS, seed: 1000 * (ci + 1) + i + 1 };
      if (cls === "n6") {
        const r = inter[i];
        const u = utterances(SETS.sel, r.spk).find((x) => x.dur >= takeS);
        if (!u) throw new Error(`n6: reader ${r.spk} has no utterance of ${takeS} s`);
        Object.assign(t, { reader: r.spk, sex: r.sex, utts: [u.id], paths: [u.path], n16: [u.n16] });
      }
      t.id = `neg|${cls}|${i}`;
      takes.push(t);
    }
  });
  return takes;
}

// ---------- audio ----------
const ffArgs = ["-af", "aresample=resampler=soxr:precision=28", "-ar", String(RATE), "-ac", "1", "-f", "f32le", "pipe:1"];
function ff(args, input) {
  const r = spawnSync("ffmpeg", ["-v", "error", ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr?.toString()}`);
  const out = new Float32Array(r.stdout.length / 4);
  out.set(new Float32Array(r.stdout.buffer, r.stdout.byteOffset, out.length));
  return out;
}
/** A FLAC utterance at 48 kHz (exactly 3 x its 16 kHz length). */
export function decode48(path, n16) {
  const x = ff(["-i", path, ...ffArgs]);
  if (n16 != null && x.length !== 3 * n16) throw new Error(`48 kHz length ${x.length} != 3 x ${n16}: ${path}`);
  return x;
}
export function decode16(path) { return ff(["-i", path, "-ac", "1", "-f", "f32le", "pipe:1"]); }
export function up48(x16) {
  const buf = Buffer.from(x16.buffer, x16.byteOffset, x16.byteLength);
  const x = ff(["-f", "f32le", "-ar", String(SRC_RATE), "-ac", "1", "-i", "pipe:0", ...ffArgs], buf);
  if (x.length !== 3 * x16.length) throw new Error(`up48 length ${x.length} != 3 x ${x16.length}`);
  return x;
}

export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h || 1;
}
function xorshift(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x7fffffff - 1; };
}
function unitRms(x) {
  let ss = 0;
  for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const r = Math.sqrt(ss / x.length) || 1;
  for (let i = 0; i < x.length; i++) x[i] /= r;
  return x;
}
export function rms(x, a = 0, b = x.length) {
  let ss = 0;
  for (let i = a; i < b; i++) ss += x[i] * x[i];
  return Math.sqrt(ss / Math.max(1, b - a));
}
const WARM = RATE; // 1 s discarded warm-up
export function whiteNoise(n, seed) {
  const rnd = xorshift(seed);
  for (let i = 0; i < WARM; i++) rnd();
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rnd();
  return unitRms(x);
}
export function pinkNoise(n, seed) {
  const rnd = xorshift(seed);
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = -WARM; i < n; i++) {
    const w = rnd();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    if (i >= 0) x[i] = v;
  }
  return unitRms(x);
}
export function brownNoise(n, seed) {
  const rnd = xorshift(seed);
  const x = new Float32Array(n);
  let y = 0;
  for (let i = -WARM; i < n; i++) { y = 0.9995 * y + rnd(); if (i >= 0) x[i] = y; }
  let m = 0;
  for (let i = 0; i < n; i++) m += x[i];
  m /= n;
  for (let i = 0; i < n; i++) x[i] -= m;
  return unitRms(x);
}
export function hum(n, seed) {
  const rnd = xorshift(seed);
  const ph = [0, 1, 2, 3, 4].map(() => (rnd() + 1) * Math.PI);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (let k = 1; k <= 5; k++) v += Math.sin(2 * Math.PI * 120 * k * t + ph[k - 1]) / k;
    x[i] = v;
  }
  return unitRms(x);
}

// Whisper-like re-synthesis at 16 kHz (LPC envelope, noise excitation).
function levinson(r, p) {
  const a = new Float64Array(p + 1); a[0] = 1;
  let e = r[0];
  if (!(e > 0)) return { a, e: 0 };
  const tmp = new Float64Array(p + 1);
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    e *= 1 - k * k;
    if (!(e > 0)) break;
  }
  return { a, e };
}
export function whisperize16(x, seed) {
  const N = 400, H = 200, p = 2 + SRC_RATE / 1000; // 25 ms frames, 12.5 ms hop, order 18
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); // periodic Hann: sums to 1 at 50 %
  const gauss = (() => { const u = xorshift(seed); return () => { let a = 0; for (let i = 0; i < 12; i++) a += (u() + 1) / 2; return a - 6; }; })();
  const out = new Float64Array(x.length + N);
  const fr = new Float64Array(N), r = new Float64Array(p + 1), y = new Float64Array(N + 200);
  for (let s = -H; s < x.length; s += H) {
    let ss = 0;
    for (let i = 0; i < N; i++) { const v = s + i >= 0 && s + i < x.length ? x[s + i] : 0; fr[i] = v * win[i]; ss += v * v; }
    const frameRms = Math.sqrt(ss / N);
    if (frameRms === 0) continue;
    for (let k = 0; k <= p; k++) { let acc = 0; for (let i = k; i < N; i++) acc += fr[i] * fr[i - k]; r[k] = acc; }
    r[0] *= 1 + 1e-9;
    const { a } = levinson(r, p);
    // all-pole filter on fresh noise, 200 samples of warm-up
    y.fill(0);
    for (let i = 0; i < y.length; i++) {
      let v = gauss();
      for (let j = 1; j <= p && j <= i; j++) v -= a[j] * y[i - j];
      y[i] = v;
    }
    let ys = 0;
    for (let i = 200; i < y.length; i++) ys += y[i] * y[i];
    const g = frameRms / (Math.sqrt(ys / N) || 1);
    for (let i = 0; i < N; i++) { const o = s + i; if (o >= 0 && o < out.length) out[o] += g * y[200 + i] * win[i]; }
  }
  const res = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) res[i] = out[i];
  const target = rms(x);
  const cur = rms(res) || 1;
  for (let i = 0; i < res.length; i++) res[i] *= target / cur;
  return res;
}

/**
 * Render one stream. Returns { samples (48 kHz), takeStartS, takeEndS, speechStartS,
 * speechEndS, takeS, speechS, speechRms (at the file's level), meta }.
 * `cache` (Map path -> Float32Array 48 kHz) avoids re-decoding a reader's utterances.
 */
export function renderPositive(take, cond, cache = new Map()) {
  const get = (p, n16) => { if (!cache.has(p)) cache.set(p, decode48(p, n16)); return cache.get(p); };
  const parts = take.paths.map((p, i) => get(p, take.n16[i]));
  const gap = Math.round(GAP_S * RATE);
  const speechLen = parts.reduce((a, x) => a + x.length, 0) + gap * (parts.length - 1);
  const speech = new Float32Array(speechLen);
  let o = 0;
  parts.forEach((x, i) => { speech.set(x, o); o += x.length + (i < parts.length - 1 ? gap : 0); });
  const speechRms = rms(speech);
  const pre = Math.round(PRE_S * RATE), lead = Math.round(LEAD_S * RATE), tail = Math.round(TAIL_S * RATE), post = Math.round(POST_S * RATE);
  const n = pre + lead + speechLen + tail + post;
  const noise = pinkNoise(n, hashSeed(take.id));
  const level = cond === "noisy" ? speechRms * dbfs(-10) : dbfs(-60);
  const g = cond === "quiet" ? dbfs(-20) : 1;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = noise[i] * level;
  for (let i = 0; i < speechLen; i++) x[pre + lead + i] += speech[i] * g;
  return {
    samples: x,
    takeStartS: pre / RATE,
    takeEndS: (pre + lead + speechLen + tail) / RATE,
    speechStartS: (pre + lead) / RATE,
    speechEndS: (pre + lead + speechLen) / RATE,
    takeS: (lead + speechLen + tail) / RATE,
    speechS: speechLen / RATE,
    speechRms,
  };
}

export function renderNegative(t) {
  const pre = Math.round(PRE_S * RATE), len = Math.round(t.takeS * RATE), post = Math.round(POST_S * RATE);
  const n = pre + len + post;
  let x;
  const scaled = (y, db) => { const k = dbfs(db); for (let i = 0; i < y.length; i++) y[i] *= k; return y; };
  switch (t.cls) {
    case "n1": x = scaled(whiteNoise(n, t.seed), -70); break;
    case "n2": x = scaled(pinkNoise(n, t.seed), -45); break;
    case "n3": x = scaled(pinkNoise(n, t.seed), -30); break;
    case "n4": x = scaled(brownNoise(n, t.seed), -30); break;
    case "n5": {
      x = scaled(hum(n, t.seed), -35);
      const p = scaled(pinkNoise(n, t.seed + 7919), -50);
      for (let i = 0; i < n; i++) x[i] += p[i];
      break;
    }
    case "n6": {
      x = scaled(pinkNoise(n, t.seed), -60);
      const src = decode16(t.paths[0]);
      const w = up48(whisperize16(src, t.seed));
      for (let i = 0; i < len && i < w.length; i++) x[pre + i] += w[i];
      break;
    }
    default: throw new Error(`class ${t.cls}`);
  }
  return { samples: x, takeStartS: pre / RATE, takeEndS: (pre + len) / RATE, takeS: len / RATE };
}

/** 16-bit PCM WAV (for listening checks). */
export function wav16(x, rate = RATE) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
  return b;
}
