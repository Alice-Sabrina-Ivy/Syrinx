// denoise-stream.js — Voice Shaper's noise reduction while the recording is being made: the same
// computation as denoise.js denoiseClip (sr -> 48 kHz with the engine's sinc resampler -> RNNoise
// 0.2 -> sr, delay compensated, the recording's length), fed chunk by chunk, so that when the
// recording ends only the last few frames are left. Every sample it emits is final and equal to
// denoiseClip's (the resampler's output does not depend on how its input is chunked;
// tests/voice-preview/denoise-test.js checks the bytes). measurements/voice-shaper-noise-2026-10-25.md.
//
//   createDenoiseStream(rnnoise, sr) -> { push(chunk) -> Float32Array, finish() -> Float32Array, free() }
//     push: one chunk of the recording (any length); returns the denoised samples that became
//     ready (in order, possibly none). finish: the recording ended; returns the remaining
//     samples, so that everything returned adds up to exactly the pushed length. free: releases
//     the RNNoise state (finish does too).
import { createSincResampler } from "../resonance-lab/sinc-resampler.js";
import { RNNOISE_RATE, FRAME, RNNOISE_DELAY } from "./denoise.js";

const CHUNK_S = 0.025; // the zero chunks resampleClip flushes with (engine/preview.js)

export function createDenoiseStream(rnnoise, sr) {
  const same = sr === RNNOISE_RATE;
  const up = same ? null : createSincResampler(sr, RNNOISE_RATE, { cutoffHz: 0.45 * RNNOISE_RATE });
  const down = same ? null : createSincResampler(RNNOISE_RATE, sr, { cutoffHz: 0.45 * sr });
  const state = rnnoise.createState();
  const fin = new Float32Array(FRAME), fout = new Float32Array(FRAME);
  let fill = 0;          // samples waiting in fin
  let nIn = 0;           // recording samples pushed (at sr)
  let n48 = 0;           // 48 kHz samples given to RNNoise (before the zero padding)
  let rnnOut = 0;        // RNNoise output samples so far (including its delay)
  let y48 = 0;           // delay-compensated 48 kHz samples passed on
  let outN = 0;          // samples returned at sr
  let finished = false;

  const parts = [];
  const emit = (a) => { if (a.length) parts.push(a); };
  const take = () => {
    if (parts.length === 0) return new Float32Array(0);
    if (parts.length === 1) { const a = parts.pop(); outN += a.length; return a; }
    let n = 0; for (const a of parts) n += a.length;
    const o = new Float32Array(n); let k = 0;
    for (const a of parts) { o.set(a, k); k += a.length; }
    parts.length = 0; outN += n;
    return o;
  };

  // the delay-compensated 48 kHz output, up to `limit` samples in all (Infinity while recording)
  let limit48 = Infinity;
  function pass48(a) {
    const n = Math.min(a.length, limit48 - y48);
    if (n <= 0) return;
    const b = n === a.length ? a : a.subarray(0, n);
    y48 += n;
    emit(same ? Float32Array.from(b) : down(b));
  }
  function runFrame() {
    state.frame(fin, fout);
    const skip = Math.max(0, Math.min(FRAME, RNNOISE_DELAY - rnnOut));
    rnnOut += FRAME;
    if (skip < FRAME) pass48(fout.subarray(skip));
    fill = 0;
  }
  function feed48(a, cap = Infinity) {
    const n = Math.min(a.length, cap - n48);
    for (let i = 0; i < n; i++) {
      fin[fill++] = a[i];
      if (fill === FRAME) runFrame();
    }
    n48 += Math.max(0, n);
  }

  return {
    push(chunk) {
      if (finished) throw new Error("denoise stream: push after finish");
      nIn += chunk.length;
      feed48(same ? chunk : up(chunk));
      return take();
    },
    finish() {
      if (finished) return new Float32Array(0);
      finished = true;
      try {
        // resampleClip(pcm, sr, 48 kHz): exactly N48 samples, flushed with zero chunks
        const N48 = same ? nIn : Math.round(nIn * RNNOISE_RATE / sr);
        if (!same) {
          const z = new Float32Array(Math.round(sr * CHUNK_S));
          for (let guard = 0; n48 < N48 && guard < 64; guard++) feed48(up(z), N48);
        }
        // denoise48: zeros after the clip until the delay has come out; N48 samples kept
        limit48 = N48;
        const zf = new Float32Array(FRAME);
        while (y48 < N48) feed48(zf);
        // resampleClip(y48, 48 kHz, sr): exactly `want` samples, flushed with zero chunks
        const want = same ? N48 : Math.round(N48 * sr / RNNOISE_RATE);
        if (!same) {
          const z = new Float32Array(Math.round(RNNOISE_RATE * CHUNK_S));
          let have = outN; for (const a of parts) have += a.length;
          for (let guard = 0; have < want && guard < 64; guard++) { const a = down(z); emit(a); have += a.length; }
        }
        const before = outN;
        let tail = take();
        // cut to `want`, then denoiseClip's fit to the recording's length (zeros if short)
        const keep = Math.max(0, Math.min(want, nIn) - before);
        const out = new Float32Array(Math.max(0, nIn - before));
        out.set(tail.subarray(0, Math.min(keep, tail.length)));
        outN = nIn;
        return out;
      } finally {
        state.free();
      }
    },
    free() { finished = true; state.free(); },
  };
}
