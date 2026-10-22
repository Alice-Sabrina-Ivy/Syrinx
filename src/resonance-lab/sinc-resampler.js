// sinc-resampler.js — streaming, anti-aliased, zero-phase resampler for the
// resonance lab's 16 kHz ANALYSIS stream.
//
// The production workers resample with linear interpolation (fine for
// pitch; CLAUDE.md "resampling for workers is linear interpolation"), but
// linear interpolation has no anti-alias filter: 8-24 kHz capture content
// folds into 0-8 kHz, inside the 500-6000 Hz bands the envelope finalists
// read. The benchmark audio was properly band-limited 16 kHz, so the lab
// analysis stream uses a Blackman-windowed sinc low-pass (cutoff 7.2 kHz,
// 32 output-rate periods of support per side), as a polyphase filter with
// one DC-normalised tap set per output phase (rational rate ratio). Output
// sample n sits exactly at input position n * srIn / srOut (zero phase — the
// same time base as the production linear resampler) and is emitted once
// its look-ahead taps have arrived (~2 ms at 48 kHz). The lab's pitch path
// keeps the production linear resampler.

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

export function createSincResampler(srIn, srOut, { halfTaps = 32, cutoffHz = 7200 } = {}) {
  if (srIn === srOut) return (chunk) => chunk;
  const g = gcd(Math.round(srIn), Math.round(srOut));
  const L = Math.round(srOut) / g;  // output phases
  const M = Math.round(srIn) / g;   // input samples per L outputs
  if (L > 4096) throw new Error(`unsupported resampling ratio ${srIn} -> ${srOut}`);
  const fc = Math.min(cutoffHz, 0.5 * Math.min(srIn, srOut)) / srIn; // cycles per input sample
  const span = Math.ceil(halfTaps * Math.max(1, srIn / srOut));    // half support, input samples
  const T = 2 * span;
  // taps[ph][t] weights input j = base - span + 1 + t for output position base + ph / L
  const taps = new Float64Array(L * T);
  for (let ph = 0; ph < L; ph++) {
    let s = 0;
    for (let t = 0; t < T; t++) {
      const d = ph / L + span - 1 - t; // output position minus input index
      let k = 0;
      if (Math.abs(d) < span) {
        const sinc = Math.abs(d) < 1e-12 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d);
        const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / span) + 0.08 * Math.cos((2 * Math.PI * d) / span);
        k = sinc * w;
      }
      taps[ph * T + t] = k;
      s += k;
    }
    for (let t = 0; t < T; t++) taps[ph * T + t] /= s;
  }
  const histLen = 1 << Math.ceil(Math.log2(4 * T + 16384));
  const mask = histLen - 1;
  const hist = new Float32Array(histLen);
  let written = 0; // input samples received
  let nOut = 0;    // next output index
  return (chunk) => {
    for (let i = 0; i < chunk.length; i++) hist[(written + i) & mask] = chunk[i];
    written += chunk.length;
    const out = new Float32Array(Math.ceil((chunk.length * L) / M) + 4);
    let m = 0;
    while (m < out.length) {
      const num = nOut * M;
      const base = Math.floor(num / L);
      const ph = num - base * L;
      const j0 = base - span + 1;
      if (j0 + T - 1 >= written) break; // look-ahead not here yet
      const o = ph * T;
      let s = 0;
      if (j0 >= 0) {
        for (let t = 0; t < T; t++) s += taps[o + t] * hist[(j0 + t) & mask];
      } else {
        for (let t = -j0; t < T; t++) s += taps[o + t] * hist[(j0 + t) & mask];
      }
      out[m++] = s;
      nOut++;
    }
    return out.subarray(0, m);
  };
}

/**
 * The same resampler as a LAZY 16 kHz sample ring (2026-10-07,
 * measurements/resonance-cue-cpu-2026-10-07.md): pushNative() only stores the
 * capture-rate audio and advances `end` by exactly the number of outputs
 * createSincResampler would have emitted for it; an output sample is computed
 * when a reader first asks for it (at / clamped / readClamped — the
 * createSampleRing interface), with the same taps summed in the same order
 * over a contiguous history copy, so every value is bit-identical. Audio
 * nobody reads (unvoiced stretches, silence) is never filtered.
 * push(x16) stores ready-made 16 kHz samples instead (tests inject the
 * analysis stream); one ring uses one of the two.
 */
export function createLazySincRing(srIn, srOut, capacityPow2 = 1 << 15, { halfTaps = 32, cutoffHz = 7200 } = {}) {
  const cap = 1 << Math.ceil(Math.log2(capacityPow2));
  const mask = cap - 1;
  const buf = new Float32Array(cap);
  const have = new Float64Array(cap).fill(-1); // absolute index stored in each slot
  let end = 0;
  let finalLength = Infinity;
  const identity = srIn === srOut;
  // resampler geometry (as createSincResampler)
  const g = identity ? 1 : gcd(Math.round(srIn), Math.round(srOut));
  const L = identity ? 1 : Math.round(srOut) / g;
  const M = identity ? 1 : Math.round(srIn) / g;
  if (L > 4096) throw new Error(`unsupported resampling ratio ${srIn} -> ${srOut}`);
  const fc = Math.min(cutoffHz, 0.5 * Math.min(srIn, srOut)) / srIn;
  const span = Math.ceil(halfTaps * Math.max(1, srIn / srOut));
  const T = 2 * span;
  const taps = new Float64Array(identity ? 0 : L * T);
  for (let ph = 0; ph < (identity ? 0 : L); ph++) {
    let s = 0;
    for (let t = 0; t < T; t++) {
      const d = ph / L + span - 1 - t;
      let k = 0;
      if (Math.abs(d) < span) {
        const sinc = Math.abs(d) < 1e-12 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d);
        const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / span) + 0.08 * Math.cos((2 * Math.PI * d) / span);
        k = sinc * w;
      }
      taps[ph * T + t] = k;
      s += k;
    }
    for (let t = 0; t < T; t++) taps[ph * T + t] /= s;
  }
  // native history, every sample written twice (i and i + H) so any T-long
  // window is contiguous; long enough for the oldest readable output
  const H = identity ? 1 : 1 << Math.ceil(Math.log2(Math.ceil((cap * M) / L) + 4 * T + 8192));
  const hmask = H - 1;
  const hist = new Float32Array(identity ? 0 : 2 * H);
  let written = 0;

  function compute(n) {
    const num = n * M;
    const base = Math.floor(num / L);
    const ph = num - base * L;
    const j0 = base - span + 1;
    const o = ph * T;
    let s = 0;
    if (j0 >= 0) {
      const p = j0 & hmask;
      for (let t = 0; t < T; t++) s += taps[o + t] * hist[p + t];
    } else {
      for (let t = -j0; t < T; t++) s += taps[o + t] * hist[(j0 + t) & hmask];
    }
    return s;
  }
  function sample(i) { // i in [end - cap, end)
    const slot = i & mask;
    if (have[slot] !== i) { buf[slot] = compute(i); have[slot] = i; }
    return buf[slot];
  }

  return {
    get end() { return end; },
    get capacity() { return cap; },
    /** Capture-rate audio: stored; `end` advances as createSincResampler would emit. */
    pushNative(x) {
      if (identity) { this.push(x); return; }
      for (let i = 0; i < x.length; i++) {
        const k = (written + i) & hmask;
        hist[k] = x[i];
        hist[k + H] = x[i];
      }
      written += x.length;
      // outputs n with floor(n M / L) - span + T <= written - 1 (look-ahead arrived)
      const a = written - span; // = written + span - T
      const n = a > 0 ? Math.floor((a * L + M - 1) / M) : 0;
      if (n > end) end = n;
    },
    /** Ready-made output-rate samples (tests). */
    push(x) {
      for (let i = 0; i < x.length; i++) { const s = (end + i) & mask; buf[s] = x[i]; have[s] = end + i; }
      end += x.length;
    },
    at(i) {
      if (i < 0 || i >= end || i < end - cap) return 0;
      return sample(i);
    },
    clamped(i) {
      const hi = Math.min(end, finalLength) - 1;
      const j = i < 0 ? 0 : i > hi ? hi : i;
      if (j < end - cap) return 0;
      return sample(j);
    },
    /** Copy n clamped samples starting at absolute index `start` into dst (CheapTrick framing). */
    readClamped(dst, start, n) {
      const hi = Math.min(end, finalLength) - 1;
      for (let i = 0; i < n; i++) {
        const j0 = start + i;
        const j = j0 < 0 ? 0 : j0 > hi ? hi : j0;
        dst[i] = j < end - cap ? 0 : sample(j);
      }
    },
    finish() { finalLength = end; },
  };
}
