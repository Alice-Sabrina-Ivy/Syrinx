// noise-synth.js — Deterministic noise generators + SNR mixing for the
// noise-augmentation oracle (2026-07-19). All generators are seeded
// (LCG) so every oracle run sees byte-identical noise; all output is
// 16 kHz mono Float32Array scaled to unit RMS (the mixer applies SNR).
//
// Noise taxonomy (chosen to span the failure modes documented in
// CLAUDE.md §Known issues plus the outdoor-noise request):
//   white         — broadband reference
//   pink          — 1/f, closer to real room/vent rumble spectra
//   fan-hum       — 120 Hz fundamental + weak 240/360 harmonics over
//                   low-passed rumble (the documented false-voicing case)
//   mains-complex — 60/120/180/240 Hz harmonic stack with a prominent
//                   180 Hz 3rd harmonic (the documented octave-pull case)
//   babble        — sum of shifted real speech tracks (caller supplies
//                   source signals from a DIFFERENT corpus than the
//                   target speech; speech-shaped + non-stationary)
//   crickets      — pulsed ~4.8 kHz chirp trains (rhythmic narrowband HF)
//   cicadas       — 3–8 kHz band noise with rough AM drone (broadband HF)
//
// Crickets/cicadas sit entirely above the 75–400 Hz pitch band —
// included to discriminate pitch-band-limited consumers from
// full-spectrum ones (VAD, tilt, gender model).
//
// The synthetic-noise caveat: speech stays REAL (corpora) per binding
// methodology; only the interference is synthetic. Field-recorded
// noise validation is a documented follow-up before shipping any
// front-end tuned against this oracle.

export const SR = 16000;

// xorshift32 — replaces the original LCG (2026-07-19): the LCG's
// lattice structure survives heavy low-passing as stable spectral
// lines at ~72.7 Hz harmonics, which the persistent-peak notch
// correctly identified as tonal interferers inside the "broadband"
// sleep-noise generator. (That accident usefully emulated codec
// birdies — now covered deliberately by sleepBirdies below.)
function makeLcg(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x7fffffff - 1; // [-1, 1)
  };
}

function normalizeRms(x) {
  let ss = 0;
  for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const rms = Math.sqrt(ss / x.length) || 1;
  for (let i = 0; i < x.length; i++) x[i] /= rms;
  return x;
}

export function white(n, seed = 1) {
  const rnd = makeLcg(seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rnd();
  return normalizeRms(x);
}

// Paul Kellet's economy pink filter over LCG white.
export function pink(n, seed = 2) {
  const rnd = makeLcg(seed);
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    x[i] = b0 + b1 + b2 + w * 0.1848;
  }
  return normalizeRms(x);
}

export function fanHum(n, seed = 3) {
  const rnd = makeLcg(seed);
  const x = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // rumble: one-pole low-passed white (~150 Hz corner)
    lp += 0.056 * (rnd() - lp);
    x[i] =
      1.0 * Math.sin(2 * Math.PI * 120 * t) +
      0.25 * Math.sin(2 * Math.PI * 240 * t + 1.1) +
      0.12 * Math.sin(2 * Math.PI * 360 * t + 2.3) +
      2.2 * lp;
  }
  return normalizeRms(x);
}

// (fully deterministic — no seed; kept out of the LCG family on purpose)
export function mainsComplex(n) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] =
      0.6 * Math.sin(2 * Math.PI * 60 * t) +
      0.8 * Math.sin(2 * Math.PI * 120 * t + 0.7) +
      1.0 * Math.sin(2 * Math.PI * 180 * t + 1.9) + // prominent 3rd harmonic
      0.3 * Math.sin(2 * Math.PI * 240 * t + 2.6);
  }
  return normalizeRms(x);
}

// babble(n, sources): sum ~8 talker streams built from `sources`
// (Float32Array speech tracks at 16 kHz, any length — short clips are
// concatenated round-robin into per-talker streams first, so vowel-length
// sources work). Deterministic offsets per talker.
export function babble(n, sources, seed = 5) {
  if (!sources || sources.length < 3) throw new Error("babble needs >=3 source tracks");
  const rnd = makeLcg(seed);
  const TALKERS = 8;
  // Round-robin the sources into TALKERS concatenated streams.
  const streams = [];
  for (let t = 0; t < TALKERS; t++) {
    const parts = sources.filter((_, i) => i % TALKERS === t % sources.length ? true : i % TALKERS === t);
    const pick = parts.length ? parts : [sources[t % sources.length]];
    const total = pick.reduce((a, p) => a + p.length, 0);
    if (total === 0) continue;
    const s = new Float32Array(total);
    let o = 0;
    for (const p of pick) { s.set(p, o); o += p.length; }
    streams.push(s);
  }
  const x = new Float32Array(n);
  let mixed = 0;
  for (const src of streams) {
    if (src.length === 0) continue;
    const off = Math.floor(Math.abs(rnd()) * src.length);
    for (let i = 0; i < n; i++) x[i] += src[(off + i) % src.length];
    mixed++;
  }
  if (mixed === 0) throw new Error("babble: no usable source material");
  return normalizeRms(x);
}

// Crickets: chirp groups at ~2.5/s; each group = ~8 pulses of a 4.8 kHz
// carrier at ~55 Hz pulse rate; slight carrier vibrato for realism.
export function crickets(n, seed = 6) {
  const rnd = makeLcg(seed);
  const x = new Float32Array(n);
  const groupPeriod = SR / 2.5;
  const pulsePeriod = SR / 55;
  const pulseLen = Math.floor(pulsePeriod * 0.55);
  const groupLen = pulsePeriod * 8;
  const jitter = Math.floor(Math.abs(rnd()) * groupPeriod);
  for (let i = 0; i < n; i++) {
    const gPos = (i + jitter) % groupPeriod;
    if (gPos >= groupLen) continue;
    const pPos = gPos % pulsePeriod;
    if (pPos >= pulseLen) continue;
    const t = i / SR;
    const env = Math.sin(Math.PI * pPos / pulseLen); // pulse envelope
    x[i] = env * Math.sin(2 * Math.PI * (4800 + 40 * Math.sin(2 * Math.PI * 6 * t)) * t);
  }
  return normalizeRms(x);
}

// Cicadas: 3–8 kHz band-limited noise with rough AM (~90 Hz) plus a slow
// pulsation envelope — a continuous "buzz-saw" drone.
export function cicadas(n, seed = 7) {
  const rnd = makeLcg(seed);
  const x = new Float32Array(n);
  // crude bandpass: difference of one-pole low-passes (~8 kHz minus ~3 kHz)
  let lpHi = 0, lpLo = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    lpHi += 0.88 * (w - lpHi); // ~8 kHz-ish corner at 16 kHz SR
    lpLo += 0.55 * (w - lpLo); // ~3 kHz-ish corner
    const band = lpHi - lpLo;
    const t = i / SR;
    const am = 0.55 + 0.45 * Math.max(0, Math.sin(2 * Math.PI * 90 * t));
    const slow = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.7 * t);
    x[i] = band * am * slow;
  }
  return normalizeRms(x);
}

// Active-level RMS of a speech signal: RMS over samples whose absolute
// value exceeds 2 % of the track peak — approximates active speech level
// without counting leading/trailing silence.
export function activeRms(x) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const thr = 0.02 * peak;
  let ss = 0, m = 0;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > thr) { ss += x[i] * x[i]; m++; }
  }
  return m ? Math.sqrt(ss / m) : 0;
}

// mix(speech, noiseUnitRms, snrDb, tailSec, leadSec): returns
// { mixed, tailStart, lead } — speech + noise at the requested SNR vs
// the speech's active level, with a noise-only LEAD of leadSec
// prepended (simulates a session where the ambient noise precedes
// speech — required to give the persistent-peak notch tracker its
// promotion time, and realistic for every front-end) and a noise-only
// TAIL of tailSec appended (false-voicing measurement). The noise is
// tiled to cover the full length. tailStart is relative to the start
// of `mixed` (i.e. includes the lead).
export function mix(speech, noiseUnitRms, snrDb, tailSec = 0, leadSec = 0) {
  const sRms = activeRms(speech);
  const g = sRms / Math.pow(10, snrDb / 20);
  const tail = Math.floor(tailSec * SR);
  const lead = Math.floor(leadSec * SR);
  const n = lead + speech.length + tail;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i >= lead && i - lead < speech.length ? speech[i - lead] : 0;
    out[i] = s + g * noiseUnitRms[i % noiseUnitRms.length];
  }
  return { mixed: out, tailStart: lead + speech.length, lead };
}

// Cascade of biquad notch filters (RBJ cookbook) — the "Direction D"
// oracle-informed front-end: the harness knows the synthetic interferer
// frequencies, so notching them here measures D's UPPER BOUND (perfect
// detection). A shippable D needs a detector for these frequencies; that
// only gets built if the upper bound proves worthwhile.
export function notchCascade(x, freqs, q = 30) {
  let y = Float32Array.from(x);
  for (const f0 of freqs) {
    const w0 = 2 * Math.PI * f0 / SR;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = 1, b1 = -2 * Math.cos(w0), b2 = 1;
    const a0 = 1 + alpha, a1 = b1, a2 = 1 - alpha;
    const out = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi;
      out[i] = yi;
    }
    y = out;
  }
  return y;
}

export const NOISE_TYPES = {
  white,
  pink,
  brown,
  "sleep-noise": sleepNoise,
  "sleep-birdies": sleepBirdies,
  "fan-hum": fanHum,
  "mains-complex": mainsComplex,
  crickets,
  cicadas,
  // babble is constructed by the caller (needs source tracks)
};

// Known interferer frequencies per synthetic noise type — consumed by
// the oracle-informed notch front-end. Broadband types have none.
export const TONAL_FREQS = {
  "fan-hum": [120, 240, 360],
  "mains-complex": [60, 120, 180, 240],
};

// Brown (1/f^2, "deep"/sleep noise — integrated white, -6 dB/oct) and a
// "sleep-video" variant (brown + gentle lowpass, matching the spectral
// shape of YouTube sleep-noise content, which is never actually white).
// Added 2026-07-19 after a field report: a "white noise" sleep video
// triggered the meters — such content is low-frequency dominated, i.e.
// the pink-rumble residual, not the measured-immune true-white case.
export function brown(n, seed = 8) {
  const rnd = makeLcg(seed);
  const x = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += rnd();
    acc *= 0.999; // leak so it doesn't wander off
    x[i] = acc;
  }
  return normalizeRms(x);
}

export function sleepNoise(n, seed = 9) {
  const rnd = makeLcg(seed);
  const x = new Float32Array(n);
  let acc = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    acc += rnd();
    acc *= 0.999;
    lp += 0.08 * (acc - lp); // extra gentle lowpass (~200 Hz-ish corner)
    x[i] = lp;
  }
  return normalizeRms(x);
}

// Sleep-noise + faint stable tonal lines — deliberately emulates lossy
// audio codecs' "birdie" artifacts on noise content (YouTube sleep
// videos): quasi-stable spectral lines a persistent-peak tracker WILL
// promote. Guards the notch's ghost-voicing veto (a notch ringing
// against surrounding rumble must not register as voice).
export function sleepBirdies(n, seed = 10) {
  const base = sleepNoise(n, seed);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    base[i] += 0.12 * Math.sin(2 * Math.PI * 87 * t) + 0.08 * Math.sin(2 * Math.PI * 174 * t + 0.9);
  }
  return normalizeRms(base);
}
