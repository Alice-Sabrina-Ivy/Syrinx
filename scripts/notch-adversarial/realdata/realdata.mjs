// realdata.mjs — JS loaders for the real-data corpora (build/notchvd/data,
// built by fetch_noise.py / fetch_voice.py / census.py / build_mixes.py; see
// README.md). No audio is committed; everything resolves under
// $NOTCHVD_ROOT (default <repo>/build/notchvd).
//
//   import { loadIndex, readClip, loadF0, resample, renderMix } from "./realdata/realdata.mjs";
//   const noise = loadIndex("noise", { label: "stationary-tonal", minDur: 20 });
//   const x = readClip(noise[0].path);                  // Float32Array @ 16 kHz
//   const x48 = resample(x, 16000, 48000);              // for the 48 kHz worker path
//   const mixes = loadIndex("mix", { set: "voice_in_noise" });
//   const m = readClip(mixes[0].path);                  // pre-rendered
//   const m2 = renderMix(mixes[0].spec);                // same samples, rendered in JS
//
// Index records (data/index_<kind>.json, written by build_index.py) are the
// manifest records + census label/flags (noise) and dedupe info; see README.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.NOTCHVD_ROOT ?? join(HERE, "../../../build/notchvd"));
export const DATA = join(ROOT, "data");
export const SR = 16000;

// ---- WAV (PCM16 / PCM24 / PCM32 / FLOAT32, mono or first channel) ----------
export function readWav(path) {
  const b = readFileSync(path);
  let off = 12, fmt = 0, ch = 1, sr = 0, bps = 0, ds = 0, dz = 0;
  while (off < b.length - 8) {
    const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") { fmt = b.readUInt16LE(off + 8); ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); bps = b.readUInt16LE(off + 22);
      if (fmt === 0xfffe) fmt = b.readUInt16LE(off + 32); }
    else if (id === "data") { ds = off + 8; dz = Math.min(sz, b.length - ds); break; }
    off += 8 + sz + (sz & 1);
  }
  const bpS = bps / 8, n = Math.floor(dz / (bpS * ch)), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = ds + i * bpS * ch;
    x[i] = fmt === 3 ? (bps === 64 ? b.readDoubleLE(p) : b.readFloatLE(p))
      : bps === 16 ? b.readInt16LE(p) / 32768 : bps === 24 ? b.readIntLE(p, 3) / 8388608 : b.readInt32LE(p) / 2147483648;
  }
  return { samples: x, sampleRate: sr };
}
export function readClip(relPath) {
  const { samples, sampleRate } = readWav(join(DATA, relPath));
  if (sampleRate !== SR) throw new Error(`${relPath}: ${sampleRate} Hz (corpus is ${SR})`);
  return samples;
}
export function loadF0(rec) {
  return rec.f0_path && existsSync(join(DATA, rec.f0_path)) ? JSON.parse(readFileSync(join(DATA, rec.f0_path), "utf8")) : null;
}

// ---- index ------------------------------------------------------------------
// filters: source, label, cls (class), set, minDur, maxDur, heldMin (s of held
// voice), noDup (default true: drop exact-duplicate clips), ids
export function loadIndex(kind, f = {}) {
  const p = join(DATA, `index_${kind}.json`);
  let recs;
  if (existsSync(p)) recs = JSON.parse(readFileSync(p, "utf8"));
  else { // fall back to the raw per-source manifests
    recs = [];
    const d = join(DATA, "manifests");
    for (const fn of readdirSync(d)) if (fn.startsWith(kind + ".") && fn.endsWith(".json")) recs.push(...JSON.parse(readFileSync(join(d, fn), "utf8")));
  }
  const inSet = (v, s) => s == null || (Array.isArray(s) ? s.includes(v) : s === v);
  return recs.filter((r) => inSet(r.source, f.source) && inSet(r.label, f.label) && inSet(r.class, f.cls) && inSet(r.set, f.set)
    && (f.minDur == null || r.dur >= f.minDur) && (f.maxDur == null || r.dur <= f.maxDur)
    && (f.heldMin == null || (r.held_sec ?? 0) >= f.heldMin) && (f.noDup === false || !r.dup_of)
    && (f.ids == null || f.ids.includes(r.id)));
}

// ---- resampling (16 kHz corpus -> the worker's input rate) -------------------
// Integer-ratio up/down by windowed-sinc polyphase (Kaiser beta 8, 32 taps per
// phase, cutoff 0.45 x the lower rate) — for 16 -> 48 kHz this mimics a
// browser mic stream band-limited at ~7.2 kHz.
export function resample(x, from, to) {
  if (from === to) return Float32Array.from(x);
  const g = gcd(from, to), up = to / g, down = from / g;
  const half = 16, L = 2 * half * up, fc = 0.45 / Math.max(up, down) * 2; // normalised to the up-sampled rate
  const h = new Float64Array(L + 1);
  const i0 = (v) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (v / (2 * k)) ** 2; s += t; } return s; };
  for (let i = 0; i <= L; i++) {
    const m = i - L / 2, w = i0(8 * Math.sqrt(1 - (2 * m / L) ** 2)) / i0(8);
    h[i] = (m === 0 ? fc : Math.sin(Math.PI * fc * m) / (Math.PI * m)) * w * up;
  }
  const n = Math.floor(x.length * up / down), y = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    const t = o * down; // index on the up-sampled grid
    let s = 0;
    for (let k = Math.ceil((t - L / 2) / up); k * up <= t + L / 2; k++) {
      if (k < 0 || k >= x.length) continue;
      s += x[k] * h[t - k * up + L / 2];
    }
    y[o] = s;
  }
  return y;
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

// ---- mixes ------------------------------------------------------------------
// renderMix(spec) mirrors build_mixes.py render() exactly (parity:
// node scripts/notch-adversarial/realdata/mix-parity.mjs). spec:
//   { sr: 16000, dur, layers: [{ clip (data-relative path), at (s), from (s),
//     len (s), gain (linear), loop (bool), fade (s), gates?: [[t0, t1], ...]
//     (layer-local seconds muted, fade-ramped), }] }
export function renderMix(spec) {
  const n = Math.round(spec.dur * SR), y = new Float64Array(n);
  for (const L of spec.layers) {
    const x = readClip(L.clip);
    const a = Math.round(L.at * SR), f = Math.round((L.from ?? 0) * SR), len = Math.round(L.len * SR);
    const fade = Math.max(1, Math.round((L.fade ?? 0.02) * SR));
    const gate = gateEnv(len, L.gates ?? [], fade);
    for (let i = 0; i < len && a + i < n; i++) {
      let k = f + i;
      if (k >= x.length) { if (!L.loop) break; k %= x.length; }
      const e = Math.min(1, (i + 1) / fade, (len - i) / fade) * gate[i];
      y[a + i] += L.gain * e * x[k];
    }
  }
  return Float32Array.from(y);
}
function gateEnv(len, gates, fade) {
  const g = new Float64Array(len).fill(1);
  for (const [t0, t1] of gates) {
    const a = Math.round(t0 * SR), b = Math.round(t1 * SR);
    for (let i = Math.max(0, a - fade); i < Math.min(len, b + fade); i++) {
      const v = i < a ? (a - i) / fade : i >= b ? (i - b + 1) / fade : 0;
      g[i] = Math.min(g[i], Math.max(0, Math.min(1, v)));
    }
  }
  return g;
}
