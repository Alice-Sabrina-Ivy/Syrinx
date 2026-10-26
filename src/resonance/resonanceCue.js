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
// The gate is the SAME module the gender worker ("Likely heard as") uses
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
// Shown start (shownStartU; 2026-10-26, measurements/resonance-start-
// reference-2026-10-26.md): 12 s of admitted voiced speech is ~22 s of
// reading after the readout fills (reading is ~45 % voiced), so the row said
// "finding your start…" until a median 31 / 34 s after listening began
// (LibriSpeech, women / men). The header and the start ring now use the
// median of the readouts collected so far while startU is still null — the
// same samples startU will be the median of, so it becomes startU exactly
// when startU is set. startU itself (the pitch-only warning's reference) is
// unchanged. Pre-registered pick P0
// (measurements/resonance-start-prereg-2026-10-26.md): the first word with
// the dot (median 9–11 s), false "brighter / darker than your start" on an
// unchanged voice not more often than before.
//
// Resume after a long idle (2026-10-07 review): the readout itself freezes
// through silence (it is a window of voiced time), so after ≥ IDLE_RESET_S
// of audio with no admitted bin the snapshot's sinceResumeS restarts at 0
// and counts the admitted voiced time since; the cue strip shows
// "settling" until it reaches 2 s, so a voice coming back after a break
// (or a different speaker) never gets the old value as a confident live
// dot. The readout's values are not reset.
//
// Phone-quality audio (noteNarrowband, from the worker's narrowband
// detector, src/resonance/narrowband.js; 2026-10-19): when the detector turns
// on, the readout and any unfinished start collection are cleared (a phone
// link reads 0.6–2.5 G darker — measurements/resonance-narrowband-2026-10-19.md),
// and while it is on every bin is dropped, its voiced time taken out like a
// held note's. When it turns off the readout refills from wideband speech
// only (the strip goes warming → settling → live). A start already found is
// kept. On wideband audio the detector never turns on (0.0 % of voiced time
// measured), so nothing here changes there.
//
// Following a change (restart; 2026-10-21,
// measurements/resonance-switch-asymmetry-2026-10-21.md): the shown value
// is the 5 s voiced median, plus a short median over the last RESTART.shortS
// (1.5 s) of voiced time. When the two differ by ≥ RESTART.jumpU (0.6 u)
// with the same sign on RESTART.confirmN (4) admitted bins in a row, the
// window drops its bins older than the short window: the shown value
// becomes the short median and grows back to 5 s. A change of resonance is
// followed in ~3 s instead of ~6 s, up and down alike. (Every value shown
// was a median of admitted bins; since 2026-10-26 a weighted one, below.) Only u / raw / clamp come from this
// readout; fill, voicedS, n, sinceResumeS and the start collection (startU)
// come from the plain 5 s readout, so a position exists exactly when it did
// before. Cost (user decision 2026-10-21, shipped despite the failed
// guard): on an unchanged voice the restart also fires ~0.5 times a minute,
// and "about where you started" held 83.1 % of live time vs 85.6 % before.
// restart: null gives the plain 5 s median (the readout before 2026-10-21).
//
// Shown value, recent bins weighted (2026-10-26,
// measurements/resonance-faster-2026-10-26.md §6): the value shown is the
// weighted median of the window's admitted bins, each weighted
// 2^(−age / SHOWN_HALF_LIFE_S) with its age in voiced seconds (the same
// clock as the window), so a change shows halfway sooner. The restart test
// still compares the plain short and 5 s medians, as before. The study's
// candidate E-ewm2.5 (scripts/resonance/faster-candidates.mjs), owner
// decision 2026-10-26: E-ewm2.5 adopted despite failing G1 (men, women;
// marginal) and G2 (men) — on dev the dot's SD on an unchanged voice 0.179 /
// 0.144 u vs bars 0.178 / 0.144 (men / women), false "brighter / darker than
// your start" 13.9 % vs 13.9 (men). Every value shown is still one of the
// admitted bins. uPlain, fill, voicedS, n, sinceResumeS and the start stay
// on the plain 5 s readout. halfLifeS: null = the median (before 2026-10-26).
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
export const RESTART = Object.freeze({ shortS: 1.5, jumpU: 0.6, confirmN: 4 });
export const SHOWN_HALF_LIFE_S = 2.5;
const DROP_VERDICTS = new Set(["sustained", "warming"]);

function median(vals) {
  if (!vals.length) return null;
  const a = Float64Array.from(vals).sort();
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

/**
 * The weighted median of vals: the smallest value (in sorted order; equal
 * values keep their input order) whose cumulative weight reaches half the
 * total. Not averaged between two values, so it is always one of vals.
 */
export function weightedMedian(vals, ws) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const tot = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= tot / 2) return vals[i]; }
  return vals[idx[idx.length - 1]];
}

/**
 * The shown readout: the median over the trailing horizonS of voiced time,
 * restarted on a confirmed change (see the header), shown as the
 * recency-weighted median (halfLifeS). restart: null and halfLifeS: null =
 * the plain median, value for value equal to readout.js's median readout;
 * halfLifeS: null alone = the restart readout of 2026-10-21 (the switch
 * pass's display readout, scripts/resonance/switch-candidates.mjs
 * createDisplayReadout). With restart RESTART and halfLifeS 2.5 it equals
 * the study's E-ewm2.5 (faster-candidates.mjs createShown) value for value.
 */
export function createRestartReadout({ ref, horizonS = 5, restart = RESTART, halfLifeS = restart ? SHOWN_HALF_LIFE_S : null }) {
  const gap = ref.womenMedian - ref.menMedian;
  let items = [];
  let raw = null;
  let streak = 0, sign = 0, restarts = 0;
  return {
    add(stampS, s) {
      if (s === null || !Number.isFinite(s)) return false;
      items.push({ v: stampS, s });
      const lo = stampS - horizonS;
      let cut = 0;
      while (cut < items.length && items[cut].v <= lo) cut++;
      if (cut) items = items.slice(cut);
      raw = median(items.map((x) => x.s));
      if (restart) {
        const lo2 = stampS - restart.shortS;
        let c2 = 0;
        while (c2 < items.length && items[c2].v <= lo2) c2++;
        const short = items.slice(c2);
        const sm = median(short.map((x) => x.s));
        const d = (sm - raw) / gap;
        const sg = Math.abs(d) >= restart.jumpU ? Math.sign(d) : 0;
        if (sg !== 0 && sg === sign) streak++;
        else { sign = sg; streak = sg !== 0 ? 1 : 0; }
        if (streak >= restart.confirmN) {
          items = short;
          raw = sm;
          streak = 0; sign = 0; restarts++;
        }
      }
      if (halfLifeS) raw = weightedMedian(items.map((x) => x.s), items.map((x) => 2 ** (-(stampS - x.v) / halfLifeS)));
      return true;
    },
    snapshot() {
      return { raw, u: raw === null ? null : (raw - ref.menMedian) / gap, n: items.length, restarts };
    },
    reset() { items = []; raw = null; streak = 0; sign = 0; },
  };
}

/**
 * reference: reference.json (needs .vtln {menMedian, womenMedian})
 * gate:      false = admit every bin (tests: equals the engine's own readout
 *            when restart is null)
 * restart:   RESTART (default) or null = the plain 5 s median shown
 * halfLifeS: SHOWN_HALF_LIFE_S (default with a restart) or null = shown as
 *            the median (the restart readout of 2026-10-21)
 */
export function createResonanceCue({ reference, horizonS = 5, gate = true, restart = RESTART, halfLifeS = restart ? SHOWN_HALF_LIFE_S : null } = {}) {
  const ref = reference.vtln;
  const readout = createReadout({ agg: "median", horizonS, ref });
  const shown = createRestartReadout({ ref, horizonS, restart, halfLifeS });
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
  let narrowband = false;

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
    /** The narrowband detector's decision after each voiced grid frame. */
    noteNarrowband(on) {
      if (on && !narrowband) {
        readout.reset();
        shown.reset();
        if (startU === null) { startSamples = []; startVoicedS = 0; }
      }
      narrowband = !!on;
    },
    /** lab-engine onStamped for the vtln finalist. */
    onStamped(te, stampS, value) {
      const delta = lastStampSeen === null ? 0 : Math.max(0, stampS - lastStampSeen);
      lastStampSeen = stampS;
      if (narrowband || DROP_VERDICTS.has(verdict) || afterSustained) {
        droppedVoicedS += delta;
        binsDropped++;
        return false;
      }
      binsAdmitted++;
      if (lastAdmitTe !== null && typeof te === "number" && te - lastAdmitTe >= IDLE_RESET_S) { sinceResumeS = 0; resumes++; }
      if (typeof te === "number") lastAdmitTe = te;
      sinceResumeS += delta;
      readout.add(stampS - droppedVoicedS, value);
      shown.add(stampS - droppedVoicedS, value);
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
      const d = shown.snapshot();
      const clamp = d.raw === null ? 0 : d.raw >= VTLN_CLAMP_EDGE ? 1 : d.raw <= -VTLN_CLAMP_EDGE ? -1 : 0;
      return {
        u: d.u,
        raw: d.raw,
        uPlain: s.u, // the plain 5 s median, never restarted: the pitch-only warning's input
        n: s.n,
        fill: s.fill,
        voicedS: s.voicedS,
        clamp,
        verdict,
        startU,
        // the header's and the start ring's start (see the header)
        shownStartU: startU !== null ? startU : median(startSamples),
        startProgress: startU !== null ? 1 : Math.min(1, startVoicedS / START_COLLECT_S),
        binsAdmitted,
        binsDropped,
        sinceResumeS,
        resumes,
        restarts: d.restarts,
      };
    },
  };
}
