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
