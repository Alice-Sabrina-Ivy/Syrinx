# Pitch octave arbitration: odd/even partial-prominence evidence — 2026-10-03

**Shipped config ("A"):** `octaveCost` 0.01 → 0.015 and
`octaveEvidence { lowThrDb -15, lowPenalty 0.05, highThrDb -3,
highPenalty 0.03, fMaxHz 3500, maxMultiple 16 }` in
[src/dsp/boersma-ac.js](../src/dsp/boersma-ac.js), plus a rumble
regression case in [tests/dsp/boersma-ac-test.js](../tests/dsp/boersma-ac-test.js).
No tracker change.

**2026-10-04 correction:** this file's "strict" convention was session-label R1
alone, not R1&CC. Under true R1&CC the low-voice octave-up cost narrowly fails
the ~0.3 pp guard, also in the combined chain (measured on the private session
recordings; results kept outside this repository) — see the note under
§References and [target-voice-combined-validation-2026-10-03.md](target-voice-combined-validation-2026-10-03.md).

One of five measured workstreams from the 2026-10-03 half-pitch
investigation, integrated in this order:
[pitch-globalpeak-transient-2026-10-03.md](pitch-globalpeak-transient-2026-10-03.md) →
this file → [pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md) →
[noise-notch-voice-safety-2026-10-03.md](noise-notch-voice-safety-2026-10-03.md) →
[pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md).
Measured independently against the then-production chain (origin/main
at f92b11a, 75–400 Hz search). At integration the globalPeak change
composes exactly with this one: on two 120 s slices of private session recordings the combined
module's voiced candidate list (freq/strength/r) equals this file's
proposed module and its `unvoicedStrength` equals the globalPeak
proposal's, frame for frame (0 mismatches; the arbitration touches only
candidate strengths, the reference only reads `r`).

## 0. Motivation

The user reported that the pitch trace sometimes shows **half** the real
pitch. Phase-1 of the 2026-10-03 investigation (scratch
`build/investigate-2026-10-03/`) split the problem into a detector part
and a display-chain part. This file covers only the detector part:

- On a raised (target) voice the worker decodes the half-pitch candidate
  on a substantial share of frames (measured on the private session
  recordings; results kept outside this repository).
- Root cause: low-frequency energy (room rumble below 140 Hz, LF speech
  energy) raises the autocorrelation at the 2T lag. The correct
  candidate is almost always present in the octave-down frames and loses
  by a small strength margin. Praat parity was ruled out (Praat AC makes
  the same call).
- Public material shows the same failure: the known vocadito_34 track is
  decoded an octave down on ~46 % of frames, and a synthetic 220 Hz voice
  under 90 Hz rumble at −10 dB decodes correctly on 0 % of frames (§5b).
- Earlier tuning only scored the 80–110 Hz register, so a target-voice
  regression of this kind could not show up there.

Task: pick the octave-arbitration change in `boersma-ac.js` (plus any
tracker change) that gets the most out of the 160–400 Hz target band
while staying inside the gender-symmetric guards. The target-band and
low-voice (75–160 Hz) metrics that drove the selection were scored on the
private session recordings; results on the private session recordings are kept outside this repository.

## 1. Harnesses and conventions

All code lives in `build/measure-2026-10-03/detector-octave/` in the
main checkout, which is gitignored scratch (not in the repo; phase-1
harnesses are under `build/investigate-2026-10-03/`). The committed guard
is `tests/dsp/boersma-ac-test.js`.

| harness | what it runs | used for |
|---|---|---|
| `investigate-2026-10-03/session-attribution/chain-harness.js` (unchanged) driven by `runvar.sh` / `launch.sh` | the full production chain on the private session recordings: notch, AC, L=2 tracker, ghost veto, harmonic guard, then on the main thread the silence gate, 400 ms hold, 2-hop lag, median-3 and paint gate | **canonical** decoded and displayed numbers (kept outside this repository) |
| `score.py` | per band/stage/speaker scoring of chain runs under both reference conventions | session tables |
| `dumpfeat.mjs` + `simdec.mjs` | dumps production candidates plus per-pair evidence features once (sessions and corpora), then replays penalty rules through the production tracker | fast screening of about 900 rule configurations (decoded only) |
| `corpus.mjs` | FDA, PTDB-TUG, Hillenbrand and vocadito in the production worker regime: streaming resample, notch, L=2, veto, guard | corpus guards, decoded (`dec`) and posted (`post`) |
| `synth.mjs` | the phase-1 synthetic generator (cached stimuli), detector plus L=2 | weak-H1 low voices, rumble, breathy voice, glides |
| `noise-oracle.mjs` | `scripts/noise-augment-oracle.js` copy with the detector swappable via `OCT_TAG` | noise-only false voicing |
| `test-prop.mjs` | `tests/dsp/boersma-ac-test.js` plus the new case, run against the proposed module | frame-level guard |
| `cpu.mjs` | ms/frame of candidates() plus emit, production and proposed interleaved | CPU |

**References and selection (session runs):** consensus (`cons`, a
majority across the AC, SHS and PENN method families) and session-label R1
("strict"; see the correction above) on the private session recordings;
configurations were selected on three tuning recordings with one held out.
Results on the private session recordings are kept outside this repository.

- The simulator and corpus classes also count 1/3 as half and 3× as up,
  so their absolute "up" numbers run about 0.1 pp higher than
  `score.py`'s.

## 2. Baseline match

- `runs/prod` (the chain harness on the real `src/dsp/boersma-ac.js`) is
  **byte-identical** to phase-1's `session-attribution/runs/baseline` on
  every column of every hop and for the candidate dump (`cmp`).
- `runs/v_default` (scratch variant module `acx.js`, all options off) is
  byte-identical to `runs/prod`.
- `runs/pA_off` (the **proposed** module with `octaveEvidence: null,
  octaveCost: 0.01`) is byte-identical to `runs/prod`. The new code path
  is inert when disabled.
- The simulator replaying the dumped production candidates reproduces
  the chain harness's `dec` column with **0 mismatching frames**.
  Replaying the recommended rule matches the real proposed module on
  ≥ 99.7 % of frames (the rest from float32 storage of strengths). Every
  headline number comes from the real module through the chain harness
  or corpus harness, not from the simulator.
- (These checks ran on the private session recordings; the baseline
  numbers they reproduce are kept outside this repository.)

## 3. Which evidence separates "f is a subharmonic of a real 2f" from "f is a real F0"?

Candidate features were compared by ROC on contested octave pairs
(f, 2f) — |s(f) − s(2f)| < 0.10 — from the private session recordings,
where the consensus reference matches one member (`pairsel.py`,
`probe.mjs`, `roc.py`; results on the private session recordings are kept outside this repository). All features are computed
from the frame's own power spectrum (the one autocorrFFT already builds):
the phase-1 SHR_hi amplitude-sum (all multiples < 3500 Hz) and its
first-2/first-3-odd and tolerance-capped variants, the odd-dip median,
**odd − even partial prominence** (peak over half-spacing valleys),
H1 − H2, and logistic combinations.

Findings:

- **No feature is clean in the contested region.** When a real low voice
  has s(2f) ≈ s(f), it is usually *because* its odd harmonics are weak,
  so the spectral evidence and the AC say the same thing. That is why
  phase-1's amplitude-sum rule raised low-voice octave-up.
- **Choice of feature matters most for the male corpora.** Every
  amplitude-sum SHR variant that helps the target band pushes real
  **PTDB male 125–160 Hz** voices up (+0.34 to +0.9 pp). The
  prominence and odd-dip features leave **every male corpus band at
  +0.00**. Prominence is formant-envelope-insensitive (each partial is
  compared with its own neighbouring valleys) and noise-insensitive
  (noise lowers odd and even prominence together, so the difference
  stays near 0).
- AND-combining with H1−H2 helps the ROC but not the guarded frontier
  (§4). It would also re-open the weak-H1 failure class if weighted
  heavily, so it was rejected.

## 4. Sweeps

### 4a. Screening (simulator, decoded value; full grids in `sweep/s1..s6.csv`)

The grids covered:
- SHR_hi amplitude thresholds {−6, −9, −12, −15, −18, −21, −24} ×
  penalty {0.05, 0.10}
- the 0.03/0.07 penalties in the chain harness (§4b)
- first-2/first-3 odd multiples, the 2000 Hz cap, the tolerance cap,
  odd-dip, prominence and H1H2
- AND and linear combinations
- the symmetric up-term
- octaveCost 0.01/0.015/0.02
- graded penalty (span 6 dB)
- conditional delta {0.05, 0.10, 0.15}
- tracker: an exact-octave jump discount toward strong-evidence
  candidates (thresholds −15/−18/−21 dB × factor 0.5/0.25/0), and
  octaveJumpCost {0.10, 0.12, 0.18, 0.25}

In total 433 + 107 + 109 + 90 + 53 + 14 configurations.

Representative rows, corpus columns ("up" includes 3×; the target-band
and low-voice columns, scored on the private session recordings, are kept
outside this repository):

| config | PTDB m 125-160 up | PTDB m <125 up | FDA m up | Hill. m up | PTDB m cor | FDA f cor | vocadito cor | vocadito_34 cor | max(F,M) err |
|---|---|---|---|---|---|---|---|---|---|
| production | 0.11 | 0.19 | 0.26 | 0.63 | 86.39 | 87.77 | 95.91 | 53.51 | 37.97 |
| octaveCost 0.015 | 0.11 | 0.19 | 0.30 | 0.75 | 86.46 | 87.92 | 96.35 | 61.21 | 37.92 |
| octaveCost 0.02 | 0.11 | 0.19 | 0.30 | 0.83 | 86.46 | 88.11 | 96.62 | 65.75 | 37.89 |
| SHR_hi amp −12 dB / 0.10 (phase-1) | **0.90** | 0.22 | 0.26 | 0.71 | 86.22 | 88.22 | 97.57 | 88.86 | 37.87 |
| SHR_hi amp −12 / 0.05 | **0.45** | 0.19 | 0.26 | 0.65 | 86.33 | 88.22 | 97.29 | 79.50 | 37.77 |
| SHR_hi amp −24 / 0.05 | 0.11 | 0.19 | 0.26 | 0.63 | 86.39 | 87.84 | 96.84 | 72.35 | 37.92 |
| SHR first-3-odd −15 / 0.10 | **0.79** | 0.19 | 0.26 | 0.70 | 86.35 | 88.22 | 97.66 | 91.47 | 37.83 |
| SHR first-3-odd −30 / 0.05 | 0.11 | 0.19 | 0.26 | 0.63 | 86.39 | 87.99 | 96.89 | 72.35 | 37.90 |
| odd-dip(3) −25 / 0.05 | 0.11 | 0.19 | 0.26 | 0.63 | 86.39 | 87.92 | 97.00 | 75.38 | 37.88 |
| H1−H2 −25 / 0.10 | 0.11 | 0.19 | 0.26 | 0.63 | 86.54 | 88.33 | 96.51 | 58.32 | 37.61 |
| SHR3 < −15 AND H1H2 < −20 / 0.15 | 0.11 | 0.19 | 0.26 | 0.63 | 86.52 | 88.26 | 96.82 | 66.71 | 37.72 |
| prominence −12 / 0.10 | 0.11 | 0.19 | 0.26 | 0.63 | 86.39 | 88.22 | 97.54 | 89.00 | 37.74 |
| prominence −15 / 0.05 | 0.11 | 0.19 | 0.26 | 0.63 | 86.39 | 87.95 | 97.10 | 76.34 | 37.82 |
| + up-term (≥ −3 dB → 2f −0.03) | 0.11 | 0.16 | 0.17 | 0.52 | 86.41 | 87.95 | 97.09 | 76.20 | 37.91 |
| **+ up-term + octaveCost 0.015 (RECOMMENDED, "A")** | 0.11 | 0.16 | 0.22 | 0.65 | 86.48 | 87.99 | 97.23 | 78.27 | 37.88 |
| A, only when \|s(f)−s(2f)\| < 0.05 | 0.11 | 0.16 | 0.22 | 0.65 | 86.48 | 87.99 | 97.15 | 76.48 | 37.88 |
| A with penalty 0.10, delta 0.10 | 0.11 | 0.16 | 0.22 | 0.65 | 86.48 | 87.99 | 97.43 | 84.59 | 37.88 |
| A + jump discount ×0.5 (prominence < −21) | 0.11 | 0.16 | 0.22 | 0.65 | 86.48 | 87.92 | 97.25 | 78.54 | 37.88 |
| A + octaveJumpCost 0.12 | 0.11 | 0.19 | 0.26 | 0.76 | 86.50 | 88.14 | 97.25 | 78.27 | 37.88 |
| A + octaveJumpCost 0.18 | 0.00 | 0.11 | 0.17 | 0.53 | 86.43 | 87.95 | 97.21 | 78.27 | 37.86 |
| octaveJumpCost 0.10 alone | 0.23 | 0.19 | 0.30 | 0.91 | 86.41 | 87.95 | 96.17 | 56.81 | 37.94 |
| jump discount alone (prominence < −15, ×0) | 0.11 | 0.19 | 0.26 | 0.63 | 86.39 | 87.65 | 96.57 | 62.59 | 37.90 |

Bold marks a male-corpus guard violation (more than +0.3 pp octave-up).

Findings:

- **The binding guard is the low voice (75–160 Hz octave-up) on the
  private session recordings**, tightest under the strict convention.
  Male corpora stay inside every guard for every prominence/odd-dip
  configuration. Female corpora and vocadito improve for every
  configuration.
- Among the configurations that satisfy every guard, the frontier of
  target-band gain is flat; graded penalties and delta conditioning move
  along the same gain/cost curve.
- **The up-term is load-bearing.** Without it, prominence −15/0.05 plus
  octaveCost 0.015 costs more low-band octave-up; alone it is nearly
  neutral and slightly lowers male octave-up (corpus columns above).
- **Tracker changes do not help** on top of the detector fix: jump
  discounts give no gain at equal cost, octaveJumpCost 0.10–0.12 buys
  target accuracy only by spending low-band octave-up, and
  octaveJumpCost 0.18 is a lower-gain point on the same curve.

  See §6 for the tracker's net effect.

### 4b. Canonical chain harness (decoded and displayed under the CURRENT display chain)

The canonical chain-harness grid (production, octaveCost 0.015 / 0.02,
sub-floor high-pass 60 / 70 Hz 2nd / 4th order, phase-1 hpo100, the SHR
amplitude grid −6/−9/−12/−15 dB × 0.03/0.05/0.07/0.10, prominence
variants and A) was run on the private session recordings; results on the private session recordings are kept outside this repository.
**Sub-floor HP 60/70 Hz was neutral to negative**, consistent with
phase-1: the harmful LF energy sits **above** the 75 Hz floor
(90–140 Hz). Rejected.

## 5. Recommended configuration: A

```
octaveCost: 0.015
octaveEvidence: { lowThrDb: -15, lowPenalty: 0.05, highThrDb: -3, highPenalty: 0.03, fMaxHz: 3500, maxMultiple: 16 }
path tracker: unchanged (ojc 0.15, vuc 0.20, L 2)
```

For each candidate f that has a partner within 5 % of 2f, `E =
mean_odd(prom) − mean_even(prom)` is computed over multiples
m = 2..16 with m·f < 3500 Hz.
- prom(m) is the peak power within ±min(3 % · mf, 0.2 f) of mf, divided
  by the mean power of the valleys at (m ± ½) f (±0.1 f), in dB.
- f itself (m = 1) is deliberately excluded, because that is where
  rumble sits.
- If E ≤ −15 dB, f loses 0.05 strength.
- If E ≥ −3 dB, its 2f partner loses 0.03.

The power spectrum is the one autocorrFFT already computes; it is copied
into a pre-allocated array, so there is no extra FFT.

### 5a. Primary: target band 160–400 Hz (chain harness)

Scored on the private session recordings (pooled and held-out, both
reference conventions); results on the private session recordings are kept outside this repository. Displayed half pitch fell, but the
displayed **correct** gain is smaller than the decoded gain. That is a
display-chain effect: the paint gate's level is anchored at the low voice
and suppresses a now-correct high value as "off-level" instead of painting
a wrong half value. This is phase-1 finding 2, addressed by the
display-chain workstream
([pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md):
post-gap re-acquisition; the hold no longer feeds the gate).

### 5b. Guards

**Low voice 75–160 Hz (chain harness, private session recordings):** the
decoded octave-up cost of A sits just inside the ~0.3 pp guard under the
consensus reference and the R1-only convention, and narrowly fails it under
true R1&CC (see the 2026-10-04 correction under §References). The variant
"A, only when |s(f)−s(2f)| < 0.05" leaves more margin for a little less
target gain; it is the fallback if a later re-measurement tips over the
limit. Results on the private session recordings are kept outside this repository.

**Corpora (corpus harness, production worker regime; decoded / posted):**

| metric | production dec | A dec | production post | A post |
|---|---|---|---|---|
| FDA male correct / up | 86.10 / 0.26 | 86.15 / 0.22 | 85.76 / 0.17 | 85.76 / 0.17 |
| FDA female correct / down | 87.73 / 0.87 | 87.95 / 0.68 | 87.69 / 0.87 | 87.88 / 0.68 |
| PTDB male <125 up | 0.19 | 0.16 | 0.19 | 0.16 |
| PTDB male 125–160 up | 0.11 | 0.11 | 0.11 | 0.11 |
| PTDB male correct | 86.39 | 86.48 | 84.20 | 84.27 |
| PTDB female correct / down | 95.00 / 0.97 | 95.11 / 0.88 | 94.92 / 0.97 | 95.04 / 0.88 |
| Hillenbrand men correct / up | 61.23 / 0.58 | 61.33 / 0.61 | 61.21 / 0.53 | 61.32 / 0.56 |
| Hillenbrand women correct / down | 61.60 / 0.79 | 61.70 / 0.55 | 61.58 / 0.79 | 61.68 / 0.55 |
| vocadito correct / down (all) | 97.34 / 1.70 | 97.84 / 1.25 | 96.98 / 1.70 | 97.48 / 1.22 |
| vocadito ≥160 Hz down | 1.03 | 0.40 | 1.02 | 0.37 |
| **vocadito_34** correct / down | 53.51 / 45.94 | **78.13 / 21.18** | 53.23 / 43.74 | **77.72 / 19.39** |
| max(F_err, M_err) | 38.77 | 38.67 | 38.79 | 38.68 |

Hillenbrand's low absolute "correct" comes from short isolated vowels
and their nulls. It is the same in both columns.

Every guard passes:
- Male octave-up moves by ≤ +0.03 pp; it falls on FDA and PTDB <125.
- Male correct is flat to up.
- Every female corpus improves.
- vocadito_34, the known 42 %-down track, recovers 24.6 pp.

**Synthetic (detector + L=2, decoded % correct; `synth.mjs`, 2 reps × f0 grid):**

| stimulus | production | A |
|---|---|---|
| weak-H1 low voices, H1 −12 dB re H2 (80–140 Hz) | 100.0 | 100.0 |
| weak-H1 low voices, H1 −16 dB + jitter/shimmer | 100.0 | 100.0 |
| weak-H1 −12 dB, breathy (SNR 15) | 100.0 | 100.0 |
| low clean / low breathy / low sine-like / low glide | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| weak-H1 + 150 Hz rumble 0 dB (octave-up stays 0.2) | 71.3 | 71.2 |
| 150–400 Hz clean / bright / breathy / breathy10 / jitter-shimmer / glides ±½ oct | 100 (all) | 100 (all) |
| 150–400 Hz vibrato | 98.5 | 100.0 |
| 150–400 Hz + 90 Hz rumble at −10 dB | 37.3 | **63.1** |
| 150–400 Hz + rumble at 0 dB | 15.8 | 22.4 |
| 150–400 Hz + rumble at +5 dB | 12.9 | 14.0 |
| breathy + rumble at −10 dB | 39.1 | 46.2 |
| breathy + rumble at 0 dB | 17.9 | 20.0 |

No synthetic class regresses by more than 0.1 pp. The new unit case
reproduces the rumble failure: 220 Hz voice plus 90 Hz rumble at −10 dB
decodes correctly on 0.0 % of frames in production and ≥ 80 % (96 %
measured) with A. The low-voice control, 110 Hz under the same rumble,
stays at 100 %.

**Noise-only false voicing** (`noise-oracle.mjs pitch --frontend=tracker
--snrs=10`, FDA + 3 s noise-only tail, production notch + guard):

| noise | production FV % | A FV % | production speech correct | A speech correct |
|---|---|---|---|---|
| white | 0.0 | 0.0 | 80.7 | 80.7 |
| pink | 0.5 | 0.8 | 81.8 | 81.9 |
| brown | 0.7 | 0.7 | 86.2 | 86.3 |
| sleep-noise | 0.2 | 0.3 | 86.1 | 86.1 |
| sleep-birdies | 0.6 | 0.7 | 86.0 | 86.1 |
| resonant-noise | 0.1 | 0.1 | 77.2 | 77.1 |
| fan-hum | 0.2 | 0.2 | 85.5 | 85.6 |
| mains-complex | 0.0 | 0.0 | 85.9 | 86.0 |
| crickets | 0.9 | 0.1 | 81.7 | 82.0 |
| cicadas | 0.0 | 0.0 | 80.7 | 80.8 |
| (babble: the tail is speech) | 98.1 | 98.5 | 71.9 | 72.2 |
| clean speech | — | — | 86.8 | 86.9 |

Mean false voicing over the 10 non-babble classes is 0.32 % (production)
and 0.29 % (A); the largest increase is pink at +0.3 pp. Speech accuracy
is flat or better on every class. The change touches only candidate
*strengths* inside octave pairs, never voicing evidence, so this is the
expected result.

**Other checks:**

- **Voicing:** decoded and displayed nulls on the private session
  recordings were flat (results kept outside this repository); the
  harmonic guard vetoes less, because a correct 2f has the harmonic
  structure the guard checks for.
- **Unit tests:** `tests/dsp/boersma-ac-test.js`, including weak-H1 and
  the 396–400 Hz ceiling cases, passes 25/25 on the proposed module. With
  the new rumble case it passes 27/27. Production fails the new case
  (26/27), so the test guards the fix. (On the integrated branch the file
  also carries the globalPeak transient cases: 33/33 after this commit.)
- **CPU:** candidates() plus emit on 5 min of speech audio, production
  and proposed interleaved on a machine under heavy background load. The
  machine was running the noise oracle and harnesses, hence the absolute
  ~0.6 ms/frame against ~0.2 ms unloaded. Production 0.59–0.66 ms/frame,
  proposed 0.60–0.69 ms/frame; three runs gave deltas of −0.012, +0.013
  and +0.052 ms/frame. That is within noise and **≪ 25 ms hop**. The
  arbitration costs about 15 multiples × ~30 bin reads for each candidate
  that has a 2f partner, with no FFT.

## 6. Tracker: net effect after the fix

Frame-local argmax (`fl`) against L=2 decoded (`dec`) was compared on the
private session recordings (results kept outside this repository). The
tracker still adds some half-pitch frames on the target band (runs that
start in the low octave), but fewer once the detector arbitrates better.
Its net effect is positive in both bands: it removes octave-up spikes and
nulls. Every tracker modification measured (§4a) fails to improve the
guarded frontier. **No tracker change is recommended.**

## 7. Reference caveat on the low-band cost

The low-band "correct → up" flips caused by A on the private session
recordings were checked with the mandated spectral odd-multiple arbiter
(`session-attribution/subharmonic.py`), asking whether 2×ref is the
physical F0: most of them sit on frames where the spectrum supports the
*higher* octave (results on the private session recordings are kept outside this repository). The arbiter shares the
detector's physical principle (odd multiples), so it is circular and is
**not** used to relax the guard. It does mean the measured low-band cost
is probably an upper bound.

## 8. Rejected options (and why)

- **Phase-1 SHR_hi amplitude-sum rule, at every threshold/penalty that
  gives a useful target-band gain.** The low-voice octave-up guard fails
  under the strict convention at every cell of the −6/−9/−12/−15 dB ×
  0.03/0.05/0.07/0.10 grid (private session recordings), and PTDB male
  125–160 up rises +0.34 to +0.9 pp. Amplitude sums are dominated by the
  strongest even partial (F1 at 2f), so real male voices with an F1 on an
  even harmonic look "odd-weak".
- **Restricting to the first 2/3 odd multiples, the 2000 Hz cap, or the
  tolerance cap.** Better ROC than the all-multiples sum, but the same
  male-corpus failure at useful thresholds.
- **Odd-dip median.** Gender-safe, but a lower guarded gain.
- **AND/linear combinations with H1−H2.** A better ROC that did not
  carry over to the guarded frontier, and H1−H2 is exactly the
  weak-H1-sensitive quantity.
- **octaveCost alone.** Dominated by A. It is kept at 0.015 inside A,
  where it adds target gain for a small low-band cost.
- **Sub-floor HP at 60/70 Hz, 2nd/4th order.** Neutral to negative
  (§4b); the damaging energy is above 75 Hz.
- **hpo100.** Higher target gain, but low-voice octave-up far outside the
  guard.
- **Graded penalty or delta conditioning.** On the same frontier; adds
  parameters for no gain. A with delta 0.05 is the documented
  conservative fallback.
- **Tracker jump discount, octaveJumpCost 0.10/0.12/0.18/0.25.** No
  guarded gain (§4a, §6).
- **Larger penalty with the up-term** (prominence −12/0.10, or penalty
  0.10 with delta 0.10). More target gain, but low-band octave-up out of
  bounds under the stated guard. It becomes the natural next step only if
  the low-band references (§7) are adjudicated, for example by
  listening-labelling the disputed frames.

## 9. Reproduce

Committed guard: `node tests/dsp/boersma-ac-test.js`. Scratch harnesses,
all from `build/measure-2026-10-03/detector-octave/` in the main checkout.
The session steps (`launch.sh` chain runs and `score.py` / `report.py`,
`dumpfeat.mjs session`, `exportrefs.py` / `runsweep.sh`, `pairsel.py` /
`probe.mjs` / `roc.py`, `simdec.mjs` / `flips.py`) need the private
session recordings and phase-1 references, which live outside the repo,
and are omitted here:

```bash
# corpora (decoded + posted)
./corpora.sh prod,pA,pA_oc10,pd12p10,pA_noup && node sumcorpus.mjs --stage=dec prod pA && node sumcorpus.mjs --stage=post prod pA
# synthetic
node synth.mjs prod,pA,pA_oc10,pA_noup,pd12p10,a12p10,oc02
# noise-only false voicing
OCT_TAG=prod node noise-oracle.mjs pitch --frontend=tracker --snrs=10 --noises=white,pink,brown,sleep-noise,sleep-birdies,resonant-noise,fan-hum,mains-complex,babble,crickets,cicadas
OCT_TAG=pA   node noise-oracle.mjs pitch --frontend=tracker --snrs=10 --noises=...same...
# unit test on the proposed module (+ new rumble case), CPU
node test-prop.mjs && node test-prod.mjs; node cpu.mjs
# screening simulator, corpus dumps
for c in fda ptdb-tug hillenbrand vocadito; do node dumpfeat.mjs corpus $c & done; wait
```

`variants.mjs` is the registry mapping each tag to its options.
`boersma-ac.proposed.js` is identical to
`proposed/src/dsp/boersma-ac.js`, which is the file the diff produces.

## 10. Integration note: coupling with the 800 Hz search ceiling (2026-10-03)

The ceiling workstream raised `maxPitchHz` 400 → 800
([pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md)). At 800 an
octave rule can pair every female F0 with a 2f partner in 400–800 Hz and
push it up out of the display (measured there, §8, for the phase-1 SHR
rule: Hillenbrand women −5.6 pp unrestricted). The shipped
`octaveEvidence` therefore carries `maxPartnerHz: 420`
(= `PITCH_DISPLAY_RANGE.high` × 1.05): a candidate is only paired with a
partner ≤ 420 Hz. At the 400 Hz search measured in this file no
candidate can exceed 400 Hz, so the restriction is a no-op and every
number above is unaffected — verified at integration: with
`maxPitchHz: 400` the integrated module's voiced candidate list equals
this file's proposed module frame for frame on two 120 s slices of private session recordings
(0 mismatches). A frame-level case in `tests/dsp/boersma-ac-test.js`
guards it at 800: a 250 Hz voice with very weak odd partials and H1
(−25 dB) stays at 250, while `maxPartnerHz: Infinity` decodes the same
frame at ~500.
