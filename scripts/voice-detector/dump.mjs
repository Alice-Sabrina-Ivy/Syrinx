// dump.mjs — voice-detector benchmark, step 1 (2026-10-06): what the CURRENT
// app paints, per 25 ms hop, on every stream of a set.
//
// Runs the production chain of a src tree (scripts/session-oracle/lib/
// chain.mjs: the REAL pitch worker incl. notch / ghost veto / above-range
// null / harmonic guard, the REAL DSP worker at the stream's own rate, the
// REAL main-thread display decision handleAnalysisResult with its silence
// gate, 400 ms pitch-hold bridge, smoothing and paint gate) over each stream
// with fresh worker / hook state, and writes per stream
//   <out>/dumps/<set>/<id>.json  meta: n hops, hop_s, sr, L, gender, the
//                                 stream's audio spec (candidates read the
//                                 SAME samples from it), set-specific meta
//   <out>/dumps/<set>/<id>.f32   float32 columns [col][hop], COLS below
//
// Hop k = display hop = the DSP frame of capture chunk k; HOP TIME
// t_k = (k + 1) * 25 ms of stream time (the chunk end, when the app paints
// hop k). The painted value describes the pitch frame k - L, so its reference
// is read at the display alignment of scripts/session-oracle/corpus.mjs:
// td_k = t_k - 0.040 - L * 0.025 - 0.030 (= t_k - 120 ms at L = 2).
//
// COLS
//   paint  value painted on the live trace at hop k (Hz, 0 = nothing)
//   ro     readout Hz in the hook state (0 = "—")    style 0 / 1 holding / 2 voiced
//   inten  DSP intensity (dB, NaN before the DSP worker posts)
//   refd   reference F0 at td_k: > 0 voiced, 0 unvoiced, -1 no reference
//          (noise-only audio; outside every voice layer of a mix)
//   lab    0 not painted (or td_k < 0)
//          1 CORRECT  painted within 5 % of a voiced reference
//          2 FALSE    painted on noise-only audio, or with no voiced
//                     reference within +-100 ms of td_k
//          3 WRONG    painted, voiced reference, off by >= 5 %
//          4 EDGE     painted, reference unvoiced at td_k but voiced within
//                     +-100 ms (span boundary; neither correct nor false)
//   seg    mixes: 1 noise-only lead (>= 1.5 s into the stream, > 0.1 s before
//          the voice program), 2 program (voice_t0..voice_t1), 3 tail
//          (> 0.5 s after the program), 0 otherwise / other sets
//   held   1 inside a held segment [h0 + 0.3, h1 - 0.1] (VocalSet / PVQD /
//          VOICED / vocadito clips, mixes' held-series programs), else 0
//
// Usage (repo root; <= 3 shards at a time on the shared machine):
//   NOTCHVD_ROOT=<...>/build/notchvd SYRINX_CORPORA_DIR=<checkout>/tests/dsp/data \
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-detector/dump.mjs \
//        --set=noise|noiseho|vin20|vin0|fda|ptdb|voc|hil|vocalset|pvqd|voiced \
//        [--src=src] [--out=build/vad] [--shard=i/n] [--ids=a,b] [--skip-existing]
//        [--relabel]   (recompute refd / lab / seg / held over existing dumps)
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { readWav } from "../notch-adversarial/realdata/realdata.mjs";
import { loadSrc, runWorkers, buildFrames, driveHook } from "../session-oracle/lib/chain.mjs";
import { setItems } from "./lib/sets.mjs";

export const COLS = ["paint", "ro", "style", "inten", "refd", "lab", "seg", "held"];
const LAB = { none: 0, correct: 1, false: 2, wrong: 3, edge: 4 };

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SET = args.set, SRC = args.src ?? "src";
if (!SET) throw new Error("--set=<name> required");
const OUT = resolve(args.out ?? "build/vad", "dumps", SET);
mkdirSync(OUT, { recursive: true });
let rev = null;
try { rev = execSync(`git log -1 --format=%h -- "${resolve(SRC)}"`, { encoding: "utf8" }).trim(); } catch { /* not a git tree */ }

let items = await setItems(SET);
if (args.ids) { const s = new Set(args.ids.split(",")); items = items.filter((x) => s.has(x.id)); }
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
items = items.filter((_, i) => i % shN === shI);
const S = args.relabel ? null : await loadSrc(SRC);

// the audio spec must reproduce the samples the chain gets (in place, no copy)
function checkAudio(it, x) {
  const a = it.audio;
  let at;
  if (a.fmt === "sig16be") {
    const b = readFileSync(a.path);
    if (b.length / 2 < a.start + x.length) throw new Error(`${a.path}: shorter than the stream`);
    at = (i) => b.readInt16BE((a.start + i) * 2) / 32768;
  } else {
    const w = readWav(a.path);
    if (w.sampleRate !== a.sr || w.samples.length < a.start + x.length) throw new Error(`${a.path}: rate / length mismatch`);
    at = (i) => w.samples[a.start + i];
  }
  for (const i of [0, 1, x.length >> 2, x.length >> 1, x.length - 1]) if (Math.abs(at(i) - x[i]) > 1e-7) throw new Error(`${a.path}: sample ${i} differs from the stream`);
}

// reference / label columns from the painted column (also --relabel: redo
// them over existing dumps without re-running the chain)
function labelCols(item, col, n, hop, L) {
  const holds = item.holds ?? [];
  const v0 = item.meta.voice_t0, v1 = item.meta.voice_t1;
  for (let k = 0; k < n; k++) {
    const tk = (k + 1) * hop;
    const td = tk - 0.040 - L * hop - 0.030;
    const r = td >= 0 ? item.ref(td) : -1;
    col.refd[k] = r; col.seg[k] = 0; col.held[k] = 0;
    if (v0 !== undefined) col.seg[k] = td >= v0 && td <= v1 ? 2 : td > v1 + 0.5 ? 3 : (td >= 1.5 && td < v0 - 0.1 ? 1 : 0);
    for (const [h0, h1] of holds) if (td >= h0 + 0.3 && td <= h1 - 0.1) { col.held[k] = 1; break; }
    // painted = whatever the trace drew at hop k (the hook only draws on hops
    // with a DSP frame; a digitally silent frame, intensity -inf, still draws
    // the hold bridge)
    const p = col.paint[k];
    if (!(p > 0) || td < 0) { col.lab[k] = LAB.none; continue; }
    if (r > 0) { col.lab[k] = Math.abs(p / r - 1) < 0.05 ? LAB.correct : LAB.wrong; continue; }
    let near = false;
    for (let d = -0.1; d <= 0.1001 && !near; d += 0.025) { const t = td + d; if (t >= 0 && item.ref(t) > 0) near = true; }
    col.lab[k] = near ? LAB.edge : LAB.false;
  }
}

const t0 = Date.now();
let done = 0;
for (const item of items) {
  const fp = resolve(OUT, `${item.id}.f32`), jp = resolve(OUT, `${item.id}.json`);
  if (args.relabel) {
    const m = JSON.parse(readFileSync(jp, "utf8"));
    const b = readFileSync(fp);
    const tbl = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    const col = Object.fromEntries(m.cols.map((c, i) => [c, tbl.subarray(i * m.n, (i + 1) * m.n)]));
    labelCols(item, col, m.n, m.hop_s, m.L);
    writeFileSync(fp, Buffer.from(tbl.buffer));
    done++;
    continue;
  }
  if (args["skip-existing"] && existsSync(fp) && existsSync(jp)) continue;
  const it = item.load();
  const x = it.samples, sr = it.sr;
  checkAudio(it, x);
  const W = runWorkers(S, x, sr);
  const D = await driveHook(S.hookPath, buildFrames(W), W.n);
  const n = W.n, hop = W.C / sr, L = W.L;
  const col = Object.fromEntries(COLS.map((c) => [c, new Float32Array(n)]));
  col.paint.set(D.paint); col.ro.set(D.ro); col.style.set(D.style); col.inten.set(W.col.inten);
  labelCols(item, col, n, hop, L);
  const tbl = new Float32Array(n * COLS.length);
  COLS.forEach((c, i) => tbl.set(col[c], i * n));
  writeFileSync(fp, Buffer.from(tbl.buffer));
  const audio = { ...it.audio, len: n * W.C };
  writeFileSync(jp, JSON.stringify({
    set: SET, id: item.id, n, hop_s: hop, C: W.C, sr, L, gender: item.gender, cols: COLS,
    audio, src: resolve(SRC), src_rev: rev, holds: item.holds ?? [], ...item.meta,
  }));
  done++;
}
console.log(`${SET} ${shI}/${shN}: ${done} of ${items.length} streams ${args.relabel ? "relabelled" : "dumped"} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
