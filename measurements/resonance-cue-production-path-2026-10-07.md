# Resonance cue: production path (vtln in "frames" mode) — 2026-10-07

Measurement note for the Dashboard's resonance cue (branch `cue-strip`,
Design A "cue strip"). The cue shows the resonance lab's **spectral-warp**
finalist (vtln_warp v3, `src/resonance-lab/vtln.js`) live on the Dashboard,
next to pitch and vocal weight. Public data and synthetic stimuli only.

## 1. Design

- **One engine, two pitch sources.** `src/resonance-lab/lab-engine.js` gains
  `pitchSource: "frames"` (default `"internal"`, the lab's behaviour). In
  frames mode the engine does not run its embedded copy of the production
  pitch chain. The new always-on `src/resonance/resonance-worker.js` (a 4th
  capture consumer) receives the pitch worker's **posted** decisions,
  relayed by the main thread as the same `pitch-hint` object the ML worker
  gets, through `pushPitchFrame(contextTime, f0)`. The engine runs the same
  streaming linear resampler as the pitch worker only to count 16 kHz
  samples, so a frame posted with chunk time `contextTime` lands at
  `n16After / 16000 − 0.04` — exactly the time the internal replica gives
  it. Frames whose chunk is unknown or older than 4 s are dropped and
  counted (`framesDropped`); a grid frame left unresolved more than 1.5 s
  behind the 2.05 s analysis ring is resolved unvoiced
  (`gridForcedUnvoiced`) so vtln never reads overwritten audio. The fv
  capture-rate ring is allocated only when the fv model is loaded.
- **Only vtln.** No le / fv / pnml, no ONNX. Assets: the lab's
  `public/resonance-lab/vtln_warp.json` (93 KB) and `reference.json` (one
  source of truth with the lab).
- **Gating** (`src/resonance/resonanceCue.js`, pure). Each vtln bin is added
  to the cue's own 5 s-voiced median readout (the lab's `readout.js`)
  unless the perceived-voice **utterance gate** (`src/ml/utterance-gate.js`,
  defaults, fed the same pitch hints on the audio clock, `decide()` once per
  capture chunk) says `sustained` (held phonation) or `warming` (an
  utterance onset being watched for a held note). After `sustained` the
  drop is latched until the gate next says `score` or `pause`, so the
  late-resolving tail of a held note never enters. Voiced time spent in
  dropped bins is taken out of the readout's voiced clock, so a held note
  does not push earlier running speech out of the 5 s horizon.
- **Overload guard.** *Revised in the review round*
  (`src/resonance/overloadGuard.js`,
  measurements/cue-strip-review-fixes-2026-10-07.md §4): the mean worker ms
  per audio second over the trailing 10 s of audio, ignoring the first 3 s;
  above 500 ms/s the worker backs off (20 s of audio, doubling, ≤ 160 s),
  the row says "paused — device busy", then it resumes with a fresh engine.
  **Historical (superseded 2026-10-07):** an EMA (τ ≈ 10 s) seeded with the
  first, coldest chunk that latched "unavailable on this device" for the
  session.
- **After a long pause** (review round): ≥ 10 s of audio with no admitted
  bin restarts the cue's `sinceResumeS`; the row shows "settling" until 2 s
  of new speech are in, so an earlier voice's readout is never shown as a
  confident live dot.

## 2. Parity (bit-exact)

`tests/resonance/vtln-production-parity-test.js` (in CI and in
`npm run test:resonance-lab`): the three committed lab fixtures (public
LibriSpeech, 5 s each) at **48 kHz** (the lab's band-limited upsample,
1200-sample chunks) and **44.1 kHz** (linear-resampled, alternating
1102 / 1103-sample chunks), the REAL pitch worker relaying into the frames
engine with relay delays of **0, 3 and 20 chunks**, vs the lab engine's
internal replica:

| Check (18 runs: 3 fixtures × 2 rates × 3 delays) | Result |
|---|---|
| vtln bin keys, null pattern and values (`===`) | identical in all 18 |
| 10 ms grid F0 track (`===`) | identical in all 18 (491 frames each) |
| readout snapshot raw / n / voicedS (`===`) | identical in all 18 |
| `framesDropped`, `gridForcedUnvoiced` | 0 in all 18 |

The real resonance worker (fake `self`, assets read from `public/`): its
ungated cue equals the engine's readout exactly; admitted + dropped bins =
every stamped bin; on the fixtures it drops 1 of 32 bins (an onset bin) and
reads within 0.02 G of the ungated readout.

The lab parity test (`tests/resonance-lab/parity-test.js`) is unchanged and
passes: the lab's behaviour is unchanged.

## 3. CPU

Node v24.14.1, i9-11900K, `node scripts/resonance/bench.mjs --reps=7`: the
three fixtures looped to 60 s at 48 kHz, 62 % of pitch frames voiced,
`process.cpuUsage()` around the worker calls only. Measured with other
jobs loading the machine to 50–75 % (median of 7; the spread is that load).

| Path | ms CPU per s of audio |
|---|---|
| **Production: resonance worker, frames mode (gate + cue included)** | **32.6** (31.8–47.9) |
| Lab engine, vtln with its internal pitch replica | 53.4 (50.3–70.3) |

Budget ≤ 35 ms/s in Node: met. Reusing the pitch worker's decisions saves
~40 % of the lab path's cost for the same finalist. (The pitch worker's own
cost is not counted: it runs anyway for the pitch trace.)

Desktop Chrome and mobile: §7.

## 4. Gating on public material

`node scripts/resonance/gating.mjs --r1=<jobs>` drives the production path
end to end (real pitch worker → frames engine → gated and ungated cue side by
side).

**Running speech.** 40 LibriSpeech test-clean readers (20 women, 20 men; the
resonance-lab benchmark's r1 set, 5 utterances each), each reader's
utterances concatenated into one reading stream: 1674 s of audio, 985 s
voiced.

| | Result |
|---|---|
| Bins dropped by the gate (utterance onsets) | median 2.2 %, q90 4.6 %, pooled 2.7 % |
| \|gated − ungated readout\| at stream end | median 0.000 G, q90 0.043 G, max 0.091 G |

The gate costs running speech almost nothing.

**Held vowels.** 24 synthetic 4 s holds (110 / 165 / 220 / 300 Hz × /a/ /i/
/u/ formants × with / without 5 Hz ±0.3 st vibrato), after 0.5 s of
silence:

| | Result |
|---|---|
| Share of the hold's bins dropped | median 96 %, min 96 % |
| Gate verdict `sustained`, share of hold time after its first second | 100 % in every hold |
| Bins admitted per hold (before the gate fires) | at most 4 (~0.6 s) |
| Holds that reached the cue's "settling" state (2 s admitted voiced) | 0 / 24 |

So a held vowel alone never produces a dot ("needs running speech"); a held
note following speech inside one utterance can contribute its first
≤ ~1 s before the gate fires (about 7 of ~33 bins in a 5 s readout; the
median absorbs it).

## 5. Time to a reading

Same 40 reading streams, from the stream start:

| State | Audio time to reach it |
|---|---|
| settling (2 s of admitted voiced speech) | median 4.0 s, q90 4.8 s |
| live (readout window full: 5 s of admitted voiced speech) | median 9.1 s, q90 11.7 s (40 / 40 reached) |

## 6. Sanity check against the bands

The lab's bands are the 10th–90th percentiles of the 20 **per-speaker
medians** of 5 s readouts per sex (`reference.json`, in u units: men
−0.53…0.29, women 0.65…1.55). Each reader's gated readout at the end of their
stream:

| | median u | inside own q10–q90 band |
|---|---|---|
| women | 1.09 | 16 / 20 |
| men | −0.00 | 11 / 20 (4 below, 5 above) |

Women and men separate (one woman at 0.27, one man at 0.78 cross the gap).
One readout per speaker is noisier than the per-speaker medians, as expected
from the lab benchmark's utterance-to-utterance wobble — and the shortfall
was larger for men (64 % of men's live readouts inside the men's band vs
83 % for women). **Since the review round the cue draws bands from the
distribution of single readouts instead** (`public/resonance-lab/cue-bands.json`:
men −0.58…0.48, women 0.57…1.39; 80 % / 80 % of live readouts inside, 17 / 20
end-of-stream readouts each) — measurements/cue-strip-review-fixes-2026-10-07.md §2.

## 7. Desktop Chrome and mobile

`node scripts/resonance/chrome-cpu.mjs` — the built app (vite preview) in
headless Chrome 154 (desktop, i9-11900K) under `?diag=1`, the fake mic
playing a 72 s LibriSpeech test-clean reading (one woman reader, CC BY 4.0),
60 s; `window.__syrinxDiag.snapshot().resonancePerf` = the worker's own busy
time (`performance.now()` around its chunk and pitch-frame processing) per
second of audio. Other jobs held the machine at ~70 % CPU load during both
runs, so these are upper-side figures.

| Run | Session mean | Overload EMA (τ 10 s) | Bins admitted / dropped | Grid frames forced unvoiced |
|---|---|---|---|---|
| 1 | 45.9 ms per audio s | 48.9 | 377 / 24 | 0 |
| 2 | 45.2 ms per audio s | 46.2 | 392 / 7 | 0 |

Target ≤ 45 ms/s: at the target under this load (≈ 1.4 × the Node figure);
the stop threshold (60 ms/s)
is not reached. The overload guard trips at 500 ms/s. With the experimental
panel on (the gender worker competing for CPU) the review measured 51.8 ms per
audio second (session mean, ~74 % machine load) vs 44.1 with it off —
measurements/cue-strip-review-fixes-2026-10-07.md §4. (A first run exposed
that the overload EMA counted only chunk processing while most vtln work
runs when a relayed pitch frame resolves grid time; it now counts both.)

**Mobile: unmeasured.** No phone was attached while this was built.
`scripts/mobile-diag-capture.js` now prints the worker's `resonancePerf`;
until it is measured, the overload guard (§1) pauses the row ("paused —
device busy") rather than letting the worker fall behind.

## 8. Honest position

The resonance-lab benchmark
(`measurements/resonance-lab-benchmark-2026-10-04.md`) establishes vtln for
**in-session change** on adult running speech; it does **not** establish
absolute position across devices and rooms (the bands come from 40
audiobook readers on good microphones), the readout wobbles by about
0.46 G from utterance to utterance (hence the 5 s pooling), it clamps at
ln α ±0.24 (u −1.63 / +2.61), and on single syllables it reads vowel
identity. The cue therefore:

1. is titled **"Resonance · approx."**;
2. draws its typical-speaker bands dashed (since the review round: a
   neutral-400 dashed outline at ≥ 3:1 contrast; before, fainter and
   fuzzy-edged, which made the women's band nearly invisible);
3. marks **where you started** this session (a ring; since the review
   round the median of the readouts over the first 12 s of voiced speech
   after the readout fills — before, the first full readout, which could sit
   0.65 u off a reader's typical level) — movement relative to it is the
   validated use — and, since the
   review round, says that change in its header ("brighter / darker than
   your start", "about where you started" within 0.3 u) with a line from
   the ring to the dot and a ~30 s trail;
4. explains in its info text that the microphone, room and distance shift
   the whole scale ("trust how the dot moves more than where it sits"),
   that it uses about the last 5 s of running speech (held vowels and single
   words don't count) and that even typical speakers' dots land outside
   their band about 1 time in 5;
5. pins the dot at the axis end with a chevron and says "beyond the scale"
   at the clamp;
6. never colours its dot on or off a target (only pitch judges).

## Reproduce

```
node tests/resonance/vtln-production-parity-test.js
node tests/resonance/resonance-cue-test.js
node scripts/resonance/bench.mjs --reps=7
node scripts/resonance/gating.mjs --r1=<jobs_r1.json>     # rows -> build/resonance-cue/
```
