# Vocadito — license + attribution

This subdirectory contains the **vocadito** dataset (40 short solo singing
excerpts with frame-level F0 annotations) integrated into Syrinx as a
pitch-detector regression test fixture.

## License

vocadito is distributed under [Creative Commons Attribution 4.0
International (CC-BY-4.0)](https://creativecommons.org/licenses/by/4.0/),
which permits redistribution provided attribution is given and modifications
are indicated. No modifications have been made to the audio or annotation
files redistributed here; see "What's included" below for the file subset.

## Attribution

Bittner, R., Pasalo, K., Bosch, J. J., Meseguer Brocal, G., & Rubinstein, D.
(2021). *vocadito: A dataset of solo vocals with f0, note, and lyric
Annotations.* Zenodo. https://doi.org/10.5281/zenodo.5578807

```bibtex
@dataset{bittner2021vocadito,
  title  = {vocadito: A dataset of solo vocals with f0, note, and lyric Annotations},
  author = {Bittner, Rachel and Pasalo, Katherine and Bosch, Juan Jos\'e and
            Meseguer Brocal, Gabriel and Rubinstein, David},
  year   = {2021},
  month  = oct,
  doi    = {10.5281/zenodo.5578807},
  url    = {https://zenodo.org/records/5578807}
}
```

Companion technical report: https://arxiv.org/abs/2110.05580

## What's included

A subset of the upstream archive needed for pitch-detection evaluation.
Lyrics and note annotations are NOT redistributed — only audio + F0
ground truth.

```
tests/dsp/data/vocadito/
├── Audio/                      40× WAV (16-bit mono 44.1 kHz, ~69 MB total)
│   └── vocadito_{1..40}.wav
├── Annotations/
│   ├── F0/                     40× frame-level F0 CSV at 5.8 ms hop
│   │   └── vocadito_{1..40}_f0.csv   (col1=time_sec, col2=f0_Hz, 0=unvoiced)
│   └── README.txt              upstream README (annotations format)
├── vocadito_metadata.csv       track_id, singer_id, average_pitch (MIDI), language
└── LICENSE.md                  this file
```

## What's NOT included

The upstream archive also contains lyric transcriptions and per-note
annotations. Those aren't relevant to pitch-detector evaluation and are
omitted to keep this commit lean. The full corpus (including lyrics and
note annotations) is available from the upstream Zenodo record.

## Why this corpus

vocadito covers pitch ranges that the existing Hillenbrand corpus misses:
- Sub-90 Hz: 14 of 40 tracks contain frames in the 69–90 Hz range
- Above 280 Hz: 11 of 40 tracks have p95 above 348 Hz, max 474 Hz
- Frame-level F0 expert-labeled by trained musicians via two-annotator
  consensus (gold-standard ground truth, methodologically equivalent to
  PTDB-TUG's laryngograph)
- 29 unique singers across 7 languages (English, Spanish, Tagalog,
  Catalan, French, Mandarin, Hawaiian)

It's solo singing rather than connected speech, so it complements rather
than replaces Hillenbrand (sustained vowels) and PTDB-TUG (connected
speech). Used by `tests/dsp/vocadito-test.js`.
