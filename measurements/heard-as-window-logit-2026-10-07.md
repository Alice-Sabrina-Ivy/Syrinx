# Gender worker: per-window logit, extracted window decision, lazy start — 2026-10-07

Hard-rule-3 note for the `src/ml/gender-worker.js` change on branch
`cue-strip`, written before the worker was edited. The worker now feeds the
experimental, opt-in "Likely heard as" panel
(`measurements/heard-as-calibration-2026-10-07.md`) instead of the retired
Perceived-voice bar. Public data only.

## What changes in the worker

1. **`score` message gains four fields**: `logit` = ln(p_female) − ln(p_male)
   of THIS window's pipeline result (`femaleLogitFromResult`, new pure helper
   in `src/ml/audio-utils.js`, labels parsed by name like
   `femaleScoreFromResult`; null if either label is missing or ≤ 0), `audioMs`
   = the audio-clock time (capture `contextTime` × 1000) of the newest chunk
   in the scored window, `spanId` (the utterance gate's span) and `mode`
   (`"gated"`, or `"fallback"` on the amplitude path). `score`, `confidence`,
   the EMA and every other field are unchanged.
2. **The per-tick window decision moves into a pure function**,
   `decideMlWindow({ gate, audioNowMs, peak, lastGateMode, silenceTracker })`
   in `src/ml/utterance-gate.js`. `maybeInfer` calls it; nothing else in the
   decision changes. The heard-as calibration replays exactly this function.
3. **The worker is started lazily** by the main thread: only while the
   "Likely heard as" panel is on (off by default). The worker file itself
   does not change for this.

## 1. The logit equals the model's fc7 difference

`node scripts/heard-as/logit-check.mjs`: 2600 public 0.75 s windows (2255
LibriSpeech test-clean r1 windows, 300 Hillenbrand /hVd/ vowels, 45 windows
of the committed lab fixtures), each through the audio-classification
**pipeline** (what the worker calls) and through
`AutoModelForAudioClassification` (raw logits), deployed q8-v2, onnxruntime-node:

| | Result |
|---|---|
| max \|femaleLogitFromResult − (d[female] − d[male])\| | **1.2e-7** (the pipeline rounds probabilities to float32) |
| null logits | 0 |
| sign disagreements with `femaleScoreFromResult − 0.5` | 0 |
| logit range on these windows | −8.84 … +6.94 (no clamping; calibration windows reach −37) |

## 2. The window decision is bit-identical

`node scripts/heard-as/window-decision-replay.mjs --runs=<dir>` replays the
recorded production-chain runs of the perceived-voice-gate audit (LibriSpeech
× channel conditions, 100 public noise clips, VOICED, VocalSet, PVQD,
speaker changes, breaths, aliasing; `scripts/perceived-voice-gate/`) through
two gate instances fed the same hints: `decideMlWindow` and a verbatim copy
of the pre-refactor inline decision.

| | Result |
|---|---|
| streams / 150 ms ticks | 1258 / 135 530 |
| ticks with any difference in score / resetEma / voice state / mode | **0** |
| scored windows | 49 468 |
| posted EMA scores compared (classifier logits from the audit) | 45 380, **0** differences (`===`) |

`tests/ml/utterance-gate-test.js` adds the `(verdict, peak, mode) →
(score, resetEma, voiceState)` table, the fallback silent-run reset tick and
tick-by-tick identity on synthetic speech / held-note / silence streams.

The score stream is unchanged by construction: the EMA input is still
`femaleScoreFromResult(result)` of the same call, reset on the same ticks.

## 3. Cost of the extra fields

| | Per window |
|---|---|
| pipeline inference, Node, 1 thread (this machine, loaded) | 18.75 ms |
| `femaleLogitFromResult` (two `Math.log` + label parse) | 4.2 µs (0.02 % of the inference; unmeasurable in the browser) |

## 4. Lazy start: what the panel being off saves

The gender worker scored every voiced window for every user until now,
though only the Perceived-voice bar read it. Desktop browser WASM inference
is ~52 ms per window at ~6.2 Hz (`measurements/gender-model-latency-2026-07-19.md`),
i.e. **~0.3 s of CPU per second of scored speech**, plus the 16.1 MB model
download on first use and the ONNX runtime's memory. With the panel off (the
default) the worker is never created: none of that runs and nothing
downloads. With the panel on, the worker is unchanged. The resonance lab's
pnml finalist fetches the model itself (`lab-worker.js`), so the lab is
unaffected.

## Reproduce

```
node scripts/heard-as/logit-check.mjs --r1=<jobs_r1.json> --hill=<Hillenbrand men/ wavs> --max=2600
node scripts/heard-as/window-decision-replay.mjs --runs=<perceived-voice-gate runs dir>
node tests/ml/audio-utils-test.js
node tests/ml/utterance-gate-test.js
```
