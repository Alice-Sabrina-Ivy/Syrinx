// above-range-sub.js — recover the true F0 of an above-display-range decode
// that is a harmonic lock on a masked low voice (candidate "pitch-absub",
// measurements/low-voice-noise-2026-10-07.md).
//
// In heavy low-frequency noise (0 dB SNR) the low harmonics of a man's
// voice are masked and the tracker can lock onto the formant-region
// harmonics instead: decodes at 5–8 x F0 (median ~590 Hz for voices under
// 105 Hz). The pitch worker posts every decode above PITCH_DISPLAY_RANGE.high
// as unvoiced (pitch-ceiling-2026-10-03.md), so these frames are lost.
//
// aboveRangeSubharmonic(buffer, decodedHz, sampleRate) looks for a
// sub-multiple f = decodedHz / k (k = 2..10, f inside the display range)
// whose harmonic series has at least MIN_OFF partials that are NOT
// multiples of the decode — the low fundamental's own partials between the
// locked ones. A real above-range tone (a sung note at d) has no energy
// between its harmonics, so it has no such partials and stays unvoiced.
//
// Harmonic test = the harmonic voicing guard's (boersma-ac.js
// harmonicStructureCount): Hann-windowed frame, 4096-point power spectrum,
// harmonic h passes when the peak within +-4 % of h*f is >= RATIO x the
// median power of the +-35 % band around it. Harmonics 1..12 up to 1000 Hz.
// An off-multiple partial must also reach -40 dB of the frame's strongest
// bin below 1 kHz (REL_FLOOR). The k with the most off-multiple partials
// wins (the smaller k on a tie).
// Returns f, or 0 when no k qualifies.

const NF = 4096;
const HALF = NF / 2;
const RATIO = 10;
const MIN_OFF = 2;
const MAX_HARM = 12;
const MAX_HARM_HZ = 1000;
const K_MAX = 10;
// An off-multiple partial must also be within REL_FLOOR of the frame's
// strongest bin below MAX_HARM_HZ. Without it, the window's sidelobe
// leakage between the harmonics of a clean above-range tone (a sung note,
// a synthetic tone) passes the median-ratio test: a clean 520 Hz tone was
// posted at 520 / 6. -40 dB is well above Hann leakage at those distances
// (~-58 dB) and far below a voice's own low partials.
const REL_FLOOR = 1e-4;

let tables = null;
function initTables() {
  const cos = new Float64Array(HALF), sin = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) { cos[i] = Math.cos((-2 * Math.PI * i) / NF); sin[i] = Math.sin((-2 * Math.PI * i) / NF); }
  const rev = new Uint32Array(NF);
  for (let i = 0, j = 0; i < NF; i++) { rev[i] = j; let b = NF >> 1; while (j & b) { j ^= b; b >>= 1; } j |= b; }
  tables = { cos, sin, rev, re: new Float64Array(NF), im: new Float64Array(NF), pw: new Float64Array(HALF), hann: null };
}

function powerSpectrum(buffer) {
  const t = tables;
  if (!t.hann || t.hann.length !== buffer.length) {
    t.hann = new Float64Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) t.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (buffer.length - 1));
  }
  const { re, im, rev, cos, sin } = t;
  re.fill(0); im.fill(0);
  const n = Math.min(buffer.length, NF);
  for (let i = 0; i < n; i++) re[i] = buffer[i] * t.hann[i];
  for (let i = 0; i < NF; i++) {
    const j = rev[i];
    if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
  }
  for (let size = 2; size <= NF; size <<= 1) {
    const h = size >> 1, step = NF / size;
    for (let s = 0; s < NF; s += size) {
      for (let k = 0; k < h; k++) {
        const c = cos[k * step], sn = sin[k * step];
        const a = s + k, b = a + h;
        const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let b = 0; b < HALF; b++) t.pw[b] = re[b] * re[b] + im[b] * im[b];
}

const band = [];
function harmonicPasses(f, binHz, minPeak) {
  const pw = tables.pw;
  const lo = Math.max(1, Math.floor((f * 0.96) / binHz));
  const hi = Math.min(HALF - 1, Math.ceil((f * 1.04) / binHz));
  let peak = 0;
  for (let b = lo; b <= hi; b++) if (pw[b] > peak) peak = pw[b];
  if (peak < minPeak) return false;
  const flo = Math.max(1, Math.floor((f * 0.65) / binHz));
  const fhi = Math.min(HALF - 1, Math.ceil((f * 1.35) / binHz));
  band.length = 0;
  for (let b = flo; b <= fhi; b++) band.push(pw[b]);
  band.sort((a, b) => a - b);
  const floor = band[Math.floor(band.length / 2)] || 1e-12;
  return peak >= RATIO * floor;
}

export function aboveRangeSubharmonic(buffer, decodedHz, sampleRate, minHz, maxHz) {
  if (!tables) initTables();
  powerSpectrum(buffer);
  const binHz = sampleRate / NF;
  let top = 0;
  const topBin = Math.min(HALF - 1, Math.ceil((MAX_HARM_HZ * 1.04) / binHz));
  for (let b = 1; b <= topBin; b++) if (tables.pw[b] > top) top = tables.pw[b];
  const minPeak = REL_FLOOR * top;
  let bestF = 0, bestOff = -1;
  for (let k = 2; k <= K_MAX; k++) {
    const f = decodedHz / k;
    if (f < minHz || f > maxHz) continue;
    let off = 0;
    for (let h = 1; h <= MAX_HARM && h * f <= MAX_HARM_HZ; h++) {
      if (h * f > sampleRate / 2 - 100) break;
      if (h % k !== 0 && harmonicPasses(h * f, binHz, minPeak)) off++;
    }
    if (off > bestOff) { bestOff = off; bestF = f; }
  }
  return bestOff >= MIN_OFF ? bestF : 0;
}
