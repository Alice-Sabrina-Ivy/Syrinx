# Resonance-lab parity fixtures

Three 5-second, 16 kHz, 16-bit excerpts used by `tests/resonance-lab/parity-test.js`:

| file | source |
|---|---|
| `ls_woman_high.wav` | LibriSpeech test-clean `237-134500-0022` (highest-F0 woman utterance in the benchmark's r1_test set) |
| `ls_man_low.wav` | LibriSpeech test-clean `2830-3980-0047` (lowest-F0 man utterance) |
| `ls_man_hi8_f105.wav` | LibriSpeech test-clean `1089-134686-0000`, Praat "Change gender" +8 semitones, formant ratio 1.05 (benchmark `manip_test` item) |

LibriSpeech (Panayotov et al., 2015) is distributed under CC BY 4.0
(https://www.openslr.org/12). The excerpts are cropped, resampled where needed and
quantised to 16 bits; the manipulated clip is a derivative produced by the benchmark.

`<name>.expected.json` holds, for the same quantised audio, the harness F0 track, the
production-detector track (prodf0.mjs) and each finalist prototype's outputs. Regenerate
both with `build/resonance-lab/venv/Scripts/python scripts/resonance-lab/lab_fixtures.py`
(needs the benchmark built under `build/resonance-lab/`).
