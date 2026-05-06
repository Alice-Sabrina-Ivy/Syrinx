# Voicing-decision literature review (PR #74 follow-up)

**Date:** 2026-05-06
**Trigger:** Refreshed-morning skepticism on whether the OR→AND gate
fix in PR #74 is the right architecture, before investing in either
Path A loud-noise capture validation or the synthetic-degradation
regression test infrastructure.
**Question:** How do mature pitch-detection implementations handle
the speech-vs-noise gating problem? Are we re-engineering something
the literature has already solved?

## TL;DR

**The literature converges on a pattern Syrinx is not following: voicing
is decided by the HMM/Viterbi *itself*, not by a downstream threshold on
the posterior.** Both reference implementations (Praat and librosa.pyin)
either (a) feed multiple soft signals into a global Viterbi optimizer
(Praat) or (b) decode voicing as part of the pitch-tracking HMM with
voiced/unvoiced state twins (pYIN/librosa). Neither uses a hard
per-frame `posterior < 0.5 → suppress` gate. The 0.5 threshold in
Syrinx's pre-PR `useAudioPipeline.js` has no precedent in the
literature.

**Recommendation: ship PR #74 as-is, then migrate to surfacing the
HMM's own voiced/unvoiced label as a follow-up.** The DSP worker
already computes it per-frame (line 954, `st >= _PYIN_UNVOICED_OFFSET`)
and explicitly throws it away — the comment at line 948 acknowledges
"voicing is advisory, not gating" but that's exactly the design that
produced the fragmentation regression. Gating on the Viterbi-decoded
voicing label is what librosa.pyin's `voiced_flag` output is for.

## 1. Praat (`Sound_to_Pitch.cpp`, `Pitch.cpp`, Boersma 1993)

Praat is the de-facto standard for phonetics research, in production
since 1993. Architecture is two-stage:

**Stage A — per-frame candidate generation.** Every frame ALWAYS gets
a voiceless candidate as candidate[1]:
```
pitchFrame->candidates[1].frequency = 0.0;   // voiceless: always present
```
plus up to N voiced candidates registered only when an autocorrelation
peak exceeds:
```
if (r[i] > 0.5 * voicingThreshold && r[i] > r[i-1] && r[i] >= r[i+1])
```
The `voicingThreshold` (default **0.45**) is a threshold on the
*normalized* autocorrelation peak height — not on intensity. If
`localPeak == 0.0`, the frame returns early with only the voiceless
candidate (genuine silence).

**Stage B — global path-finding (`Pitch_pathFinder`).** Dynamic
programming. The voiceless candidate's strength is computed:
```
unvoicedStrength = 2.0 - frame->intensity / (silenceThreshold / (1.0 + voicingThreshold));
unvoicedStrength = voicingThreshold + max(0.0, unvoicedStrength);
```
Voiced candidates get:
```
delta[iframe][icand] = candidate->strength - octaveCost * log2(ceiling / candidate->frequency)
```
Transitions cost `voicedUnvoicedCost` (default **0.14**, time-normalized)
per voicing-state change, and `octaveJumpCost * |log2(f1/f2)|` (default
**0.35** for the jump cost) for in-voiced frequency jumps.

**Boersma 1993, §3.3, verbatim:**
> "The first candidate is the unvoiced candidate, which is always
> present. The strength of this candidate is computed with two soft
> threshold parameters. E.g., if VoicingThreshold is 0.4 and
> SilenceThreshold is 0.05, this frame bears a good chance of being
> analyzed as voiceless (in step 4) if there are no autocorrelation
> peaks above approximately 0.4 OR if the local absolute peak value
> is less than approximately 0.05 times the global absolute peak
> value..."

**Critical observations:**
- The OR-logic between two arms (peak height and intensity vs. global
  peak) IS Boersma's design choice — but both arms feed into a
  **strength score**, not a hard veto. The voiced/unvoiced decision
  is the path-finder's choice of best candidate sequence, not a per-frame
  threshold compare.
- **The intensity arm uses local-vs-global peak ratio, not a fixed dB
  threshold.** This handles loud-silent-loud transitions correctly
  and is robust to mic gain / distance / ambient noise floor.
- Defaults: silenceThreshold=0.03 (3% of global peak), voicingThreshold=0.45,
  voicedUnvoicedCost=0.14, octaveJumpCost=0.35.

## 2. librosa.pyin (`librosa/core/pitch.py`)

Reference Python implementation of pYIN. Source verified locally at
lines 652–970. Implementation comment line 841–842: *"The implementation
here follows the official pYIN software which differs from the method
described in the paper."*

**Two outputs returned** (lines 760–767, 893):
- `voiced_flag` — boolean `states < n_pitch_bins` from Viterbi state output
- `voiced_prob` — `clip(sum(observation_probs[:n_pitch_bins, :], axis=0), 0, 1)`,
  the per-frame total probability mass on voiced pitch bins, computed
  pre-Viterbi from the YIN candidate distribution alone (lines 965–967)

**HMM topology** (lines 869–883):
```python
# 2 * n_pitch_bins states: M voiced + M unvoiced "twin" states
transition = sequence.transition_local(n_pitch_bins, transition_width, window="triangle", wrap=False)
t_switch = sequence.transition_loop(2, 1 - switch_prob)   # 2x2 voicing-switch block
transition = np.kron(t_switch, transition)                # Kronecker product = paired states
```

**Observation model** (lines 962–968):
```python
observation_probs[bin_index, frame_index] = yin_probs[yin_period, frame_index]
voiced_prob = clip(sum(observation_probs[:n_pitch_bins, :], axis=0), 0, 1)
observation_probs[n_pitch_bins:, :] = (1 - voiced_prob) / n_pitch_bins
```

So:
- Voiced-state observation mass = sum of Beta-distributed threshold probabilities
- Unvoiced-state mass = `1 - voiced_prob` divided uniformly across N pitch bins

**Defaults** (lines 661–667): `n_thresholds=100`, `beta_parameters=(2, 18)`
(mean ≈ 0.1), `switch_prob=0.01`, `no_trough_prob=0.01`.

**No intensity/silence threshold anywhere.** librosa.pyin's voicing decision
is **purely a Viterbi decode** over candidate-mass evidence. Silent frames
produce no troughs below threshold → `voiced_prob` is 0 → unvoiced states
receive `(1-0)/N` mass each → Viterbi prefers the unvoiced column.
Silence handling is an emergent property of the observation model, not a
separate gate.

**This is structurally what Syrinx's DSP worker already computes** — the
HMM is exactly the same architecture (300 voiced + 300 unvoiced twin
states, switch_prob=0.01, Beta(2,18) thresholds). The Viterbi traceback
at `dsp-worker.js` line 941–947 produces a `curBest` argmax that includes
the voiced/unvoiced label as part of the state index. Line 954
(`pitchIdx = st >= _PYIN_UNVOICED_OFFSET ? st - _PYIN_UNVOICED_OFFSET : st`)
extracts the pitch but discards the voicing label.

## 3. Original pYIN paper (Mauch & Dixon, ICASSP 2014)

§2.2:
> "We use this idea but develop a more realistic HMM with one voiced (v=1)
> and one unvoiced (v=0) state per pitch (i.e. with 2M pitches) ...
> Assuming that the prior probability of being in either a voiced or an
> unvoiced state is P(v=1) = P(v=0) = 0.5, we define our model's
> observation probability as:
>
> p_{m,v} = 0.5 · pm     for v = 1
> p_{m,v} = 0.5 · (1 − Σk Pk)  for v = 0"

So the unvoiced observation probability is `0.5 × (1 − total_voiced_candidate_mass)`
— missing mass from the candidate distribution becomes evidence for unvoiced.
Identical to the librosa implementation.

**Transition model, eq. (7):**
> "p_v = P(v_t | v_{t−1}) = 0.99 if no change; 0.01 otherwise"

This is the `switch_prob = 0.01` propagated into librosa's default.
Strong stickiness — voicing changes are penalized 99:1.

**Result claim, §3.1:** voicing detection recall 92.5%/94.1%/95.0% and
specificity 91.9%/90.6%/88.9% across three Beta-distribution variants.
**No intensity threshold appears anywhere in the algorithm.** Voicing
decisions are purely from candidate-mass distribution + HMM stickiness.

## 4. Other implementations (Talkin RAPT, original YIN)

**Talkin 1995 (RAPT, the get_f0/Snack algorithm).** Cited by pYIN as ref [4].
Multi-feature scheme: NCCF peak strength + low-band energy + zero-crossing
rate, combined into candidate strengths fed to a Viterbi path-finder with
voicing transition costs. Same general pattern as Praat: multiple soft
signals → strength score → global Viterbi.

**De Cheveigné & Kawahara 2002 (YIN paper).** Original YIN does NOT
specify a voicing decision at all. It's left to the caller. pYIN's
contribution was adding the HMM voicing layer on top.

## 5. Comparison table

| Method | Signals used | Gate type | Thresholds | Temporal context | Real-speech robustness |
|---|---|---|---|---|---|
| **Syrinx pre-PR (OR)** | intensity (dB), voicedness (HMM-smoothed posterior) | Hard per-frame OR; suppress if EITHER fails | -50 dB, 0.5 | None at gate level | **Poor** — 88% of real speech suppressed; voicedness arm rejects 64% because it measures clean periodicity |
| **Syrinx PR #74 (AND)** | intensity, voicedness | Hard per-frame AND; suppress only if BOTH fail | -50 dB, 0.5 | None at gate level | **Reasonable on tested captures** (76–78% speech kept, 100% noise suppressed) but voicedness arm dormant in practice (within 1pp of intensity-only). Codex's loud-unvoiced concern unvalidated |
| **Praat** | Local AC peak height, frame intensity vs **global absolute peak** | Soft scoring → global Viterbi | voicingThreshold=0.45, silenceThreshold=0.03 (ratio), voicedUnvoicedCost=0.14, octaveJumpCost=0.35 | Full-utterance Viterbi | High — production-grade in phonetics labs since 1993 |
| **librosa.pyin** | YIN candidate-mass distribution only | HMM observation model with voiced/unvoiced state twins | switch_prob=0.01, Beta(2,18), no_trough_prob=0.01 | Full-sequence Viterbi over (2×M)-state HMM | High on music — voicing recall 92.5–95%, specificity 88.9–91.9%. **No intensity gating at all** |
| **Original pYIN** (Mauch & Dixon 2014) | YIN candidate mass | HMM with twin voiced/unvoiced pitch states | switch_prob = 0.01 (P(no change)=0.99), Beta(α=1,β=18) for thresholds | Full-sequence Viterbi | Same as librosa numbers. Designed for clean singing |
| **RAPT** (Talkin 1995) | NCCF peak height, low-band energy, zero-crossing rate | Soft scoring → Viterbi | (multiple) | Full-sequence Viterbi | High — used in get_f0/Snack |

## 6. Three load-bearing observations from the synthesis

**A. pYIN already has an HMM-decided voiced/unvoiced label per frame.**
The `voiced_flag` output (`states < n_pitch_bins`) is the algorithm's *own*
answer to "is this frame voiced." Syrinx is currently throwing this away
and replacing it with a hand-rolled gate downstream. The DSP worker
computes the Viterbi argmax at `dsp-worker.js:941–947`, and the
voiced/unvoiced label is encoded in `curBest` (`>= _PYIN_UNVOICED_OFFSET`
means unvoiced). Line 954 extracts the pitch index but discards the
voicing label. The comment at line 948 says "voicing is advisory, not
gating" — that's the design that produced the fragmentation regression.

**B. No mature implementation thresholds the *posterior* at 0.5 to gate frames.**
librosa.pyin doesn't even *expose* a threshold-on-`voiced_prob` API;
downstream users either consume `voiced_flag` directly (the Viterbi
decision) or use `voiced_prob` as a continuous confidence weight. Praat
uses peak height as input to the path-finder, never as a hard suppress-
the-frame gate. The 0.5 threshold in Syrinx's code has no precedent.
The investigation that motivated PR #74 confirmed empirically why: median
voicedness on real speech is 0.005–0.018, well below 0.5, so the
threshold was structurally wrong for any real-world voice.

**C. The intensity arm should compare against a global/recent peak, not absolute dB.**
Boersma 1993 was explicit about this in 1993 and Praat has used it for
30+ years — `silenceThreshold = local_peak / global_peak < 0.03` makes
the gate adaptive to recording conditions. A hard −50 dB threshold on
absolute intensity is sensitive to mic gain, distance, and ambient noise
floor. The mobile platform-floor measurements already show inputRms
varies by 10× between synthetic fixture and real-mic capture; the same
unit-stable problem applies to absolute-dB gates.

## 7. Recommendation: Outcome 2 (different approach), staged

**Stage 1 — ship PR #74 as a minimum-disruption fix.** The OR→AND change
is strictly an improvement on every measured capture (76–78% speech
kept vs 12% under OR; 100% noise suppressed in tested captures).
Codex's loud-unvoiced concern is real but the AND gate is empirically
no worse than intensity-only on real-mic data (within 1pp). Path A
loud-noise capture is still useful but isn't a blocker for this PR —
the change is monotonically better than what's deployed.

**Stage 2 — surface the pYIN HMM's voiced/unvoiced label.** Concretely:
1. Modify `dsp-worker.js` to return `voicedFlag = (curBest < _PYIN_UNVOICED_OFFSET)`
   alongside `pitch` and `voicedness`.
2. In `useAudioPipeline.js`, gate on `!data.voicedFlag` instead of the
   manual AND.
3. The intensity arm becomes a **safety net for loud-unvoiced noise the
   HMM mis-labels**, not the primary gate.

This is what librosa.pyin consumers do. The HMM is already computing
the right answer; we just need to surface it.

**Stage 3 — adaptive intensity threshold (Boersma-style).** Replace
`-50 dB` with `local_peak / recent_peak < SILENCE_RATIO`. Default 0.03
matches Praat. This handles mic gain / distance / noise floor variation
that the absolute dB threshold can't.

**Stage 4 — real-voice regression suite.** The synthetic-degradation
infrastructure called out in PR #74's CLAUDE.md note becomes the
validation harness for Stages 2–3. Use Hillenbrand recordings attenuated
to inputRms ~0.013 (real-mic baseline), injected via
`--use-file-for-fake-audio-capture`. Test that any future gate
configuration:
- Passes ≥80% of voiced frames on real speech
- Suppresses ≥95% of silence frames
- Suppresses ≥95% of loud-unvoiced frames (fan, AC, typing)

**The current PR is correct to ship**, but it is not the long-term
architecture. The architecture mature implementations converge on is
"let the HMM decide voicing; use intensity as a safety net against
loud-unvoiced noise; never threshold the posterior." Migrating Syrinx
toward that pattern is the meaningful next work item after PR #74.

## 8. Source references

- `praat/fon/Sound_to_Pitch.cpp`, `praat/fon/Pitch.cpp` — fetched from
  github.com/praat/praat master, 2026-05-06.
- Boersma, P. (1993). "Accurate short-term analysis of the fundamental
  frequency and the harmonics-to-noise ratio of a sampled sound."
  IFA Proceedings 17, pp. 97–110.
- librosa Python source at `librosa/core/pitch.py:652–970`. Verified
  against installed librosa version locally.
- Mauch, M. & Dixon, S. (2014). "pYIN: A Fundamental Frequency
  Estimator Using Probabilistic Threshold Distributions." ICASSP 2014.
- Talkin, D. (1995). "A robust algorithm for pitch tracking (RAPT)."
  In Speech Coding and Synthesis.
- de Cheveigné, A. & Kawahara, H. (2002). "YIN, a fundamental frequency
  estimator for speech and music." JASA 111(4), 1917–1930.
- Syrinx code: `src/dsp/dsp-worker.js:941–955` (Viterbi traceback;
  voicing label computed but discarded), `src/audio/useAudioPipeline.js:537–542`
  (current AND gate from PR #74).
- Prior measurement: `measurements/voicedness-gate-pathB-investigation-2026-05-06.md`
  (gate-logic comparison + Path B ruled out).
