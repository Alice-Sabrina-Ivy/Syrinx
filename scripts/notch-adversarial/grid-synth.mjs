// grid-synth.mjs (copy of the 2026-10-03 notch-guard-risk synth.mjs) — held-note voice synthesizer for notch/guard risk sweeps.
// Harmonic glottal-ish source with per-cycle jitter + shimmer, slow
// F0 wander (Ornstein-Uhlenbeck in cents), linear drift, sinusoidal
// vibrato, controllable H1-H2 (breathiness), aspiration noise, and a
// crude 2-formant vowel envelope (/a/-ish or /i/-ish).
export const SR = 16000;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rnd) {
  const u = Math.max(1e-12, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// formant gain (resonance magnitude) for harmonic freq f
function formantGain(f, formants) {
  let g = 1;
  for (const [F, B] of formants) {
    // 2-pole resonance magnitude, normalized to 1 at DC
    const num = F * F + (B / 2) ** 2;
    const den = Math.sqrt(((F - f) ** 2 + (B / 2) ** 2) * ((F + f) ** 2 + (B / 2) ** 2));
    g *= num / den;
  }
  return g;
}
const VOWELS = {
  a: [[800, 80], [1200, 90], [2600, 120]],
  i: [[300, 60], [2300, 100], [3000, 120]],
  u: [[350, 60], [800, 80], [2400, 120]],
  none: [],
};

// heldNote(cfg) -> Float32Array
//  f0: Hz; durSec: held duration; preSec/postSec silence padding
//  jitterPct: per-cycle period SD (%); shimmerPct: per-cycle amp SD (%)
//  wanderCents: OU stationary SD (cents), wanderTau (s)
//  driftCents: linear drift over the hold
//  vibCents: vibrato depth (peak, cents), vibHz
//  h1h2: dB (H1 above H2), slope: dB/oct beyond H2
//  hnrDb: aspiration-noise level re voiced power (Infinity = none)
//  vowel: 'a'|'i'|'u'|'none'; amp: peak-ish amplitude; seed
export function heldNote(cfg) {
  const {
    f0 = 220, durSec = 10, preSec = 1, postSec = 3,
    jitterPct = 0.5, shimmerPct = 3, wanderCents = 0, wanderTau = 0.5,
    driftCents = 0, vibCents = 0, vibHz = 5, h1h2 = 5, slope = -9,
    hnrDb = Infinity, vowel = "a", amp = 0.2, seed = 1, rampSec = 0.08,
    floorDb = -70,
  } = cfg;
  const rnd = mulberry(seed);
  const total = Math.round((preSec + durSec + postSec) * SR);
  const out = new Float32Array(total);
  const n0 = Math.round(preSec * SR), n1 = n0 + Math.round(durSec * SR);
  const nh = Math.max(1, Math.floor(3800 / f0));
  // harmonic amplitudes at nominal f0 (formant gains evaluated at nominal
  // harmonic freqs; fine for small FM)
  const A = new Float64Array(nh + 1);
  const fm = VOWELS[vowel] ?? VOWELS.a;
  for (let k = 1; k <= nh; k++) {
    let db = k === 1 ? 0 : -h1h2 + slope * Math.log2(k / 2);
    A[k] = Math.pow(10, db / 20) * (fm.length ? formantGain(k * f0, fm) : 1);
  }
  let norm = 0; for (let k = 1; k <= nh; k++) norm += A[k] * A[k];
  norm = Math.sqrt(norm / 2); // rms of sum
  for (let k = 1; k <= nh; k++) A[k] /= norm; // unit rms
  let phase = 0, cycJ = 1, cycS = 1, ou = 0;
  const ouA = Math.exp(-1 / (wanderTau * SR));
  const ouS = wanderCents * Math.sqrt(1 - ouA * ouA);
  const vPhase0 = rnd() * 2 * Math.PI;
  const voicedRms = amp / Math.SQRT2;
  const noiseRms = isFinite(hnrDb) ? voicedRms * Math.pow(10, -hnrDb / 20) : 0;
  const floorRms = Math.pow(10, floorDb / 20);
  // aspiration noise: white -> one-pole high-pass-ish tilt (leave white)
  for (let n = 0; n < total; n++) {
    const tn = (n - n0) / SR;
    let s = 0;
    if (n >= n0 && n < n1) {
      ou = ouA * ou + ouS * gauss(rnd);
      const cents = ou + driftCents * (tn / durSec) + vibCents * Math.sin(2 * Math.PI * vibHz * tn + vPhase0);
      const f = f0 * Math.pow(2, cents / 1200) * cycJ;
      phase += 2 * Math.PI * f / SR;
      if (phase >= 2 * Math.PI) {
        phase -= 2 * Math.PI;
        cycJ = 1 + (jitterPct / 100) * gauss(rnd);
        cycS = 1 + (shimmerPct / 100) * gauss(rnd);
      }
      let v = 0;
      for (let k = 1; k <= nh; k++) {
        if (k * f > 7800) break;
        v += A[k] * Math.sin(k * phase);
      }
      const ramp = Math.min(1, tn / rampSec, (durSec - tn) / rampSec);
      s = ramp * (voicedRms * cycS * v + noiseRms * gauss(rnd));
    }
    out[n] = s + floorRms * gauss(rnd);
  }
  return out;
}
