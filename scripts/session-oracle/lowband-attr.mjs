// lowband-attr.mjs — per-hop stage-attribution dump for the low-register
// voicing pass (2026-10-04, measurements/pitch-low-register-voicing-2026-10-04.md).
// Same production chain as run.mjs / corpus.mjs (lib/chain.mjs: REAL pitch
// worker, REAL DSP worker, REAL handleAnalysisResult), plus a richer
// observation-only tap: every frame's top candidates (freq, strength), its
// unvoicedStrength, the tracker decode, the harmonic guard's verdict on the
// decoded frame and the posted value — enough to say WHICH stage lost a
// reference-voiced frame (lowband_attr.py).
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/lowband-attr.mjs \
//        --set=sessions|fda|ptdb|hil|voc [--src=src] [--tag=head] [--shard=i/n]
//        [--sessions=...] [--out=build/session-oracle/attr]
// Corpora come from the pitch-benchmark corpus dump ($PITCH_BENCH_DIR/data,
// scripts/pitch-benchmark/export_corpora.mjs — bit-identical to the loaders).
// Output: <out>/<tag>/<set>/<name>.f32 (Float32, column-major, COLS below)
// + <name>.json meta. Detection columns are indexed by the chunk completing
// the analysis frame (window centre = chunk end - 40 ms); display columns
// (paint, ro, inten) by display hop, as in lib/chain.mjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc, buildFrames, driveHook } from "./lib/chain.mjs";
import { readWav } from "./lib/wav.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const K = 8; // candidates kept per frame
export const COLS = ["uv", "ncand", ...Array.from({ length: K }, (_, i) => [`f${i}`, `s${i}`]).flat(),
  "dec", "guard", "post", "conf", "nnotch", "inten", "paint", "ro"];

function runX(S, samples, sr) {
  const C = Math.round(sr * 25 / 1000);
  const n = Math.floor(samples.length / C);
  const col = Object.fromEntries(COLS.map((c) => [c, new Float32Array(n)]));
  col.guard.fill(-1); col.inten.fill(NaN);
  const msgPitch = new Float32Array(n).fill(NaN), msgConf = new Float32Array(n).fill(NaN);
  const frameChunk = []; let L = null; let curK = -1; let lastDec = -1;
  globalThis.__SO_TAP = {
    tracker(t) { L = t.config.lookback; },
    cand(fc) {
      col.uv[curK] = fc.unvoicedStrength; col.ncand[curK] = fc.voiced.length;
      for (let i = 0; i < K && i < fc.voiced.length; i++) { col[`f${i}`][curK] = fc.voiced[i].freq; col[`s${i}`][curK] = fc.voiced[i].strength; }
      frameChunk.push(curK);
    },
    emit(d) {
      const fi = frameChunk.length - 1; lastDec = -1;
      if (L !== null && fi >= L) { lastDec = frameChunk[fi - L]; col.dec[lastDec] = d > 0 ? d : 0; }
    },
    guard(keep) { if (lastDec >= 0) col.guard[lastDec] = keep ? 1 : 0; },
  };
  const { P, D } = S;
  globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: sr } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  if (L === null) throw new Error("tap not active (SO_TAP=0?)");
  globalThis.self = D; D.posts = [];
  D.onmessage({ data: { type: "init", sampleRate: sr } });
  const dp = {}; D.onmessage({ data: { type: "port", port: dp } });
  let busyNs = 0n;
  for (let k = 0; k < n; k++) {
    const ct = (k + 1) * C / sr;
    globalThis.self = P; curK = k; P.posts.length = 0;
    const a = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
    const t0 = process.hrtime.bigint();
    pp.onmessage({ data: { buffer: a.buffer, contextTime: ct } });
    busyNs += process.hrtime.bigint() - t0;
    for (const m of P.posts) {
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
      if (m.type !== "pitch") continue;
      const kk = Math.round(m.contextTime * sr / C) - 1;
      col.post[kk] = m.pitch !== null ? m.pitch : 0; col.conf[kk] = m.confidence;
      col.nnotch[kk] = m.notchedFreqs ? m.notchedFreqs.length : 0;
      msgPitch[k] = m.pitch !== null ? m.pitch : 0; msgConf[k] = m.confidence;
    }
    globalThis.self = D; D.posts.length = 0;
    const b = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
    dp.onmessage({ data: { buffer: b.buffer, contextTime: ct } });
    for (const m of D.posts) if (m.type === "analysis") col.inten[k] = m.data.intensity;
  }
  globalThis.__SO_TAP = null;
  return { n, C, sr, L, col, msgPitch, msgConf, cpuMsPerChunk: Number(busyNs) / 1e6 / n };
}

const SRC = args.src ?? "src", TAG = args.tag ?? "head", SET = args.set ?? "sessions";
const OUT = resolve(args.out ?? "build/session-oracle/attr", TAG, SET);
mkdirSync(OUT, { recursive: true });
const S = await loadSrc(SRC);
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
let items;
if (SET === "sessions") {
  const ROOT = args["sessions-root"] ?? process.env.SYRINX_SESSIONS_DIR;
  if (!ROOT) throw new Error("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)");
  items = (args.sessions ?? "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",").map((s) => ({ name: s, load: () => readWav(`${ROOT}/${s}/session.wav`) }));
} else {
  const DATA = resolve(process.env.PITCH_BENCH_DIR ?? "build/pitch-benchmark", "data");
  const index = JSON.parse(readFileSync(resolve(DATA, "index.json"), "utf8"));
  items = index.filter((t) => t.corpus === SET).map((t) => ({
    name: t.trackId, gender: t.gender,
    load: () => { const b = readFileSync(resolve(DATA, SET, `${t.trackId}.f32`)); return { samples: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), sr: t.sr }; },
  }));
}
items = items.filter((_, i) => i % shN === shI);
const t0 = Date.now();
for (const it of items) {
  const { samples, sr } = it.load();
  const W = runX(S, samples, sr);
  const Dc = await driveHook(S.hookPath, buildFrames(W), W.n);
  W.col.paint.set(Dc.paint); W.col.ro.set(Dc.ro);
  const tbl = new Float32Array(W.n * COLS.length);
  COLS.forEach((c, i) => tbl.set(W.col[c], i * W.n));
  writeFileSync(resolve(OUT, `${it.name}.f32`), Buffer.from(tbl.buffer));
  writeFileSync(resolve(OUT, `${it.name}.json`), JSON.stringify({ name: it.name, gender: it.gender ?? null, n: W.n, hopS: W.C / W.sr, L: W.L, cols: COLS, cpuMsPerChunk: W.cpuMsPerChunk, src: resolve(SRC) }));
}
console.log(`${TAG} ${SET} ${shI}/${shN}: ${items.length} items ${(Date.now() - t0) / 1000}s`);
