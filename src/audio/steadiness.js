// steadiness.js — live pitch-steadiness readout (2026-10-04).
//
// "How steadily is the voice holding pitch over the last second": the
// standard deviation, in semitones, of the pitch worker's POSTED pitch
// values over a rolling ~1 s window — the 1-s pitch SD tracked in voice
// training. Pure module (no React, no worker globals); the hook feeds it
// every pitch-worker message, reads it once per DSP frame, and publishes
// it with its other ~5 fps throttled readouts.
//
// Recipe (decision data: measurements/steadiness-readout-2026-10-04.md;
// background: measurements/pitch-precision-steadiness-2026-10-04.md):
//   * Source = posted worker values, not the painted trace or readout.
//     The display median-3 shrinks real wobble (painted SD ~0.88-0.94 of
//     the reference) and the hold bridge paints constant values through
//     gaps, which makes a window look steadier than the voice was.
//   * Every message enters the window, voiced or not, so the coverage
//     gate sees the gaps: a window reports only when enough of it is
//     voiced (minCoverage of the expected message count) and enough
//     values survive the trim (minValues).
//   * Robust trim around the window median (trimmedSpread): octave-class
//     and voicing-boundary frames otherwise dominate the SD. A window the
//     trim cannot clean up (a register switch, an octave-error run) is not
//     reported ("—") rather than reported as a wrong "steady" number —
//     and it also ends the post-note hold (below), so the previous note's
//     reading is never shown across a switch.
//   * Population SD of 12·log2(f): unit-free (the same reading at 100 Hz
//     and 300 Hz for the same musical wobble), gender-symmetric.
//   * Deliberate vibrato and slides are reported as movement, as the
//     training 1-s SD does — the module does not try to separate them.
//   * The measured noise floor is ~0.05 st (synthetic held notes), so
//     readings below ~0.1 st are not distinguishable from each other;
//     formatSteadiness() renders them as "<0.1".
//
// Hot-path cost: push() is O(1) into preallocated ring buffers and does
// not allocate; the window statistic (one sort of <= ~60 values into a
// preallocated scratch array) runs on the first read() after new
// messages (updateSec 0) — the hook reads once per DSP frame. read()
// allocates only a small result object when the reading changes.

// Post-voice dim hold (seconds). 0 = off: the user chose a live-only
// readout (2026-10-04, measurement file §10). After the voice stops the
// reading clears to "—" as soon as the window's voiced coverage drops
// below minCoverage (~0.4 s after the last voiced frame with the 1 s
// window); nothing is shown dimmed. Set > 0 to re-enable the hold.
export const HOLD_SEC = 0;

// Why trimmedSpread returned null (written to its optional `info` arg).
export const SPREAD_OK = "ok";
export const SPREAD_FEW = "few";     // fewer than minValues values (before or after the trim)
export const SPREAD_REFUSED = "refused"; // the two-stage trim refused the window

export const STEADINESS_DEFAULTS = Object.freeze({
  // Rolling window length (audio seconds).
  windowSec: 1.0,
  // Nominal pitch-message cadence (one per 25 ms capture chunk). The
  // coverage denominator is max(messages in window, windowSec / this),
  // so missing messages (warm-up, a stalling worker) count as unvoiced.
  expectedHopSec: 0.025,
  // Minimum voiced fraction of the window.
  minCoverage: 0.6,
  // Minimum number of values left after the trim.
  minValues: 8,
  // Inner trim half-width around the window median (semitones).
  trimSemitones: 3,
  // Outer (octave-class) trim, used when the inner trim would drop more
  // than maxTrimFraction (a genuinely wide window). null disables.
  wideTrimSemitones: 6,
  // Max fraction the inner trim may drop for its SD to be the reading.
  maxTrimFraction: 0.1,
  // Max fraction the outer trim may drop; beyond it the window is not
  // reported (null = same as maxTrimFraction).
  maxWideTrimFraction: 0.15,
  // Recompute at most this often (audio seconds); 0 = on the first read()
  // after new messages (the hook reads once per DSP frame).
  updateSec: 0,
  // EMA weight of the newest reading (1 = no display smoothing).
  emaAlpha: 1,
  // After the window stops qualifying for lack of voiced coverage (the
  // voice stopped or went sparse), keep showing the last reading
  // (flagged held, rendered dim) for this long, so a note can be read
  // after it ends. A trim refusal with coverage OK (register switch,
  // octave-error run during continuous phonation) does NOT hold: it
  // clears the reading to "—". 0 disables (the default, HOLD_SEC).
  holdSec: HOLD_SEC,
});

const CAPACITY = 512; // > windowSec / message interval for any sane cadence

// One trim stage: SD of the values within `width` of the median `med`
// (sorted `s`, length n), written into `out` (reused, no allocation).
function trimStage(s, n, med, width, out) {
  let k = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(s[i] - med) <= width) { k++; sum += s[i]; }
  }
  out.kept = k;
  out.dropped = (n - k) / n;
  if (k < 2) { out.sd = NaN; return out; }
  const mean = sum / k;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(s[i] - med) <= width) { const d = s[i] - mean; ss += d * d; }
  }
  out.sd = Math.sqrt(ss / k);
  return out;
}
const stageA = { sd: NaN, kept: 0, dropped: 0 };
const stageB = { sd: NaN, kept: 0, dropped: 0 };
function done(info, sd, reason) {
  if (info) info.reason = reason;
  return sd;
}
const pickOpt = (opts, k) => (opts && opts[k] !== undefined ? opts[k] : STEADINESS_DEFAULTS[k]);

// Population SD (semitones) of `values[0..n)` after the robust trim, or
// null if the window does not qualify. `scratch` is a Float64Array of at
// least n (sorted in place). If `info` is an object, info.reason is set
// to SPREAD_OK, SPREAD_FEW or SPREAD_REFUSED (the tracker holds the last
// reading on SPREAD_FEW like a coverage failure, but clears it on
// SPREAD_REFUSED). Exported for tests and offline scoring.
//
// Two stages around the window median:
//   1. inner trim (trimSemitones): if it drops at most maxTrimFraction of
//      the values, its SD is the reading — a steady-ish window with a few
//      octave-class or voicing-boundary outliers.
//   2. otherwise the window genuinely spreads wider (intonation, a slide):
//      the outer trim (wideTrimSemitones, octave-class values only) is
//      used, unless it drops more than maxWideTrimFraction — then the
//      window is a register switch or an octave-error run, and null.
//      wideTrimSemitones null disables stage 2 (stage-1 failure = null).
export function trimmedSpread(values, n, opts = STEADINESS_DEFAULTS, scratch = null, info = null) {
  const trimSemitones = pickOpt(opts, "trimSemitones");
  const wideTrimSemitones = pickOpt(opts, "wideTrimSemitones");
  const maxTrimFraction = pickOpt(opts, "maxTrimFraction");
  const maxWideTrimFraction = pickOpt(opts, "maxWideTrimFraction");
  const minValues = pickOpt(opts, "minValues");
  if (n < minValues || n === 0) return done(info, null, SPREAD_FEW);
  // Sorted copy of values[0, n) in the scratch array (`values` is not
  // modified; without a large-enough scratch this allocates). Insertion
  // sort: n is ~40 and it sorts only the used prefix without a view.
  const s = scratch && scratch.length >= n ? scratch : new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    let j = i - 1;
    while (j >= 0 && s[j] > v) { s[j + 1] = s[j]; j--; }
    s[j + 1] = v;
  }
  const med = n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  const a = trimStage(s, n, med, trimSemitones, stageA);
  if (a.dropped <= maxTrimFraction) return a.kept >= minValues ? done(info, a.sd, SPREAD_OK) : done(info, null, SPREAD_FEW);
  if (!(wideTrimSemitones > trimSemitones)) return done(info, null, SPREAD_REFUSED);
  const b = trimStage(s, n, med, wideTrimSemitones, stageB);
  const maxWide = typeof maxWideTrimFraction === "number" ? maxWideTrimFraction : maxTrimFraction;
  if (b.dropped <= maxWide) return b.kept >= minValues ? done(info, b.sd, SPREAD_OK) : done(info, null, SPREAD_FEW);
  return done(info, null, SPREAD_REFUSED);
}

export function hzToSemitones(hz) {
  return 12 * Math.log2(hz);
}

// Rolling tracker. push(pitchHz | null, timeSec) for EVERY pitch message
// (null = unvoiced); read() returns { value: semitones | null, held }.
export function createSteadinessTracker(options = {}) {
  const cfg = { ...STEADINESS_DEFAULTS, ...options };
  const times = new Float64Array(CAPACITY);
  const semis = new Float64Array(CAPACITY); // NaN = unvoiced
  const valueBuf = new Float64Array(CAPACITY);
  const scratch = new Float64Array(CAPACITY);
  const expectedCount = cfg.windowSec / cfg.expectedHopSec;
  const info = { reason: SPREAD_OK };
  const NONE = Object.freeze({ value: null, held: false });
  let head = 0;   // index of the oldest entry
  let count = 0;
  let latestT = -Infinity;
  let lastComputeT = -Infinity;
  let dirty = false;
  let fresh = null;       // latest qualifying reading (after EMA) or null
  let lastValid = null;
  let lastValidT = -Infinity;
  let result = NONE;

  function reset() {
    head = 0; count = 0;
    latestT = -Infinity; lastComputeT = -Infinity; dirty = false;
    fresh = null; lastValid = null; lastValidT = -Infinity;
    result = NONE;
  }

  function push(pitchHz, timeSec) {
    if (typeof timeSec !== "number" || !Number.isFinite(timeSec)) return;
    // Clock went backwards (new capture source): start over.
    if (timeSec < latestT - 0.5) reset();
    if (count === CAPACITY) { head = (head + 1) % CAPACITY; count--; }
    const i = (head + count) % CAPACITY;
    times[i] = timeSec;
    semis[i] = typeof pitchHz === "number" && pitchHz > 0 ? hzToSemitones(pitchHz) : NaN;
    count++;
    if (timeSec > latestT) latestT = timeSec;
    // Evict entries that left the window.
    const cutoff = latestT - cfg.windowSec;
    while (count > 0 && times[head] <= cutoff + 1e-9) { head = (head + 1) % CAPACITY; count--; }
    dirty = true;
  }

  function compute() {
    let nAll = 0, nV = 0;
    for (let j = 0; j < count; j++) {
      const i = (head + j) % CAPACITY;
      nAll++;
      const v = semis[i];
      if (v === v) valueBuf[nV++] = v; // not NaN
    }
    const denom = Math.max(nAll, expectedCount);
    let sd = null;
    let refused = false;
    if (nV / denom >= cfg.minCoverage) {
      sd = trimmedSpread(valueBuf, nV, cfg, scratch, info);
      refused = info.reason === SPREAD_REFUSED;
    }
    if (sd !== null) {
      fresh = fresh !== null && cfg.emaAlpha < 1 ? cfg.emaAlpha * sd + (1 - cfg.emaAlpha) * fresh : sd;
      lastValid = fresh; lastValidT = latestT;
      setResult(fresh, false);
    } else if (refused) {
      // Enough voiced audio but the trim cannot clean the window up: a
      // register switch / octave-error run during continuous phonation.
      // Show "—", and drop the old note's reading so it is not held
      // across the switch.
      fresh = null; lastValid = null; lastValidT = -Infinity;
      result = NONE;
    } else {
      // Too little voiced audio (the voice stopped / went sparse): hold
      // the last reading, dimmed, for holdSec.
      fresh = null;
      if (lastValid !== null && latestT - lastValidT <= cfg.holdSec) setResult(lastValid, true);
      else result = NONE;
    }
  }

  function setResult(value, held) {
    if (result.value !== value || result.held !== held) result = { value, held };
  }

  function read() {
    if (dirty && latestT - lastComputeT >= cfg.updateSec - 1e-9) {
      compute();
      lastComputeT = latestT;
      dirty = false;
    }
    return result;
  }

  return { push, read, reset, config: cfg };
}

// Display string for a reading in semitones: one decimal (the measured
// agreement with Praat is ~0.1 st, so a second decimal would be noise),
// "<0.1" below the noise floor, null for no reading.
export function formatSteadiness(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0.1) return "<0.1";
  return value < 9.95 ? value.toFixed(1) : value.toFixed(0);
}
