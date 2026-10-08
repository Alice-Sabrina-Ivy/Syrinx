// cueStripModel.js — the Dashboard cue strip's pure logic (no React), so the
// geometry, the direction highlight, the dots' colours and fills, the trails,
// the row states, the header words and the screen-reader summaries are
// unit-testable in Node (tests/audio/cue-strip-model-test.js).
//
// Three rows, one orientation: the typically-men end on the LEFT.
//   pitch      log Hz 75–320; bands = typical adult men 85–155 / women
//              165–255 Hz (the training-direction targets, which are those
//              ranges — trainingDirection.js PITCH_TARGETS); the dot AND the
//              header number are the 1.5 s pitch LEVEL the target is judged
//              on. On / off target is shown by colour AND fill (hollow dot
//              when off) AND a word ("in target" / "↑ higher" / "↓ lower").
//   resonance  u (0 = typical LibriSpeech man, 1 = typical woman), −1.0…2.2;
//              bands = 10th–90th percentile of individual 5 s readouts of
//              20 + 20 LibriSpeech readers through the production path
//              (public/resonance-lab/cue-bands.json; typical speakers' dots
//              fall inside their own band ~80 % of the time, men and women
//              alike); approximate in absolute position, so dashed and never
//              judged. The header says how far the dot is from where you
//              started (the validated use); a slow trail (one sample every
//              2 s, ~30 s) shows the drift.
//   weight     σ from the session's own first-30 s baseline, −3 (heavier)
//              … +3 (lighter); the dot is the ~5 s median level
//              (vocal-weight-level.js); no population bands.
// Direction highlight: the same element and style for every direction,
// only { low, high } changes; none for "Just exploring" / unanswered. Only
// the pitch dot is coloured on / off target (statusColor(pitchStatus(...)),
// the F0 readout's rule); resonance and weight dots are always neutral.
// measurements/cue-strip-review-fixes-2026-10-07.md

import { COLORS, CUE_AXES, statusColor } from "../utils/constants.js";
import {
  PITCH_TARGETS,
  pitchTargetFor,
  pitchStatus,
  resonanceTargetFor,
  resonanceU,
  weightRangeFor,
} from "../utils/trainingDirection.js";
import { VTLN_CLAMP_EDGE } from "../resonance/resonanceCue.js";

export const CUES = ["pitch", "resonance", "weight"];
export const TRAIL_LEN = 8;
export const TRAIL_EVERY_MS = 250;
// Resonance changes over seconds (5 s readout): a slower, longer trail.
export const RESONANCE_TRAIL = Object.freeze({ n: 15, everyTicks: 8 }); // one per 2 s, ~30 s

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
/** -> { men: { x0, x1, xm }, women: { x0, x1, xm } } | null (weight has none). */
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
  if (cue === "weight") return weightRangeFor(direction, CUE_AXES.weight.max);
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
 * "in target" | "↑ higher" | "↓ lower" | null (no target, no level, or past
 * the band in the direction of travel — shown neutrally).
 */
export function pitchCueWord(pitchLevel, direction) {
  const t = pitchTargetFor(direction);
  const st = pitchStatus(pitchLevel, t);
  if (st === "in") return "in target";
  if (st === "out") return pitchLevel < t.low ? "↑ higher" : "↓ lower";
  return null;
}

// ---- row states (CueStrip data-state)
// pitch:     idle | holding | live
// resonance: starting | unavailable | paused | idle | sustained | warming | settling | holding | live
// weight:    calibrating | idle | holding | live
export function pitchRowState({ voiced, holding, pitchLevel }) {
  if (voiced && pitchLevel != null) return "live";
  if (voiced || holding) return "holding";
  return "idle";
}
export const RESONANCE_WARM_S = 2;
export function resonanceRowState({ workerStatus, snap, voiced, holding }) {
  if (workerStatus === "error") return "unavailable";
  if (workerStatus === "overloaded") return "paused";
  if (workerStatus !== "ready" || !snap) return "starting";
  if (!voiced && !holding) return "idle";
  if (snap.verdict === "sustained") return "sustained";
  if ((snap.voicedS ?? 0) < RESONANCE_WARM_S || snap.u == null) return "warming";
  if ((snap.fill ?? 0) < 1) return "settling";
  // Back after a long pause (resonanceCue IDLE_RESET_S): the readout still
  // holds the earlier speech until ~2 s of new voiced speech is in.
  if ((snap.sinceResumeS ?? Infinity) < RESONANCE_WARM_S) return "settling";
  if (!voiced) return "holding";
  return "live";
}
export function weightRowState({ vocalWeight, voiced, holding }) {
  if (!vocalWeight?.baselineReady) return "calibrating";
  if (!voiced && !holding) return "idle";
  if (!voiced || vocalWeight.sigmaLevel == null) return "holding";
  return "live";
}

/** The value a row's dot shows, in the cue's units (null = none). */
export function rowValue(cue, inputs) {
  if (cue === "pitch") return inputs.pitchLevel ?? null;
  if (cue === "resonance") return inputs.snap?.u ?? null;
  return inputs.vocalWeight?.sigmaLevel ?? null;
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
// idle and on any change into or out of "sustained".
export function createTrail(n = TRAIL_LEN, everyTicks = 1) {
  let pts = [];
  let lastState = null;
  let ticks = 0;
  return {
    /** One 250 ms tick. Returns the current points (oldest first). */
    tick(state, value) {
      const intoOut = lastState !== null && (state === "sustained") !== (lastState === "sustained");
      if (state === "idle" || intoOut) { pts = []; ticks = 0; }
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
export function resonanceHeader(state, snap) {
  switch (state) {
    case "starting": return "starting…";
    case "unavailable": return "unavailable on this device";
    case "paused": return "paused — device busy";
    case "idle": return "—";
    case "sustained": return "needs running speech";
    case "warming": return "keep talking…";
    case "settling": return "settling…";
    default: {
      const p = axisPos("resonance", snap?.u, { clamp: resonanceClamp(snap) });
      if (p && p.beyond !== 0) return "beyond the scale";
      if (snap?.u == null) return "last ~5 s of speech";
      // The start reference is the median of the first ~12 s of voiced readouts.
      if (snap.startU == null) return "finding your start…";
      const d = snap.u - snap.startU;
      if (Math.abs(d) < RESONANCE_CHANGE_DEADBAND) return "about where you started";
      return d > 0 ? "brighter than your start" : "darker than your start";
    }
  }
}
// Weight: deadband 0.3 σ (the 5 s level's own same-voice wobble is
// ~0.67 σ q10–q90).
export const WEIGHT_DEADBAND = 0.3;
export function weightHeader(state, vocalWeight) {
  if (state === "calibrating") {
    const p = vocalWeight?.baselineProgress ?? 0;
    return vocalWeight?.cpp == null && p === 0 ? "Calibrating…" : `Calibrating ${Math.round(p * 100)} %`;
  }
  const s = vocalWeight?.sigmaLevel;
  if (state === "idle" || s == null) return "—";
  const a = Math.abs(s);
  if (a < WEIGHT_DEADBAND) return "about where you started";
  return `${a.toFixed(1)} σ ${s > 0 ? "lighter" : "heavier"} than your start`;
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
export function cueSummary(cue, { state, direction = null, pitchLevel = null, snap = null, vtlnRef = null, vocalWeight = null } = {}) {
  if (cue === "pitch") {
    if (state === "idle" || pitchLevel == null) return "Pitch: no voice right now.";
    const t = pitchTargetFor(direction);
    const hz = `Pitch level ${Math.round(pitchLevel)} Hz`;
    if (!t) return `${hz}.`;
    const st = pitchStatus(pitchLevel, t);
    const range = `${t.low} to ${t.high} Hz`;
    if (st === "in") return `${hz}, inside your target ${range}.`;
    if (st === "beyond") return `${hz}, past your target ${range} in your direction.`;
    return `${hz}, ${pitchLevel < t.low ? "below" : "above"} your target ${range}.`;
  }
  if (cue === "resonance") {
    if (state !== "live" && state !== "holding") return `Resonance (approximate): ${resonanceHeader(state, snap)}`;
    const w = bandWords(snap?.u, vtlnRef);
    return sentence(`Resonance (approximate)${w ? `: ${w}` : ""}, ${resonanceHeader(state, snap)}`);
  }
  return sentence(`Vocal weight: ${weightHeader(state, vocalWeight)}`);
}
