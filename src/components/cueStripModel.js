// cueStripModel.js — the Dashboard cue strip's pure logic (no React), so the
// geometry, the direction highlight, the dots' colours, the trail and the row
// states are unit-testable in Node (tests/audio/cue-strip-model-test.js).
//
// Three rows, one orientation: the typically-men end on the LEFT.
//   pitch      log Hz 75–320; bands = typical adult men 85–155 / women
//              165–255 Hz (the training-direction targets, which are those
//              ranges — trainingDirection.js PITCH_TARGETS); the dot is the
//              1.5 s pitch LEVEL the target is judged on.
//   resonance  u (0 = typical LibriSpeech man, 1 = typical woman), −1.0…2.2;
//              bands = the 10th–90th percentile 5 s readouts of 20 + 20
//              LibriSpeech readers (reference.json "vtln"); approximate in
//              absolute position, so drawn fainter, never judged.
//   weight     σ from the session's own first-30 s baseline, −3 (heavier)
//              … +3 (lighter); no population bands.
// Direction highlight: the same element and style for every direction,
// only { low, high } changes; none for "Just exploring" / unanswered. Only
// the pitch dot is coloured on / off target (statusColor(pitchStatus(...)),
// the F0 readout's rule); resonance and weight dots are always neutral.

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
/** -> { men: { x0, x1, xm }, women: { x0, x1, xm } } | null (weight has none). */
export function bandsFor(cue, vtlnRef = null) {
  if (cue === "pitch") {
    const geo = (t) => { const r = rangeOnAxis("pitch", t); return { ...r, xm: frac("pitch", Math.sqrt(t.low * t.high)) }; };
    return { men: geo(PITCH_TARGETS.masculine), women: geo(PITCH_TARGETS.feminine) };
  }
  if (cue === "resonance" && vtlnRef) {
    const geo = (q) => {
      const r = rangeOnAxis("resonance", { low: resonanceU(vtlnRef, q.q10), high: resonanceU(vtlnRef, q.q90) });
      return { ...r, xm: frac("resonance", resonanceU(vtlnRef, q.q50)) };
    };
    return { men: geo(vtlnRef.men), women: geo(vtlnRef.women) };
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

// ---- row states (CueStrip data-state)
// pitch:     idle | holding | live
// resonance: starting | unavailable | idle | sustained | warming | settling | holding | live
// weight:    calibrating | idle | holding | live
export function pitchRowState({ voiced, holding, pitchLevel }) {
  if (voiced && pitchLevel != null) return "live";
  if (voiced || holding) return "holding";
  return "idle";
}
export const RESONANCE_WARM_S = 2;
export function resonanceRowState({ workerStatus, snap, voiced, holding }) {
  if (workerStatus === "error" || workerStatus === "overloaded") return "unavailable";
  if (workerStatus !== "ready" || !snap) return "starting";
  if (!voiced && !holding) return "idle";
  if (snap.verdict === "sustained") return "sustained";
  if ((snap.voicedS ?? 0) < RESONANCE_WARM_S || snap.u == null) return "warming";
  if ((snap.fill ?? 0) < 1) return "settling";
  if (!voiced) return "holding";
  return "live";
}
export function weightRowState({ vocalWeight, voiced, holding }) {
  if (!vocalWeight?.baselineReady) return "calibrating";
  if (!voiced && !holding) return "idle";
  if (!voiced || vocalWeight.sigmaDelta == null) return "holding";
  return "live";
}

/** The value a row's dot shows, in the cue's units (null = none). */
export function rowValue(cue, inputs) {
  if (cue === "pitch") return inputs.pitchLevel ?? null;
  if (cue === "resonance") return inputs.snap?.u ?? null;
  return inputs.vocalWeight?.sigmaDelta ?? null;
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

// ---- trail: the last TRAIL_LEN samples taken every TRAIL_EVERY_MS while LIVE.
// Frozen (no samples) in any other state; cleared when the row goes idle and
// on any change into or out of "sustained".
export function createTrail(n = TRAIL_LEN) {
  let pts = [];
  let lastState = null;
  return {
    /** One 250 ms tick. Returns the current points (oldest first). */
    tick(state, value) {
      const intoOut = lastState !== null && (state === "sustained") !== (lastState === "sustained");
      if (state === "idle" || intoOut) pts = [];
      lastState = state;
      if (state === "live" && value != null && Number.isFinite(value)) {
        pts = [...pts, value];
        if (pts.length > n) pts = pts.slice(pts.length - n);
      }
      return pts;
    },
    points: () => pts,
    clear() { pts = []; lastState = null; },
  };
}
/** Trail circle opacity, oldest 0.12 -> newest 0.45. */
export const trailOpacity = (i, len) => (len <= 1 ? 0.45 : 0.12 + ((0.45 - 0.12) * i) / (len - 1));

// ---- header text
export function resonanceHeader(state, snap) {
  switch (state) {
    case "starting": return "starting…";
    case "unavailable": return "unavailable on this device";
    case "idle": return "—";
    case "sustained": return "needs running speech";
    case "warming": return "keep talking…";
    case "settling": return "settling…";
    default: {
      const p = axisPos("resonance", snap?.u, { clamp: resonanceClamp(snap) });
      return p && p.beyond !== 0 ? "beyond the scale" : "last ~5 s of speech";
    }
  }
}
export function weightHeader(state, vocalWeight) {
  if (state === "calibrating") {
    const p = vocalWeight?.baselineProgress ?? 0;
    return vocalWeight?.cpp == null && p === 0 ? "Calibrating…" : `Calibrating ${Math.round(p * 100)} %`;
  }
  const s = vocalWeight?.sigmaDelta;
  if (state === "idle" || s == null) return "—";
  const a = Math.abs(s);
  if (a < 0.05) return "at your start";
  return `${a.toFixed(1)} σ ${s > 0 ? "lighter" : "heavier"} than your start`;
}
