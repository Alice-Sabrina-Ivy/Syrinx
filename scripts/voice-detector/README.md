# Voice-detector benchmark (2026-10-06)

Phase 1 of the voice-detector work: **measurement only**, `src/` is not
touched. On real noise-only audio the current app paints a false pitch line
about 24 % of the time (half of it the 400 ms pitch-hold bridge, half fresh
false voicing; [realnoise-false-voicing-attribution-2026-10-05.md](../../measurements/realnoise-false-voicing-attribution-2026-10-05.md)).
A detector that says "a human voice is present" could gate the display. This
harness measures any such detector against a viability bar fixed before any
candidate ran: does it remove the false line without vetoing real voices?

Every number comes from the **production chain**: the real pitch worker
(notch, ghost veto, above-range null, harmonic guard), the real DSP worker and
the real main-thread display decision (`useAudioPipeline.js`
`handleAnalysisResult`: silence gate, hold bridge, smoothing, paint gate),
through `scripts/session-oracle/lib/chain.mjs`, one fresh session per stream.
The candidate's veto is laid over the painted trace; the hook itself is not
re-driven.

## Files

| file | what |
|---|---|
| `dump.mjs` | step 1: per stream, per 25 ms hop, what the current app paints and whether it is CORRECT / FALSE (+ the stream's audio spec for candidates) |
| `lib/sets.mjs` | the stream sets, reference F0 per set, audio located in place |
| `run-dumps.sh` | every set, sharded, at most 3 processes, resumable |
| `lib/streams.py`, `lib/streams.mjs` | candidate side: list the streams, read exactly the samples the app got, write probability files |
| `baselines.py` | the two validation detectors (`always`, `energy`) |
| `score.py` | step 2: align a candidate to the painted hops, apply its threshold + hangover, score V1–V4 |
| `check.py` | parity of the dumps with the published base numbers of the same chain |
| `selftest.py` | contract checks of the scorer's alignment, hangover and onset logic |
| `judge/` | the verdict's checks ([voice-detector-benchmark-2026-10-06.md](../../measurements/voice-detector-benchmark-2026-10-06.md)): `spot.py` / `spot-wasm.mjs` re-run Silero and WebRTC (reference + browser port) and test causality by truncation; `variant.py` scores a candidate's files at another threshold / hangover; `webrtc_point.py` re-emits a WebRTC sweep point; `tables.py` the cross-candidate table. The custom detector's look (2026-10-07, [voice-detector-custom-2026-10-06.md](../../measurements/voice-detector-custom-2026-10-06.md)): `custom_rerun.mjs` (re-run in onnxruntime-web WASM through the app's resampler + truncation causality), `custom_tradeoff.py` / `custom_fastscore.py` (post-hoc threshold × hangover grid and failure breakdowns), `custom_v5_infer.py` / `custom_v5_score.py` (V5 on the private session recordings; results outside this repository). Round 2 (pre-registration Addenda D–F): `custom_r2_report.py` (V1 per reference-F0 band and voice program, V2 per source, held-out B shared / new classes, clip-bootstrap intervals, carried-state rows), `custom_r2_tradeoff.py` (post-hoc threshold × hangover grid of any candidate's fresh or carried files, parity-checked against its score.py JSON), `custom_probes.py` (the round-1 review's voice probes — VocalSet techniques incl. lip trills, Freesound voice recordings — re-run with any ONNX model; post hoc) |

## Data (read in place, never copied)

| env | what |
|---|---|
| `NOTCHVD_ROOT` | `build/notchvd` of the checkout that built the real corpora ([scripts/notch-adversarial/realdata](../notch-adversarial/realdata/README.md)) |
| `NOTCHVD_HELDOUT_ROOT` | the second held-out noise set (default `$NOTCHVD_ROOT-heldout`) |
| `SYRINX_CORPORA_DIR` | a `tests/dsp/data` with the gitignored FDA / PTDB-TUG audio |

Public sources only (`realdata.mjs` `isPublic`). Outputs go under `build/vad/`
(gitignored); model files and downloads too. No model weights are committed.

| set | streams | what |
|---|---|---|
| `noise` | 279 | noise-only, public, ≥ 10 s, first 90 s. `split`: tune 194 / held 85 (FNV split of the noise source, `realnoise-fv/lib/sets.mjs`) |
| `noiseho` | 119 | the second held-out noise set: dcaseeval 18 + fsheld 101, first 90 s |
| `vin20` | 784 | voice in real noise, +10 / 0 dB, mixes as built: 20 s noise-only lead, voice program, 5 s tail |
| `vin0` | 784 | the same mixes cropped so the voice starts with the stream (lead 0) |
| `fda` / `ptdb` / `voc` / `hil` | 100 / 180 / 40 / 1116 | FDA, PTDB-TUG, vocadito, Hillenbrand at their native rates, `tests/dsp/data/corpora.js` references (`session-oracle/corpus.mjs` conventions) |
| `vocalset` | 399 | VocalSet long tones (forte / pp / straight / messa): held notes; Praat F0 |
| `pvqd` / `voiced` | 296 / 208 | clinical sustained vowels (dysphonic, breathy; PVQD also CAPE-V sentences); Praat F0. PVQD gender is unknown |

## Step 1: dumps (`dump.mjs`)

Hop k is the DSP frame of capture chunk k. **Hop time** t_k = (k + 1) · C / sr
(C = round(0.025 · sr); 25 ms, 25.011 ms at 44.1 kHz) of stream time — the
moment the app paints hop k. The painted value describes pitch frame k − L,
so its reference is read at td_k = t_k − 40 ms − L · hop − 30 ms
(t_k − 120 ms at L = 2; corpus.mjs).

Per hop `lab`: **CORRECT** painted within 5 % of a voiced reference;
**FALSE** painted on noise-only audio, or with no voiced reference within
±100 ms of td_k; WRONG painted at a voiced reference but ≥ 5 % off; EDGE
painted next to (≤ 100 ms) a voiced span. Columns, references and segment
codes: the header of `dump.mjs`. Mix reference = Praat F0 of each voice layer
on the mix timeline (`realnoise-fv/vinscore.py` truth). Gender: corpus /
voice-clip metadata (`w` → f; PVQD, vocadito, `n/a` → unknown).

```bash
export NOTCHVD_ROOT=<checkout>/build/notchvd SYRINX_CORPORA_DIR=<checkout>/tests/dsp/data
bash scripts/voice-detector/run-dumps.sh                       # all sets, <= 3 processes, ~30 min
```

## Candidate interface

A candidate is a directory `build/vad/cand/<name>/` (or any directory) with

**`candidate.json`**

```json
{
  "name": "silero-v5",
  "hop_ms": 32,              "first_avail_ms": 32,
  "frame_ms": 32,            "lookahead_ms": 0,
  "threshold": 0.5,          "hangover_ms": 200,
  "agg": "last",             "p_before_first": 0,
  "v4": { "license": "MIT", "license_file": "build/vad/models/x/LICENSE", "license_text_checked": true,
          "model_bytes": 2313101, "runtime": "onnxruntime-web-wasm",
          "wasm_ms_per_25ms": 0.41, "wasm_measured_on": "desktop Chrome 147, ort-web 1.x WASM, 1 thread" },
  "notes": "..."
}
```

| field | meaning |
|---|---|
| `hop_ms` | frame hop of the probability file (any value, e.g. 10, 25, 32) |
| `first_avail_ms` | stream time (ms from the stream's first sample) at which frame 0's probability can exist = the end of the last audio sample it depends on, **including any internal look-ahead**. Frame i is available at `first_avail_ms + i · hop_ms` |
| `frame_ms` | the analysis window length (V3) |
| `lookahead_ms` | extra display delay the candidate asks for: hop k may use frames available by t_k + `lookahead_ms`. 0 = the gate adds no latency |
| `threshold` | voice when p ≥ threshold |
| `hangover_ms` | stay voice this long (hop time) after the last hop with p ≥ threshold |
| `agg` | `last` (default): the latest available frame; `max` / `mean`: the frames that became available since the previous hop (else the latest) |
| `p_before_first` | p for hops before frame 0 is available (default 0) |
| `v4` | deployability facts the candidate runner measured / read (V4) |

**Per stream** `<set>/<id>.f32`: float32 little-endian, one probability in
[0, 1] per frame of the stated grid, starting at frame 0 — at least every frame
available by the stream's last hop time. Streams and their exact samples:
`lib/streams.py` (`list_streams`, `load_audio`, `load_audio_16k`) or
`lib/streams.mjs` (`listStreams`, `loadAudio`, `writeProbs`). Stream time 0 is
`audio.start` of the stream's file; a stream is `audio.len` samples at
`audio.sr` (FDA is raw 16-bit big-endian `.sig`).

The candidate must be causal on its own grid: frame i may use only samples
before its availability time. The harness enforces the rest by construction:
for hop k it reads only frames available by t_k + `lookahead_ms`, then
applies the candidate's threshold and hangover; a painted hop that is not
voice is **vetoed**.

```bash
python scripts/voice-detector/score.py <name or dir> [...] [--json=build/vad/scores/<name>.json] [--worst=10]
python scripts/voice-detector/baselines.py && python scripts/voice-detector/score.py always energy
```

## Viability bar (pre-registered 2026-10-06, fixed before any candidate ran)

- **V1 voice kept**: among the hops the current app paints CORRECTLY on real
  voices, the detector (one fixed operating point incl. hangover) vetoes
  ≤ 1 % on EACH voice set — FDA, PTDB-TUG, vocadito, VocalSet long tones,
  PVQD + VOICED, Hillenbrand — per gender, the worse gender reported; and
  ≤ 3 % on voice-in-noise mixes at +10 and 0 dB (20 s lead and lead 0).
- **V2 noise removed**: among the hops the current app paints FALSELY on
  real noise-only audio, the detector vetoes ≥ 60 % on the 279 clips and
  ≥ 50 % on each held-out noise set; per class and the worst machine rooms
  (hvac, mains hum, microwave, refrigerator, generator) reported.
- **V3 timing**: frame size + lookahead ≤ 100 ms; voice onsets not vetoed
  for more than 100 ms (median).
- **V4 deployability**: permissive licence (MIT / BSD / Apache-2.0, text
  read), model ≤ 5 MB, runs in the browser (onnxruntime-web WASM or pure
  JS / WASM), desktop CPU ≤ 2 ms per 25 ms of audio with the WASM backend.

**Readings fixed in `score.py`** (before any candidate was scored; only the
two validation detectors had run):

- Gender groups f / m / unknown; "worse gender" = the worst group present
  (PVQD and vocadito have only unknown; PVQD + VOICED is one row with three
  groups). Voice-in-noise: four cells (+10 / 0 dB × 20 s lead / lead 0), each
  ≤ 3 %.
- V2 shares are pooled over hops. "Each held-out noise set" = the in-set
  held-out split (85 of the 279) and the second held-out set (119). The
  clip-mean painted fraction before → after (the earlier 23.9 % metric) is
  printed next to it, not scored. `notchvd-heldout2` holds voice only (no
  noise).
- V3 onsets: a trace onset of the current app (a painted hop after ≥ 200 ms
  with nothing painted) whose first 4 hops include ≥ 2 CORRECT ones. Delay =
  first un-vetoed painted hop of that run − onset, censored at the run's end
  ("never shown"), plus the candidate's `lookahead_ms` (a delayed display
  starts later). Verdict: median over all onsets of the voice sets and mixes,
  worse gender ≤ 100 ms; per set reported.
- V4: licence ∈ {MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0} with
  `license_text_checked`; `model_bytes` ≤ 5 000 000; runtime ∈
  {onnxruntime-web-wasm, js, wasm}; `wasm_ms_per_25ms` ≤ 2.0, measured by the
  candidate runner. Undeclared = unverified = not passed.
