// heard-as.js — the experimental "Likely heard as" estimate (opt-in, off by
// default): how listeners in published studies might hear a voice, as a
// RANGE of man / unsure / woman shares, never a verdict. Pure; used live
// (HeardAsPanel via useAudioPipeline) and by the calibration tooling
// (scripts/heard-as/), so the aggregation the constants were fitted on and
// the one the app shows are the same code.
// measurements/heard-as-calibration-2026-10-07.md
//
// Inputs (all on the AUDIO clock, ms):
//   addWindow({ audioMs, logit, mode, classified = true })  every window the
//       gender worker's utterance gate scored: audioMs = the window's end,
//       logit = ln p_female − ln p_male of that window (unsmoothed), mode
//       "gated" | "fallback". Only gated windows are kept (fallback windows
//       are the amplitude path, never used). Since 2026-10-07 the worker runs
//       the classifier on a scored window only every 450 ms
//       (measurements/heard-as-cpu-2026-10-07.md): the others arrive with
//       classified: false and no logit — they still count as scored windows
//       (the window count, the voiced time and the F0 spans below are exactly
//       the 150 ms schedule's), only meterLogit averages the classified ones.
//       A classified window without a finite logit is dropped.
//   addPitch({ audioMs, f0 })  every posted pitch-worker frame (f0 null /
//       0 = unvoiced), at its capture time — the posted value, never the
//       smoothed / painted / held one.
//
// The aggregate (one definition, live and at fit time), over the trailing
// windowMs (8 s):
//   meterLogit = arithmetic mean of the classified windows' logits whose END
//                lies in the span;
//   lnF0       = ln(median of the voiced posted pitch values) of the frames
//                whose time lies inside at least one of those windows
//                ([end − 750 ms, end]);
//   voicedMs   = the audio-clock spacing before each such voiced frame,
//                capped at 100 ms (25 ms per frame normally; stays right under
//                the ?chunk= diag flag).
// Voiced windows only (measurements/heard-as-voiced-windows-2026-10-08.md,
// user decision A: whisper must not get readings): with logitMinVoicedMs > 0
// a classified window's logit enters meterLogit only if its own span holds
// >= logitMinVoicedMs of posted voiced frames (each counted as voicedMs
// counts it); with logitMinRunMs > 0, only if a run of consecutive posted
// voiced frames inside the span lasts >= logitMinRunMs (broken by an unvoiced
// frame or a > 100 ms gap). Such a window still counts as a scored window
// (count, voiced time, F0 spans); nClassified counts only the qualifying ones.
// Hidden (with a reason) when: the worker's voice state is "sustained"
// (held vowel / note), no scored window yet ("listening"), the newest
// scored window is older than freshMs ("stale"), the span holds fewer
// than minWindows windows or less than minVoicedMs voiced ("short"), or the
// aggregate lies outside the fit data (F0 81–293 Hz, meter logit
// −7.31…+5.72: "outside" — e.g. many children's voices; 2026-10-07 review:
// the spec says out-of-scope input must hide it, not just add a note).

import { HEARD_AS_CALIBRATION } from "./heardAsCalibration.js";

export const ML_WINDOW_MS = 750;
const MAX_HOP_MS = 100;

function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const h = n >> 1;
  return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
}

export function createHeardAsAggregator({
  windowMs = HEARD_AS_CALIBRATION.windowMs,
  minVoicedMs = HEARD_AS_CALIBRATION.minVoicedMs,
  minWindows = HEARD_AS_CALIBRATION.minWindows,
  freshMs = HEARD_AS_CALIBRATION.freshMs,
  logitMinVoicedMs = HEARD_AS_CALIBRATION.logitMinVoicedMs ?? 0,
  logitMinRunMs = HEARD_AS_CALIBRATION.logitMinRunMs ?? 0,
} = {}) {
  let windows = []; // { audioMs, logit } ascending
  let frames = [];  // { audioMs, f0, dt, gap } ascending (gap = raw spacing, uncapped)
  let lastFrameMs = null;
  let everScored = false;

  function trim(nowMs) {
    if (!Number.isFinite(windowMs)) return;
    const cut = nowMs - windowMs - ML_WINDOW_MS - 1000;
    let i = 0;
    while (i < windows.length && windows[i].audioMs < cut) i++;
    if (i) windows = windows.slice(i);
    let j = 0;
    while (j < frames.length && frames[j].audioMs < cut) j++;
    if (j) frames = frames.slice(j);
  }

  // Does the classified window ending at endMs pass the voiced-windows rule?
  function voicedEnough(endMs) {
    if (!(logitMinVoicedMs > 0) && !(logitMinRunMs > 0)) return true;
    const a = endMs - ML_WINDOW_MS;
    let lo = 0, hi = frames.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (frames[m].audioMs < a) lo = m + 1; else hi = m; }
    let voiced = 0, run = 0, best = 0;
    for (let i = lo; i < frames.length && frames[i].audioMs <= endMs; i++) {
      const f = frames[i];
      if (f.f0 > 0) {
        voiced += f.dt;
        run = i > lo && f.gap <= MAX_HOP_MS ? run + f.dt : f.dt;
        if (run > best) best = run;
      } else run = 0;
    }
    return voiced >= logitMinVoicedMs && best >= logitMinRunMs;
  }

  return {
    addWindow({ audioMs, logit, mode, classified = true }) {
      if (mode !== "gated") return false;
      if (classified && (typeof logit !== "number" || !Number.isFinite(logit))) return false;
      if (typeof audioMs !== "number" || !Number.isFinite(audioMs)) return false;
      windows.push({ audioMs, logit: classified ? logit : null });
      everScored = true;
      trim(audioMs);
      return true;
    },
    addPitch({ audioMs, f0 }) {
      if (typeof audioMs !== "number" || !Number.isFinite(audioMs)) return;
      if (lastFrameMs !== null && audioMs < lastFrameMs - 1000) { windows = []; frames = []; lastFrameMs = null; } // new stream
      const gap = lastFrameMs === null ? 25 : Math.max(audioMs - lastFrameMs, 0);
      const dt = Math.min(gap, MAX_HOP_MS);
      lastFrameMs = audioMs;
      frames.push({ audioMs, f0: typeof f0 === "number" && f0 > 0 ? f0 : 0, dt, gap });
      trim(audioMs);
    },
    /** The raw aggregate over (nowMs − windowMs, nowMs], no hide rules (fit-time use). */
    aggregate(nowMs) {
      const lo = Number.isFinite(windowMs) ? nowMs - windowMs : -Infinity;
      const W = windows.filter((w) => w.audioMs > lo && w.audioMs <= nowMs);
      if (!W.length) return { nWindows: 0, nClassified: 0, meterLogit: null, lnF0: null, voicedMs: 0, newestMs: null };
      let sum = 0, nL = 0;
      for (const w of W) if (w.logit !== null && voicedEnough(w.audioMs)) { sum += w.logit; nL++; }
      // union of the windows' spans (ascending ends, equal lengths -> merge)
      const spans = [];
      for (const w of W) {
        const a = w.audioMs - ML_WINDOW_MS, b = w.audioMs;
        const last = spans[spans.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else spans.push([a, b]);
      }
      const f0s = [];
      let voicedMs = 0;
      let k = 0;
      for (const f of frames) {
        if (!(f.f0 > 0)) continue;
        while (k < spans.length && spans[k][1] < f.audioMs) k++;
        if (k >= spans.length) break;
        if (f.audioMs >= spans[k][0] && f.audioMs <= spans[k][1]) { f0s.push(f.f0); voicedMs += f.dt; }
      }
      f0s.sort((x, y) => x - y);
      const med = median(f0s);
      return {
        nWindows: W.length,
        nClassified: nL,
        meterLogit: nL ? sum / nL : null,
        lnF0: med === null ? null : Math.log(med),
        voicedMs,
        nVoicedFrames: f0s.length,
        newestMs: W[W.length - 1].audioMs,
      };
    },
    /** -> { hidden: reason } | { meterLogit, lnF0, nWindows, voicedMs, ageMs } */
    estimate(nowMs, voiceState = null) {
      if (voiceState === "sustained") return { hidden: "sustained" };
      if (!everScored) return { hidden: "listening" };
      const newest = windows.length ? windows[windows.length - 1].audioMs : null;
      if (newest === null || nowMs - newest > freshMs) return { hidden: "stale" };
      const g = this.aggregate(nowMs);
      if (g.nWindows < minWindows || g.voicedMs < minVoicedMs || g.lnF0 === null || g.meterLogit === null) return { hidden: "short", nWindows: g.nWindows, voicedMs: g.voicedMs };
      if (outsideTestedRange(g.meterLogit, g.lnF0)) return { hidden: "outside", meterLogit: g.meterLogit, lnF0: g.lnF0 };
      return { meterLogit: g.meterLogit, lnF0: g.lnF0, nWindows: g.nWindows, voicedMs: g.voicedMs, ageMs: nowMs - newest };
    },
    reset() { windows = []; frames = []; lastFrameMs = null; everScored = false; },
  };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export function heardAsEta(meterLogit, lnF0, C = HEARD_AS_CALIBRATION) {
  return C.a + C.bMeter * meterLogit + C.bLnF0 * lnF0;
}

// Unsure share at two-way share s (= P "man", unsure counted half).
export function unsureShare(s, C = HEARD_AS_CALIBRATION) {
  return Math.min(Math.max(C.unsureFloor, C.unsureK * 4 * s * (1 - s)), 2 * Math.min(s, 1 - s));
}
const manShare = (s, C) => s - unsureShare(s, C) / 2;
const womanShare = (s, C) => 1 - s - unsureShare(s, C) / 2;

/**
 * -> { eta, s, sLow, sHigh, man: [lo, hi], unsure: [lo, hi], woman: [lo, hi],
 *      centre: { man, unsure, woman }, word }
 * s = two-way share "man"; the range is eta ± halfWidth. Shares at each end
 * sum to 1 and satisfy man + unsure/2 = s. `word` is computed for tests and
 * the measurement note only — the panel never shows a verdict.
 */
export function heardAsShares(meterLogit, lnF0, C = HEARD_AS_CALIBRATION) {
  const eta = heardAsEta(meterLogit, lnF0, C);
  const s = sigmoid(eta), sLow = sigmoid(eta - C.halfWidth), sHigh = sigmoid(eta + C.halfWidth);
  const uLo = unsureShare(sLow, C), uHi = unsureShare(sHigh, C);
  const peakS = Math.min(Math.max(0.5, sLow), sHigh);
  return {
    eta, s, sLow, sHigh,
    man: [manShare(sLow, C), manShare(sHigh, C)],
    unsure: [Math.min(uLo, uHi), unsureShare(peakS, C)],
    woman: [womanShare(sHigh, C), womanShare(sLow, C)],
    centre: { man: manShare(s, C), unsure: unsureShare(s, C), woman: womanShare(s, C) },
    word: sLow > 0.5 ? "man" : sHigh < 0.5 ? "woman" : "split",
  };
}

/** A share range [lo, hi] in "x in 10 listeners": low end rounded down, high end up. */
export function shareTenths([lo, hi]) {
  return [Math.floor(10 * lo + 1e-9), Math.ceil(10 * hi - 1e-9)];
}
export function formatShare([lo, hi]) {
  if (hi < 0.05) return "fewer than 1 in 10";
  if (lo > 0.95) return "nearly all";
  const [a, b] = shareTenths([lo, hi]);
  return a === b ? `about ${a} in 10` : `about ${a}–${b} in 10`;
}
// A range whose rounded ends span 8 tenths or more says almost nothing
// (2026-10-07 review: "about 0–10 in 10" read as a full bar). The panel's
// man <-> woman axis (heardAsAxisModel.js) applies it to the two-way range:
// band dimmed, no dot, "Can't tell yet".
export const WIDE_SHARE_TENTHS = 8;
export function isWideShare(range) {
  const [a, b] = shareTenths(range);
  return b - a >= WIDE_SHARE_TENTHS;
}

export function outsideTestedRange(meterLogit, lnF0, C = HEARD_AS_CALIBRATION) {
  return lnF0 < C.range.lnF0[0] || lnF0 > C.range.lnF0[1] || meterLogit < C.range.meterLogit[0] || meterLogit > C.range.meterLogit[1];
}
