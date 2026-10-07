// subharmonic-evidence.js — does an above-range decode hide a low voice?
// (2026-10-07, low-voice-noise candidate "meter-c1")
//
// In 0 dB low-frequency-heavy noise the tracker locks onto a formant-region
// harmonic of a low voice and decodes 5-8x F0 (median ~590 Hz); the worker
// posts those frames unvoiced (above-range null). For the men under 105 Hz
// of the 38-speaker LibriSpeech set that is 15.5 % of Praat-voiced frames at
// real 0 dB (measurements/low-voice-noise-2026-10-07.md, Diagnosis).
//
// subharmonicPartialCount(buffer, decodedHz, sampleRate) looks for the low
// fundamental's own partials: for every sub-multiple f = d/k (k = 2..10,
// 75 <= f <= 400 Hz) it counts the harmonics h*f <= 1000 Hz (h <= 12) that
// clear the local floor by 10 dB (the harmonic guard's rule) AND are not
// multiples of d (h % k != 0) — partials a d-periodic sound cannot have.
// Returns the best count over k (0 when no k qualifies). A count >= 2
// ("absub2") marks the frame as weak voice evidence: the pitch worker posts
// it as `subharmonic: true` on an unvoiced message, and only the perceived-
// voice utterance gate reads it (keeps an open utterance alive; never opens
// one, never painted, never a pitch).
//
// Known limitation: a clean harmonic note above 400 Hz is often counted
// too — Hann sidelobes of its strong partials clear the 10 dB floor at
// sub-multiple partials within ~60 Hz of them. Weak hints never open an
// utterance, so such a note can only keep one open (e.g. a high sung note
// straight after speech). tests/dsp/subharmonic-evidence-test.js
//
// One 4096-point FFT per call (Hann window over the buffer, zero-padded),
// on the decoded frame's own buffer; called only for above-range decodes.

import { fft } from "./boersma-ac.js";

export const SUBHARMONIC_DEFAULTS = Object.freeze({
  minHz: 75,           // sub-multiple search range (= the display range)
  maxHz: 400,
  maxK: 10,            // d/2 .. d/10
  maxPartialHz: 1000,  // partials counted up to here
  maxHarmonic: 12,
  ratio: 10,           // peak >= ratio x band median (harmonicStructureCount's rule)
});

const N = 4096;
let scratch = null;

export function subharmonicPartialCount(buffer, decodedHz, sampleRate, opts = {}) {
  const o = { ...SUBHARMONIC_DEFAULTS, ...opts };
  if (!(decodedHz > 0)) return 0;
  if (!scratch) scratch = { re: new Float64Array(N), im: new Float64Array(N), pw: new Float64Array(N / 2), hann: null };
  const s = scratch;
  if (!s.hann || s.hann.length !== buffer.length) {
    s.hann = new Float64Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) s.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (buffer.length - 1));
  }
  s.re.fill(0); s.im.fill(0);
  const n = Math.min(buffer.length, N);
  for (let i = 0; i < n; i++) s.re[i] = buffer[i] * s.hann[i];
  fft(s.re, s.im, false);
  const half = N / 2;
  for (let b = 0; b < half; b++) s.pw[b] = s.re[b] * s.re[b] + s.im[b] * s.im[b];
  const binHz = sampleRate / N;

  const passes = (f) => {
    const lo = Math.max(1, Math.floor((f * 0.96) / binHz));
    const hi = Math.min(half - 1, Math.ceil((f * 1.04) / binHz));
    let peak = 0;
    for (let b = lo; b <= hi; b++) if (s.pw[b] > peak) peak = s.pw[b];
    const flo = Math.max(1, Math.floor((f * 0.65) / binHz));
    const fhi = Math.min(half - 1, Math.ceil((f * 1.35) / binHz));
    const band = [];
    for (let b = flo; b <= fhi; b++) band.push(s.pw[b]);
    band.sort((a, b) => a - b);
    const floor = band[Math.floor(band.length / 2)] || 1e-12;
    return peak >= o.ratio * floor;
  };

  let best = 0;
  for (let k = 2; k <= o.maxK; k++) {
    const f = decodedHz / k;
    if (f < o.minHz || f > o.maxHz) continue;
    let off = 0;
    for (let h = 1; h <= o.maxHarmonic && h * f <= o.maxPartialHz; h++) {
      if (h % k === 0 || h * f > sampleRate / 2 - 100) continue;
      if (passes(h * f)) off++;
    }
    if (off > best) best = off;
  }
  return best;
}
