# Pitch spikes + display flicker — 2026-06-10

Live-use report after the PR #82 fix ("much better, but"): (1) pitch
occasionally spikes way up/down while talking; (2) on the mobile
pitch-only view, the display flashes grey rapidly as background noise
flaps the voicing decision.

## Spikes — verdict

`scripts/pitch-spike-measure.js` counts transient excursion events
(≥6 semitones from 1-s local median, ≤300 ms) through the production AC
pipeline and display smoothing. The measurement was run on a private
session recording; results on the private session recordings are kept
outside this repository.

Mechanism (code-level): the display median buffer resets on every gap,
so the **first post-gap frame passes through the median unfiltered** —
onset misestimates went straight to screen.

**Shipped: onset confirmation (3 frames).** Pitch is painted only after
3 consecutive decoded frames; the first painted value is then a true
median-of-3. On the private session recording, onset confirmation alone
brought the L=2 spike count to the reference tracker's level (results
kept outside this repository), so no lookback increase was needed (L
stays 2 per the user's latency preference). Cost: 50 ms extra latency
*at utterance start only*.

**Rejected: semitone jump clamp** (formant-style outlier clamping
applied to pitch): the clamp fights genuine fast pitch movement — its
spike reduction came with a large band-accuracy cost, measured on the
same private session recording — and is the same mechanism family as the
octave-locking `reconcileHarmonic` removed 2026-05-09.

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
