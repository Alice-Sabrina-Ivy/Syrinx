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
  minPitchHz: 75,        // search floor = the pitch trace's display floor
                         // (constants.js PITCH_DISPLAY_RANGE.low). Raised
                         // 60->75 on 2026-06-10 to match the display: at
                         // 60 the trace painted 60-75 Hz detections under
                         // the chart. Corpus cost of dropping 60-75 Hz is
                         // negligible (FDA 0.13%, PTDB 0.97%, Hillenbrand/
                         // vocadito ~0). measurements/
                         // pitch-trace-floor-2026-06-10.md
  maxPitchHz: 800,       // search ceiling = 2x the 400 Hz DISPLAY ceiling
                         // (2026-10-03; was 400 = the display ceiling).
                         // With the search capped at the display ceiling,
                         // phonation above it (sirens, break excursions)
                         // had no fundamental candidate and decoded as a
                         // CONFIDENT half-pitch value inside the display:
                         // 69 % of the user's true >400 Hz frames posted
                         // at half, 43 % painted at half. At 800 they
                         // decode at their true F0 and the pitch worker
                         // posts every decode above PITCH_DISPLAY_RANGE.
                         // high as unvoiced (pitch-worker.js); 2x makes
                         // the guarantee structural — a true F0 in
                         // (400, 1600) can only alias to a half value
                         // ABOVE 400, which is nulled too. 600 leaves
                         // 600-800 Hz aliasing into 300-400. The 600->400
                         // cut of 2026-06-10 (3-4x harmonic-lock surface)
                         // is not undone: those locks now land above 400
                         // and post as unvoiced instead of painting.
                         // measurements/pitch-ceiling-2026-10-03.md
  voicingThreshold: 0.35, // tuned (Praat default 0.45). 0.45→0.40 by the
                          // stage-A sweep (frame-local, 50-600 Hz,
                          // boersma-ac-tuning-2026-06-09.md); 0.40→0.35
                          // by the stage-E sweep AT the deployed
                          // operating point (75-400 Hz, L=2 tracker):
                          // corpus nulls convert to correct with octave
                          // errors and flip rate flat-or-better on every
                          // corpus + the session (band 93.9→94.2, band
                          // nulls 0.4→0.1). 0.28-0.33 measured slightly
                          // better still on clean corpora — headroom
                          // pending a real-noise oracle. measurements/
                          // pitch-l2-retune-2026-07-19.md
  silenceThreshold: 0.03, // Praat default (fraction of global peak)
  octaveCost: 0.015,      // Praat default 0.01 -> 0.015 (2026-10-03,
                          // with octaveEvidence below; measurements/
                          // pitch-octave-arbitration-2026-10-03.md).
                          // Still DO NOT RAISE materially — larger values
                          // are a high-octave bias that re-creates the
                          // weak-H1 octave-up failure on low-F0 voices
                          // (stage-A: 0.2 -> 48.5 % octave-up in the
                          // user-session 80-110 Hz band). 0.015 alone
                          // measured +0.07/+0.13 pp (consensus/strict
                          // refs) Alice 75-160 Hz octave-up.
  // Spectral octave arbitration for (f, 2f) candidate pairs (2026-10-03).
  // Low-frequency energy (room rumble <140 Hz, LF speech energy) inflates
  // the autocorrelation at the 2T lag, so a real F0 2f can lose to its
  // subharmonic f by a few hundredths. For every candidate f that has a
  // 2f partner, oddEvenProminenceDb(f) compares the peak prominence of
  // the partials at ODD multiples 3f, 5f, ... with the EVEN multiples
  // 2f, 4f, ... (f itself is skipped — that is where rumble lives):
  //   <= lowThrDb  : odd multiples absent -> f is a subharmonic of a real
  //                  2f -> f.strength -= lowPenalty
  //   >= highThrDb : odd multiples as prominent as even -> f is a real F0
  //                  -> partner 2f.strength -= highPenalty (symmetric
  //                  octave-up guard; it is what keeps the low-voice
  //                  octave-up cost inside +0.3 pp — without it +0.30/
  //                  +0.41 pp)
  // Prominence-based (peak vs. the valleys half a comb-spacing away), so
  // it is insensitive to the formant envelope and to broadband noise
  // (noise lowers both odd and even prominence -> no penalty).
  // maxPartnerHz: only pairs whose 2f partner lies inside the DISPLAY
  // range (PITCH_DISPLAY_RANGE.high 400 x 1.05) are arbitrated. Coupling
  // with the 800 Hz search ceiling (maxPitchHz above): at 800 an octave
  // rule could pair every female F0 with a 400-800 Hz partner and push it
  // up out of the display (pitch-ceiling-2026-10-03.md §8 — phase-1 SHR
  // rule, Hillenbrand women -5.6 pp unrestricted). Arbitration was
  // measured at the 400 Hz search, where no partner can exceed 400, so
  // this restriction reproduces exactly the measured domain.
  octaveEvidence: {
    lowThrDb: -15, lowPenalty: 0.05,
    highThrDb: -3, highPenalty: 0.03,
    fMaxHz: 3500, maxMultiple: 16,
    maxPartnerHz: 420,
  },
  peakFloor: 0.15,        // ignore AC maxima weaker than this (rNorm)
  maxCandidates: 15,
  // Silence-term reference (globalPeak) transient rejection, 2026-10-03 —
  // see the globalPeak comment in createBoersmaAC. An event raises the
  // reference only if it fills >= referenceRank PERIODIC frames of the
  // last referenceWindow frames; referenceGain re-centres that rank
  // statistic on the old running max for sustained speech.
  // measurements/pitch-globalpeak-transient-2026-10-03.md
  referenceWindow: 12,      // frames (300 ms at the 25 ms hop)
  referenceRank: 5,
  referenceGain: 1.2,
  referencePeriodicR: 0.35, // frame counts if its best in-range AC peak r >= this
};

// Production frame length at 16 kHz: 80 ms. Response center sits 40 ms
// behind the latest sample. 1536→1280 on 2026-07-19 (stage-F sweep at
// the deployed 75-400/L=2 operating point, minLag fix in place): with
// vt 0.35, 1280 beats 1536 on the tuning session (band 94.2→95.4,
// octave-up 4.1→3.4), BOTH held-out recordings (97.3→98.3, 98.1→98.6),
// FDA (+1.0) and PTDB (+1.4) for BOTH genders, at the cost of ~1 pp on
// hillenbrand (isolated short vowels; symmetric across m/w, mostly
// nulls) and −0.1 vocadito. 1152 pushes further but the hillenbrand/
// vocadito cost steepens; 1408 is dominated. The 2026-06-09 stage-B
// pick of 1536 was measured frame-local at 50-600 Hz — the optimum
// moved with the operating point. measurements/
// pitch-l2-retune-2026-07-19.md
export const BOERSMA_FRAME_LENGTH_16K = 1280;

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
// If powOut is given, the frame's one-sided power spectrum bins
// [0, powOut.length) are copied there (reused by the octave arbitration).
function autocorrFFT(x, n, fftSize, scratch, out, maxLag, powOut) {
  const { re, im } = scratch;
  re.fill(0); im.fill(0);
  for (let i = 0; i < n; i++) re[i] = x[i];
  fft(re, im, false);
  for (let i = 0; i < fftSize; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p; im[i] = 0;
  }
  if (powOut) for (let i = 0; i < powOut.length; i++) powOut[i] = re[i];
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
  //
  // Transient rejection (2026-10-03): the running max used to take EVERY
  // frame's localPeak, so one click / plosive pop / desk bump far above a
  // quiet AGC-off voice (e.g. 1.0 vs speech peaks 0.03) latched the
  // reference for 30-50 s and the silence term vetoed the voice the whole
  // time (transient oracle: 34-50 % of voiced frames lost after ONE click
  // at speech peak 0.03; real sessions ran on a transient-set reference
  // 11-24 % of the time). Now a frame contributes only if its own AC is
  // periodic (best in-range peak r >= referencePeriodicR; transients are
  // aperiodic), and the contribution is the referenceRank-th largest such
  // frame peak over the last referenceWindow frames, x referenceGain — an
  // impulse appears in at most ~4 frames (80 ms window, 25 ms hop) and
  // its window-edge frames are the only periodic ones, so it can never
  // fill 5 periodic slots. Sustained speech does, and the gain puts the
  // rank-5 level back on the old running max (median ratio ~1.0 on all
  // four sessions). Decay (0.999/frame) and the 1e-4 floor unchanged, so
  // long-silence and soft-onset behaviour match the old tracker.
  let globalPeak = 1e-4;
  const refW = cfg.referenceWindow;
  const refRing = new Float64Array(refW); // gated frame peaks (0 = aperiodic)
  const refTmp = new Float64Array(refW);
  let refPos = 0, refFill = 0;
  function updateReference(localPeak, bestR) {
    refRing[refPos] = bestR >= cfg.referencePeriodicR ? localPeak : 0;
    refPos = (refPos + 1) % refW;
    if (refFill < refW) refFill++;
    for (let i = 0; i < refFill; i++) refTmp[i] = refRing[i];
    const rank = Math.min(cfg.referenceRank, refFill);
    let level = 0;
    for (let k = 0; k < rank; k++) { // rank-th largest; W, rank tiny
      let bi = 0;
      for (let i = 1; i < refFill; i++) if (refTmp[i] > refTmp[bi]) bi = i;
      level = refTmp[bi];
      refTmp[bi] = -1;
    }
    globalPeak = Math.max(cfg.referenceGain * level, globalPeak * 0.999, 1e-4);
  }
  const scratch = { re: new Float64Array(fftSize), im: new Float64Array(fftSize) };
  const windowed = new Float64Array(n);
  const rX = new Float64Array(maxLag + 1);
  const rW = new Float64Array(maxLag + 1);
  const rNorm = new Float64Array(maxLag + 1);

  // Octave-arbitration state (pre-allocated; no per-frame allocation
  // beyond the candidate objects candidates() already creates).
  const oe = cfg.octaveEvidence || null;
  const partnerMaxHz = oe && oe.maxPartnerHz != null ? oe.maxPartnerHz : Infinity;
  const binHz = sampleRate / fftSize;
  const spec = oe ? new Float64Array(Math.min(fftSize / 2, Math.ceil((oe.fMaxHz * 1.1) / binHz) + 2)) : null;
  const pen = new Float64Array(maxLag + 1); // >= max local-maxima count
  const DB = 10 / Math.LN10;
  // max power within [x - half, x + half]
  function peakPow(x, half) {
    let lo = Math.floor((x - half) / binHz), hi = Math.ceil((x + half) / binHz);
    if (lo < 1) lo = 1;
    if (hi > spec.length - 1) hi = spec.length - 1;
    let m = 1e-30;
    for (let b = lo; b <= hi; b++) if (spec[b] > m) m = spec[b];
    return m;
  }
  function meanPow(x, half) {
    let lo = Math.floor((x - half) / binHz), hi = Math.ceil((x + half) / binHz);
    if (lo < 1) lo = 1;
    if (hi > spec.length - 1) hi = spec.length - 1;
    let s = 0;
    for (let b = lo; b <= hi; b++) s += spec[b];
    return s / (hi - lo + 1) + 1e-30;
  }
  // mean prominence (dB) of the partials at odd multiples m*f (m = 3, 5,
  // ...) minus that at even multiples (m = 2, 4, ...), m <= maxMultiple,
  // m*f < fMaxHz. Prominence = peak (±min(3 %, 0.2 f)) over the mean
  // level of the valleys at (m ± 0.5) f (±0.1 f).
  function oddEvenProminenceDb(f) {
    let so = 0, no = 0, se = 0, ne = 0;
    for (let m = 2; m <= oe.maxMultiple && m * f < oe.fMaxHz; m++) {
      const x = m * f;
      const half = Math.min(0.03 * x, 0.2 * f);
      const v = 0.5 * (meanPow(x - 0.5 * f, 0.1 * f) + meanPow(x + 0.5 * f, 0.1 * f));
      const prom = DB * Math.log(peakPow(x, half) / v);
      if (m & 1) { so += prom; no++; } else { se += prom; ne++; }
    }
    return (no ? so / no : 0) - (ne ? se / ne : 0);
  }

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

    for (let i = 0; i < n; i++) windowed[i] = (buffer[i] - mean) * window[i];
    autocorrFFT(windowed, n, fftSize, scratch, rX, maxLag, spec);
    const r0 = rX[0];
    if (r0 <= 0) return { voiced: [], unvoicedStrength: cfg.voicingThreshold };
    for (let t = 0; t <= maxLag; t++) rNorm[t] = (rX[t] / r0) / (rW[t] / rW0);

    const cands = [];
    // Scan from minLag exactly (rNorm is computed for all lags 0..maxLag,
    // so the t-1 neighbor exists): starting at minLag+1 made the lag bin
    // of maxPitchHz itself ineligible as a local max, so any F0 above
    // ~maxPitch*(1 - maxPitch/(2*sampleRate)) (≈395 Hz at 400/16k) had NO
    // fundamental candidate and decoded as a confident octave-down via
    // the always-present 2x-period subharmonic peak (2026-07-19; frame
    // guard in tests/dsp/boersma-ac-test.js).
    for (let t = minLag; t < maxLag; t++) {
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
    if (oe && cands.length > 1) {
      // Octave arbitration (see BOERSMA_DEFAULTS.octaveEvidence). Pairs
      // are found on the pre-penalty strengths; penalties are summed and
      // applied afterwards so the result is order-independent. Partners
      // above maxPartnerHz are never paired (display-range domain only).
      const m = cands.length;
      for (let i = 0; i < m; i++) pen[i] = 0;
      for (let i = 0; i < m; i++) {
        const f = cands[i].freq;
        let u = -1;
        for (let j = 0; j < m; j++) {
          if (j !== i && cands[j].freq <= partnerMaxHz
            && Math.abs(cands[j].freq / (2 * f) - 1) < 0.05
            && (u < 0 || cands[j].strength > cands[u].strength)) u = j;
        }
        if (u < 0) continue;
        const ev = oddEvenProminenceDb(f);
        if (ev <= oe.lowThrDb) pen[i] += oe.lowPenalty;
        else if (ev >= oe.highThrDb) pen[u] += oe.highPenalty;
      }
      for (let i = 0; i < m; i++) cands[i].strength -= pen[i];
    }
    let bestR = 0;
    for (const c of cands) if (c.r > bestR) bestR = c.r;
    updateReference(localPeak, bestR);
    const unvoicedStrength = cfg.voicingThreshold + Math.max(
      0,
      2 - (localPeak / globalPeak) / (cfg.silenceThreshold / (1 + cfg.voicingThreshold)),
    );
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
                            // 25 ms hop -> ~90 ms total display latency
                            // at the 80 ms frame: 40 ms window center +
                            // 50 ms decode). L=4 (~140 ms) scores
                            // marginally better (2026-06-09 tuning at
                            // the then-96 ms frame: session correct
                            // 93.7 vs 93.4, flip 4.3 vs 5.0); L=2
                            // chosen for responsiveness (user decision
                            // 2026-06-09).
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

// harmonicStructureCount(buffer, f0, sampleRate) — SWIPE-flavored
// harmonic-structure check (Camacho 2008, simplified), added 2026-07-20
// as the voicing-quality veto the voicing-robustness shootout selected
// (measurements/noise-robustness-oracle-2026-07-19.md §9): counts
// spectral peaks at k*f0 (k=1..4) that clear the local floor by 6 dB.
// Voiced speech always presents several harmonics; noise shaped through
// a resonator presents exactly one — the field-failure class ("white
// noise" videos painting 290-380 Hz) is vetoed BY CONSTRUCTION when the
// caller requires a count >= 2. Shootout: costs 0.3 pp FDA / 0.0 pp
// vocadito while cutting every measured noise class's painting 3-8x.
// NOTE: a mathematically pure sine also has count 1 — the veto is
// applied at the WORKER level (reported pitch), deliberately not inside
// detect(), so detector-level tests and harnesses that use pure-tone
// stimuli keep exercising the estimator itself.
const _hsFftN = 4096;
let _hsScratch = null;
export function harmonicStructureCount(buffer, f0, sampleRate, ratio = 10) {
  if (!_hsScratch) {
    _hsScratch = {
      re: new Float64Array(_hsFftN),
      im: new Float64Array(_hsFftN),
      hann: null,
    };
  }
  const s = _hsScratch;
  if (!s.hann || s.hann.length !== buffer.length) {
    s.hann = new Float64Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      s.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (buffer.length - 1));
    }
  }
  s.re.fill(0); s.im.fill(0);
  const n = Math.min(buffer.length, _hsFftN);
  for (let i = 0; i < n; i++) s.re[i] = buffer[i] * s.hann[i];
  fft(s.re, s.im, false);
  const half = _hsFftN / 2;
  const binHz = sampleRate / _hsFftN;
  let count = 0;
  for (let k = 1; k <= 4; k++) {
    const f = k * f0;
    if (f > sampleRate / 2 - 100) break;
    const lo = Math.max(1, Math.floor((f * 0.96) / binHz));
    const hi = Math.min(half - 1, Math.ceil((f * 1.04) / binHz));
    let peak = 0;
    for (let b = lo; b <= hi; b++) {
      const p = s.re[b] * s.re[b] + s.im[b] * s.im[b];
      if (p > peak) peak = p;
    }
    const flo = Math.max(1, Math.floor((f * 0.65) / binHz));
    const fhi = Math.min(half - 1, Math.ceil((f * 1.35) / binHz));
    const band = [];
    for (let b = flo; b <= fhi; b++) band.push(s.re[b] * s.re[b] + s.im[b] * s.im[b]);
    band.sort((a, b) => a - b);
    const floor = band[Math.floor(band.length / 2)] || 1e-12;
    // `ratio` guards against max-statistics: the max over the ~13 bins
    // of the ±4 % search band is typically ~4x the band median for pure
    // noise (max of N exponentials), so a 6 dB threshold let noise fake
    // harmonics. Default 10x (10 dB) puts a noise-bin false harmonic
    // below ~1 % per band while true speech harmonics (20 dB+) pass.
    if (peak >= ratio * floor) count++;
  }
  return count;
}

// createHarmonicVoicingGuard — the production wrapper around
// harmonicStructureCount selected by the 2026-07-20 voicing-robustness
// shootout (scripts/voicing-robustness-shootout.js): veto reported
// voicing only after `debounce` CONSECUTIVE frames fail the harmonic
// check. Sustained non-harmonic content (the field-failure class:
// noise shaped through the pitch band) dies after debounce*hop
// (~100 ms) and can never paint beyond an onset blip; transient weak
// speech frames (breathy offsets, soft onsets) pass untouched —
// measured cost 0.1 pp FDA / 0.1 pp vocadito at ratio 10 / debounce 4,
// with every synthetic noise class <= 0.1 % painted. One instance per
// stream; check() must be called for every DECODED frame in order.
export function createHarmonicVoicingGuard({ ratio = 10, debounce = 4 } = {}) {
  let failStreak = 0;
  return {
    // check(buffer, f0, sampleRate): true = keep voiced, false = veto.
    // Call with f0 > 0 only; call reset() (or let streak decay via a
    // passing frame) across unvoiced gaps — unvoiced frames don't
    // advance the streak by definition.
    check(buffer, f0, sampleRate) {
      if (harmonicStructureCount(buffer, f0, sampleRate, ratio) >= 2) {
        failStreak = 0;
        return true;
      }
      failStreak++;
      return failStreak < debounce;
    },
    reset() { failStreak = 0; },
  };
}
