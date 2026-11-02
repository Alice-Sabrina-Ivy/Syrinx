// perturb.mjs — named, parameterised audio perturbations for the mobile
// resonance diagnosis (chain.mjs). Applied to the whole 48 kHz stream before
// it enters the chain (pitch worker AND resonance worker see the same audio).
//
// Spec, compact form (transforms joined by "+", applied left to right):
//   gain:<dB>                      multiply by 10^(dB/20)
//   level:<dBFS>                   scale so the ACTIVE speech level (below) is <dBFS>
//   hp:<fc>[:<Q>[:<n>]]            RBJ high-pass biquad, Q 0.7071, n cascaded sections (1)
//   lp:<fc>[:<Q>[:<n>]]            RBJ low-pass
//   bp:<fc>[:<Q>[:<n>]]            RBJ band-pass (0 dB peak)
//   notch:<fc>[:<Q>[:<n>]]         RBJ notch
//   peak:<fc>:<gainDb>[:<Q>]       RBJ peaking EQ (Q 1)
//   hshelf:<fc>:<gainDb>[:<S>]     RBJ high shelf (shelf slope S 1)
//   lshelf:<fc>:<gainDb>[:<S>]     RBJ low shelf
//   fir:<path>                     FIR taps (.json array or .f32), centred (delay (N-1)/2 removed)
//   firc:<path>                    the same, causal (delay kept)
//   bw:<rate>                      resample to <rate> and back (sinc, cutoff 0.45 x rate)
//   noise:<white|pink|brown>:<snrDb>[:<seed>]   additive noise at an SNR (below)
//   noisefile:<snrDb>:<path>       additive noise from a .f32 (at the stream rate) or .wav file, looped
//   clip:<dBFS>                    hard clip at amplitude 10^(dBFS/20)
//   mod:<path>                     a module exporting apply(Float32Array, sr, params, ctx) -> Float32Array
//
// JSON form (for parameters the compact form cannot carry, e.g. module params):
//   [{ "type": "gain", "db": -20 }, { "type": "mod", "path": "...", "params": {...} }, ...]
//   keys per type: gain{db} level{dbfs} hp/lp/bp/notch{fc,q,n} peak{fc,db,q} hshelf/lshelf{fc,db,s}
//   fir/firc{path} or fir/firc{taps:[...]} bw{rate} noise{kind,snr,seed} noisefile{snr,path}
//   clip{dbfs} mod{path,params} biquad{b:[b0,b1,b2],a:[a0,a1,a2],n}
//
// Levels (dBFS = 10 log10 of the mean square: a full-scale square wave is
// 0 dBFS, a full-scale sine -3; the app's diag inputRms in dB is the same
// scale). Both measured on the band the chain hears (the signal resampled to
// 16 kHz, as the pitch / resonance workers do):
//   active speech level = mean power of the 20 ms frames whose power is within
//                         25 dB of the 95th-percentile frame
//   noise level         = mean power of the whole noise signal
//   SNR                 = active speech level - noise level (the noise added is
//                         full-band; only its scale is set on the 0-8 kHz band)
// Noise is seeded (mulberry32), so every stream of the same length gets the same
// noise samples (controls and switch streams share the realisation).
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resampleClip } from "../../../src/voice-preview/engine/preview.js";

export const LEVEL_FRAME_S = 0.02;
export const ACTIVE_WITHIN_DB = 25;

// ---- parsing
const num = (s, d) => (s === undefined || s === "" ? d : Number(s));
export function parsePert(spec) {
  if (spec == null || spec === "" || spec === "none" || spec === "clean") return [];
  if (Array.isArray(spec)) return spec.map(normalize);
  const s = String(spec).trim();
  if (s.startsWith("[") || s.startsWith("{")) { const j = JSON.parse(s); return (Array.isArray(j) ? j : [j]).map(normalize); }
  if (s.endsWith(".json")) return parsePert(readFileSync(s, "utf8"));
  return s.split("+").filter(Boolean).map((t) => {
    const i = t.indexOf(":");
    const type = i < 0 ? t : t.slice(0, i), rest = i < 0 ? "" : t.slice(i + 1);
    if (type === "mod") return normalize({ type, path: rest });
    if (type === "fir" || type === "firc") return normalize({ type, path: rest });
    if (type === "noisefile") { const j = rest.indexOf(":"); return normalize({ type, snr: Number(rest.slice(0, j)), path: rest.slice(j + 1) }); }
    const a = rest.split(":");
    switch (type) {
      case "gain": return normalize({ type, db: num(a[0]) });
      case "level": return normalize({ type, dbfs: num(a[0]) });
      case "hp": case "lp": case "bp": case "notch": return normalize({ type, fc: num(a[0]), q: num(a[1], undefined), n: num(a[2], undefined) });
      case "peak": return normalize({ type, fc: num(a[0]), db: num(a[1]), q: num(a[2], undefined) });
      case "hshelf": case "lshelf": return normalize({ type, fc: num(a[0]), db: num(a[1]), s: num(a[2], undefined) });
      case "bw": return normalize({ type, rate: num(a[0]) });
      case "noise": return normalize({ type, kind: a[0], snr: num(a[1]), seed: num(a[2], undefined) });
      case "clip": return normalize({ type, dbfs: num(a[0]) });
      default: throw new Error(`unknown perturbation "${type}" in "${spec}"`);
    }
  });
}
function normalize(t) {
  const o = { ...t };
  const need = (k) => { if (o[k] === undefined || (typeof o[k] === "number" && !Number.isFinite(o[k]))) throw new Error(`${o.type}: ${k} missing`); };
  switch (o.type) {
    case "gain": need("db"); break;
    case "level": need("dbfs"); break;
    case "hp": case "lp": case "bp": case "notch": need("fc"); o.q ??= Math.SQRT1_2; o.n ??= 1; break;
    case "peak": need("fc"); need("db"); o.q ??= 1; break;
    case "hshelf": case "lshelf": need("fc"); need("db"); o.s ??= 1; break;
    case "biquad": need("b"); need("a"); o.n ??= 1; break;
    case "fir": case "firc": if (!o.taps) need("path"); break;
    case "bw": need("rate"); break;
    case "noise": need("kind"); need("snr"); o.seed ??= 1; if (!["white", "pink", "brown"].includes(o.kind)) throw new Error(`noise kind ${o.kind}`); break;
    case "noisefile": need("snr"); need("path"); break;
    case "clip": need("dbfs"); break;
    case "mod": need("path"); o.params ??= {}; break;
    default: throw new Error(`unknown perturbation type ${o.type}`);
  }
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
/** A short, file-name-safe label for a parsed spec. */
export function pertLabel(list) {
  if (!list.length) return "clean";
  return list.map((t) => [t.type, ...Object.entries(t).filter(([k]) => k !== "type" && k !== "params" && k !== "taps").map(([, v]) => (typeof v === "string" ? path.basename(v).replace(/\.[^.]+$/, "") : v))].join("_"))
    .join("+").replace(/[^A-Za-z0-9_.+-]/g, "_");
}

// ---- level measures (on the 16 kHz band, as the chain hears it)
const to16 = (x, sr) => (sr === 16000 ? x : resampleClip(x, sr, 16000));
export function activeLevelDb(x, sr, { band16 = true } = {}) {
  const y = band16 ? to16(x, sr) : x, fsr = band16 ? 16000 : sr;
  const F = Math.round(LEVEL_FRAME_S * fsr), p = [];
  for (let i = 0; i + F <= y.length; i += F) { let s = 0; for (let j = i; j < i + F; j++) s += y[j] * y[j]; p.push(s / F); }
  if (!p.length) return -Infinity;
  const sorted = [...p].sort((a, b) => a - b), ref = sorted[Math.floor(0.95 * (sorted.length - 1))];
  if (!(ref > 0)) return -Infinity;
  const thr = ref * 10 ** (-ACTIVE_WITHIN_DB / 10);
  let s = 0, n = 0;
  for (const v of p) if (v >= thr) { s += v; n++; }
  return 10 * Math.log10(s / n);
}
export function meanLevelDb(x, sr, { band16 = true } = {}) {
  const y = band16 ? to16(x, sr) : x;
  let s = 0; for (let i = 0; i < y.length; i++) s += y[i] * y[i];
  return 10 * Math.log10(s / y.length);
}

// ---- biquads (RBJ cookbook), direct form II transposed in float64
export function biquadCoefs(t, sr) {
  if (t.type === "biquad") { const [b0, b1, b2] = t.b, [a0, a1, a2] = t.a; return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]; }
  const w0 = (2 * Math.PI * t.fc) / sr, c = Math.cos(w0), sn = Math.sin(w0);
  if (!(t.fc > 0 && t.fc < sr / 2)) throw new Error(`${t.type}: fc ${t.fc} outside (0, ${sr / 2})`);
  let b0, b1, b2, a0, a1, a2;
  if (["hp", "lp", "bp", "notch", "peak"].includes(t.type)) {
    const al = sn / (2 * t.q);
    if (t.type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (t.type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (t.type === "bp") { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (t.type === "notch") { b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { const A = 10 ** (t.db / 40); b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  } else {
    const A = 10 ** (t.db / 40), al = (sn / 2) * Math.sqrt((A + 1 / A) * (1 / t.s - 1) + 2), sA = 2 * Math.sqrt(A) * al;
    if (t.type === "lshelf") {
      b0 = A * ((A + 1) - (A - 1) * c + sA); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sA);
      a0 = (A + 1) + (A - 1) * c + sA; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sA;
    } else {
      b0 = A * ((A + 1) + (A - 1) * c + sA); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sA);
      a0 = (A + 1) - (A - 1) * c + sA; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sA;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function biquad(x, k, n) {
  let y = x;
  for (let s = 0; s < n; s++) {
    const out = new Float32Array(y.length);
    const [b0, b1, b2, a1, a2] = k;
    let z1 = 0, z2 = 0;
    for (let i = 0; i < y.length; i++) { const v = y[i], o = b0 * v + z1; z1 = b1 * v - a1 * o + z2; z2 = b2 * v - a2 * o; out[i] = o; }
    y = out;
  }
  return y;
}
/** |H(f)| in dB of a biquad stage (for reporting). */
export function biquadGainDb(k, f, sr) {
  const [b0, b1, b2, a1, a2] = k, w = (2 * Math.PI * f) / sr;
  const re = (c0, c1, c2) => c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w), im = (c1, c2) => -(c1 * Math.sin(w) + c2 * Math.sin(2 * w));
  const nr = re(b0, b1, b2), ni = im(b1, b2), dr = re(1, a1, a2), di = im(a1, a2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

// ---- FIR
function loadTaps(t) {
  if (t.taps) return Float64Array.from(t.taps);
  if (t.path.endsWith(".f32")) { const b = readFileSync(t.path); return Float64Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)); }
  return Float64Array.from(JSON.parse(readFileSync(t.path, "utf8")));
}
function fir(x, h, centred) {
  const N = h.length, D = centred ? (N - 1) >> 1 : 0, y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const n = i + D; let s = 0;
    for (let j = 0; j < N; j++) { const m = n - j; if (m >= 0 && m < x.length) s += h[j] * x[m]; }
    y[i] = s;
  }
  return y;
}

// ---- noise
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rnd) { let s = 0; return () => { if (s) { const v = s; s = 0; return v; } let u = 0; while (u === 0) u = rnd(); const v = rnd(), r = Math.sqrt(-2 * Math.log(u)); s = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v); }; }
export function makeNoise(kind, n, seed) {
  const g = gauss(mulberry32(seed >>> 0 || 1)), y = new Float32Array(n);
  if (kind === "white") for (let i = 0; i < n; i++) y[i] = g();
  else if (kind === "pink") { // Paul Kellett's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = g();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  } else { // brown: leaky integrator of white
    let b = 0; for (let i = 0; i < n; i++) { b = 0.998 * b + g() * 0.05; y[i] = b; }
  }
  return y;
}
function readNoiseFile(p, sr) {
  const b = readFileSync(p);
  if (p.endsWith(".f32")) return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
  // minimal WAV reader: PCM 16 / 24 / 32-bit int or 32-bit float, any channels (mixed to mono)
  if (b.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${p}: not a WAV`);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = { tag: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
      if (fmt.tag === 0xfffe && sz >= 26) fmt.tag = b.readUInt16LE(off + 8 + 24); // WAVE_FORMAT_EXTENSIBLE: the subformat's code
    }
    if (id === "data") data = b.subarray(off + 8, off + 8 + sz);
    off += 8 + sz + (sz & 1);
  }
  const bps = fmt.bits / 8, n = Math.floor(data.length / bps / fmt.ch), y = new Float32Array(n);
  const isFloat = fmt.tag === 3;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bps;
      s += isFloat ? data.readFloatLE(o) : bps === 2 ? data.readInt16LE(o) / 32768 : bps === 3 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648;
    }
    y[i] = s / fmt.ch;
  }
  return fmt.sr === sr ? y : resampleClip(y, fmt.sr, sr);
}
function addNoise(x, sr, noise, snr) {
  const loop = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) loop[i] = noise[i % noise.length];
  const sp = activeLevelDb(x, sr), nl = meanLevelDb(loop, sr);
  const g = 10 ** ((sp - snr - nl) / 20), y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + g * loop[i];
  return { y, info: { speechDb: sp, noiseDbBefore: nl, gainDb: 20 * Math.log10(g) } };
}

const modCache = new Map();
/**
 * Apply a parsed perturbation list. Returns { y, info: [...] } (info per
 * transform: levels / gains applied, for the run record).
 */
export async function applyPert(list, x, sr, ctx = {}) {
  let y = x;
  const info = [];
  for (const t of list) {
    switch (t.type) {
      case "gain": { const g = 10 ** (t.db / 20); const z = new Float32Array(y.length); for (let i = 0; i < y.length; i++) z[i] = y[i] * g; y = z; info.push({ type: t.type }); break; }
      case "level": { const a = activeLevelDb(y, sr), g = 10 ** ((t.dbfs - a) / 20); const z = new Float32Array(y.length); for (let i = 0; i < y.length; i++) z[i] = y[i] * g; y = z; info.push({ type: t.type, activeBefore: a, gainDb: t.dbfs - a }); break; }
      case "hp": case "lp": case "bp": case "notch": case "peak": case "hshelf": case "lshelf": case "biquad": y = biquad(y, biquadCoefs(t, sr), t.n ?? 1); info.push({ type: t.type }); break;
      case "fir": case "firc": y = fir(y, loadTaps(t), t.type === "fir"); info.push({ type: t.type }); break;
      case "bw": y = resampleClip(resampleClip(y, sr, t.rate), t.rate, sr).subarray(0, y.length); if (y.length < x.length) { const z = new Float32Array(x.length); z.set(y); y = z; } info.push({ type: t.type }); break;
      case "noise": { const r = addNoise(y, sr, makeNoise(t.kind, y.length, t.seed), t.snr); y = r.y; info.push({ type: t.type, ...r.info }); break; }
      case "noisefile": { const r = addNoise(y, sr, readNoiseFile(t.path, sr), t.snr); y = r.y; info.push({ type: t.type, ...r.info }); break; }
      case "clip": { const a = 10 ** (t.dbfs / 20); let k = 0; const z = new Float32Array(y.length); for (let i = 0; i < y.length; i++) { const v = y[i]; z[i] = v > a ? a : v < -a ? -a : v; if (z[i] !== v) k++; } y = z; info.push({ type: t.type, clippedShare: k / y.length }); break; }
      case "mod": {
        const p = path.resolve(t.path);
        if (!modCache.has(p)) modCache.set(p, await import(pathToFileURL(p).href));
        const m = modCache.get(p);
        if (typeof m.apply !== "function") throw new Error(`${p}: no apply() export`);
        const z = await m.apply(y, sr, t.params, ctx);
        if (!(z instanceof Float32Array) || z.length !== y.length) throw new Error(`${p}: apply() must return a Float32Array of the input's length`);
        y = z; info.push({ type: t.type }); break;
      }
      default: throw new Error(`unknown type ${t.type}`);
    }
  }
  return { y: y === x ? x : y, info };
}
