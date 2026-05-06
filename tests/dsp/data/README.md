# Pitch-detector evaluation corpora

This directory holds the corpora used by `npm run test:dsp` and individual
DSP test scripts. Each corpus has a different coverage profile; the test
suite uses them complementarily, not redundantly.

## Inventory

| Corpus | Files | Format | F0 ground truth | Pitch coverage | License | In-repo? |
|---|---|---|---|---|---|---|
| **Hillenbrand** | `vowdata.dat` + `men/` + `women/` | 16 kHz WAV; `vowdata.dat` truth file at steady-state | Single F0 per file (steady-state) | 90–330 Hz, **zero below 90 Hz** | Public domain | Yes (~19 MB) |
| **PTDB-TUG** | `ptdb-tug/` | 48 kHz WAV; `.f0` reference at 10 ms hop | Laryngograph-derived (gold standard) at 10 ms hop | Connected speech, 80–450 Hz across normal adults | ODC-BY (Open Database License + Database Contents License) | **Audio gitignored — fetch on demand** |
| **vocadito** | `vocadito/` | 44.1 kHz WAV; F0 CSV at 5.8 ms hop | Expert-labeled (trained musicians, two-annotator consensus) at 5.8 ms hop | 69–474 Hz, 14 tracks with frames < 90 Hz, 11 tracks with p95 > 348 Hz | CC-BY 4.0 | Yes (~73 MB) |

## Running the corpus tests

```bash
npm run test:dsp
```

This runs Hillenbrand → PTDB-TUG → vocadito in sequence. Each script
exits 0 with a `SKIP:` message if its corpus is missing, so the
top-level command works even when a fetch-on-demand corpus hasn't
been populated.

Individual tests can also be run directly:

```bash
node tests/dsp/real-speech-test.js   # Hillenbrand multi-frame
node tests/dsp/ptdb-tug-test.js      # PTDB-TUG, real-world connected speech
node tests/dsp/vocadito-test.js      # vocadito, low/high pitch coverage
```

## Fetch-on-demand corpora

PTDB-TUG audio is gitignored (~140 MB for the SX subset, ~3.9 GB for the
full upstream archive) — the corpus' license profile + size make in-repo
commit unsuitable. To populate:

```bash
bash scripts/fetch-ptdb-tug-subset.sh
```

The script downloads 4 speakers × 45 SX sentences from
`http://www2.spsc.tugraz.at/databases/PTDB-TUG/SPEECH%20DATA/` and
extracts to `tests/dsp/data/ptdb-tug/{FEMALE,MALE}/{MIC,REF}/`. See
`tests/dsp/data/ptdb-tug/README.md` for the subset rationale and full
fetch details.

## When to add a new corpus here

The eligible-corpus criteria (per
`measurements/voicing-decision-literature-review-2026-05-06.md` ↑
followups):

1. License must allow redistribution OR fetch-on-demand from the
   original source — CC-BY, CC0, MIT, Apache, ODC-BY, public domain
   acceptable; CC-NC and "research only" are not.
2. F0 ground truth must be gold-standard (laryngograph or
   expert-labeled) for primary tuning use. Algorithm-derived F0
   (Praat/REAPER) is acceptable for speaker-diversity sanity checks
   but not for tuning oracles.
3. The corpus closes a coverage gap that the existing inventory
   doesn't address. Coverage gaps to track: sub-90 Hz (vocal fry,
   bass voice, trans-masc), > 280 Hz sustained (high feminine,
   pre-pubescent, trans-fem), connected speech with prosodic motion.

## Why a per-corpus test instead of one harness

Each corpus has its own reference format (`vowdata.dat` single-F0
text, PTDB-TUG `.f0` 4-column 10-ms-hop, vocadito 2-column 5.8-ms-hop
CSV) and a slightly different evaluation methodology (single-window
steady-state vs frame-by-frame contour matching). The per-corpus
tests own the format-specific parsing; a parameterized harness on
top can pull frame-level results from each into a unified
per-pitch-bucket view (planned).
