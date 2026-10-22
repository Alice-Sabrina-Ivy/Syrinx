# Clarity cue: pre-registered selection study (FAILED) and what the cue strip ships instead

Study run 2026-10-08 (interrupted) and resumed 2026-10-11 under a pre-registration hashed before any
candidate result. Code under test: `origin/cue-strip` at `adf19c3` (`src/dsp/cpp.js` and the pitch
chain are unchanged up to `53704cc`, the base of the `clarity-cue` branch). Written before any code
change on `clarity-cue` (CLAUDE.md Hard rule 3).

## 1. Summary

- **The question.** The user decided on 2026-10-08 to replace the cue strip's "Vocal weight" row
  with a measured "Clarity: clear ↔ breathy" cue, corrected for pitch and loudness, with no
  direction zones, the measure to be chosen by a pre-registered test between CPP corrected for pitch
  and loudness (candidate a, CPPc) and fit-free harmonic-to-valley ratios (b, HVR6; c, gHVR); raw
  production CPP (d) is the reference.
- **The verdict: FAIL.** No eligible candidate meets the pass bar for both sexes, so under the
  pre-registration's rule 4 **nothing is selected**. Every candidate tracks the clear ↔ breathy axis
  (synthetic aspiration rho 0.997–1.000, PVQD breathiness rho −0.46 to −0.62, VocalSet straight >
  breathy 0.83–0.96, both sexes), so the axis is real. They fail on leaks:
  - **vowels** (all candidates, both sexes): the within-speaker range over 12 vowels is 1.0–1.5× the
    straight → breathy step for women and 2.1–3.9× for men (on the 4 W / 5 M VocalSet test singers
    men's breathy step is about half of women's in every measure; on the held-out VocalSet train
    singers the steps are nearly equal — raw CPP 0.32 W / 0.31 M — so the men's vowel-leak ratio
    rests on a small step estimate and the sex gap in vowel leak is probably overstated; §10);
  - **loudness and pitch** (b, c, d): within-speaker r with level 0.54–0.69 and with pitch 0.32–0.56
    on running speech;
  - **phone chain** (a): the pitch + level correction fixes pitch (r −0.07 / +0.14) and most of
    loudness (−0.15 / −0.26, men still failing), but a phone-like AGC squeezes the level spread
    (3.5 → 2.4 dB per speaker), the fixed per-dB correction under-corrects, and the clean-vs-phone
    within-speaker rank r drops to ~0.6 (bar 0.8).
- **Display reference** (pre-registered §7): self-relative for every candidate; population bands
  would read women clearer than men (the W − M gap is 0.78–1.91× the smaller sex's step, bar 0.5×).
- **What ships (this branch), per the task's FAILED branch:** the row keeps its measure (raw
  production CPP, the reference d — the only measure the app already computes) and is **renamed to
  what it measures: "Clarity · approx."**, axis "breathier ↔ clearer", read against the user's own
  first-30-s start as before, with **no direction zones** (the same row, colour and text in every
  training direction), and an honest caveat in the info text and under the strip: speaking louder or
  higher also reads clearer and vowels differ, so compare like with like; it is not vocal weight.
  Raw CPP passes B1–B3 and B7 for both sexes (aspiration 1.000 / 0.997, PVQD −0.54 / −0.59,
  straight > breathy 0.95 / 0.83, phone rank ≥ 0.96) and fails B4–B6 (pitch r 0.32 / 0.50, level r
  0.69 / 0.68, vowel range / step 1.52 / 3.91) — the caveat states exactly those three leaks.
- **Weight goes back to research** (the user's 2026-10-08 decision 2: an experimental weight ×
  clarity view in the Resonance lab only, after the remaining sceptic checks).

## 2. Why the row was wrong as "Vocal weight"

The 2026-10-08 vocal-weight research (scratch, not committed; aggregate figures only) found the
shipped gauge is a clear ↔ breathy (periodicity) measure and mostly reads weight **backwards**:

- on voice-teacher takes that changed only weight (evaluation-only recordings, no licence), the
  heavier take read lighter 69 % of the time; a raised pitch read lighter 88.5 %; breathy voice
  reads heavier; within-speaker r with EGG contact quotient 0.02 (CMU ARCTIC / FDA / PTDB-TUG EGG,
  evaluation only).
- **The "higher CPP = lighter" direction came from a misread abstract.** Aaen et al. 2025
  (*Folia Phoniatr Logop* 77(4):319–331, doi 10.1159/000542842) report "negative correlations for
  SPL, shimmer, and CPP measures for RD [reduced-density] conditions", i.e. lighter = quieter, less
  shimmer and *lower* CPP. The 2026-05-09 literature review
  ([vocal-weight-literature-2026-05-09.md](vocal-weight-literature-2026-05-09.md)) read it the other
  way ("reduced-density voices have higher CPP"). The full text is paywalled; the abstract's
  grouping is unambiguous on the sign. That review, the 2026-05-09 audit and the code comments that
  repeat the claim are historical from this note on (CLAUDE.md marks them so).

## 3. Code changes on `clarity-cue` (after this note)

- `src/components/CueStrip.jsx`, `src/components/cueStripModel.js`, `src/utils/constants.js`: the
  third cue is `clarity` ("Clarity · approx.", ends "breathier" / "clearer", header "1.2 σ clearer
  than your start" / "… breathier …", deadband 0.3 σ unchanged); no highlight in any direction; a
  one-line caveat under the strip in every direction (replaces the weight pitch note that showed only
  with a weight zone); info text says what it measures, that it is not vocal weight, and the three
  leaks.
- `src/utils/trainingDirection.js`: the weight zones (`WEIGHT_TARGETS`, `weightTargetFor`,
  `weightStatus`, `weightZoneForDisplay`, `weightRangeFor`) and `WEIGHT_PITCH_NOTE` are removed;
  `src/components/DirectionPrompt.jsx`: the options no longer say "lighter / heavier vocal weight".
- Pipeline unchanged: `useAudioPipeline` still computes the CPP aggregate, the frozen first-30-s
  baseline and the ~5 s level; the state slice keeps its historical name `vocalWeight`, and the
  `vocal-weight-*.js` module names are kept (renaming them would only churn files another workflow
  is editing). Comments that said "positive = lighter" now say "positive = higher CPP = clearer".
- The study's baseline recommendation (a robust high-percentile reference that keeps updating, a
  manual reset, nothing shown for 20 s) is **not** shipped — it was not tested and needs its own
  measurement. The frozen first-30-s baseline is unchanged; the info text says a breathy or quiet
  warm-up sets a breathy start.

## 4. Licences

| Data | Licence | Use here |
|---|---|---|
| LibriSpeech dev-clean / test-clean | CC BY 4.0 | fit of CPPc (dev only); leak tests (test) |
| PVQD | CC BY 4.0 | breathiness ratings (test split) |
| VocalSet | CC BY 4.0 | straight vs breathy (test singers) |
| AVID (Zenodo 10524873) | CC BY 4.0 | loudness (4-speaker subset; full corpus post-hoc) |
| Hillenbrand 1995 /hVd/ | public domain | vowel leak |
| Bench synthetic grid | generated | aspiration |
| CMU ARCTIC EGG | CMU licence (BSD-style) | evaluation only |
| CSTR FDA | no licence | evaluation only, aggregate only |
| PTDB-TUG | ODbL 1.0 + DbCL 1.0 | evaluation only; nothing fitted on it |

Nothing in the shipped code is fitted (the cue is raw CPP read against the user's own start). No
private recordings, no teacher-demo audio and no PTDB/FDA-fitted constants were used. Scratch
locations (not committed): `scratchpad/clarity-weight/clarity/` (PREREG.md, RESULT.md,
results.json, tables.md, posthoc_*.json, cpu.json, extract.mjs, hvr.js, build.py, metrics.py).

## 5. CPU (ms of CPU per second of audio; Node 24, single thread)

| Candidate | ms / s |
|---|---|
| d CPP (shipped, already computed every DSP frame) | 16.3 |
| a CPPc | 16.8 |
| b HVR6 | 5.0 |
| c gHVR | 15.7 |

The shipped change adds no computation.

## 6. Pre-registration (verbatim)

sha256 of the file `PREREG.md` as written: `586f2a3908cd19429722051f69da1ea61eea5c9cefa7a948e73f428186acd2bc`,
recorded in `PREREG.sha256` at 2026-10-08T06:17:15-05:00, before any candidate value existed. The
block below is that file byte for byte (UTF-8, LF line endings): the bytes between the line after
`~~~~markdown` and the line `~~~~` hash to the value above.

~~~~markdown
# Clarity cue selection study: pre-registration

Written 2026-10-08, before any candidate result of this study was computed.
Its sha256 is recorded in `PREREG.sha256` next to this file, and in RESULT.md,
before the first candidate value is produced. Anything decided after that
point is labelled "post-hoc" in RESULT.md.

## 0. Purpose and scope

The user decided (2026-10-08) to replace the cue strip's "Vocal weight" row
with a measured "Clarity: clear <-> breathy" cue with no direction zones. The
cue must be corrected for pitch and loudness. This study chooses its measure by
the rule in §6, between:

- CPP corrected for pitch and level (candidate a), and
- a fit-free harmonic-to-valley ratio (candidates b and c).

Raw CPP (candidate d) is the reference.

Scratch research only. Nothing is committed and no repo file changes. No
private recordings are used.

**Code under test:** `origin/cue-strip` at
`adf19c3fc84c33fbb6d11e415612c65d341ad0e8`, extracted with `git archive` to
`src-cue/`. That covers `src/dsp/cpp.js`, `src/dsp/pitch-worker.js` and
`scripts/session-oracle/lib/chain.mjs`.

**Disclosure of prior knowledge.** The 2026-10-08 vocal-weight research already
scored four clarity axes on the bench test split:

| Clarity axis | synthetic aspiration rho | VocalSet straight > breathy | PVQD rho |
|---|---|---|---|
| CPP corrected for pitch and level (v7, PTDB fit) | 0.995 | 81 % | -0.45 |
| glottal HVR | 1.00 | 93 % | -0.47 |
| learned v5 head | 0.999 | 91 % | -0.66 |
| voice-map HVR+CPP | 1.00 | 96 % | -0.74 |

None of them was scored for pitch or level leak on real speech, vowel leak,
phone robustness or sex differences. The design of candidate b was informed by
the glottal HVR result. No new measure of this study has been computed on any
data.

## 1. Candidates (fixed)

All candidates are signed **higher = clearer** (less breathy or noisy).

### Frame series shared by every candidate

`extract.mjs` drives the **real** production pitch worker (`src-cue/src/dsp/pitch-worker.js`,
fresh init per session) at production cadence: 25 ms capture chunks at the
file's own rate, with `contextTime` = the time of the chunk's last sample. Per
DSP frame, it also reproduces the DSP worker's per-frame work:

- **Window:** the last 50 ms of input at the capture rate, after each chunk.
- **Level:** `intensity` = 20·log10(RMS of that window), in dBFS.
- **CPP:** `computeCPP(window, sr)` from `src-cue/src/dsp/cpp.js`, with the
  production defaults. The module state is reset per session.
- **Voicing:** `voiced_dsp`. A DSP frame is voiced when the pitch message
  consumed at that chunk has a non-null pitch. This is the production
  aggregator's `hasPitch`, apart from the 400 ms hold, which the aggregator
  does not use.

**Time conventions:**

- DSP-frame values (candidates a and d) are stamped at the centre of the 50 ms
  window (chunk end − 25 ms).
- Pitch-frame values (candidates b and c) are stamped at the posted frame's own
  centre (`contextTime` − 40 ms) and use the posted pitch of that frame.
- Every candidate scores only the frames it would use in production:
  - a and d: voiced DSP frames with a non-null CPP.
  - b and c: posted non-null pitches whose analysis returns a value.

**Sessions:**

- One session per speaker. A speaker's files are joined with 0.5 s of −90 dBFS
  deterministic dither between them, preceded by 0.5 s of dither.
- Frames are mapped back to their file by time.
- PVQD, VocalSet and synthetic items are one session per item (one file each).

**16 kHz signal for b and c:** the windowed-sinc FIR plus linear-interpolation
resampler of the glottal JS port (`cand-glottal/run_js.mjs` `to16k`), applied
to the whole session.

### (a) CPPc: production CPP corrected for F0 and level

```
CPPc_f = CPP_f − g(log2 F0_f) − beta · clamp(L_f − L_ref, −15, +15)
```

- `F0_f` is the pitch in the message consumed at that DSP frame. This is what
  production has available at that moment.
- `L_f` is the frame intensity in dB.
- `L_ref` is the session's median intensity over its voiced DSP frames.
  - Evaluation uses the whole session.
  - A production port uses the running median of the last 30 s of voiced
    frames. Within-session metrics do not depend on this choice, because it
    adds a constant per session. The between-speaker metric (PVQD) uses one
    file per session.
- `g` is a continuous piecewise-linear function of log2 F0 with knots at 75,
  100, 125, 150, 200, 250, 300 and 400 Hz.
  - Basis: an intercept-free linear term plus hinge terms max(0, x − log2 k)
    for the interior knots 100, 125, 150, 200, 250 and 300 Hz.
  - Below the train-data 1st percentile and above its 99th percentile, F0 is
    clamped to those percentiles before g is evaluated.
  - g is anchored so that g(log2 160 Hz) = 0.

**Fit:**

- **Data:** LibriSpeech **dev-clean** (CC BY 4.0), all 40 speakers (20 F,
  20 M).
  - Per speaker: utterances in sorted file-name order until 180 s of audio is
    reached. One session per speaker, at 16 kHz.
  - All voiced DSP frames with non-null CPP.
- **Model:** ordinary least squares of CPP_f on the g basis and on (L_f −
  L_ref), plus speaker fixed effects.
  - Frames are weighted 1/n_s, so each speaker has equal weight.
  - Nothing else is fitted. No bench, PVQD, VocalSet, FDA, PTDB, AVID or
    Hillenbrand data is used.
- **Output:** the fitted constants (the g knot values, beta and the clamp
  percentiles) are written to `fit_cppc.json`. They are reported verbatim in
  RESULT.md.

### (b) HVR6: fit-free harmonic-to-valley ratio on the posted-pitch harmonics

For each posted non-null pitch f, on the 16 kHz signal:

1. **Window:** a Hann window of `Lw = min(1280, round(6 · 16000 / f))` samples
   (6 periods), centred on the posted frame's centre, zero-padded to a
   4096-point FFT. The power spectrum is P[k], with no pre-emphasis.
2. **F0 refinement:**
   - For h = 1..min(5, floor(1500/f)), find the maximum bin of P within ±0.2·f
     of h·f.
   - Refine each peak by parabolic interpolation on dB.
   - Then f̂ = median(peak_freq_h / h). If fewer than 2 peaks are found,
     f̂ = f.
3. **Harmonic count:** H = the largest h with (h+1)·f̂ ≤ 4000 Hz. If H < 3,
   there is no value.
4. **Peak tracking:**
   - Predict p_1 = f̂, and p_h = q_{h−1} + f̂ for h > 1.
   - q_h is the frequency of the maximum bin within ±0.15·f̂ of p_h, for
     h = 1..H+1.
   - The peak level is A_h = 10·log10 P[q_h].
5. **Valleys:** for h = 1..H, m_h = (q_h + q_{h+1}) / 2, and
   V_h = 10·log10(mean of P over bins within ±0.1·f̂ of m_h).
6. **Frame value:** HVR6 = mean over h = 1..H of (A_h − V_h), in dB.

**Code:** `hvr.js` in this folder. No fitted constants.

### (c) gHVR: glottal-source HVR from the research candidate

This is the fit-free clarity axis of the glottal candidate. It is
`createGlottalAnalyzer()` with its default options (IAIF), from
`vocal-weight/cand-glottal/glottal.js`, called as `analyse(y16k, centreIndex, f)`
for each posted non-null pitch. The candidate's value is `o.hvr`, the
harmonic-to-valley ratio of the flow-derivative spectrum over 0–4 kHz.

It is chosen as (c) because it is the only research clarity axis that is both
fit-free and licence-clean:

- The learned v5 head was trained on PVQD ratings, so its PVQD score would not
  be independent.
- The voice-map clarity axis has a prior fitted on PTDB.

Bench-test numbers for v5 and the voice map are quoted from the research as
context only. They are not candidates.

### (d) CPP: uncorrected production CPP (reference)

The per-frame production CPP on voiced DSP frames. This is what the current
aggregator averages.

**Aggregation, all candidates:**

- A 1-s bin value is the mean of the candidate's frame values whose stamps fall
  inside the bin. At least 4 frames are required (the production
  `MIN_VOICED_FRAMES`).
- A file value is the median of the candidate's frame values in the file. The
  bench's `score.py` uses the same convention.

## 2. Data

| Role | Set | Licence | Use |
|---|---|---|---|
| Fit of a | LibriSpeech dev-clean, 40 speakers (20 F / 20 M), ≤ 180 s each | CC BY 4.0 | train only |
| Real-speech leaks (primary) | LibriSpeech test-clean, 40 speakers (20 F / 20 M), ≤ 180 s each | CC BY 4.0 | test |
| Real-speech leaks (secondary) | Bench EGG test speakers: CMU jmk; FDA rl, sb; PTDB F06–F10, M06–M10 | CMU / none / ODbL | evaluation only |
| Deliberate loudness (secondary) | AVID 4-speaker subset (`verify-skeptic/avid/raw`; Spk7 M, Spk18 F, Spk19 M, Spk33 F), 10-s chunks as in `avid_run.py` | CC BY 4.0 | test |
| Synthetic aspiration | Bench synthetic **test** grid (core + gain) | generated | test |
| PVQD breathiness | Bench PVQD **test** split (48 F / 25 M) | CC BY 4.0 | test |
| VocalSet straight vs breathy | Bench VocalSet **test** singers (4 F, 5 M), scales | CC BY 4.0 | test |
| Vowel leak | Hillenbrand 1995 /hVd/, `tests/dsp/data/{men,women}` (45 M, 48 F, 12 vowels), one session per speaker | public domain | test |
| Phone chain | PVQD test, LibriSpeech test-clean, VocalSet test (straight/breathy scales), AVID subset, each re-recorded through §4 at 16, 44.1 and 48 kHz | as above | test |
| Display rule (noise / reverb shifts) | Bench EGG test `noise20` and `reverb` variants vs their clean bases | as above | evaluation only |

**Splits:**

- No candidate is fitted on bench data. The bench train split is therefore
  also held out for every candidate.
- Primary numbers use the bench **test** split. Train+test numbers are reported
  as a secondary, larger sample.
- If fewer than 2 VocalSet singers of a sex have ≥ 5 matched pairs in the test
  split (sopranos above 400 Hz post unvoiced), that sex's VocalSet criterion is
  evaluated on test+train singers, and RESULT says so.

**Sex:**

| Set | Source of sex |
|---|---|
| Synthetic | tract (m / f) |
| LibriSpeech | SPEAKERS.TXT |
| PVQD | label |
| VocalSet | singer name |
| Hillenbrand | folder |
| EGG items | label |
| AVID | metadata |

## 3. Metrics (computed per sex)

**M1. Synthetic aspiration tracking.**

- **Primary:** the mean over cells (Rd, F0, vowel, tract) of −Spearman(asp
  order none / −25 / −18 / −11 dB, file value), as in `score.py`
  `clarity_tracks_aspiration_rho`, computed separately for tract m and tract f.
- **Reported:** independence, in units of the mean aspiration effect E (file
  value at asp −11 minus none, same cell; |E| is used as the unit):
  - the Rd slope per doubling (no-aspiration core, OLS with F0 and vowel×tract
    fixed effects);
  - the F0 slope per octave (same fit);
  - the gain slope per +12 dB (gain family).

**M2. PVQD.** Spearman rho(file value, CAPE-V breathiness) on the PVQD test
split, per sex. The partial rho given sex and log F0 is also reported, pooled.

**M3. VocalSet.**

- **Primary:** straight > breathy at matched pitch (|Δ| ≤ 1 st, same singer and
  vowel, scales, 1-s bins with ≥ 50 % voiced Praat frames). This is the per-singer
  mean accuracy (singers with ≥ 5 pairs), as `score.py` `pair_acc` computes it,
  then the mean over the singers of each sex.
- **Step:** the per-singer median of (straight − breathy) over the same matched
  pairs, then the median over singers of each sex. Used in M6 and §7.

**M4. Real-speech pitch leak.** On LibriSpeech test-clean:

- **Bins:** consecutive 1-s bins from each file's start, keeping bins with
  ≥ 50 % of their 40 DSP frames voiced. **Common bins** are the bins where
  every candidate has ≥ 4 frames.
- **Bin F0:** log2 of the median posted pitch over the bin's posted frames.
- **Bin level:** the mean DSP intensity over the bin's voiced DSP frames.
- **Leak:** Pearson r(bin value, bin log2 F0) within each speaker. The
  statistic is the Fisher-z mean over speakers of each sex.
- **Secondary:** the same on the bench EGG test speakers (their own 1-s truth
  bins) and on the AVID subset.

**M5. Real-speech level leak.** The same as M4, with the bin level in place of
F0. Partial r (level given F0, F0 given level) is reported too.

- AVID: within-speaker r with level and with log F0 over 1-s bins in 10-s
  chunks, and the clarity change from soft to very loud in units of that sex's
  VocalSet step. These are reported, not binding.

**M6. Vowel leak.**

- On Hillenbrand, the per-file value is the median of the candidate's frames
  in the middle 20–80 % of that file's frames.
- The within-speaker range is max − min over the speaker's vowels (speakers
  with ≥ 10 vowels valued). Take the median over the speakers of each sex.
- Compare with the same sex's VocalSet step (M3). Reported as range / step.
- The within-speaker SD and per-vowel mean deviations are reported too.

**M7. Phone-chain robustness.** For each rate R in {16 000, 44 100, 48 000}:

- **P1:** Spearman between clean and phone-chain file values over PVQD test
  files, per sex.
- **P3:** within-speaker Spearman between clean and phone-chain 1-s bin values
  on LibriSpeech test-clean (clean common bins whose phone version has ≥ 4
  frames for that candidate), as the Fisher-z mean over speakers of each sex.
- **Reported:**
  - P2: VocalSet test, within-singer bins, plus straight > breathy under the
    phone chain.
  - AVID within-speaker bins.
  - The coverage loss.
  - The median shift (phone − clean), in units of the VocalSet step.

**M8. CPU.** Node 24 on this desktop, single thread, per second of 48 kHz audio:

- a and d: `computeCPP` every 25 ms on the 50 ms window, plus the trivial
  correction for a.
- b and c: the per-voiced-frame analysis at 40 frames/s on 16 kHz audio
  (worst case, fully voiced), excluding the 16 kHz resample, which the pitch
  worker already does.

Measured on the AVID subset's first 60 s, best of 3.

## 4. Phone-like chain (fixed)

This is the chain from `verify-skeptic/avid/avid_phone.py`, generalised to an
output rate R:

1. Resample the source to R with `scipy.signal.resample_poly`.
2. 2nd-order Butterworth high-pass at 120 Hz.
3. +4 dB peaking EQ at 3 kHz, Q 1.
4. AGC:
   - 10 ms RMS blocks.
   - One-pole envelope with attack time constant 1 block and release 30
     blocks.
   - Gain = clip(−23 dBFS − envelope dB, −20, +25) dB, linearly interpolated
     per sample.
5. Add white noise at −65 dBFS (numpy default_rng seed 0).
6. Clip to ±1 and write as 16-bit PCM.

## 5. Pass bar (binding; must hold for BOTH sexes)

| # | Criterion | Threshold |
|---|---|---|
| B1 | M1 synthetic aspiration rho | ≥ 0.90 |
| B2 | M2 PVQD rho with breathiness (correct sign: breathier reads less clear) | ≤ −0.40 |
| B3 | M3 VocalSet straight > breathy | ≥ 0.80 |
| B4 | M4 LibriSpeech within-speaker pitch leak | \|r\| ≤ 0.20 |
| B5 | M5 LibriSpeech within-speaker level leak | \|r\| ≤ 0.20 |
| B6 | M6 Hillenbrand median vowel range | < the VocalSet straight − breathy step (ratio < 1) |
| B7 | M7 phone chain: P1 and P3 at every rate | ≥ 0.80 |

**The candidate's direction must be right.** If the VocalSet step is ≤ 0 for a
sex, B3 and B6 fail for that sex.

A candidate passes when it meets B1–B7 for women and for men. The study
**passes** when at least one eligible candidate (a, b or c) passes.

## 6. Selection rule (binding)

**Margins.** For each eligible candidate and each sex, compute normalised
margins, each clipped to [−1, 1]:

| Margin | Formula |
|---|---|
| m1 | (rho − 0.9) / 0.1 |
| m2 | (−rho − 0.4) / 0.4 |
| m3 | (acc − 0.8) / 0.2 |
| m4 | (0.2 − \|r_pitch\|) / 0.2 |
| m5 | (0.2 − \|r_level\|) / 0.2 |
| m6 | 1 − range / step |
| m7 | (min over P1, P3 and rates − 0.8) / 0.2 |

The score S is the mean of the 14 margins (7 criteria × 2 sexes).

**Rule:**

1. Only passing candidates among a, b and c are selectable. d is a reference.
2. Select the passing candidate with the highest S.
3. If the best two passing candidates differ by less than 0.05 in S, prefer the
   simpler one, in this order:
   - b (fit-free, lowest compute);
   - c (fit-free);
   - a (fitted constants).
4. If no eligible candidate passes, the study **fails**:
   - Nothing is selected for shipping.
   - RESULT reports every candidate's criteria and the margins it missed by.
   - Any post-hoc fix is labelled post-hoc and needs a new pre-registration
     before it can be selected.

## 7. Display reference rule (binding)

Choose **population bands** (built from licence-clean healthy speech:
LibriSpeech test-clean per-speaker medians, pooled across sexes, the same bands
for everyone) only if all three hold for the selected measure:

1. B2 passes for both sexes. Between-speaker values then mean something.
2. For each sex, the median |shift| of per-speaker or per-file medians between
   clean and each of phone16, phone44, phone48, `noise20` and `reverb` is
   ≤ 0.5 × that sex's VocalSet step. Phone shifts come from PVQD test and
   LibriSpeech test; `noise20` and `reverb` from the bench EGG test variants.
3. The difference between the median female and median male LibriSpeech
   test-clean speaker values is ≤ 0.5 × the smaller of the two sexes' steps.
   Otherwise one band set would treat the sexes differently.

Otherwise the display is **self-relative**, read against the user's own
session baseline as today. The baseline must be robust to a breathy warm-up,
which RESULT will discuss.

## 8. Reporting

RESULT.md reports:

- every metric above, for every candidate, per sex;
- the pass / fail table;
- S;
- the selected measure, with its exact constants and code pointers;
- the display decision;
- any deviation from this plan, labelled with its reason.

Deviations forced by data or tooling are allowed only if they are applied
identically to every candidate and stated.
~~~~

## 7. Deviations from the plan (from RESULT.md; applied identically to every candidate)

1. §7 "median |shift|" was read literally (median over speakers / files of |shift|), changed before
   any result was computed; under either reading every candidate is self-relative.
2. Leak statistics need ≥ 8 bins per speaker (implementation guard; all 40 LibriSpeech speakers
   qualified).
3. The pre-registered 4-speaker AVID subset has no intensity labels, so its soft → very loud change
   is reported as the slope × each speaker's 5–95 % level span; the soft → very loud change itself
   comes from the full AVID corpus (post-hoc).
4. The CPU audio (AVID subset, 44.1 kHz) was resampled to 48 kHz as M8 specifies.
5. Synthetic file values use score.py's own window (0.3 s to duration − 0.1 s).
6. One 64-bit float AVID PARA file (post-hoc set only) was converted losslessly to 32-bit float.

## 8. Results, per sex (W = women, M = men)

Reproduced from the study's RESULT.md; aggregates only.

### Pass bar (B1-B7), values per sex (W = women, M = men); a value in **bold** fails

| Candidate | Sex | B1 asp rho (>= 0.90) | B2 PVQD rho (<= -0.40) | B3 straight>breathy (>= 0.80) | B4 pitch r (abs <= 0.20) | B5 level r (abs <= 0.20) | B6 vowel range / step (< 1) | B7 min phone rank r (>= 0.80) | passes | S |
|---|---|---|---|---|---|---|---|---|---|---|
| a CPPc | W | 1.000 | -0.53 | 0.94 | -0.07 | -0.15 | **1.40** | **0.61** | no | 0.081 |
| a CPPc | M | 0.999 | -0.55 | 0.84 | 0.14 | **-0.26** | **2.27** | **0.58** | no | 0.081 |
| b HVR6 | W | 1.000 | -0.52 | 0.96 | **0.40** | **0.60** | **1.03** | 0.95 | no | 0.042 |
| b HVR6 | M | 1.000 | -0.62 | 0.91 | **0.46** | **0.55** | **2.15** | 0.94 | no | 0.042 |
| c gHVR | W | 1.000 | -0.46 | 0.96 | **0.47** | **0.59** | **1.24** | 0.97 | no | 0.017 |
| c gHVR | M | 1.000 | -0.61 | 0.89 | **0.56** | **0.54** | **2.34** | 0.94 | no | 0.017 |
| d CPP (ref) | W | 1.000 | -0.54 | 0.95 | **0.32** | **0.69** | **1.52** | 0.97 | no | 0.017 |
| d CPP (ref) | M | 0.997 | -0.59 | 0.83 | **0.50** | **0.68** | **3.91** | 0.96 | no | 0.017 |

### Margins (clipped to [-1, 1]; S = mean of the 14)

| Candidate | Sex | m1 | m2 | m3 | m4 | m5 | m6 | m7 |
|---|---|---|---|---|---|---|---|---|
| a CPPc | W | 1.00 | 0.33 | 0.70 | 0.64 | 0.23 | -0.40 | -0.94 |
| a CPPc | M | 0.99 | 0.38 | 0.20 | 0.30 | -0.30 | -1.00 | -1.00 |
| b HVR6 | W | 1.00 | 0.29 | 0.82 | -1.00 | -1.00 | -0.03 | 0.74 |
| b HVR6 | M | 1.00 | 0.55 | 0.54 | -1.00 | -1.00 | -1.00 | 0.69 |
| c gHVR | W | 1.00 | 0.16 | 0.79 | -1.00 | -1.00 | -0.24 | 0.83 |
| c gHVR | M | 1.00 | 0.53 | 0.46 | -1.00 | -1.00 | -1.00 | 0.70 |
| d CPP (ref) | W | 1.00 | 0.36 | 0.73 | -0.62 | -1.00 | -0.52 | 0.87 |
| d CPP (ref) | M | 0.97 | 0.48 | 0.13 | -1.00 | -1.00 | -1.00 | 0.82 |

### M1 synthetic aspiration (bench synthetic test grid, 144 cells per tract)

| Candidate | Tract | rho | effect none -> -11 dB | Rd leak / doubling | F0 leak / octave | gain leak / +12 dB |
|---|---|---|---|---|---|---|
| a CPPc | f | 1.000 | -0.855 | -0.072 | +0.102 | +0.010 |
| a CPPc | m | 0.999 | -0.879 | -0.060 | +0.076 | -0.014 |
| b HVR6 | f | 1.000 | -15.388 | -0.079 | +0.266 | +0.033 |
| b HVR6 | m | 1.000 | -15.138 | -0.094 | +0.259 | +0.045 |
| c gHVR | f | 1.000 | -17.142 | -0.122 | +0.478 | +0.031 |
| c gHVR | m | 1.000 | -17.026 | -0.133 | +0.459 | +0.047 |
| d CPP (ref) | f | 1.000 | -0.855 | -0.072 | +0.135 | +0.010 |
| d CPP (ref) | m | 0.997 | -0.878 | -0.061 | +0.108 | -0.015 |

Leaks are in units of |E|, the mean aspiration effect (none -> -11 dB) of the same candidate and tract.

### M2 PVQD breathiness (Spearman; test split = binding, train+test = secondary)

| Candidate | W test (n 48) | M test (n 25) | W train+test (n 89) | M train+test (n 54) | pooled test | partial given sex, log F0 |
|---|---|---|---|---|---|---|
| a CPPc | -0.53 | -0.55 | -0.51 | -0.64 | -0.51 | -0.61 |
| b HVR6 | -0.52 | -0.62 | -0.55 | -0.70 | -0.52 | -0.66 |
| c gHVR | -0.46 | -0.61 | -0.50 | -0.64 | -0.45 | -0.63 |
| d CPP (ref) | -0.54 | -0.59 | -0.53 | -0.63 | -0.52 | -0.63 |

### M3 VocalSet straight > breathy at matched pitch (test singers: 4 W, 5 M; train+test: 8 W, 11 M)

| Candidate | W acc | W step | M acc | M step | W acc (train+test) | M acc (train+test) |
|---|---|---|---|---|---|---|
| a CPPc | 0.941 | 0.415 | 0.841 | 0.245 | 0.896 | 0.836 |
| b HVR6 | 0.964 | 7.806 | 0.908 | 4.377 | 0.939 | 0.909 |
| c gHVR | 0.958 | 9.214 | 0.893 | 5.077 | 0.916 | 0.890 |
| d CPP (ref) | 0.946 | 0.394 | 0.825 | 0.192 | 0.909 | 0.852 |

Steps are in each candidate's own units (CPP units for a/d, dB for b/c).

Caveat (independent review, 2026-10-11): the steps above are from the 4 W / 5 M **test** singers. On
the held-out VocalSet **train** singers (4 W / 6 M, scales, file medians per singer and vowel, real
workers) the straight → breathy steps are nearly equal between the sexes: raw CPP 0.322 W / 0.312 M,
CPPc 0.316 / 0.291, HVR6 7.63 / 6.28. The test-split men's step (0.192 for raw CPP) is therefore a
small estimate, and the M6 ratios that divide by it (men 2.15–3.91) probably overstate the sex gap
in vowel leak. The FAIL verdict does not depend on it: women fail B6 on their own (1.03–1.52), and
the loudness / pitch leaks fail for both sexes. A future pre-registration should take the step from
train + test singers or bootstrap it.

### M4 / M5 real-speech leaks: within-speaker r over 1-s bins (Fisher-z mean)

LibriSpeech test-clean (binding), 20 W / 20 M speakers, 4992 common bins.

| Candidate | Sex | r pitch | r level | partial r pitch given level | partial r level given pitch | EGG test r pitch | EGG test r level | EGG test r CQ | AVID subset r pitch | AVID subset r level |
|---|---|---|---|---|---|---|---|---|---|---|
| a CPPc | W | -0.07 | -0.15 | -0.02 | -0.13 | +0.00 | -0.33 | -0.02 | -0.11 | -0.11 |
| a CPPc | M | +0.14 | -0.26 | +0.26 | -0.33 | +0.07 | -0.43 | -0.09 | -0.54 | -0.70 |
| b HVR6 | W | +0.40 | +0.60 | +0.19 | +0.53 | +0.55 | +0.36 | +0.09 | +0.77 | +0.87 |
| b HVR6 | M | +0.46 | +0.55 | +0.34 | +0.48 | +0.42 | +0.25 | +0.00 | +0.73 | +0.79 |
| c gHVR | W | +0.47 | +0.59 | +0.29 | +0.49 | +0.57 | +0.38 | +0.10 | +0.79 | +0.86 |
| c gHVR | M | +0.56 | +0.54 | +0.47 | +0.44 | +0.52 | +0.28 | -0.00 | +0.79 | +0.80 |
| d CPP (ref) | W | +0.32 | +0.69 | +0.03 | +0.65 | +0.41 | +0.29 | +0.01 | +0.63 | +0.85 |
| d CPP (ref) | M | +0.50 | +0.68 | +0.37 | +0.63 | +0.49 | +0.25 | -0.10 | +0.75 | +0.85 |

EGG test speakers: 5 W / 7 M (CMU, FDA, PTDB; evaluation only). AVID subset: 2 W / 2 M.

AVID subset level slope (reported): clarity change across each speaker's 5-95 % level span, in units of the sex's VocalSet step:

| Candidate | W speakers | M speakers |
|---|---|---|
| a CPPc | -0.30 over 23 dB, +0.13 over 19 dB | -1.60 over 23 dB, -1.32 over 25 dB |
| b HVR6 | +1.21 over 23 dB, +1.42 over 19 dB | +1.41 over 23 dB, +1.43 over 25 dB |
| c gHVR | +1.14 over 23 dB, +1.49 over 19 dB | +1.41 over 23 dB, +1.60 over 25 dB |
| d CPP (ref) | +1.58 over 23 dB, +1.77 over 19 dB | +2.65 over 23 dB, +3.35 over 25 dB |

### M6 vowel leak (Hillenbrand, 48 W / 45 M, 12 vowels)

Step = the M3 test-singer step (4 W / 5 M); see the caveat under M3 — the men's ratios rest on a
small step estimate.

| Candidate | Sex | median within-speaker range | step | range / step | median SD / step | lowest vowel (dev/step) | highest vowel (dev/step) |
|---|---|---|---|---|---|---|---|
| a CPPc | W | 0.581 | 0.415 | 1.40 | 0.40 | uw -0.25 | ah +0.33 |
| a CPPc | M | 0.555 | 0.245 | 2.27 | 0.62 | oo -0.34 | ae +0.28 |
| b HVR6 | W | 8.059 | 7.806 | 1.03 | 0.32 | uh -0.13 | iy +0.12 |
| b HVR6 | M | 9.395 | 4.377 | 2.15 | 0.61 | eh -0.35 | uw +0.45 |
| c gHVR | W | 11.457 | 9.214 | 1.24 | 0.38 | uh -0.14 | iy +0.15 |
| c gHVR | M | 11.894 | 5.077 | 2.34 | 0.65 | eh -0.40 | uw +0.50 |
| d CPP (ref) | W | 0.598 | 0.394 | 1.52 | 0.47 | ih -0.23 | er +0.17 |
| d CPP (ref) | M | 0.750 | 0.192 | 3.91 | 1.09 | oo -1.03 | er +0.71 |

### M7 phone chain (120 Hz HP + 3 kHz EQ + AGC + -65 dBFS noise)

| Candidate | Sex | P1 PVQD 16/44.1/48 | P3 Libri 16/44.1/48 | P2 VocalSet 16/44.1/48 | straight>breathy on phone 16/44.1/48 | AVID 16/44.1/48 | PVQD median shift / step (48k) |
|---|---|---|---|---|---|---|---|
| a CPPc | W | 0.97/0.98/0.98 | 0.62/0.61/0.61 | 0.84/0.85/0.86 | 0.94/0.95/0.94 | 0.25/0.27/0.27 | +0.04 |
| a CPPc | M | 0.97/0.98/0.98 | 0.59/0.59/0.58 | 0.75/0.75/0.75 | 0.84/0.82/0.83 | -0.37/-0.36/-0.37 | +0.06 |
| b HVR6 | W | 1.00/1.00/1.00 | 0.95/0.95/0.95 | 0.95/0.98/0.98 | 0.95/0.96/0.96 | 0.98/0.99/0.98 | -0.05 |
| b HVR6 | M | 0.99/0.99/0.98 | 0.94/0.94/0.94 | 0.97/0.99/0.99 | 0.87/0.88/0.88 | 0.97/0.98/0.97 | -0.01 |
| c gHVR | W | 0.99/1.00/1.00 | 0.97/0.97/0.97 | 0.96/0.98/0.98 | 0.96/0.96/0.96 | 0.99/0.99/0.99 | -0.03 |
| c gHVR | M | 0.99/0.99/0.99 | 0.94/0.94/0.94 | 0.98/0.99/0.99 | 0.86/0.86/0.86 | 0.98/0.99/0.98 | +0.01 |
| d CPP (ref) | W | 0.98/0.99/0.99 | 0.97/0.98/0.97 | 0.93/0.97/0.97 | 0.93/0.93/0.94 | 0.98/0.99/0.98 | -0.03 |
| d CPP (ref) | M | 0.99/0.99/0.99 | 0.97/0.96/0.97 | 0.95/0.98/0.98 | 0.81/0.82/0.83 | 0.98/0.99/0.98 | -0.06 |

Coverage under the phone chain was 1.00 for every candidate (P1 and P3).

### Display rule (PREREG §7), computed for every candidate

| Candidate | cond 1 PVQD both sexes | cond 2 max shift / step W, M | cond 3 (W - M) / min step | decision |
|---|---|---|---|---|
| a CPPc | yes | 0.26, 0.55 | 0.91 | self-relative |
| b HVR6 | yes | 0.37, 0.35 | 0.78 | self-relative |
| c gHVR | yes | 0.27, 0.29 | 0.86 | self-relative |
| d CPP (ref) | yes | 0.43, 0.40 | 1.91 | self-relative |

### POST-HOC variants (not pre-registered; cannot be selected)

| Variant | Sex | B1 | B2 | B3 | B4 | B5 | B6 | B7 | S |
|---|---|---|---|---|---|---|---|---|---|
| a2 CPP, pitch-only correction | W | 1.000 | -0.60 | 0.94 | +0.11 | +0.62 | 1.46 | 0.97 | 0.215 |
| a2 CPP, pitch-only correction | M | 0.997 | -0.62 | 0.84 | +0.09 | +0.59 | 4.17 | 0.95 | 0.215 |
| b3 HVR6, pitch-only correction | W | 1.000 | -0.59 | 0.97 | +0.23 | +0.55 | 1.00 | 0.94 | 0.241 |
| b3 HVR6, pitch-only correction | M | 1.000 | -0.62 | 0.90 | +0.02 | +0.43 | 2.02 | 0.91 | 0.241 |
| b2 HVR6, pitch + level correction | W | 1.000 | -0.55 | 0.97 | -0.03 | -0.09 | 1.16 | 0.61 | 0.254 |
| b2 HVR6, pitch + level correction | M | 1.000 | -0.62 | 0.88 | -0.04 | -0.23 | 1.55 | 0.53 | 0.254 |

### POST-HOC AVID full corpus, PARA (50 speakers: 25 W / 25 M)

| Candidate | Sex | very loud - soft, / step (median over speakers) | share of speakers reading very loud clearer | Spearman with condition | 1-s bin r level | 1-s bin r pitch |
|---|---|---|---|---|---|---|
| a CPPc | W | -0.08 | 0.36 | -0.26 | -0.23 | -0.13 |
| a CPPc | M | -0.70 | 0.08 | -0.86 | -0.56 | -0.39 |
| b HVR6 | W | 1.19 | 1.00 | +0.93 | +0.86 | +0.62 |
| b HVR6 | M | 1.17 | 1.00 | +0.95 | +0.84 | +0.70 |
| c gHVR | W | 1.08 | 1.00 | +0.94 | +0.85 | +0.65 |
| c gHVR | M | 1.07 | 1.00 | +0.95 | +0.84 | +0.76 |
| d CPP (ref) | W | 1.52 | 1.00 | +0.91 | +0.86 | +0.55 |
| d CPP (ref) | M | 2.82 | 1.00 | +0.95 | +0.88 | +0.70 |

## 9. Checks on the `clarity-cue` branch (2026-10-11)

- `npm run lint`: clean. `npm run test:unit`: 39 / 39 scripts pass (incl. `tests/audio/cue-strip-model-test.js`
  73 checks — clarity axis, no highlight in any direction, headers never say lighter / heavier /
  weight — and `tests/data/training-direction-test.js` — no weight-zone helpers exported).
  `npm run test:resonance-lab`: 89 passed, 0 failed. `npm run build`: ok.
- `scripts/cue-strip-smoke.mjs` on the built app: 80 / 80 at each of 448×890, 402×750, 360×690,
  890×360 and 1280×800 — the third row is "Clarity · approx." with ends breathier / clearer, no strip
  text and no direction option says weight / lighter / heavier, the caveat shows in all four directions
  (at b98a0e0 only with the caption, i.e. not at 890×360 — the smoke check passed there because it
  accepted "caption and caveat both hidden"; fixed in the review round, see §10), clarity has no highlight in any direction, calibrating → live
  ≤ 45 s, layout (trace + strip in the first screen, no clipped header, popovers readable) unchanged.

## 10. Independent review and fixes (2026-10-11)

- **Pre-registration order confirmed** by an independent review: the fenced block in §6 hashes to
  586f2a3908cd…2bc (= PREREG.sha256, recorded before any candidate result); the only post-hash
  scoring change (median |shift| in the display rule) cannot change the decision.
- **Held-out reproduction** (real pitch + DSP workers at b98a0e0, data the binding tests did not use:
  AVID SENT sentences 4 W / 4 M clean and phone-like at 48 and 16 kHz, VocalSet train singers
  4 W / 6 M, PVQD train split 41 W / 29 M). Raw CPP (what ships), women / men: PVQD breathiness rho
  −0.47 / −0.65; straight > breathy 0.85 / 0.83; very loud − soft +2.04 / +1.53 steps (very loud
  reads clearer for 8 of 8 speakers); within-speaker r with level 0.85 / 0.78 and with pitch
  0.55 / 0.61; phone-like rank r 0.95–0.98, and under the phone-like AGC (level spread ~19 → 4.7 dB)
  CPP still correlates 0.78–0.84 with true loudness, so "louder reads clearer" holds on phones too.
  CPPc's phone collapse reproduces (rank r 0.50 W / −0.14 M; for men very loud reads breathier,
  −0.65 step, 0 of 4 speakers clearer); HVR6's leaks reproduce (level r 0.89 / 0.71, pitch r
  0.64 / 0.61). On sung VocalSet scales raw CPP's vowel range / step was 1.06 W / 0.70 M (see the
  M3 caveat on the step).
- **Fixes in this round:** (1) the caveat is now visible in short landscape (phone held sideways,
  `(max-height: 480px) and (min-width: 640px)`, e.g. 890×360): the caption lines stay hidden there
  for height, and a short form "· louder or higher reads clearer" (`data-clarity-note`) sits in the
  clarity row's title line; the smoke test now requires the caveat at every viewport and includes
  it in the clipped-header check. (2) ARCHITECTURE.md roadmap item 9 no longer describes the removed
  weight zone as current. (3) The "men's step is about half" sentence is qualified (§1, M3, M6).
  (4) `scripts/voice-direction-smoke.mjs` is marked stale (it still asserts the removed weight zone;
  not in the unit-test runner; superseded by `scripts/cue-strip-smoke.mjs`).
- **Checks after the fixes:** `npm run lint` clean; `npm run test:unit` 39 / 39; `npm run build` ok;
  `scripts/cue-strip-smoke.mjs` 80 / 80 at each of 448×890, 402×750, 360×690, 890×360 and 1280×800,
  with the caveat now required at every viewport (at 890×360 it reads "· louder or higher reads
  clearer" in the clarity title line, not clipped) and the prereg block still hashing to
  586f2a39…2bc.
