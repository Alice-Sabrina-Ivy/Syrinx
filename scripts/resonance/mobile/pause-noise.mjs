// pause-noise.mjs — stationary room noise at a set PAUSE FLOOR, for the
// pause-dropout dose-response (pause-row.mjs). A perturb.mjs `mod` module:
//
//   { "type": "mod", "path": "<abs>/scripts/resonance/mobile/pause-noise.mjs",
//     "params": { "kind": "brown" | "pink", "floorDb": -50, "hp": 50, "hpN": 1, "seed": 7 } }
//
// The noise: perturb.mjs makeNoise(kind) — brown (leaky integrator of white,
// -6 dB/oct above ~15 Hz) or pink (Kellett, -3 dB/oct) — through an RBJ
// high-pass at `hp` Hz (Q 0.7071, `hpN` sections; default 50 Hz, one
// 12 dB/oct section: a phone microphone's low cut, so the brown family is
// "room rumble" weighted to 50–300 Hz rather than infrasound) and then
// scaled so that the MEDIAN of the DSP worker's intensity measure over the
// noise ALONE equals floorDb: 20 log10 RMS of the last 50 ms (2400 samples
// at 48 kHz) at every 25 ms chunk end — src/dsp/dsp-worker.js
// computeIntensity, full band, no DC removal. In the speech stream's pauses
// the real DSP worker then reads ~floorDb (pause-row.mjs measures and
// reports the actual median per condition).
//
// kind "file" (params.path: a mono PCM16 WAV, e.g. the committed real
// air-conditioner clip tests/dsp/data/notch-real/ac114.wav, MS-SNSD, CC0):
// resampled to 48 kHz, looped from a seeded start offset, high-passed and
// scaled the same way.
//
// The seed is the given seed + a hash of the stream's reader / id
// (perturb.mjs ctx), so every reader gets its own realisation, the same at
// every floor (only the scale changes between floors).
import { readFileSync } from "node:fs";
import { makeNoise, applyPert } from "./perturb.mjs";
import { resampleClip } from "../../../src/voice-preview/engine/preview.js";

export const DSP_WIN = 2400, DSP_HOP = 1200;
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Median over chunk ends of 20 log10 RMS of the last 50 ms (the DSP worker's intensity). */
export function dspMedianDb(z) {
  const v = [];
  for (let e = DSP_WIN; e <= z.length; e += DSP_HOP) {
    let s = 0; for (let i = e - DSP_WIN; i < e; i++) s += z[i] * z[i];
    v.push(10 * Math.log10(s / DSP_WIN + 1e-30));
  }
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

function readWav16Mono(p) {
  const b = readFileSync(p);
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") {
      if (!fmt || fmt.bits !== 16 || fmt.ch !== 1) throw new Error(`${p}: needs mono PCM16`);
      const x = new Float32Array(sz / 2);
      for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(o + 8 + 2 * i) / 32768;
      return { x, sr: fmt.sr };
    }
    o += 8 + sz + (sz & 1);
  }
  throw new Error(`${p}: no data`);
}
export async function makeRoomNoise(n, sr, { kind, floorDb, hp = 50, hpN = 1, seed = 1, path: file = null }, key = "") {
  if (sr !== 48000) throw new Error("pause-noise: the DSP window is defined at 48 kHz");
  if (!["brown", "pink", "white", "file"].includes(kind)) throw new Error(`pause-noise: kind ${kind}`);
  if (!Number.isFinite(floorDb)) throw new Error("pause-noise: floorDb");
  const s = ((seed >>> 0) + hash(`${kind}|${key}`)) >>> 0 || 1;
  let z;
  if (kind === "file") {
    const { x, sr: fsr } = readWav16Mono(file);
    const y = resampleClip(x, fsr, sr);
    const off = s % y.length;
    z = new Float32Array(n);
    for (let i = 0; i < n; i++) z[i] = y[(off + i) % y.length];
  } else z = makeNoise(kind, n, s);
  if (hp > 0) z = (await applyPert([{ type: "hp", fc: hp, q: Math.SQRT1_2, n: hpN }], z, sr)).y;
  const med = dspMedianDb(z);
  const g = 10 ** ((floorDb - med) / 20);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = g * z[i];
  return { z: out, gainDb: 20 * Math.log10(g), seed: s };
}

export async function apply(y, sr, params, ctx = {}) {
  const { z } = await makeRoomNoise(y.length, sr, params, ctx.reader ?? ctx.id ?? "");
  const out = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = y[i] + z[i];
  return out;
}
