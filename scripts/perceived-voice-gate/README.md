# Perceived Voice gate measurement

Reproduces `measurements/perceived-voice-gate-2026-10-07.md`: the Perceived
Voice meter's utterance gate (`src/ml/utterance-gate.js`) and display rules
(`src/components/perceivedVoiceView.js`) against the retired 2026-07-19
chain, through the real pitch worker, DSP worker and hook. Public data
only. Every output goes to the gitignored `build/perceived-voice-gate/`
(override with `SYRINX_PVG_OUT`).

| step | script | output |
|---|---|---|
| 1. sets | `prep.py <set>…` | `sets/<set>/*.f32` (16 kHz float32), `sets/jobs_<set>.json` (the measured subset), `sets/meta_<set>.json` |
| 2. chain | `chain.mjs <set>` (with `--import ./scripts/session-oracle/lib/register.mjs`) | `runs/vad_<set>.<i>.jsonl`: per-chunk posted pitch + capture time, DSP gate, painted trace; the retired gate's codes per 150 ms tick |
| 3. classifier | `score.py <set> <i/n>` | `runs/sc_<set>.<i>.jsonl`: logits of the deployed ONNX for every window the retired gate scored |
| 4. gate replay | `replay.mjs --set=<set> [--variant=<name>] [--gate='{…}'] [--fresh=<ms>] [--clock=audio\|post]` | `replay/<set>.<variant>.jsonl`: verdicts, posted scores, the number / state on screen per 25 ms |
| 5. metrics | `analyze.py <variant\|before> noise chan onset dyn held adv`, `analyze.py x sweep --variants=a,b,…` | tables on stdout, CSVs in `results/` |

Sets: `chan` (LibriSpeech × 9 channel conditions), `noise` (100 public noise
clips), `voiced`, `vocalset`, `pvqd` (held phonation + PVQD speech), `dyn`
(speaker changes), `ls` / `pv` (natural, F0-flattened and slowed speech), `vo`
(vocadito singing). `ls`, `pv`, `vo` have no step 3: their replay is
verdict-only.

Inputs (never private recordings):

- `$SYRINX_RLAB_BUILD` (default `build/resonance-lab`): the resonance lab's
  LibriSpeech benchmark — `bench/manifests/{r1_test,manip_test}.parquet`
  with Praat F0 tracks (`scripts/resonance-lab/build_bench.py`). Manifest
  paths that name another checkout are remapped.
- `$NOTCHVD_ROOT` (default `build/notchvd`): the notch real-data corpora —
  `data/index_noise.json`, `data/index_voice.json`
  (`scripts/notch-adversarial/realdata/fetch_noise.py`, `fetch_voice.py`,
  `build_index.py`). Only Freesound / DCASE / MS-SNSD / DEMAND / ESC-50
  noise and VOICED / VocalSet / PVQD / vocadito voice records are read.
- PVQD speaker sex: the database's `Demographics.xlsx`
  (`--pvqd-demographics=<path>` or `$SYRINX_PVQD_DEMOGRAPHICS`), for `pvqd`
  and `pv`.
- The classifier: `$SYRINX_GENDER_ONNX`, default the Transformers.js cache
  `node_modules/@huggingface/transformers/.cache/Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2/onnx/model_quantized.onnx`
  (present once the model has run in Node, e.g.
  `node tests/ml/perceived-voice-hillenbrand-test.js`).

Python needs numpy, pandas, scipy, onnxruntime, praat-parselmouth (and
openpyxl for the PVQD spreadsheet), plus `scripts/resonance-lab/rlab`.

```bash
S=scripts/perceived-voice-gate
for s in chan noise voiced vocalset pvqd dyn; do python $S/prep.py $s --pvqd-demographics=<Demographics.xlsx>; done
for s in ls pv vo; do python $S/prep.py $s --pvqd-demographics=<Demographics.xlsx>; done   # ls needs chan first
for s in chan noise voiced vocalset pvqd dyn ls pv vo; do
  node --import ./scripts/session-oracle/lib/register.mjs $S/chain.mjs $s
done
for s in chan noise voiced vocalset pvqd dyn; do python $S/score.py $s 0/2 & python $S/score.py $s 1/2; wait; done
for s in chan noise voiced vocalset pvqd dyn ls pv vo; do node $S/replay.mjs --set=$s --variant=shipped; done
python $S/analyze.py before noise chan onset dyn held
python $S/analyze.py shipped noise chan onset dyn held adv
```

Parameter variants: replay `chan` and `noise` with e.g.
`--variant=run200 --gate='{"onsetRunMs":200}'` or `--variant=fresh1500
--fresh=1500`, then `python $S/analyze.py x sweep --variants=shipped,run200,…`.
The first version of the gate: `--clock=post
--gate='{"sustainMinShare":0.9,"maxHopMs":60}'`.

Each `prep.py` set is built in its own run with fixed random seeds, so a
rebuild is reproducible. The streams behind the 2026-10-07 figures were
built before these scripts were committed, with the seeded generator
shared across sets: a rebuild gives identical speech / noise samples but
different −70 dBFS floor noise and noise draws (checked on `voiced`), so
figures can move by a few tenths. `chain.mjs` reproduces those runs
bit-exactly from the same streams (checked on `chan`), and its `ctx`
column confirms the replay's audio-clock offset (frame k − 2's capture
time = chunk k's − 50 ms). `chain.mjs` takes `--src=<tree>` to measure
another commit (`git archive <rev> src | tar -x -C build/trees/<name>`).
