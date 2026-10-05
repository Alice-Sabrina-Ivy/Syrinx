// hnr.js — Harmonics-to-noise ratio (dB), Boersma (1993) window-corrected
// autocorrelation — the method behind Praat's "To Harmonicity (ac)".
//
// Extracted from dsp-worker.js 2026-10-03. The previous implementation took
// the raw, unwindowed, biased ACF of the frame, whose periodic peak is
// scaled by the lag overlap (n - T) / n, so it measured mostly F0, not
// noise: a perfectly periodic 100 Hz tone read ~5 dB and a 300 Hz tone
// ~10.7 dB (true HNR 40 dB), and vs Praat it was ~-7.5 dB biased with a
// ~5 dB F0 confound across 80-400 Hz.
// measurements/hnr-window-corrected-2026-10-03.md.
//
// Method (per frame): remove the mean, apply a Hann window, take the
// normalized ACF r_x(τ)/r_x(0) via FFT, divide by the Hann window's own
// normalized ACF r_w(τ) (this undoes the window/overlap taper), pick the
// highest local maximum for lags in [sr/600, sr/75 + 2] with parabolic
// interpolation, reflect r > 1 to 1/r (Praat convention), and report
// 10·log10(r / (1 − r)).
//
// Frame length: callers pass a 70 ms frame (5.25 periods of the 75 Hz
// floor), not Praat's 4.5-period (60 ms) harmonicity default. With a
// Hann window and this correction, frames spanning ~4.8 periods of F0
// hit a window-correction resonance (measured band ~4.6-5.0 periods): at
// 60 ms that lands at F0 ~ 77-83 Hz,
// where stationary clean voices (true HNR 20 / 25 dB) read +1.5 / +9 dB
// high with frame-to-frame scatter of 28-40 dB — squarely on low male
// voices sustaining a vowel. At 70 ms the main band sits at ~66-71 Hz,
// below the search floor — but this REDUCES rather than removes the
// ~80 Hz error: at true HNR >= 30 dB, stationary clean voices at ~77-85 Hz
// still read +0.5..+2.9 dB high on average with 2-5 dB frame-to-frame
// scatter (a few frames per second hit the 40 dB cap, when the corrected
// true-period peak lands just above r = 1 and reflects), and at F0
// ~151-155 Hz a 2T peak just under maxLag can out-score T (frames up to
// +4.7 dB). At 25 dB the mean error stays <= +0.75 dB (hnr-test bound).
// Real fix if it ever matters: a Gaussian window (Praat's alternative) or
// derating peaks within a few lags of maxLag. Cost: on running speech 70 ms reads 0.4-0.65 dB below
// Praat to_harmonicity_ac (more F0/amplitude change inside the longer
// frame), uniformly across F0 (no F0 confound), vs ~0 dB at 60 ms.
// measurements/hnr-window-corrected-2026-10-03.md.

// Zero-GC hot path: the FFT buffers, Hann window and window ACF are
// allocated once per (frame length, sample rate) — i.e. once per worker
// init — with FFT length = next power of two >= n + maxLag + 2 so the
// FFT autocorrelation never wraps (4096 at 44.1/48 kHz for a 70 ms frame,
// 2048 at 16 kHz, 8192 at 96 kHz).

const MIN_F0 = 75;   // matches the pitch detector floor / PITCH_DISPLAY_RANGE
const MAX_F0 = 600;
let _n = 0, _sr = 0, _fftLen = 0, _maxLag = 0;
let _re = null, _im = null;
let _win = null;   // Hann window, length n
let _winAc = null; // window ACF normalized to 1 at lag 0, lags 0..maxLag

function init(n, sr) {
  _n = n;
  _sr = sr;
  // +2 lags of headroom (as Praat) so a peak exactly at sr/75 is still an
  // interior local maximum.
  _maxLag = Math.min(Math.ceil(sr / MIN_F0) + 2, Math.floor(n / 2));
  _fftLen = 1;
  while (_fftLen < n + _maxLag + 2) _fftLen <<= 1;
  _re = new Float64Array(_fftLen);
  _im = new Float64Array(_fftLen);
  _win = new Float64Array(n);
  _winAc = new Float64Array(_maxLag + 1);
  for (let i = 0; i < n; i++) _win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += _win[i] * _win[i];
  for (let lag = 0; lag <= _maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += _win[i] * _win[i + lag];
    _winAc[lag] = s / r0;
  }
}

// buffer: the analysis frame (production passes the last 70 ms of the
// dsp-worker ring). Returns HNR in dB, or null for silence / no periodicity.
export function computeHNR(buffer, sr) {
  const n = buffer.length;
  if (n !== _n || sr !== _sr) init(n, sr);
  const re = _re;
  const im = _im;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += buffer[i];
  mean /= n;
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) re[i] = (buffer[i] - mean) * _win[i];

  fft(re, im);
  for (let i = 0; i < _fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im); // real, even input: forward FFT == inverse up to a scale
  const r0 = re[0];
  if (!(r0 > 0)) return null;

  const minLag = Math.max(2, Math.floor(sr / MAX_F0));
  let best = 0;
  let prev = re[minLag - 1] / r0 / _winAc[minLag - 1];
  let cur = re[minLag] / r0 / _winAc[minLag];
  for (let lag = minLag; lag < _maxLag; lag++) {
    const next = re[lag + 1] / r0 / _winAc[lag + 1];
    if (cur > prev && cur >= next && cur > 0) {
      let peak = cur;
      const den = prev - 2 * cur + next;
      if (den < 0) peak = cur - (0.125 * (prev - next) * (prev - next)) / den;
      if (peak > best) best = peak;
    }
    prev = cur;
    cur = next;
  }
  if (best <= 0) return null;
  if (best > 1) best = 1 / best; // Praat convention for over-unity peaks
  best = Math.min(best, 0.9999);   // cap at 40 dB
  return 10 * Math.log10(best / (1 - best));
}

// Radix-2 Cooley-Tukey FFT (in-place); same implementation as dsp-worker.js.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
