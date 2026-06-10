// boersma-ac.js — Frame-local Praat-style autocorrelation pitch detector
// (Boersma 1993, "Accurate short-term analysis of the fundamental
// frequency and the harmonics-to-noise ratio of a sampled sound").
//
// Implements the core of Praat's AC method on a single analysis frame:
//   1. subtract local mean, multiply by Hann window
//   2. normalized autocorrelation via FFT: r_x(tau) / r_x(0)
//   3. divide by the window's own normalized autocorrelation
//      (Boersma's key correction — undoes the window taper bias)
//   4. find local maxima in the pitch range, parabolic interpolation
//   5. candidate strength = r - octaveCost * log2(minPitch * tau_sec)
//      (favors higher-frequency candidates, per Praat)
//   6. compare best voiced candidate against the unvoiced candidate
//      (voicingThreshold + silence term)
//
// Deliberately frame-local: no Viterbi path search (Praat's
// octave-jump/voiced-unvoiced transition costs). This matches the
// constraint of Syrinx's per-25-ms-hop streaming pipeline and gives a
// conservative (lower-bound) estimate of Praat-like quality; a
// bounded-lookback path search like the retired pYIN L=4 machinery is
// the known upgrade path if frame-local proves close but flippy.
//
// Built for the 2026-06-09 pitch-detector shootout (SwiftF0 weak-H1
// octave-up failure on low-F0 voices). Evaluation harness:
// scripts/pitch-shootout-extract.js.

export const BOERSMA_DEFAULTS = {
  minPitchHz: 75,        // speech-scoped search range = the pitch trace's
  maxPitchHz: 400,       // display range exactly (constants.js
                         // PITCH_DISPLAY_RANGE 75-400). Floor raised
                         // 60->75 on 2026-06-10 to match the display: at
                         // 60 the trace painted 60-75 Hz detections under
                         // the chart (the display floor was 75). Corpus
                         // cost of dropping 60-75 Hz is negligible (FDA
                         // 0.13%, PTDB 0.97%, Hillenbrand/vocadito ~0);
                         // 3.6% of the low-voice session's frames sat
                         // there and now render as honest gaps instead of
                         // under-chart artifacts. Ceiling was cut 600->400
                         // earlier the same day (removed the 3-4x
                         // harmonic-lock error surface). measurements/
                         // pitch-range-60-400-2026-06-10.md +
                         // pitch-trace-floor-2026-06-10.md
  voicingThreshold: 0.40, // tuned (Praat default 0.45) — stage-A sweep,
                          // measurements/boersma-ac-tuning-2026-06-09.md
  silenceThreshold: 0.03, // Praat default (fraction of global peak)
  octaveCost: 0.01,       // Praat default. DO NOT RAISE — higher values
                          // are a high-octave bias that re-creates the
                          // weak-H1 octave-up failure on low-F0 voices
                          // (stage-A: 0.2 -> 48.5 % octave-up in the
                          // user-session 80-110 Hz band).
  peakFloor: 0.15,        // ignore AC maxima weaker than this (rNorm)
  maxCandidates: 15,
};

// Production frame length at 16 kHz: 96 ms. Stage-B sweep: beats 64 ms
// (vocadito +1.8, session +2.1, flips -2.7) and 128 ms (which blurs
// dynamic speech). Response center sits 48 ms behind the latest sample.
export const BOERSMA_FRAME_LENGTH_16K = 1536;

// In-place iterative radix-2 complex FFT (re/im arrays, length power of 2).
function fft(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (invert ? 1 : -1);
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Linear autocorrelation of x (length n) for lags [0, maxLag] via FFT
// with zero padding. Writes into out (length maxLag+1).
function autocorrFFT(x, n, fftSize, scratch, out, maxLag) {
  const { re, im } = scratch;
  re.fill(0); im.fill(0);
  for (let i = 0; i < n; i++) re[i] = x[i];
  fft(re, im, false);
  for (let i = 0; i < fftSize; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p; im[i] = 0;
  }
  fft(re, im, true);
  for (let t = 0; t <= maxLag; t++) out[t] = re[t];
}

export function createBoersmaAC(sampleRate, frameLength, opts = {}) {
  const cfg = { ...BOERSMA_DEFAULTS, ...opts };
  const n = frameLength;
  const fftSize = 1 << Math.ceil(Math.log2(2 * n));
  const minLag = Math.max(2, Math.floor(sampleRate / cfg.maxPitchHz));
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / cfg.minPitchHz));

  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }

  // Adaptive global peak for the Boersma silence term. Praat normalizes
  // localPeak by the RECORDING's global peak; a streaming detector has no
  // file, so track a slowly decaying running max (~17 s half-life at the
  // 25 ms hop). Hardcoding 1.0 (pre-fix) silenced real mics: with AGC off
  // speech peaks at 0.01-0.05 full-scale, inflating unvoicedStrength past
  // any voiced candidate — a clean 100 Hz tone at peak 0.02 decoded
  // UNVOICED. Corpus/session WAVs sit near full scale, which masked this
  // in every harness; caught from live-use report 2026-06-09.
  let globalPeak = 1e-4;
  const scratch = { re: new Float64Array(fftSize), im: new Float64Array(fftSize) };
  const windowed = new Float64Array(n);
  const rX = new Float64Array(maxLag + 1);
  const rW = new Float64Array(maxLag + 1);
  const rNorm = new Float64Array(maxLag + 1);

  // Window autocorrelation, computed once.
  autocorrFFT(window, n, fftSize, scratch, rW, maxLag);
  const rW0 = rW[0];

  // candidates(buffer): returns Praat-style frame candidates
  //   { voiced: [{ freq, strength }, ...], unvoicedStrength }
  // sorted by descending strength. The voiced array holds up to
  // maxCandidates local autocorrelation maxima in the pitch range; the
  // unvoiced option competes via unvoicedStrength. Frame-local detection
  // (detect, below) just takes the argmax; the path tracker runs a
  // bounded-lookback Viterbi over these candidate sets.
  function candidates(buffer) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += buffer[i];
    mean /= n;
    let localPeak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buffer[i] - mean);
      if (v > localPeak) localPeak = v;
    }
    if (localPeak === 0) return { voiced: [], unvoicedStrength: cfg.voicingThreshold };
    globalPeak = Math.max(localPeak, globalPeak * 0.999, 1e-4);

    for (let i = 0; i < n; i++) windowed[i] = (buffer[i] - mean) * window[i];
    autocorrFFT(windowed, n, fftSize, scratch, rX, maxLag);
    const r0 = rX[0];
    if (r0 <= 0) return { voiced: [], unvoicedStrength: cfg.voicingThreshold };
    for (let t = 0; t <= maxLag; t++) rNorm[t] = (rX[t] / r0) / (rW[t] / rW0);

    const unvoicedStrength = cfg.voicingThreshold + Math.max(
      0,
      2 - (localPeak / globalPeak) / (cfg.silenceThreshold / (1 + cfg.voicingThreshold)),
    );

    const cands = [];
    for (let t = minLag + 1; t < maxLag; t++) {
      if (rNorm[t] > rNorm[t - 1] && rNorm[t] >= rNorm[t + 1] && rNorm[t] > cfg.peakFloor) {
        const a = rNorm[t - 1], b = rNorm[t], c = rNorm[t + 1];
        const denom = a - 2 * b + c;
        const dt = denom !== 0 ? 0.5 * (a - c) / denom : 0;
        const lag = t + Math.max(-0.5, Math.min(0.5, dt));
        const r = b - 0.25 * (a - c) * dt;
        const freq = sampleRate / lag;
        if (freq < cfg.minPitchHz || freq > cfg.maxPitchHz) continue;
        // Praat candidate strength: R - octaveCost*log2(minPitch*tau).
        // tau ≤ 1/minPitch ⇒ log term ≤ 0 ⇒ bonus growing with freq,
        // the counterweight to raw AC's subharmonic preference.
        const strength = r - cfg.octaveCost * Math.log2(cfg.minPitchHz * lag / sampleRate);
        cands.push({ freq, strength, r });
      }
    }
    cands.sort((x, y) => y.strength - x.strength);
    if (cands.length > cfg.maxCandidates) cands.length = cfg.maxCandidates;
    return { voiced: cands, unvoicedStrength };
  }

  // detect(buffer): frame-local argmax over the candidate set. Returns
  // { pitch, strength, voiced }.
  function detect(buffer) {
    const { voiced, unvoicedStrength } = candidates(buffer);
    const best = voiced[0]; // candidates() returns descending strength
    if (!best || best.strength <= unvoicedStrength) {
      return { pitch: null, strength: best ? best.strength : 0, voiced: false };
    }
    return { pitch: best.freq, strength: best.strength, voiced: true };
  }

  return { detect, candidates, config: cfg, minLag, maxLag, fftSize };
}

// createPathTracker — online bounded-lookback Viterbi over Boersma
// candidate sets (Praat's path-finding, adapted to streaming with a
// finite L-frame delay, mirroring the retired pYIN L=4 design). Suppresses
// octave flips that frame-local argmax produces: a candidate that requires
// an octave jump from the running path pays octaveJumpCost * |Δlog2 f|, so
// a single strong subharmonic frame can't yank the contour unless it
// persists. Voiced↔unvoiced transitions pay voicedUnvoicedCost.
//
// emit(frameCandidates) is called once per hop with the output of
// detector.candidates(buffer); it returns the decoded pitch for the frame
// that is now L hops old (null until the lattice has filled), so the
// contour is delayed by L hops — acceptable at L≤4 (≤100 ms), the same
// trade pYIN made.
export const PATH_DEFAULTS = {
  octaveJumpCost: 0.15,     // per octave of frame-to-frame pitch jump.
                            // Tuned (stage-C): higher values make a
                            // wrong octave stickier, not rarer.
  voicedUnvoicedCost: 0.20, // entering/leaving voicing
  lookback: 2,              // L: decode delay in frames (50 ms at the
                            // 25 ms hop -> ~98 ms total display latency).
                            // L=4 (~148 ms) scores marginally better
                            // (session correct 93.7 vs 93.4, flip 4.3
                            // vs 5.0); L=2 chosen for responsiveness
                            // (user decision 2026-06-09).
};

export function createPathTracker(opts = {}) {
  const cfg = { ...PATH_DEFAULTS, ...opts };
  // Lattice column: array of states { freq|null, localCost, totalCost,
  // backState }. localCost = -strength (Viterbi minimizes cost). The
  // window holds at most lookback+1 columns; backState chains are severed
  // at the trailing edge each emit, bounding memory and making the search
  // a true bounded-lookback decode (no traceback past the window).
  let prevColumn = null;
  const window = [];
  let lastEmitted = null;

  function transitionCost(prev, cur) {
    const pv = prev.freq === null, cv = cur.freq === null;
    if (pv !== cv) return cfg.voicedUnvoicedCost;
    if (pv && cv) return 0;
    return cfg.octaveJumpCost * Math.abs(Math.log2(cur.freq / prev.freq));
  }

  function buildColumn(frameCandidates) {
    const states = frameCandidates.voiced.map((c) => ({
      freq: c.freq, localCost: -c.strength, totalCost: 0, backState: null,
    }));
    states.push({
      freq: null, localCost: -frameCandidates.unvoicedStrength,
      totalCost: 0, backState: null,
    });
    if (!prevColumn) {
      for (const s of states) s.totalCost = s.localCost;
    } else {
      for (const s of states) {
        let bestCost = Infinity, bestBack = null;
        for (const p of prevColumn) {
          const c = p.totalCost + transitionCost(p, s) + s.localCost;
          if (c < bestCost) { bestCost = c; bestBack = p; }
        }
        s.totalCost = bestCost; s.backState = bestBack;
      }
    }
    prevColumn = states;
    window.push(states);
    return states;
  }

  // emit(frameCandidates): push a frame, return the decoded pitch for the
  // frame now `lookback` hops old (null until the window has filled).
  function emit(frameCandidates) {
    const states = buildColumn(frameCandidates);
    if (window.length <= cfg.lookback) return null;
    // Trace the current best path back `lookback` columns to the window's
    // trailing column, emit that, then drop and sever it.
    let cur = states.reduce((a, b) => (b.totalCost < a.totalCost ? b : a));
    for (let k = 0; k < cfg.lookback; k++) cur = cur.backState ?? cur;
    lastEmitted = cur.freq;
    window.shift();
    for (const s of window[0]) s.backState = null; // sever; bound memory
    return cur.freq;
  }

  // flush(): at stream end, decode and return the still-pending trailing
  // frames (the last `window.length` columns) via best-path traceback.
  function flush() {
    if (!prevColumn) return [];
    let cur = prevColumn.reduce((a, b) => (b.totalCost < a.totalCost ? b : a));
    const tail = [];
    while (cur) { tail.push(cur.freq); cur = cur.backState; }
    tail.reverse();
    const out = tail.slice(Math.max(0, tail.length - window.length));
    window.length = 0;
    prevColumn = null;
    return out;
  }

  return { emit, flush, get lastEmitted() { return lastEmitted; }, config: cfg };
}

// Normalized cross-correlation at a specific integer lag over the frame
// (used by the half-period referee on SwiftF0 output). Searches +-search
// lags around `lag` and returns the max.
export function normCorrAtLag(buffer, lag, search = 2) {
  const n = buffer.length;
  let best = -1;
  for (let L = lag - search; L <= lag + search; L++) {
    if (L < 1 || L >= n) continue;
    let num = 0, e0 = 0, e1 = 0;
    for (let i = 0; i + L < n; i++) {
      num += buffer[i] * buffer[i + L];
      e0 += buffer[i] * buffer[i];
      e1 += buffer[i + L] * buffer[i + L];
    }
    const denom = Math.sqrt(e0 * e1);
    const r = denom > 0 ? num / denom : 0;
    if (r > best) best = r;
  }
  return best;
}
