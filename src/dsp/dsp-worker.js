// dsp-worker.js — Web Worker that performs all DSP analysis off the main thread
// Pitch detection (YIN), formant extraction (Burg LPC), spectral tilt, HNR, intensity

const WINDOW_MS = 50;
let sampleRate = 48000;
let windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);

// Formant extraction parameters — computed on init.
// Target effective sample rate for formant analysis: ~10 kHz.  Praat uses
// 2× the maximum formant ceiling (default 5500 Hz → 11 kHz for female, 5000 Hz
// → 10 kHz for male).  We target 10 kHz as a compromise and adapt LPC order
// based on detected pitch.
// Maximum effective sample rate for formant analysis.  Decimation factor is
// chosen so that targetSR = sampleRate / factor ≤ MAX_FORMANT_SR.
// Praat uses 2× maxFormant (default 5500 → 11 kHz).  We cap at 12 kHz which
// ensures factor ≥ 2 at 16 kHz and factor = 4 at 48 kHz.
const MAX_FORMANT_SR = 12000;
let decimationFactor = 4;
let targetSR = 12000;
// Base LPC order — may be adjusted per-frame based on detected pitch.
// Order 10 at 10 kHz = 5 poles = ~5 formants up to 5 kHz (suitable for male).
// Order 12 at 10 kHz = 6 poles = ~6 formants (suitable for female, higher ceiling).
const LPC_ORDER_MALE = 10;
const LPC_ORDER_FEMALE = 12;
let LPC_ORDER = 10;
// Pre-computed FIR anti-alias filter for decimation (re-computed on 'init' message).
// Initialize with default decimation factor so the worker is ready before 'init'.
let antiAliasFilter = null; // populated below after designLowPassFIR is defined

// Pre-allocated ring buffer to avoid GC pressure from repeated allocations.
// Uses a fixed-size buffer with a write position; oldest data is overwritten.
let ringCapacity = windowSize * 2;
let ringBuffer = new Float32Array(ringCapacity);
let ringLen = 0; // how many valid samples are in the buffer
let analysisCount = 0;

// Diagnostic: track pending chunks for queue depth monitoring
let pendingChunks = 0;
let lastContextTime = 0; // AudioContext time when latest chunk was captured

// Diagnostic-mode toggle, set via the `init` message from the main thread
// when the URL has ?diag=1. When off, the additional timing/voicedness
// fields are NOT computed or sent — only the existing production fields.
// When on, processChunk emits extra fields the overlay uses.
let _diag = false;

// --- Pre-allocated buffers for zero-GC-pressure hot path ---
// These are sized for the default 48 kHz sample rate and re-allocated on 'init'.
let _preEmph = new Float64Array(windowSize);
let _windowed = new Float64Array(windowSize);
// Sized for factor=1 (no decimation) to support pitch-adaptive decimation
let _decimated = new Float64Array(windowSize);

// YIN pitch: FFT-based autocorrelation buffers.
// FFT size must be >= 2*windowSize and a power of 2.
let _yinFftLen = 1;
{ let _n = windowSize; while (_yinFftLen < _n * 2) _yinFftLen <<= 1; }
let _yinRe = new Float64Array(_yinFftLen);
let _yinIm = new Float64Array(_yinFftLen);
let _yinDiff = new Float32Array(windowSize);
let _yinCmnd = new Float32Array(windowSize);
let _yinCumSq = new Float64Array(windowSize + 1); // prefix sum of x[i]^2 for YIN

// Spectral tilt: 2048-point FFT (fixed size, independent of sample rate)
const _tiltRe = new Float64Array(2048);
const _tiltIm = new Float64Array(2048);

// HNR: 4096-point FFT (fixed, accommodates 2048 samples zero-padded)
const _hnrRe = new Float64Array(4096);
const _hnrIm = new Float64Array(4096);

// Burg LPC: pre-allocated prediction error buffers (sized for full window to
// support factor=1 decimation for female voice analysis)
let _burgEf = new Float64Array(windowSize);
let _burgEb = new Float64Array(windowSize);
let _burgEfTmp = new Float64Array(windowSize);
let _burgEbTmp = new Float64Array(windowSize);
// Maximum possible LPC order: up to 16 for female voices at high sample rates
const MAX_LPC_ORDER = 16;
let _burgA = new Float64Array(MAX_LPC_ORDER + 1);
let _burgANew = new Float64Array(MAX_LPC_ORDER + 1);

// Root finding: flat typed arrays instead of object arrays (2 doubles per root)
let _rootsRe = new Float64Array(MAX_LPC_ORDER);
let _rootsIm = new Float64Array(MAX_LPC_ORDER);

// Formant selection scratch arrays (max MAX_LPC_ORDER/2 formants)
const _formantFreqs = new Float64Array(MAX_LPC_ORDER);
const _formantBws = new Float64Array(MAX_LPC_ORDER);

// --- pYIN: probabilistic threshold integration (Mauch & Dixon 2014, §2.1) ---
// Stage gating via globalThis.__PYIN_STAGE (read per call inside detectPitch).
// Production default is 2 (set via _PYIN_STAGE_DEFAULT below).
//   0 = vanilla YIN — first-below-threshold + parabolic interpolation. No
//       octave correction. Retained as a baseline reference for comparison
//       harnesses; not the production path.
//   1 = pYIN step 1 only — Beta(2,18) threshold integration with naive
//       argmax collapse to a single τ. No HMM. Diagnostic stage.
//   2 = pYIN Stage 2.B (production) — HMM with bounded-history Viterbi
//       over the voicing-duplicated 600-state space. σ=50 cents,
//       L=4 (100 ms latency at 25 ms hop).
//
// Beta(α=2, β=18) CDF lookup table built once at module load.
// PDF: f(x) = 342·x·(1−x)^17 since 1/B(2,18) = 19·18 = 342.
// Trapezoidal integration into a 1024-entry table, then renormalize so
// CDF(1) = 1 exactly (cancels accumulated trapezoidal drift). All pYIN
// per-frame cost is O(nCandidates) lookups against this table.
const _BETA_CDF_LEN = 1024;
const _betaCdf = new Float32Array(_BETA_CDF_LEN);
{
  const dx = 1 / (_BETA_CDF_LEN - 1);
  const pdf = (x) => 342 * x * Math.pow(1 - x, 17);
  let acc = 0;
  _betaCdf[0] = 0;
  for (let i = 1; i < _BETA_CDF_LEN; i++) {
    acc += 0.5 * (pdf((i - 1) * dx) + pdf(i * dx)) * dx;
    _betaCdf[i] = acc;
  }
  const last = _betaCdf[_BETA_CDF_LEN - 1];
  if (last > 0) for (let i = 0; i < _BETA_CDF_LEN; i++) _betaCdf[i] /= last;
}

function _betaCdfLookup(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const idx = x * (_BETA_CDF_LEN - 1);
  const lo = idx | 0;
  const hi = lo + 1 < _BETA_CDF_LEN ? lo + 1 : _BETA_CDF_LEN - 1;
  const frac = idx - lo;
  return _betaCdf[lo] * (1 - frac) + _betaCdf[hi] * frac;
}

// pYIN candidate scratch buffers — caps far above typical (~5–15 candidates
// per frame in normal speech). Sized at module load; never reallocated.
const _PYIN_MAX_CANDIDATES = 64;
const _pyinCandTau = new Int32Array(_PYIN_MAX_CANDIDATES);
const _pyinCandV = new Float32Array(_PYIN_MAX_CANDIDATES);
const _pyinCandProb = new Float32Array(_PYIN_MAX_CANDIDATES);

// --- pYIN Stage 2: HMM with bounded-history Viterbi (Mauch & Dixon §2.2–2.3,
//     librosa-pyin-style voicing-duplicated state space) ---
//
// State space: 300 voiced pitch states + 300 unvoiced TWINS, total N = 600.
//   index s ∈ [0, 300)   → voiced at pitch s   (75 → 600 Hz, 12 cents/state)
//   index s ∈ [300, 600) → unvoiced at pitch (s − 300)
//
// Replaces the earlier single-unvoiced-super-state design (option A) which
// trapped the HMM in unvoiced state on real-speech frames where individual
// CMND minima are shallow (~0.10–0.20). See
// measurements/pyin-stage2-2026-05-04.md for the failure-mode trace.
//
// Pitch propagation through marginal frames is the design feature. Both
// twins of every pitch state share the same Gaussian-over-cents pitch
// transition prior (σ = 20 cents, paper default); voicing flips
// (switch_prob = 0.01) factor independently. So unvoiced(s) → voiced(s)
// is the highest-weight transition out of unvoiced(s) — this is what
// preserves "the pitch I had a moment ago" through marginal-CMND frames.
//
// Mirrors librosa.pyin's HMM structure: pitch transition × voicing flip
// factorization, uniform unvoiced obs (1 − voicedness)/N_pitch, voiced obs
// directly from candidate Beta-CDF mass. Diverges from the paper only in
// observation-noise smoothing (we add ε per state, librosa does similar).
const _PYIN_N_PITCH = 300;
const _PYIN_N_STATES = 600;
const _PYIN_VOICED_OFFSET = 0;
const _PYIN_UNVOICED_OFFSET = 300;
// σ = 50 cents (was 20 from the original Mauch & Dixon paper). Set on
// 2026-05-04 after the L-axis sweep at L=4 (the new ship lookback)
// showed σ=50 strictly dominates σ=75 on Hillenbrand: full-corpus
// F=12.16 vs 12.20, M=12.15 vs 12.95 — the M gain is real. PTDB-TUG
// codet at σ=50 (F=6.20, p95=17.2) is within sampling-noise of σ=75
// on a 180-file corpus and well inside Stage 0 dominance.
// The σ-rate-scaling argument now resolves cleanly: paper σ=20 at
// 10 ms hop ≈ σ=50 at our 25 ms hop, which the L-axis sweep at L=4
// confirms empirically. See measurements/pyin-L-sweep-2026-05-04.md
// (and pyin-stage2b-sigma-sweep-2026-05-04.md for the prior L=2-only
// σ-sweep that selected σ=75 before the L-axis was mapped).
const _PYIN_SIGMA_CENTS = 50;
const _PYIN_CENTS_PER_STATE = 12;
const _PYIN_SWITCH_PROB = 0.01;
const _PYIN_OBS_FLOOR = 1e-6;
const _PYIN_L_MAX = 10;
// Production lookback default. L=4 = 100 ms latency at the 25 ms hop
// — exactly the original latency budget. Selected by the L-axis Pareto
// sweep at measurements/pyin-L-sweep-2026-05-04.md: at full-corpus
// Hillenbrand 1116 files, L=4 σ=50 is the gender-symmetric optimum
// (F=12.16, M=12.15, gap < 0.01 Hz) — substantially better than
// L=2 σ=75 on male voices (M=15.52). Harnesses override per call via
// globalThis.__PYIN_LOOKBACK; production uses this default.
const PYIN_LOOKBACK_DEFAULT = 4;
// Production default for the stage-gate dispatch. PYIN_STAGE=2 is pYIN
// with HMM + bounded-history Viterbi (option B, librosa-style voicing-
// duplicated state space). Harnesses can override per call by setting
// globalThis.__PYIN_STAGE to 0 (vanilla YIN), 1 (Beta-threshold
// with naive argmax), or 2.
const _PYIN_STAGE_DEFAULT = 2;

// Pitch transition log-probabilities — Gaussian over cents distance,
// independent of voicing. Transposed layout: [to_pitch·N_PITCH + from_pitch]
// = log P(from_pitch → to_pitch). ~360 KB Float32. Used for both
// voiced→voiced and unvoiced→unvoiced and voicing-flip transitions —
// pitch transition factor is the same regardless of voicing change.
//
// Built at module load with the default σ; the {type: "set-pyin-sigma"}
// message rebuilds it with a different σ. Harness-only API: production
// runs the default. The matrix is sample-rate-independent (cents are
// log-frequency), so a single rebuild covers all worker contexts.
const _PYIN_LOG_PITCH_TRANS = new Float32Array(_PYIN_N_PITCH * _PYIN_N_PITCH);
function _pyinBuildPitchTrans(sigma) {
  const cps = _PYIN_CENTS_PER_STATE;
  const w = new Float64Array(_PYIN_N_PITCH);
  for (let from = 0; from < _PYIN_N_PITCH; from++) {
    let sum = 0;
    for (let to = 0; to < _PYIN_N_PITCH; to++) {
      const dCents = cps * (to - from);
      w[to] = Math.exp(-(dCents * dCents) / (2 * sigma * sigma));
      sum += w[to];
    }
    const inv = 1 / sum;
    for (let to = 0; to < _PYIN_N_PITCH; to++) {
      _PYIN_LOG_PITCH_TRANS[to * _PYIN_N_PITCH + from] = Math.log(w[to] * inv);
    }
  }
}
_pyinBuildPitchTrans(_PYIN_SIGMA_CENTS);

// Voicing flip log-probabilities — 2×2 table indexed by [from_voiced][to_voiced]
// with 1 = voiced, 0 = unvoiced. switch_prob = 0.01 either direction.
const _PYIN_LOG_VOICING_VV = Math.log(1 - _PYIN_SWITCH_PROB);   // voiced → voiced
const _PYIN_LOG_VOICING_VU = Math.log(_PYIN_SWITCH_PROB);       // voiced → unvoiced
const _PYIN_LOG_VOICING_UV = Math.log(_PYIN_SWITCH_PROB);       // unvoiced → voiced
const _PYIN_LOG_VOICING_UU = Math.log(1 - _PYIN_SWITCH_PROB);   // unvoiced → unvoiced

// Forward log-α buffer — 2 frames worth (current + previous). 600 states each.
const _PYIN_LOG_ALPHA = new Float32Array(2 * _PYIN_N_STATES);
// Backpointers — circular over L_MAX frames. Int16 holds 0–599 fine.
const _PYIN_BACKPTRS = new Int16Array(_PYIN_L_MAX * _PYIN_N_STATES);
// Per-frame observation log-likelihoods scratch (all 600 states).
const _PYIN_OBS_LOG = new Float32Array(_PYIN_N_STATES);

// Viterbi inner-loop scratch: best previous-voiced and previous-unvoiced
// path values + argmaxes per to_pitch. Lets us decompose the N²=360k inner
// loop into 2·N_PITCH² ≈ 180k MACs per frame (factoring out the
// 4-element voicing flip combinatorics from the inner loop).
const _PYIN_BEST_VOICED_PATH = new Float32Array(_PYIN_N_PITCH);
const _PYIN_BEST_UNVOICED_PATH = new Float32Array(_PYIN_N_PITCH);
const _PYIN_BEST_VOICED_ARG = new Int16Array(_PYIN_N_PITCH);
const _PYIN_BEST_UNVOICED_ARG = new Int16Array(_PYIN_N_PITCH);

// HMM frame counter — frames-since-last-reset. Module-level state by design;
// reset via the {type: "reset-pitch-hmm"} message (harness only — production
// runs continuously and never resets).
let _pyinFrameIdx = 0;

// Two voicedness signals are exposed by Stage 2.B, addressing two
// different downstream questions. KEEP THEM DISTINCT — they're not
// interchangeable.
//
// 1. _pyinLastVoicedness  — HMM-smoothed posterior P(voiced | obs_{1..t}).
//    Combines per-frame Beta-CDF candidate mass with the HMM's
//    accumulated α via log-sum-exp ratio. In [0, 1]. Used by downstream
//    UI / smoother as a confidence signal: high → "I'm confident this
//    frame is voiced". Surfaced on the postMessage payload.
//    Behavior on silence/DC/no-candidate input: ~0.5 (uniform Bayesian
//    response to no evidence — the HMM correctly says "I don't know").
//
// 2. _pyinLastVoicednessObs — raw per-frame candidate Beta-CDF mass.
//    The fraction of the threshold distribution that selects ANY
//    candidate (= 1 − F_β(deepest CMND minimum)). In [0, 1]. Used by
//    tests that ask "did the signal contain pitch evidence at all" —
//    silence/DC/noise have ZERO candidate mass and 0 voicednessObs;
//    real speech (even with shallow CMND) has > 0. NOT used by the
//    HMM directly (the HMM uses obs distribution, not this scalar).
//
// Note: HMM-smoothed voicedness is at frame t, while the returned pitch
// is the L-back state — there's an L-frame asymmetry (~50–250 ms
// depending on lookback). Document if a future consumer needs them
// synchronized.
let _pyinLastVoicedness = null;
let _pyinLastVoicednessObs = null;

function _pyinResetState() {
  _pyinFrameIdx = 0;
  _pyinLastVoicedness = null;
  _pyinLastVoicednessObs = null;
}

function processChunk(buffer, contextTime) {
  const chunkReceiveTime = performance.now();
  // Wall-clock receipt time, used by the main thread (diag mode) to compute
  // chunkArrivalMs against the audio-context epoch. Captured even when diag
  // is off — it's one timestamp call, negligible.
  const chunkReceiveEpochMs = performance.timeOrigin + performance.now();
  pendingChunks--;
  if (contextTime !== null && contextTime !== undefined) lastContextTime = contextTime;

  const chunk = new Float32Array(buffer);
  appendToRingBuffer(chunk);

  if (ringLen < windowSize) return;

  // Extract analysis window (last windowSize samples) without allocating
  const windowStart = ringLen - windowSize;
  const window = ringBuffer.subarray(windowStart, ringLen);
  const intensity = computeIntensity(window);

  // Pitch detection — timed separately from formant/tilt/HNR when diag is on
  // so the overlay can isolate pYIN cost from the heavier every-6th-frame
  // analysis. Cost when diag is off: one extra performance.now() call,
  // negligible compared to detectPitch itself (~1 ms).
  const pitchStart = _diag ? performance.now() : 0;
  const pitch = detectPitch(window, sampleRate);
  const pitchEnd = _diag ? performance.now() : 0;

  // Formants, spectral tilt, HNR are heavier — run every 6th analysis frame.
  // At ~30 fps DSP rate, this fires every ~200ms, saving significant CPU
  // (LPC + root finding + FFT) while still being responsive enough for training.
  let formants = null, spectralTilt = null, hnr = null;
  if (analysisCount % 6 === 0) {
    formants = extractFormants(window, pitch);
    spectralTilt = computeSpectralTilt(window, sampleRate);
    hnr = computeHNR(window, sampleRate);
  }
  analysisCount++;

  const analysisEndTime = performance.now();

  // Diagnostic-only fields. inputRms is computed cheaply from the window
  // we already have. When diag is off, none of this is computed or sent.
  // chunkArrivalMs is NOT computed here — the AudioWorklet can't supply
  // a comparable wall-clock timestamp (no `performance` in
  // AudioWorkletGlobalScope). The main thread reconciles
  // chunkReceiveEpochMs against ctxCreatedAtEpochMs + contextTime.
  let diagFields = null;
  if (_diag) {
    let sumSq = 0;
    for (let i = 0; i < window.length; i++) sumSq += window[i] * window[i];
    const inputRms = Math.sqrt(sumSq / window.length);
    diagFields = {
      voicednessObs: _pyinLastVoicednessObs,
      pitchDetectMs: pitchEnd - pitchStart,
      inputRms,
      // Wall-clock epoch-ms at chunk receipt and at postMessage. Main
      // thread combines these with ctxCreatedAtEpochMs + contextTime to
      // derive chunkArrivalMs (capture → worker arrival) and
      // handoffToMainMs (DSP postMessage → main onmessage entry).
      chunkReceiveEpochMs,
      postedAtEpochMs: performance.timeOrigin + performance.now(),
    };
  }

  self.postMessage({
    type: "analysis",
    data: {
      pitch, intensity, formants, spectralTilt, hnr,
      // pYIN Stage 2 only: HMM-smoothed voicing posterior at the current
      // frame, in [0, 1]. null when Stage 2 isn't active (Stage 0/1 don't
      // compute it). No UI consumer yet — exposed on the protocol so the
      // smoother / future resonance display can pick it up later without
      // a worker-API change. See _detectPitchPyinStage2 for derivation.
      voicedness: _pyinLastVoicedness,
      // Absolute timestamp comparable across threads
      absoluteTime: performance.timeOrigin + performance.now(),
      // Diagnostic fields (always present so the main-thread shape doesn't
      // change; the heavy ones nest under `diag` when diag is on, null otherwise)
      workerProcessingMs: analysisEndTime - chunkReceiveTime,
      pendingChunks,
      contextTime: lastContextTime, // AudioContext time when audio was captured
      diag: diagFields,
    },
  });
}

self.onmessage = (e) => {
 try {
  const { type } = e.data;

  if (type === "init") {
    sampleRate = e.data.sampleRate;
    if (e.data.diag) _diag = true;
    windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
    // Use ceil to ensure targetSR ≤ MAX_FORMANT_SR.  At 16 kHz input,
    // ceil(16000/12000)=2 → targetSR=8000; at 48 kHz, ceil(48000/12000)=4 → 12000.
    // The key fix: Math.round(16000/11000)=1 gave NO downsampling at 16 kHz.
    decimationFactor = Math.max(1, Math.ceil(sampleRate / MAX_FORMANT_SR));
    targetSR = sampleRate / decimationFactor;
    // Anti-alias cutoff: 0.45/factor gives 90% of target Nyquist.
    // Previous 0.4/factor was too aggressive at low decimation factors (e.g.
    // at 16kHz/factor=2, cutoff was 3200 Hz, truncating female F2/F3).
    antiAliasFilter = designLowPassFIR(0.45 / decimationFactor, decimationFactor * 16 + 1);
    ringCapacity = windowSize * 2;
    ringBuffer = new Float32Array(ringCapacity);
    ringLen = 0;
    analysisCount = 0;

    // Re-allocate pre-sized buffers for new sample rate
    _preEmph = new Float64Array(windowSize);
    _windowed = new Float64Array(windowSize);
    // Sized for factor=1 to support pitch-adaptive decimation for female voices
    _decimated = new Float64Array(windowSize);
    _burgEf = new Float64Array(windowSize);
    _burgEb = new Float64Array(windowSize);
    _burgEfTmp = new Float64Array(windowSize);
    _burgEbTmp = new Float64Array(windowSize);
    _burgA = new Float64Array(MAX_LPC_ORDER + 1);
    _burgANew = new Float64Array(MAX_LPC_ORDER + 1);
    _rootsRe = new Float64Array(MAX_LPC_ORDER);
    _rootsIm = new Float64Array(MAX_LPC_ORDER);

    // YIN FFT buffers
    _yinFftLen = 1;
    while (_yinFftLen < windowSize * 2) _yinFftLen <<= 1;
    _yinRe = new Float64Array(_yinFftLen);
    _yinIm = new Float64Array(_yinFftLen);
    _yinDiff = new Float32Array(windowSize);
    _yinCmnd = new Float32Array(windowSize);
    _yinCumSq = new Float64Array(windowSize + 1);
    // Init-ack so the main thread can confirm the worker received the
    // diag flag and set up its buffers. Always sent regardless of diag.
    self.postMessage({ type: "worker-init-ack", diag: _diag, sampleRate, windowSize });
    return;
  }

  // Direct MessagePort from AudioWorklet (bypasses main thread)
  if (type === "port") {
    const port = e.data.port;
    port.onmessage = (ev) => {
      pendingChunks++;
      const msg = ev.data;
      if (msg && msg.buffer) {
        processChunk(msg.buffer, msg.contextTime);
      } else {
        // Fallback: raw ArrayBuffer (shouldn't happen with updated worklet)
        processChunk(msg);
      }
    };
    return;
  }

  if (type === "chunk") {
    pendingChunks++;
    processChunk(e.data.buffer);
  }

  // pYIN HMM reset — harness-only message used between independent
  // recordings to clear forward variables. Production runs the worker
  // continuously across an entire session and never sends this.
  if (type === "reset-pitch-hmm") {
    _pyinResetState();
    return;
  }

  // pYIN σ override — harness-only message used by the σ-sweep harness
  // to test transition-prior sensitivity. Rebuilds the pitch transition
  // matrix with the new σ; existing α-buffers are unaffected so a reset
  // typically follows. Production never sends this; default σ stays at
  // _PYIN_SIGMA_CENTS = 20 cents (paper default).
  if (type === "set-pyin-sigma") {
    _pyinBuildPitchTrans(e.data.sigma);
    return;
  }
 } catch (err) {
   // Surface init / message-handler errors so an empty pipeline doesn't
   // look like "no audio". Production code paths shouldn't hit this; if
   // they do, the diag overlay's "Pipeline status" panel will show why.
   self.postMessage({
     type: "worker-error",
     where: "onmessage",
     message: err && err.message ? err.message : String(err),
     stack: err && err.stack ? err.stack : null,
   });
 }
};

// --- Ring buffer ---

function appendToRingBuffer(chunk) {
  if (ringLen + chunk.length <= ringCapacity) {
    // Room to append directly
    ringBuffer.set(chunk, ringLen);
    ringLen += chunk.length;
  } else {
    // Shift old data left to make room, keeping at most (ringCapacity - chunk.length)
    const keepLen = Math.min(ringLen, ringCapacity - chunk.length);
    ringBuffer.copyWithin(0, ringLen - keepLen, ringLen);
    ringBuffer.set(chunk, keepLen);
    ringLen = keepLen + chunk.length;
  }
}

// --- Intensity (RMS in dB) ---

function computeIntensity(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

// --- YIN Pitch Detection (FFT-accelerated) ---
// Uses FFT-based autocorrelation to compute the YIN difference function in
// O(n log n) instead of O(n²). The difference function d(tau) can be expressed as:
//   d(tau) = r(0) + r_shifted(0) - 2*r_cross(tau)
// where r_cross is the cross-correlation computed via FFT.
//
// Stage 2 (pYIN HMM) returns the HMM's best pitch estimate regardless of
// voicing state; production silence gating happens upstream in
// useAudioPipeline.js. The HMM's voicing posterior is exposed separately
// on the worker's postMessage payload as `voicedness ∈ [0,1]`. Stage 0 (legacy
// YIN) and Stage 1 (Beta-threshold + argmax) keep the original null-on-no-
// detection contract.

function detectPitch(buffer, sr) {
  // Reset Stage-2-only voicedness signals; Stage 2 sets them before
  // returning, other stages leave them null so the postMessage payload
  // reflects "not computed". See the module-level comment block on
  // _pyinLastVoicedness / _pyinLastVoicednessObs for the distinction.
  _pyinLastVoicedness = null;
  _pyinLastVoicednessObs = null;
  const threshold = 0.20;
  const minF0 = 75;
  const maxF0 = 600;
  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.floor(sr / minF0);
  const halfLen = Math.floor(buffer.length / 2);
  const searchLen = Math.min(maxLag + 2, halfLen);

  if (maxLag >= halfLen) return null;

  const N = buffer.length;
  const fftLen = _yinFftLen;
  const re = _yinRe;
  const im = _yinIm;

  // Zero-fill and load buffer into FFT arrays
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < N; i++) re[i] = buffer[i];

  // Autocorrelation via FFT: IFFT(|FFT(x)|²)
  fft(re, im);
  for (let i = 0; i < fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im);
  // re[tau] / fftLen = autocorrelation at lag tau

  // Compute the YIN difference function using FFT autocorrelation.
  // The FFT gives r(tau) = sum_{i=0}^{N-1-tau} x[i]*x[i+tau] (linear correlation).
  // The difference function over the matching range is:
  //   d(tau) = sum_{i=0}^{N-1-tau} x[i]^2 + sum_{i=tau}^{N-1} x[i]^2 - 2*r(tau)
  // We use a prefix sum of x[i]^2 to compute both energy terms in O(1) per tau.

  const diff = _yinDiff;

  // Prefix sum: cumSq[k] = sum_{i=0}^{k-1} x[i]^2
  const cumSq = _yinCumSq;
  cumSq[0] = 0;
  for (let i = 0; i < N; i++) {
    cumSq[i + 1] = cumSq[i] + buffer[i] * buffer[i];
  }

  diff[0] = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    // leftEnergy(tau) = sum_{i=0}^{N-1-tau} x[i]^2 = cumSq[N - tau]
    // rightEnergy(tau) = sum_{i=tau}^{N-1} x[i]^2 = cumSq[N] - cumSq[tau]
    const autocorr = re[tau] / fftLen;
    diff[tau] = cumSq[N - tau] + (cumSq[N] - cumSq[tau]) - 2 * autocorr;
  }

  // Step 2: Cumulative mean normalized difference
  const cmnd = _yinCmnd;
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  // pYIN gate: probabilistic threshold integration (Mauch & Dixon 2014 §2.1).
  // When __PYIN_STAGE === 1, run Beta(2,18) threshold integration with naive
  // argmax-over-candidates collapse. When === 2, run pYIN Stage 2.B (HMM +
  // bounded-history Viterbi) — the production default. When === 0, fall
  // through to vanilla YIN below (first-below-threshold + parabolic interp).
  // Read lazily so the harness can change __PYIN_STAGE between calls without
  // re-instantiating the worker context. Production default is
  // _PYIN_STAGE_DEFAULT = 2 (set above); harnesses may override per call.
  const __pyinStage =
    typeof globalThis !== "undefined" && Number.isInteger(globalThis.__PYIN_STAGE)
      ? globalThis.__PYIN_STAGE
      : _PYIN_STAGE_DEFAULT;
  if (__pyinStage === 1) {
    return _detectPitchPyinStage1(cmnd, searchLen, minLag, maxLag, sr);
  }
  if (__pyinStage === 2) {
    return _detectPitchPyinStage2(cmnd, searchLen, minLag, maxLag, sr);
  }

  // Step 3: Absolute threshold — collect all dips below threshold, then
  // pick the best one (preferring the first/lowest-frequency dip to avoid
  // octave errors, but allowing a deeper dip at 2× lag if it is significantly
  // better — indicating the first dip was a sub-harmonic artifact).
  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, searchLen); tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < searchLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null;

  // (Stage 0 = vanilla YIN. The multi-mult harmonic-correction block
  // that used to live here was removed on 2026-05-04 after Stage 2.B
  // pYIN became the production default — its HMM does the work the
  // multi-mult heuristic was doing, and on a wider class of inputs.
  // PYIN_STAGE=0 is no longer the production path; it remains as a
  // baseline reference for comparison harnesses, now equivalent to
  // first-below-threshold YIN with parabolic interpolation only.)

  // Step 4: Parabolic interpolation
  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < searchLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  let refinedTau = denom !== 0 ? bestTau + (s0 - s2) / denom : bestTau;

  const minTauVal = sr / maxF0;
  const maxTauVal = sr / minF0;
  refinedTau = Math.max(minTauVal, Math.min(maxTauVal, refinedTau));

  return sr / refinedTau;
}

// pYIN Stage 1: probabilistic threshold integration + naive argmax collapse.
// Replaces the legacy "first below 0.20" decision and multi-mult harmonic
// correction. Inputs: filled CMND in [0, searchLen), the τ-search bounds,
// and sample rate. Returns Hz or null. Per-frame cost: one local-minima
// scan over [minLag, maxLag), then ≤ _PYIN_MAX_CANDIDATES Beta-CDF lookups.
//
// Algorithm (Mauch & Dixon 2014, §2.1):
//   - Candidates are local minima of CMND in the τ-search range.
//   - Sort by τ ascending. For threshold s, YIN selects the smallest-τ
//     candidate with CMND value < s. Integrate over s ~ Beta(2, 18):
//     candidate τ_k with value v_k is selected when s ∈ (v_k, m_k], where
//     m_k = min over earlier candidates' values (initial 1.0). Probability
//     mass: F_β(m_k) − F_β(v_k), nonzero only when v_k < m_k (a "new low").
//   - Stage 1 is naive: pick the highest-probability candidate. Stage 2
//     will plug this distribution into an HMM and let Viterbi decode the
//     state sequence over recent frames.
function _detectPitchPyinStage1(cmnd, searchLen, minLag, maxLag, sr) {
  const upper = maxLag < searchLen - 1 ? maxLag : searchLen - 1;

  // Local-minima scan. "Strict left, ≤ right" picks the leftmost element
  // of any plateau as its representative — exactly one candidate per dip.
  let nCand = 0;
  for (let tau = minLag + 1; tau < upper; tau++) {
    if (cmnd[tau] < cmnd[tau - 1] && cmnd[tau] <= cmnd[tau + 1]) {
      if (nCand < _PYIN_MAX_CANDIDATES) {
        _pyinCandTau[nCand] = tau;
        _pyinCandV[nCand] = cmnd[tau];
        nCand++;
      }
    }
  }
  if (nCand === 0) return null;

  // Probability mass per candidate (in τ-ascending order, which the scan
  // already produces). runMin tracks min-of-previous; only "new lows"
  // accumulate any mass.
  let runMin = 1.0;
  let bestProb = 0;
  let bestIdx = -1;
  for (let k = 0; k < nCand; k++) {
    const v = _pyinCandV[k];
    if (v < runMin) {
      const prob = _betaCdfLookup(runMin) - _betaCdfLookup(v);
      _pyinCandProb[k] = prob;
      if (prob > bestProb) {
        bestProb = prob;
        bestIdx = k;
      }
      runMin = v;
    } else {
      _pyinCandProb[k] = 0;
    }
  }
  if (bestIdx < 0) return null;
  const bestTau = _pyinCandTau[bestIdx];

  // Parabolic interpolation — identical to the legacy path so refinement
  // accuracy on pure tones / clean harmonics is unchanged.
  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < searchLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  let refinedTau = denom !== 0 ? bestTau + (s0 - s2) / denom : bestTau;
  const minTauVal = sr / 600;
  const maxTauVal = sr / 75;
  refinedTau = Math.max(minTauVal, Math.min(maxTauVal, refinedTau));
  return sr / refinedTau;
}

// pYIN Stage 2 (option B): voicing-duplicated HMM + bounded-history Viterbi.
// Returns the decoded pitch L frames behind real-time, or null when the
// L-frames-back state is on the unvoiced half of the state space (or during
// warm-up).
//
// Module-level state (`_pyinFrameIdx`, `_PYIN_LOG_ALPHA`, `_PYIN_BACKPTRS`)
// accumulates across calls. Harness invokes {type: "reset-pitch-hmm"} between
// independent recordings; production runs continuously without resets.
function _detectPitchPyinStage2(cmnd, searchLen, minLag, maxLag, sr) {
  // --- Stage 1 candidate generation (reused verbatim) ---
  const upper = maxLag < searchLen - 1 ? maxLag : searchLen - 1;
  let nCand = 0;
  for (let tau = minLag + 1; tau < upper; tau++) {
    if (cmnd[tau] < cmnd[tau - 1] && cmnd[tau] <= cmnd[tau + 1]) {
      if (nCand < _PYIN_MAX_CANDIDATES) {
        _pyinCandTau[nCand] = tau;
        _pyinCandV[nCand] = cmnd[tau];
        nCand++;
      }
    }
  }

  // --- Build observation likelihoods (librosa-pyin observation model) ---
  // 1. Compute per-pitch candidate mass `pitch_obs[s]` (sums to voicedness).
  // 2. Normalize: `pitch_obs_n[s] = pitch_obs[s] / voicedness` (sums to 1
  //    when voicedness > 0).
  // 3. Distribute across voicing twins:
  //      obs[V(s)]  = voicedness        · pitch_obs_n[s]
  //      obs[UV(s)] = (1 − voicedness)  · pitch_obs_n[s]
  // The voiced and unvoiced twins share the SAME pitch shape — the
  // voicedness factor only changes the voicing weight. This is the
  // mechanism by which pitch context propagates through marginal-CMND
  // frames: the unvoiced twin at the candidate's pitch carries most of the
  // mass when voicedness is low, and the HMM later transitions back to
  // voiced once voicedness recovers.
  const NP = _PYIN_N_PITCH;
  const N = _PYIN_N_STATES;
  for (let s = 0; s < NP; s++) _PYIN_OBS_LOG[s] = 0; // pitch_obs scratch
  let voicedness = 0;
  if (nCand > 0) {
    let runMin = 1.0;
    for (let k = 0; k < nCand; k++) {
      const v = _pyinCandV[k];
      if (v < runMin) {
        const prob = _betaCdfLookup(runMin) - _betaCdfLookup(v);
        if (prob > 0) {
          const tau = _pyinCandTau[k];
          const pitchHz = sr / tau;
          if (pitchHz >= 75 && pitchHz <= 600) {
            const sFloat = 100 * Math.log2(pitchHz / 75);
            let s = (sFloat + 0.5) | 0;
            if (s < 0) s = 0;
            else if (s >= NP) s = NP - 1;
            _PYIN_OBS_LOG[s] += prob;
            voicedness += prob;
          }
        }
        runMin = v;
      }
    }
  }
  // Capture raw candidate-mass voicedness BEFORE the obs distribution
  // normalization or no-candidate fallback. This is the "did this signal
  // contain pitch evidence at all" signal — distinct from the HMM-smoothed
  // posterior computed below. See the module-level comment block on the
  // two voicedness signals for the architectural distinction.
  _pyinLastVoicednessObs = voicedness;

  if (voicedness > 0) {
    // Normalize pitch_obs to sum to 1, then distribute across twins.
    const inv = 1 / voicedness;
    const oneMinusV = 1 - voicedness;
    for (let s = 0; s < NP; s++) {
      const p = _PYIN_OBS_LOG[s] * inv; // pitch_obs_n[s], sums to 1
      _PYIN_OBS_LOG[s] = voicedness * p;            // obs[V(s)]
      _PYIN_OBS_LOG[_PYIN_UNVOICED_OFFSET + s] = oneMinusV * p; // obs[UV(s)]
    }
  } else {
    // No candidates at all → no pitch information. Uniform across both twins.
    const u = 1 / N;
    for (let s = 0; s < N; s++) _PYIN_OBS_LOG[s] = u;
  }

  // Smooth + log. Adding ε per state avoids log(0) without distorting the
  // distribution shape: total mass is 1, ε per state ≪ typical mass.
  const eps = _PYIN_OBS_FLOOR;
  const denom = 1 + N * eps;
  for (let s = 0; s < N; s++) {
    _PYIN_OBS_LOG[s] = Math.log((_PYIN_OBS_LOG[s] + eps) / denom);
  }

  // --- Read lookback (per call so the harness can sweep) ---
  // Production uses PYIN_LOOKBACK_DEFAULT (=4 → 100 ms latency at the
  // 25 ms hop). Harnesses override per call via globalThis.__PYIN_LOOKBACK.
  let lookback =
    (typeof globalThis !== "undefined" && globalThis.__PYIN_LOOKBACK) | 0;
  if (lookback < 1) lookback = PYIN_LOOKBACK_DEFAULT;
  if (lookback > _PYIN_L_MAX) lookback = _PYIN_L_MAX;

  // --- Viterbi forward step ---
  // Decompose the transition into pitch_trans × voicing_flip. For each
  // to_pitch, find the best voiced-source and unvoiced-source path
  // (sweeping from_pitch); then for each (to_pitch, to_voiced) destination
  // combine those two paths with the four voicing flip log-probs.
  const t = _pyinFrameIdx;
  const curOff = (t & 1) * N;
  if (t === 0) {
    const logUnif = -Math.log(N);
    for (let s = 0; s < N; s++) {
      _PYIN_LOG_ALPHA[curOff + s] = logUnif + _PYIN_OBS_LOG[s];
    }
  } else {
    const prevOff = ((t - 1) & 1) * N;
    const bpOff = (t % _PYIN_L_MAX) * N;

    // Step 1: per to_pitch, find best from_pitch separately for voiced
    // and unvoiced sources. Inner loop is sequential in memory.
    for (let toPitch = 0; toPitch < NP; toPitch++) {
      const transRow = toPitch * NP;
      let bestV = -Infinity, bestVArg = 0;
      let bestU = -Infinity, bestUArg = 0;
      for (let fromPitch = 0; fromPitch < NP; fromPitch++) {
        const tp = _PYIN_LOG_PITCH_TRANS[transRow + fromPitch];
        const aV = _PYIN_LOG_ALPHA[prevOff + fromPitch] + tp;
        if (aV > bestV) { bestV = aV; bestVArg = fromPitch; }
        const aU = _PYIN_LOG_ALPHA[prevOff + _PYIN_UNVOICED_OFFSET + fromPitch] + tp;
        if (aU > bestU) { bestU = aU; bestUArg = _PYIN_UNVOICED_OFFSET + fromPitch; }
      }
      _PYIN_BEST_VOICED_PATH[toPitch] = bestV;
      _PYIN_BEST_VOICED_ARG[toPitch] = bestVArg;
      _PYIN_BEST_UNVOICED_PATH[toPitch] = bestU;
      _PYIN_BEST_UNVOICED_ARG[toPitch] = bestUArg;
    }

    // Step 2: combine with voicing-flip factor for each (to_pitch, to_voiced).
    for (let toPitch = 0; toPitch < NP; toPitch++) {
      const bestV = _PYIN_BEST_VOICED_PATH[toPitch];
      const bestU = _PYIN_BEST_UNVOICED_PATH[toPitch];
      const bestVArg = _PYIN_BEST_VOICED_ARG[toPitch];
      const bestUArg = _PYIN_BEST_UNVOICED_ARG[toPitch];

      // Destination voiced (twin index = toPitch).
      const candVV = bestV + _PYIN_LOG_VOICING_VV;
      const candUV = bestU + _PYIN_LOG_VOICING_UV;
      let chosen, chosenArg;
      if (candVV > candUV) { chosen = candVV; chosenArg = bestVArg; }
      else { chosen = candUV; chosenArg = bestUArg; }
      _PYIN_LOG_ALPHA[curOff + toPitch] = chosen + _PYIN_OBS_LOG[toPitch];
      _PYIN_BACKPTRS[bpOff + toPitch] = chosenArg;

      // Destination unvoiced (twin index = toPitch + 300).
      const candVU = bestV + _PYIN_LOG_VOICING_VU;
      const candUU = bestU + _PYIN_LOG_VOICING_UU;
      const toUIdx = _PYIN_UNVOICED_OFFSET + toPitch;
      if (candVU > candUU) { chosen = candVU; chosenArg = bestVArg; }
      else { chosen = candUU; chosenArg = bestUArg; }
      _PYIN_LOG_ALPHA[curOff + toUIdx] = chosen + _PYIN_OBS_LOG[toUIdx];
      _PYIN_BACKPTRS[bpOff + toUIdx] = chosenArg;
    }
  }
  _pyinFrameIdx = t + 1;

  // --- HMM-smoothed voicing posterior at the current frame ---
  // P(voiced | obs_{1..t}) = sum_{voiced s} α[s] / sum_{all s} α[s].
  // Computed via log-sum-exp with the joint max as the shift to keep both
  // halves on the same numerical scale.
  {
    let maxV = -Infinity, maxU = -Infinity;
    for (let s = 0; s < NP; s++) {
      const aV = _PYIN_LOG_ALPHA[curOff + s];
      if (aV > maxV) maxV = aV;
      const aU = _PYIN_LOG_ALPHA[curOff + _PYIN_UNVOICED_OFFSET + s];
      if (aU > maxU) maxU = aU;
    }
    const maxBoth = maxV > maxU ? maxV : maxU;
    let sumV = 0, sumU = 0;
    for (let s = 0; s < NP; s++) {
      sumV += Math.exp(_PYIN_LOG_ALPHA[curOff + s] - maxBoth);
      sumU += Math.exp(_PYIN_LOG_ALPHA[curOff + _PYIN_UNVOICED_OFFSET + s] - maxBoth);
    }
    _pyinLastVoicedness = sumV / (sumV + sumU);
  }

  // --- Warm-up: need lookback complete frames before tracing back ---
  if (t < lookback) return null;

  // --- Trace back L steps from current argmax ---
  let curBest = 0;
  let curBestVal = _PYIN_LOG_ALPHA[curOff];
  for (let s = 1; s < N; s++) {
    const v = _PYIN_LOG_ALPHA[curOff + s];
    if (v > curBestVal) { curBestVal = v; curBest = s; }
  }
  let st = curBest;
  for (let i = 0; i < lookback; i++) {
    const bpSlot = (t - i) % _PYIN_L_MAX;
    st = _PYIN_BACKPTRS[bpSlot * N + st];
  }
  // Return pitch from whichever twin the HMM decoded — voicing is advisory,
  // not gating. Matches librosa.pyin's behavior: f0 is reported from the
  // pitch-state index regardless of voicing; the separate voicedness signal
  // (exposed on the postMessage payload) tells consumers what the HMM
  // thought about voicing. Gating-by-voicing happens upstream in
  // useAudioPipeline.js and the smoother (silence hold + median).
  const pitchIdx = st >= _PYIN_UNVOICED_OFFSET ? st - _PYIN_UNVOICED_OFFSET : st;
  return 75 * Math.pow(2, pitchIdx / 100);
}

// --- Formant Extraction (Burg LPC) ---
// Accepts optional detectedPitch to adapt LPC order and formant ceiling.
// Praat's "To Formant (burg)" uses maxFormant=5500 for female, 5000 for male,
// and nFormant=5 (LPC order = 2*nFormant = 10 for male, or +2 for female at
// higher effective SR).  We follow the same approach.

function extractFormants(buffer, detectedPitch) {
  const n = buffer.length;

  // Adapt parameters based on pitch (Praat-style gender detection).
  // Praat's "To Formant (burg)" uses:
  //   Male:   maxFormant=5000, nFormant=5 → LPC order=10, effective SR=10000
  //   Female: maxFormant=5500, nFormant=5 → LPC order=10, effective SR=11000
  // We follow the same principle: choose decimation + LPC order so that
  // the effective analysis bandwidth matches the expected formant range.
  let lpcOrder, maxFormant, effectiveDecFactor, effectiveTargetSR, effectiveFilter;

  const isFemale = detectedPitch === null || detectedPitch >= 160;
  const isMale = detectedPitch !== null && detectedPitch < 140;

  if (isMale) {
    // Male: formant ceiling ~5000 Hz, targetSR ~10 kHz
    maxFormant = 5000;
    effectiveDecFactor = decimationFactor;
    effectiveTargetSR = targetSR;
    effectiveFilter = antiAliasFilter;
    lpcOrder = LPC_ORDER_MALE;
  } else {
    // Female (or unknown): formant ceiling ~5500 Hz, targetSR ~11 kHz
    // If the default decimation gives targetSR < 11000, reduce the factor.
    maxFormant = 5500;
    const minTargetSR = 11000;
    effectiveDecFactor = decimationFactor;
    effectiveTargetSR = targetSR;
    effectiveFilter = antiAliasFilter;
    while (effectiveDecFactor > 1 && sampleRate / effectiveDecFactor < minTargetSR) {
      effectiveDecFactor--;
    }
    if (effectiveDecFactor !== decimationFactor) {
      effectiveTargetSR = sampleRate / effectiveDecFactor;
      effectiveFilter = designLowPassFIR(0.45 / effectiveDecFactor, effectiveDecFactor * 16 + 1);
    }
    // At 16 kHz with factor=1, targetSR=16000 → need higher LPC order to model
    // the wider bandwidth (up to 8 kHz). Praat uses nFormant=5 at 11 kHz,
    // so at 16 kHz we need proportionally more: ceil(5 * 16000/11000) * 2 = 16.
    // But we cap at a reasonable value to avoid over-fitting.
    lpcOrder = Math.min(16, Math.max(LPC_ORDER_FEMALE, Math.ceil(5 * effectiveTargetSR / 11000) * 2));
  }

  // Pre-emphasis into pre-allocated buffer
  _preEmph[0] = buffer[0];
  for (let i = 1; i < n; i++) {
    _preEmph[i] = buffer[i] - 0.97 * buffer[i - 1];
  }

  // Hamming window into pre-allocated buffer
  for (let i = 0; i < n; i++) {
    _windowed[i] = _preEmph[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  // Downsample with anti-alias FIR filter (writes into _decimated)
  const decLen = decimateWithFilter(_windowed, effectiveDecFactor, effectiveFilter);

  // Burg LPC (uses pre-allocated buffers internally)
  const coefficients = burgLPC(_decimated.subarray(0, decLen), lpcOrder);

  // Find polynomial roots (uses pre-allocated flat arrays)
  const rootCount = findPolynomialRoots(coefficients, lpcOrder);

  // Convert roots to formant frequencies + bandwidths
  // Use a small fixed-size scratch array to avoid allocations
  let fCount = 0;
  const fFreqs = _formantFreqs;
  const fBws = _formantBws;
  for (let i = 0; i < rootCount; i++) {
    if (_rootsIm[i] <= 0) continue;

    const freq = (Math.atan2(_rootsIm[i], _rootsRe[i]) * effectiveTargetSR) / (2 * Math.PI);
    const mag = Math.sqrt(_rootsRe[i] * _rootsRe[i] + _rootsIm[i] * _rootsIm[i]);
    const bw = mag > 0 ? (-Math.log(mag) * effectiveTargetSR) / Math.PI : Infinity;

    if (freq > 90 && freq < maxFormant && bw > 0 && bw < 600) {
      fFreqs[fCount] = freq;
      fBws[fCount] = bw;
      fCount++;
    }
  }

  // Sort by frequency (insertion sort — at most ~6 elements)
  for (let i = 1; i < fCount; i++) {
    const kf = fFreqs[i], kb = fBws[i];
    let j = i - 1;
    while (j >= 0 && fFreqs[j] > kf) {
      fFreqs[j + 1] = fFreqs[j];
      fBws[j + 1] = fBws[j];
      j--;
    }
    fFreqs[j + 1] = kf;
    fBws[j + 1] = kb;
  }

  return {
    f1: fCount > 0 ? fFreqs[0] : null,
    f2: fCount > 1 ? fFreqs[1] : null,
    f3: fCount > 2 ? fFreqs[2] : null,
  };
}

// Design a Blackman-windowed sinc low-pass FIR filter.
// cutoffNormalized: cutoff as fraction of sample rate (0.5 = Nyquist)
// numTaps: filter length (odd for symmetric, linear-phase)
function designLowPassFIR(cutoffNormalized, numTaps) {
  const coeffs = new Float64Array(numTaps);
  const mid = (numTaps - 1) / 2;
  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    // Windowed sinc: sinc provides ideal low-pass, Blackman window gives
    // ~74 dB stopband attenuation (vs ~13 dB for box-car averaging).
    let sinc;
    if (Math.abs(x) < 1e-10) {
      sinc = 2 * cutoffNormalized;
    } else {
      sinc = Math.sin(2 * Math.PI * cutoffNormalized * x) / (Math.PI * x);
    }
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (numTaps - 1))
                     + 0.08 * Math.cos((4 * Math.PI * i) / (numTaps - 1));
    coeffs[i] = sinc * win;
  }
  // Normalize to unity DC gain
  let sum = 0;
  for (let i = 0; i < numTaps; i++) sum += coeffs[i];
  for (let i = 0; i < numTaps; i++) coeffs[i] /= sum;
  return coeffs;
}

// Initialize default anti-alias filter (matches default decimationFactor = 4)
antiAliasFilter = designLowPassFIR(0.45 / decimationFactor, decimationFactor * 16 + 1);

// Downsample with FIR anti-alias filtering to prevent aliasing artifacts.
// Writes result into pre-allocated _decimated buffer. Returns the decimated length.
function decimateWithFilter(buffer, factor, filterTaps) {
  if (factor <= 1) {
    // Copy into _decimated for consistency
    for (let i = 0; i < buffer.length; i++) _decimated[i] = buffer[i];
    return buffer.length;
  }
  const taps = filterTaps || antiAliasFilter;
  const numTaps = taps.length;
  const halfTaps = numTaps >> 1;
  const bufLen = buffer.length;
  const newLen = Math.floor(bufLen / factor);
  for (let i = 0; i < newLen; i++) {
    let sum = 0;
    const center = i * factor;
    // Compute clamped bounds to avoid per-sample branch
    const jStart = Math.max(0, halfTaps - center);
    const jEnd = Math.min(numTaps, bufLen - center + halfTaps);
    for (let j = jStart; j < jEnd; j++) {
      sum += buffer[center - halfTaps + j] * taps[j];
    }
    _decimated[i] = sum;
  }
  return newLen;
}

// Burg LPC algorithm — uses pre-allocated buffers to avoid per-frame GC.
// Takes a buffer (the pre-allocated _decimated) and its valid length.
// Returns _burgA (the coefficient array) directly.
function burgLPC(samples, order) {
  const n = samples.length;
  const a = _burgA;
  const aNew = _burgANew;
  const ef = _burgEf;
  const eb = _burgEb;
  const efTmp = _burgEfTmp;
  const ebTmp = _burgEbTmp;

  a.fill(0);
  a[0] = 1;

  // Initialize ef and eb from samples
  for (let i = 0; i < n; i++) {
    ef[i] = samples[i];
    eb[i] = samples[i];
  }

  for (let m = 1; m <= order; m++) {
    let num = 0, den = 0;
    for (let i = m; i < n; i++) {
      num += ef[i] * eb[i - 1];
      den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1];
    }
    if (den === 0) break;
    const k = (-2 * num) / den;

    // Update LPC coefficients in-place via aNew scratch
    aNew[0] = 1;
    for (let i = 1; i < m; i++) {
      aNew[i] = a[i] + k * a[m - i];
    }
    aNew[m] = k;
    for (let i = 0; i <= m; i++) a[i] = aNew[i];

    // Update prediction errors into scratch buffers to avoid read-after-write
    // corruption (eb[i] must not be overwritten before eb[i-1] is read next iter)
    for (let i = m; i < n; i++) {
      efTmp[i] = ef[i] + k * eb[i - 1];
      ebTmp[i] = eb[i - 1] + k * ef[i];
    }
    // Swap scratch back
    for (let i = m; i < n; i++) {
      ef[i] = efTmp[i];
      eb[i] = ebTmp[i];
    }
  }

  return a;
}

// Durand-Kerner method for finding all roots of a polynomial.
// Uses pre-allocated flat arrays _rootsRe/_rootsIm. Returns the root count (n).
// coefficients[0..n] where poly = c[0]*z^n + c[1]*z^(n-1) + ... + c[n]
function findPolynomialRoots(coefficients, order) {
  const n = order !== undefined ? order : coefficients.length - 1;
  if (n <= 0) return 0;

  const rRe = _rootsRe;
  const rIm = _rootsIm;

  // Initial guesses on a circle of radius 0.9
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + 0.4;
    rRe[i] = 0.9 * Math.cos(angle);
    rIm[i] = 0.9 * Math.sin(angle);
  }

  for (let iter = 0; iter < 50; iter++) {
    let maxDelta = 0;

    for (let i = 0; i < n; i++) {
      // Evaluate polynomial at root[i] using Horner's method
      let pr = coefficients[0], pi = 0;
      const ri_re = rRe[i], ri_im = rIm[i];
      for (let j = 1; j <= n; j++) {
        const newR = pr * ri_re - pi * ri_im + coefficients[j];
        pi = pr * ri_im + pi * ri_re;
        pr = newR;
      }

      // Product of (root[i] - root[j]) for j != i
      let qr = 1, qi = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dr = ri_re - rRe[j];
        const di = ri_im - rIm[j];
        const newR = qr * dr - qi * di;
        qi = qr * di + qi * dr;
        qr = newR;
      }

      const denom = qr * qr + qi * qi;
      if (denom < 1e-30) continue;
      const deltaR = (pr * qr + pi * qi) / denom;
      const deltaI = (pi * qr - pr * qi) / denom;

      rRe[i] = ri_re - deltaR;
      rIm[i] = ri_im - deltaI;

      const mag = deltaR * deltaR + deltaI * deltaI;
      if (mag > maxDelta) maxDelta = mag;
    }

    // Compare squared magnitude against squared threshold (avoid sqrt)
    if (maxDelta < 1e-20) break;
  }

  return n;
}

// --- Radix-2 Cooley-Tukey FFT (in-place) ---

function fft(re, im) {
  const n = re.length;
  // Radix-2 FFT requires n to be a power of 2. Callers are expected to
  // provide correctly sized buffers, but guard against silent corruption.
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, got ${n}`);
  }
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // FFT butterfly
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

// --- Spectral Tilt: FFT Band Energy Ratio ---

function computeSpectralTilt(buffer, sr) {
  const fftSize = 2048;
  const n = Math.min(buffer.length, fftSize);
  const re = _tiltRe;
  const im = _tiltIm;

  // Zero-fill and apply Hann window
  re.fill(0);
  im.fill(0);
  const offset = buffer.length - n;
  for (let i = 0; i < n; i++) {
    re[i] = buffer[offset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  fft(re, im);

  // Precompute bin boundaries to avoid per-bin multiply
  const binHz = sr / fftSize;
  const lowBinEnd = Math.min(Math.floor(1000 / binHz), fftSize / 2);
  const highBinEnd = Math.min(Math.floor(4000 / binHz), fftSize / 2);
  let lowEnergy = 0, highEnergy = 0;

  for (let k = 1; k < lowBinEnd; k++) {
    lowEnergy += re[k] * re[k] + im[k] * im[k];
  }
  for (let k = lowBinEnd; k < highBinEnd; k++) {
    highEnergy += re[k] * re[k] + im[k] * im[k];
  }

  if (highEnergy === 0) return null;
  return 10 * Math.log10(lowEnergy / highEnergy);
}

// --- HNR: Harmonics-to-Noise Ratio (FFT-based autocorrelation) ---

function computeHNR(buffer, sr) {
  const maxN = 2048;
  const n = Math.min(buffer.length, maxN);
  const offset = buffer.length - n;
  const fftLen = 4096; // Fixed: 2048 samples zero-padded to 4096
  const re = _hnrRe;
  const im = _hnrIm;

  // Zero-fill and load signal
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) re[i] = buffer[offset + i];

  fft(re, im);

  // Power spectrum in-place
  for (let i = 0; i < fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }

  fft(re, im);
  const r0 = re[0] / fftLen;
  if (r0 === 0) return null;

  const minLag = Math.floor(sr / 600);
  const maxLag = Math.min(Math.floor(sr / 75), Math.floor(n / 2));
  let maxVal = 0;

  for (let lag = minLag; lag < maxLag; lag++) {
    const normalized = (re[lag] / fftLen) / r0;
    if (normalized > maxVal) maxVal = normalized;
  }

  if (maxVal <= 0) return null;
  maxVal = Math.min(maxVal, 0.99);
  return 10 * Math.log10(maxVal / (1 - maxVal));
}
