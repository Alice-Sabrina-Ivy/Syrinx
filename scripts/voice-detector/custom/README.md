# Custom voice-vs-machine detector — training data (2026-10-06)

Phase "custom model" of the voice-detector work. Pre-registration (fixed
before any model is trained):
[measurements/voice-detector-custom-preregistration-2026-10-06.md](../../../measurements/voice-detector-custom-preregistration-2026-10-06.md).
Evaluation is the unchanged benchmark harness one directory up (`score.py`, the
candidate interface in `../README.md`).

| file | what |
|---|---|
| `splits.json` | the pre-registered sources, licence rules, exclusions, de-duplication rules and train / val splits (rules plus the exact lists they produce) |
| `fetch_archives.py` | downloads the whole archives (FSD50K, Coswara date folders, LibriSpeech dev / test, MDVR-KCL, ESMUC, Cantoría, Choral Singing Dataset) into `build/vad-train/dl/`; resumable, size / md5 checked, at most 3 transfers |
| `fetch_fstrain.py` | the `fstrain` Freesound previews (machine / room queries; CC0 / CC BY only; benchmark ids and uploaders skipped) |
| `prepare.py` | extracts and converts every used file to 16 kHz mono (PCM16 WAV) under `build/vad-train/data/`, range-reads the VCTK and Dagstuhl ChoirSet members it needs, computes the Praat AC labels, applies the exclusion rules and writes `build/vad-train/data/manifest[.<part>].jsonl` |
| `dedup.py` | audio checks of the negatives: Haitsma-Kalker fingerprint against every benchmark noise clip (candidates from 16-bit half-word hits; match = BER <= 0.35 over an aligned 3 s block), Silero speech screen, and the matched-uploader rule (pre-registration addendum A); `--selftest` re-checks the FSD50K clips dropped by id |
| `summarize.py` | per source x split counts and drop reasons of the manifest (the addendum's tables) |
| `common.py` | paths, FNV-1a, the keyword rule, benchmark id / uploader lists, 16 kHz conversion, the multi-file manifest (`manifest*.jsonl`, latest record per id wins) |

Data root: `build/vad-train/` (gitignored; `VAD_TRAIN_ROOT` overrides). No
audio and no weights are committed. The benchmark's noise clips are read in
place (`NOTCHVD_ROOT`, `NOTCHVD_HELDOUT_ROOT`) only to fingerprint them for
de-duplication. The private session recordings are not read by any script
here.

```bash
python scripts/voice-detector/custom/fetch_archives.py --jobs=3
NOTCHVD_ROOT=<checkout>/build/notchvd python scripts/voice-detector/custom/fetch_fstrain.py
python scripts/voice-detector/custom/prepare.py --jobs=3          # concurrent runs: --sources=... --part=<name>
NOTCHVD_ROOT=<checkout>/build/notchvd python scripts/voice-detector/custom/dedup.py      # then again with --selftest
python scripts/voice-detector/custom/summarize.py
```
