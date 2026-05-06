# Voicedness gate Path B investigation (PR #74 follow-up)

**Date:** 2026-05-06
**Trigger:** Codex review on PR #74 flagged that the AND-logic gate
admits loud-but-unvoiced noise (fans, AC, typing) that the previous
OR-logic gate suppressed via the voicedness arm.
**Question (Path B):** Would `intensity < -50 OR voicednessObs < THR`
preserve noise suppression while fixing speech fragmentation?
The hypothesis was that pYIN's HMM smoothing collapses voicedness
toward zero on real speech, so swapping in the pre-HMM raw signal
(`voicednessObs`) might restore the OR semantics.

## Captures used

All three are real-mic captures from the desktop attach harness on
2026-05-06 (NOT the synthetic 200 Hz fixture, which has both inputRms
and voicedness ~10–30× higher than real-mic content and therefore
can't drive gate calibration).

| Tag | File | Description | n frames |
|---|---|---|---|
| voice-03-52 | `mstp-2026-05-06T03-52-43-849Z.json` | 90 s direct voice | 1200 |
| voice-06-00 | `mstp-2026-05-06T06-00-02-019Z.json` | TED talk via PC speakers | 1200 |
| noise-06-21 | `mstp-2026-05-06T06-21-16-830Z.json` | 30 s quiet ambient | 1200 |

## voicedness vs voicednessObs distributions

Conditional on `inputRms > 0.005` (filters silence so we look only at
audible-content frames):

| Capture | signal | p10 | p25 | median | p75 | p90 | n |
|---|---|---|---|---|---|---|---|
| voice-03-52 | voicedness | 0.000 | 0.000 | 0.015 | 0.977 | 1.000 | 853 |
| voice-03-52 | vobs (raw) | 0.000 | 0.000 | 0.105 | 0.908 | 0.984 | 853 |
| voice-06-00 | voicedness | 0.000 | 0.001 | 0.008 | 0.132 | 0.905 | 864 |
| voice-06-00 | vobs (raw) | 0.000 | 0.001 | 0.105 | 0.595 | 0.851 | 864 |

**The Stage-1 hypothesis partially confirms but doesn't help the gate.**
`voicednessObs` median is higher (0.105 vs 0.015/0.008) and p75 is
higher in voice-06-00 (0.595 vs 0.132). But on both real-voice captures
the median for both signals is well below 0.5. The p10/p25 are zero
for both — many audible-speech frames have no candidate-mass evidence
at all because pYIN finds no period with strong CMND structure on
that window (formant noise, articulation transients, fricatives).

## Gate-logic comparison

Pass rate (kept-fraction). For voice captures, higher is better;
for the noise capture, lower is better.

| Gate logic | voice-03-52 | voice-06-00 | noise-06-21 |
|---|---|---|---|
| OR-voiced (pre-PR baseline)    | 26.4% (317/1200) | 11.9% (143/1200) | 0.0% (0/1200) |
| **AND-voiced (current PR)**    | **77.8% (934/1200)** | **76.4% (917/1200)** | **0.0% (0/1200)** |
| intensity-only (-50 dB)        | 76.8% (922/1200) | 76.4% (917/1200) | 0.0% (0/1200) |
| OR-vobs ≥ 0.5                  | 28.5% (342/1200) | 21.1% (253/1200) | 0.0% (0/1200) |
| OR-vobs ≥ 0.4                  | 30.0% (360/1200) | 24.3% (292/1200) | 0.0% (0/1200) |
| OR-vobs ≥ 0.3                  | 31.9% (383/1200) | 26.9% (323/1200) | 0.0% (0/1200) |
| OR-vobs ≥ 0.2                  | 33.3% (399/1200) | 30.9% (371/1200) | 0.0% (0/1200) |
| OR-vobs ≥ 0.1                  | 36.0% (432/1200) | 36.8% (442/1200) | 0.0% (0/1200) |

**Path B is empirically ruled out.** OR-with-voicednessObs at any
threshold produces a voice pass rate of 21–36% — far below the
≥80% target and substantially worse than the AND-voiced gate
(77.8%/76.4%). The HMM-collapse hypothesis was correct in direction
(`vobs` IS higher than `voicedness` on speech) but the absolute
levels are still too low for OR-style rejection: median `vobs` on
audible speech is ~0.1, well below the 0.5 threshold the gate would
need to reject low-vobs speech frames.

## Critical secondary finding: AND-voiced ≈ intensity-only

The PR's AND-voiced gate produces results within 1.0 percentage
point of intensity-only gating across all three captures:

- voice-03-52: AND 77.8% vs intensity-only 76.8% (12-frame difference)
- voice-06-00: AND 76.4% vs intensity-only 76.4% (0 frames)
- noise-06-21: AND 0.0% vs intensity-only 0.0% (0 frames)

The disagreement region is the "quiet+voiced" cell (intensity below
–50 dB AND voicedness ≥ 0.5). On real-mic captures this is virtually
empty — pYIN doesn't produce strong voicedness on near-silent
windows. So **the voicedness arm of the AND gate is dormant in
practice**: it would only fire if intensity already says "noise" but
voicedness says "speech," which doesn't happen on real recordings.

This sharpens what Codex's concern actually reduces to:

> Does intensity-only gating at –50 dB suppress loud-but-unvoiced
> noise (fans, AC, keyboard typing) that was previously caught by
> the voicedness arm of the OR gate?

That's a Path A measurement question. Existing captures don't
answer it because the only noise capture (06-21) is **quiet**
ambient (rms median 0.00018, intensity well below –50 dB) — already
caught by the intensity arm. We need a loud-unvoiced capture to
tell whether intensity-only is sufficient.

## Loud+unvoiced disagreement region (where AND-PR differs from OR-pre-PR)

These are the frames the PR newly admits compared to the pre-PR gate:

| Capture | loud+unvoiced | loud+voiced | quiet+unvoiced | quiet+voiced |
|---|---|---|---|---|
| voice-03-52 | 605 | 317 | 266 | 12 |
| voice-06-00 | 774 | 143 | 283 | 0 |
| noise-06-21 | 0 | 0 | 1200 | 0 |

In both voice captures, **100% of loud+unvoiced frames have a pitch
detected by pYIN.** So the voicedness arm of OR-pre-PR was
suppressing real pitch readings on continuous speech. AND-PR
correctly admits these. The fragmentation fix is real on real-voice
input.

In noise-06-21, **99.8% of frames have a pitch detected** by pYIN
even though it's quiet ambient noise — pYIN happily returns phantom
pitch values on near-silence. This shows the voicedness arm WAS a
real safety net for the loud-unvoiced case (where intensity gating
fails), even though we can't observe that case in this noise
capture. The risk Codex flagged is plausible.

## Three-path framing for the decision

**Path A (ship as-is, validate first)** — capture loud-unvoiced
audio (fan, AC, typing during silence) and measure suppression rate
under intensity-only gating. If loud-unvoiced suppression is ≥95%,
the AND PR is safe to ship as-is. If suppression is substantially
worse (say 70–80%), the AND logic is admitting too much noise and
we need a different approach.

**Path B (voicednessObs OR)** — empirically ruled out by this
investigation. Voice pass rate of 21–36% is unacceptable.

**Path C (hybrid logic)** — last-resort if Path A validation fails.
Possible directions: gate on pitch null AND voicedness threshold;
add a separate loud-noise classifier (broadband energy distribution
or spectral flatness measure that distinguishes noise from speech);
combine intensity + a more permissive voicedness threshold.

## Recommendation pending Path A data

Hold the PR until loud-noise capture lands. The current AND gate
is functionally equivalent to intensity-only gating, so the ship
decision reduces to "is intensity-only sufficient on its own to
suppress loud-unvoiced noise." That requires audio that doesn't
exist in the current measurement set.

If Path A confirms acceptable suppression: ship the PR with a
documentation note that the voicedness arm is dormant on real-world
audio (the AND logic exists for harness/synthetic-stimulus
defensiveness rather than for production noise rejection).

If Path A reveals a regression: revisit with Path C designs.

## Reproducibility

Gate-logic comparison run inline as a one-liner against the three
captures in `measurements/desktop-diag-runs/`. Stats helpers in
`scripts/analyze-voicedness.js` already include voicednessObs in
the per-capture distribution output, but the gate-comparison
cross-tab was inline node and isn't preserved as a script — if a
future investigation needs to repeat this, copy the inline logic
from this commit's transcript or re-derive it in <30 lines using
`f.intensity`, `f.voicedness`, `f.voicednessObs`, `f.pitch`,
`f.inputRms` from each frame.
