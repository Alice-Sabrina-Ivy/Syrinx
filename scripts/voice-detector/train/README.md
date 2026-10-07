# Custom voice-vs-machine detector — training step (2026-10-06)

Step 2 of the custom detector. Pre-registration (fixed before any model was
trained):
[measurements/voice-detector-custom-preregistration-2026-10-06.md](../../../measurements/voice-detector-custom-preregistration-2026-10-06.md).
Data step: [../custom/](../custom/README.md). Evaluation: the unchanged
benchmark harness one directory up (`score.py`, candidate interface in
`../README.md`). Results and the selection table:
[measurements/voice-detector-custom-training-2026-10-06.md](../../../measurements/voice-detector-custom-training-2026-10-06.md).

Everything here reads only the TRAINING split for training and only the
pre-registered selection data (the val split of §2.2 + the benchmark's
194-clip tuning split) for choosing a model and its operating point. No
evaluation stream (V1 voice sets, mixes, held-out A / B) is read before the
model is frozen. Audio, packed data, checkpoints and ONNX files live under
`build/vad-train/` (gitignored); nothing of that is committed. The private
session recordings are not read by any script here.

| file | what |
|---|---|
| `tcommon.py` | paths, the model's frame grid (hop 12.5 ms, 32 ms window, availability), the pitch worker's streaming linear resampler (ported from `src/ml/audio-utils.js`, matches it to 1 ulp), the frame labels of §1.1 |
| `synth.py` | the synthetic interferers (13 families) and shoebox room impulse responses, seeded (train seeds `[0, 1e9)`, val seeds `[1e9, 1e9 + 2000)`) |
| `pack.py` | packs the manifest's train / val audio into int16 memmaps with label tracks, plus the synthetic and RIR banks |
| `valsets.py` | the validation streams of §3: clean val voice at native rate, val mixes (+10 / 0 dB, 20 s lead and lead 0), val negatives |
| `valdump.mjs`, `run-valdumps.sh` | the app's production chain over the validation streams (`dump.mjs` format and labels) |
| `model.py` | the causal model (DFT-conv log-mel front end, causal 2-D convolutions, GRU) and its streaming form |
| `train.py` | training with on-the-fly mixing and GPU augmentation |
| `infer.py` | writes candidate probability files (torch checkpoint or streaming ONNX), through the app's resampler |
| `opselect.py` | the pre-registered operating-point rule on the selection data |
| `export.py` | streaming ONNX export + parity against the batch model |
| `wasm_bench.mjs` | V4 CPU: onnxruntime-web WASM, 1 thread, Node and headless Chrome (temporary profile, killed by its own PID) |

```bash
VENV=build/vad-train/venv/Scripts/python.exe        # CUDA PyTorch venv (pip install torch --index-url https://download.pytorch.org/whl/cu128)
python scripts/voice-detector/train/pack.py
python scripts/voice-detector/train/valsets.py
bash scripts/voice-detector/train/run-valdumps.sh   # <= 3 node processes
(cd scripts/voice-detector/train && $VENV train.py --name=r1-base --steps=12000)
$VENV scripts/voice-detector/train/infer.py --ckpt=build/vad-train/train/runs/r1-base/ckpt_012000.pt --out=build/vad-train/cand/r1-base
$VENV scripts/voice-detector/train/infer.py --ckpt=... --out=build/vad-train/cand/r1-base --root=build/vad --sets=noise --split=tune
python scripts/voice-detector/train/opselect.py build/vad-train/cand/r1-base
```
