// distance-mod.mjs — perturb.mjs "mod" transform for the distance / room area
// of the mobile resonance diagnosis (2026-10-28).
//
// params:
//   ir:        path of a 48 kHz float32 impulse response (distance-rir.py), or null (no convolution)
//   level:     "clean" = the reader's own clean active level (its N control, no IR),
//              a number = that active level in dBFS (0-8 kHz band, perturb.mjs's definition),
//              or null = no re-levelling
//   noiseRelDb: room / mic noise floor relative to that active level (e.g. -47), or null = none
//   noiseAbsDb: or the noise floor's absolute level in dBFS (0-8 kHz band), overriding noiseRelDb
//   noiseKind: "pink" (default) | "white" | "brown"
//   streams:   the streams dir (default build/resonance-mobile/streams)
//
// Every stream of a reader gets the SAME gain and the same noise realisation
// (seeded per reader, generated sample by sample from t = 0): the gain is set
// on the reader's N control convolved with the same IR, and the noise scale on
// a 54 s realisation, so a switch stream's first 18 s are exactly the N
// control's first 18 s (as with a real microphone at a fixed gain).
// The convolution is causal (FFT overlap-add) and the output keeps the input's length.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFFT } from "../../../src/resonance-lab/fft.js";
import { activeLevelDb, meanLevelDb, makeNoise } from "./perturb.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };

const irCache = new Map();
function irSpectrum(p) {
  if (irCache.has(p)) return irCache.get(p);
  const h = readF32(p);
  let N = 1; while (N < 4 * h.length) N <<= 1;
  N = Math.max(N, 1 << 16);
  const fft = createFFT(N), re = new Float64Array(N), im = new Float64Array(N);
  re.set(h);
  fft.forward(re, im);
  const r = { h, N, re, im, fft, L: N - h.length + 1 };
  irCache.set(p, r);
  return r;
}
/** Causal linear convolution of x with the IR, truncated to x.length (overlap-add). */
export function convolve(x, irPath) {
  const S = irSpectrum(irPath);
  const { N, L, fft } = S, y = new Float64Array(x.length + N);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s < x.length; s += L) {
    re.fill(0); im.fill(0);
    const e = Math.min(x.length, s + L);
    for (let i = s; i < e; i++) re[i - s] = x[i];
    fft.forward(re, im);
    for (let k = 0; k < N; k++) {
      const a = re[k], b = im[k], c = S.re[k], d = S.im[k];
      re[k] = a * c - b * d; im[k] = a * d + b * c;
    }
    fft.inverse(re, im);
    for (let i = 0; i < N; i++) y[s + i] += re[i] / N;
  }
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = y[i];
  return out;
}

function hashSeed(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) || 1; }
const gainCache = new Map();
function readerGain(sr, params, ctx) {
  const key = JSON.stringify([ctx.reader, params.ir ?? null, params.level ?? null, params.noiseRelDb ?? null, params.noiseKind ?? "pink", params.noiseAbsDb ?? null]);
  if (gainCache.has(key)) return gainCache.get(key);
  const streams = path.resolve(repo, params.streams ?? "build/resonance-mobile/streams");
  const nPath = path.join(streams, "v", `${ctx.reader}__N.f32`);
  if (!existsSync(nPath)) throw new Error(`distance-mod: no N control for ${ctx.reader} (${nPath})`);
  const n0 = readF32(nPath);
  const cleanDb = activeLevelDb(n0, sr);
  const conv = params.ir ? convolve(n0, path.resolve(repo, params.ir)) : n0;
  const convDb = activeLevelDb(conv, sr);
  const target = params.level === "clean" ? cleanDb : typeof params.level === "number" ? params.level : convDb;
  const g = 10 ** ((target - convDb) / 20);
  let noiseScale = 0;
  if (params.noiseRelDb != null || params.noiseAbsDb != null) {
    const nz = makeNoise(params.noiseKind ?? "pink", n0.length, hashSeed(ctx.reader));
    const nl = meanLevelDb(nz, sr);
    noiseScale = 10 ** (((params.noiseAbsDb != null ? params.noiseAbsDb : target + params.noiseRelDb) - nl) / 20);
  }
  const r = { g, gainDb: 20 * Math.log10(g), cleanDb, convDb, target, noiseScale };
  gainCache.set(key, r);
  return r;
}

export function apply(x, sr, params = {}, ctx = {}) {
  if (sr !== 48000) throw new Error("distance-mod: 48 kHz streams expected");
  const G = readerGain(sr, params, ctx);
  const y = params.ir ? convolve(x, path.resolve(repo, params.ir)) : Float32Array.from(x);
  for (let i = 0; i < y.length; i++) y[i] *= G.g;
  if (G.noiseScale > 0) {
    const nz = makeNoise(params.noiseKind ?? "pink", y.length, hashSeed(ctx.reader));
    for (let i = 0; i < y.length; i++) y[i] += G.noiseScale * nz[i];
  }
  return y;
}
export function readerLevelInfo(sr, params, ctx) { return readerGain(sr, params, ctx); }
