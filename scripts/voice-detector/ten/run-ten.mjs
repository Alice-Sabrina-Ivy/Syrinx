// run-ten.mjs — TEN VAD candidate runner for the voice-detector benchmark
// (2026-10-06, phase 1: measurement only). Runs the OFFICIAL browser build of
// TEN VAD (github.com/TEN-framework/ten-vad, lib/Web/ten_vad.{js,wasm}: the
// Emscripten WASM module with its own feature extraction + GRU model) in
// Node's V8 WebAssembly on every benchmark stream and writes one probability
// per 16 ms frame (README "Candidate interface").
//
//   node scripts/voice-detector/ten/run-ten.mjs [--root=build/vad] [--out=build/vad/cand/ten]
//        [--ten=build/vad/ten/src] [--sets=noise,fda,...] [--shard=0/3] [--force]
//
// The clone of ten-vad (no weights are committed here) lives at --ten.
// Per stream: the exact samples the app got (lib/streams.mjs), resampled to
// 16 kHz when the stream is not 16 kHz with the app's own anti-aliased
// streaming resampler (src/resonance-lab/sinc-resampler.js; <= 2 ms of
// look-ahead, flushed with zeros at the stream end), scaled to int16, fed to
// one fresh TEN VAD instance in hops of 256 samples (the model's internal
// hop: 768-sample Hann window, 3-frame feature stack, GRU state). Frame i =
// 16 kHz samples [256 i, 256 (i + 1)), available at 16 (i + 1) ms (+ 2 ms
// resampler look-ahead on the 20 / 44.1 / 48 kHz sets: candidate.json
// declares first_avail_ms = 18 for every set, the conservative bound).
// Resumable: a stream whose .f32 already holds the full frame count is skipped.
// Timing of the WASM process calls is summed per shard (contended; the clean
// CPU number comes from bench-ten.mjs).
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listStreams, loadAudio, writeProbs, SETS } from "../lib/streams.mjs";
import { createSincResampler } from "../../../src/resonance-lab/sinc-resampler.js";

const A = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("=");
  return [k, v ?? "1"];
}));
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const ROOT = resolve(REPO, A.root ?? "build/vad");
const OUT = resolve(REPO, A.out ?? "build/vad/cand/ten");
const TEN = resolve(REPO, A.ten ?? "build/vad/ten/src");
const SEL = (A.sets ?? SETS.join(",")).split(",");
const [SHARD, NSHARD] = (A.shard ?? "0/1").split("/").map(Number);
const HOP = 256;
const SR = 16000;
const RS_HALF_TAPS = 32; // createSincResampler default: 32 output periods = 2 ms

export async function loadTen(tenDir = TEN) {
  const web = join(tenDir, "lib", "Web");
  const create = (await import(pathToFileURL(join(web, "ten_vad.js")).href)).default;
  const M = await create({ wasmBinary: readFileSync(join(web, "ten_vad.wasm")) });
  const hp = M._malloc(4), buf = M._malloc(HOP * 2), pp = M._malloc(4), fp = M._malloc(4);
  return {
    M,
    // probabilities of one stream (Int16Array @ 16 kHz), fresh instance
    run(x16, timing) {
      if (M._ten_vad_create(hp, HOP, 0.5) !== 0) throw new Error("ten_vad_create failed");
      const h = M.HEAP32[hp >> 2];
      const nf = Math.floor(x16.length / HOP);
      const p = new Float32Array(nf);
      const t0 = performance.now();
      for (let i = 0; i < nf; i++) {
        M.HEAP16.set(x16.subarray(i * HOP, (i + 1) * HOP), buf >> 1);
        if (M._ten_vad_process(h, buf, HOP, pp, fp) !== 0) throw new Error("ten_vad_process failed");
        const v = M.HEAPF32[pp >> 2];
        p[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      if (timing) { timing.ms += performance.now() - t0; timing.frames += nf; }
      M._ten_vad_destroy(hp);
      return p;
    },
  };
}

export function to16k(samples, sr) {
  if (sr === SR) return samples;
  const rs = createSincResampler(sr, SR, { halfTaps: RS_HALF_TAPS });
  const want = Math.ceil((samples.length * SR) / sr);
  const y = new Float32Array(want);
  let m = 0;
  const put = (o) => { const k = Math.min(o.length, want - m); if (k > 0) { y.set(o.subarray(0, k), m); m += k; } };
  // fed in 25 ms capture chunks as the app would: the resampler keeps a
  // bounded ring of history (one call with a whole stream would wrap it)
  const C = Math.round(0.025 * sr);
  for (let i = 0; i < samples.length; i += C) put(rs(samples.subarray(i, Math.min(samples.length, i + C))));
  // flush the look-ahead with zeros (the last ~2 ms of output; no future audio)
  put(rs(new Float32Array(Math.ceil(((RS_HALF_TAPS + 4) * sr) / SR))));
  if (m !== want) throw new Error(`resampler produced ${m} of ${want} samples`);
  return y;
}

export function toInt16(x) {
  const y = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.round(x[i] * 32768);
    y[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return y;
}

async function main() {
  const ten = await loadTen();
  const streams = listStreams(ROOT, SEL).filter((_, i) => i % NSHARD === SHARD);
  const timing = { ms: 0, frames: 0 };
  let done = 0, skipped = 0;
  const t0 = Date.now();
  for (const meta of streams) {
    const fp = join(OUT, meta.set, `${meta.id}.f32`);
    const len16 = Math.ceil((meta.audio.len * SR) / meta.audio.sr);
    const nf = Math.floor(len16 / HOP);
    if (!A.force && existsSync(fp) && statSync(fp).size === nf * 4) { skipped++; continue; }
    const { samples, sr } = loadAudio(meta);
    const p = ten.run(toInt16(to16k(samples, sr)), timing);
    if (p.length !== nf) throw new Error(`${meta.set}/${meta.id}: ${p.length} frames, expected ${nf}`);
    writeProbs(OUT, meta, p);
    done++;
    if (done % 50 === 0) console.log(`[${SHARD}/${NSHARD}] ${done + skipped}/${streams.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  const audioMs = timing.frames * 16;
  const summary = { shard: `${SHARD}/${NSHARD}`, sets: SEL, streams: streams.length, done, skipped, wasm_ms: timing.ms, audio_ms: audioMs,
    ms_per_25ms: audioMs ? (timing.ms / audioMs) * 25 : null, wall_s: (Date.now() - t0) / 1000, node: process.version };
  const ld = join(ROOT, "ten", "logs");
  mkdirSync(ld, { recursive: true });
  writeFileSync(join(ld, `run-${SEL.length === SETS.length ? "all" : SEL.join("+")}-${SHARD}of${NSHARD}.json`), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
