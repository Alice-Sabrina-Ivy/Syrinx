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
// and harmonics move constantly (session prosody p99 deviation is
// 8.3 st; even a held note carries vibrato/drift); a fan or mains hum
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
//   - ONSET-BORN tracks (first seen at an onset or inside a sound that
//     began at one) need ONSET_MIN_TRACK_SEC instead (see "Held notes")
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
// In-sound latch + new-note re-births (2026-10-04, measurements/noise-
// notch-held-note-robustness-2026-10-04.md). "First seen AT an onset"
// missed three routine exercise shapes, each notched ~5 s in and then
// blanked by the ghost veto (real worker, 16 kHz suite): a hold that
// slides/steps > MATCH_HZ mid-note spawns a track 2+ s into the sound
// (74.3 % of hold frames reported); speech running into a hold with
// < 0.3 s gaps never dips 10 dB in a 512 ms window (66.6 %); repeated
// same-pitch holds with short breaths pile onto one track (77.0 %).
// Now (a) a chunk-level (25 ms) band-energy onset — or the observation-
// level one — sets a LATCH that holds until the band energy has been back
// within ONSET_DB of the pre-onset floor for LATCH_RELEASE_SEC; every
// track born while latched is onset-born. (b) An unpromoted onset-born
// track restarts its 20 s delay clock (not its duty) as a new note when the
// latch releases, or when a SOUND OFFSET (>= OFFSET_DB under the last
// second's max, so an audible inhalation still counts) is followed within
// OFFSET_OBS observations by the line vanishing/weakening (>= DIP_DB under
// its median power) while the band is >= DIP_DB under its recent max. All
// three shapes: 100 % reported (= the no-notch ceiling, 16 and 48 kHz);
// every interferer case of the suite, the committed oracles and the four
// sessions' accuracy unchanged. Trades: (1) phonation already sounding in
// the stream's first chunk has no pre-onset reference — the same signal as
// a hum present at start, which keeps its 5 s promotion (making such tracks
// onset-born: suite start-of-session speech 75.0 -> 68.3 % correct, pause
// FV 5.0 -> 57.4 %); (2) an interferer switching on during DENSE speech
// (no 10 dB dip in the preceding 2 s) is now onset-born like any switch-on
// (~20 s; the shipped rule promoted it at ~5 s by accident of the same gap
// that blanked speech->hold): synthetic dense-speech probe 88.4 -> 79.7 %
// correct over 30 s; (3) the session-05-07 120 Hz line is no longer notched
// (69 s; posted accuracy in those windows 84 -> 94 %, pause voicing equal).
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
  // in-sound latch + sound-offset re-birth (2026-10-04; see "Held notes").
  // Interferer-side cost of the alternatives (mid-session switch-on during
  // FDA speech, promotion after onset; shipped 20.1 s): a line-level co-dip
  // (line unseen + band -6 dB for 2 observations) also fired on hum lines
  // masked by speech (hum-rich120 +10 dB: 29.1 s); offsetDb 15 fired in
  // speech pauses (fan-drift +10 dB: 29.2 s); offsetDb 20 with a 0.3 s
  // release window: identical to shipped on every interferer cell.
  latchReleaseSec: 0.3,
  offsetDb: 20,
  offsetObs: 5,
  dipDb: 6,
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
  const onsetRatio = Math.pow(10, cfg.onsetDb / 10);
  const dipRatio = Math.pow(10, -cfg.dipDb / 10);

  // observation cadence: seconds per observation, derived at runtime
  // from chunk length (chunks are ~25 ms in production; tests may vary)
  let chunkCounter = 0;
  let obsPerSec = null;

  // tracks: { id, freq, dev, power, pw, refPow, hits, firstObs, noteObs,
  //           lastSeenObs, active, onsetBorn, pend }
  let tracks = [];
  let obsIndex = 0;
  let nextTrackId = 1;
  const energyHist = [];   // band energy of recent observations (onset rule)

  let cascade = [];        // [{ id, freq, biquad }], ascending track id

  // ---- in-sound latch + sound-offset events (2026-10-04, see header) ----
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
  const chunkHist = [];    // chunk energies, last onsetHistSec (onset reference)
  const chunkRecent = [];  // chunk energies, last latchReleaseSec (release/offset level)
  const chunkMaxRing = []; // chunk energies, last 1 s + latchReleaseSec (offset reference)
  let sawSound = false, lastChunkE = 0;
  let latched = false;     // in a sound that began at an onset and has not ended
  let latchFloorChunk;     // pre-onset floor, chunk units (undefined: unknown)
  let latchFloorObs;       // pre-onset floor, observation units
  let released = false;    // latch released since the last observation
  let offsetFired = false, offsetArmed = true;

  function chunkStep(chunk) {
    // exact digital silence BEFORE the stream's first real audio carries no
    // level information and must not become the onset reference: a room hum
    // that is simply PRESENT when audio starts flowing would otherwise read
    // as switching on (onset-born, 20 s). Later digital silence is a floor.
    let raw2 = 0;
    for (let i = 0; i < chunk.length; i++) raw2 += chunk[i] * chunk[i];
    if (raw2 / chunk.length >= 1e-12) sawSound = true;
    if (!chunkScratch || chunkScratch.length !== chunk.length) chunkScratch = new Float32Array(chunk.length);
    chunkScratch.set(chunk);
    for (const f of bandFilters) f.processInPlace(chunkScratch);
    let e = 0;
    for (let i = 0; i < chunkScratch.length; i++) e += chunkScratch[i] * chunkScratch[i];
    e = Math.max(1e-10, e / chunkScratch.length);
    lastChunkE = e;
    const histLen = Math.max(2, Math.round(cfg.onsetHistSec * sampleRate / chunk.length));
    const relLen = Math.max(1, Math.round(cfg.latchReleaseSec * sampleRate / chunk.length));
    // chunk-level onset (25 ms resolution): catches onsets the 512 ms
    // observation windows smear — syllables after short gaps, phonation
    // starting in the first observation window of the stream
    if (chunkHist.length >= 2 && !latched) {
      let mn = Infinity;
      for (const v of chunkHist) if (v < mn) mn = v;
      if (e >= mn * onsetRatio) { latched = true; latchFloorChunk = mn; chunkRecent.length = 0; }
    }
    if (sawSound) { chunkHist.push(e); if (chunkHist.length > histLen) chunkHist.shift(); }
    chunkRecent.push(e); if (chunkRecent.length > relLen) chunkRecent.shift();
    // sound offset: the last latchReleaseSec sits >= offsetDb below the
    // loudest chunk of the preceding second (a breath, even when audible
    // inhalation keeps the level above the pre-onset floor). Re-armed once
    // the level is back within offsetDb/2 of that maximum.
    const maxLen = Math.round(sampleRate / chunk.length);
    chunkMaxRing.push(e); if (chunkMaxRing.length > maxLen + relLen) chunkMaxRing.shift();
    let recentMean = 0;
    if (chunkRecent.length >= relLen) {
      for (const v of chunkRecent) recentMean += v;
      recentMean /= chunkRecent.length;
      let mx = 0;
      for (let i = 0; i < chunkMaxRing.length - relLen; i++) if (chunkMaxRing[i] > mx) mx = chunkMaxRing[i];
      if (offsetArmed && mx > 0 && recentMean <= mx * Math.pow(10, -cfg.offsetDb / 10)) { offsetFired = true; offsetArmed = false; }
      else if (!offsetArmed && e >= mx * Math.pow(10, -cfg.offsetDb / 20)) offsetArmed = true;
      // latch release: back within onsetDb of the pre-onset floor
      if (latched && latchFloorChunk !== undefined && recentMean <= latchFloorChunk * onsetRatio) { latched = false; released = true; }
    }
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
    const onsetHistObs = Math.ceil(cfg.onsetHistSec * (obsPerSec ?? 10));
    const onsetNow = energyHist.length > 1 && bandEnergy >= minEnergy * onsetRatio;
    if (onsetNow && !latched) {
      latched = true; latchFloorObs = minEnergy; chunkRecent.length = 0;
      let mn = Infinity;
      for (const v of chunkHist) if (v < mn) mn = v;
      // chunk floor only when the chunk history actually holds the pre-onset
      // level (it does not when the stream began with digital silence)
      latchFloorChunk = mn < Infinity && lastChunkE >= mn * onsetRatio ? mn : undefined;
    } else if (latched && latchFloorChunk === undefined && bandEnergy <= latchFloorObs * onsetRatio) {
      latched = false; released = true;
    }
    const inSound = onsetNow || latched;
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
        // that production never promoted — measured on session 05-07.)
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
        tracks.push({ id: nextTrackId++, freq: pk.freq, dev: 0, power: pk.power, pw: [], hits: 1, firstObs: obsIndex, noteObs: obsIndex, lastSeenObs: obsIndex, active: false, _seen: true, onsetBorn: inSound, pend: 0 });
      }
    }

    // per-track power reference: median of the last 9 sighting powers (a
    // decaying max was inflated by speech harmonics beating with a hum line,
    // which then read as "dipped" in the next pause)
    for (const t of tracks) {
      if (t._seen) { t.pw.push(t.power); if (t.pw.length > 9) t.pw.shift(); }
      const sp = [...t.pw].sort((a, b) => a - b);
      t.refPow = sp[Math.floor(sp.length / 2)] ?? t.power;
    }
    // new-note re-births of unpromoted onset-born tracks (2026-10-04) restart
    // the onset-born DELAY clock (noteObs) only — duty keeps the track's whole
    // history, so a weak, intermittently masked hum line keeps its diluted
    // duty (restarting firstObs/hits too promoted the session-05-07 room-hum
    // line at 440 s, where production never notched; -3.6 pp posted there):
    //  - latch released (band energy back near the pre-onset floor): such a
    //    line cannot be an interferer that switched on with the sound — it
    //    would hold the energy above that floor;
    //  - sound offset: within offsetObs observations the line is gone or
    //    >= dipDb under its median power WHILE the band is >= dipDb under its
    //    recent max (a hum line in a speech pause keeps its power; a hum line
    //    masked by speech has the band up).
    if (released) {
      for (const t of tracks) if (!t.active && t.onsetBorn) t.noteObs = obsIndex;
    }
    released = false;
    if (offsetFired) {
      for (const t of tracks) if (!t.active && t.onsetBorn) t.pend = cfg.offsetObs;
      offsetFired = false;
    }
    for (const t of tracks) {
      if (!(t.pend > 0)) continue;
      t.pend--;
      if (bandEnergy <= recentMax * dipRatio && (!t._seen || t.power <= t.refPow * dipRatio)) {
        t.noteObs = obsIndex; t.pend = 0;
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
      // onset-born: timed from the current note (latest re-birth)
      const timed = t.onsetBorn ? obsIndex - Math.max(t.noteObs, t.firstObs) + 1 : span;
      // promote only on an observation that actually saw the peak (a note
      // that just ended must not promote on its trailing duty)
      if (!t.active && t._seen && timed >= (t.onsetBorn ? onsetMinObs : minObs) && duty >= cfg.promoteDuty) t.active = true;
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
