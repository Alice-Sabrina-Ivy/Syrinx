# Stage 2 voicedFlag investigation — empirically failed (PR #74 follow-up)

**Date:** 2026-05-06
**Branch:** `pitch-voicedflag-from-hmm` (deleted; source changes discarded)
**Outcome:** Stage 2 design **does not ship**. Validation captures
showed voicedFlag-as-primary-gate keeps only 32.3% of voice frames
(target ≥76%, Stage 1 baseline 87.3%) — a 55-point regression vs the
deployed AND gate.

**Trigger:** Literature review at
[voicing-decision-literature-review-2026-05-06.md](voicing-decision-literature-review-2026-05-06.md)
identified that mature pitch detectors (Praat, librosa.pyin, original
pYIN paper, RAPT) decide voicing via the HMM/Viterbi MAP rather than
a posterior threshold, and that Syrinx's `dsp-worker.js` was already
computing the Viterbi-decoded voiced/unvoiced label but discarding it.
Stage 2 surfaced that label as `voicedFlag` and used it as the primary
gating signal in `useAudioPipeline.js`. Validation contradicted the
literature review's prediction.

## Implementation summary

Three source files modified:

1. **`src/dsp/dsp-worker.js`** —
   - Added `_pyinLastVoicedFlag` module variable parallel to
     `_pyinLastVoicedness` and `_pyinLastVoicednessObs`.
   - Reset to `null` at top of `detectPitch`; set inside
     `_detectPitchPyinStage2` from the L-back state of the Viterbi
     traceback (`st < _PYIN_UNVOICED_OFFSET`). Time-aligned with the
     pitch return value.
   - Surfaced on the postMessage payload as `voicedFlag: boolean | null`.
   - Updated module-level comment block (was "two voicing signals" →
     "three voicing signals") and the Viterbi-traceback comment that
     incorrectly claimed prior behavior matched librosa.pyin.

2. **`src/audio/useAudioPipeline.js`** —
   - Removed `VOICEDNESS_THRESHOLD = 0.5` constant (no longer used —
     PR #74's gate keyed on `data.voicedness < 0.5`, Stage 2 keys on
     `!data.voicedFlag`).
   - Replaced PR #74's AND gate (intensity AND voicedness-posterior)
     with OR gate (intensity OR `!voicedFlag`). The two arms handle
     disjoint failure modes — see the Q2 framing in this file.
   - Stage 0 / Stage 1 fall back to intensity-only gating (voicedFlag
     is `null` from those paths, so the `typeof === "boolean"` check
     leaves `hmmUnvoiced = false`, gate collapses to intensity).

3. **`src/diag/diag.js`** — `voicedFlag` added to the `lowRes` ring
   schema so future captures preserve it for offline analysis.

## Sanity check (synthetic stimuli)

Quick VM-context check at `/tmp/voicedflag-sanity.mjs` exercising
`detectPitch` directly on three stimuli:

| Stimulus | pitch (Hz) | voicedFlag | voicedness | voicednessObs |
|---|---|---|---|---|
| Clean 200 Hz tone | 200.69 | true ✓ | 1.0000 | 1.0000 |
| White noise | 75.00 | true (unexpected) | 0.5000 | 0.0000 |
| Silence (DC=0) | 75.00 | true (unexpected) | 0.5000 | 0.0000 |

Clean tone: as expected. The other two: unexpected — surfaced a
structural finding (Q1 below) before continuing.

## Q1: voicedFlag on silence — the no-candidates fallback

### Finding

Syrinx's no-candidates fallback at
[src/dsp/dsp-worker.js:853-857](../src/dsp/dsp-worker.js#L853-L857)
diverges from the reference implementations. When pYIN finds no
candidates below threshold (silence, DC, broadband noise without
periodicity):

**Syrinx (current):** distribute observation mass uniformly across
all 600 states (voiced AND unvoiced twins together).
```javascript
} else {
  // No candidates at all → no pitch information. Uniform across both twins.
  const u = 1 / N;
  for (let s = 0; s < N; s++) _PYIN_OBS_LOG[s] = u;
}
```

**librosa.pyin** (`librosa/core/pitch.py:962-968`): put 100% of mass
on the unvoiced half.
```python
voiced_prob = clip(sum(observation_probs[:n_pitch_bins, :], axis=0), 0, 1)
observation_probs[n_pitch_bins:, :] = (1 - voiced_prob) / n_pitch_bins
# When voiced_prob = 0: voiced obs = 0; unvoiced obs sums to 1.0
```

**Mauch & Dixon 2014 paper §2.2:**
```
p_{m,v=1} = 0.5 · pm
p_{m,v=0} = 0.5 · (1 − Σk Pk)
```
When Σk Pk = 0: voiced = 0, unvoiced = 0.5 (with the per-pitch
distribution within unvoiced not explicitly stated in the paper but
treated as uniform by librosa).

### Consequence

Under uniform observations, the Viterbi MAP at
[src/dsp/dsp-worker.js:937-942](../src/dsp/dsp-worker.js#L937-L942)
tiebreaks to state 0 (voiced, lowest pitch). The argmax loop
initializes `curBest = 0` and only replaces on strict-greater-than:
```javascript
let curBest = 0;
let curBestVal = _PYIN_LOG_ALPHA[curOff];
for (let s = 1; s < N; s++) {
  const v = _PYIN_LOG_ALPHA[curOff + s];
  if (v > curBestVal) { curBestVal = v; curBest = s; }
}
```
Equal-probability states leave `curBest` at whatever index it landed
on first. State 0 is the voiced twin at the lowest pitch (75 Hz). So
on silence: `voicedFlag = true, pitch = 75 Hz`.

If Syrinx aligned with librosa (all-mass-on-unvoiced fallback), the
Viterbi MAP would correctly land in the unvoiced half on silence and
`voicedFlag = false`.

### Disambiguation: deliberate, not accidental

**`git blame` and commit context.** Lines 853-857 were introduced in
commit `0568fe25` (Alice Sabrina Ivy, 2026-05-04, *"dsp: replace
YIN+multi-mult with pYIN at σ=50 cents, L=4 lookback"*). The commit
shipped pYIN Stage 2.B as the production pitch detector with the
uniform-fallback obs distribution from day one — not an evolved
shortcut.

**Documented design intent.** The companion measurement
[pass4-stage2b-final-baseline-2026-05-04.md:50-83](pass4-stage2b-final-baseline-2026-05-04.md)
describes the rationale verbatim:

> "The HMM-smoothed posterior on silence is structurally ~0.5, not 0.
> Silence/DC/no-candidate input triggers the worker's uniform-fallback
> obs distribution (no information → uniform Bayesian response). The
> HMM forward step then propagates equal mass to voiced and unvoiced
> twins, and the LSE ratio collapses to 0.5. This is *correct*
> algorithm behavior — the HMM is honestly saying 'I don't know if
> this is voiced'."

**Test infrastructure depends on it.**
[tests/dsp/pitch-detection-comprehensive.js:296-340](../tests/dsp/pitch-detection-comprehensive.js#L296)
explicitly tests silence/DC/noise via `voicednessObs < 0.05` rather
than `voicedness < threshold`, with comments calling out that the
HMM-smoothed voicedness on silence is "structurally ~0.5" and
voicednessObs is the right signal to ask "is there pitch evidence".
The test was written around the deliberate divergence — pass4 §"Why
both exist" notes the dual-signal architecture exists *precisely
because* the smoothed posterior can't distinguish silence (~0.5) from
voiced-with-shallow-CMND (~0.05).

**Verdict: the divergence is deliberate and load-bearing.** It was
introduced to give the smoothed posterior a defensible "I don't know"
fallback semantics. The trade-off:
- ✓ `voicedness` posterior reads as 0.5 on silence (uniform Bayesian
  response, intuitively correct).
- ✗ `voicedFlag` is unreliable on silence (Viterbi MAP tiebreaks to
  voiced state 0).

When Stage 2.B was designed, voicedFlag wasn't a downstream consumer —
gating used the smoothed posterior directly. The trade-off was made
without considering the Viterbi-MAP failure mode on silence. Stage 2
of this branch makes voicedFlag a downstream consumer for the first
time, which exposes the failure mode.

### Decision for this PR: keep the divergence; safety-net handles it

Aligning with librosa/paper would expand scope significantly:

- Changes `voicedness` baseline on silence from ~0.5 → ~0.
  Documented test + measurement assumptions (pass4, comprehensive
  test) would need updating.
- Pass4's full-corpus baseline (Hillenbrand mean F0 error 12.2 Hz)
  was measured under the uniform-fallback dynamics. HMM recovery
  behavior on speech-silence-speech transitions could shift; the
  baseline would need re-measurement to confirm no regression.
- Possible knock-on effects on voicednessObs's stated role (the dual-
  signal architecture exists *because* of the uniform-fallback choice;
  removing the divergence might make voicednessObs redundant).

Stage 2's intensity safety-net catches silence directly. The OR-logic
gate (`intensityQuiet || hmmUnvoiced`) covers the Viterbi-MAP-on-silence
failure mode without changing the underlying algorithm:

- **Silence frames:** `intensity` well below −50 dB → `intensityQuiet`
  fires → frame suppressed. Doesn't matter that voicedFlag = true.
- **Loud-but-unvoiced frames** (fan, AC, typing): `intensity` above
  −50 dB → `intensityQuiet` doesn't fire → voicedFlag is the primary
  defense. Validity depends on whether pYIN's HMM correctly classifies
  these as unvoiced from candidate-mass evidence (load-bearing
  question, validates against Codex's PR #74 concern).

**Open future investigation (not this PR):** is the deliberate
divergence still the right design choice, given that voicedFlag is now
a downstream consumer? Aligning with librosa would simplify Stage 2's
mental model (voicedFlag becomes universally reliable) at the cost of
re-baselining pass4. That's a separate algorithmic decision that
should be measurement-driven on its own.

## Q2: gate-comment framing

Stage 2's gate logic has been re-framed in the
`useAudioPipeline.js:handleAnalysisResult` comment block to reflect
that intensity and voicedFlag handle **disjoint failure modes**, not
"primary signal with safety net". The two arms catch failure modes
the other can't:

- `intensity < SILENCE_THRESHOLD_DB` catches silence and below-floor
  audio. The HMM's voicedFlag is unreliable on near-silent frames
  (Q1 finding above).
- `!voicedFlag` catches loud-but-unvoiced audio (mechanical noise,
  typing, etc.) where intensity alone would let phantom pitch
  through. Matches librosa.pyin's Viterbi-decoded voicing convention.

Both arms are necessary; neither alone is sufficient.

## Validation result — Stage 2 fails on real speech

Captures taken on the Stage 2 build via the desktop attach harness:
- voice: `mstp-2026-05-06T16-56-20-533Z.json` (90 s direct voice, 1200 frames)
- noise: `mstp-2026-05-06T16-58-01-961Z.json` (30 s quiet ambient, 1200 frames)

Pass rates under three gate configurations (debounced via
`SILENCE_DEBOUNCE_FRAMES = 3`):

| Gate | Voice kept | Noise suppressed |
|---|---|---|
| Stage 0 (intensity-only)             | 85.7% | 99.8% |
| Stage 1 / PR #74 (intensity AND voicedness < 0.5) | 87.3% | 99.8% |
| **Stage 2 (intensity OR !voicedFlag)** | **32.3%** | **99.8%** |

Voice criterion (≥76% kept): **FAIL.** Stage 2 keeps 32.3% — a
55-point regression vs Stage 1. Noise criterion holds (the
intensity safety-net handles silence regardless of voicedFlag).

## Why — structural finding

`voicedFlag` is `false` on **872 / 1200** voice frames (73% of
audible speech). The Viterbi MAP parks in the unvoiced twin on real
speech, not the voiced twin. Tracing the observation model — for
each pitch s:

```
obs[V(s)]  = voicedness × pitch_obs_n[s]
obs[UV(s)] = (1 − voicedness) × pitch_obs_n[s]
```

When per-frame voicedness on real speech is structurally ~0.005–0.018
(the very finding PR #74 characterized), the unvoiced twin
observation is 50–200× larger than the voiced twin observation **at
every pitch**. The 99:1 voicing-stickiness prior reinforces voiced
state once entered, but doesn't rescue the per-frame MAP from the
overwhelming unvoiced-side observation evidence. The HMM-smoothed
posterior `voicedness` and the Viterbi-decoded `voicedFlag` are
downstream of the same per-frame factor and exhibit equivalent bias
on real speech.

## Methodology lesson

The literature review's recommendation ("use librosa.pyin's canonical
voicedFlag output") was load-bearing on an empirical claim that
**doesn't transfer from clean monophonic music to real conversational
speech.** Mauch & Dixon 2014's voicing recall numbers (92.5–95.0%)
were measured against the RWC Music Database (singing). Real speech
has higher per-frame variance in candidate-mass evidence than
sustained singing notes, and pYIN's voicing layer underperforms in
that regime regardless of which downstream signal is used (posterior
or MAP).

Praat's approach (peak-height-vs-global-peak ratio fed to a
path-finder) is fundamentally different from pYIN's
candidate-mass-vs-Beta-CDF and likely wouldn't have this failure
mode — but it isn't a drop-in for pYIN's architecture, so adopting
it is genuine algorithmic surgery, not a parameter change.

**General lesson for future literature-driven work:** when a
recommended approach has empirical backing from a specific corpus,
the corpus's characteristics matter as much as the algorithm. Music
research validates against music; speech research validates against
speech. Crossing the boundary needs explicit re-validation before
ship claims, not after.

## What landed where

- **Source changes discarded.** `src/dsp/dsp-worker.js`,
  `src/audio/useAudioPipeline.js`, `src/diag/diag.js` reverted on the
  branch; the branch itself was deleted. The Viterbi argmax at
  [src/dsp/dsp-worker.js:937-942](../src/dsp/dsp-worker.js#L937-L942)
  continues to compute the voicedFlag label internally; it remains
  unsurfaced.
- **PR #74's AND gate stays as production.** No regression in the
  deployed code.
- **This file preserved** as durable methodology record, bundled with
  the next investigation's PR.

## Q1 disambiguation result (kept here for the historical record)

The no-candidates fallback at
[src/dsp/dsp-worker.js:853-857](../src/dsp/dsp-worker.js#L853-L857)
distributes obs probability uniformly across all 600 states (voiced
AND unvoiced twins). This diverges from librosa.pyin
(`librosa/core/pitch.py:962-968`) and the Mauch & Dixon paper §2.2,
which put 100% of mass on unvoiced when `voiced_prob = 0`.

`git blame` and the companion measurement
[pass4-stage2b-final-baseline-2026-05-04.md:50-83](pass4-stage2b-final-baseline-2026-05-04.md)
confirm the divergence is **deliberate and load-bearing**:

> "The HMM-smoothed posterior on silence is structurally ~0.5, not 0.
> ... no information → uniform Bayesian response. ... This is *correct*
> algorithm behavior — the HMM is honestly saying 'I don't know if
> this is voiced'."

[tests/dsp/pitch-detection-comprehensive.js:296-340](../tests/dsp/pitch-detection-comprehensive.js#L296)
explicitly tests silence/DC/noise via `voicednessObs < 0.05` rather
than `voicedness < threshold`, with comments calling out that the
HMM-smoothed voicedness on silence is "structurally ~0.5" — the dual
voicedness/voicednessObs signal architecture exists *because* of this
deliberate design choice.

The Q1 finding is moot for the discarded Stage 2 design (the speech-
frame failure mode dominates regardless of how the silence-frame
fallback is configured), but the disambiguation work stays useful for
any future investigation that touches the no-candidates branch.

## Open questions deferred to future investigations

1. **Per-frame voicedness factor weighting in the observation model.**
   Reweighting `obs[V] / obs[UV]` so the per-frame voicedness has less
   runaway effect on the Viterbi MAP would change the speech-frame
   failure mode characterized here. Algorithmic surgery, requires
   re-baselining pass4 (Hillenbrand mean F0 error 12.2 Hz). Not yet
   evaluated.
2. **Praat-style architecture as a separate pitch detector path.** The
   peak-height-vs-global-peak design is robust on speech in a way
   pYIN's candidate-mass approach isn't. Could ship as Stage X
   alongside pYIN with runtime selection. Significant work; not yet
   scoped.
3. **Real-voice regression suite** (still relevant — would have caught
   Stage 2 in CI before any captures): use Hillenbrand attenuated to
   inputRms ~0.013 via `--voice-file` injection, test pass rate
   against any future gate change. Public-domain corpus, no
   developer-voice involvement. Stage 4 in the original roadmap.
