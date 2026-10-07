// utterance-gate.js — which ML windows the perceived-voice classifier may
// score, and what the meter should say when it may not (2026-10-07).
//
// Pure, Node-testable; used by gender-worker.js and replayed bit-exactly
// by the measurement harness (measurements/perceived-voice-gate-2026-10-07.md).
//
// Why: an audit of the deployed meter on public data found it showed a
// number during noise-only audio 71 % of the time (leaning masculine),
// seeded its EMA from the noise before speech, kept stale values on
// screen for up to 6 s, and read held vowels / sung notes near 50. The
// old gate scored a 0.75 s window whenever ANY voiced pitch frame had
// arrived in the last 500 ms (plus a sub-75 Hz periodicity probe that
// passed 8.6 % of real-noise windows on its own), so one false-voiced
// noise blip opened half a second of scoring, and the first windows of
// an utterance were mostly the silence or noise before it.
//
// The gate works only on the relayed pitch-voicing stream (one hint per
// pitch-worker frame: { voiced, ts, pitch }). Every time is on ONE clock,
// the AUDIO clock (gender-worker.js passes the capture contextTime, in
// ms, of the frame a hint describes, and of the newest audio chunk as
// "now"): hints are then exactly one capture chunk apart however bursty
// their delivery is. (Until the 2026-10-07 review they carried the pitch
// worker's decode wall time; capture delivers chunks in bursts, one burst
// per hardware audio frame, so with frames >= 64 ms apart every burst
// looked like a hole in the stream, no voiced run ever reached the onset
// length, and the meter never showed a number.)
//
//   utterance  opens on a run of >= onsetRunMs consecutive voiced hints
//              (onset = the run's first hint), closes after gapMs with no
//              voiced hint. A span starts at the onset (and restarts
//              after sustained phonation, below); the worker resets its
//              EMA on the first scored window of every span, so a new
//              utterance never blends with the previous one or with the
//              noise before it.
//   score      only if the span is old enough that at most
//              (1 - minPostOnsetFrac) of the window predates it, the
//              newest voiced hint is <= recencyMs old, and >= minVoicedShare
//              of the window's hints are voiced ("recent AND voiced").
//   sustained  long steady voicing with little pitch movement: over the
//              trailing sustainMs, >= sustainMinShare of hints voiced AND
//              the voiced pitch's 10th-90th percentile spread
//              <= sustainMaxSpreadSt semitones. Held single vowels / notes
//              (about 1 s or longer) are not what the classifier reads (it
//              puts women's held vowels near 50), so the meter shows
//              "needs running speech" instead. While a young span has been
//              steady since its start it is held at "warming" rather than
//              scored, so a held note doesn't flash a number before the
//              full-second test can fire. Running speech breaks voicing or
//              moves pitch within a syllable or two, which releases it.
//              Limits (measurements/perceived-voice-gate-2026-10-07.md):
//              it is a single-held-note test — melodic singing (vibrato
//              wider than ~1 st, glides, legato notes under ~0.5 s) is
//              mostly scored; and speech on a deliberately flat pitch with
//              almost no unvoiced frames can trip it.
//
// Verdicts from decide(nowTs):
//   "stale"     no pitch hint for staleMs (pitch worker dead / not warm):
//               the caller falls back to its amplitude-only path.
//   "silent"    no open utterance.
//   "warming"   utterance open, window not scoreable yet (too much of it
//               predates the onset, or a steady start is being watched).
//   "pause"     utterance open but no recent / not enough voicing in the
//               window (a breath, a long consonant cluster, a noise blip).
//   "sustained" held phonation — don't score, show "needs running speech".
//   "score"     score it; resetEma is true on the span's first score.

// Speech evidence (2026-10-07, low-voice-noise candidate
// "voice-detector-gate", measurements/low-voice-noise-2026-10-07.md):
// the worker also feeds speech-detector hints (noteSpeech: one { ts, p }
// per 32 ms Silero VAD frame, audio clock; speech-detector.js). While they
// are live, WHETHER someone is speaking comes from them: a speech
// utterance opens on a run of >= onsetRunMs of speech frames
// (p >= speechThreshold), closes after gapMs without one, and a window
// scores only if a speech frame is <= recencyMs old and >= minVoicedShare
// of the window's speech frames are speech. Pitch hints then only shape
// the held-note tests: "sustained" (unchanged) and the steady-onset hold,
// which watches the pitch utterance the gate would have opened on pitch
// voicing alone (kept running in the background, exactly as before), so
// a held vowel is held at "warming" just as it was. Why: the pitch tracker
// loses low (men's) voices in heavy noise far more than women's, so a
// pitch-voicing onset rarely formed for them; every pitch-evidence lever
// that recovered them also voiced noise about 1:1. With no speech hint
// for staleMs (detector still loading, or failed) the gate runs on pitch
// voicing exactly as before.

export const UTTERANCE_GATE_DEFAULTS = Object.freeze({
  windowMs: 750,            // ML window length (gender-worker WINDOW_SECONDS)
  onsetRunMs: 150,          // consecutive voicing that opens an utterance
  gapMs: 1000,              // no voicing this long closes it
  recencyMs: 500,           // newest voiced hint must be this recent to score
  minVoicedShare: 0.15,     // voiced share of the window's hints
  minPostOnsetFrac: 0.5,    // >= this much of the window must follow the span start
  staleMs: 2000,            // no hints at all this long = pitch feed dead
  sustainMs: 1000,          // trailing span the held-phonation test looks at
  sustainMinShare: 0.95,    //   voiced share over it (0.9 until the
                            //   2026-10-07 review: flat-intonation speech
                            //   tripped it; held vowels are ~100 % voiced)
  sustainMaxSpreadSt: 2.0,  //   p90 - p10 of voiced pitch, semitones
  holdSteadyOnset: true,    // keep a young, steady span at "warming"
  // Longest gap between consecutive hints (audio clock) that still
  // counts as continuous: hints are one capture chunk apart (25 ms; at
  // most 50 ms with the ?chunk= diag flag), so a larger gap is lost audio.
  maxHopMs: 100,
  resetBackMs: 1000,        // the clock jumping back this far = a new stream
  speechThreshold: 0.5,     // speech-detector frame counts as speech (Silero's default)
  speechHopMs: 32,          // speech-detector frame hop (512 samples at 16 kHz)
  // minPostOnsetFrac while speech hints decide (0.5 measured too: see
  // measurements/low-voice-noise-2026-10-07.md, candidate voice-detector-gate).
  speechMinPostOnsetFrac: 0.4,
  // A speech run still going when a held-note verdict ends may open an
  // utterance whose span starts at the end of the note (so the note is
  // never scored: >= speechMinPostOnsetFrac of a scored window follows it). Pitch runs break
  // within a syllable; a speech detector's run does not, so without this a
  // steady hum the pitch tracker calls a "held note" kept the meter shut
  // for the rest of the sentence.
  speechReopenAfterHold: true,
});

// Linear-interpolated percentile of an ascending-sorted array.
function pct(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Voiced share + pitch spread (semitones, p90 - p10) of the hints with
// ts > fromTs. spread is null with fewer than 5 voiced hints.
function stats(hints, fromTs) {
  let n = 0, v = 0;
  const st = [];
  for (let i = hints.length - 1; i >= 0; i--) {
    const h = hints[i];
    if (h.ts <= fromTs) break;
    n++;
    if (h.voiced) {
      v++;
      if (h.st !== null) st.push(h.st);
    }
  }
  let spread = null;
  if (st.length >= 5) {
    st.sort((a, b) => a - b);
    spread = pct(st, 0.9) - pct(st, 0.1);
  }
  return { n, share: n > 0 ? v / n : 0, spread };
}

export function createUtteranceGate(options = {}) {
  const o = { ...UTTERANCE_GATE_DEFAULTS, ...options };
  const keepMs = Math.max(o.windowMs, o.sustainMs) + 4 * o.maxHopMs;
  let hints = [];            // { ts, voiced, st } oldest first, trimmed to keepMs
  let lastHintTs = null;
  let lastVoicedTs = null;
  let runStartTs = null;     // first hint of the current voiced run
  let spanId = 0;            // shared counter: every new span (either kind) gets a fresh id
  let lastScoredSpanId = -1;
  let lastSustainedTs = null; // last decide() that found held phonation
  // The pitch utterance: what the gate opens on pitch voicing alone.
  const pu = { open: false, spanStartTs: null, spanId: 0 };
  // The speech utterance: opened by speech-detector frames.
  const su = { open: false, spanStartTs: null, spanId: 0 };
  let speech = [];           // { ts, on } oldest first, trimmed to keepMs
  let lastSpeechHintTs = null;
  let lastSpeechTs = null;   // newest frame with p >= speechThreshold
  let speechRunStartTs = null; // start (audio ms) of the current speech run

  // Speech hints decide "is someone speaking" while they are live.
  const speechLive = (ts) => lastSpeechHintTs !== null && ts - lastSpeechHintTs <= o.staleMs;

  function closeIfGap(ts) {
    if (pu.open && (lastVoicedTs === null || ts - lastVoicedTs > o.gapMs)) pu.open = false;
    if (su.open && (lastSpeechTs === null || ts - lastSpeechTs > o.gapMs)) su.open = false;
  }

  function openSpan(u, startTs) {
    u.open = true;
    u.spanStartTs = startTs;
    u.spanId = ++spanId;
  }

  function reset() {
    hints = [];
    lastHintTs = null;
    lastVoicedTs = null;
    runStartTs = null;
    pu.open = false;
    pu.spanStartTs = null;
    lastSustainedTs = null;
    su.open = false;
    su.spanStartTs = null;
    speech = [];
    lastSpeechHintTs = null;
    lastSpeechTs = null;
    speechRunStartTs = null;
  }

  return {
    // { voiced, ts, pitch } — one per pitch-worker frame, in order; ts on
    // the audio clock (ms).
    notePitchHint(hint) {
      if (!hint || typeof hint.ts !== "number" || !Number.isFinite(hint.ts)) return;
      const ts = hint.ts;
      // A clock that jumps back is a new stream (capture restarted):
      // nothing from the old one may count.
      if (lastHintTs !== null && ts < lastHintTs - o.resetBackMs) reset();
      const voiced = !!hint.voiced;
      // A hole in the hint stream breaks the voiced run (the frames that
      // would have filled it are unknown).
      if (lastHintTs !== null && ts - lastHintTs > o.maxHopMs) runStartTs = null;
      const hop = lastHintTs !== null ? Math.min(Math.max(ts - lastHintTs, 0), o.maxHopMs) : 25;
      closeIfGap(ts);
      const p = typeof hint.pitch === "number" && hint.pitch > 0 ? hint.pitch : null;
      hints.push({ ts, voiced, st: voiced && p !== null ? 12 * Math.log2(p / 100) : null });
      let drop = 0;
      while (drop < hints.length && hints[drop].ts < ts - keepMs) drop++;
      if (drop > 0) hints = hints.slice(drop);
      lastHintTs = ts;
      if (voiced) {
        if (runStartTs === null) runStartTs = ts;
        lastVoicedTs = ts;
        // Opens on a long-enough run that began AFTER any held note: the
        // rest of a held note (or a note's tail) never opens one.
        if (!pu.open && ts - runStartTs + hop >= o.onsetRunMs
          && (lastSustainedTs === null || runStartTs > lastSustainedTs)) {
          openSpan(pu, runStartTs);
        }
      } else {
        runStartTs = null;
      }
    },

    // { ts, p } — one per speech-detector frame, in order; ts = audio-clock
    // ms of the frame's last sample, p = its speech probability.
    noteSpeech(hint) {
      if (!hint || typeof hint.ts !== "number" || !Number.isFinite(hint.ts)) return;
      if (typeof hint.p !== "number" || !Number.isFinite(hint.p)) return;
      const ts = hint.ts;
      if (lastSpeechHintTs !== null && ts < lastSpeechHintTs - o.resetBackMs) reset();
      if (lastSpeechHintTs !== null && ts - lastSpeechHintTs > o.maxHopMs) speechRunStartTs = null;
      const on = hint.p >= o.speechThreshold;
      closeIfGap(ts);
      speech.push({ ts, on });
      let drop = 0;
      while (drop < speech.length && speech[drop].ts < ts - keepMs) drop++;
      if (drop > 0) speech = speech.slice(drop);
      lastSpeechHintTs = ts;
      if (on) {
        if (speechRunStartTs === null) speechRunStartTs = ts - o.speechHopMs;
        lastSpeechTs = ts;
        if (!su.open) {
          // A run that began during a held note counts from the note's end.
          const held = lastSustainedTs !== null && speechRunStartTs <= lastSustainedTs;
          if (!held || o.speechReopenAfterHold) {
            const start = held ? lastSustainedTs : speechRunStartTs;
            if (ts - start >= o.onsetRunMs) openSpan(su, start);
          }
        }
      } else {
        speechRunStartTs = null;
      }
    },

    // nowTs: audio-clock ms of the newest audio in the ML window.
    // -> { verdict, resetEma, spanId }
    decide(nowTs) {
      const useSpeech = speechLive(nowTs);
      const u = useSpeech ? su : pu;
      const out = (verdict, resetEma = false) => ({ verdict, resetEma, spanId: u.spanId });
      if (lastHintTs === null || nowTs - lastHintTs > o.staleMs) return out("stale");

      // Held phonation over the trailing sustainMs (needs history covering
      // it). It closes the utterance: scoring resumes only with a new
      // utterance whose voicing starts after the note (see notePitchHint),
      // so the note's tail is never scored, and that utterance gets a
      // fresh EMA.
      const covered = hints.length > 0 && hints[0].ts <= nowTs - o.sustainMs + o.maxHopMs;
      if (covered) {
        const s = stats(hints, nowTs - o.sustainMs);
        if (s.share >= o.sustainMinShare && s.spread !== null && s.spread <= o.sustainMaxSpreadSt) {
          pu.open = false;
          su.open = false;
          lastSustainedTs = nowTs;
          return out("sustained");
        }
      }

      closeIfGap(nowTs);
      if (!u.open) return out("silent");

      const age = nowTs - u.spanStartTs;
      if (age < (useSpeech ? o.speechMinPostOnsetFrac : o.minPostOnsetFrac) * o.windowMs) return out("warming");
      // A young pitch utterance that has been steady since its start is
      // watched at "warming" until the full-second held-note test can
      // decide (with speech evidence: the pitch utterance running in the
      // background, so a vowel held after speech is watched as before).
      if (o.holdSteadyOnset && pu.open && nowTs - pu.spanStartTs < o.sustainMs) {
        const s = stats(hints, pu.spanStartTs - 1);
        if (s.share >= o.sustainMinShare && (s.spread === null || s.spread <= o.sustainMaxSpreadSt)) {
          return out("warming");
        }
      }
      const lastEv = useSpeech ? lastSpeechTs : lastVoicedTs;
      if (lastEv === null || nowTs - lastEv > o.recencyMs) return out("pause");
      let share;
      if (useSpeech) {
        let n = 0, v = 0;
        for (let i = speech.length - 1; i >= 0 && speech[i].ts > nowTs - o.windowMs; i--) {
          n++;
          if (speech[i].on) v++;
        }
        share = n > 0 ? v / n : 0;
      } else {
        share = stats(hints, nowTs - o.windowMs).share;
      }
      if (share < o.minVoicedShare) return out("pause");
      const resetEma = u.spanId !== lastScoredSpanId;
      lastScoredSpanId = u.spanId;
      return out("score", resetEma);
    },
  };
}

// Meter-facing state for a verdict (posted by the worker on change):
//   listening — nothing voice-like; no number
//   updating  — a voice onset is being collected; no number yet
//   scoring   — scores are arriving
//   pause     — utterance open, scoring paused (a fresh score may still show)
//   sustained — held phonation; "needs running speech"
export function meterStateForVerdict(verdict) {
  switch (verdict) {
    case "score": return "scoring";
    case "warming": return "updating";
    case "pause": return "pause";
    case "sustained": return "sustained";
    default: return "listening"; // silent (stale is resolved by the caller)
  }
}
