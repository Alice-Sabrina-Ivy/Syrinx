// guard-probe.mjs — per-harmonic prominence of every frame the REAL pitch
// worker hands to its harmonic voicing guard (2026-10-04 low-register
// voicing pass, measurements/pitch-low-register-voicing-2026-10-04.md).
// For each guard call (decoded frame, its f0 and its own delayed buffer) it
// records peak/floor in dB at k*f0, k = 1..8, under two floors:
//   prod  median of the ±35 %-of-k*f0 band (production harmonicStructureCount)
//   ih    median of the inter-harmonic bins only (|b - k f0| >= lobe and
//         >= lobe from k f0 ± f0; lobe = Hann main-lobe half-width 2/T + 5 Hz)
// so guard rules can be designed against reference-labelled frames
// (guard_probe.py) instead of by trial.
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/guard-probe.mjs \
//        --set=sessions|fda|ptdb|hil|voc|noise [--src=src] [--tag=base] [--shard=i/n] [--sessions=...]
// Output: build/session-oracle/gprobe/<tag>/<set>/<name>.f32 rows of
//   [hop, f0, keep, prod1..8, ih1..8] (Float32, row-major, 19 per call) + .json meta.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc } from "./lib/chain.mjs";
import { readWav } from "./lib/wav.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const KMAX = 8, ROW = 3 + 2 * KMAX, FFTN = 4096;
const re = new Float64Array(FFTN), im = new Float64Array(FFTN), pw = new Float64Array(FFTN / 2);
let hann = null;
function fft() {
  const n = FFTN;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function prominences(buf, f0, sr, out, o) {
  if (!hann || hann.length !== buf.length) { hann = new Float64Array(buf.length); for (let i = 0; i < buf.length; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (buf.length - 1)); }
  re.fill(0); im.fill(0);
  for (let i = 0; i < Math.min(buf.length, FFTN); i++) re[i] = buf[i] * hann[i];
  fft();
  for (let b = 0; b < FFTN / 2; b++) pw[b] = re[b] * re[b] + im[b] * im[b];
  const half = FFTN / 2, binHz = sr / FFTN, lobe = 2 / (buf.length / sr) + 5;
  const med = (a) => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)] || 1e-12; };
  for (let k = 1; k <= KMAX; k++) {
    const f = k * f0;
    if (f > sr / 2 - 100) { out[o + 3 + k - 1] = NaN; out[o + 3 + KMAX + k - 1] = NaN; continue; }
    let peak = 0;
    for (let b = Math.max(1, Math.floor(f * 0.96 / binHz)); b <= Math.min(half - 1, Math.ceil(f * 1.04 / binHz)); b++) if (pw[b] > peak) peak = pw[b];
    const bp = [];
    for (let b = Math.max(1, Math.floor(f * 0.65 / binHz)); b <= Math.min(half - 1, Math.ceil(f * 1.35 / binHz)); b++) bp.push(pw[b]);
    const bi = [];
    const w = Math.max(f0 - lobe, lobe + 2 * binHz);
    for (let b = Math.max(1, Math.floor((f - w) / binHz)); b <= Math.min(half - 1, Math.ceil((f + w) / binHz)); b++) {
      const df = Math.abs(b * binHz - f);
      if (df < lobe || (f0 - df < lobe && df <= w)) continue;
      bi.push(pw[b]);
    }
    const fp = med(bp), fi = bi.length >= 4 ? med(bi) : fp;
    out[o + 3 + k - 1] = 10 * Math.log10(peak / fp + 1e-12);
    out[o + 3 + KMAX + k - 1] = 10 * Math.log10(peak / fi + 1e-12);
  }
}

const SRC = args.src ?? "src", TAG = args.tag ?? "base", SET = args.set ?? "sessions";
const OUT = resolve("build/session-oracle/gprobe", TAG, SET);
mkdirSync(OUT, { recursive: true });
const S = await loadSrc(SRC);
let items;
if (SET === "sessions") {
  const ROOT = process.env.SYRINX_SESSIONS_DIR; // the private session recordings (local only; see CLAUDE.md)
  if (!ROOT) throw new Error("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)");
  items = (args.sessions ?? "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",").map((s) => ({ name: s, load: () => readWav(`${ROOT}/${s}/session.wav`) }));
} else if (SET === "noise") {
  const { SR, NOISE_TYPES } = await import("../noise-synth.js");
  items = Object.keys(NOISE_TYPES).map((nz) => ({ name: nz, load: () => ({ samples: Float32Array.from(NOISE_TYPES[nz](30 * SR), (x) => x * 0.03), sr: SR }) }));
} else {
  const DATA = resolve(process.env.PITCH_BENCH_DIR ?? "build/pitch-benchmark", "data");
  const index = JSON.parse(readFileSync(resolve(DATA, "index.json"), "utf8"));
  items = index.filter((t) => t.corpus === SET).map((t) => ({
    name: t.trackId,
    load: () => { const b = readFileSync(resolve(DATA, SET, `${t.trackId}.f32`)); return { samples: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), sr: t.sr }; },
  }));
}
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
items = items.filter((_, i) => i % shN === shI);
for (const it of items) {
  const { samples, sr } = it.load();
  const C = Math.round(sr * 0.025), n = Math.floor(samples.length / C);
  const rows = []; const frameChunk = []; let L = null, curK = -1, lastDec = -1;
  globalThis.__SO_TAP = {
    tracker(t) { L = t.config.lookback; },
    cand() { frameChunk.push(curK); },
    emit() { const fi = frameChunk.length - 1; lastDec = L !== null && fi >= L ? frameChunk[fi - L] : -1; },
    guard(keep, f0, buf) {
      const r = new Float32Array(ROW); r[0] = lastDec; r[1] = f0; r[2] = keep ? 1 : 0;
      prominences(buf, f0, 16000, r, 0); rows.push(r);
    },
  };
  const P = S.P; globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: sr } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  for (let k = 0; k < n; k++) {
    curK = k; P.posts.length = 0;
    pp.onmessage({ data: { buffer: Float32Array.from(samples.subarray(k * C, (k + 1) * C)).buffer, contextTime: (k + 1) * C / sr } });
  }
  globalThis.__SO_TAP = null;
  const tbl = new Float32Array(rows.length * ROW);
  rows.forEach((r, i) => tbl.set(r, i * ROW));
  writeFileSync(resolve(OUT, `${it.name}.f32`), Buffer.from(tbl.buffer));
  writeFileSync(resolve(OUT, `${it.name}.json`), JSON.stringify({ name: it.name, n, hopS: C / sr, L, row: ["hop", "f0", "keep", ...Array.from({ length: KMAX }, (_, i) => `prod${i + 1}`), ...Array.from({ length: KMAX }, (_, i) => `ih${i + 1}`)] }));
}
console.log(`${TAG} ${SET} ${shI}/${shN}: ${items.length} items`);
