// run_wasm.mjs — WebRTC VAD candidate, browser runtime (voice-detector
// benchmark, 2026-10-06). Runs the browser-viable WASM port of the WebRTC
// VAD — @echogarden/fvad-wasm 0.2.0 (libfvad compiled with Emscripten,
// BSD-3-Clause) — on the benchmark streams through V8's WebAssembly engine,
// (1) checks its decisions against the py-webrtcvad reference cache of
// run_py.py frame by frame, and (2) measures its CPU cost per 25 ms of audio.
//
//   FVAD_WASM_JS=<dir>/node_modules/@echogarden/fvad-wasm/fvad.js \
//   node scripts/voice-detector/webrtc/run_wasm.mjs [--root=build/vad]
//        [--out=build/vad/webrtc] [--sets=noise,...] [--bench-only] [--bench-s=600]
//
// The package is NOT installed into the repository's node_modules: install
// it in a scratch directory and point FVAD_WASM_JS at its fvad.js.
//
// Input: identical int16 samples to run_py.py — 16 kHz streams read in place
// (lib/streams.mjs) and quantised as floor(x * 32768 + 0.5) clipped; the
// 20 / 44.1 / 48 kHz streams read from run_py.py's <out>/pcm16 dump of the
// resampled int16 input.
//
// Out: <out>/wasm/<set>/<id>.u8 = the decisions of modes 0..3 x frames
// 10 / 20 / 30 ms concatenated (mode-major), and <out>/wasm-check.json (per
// config: frames compared, frames that differ from py-webrtcvad, VAD CPU ms
// per 25 ms of audio). The benchmark block times the per-chunk cost the app
// would pay: 25 ms capture chunks at 16 kHz split into 10 ms VAD frames
// (incl. the int16 conversion and the copy into the WASM heap), and the same
// at 48 kHz input (the VAD's own internal 48 -> 8 kHz downsampler).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import { listStreams, loadAudio, SETS } from "../lib/streams.mjs";

const A = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const ROOT = A.root ?? "build/vad";
const OUT = A.out ?? join(ROOT, "webrtc");
const SEL = (A.sets ?? SETS.join(",")).split(",");
const MODES = [0, 1, 2, 3];
const FRAMES_MS = [10, 20, 30];
const FVAD = process.env.FVAD_WASM_JS;
if (!FVAD || !existsSync(FVAD)) throw new Error("set FVAD_WASM_JS to the fvad.js of @echogarden/fvad-wasm 0.2.0 (installed in a scratch dir)");

const fvadFactory = (await import(pathToFileURL(FVAD).href)).default;
const M = await fvadFactory();

class Vad {
  constructor(mode, sr, maxSamples) {
    this.h = M._fvad_new();
    if (!this.h) throw new Error("fvad_new failed");
    if (M._fvad_set_mode(this.h, mode) !== 0) throw new Error("fvad_set_mode");
    if (M._fvad_set_sample_rate(this.h, sr) !== 0) throw new Error("fvad_set_sample_rate");
    this.buf = M._malloc(maxSamples * 2);
  }
  // int16 frame (Int16Array view) -> 1 / 0
  process(frame) {
    M.HEAP16.set(frame, this.buf >> 1);
    const r = M._fvad_process(this.h, this.buf, frame.length);
    if (r < 0) throw new Error("fvad_process: invalid frame length");
    return r;
  }
  free() { M._free(this.buf); M._fvad_free(this.h); }
}

function toI16(x) {
  const o = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.floor(x[i] * 32768 + 0.5);
    o[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return o;
}

function pcmFor(meta) {
  if (meta.audio.sr === 16000) return toI16(loadAudio(meta).samples);
  const p = join(OUT, "pcm16", meta.set, `${meta.id}.i16`);
  const b = readFileSync(p);
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

// minimal .npz reader (zip of .npy, stored or deflated) for the uint8 arrays of run_py.py
function readNpz(path) {
  const b = readFileSync(path);
  const out = {};
  let eocd = b.length - 22;
  while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const nEnt = b.readUInt16LE(eocd + 10);
  let cd = b.readUInt32LE(eocd + 16);
  for (let e = 0; e < nEnt; e++) {
    const method = b.readUInt16LE(cd + 10), csize = b.readUInt32LE(cd + 20);
    const nlen = b.readUInt16LE(cd + 28), xlen = b.readUInt16LE(cd + 30), clen = b.readUInt16LE(cd + 32);
    const lho = b.readUInt32LE(cd + 42);
    const name = b.toString("utf8", cd + 46, cd + 46 + nlen);
    const lnl = b.readUInt16LE(lho + 26), lxl = b.readUInt16LE(lho + 28);
    const data = b.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize);
    const raw = method === 0 ? data : inflateRawSync(data);
    const hl = raw.readUInt16LE(8);
    out[name.replace(/\.npy$/, "")] = new Uint8Array(raw.subarray(10 + hl));
    cd += 46 + nlen + xlen + clen;
  }
  return out;
}

function runStream(pcm) {
  const res = {};
  for (const mode of MODES) {
    for (const fms of FRAMES_MS) {
      const n = 16 * fms, nfr = Math.floor(pcm.length / n);
      const v = new Vad(mode, 16000, n);
      const d = new Uint8Array(nfr);
      const t0 = performance.now();
      for (let i = 0; i < nfr; i++) d[i] = v.process(pcm.subarray(i * n, (i + 1) * n));
      res[`d${mode}_${fms}`] = { d, ms: performance.now() - t0 };
      v.free();
    }
  }
  return res;
}

function bench(seconds) {
  // the app's per-chunk cost: a 25 ms capture chunk (float32) -> int16 -> 10 ms
  // VAD frames (a 10 ms remainder carried to the next chunk), at 16 and 48 kHz
  const out = {};
  for (const sr of [16000, 48000]) {
    for (const mode of MODES) {
      const C = Math.round(0.025 * sr), F = Math.round(0.01 * sr);
      const n = Math.round(seconds * sr);
      // a deterministic speech-like test signal: harmonic buzz + noise, amplitude-modulated
      const x = new Float32Array(n);
      let s = 12345;
      for (let i = 0; i < n; i++) {
        s = (s * 1103515245 + 12345) >>> 0;
        const t = i / sr, f0 = 120 + 40 * Math.sin(2 * Math.PI * 0.3 * t);
        let h = 0;
        for (let k = 1; k <= 8; k++) h += Math.sin(2 * Math.PI * k * f0 * t) / k;
        x[i] = 0.1 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t)) * h + 0.01 * ((s / 4294967296) - 0.5);
      }
      const v = new Vad(mode, sr, F);
      const carry = new Int16Array(F);
      let nc = 0, voiced = 0;
      // warm-up pass, then the timed pass
      for (const timed of [false, true]) {
        nc = 0;
        const t0 = performance.now();
        for (let c = 0; c + C <= n; c += C) {
          const chunk = x.subarray(c, c + C);
          for (let i = 0; i < C; i++) {
            const q = Math.floor(chunk[i] * 32768 + 0.5);
            carry[nc++] = q > 32767 ? 32767 : q < -32768 ? -32768 : q;
            if (nc === F) { voiced += v.process(carry); nc = 0; }
          }
        }
        const ms = performance.now() - t0;
        if (timed) out[`sr${sr}_mode${mode}`] = { ms_per_25ms: ms / (n / C), chunks: Math.floor(n / C), voiced_frames: voiced };
      }
      v.free();
    }
  }
  return out;
}

const summary = { fvad: { package: "@echogarden/fvad-wasm@0.2.0", js: FVAD }, node: process.version, v8: process.versions.v8, configs: {}, bench: null };
if (!A["bench-only"]) {
  const tot = {};
  let cnt = 0;
  for (const meta of listStreams(ROOT, SEL)) {
    const pcm = pcmFor(meta);
    const r = runStream(pcm);
    const npz = join(OUT, "cache", meta.set, `${meta.id}.npz`);
    const ref = existsSync(npz) ? readNpz(npz) : null;
    const parts = [];
    for (const [k, { d, ms }] of Object.entries(r)) {
      parts.push(d);
      const t = (tot[k] ??= { frames: 0, differ: 0, compared: 0, ms: 0, audio_s: 0, streams_differ: 0 });
      t.frames += d.length;
      t.ms += ms;
      t.audio_s += pcm.length / 16000;
      if (ref && ref[k]) {
        if (ref[k].length !== d.length) throw new Error(`${meta.set}/${meta.id} ${k}: length ${d.length} vs py ${ref[k].length}`);
        let diff = 0;
        for (let i = 0; i < d.length; i++) diff += d[i] !== ref[k][i];
        t.compared += d.length;
        t.differ += diff;
        t.streams_differ += diff > 0;
      }
    }
    const dst = join(OUT, "wasm", meta.set, `${meta.id}.u8`);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length))));
    if (++cnt % 200 === 0) console.log(`${cnt} streams`);
  }
  for (const [k, t] of Object.entries(tot)) t.vad_ms_per_25ms = t.ms / (t.audio_s / 0.025);
  summary.configs = tot;
  summary.streams = cnt;
}
summary.bench = bench(Number(A["bench-s"] ?? 600));
const outFile = resolve(OUT, A["bench-only"] ? "wasm-bench.json" : "wasm-check.json");
writeFileSync(outFile, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
