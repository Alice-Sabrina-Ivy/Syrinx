// synth.mjs — voice synthesizer for the 2026-10-04 held-note robustness
// suite. Generalizes the 2026-10-03 phase-1 notch-guard-risk heldNote
// (jitter/shimmer, OU wander, vibrato, H1-H2 + slope, aspiration noise,
// 3-formant vowel envelope, -70 dB floor) to (a) any sample rate, (b) an
// arbitrary F0 trajectory + amplitude envelope (glides, steps, phrases,
// speech-like syllables) and (c) per-segment vowel.
export function mulberry(seed) {
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
function formantGain(f, formants) {
  let g = 1;
  for (const [F, B] of formants) {
    const num = F * F + (B / 2) ** 2;
    const den = Math.sqrt(((F - f) ** 2 + (B / 2) ** 2) * ((F + f) ** 2 + (B / 2) ** 2));
    g *= num / den;
  }
  return g;
}
export const VOWELS = {
  a: [[800, 80], [1200, 90], [2600, 120]],
  i: [[300, 60], [2300, 100], [3000, 120]],
  u: [[350, 60], [800, 80], [2400, 120]],
  e: [[500, 70], [1800, 100], [2600, 120]],
  none: [],
};
export const QUAL = {
  modal: { h1h2: 4, hnrDb: 30, slope: -9 },
  breathy: { h1h2: 12, hnrDb: 10, slope: -12 },
};

// synth({ sr, dur, f0At(t) -> base Hz (0 = unvoiced), ampAt(t) -> [0,1],
//         vowelAt(t) -> key, qual, vibCents, vibHz, wanderCents, jitterPct,
//         shimmerPct, amp, seed, floorDb, h1GainAt(t) -> dB (optional: an
//         extra gain on the 1st harmonic only, 2026-10-06) })
// Harmonic amplitudes are re-evaluated every 5 ms (F0/vowel can move).
export function synth({
  sr = 16000, dur, f0At, ampAt, vowelAt = () => "a", qual = "modal",
  vibCents = 0, vibHz = 5.5, wanderCents = 0, wanderTau = 0.5,
  jitterPct = 0.5, shimmerPct = 3, amp = 0.2, seed = 1, floorDb = -70, h1GainAt = null,
}) {
  const q = typeof qual === "string" ? QUAL[qual] : qual;
  const rnd = mulberry(seed);
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const blk = Math.max(1, Math.round(0.005 * sr));
  const maxH = 64;
  const A = new Float64Array(maxH + 1);
  let nh = 0;
  let phase = 0, cycJ = 1, cycS = 1, ou = 0;
  const ouA = Math.exp(-1 / (wanderTau * sr));
  const ouS = wanderCents * Math.sqrt(1 - ouA * ouA);
  const vPhase0 = rnd() * 2 * Math.PI;
  const voicedRms = amp / Math.SQRT2;
  const noiseRms = isFinite(q.hnrDb) ? voicedRms * Math.pow(10, -q.hnrDb / 20) : 0;
  const floorRms = Math.pow(10, floorDb / 20);
  let voicedPrev = false, tOn = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f0b = f0At(t);
    let s = 0;
    if (f0b > 0) {
      if (!voicedPrev) { tOn = t; voicedPrev = true; }
      if ((i % blk) === 0 || nh === 0) {
        const fm = VOWELS[vowelAt(t)] ?? VOWELS.a;
        nh = Math.min(maxH, Math.max(1, Math.floor(3800 / f0b)));
        let norm = 0;
        for (let k = 1; k <= nh; k++) {
          const db = k === 1 ? 0 : -q.h1h2 + q.slope * Math.log2(k / 2);
          A[k] = Math.pow(10, db / 20) * (fm.length ? formantGain(k * f0b, fm) : 1);
          norm += A[k] * A[k];
        }
        norm = Math.sqrt(norm / 2);
        for (let k = 1; k <= nh; k++) A[k] /= norm;
      }
      ou = ouA * ou + ouS * gauss(rnd);
      const cents = ou + vibCents * Math.sin(2 * Math.PI * vibHz * (t - tOn) + vPhase0);
      const f = f0b * Math.pow(2, cents / 1200) * cycJ;
      phase += 2 * Math.PI * f / sr;
      if (phase >= 2 * Math.PI) {
        phase -= 2 * Math.PI;
        cycJ = 1 + (jitterPct / 100) * gauss(rnd);
        cycS = 1 + (shimmerPct / 100) * gauss(rnd);
      }
      let v = 0;
      for (let k = 1; k <= nh; k++) {
        if (k * f > 7800) break;
        v += (k === 1 && h1GainAt ? Math.pow(10, h1GainAt(t) / 20) : 1) * A[k] * Math.sin(k * phase);
      }
      s = ampAt(t) * (voicedRms * cycS * v + noiseRms * gauss(rnd));
    } else {
      voicedPrev = false;
      // unvoiced: amplitude envelope may still carry a consonant noise burst
      const a = ampAt(t);
      if (a > 0) s = a * voicedRms * 0.1 * gauss(rnd);
    }
    out[i] = s + floorRms * gauss(rnd);
  }
  return out;
}

// envelope helper: piecewise segments [[t0, t1, ramp]] -> amplitude 0/1 with
// linear ramps inside each segment
export function segEnv(segs, ramp = 0.06) {
  return (t) => {
    for (const s of segs) {
      const [a, b, r = ramp] = s;
      if (t >= a && t <= b) return Math.max(0, Math.min(1, (t - a) / r, (b - t) / r));
    }
    return 0;
  };
}
