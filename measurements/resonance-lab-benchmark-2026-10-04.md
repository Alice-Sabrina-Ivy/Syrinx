# Resonance lab — calibration-free resonance benchmark, finalists and in-app lab view (2026-10-04 / 05)

Branch `resonance-lab` (worktree `Syrinx-res`). Experimental research: **no production
behaviour changed** — the lab exists only behind `?resonance=lab`.

**Question.** Can Syrinx give real-time resonance feedback that (1) works for anyone — any
voice, any training direction, speakers it has never heard — and (2) needs no per-user
calibration recordings?

**Answer (partly).** For adults speaking running speech: yes, for "where does the last
~2-5 s of voiced speech sit on the adult men-women resonance continuum, and did it move".
Four structurally different readouts pass the pre-registered rubric's public gates (R1–R4) on
held-out speakers, track hand-measured formant size *within* a sex (the deployed perceived-voice meter does
not), and see a training-sized 5 % formant change. Not established: children (no real
children's audio), non-English or spontaneous speech, held/isolated vowels, and absolute
position across microphones/rooms (device/noise bias ≈ 0.3-0.6 of the men-women gap, as
large as a training-sized change). Every finalist reached its hardest gate after
test numbers had been seen (critic, §4), so the passes are **test-informed** until
re-confirmed on fresh data.

Per-family detail: [baselines](resonance-benchmark-baselines-2026-10-04.md),
[formant-vtl](resonance-formant-vtl-2026-10-04.md),
[learned-envelope](resonance-learned-envelope-2026-10-04.md),
[pitch-neutral-ml](resonance-pitch-neutral-ml-2026-10-04.md),
[vtln-warp](resonance-vtln-warp-2026-10-04.md). Harness: [scripts/resonance-lab/README.md](../scripts/resonance-lab/README.md).

## 1. Benchmark

### Datasets (built by `scripts/resonance-lab/build_bench.py`; all audio delivered at 16 kHz)

| set | content | used for |
|---|---|---|
| r1_test | LibriSpeech test-clean, 25 utts × 40 held-out speakers (20 F / 20 M), 2.3 h | R1, gap G, R5, R7, lab reference bands |
| ptdb / fda | PTDB-TUG 2 F + 2 M (180 utts); CSTR FDA 1 M + 1 F (100 utts) | R1 per corpus (speaker-limited) |
| hill | Hillenbrand hVd tokens with audio, 45 men / 48 women (1,116) | R1 per corpus, G_hill, R4 |
| manip_test | 5 utts × 40 test-clean speakers, ≤ 5 s, × 42 conditions (8,400 items) | R2, R3, R3 @+8 st, combos |
| manip_hill | 10 men + 10 women × 12 Hillenbrand vowels × 42 conditions | R2/R3 on steady vowels |
| synth | every vowdata token (men/women/boys/girls) formant-synthesised, 2 s held | R5 held-vowel SD, R7 children (synthetic only) |
| sessions | private session clips (local-only, never committed) | R6 real-trainee ordering |
| r1_dev / manip_dev / train_dev | the same recipes on LibriSpeech dev-clean (40 other speakers) | tuning; the ONLY training pool |

F0 track supplied to candidates: two-pass Praat AC (label-blind, per item), 10 ms grid.
Manipulations (`rlab/manip.py`): Praat PSOLA pitch ±4/8/12 st; Praat "Change gender"
formant ×0.85…1.15 (pitch kept); +8 st × formant; combined male↔female moves; the same in
WORLD (envelope + aperiodicity warp). Every Δ is taken against the **same-engine
reference** so resynthesis artefacts cancel; QA in the baselines file (realised envelope
scale within ~0.7 % IQR of intended).

### Rubric (pre-registered; normalised by each candidate's own men-women gap G)

| | metric | pass |
|---|---|---|
| R1 | AUC women > men after 5 s of voiced speech, test-clean held-out speakers | ≥ 0.85 |
| R2 | pitch leak: \|median Δreadout per octave of pitch-only shift\| / G (Praat) | ≤ 0.20 |
| R3 | resonance sensitivity: slope vs ln(formant scale) × ln 1.15 / G, and sign accuracy at ±5 % | in [0.5, 1.5] and sign ≥ 0.90 |
| R4 | Hillenbrand median within-speaker across-vowel SD / G_hill | ≤ 0.5 |
| R5 | flicker, held-vowel SD, time to stable | reported |
| R6 | private-session 5 s readouts follow the pre-registered ordering of the three session groups (results kept outside this repository) | ordering holds |
| R7 | synthetic children position; AUC of highest-F0 quarter of women vs men | reported |
| R8 | CPU ms per s of audio, model size | reported |

## 2. Full leaderboard (test split, full runs; every candidate scored, failures included)

`PYTHONIOENCODING=utf-8 build/resonance-lab/venv/Scripts/python scripts/resonance-lab/lab_tables.py full --public`.
Results on the private session recordings (R6) are kept outside this repository; "result" below is
the verdict on the public gates R1–R4.
The full per-metric table (per corpus, per sex, toward-class, combos, R7, R8) is
`build/resonance-lab/results/leaderboard.md`.

| candidate | R1 AUC 5 s | R2 Praat | R3 Praat | sign ±5 % | R3 / sign @+8 st | R4 | flicker | result |
|---|---|---|---|---|---|---|---|---|
| b1_raw_f2 (current UI F2) | 0.76 | 0.00 | 0.80 | 0.83 | 0.90 / 0.79 | 2.12 | 0.95 | fail (R1, R3, R4) |
| b2_ecapa (deployed perceived-voice meter) | 1.00 | 0.15 | 0.22 | 0.79 | 0.22 / 0.90 | 0.15 | 0.03 | fail (R3) |
| b3_praat_vtl | 0.86 | 0.06 | 0.65 | 0.84 | 0.85 / 0.85 | 0.63 | 1.14 | fail (R3, R4) |
| **fv_app101214_gm1234_ridge2_bw800** | 0.98 | 0.00 | 0.86 | 0.96 | 0.85 / 0.95 | 0.43 | 0.68 | **PASS** |
| le_ens_h16 | 0.97 | 0.04 | 0.72 | 0.99 | 0.69 / 0.98 | 0.46 | 0.59 | **PASS** |
| **le_ens_h64** | 0.97 | 0.04 | 0.75 | 0.99 | 0.71 / 0.98 | 0.43 | 0.58 | **PASS** |
| le_logreg_band | 0.97 | 0.10 | 0.32 | 0.82 | 0.37 / 0.85 | 0.83 | 0.61 | fail (R3, R4) |
| le_mlp_band500_h16 | 0.97 | 0.04 | 0.71 | 0.99 | 0.69 / 0.98 | 0.46 | 0.59 | **PASS** |
| le_mlp_band500_h16_s1 | 0.98 | 0.05 | 0.71 | 0.99 | 0.67 / 0.98 | 0.41 | 0.60 | **PASS** |
| le_mlp_band500_h16_s2 | 0.96 | 0.04 | 0.72 | 0.99 | 0.68 / 0.98 | 0.50 | 0.61 | fail (R4) |
| le_mlp_band500_h64 | 0.97 | 0.04 | 0.72 | 0.99 | 0.70 / 0.98 | 0.48 | 0.58 | **PASS** |
| le_mlp_band500_h64_s1 | 0.97 | 0.04 | 0.72 | 0.99 | 0.69 / 0.98 | 0.40 | 0.58 | **PASS** |
| le_mlp_band500_h64_s2 | 0.97 | 0.03 | 0.71 | 0.99 | 0.69 / 0.98 | 0.44 | 0.55 | **PASS** |
| le_ridge_band500_pairs | 0.94 | 0.06 | 0.48 | 0.95 | 0.44 / 0.94 | 0.94 | 0.62 | fail (R3, R4) |
| pnml_head_scale_none0 | 0.54 | 3.79 | 10.63 | 0.99 | 10.43 / 0.97 | 4.27 | 2.06 | fail (R1, R2, R3, R4) |
| pnml_head_scale_tdpsola165 | 0.77 | 0.18 | 2.13 | 0.98 | 2.18 / 0.97 | 1.85 | 0.52 | fail (R1, R3, R4) |
| pnml_head_scalesex035_none0 | 0.90 | 0.26 | 1.52 | 1.00 | 1.51 / 1.00 | 0.61 | 0.25 | fail (R2, R3, R4) |
| pnml_head_scalesex035_tdpsola165 | 0.96 | 0.01 | 1.18 | 0.99 | 1.22 / 0.99 | 0.78 | 0.23 | fail (R4) |
| pnml_head_scalesex100_none0 | 1.00 | 0.07 | 0.71 | 1.00 | 0.73 / 1.00 | 0.29 | 0.12 | **PASS** |
| pnml_head_scalesex100_tdpsola165 | 0.99 | 0.08 | 0.73 | 0.99 | 0.78 / 0.99 | 0.53 | 0.15 | fail (R4) |
| pnml_head_scalesex140_none0 | 1.00 | 0.13 | 0.56 | 1.00 | 0.61 / 1.00 | 0.27 | 0.11 | **PASS** |
| pnml_head_scalesex140_tdpsola165 | 0.99 | 0.11 | 0.63 | 0.99 | 0.67 / 0.99 | 0.47 | 0.15 | **PASS** |
| **pnml_head_scalesex_none0** | 0.99 | 0.01 | 0.88 | 1.00 | 0.91 / 1.00 | 0.35 | 0.14 | **PASS** |
| pnml_head_scalesex_tdpsola165 | 0.99 | 0.06 | 0.86 | 0.99 | 0.89 / 0.99 | 0.61 | 0.16 | fail (R4) |
| pnml_head_sex_none0 | 1.00 | 0.30 | 0.17 | 0.77 | 0.19 / 0.86 | 0.23 | 0.12 | fail (R2, R3) |
| pnml_head_sex_tdpsola165 | 1.00 | 0.15 | 0.28 | 0.82 | 0.27 / 0.85 | 0.49 | 0.20 | fail (R3) |
| pnml_tdpsola165_logit (pitch-flattened deployed model) | 1.00 | 0.04 | 0.40 | 0.93 | 0.42 / 0.92 | 0.38 | 0.15 | fail (R3) |
| pnml_tdpsola165_prob | 1.00 | 0.03 | 0.35 | 0.88 | 0.37 / 0.88 | 0.44 | 0.12 | fail (R3) |
| **vtln_warp** (v3, 800-5000 Hz) | 0.97 | 0.05 | 1.17 | 0.98 | 1.16 / 0.99 | 0.31 | 0.25 | **PASS** |
| vtln_warp_b1000 | 0.95 | 0.04 | 1.10 | 0.98 | 1.11 / 0.98 | 0.33 | 0.24 | **PASS** |
| vtln_warp_b300 | 0.98 | 0.16 | 0.82 | 0.97 | 0.79 / 0.92 | 0.42 | 0.25 | **PASS** |
| vtln_warp_b600 | 0.99 | 0.08 | 1.00 | 0.99 | 1.03 / 0.99 | 0.40 | 0.24 | **PASS** |
| vtln_warp_b600_aug | 0.99 | 0.08 | 0.96 | 0.99 | 0.96 / 0.99 | 0.38 | 0.23 | **PASS** |

Dev-split sweeps (69 formant-vtl variants, 61 learned-envelope CV variants, the plain
pitch-neutral family, 20+ vtln dev variants) are tabulated in the family files.

Headline negatives worth keeping:

* **The current UI signal (raw F2) fails** R1/R3/R4; raw F2 mostly follows the vowel.
* **The deployed perceived-voice meter (B2) is not a resonance meter**: separation is
  perfect, but a ×1.05 formant change moves it 0.03-0.07 G, sign accuracy 0.79, isolated
  Hillenbrand vowels at chance (0.49), and within-sex correlation with hand-measured formant
  size 0.17 (men) / 0.03 (women).
* **Removing pitch from the deployed model's input does not make it resonance-sensitive**
  (every resynthesis engine / reference pitch: R3 0.26-0.40) — the passing pnml row comes
  from a newly trained head, not from the flattening.

## 3. Judge verdict (re-scored independently)

The judge re-ran fv, le and vtln on the full test split from scratch (metrics identical,
per-window scores bit-identical) and pnml's quick subset from its deployment ONNX
(within 1e-4). Diagnostics beyond the rubric:

* **Within-sex validity** (Spearman vs a hand-measured, vowel-normalised F1-F3 size index,
  Hillenbrand speakers; men / women): B1 0.46 / 0.62, **B2 0.17 / 0.03**, B3 0.57 / 0.47,
  vtln 0.52 / 0.67, pnml 0.35 / 0.60, le 0.49 / **0.77**, fv 0.44 / 0.62. Controlling for
  F0 changes these by ≤ 0.05.
* **Convergent validity** on the 20 + 20 test-clean speakers: fv / le / vtln agree
  pairwise at 0.86-0.87 (men) and 0.54-0.74 (women); pnml vs those 0.69-0.77 / 0.26-0.65.
* **Is a 5 % change visible in 5 s?** 5 s readout SD vs the ×1.05 move (men / women), in G:
  vtln 0.18 vs 0.44 / 0.39; pnml 0.09 vs 0.36 / 0.32; le 0.13 vs 0.28 / 0.22; fv 0.17 vs
  0.29 / 0.32; B2 0.03 vs 0.03 / 0.07.
* **Channel / noise probe** (240 utterances × 9 conditions; clean F0 track used for voicing
  in every condition — optimistic): median readout shift in G and 5 s AUC —

  | condition | vtln | pnml | le | fv |
  |---|---|---|---|---|
  | pink noise 20 dB SNR | +0.11, 0.95 | −0.01, 0.99 | +0.22, 0.98 | +0.16, 0.97 |
  | pink noise 10 dB | +0.26, 0.91 | −0.04, 1.00 | +0.55, 0.95 | +0.37, 0.95 |
  | babble 10 dB | +0.13, 0.94 | −0.04, 0.99 | +0.34, 0.95 | +0.25, 0.95 |
  | telephone band 300-3400 Hz | −0.56, 0.96 | −0.03, 1.00 | −0.36, 0.97 | **−0.66, 0.74** |
  | reverb RT60 0.5 s | +0.03, 0.96 | −0.03, 0.99 | +0.16, 0.97 | +0.13, 0.96 |

  Noise makes men read more feminine under all three DSP finalists (at 10 dB, men shift
  +0.26 to +0.78 G — critic's correction of the judge's range). A ±6 dB high-shelf tilt
  shifts every finalist ≤ 0.11 G; −20 dB of level shifts none.

Judge recommendation for the live trial: vtln_warp (most resonance-sensitive) and
pnml_head_scalesex_none0 (channel-robust, drop-in model change), with le and fv as cheap
JS-ready companions.

## 4. Critic corrections (accepted; they change how the passes may be cited)

1. **Test-set peeking on the binding gates.** Neither R4 nor the private-session R6 has a
   working dev proxy, and every finalist's final configuration was chosen after test numbers
   were seen: vtln's final 800 Hz band is test-informed (partly on results on the private
   session recordings, kept outside this repository); pnml switched from TD-PSOLA to raw input
   after the TD-PSOLA head failed R4 on the test quick subset; fv combined the best
   test-viewed parts of 9 test variants; le ran 11 test runs (1 of 6 seeds fails R4).
   → Report the passes as test-informed; re-confirm R4 on a second vowel corpus (and R6 on
   new recordings) before calling them passes.
2. **le's R2/R3 are not out-of-engine evidence**: it was trained on the harness's own Praat
   PSOLA / Change-gender / WORLD transforms with losses that directly target R2/R3. Its
   validity evidence is R1 and within-sex Hillenbrand tracking (0.49 / 0.77).
3. **R6 raised − low is not a resonance ground truth**: alice_raised / alice_low are defined
   by F0 bucket, so pitch confounds the contrast. Results on the private session recordings
   are kept outside this repository.
4. **vtln with production F0** (critic's run, Boersma-AC emulation tracks, test quick): still
   passes R1-R4 (AUC5 0.981, R2 0.007, R3 1.14 / sign 0.98, R4 0.40), but women's isolated
   Hillenbrand vowels WORLD R2 rises 0.06 → 0.37 and women's +8 st R3 0.52 → 0.43.
5. **pnml's channel invariance is not shown for its resonance component**: its 5 s AUC
   *rises* under telephone band (0.984 → 0.996), consistent with a readout dominated by the
   c = 0.07 sex/identity term; a pure-scale head separates only at AUC 0.54-0.77. Label it
   "resonance-weighted perceived voice"; show R3/sign surviving noise and telephone band
   before calling it channel-robust.
6. "In-session change trustworthy at the ~5 % level" is overstated: single-5 s d′ is only
   1.3-2.4 for the DSP finalists, on uniform resynthesis scaling, in a clean stable room.
   Better: *a 5 % change is detectable after averaging several 5 s readouts in a stable room.*
7. Browser real-time issues: pnml must not be a second 16 MB session (one graph, both
   outputs); vtln had no JS port and needs F0 aligned to audio behind the pitch decode lag.
8. Methodology: the harness F0 is non-causal; Hillenbrand R1 for B2/pnml is not fully held
   out (q8-v2 was accepted on Hillenbrand).

## 5. Finalists in the lab (critic's revised list)

| finalist | role in the lab | what it is | cite with |
|---|---|---|---|
| vtln_warp v3 | most resonance-specific DSP readout | CheapTrick envelope (needs F0) scored against ±0.24 ln-shifted sub-windows of a SAT-trained 32-component GMM, 800-5000 Hz; ML ln α over the trailing 1 s of voicing | band choice is test-informed (used private-session R6 results) |
| pnml_head_scalesex_none0 | steadiest, least channel-sensitive | deployed ECAPA q8-v2 fc6 embedding → 192-weight head (target ln α + 0.07·sex) | "resonance-weighted perceived voice"; partly a sex/identity readout |
| le_ens_h64 | cheapest JS-ready companion | 3-seed tiny MLP on the pitch-free 500-6000 Hz band envelope | R2/R3 are in-engine; largest noise bias |
| fv_app101214_gm1234_ridge2_bw800 | interpretable companion | app LPC (orders 10/12/14) F1-F4 log geometric mean minus a 10-weight vowel-shape correction | fails narrow-band (telephone / Bluetooth HFP) audio |

## 6. In-app lab implementation

Files (all new except the two hook lines):

| file | role |
|---|---|
| `src/resonance-lab/flag.js` | `?resonance=lab` flag — the only lab code in the main bundle |
| `src/resonance-lab/labPipeline.js` | main thread: spawns the lab worker, connects ONE extra capture consumer port, small store for the view |
| `src/resonance-lab/lab-worker.js` | worker: runs the engine; pnml via transformers.js with the deployed model patched in memory |
| `src/resonance-lab/lab-engine.js` | pure streaming core (also run unchanged by the Node tests and the lab-live benchmark) |
| `src/resonance-lab/{vtln,le,fv,pnml}.js` | the four finalists, allocation-free per frame |
| `src/resonance-lab/onnx-patch.js` | protobuf patch: `logits` := Concat([fc7 logits, relu_33], 1) |
| `src/resonance-lab/sinc-resampler.js`, `ring.js`, `fft.js`, `readout.js` | anti-aliased 16 kHz analysis stream; sample rings; FFT; sliding 5 s-voiced readouts |
| `src/resonance-lab/LabView.jsx` | lazy view (tab "Resonance lab") |
| `public/resonance-lab/*.json` | le (198 KB), vtln (93 KB), fv (<1 KB), pnml head (5 KB), reference bands (3 KB) — `scripts/resonance-lab/export_lab_assets.py` |
| `src/audio/useAudioPipeline.js`, `src/App.jsx` | `if (RESONANCE_LAB_ENABLED) import(...)` + stop/teardown; tab + lazy view |

Design points:

* **Pitch.** The engine runs its own exact replica of the production pitch worker (linear
  resampler → notch → Boersma-AC → L = 2 tracker → notch veto + harmonic guard), with each
  decoded frame attributed to the centre of its 80 ms buffer, mapped to the benchmark's
  10 ms grid (nearest within 12.5 ms) — identical to `prodf0.mjs`, the critic's production-F0
  emulation. Every finalist frame waits until its pitch decision exists (~90 ms behind the
  audio); this also solves vtln's need for F0 aligned to the audio.
* **Analysis stream.** le / vtln / pnml read a 16 kHz stream from an anti-aliased polyphase
  sinc resampler (Blackman, cutoff 7.2 kHz; error < 1.2e-4 rms to 6.5 kHz, aliases of
  12-20 kHz tones ≤ −113 dB at 48 and 44.1 kHz). The production linear resampler would fold
  8-24 kHz into the bands these finalists read; the benchmark audio was band-limited. fv
  reads the capture-rate stream through the app's own FIR decimator, as the prototype did.
* **pnml = one inference, two readouts** (critic item 7): the lab fetches the same Hub file
  the gender worker uses (read from the transformers.js browser cache if present; the lab
  never writes the patched bytes into that cache), patches the graph in memory so
  `logits` = [2 original logits, 192-d relu_33 embedding], and applies the head in JS. The
  patched graph passes `onnx.checker`, keeps every initializer byte-identical, and matches
  the prototype's embedding graph exactly (max |Δ| = 0 on 5 random windows in Python ORT).
  The lab still runs alongside the production gender worker (two inferences per hop in lab
  mode); the dual output is what a production cutover would use to replace both.
* **Readouts.** Each finalist's own pooling (median; mean for le) over the values stamped
  in the trailing 5 s of voiced time (silence freezes rather than drains). Display:
  u = (readout − men median) / (women median − men median) from the finalist's 5 s
  readouts on the 20 + 20 held-out LibriSpeech test-clean speakers (bands = q10-q90 of
  per-speaker medians). Axis labelled only "larger / darker ↔ smaller / brighter"; no
  targets, no colours with meaning, same for any direction of training. Jitter whisker =
  SD of the last 20 readouts (3 s).

## 7. Parity: JS ports vs the scored prototypes

`npm run test:resonance-lab` (= `node tests/resonance-lab/parity-test.js`). The whole
streaming engine is driven with 25 ms / 48 kHz chunks; the 16 kHz analysis stream and the
harness F0 track are injected so the inputs equal the prototypes'. Fixtures: three 5 s
LibriSpeech test-clean clips (highest-F0 woman, lowest-F0 man, a man at +8 st × formant
1.05), regenerated by `scripts/resonance-lab/lab_fixtures.py`.

| finalist | prototype compared against | bins compared (3 fixtures) | max \|Δ\| | in G | NaN/null pattern |
|---|---|---|---|---|---|
| le | le_ens_h64 (Python) | 83 | 5.6e-16 | 6e-15 | identical |
| vtln | vtln_warp v3 (Python + pyworld 0.3.5) | 83 | 4.0e-6 ln α | 4e-5 | identical |
| fv | fvtl_js.mjs (scored JS; output rounded to 1e-6) | 84 | 4.9e-7 | 4e-6 | identical |
| pnml raw head score | Python ORT on the prototype's embedding graph, float32 | 102 windows | 4.2e-17 | 4e-16 | identical |
| pnml gated EMA | same | 102 windows | 2.8e-17 | 3e-16 | identical |
| deployed fc7 logit (same inference) | Python ORT | 102 windows | 2.4e-7 | – | identical |
| pitch path | prodf0.mjs (fixture rounded to 1e-4 Hz) | 1,473 frames | 5e-5 Hz | – | voicing identical |

vtln's residual is the prototype scoring its GMM in float32. The CheapTrick port is exact
WORLD 0.3.x (incl. its deterministic xorshift safeguard noise), checked through vtln.
(The benchmark's own pnml numbers used float16-cached embeddings, ≤ 1.2e-4 off per window —
judge.)

## 8. The finalists through the in-app lab path (benchmark, --quick subsets)

`scripts/resonance-lab/candidates/lab_live.py` runs each finalist through
`lab-engine.js` exactly as the browser does — 16 kHz items band-limited-upsampled to
48 kHz, 25 ms capture chunks, the engine's own production pitch replica for voicing **and**
F0 (the harness F0 is ignored), its anti-aliased analysis resampler, the 90 ms decode-lag
scheduling — scored by the unchanged harness. Quick subsets only (r1_test 8 utts/speaker,
¼ of manip sources, ⅓ of Hillenbrand speakers, ½ of the sessions set); not comparable with full
runs, compared here against each prototype's own quick run.

`PYTHONIOENCODING=utf-8 $PY scripts/resonance-lab/lab_tables.py live --public` (lab-path results are kept in
`build/resonance-lab/lab_live/results/`, out of the shared leaderboard).

| finalist / path | R1 AUC 5 s | R2 Praat | R3 Praat | sign ±5 % | R3 / sign @+8 st | R4 | flicker | result (quick) |
|---|---|---|---|---|---|---|---|---|
| vtln: harness F0 (prototype) | 0.98 | 0.05 | 1.18 | 0.98 | 1.22 / 0.98 | 0.42 | 0.26 | **PASS** |
| vtln: production-F0 track (prototype, critic) | 0.98 | 0.01 | 1.14 | 0.98 | 1.14 / 0.98 | 0.40 | 0.31 | **PASS** |
| vtln: **in-app lab path** | 0.98 | 0.01 | 1.13 | 0.98 | 1.14 / 0.98 | 0.40 | 0.31 | **PASS** |
| pnml: harness F0 (prototype) | 0.99 | 0.02 | 1.02 | 1.00 | 0.99 / 1.00 | 0.31 | 0.15 | **PASS** |
| pnml: **in-app lab path** | 0.98 | 0.03 | 1.03 | 1.00 | 1.03 / 1.00 | 0.37 | 0.19 | **PASS** |
| le: harness F0 (prototype) | 0.98 | 0.03 | 0.67 | 0.98 | 0.63 / 0.99 | 0.53 | 0.50 | fail (R4) |
| le: production-F0 track (prototype) | 0.97 | 0.05 | 0.65 | 0.98 | 0.65 / 0.96 | 0.59 | 0.58 | fail (R4) |
| le: **in-app lab path** | 0.97 | 0.05 | 0.63 | 0.98 | 0.62 / 0.97 | 0.57 | 0.58 | fail (R4) |
| fv: harness F0 (prototype) | 0.98 | 0.00 | 0.86 | 0.96 | 0.85 / 0.99 | 0.44 | 0.66 | **PASS** |
| fv: **in-app lab path** | 0.97 | 0.01 | 0.87 | 0.95 | 0.89 / 0.95 | 0.45 | 0.78 | **PASS** |

Results on the private session recordings (R6) are kept outside this repository; "result (quick)" is
the verdict on the public gates R1–R4.

Reading: **the lab path reproduces each finalist's prototype behaviour.** Every
difference is the size of the harness-F0 → production-F0 change the critic already
measured for vtln (and the pitch-neutral-ml agent for le); the anti-aliased resampler,
48 kHz framing and decode-lag scheduling add nothing visible. le fails R4 on this quick
subset under every path (its full-split R4 0.43 is marginal; quick subset 0.53 — known).
fv loses some sign accuracy at +8 st (0.99 → 0.95) and gains flicker (0.66 → 0.78)
from production voicing.

## 9. Cost

| path | measured |
|---|---|
| Node, lab engine on 16 s of speech @ 48 kHz (single thread) | pitch replica + resamplers ≈ 22 ms CPU per s of audio; + le ≈ 4; + fv ≈ 6; + vtln ≈ 21; all four DSP finalists ≈ 45-55 |
| Node, lab-live benchmark (incl. the bench's 16→48 kHz upsampling) | le 44, fv 46, vtln 73 ms CPU per s of audio (whole engine incl. pitch replica); pnml 181 ms CPU per s with onnxruntime-node, 1 thread |
| headless Chrome (desktop, smoke run, lab worker) | all four DSP finalists + pitch replica + resampler: 80-108 ms of worker time per s of audio across three smoke runs (machine shared with other jobs); pnml 57-94 ms per inference (59 ms in the least-loaded run) — the deployed meter's cost class, paid a second time in lab mode |
| pnml inference | same graph as the deployed meter (~52 ms desktop WASM per the 2026-07-19 measurement); in lab mode it runs IN ADDITION to the production gender worker; mobile unmeasured |

## 10. Production isolation (no flag)

* Build: the production chunks are byte-identical to the branch head before the lab
  (`pitch-worker-EOfs3FpO.js`, `gender-worker-BXSWd1M-.js`, `dsp-worker-DzXvU6f8.js`, the ORT
  wasm). The main `index` chunk changes by the flag check and two lazy-import stubs
  (`LabView`, `labPipeline` chunk names); the CSS gains the LabView's Tailwind utilities
  (+2.7 kB of unused rules without the flag); `DiagnosticOverlay` changes only through its
  import of the renamed index chunk. New, never-fetched-without-the-flag files:
  `labPipeline-*.js`, `lab-worker-*.js`, `LabView-*.js`, `resonance-lab/*.json`.
* Run (`scripts/resonance-lab/lab-smoke.mjs`, built app via `vite preview`, headless Chrome
  with a fake-mic speech WAV, fresh temp profile, PID-scoped cleanup): without the flag
  exactly the three production workers start and **no** lab chunk, worker or asset is
  requested; with `?resonance=lab` the lab worker starts, its five JSON assets load, all four
  readouts settle (pnml model loaded), no page errors.

## 11. Limitations (what the lab can and cannot tell a trainee)

* **Population scope:** adults, English read speech (LibriSpeech 40 + 40 speakers for
  training/reference); R6 rests on one trainee's private recordings. No real children, no non-English
  or spontaneous speech, no singing/falsetto/whisper. Synthetic children put le and vtln
  *below* men (vtln saturates at its ±0.24 ln search range).
* **Absolute position is device- and room-dependent** by roughly 0.3-0.6 G; noise pushes
  the DSP readouts toward smaller/brighter (a false "progress" signal in a noisy room).
  Within-session change is the trustworthy quantity; average several 5 s readouts.
* **Held vowels** read less reliably (Hillenbrand R3 0.46-0.72) and vowel offsets of
  ±0.5-0.6 G remain — use running speech.
* **Uniform scaling is not real training.** R3 manipulations scale every formant together;
  real resonance work (larynx height, tongue fronting, lip spreading) changes ratios, and
  fv's vowel-shape correction may absorb some of it.
* **Passes are test-informed** (§4.1); R4 margins are narrow for le and fv (CI to 0.53-0.54).
* **Lab-path specifics:** production pitch errors feed vtln's envelope (sustained
  octave-down ≈ −0.25 G for women); the lab adds a second ECAPA inference per hop on top of
  the gender worker; mobile is untested.

## 12. Reproduction

```bash
PY=build/resonance-lab/venv/Scripts/python                 # system site-packages + pyworld 0.3.5
$PY scripts/resonance-lab/build_bench.py                    # benchmark items (~1 h, idempotent)
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/vtln_warp.py
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/learned-envelope/le_ens_h64.py
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/formant-vtl/fv_js.py
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/pitch-neutral-ml/pnml.py
$PY scripts/resonance-lab/bench.py leaderboard
PYTHONIOENCODING=utf-8 $PY scripts/resonance-lab/lab_tables.py full --public
# lab assets, fixtures, parity
$PY scripts/resonance-lab/export_lab_assets.py              # public/resonance-lab/*.json
$PY scripts/resonance-lab/lab_fixtures.py                   # tests/resonance-lab/fixtures/
npm run test:resonance-lab
# finalists through the in-app lab path (quick)
for c in LabLiveLe LabLiveFv LabLiveVtln LabLivePnml; do
  $PY scripts/resonance-lab/bench.py score "scripts/resonance-lab/candidates/lab_live.py:$c" --quick; done
PYTHONIOENCODING=utf-8 $PY scripts/resonance-lab/lab_tables.py live --public
# isolation + live smoke on the built app (48 kHz speech WAV as the fake mic)
npm run build && node scripts/resonance-lab/lab-smoke.mjs --wav=<speech_48k.wav> --seconds=45
```

Try it: `npm run dev`, open `http://localhost:5173/Syrinx/?resonance=lab`, Start Listening,
open the "Resonance lab" tab, speak (running speech, ~5 s per reading).
