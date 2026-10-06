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
// prominence) of the frames the pitch worker posted as voiced. A voice —
// even at 0 dB SNR in machine noise — produces strongly harmonic voiced
// frames (vowel nuclei) every few seconds; the weakly periodic false voicing
// of real noise rarely does. Nothing is learned about the background, so a
// voice that starts with the stream cannot become "the background": the
// voice's own frames are the evidence.
//
// Rule, for a held frame (no fresh pitch, bridge window open):
//   - the first BRIDGE_GRACE_MS of every gap is drawn unconditionally
//     (short dropouts inside a word);
//   - after a voiced run of >= BRIDGE_LONG_RUN_MS, the first
//     BRIDGE_LONG_GRACE_MS of the gap are drawn unconditionally;
//   - beyond that the held value is drawn only when a STRONG voiced frame
//     was seen within the last BRIDGE_EVIDENCE_MS: the mean CPP of the
//     voiced frames among the last CPP_SMOOTH_FRAMES DSP frames (at least
//     CPP_SMOOTH_MIN of them) >= BRIDGE_CPP_MIN;
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
// Known cost (the measurement's G2 row): weak, breathy or dysphonic
// phonation in loud noise (CPP is the clinical breathiness measure) may not
// reach the evidence level, and then loses the bridge's held frames — the
// voice's own fresh frames still paint.

export const BRIDGE_GRACE_MS = 50;
export const BRIDGE_LONG_RUN_MS = 250;
export const BRIDGE_LONG_GRACE_MS = 200;
export const BRIDGE_CPP_MIN = 0.5;
export const BRIDGE_EVIDENCE_MS = 20000;
export const CPP_SMOOTH_FRAMES = 4;
export const CPP_SMOOTH_MIN = 2;
// No CPP from the DSP worker for this long = no evidence source: fail open.
export const CPP_MISSING_MS = 1000;
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
  const recent = [];        // { fresh, cpp } of the last CPP_SMOOTH_FRAMES DSP frames
  let lastFreshAt = null;   // time of the last frame with a fresh pitch
  let runStartAt = null;    // first frame of the current / last fresh run
  let lastRunMs = 0;        // duration of that run
  let frameMs = 25;         // DSP cadence, measured frame to frame
  let prevNow = null;
  let strongAt = null;      // time of the last STRONG voiced frame
  let lastCppAt = null;     // time of the last frame that carried a CPP value

  // Every DSP frame (silence-gated ones included): fresh = a non-stale
  // pitch this frame; cpp = the DSP worker's CPP (null when absent).
  function push({ now, fresh, cpp }) {
    if (prevNow !== null && now > prevNow) frameMs = now - prevNow;
    prevNow = now;
    const hasCpp = typeof cpp === "number" && Number.isFinite(cpp);
    if (hasCpp) lastCppAt = now;
    recent.push({ fresh, cpp: hasCpp ? cpp : null });
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
