# CSTR FDA evaluation database

Pitch-detector evaluation database from the Centre for Speech Technology
Research, University of Edinburgh (Bagshaw 1994). Used by
`tests/dsp/fda-test.js` to evaluate pitch detection on connected English
speech with **laryngograph-derived ground truth**, with particular
coverage of sub-90-Hz fundamentals on the male speaker — the regime
Hillenbrand and Vocadito don't fully cover.

## What's in the corpus

- Speaker **RL** (male, English): 50 connected-speech sentences. F0
  range observed across all sentences: min 60 Hz, p1 68 Hz, p5 88 Hz,
  median 121 Hz, p95 171 Hz, max 220 Hz (from the literature audit at
  `measurements/voicing-decision-literature-review-2026-05-06.md`
  followups).
- Speaker **SB** (female, English): 50 connected-speech sentences. F0
  range: min 120 Hz, median 253 Hz, p95 313 Hz, p99 339 Hz, max 400 Hz.

Format (per upstream README):

| File | Content |
|---|---|
| `*.sig` | Speech waveform, 20 kHz, 16-bit, mono, **headerless**, big-endian (SUN byte order). |
| `*.fx`  | F0 contour in XMG format. ASCII header up to a `0x0c` (form feed) byte, then `time_ms F0_Hz` pairs space-separated, with `=` lines marking voicing breaks. F0 timestamps are at glottal-pulse boundaries (pitchmarks), so spacing is irregular (~1/F0 within voiced segments). |
| `*.lar` | Laryngograph waveform (raw). Not used by Syrinx tests — we already have F0 derived from these. |

## Re-fetching

The audio is gitignored (~17 MB compressed, ~27 MB extracted). To
populate:

```bash
bash scripts/fetch-fda-subset.sh
```

That script `curl`s the archive directly from
`https://www.cstr.ed.ac.uk/research/projects/fda/fda_eval.tar.gz`
and extracts only the `.sig` + `.fx` files we need into
`tests/dsp/data/fda/{rl,sb}/`.

## License — why fetch-on-demand and not in-repo commit

The corpus README has no explicit license header. CSTR Edinburgh has
freely distributed the archive for 30+ years for the express purpose
of evaluating pitch-determination algorithms (Bagshaw's PhD work).
The fetch-on-demand pattern keeps Syrinx clear of redistribution
liability — users download directly from the original CSTR URL rather
than from a Syrinx-hosted mirror. If you are integrating FDA into a
published work, contact CSTR Edinburgh for any required license
clarification beyond the implicit free-distribution-for-evaluation
the corpus has carried since 1994.

## Citation

> P.C. Bagshaw, "Automatic prosodic analysis for computer aided
> pronunciation teaching", PhD thesis, University of Edinburgh, 1994.

Also relevant context paper:

> P.C. Bagshaw, S.M. Hiller, M.A. Jack, "Enhanced pitch tracking and
> the processing of F0 contours for computer aided intonation
> teaching", *Eurospeech 1993*.

## Why this corpus

The Stage A audit at
`measurements/voicing-decision-literature-review-2026-05-06.md`
identified that Hillenbrand has zero F0 coverage below 90 Hz — the
regime where production has been observed to produce octave errors
(3×–5× harmonic spikes on sustained 80 Hz monotone). FDA is the
single best speech-domain corpus for that gap: gold-standard
laryngograph ground truth, connected speech rather than sustained
vowels (better realism than singing), and concrete sub-90-Hz coverage
(RL p5 = 88 Hz, p1 = 68 Hz).
