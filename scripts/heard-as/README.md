# "Likely heard as" tooling

The experimental, opt-in "Likely heard as" panel
(`src/components/HeardAsPanel.jsx`) pools the gender worker's per-window
classifier logits and the posted pitch with `src/ml/heard-as.js` and maps
them to listener shares with the constants in `src/ml/heardAsCalibration.js`.
Decision data: `measurements/heard-as-calibration-2026-10-07.md` and
`measurements/heard-as-window-logit-2026-10-07.md`. Public data only; every
output goes to the gitignored `build/heard-as/`.

## Production chain (Node)

| Script | What it does |
|---|---|
| `chain.mjs` | The app's chain on the audio clock: real pitch worker (fake `self`), the gender worker's window schedule (streaming resampler, 0.75 s ring, 150 ms decision hop, the classifier every `ML_CLASSIFY_HOP_MS` via `classifyDue` (option `classifyHopMs`), `decideMlWindow` + the real utterance gate fed the relayed pitch frames, the silence floor). `replay()` needs no model; `loadClassifier()` loads the deployed q8-v2 pipeline from the transformers.js cache |
| `run_chain.mjs <jobs.json> <out.jsonl> [--burst=40 --jitter=5] [--hop=450] [--logits=<chain.jsonl>]` | Per stimulus: replay → classifier → `heard-as.js` aggregate over the whole stimulus. `--burst` times the hop on a bursty arrival clock (the burst-jitter check); `--hop` sets the classifier hop; `--logits` reuses a previous run's logits for windows at the same time |
| `compare_hop.py <pov_stimuli.csv> <base.jsonl> <variant.jsonl>...` | Palette share change between two `run_chain.mjs` runs (e.g. classifier hops) and each one's error vs the listeners |
| `hop-study.mjs --r1=<jobs.json>` + `hop_study_report.py` | The live panel (2 s updates, 250 ms held-note check, hide rules) at several classifier hops on continuous LibriSpeech readers, short utterances and synthetic held vowel / noise / silence: time to the first estimate, hide-state changes, shown-estimate change, women and men separately |
| `voiced-windows/` (`build_streams.py`, `run.mjs`, `eval.mjs`) | `measurements/heard-as-voiced-windows-2026-10-08.md`: the chain with and without the speech detector on whisper mixes, held-out readers, the Palette, noise / channel / reverb, music and synthetic streams; the voiced-windows rule variants; the constants re-check |
| `ort-bench.mjs` | Classifier cost per inference under onnxruntime-web builds and session options (Node) |
| `make_golden.mjs` | Writes `tests/ml/fixtures/heard-as-golden.json` from the three lab fixtures (public LibriSpeech); aggregates by `golden_check.py` (independent Python). **Re-run after any change to the utterance gate, the pitch chain or `decideMlWindow`** — after re-checking the constants |
| `analyze_palette.py <pov_stimuli.csv> <chain.jsonl> [<burst.jsonl>]` | Production-chain vs lab-chain inputs on the Palette and the shipped constants' error on each |
| `logit-check.mjs` | `femaleLogitFromResult` vs the model's raw fc7 difference on public windows |
| `window-decision-replay.mjs --runs=<dir>` | `decideMlWindow` vs the pre-refactor inline decision over recorded perceived-voice-gate runs (`scripts/perceived-voice-gate/`) |

`chain.mjs` takes `speech` (the Silero speech detector fed to the gate exactly as the gender worker does: `loadSpeechDetector(<silero_vad.onnx>)`, sha256-checked, or recorded probabilities); `run_chain.mjs --silero=` and `make_golden.mjs --silero=` (required) use it — the live gate is the detector's since the voice-direction merge.

`tests/ml/heard-as-equivalence-test.js` (CI) fails when the window set or the
posted pitch on the fixtures changes: then re-run `run_chain.mjs` on the
calibration sources, refit or confirm the constants (below), and regenerate
the golden file.

## Pitch-only-change warning study

`pitch-only/` — the pre-registered study behind `src/ml/pitch-only-warning.js`
(`measurements/heard-as-pitch-only-warning-2026-10-07.md`, whose Reproduce
section lists the order): `build_jobs.py` (session audio), `session.mjs` (the
production chain, ticks every 2 s), `features.py`, `rules.py` (every
pre-registered configuration), `select_report.py`, `details.py`, `posthoc.py`
(the K = 1 / 2 / 3 flash check) and `make_fixture.py` (the golden replay
fixture `tests/ml/fixtures/pitch-only-golden.json`). Run in a directory under
`build/`; needs `SYRINX_LIBRISPEECH` and, for the hcc / picka / rb sets,
`SYRINX_HEARD_AS_DATA`.

## Calibration (Python)

`calibration/` holds the fit that produced the shipped constants (form A,
licence-clean sources only). The inputs are per-stimulus tables, never
committed (they include NC-licensed validation sources):

```
$SYRINX_HEARD_AS_DATA/
  feminine-eval/<source>/stimuli.csv      one row per measured stimulus: cues + the source's listener shares
  resonance-choice/measure/pov_stimuli.csv  Palette (Munson & Dolquist 2025, CC BY 4.0) shares + cues
  resonance-choice/measure/r1_utts.csv, out_r1.jsonl   40 LibriSpeech readers (u-scale, hide rules)
```

The cues in those tables were measured with the resonance lab's chain
(`meter_logit` = mean fc7 logit of the lab-gated windows, `lnf0` = ln median
voiced F0 of the production pitch replica). Sources and where to get them:
Palette of Voices (OSF n3twm), Meyer et al. 2023 (DataverseNL
doi:10.34894/IAGXVF; Fig. 6B), Skuk et al. 2020 (OSF f85tj), Hillenbrand &
Clark 2009 (published condition rates; stimuli rebuilt from the Hillenbrand
et al. 1995 /hVd/ recordings and LibriSpeech test-clean), ResearchBox 695
(Zenodo doi:10.5281/zenodo.15038471); validation: PICKA (Jebens 2022, Nagels
2020), bmmb, Kong STraDa, Neuenswander, Mooshammer, LibriTTS-P.

Run in an output directory (each script writes its `.txt` / `.json` there), in order:

```
export SYRINX_HEARD_AS_DATA=<data root>
cd build/heard-as/calibration
python <repo>/scripts/heard-as/calibration/configs.py       # target + fit-set choice
python <repo>/scripts/heard-as/calibration/calibrate.py     # fit, bootstrap, LOSO, LOTO, validation -> fit.json
python <repo>/scripts/heard-as/calibration/unsure.py        # unsure share model + split rule
python <repo>/scripts/heard-as/calibration/width.py         # trainee-direction table, naive coverage
python <repo>/scripts/heard-as/calibration/width_latent.py  # panel-noise-corrected per-voice coverage
python <repo>/scripts/heard-as/calibration/tenths.py
python <repo>/scripts/heard-as/calibration/final_checks.py  # coverage by side, display table
python <repo>/scripts/heard-as/calibration/sens.py          # sensitivity to the fit set
python <repo>/scripts/heard-as/calibration/hide_rules.py    # hide-rule effects
python <repo>/scripts/heard-as/calibration/make_json.py     # constants + test vectors
```

(`gate_replay.mjs` + `gate_check.py`: lab gate vs live utterance gate on the
measured items.) Needs numpy, pandas, scipy.

Any new constants go into `src/ml/heardAsCalibration.js` and the test vectors
into `tests/ml/fixtures/heard-as-test-vectors.json`; then regenerate the golden
file and update the measurement note.
