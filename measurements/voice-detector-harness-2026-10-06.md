# Voice-detector benchmark — shared harness and current-app baseline (2026-10-06)

Branch `voice-detector` @ 4404244 (main + the V19g hum filter + the real-noise
tooling). Phase 1 = measurement only: `src/` is unchanged. Tools and the
candidate interface: [scripts/voice-detector/](../scripts/voice-detector/README.md).
Problem statement: [realnoise-false-voicing-attribution-2026-10-05.md](realnoise-false-voicing-attribution-2026-10-05.md)
§1a; why display-side heuristics stalled: `pitch-hold-bridge-rework-2026-10-06.md`
on branch `gap-bridge-rework` (machine rooms pass CPP / periodicity evidence).
Public data only; no private recordings were used in this step.

## What was built

1. **Dumps of the current app** (`dump.mjs`): the real pitch worker, DSP worker
   and display hook over every stream of 11 sets (4 305 streams, 3.07 M hops),
   per 25 ms hop: painted value, reference F0 at the display alignment
   (t_k − 120 ms) and a label — CORRECT (within 5 % of a voiced reference),
   FALSE (noise-only audio, or no voiced reference within ±100 ms), WRONG,
   EDGE — plus speaker gender and the stream's audio spec (path, rate, sample
   range), so a candidate reads exactly the samples the app got, in place.
2. **Candidate interface + scorer** (`score.py`): a candidate writes one
   float32 probability per frame on a grid it states (`hop_ms`,
   `first_avail_ms`); the scorer gives hop k only the frames available by hop
   time + the declared `lookahead_ms`, applies the candidate's threshold and
   hangover, and scores the pre-registered bar V1–V4 (README "Viability
   bar", incl. the readings fixed before any candidate ran).
3. **Validation**: parity with the published base numbers, a contract
   self-test (`selftest.py`), a JS / Python loader cross-check (106 streams,
   identical samples), and the two trivial detectors below.

## Parity with the published base (`check.py`)

The branch's `src` equals the base of the hold-bridge rework (21d0117).

| metric | dumps | published |
|---|---|---|
| noise-only painted, clip mean: all 279 / tuning 194 / held-out 85 | 23.93 / 24.11 / 23.52 % | 23.93 / 24.11 / 23.52 % |
| … second held-out set 119 / dcaseeval / fsheld | 20.41 / 18.12 / 20.81 % | 20.41 / 18.12 / 20.81 % |
| voice in noise painted at pitch (8 %), 20 s lead, +10 / 0 dB | 82.124 / 54.997 % | 82.12 / 54.99 % (V14 base) |
| … held-out 135, 20 s lead, +10 / 0 dB | 82.280 / 56.468 % | 82.28 / 56.47 % |
| … lead 0, 0 dB, all 392 / held-out 135 | 54.336 / 55.571 % | 54.34 / 55.58 % |
| FDA / PTDB-TUG painted max(F_err, M_err) | 16.71 / 19.07 % | 16.71 / 19.07 % (V14 base) |

The tapped `realnoise-fv/attr.mjs` (with the V19g absolute-import fix to
`lib/tap-notch.mjs`, committed here) paints the same values hop for hop on
the three clips checked.

## Current app, per set (the counts every candidate is scored against)

| set | streams | hops | painted | CORRECT | FALSE | WRONG | EDGE | CORRECT f / m / unknown | voice onsets |
|---|---|---|---|---|---|---|---|---|---|
| noise (279) | 279 | 527 806 | 122 436 | 0 | 122 436 | 0 | 0 | — | 0 |
| noiseho (119) | 119 | 239 537 | 46 033 | 0 | 46 033 | 0 | 0 | — | 0 |
| vin20 +10 dB | 392 | 774 527 | 405 686 | 185 676 | 153 576 | 28 947 | 37 487 | 35 918 / 104 525 / 45 233 | 1 432 |
| vin20 0 dB | 392 | 774 527 | 360 142 | 120 641 | 149 075 | 60 340 | 30 086 | 21 906 / 67 220 / 31 515 | 1 543 |
| vin0 +10 dB | 392 | 460 927 | 318 670 | 185 246 | 66 437 | 29 451 | 37 536 | 35 860 / 104 420 / 44 966 | 1 386 |
| vin0 0 dB | 392 | 460 927 | 268 140 | 118 994 | 57 466 | 61 563 | 30 117 | 22 597 / 66 077 / 30 320 | 1 510 |
| FDA | 100 | 13 264 | 8 418 | 4 188 | 304 | 610 | 3 316 | 2 274 / 1 914 / 0 | 102 |
| PTDB-TUG | 180 | 48 667 | 14 735 | 8 089 | 763 | 838 | 5 045 | 4 304 / 3 785 / 0 | 213 |
| vocadito | 40 | 32 650 | 26 885 | 20 817 | 976 | 321 | 4 771 | 0 / 0 / 20 817 | 182 |
| Hillenbrand | 1 116 | 23 840 | 14 066 | 9 975 | 0 | 4 008 | 83 | 5 692 / 4 283 / 0 | 988 |
| VocalSet long tones | 399 | 174 444 | 97 805 | 88 109 | 4 987 | 1 526 | 3 183 | 17 130 / 70 979 / 0 | 465 |
| PVQD | 296 | 289 698 | 179 765 | 134 870 | 3 577 | 11 530 | 29 788 | 0 / 0 / 134 870 | 2 515 |
| VOICED | 208 | 39 485 | 35 667 | 33 426 | 279 | 1 542 | 420 | 21 503 / 11 923 / 0 | 218 |

- V2's denominators: 122 436 falsely painted hops on the 279 clips (tuning
  split 79 223, held-out split 43 213) and 46 033 on the second held-out set.
- The mixes' noise segments add 153 576 / 149 075 FALSE hops (20 s lead;
  86 475 / 87 040 of them in the noise-only lead) — reported, not scored.
- `notchvd-heldout2` holds voice only (Coswara sustained vowels), no noise.
- Gender is unknown for PVQD and vocadito; their rows are scored on the
  "unknown" group.

## Validation detectors

| row | `always` (p = 1) | `energy` (25 ms energy ≥ stream P20 + 6 dB, no hangover) |
|---|---|---|
| V1 worse-gender vetoed: FDA / PTDB / vocadito | 0 / 0 / 0 % | 12.38 / 1.97 / 15.17 % |
| … VocalSet / PVQD + VOICED / Hillenbrand | 0 / 0 / 0 % | 47.75 / 99.76 / 23.84 % |
| … voice in noise +10 / 0 dB, 20 s lead | 0 / 0 % | 19.82 / 68.58 % |
| … voice in noise +10 / 0 dB, lead 0 | 0 / 0 % | 28.44 / 82.45 % |
| V2 removed: 279 / held-out 85 / held-out 119 | 0 / 0 / 0 % | 75.82 / 75.96 / 78.00 % |
| … mains hum (279) / refrigerator / hvac | 0 / 0 / 0 % | 43.98 / 50.69 / 83.36 % |
| V3 latency / median onset delay (worse gender) | 0 ms / 0 ms | 25 ms / 0 ms (p90 2.1 s, female) |
| verdict | V1 pass, V2 fail (as required) | V1 fail, V2 pass, V3 pass |

`always` gives exactly 0 % vetoed and 0 % removed on every row and a 0 ms
onset delay, as it must. `energy` behaves as an energy gate should: it removes
most stationary noise, and it vetoes every voice that fills its stream
(sustained vowels: VOICED 99.8 %, where the stream's 20th percentile is the
voice itself) and quiet voice in loud noise. Neither is a candidate.

## Reproduction (repo root)

```bash
export NOTCHVD_ROOT=<checkout>/build/notchvd SYRINX_CORPORA_DIR=<checkout>/tests/dsp/data
bash scripts/voice-detector/run-dumps.sh               # 4 305 streams, ~35 min with 3 processes
python scripts/voice-detector/check.py                 # parity table
python scripts/voice-detector/selftest.py              # alignment / hangover / onset contracts
python scripts/voice-detector/baselines.py
python scripts/voice-detector/score.py always energy --json=build/vad/scores/baselines.json
```
