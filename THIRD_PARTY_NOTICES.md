# Third-party notices

Syrinx's own code and documentation are released under the MIT License (see
[LICENSE](LICENSE)). The third-party libraries, models and data below keep
their own licences; the MIT License does not apply to them.

## Libraries shipped in the app

| Component | Licence | Source |
|---|---|---|
| React, React DOM | MIT | https://github.com/facebook/react |
| Dexie.js | Apache-2.0 | https://github.com/dexie/Dexie.js |
| Transformers.js (`@huggingface/transformers`) | Apache-2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime Web 1.26.0-dev.20260416-b7804b056c (`onnxruntime-web`): the JavaScript bundled with Transformers.js, plus its WebAssembly runtime files shipped with the app since 2026-10-07 (`ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, and `ort-wasm-simd-threaded.{mjs,wasm}` for Safari, copied unmodified from the npm package into the build's `assets/`) | MIT — Copyright (c) Microsoft Corporation. The WebAssembly binaries also contain third-party components that ONNX Runtime lists in its [ThirdPartyNotices.txt](https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt) | https://github.com/microsoft/onnxruntime |

Build-time tools (Vite, Tailwind CSS, ESLint and plugins) are MIT-licensed and
are not shipped in the built app.

## Models

- **Voice classifier** (used by the opt-in "Likely heard as" panel and the resonance lab). A re-quantised ONNX export of
  [JaesungHuh/voice-gender-classifier](https://github.com/JaesungHuh/voice-gender-classifier)
  (MIT), fetched at runtime from Hugging Face
  (`Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2`).
- **Speech detector for the Perceived Voice meter.**
  [Silero VAD](https://github.com/snakers4/silero-vad) v6.2.3
  (`src/silero_vad/data/silero_vad.onnx` at tag v6.2.3, commit 5cd7945,
  2,327,524 bytes, sha256
  `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`) — MIT,
  Copyright (c) 2020-present Silero Team. The unmodified file is fetched at
  runtime from a byte-identical mirror on the project's Hugging Face
  account (`Alice-Sabrina-Ivy/silero-vad-v6.2.3-onnx`, commit
  `6c8942f41b1e6a85ef5b092537f0db565f099c49`, with Silero's LICENSE and a
  model card that credits the upstream project), checked against that
  sha256 before use, and kept in the browser's Cache Storage
  (`src/ml/speech-detector.js`).
- **Resonance lab models** (`public/resonance-lab/`: `vtln_warp.json`,
  `le_ens_h64.json`, `pnml_head.json`, `fv_model.json`) were trained or fitted
  on LibriSpeech dev-clean, and the reference bands in `reference.json` come
  from LibriSpeech test-clean. LibriSpeech: V. Panayotov, G. Chen, D. Povey,
  S. Khudanpur, "LibriSpeech: an ASR corpus based on public domain audio
  books", ICASSP 2015 — CC BY 4.0, https://www.openslr.org/12.
- **Resonance cue** (Dashboard): the same `vtln_warp.json` and
  `reference.json` as the resonance lab, plus `cue-bands.json` (bands of
  single 5 s readings of the same LibriSpeech test-clean readers) —
  LibriSpeech, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/);
  numbers derived from it (modified).
- **"Likely heard as" estimate** (experimental, opt-in;
  `src/ml/heardAsCalibration.js`). Only fitted numbers ship — no audio and no
  per-stimulus tables: the shipped constants are derived from (modified
  from) the data below. Licence texts: CC BY 4.0
  https://creativecommons.org/licenses/by/4.0/, CC0 1.0
  https://creativecommons.org/publicdomain/zero/1.0/. The constants were
  fitted on:
  - Palette of Voices — B. Munson & D. Dolquist (2025), "The Perception of
    (Trans)masculinity in Speech: Effects of Acoustic Characteristics and
    Rater Identity", *JSLHR*, doi:10.1044/2025_JSLHR-24-00756; OSF n3twm —
    CC BY 4.0.
  - L. Meyer, L. Rachman, G. Araiza-Illan, E. Gaudrain & D. Başkent (2023),
    *PLOS ONE* 18:e0294328, doi:10.1371/journal.pone.0294328 — per-cell values
    digitised from Fig. 6B (CC BY 4.0); data doi:10.34894/IAGXVF (CC0 1.0).
  - V. G. Skuk, L. Kirchen, T. Oberhoffner, O. Guntinas-Lichius, C. Dobel &
    S. R. Schweinberger (2020), *JSLHR* 63(9):3155–3175,
    doi:10.1044/2020_JSLHR-20-00026; OSF f85tj — CC BY 4.0.
  - J. M. Hillenbrand & M. J. Clark (2009), "The role of f0 and formant
    frequencies in distinguishing the voices of men and women", *Attention,
    Perception, & Psychophysics* 71(5):1150–1166, doi:10.3758/APP.71.5.1150 —
    published condition rates, used as facts (stimuli rebuilt locally from the
    Hillenbrand et al. 1995 recordings and LibriSpeech; not redistributed).
  - S. Mohsenin & K. P. Munz (2024), "Gender-Ambiguous Voices and Social
    Disfluency", *Psychological Science*, doi:10.1177/09567976241238222;
    ResearchBox 695 / Zenodo doi:10.5281/zenodo.15038471 — listener data
    CC BY 4.0. The stimuli are vendor text-to-speech audio, which that
    licence does not cover: they were measured locally only, never
    redistributed, and only numbers derived from them ship (dropping this
    source moves the estimate by at most 0.12 logit).
  - LibriSpeech (above), CC BY 4.0, as the base audio of rebuilt stimuli.

  Sources used for validation only (no constant depends on them) are cited in
  `measurements/heard-as-calibration-2026-10-07.md`.
- **SwiftF0** (`tests/dsp/data/swift-f0/model.onnx`, used only by legacy test
  harnesses) — MIT, https://github.com/lars76/swift-f0.

## Data in this repository (tests only, not shipped)

| Data | Licence | Notes |
|---|---|---|
| Hillenbrand et al. (1995) vowels (`tests/dsp/data/men`, `women`, `vowdata.dat`) | Public domain | J. Hillenbrand, L. Getty, M. Clark, K. Wheeler, "Acoustic characteristics of American English vowels", JASA 97(5), 1995 |
| vocadito (`tests/dsp/data/vocadito`) | CC BY 4.0 | R. Bittner et al., vocadito — a dataset of solo vocals with f0, note and lyric annotations |
| LibriSpeech excerpts (`tests/resonance-lab/fixtures`) | CC BY 4.0 | See the fixtures README for item IDs and manipulations |
| "Likely heard as" golden file and test vectors (`tests/ml/fixtures/heard-as-*.json`) | CC BY 4.0 (derived from the LibriSpeech fixtures above) | Classifier logits and posted pitch of the three fixtures; calibration test vectors (numbers only) |
| Real-noise and long-tone clips (`tests/dsp/data/notch-real`) | CC0 (MS-SNSD) / CC BY 4.0 (VocalSet, PVQD) | Sources and attributions in `tests/dsp/data/notch-real/README.md` |

PTDB-TUG (ODbL / DbCL) and the CSTR FDA corpus are fetched on demand for local
testing and are not committed; see `tests/dsp/data/README.md`.
