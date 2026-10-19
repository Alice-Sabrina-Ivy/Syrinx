// detector.mjs — narrowband (phone-quality) audio detector, pure module
// (measurements/resonance-narrowband-2026-10-19.md §2). No imports, no
// globals: the later src/ implementation imports or copies it verbatim and is
// checked bit-for-bit against this file.
//
// Input: one 512-sample window of the resonance engine's 16 kHz stream
// (ring16) ending at a VOICED 10 ms grid frame (samples [c - 512, c),
// c = round(t_j * 16000)). Unvoiced frames are never passed in.
//
//   bandEnergies(win, out)  power spectrum (periodic Hann, 512-point FFT,
//                           float64) summed over the four candidate bands:
//                           out[0] 3.8-6.5 kHz, out[1] 4.5-6.5 kHz,
//                           out[2] 1.0-3.5 kHz, out[3] 2.5-3.5 kHz
//                           (bins k with lo <= k * 31.25 Hz <= hi)
//   createDecision(p)       running averages + hysteresis on one band pair
//   createNarrowbandDetector(p)  the two together, one call per voiced frame
//
// Running average: E <- E + a (e - E) per voiced frame, a = 1 - exp(-0.01 / tauS),
// E starts at 0 (the start-up bias is the same factor in both bands, so it
// cancels in the ratio). F = 10 log10(E_high / E_ref) dB. Undecided until
// vMinS seconds of voiced frames; then on when F < tOnDb, off when
// F > tOnDb + hystDb.

export const N = 512;
export const SR = 16000;
export const BAND_EDGES = [
  [3800, 6500], // 0: high A
  [4500, 6500], // 1: high B / C
  [1000, 3500], // 2: reference A / B
  [2500, 3500], // 3: reference C
];
// band pair -> [high index, reference index] into bandEnergies' output
export const PAIRS = { A: [0, 2], B: [1, 2], C: [1, 3] };
const FRAME_S = 0.01;
const TINY = 1e-30;

const HANN = new Float64Array(N);
for (let n = 0; n < N; n++) HANN[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
const BIN_LO = BAND_EDGES.map(([lo]) => Math.ceil(lo / (SR / N) - 1e-9));
const BIN_HI = BAND_EDGES.map(([, hi]) => Math.floor(hi / (SR / N) + 1e-9));
// radix-2 tables
const BITREV = new Uint16Array(N);
for (let i = 0, bits = Math.log2(N); i < N; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  BITREV[i] = r;
}
const COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let k = 0; k < N / 2; k++) { COS[k] = Math.cos((2 * Math.PI * k) / N); SIN[k] = Math.sin((2 * Math.PI * k) / N); }
const re = new Float64Array(N), im = new Float64Array(N);

/** Four band energies of one 512-sample window (any array-like of numbers). */
export function bandEnergies(win, out = new Float64Array(4)) {
  for (let i = 0; i < N; i++) { re[BITREV[i]] = win[i] * HANN[i]; im[BITREV[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step], sn = SIN[k * step];
        const a = s + k, b = a + half;
        const tr = re[b] * c + im[b] * sn;
        const ti = im[b] * c - re[b] * sn;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let j = 0; j < 4; j++) {
    let e = 0;
    for (let k = BIN_LO[j]; k <= BIN_HI[j]; k++) e += re[k] * re[k] + im[k] * im[k];
    out[j] = e;
  }
  return out;
}

/**
 * Running averages + hysteresis on one band pair.
 * p: { tauS, vMinS, hystDb, tOnDb }. push(eHigh, eRef) per voiced frame;
 * returns this decision's state object (reused): { n, decided, on, f }.
 */
export function createDecision({ tauS, vMinS, hystDb, tOnDb }) {
  const a = 1 - Math.exp(-FRAME_S / tauS);
  const nMin = Math.round(vMinS / FRAME_S);
  const tOff = tOnDb + hystDb;
  let eh = 0, er = 0;
  const st = { n: 0, decided: false, on: false, f: null };
  return {
    push(eHigh, eRef) {
      eh += a * (eHigh - eh);
      er += a * (eRef - er);
      st.n++;
      st.f = 10 * Math.log10((eh + TINY) / (er + TINY));
      if (st.n >= nMin) {
        st.decided = true;
        if (!st.on && st.f < tOnDb) st.on = true;
        else if (st.on && st.f > tOff) st.on = false;
      }
      return st;
    },
    get state() { return st; },
  };
}

/** p: { band: "A"|"B"|"C", tauS, vMinS, hystDb, tOnDb }. frame(win512) per voiced frame. */
export function createNarrowbandDetector(p) {
  const [hi, ref] = PAIRS[p.band];
  const d = createDecision(p);
  const e = new Float64Array(4);
  return {
    frame(win) { bandEnergies(win, e); return d.push(e[hi], e[ref]); },
    get state() { return d.state; },
  };
}
