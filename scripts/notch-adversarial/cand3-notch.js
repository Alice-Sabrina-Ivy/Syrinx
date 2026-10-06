// cand3-notch.js — notch voice-vs-machine CANDIDATE phase (2026-10-05):
// r8-notch.js (bc42ad0 + quiet-window breath re-births) plus a per-track
// LINE COHERENCE classifier (shared mid-band FM of the line and its own 2nd
// partial; measurements/notch-voice-machine-discrimination-2026-10-05.md),
// with option flags read from globalThis.__NOTCH_OPTS (variants.mjs V*):
//   rebirth (default true)  false = no breath re-births (= bc42ad0's module)
//   coh     (default null)  { voice: "none"|"onset"|"block", machine: bool,
//            rebirthGate: "any"|"voice"|"notMachine", voiceRevoke: bool,
//            reanchor: bool, jumpGuard: bool,
//            minWin 3, poolWin 5, mCorr 0.15, mCoh 1, vCorr 0.5, vCoh 2,
//            fLo 80, fHi 400, win 1024, wch 40,
//            jumpMode "first3" | "plateau" (2026-10-05 follow-up: the
//              takeover test — >= jumpDb over a level that held within
//              jumpStableDb for jumpRefObs sightings ending jumpRiseObs
//              observations earlier — instead of >= jumpDb over the
//              median of the first 3 sightings), jumpRefObs 3,
//              jumpStableDb 3, jumpRiseObs 6,
//            jumpPeakTolDb 0 (V18: 3 — the steady reference must be the line's
//              loudest so far, within this; 0 = off),
//            grantLastCorr 0 (V17, rejected: voice timing only while the
//              latest single window's correlation is >= this; 0 = off),
//            (2026-10-06 fix round, V19*:)
//            jumpPreVoice false (the takeover test fires only when the line's
//              coherence windows completed before its steady reference ended
//              do NOT pool to a voice verdict, or there are none: a voice
//              that gets louder — a vowel change, a crescendo — read as a
//              voice before the jump; a hum taken over by a note did not),
//            jumpPreFirst false (V19f: those windows must have ended by the
//              reference's FIRST sighting, not its last: a note's onset can
//              sit in a window that ends inside the steady stretch),
//            bandMarginHz 0 (lines are measured from fLo - this to fHi + this),
//            clearOob false (a line outside the band drops its running cents
//              series: a window never splices non-adjacent chunks),
//            lapseCorr 0, lapseCoh 0 (voice timing is also revoked when the
//              line's pooled windows, >= 1, fall under these: the evidence
//              that granted it has lapsed; 0 = off),
//            capSec 0, capFirstObs 1 (a voice-timed line first seen in the
//              stream's first capFirstObs observations is timed capSec s
//              instead of onsetMinTrackSec; 0 = off) }
// With rebirth true and coh null it is r8-notch.js message for message.
// r8-notch.js — the round-2 candidate (`R8`, 2026-10-04) as a clean,
// flag-free drop-in for src/dsp/noise-notch.js: bc42ad0's module plus the
// quiet-window breath re-birth. NOT shipped — it fails the round-2 strict
// rule on exactly one class: a tonal source that itself cuts out for
// 0.15-1 s every 5 / 8 s is never notched (bc42ad0: ~20 s; noise-only pause
// FV ~0 -> 86-98 %), because that signal is identical to repeated steady
// same-pitch holds with breaths. Every other cell of the suite holds
// (measurements/noise-notch-held-note-robustness-2026-10-04.md "Round 2").
// Adopting it is a product decision. Message-level parity with
// cand2-notch.js variant R8: 0 mismatches (parity.mjs R8 SRC 17 and
// r2int beatpause / shared samples, while this file was src/).
//
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
//     notes" below), timed from the note's latest start ("Breaths")
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
// Breaths (2026-10-04, measurements/noise-notch-held-note-robustness-
// 2026-10-04.md "Round 2"): same-pitch holds separated by breaths piled
// onto one onset-born track (its age spans the breaths) and were notched
// once the series passed 20 s. A SOUND OFFSET — the 50 Hz-4 kHz band
// energy of the last 0.3 s >= OFFSET_DB (or of the last 0.1 s >=
// SHORT_GAP_DB) under the loudest 25 ms chunk of the preceding second —
// restarts an unpromoted onset-born track's 20 s delay clock (not its
// duty) when, within OFFSET_OBS observations, BOTH
//   - the line dips >= DIP_DB under its median power in the 512 ms
//     observation (read off the spectrum at the track frequency) while the
//     band is >= DIP_DB under its recent max, AND
//   - the line is ABSENT from a QUIET WINDOW: 100 ms of raw audio inside
//     the breath (chunks >= SHORT_GAP_DB under the last ~1.3 s max, the
//     quiet run's first chunk skipped), where the line is < QUIET_K x the
//     local spectral floor, or has decayed >= DECAY_ELIG_DB within 100 ms
//     and >= DECAY_RATE_DB per 50 ms since the run began (a reverberant
//     release tail).
// While the quiet run lasts the re-birth is PROVISIONAL (the track cannot
// promote): it is confirmed when the run ends, and void if the line comes
// BACK inside the run (>= RETURN_DB over its minimum, >= RETURN_K x the
// floor) — an equal-amplitude beat's null met the pause.
// The quiet-window test is what a stationary interferer cannot pass: a hum
// stays a prominent, level line in every pause, even when it beats, is
// amplitude-modulated, or shares the note's track 16-30 dB under the voice
// (round 1's dip-only rule read the hum's level in a breath as "the line
// dipped" and never notched it; its revokes needed a 0.7 s+ band dip).
// A re-birth stays revocable: a later quiet window in which the line is
// STEADY — prominent in STEADY_WIN consecutive windows (200 ms), each
// within QUIET_DECAY_DB of the previous and the last within it of the
// first — restores the clock from before the first re-birth. Accepted: a tonal source that
// itself switches fully off for 0.1-2 s between multi-second stretches is
// the repeated-holds signal and is treated as one; a breath shorter than
// a reverberant tail (0.25 s at RT60 0.6 s) re-births nothing (bc42ad0
// behavior). (6f8be18's in-sound latch and round 1's glide / step handoff
// were both reverted: the latch blocked or delayed real hums — present
// at stream start with speech in the first 0.6 s, weak hums switching on
// mid-speech, capture pre-roll, dense speech — and the handoff gave a hum
// that stepped frequency, or reappeared beside a note that moved or ended
// into continuous speech, a fresh 20 s clock. Mid-hold glides / steps,
// speech running into a hold and phonation in the stream's first
// observation windows are known limitations again.)
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
  // breath re-births (2026-10-04 rounds 1-2; see "Breaths" above)
  offsetDb: 20,          // sound offset: last 0.3 s this far under the last second's max
  offsetSec: 0.3,
  shortGapDb: 18,        // catch breath: last 0.1 s this far under it; also
                         //   the quiet-window chunk threshold
  shortGapSec: 0.1,
  offsetObs: 5,          // observations after an offset to see the line dip
  dipDb: 6,              // line and band dip depth (512 ms observation)
  quietK: 10,            // quiet window: line < this x local floor = absent
  decayEligDb: 6,        //   ... or decayed this far over the last 100 ms ...
  decayRateDb: 3,        //   ... at >= this per 50 ms hop since the run's first window
  steadyWin: 5,          // steady: this many consecutive prominent windows ...
  quietDecayDb: 3,       //   ... each within this of the previous, last within it of the first
  returnDb: 6,           // back: >= this over its minimum since the absence ...
  returnK: 20,           //   ... and >= this x the local floor
  retuneHz: 0.5,         // retune a live section in place when its track
                         //   drifted more than this (filter state kept)
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
  const cfg = { ...NOTCH_DEFAULTS, rebirth: true, coh: null, ...(globalThis.__NOTCH_OPTS ?? {}), ...opts };
  const COH = cfg.coh ? { voice: "onset", machine: true, rebirthGate: "any", voiceRevoke: false, reanchor: false, jumpGuard: false, jumpDb: 10, jumpMode: "first3", jumpRefObs: 3, jumpStableDb: 3, jumpRiseObs: 6, jumpPeakTolDb: 0, grantLastCorr: 0, jumpPreVoice: false, jumpPreFirst: false, bandMarginHz: 0, clearOob: false, lapseCorr: 0, lapseCoh: 0, capSec: 0, capFirstObs: 1, revokeLast: false, minWin: 3, poolWin: 5, mCorr: 0.15, mCoh: 1, vCorr: 0.5, vCoh: 2, fLo: 80, fHi: 400, win: 1024, wch: 40, gateDb: 10, ...cfg.coh } : null;
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
  const dipRatio = Math.pow(10, -cfg.dipDb / 10);

  // observation cadence: seconds per observation, derived at runtime
  // from chunk length (chunks are ~25 ms in production; tests may vary)
  let chunkCounter = 0;
  let obsPerSec = null;

  // tracks: { id, freq, dev, power, pw, refPow, hits, firstObs, noteObs,
  //           lastSeenObs, active, onsetBorn, pend, prov, chain, qAbsAt,
  //           qMin, qMinRun, qRunId, qHist }
  let tracks = [];
  let obsIndex = 0;
  let nextTrackId = 1;
  const energyHist = [];   // band energy of recent observations (onset rule)

  let cascade = [];        // [{ id, freq, biquad }], ascending track id

  // ---- sound offsets + quiet windows (breath re-births, 2026-10-04) ----
  // Per-chunk 50 Hz - 4 kHz band energy: 2nd-order RBJ high-pass + two
  // 2nd-order low-passes on a scratch copy of the raw chunk.
  function rbj(type, f0) {
    const w0 = 2 * Math.PI * f0 / sampleRate, al = Math.sin(w0) / (2 * Math.SQRT1_2), c = Math.cos(w0), a0 = 1 + al;
    return type === "hp"
      ? new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0)
      : new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0);
  }
  const bandFilters = [rbj("hp", cfg.bandLoHz), rbj("lp", 4000), rbj("lp", 4000)];
  let chunkScratch = null;
  const chunkRecent = [];  // chunk energies, last offsetSec
  const chunkMaxRing = []; // chunk energies, last 1 s + offsetSec (offset reference)
  let offsetFired = false;
  const armed = [true, true]; // [offset, catch breath]
  let chunkCount = 0;

  // quiet windows (see "Breaths"): inside a run of chunks >= shortGapDb
  // under the loudest of the last ~1.3 s, every 2 chunks from the run's 5th
  // on, the last 4 chunks (100 ms) of raw audio, Hann-windowed; each
  // unpromoted onset-born line is read at its frequency (max over +-1 bin)
  // against the local floor (median of the bins 25-90 Hz either side,
  // skipping the line's octave and sub-octave)
  let quietRun = 0, quietRunId = 0;
  let qLen = 0, qN = 0, qRe = null, qIm = null, qWin = null;
  function quietStep(e, k) {
    let mx = 0;
    for (const v of chunkMaxRing) if (v > mx) mx = v;
    if (!(mx > 0 && e <= mx * Math.pow(10, -cfg.shortGapDb / 10))) {
      // the run ended without the line coming back: confirm provisional
      // re-births (clock restarted at the observation that made them)
      if (quietRun > 0) for (const t of tracks) if (t.prov !== undefined) {
        if (t.chain === undefined) t.chain = t.noteObs;
        t.noteObs = t.prov; t.prov = undefined;
      }
      quietRun = 0; return;
    }
    if (++quietRun === 1) quietRunId++;
    if (quietRun < 5 || quietRun % 2 === 0 || rawFill < 4 * k) return;
    const cand = tracks.filter((t) => !t.active && t.onsetBorn);
    if (!cand.length) return;
    const L = 4 * k;
    if (L !== qLen) {
      qLen = L; qN = 1; while (qN < 1.25 * L) qN <<= 1;
      qRe = new Float64Array(qN); qIm = new Float64Array(qN); qWin = new Float64Array(L);
      for (let i = 0; i < L; i++) qWin[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1));
    }
    qRe.fill(0); qIm.fill(0);
    for (let i = 0; i < L; i++) qRe[i] = raw[bufferLength - L + i] * qWin[i];
    fft(qRe, qIm);
    const qBin = sampleRate / qN;
    const pw = (b) => qRe[b] * qRe[b] + qIm[b] * qIm[b];
    const steadyRatio = Math.pow(10, -cfg.quietDecayDb / 10);
    for (const t of cand) {
      const b0 = Math.round(t.freq / qBin);
      let p = 0;
      for (let b = b0 - 1; b <= b0 + 1; b++) if (b > 0 && b < qN / 2) p = Math.max(p, pw(b));
      const fl = [];
      for (let b = Math.max(1, Math.round((t.freq - 90) / qBin)); b <= Math.min(qN / 2 - 1, Math.round((t.freq + 90) / qBin)); b++) {
        const f = b * qBin;
        if (Math.abs(f - t.freq) < 25 || Math.abs(f - 2 * t.freq) < 22 || Math.abs(f - t.freq / 2) < 22) continue;
        fl.push(pw(b));
      }
      fl.sort((a, b) => a - b);
      const floor = fl.length ? fl[Math.floor(fl.length / 2)] : 0;
      const markAbsent = () => { t.qAbsAt = chunkCount; t.qMin = t.qMinRun === quietRunId ? Math.min(t.qMin, p) : p; t.qMinRun = quietRunId; };
      // absent: not prominent
      if (!(floor > 0) || p < cfg.quietK * floor) { markAbsent(); t.qHist = []; continue; }
      // back: the line returns inside the same quiet run (>= returnDb over
      // its minimum since the absence, >= returnK x the floor) — it was never
      // gone (an equal-amplitude beat's null): absence and any provisional
      // re-birth are void
      if (t.qMinRun === quietRunId && t.qAbsAt !== undefined && p >= t.qMin * Math.pow(10, cfg.returnDb / 10) && p >= cfg.returnK * floor) {
        t.qAbsAt = undefined; t.qMinRun = undefined; t.prov = undefined;
      }
      if (t.qRunId !== quietRunId) { t.qRunId = quietRunId; t.qHist = []; }
      const h = t.qHist;
      h.push(p);
      const n = h.length;
      // absent: decayed FAST, >= decayEligDb over the last 3 windows (100 ms)
      // AND >= decayRateDb per 50 ms hop on average since the run's first
      // window — a release tail ringing into the breath (reverb, room mode:
      // RT60 0.8 s decays 7.5 dB / 100 ms from the moment the note stops); a
      // hum holds its level (a 2:1 beat moves <= ~2 dB / 100 ms; a 1:1 beat
      // slides slowly, then plunges into its null: 2 dB / hop on average
      // over the pause that met it, scripts/notch-adversarial r2int.mjs
      // beatpause seed 8)
      if (n >= 2 && p <= h[Math.max(0, n - 3)] * Math.pow(10, -cfg.decayEligDb / 10)
          && p <= h[0] * Math.pow(10, -cfg.decayRateDb * (n - 1) / 10)) { markAbsent(); continue; }
      // steady: revoke the re-birth chain (clock from before its first
      // re-birth) and void any absence seen earlier in this run
      if (n >= cfg.steadyWin) {
        let ok = h[n - 1] >= h[n - cfg.steadyWin] * steadyRatio;
        for (let i = n - cfg.steadyWin + 1; i < n; i++) if (h[i] < h[i - 1] * steadyRatio) ok = false;
        if (ok) {
          t.qAbsAt = undefined; t.prov = undefined;
          if (t.chain !== undefined) { t.noteObs = t.chain; t.chain = undefined; }
        }
      }
    }
  }

  function chunkStep(chunk) {
    if (!chunkScratch || chunkScratch.length !== chunk.length) chunkScratch = new Float32Array(chunk.length);
    chunkScratch.set(chunk);
    for (const f of bandFilters) f.processInPlace(chunkScratch);
    let e = 0;
    for (let i = 0; i < chunkScratch.length; i++) e += chunkScratch[i] * chunkScratch[i];
    e = Math.max(1e-10, e / chunkScratch.length);
    const relLen = Math.max(1, Math.round(cfg.offsetSec * sampleRate / chunk.length));
    chunkRecent.push(e); if (chunkRecent.length > relLen) chunkRecent.shift();
    const maxLen = Math.round(sampleRate / chunk.length);
    chunkMaxRing.push(e); if (chunkMaxRing.length > maxLen + relLen) chunkMaxRing.shift();
    chunkCount++;
    quietStep(e, chunk.length);
    if (chunkRecent.length < relLen) return;
    // offset: the last offsetSec (shortGapSec) sits >= offsetDb (shortGapDb)
    // below the loudest chunk before it within the last second — a breath,
    // even when audible inhalation keeps the level well above the room
    // floor; re-armed once the level is back within half that depth
    const rules = [[relLen, cfg.offsetDb], [Math.max(1, Math.round(cfg.shortGapSec * sampleRate / chunk.length)), cfg.shortGapDb]];
    rules.forEach(([len, db], r) => {
      let m = 0;
      for (let i = chunkRecent.length - len; i < chunkRecent.length; i++) m += chunkRecent[i];
      m /= len;
      let mx = 0;
      for (let i = 0; i < chunkMaxRing.length - len; i++) if (chunkMaxRing[i] > mx) mx = chunkMaxRing[i];
      if (armed[r] && mx > 0 && m <= mx * Math.pow(10, -db / 10)) { offsetFired = true; armed[r] = false; }
      else if (!armed[r] && e >= mx * Math.pow(10, -db / 20)) armed[r] = true;
    });
  }

  // ---- line coherence (CANDIDATE, 2026-10-05) ---------------------------
  // Per 25 ms chunk and per unpromoted track in [fLo, fHi]: the windowed
  // (Hann, WIN samples) DFT coefficient at the track's frequency f and at 2f
  // on the window ending at the chunk boundary and on the one ending a chunk
  // earlier; the phase advance gives the instantaneous frequency of the line
  // and of its 2nd partial. Over WCH consecutive VALID chunks (the latest
  // observation, or the one before, saw the line) one window's mid-band
  // (5-point moving average, linear trend removed) cents series m1 / m2 give
  // s12 = mean(m1 m2), s11 = mean(m1^2), s22 = mean(m2^2). The last poolWin
  // windows are pooled: pcorr = S12 / sqrt(S11 S22), pcoh = sqrt(S12 / n)
  // cents (signed). linefeat.py's estimator, ported 1:1.
  let cohHann = null, cohLast = 0;
  function cohDft(off, n, f) {
    // sum_{i<n} raw[off+i] w[i] e^{-2 pi i f i / sr}
    const w = 2 * Math.PI * f / sampleRate, cr = Math.cos(w), ci = -Math.sin(w);
    let pr = 1, pi = 0, sr_ = 0, si = 0;
    for (let i = 0; i < n; i++) {
      const v = raw[off + i] * cohHann[i];
      sr_ += v * pr; si += v * pi;
      const nr = pr * cr - pi * ci; pi = pr * ci + pi * cr; pr = nr;
    }
    return [sr_, si];
  }
  function cohIF(f, k) {
    const n = COH.win, end = bufferLength, a = cohDft(end - n, n, f), b = cohDft(end - n - k, n, f);
    cohLast = a[0] * a[0] + a[1] * a[1];
    // X_cur conj(X_prev) with absolute-time phase: extra e^{-2 pi i f k / sr}
    let re_ = a[0] * b[0] + a[1] * b[1], im_ = a[1] * b[0] - a[0] * b[1];
    const w = -2 * Math.PI * f * k / sampleRate, c = Math.cos(w), s = Math.sin(w);
    const r2 = re_ * c - im_ * s; im_ = re_ * s + im_ * c; re_ = r2;
    return f + Math.atan2(im_, re_) / (2 * Math.PI * k / sampleRate);
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
    if (!COH || rawFill < bufferLength || k <= 0) return;
    if (!cohHann || cohHann.length !== COH.win) {
      cohHann = new Float64Array(COH.win);
      for (let i = 0; i < COH.win; i++) cohHann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (COH.win - 1));
    }
    for (const t of tracks) {
      if (t.active) continue;
      if (t.freq < COH.fLo - COH.bandMarginHz || t.freq > COH.fHi + COH.bandMarginHz) {
        if (COH.clearOob && t.coh) { t.coh.c1.length = 0; t.coh.c2.length = 0; }
        continue;
      }
      if (!t.coh) t.coh = { c1: [], c2: [], wins: [] };
      const C = t.coh;
      if (obsIndex - t.lastSeenObs > 1) { C.c1.length = 0; C.c2.length = 0; continue; }
      const f1 = cohIF(t.freq, k), p1 = cohLast, f2 = cohIF(2 * t.freq, k);
      // line-presence gate: a chunk whose 64 ms line level is >= gateDb under
      // the track's running level (EMA of dB over present chunks) carries no
      // line (a breath / cut-out still inside the 512 ms observation that
      // keeps the track "seen") -> the run restarts
      const lv = 10 * Math.log10(p1 + 1e-30);
      if (C.lv !== undefined && lv < C.lv - COH.gateDb) {
        C.c1.length = 0; C.c2.length = 0;
        // reanchor: the line stays >= gateDb down for 0.5 s while still seen
        // -> a different (weaker) source now holds the line: restart the
        // level and drop the old windows
        if (COH.reanchor && ++C.low >= 20) { C.lv = lv; C.wins.length = 0; C.low = 0; }
        continue;
      }
      C.low = 0;
      C.lv = C.lv === undefined ? lv : 0.95 * C.lv + 0.05 * lv;
      C.c1.push(1200 * Math.log2(Math.max(f1, 1e-3)));
      C.c2.push(1200 * Math.log2(Math.max(f2, 1e-3)));
      if (C.c1.length < COH.wch) continue;
      const m1 = midSeries(C.c1), m2 = midSeries(C.c2);
      let s12 = 0, s11 = 0, s22 = 0;
      for (let i = 0; i < m1.length; i++) { s12 += m1[i] * m2[i]; s11 += m1[i] * m1[i]; s22 += m2[i] * m2[i]; }
      C.wins.push([s12 / m1.length, s11 / m1.length, s22 / m1.length, chunkCounter]); // [.., chunk the window ended on]
      if (C.wins.length > COH.poolWin) C.wins.shift();
      C.c1.length = 0; C.c2.length = 0;
      if (globalThis.__COHWIN) globalThis.__COHWIN.push({ c: chunkCount, id: t.id, f: t.freq, w: C.wins[C.wins.length - 1] });
    }
  }
  // "machine" | "voice" | null (undecided / too little evidence)
  function cohClass(t) {
    const C = t.coh;
    if (!COH || !C || C.wins.length < COH.minWin) return null;
    let S12 = 0, S11 = 0, S22 = 0;
    for (const [a, b, c] of C.wins) { S12 += a; S11 += b; S22 += c; }
    const pcorr = S12 / Math.max(1e-12, Math.sqrt(S11 * S22));
    const pcoh = Math.sign(S12) * Math.sqrt(Math.abs(S12) / C.wins.length);
    t.cohStat = [pcorr, pcoh];
    if (pcorr < COH.mCorr || pcoh < COH.mCoh) return "machine";
    if (pcorr >= COH.vCorr && pcoh >= COH.vCoh) return "voice";
    return null;
  }

  // the LATEST single window alone reads machine (revokeLast)
  // the LATEST single window's correlation (grantLastCorr: voice timing is
  // granted only while the line still moves with its partial right now)
  function lastCorr(t) {
    const w = t.coh?.wins; if (!w || !w.length) return -1;
    const [a, b, c] = w[w.length - 1];
    return a / Math.max(1e-12, Math.sqrt(b * c));
  }
  // pooled verdict stats over the line's windows that ended at or before
  // chunk c (all windows: c = Infinity): [pcorr, pcoh, n]
  function pooledUpTo(t, c) {
    let S12 = 0, S11 = 0, S22 = 0, n = 0;
    for (const w of t.coh?.wins ?? []) if (w[3] <= c) { S12 += w[0]; S11 += w[1]; S22 += w[2]; n++; }
    return n ? [S12 / Math.max(1e-12, Math.sqrt(S11 * S22)), Math.sign(S12) * Math.sqrt(Math.abs(S12) / n), n] : [0, 0, 0];
  }
  // jumpPreVoice: the line read as a voice before its steady reference ended
  function preVoice(t, c) {
    const [pc, ph, n] = pooledUpTo(t, c);
    return n > 0 && pc >= COH.vCorr && ph >= COH.vCoh;
  }
  // lapse: the pooled windows no longer support the voice timing
  function lapsed(t) {
    const [pc, ph, n] = pooledUpTo(t, Infinity);
    return n > 0 && (pc < COH.lapseCorr || ph < COH.lapseCoh);
  }
  function lastMachine(t) {
    const w = t.coh?.wins; if (!w || !w.length) return false;
    const [a, b, c] = w[w.length - 1];
    return a / Math.max(1e-12, Math.sqrt(b * c)) < COH.mCorr || Math.sign(a) * Math.sqrt(Math.abs(a)) < COH.mCoh;
  }
  // breath re-births allowed for this track? (rebirthGate: "any" = R8,
  // "voice" = only voice-confirmed lines, "notMachine" = unless machine-
  // confirmed)
  function rebirthOk(t) {
    if (!COH || COH.rebirthGate === "any") return true;
    const c = cohClass(t);
    return COH.rebirthGate === "voice" ? c === "voice" : c !== "machine";
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
    let recentMax = bandEnergy;
    for (const e of energyHist) if (e > recentMax) recentMax = e;
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
    // a track's line power read straight off the spectrum (max over +-1 Hz):
    // independent of peak picking, whose min-separation drops a hum line
    // next to a speech harmonic (which would read as "the line vanished")
    const binPow = (f) => {
      const k0 = Math.round(f / binHz) - loBin, r = Math.max(1, Math.round(1 / binHz));
      let m = 0;
      for (let k = Math.max(0, k0 - r); k <= Math.min(power.length - 1, k0 + r); k++) if (power[k] > m) m = power[k];
      return m;
    };
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
        best.firstObs = obsIndex; best.noteObs = obsIndex; best.hits = 0; best.onsetBorn = true; best.coh = undefined; best.voiceBorn = false; best.pow0 = undefined; best.p3 = undefined; best.ph = undefined; best.prePeak = undefined; best.jumped = false;
        best.freq = pk.freq; best.dev = 0;
      }
      if (best) {
        best.dev = 0.9 * best.dev + 0.1 * Math.abs(pk.freq - best.freq); // wobble estimate
        best.freq = 0.9 * best.freq + 0.1 * pk.freq; // slow EMA — stability IS the criterion
        best.power = pk.power;
        if (best.p3 === undefined) best.p3 = [];
        if (COH && COH.jumpMode === "plateau") {
          // takeover: >= jumpDb over a level that held (within jumpStableDb)
          // for the jumpRefObs consecutive sightings ending jumpRiseObs
          // observations ago — a louder source starting on a line that was
          // already there at a steady level. A crescendo rises slower than
          // that; a voice's attack has no steady level before it
          const ph = (best.ph ??= []);
          ph.push([obsIndex, 10 * Math.log10(pk.power + 1e-30), chunkCounter]);
          const R = COH.jumpRiseObs, P = COH.jumpRefObs;
          while (ph.length && ph[0][0] <= obsIndex - R - P) {
            // jumpPeakTolDb: the line's loudest sighting BEFORE the reference
            // (a takeover's steady level is the line's loudest so far; a voice
            // that dipped and recovers was louder before its steady stretch)
            if (ph[0][0] <= obsIndex - R - P) best.prePeak = Math.max(best.prePeak ?? -Infinity, ph[0][1]);
            ph.shift();
          }
          const ref = ph.filter(([o]) => o <= obsIndex - R).map(([, d]) => d);
          if (ref.length >= P) {
            const lo = Math.min(...ref), hi = Math.max(...ref), med = [...ref].sort((a, b) => a - b)[Math.floor(ref.length / 2)];
            const peakOk = !COH.jumpPeakTolDb || (best.prePeak ?? -Infinity) <= hi + COH.jumpPeakTolDb;
            // jumpPreVoice: not a takeover when the line already read as a
            // voice before the reference ended (a vowel change, a crescendo)
            const refCs = ph.filter(([o]) => o <= obsIndex - R).map(([, , c]) => c);
            const refC = COH.jumpPreFirst ? Math.min(...refCs) : Math.max(...refCs);
            if (hi - lo <= COH.jumpStableDb && peakOk && ph[ph.length - 1][1] >= med + COH.jumpDb && !(COH.jumpPreVoice && preVoice(best, refC))) best.jumped = true;
          }
        } else if (best.pow0 === undefined) { best.p3.push(pk.power); if (best.p3.length === 3) best.pow0 = [...best.p3].sort((a, b) => a - b)[1]; }
        else if (pk.power >= best.pow0 * Math.pow(10, (COH ? COH.jumpDb : cfg.onsetDb) / 10)) best.jumped = true;
        best.hits++;
        best.lastSeenObs = obsIndex;
        best._seen = true;
      } else {
        tracks.push({ id: nextTrackId++, freq: pk.freq, dev: 0, power: pk.power, pw: [], hits: 1, firstObs: obsIndex, noteObs: obsIndex, lastSeenObs: obsIndex, active: false, _seen: true, onsetBorn: onsetNow, pend: 0 });
      }
    }

    // per-track power reference: median of the last 9 sighting powers
    for (const t of tracks) {
      if (t._seen) { t.pw.push(t.power); if (t.pw.length > 9) t.pw.shift(); }
      const sp = [...t.pw].sort((a, b) => a - b);
      t.refPow = sp[Math.floor(sp.length / 2)] ?? t.power;
    }
    // breath re-birth (see "Breaths"): after a sound offset, an unpromoted
    // onset-born line absent from a recent quiet window that dips >= dipDb
    // under its median power while the band is >= dipDb under its recent max
    // starts a new note — its delay clock (noteObs) restarts (the clock
    // before the first re-birth kept in `chain` for a steady-line revoke);
    // duty keeps the track's whole history
    if (offsetFired) {
      if (cfg.rebirth) for (const t of tracks) if (!t.active && t.onsetBorn && rebirthOk(t)) t.pend = cfg.offsetObs;
      offsetFired = false;
    }
    for (const t of tracks) {
      if (!(t.pend > 0)) continue;
      t.pend--;
      if (t.qAbsAt === undefined || chunkCount - t.qAbsAt > (cfg.offsetObs + 1) * cfg.observeEveryChunks) continue;
      if (bandEnergy <= recentMax * dipRatio && binPow(t.freq) <= t.refPow * dipRatio) {
        t.pend = 0;
        // still inside the quiet run: provisional until it ends (the line
        // may yet come back); the track cannot promote meanwhile
        if (quietRun > 0) { t.prov = obsIndex; continue; }
        if (t.chain === undefined) t.chain = t.noteObs;
        t.noteObs = obsIndex;
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
      // onset-born: timed from the current note (latest breath re-birth)
      const timed = t.onsetBorn ? obsIndex - Math.max(t.noteObs, t.firstObs) + 1 : span;
      const cls = COH && !t.active ? cohClass(t) : null;
      if (cls === "voice" && !t.onsetBorn && COH.voice === "onset" && !(COH.jumpGuard && t.jumped) && (!COH.grantLastCorr || lastCorr(t) >= COH.grantLastCorr)) { t.onsetBorn = true; t.voiceBorn = true; }
      // voiceRevoke: a voice-timed line that later reads machine-confirmed
      // (a spin-up transient that settled into a steady hum) gets its own
      // non-onset timing back
      // lapse (V19): or its pooled windows fell under lapseCorr / lapseCoh
      if (t.voiceBorn && COH.voiceRevoke && (cls === "machine" || (COH.revokeLast && lastMachine(t)) || (COH.lapseCorr > 0 && lapsed(t)))) { t.onsetBorn = false; t.voiceBorn = false; }
      // promote only on an observation that actually saw the peak (a note
      // that just ended must not promote on its trailing duty)
      if (cls === "machine" && COH.machine) {
        if (!t.active && t._seen && span >= minObs && duty >= cfg.promoteDuty) { t.active = true; t.prov = undefined; }
      } else if (cls === "voice" && COH.voice === "block") {
        // voice-confirmed: no promotion while the line looks like a voice
      } else if (!t.active && t._seen && t.prov === undefined && timed >= (t.onsetBorn ? (COH && COH.capSec > 0 && t.voiceBorn && t.firstObs <= COH.capFirstObs ? Math.ceil(COH.capSec * (obsPerSec ?? 10)) : onsetMinObs) : minObs) && duty >= cfg.promoteDuty) t.active = true;
      if (globalThis.__COHCLS && cls !== null) globalThis.__COHCLS(t, cls, obsIndex);
      if (globalThis.__COHDBG && cls !== null && t._seen && obsIndex % 10 === 0) globalThis.__COHDBG.push({ o: obsIndex, f: +t.freq.toFixed(1), cls, st: t.cohStat.map((v) => +v.toFixed(2)), ob: t.onsetBorn, nw: t.coh.wins.length });
      if (t.active && obsIndex - t.lastSeenObs > missObs) { t.active = false; t.hits = 0; t.firstObs = obsIndex; }
    }
    if (globalThis.__OBSDBG) globalThis.__OBSDBG(obsIndex, tracks, onsetNow, bandEnergy);

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
    if (k > 0) chunkStep(chunk);
    chunkCounter++;
    if (rawFill >= bufferLength && chunkCounter % cfg.observeEveryChunks === 0) observe();
    if (COH && obsIndex > 0) cohStep(Math.min(k, bufferLength - COH.win));

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
