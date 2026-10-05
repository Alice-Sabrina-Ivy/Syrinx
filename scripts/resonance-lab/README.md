# Resonance-validity benchmark (resonance-lab)

A shared, calibration-free benchmark for **real-time resonance feedback that works for
any voice without per-user recordings**. Every candidate is scored on the same items and
the same metrics; the question each metric asks is "does this readout track vocal-tract
resonance — and *only* resonance — for speakers it has never heard?"

Code lives here (committed). Everything generated — converted audio, manipulated WAVs,
F0 tracks, cached scores, results — lives under `build/resonance-lab/` (gitignored).
Results on the `sessions` set (rubric item R6, the private session recordings) stay there
or in the user's private project: never copy R6 scores, AUCs or orderings into
`measurements/` (see CLAUDE.md "Private session data").

## Quick start

```bash
PY=build/resonance-lab/venv/Scripts/python          # venv = system site-packages + pyworld
$PY scripts/resonance-lab/build_bench.py            # one-off: build all item sets (~1 h, idempotent)
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/<you>.py --quick   # fast iteration
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/<you>.py           # leaderboard run
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/<you>.py --split dev  # tuning split
$PY scripts/resonance-lab/bench.py leaderboard      # rebuild the table from results/*.json
```

Results: `build/resonance-lab/results/<name>[.dev][.quick].json` plus
`build/resonance-lab/results/leaderboard.{md,json}`. Scores are cached per set in
`build/resonance-lab/scores/<name>/`; bump your candidate's `version` (or pass `--force`)
after changing it.

## Writing a candidate

Copy `candidates/example_template.py`. A candidate is a Python file that defines
`CANDIDATE` (a class or instance) following `rlab/candidate.py`:

```python
class MyCand(Candidate):
    name = "my_cand"; version = "1"; description = "..."
    cadence_s = 0.15          # nominal output interval
    uses_f0 = True            # receive an F0Track
    aggregate = "median"      # harness pools window scores into readouts with this (median|mean)
    model_bytes = 0; js_portability = "..."
    def setup(self): ...      # once per worker process (load models here)
    def score(self, x, sr, f0=None):   # x float32 @ 16 kHz; f0 = F0Track (t, f0; 10 ms; 0 = unvoiced)
        return t, s           # window times (s, window END for causal output) and scores
```

* **Orientation:** larger score = more feminine-typical / shorter apparent vocal tract.
  Units are arbitrary — every metric is normalised by your own men-women gap `G`.
* `NaN` = "no output here" (e.g. unvoiced). Readouts skip NaNs; coverage is reported.
* `score()` sees audio (+ F0) only: no labels, ids or file names. It is stateless across
  calls (each item is a fresh stream).
* **Training data:** learned candidates may fit ONLY on the `train_dev` manifest
  (`build/resonance-lab/bench/manifests/train_dev.parquet`: all 2,703 LibriSpeech
  dev-clean utterances, 40 speakers, with `sex`, `path`, `f0_path`). Test sets must never be
  used for fitting or threshold choice. For tuning, use `--split dev` (`r1_dev` +
  `manip_dev`, also dev-clean — so use speaker-wise CV if you also train on dev-clean).
* Torch/ORT threads are pinned to 1 per worker; the harness parallelises over items.
* **JS candidates:** subclass `NodeBridgeCandidate` (see `candidates/b1_raw_f2.py` +
  `node/app_formants_f2.mjs`). The harness writes anonymised raw float32 audio + F0 files,
  runs `node <script> jobs.json out.jsonl` shards as child processes (terminated only via
  their own handles), and reads one JSON line per item `{"key","t","s"}` plus an optional
  `{"__cpu_s": ...}` line for R8.

The F0 track: two-pass Praat AC (pass 1 at 60-700 Hz, pass 2 at [0.75 q25, 1.5 q75] of
pass 1 — per item, label-blind). Manipulated items get the source track × the intended
pitch factor (timing is preserved by both engines; QA confirms the realised median within
~1 %). Session clips use the octave-robust consensus reference from the 2026-10-03
session-attribution investigation. This is a better F0 than production's 75-400 Hz
Boersma-AC will give at the extremes (e.g. men at −12 st ≈ 50 Hz) — candidates that lean
on F0 should say how they would behave with the production detector.

## Item sets (`build_bench.py`)

| set | content | used by |
|---|---|---|
| `r1_test` | LibriSpeech test-clean, 25 utts × 40 held-out speakers (20 F / 20 M), 2.3 h | R1, G, R5, R7 |
| `ptdb` | PTDB-TUG subset, 2 F + 2 M speakers, 180 utts (MIC, 48 k → 16 k) | R1 per-corpus |
| `fda` | CSTR FDA, 1 M + 1 F, 100 utts (20 k → 16 k) | R1 per-corpus |
| `hill` | Hillenbrand men + women hVd tokens with audio (1,116) | R1 per-corpus, G_hill, R4 |
| `manip_test` | 5 utts × 40 test-clean speakers (100 F + 100 M), cropped to ≤ 5 s, × 42 conditions | R2, R3, R3@+8 st, combos |
| `manip_hill` | Hillenbrand 10 men + 10 women × 12 vowels (240 tokens) × 42 conditions | R2, R3 on steady vowels |
| `synth` | all vowdata tokens (men/women/**boys/girls**) formant-synthesised, 2 s held | R5 held-vowel SD, R7 children |
| `sessions` | private session clips (`$SYRINX_SESSIONS_DIR`; local-only, never committed): groups second / alice_low / alice_raised | R6 |
| `r1_dev`, `manip_dev` | same recipes on dev-clean (80 manip sources) | `--split dev` tuning |
| `train_dev` | all dev-clean utterances (never scored) | training pool |

### Manipulation conditions (`rlab/manip.py`), per source

* `orig` (unprocessed crop)
* **Praat** — `ref_psola` (PSOLA ×1.0), `p±4/±8/±12` (PSOLA pitch tier × 2^(st/12)), `ref_cg`
  ("Change gender" ratio 1.0, pitch kept), `f0.85 … f1.15` (Change gender formant ratio,
  pitch kept), `hi8_f0.95/1.00/1.05/1.10` (Change gender +8 st with formant ratio), combos
  `mf+4_f1.05, mf+8_f1.10, mf+12_f1.15` (men → female-like) / `fm-4_f0.95, fm-8_f0.90,
  fm-12_f0.85` (women → male-like).
* **WORLD** (pyworld harvest/cheaptrick/d4c) — `ref` (analysis/synthesis), the same pitch,
  formant (envelope and aperiodicity warped S'(f) = S(f/α)), `hi8_*` and combo conditions.

Each condition is compared against its **same-engine reference** (pitch vs `ref_psola`;
formant/combo vs `ref_cg`; `hi8_f*` vs `hi8_f1.00`; WORLD vs WORLD `ref`), so resynthesis
artifacts cancel. All variants of a source are RMS-matched to the source and share one
peak-limiting gain. QA columns in the manifest: `qa_f0_ratio` (realised / intended F0
median, Praat with an expectation-centred range) and `qa_env_scale` (log-frequency shift of
the mean LPC envelope vs the condition's reference).

## Metrics (`rlab/metrics.py`)

Readouts: **utterance** = `aggregate` of an item's finite window scores. **Horizon H** =
walk a speaker's items in stream order, stamp each window with the speaker's cumulative
*voiced* time, readout k = aggregate of windows in [kH, (k+1)H) (complete bins only).
**Speaker** = aggregate of all the speaker's windows. AUCs are oriented women > men and
speaker-balanced (each speaker's readouts weighted 1/n).

**G** = median over women speakers of their median utterance readout − the same for men,
on `r1_test`. `G_hill` likewise on Hillenbrand.

| metric | definition | pass |
|---|---|---|
| **R1** separability | AUC women vs men at 2 s / **5 s** voiced / utterance / speaker on test-clean; per-corpus PTDB, FDA, Hillenbrand token + speaker | 5 s AUC ≥ 0.85 |
| **R2** pitch leak | per source, slope (through 0) of Δreadout vs octaves over the six pitch-only conditions; median over sources; \|·\| / G. Praat headline, WORLD + per-sex + Hillenbrand reported | ≤ 0.20 |
| **R3** resonance sensitivity | per source, slope of Δreadout vs ln(formant scale) over the six formant-only conditions; median × ln 1.15 / G (1.15 ≈ the men→women dispersion gap, so ideal ≈ 1). Sign accuracy = share of Δ(×1.05) > 0 and Δ(×0.95) < 0 | in [0.5, 1.5] and sign ≥ 0.90 |
| R3@+8 st | the same at a raised pitch (`hi8_*` vs `hi8_f1.00`; men ≈ 190 Hz, women ≈ 330 Hz) — the trainee-relevant case | reported |
| toward-class | median move of men toward female (+12/+8 st, ×1.15/×1.05) and women toward male (−12/−8 st, ×0.85/×0.95), in G. A saturating score (classifier probability) is flat in the same-class direction, which dilutes the symmetric R2/R3 slopes; these one-sided figures show the leak where the meter can actually move | reported (read alongside R2/R3) |
| combos | Δ/G of the combined moves; "resonance share" = Δ(formant-only)/Δ(combo); share of sources crossing the men/women midpoint; also share of men flipped by **pitch alone** (+12 st) | reported |
| **R4** vowel robustness | Hillenbrand median within-speaker across-vowel SD / G_hill; per-vowel offsets | ≤ 0.5 |
| R5 stability | flicker = median within-utterance SD of window scores / G (test-clean); held SD = median SD over synthetic held vowels (0.75-2 s) / G; time-to-stable = voiced seconds until the cumulative readout stays within ±0.25 G of its 60 s value | reported |
| **R6** real voices | Session clip and 5 s readouts: S−L, R−L, S−R in G units (S second voice, R alice_raised, L alice_low), AUCs, ordering, and R−L corrected for the measured pitch leak × the raised-vs-low octave distance | second > alice_raised > alice_low |
| R7 high-F0 | synthetic boys/girls position relative to synthetic men (0) and women (1); AUC children vs men; AUC of top- vs bottom-F0-quartile test-clean women vs men; R3@+8 st for women | reported |
| R8 cost | CPU ms per second of audio (single thread; JS bridges report extractor time only), model MB, JS-portability note | reported |

## Caveats built into the design

* Manipulation engines leave artifacts; that is why there are two (Praat PSOLA/Change
  gender and WORLD) and why every Δ is against a same-engine reference. Disagreement
  between engines is a flag, not noise to average away.
* "×1.15 ≈ men→women gap" is a literature figure; B3 (Praat dispersion) measures the
  actual test-clean men/women dF ratio for calibration (see the measurement file).
* FDA has one speaker per sex and PTDB two: their AUCs are speaker-identity-limited;
  test-clean (40 speakers) is the headline.
* Synthetic vowels (R5 held, R7 children) are static-formant, source-filter stimuli — a
  domain shift for learned candidates. Read children only relative to the synthetic
  men/women produced by the same synthesiser. Praat Burg also mis-tracks some of these
  static synthetic spectra (spurious extra poles), so formant-based candidates may read
  them worse than real voices.
* The sessions R6 set comes from one trainee's private recordings on one room/mic chain.
  Ordering "raised > low" assumes the trainee's raised register also carries some
  resonance change; the pitch-corrected R−L column shows how much of any raised-register
  shift is explained by pitch leak alone.
