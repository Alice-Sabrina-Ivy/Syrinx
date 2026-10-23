// denoise.js — Voice Shaper's optional background-noise reduction: RNNoise 0.2 (xiph/rnnoise,
// BSD-3-Clause) on the recording before the WORLD analysis, inside the voice-preview worker
// (../vp-worker.js) and in Node by the tests. measurements/voice-shaper-denoise-2026-10-23.md.
//
// The module, src/voice-preview/rnnoise/rnnoise.wasm, is the RNNoise 0.2 build embedded in the
// pinned npm package @jitsi/rnnoise-wasm (dist/rnnoise-sync.js), taken out unchanged by
// scripts/voice-preview/extract-rnnoise.mjs. It is loaded here without Emscripten's glue: the
// module imports two functions (heap growth, a large memcpy) and exports its memory and the
// RNNoise entry points under minified names, which belong to these exact bytes — EXPORTS and
// RNNOISE_PINS.wasmSha256 change together (tests/voice-preview/denoise-test.js).
//
//   loadRnnoise(url) -> Promise<rnnoise>        fetch + compile + instantiate (the worker)
//   createRnnoise(bytes | WebAssembly.Module)   the same, synchronous (Node tests)
//   rnnoise.denoise48(pcm)   Float32Array at 48 kHz (±1) -> denoised, same length, delay-compensated
//   denoiseClip(rnnoise, pcm, sr)   any capture rate: sr -> 48 kHz -> RNNoise -> sr (the engine's
//                                   zero-phase sinc resampler), same length as pcm
//
// RNNoise works on 480-sample (10 ms) frames at 48 kHz with int16-scaled floats and delays its
// output by RNNOISE_DELAY samples; denoise48 feeds that many zeros after the clip and drops the
// first RNNOISE_DELAY outputs, so the result lines up with the posted pitch track. A fresh
// RNNoise state per clip: the result depends only on the clip.
import { resampleClip } from "./engine/preview.js";

export const RNNOISE_PINS = Object.freeze({
  packageVersion: "0.2.1",
  packageGitHead: "cb529a59a8478fe604e57986fc96afdaecfa6fb7",
  rnnoiseCommit: "372f7b4b76cde4ca1ec4605353dd17898a99de38",
  syncJsSha256: "05a553f523d59502d133a6d05dbf1878137c9e7bcff06edf5561f7001b62f95f",
  wasmSha256: "4f513a50613de74378331237886138eab52fa2650e8b1a41eb587d932d9b8850",
  wasmBytes: 1440118,
});
/** The module's minified export names (Module["asm"] in the package's rnnoise-sync.js). */
export const EXPORTS = Object.freeze({ memory: "c", ctors: "d", malloc: "e", free: "f", create: "h", destroy: "i", process: "j" });
export const RNNOISE_RATE = 48000;
export const FRAME = 480;
/** Output delay of rnnoise_process_frame, samples at 48 kHz (two frames; measured, denoise-test.js). */
export const RNNOISE_DELAY = 960;
const SCALE = 32768;

function instantiate(module) {
  let memory = null;
  const imports = {
    a: {
      // emscripten_resize_heap(requestedSize): grow to at least requestedSize bytes
      a(requested) {
        const want = requested >>> 0;
        const have = memory.buffer.byteLength;
        if (want <= have) return 1;
        try { memory.grow(Math.ceil((want - have) / 65536)); return 1; } catch { return 0; }
      },
      // emscripten_memcpy_big(dest, src, num)
      b(dest, src, num) { new Uint8Array(memory.buffer).copyWithin(dest, src, src + num); },
    },
  };
  const inst = new WebAssembly.Instance(module, imports);
  const e = inst.exports;
  for (const [k, name] of Object.entries(EXPORTS)) {
    if (!e[name]) throw new Error(`RNNoise module has no export "${name}" (${k})`);
  }
  memory = e[EXPORTS.memory];
  e[EXPORTS.ctors]();
  const fn = (k) => e[EXPORTS[k]];

  function denoise48(pcm) {
    const st = fn("create")(0);
    if (!st) throw Object.assign(new Error("rnnoise_create failed"), { kind: "memory" });
    const pin = fn("malloc")(FRAME * 4);
    const pout = fn("malloc")(FRAME * 4);
    if (!pin || !pout) throw Object.assign(new Error("RNNoise malloc failed"), { kind: "memory" });
    try {
      const n = pcm.length;
      const total = n + RNNOISE_DELAY;
      const out = new Float32Array(n);
      for (let k = 0; k < total; k += FRAME) {
        // the heap can grow (and its buffer move) inside process: views are made per frame
        let heap = new Float32Array(memory.buffer, pin, FRAME);
        for (let i = 0; i < FRAME; i++) { const j = k + i; heap[i] = j < n ? pcm[j] * SCALE : 0; }
        fn("process")(st, pout, pin);
        heap = new Float32Array(memory.buffer, pout, FRAME);
        for (let i = 0; i < FRAME; i++) {
          const j = k + i - RNNOISE_DELAY;
          if (j >= 0 && j < n) out[j] = heap[i] / SCALE;
        }
      }
      return out;
    } finally {
      fn("free")(pin);
      fn("free")(pout);
      fn("destroy")(st);
    }
  }

  return { denoise48, memoryBytes: () => memory.buffer.byteLength };
}

/** Synchronous: bytes (ArrayBuffer / typed array) or a compiled WebAssembly.Module. */
export function createRnnoise(src) {
  return instantiate(src instanceof WebAssembly.Module ? src : new WebAssembly.Module(src));
}

/** Fetch, compile and instantiate the module at `url`. */
export async function loadRnnoise(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RNNoise module: HTTP ${res.status}`);
  const module = await WebAssembly.compile(await res.arrayBuffer());
  return instantiate(module);
}

/** Denoise a whole clip at its capture rate sr; returns a Float32Array of pcm.length samples at sr. */
export function denoiseClip(rnnoise, pcm, sr) {
  if (sr === RNNOISE_RATE) return rnnoise.denoise48(pcm);
  const y = resampleClip(rnnoise.denoise48(resampleClip(pcm, sr, RNNOISE_RATE)), RNNOISE_RATE, sr);
  if (y.length === pcm.length) return y;
  const out = new Float32Array(pcm.length);
  out.set(y.subarray(0, Math.min(y.length, pcm.length)));
  return out;
}
