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
// Units: u = (readout − LibriSpeech men's median) / (women's − men's
// median) (reference.json "vtln"): 0 = typical adult man in that corpus,
// 1 = typical adult woman. The vtln estimator clamps ln α at ±0.24; a
// readout within 0.0005 of it is reported as clamped (beyond the scale).
// measurements/resonance-cue-production-path-2026-10-07.md

import { createReadout } from "../resonance-lab/readout.js";
import { createUtteranceGate } from "../ml/utterance-gate.js";

export const VTLN_CLAMP_EDGE = 0.2395;
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
  let lastStampSeen = null;
  let droppedVoicedS = 0;
  let binsAdmitted = 0;
  let binsDropped = 0;
  let afterSustained = false;

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
      readout.add(stampS - droppedVoicedS, value);
      if (startU === null) {
        const s = readout.snapshot();
        if (s.fill >= 1 && s.u !== null) startU = s.u;
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
        binsAdmitted,
        binsDropped,
      };
    },
  };
}
