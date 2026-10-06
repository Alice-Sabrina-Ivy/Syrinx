# Real clips for tests/dsp/noise-notch-test.js (2026-10-05)

Written by `scripts/notch-adversarial/realdata/export_test_clips.mjs` from the
real-data corpora (`build/notchvd/`, see
`measurements/notch-realdata-corpora-2026-10-05.md`). 16 kHz mono PCM16, levels
as recorded.

| file | content | source | license |
|---|---|---|---|
| `ac114.wav` | 10 s (5-15 s) of an air conditioner: a stationary 114.6 Hz compressor line over broadband noise | MS-SNSD `noise_test/AirConditioner_10.wav` (Reddy et al., MS-SNSD, Interspeech 2019; Freesound clips selected by MS-SNSD), https://github.com/microsoft/MS-SNSD | CC0 |
| `vs_f2_262.wav` | three long tones of VocalSet singer female2 at ~262 Hz, 3.5 s each, back to back: forte /o/ (0.6 s in), straight /a/ (0.776 s in), straight /e/ (0.639 s in) | VocalSet `FULL/female2/long_tones/{forte,straight}/f2_long_*` (Wilkins, Seetharaman, Wahl, Pardo, ISMIR 2018), https://zenodo.org/records/1193957 | CC BY 4.0 |
| `vs_m1_128.wav` | three long tones of VocalSet singer male1 at ~128 Hz, 2.75 s each: straight /a/ (0.229 s in), /e/ (0.379 s in), /i/ (0.429 s in) | VocalSet `FULL/male1/long_tones/straight/m1_long_straight_*` | CC BY 4.0 |
| `pvqd_cresc.wav` | (2026-10-05 follow-up) the first 5.6 s of PVQD `Sj6001` and the first 5.25 s of PVQD `SJ2012`, back to back: sustained /a/ from the recording's start whose level rises 5-11 dB over its first 1-3 s (a natural onset crescendo) | Perceptual Voice Qualities Database (Walden, P. R., PVQD, Mendeley Data v4, doi 10.17632/9dz247gnyb.4) | CC BY 4.0 |

Excerpts are unmodified apart from cutting and 16-bit requantization (the
corpus copies are the first channel resampled to 16 kHz).
