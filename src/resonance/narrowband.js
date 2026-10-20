// narrowband.js — phone-quality (narrowband, ~8 kHz-link) audio detector for
// the resonance cue. Pure; runs in src/resonance/resonance-worker.js and in
// Node tests.
//
// Exactly the detector selected and confirmed on held-out speakers in
// measurements/resonance-narrowband-2026-10-19.md (round 4): band pair C,
// τ 8 s, V_min 3 s, H 6 dB, T_on −34 dB. The arithmetic is a copy of
// scripts/resonance-narrowband/detector.mjs (bandEnergies + createDecision,
// pair C only) and must stay bit-identical to it:
// tests/resonance/narrowband-test.js checks the module against that file and
// the real resonance worker against the measured harness (extract.mjs).
//
// Input: on every VOICED 10 ms grid frame j of the lab engine (t_j =
// 0.005 + 0.01 j s), the 512 samples [c − 512, c), c = round(t_j · 16000), of
// the engine's own 16 kHz ring; periodic Hann, 512-point FFT (float64),
// energy in 4.5–6.5 kHz (high) and 2.5–3.5 kHz (reference), bins k with
// lo ≤ 31.25 k ≤ hi. Long-term estimate: E ← E + a (e − E) per voiced
// frame, a = 1 − exp(−0.01 / τ), E starts at 0 (unvoiced time does not age
// it). F = 10 log10(E_high / E_ref) dB. Undecided until V_min of voiced
// frames; then on when F < T_on, off when F > T_on + H.
//
// Measured (held-out half, 20 readers): never on for wideband audio (0.0 % of
// voiced time in all 33 wideband conditions, 0 / 60 clean streams); on after
// 3 s of voiced audio for 100 % of telephone-band, AMR-NB, G.711 and
// narrowband-Bluetooth-like streams. Not covered: Opus 8 kbit/s narrowband
// and a plain 4 kHz low-pass ("dull") microphone — almost never caught.
// The time constant is in voiced seconds, so a switch from wideband to phone
// audio in the middle of a session takes far longer than 3 s to show (the
// study measured streams from their start only); a fresh start of listening
// starts a fresh detector.

export const NARROWBAND = Object.freeze({ band: "C", tauS: 8, vMinS: 3, hystDb: 6, tOnDb: -34 });

export const N = 512;
export const SR = 16000;
const HIGH_HZ = [4500, 6500];
const REF_HZ = [2500, 3500];
const FRAME_S = 0.01;
const TINY = 1e-30;

const HANN = new Float64Array(N);
for (let n = 0; n < N; n++) HANN[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
const binLo = (hz) => Math.ceil(hz / (SR / N) - 1e-9);
const binHi = (hz) => Math.floor(hz / (SR / N) + 1e-9);
const HI_LO = binLo(HIGH_HZ[0]), HI_HI = binHi(HIGH_HZ[1]);
const REF_LO = binLo(REF_HZ[0]), REF_HI = binHi(REF_HZ[1]);
// radix-2 tables
const BITREV = new Uint16Array(N);
for (let i = 0, bits = Math.log2(N); i < N; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  BITREV[i] = r;
}
const COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let k = 0; k < N / 2; k++) { COS[k] = Math.cos((2 * Math.PI * k) / N); SIN[k] = Math.sin((2 * Math.PI * k) / N); }

/**
 * A fresh detector (one per lab engine). frame(get, c): one voiced grid
 * frame, get(i) = the 16 kHz sample i (the engine's ring16.at), c = the
 * frame's sample index. Returns the state object (reused):
 * { n: voiced frames, decided, on, f: dB | null }.
 */
export function createNarrowbandDetector({ tauS, vMinS, hystDb, tOnDb } = NARROWBAND) {
  const re = new Float64Array(N), im = new Float64Array(N);
  const a = 1 - Math.exp(-FRAME_S / tauS);
  const nMin = Math.round(vMinS / FRAME_S);
  const tOff = tOnDb + hystDb;
  let eh = 0, er = 0;
  const st = { n: 0, decided: false, on: false, f: null };

  function energies(get, c) {
    for (let i = 0; i < N; i++) { re[BITREV[i]] = get(c - N + i) * HANN[i]; im[BITREV[i]] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) {
        for (let k = 0; k < half; k++) {
          const cs = COS[k * step], sn = SIN[k * step];
          const p = s + k, q = p + half;
          const tr = re[q] * cs + im[q] * sn;
          const ti = im[q] * cs - re[q] * sn;
          re[q] = re[p] - tr; im[q] = im[p] - ti;
          re[p] += tr; im[p] += ti;
        }
      }
    }
    let h = 0, r = 0;
    for (let k = HI_LO; k <= HI_HI; k++) h += re[k] * re[k] + im[k] * im[k];
    for (let k = REF_LO; k <= REF_HI; k++) r += re[k] * re[k] + im[k] * im[k];
    eh += a * (h - eh);
    er += a * (r - er);
  }

  return {
    frame(get, c) {
      energies(get, c);
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
