# PTDB-TUG corpus subset

Pitch tracking database from Graz University of Technology
(Pirker, Wohlmayr, Petrik, Pernkopf — Interspeech 2011).

This directory holds a **subset** of the PTDB-TUG corpus used by
`tests/dsp/ptdb-tug-test.js` to evaluate Stage 2.B pYIN against the
laryngograph-derived ground-truth F0 contours on real-world
recordings (microphone-captured, environmental noise, natural prosody).

## What's in the subset

- 2 female speakers (F01, F02) and 2 male speakers (M01, M02)
- 45 SX (TIMIT-derived, phonetically balanced) sentences per speaker
- Total ~180 audio files + 180 F0 reference files (~200 MB)

Path layout matches the upstream archive:

```
tests/dsp/data/ptdb-tug/
├── FEMALE/
│   ├── MIC/F01/mic_F01_sx*.wav  (48 kHz audio)
│   ├── MIC/F02/...
│   └── REF/F01/ref_F01_sx*.f0   (10 ms hop F0 + voicing)
└── MALE/
    └── ...
```

## REF .f0 format

Four whitespace-separated columns per line, one line per 10 ms frame:

| col | meaning |
|----:|---------|
| 1 | Smoothed F0 estimate (Hz). 0 when unvoiced. **This is the ground truth used by `ptdb-tug-test.js`.** |
| 2 | Voicing flag (0 / 1). |
| 3 | Alternative pitch estimate (unused here). |
| 4 | Confidence / probability (unused here). |

## Re-fetching

The audio is gitignored (see `.gitignore`). To re-populate:

```bash
bash scripts/fetch-ptdb-tug-subset.sh
```

That script `curl`s the SX subset from
`http://www2.spsc.tugraz.at/databases/PTDB-TUG/SPEECH%20DATA/`. Speakers
and sentence range are controlled at the top of the script.

If you want the full corpus (3.9 GB compressed, 10 speakers per gender,
~691 sentences each including SI and SA), the upstream archive is at the
same base URL: `SPEECH_DATA_ZIPPED.zip`.

## License

PTDB-TUG is released under the Open Database License + Database Contents
License (Open Data Commons). Citation when used in publications:

> G. Pirker, M. Wohlmayr, S. Petrik, F. Pernkopf,
> "A Pitch Tracking Corpus with Evaluation on Multipitch Tracking Scenario",
> *Interspeech 2011*.

## Why a subset

The full corpus is overkill for our use: we want a real-world regression
signal, not exhaustive coverage. 4 speakers × 45 SX sentences gives
~10,000 voiced REF frames per gender per stage cell — well-powered for
detecting F0 mean differences of a few Hz. Statistical noise on per-frame
errors at this sample size is small enough that the Stage 2 vs Stage 0
comparison is decisive without paying the full 3.9 GB download cost.
