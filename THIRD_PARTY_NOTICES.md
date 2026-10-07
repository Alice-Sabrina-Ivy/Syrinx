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
| ONNX Runtime Web (bundled by Transformers.js) | MIT | https://github.com/microsoft/onnxruntime |

Build-time tools (Vite, Tailwind CSS, ESLint and plugins) are MIT-licensed and
are not shipped in the built app.

## Models

- **Perceived voice model.** A re-quantised ONNX export of
  [JaesungHuh/voice-gender-classifier](https://github.com/JaesungHuh/voice-gender-classifier)
  (MIT), fetched at runtime from Hugging Face
  (`Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2`).
- **Speech detector for the Perceived Voice meter.**
  [Silero VAD](https://github.com/snakers4/silero-vad) v6.2.3
  (`src/silero_vad/data/silero_vad.onnx` at tag v6.2.3, commit 5cd7945,
  2,327,524 bytes, sha256
  `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`) — MIT,
  Copyright (c) 2020-present Silero Team. The unmodified file is fetched at
  runtime from the GitHub tag through jsDelivr
  (`https://cdn.jsdelivr.net/gh/snakers4/silero-vad@v6.2.3/src/silero_vad/data/silero_vad.onnx`)
  and checked against that sha256 before use (`src/ml/speech-detector.js`).
  A byte-identical mirror on the project's Hugging Face account
  (`Alice-Sabrina-Ivy/silero-vad-v6.2.3-onnx`, with Silero's LICENSE and a
  model card that credits the upstream project) is planned and not yet
  published.
- **Resonance lab models** (`public/resonance-lab/`: `vtln_warp.json`,
  `le_ens_h64.json`, `pnml_head.json`, `fv_model.json`) were trained or fitted
  on LibriSpeech dev-clean, and the reference bands in `reference.json` come
  from LibriSpeech test-clean. LibriSpeech: V. Panayotov, G. Chen, D. Povey,
  S. Khudanpur, "LibriSpeech: an ASR corpus based on public domain audio
  books", ICASSP 2015 — CC BY 4.0, https://www.openslr.org/12.
- **SwiftF0** (`tests/dsp/data/swift-f0/model.onnx`, used only by legacy test
  harnesses) — MIT, https://github.com/lars76/swift-f0.

## Data in this repository (tests only, not shipped)

| Data | Licence | Notes |
|---|---|---|
| Hillenbrand et al. (1995) vowels (`tests/dsp/data/men`, `women`, `vowdata.dat`) | Public domain | J. Hillenbrand, L. Getty, M. Clark, K. Wheeler, "Acoustic characteristics of American English vowels", JASA 97(5), 1995 |
| vocadito (`tests/dsp/data/vocadito`) | CC BY 4.0 | R. Bittner et al., vocadito — a dataset of solo vocals with f0, note and lyric annotations |
| LibriSpeech excerpts (`tests/resonance-lab/fixtures`) | CC BY 4.0 | See the fixtures README for item IDs and manipulations |
| Real-noise and long-tone clips (`tests/dsp/data/notch-real`) | CC0 (MS-SNSD) / CC BY 4.0 (VocalSet, PVQD) | Sources and attributions in `tests/dsp/data/notch-real/README.md` |

PTDB-TUG (ODbL / DbCL) and the CSTR FDA corpus are fetched on demand for local
testing and are not committed; see `tests/dsp/data/README.md`.
