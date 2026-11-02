// cueStripModel.js — the Dashboard cue strip's pure logic (no React), so the
// geometry, the direction highlight, the dots' colours and fills, the trails,
// the row states, the header words and the screen-reader summaries are
// unit-testable in Node (tests/audio/cue-strip-model-test.js).
//
// Two rows (2026-10-11); both put the typically-men end on the LEFT.
//   pitch      log Hz 75–320; bands = typical adult men 85–155 / women
//              165–255 Hz (the training-direction targets, which are those
//              ranges — trainingDirection.js PITCH_TARGETS); the dot AND the
//              header number are the 1.5 s pitch LEVEL the target is judged
//              on. On / off target is shown by colour AND fill (hollow dot
//              when off) AND a word ("on target" / "↑ higher" / "↓ lower").
//   resonance  u (0 = typical LibriSpeech man, 1 = typical woman), −1.0…2.2;
//              bands = 10th–90th percentile of individual 5 s readouts of
//              20 + 20 LibriSpeech readers through the production path
//              (public/resonance-lab/cue-bands.json; typical speakers' dots
//              fall inside their own band ~80 % of the time, men and women
//              alike); approximate in absolute position, so dashed and never
//              judged. The header says how far the dot is from where you
//              started (the validated use); a slow trail (one sample per
//              2 s of live speech, 15 samples: ~30 s of speech, about the
//              last 40 s with its pauses) shows the drift.
//   (clarity)  HIDDEN since 2026-10-11 (user decision): the third row,
//              "Clarity · approx." (raw CPP in σ from the session's own
//              start; "Vocal weight" until 2026-10-11), is gone from the
//              strip until a measure passes its test — the pre-registered
//              clarity study failed (measurements/clarity-cue-2026-10-08.md)
//              and the CPP pipeline behind it is retired
//              (measurements/vocal-weight-pipeline-retire-2026-10-11.md).
//              Its model code (clarityRowState / clarityHeader) is in git
//              history (cue-strip 31ffe58).
// Phone-quality audio (2026-10-19): while the resonance worker's narrowband
// detector is on (snap.narrowband.on), the resonance row is "narrowband": no
// dot, no trail, no start ring, only the notice NARROWBAND_NOTICE; pitch is
// untouched. measurements/resonance-narrowband-2026-10-19.md
// Resonance row hold (cueRowStates resonanceHold): where the plain rule says
// "idle", the row keeps its position (dimmed) instead, so the trail survives
// short pauses and the ~130 ms idle blink when speech resumes; it never
// shows "keep talking…" from the hold. The wired hold is K4,
// createVoiceHoldRef (narrower-hold round, confirmed on fresh data
// 2026-11-01; measurements/resonance-row-hold-narrow-2026-11-01.md): it
// bridges the blink and holds up to 5 s into a pause only after ticks of
// the user's own voice (>= 10 dB over the room and near the voice's own
// recent level), so a room within ~5 dB of the voice, or a voice that drops
// > ~6 dB below its own last-minute level, still clears the trail. C1,
// createResonanceHold (5 s after any shown voice, any noise floor; user
// decision 2026-10-28, measurements/resonance-row-hold-2026-10-28.md),
// failed its noise guards and is only the harness's reference arm now; K1–K3
// and K5 below are the round's other candidates, kept for the harness and
// the tests. Each candidate is a factory whose tick answers the same
// resonanceHold flag from the tick's flags, the throttled DSP level and the
// worker's snapshot (§3 of that note).
// Direction highlight: the same element and style for every direction,
// only { low, high } changes; none for "Just exploring" / unanswered.
// Only the pitch dot is coloured on / off target (statusColor(pitchStatus(...)),
// the F0 readout's rule); the resonance dot is always neutral.
// measurements/cue-strip-review-fixes-2026-10-07.md

import { COLORS, CUE_AXES, SILENCE_HOLD_MS, statusColor } from "../utils/constants.js";
import {
  PITCH_TARGETS,
  pitchTargetFor,
  pitchStatus,
  resonanceTargetFor,
  resonanceU,
} from "../utils/trainingDirection.js";
import { VTLN_CLAMP_EDGE } from "../resonance/resonanceCue.js";
import { SILENCE_THRESHOLD_DB } from "../audio/pitchGate.js";

export const CUES = ["pitch", "resonance"];
export const TRAIL_LEN = 8;
export const TRAIL_EVERY_MS = 250;
// Resonance changes over seconds (5 s readout): a slower, longer trail.
// One per 2 s of live speech, 15: ~30 s of speech, about the last 40 s with
// its pauses with the K4 hold (measurements/resonance-row-hold-narrow-2026-11-01.md:
// median age of the oldest point 39.75 s on fresh clean speech).
export const RESONANCE_TRAIL = Object.freeze({ n: 15, everyTicks: 8 });

// ---- axes: value -> fraction of the axis width [0, 1], plus where it fell
function frac(cue, v) {
  const a = CUE_AXES[cue];
  if (v == null || !Number.isFinite(v)) return null;
  const f = a.log ? (Math.log(v) - Math.log(a.min)) / (Math.log(a.max) - Math.log(a.min)) : (v - a.min) / (a.max - a.min);
  return f;
}
/** -> { x: 0..1, beyond: -1 | 0 | 1 } or null. beyond: pinned at an end. */
export function axisPos(cue, v, { clamp = 0 } = {}) {
  const f = frac(cue, v);
  if (f === null) return null;
  const beyond = clamp !== 0 ? clamp : f < 0 ? -1 : f > 1 ? 1 : 0;
  const x = beyond < 0 ? 0 : beyond > 0 ? 1 : f;
  return { x, beyond };
}
/** A { low, high } range on a cue's axis -> { x0, x1 } fractions (clipped), or null. */
export function rangeOnAxis(cue, range) {
  if (range == null) return null;
  const a = frac(cue, range.low), b = frac(cue, range.high);
  const x0 = Math.max(0, Math.min(1, a)), x1 = Math.max(0, Math.min(1, b));
  return x1 > x0 ? { x0, x1 } : null;
}
export const ticks = (cue) => (CUE_AXES[cue].ticks ?? []).map((v) => ({ v, x: frac(cue, v) }));

// ---- population bands
/**
 * The resonance reference the strip draws with: u units from reference.json
 * "vtln" (per-speaker medians), the cue's bands from cue-bands.json (the
 * distribution of individual 5 s readouts), and the per-speaker bands kept
 * for the androgynous highlight (the gap between typical men's and women's
 * readings). cueBands null -> the per-speaker bands (older asset set).
 */
export function cueResonanceRef(vtlnRef, cueBands = null) {
  if (!vtlnRef) return null;
  if (!cueBands?.men || !cueBands?.women) return vtlnRef;
  return { ...vtlnRef, men: cueBands.men, women: cueBands.women, speakerBands: { men: vtlnRef.men, women: vtlnRef.women } };
}
/** -> { men: { x0, x1, xm }, women: { x0, x1, xm } } | null. */
export function bandsFor(cue, vtlnRef = null) {
  if (cue === "pitch") {
    const geo = (t) => { const r = rangeOnAxis("pitch", t); return { ...r, xm: frac("pitch", Math.sqrt(t.low * t.high)) }; };
    return { men: geo(PITCH_TARGETS.masculine), women: geo(PITCH_TARGETS.feminine) };
  }
  if (cue === "resonance" && vtlnRef) {
    // Tick at the typical speaker (u 0 / u 1: the per-speaker medians).
    const geo = (q, um) => ({ ...rangeOnAxis("resonance", { low: resonanceU(vtlnRef, q.q10), high: resonanceU(vtlnRef, q.q90) }), xm: frac("resonance", um) });
    return { men: geo(vtlnRef.men, 0), women: geo(vtlnRef.women, 1) };
  }
  return null;
}

// ---- direction highlight (one style for every direction)
export const HIGHLIGHT_STYLE = Object.freeze({ fill: COLORS.targetBand, stroke: COLORS.targetBandBorder, strokeWidth: 1, rx: 4 });
/** The highlighted range in the cue's own units, or null (no highlight). */
export function targetRangeFor(cue, direction, vtlnRef = null) {
  if (cue === "pitch") { const t = pitchTargetFor(direction); return t ? { low: t.low, high: t.high } : null; }
  if (cue === "resonance") return resonanceTargetFor(direction, vtlnRef);
  return null;
}
/** -> { low, high, x0, x1, style } | null */
export function highlightFor(cue, direction, vtlnRef = null) {
  const r = targetRangeFor(cue, direction, vtlnRef);
  const g = rangeOnAxis(cue, r);
  return r && g ? { low: r.low, high: r.high, ...g, style: HIGHLIGHT_STYLE } : null;
}

// ---- dot colour: only pitch judges
export function dotColor(cue, { pitchLevel = null, direction = null } = {}) {
  if (cue === "pitch") return statusColor(pitchStatus(pitchLevel, pitchTargetFor(direction)));
  return COLORS.neutralTrace;
}
/** Hollow (outline-only) dot = off target — the non-colour channel (WCAG 1.4.1). */
export function dotHollow(cue, { pitchLevel = null, direction = null } = {}) {
  return cue === "pitch" && pitchStatus(pitchLevel, pitchTargetFor(direction)) === "out";
}
/**
 * The pitch row's status word (the same words in every direction):
 * "on target" | "↑ higher" | "↓ lower" | null (no target or no level).
 * Only the band is on target: past it in the direction of travel reads
 * like any other level on that side (user decision 2026-10-19).
 */
export function pitchCueWord(pitchLevel, direction) {
  const t = pitchTargetFor(direction);
  const st = pitchStatus(pitchLevel, t);
  if (st === "in") return "on target";
  if (st === "out") return pitchLevel < t.low ? "↑ higher" : "↓ lower";
  return null;
}

// ---- row states (CueStrip data-state)
// pitch:     idle | holding | live
// resonance: starting | restarting | reload | unavailable | paused | narrowband | idle | sustained | warming | settling | holding | live
export function pitchRowState({ voiced, holding, pitchLevel }) {
  if (voiced && pitchLevel != null) return "live";
  if (voiced || holding) return "holding";
  return "idle";
}
export const RESONANCE_WARM_S = 2;
export const NARROWBAND_NOTICE = "Phone-quality audio — paused";
export const NARROWBAND_INFO =
  "Your microphone sound is cut off above about 4 kHz, as on a phone call or a narrowband Bluetooth headset. " +
  "Resonance readings need the fuller sound, so they are paused. Pitch still works. A wired or wideband " +
  "microphone fixes this.";
export function resonanceRowState({ workerStatus, snap, voiced, holding }) {
  if (workerStatus === "error") return "unavailable";
  // A runtime error the worker recovers from in ~2 s of audio, and a
  // worker / asset file that failed to load (a newer deploy: a reload
  // fixes it) — neither is about the device (2026-10-19 review F2-1).
  if (workerStatus === "restarting") return "restarting";
  if (workerStatus === "reload") return "reload";
  if (workerStatus === "overloaded") return "paused";
  if (workerStatus !== "ready" || !snap) return "starting";
  // Phone-quality audio: shown through pauses too (the detector's state does
  // not age without voice); clears when the worker's detector turns off.
  if (snap.narrowband?.on === true) return "narrowband";
  if (!voiced && !holding) return "idle";
  if (snap.verdict === "sustained") return "sustained";
  // The worker withholds u until its narrowband detector has decided; keep
  // warming on the detector state too, so no position shows before it can.
  if ((snap.voicedS ?? 0) < RESONANCE_WARM_S || snap.u == null || snap.narrowband?.decided === false) return "warming";
  if ((snap.fill ?? 0) < 1) return "settling";
  // Back after a long pause (resonanceCue IDLE_RESET_S): the readout still
  // holds the earlier speech until ~2 s of new voiced speech is in.
  if ((snap.sinceResumeS ?? Infinity) < RESONANCE_WARM_S) return "settling";
  if (!voiced) return "holding";
  return "live";
}
/**
 * C1, the resonance row's first hold clock (2026-10-28 user decision, built
 * 2026-11-01; measurements/resonance-row-hold-2026-10-28.md). It failed its
 * noise guards and is no longer wired (the strip uses K4,
 * createVoiceHoldRef, below); kept as the harness's reference arm and for
 * the tests. Fed the gated pitchVoiced and the time at each 4 Hz tick, it
 * answers whether at most holdMs have passed since a tick last saw it true
 * (that tick included). CueStrip keeps a hold's answer in its tick view and
 * every render uses the latest tick's answer.
 * Why: the hook's own hold (pitchHolding) exists only on its silence-gate
 * path (50 ms intensity < -50 dBFS); in a pause that hears the room the row
 * went idle ~0.8 s in, and on every device the first ~130 ms of resumed
 * speech read idle too (the "onset blink"), and idle clears the trail —
 * measurements/resonance-phone-vs-desktop-2026-10-28.md §5.
 */
export const RESONANCE_HOLD_MS = SILENCE_HOLD_MS; // 5 s, the pitch readout's silence hold
export function createResonanceHold(holdMs = RESONANCE_HOLD_MS) {
  let last = -Infinity;
  return {
    /** One tick: the gated pitchVoiced at nowMs (monotonic ms). */
    tick(pitchVoiced, nowMs) {
      if (pitchVoiced) last = nowMs;
      return nowMs - last <= holdMs;
    },
    clear() { last = -Infinity; },
  };
}

// ---- narrower holds: candidates K1–K5 (2026-11-01, pre-registered;
// measurements/resonance-row-hold-narrow-2026-11-01.md §3, whose code blocks
// are normative and transcribed here line for line). K4 (createVoiceHoldRef)
// passed the fresh confirmation (2026-11-01) and is the one CueStrip wires;
// the others stay for the harness and the tests. Every factory's tick has one signature,
//   tick({ pitchVoiced, pitchHolding, pitchLevel, intensity, snap, workerStatus, hasRef }, nowMs)
// and is pure (the clock is passed in). intensity is the hook's throttled
// `intensity`: the 50 ms full-band DSP level (dBFS) of the frame that fired
// the latest 200 ms state update; null when not listening / no frame yet.
// The common preamble (§3.1) runs first in each: null / NaN intensity resets
// the factory to its initial state and answers false; a worker that is not
// "ready" answers false and changes nothing; the level is clamped at
// -120 dBFS (digital silence, -Infinity, reads -120); rBase = the plain
// rule's resonance row (cueRowStates without a hold) — computed only where
// the rule reads it (K2–K4; cueRowStates is pure, so leaving it out of K1
// and K5 changes nothing). The answer acts only where that plain rule says
// "idle" and never shows "warming" (cueRowStates resonanceHold).

/** §3.1 quantile: the sorted copy, interpolated at p·(n − 1). */
export function holdQuantile(a, p) {
  const s = [...a].sort((x, y) => x - y);
  const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
/** §3.1 median: the middle value of the sorted copy, or the mean of the two middle values. */
export function holdMedian(a) {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * K1 QB, the quiet-hold onset bridge (§3.2): the next two ticks after a tick
 * that showed the hook's own dim hold in a pause quieter than the silence
 * threshold, within 5 s of shown voice. Parameters (4): bridge 700 ms,
 * recency 5000 ms, level -50 dBFS, clamp -120 dBFS.
 */
export function createQuietOnsetBridge() {
  let lastV = -Infinity, lastArm = -Infinity;
  const reset = () => { lastV = -Infinity; lastArm = -Infinity; };
  return {
    tick({ pitchVoiced, pitchHolding, intensity, workerStatus }, nowMs) {
      if (intensity == null || Number.isNaN(intensity)) { reset(); return false; }
      if (workerStatus !== "ready") return false;
      const t = nowMs;
      const v = !!pitchVoiced, h = !!pitchHolding;
      const x = Math.max(-120, intensity);
      if (v) lastV = t;
      if (h && !v && x < SILENCE_THRESHOLD_DB && t - lastV <= SILENCE_HOLD_MS) lastArm = t;
      return t - lastArm <= 700;
    },
    clear: reset,
  };
}

/**
 * K2 VB, the own-voice-armed bridge (§3.3): the next two ticks after any
 * tick where the plain rule's resonance row was not idle, armed only by a
 * tick in the last 6 s that showed a voice >= 10 dB over the room (q20 of
 * the last 40 tick levels) while the worker was scoring. Parameters (8):
 * ring 40 ticks, at least 16 ticks, quantile 0.2, margin 10 dB, bridge
 * 700 ms, arming 6000 ms, clamp -120 dBFS, verdict set.
 */
export function createVoiceArmedBridge() {
  let L = [], lastQ = -Infinity, lastNI = -Infinity;
  const reset = () => { L = []; lastQ = -Infinity; lastNI = -Infinity; };
  return {
    tick({ pitchVoiced, pitchHolding, pitchLevel, intensity, snap, workerStatus, hasRef }, nowMs) {
      if (intensity == null || Number.isNaN(intensity)) { reset(); return false; }
      if (workerStatus !== "ready") return false;
      const t = nowMs;
      const v = !!pitchVoiced;
      const x = Math.max(-120, intensity);
      const rBase = cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap, workerStatus, hasRef }).resonance;
      L.push(x); if (L.length > 40) L.shift();
      const floor = L.length >= 16 ? holdQuantile(L, 0.2) : null;
      const own = v && floor !== null && x >= floor + 10
        && (snap?.verdict === "score" || snap?.verdict === "pause");
      if (own) lastQ = t;
      if (rBase !== "idle" && rBase !== "starting") lastNI = t;
      return t - lastNI <= 700 && t - lastQ <= 6000;
    },
    clear: reset,
  };
}

/**
 * K3 VH, the own-voice hold (§3.4): K2, plus a hold that each own-voice tick
 * extends to 1 s per own-voice tick in the last 5 s, at most 5 s.
 * Parameters (11): K2's 8, 1000 ms per tick, the 5000 ms cap, the 5000 ms
 * evidence window.
 */
export function createVoiceHold() {
  let L = [], Q = [], lastQ = -Infinity, lastNI = -Infinity, holdUntil = -Infinity;
  const reset = () => { L = []; Q = []; lastQ = -Infinity; lastNI = -Infinity; holdUntil = -Infinity; };
  return {
    tick({ pitchVoiced, pitchHolding, pitchLevel, intensity, snap, workerStatus, hasRef }, nowMs) {
      if (intensity == null || Number.isNaN(intensity)) { reset(); return false; }
      if (workerStatus !== "ready") return false;
      const t = nowMs;
      const v = !!pitchVoiced;
      const x = Math.max(-120, intensity);
      const rBase = cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap, workerStatus, hasRef }).resonance;
      L.push(x); if (L.length > 40) L.shift();
      const floor = L.length >= 16 ? holdQuantile(L, 0.2) : null;
      const own = v && floor !== null && x >= floor + 10
        && (snap?.verdict === "score" || snap?.verdict === "pause");
      if (own) {
        lastQ = t;
        Q = Q.filter((u) => u > t - 5000); Q.push(t);
        holdUntil = Math.max(holdUntil, t + Math.min(5000, 1000 * Q.length));
      }
      if (rBase !== "idle" && rBase !== "starting") lastNI = t;
      return (t - lastNI <= 700 && t - lastQ <= 6000) || t <= holdUntil;
    },
    clear: reset,
  };
}

/**
 * K4 VHR, K3 with an own-loudness reference (§3.5): an own-voice tick must
 * also be within 6 dB of the median of the loud shown ticks of the last 60 s
 * (the current tick included; at least 8). Parameters (14): K3's 11, the
 * 60000 ms window, at least 8 ticks, 6 dB.
 */
export function createVoiceHoldRef() {
  let L = [], R = [], Q = [], lastQ = -Infinity, lastNI = -Infinity, holdUntil = -Infinity;
  const reset = () => { L = []; R = []; Q = []; lastQ = -Infinity; lastNI = -Infinity; holdUntil = -Infinity; };
  return {
    tick({ pitchVoiced, pitchHolding, pitchLevel, intensity, snap, workerStatus, hasRef }, nowMs) {
      if (intensity == null || Number.isNaN(intensity)) { reset(); return false; }
      if (workerStatus !== "ready") return false;
      const t = nowMs;
      const v = !!pitchVoiced;
      const x = Math.max(-120, intensity);
      const rBase = cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap, workerStatus, hasRef }).resonance;
      L.push(x); if (L.length > 40) L.shift();
      const floor = L.length >= 16 ? holdQuantile(L, 0.2) : null;
      const marginOK = v && floor !== null && x >= floor + 10;
      if (marginOK) R.push({ t, x }); // before ref: the current tick counts
      R = R.filter((e) => e.t >= t - 60000);
      const ref = R.length >= 8 ? holdMedian(R.map((e) => e.x)) : null;
      const own = marginOK && (snap?.verdict === "score" || snap?.verdict === "pause")
        && ref !== null && x >= ref - 6;
      if (own) {
        lastQ = t;
        Q = Q.filter((u) => u > t - 5000); Q.push(t);
        holdUntil = Math.max(holdUntil, t + Math.min(5000, 1000 * Q.length));
      }
      if (rBase !== "idle" && rBase !== "starting") lastNI = t;
      return (t - lastNI <= 700 && t - lastQ <= 6000) || t <= holdUntil;
    },
    clear: reset,
  };
}

/**
 * K5 QP, hold while the pause stays quieter than the speech before it
 * (§3.6): support = a quiet tick (>= 8 dB below the median shown voice of
 * the last 2 s, within 5 s of it) where the hook's own hold is on, or the
 * second of two consecutive quiet ticks; each support tick bridges the next
 * two ticks; never more than 5 s after the last shown-voice tick.
 * Parameters (6): bridge 700 ms, recency 5000 ms, window 2000 ms, 8 dB,
 * clamp -120 dBFS, two consecutive ticks.
 */
export function createQuietPauseHold() {
  let lastV = -Infinity, lastSupport = -Infinity, V = [], prevQ = false;
  const reset = () => { lastV = -Infinity; lastSupport = -Infinity; V = []; prevQ = false; };
  return {
    tick({ pitchVoiced, pitchHolding, intensity, workerStatus }, nowMs) {
      if (intensity == null || Number.isNaN(intensity)) { reset(); return false; }
      if (workerStatus !== "ready") return false;
      const t = nowMs;
      const v = !!pitchVoiced, h = !!pitchHolding;
      const x = Math.max(-120, intensity);
      if (v) { lastV = t; V.push({ t, x }); }
      V = V.filter((e) => e.t >= lastV - 2000);
      const voiceDb = V.length ? holdMedian(V.map((e) => e.x)) : null;
      const recent = t - lastV <= SILENCE_HOLD_MS;
      const q = !v && recent && voiceDb !== null && x <= voiceDb - 8;
      if (q && (h || prevQ)) lastSupport = t; // shown-voice ticks are never support
      prevQ = q;
      return recent && t - lastSupport <= 700;
    },
    clear: reset,
  };
}

/** The round's candidates by name (§2): the harness and the tests read this. */
export const RESONANCE_HOLD_CANDIDATES = Object.freeze({
  K1: createQuietOnsetBridge,
  K2: createVoiceArmedBridge,
  K3: createVoiceHold,
  K4: createVoiceHoldRef,
  K5: createQuietPauseHold,
});

/**
 * Both rows' states, as the strip shows them. Both rows read the pitch
 * display's own flags, pitchVoiced / pitchHolding (useAudioPipeline: the raw
 * voiced / holding, except while the voice gate hides the pitch — setting on,
 * detector ready, "no voice"). The resonance row read the raw flags until
 * 2026-10-21, so noise the pitch chain voiced took it out of "idle" ("keep
 * talking…" with nobody speaking) even with the gate on; user decision
 * 2026-10-21, measured in measurements/voice-gate-resonance-row-2026-10-21.md
 * (noise only: the row leaves "idle" 7.0 % of the time instead of 33.3 %;
 * speech: the same state on >= 99.9 % of the time, the same positions).
 * hasRef false: the reference bands are not loaded, so only the resonance
 * worker's own state can show (unavailable / paused / starting) — an error
 * is never hidden.
 * resonanceHold (the wired hold's answer: K4, createVoiceHoldRef, since
 * 2026-11-01; C1's createResonanceHold, 2026-10-28, in the harness's
 * reference arm only): where the resonance row
 * would be "idle", it takes the state it would have while holding —
 * "holding" (the dimmed thumb), "settling" or "sustained" — but never
 * "warming" ("keep talking…" with nobody speaking; a row with no position
 * stays idle). So the row differs from the plain rule only where that rule
 * says idle. The pitch row never reads it.
 */
export function cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap, workerStatus, hasRef = true, resonanceHold = false }) {
  const flags = { voiced: !!pitchVoiced, holding: !!pitchHolding };
  const rSnap = hasRef ? snap : null;
  let resonance = resonanceRowState({ ...flags, workerStatus, snap: rSnap });
  if (resonance === "idle" && resonanceHold) {
    const held = resonanceRowState({ voiced: false, holding: true, workerStatus, snap: rSnap });
    if (held !== "warming") resonance = held;
  }
  return {
    pitch: pitchRowState({ ...flags, pitchLevel }),
    resonance,
  };
}
/** The value a row's dot shows, in the cue's units (null = none). */
export function rowValue(cue, inputs) {
  if (cue === "pitch") return inputs.pitchLevel ?? null;
  if (cue === "resonance") return inputs.snap?.u ?? null;
  return null;
}
/** Resonance at the vtln clamp: -1 / 0 / +1 (pinned with a chevron). */
export const resonanceClamp = (snap) =>
  snap?.raw == null ? 0 : snap.raw >= VTLN_CLAMP_EDGE ? 1 : snap.raw <= -VTLN_CLAMP_EDGE ? -1 : 0;

// Dot opacity per state; null = no dot.
export function dotOpacity(state) {
  switch (state) {
    case "live": return 1;
    case "holding": return 0.5;
    case "settling": return 0.45;
    case "sustained": return 0.3;
    default: return null;
  }
}

// ---- trail: the last n samples, one every `everyTicks` 250 ms ticks while
// LIVE. Frozen (no samples) in any other state; cleared when the row goes
// idle and on any change into or out of "sustained" or "narrowband". (The
// resonance row's hold, K4, keeps it out of idle through the onset blink and
// for up to 5 s into a pause after the user's own voice, so its trail
// survives those; in a room within ~5 dB of the voice it still clears about
// 1 s into a pause — cueRowStates resonanceHold.)
export function createTrail(n = TRAIL_LEN, everyTicks = 1) {
  let pts = [];
  let lastState = null;
  let ticks = 0;
  return {
    /** One 250 ms tick. Returns the current points (oldest first). */
    tick(state, value) {
      const intoOut = lastState !== null && ((state === "sustained") !== (lastState === "sustained")
        || (state === "narrowband") !== (lastState === "narrowband"));
      // An already-empty trail stays the same array, so the memoised
      // columns do not re-render on every idle tick.
      if (state === "idle" || intoOut) { if (pts.length) pts = []; ticks = 0; }
      lastState = state;
      if (state === "live" && value != null && Number.isFinite(value)) {
        if (ticks % everyTicks === 0) {
          pts = [...pts, value];
          if (pts.length > n) pts = pts.slice(pts.length - n);
        }
        ticks++;
      }
      return pts;
    },
    points: () => pts,
    clear() { pts = []; lastState = null; ticks = 0; },
  };
}
/** Trail circle opacity, oldest 0.12 -> newest 0.45. */
export const trailOpacity = (i, len) => (len <= 1 ? 0.45 : 0.12 + ((0.45 - 0.12) * i) / (len - 1));

// ---- header text
// Resonance: the change from where you started (the validated use), with a
// deadband the size of a steady voice's own wobble (0.3 u; same-voice
// q10–q90 spread of the 5 s readout 0.28–0.65 u on resynthesised
// LibriSpeech runs, measurements/cue-strip-review-fixes-2026-10-07.md §3).
export const RESONANCE_CHANGE_DEADBAND = 0.3;
/** The start the header and the start ring use: the worker's shownStartU
 *  (startU once set), or startU from a post that has none. */
export const shownStart = (snap) => snap?.shownStartU ?? snap?.startU ?? null;
export function resonanceHeader(state, snap) {
  switch (state) {
    case "starting": return "starting…";
    case "restarting": return "restarting…";
    case "reload": return "unavailable — reload the page";
    case "unavailable": return "unavailable on this device";
    case "paused": return "paused — device busy";
    case "narrowband": return NARROWBAND_NOTICE;
    case "idle": return "—";
    case "sustained": return "needs running speech";
    case "warming": return "keep talking…";
    case "settling": return "settling…";
    default: {
      const p = axisPos("resonance", snap?.u, { clamp: resonanceClamp(snap) });
      if (p && p.beyond !== 0) return "beyond the scale";
      if (snap?.u == null) return "last ~5 s of speech";
      // The start: the median of the readouts collected so far, final after
      // ~12 s of voiced readouts (resonanceCue.js shownStartU, 2026-10-26).
      const start = shownStart(snap);
      if (start == null) return "finding your start…";
      const d = snap.u - start;
      if (Math.abs(d) < RESONANCE_CHANGE_DEADBAND) return "about where you started";
      return d > 0 ? "brighter than your start" : "darker than your start";
    }
  }
}
// ---- screen-reader summaries (one per row; CueStrip refreshes them at 1 Hz)
function bandWords(u, ref) {
  if (!ref || u == null) return null;
  const m = [resonanceU(ref, ref.men.q10), resonanceU(ref, ref.men.q90)];
  const w = [resonanceU(ref, ref.women.q10), resonanceU(ref, ref.women.q90)];
  const inM = u >= m[0] && u <= m[1], inW = u >= w[0] && u <= w[1];
  if (inM && inW) return "where the typical men's and women's bands overlap";
  if (inM) return "inside the typical men's band";
  if (inW) return "inside the typical women's band";
  if (u < m[0]) return "below the typical men's band";
  if (u > w[1]) return "above the typical women's band";
  return "between the typical men's and women's bands";
}
// A header that already ends a sentence ("finding your start…") gets no
// extra period (2026-10-07 UX review: "…." read aloud).
const sentence = (t) => (/[.…!?]$/.test(t) ? t : `${t}.`);
// "holding" = the dimmed thumb kept through a pause (pitch: the hook's 5 s
// silence hold or a brief dropout; resonance: the same, or the row's own
// hold, createVoiceHoldRef): the summary says it is the last reading, so a
// screen reader does not hear a held position as a live one (2026-11-02
// decision; screen-reader text only — the visible words are unchanged).
const LAST_READING = "last reading";
export function cueSummary(cue, { state, direction = null, pitchLevel = null, snap = null, vtlnRef = null } = {}) {
  const held = state === "holding";
  if (cue === "pitch") {
    if (state === "idle" || pitchLevel == null) return "Pitch: no voice right now.";
    const t = pitchTargetFor(direction);
    const hz = `Pitch level ${Math.round(pitchLevel)} Hz${held ? ` (${LAST_READING})` : ""}`;
    if (!t) return `${hz}.`;
    const st = pitchStatus(pitchLevel, t);
    const range = `${t.low} to ${t.high} Hz`;
    if (st === "in") return `${hz}, on target (${range}).`;
    return `${hz}, ${pitchLevel < t.low ? "below" : "above"} your target ${range}.`;
  }
  if (cue === "resonance") {
    // Idle: the header is a bare "—" on screen; read a phrase instead.
    if (state === "idle") return "Resonance (approximate): no voice right now.";
    if (state === "narrowband") return "Resonance (approximate): paused, phone-quality audio — the sound is cut off above about 4 kHz. Pitch still works.";
    if (state !== "live" && state !== "holding") return `Resonance (approximate): ${resonanceHeader(state, snap)}`;
    const w = bandWords(snap?.u, vtlnRef);
    return sentence(`Resonance (approximate${held ? `, ${LAST_READING}` : ""})${w ? `: ${w}` : ""}, ${resonanceHeader(state, snap)}`);
  }
  // Any other cue (the hidden clarity row, an unknown name): no sentence,
  // matching rowValue — a future row must add its own branch.
  return null;
}
