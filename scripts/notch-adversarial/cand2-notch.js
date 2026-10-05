// cand2-notch.js — round-2 candidate module (2026-10-04): cb00425's
// src/dsp/noise-notch.js (N13) plus option flags read from
// globalThis.__NOTCH_OPTS (variants.mjs R* variants):
//   handoffCents: 0       -> glide / step handoff off
//   quietGate: true       -> breath re-birth needs the LINE absent in a quiet
//                            window (100 ms of raw audio inside the breath)
//   n13Revokes: false     -> cb00425's re-birth revokes (still-a-peak /
//                            recover-while-band-down / band-rise confirms) off
//   steadyWin: 2          -> permanent STEADY flag after 2 level prominent
//                            windows; > 2: run-scoped, that many windows
//   quietDecayDb          -> steady tolerance between windows
//   decayEligDb, decaySpan -> a line decaying this far (under the run max, or
//                            over the last decaySpan windows) counts as absent
//   decayRateDb           -> ... and only if it has decayed >= this per window
//                            hop on average since the run's first window
//   prov, returnDb, returnK -> provisional re-birth inside the quiet run,
//                            voided when the line comes back (+returnDb over
//                            its minimum, >= returnK x floor)
// globalThis.__QDBG (array) collects quiet-window / re-birth trace events.
// Everything else is byte-for-byte cb00425.
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
//     notes" below), timed from the note's latest start ("Breaths",
//     "Glides")
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
// Breaths (2026-10-04 round 1, measurements/noise-notch-held-note-
// robustness-2026-10-04.md "Round 1"): same-pitch holds separated by
// breaths piled onto one onset-born track (its age spans the breaths) and
// were notched once the series passed 20 s. A SOUND OFFSET — the 50 Hz-
// 4 kHz band energy of the last 0.3 s >= OFFSET_DB (or of the last 0.1 s
// >= SHORT_GAP_DB) under the loudest 25 ms chunk of the preceding second —
// followed within OFFSET_OBS observations by the line itself dipping
// >= DIP_DB under its median power (read off the spectrum at the track
// frequency, not from peak picking) while the band is >= DIP_DB under its
// recent max restarts an unpromoted onset-born track's 20 s delay clock
// (not its duty). Only onset-born tracks are affected and the line itself
// must dip, so a stationary interferer (which keeps its power through
// every pause) is never delayed. (6f8be18's in-sound latch, which also
// covered glides, speech->hold and phonation 0.15 s into the stream, was
// reverted in round 1: it blocked or delayed real hums — never notched
// when present at stream start with speech in the first 0.6 s, weak hums
// switching on mid-speech, ~20 s instead of ~5 s after capture pre-roll,
// and hums switching on during dense speech by a 120 Hz voice.)
//
// Glides (2026-10-04 round 1, same file): a held note that slides or steps
// > MATCH_HZ mid-hold spawned a track that was not onset-born (no onset at
// that time) and was notched ~5 s later (shift family 73.6 % of hold frames
// reported). A HANDOFF: a line born not at an onset, within HANDOFF_CENTS
// of an unpromoted onset-born line that had been HELD (>= HANDOFF_HELD_SEC
// at duty >= HANDOFF_HELD_DUTY) and has vanished within the last
// HANDOFF_LOST_SEC (the child may be up to HANDOFF_YOUNG_SEC older than the
// vanishing: a step's 512 ms window holds both pitches), is the same note
// moved — it is onset-born, its 20 s clock starting at the move. (Taking
// the PARENT's clock instead promoted voice lines on the spot: a mains
// 180 Hz line that had switched on at an onset, masked for one observation
// by a syllable, "handed off" to a 190 Hz speech peak 25 s later.) Not
// while the band has dipped >= DIP_DB under its 2 s max (a moved note keeps
// sounding; a note that ENDED does not hand off), and REVOKED (back to not
// onset-born) when the line is still a picked peak REVOKE_SEC into a band
// dip (REVOKE_PERSIST_OBS observations running): the sound it was handed off from ended and the line stayed — a room
// hum the note had masked (min-separation) and then glided onto, not the
// note. Without the band and revoke conditions 34 of 168 hum-beside-a-held-
// note cells promoted later than bc42ad0 (up to 15 s). A handoff can only
// delay a promotion (until the next pause revokes it), never advance one.
//
// A breath re-birth is REVOKED (the clock restored) when the line is still
// a picked peak REVOKE_SEC after it, in REVOKE_PERSIST_OBS consecutive
// observations, while the band has stayed down: the note was sitting on an
// interferer within MATCH_HZ (one shared track), and what "dipped" was the
// note, not the line (hum at 120 Hz under a 123 Hz held note: promoted
// 4-8 s later than bc42ad0 without it). It is also revoked when the line
// comes BACK to >= -dipDb of its pre-dip median in REVOKE_RECOVER_OBS
// consecutive observations while the band is still down: a beating or
// amplitude-modulated hum whose trough met a speech pause (weak2 suite,
// two fans 0.5 Hz apart at +9/+18 dB: promoted ~10 s later than bc42ad0,
// pause FV +20-31 pp, without it); a breath's ended note stays gone. A
// rising band (the next note) confirms the re-birth.
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
  // breath re-births (2026-10-04 round 1; see "Breaths" above)
  offsetDb: 20,          // sound offset: last 0.3 s this far under the last second's max
  offsetSec: 0.3,
  shortGapDb: 18,        // catch breath: last 0.1 s this far under it
  shortGapSec: 0.1,
  offsetObs: 5,          // observations after an offset to see the line dip
  dipDb: 6,              // line and band dip depth
  // glide / step handoff (2026-10-04 round 1; see "Glides" above)
  handoffCents: 160,     // child within this of the vanished parent
  handoffHeldSec: 1,     // parent held this long ...
  handoffHeldDuty: 0.7,  //   at this duty (a note's H2 near the 460 Hz edge is picked at ~0.8) ...
  handoffLostSec: 1.5,   // ... and last seen within this
  handoffYoungSec: 0.6,  // child born at most this long before
  revokeSec: 0.7,        // breath re-birth / handoff revoked if the line is
                         //   still a peak this long into a band dip ...
  revokePersistObs: 3,   // ... in this many consecutive observations (one
                         //   sighting was the NEXT note's onset at the end
                         //   of a 1 s breath's 512 ms window)
  revokeRecoverObs: 2,   // breath re-birth also revoked when the line is back
                         //   at >= -dipDb of its pre-dip median in this many
                         //   consecutive observations while the band is
                         //   still down (a beating / AM hum's trough met a
                         //   speech pause: weak2 "beat" +9/+18 dB promoted
                         //   ~10 s later than bc42ad0 without it)
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
  const cfg = { ...NOTCH_DEFAULTS, n13Revokes: true, quietGate: false, quietK: 10, quietDecayDb: 4, steadyWin: 2, decayEligDb: 0, decaySpan: 0, prov: false, returnDb: 3, decayRateDb: 0, ...(globalThis.__NOTCH_OPTS ?? {}), ...opts };
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
  //           lastSeenObs, active, onsetBorn, inherited, pend, prevNote,
  //           rebornObs, rebRef, revSeen, recSeen, hoSeen }
  let tracks = [];
  let obsIndex = 0;
  let nextTrackId = 1;
  const energyHist = [];   // band energy of recent observations (onset rule)

  let cascade = [];        // [{ id, freq, biquad }], ascending track id
  let downSince = null;    // first observation of the current band dip (handoff revoke)

  // ---- sound offsets (breath re-births, 2026-10-04 round 1) ----
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
  let chunkCount = 0;      // chunks seen (quiet-window timing)

  // ---- quiet windows (round 2) ----
  // A chunk is QUIET when its band energy is >= shortGapDb under the
  // loudest chunk of the last ~1.3 s. Inside a quiet run, every 2 chunks
  // from its 5th on, the last 4 chunks (100 ms) of RAW audio are Hann-
  // windowed and each unpromoted onset-born track's line is read at its
  // frequency against the local spectral floor (median of the bins 25-90 Hz
  // either side, skipping the line's octave / sub-octave). The run's first
  // chunk is never in a window (a note's release tail). Not prominent
  // (< quietK x floor) = ABSENT: a breath re-birth needs this. Prominent in
  // two consecutive windows, the later within quietDecayDb of the earlier
  // (a hum holds its level; a reverberant tail decays) = STEADY: revokes the
  // track's re-birth chain (clock restored) and bars further re-births.
  let quietRun = 0, quietRunId = 0;
  let qLen = 0, qN = 0, qRe = null, qIm = null, qWin = null;
  function quietStep(e, k) {
    let mx = 0;
    for (const v of chunkMaxRing) if (v > mx) mx = v;
    if (!(mx > 0 && e <= mx * Math.pow(10, -cfg.shortGapDb / 10))) {
      // run ended without the line coming back: confirm provisional re-births
      if (quietRun > 0 && cfg.prov) for (const t of tracks) if (t.prov !== undefined) {
        if (t.chain === undefined) t.chain = t.noteObs;
        t.noteObs = t.prov; t.prov = undefined;
        if (globalThis.__QDBG) globalThis.__QDBG.push({ c: chunkCount, confirm: +t.freq.toFixed(1) });
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
    for (const t of cand) {
      if (t.qRunId !== quietRunId) { t.qRunId = quietRunId; t.qLast = null; }
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
      if (globalThis.__QDBG) globalThis.__QDBG.push({ c: chunkCount, run: quietRun, f: +t.freq.toFixed(1), db: +(10 * Math.log10(p / floor)).toFixed(1), pdb: +(10 * Math.log10(p)).toFixed(1), chain: t.chain });
      const markAbs = () => { t.qAbsAt = chunkCount; t.qMin = t.qMinRun === quietRunId ? Math.min(t.qMin, p) : p; t.qMinRun = quietRunId; };
      if (!(floor > 0) || p < cfg.quietK * floor) { markAbs(); t.qLast = null; t.qHist = []; continue; }
      // the line came BACK inside the same quiet run (>= returnDb over its
      // minimum since the absence): it was never gone (a beat null)
      if (cfg.prov && t.qMinRun === quietRunId && t.qAbsAt !== undefined && p >= t.qMin * Math.pow(10, cfg.returnDb / 10) && p >= (cfg.returnK ?? 0) * floor) {
        t.qAbsAt = undefined; t.qMinRun = undefined;
        if (t.prov !== undefined && globalThis.__QDBG) globalThis.__QDBG.push({ c: chunkCount, cancel: +t.freq.toFixed(1) });
        t.prov = undefined;
      }
      if (cfg.steadyWin > 2) {
        // run-scoped: steadyWin consecutive prominent windows, each within
        // quietDecayDb of the previous and the last within it of the first
        const dr = Math.pow(10, -cfg.quietDecayDb / 10);
        if (t.qRunId2 !== quietRunId) { t.qRunId2 = quietRunId; t.qHist = []; }
        t.qHist.push(p);
        const h = t.qHist, n = h.length;
        // a line DECAYING >= decayEligDb under its loudest window of this run
        // is a release tail ringing into the breath (reverb, room mode) —
        // counts as absent (a hum holds its level: beating 2:1 moves <= ~1 dB
        // per 50 ms window hop)
        if (cfg.decayEligDb > 0 && n >= 2 && h[n - 1] <= (cfg.decaySpan ? h[Math.max(0, n - cfg.decaySpan)] : Math.max(...h)) * Math.pow(10, -cfg.decayEligDb / 10)
            && !(cfg.decayRateDb > 0 && h[n - 1] > h[0] * Math.pow(10, -cfg.decayRateDb * (n - 1) / 10))) { markAbs(); continue; }
        if (n >= cfg.steadyWin) {
          let ok = h[n - 1] >= h[n - cfg.steadyWin] * dr;
          for (let i = n - cfg.steadyWin + 1; i < n; i++) if (h[i] < h[i - 1] * dr) ok = false;
          if (ok && globalThis.__QDBG) globalThis.__QDBG.push({ c: chunkCount, steady: +t.freq.toFixed(1), chain: t.chain });
          if (ok) { t.qAbsAt = undefined; t.prov = undefined; if (t.chain !== undefined) { t.noteObs = t.chain; t.chain = undefined; } }
        }
        continue;
      }
      if (t.qLast !== null && p >= t.qLast * Math.pow(10, -cfg.quietDecayDb / 10)) {
        t.steady = true; t.qAbsAt = undefined;
        if (t.chain !== undefined) { t.noteObs = t.chain; t.chain = undefined; }
      }
      t.qLast = p;
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
    if (cfg.quietGate) quietStep(e, chunk.length);
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
        best.firstObs = obsIndex; best.noteObs = obsIndex; best.hits = 0; best.onsetBorn = true;
        best.freq = pk.freq; best.dev = 0;
      }
      if (best) {
        best.dev = 0.9 * best.dev + 0.1 * Math.abs(pk.freq - best.freq); // wobble estimate
        best.freq = 0.9 * best.freq + 0.1 * pk.freq; // slow EMA — stability IS the criterion
        best.power = pk.power;
        best.hits++;
        best.lastSeenObs = obsIndex;
        best._seen = true;
      } else {
        tracks.push({ id: nextTrackId++, freq: pk.freq, dev: 0, power: pk.power, pw: [], hits: 1, firstObs: obsIndex, noteObs: obsIndex, lastSeenObs: obsIndex, active: false, _seen: true, onsetBorn: onsetNow, pend: 0 });
      }
    }

    // glide / step handoff (see "Glides"): a young line born not at an
    // onset where a HELD unpromoted onset-born line just vanished, within
    // handoffCents of it, is the same note moved — onset-born (own clock)
    // — only while the band holds (a note that ENDED does not hand off)
    if (cfg.handoffCents > 0 && bandEnergy >= recentMax * dipRatio) {
      const ops = obsPerSec ?? 10;
      const youngObs = Math.ceil(cfg.handoffYoungSec * ops), lostObs = Math.ceil(cfg.handoffLostSec * ops);
      const heldObs = Math.ceil(cfg.handoffHeldSec * ops);
      for (const c of tracks) {
        if (c.onsetBorn || obsIndex - c.firstObs > youngObs) continue;
        const par = tracks.find((t) => t !== c && t.onsetBorn && !t.active && !t._seen
          && obsIndex - t.lastSeenObs <= lostObs
          && t.lastSeenObs - Math.max(t.firstObs, t.noteObs) + 1 >= heldObs
          && t.hits / (t.lastSeenObs - t.firstObs + 1) >= cfg.handoffHeldDuty
          && Math.abs(1200 * Math.log2(c.freq / t.freq)) <= cfg.handoffCents);
        if (par) { c.onsetBorn = true; c.inherited = true; }
      }
    }

    // per-track power reference: median of the last 9 sighting powers
    for (const t of tracks) {
      if (t._seen) { t.pw.push(t.power); if (t.pw.length > 9) t.pw.shift(); }
      const sp = [...t.pw].sort((a, b) => a - b);
      t.refPow = sp[Math.floor(sp.length / 2)] ?? t.power;
    }
    // breath re-birth (see "Breaths"): after a sound offset, an unpromoted
    // onset-born line that dips >= dipDb under its median power while the
    // band is >= dipDb under its recent max starts a new note — its delay
    // clock (noteObs) restarts; duty keeps the track's whole history
    if (offsetFired) {
      for (const t of tracks) if (!t.active && t.onsetBorn) t.pend = cfg.offsetObs;
      offsetFired = false;
    }
    for (const t of tracks) {
      if (!(t.pend > 0)) continue;
      t.pend--;
      if (cfg.quietGate && (t.steady || t.qAbsAt === undefined || chunkCount - t.qAbsAt > (cfg.offsetObs + 1) * cfg.observeEveryChunks)) continue;
      if (bandEnergy <= recentMax * dipRatio && binPow(t.freq) <= t.refPow * dipRatio) {
        if (cfg.quietGate && t.chain === undefined) t.chain = t.noteObs;
        if (cfg.n13Revokes && t.prevNote === undefined) { t.prevNote = t.noteObs; t.rebRef = t.refPow; }
        t.rebornObs = obsIndex; t.revSeen = 0; t.recSeen = 0;
        if (cfg.prov && quietRun > 0) { t.prov = obsIndex; t.pend = 0; continue; }
        t.noteObs = obsIndex; t.pend = 0;
        if (globalThis.__QDBG) globalThis.__QDBG.push({ c: chunkCount, rebirth: +t.freq.toFixed(1) });
      }
    }

    // promote / demote / prune
    const missObs = Math.ceil(cfg.missSec * (obsPerSec ?? 10));
    const minObs = Math.ceil(cfg.minTrackSec * (obsPerSec ?? 10));
    const onsetMinObs = Math.ceil(cfg.onsetMinTrackSec * (obsPerSec ?? 10));
    // revoke a breath re-birth (see "Glides"): the line still a picked peak
    // revokeSec after it, the band still down -> restore the clock; the band
    // rising back (the next note) confirms it
    const revokeObs = Math.ceil(cfg.revokeSec * (obsPerSec ?? 10));
    for (const t of tracks) {
      if (t.prevNote === undefined) continue;
      if (bandEnergy >= recentMax * dipRatio || t.active || obsIndex - t.rebornObs > 3 * revokeObs) { t.prevNote = undefined; continue; }
      t.revSeen = obsIndex - t.rebornObs >= revokeObs && t._seen ? t.revSeen + 1 : 0;
      t.recSeen = binPow(t.freq) >= t.rebRef * dipRatio ? t.recSeen + 1 : 0;
      if (t.revSeen >= cfg.revokePersistObs || t.recSeen >= cfg.revokeRecoverObs) { t.revSeen = 0; t.noteObs = t.prevNote; t.prevNote = undefined; }
    }
    // revoke a handoff (see "Glides"): an inherited line still a picked
    // peak revokeSec into a band dip outlived the note it came from
    if (bandEnergy < recentMax * dipRatio) { if (downSince === null) downSince = obsIndex; }
    else { downSince = null; for (const t of tracks) t.hoSeen = 0; }
    if (downSince !== null && obsIndex - downSince >= revokeObs) {
      for (const t of tracks) {
        if (!t.inherited || t.active) continue;
        t.hoSeen = t._seen ? (t.hoSeen ?? 0) + 1 : 0;
        if (t.hoSeen >= cfg.revokePersistObs) { t.inherited = false; t.onsetBorn = false; }
      }
    }
    tracks = tracks.filter((t) => obsIndex - t.lastSeenObs <= missObs || t.active);
    for (const t of tracks) {
      const span = obsIndex - t.firstObs + 1;
      const duty = t.hits / span;
      // onset-born: timed from the current note (latest breath re-birth)
      const timed = t.onsetBorn ? obsIndex - Math.max(t.noteObs, t.firstObs) + 1 : span;
      // promote only on an observation that actually saw the peak (a note
      // that just ended must not promote on its trailing duty)
      if (!t.active && t._seen && t.prov === undefined && timed >= (t.onsetBorn ? onsetMinObs : minObs) && duty >= cfg.promoteDuty) t.active = true;
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
    if (k > 0) chunkStep(chunk);
    chunkCounter++;
    if (rawFill >= bufferLength && chunkCounter % cfg.observeEveryChunks === 0) observe();

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
