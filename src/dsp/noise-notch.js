// noise-notch.js — Persistent-peak tonal-interferer tracker + streaming
// notch chain for the pitch path (2026-07-19).
//
// Decision data: measurements/noise-robustness-oracle-2026-07-19.md.
// Tonal interference (fan hum, mains harmonics) is the one measured
// pitch catastrophe: at fan-hum +10 dB SNR the tracker locks an octave
// down on 46 % of speech frames and paints 100 % of noise-only audio as
// voice. The oracle-informed notch upper bound recovers to within ~2 pp
// of clean; this module is the shippable version — it must DETECT the
// interferers itself.
//
// Detection principle: an interferer is a narrow spectral peak that is
// FREQUENCY-STABLE for a long time at high duty cycle. Real speech F0
// and harmonics move constantly (real speech wanders several semitones
// around its running level — measured on a private session recording;
// even a held note carries vibrato/drift); a fan or mains hum
// sits within ±2–3 Hz for minutes. We deliberately do NOT use the
// detector's own voicing decisions as the "silence" reference — under
// strong hum the detector calls everything voiced (that's the failure
// being fixed), so bootstrap from stability instead:
//
//   - every OBSERVE_EVERY-th chunk (~100 ms), take a zero-padded FFT of
//     the raw (pre-notch) rolling buffer and find narrow peaks in
//     [BAND_LO, BAND_HI] with >= PROMINENCE x the band's median power
//   - match peaks to tracks within MATCH_HZ; a track PROMOTES to an
//     active notch after MIN_TRACK_SEC with duty >= PROMOTE_DUTY (only
//     on an observation that actually saw it), and DEMOTES after
//     MISS_SEC of absence
//   - ONSET-BORN tracks need ONSET_MIN_TRACK_SEC instead (see "Held
//     notes" below)
//   - at most MAX_NOTCHES active (strongest first); each is a biquad
//     notch (RBJ, Q = NOTCH_Q -> ~4 Hz wide at 120 Hz), state carried
//     across chunks. Sections are keyed by TRACK ID: a surviving track
//     keeps its filter state and is retuned in place when it drifts
//     > RETUNE_HZ. (The original freq.toFixed(0) key rebuilt the whole
//     cascade, resetting every section, whenever any track's EMA crossed
//     a 1 Hz rounding boundary or two tracks swapped power order:
//     measured 43 rebuilds and 117 leak chunks > +10 dB, max +16 dB, on
//     a 120 Hz hum wobbling +-0.6 Hz.)
//
// Held notes (2026-10-03, measurements/noise-notch-voice-safety-
// 2026-10-03.md): a voice-training user holding a steady note (even
// 25 c vibrato is < 2 Hz at 120 Hz) for > MIN_TRACK_SEC used to be
// promoted to a notch, after which the worker's ghost veto blanked the
// note (prod: 49.5 % of held-note frames reported vs 94.0 % with no
// notch; breathy notes go blank once notched even without the veto —
// notching H1 leaves too little periodicity). A held note starts at a
// sound onset, while a hum is normally present before the voice, so a
// track first seen while the 50 Hz-4 kHz band energy is >= ONSET_DB
// above its ONSET_HIST_SEC running minimum is ONSET-BORN and must
// persist ONSET_MIN_TRACK_SEC (20 s) before notching. A weak, young
// (< ONSET_HIST_SEC old) track — typically a noise peak — whose peak
// power jumps >= ONSET_DB at an onset is re-born onset-born, so a note
// cannot "adopt" a noise track's age and not-onset-born status.
// Accepted trades: a note held longer than
// ONSET_MIN_TRACK_SEC is still notched (and its trace may gap until it
// moves), and an interferer that SWITCHES ON mid-session (fan, fridge
// compressor) is notched after ~20 s instead of ~5 s.
//
// Voice vs machine lines (2026-10-05, measurements/noise-notch-voice-
// discrimination-2026-10-05.md): the onset rule above misses held notes
// whose line is NOT born at an onset — a glide / step > MATCH_HZ mid-hold
// (the moved line is new), speech running into a hold with < ~0.3 s gaps,
// phonation in the stream's first observation windows — which were notched
// ~5 s in (bc42ad0: 45-74 % of hold frames). A voice line is told from a
// machine line directly: a voice's partials wander TOGETHER (F0 wander,
// vibrato, tremor move every harmonic by the same cents), a motor / mains /
// electronics line has no mid-band FM shared with its own 2nd partial
// (measurements/notch-voice-machine-discrimination-2026-10-05.md: real
// corpora, AUC 0.997 clean). Per 25 ms chunk each unpromoted line in
// COH_LO_HZ..COH_HI_HZ is read at f and 2f (64 ms Hann DFT bins, phase-
// vocoder instantaneous frequency); 1 s windows of the mid-band (0.5-8 Hz)
// cents series pool over the last COH_POOL windows into pcorr (shared /
// total modulation) and pcoh (shared modulation, cents). With >= 3 windows:
//   - VOICE-confirmed (pcorr >= VOICE_CORR AND pcoh >= VOICE_COH): a line
//     that was not onset-born is timed as onset-born (ONSET_MIN_TRACK_SEC
//     from its first sighting) — unless its level rose >= COH_JUMP_DB over
//     its first sightings (a louder source took over a pre-existing line:
//     a note sung on a hum's track)
//   - the voice timing is revoked when the line later reads MACHINE-
//     confirmed (pcorr < MACHINE_CORR or pcoh < MACHINE_COH, pooled or in
//     its latest window alone): a spin-up transient that settled, a note
//     that ended over a hum
//   - nothing else changes: undecided lines, machine lines and onset-born
//     lines keep bc42ad0's timing.
// The verdict is strict on purpose (0.7 / 2.5 c, not the 0.5 / 2 c of the
// discrimination phase): ~2 % of real machine lines (mains buzz, electronics
// whine, a ballast, a fan, a motor) still read voice-confirmed online, and
// each one present before any onset is notched up to 20 s late instead of
// 5 s.
// Known held-note gaps that remain (bc42ad0's): same-pitch holds separated
// by breaths share one onset-born track that is notched once the series
// passes 20 s (64-85 % of hold frames) — signal-identical to a tonal source
// that cuts out for 0.15-1 s every few seconds, and breath rules that close
// it (round 2's R8, or R8 restricted to voice-confirmed lines) left real
// gated sources painted (measured: 227 / 3-6 of 504 real noise_gated
// streams); holds >= 20 s; a note whose line reads machine-like (synthetic
// zero-wander tones; no real voice measured that steady).
//
// Detection runs on RAW audio, filtering on the OUTPUT stream — a
// notched interferer must stay visible to the tracker or the notch
// set would oscillate.

export const NOTCH_DEFAULTS = {
  bandLoHz: 50,          // search band: covers mains fundamentals up to
  bandHiHz: 460,         //   just past the 400 Hz DISPLAY ceiling. The
                         //   detector searches to 800 since 2026-10-03,
                         //   but decodes above 400 post as unvoiced, so a
                         //   460-800 Hz tonal interferer can no longer
                         //   paint (synthetic 520/640 Hz whines: 100 %
                         //   painted at HALF pitch with the old 400 Hz
                         //   search ceiling, 0 % now). Not widened: a
                         //   wider band would also promote held sung
                         //   notes in that range to notches.
  observeEveryChunks: 4, // ~100 ms at the 25 ms chunk cadence
  obsLen: 8192,          // 512 ms observation window (1.95 Hz resolution
                         //   — long enough to RESOLVE vibrato: a sung
                         //   note with FM smears across bins, a hum
                         //   stays a single-bin razor line)
  fftSize: 16384,        // ~0.98 Hz bins after zero-padding
  prominence: 8,         // peak power >= 8x band median power
  relativeFloorDb: 26,   // reject peaks > this far below the band max
                         //   (Hann window sidelobes sit at -31.5 dB)
  narrowOffHz: 5,        // narrowness probe offset ...
  narrowRatio: 0.15,     // ... power there must be < this x peak
  minSepHz: 10,          // reject peaks this close to a stronger one
  matchHz: 3,            // track association tolerance
  minTrackSec: 5,        // stability duration before notching
  promoteDuty: 0.9,      // fraction of observations present
  missSec: 2,            // absent this long -> demote/drop
  maxNotches: 4,
  notchQ: 30,            // ~4 Hz -3 dB width at 120 Hz
  // onset-born promotion delay (2026-10-03; see "Held notes" above).
  // Sweep: 6/10/15 dB identical on held notes and on all four sessions;
  // 10 s too short for 14 s holds, 15 s blanks 15-20 s holds, 20 s keeps
  // every hold <= 20 s at the no-notch ceiling.
  onsetDb: 10,
  onsetHistSec: 2,
  onsetMinTrackSec: 20,
  retuneHz: 0.5,         // retune a live section in place when its track
                         //   drifted more than this (filter state kept)
  // line coherence (2026-10-05; see "Voice vs machine lines" above)
  cohLoHz: 80,           // lines measured: 80-400 Hz (the display band)
  cohHiHz: 400,
  cohWin: 1024,          // 64 ms Hann DFT at f and 2f per 25 ms chunk
  cohWinChunks: 40,      // 1 s feature window (40 consecutive valid chunks)
  cohGateDb: 10,         // chunk invalid when the line is this far under its running level
  cohPool: 5,            // verdicts pool the last 5 windows ...
  cohMinWin: 3,          // ... and need >= 3
  machineCorr: 0.15,     // machine-confirmed: pcorr < this OR pcoh < machineCoh
  machineCoh: 1,         //   (cents)
  voiceCorr: 0.7,        // voice-confirmed: pcorr >= this AND pcoh >= voiceCoh
  voiceCoh: 2.5,         //   (cents)
  cohJumpDb: 6,          // no voice timing once a line rose this far over its first sightings
};

// In-place iterative radix-2 FFT (same shape as boersma-ac.js's).
function fft(re, im) {
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
    const ang = (-2 * Math.PI) / len;
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
}

class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  // retune in place: new coefficients, filter state (x1..y2) kept
  setCoefficients(o) {
    this.b0 = o.b0; this.b1 = o.b1; this.b2 = o.b2; this.a1 = o.a1; this.a2 = o.a2;
  }
  processInPlace(x) {
    let { x1, x2, y1, y2 } = this;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi;
      x[i] = yi;
    }
    this.x1 = x1; this.x2 = x2; this.y1 = y1; this.y2 = y2;
  }
}

function makeNotch(f0, sampleRate, q) {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return new Biquad(1 / a0, (-2 * Math.cos(w0)) / a0, 1 / a0, (-2 * Math.cos(w0)) / a0, (1 - alpha) / a0);
}

// createNoiseNotch(sampleRate, opts): streaming tracker + filter for
// the pitch worker's 16 kHz chunk stream.
//
//   process(chunk): observe RAW chunk, then return the chunk with any
//     active notches applied IN PLACE (the caller's array is modified
//     and returned). Zero added latency (causal IIR).
//   activeFreqs(): current notched frequencies (Hz, rounded 0.1) —
//     diagnostic surface (relayed to the main thread as notchedFreqs).
//   activeLines(): [{ freq, dev }] per notched interferer — the track's
//     current frequency estimate and its wobble (EMA of |peak - estimate|,
//     Hz); input to isNearNotch (the worker's ghost veto).
export function createNoiseNotch(sampleRate, opts = {}) {
  const cfg = { ...NOTCH_DEFAULTS, ...opts };
  const N = cfg.fftSize;
  const bufferLength = cfg.obsLen;            // dedicated observation buffer
  const raw = new Float32Array(bufferLength); // rolling RAW buffer
  let rawFill = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  const window = new Float64Array(bufferLength);
  for (let i = 0; i < bufferLength; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (bufferLength - 1));
  }
  const binHz = sampleRate / N;
  const loBin = Math.max(2, Math.floor(cfg.bandLoHz / binHz));
  const hiBin = Math.min(N / 2 - 2, Math.ceil(cfg.bandHiHz / binHz));

  // observation cadence: seconds per observation, derived at runtime
  // from chunk length (chunks are ~25 ms in production; tests may vary)
  let chunkCounter = 0;
  let obsPerSec = null;

  // tracks: { id, freq, dev, power, hits, firstObs, lastSeenObs, active, onsetBorn,
  //           voiceBorn, jumped, pow0, p3, coh }
  let tracks = [];
  let obsIndex = 0;
  let nextTrackId = 1;
  const energyHist = [];   // band energy of recent observations (onset rule)

  let cascade = [];        // [{ id, freq, biquad }], ascending track id

  // ---- line coherence: voice vs machine lines (2026-10-05) --------------
  // Per chunk and per unpromoted track in [cohLoHz, cohHiHz]: the Hann-
  // windowed (cohWin samples) DFT coefficient at the track frequency f and
  // at 2f on the window ending at the chunk boundary and on the one ending
  // a chunk earlier; the phase advance is the instantaneous frequency of the
  // line and of its 2nd partial. A chunk is valid while the latest (or the
  // previous) observation saw the line and the line's 64 ms level is within
  // cohGateDb of its running level (a breath / cut-out the 512 ms observation
  // still covers carries no line); >= cohGateDb down for 0.5 s while still
  // seen means a weaker source now holds the line (a note ended over a hum):
  // the level and the windows restart. Over cohWinChunks consecutive valid
  // chunks the mid-band (5-point moving average, linear trend removed) cents
  // series m1 / m2 give one window's s12 = mean(m1 m2), s11 = mean(m1^2),
  // s22 = mean(m2^2); the last cohPool windows pool to pcorr = S12 /
  // sqrt(S11 S22) and pcoh = sign(S12) sqrt(|S12| / n) (cents). The
  // estimator of scripts/notch-adversarial/realdata/linefeat.py (+ the gate).
  // Cost: 4 x cohWin complex MACs per measured line per chunk.
  let cohHann = null;
  function cohDft(off, n, f) {
    const w = 2 * Math.PI * f / sampleRate, cr = Math.cos(w), ci = -Math.sin(w);
    let pr = 1, pi = 0, sr = 0, si = 0;
    for (let i = 0; i < n; i++) {
      const v = raw[off + i] * cohHann[i];
      sr += v * pr; si += v * pi;
      const nr = pr * cr - pi * ci; pi = pr * ci + pi * cr; pr = nr;
    }
    return [sr, si];
  }
  // [instantaneous frequency at f over the last k samples, line power]
  function cohIF(f, k) {
    const n = cfg.cohWin, a = cohDft(bufferLength - n, n, f), b = cohDft(bufferLength - n - k, n, f);
    // X_cur conj(X_prev) in absolute-time phase: the extra e^{-2 pi i f k / sr}
    let re_ = a[0] * b[0] + a[1] * b[1], im_ = a[1] * b[0] - a[0] * b[1];
    const w = -2 * Math.PI * f * k / sampleRate, c = Math.cos(w), s = Math.sin(w);
    const r2 = re_ * c - im_ * s; im_ = re_ * s + im_ * c; re_ = r2;
    return [f + Math.atan2(im_, re_) / (2 * Math.PI * k / sampleRate), a[0] * a[0] + a[1] * a[1]];
  }
  function midSeries(c) {
    const L = c.length - 4, s = new Float64Array(L);
    for (let i = 0; i < L; i++) s[i] = (c[i] + c[i + 1] + c[i + 2] + c[i + 3] + c[i + 4]) / 5;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < L; i++) { sx += i; sy += s[i]; sxx += i * i; sxy += i * s[i]; }
    const den = L * sxx - sx * sx, sl = den ? (L * sxy - sx * sy) / den : 0, ic = (sy - sl * sx) / L;
    for (let i = 0; i < L; i++) s[i] -= sl * i + ic;
    return s;
  }
  function cohStep(k) {
    if (rawFill < bufferLength || k <= 0) return;
    if (!cohHann) {
      cohHann = new Float64Array(cfg.cohWin);
      for (let i = 0; i < cfg.cohWin; i++) cohHann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (cfg.cohWin - 1));
    }
    for (const t of tracks) {
      if (t.active || t.freq < cfg.cohLoHz || t.freq > cfg.cohHiHz) continue;
      if (!t.coh) t.coh = { c1: [], c2: [], wins: [], lv: undefined, low: 0 };
      const C = t.coh;
      if (obsIndex - t.lastSeenObs > 1) { C.c1.length = 0; C.c2.length = 0; continue; }
      const [f1, p1] = cohIF(t.freq, k), [f2] = cohIF(2 * t.freq, k);
      const lv = 10 * Math.log10(p1 + 1e-30);
      if (C.lv !== undefined && lv < C.lv - cfg.cohGateDb) {
        C.c1.length = 0; C.c2.length = 0;
        if (++C.low >= 20) { C.lv = lv; C.wins.length = 0; C.low = 0; }
        continue;
      }
      C.low = 0;
      C.lv = C.lv === undefined ? lv : 0.95 * C.lv + 0.05 * lv;
      C.c1.push(1200 * Math.log2(Math.max(f1, 1e-3)));
      C.c2.push(1200 * Math.log2(Math.max(f2, 1e-3)));
      if (C.c1.length < cfg.cohWinChunks) continue;
      const m1 = midSeries(C.c1), m2 = midSeries(C.c2);
      let s12 = 0, s11 = 0, s22 = 0;
      for (let i = 0; i < m1.length; i++) { s12 += m1[i] * m2[i]; s11 += m1[i] * m1[i]; s22 += m2[i] * m2[i]; }
      C.wins.push([s12 / m1.length, s11 / m1.length, s22 / m1.length]);
      if (C.wins.length > cfg.cohPool) C.wins.shift();
      C.c1.length = 0; C.c2.length = 0;
    }
  }
  const isMachine = (s12, s11, s22, n) => s12 / Math.max(1e-12, Math.sqrt(s11 * s22)) < cfg.machineCorr
    || Math.sign(s12) * Math.sqrt(Math.abs(s12) / n) < cfg.machineCoh;
  // "machine" | "voice" | null (undecided, or < cohMinWin windows)
  function cohClass(t) {
    const C = t.coh;
    if (!C || C.wins.length < cfg.cohMinWin) return null;
    let S12 = 0, S11 = 0, S22 = 0;
    for (const [a, b, c] of C.wins) { S12 += a; S11 += b; S22 += c; }
    if (isMachine(S12, S11, S22, C.wins.length)) return "machine";
    const pcorr = S12 / Math.max(1e-12, Math.sqrt(S11 * S22)), pcoh = Math.sign(S12) * Math.sqrt(Math.abs(S12) / C.wins.length);
    return pcorr >= cfg.voiceCorr && pcoh >= cfg.voiceCoh ? "voice" : null;
  }
  // the latest single window alone reads machine
  function lastMachine(t) {
    const w = t.coh?.wins;
    if (!w || !w.length) return false;
    const [a, b, c] = w[w.length - 1];
    return isMachine(a, b, c, 1);
  }

  function observe() {
    obsIndex++;
    // windowed, zero-padded power spectrum of the raw buffer
    re.fill(0); im.fill(0);
    for (let i = 0; i < bufferLength; i++) re[i] = raw[i] * window[i];
    fft(re, im);
    // onset detector: broadband (bandLo..4 kHz) energy vs its running min
    let bandEnergy = 0;
    const onsetHiBin = Math.floor(4000 / binHz);
    for (let b = loBin; b < onsetHiBin; b++) bandEnergy += re[b] * re[b] + im[b] * im[b];
    energyHist.push(bandEnergy);
    if (energyHist.length > Math.ceil(cfg.onsetHistSec * (obsPerSec ?? 10))) energyHist.shift();
    let minEnergy = Infinity;
    for (const e of energyHist) if (e < minEnergy) minEnergy = e;
    const onsetRatio = Math.pow(10, cfg.onsetDb / 10);
    const onsetHistObs = Math.ceil(cfg.onsetHistSec * (obsPerSec ?? 10));
    const onsetNow = energyHist.length > 1 && bandEnergy >= minEnergy * onsetRatio;
    const power = new Float64Array(hiBin - loBin + 1);
    for (let b = loBin; b <= hiBin; b++) {
      power[b - loBin] = re[b] * re[b] + im[b] * im[b];
    }
    const sorted = [...power].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1e-12;
    const bandMax = sorted[sorted.length - 1] || 1e-12;
    const relFloor = bandMax * Math.pow(10, -cfg.relativeFloorDb / 10);
    const narrowOffBins = Math.max(2, Math.round(cfg.narrowOffHz / binHz));

    // candidate maxima: prominent vs the band median, above the relative
    // floor (rejects window sidelobes), and NARROW (a hum is a razor
    // line at 512 ms resolution; vibrato / moving F0 smears wide)
    const rawPeaks = [];
    for (let k = narrowOffBins; k < power.length - narrowOffBins; k++) {
      const p = power[k];
      if (p <= power[k - 1] || p < power[k + 1]) continue;
      if (p < cfg.prominence * median || p < relFloor) continue;
      if (power[k - narrowOffBins] > cfg.narrowRatio * p) continue;
      if (power[k + narrowOffBins] > cfg.narrowRatio * p) continue;
      const a = power[k - 1], b = p, c = power[k + 1];
      const denom = a - 2 * b + c;
      const dt = denom !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom)) : 0;
      rawPeaks.push({ freq: (loBin + k + dt) * binHz, power: p });
    }
    rawPeaks.sort((x, y) => y.power - x.power);
    // min-separation: drop peaks close to a stronger accepted one
    const peaks = [];
    for (const pk of rawPeaks) {
      if (peaks.every((q) => Math.abs(q.freq - pk.freq) >= cfg.minSepHz)) peaks.push(pk);
    }

    // associate with tracks
    for (const t of tracks) t._seen = false;
    for (const pk of peaks.slice(0, 12)) {
      let best = null, bestD = cfg.matchHz;
      for (const t of tracks) {
        const d = Math.abs(t.freq - pk.freq);
        if (d < bestD && !t._seen) { best = t; bestD = d; }
      }
      if (best && onsetNow && !best.active && pk.power >= best.power * onsetRatio
          && obsIndex - best.firstObs < onsetHistObs) {
        // a weak, YOUNG track (a noise peak born < onsetHistSec ago) adopted
        // by a sound starting now: restart it as a new onset-born track.
        // (Older tracks keep their history: re-birthing a long-lived weak
        // hum line resets its diluted duty and notched a real room hum
        // that production never promoted — measured on a private session
        // recording.)
        best.firstObs = obsIndex; best.hits = 0; best.onsetBorn = true;
        best.coh = undefined; best.voiceBorn = false; best.pow0 = undefined; best.p3 = undefined; best.jumped = false;
        best.freq = pk.freq; best.dev = 0;
      }
      if (best) {
        best.dev = 0.9 * best.dev + 0.1 * Math.abs(pk.freq - best.freq); // wobble estimate
        best.freq = 0.9 * best.freq + 0.1 * pk.freq; // slow EMA — stability IS the criterion
        best.power = pk.power;
        // a louder source taking over a pre-existing line (>= cohJumpDb over
        // the median of its first 3 sightings): no voice timing for it
        if (best.pow0 === undefined) { (best.p3 ??= []).push(pk.power); if (best.p3.length === 3) best.pow0 = [...best.p3].sort((a, b) => a - b)[1]; }
        else if (pk.power >= best.pow0 * Math.pow(10, cfg.cohJumpDb / 10)) best.jumped = true;
        best.hits++;
        best.lastSeenObs = obsIndex;
        best._seen = true;
      } else {
        tracks.push({ id: nextTrackId++, freq: pk.freq, dev: 0, power: pk.power, hits: 1, firstObs: obsIndex, lastSeenObs: obsIndex, active: false, _seen: true, onsetBorn: onsetNow });
      }
    }

    // promote / demote / prune
    const missObs = Math.ceil(cfg.missSec * (obsPerSec ?? 10));
    const minObs = Math.ceil(cfg.minTrackSec * (obsPerSec ?? 10));
    const onsetMinObs = Math.ceil(cfg.onsetMinTrackSec * (obsPerSec ?? 10));
    tracks = tracks.filter((t) => obsIndex - t.lastSeenObs <= missObs || t.active);
    for (const t of tracks) {
      const span = obsIndex - t.firstObs + 1;
      const duty = t.hits / span;
      // voice timing (see "Voice vs machine lines"): a voice-confirmed line
      // that was not onset-born is timed as onset-born; revoked when it
      // reads machine (pooled, or its latest window alone)
      if (!t.active) {
        const cls = cohClass(t);
        if (cls === "voice" && !t.onsetBorn && !t.jumped) { t.onsetBorn = true; t.voiceBorn = true; }
        if (t.voiceBorn && (cls === "machine" || lastMachine(t))) { t.onsetBorn = false; t.voiceBorn = false; }
      }
      // promote only on an observation that actually saw the peak (a note
      // that just ended must not promote on its trailing duty)
      if (!t.active && t._seen && span >= (t.onsetBorn ? onsetMinObs : minObs) && duty >= cfg.promoteDuty) t.active = true;
      if (t.active && obsIndex - t.lastSeenObs > missObs) { t.active = false; t.hits = 0; t.firstObs = obsIndex; }
    }

    // update the cascade: the strongest maxNotches active tracks, one
    // section per track id. Surviving sections keep their filter state (no
    // rebuild transient); a section is retuned in place only when its track
    // drifted > retuneHz; only entering tracks get fresh sections.
    const actives = tracks.filter((t) => t.active)
      .sort((a, b) => b.power - a.power)
      .slice(0, cfg.maxNotches)
      .sort((a, b) => a.id - b.id);
    const byId = new Map(cascade.map((c) => [c.id, c]));
    cascade = actives.map((t) => {
      const c = byId.get(t.id);
      if (!c) return { id: t.id, freq: t.freq, biquad: makeNotch(t.freq, sampleRate, cfg.notchQ) };
      if (Math.abs(c.freq - t.freq) > cfg.retuneHz) {
        c.biquad.setCoefficients(makeNotch(t.freq, sampleRate, cfg.notchQ));
        c.freq = t.freq;
      }
      return c;
    });
  }

  function process(chunk) {
    // maintain raw rolling buffer (pre-notch — see header)
    const k = chunk.length;
    if (k >= bufferLength) {
      raw.set(chunk.subarray(k - bufferLength));
      rawFill = bufferLength;
    } else {
      raw.copyWithin(0, k, bufferLength);
      raw.set(chunk, bufferLength - k);
      rawFill = Math.min(bufferLength, rawFill + k);
    }
    if (obsPerSec == null && k > 0) obsPerSec = sampleRate / (k * cfg.observeEveryChunks);
    chunkCounter++;
    if (rawFill >= bufferLength && chunkCounter % cfg.observeEveryChunks === 0) observe();
    if (obsIndex > 0) cohStep(Math.min(k, bufferLength - cfg.cohWin));

    for (const n of cascade) n.biquad.processInPlace(chunk);
    return chunk;
  }

  return {
    process,
    activeFreqs: () => cascade.map((n) => Math.round(n.freq * 10) / 10),
    activeLines: () => cascade.map((n) => {
      const t = tracks.find((x) => x.id === n.id);
      return t ? { freq: t.freq, dev: t.dev } : { freq: n.freq, dev: 0 };
    }),
    config: cfg,
  };
}

// isNearNotch(freqHz, lines, opts): ghost-voicing veto test. lines =
// notch.activeLines() ([{ freq, dev }]; bare numbers are accepted as
// { freq, dev: 0 }). True when freqHz is within r * tolHz of r * freq
// for r in `rels`, with tolHz = max(tolFrac * freq, wobbleK * dev).
//
// Why a veto at all: a notch rarely removes a real interferer completely
// — in continuous speech often only its strongest line is promoted, and a
// slowly-wobbling line slips partly outside the Q = 30 notch — so the
// residual (its other harmonics, plus rumble) is still periodic at the
// interferer frequency and decodes as sustained "voice" in every pause
// that the harmonic guard accepts (it IS harmonic). Measured without any
// veto: 78 % of speech pauses painted after a fan switches on mid-
// session, 56 % false voicing on a +-1.5 Hz wobbling fan, 61 % on a
// wobbling rich hum (measurements/noise-notch-voice-safety-2026-10-03.md).
//
// Why narrow (2026-10-03; was +-4 % around f/2, f and 2f of the
// rounded section frequency): that blanked REAL voice in three 8 %-wide
// bands per notch — a 120 Hz hum covered both of a voice-training user's
// registers — costing 16-21 pp of speech accuracy in fan-hum / mains
// noise (FDA fan-hum +10 dB: 69.3 % correct vs 85.5 % with no veto).
// The decoded ghost sits within ~+-2 % of the line (the notch's phase
// response and LF rumble perturb its period), or at the line's octave
// (mains-style stacks with unpromoted even harmonics). wobbleK * dev
// widens the window only for lines whose frequency is measurably moving.
export function isNearNotch(freqHz, lines, { tolFrac = 0.02, wobbleK = 6, rels = [1, 2] } = {}) {
  for (const ln of lines) {
    const f = typeof ln === "number" ? ln : ln.freq;
    const dev = typeof ln === "number" ? 0 : ln.dev;
    const tolHz = Math.max(tolFrac * f, wobbleK * dev);
    for (const r of rels) {
      if (Math.abs(freqHz - r * f) <= r * tolHz) return true;
    }
  }
  return false;
}
