// bridgeEvidence.js — voice evidence for the pitch-hold bridge (2026-10-06,
// measurements/pitch-hold-bridge-rework-2026-10-06.md). Extracted for
// unit-testing, same pattern as pitchGate.js / pitchPaintGate.js.
//
// The bridge (pitchGate.js PITCH_HOLD_MAX_MS) holds the last smoothed pitch
// across detector null gaps of up to 400 ms so a word's trace does not
// fragment at consonants and dropouts. On real noise-only audio it also
// joined short false-voiced runs into continuous lines: half of the painted
// false pitch there (measurements/realnoise-false-voicing-attribution-
// 2026-10-05.md §1a). Restricting the bridge by run length or a shorter
// window was rejected (same file §3.1): in speech, and more in noisy speech,
// the bridge carries real voiced frames the detector nulls.
//
// The evidence is the DSP worker's per-frame CPP (cpp.js, cepstral peak
// prominence; `bridgeCpp`, a 64 ms window — dsp-worker.js) of the frames the
// pitch worker posted as voiced. A voice — even at 0 dB SNR in machine
// noise — produces strongly harmonic voiced frames (vowel nuclei) every few
// seconds; the weakly periodic false voicing of real noise rarely does.
// Nothing is learned about the background, so a voice that starts with the
// stream cannot become "the background": the voice's own frames are the
// evidence.
//
// Alignment (fix round, 2026-10-06): a DSP frame consumes the latest pitch
// message, which describes the frame the decode delay put L hops back
// (~90 ms before the chunk end), while the DSP frame's own CPP window ends at
// its chunk end. Pairing the two scored the last 2-3 voiced frames of every
// run with CPP of audio after the voice stopped. The voiced flag is now
// paired with the CPP of the SAME capture chunk the pitch frame ended on
// (both messages carry that chunk's contextTime; the 64 ms CPP window lies
// inside the 80 ms pitch window); without timestamps, the CPP of
// CPP_FALLBACK_LAG frames back.
//
// Rule, for a held frame (no fresh pitch, bridge window open):
//   - the first BRIDGE_GRACE_MS of every gap is drawn unconditionally
//     (short dropouts inside a word);
//   - after a voiced run of >= BRIDGE_LONG_RUN_MS, the first
//     BRIDGE_LONG_GRACE_MS of the gap are drawn unconditionally;
//   - beyond that the held value is drawn only when a STRONG voiced frame
//     was seen within the last BRIDGE_EVIDENCE_MS: the mean aligned CPP of
//     the voiced frames among the last CPP_SMOOTH_FRAMES pairings (at least
//     CPP_SMOOTH_MIN of them) >= BRIDGE_CPP_MIN, each frame's CPP first
//     divided by lowF0Gain(its pitch) — below 100 Hz even the 64 ms CPP reads
//     low for a modal or breathy voice (a synthetic vowel at 76-90 Hz: 0.75-
//     1.0 of its 100-250 Hz value, BRIDGE_LOW_F0_GAIN), and without the
//     correction breathy held notes at 78-88 Hz lost their bridge;
//   - no CPP from the DSP worker for CPP_MISSING_MS (input below 16 kHz:
//     computeCPP returns null) fails open: the bridge is drawn as before.
// A held frame that fails is HIDDEN, not dropped: the hold window, the
// smoothing buffer and the paint gate's continuity are untouched (the hook
// still pushes the held value through pitchPaintGate with fresh: false), so
// a voice that resumes within the window paints at once — no 3-frame onset
// re-confirmation. Ending the hold instead re-armed the onset confirmation
// and cost clean speech (PTDB-TUG +0.3 pp display error) for little extra
// noise gain.
//
// Operating point (fix round): BRIDGE_CPP_MIN is the highest threshold at
// which every guard of the pre-registered rule holds (voice in noise per
// stream, held notes per scenario incl. 80-120 Hz breathy holds); it cuts
// painted false voicing on noise-only audio by ~13 %, not the rule's 25 %.
//
// Known cost (the measurement's G2 / G6 rows): weak, breathy or dysphonic
// phonation in loud noise may not reach the evidence level, and then loses
// the bridge's held frames — the voice's own fresh frames still paint; the
// cost is larger for male than for female voices. The evidence opens for
// BRIDGE_EVIDENCE_MS after any strong frame, so after speech the bridge is
// drawn as before: the cut reaches noise far from speech (and each new
// stream's start: every Stop / Start), not noise in the pauses of a
// session.

export const BRIDGE_GRACE_MS = 50;
export const BRIDGE_LONG_RUN_MS = 250;
export const BRIDGE_LONG_GRACE_MS = 200;
export const BRIDGE_CPP_MIN = 0.39;
export const BRIDGE_EVIDENCE_MS = 20000;
export const CPP_SMOOTH_FRAMES = 4;
export const CPP_SMOOTH_MIN = 2;
// No CPP from the DSP worker for this long = no evidence source: fail open.
export const CPP_MISSING_MS = 1000;
// Alignment of the voiced flag with the CPP of its own capture chunk: the
// match tolerance on contextTime (half a 25 ms hop), and the fallback lag in
// DSP frames when either message carries no contextTime (the pitch message
// consumed at DSP frame k describes frame k - L, L = 2: boersma-ac.js
// PATH_DEFAULTS.lookback).
export const CPP_ALIGN_TOL_S = 0.0125;
export const CPP_FALLBACK_LAG = 2;
const CPP_RING = 8;
// lowF0Gain: the 64 ms CPP of a synthetic glottal-pulse vowel relative to its
// 100-250 Hz mean — about the mean of four readings (16 / 48 kHz, modal /
// -6 dB aspiration: 0.80 / 0.83 / 0.93 / 0.99 at 76 / 82 / 90 / 100 Hz),
// rounded; scripts/realnoise-fv/cpp-vs-f0.mjs, measurements/pitch-hold-
// bridge-rework-2026-10-06.md §4.1. Linear between the points, 0.8 below
// 75 Hz, 1 from 100 Hz up. High voices read low too (300-350 Hz: 0.66-0.85)
// but are not corrected: there it admitted more noise than it saved voice.
export const BRIDGE_LOW_F0_GAIN = [[75, 0.8], [82, 0.82], [90, 0.92], [100, 1]];
export function lowF0Gain(f0) {
  const g = BRIDGE_LOW_F0_GAIN;
  if (!(f0 > 0)) return 1;
  if (f0 <= g[0][0]) return g[0][1];
  for (let i = 1; i < g.length; i++) {
    if (f0 <= g[i][0]) {
      const [a, ga] = g[i - 1], [b, gb] = g[i];
      return ga + (gb - ga) * (f0 - a) / (b - a);
    }
  }
  return 1;
}
// Frame times are whole milliseconds (the hook rounds absoluteTime), so a
// boundary compare gets 1 ms of slack.
const EPS_MS = 1;

export function createBridgeEvidence({
  graceMs = BRIDGE_GRACE_MS,
  longRunMs = BRIDGE_LONG_RUN_MS,
  longGraceMs = BRIDGE_LONG_GRACE_MS,
  cppMin = BRIDGE_CPP_MIN,
  evidenceMs = BRIDGE_EVIDENCE_MS,
} = {}) {
  const recent = [];        // { fresh, cpp } of the last CPP_SMOOTH_FRAMES pairings
  const ring = [];          // { ct, cpp } of the last CPP_RING DSP frames
  let lastFreshAt = null;   // time of the last frame with a fresh pitch
  let runStartAt = null;    // first frame of the current / last fresh run
  let lastRunMs = 0;        // duration of that run
  let frameMs = 25;         // DSP cadence, measured frame to frame
  let prevNow = null;
  let strongAt = null;      // time of the last STRONG voiced frame
  let lastCppAt = null;     // time of the last frame that carried a CPP value

  // The CPP of the DSP frame whose chunk the pitch frame ended on.
  function alignedCpp(pitchCt) {
    const timed = typeof pitchCt === "number" && Number.isFinite(pitchCt)
      && ring.some((r) => r.ct !== null);
    if (timed) {
      let best = null, bestD = CPP_ALIGN_TOL_S;
      for (const r of ring) {
        if (r.ct === null) continue;
        const d = Math.abs(r.ct - pitchCt);
        if (d <= bestD) { best = r; bestD = d; }
      }
      return best ? best.cpp : null;
    }
    const i = ring.length - 1 - CPP_FALLBACK_LAG;
    return i >= 0 ? ring[i].cpp : null;
  }

  // Every DSP frame (silence-gated ones included): fresh = a non-stale
  // pitch this frame; f0 = that pitch (Hz, null when not fresh); cpp = the
  // DSP worker's bridgeCpp (null when absent); cppCt = that DSP frame's
  // contextTime; pitchCt = the consumed pitch message's contextTime (the
  // chunk its frame ended on).
  function push({ now, fresh, f0 = null, cpp, cppCt = null, pitchCt = null }) {
    if (prevNow !== null && now > prevNow) frameMs = now - prevNow;
    prevNow = now;
    const hasCpp = typeof cpp === "number" && Number.isFinite(cpp);
    if (hasCpp) lastCppAt = now;
    ring.push({ ct: typeof cppCt === "number" && Number.isFinite(cppCt) ? cppCt : null, cpp: hasCpp ? cpp : null });
    if (ring.length > CPP_RING) ring.shift();
    const ac = alignedCpp(pitchCt);
    recent.push({ fresh, cpp: ac === null ? null : ac / lowF0Gain(f0) });
    if (recent.length > CPP_SMOOTH_FRAMES) recent.shift();
    let sum = 0, count = 0;
    for (const r of recent) if (r.fresh && r.cpp !== null) { sum += r.cpp; count++; }
    if (count >= CPP_SMOOTH_MIN && sum / count >= cppMin) strongAt = now;
    if (fresh) {
      // A fresh frame more than ~one hop after the previous one starts a run.
      if (lastFreshAt === null || now - lastFreshAt > frameMs * 1.5) runStartAt = now;
      lastFreshAt = now;
      lastRunMs = now - runStartAt + frameMs;
    }
  }

  // May a held frame at `now` (no fresh pitch, bridge window open) be drawn?
  function allowHeld(now) {
    if (lastFreshAt === null) return true;
    const age = now - lastFreshAt;
    if (age <= graceMs + EPS_MS) return true;
    if (lastRunMs >= longRunMs - EPS_MS && age <= longGraceMs + EPS_MS) return true;
    if (lastCppAt === null || now - lastCppAt > CPP_MISSING_MS) return true;
    return strongAt !== null && now - strongAt < evidenceMs;
  }

  return { push, allowHeld };
}
