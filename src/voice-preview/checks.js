// checks.js — Voice Shaper's recording check (pure; tests/voice-preview/checks-test.js).
// measurements/voice-preview-phase1-2026-10-19.md §7. A flag only adds a notice; the
// preview is still made. Not enough voice means no preview.
//
// Hum: the pitch worker's tonal-noise detector (src/dsp/noise-notch.js, read through the
//   `notchedFreqs` field of its posted messages): flagged if any posted message for a
//   recorded chunk carried at least one active notch line. A hum must be stable for about
//   5 s to promote, so the seconds before the recording count through the notch's own
//   memory (Record waits until listening has run 6 s).
// Background noise: the spike's level check d2 (levelMargin in the spike's
//   scripts/voice-preview/hum/hum-run.mjs, branch voice-preview-spike, deleted 2026-10-21
//   by the owner's decision and not kept) with its floor moved
//   from the 10th to the 5th percentile (fix step) — margin = 95th - 5th percentile of the
//   energies of non-overlapping 20 ms frames, 10 log10(mean x^2 + 1e-20),
//   linear-interpolated percentiles — flagged below NOISE_MARGIN_DB (28 dB). With the 10th
//   percentile and 30 dB, continuous speech with few pauses could be flagged in a quiet
//   room (the 10th percentile was speech, not room noise): on public studio recordings
//   trimmed to speech 2 of 69 clips were flagged (clean margins down to 25.4 dB). With the
//   5th percentile and 28 dB: 0 of 69 (lowest 29.7 dB), 0 of 261 whole files, and every
//   clip with pink noise at +10 or +20 dB SNR or fan hum 20 dB down still flagged (highest
//   27.0 dB). scripts/voice-preview/noise-margin-eval.mjs; the note's fix step.
// Enough voice: at least MIN_VOICED_HOPS voiced posted hops (1.0 s).

export const NOISE_MARGIN_DB = 28;
/** The percentile of the 20 ms frame energies taken as the noise floor. */
export const FLOOR_PERCENTILE = 0.05;
export const MIN_VOICED_HOPS = 40;
export const HOP_S = 0.025;

/** The spike's level check d2 with the floor at FLOOR_PERCENTILE. Returns { p95, floor, margin }. */
export function levelMargin(x, sr) {
  const n = Math.round(sr * 0.02), m = Math.floor(x.length / n);
  const e = [];
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = i * n; j < (i + 1) * n; j++) s += x[j] * x[j];
    e.push(10 * Math.log10(s / n + 1e-20));
  }
  e.sort((a, b) => a - b);
  const q = (p) => { const h = (e.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return e[lo] + (e[hi] - e[lo]) * (h - lo); };
  return { p95: q(0.95), floor: q(FLOOR_PERCENTILE), margin: q(0.95) - q(FLOOR_PERCENTILE) };
}

export const noiseFlag = (marginDb) => !(marginDb >= NOISE_MARGIN_DB);

/** notched: per recorded chunk, 1 if its posted message carried an active notch line. */
export function humFlag(notched) {
  if (!notched) return false;
  for (let i = 0; i < notched.length; i++) if (notched[i]) return true;
  return false;
}

export function voicedHops(track) {
  let n = 0;
  for (let i = 0; i < track.length; i++) if (track[i] > 0) n++;
  return n;
}

/**
 * The whole check. pcm at the capture rate sampleRate; track / notched per recorded chunk.
 * Returns { hum, noise, marginDb, voicedS, enoughVoice }.
 */
export function recordingCheck({ pcm, sampleRate, track, notched }) {
  const margin = levelMargin(pcm, sampleRate).margin;
  const hops = voicedHops(track);
  return {
    hum: humFlag(notched),
    noise: noiseFlag(margin),
    marginDb: margin,
    voicedS: hops * 25 / 1000, // HOP_S per hop, rounded once
    enoughVoice: hops >= MIN_VOICED_HOPS,
  };
}
