# Established-level excursion break — 2026-06-10

Live report (screenshot): saying "hello testing 1 2 3" at 90-120 Hz, the
pitch trace mostly sits correctly at ~100-120 Hz but throws frequent
full-height connected lines up to ~380 Hz (3-4× harmonic locks). The
PR #84 consecutive-delta jump break was supposed to catch these and
didn't.

## Why the jump break failed (scripts/pitch-excursion-measure.js)

Reconstructed the exact production display pipeline (AC + path tracker +
5-frame median + onset-confirm + consecutive-delta jump break) over the
2026-05-26 session:

- **1078 connected painted pairs ≥ 9 st apart** (the visible vertical
  lines), and **0 of them were ≥ 12 st steps.** The 5-frame median ramps
  an instant 100→380 Hz octave jump through intermediate values whose
  step-to-step deltas are each < 12 st, so the consecutive-delta break
  (threshold 12 st) never fires — the whole ramp paints connected.
- Deviation of each painted frame from the established level (median of
  the last 15 painted values): **normal prosody p99 = 8.3 st, max 9.0**;
  **excursion frames median 13.2 st** (octave-class). Clean separation —
  the established level, not the previous frame, is the right reference.

## Fix: break against the established level (src/audio/pitchPaintGate.js)

Track a robust median of recent painted pitches. A value ≥ EXCURSION_SEMI
off that level is an octave-class jump: suppressed (gap) unless it
sustains a consistent new level for EXCURSION_SUSTAIN frames, then
accepted as a genuine register change and the level reseeds there. The
painted value is always the real detected pitch — this gates *when* to
paint, never alters the number (unlike the octave-locking
reconcileHarmonic removed 2026-05-09). Smooth glides are unaffected (each
step stays within SEMI of the moving level); only near-instant octave
jumps trip it.

Extracted as a unit-tested module (pattern of pitchGate.js /
pitchSmoothing.js); replaces the inline jump-break + onset-streak logic
in useAudioPipeline.js. The established level persists across brief
unvoiced gaps (speech has micro-gaps every few hundred ms — resetting
there would disable the gate on the onsets right after) and clears on
prolonged silence / mic stop.

## Tuning (scripts/pitch-excursion-fix-sweep.js, 2026-05-26 session)

| config | connPairs ≥9 st | painted | band 80-110 corr |
|---|---|---|---|
| current (consecutive-delta @12 st) | 1078 | 73 523 | 79.0 % |
| **semi 9.5, sustain 16 (shipped)** | **142** | 54 719 | **81.1 %** |
| semi 10, sustain 16 | 187 | 55 244 | 81.1 % |
| semi 11, sustain 16 | 382 | 57 066 | 80.8 % |
| semi 9.5, sustain 8 | 138 | 60 045 | 80.3 % |
| semi 9.5, sustain 24 | 141 | 53 715 | 82.2 % |

- **SEMI 9.5**: sits in the gap between prosody max (9.0) and the octave
  (12). Lower = more excursions caught; 9.5 is the floor that clears
  prosody. 10/11 leave progressively more spikes.
- **SUSTAIN 16** (~400 ms): outlasts the harmonic-lock tail (locks run
  median 4, p90 11 frames) while keeping genuine-register-change latency
  acceptable. The reported failure is *speech* — you don't jump octaves
  between words — so the latency cost lands only on deliberate abrupt
  octave jumps, and smooth slides incur none. 8 under-suppresses long
  locks; 24 adds latency for marginal gain.

Connected octave-class spike pairs (≥ 12 st) over the whole 53-min
session: **down to 24** (from the screenshot's mess). Band accuracy
*improves* (79.0 → 81.1 %) because suppressed excursions were wrong.
Painted-frame count drops 73 523 → 54 719: the removed frames are the
excursions plus their onset-confirm shoulders — recording is unaffected
(it keeps every per-frame value).

Production-module end-to-end check (real pitchPaintGate, not the sweep's
inline copy): 54 725 painted / 142 connected / 24 octave-class — matches
the sweep exactly.

## Residual / limitations

- ~24 octave-class connecting steps remain over 53 min (~0.45/min), each
  a single segment at an accept-transition or genuine fast prosody — not
  the sustained full-height lines. Acceptable; further suppression trades
  responsiveness on real register changes.
- A ramp step still inside prosody range (e.g. 100→140 ≈ 5.8 st) paints
  before the climb crosses the threshold, so a short upward stub can
  precede a suppressed excursion. Correct by construction — indistinguishable
  from prosody until it climbs further — and far smaller than the prior
  full-height spike.
- This is display-layer; the detector still produces the excursions
  (the documented low-F0 harmonic-lock limitation). The trace and readout
  are now clean; the underlying detection is unchanged.
