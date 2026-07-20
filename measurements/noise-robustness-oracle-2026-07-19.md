# Noise-augmentation oracle + front-end candidate matrix — 2026-07-19

Decides which noise-cancellation approach Syrinx should adopt for noisy
environments, from measured accuracy deltas rather than intuition.
Requested options analysis narrowed to candidates measured here:
**D — notch filtering for tonal interferers** (oracle-informed upper
bound), **E — noise-adaptive detection thresholds** (vt sweep as upper
bound), with **B — RNNoise on the gender/VAD path** pending the gender
matrix, and **A — browser `noiseSuppression: true`** shippable only as
a labeled toggle (not measurable in Node; browser A/B is follow-up).

Infrastructure (new, this pass):

- [scripts/noise-synth.js](../scripts/noise-synth.js) — deterministic
  (seeded) noise generators at 16 kHz: `white`, `pink`, `fan-hum`
  (120 Hz + harmonics + rumble — the documented false-voicing case),
  `mains-complex` (60/120/180/240 Hz, prominent 3rd harmonic — the
  documented octave-pull case), `babble` (sum of 8 talker streams built
  from REAL corpus speech of a different corpus than the target),
  `crickets` (~4.8 kHz pulsed chirps), `cicadas` (3–8 kHz AM drone).
  Crickets/cicadas sit entirely above the 75–400 Hz pitch band by
  design — they discriminate pitch-band-limited consumers from
  full-spectrum ones. SNR is set against the speech track's active
  level; every pitch cell appends a 3 s noise-only tail for
  false-voicing measurement.
- [scripts/noise-augment-oracle.js](../scripts/noise-augment-oracle.js)
  — three modes over real-speech corpora: `pitch` (FDA, production
  Boersma-AC fl 1280 / vt 0.35 / L=2), `gender` (Hillenbrand subset,
  production windowing/VAD/EMA + the q8-v2 model), `cpp` (median-CPP
  bias vs clean).

**Methodology caveat (binding):** speech is real (corpora); the
interference is synthetic. Any front-end tuned against this oracle gets
a field-recorded-noise validation pass before shipping.

## 1. Pitch: baseline degradation (FDA, 100 tracks; clean = 87.0 % correct)

| noise | SNR | correct | oct-down | null | false-voiced (noise-only) |
|---|---|---|---|---|---|
| white | +20/+10/+5 | 86.3 / 80.9 / 68.0 | ~0 | 3.6 / 11.1 / 27.6 | 0 % |
| pink | +20/+10/+5 | 86.6 / 82.8 / 72.4 | ~0–1.4 | 3.2 / 8.6 / 19.5 | 12–16 % |
| crickets | +20/+10/+5 | 86.6 / 81.9 / 73.4 | ~0 | 3.2 / 8.6 / 17.4 | 3 % |
| cicadas | +20/+10/+5 | 86.4 / 81.4 / 70.3 | ~0 | 3.6 / 10.8 / 25.2 | 0 % |
| **fan-hum** | +20/+10/+5 | **73.6 / 41.6 / 32.0** | **15.6 / 46.0 / 49.1** | ~0 | **89–100 %** |
| **mains-complex** | +20/+10/+5 | 85.6 / **71.4 / 48.4** | 0.8 / 8.6 / 15.7 | 4.2 / 13.3 / 31.4 | 0 % |
| babble | +20/+10/+5 | 85.7 / **71.1 / 54.6** | 1.5 / 13.8 / 24.5 | ~2 | 83–100 % |

Reading:

- **Broadband noise degrades gracefully and honestly** — including
  crickets and cicadas, which behave like white noise for the pitch
  path (their energy is out-of-band; what hurts is the leaked wideband
  floor). Errors overwhelmingly become NULLS (honest trace gaps), not
  wrong pitch: octave errors stay ≈0 even at +5 dB. The AC detector
  needs no protection from broadband noise beyond what it has.
- **Tonal noise is the catastrophe, confirming the May
  characterization** — and it's worse than suspected: fan-hum at
  +10 dB SNR (audible but not loud) drops correct to 41.6 % with 46 %
  octave-DOWN *during speech* (the tracker locks to the 120 Hz hum
  under the voice) and paints 100 % of noise-only audio as voiced.
- **Babble is its own category**: the detector "falsely" voices
  noise-only babble because babble genuinely contains voiced speech —
  that is correct detection of the wrong talker, unfixable at the
  signal level short of source separation (out of scope). Trace
  capture during overlapped speech (13.8 % oct-down at +10 dB) is
  likewise a competing-F0 problem, not a noise-suppression problem.

## 2. Direction D upper bound: oracle-informed notch (tonal types)

Biquad notch cascade (Q=30) at the known interferer frequencies:

| noise | SNR | correct (baseline → notch) | oct-down | false-voiced |
|---|---|---|---|---|
| fan-hum | +20 | 73.6 → **86.6** | 15.6 → 0.5 | 89.4 → **0** |
| fan-hum | +10 | 41.6 → **86.1** | 46.0 → 0.6 | 100 → **0** |
| fan-hum | +5 | 32.0 → **84.8** | 49.1 → 0.5 | 100 → **0** |
| mains-complex | +20/+10/+5 | 85.6/71.4/48.4 → **86.5 flat** | → 0.5 | 0 → 0 |
| clean (notch off-target check) | — | 87.0 → 87.0 | — | — |

**Near-total recovery** — within 0.4–2.2 pp of clean at every SNR, the
octave-capture eliminated, false-voicing eliminated, and the clean
reference is untouched. This is the upper bound (the harness knows the
interferer frequencies); the shippable version needs a
persistent-peak detector — the classic design: track narrow spectral
peaks that persist through gate-silent periods (a hum persists when
the voice stops; voice harmonics don't), notch only those, never
within a few Hz of tracked F0 harmonics, cap at ~4 notches. The upper
bound says that engineering is emphatically worth doing.

## 3. Direction E upper bound: noise-adaptive voicing threshold — RULED OUT

vt sweep under noise (an adaptive-threshold gate could at best pick the
per-condition optimum of these columns):

| condition | vt 0.35 (prod) | vt 0.45 | vt 0.55 |
|---|---|---|---|
| clean correct | 87.0 | 85.6 | 82.6 |
| white +5 correct | 68.0 | 55.3 | 41.2 |
| fan-hum +10 false-voiced | 100 % | 100 % | 100 % |
| fan-hum +20 false-voiced | 89.4 % | 89.7 % | 90.1 % |

Raising the voicing threshold **does not reject hum at any tested
setting** — a hum is genuinely periodic, its AC peak is as strong as
voice, so no scalar threshold separates them — while it monotonically
destroys legitimate detections in broadband noise (white +5:
68 → 41 % from vt 0.35 → 0.55). The adaptive-threshold direction is
dead for the tonal problem and strictly harmful for the broadband one.
(It also retroactively validates vt 0.35 from the pitch retune: the
clean-corpus optimum is ALSO the best noisy-speech setting measured.)

## 4. Gender model under noise

(31-speaker Hillenbrand subset, q8-v2 model, production windowing/VAD/EMA;
clean = 31/31)

| noise | acc (+20/+10/+5 dB) | mean |Δscore| vs clean (+5 dB) | noise-only: VAD pass / mean score |
|---|---|---|---|
| white | 31/31 at all | 0.048 | 100 % / 0.21 |
| pink | 31/31 at all | 0.028 | 100 % / 0.16 |
| fan-hum | 31/31 at all | 0.010 | 100 % / 0.04 |
| mains-complex | 31/31 at all | 0.012 | 100 % / 0.32 |
| babble | 31/31, 31/31, **30/31** | 0.155 | 100 % / 0.09 |
| crickets | 31/31 at all | 0.015 | 100 % / 0.25 |
| cicadas | 31/31 at all | 0.058 | 100 % / 0.37 |

Two findings:

- **The v2 classifier is essentially noise-immune on speech.** One
  misclassification in 651 noisy trials, score drift ≤0.06 everywhere
  except babble +5 dB. There is nothing for a denoiser to recover —
  **Option B (RNNoise on the gender path) is ruled out by measurement**:
  it can only add artifact risk to a path that isn't failing. (The
  notch front-end is confirmed harmless here too: identical accuracy,
  drift unchanged.)
- **The real noise problem is the VAD, not the classifier.** Pure noise
  passes the peak-amplitude VAD in 100 % of windows for every noise
  type, and the classifier scores noise masculine-to-neutral (0.04–0.37
  mean). In production, that means every speech pause in a noisy room
  feeds masculine-leaning scores into the EMA, dragging the meter down
  between phrases — an invisible bias that never appears in clean-room
  or clean-corpus testing. The silence-reset never fires because the
  tracker never sees "silent." This is decision-level, not
  signal-level: the fix is a noise-aware VAD (rolling noise-floor
  margin, or coupling the ML gate to the pitch worker's voicedness,
  which the pipeline already computes), and this oracle's noise-only
  VAD-pass metric is its acceptance test (target ≈0 %).

## 5. CPP under noise

(93 Hillenbrand tracks, median-CPP bias vs clean)

| noise | +20 dB | +10 dB | +5 dB |
|---|---|---|---|
| white | −0.26 | −0.55 | −0.70 |
| pink | −0.30 | −0.57 | −0.72 |
| fan-hum | −0.16 | −0.32 | −0.43 |
| mains-complex | −0.12 | −0.15 | −0.16 |
| babble | −0.26 | −0.49 | −0.58 |
| crickets | **0.00** | **0.00** | **0.00** |
| cicadas | −0.14 | −0.34 | −0.47 |

CPP reads at most ~0.7 dB heavier under loud noise (crickets: literally
zero — fully out-of-band). Two mitigating structures already exist:
the vocal-weight gauge is σ-normalized against a per-session baseline
calibrated **in the same room**, so a stationary noise floor is largely
absorbed into μ; and the aggregator only ingests pitch-confirmed
frames. The residual exposure is noise that starts or stops
mid-session (bias vs a locked baseline). Verdict: monitor, don't fix —
and per the analysis in the options review, never feed CPP denoised
audio (any denoiser alters exactly the harmonics-to-noise structure
CPP measures).

## 6. Decision

Measured verdicts, one per candidate:

- **D — persistent-peak notch front-end: BUILD.** Upper bound is a
  near-total recovery of the only catastrophic pitch failure
  (fan-hum +5 dB: 32 → 85 % correct, octave-capture and false-voicing
  eliminated), with measured zero impact on clean speech, the gender
  model, and CPP. Shippable design: track narrow spectral peaks that
  persist through gate-silent frames (a hum outlives the voice; voice
  harmonics don't), never notch within a few Hz of tracked F0
  multiples, cap ~4 notches, feed ALL consumers. Acceptance: this
  oracle's tonal rows within ~2 pp of the oracle-informed upper bound,
  clean row unchanged, plus a field-recorded-hum validation.
- **Gender VAD noise-floor fix: BUILD** (new finding, §4). Peak-VAD
  passes 100 % of noise-only windows and the resulting
  masculine-leaning scores pollute the EMA during every pause in a
  noisy room. Fix at decision level (noise-floor-referenced margin or
  pitch-voicedness coupling); acceptance: noise-only VAD pass ≈0 %
  with clean-speech scoring unchanged on the Hillenbrand oracle.
- **B — RNNoise (any broadband ML denoiser): RULED OUT.** The gender
  model doesn't need it (§4), pitch degrades honestly to nulls under
  broadband noise rather than wrong values (§1), and CPP must never
  see denoised audio. There is no consumer left for it to help.
- **E — noise-adaptive detection thresholds: RULED OUT** (§3) — can't
  reject genuinely-periodic hum at any setting, and strictly harms
  broadband-noise speech accuracy.
- **A — browser `noiseSuppression: true` toggle: NOT RECOMMENDED.**
  Same reasoning as B, plus it processes the whole capture (can't be
  routed per-consumer) and corrupts CPP by construction. Revisit only
  on field reports of a noise class this oracle missed.
- **Babble / competing speech: OUT OF SCOPE** — the detector correctly
  finds the other voice; that's source separation, not noise
  cancellation. Documented as a known limitation.

Net: no broadband noise cancellation at all — the measured problems
are one narrowband front-end (notch) and one decision-level gate fix
(VAD), both of which leave every measurement path bit-identical on
clean speech. "Least impact on detection accuracy" turned out to mean
"don't denoise; remove the two specific failure modes."​

## Reproduction

```
node scripts/noise-augment-oracle.js pitch  [--frontend=notch] [--vt=N] \
  [--noises=a,b,c] [--snrs=20,10,5] [--out=FILE]
node scripts/noise-augment-oracle.js gender [--frontend=notch] [--subset=N]
node scripts/noise-augment-oracle.js cpp
```
