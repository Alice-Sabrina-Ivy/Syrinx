// corpora.js — shared loaders for the pitch-detection corpora used by
// tests/dsp/pitch-bucket-harness.js. Each loader returns an array of
// uniform Track records:
//
//   {
//     corpus:     "hillenbrand" | "ptdb-tug" | "vocadito" | "fda",
//     trackId:    string,                 // file basename, no extension
//     gender:     "m" | "f" | "b" | "g" | "unknown",
//     samples:    Float32Array,           // mono PCM, [-1, 1]
//     sampleRate: number,                 // Hz
//     ref:        { f0: Float32Array, hopMs: number },  // f0[i]=0 means unvoiced
//   }
//
// Each corpus' upstream format is parsed here. The existing per-corpus
// tests (real-speech-test.js, ptdb-tug-test.js, vocadito-test.js,
// fda-test.js) were each written self-contained and remain so — the
// harness uses these shared loaders to avoid duplicating ~200 LOC of
// format-specific parsing across multiple harness scripts.

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");
const DATA = join(ROOT, "tests/dsp/data");

// ---------------------------------------------------------------------------
//  Format readers
// ---------------------------------------------------------------------------

// 16-bit PCM mono WAV (Hillenbrand 16 kHz, PTDB-TUG 48 kHz, Vocadito 44.1 kHz)
function readWav(path) {
  const buf = readFileSync(path);
  let off = 12, sr = 0, bps = 0, ds = 0, dz = 0;
  while (off < buf.length - 8) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt ") { sr = buf.readUInt32LE(off + 12); bps = buf.readUInt16LE(off + 22); }
    else if (id === "data") { ds = off + 8; dz = sz; break; }
    off += 8 + sz;
  }
  const n = dz / (bps / 8);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(ds + i * 2) / 32768;
  return { samples: s, sampleRate: sr };
}

// 16-bit PCM mono raw, big-endian. FDA .sig files at 20 kHz.
function readSig(path, sampleRate = 20000) {
  const buf = readFileSync(path);
  const n = buf.length / 2;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16BE(i * 2) / 32768;
  return { samples: s, sampleRate };
}

// PTDB-TUG .f0 — 4 cols, 10 ms hop. Col 1 = f0 Hz, col 2 = voiced flag.
function readPtdbF0(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const f0 = new Float32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    const voiced = parts[1] === "1.0" || parts[1] === "1";
    f0[i] = voiced ? parseFloat(parts[0]) : 0;
  }
  return { f0, hopMs: 10 };
}

// Vocadito .csv — 2 cols, 5.8 ms hop. Col 1 = time, col 2 = f0 (0 = unvoiced).
function readVocaditoF0(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const t = new Float32Array(lines.length);
  const f0 = new Float32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",");
    t[i] = parseFloat(parts[0]);
    f0[i] = parseFloat(parts[1]);
  }
  const hopMs = t.length >= 2 ? (t[1] - t[0]) * 1000 : 5.8049886;
  return { f0, hopMs };
}

// FDA .fx — XMG format. ASCII header to 0x0c, then `time_ms F0_Hz` pitchmark
// pairs separated by `=` voicing-break lines. We resample irregular pitchmarks
// onto a 5 ms grid via linear interpolation within voiced segments.
const FDA_REF_HOP_MS = 5;
function readFdaFx(path) {
  const buf = readFileSync(path);
  const hdrEnd = buf.indexOf(0x0c);
  if (hdrEnd === -1) throw new Error(`No 0x0c header terminator in ${path}`);
  const data = buf.toString("utf8", hdrEnd + 1).trim();
  const lines = data.split("\n");
  const segments = [];
  let cur = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") continue;
    if (t === "=") { if (cur.length > 0) segments.push(cur); cur = []; continue; }
    const parts = t.split(/\s+/);
    if (parts.length !== 2) continue;
    const tMs = parseFloat(parts[0]);
    const f0 = parseFloat(parts[1]);
    if (Number.isFinite(tMs) && Number.isFinite(f0)) cur.push({ tMs, f0 });
  }
  if (cur.length > 0) segments.push(cur);
  const lastTimeMs = segments.length > 0 && segments[segments.length - 1].length > 0
    ? segments[segments.length - 1][segments[segments.length - 1].length - 1].tMs
    : 0;
  const nBins = Math.ceil(lastTimeMs / FDA_REF_HOP_MS) + 1;
  const f0 = new Float32Array(nBins);
  for (const seg of segments) {
    if (seg.length === 0) continue;
    const startBin = Math.ceil(seg[0].tMs / FDA_REF_HOP_MS);
    const endBin = Math.floor(seg[seg.length - 1].tMs / FDA_REF_HOP_MS);
    for (let bin = startBin; bin <= endBin; bin++) {
      const queryMs = bin * FDA_REF_HOP_MS;
      let lo = 0, hi = seg.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >>> 1;
        if (seg[mid].tMs <= queryMs) lo = mid; else hi = mid;
      }
      const a = seg[lo], b = seg[hi];
      const span = b.tMs - a.tMs;
      f0[bin] = span > 0 ? a.f0 + (b.f0 - a.f0) * (queryMs - a.tMs) / span : a.f0;
    }
  }
  return { f0, hopMs: FDA_REF_HOP_MS };
}

// ---------------------------------------------------------------------------
//  Per-corpus loaders
// ---------------------------------------------------------------------------

// Hillenbrand has single steady-state F0 per file. We mark the central 70%
// of each utterance as voiced at that F0; surrounding regions get 0
// (mirrors real-speech-test.js's central-70 % convention).
const HILLENBRAND_REF_HOP_MS = 5;
const HILLENBRAND_CENTRAL = [0.15, 0.85];

export function loadHillenbrand() {
  const dir = join(DATA);
  const vowdataPath = join(dir, "vowdata.dat");
  if (!existsSync(vowdataPath)) return [];
  const truth = new Map();
  for (const line of readFileSync(vowdataPath, "utf8").split("\n")) {
    const m = line.match(/^([mwbg]\d{2}\w{2})\s+\d+\s+(\d+)/);
    if (m) {
      const f0 = parseInt(m[2], 10);
      if (f0 > 0) truth.set(m[1], f0);
    }
  }
  const out = [];
  for (const sub of ["men", "women"]) {
    const subDir = join(dir, sub);
    if (!existsSync(subDir)) continue;
    for (const wavFile of readdirSync(subDir).filter((f) => f.endsWith(".wav"))) {
      const stem = wavFile.replace(/\.wav$/, "");
      const trueF0 = truth.get(stem);
      if (!trueF0) continue;
      const { samples, sampleRate } = readWav(join(subDir, wavFile));
      const durMs = samples.length * 1000 / sampleRate;
      const nBins = Math.ceil(durMs / HILLENBRAND_REF_HOP_MS);
      const f0 = new Float32Array(nBins);
      const startBin = Math.floor(nBins * HILLENBRAND_CENTRAL[0]);
      const endBin = Math.ceil(nBins * HILLENBRAND_CENTRAL[1]);
      for (let i = startBin; i < endBin; i++) f0[i] = trueF0;
      out.push({
        corpus: "hillenbrand",
        trackId: stem,
        gender: stem[0],
        samples, sampleRate,
        ref: { f0, hopMs: HILLENBRAND_REF_HOP_MS },
      });
    }
  }
  return out;
}

export function loadPtdbTug() {
  const dir = join(DATA, "ptdb-tug");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const [gender, gDir] of [["f", "FEMALE"], ["m", "MALE"]]) {
    const micRoot = join(dir, gDir, "MIC");
    if (!existsSync(micRoot)) continue;
    for (const speaker of readdirSync(micRoot)) {
      const speakerMicDir = join(micRoot, speaker);
      const speakerRefDir = join(dir, gDir, "REF", speaker);
      if (!existsSync(speakerRefDir)) continue;
      for (const wavFile of readdirSync(speakerMicDir).filter((f) => f.endsWith(".wav"))) {
        const refFile = wavFile.replace(/^mic_/, "ref_").replace(/\.wav$/, ".f0");
        const refPath = join(speakerRefDir, refFile);
        if (!existsSync(refPath)) continue;
        const { samples, sampleRate } = readWav(join(speakerMicDir, wavFile));
        if (sampleRate !== 48000) continue;
        out.push({
          corpus: "ptdb-tug",
          trackId: wavFile.replace(/\.wav$/, ""),
          gender,
          samples, sampleRate,
          ref: readPtdbF0(refPath),
        });
      }
    }
  }
  return out;
}

export function loadVocadito() {
  const dir = join(DATA, "vocadito");
  if (!existsSync(dir)) return [];
  const audioDir = join(dir, "Audio");
  const f0Dir = join(dir, "Annotations", "F0");
  if (!existsSync(audioDir) || !existsSync(f0Dir)) return [];
  const out = [];
  for (const wavFile of readdirSync(audioDir).filter((f) => f.endsWith(".wav"))) {
    const m = wavFile.match(/vocadito_(\d+)\.wav/);
    if (!m) continue;
    const trackId = parseInt(m[1], 10);
    const f0Path = join(f0Dir, `vocadito_${trackId}_f0.csv`);
    if (!existsSync(f0Path)) continue;
    const { samples, sampleRate } = readWav(join(audioDir, wavFile));
    if (sampleRate !== 44100) continue;
    out.push({
      corpus: "vocadito",
      trackId: `vocadito_${trackId}`,
      gender: "unknown",  // vocadito mixes singer demographics; track-level only
      samples, sampleRate,
      ref: readVocaditoF0(f0Path),
    });
  }
  return out;
}

export function loadFda() {
  const dir = join(DATA, "fda");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const [gender, sub] of [["m", "rl"], ["f", "sb"]]) {
    const subDir = join(dir, sub);
    if (!existsSync(subDir)) continue;
    for (const sigFile of readdirSync(subDir).filter((f) => f.endsWith(".sig"))) {
      const fxPath = join(subDir, sigFile.replace(/\.sig$/, ".fx"));
      if (!existsSync(fxPath)) continue;
      const { samples, sampleRate } = readSig(join(subDir, sigFile));
      out.push({
        corpus: "fda",
        trackId: sigFile.replace(/\.sig$/, ""),
        gender,
        samples, sampleRate,
        ref: readFdaFx(fxPath),
      });
    }
  }
  return out;
}

export function loadAllCorpora() {
  return [
    ...loadHillenbrand(),
    ...loadPtdbTug(),
    ...loadVocadito(),
    ...loadFda(),
  ];
}
