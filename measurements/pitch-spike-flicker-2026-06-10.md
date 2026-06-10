# Pitch spikes + display flicker — 2026-06-10

Live-use report after the PR #82 fix ("much better, but"): (1) pitch
occasionally spikes way up/down while talking; (2) on the mobile
pitch-only view, the display flashes grey rapidly as background noise
flaps the voicing decision.

## Spikes — measurement and verdict

`scripts/pitch-spike-measure.js`: production AC pipeline over the
2026-05-26 session, production display smoothing applied, counting
transient excursion events (≥6 semitones from 1-s local median, ≤300 ms).

| config | spike events |
|---|---|
| L=2 (production) | 3 971 |
| L=4 | 3 485 |
| L=6 | 3 349 |
| **Praat reference contour (same audio, same metric)** | **3 434** |
| **L=2 + onset-confirm(3)** | **3 432** |

Classification of L=2 spike runs by position in their voiced segment:
**~30 % onset** (first ~50 ms), ~29 % offset, ~42 % mid-segment (the
mid bucket is inflated by genuine glides). Key mechanism found: the
display median buffer resets on every gap, so the **first post-gap
frame passes through the median unfiltered** — onset misestimates went
straight to screen.

**Shipped: onset confirmation (3 frames).** Pitch is painted only after
3 consecutive decoded frames; the first painted value is then a true
median-of-3. This alone brings L=2 to Praat-reference spike levels
(3 432 vs 3 434) at 50 ms extra latency *at utterance start only* — so
no lookback increase (L stays 2 per the user's latency preference).

**Rejected: semitone jump clamp** (formant-style outlier clamping
applied to pitch). Sweep at 3/4/5-semitone clamps: spikes drop ~25–40 %
but 80–110 Hz accuracy drops 9–13 pp — the clamp fights genuine fast
pitch movement, and is the same mechanism family as the octave-locking
`reconcileHarmonic` removed 2026-05-09. Residual mid-segment excursions
are at the reference tracker's own level; further suppression would
trade correctness for cosmetics.

## Flicker — display hysteresis

The big Hz readout, note name, and status dot mapped raw per-frame
voicing to opacity/color at the 5 fps state-update rate; noise hovering
at the voicing threshold strobed grey↔color. Fix (display-layer only, in
useAudioPipeline.js; session recording keeps the truthful per-frame
flag):

- rise: `ONSET_CONFIRM_FRAMES = 3` (also the spike fix — single
  noise-blip frames can no longer flash the voiced style);
- fall: `VOICED_FALL_FRAMES = 16` (~400 ms) — display passes through the
  dim "holding" style before going grey, and the 300 ms CSS opacity
  transition never strobes.

Simulation (40 fps, 30 s): random noise-flapping voicing (35 % voiced)
produces **529 display transitions without hysteresis vs 87 with** —
and the survivors are dim↔grey at the 400 ms fall cadence, not rapid
color flashes. Normal speech cadence (2 s utterances, 0.3 s gaps):
16 → 17 transitions (brief gaps bridge through "holding"; no behavior
change).

Note: noise *triggering* voicing at all is the long-documented
tonal-noise limitation (all detectors); this change makes the UI calm
under it rather than pretending to fix detection-on-noise.
