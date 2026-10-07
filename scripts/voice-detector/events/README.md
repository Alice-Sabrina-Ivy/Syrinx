# Audio-event candidate: YAMNet (voice-detector benchmark, 2026-10-06)

Phase 1, measurement only (`src/` untouched). Candidate: an audio-event
classifier that tells human voice (speech / singing / humming) from machine
sound, as a display gate. YAMNet, voice probability = sum of the human-vocal
class scores. Scored with the shared harness ([../README.md](../README.md),
`score.py`) against the pre-registered bar V1–V4.

## Provenance

| item | value |
|---|---|
| model | YAMNet, TensorFlow Model Garden `research/audioset/yamnet` (Keras code `yamnet.py`, `params.py`, `features.py` from `tensorflow/models` master, fetched 2026-10-06) |
| weights | <https://storage.googleapis.com/audioset/yamnet.h5> (the README's official link), 15 296 092 bytes, sha256 `13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744` |
| class map | `yamnet_class_map.csv` (same directory upstream), sha256 `cdf24d19…cdb040` |
| licence | Apache-2.0: `tensorflow/models` `LICENSE` (covers `/research`; body identical to the canonical Apache 2.0 text, no additions; sha256 `5b17814b…b52385`); every YAMNet instance on Kaggle (`google/yamnet`: TF2, TFLite, TF.js, Coral) is listed as "Apache 2.0". Class names come from the AudioSet ontology (CC BY-SA 4.0) — only indices are needed at run time |
| deployable file | `yamnet_core_pw8d16.onnx`, 4 468 011 bytes: pointwise convs int8 (per-channel, weight-only, DequantizeLinear → float Conv), dense fp16, the rest fp32; sha256 `a13ed084…8298e` |

Nothing under `build/` is committed (weights, ONNX files, scores, candidate
directories).

## Files

| file | what |
|---|---|
| `convert_onnx.py` | official Keras model + `yamnet.h5` → hand-built ONNX of the core network (log-mel patches → 521 scores, BN folded, TF `same` = ONNX `SAME_UPPER`), four weight formats; parity vs the official pipeline |
| `yamnet_lib.py` | log-mel front end (exactly `features.py`), causal framing with 95 rows of silence history, the human-vocal class list |
| `run_yamnet.py` | onnxruntime CPU over every benchmark stream → per-frame class scores on a 20 ms grid |
| `sweep.py` | threshold × hangover sweep with the harness's own alignment / hangover / onset code; applies the pre-registered selection rule; trade-offs |
| `write_cand.py` | scores → `build/vad/cand/<name>/` (candidate.json incl. the V4 block, `.f32` files) |
| `wasm_bench.mjs` | V4 CPU: JS log-mel + onnxruntime-web WASM (1 thread) streaming in Node or headless Chrome (own temp profile, PID-scoped cleanup) |
| `wasm_parity.py` | WASM voice probabilities vs the `run_yamnet.py` reference |

## Reproduce

```bash
M=build/vad/events/model; mkdir -p $M
curl -L -o $M/yamnet.h5 https://storage.googleapis.com/audioset/yamnet.h5
for f in yamnet.py params.py features.py yamnet_class_map.csv; do
  curl -L -o $M/$f https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/$f; done
curl -L -o $M/LICENSE https://raw.githubusercontent.com/tensorflow/models/master/LICENSE
# scratch venv (Python 3.12): tensorflow-cpu tf-keras h5py onnx onnxruntime scipy soundfile
<venv>/python scripts/voice-detector/events/convert_onnx.py $M $M
python scripts/voice-detector/events/run_yamnet.py --model=$M/yamnet_core_pw8d16.onnx --tag=pw8d16      # ~40 min, 8 threads
python scripts/voice-detector/events/run_yamnet.py --model=$M/yamnet_core_fp32.onnx --tag=fp32          # quantization reference
python scripts/voice-detector/events/run_yamnet.py --model=$M/yamnet_core_pw8d16.onnx --tag=pw8d16_r8 --real=8
node scripts/voice-detector/events/wasm_bench.mjs --ort=<checkout with node_modules> --per-set=2 --hops=12,14,16,24 --json=build/vad/events/wasm_node.json --dump-probs=...
node scripts/voice-detector/events/wasm_bench.mjs --ort=<checkout> --mode=chrome ... --json=build/vad/events/wasm_chrome.json
python scripts/voice-detector/events/sweep.py --scores=build/vad/events/scores/pw8d16 --hops=7,1,6,8,12
python scripts/voice-detector/events/write_cand.py --scores=build/vad/events/scores/pw8d16 --name=yamnet --hop-ms=140 --threshold=0.002 --hangover=800 --wasm-json=build/vad/events/wasm_node.json,build/vad/events/wasm_chrome.json
python scripts/voice-detector/score.py yamnet yamnet-ctx yamnet-95ms --root=build/vad --json=build/vad/scores/yamnet.json
```

## Result (2026-10-06): fails the bar on V2 — by a wide margin, in every variant

Deployable model (`pw8d16`), hop 140 ms (the smallest 20 ms multiple whose
WASM cost stays ≤ 1.8 ms per 25 ms in both Node and Chrome), operating point
by the pre-registered rule (best V2 on the 194-clip tuning split among the
points meeting V1; held-out sets never used to choose). Full harness output:
`build/vad/scores/yamnet.md`, `yamnet-95ms.md`, `yamnet-fp32.md` (not committed).

| candidate | op. point | V1 worst row | V2 279 / held-out A / B | V3 | V4 | verdict |
|---|---|---|---|---|---|---|
| `yamnet` (frame gate, 975 ms patch) | p ≥ 0.002, hangover 800 ms | 2.61 % (0 dB, 20 s lead, gender unknown); clean ≤ 0.12 % | 12.77 / 9.19 / 9.55 % | latency 975 ms FAIL; onset median 0 ms | pass (Apache-2.0, 4.47 MB, 1.60 ms / 25 ms) | V1 pass · **V2 FAIL** · **V3 FAIL** · V4 pass |
| `yamnet-ctx` (context gate, "a voice in the last 8 s") | p ≥ 0.02, hangover 8 s | 2.52 % (0 dB, lead 0, m); clean ≤ 0.27 % | 24.78 / 19.83 / 24.58 % | latency 975 ms FAIL; onset median 0 ms | pass | V1 pass · **V2 FAIL** · **V3 FAIL** · V4 pass |
| `yamnet-95ms` (only the last 8 patch rows carry audio) | p ≥ 0.01, hangover 640 ms | 2.62 % (0 dB, 20 s lead, f); clean ≤ 0.85 % | 9.82 / 12.26 / 9.98 % | pass (95 ms; onset median 0 ms) | pass | V1 pass · **V2 FAIL** · V3 pass · V4 pass |

- Trade-off (`yamnet`, hop 140): relaxing the clean-set limit to 2 % changes
  nothing (the 0 dB mixes at ~2.6 % bind); clean and mix limits 5 %: V2 18.1 %
  (279). Reaching V2 ≥ 60 % on the tuning split costs 14.5–14.8 % of the
  correctly painted voice at 0 dB, 3.6 % at +10 dB, 2.7 % on PVQD + VOICED.
  Context gate: 5 % → V2 35.7 %; V2 ≥ 60 % costs 7.1–8.7 % at 0 dB.
- Not a timing artefact: a non-causal window centred on the painted audio
  (lookahead 360 ms) reaches only 12.2 % (279) at V1.
- Not a quantization artefact: fp32 weights at the same points give V2
  12.77 % / 25.10 % (vs 12.77 / 24.78) and V1 within 0.1 pp.
- Why: machine noise carries small but non-zero "Speech" / "Chant" / "Mantra"
  scores (mean vocal sum 0.089 on falsely painted noise hops), while voice at
  0 dB in fan / server-room / projector / air-conditioner noise drops below
  them; six DEMAND scenes (restaurant, cafeteria, bus, square, meeting room)
  hold real background talkers (YAMNet's top class is Speech on 59–100 % of
  their false hops; 7 398 of the 122 436 false hops) — a "voice present"
  detector cannot tell the user from them.
- Parity: ONNX fp32 vs the official TF pipeline max |Δscore| 1.8e-6; numpy
  log-mel vs `features.py` 8.8e-6; WASM (Node + headless Chrome 154) vs the
  onnxruntime reference max |Δp| 5.9e-6 over 8 360 frames.
