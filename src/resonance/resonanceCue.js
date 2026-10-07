// resonanceCue.js — the Dashboard's resonance cue: the resonance lab's
// spectral-warp (vtln) readout, gated so held vowels and notes don't count.
// Pure; runs in src/resonance/resonance-worker.js and in Node tests.
//
// The lab engine (src/resonance-lab/lab-engine.js, pitchSource "frames")
// emits one vtln value per 150 ms bin and stamps it with the stream's
// cumulative voiced time; onStamped() here adds it to this cue's own
// sliding 5 s-voiced median readout (readout.js, the lab's readout) unless
// the utterance gate's latest verdict is "sustained" (held phonation) or
// "warming" (an utterance onset still being watched for a held note).
// Every other verdict admits the bin: "score", "pause", "silent" (bins
// resolve ~90 ms after their audio, so an utterance's tail lands after it
// closes) and "stale" — except that after a "sustained" verdict the drop is
// latched until the gate next says "score" or "pause" (a new utterance), so
// the late-resolving tail of a held note never enters.
//
// The gate is the SAME module the perceived-voice meter uses
// (src/ml/utterance-gate.js, its defaults), fed the same pitch hints on the
// audio clock; decide(nowMs) runs once per capture chunk and its verdict
// applies to the bins stamped while that chunk (or a pitch frame relayed
// after it) is processed.
//
// Voiced time spent in dropped bins is taken out of the readout's voiced
// clock, so a held note neither enters the readout nor pushes the running
// speech before it out of the 5 s horizon.
//
// Known limit: up to ~1 s of a held note that follows running speech inside
// one utterance can enter before the gate fires (about 7 of ~33 bins in a
// 5 s readout; the median absorbs it).
//
// Where you started (startU): the MEDIAN of the readouts over the first
// START_COLLECT_S of admitted voiced speech after the readout first fills
// (2026-10-07 review: a single first readout sat up to 0.65 u off an
// expressive reader's typical level, so an unchanged voice read "brighter
// than your start" the whole session; with a ~20 s reference an unchanged
// voice reads "about where you started" in 96 % of live samples, ±10 %
// formants still move 0.7–0.9 u — measurements/cue-strip-review-fixes-
// 2026-10-07.md §3). startU stays null until then.
//
// Resume after a long idle (2026-10-07 review): the readout itself freezes
// through silence (it is a window of voiced time), so after ≥ IDLE_RESET_S
// of audio with no admitted bin the snapshot's sinceResumeS restarts at 0
// and counts the admitted voiced time since; the cue strip shows
// "settling" until it reaches 2 s, so a voice coming back after a break
// (or a different speaker) never gets the old value as a confident live
// dot. The readout's values are not reset.
//
// Units: u = (readout − LibriSpeech men's median) / (women's − men's
// median) (reference.json "vtln"): 0 = typical adult man in that corpus,
// 1 = typical adult woman. The vtln estimator clamps ln α at ±0.24; a
// readout within 0.0005 of it is reported as clamped (beyond the scale).
// measurements/resonance-cue-production-path-2026-10-07.md

import { createReadout } from "../resonance-lab/readout.js";
import { createUtteranceGate } from "../ml/utterance-gate.js";

export const VTLN_CLAMP_EDGE = 0.2395;
export const IDLE_RESET_S = 10;
export const START_COLLECT_S = 12;
const DROP_VERDICTS = new Set(["sustained", "warming"]);

/**
 * reference: reference.json (needs .vtln {menMedian, womenMedian})
 * gate:      false = admit every bin (tests: equals the engine's own readout)
 */
export function createResonanceCue({ reference, horizonS = 5, gate = true } = {}) {
  const ref = reference.vtln;
  const readout = createReadout({ agg: "median", horizonS, ref });
  const g = gate ? createUtteranceGate() : null;
  let verdict = gate ? "silent" : "score";
  let startU = null;
  let startSamples = [];
  let startVoicedS = 0;
  let lastStampSeen = null;
  let droppedVoicedS = 0;
  let binsAdmitted = 0;
  let binsDropped = 0;
  let afterSustained = false;
  let lastAdmitTe = null;
  let sinceResumeS = 0;
  let resumes = 0;

  return {
    /** One relayed pitch frame (the hook's pitch-hint message). */
    notePitchHint({ voiced, pitch, contextTime }) {
      if (!g || typeof contextTime !== "number" || !Number.isFinite(contextTime)) return;
      g.notePitchHint({ voiced, pitch, ts: contextTime * 1000 });
    },
    /** Once per capture chunk, before the chunk is pushed into the engine. */
    noteChunk(contextTime) {
      if (!g || typeof contextTime !== "number" || !Number.isFinite(contextTime)) return verdict;
      verdict = g.decide(contextTime * 1000).verdict;
      if (verdict === "sustained") afterSustained = true;
      else if (verdict === "score" || verdict === "pause") afterSustained = false;
      return verdict;
    },
    /** lab-engine onStamped for the vtln finalist. */
    onStamped(te, stampS, value) {
      const delta = lastStampSeen === null ? 0 : Math.max(0, stampS - lastStampSeen);
      lastStampSeen = stampS;
      if (DROP_VERDICTS.has(verdict) || afterSustained) {
        droppedVoicedS += delta;
        binsDropped++;
        return false;
      }
      binsAdmitted++;
      if (lastAdmitTe !== null && typeof te === "number" && te - lastAdmitTe >= IDLE_RESET_S) { sinceResumeS = 0; resumes++; }
      if (typeof te === "number") lastAdmitTe = te;
      sinceResumeS += delta;
      readout.add(stampS - droppedVoicedS, value);
      if (startU === null) {
        const s = readout.snapshot();
        if (s.fill >= 1 && s.u !== null) {
          if (startSamples.length) startVoicedS += delta;
          startSamples.push(s.u);
          if (startVoicedS >= START_COLLECT_S) {
            const q = [...startSamples].sort((a, b) => a - b), h = q.length >> 1;
            startU = q.length % 2 ? q[h] : (q[h - 1] + q[h]) / 2;
            startSamples = [];
          }
        }
      }
      return true;
    },
    snapshot() {
      const s = readout.snapshot();
      const clamp = s.raw === null ? 0 : s.raw >= VTLN_CLAMP_EDGE ? 1 : s.raw <= -VTLN_CLAMP_EDGE ? -1 : 0;
      return {
        u: s.u,
        raw: s.raw,
        n: s.n,
        fill: s.fill,
        voicedS: s.voicedS,
        clamp,
        verdict,
        startU,
        startProgress: startU !== null ? 1 : Math.min(1, startVoicedS / START_COLLECT_S),
        binsAdmitted,
        binsDropped,
        sinceResumeS,
        resumes,
      };
    },
  };
}
