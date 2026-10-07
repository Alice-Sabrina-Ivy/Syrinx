# Voice-detector benchmark — candidates and verdict (2026-10-06)

Branch `voice-detector` (from 4404244 = main with the V19g hum filter, plus the
real-noise tooling). This is phase 1, measurement only: `src/` is unchanged.

- Harness, data and the current-app baseline:
  [voice-detector-harness-2026-10-06.md](voice-detector-harness-2026-10-06.md),
  tools in [scripts/voice-detector/](../scripts/voice-detector/README.md).
- Problem statement:
  [realnoise-false-voicing-attribution-2026-10-05.md](realnoise-false-voicing-attribution-2026-10-05.md)
  §1a. On real noise-only audio the app paints a false pitch line about 24 % of
  the time. Half of that is the 400 ms hold bridge, half is fresh false voicing.
- Why display-side heuristics stalled: `pitch-hold-bridge-rework-2026-10-06.md`
  on branch `gap-bridge-rework`. Machine rooms pass CPP and periodicity
  evidence.

Only public data was used. The private session recordings were not used.

## Decision

**No candidate meets the pre-registered bar. Phase 2 does not start, and
nothing goes into `src`.** Four detector families were benchmarked: six
rule-picked operating points, plus Silero's own defaults for information.
Every rule-picked point meets V1 ("voice kept") and fails V2 ("noise
removed").

| | V1 voice kept | V2 removed: 279 / held-out A / held-out B (bar 60 / 50 / 50 %) | V3 timing | V4 deploy | verdict |
|---|---|---|---|---|---|
| **WebRTC VAD** (GMM; mode 2, 30 ms, 1 of the last 3 frames, 1.25 s hangover) | pass (worst VocalSet f 0.998 %) | **13.14 / 16.50 / 12.58** | pass (90 ms; onset median 0) | pass (BSD-3, 35 KB, 0.016 ms) | fails V2 |
| **Silero VAD v6.2.3** (p ≥ 0.002, 45 s hangover) | pass (worst 0 dB mix f 2.76 %) | **10.90 / 9.26 / 12.76** | pass | pass (MIT, 2.3 MB, 0.44 ms) | fails V2 |
| YAMNet, 95 ms window (p ≥ 0.01, 0.64 s) | pass (worst 0 dB mix f 2.62 %) | **9.82 / 12.26 / 9.98** | pass | pass (Apache-2.0, 4.47 MB, 1.60 ms) | fails V2 |
| TEN VAD (p ≥ 0.35, 3 s) | pass (worst 0 dB mix m 2.84 %) | **9.87 / 9.56 / 11.51** | pass | **licence FAIL** (Apache-2.0 + non-compete) | fails V2, V4 |
| YAMNet frame gate (p ≥ 0.002, 0.8 s) | pass | **12.77 / 9.19 / 9.55** | **FAIL** (975 ms window) | pass | fails V2, V3 |
| YAMNet context gate (p ≥ 0.02, 8 s) | pass | **24.78 / 19.83 / 24.58** | **FAIL** (975 ms window) | pass | fails V2, V3 |
| *Silero defaults (p ≥ 0.5, 100 ms; information only)* | **FAIL** (VocalSet 98.7 %, PVQD + VOICED 94.4 %) | 98.02 / 95.26 / 99.69 | **FAIL** (onset median m 750 ms) | pass | fails V1, V3 |

- **The best candidate is the WebRTC VAD.** It fails only V2, and is about 4×
  short there: it removes 13 % of the false line where the bar asks for 60 %.
  - It barely touches the worst machine rooms: mains hum 0.04 %, microwave
    0 %, refrigerator 0.75 %, generator 0 %, hvac 4.1 % (279 clips).
  - It meets V1 by one hop: 171 of 17,130 correct female VocalSet hops are
    vetoed (0.998 %). One more vetoed hop would fail.
- **Silero comes second**, also failing only V2. The rule's pick for it is a
  45 s near-latch, because no point with a hangover of 5 s or less meets V1.
- **Relaxing V1 does not rescue any candidate at a usable cost.** Best V2 on
  the 279 clips:
  - WebRTC: 19.9 % with V1 at 2 %, 27.3 % at 5 %, 33.6 % at 10 %.
  - WebRTC with V1 ignored entirely: 47.2 %. That point vetoes 33 % of male
    held-note hops, and still fails V2 on the 279 clips (47.2 %) and on
    held-out B (47.9 %).
  - Silero and TEN at their own defaults do pass V2, but V1 collapses:
    Silero vetoes nearly every held note and sustained vowel (VocalSet
    98.7 %, PVQD + VOICED 94.4 %); TEN vetoes 33–57 % of male voice in noise
    and 11.8 % of sustained vowels.
- **One configuration passes V2 on all three sets.** It was found by post-hoc
  exploration (§4.4), not by the selection rule: the YAMNet context gate at
  p ≥ 0.08 removes 60.6 / 56.6 / 57.0 %. It fails anyway:
  - V1: it vetoes 7.6–9.2 % of male voice at 0 dB, 2.3 % of sustained vowels
    and 1.5 % of held notes.
  - V3: its 975 ms window fails the latency clause by construction.
  - It is about 3–7 ms per 25 ms on phones (estimated).
  - Because of its 8 s context, it barely touches false painting right after
    speech, which is the common case in a live session.

**Why every family fails.** A speech or voice-activity detector separates
machine noise from *speech* well. Silero at its defaults removes 98 % and
keeps 100 % of FDA and PTDB-TUG. What it cannot separate from machine noise is
*sustained phonation*:

- held notes;
- sustained and dysphonic vowels;
- voice at 0 dB in fan or air-conditioner noise.

The reasons differ by detector:

- **WebRTC:** its adaptive noise model learns a held tone as background (§4.3).
- **Silero:** it scores held notes and sustained vowels near 0.
- **YAMNet:** machine noise carries small non-zero Speech, Chant and Mantra
  scores.

For a voice-training tool, held notes and sustained vowels are the core use
case. V1 therefore forces every threshold below the level the machine rooms
reach, so the false line stays.

## 1. The pre-registered bar (verbatim)

Fixed before any candidate ran, and not changed after:

> PRE-REGISTERED VIABILITY BAR (fixed now; report every row; do not change after seeing numbers):
>  V1 voice kept: among the frames the CURRENT app (main = this branch's src) paints CORRECTLY on real voices, the detector (at one fixed operating point incl. its hangover/smoothing) vetoes <= 1 % on EACH voice set — FDA speech, PTDB-TUG speech, vocadito singing, VocalSet long tones (held notes), PVQD + VOICED sustained vowels (dysphonic/breathy), Hillenbrand vowels — computed per gender and reported as the worse gender; and <= 3 % on voice-in-noise mixes at +10 and 0 dB (incl. voice starting with the stream).
>  V2 noise removed: among the frames the current app paints FALSELY on real noise-only audio, the detector vetoes >= 60 % on the 279 tuning clips and >= 50 % on each held-out noise set; also report per noise class (stationary-tonal / intermittent / mixed / broadband; and the worst machine rooms: hvac, mains hum, microwave, fridge, generator).
>  V3 timing: the detector's decision for a frame must be available within 100 ms of that frame (lookahead + frame size) and voice onsets must not be vetoed for more than 100 ms (median) — the trace must not start later.
>  V4 deployability: permissive licence usable in a public app (MIT / BSD / Apache-2.0 without restrictive additions — read the actual licence text), model <= 5 MB, runs in the browser (onnxruntime-web WASM or pure JS/WASM), desktop CPU <= 2 ms per 25 ms of audio measured with the WASM backend (mobile estimated, not required).

**How the bar is read.** These readings are fixed in `score.py`. The scorer
has not changed since harness commit 7cd4e86, before any candidate was scored;
details are in the harness README, "Viability bar".

- **Gender.** Rows are scored per gender (f / m / unknown); a row's result is
  its worst group.
- **Voice in noise.** Four cells (+10 / 0 dB × 20 s noise lead / lead 0), each
  ≤ 3 %.
- **V2.** Shares are pooled over hops. "Each held-out noise set" means two
  sets:
  - held-out A: the in-set FNV split, 85 of the 279 clips;
  - held-out B: the second held-out set, 119 clips.
- **V3.**
  - Latency = declared `frame_ms` + `lookahead_ms`.
  - Onset delay = the first un-vetoed painted hop of each current-app trace
    onset, measured from that onset and censored at the run's end. It is
    reported as the median in the worse gender.
- **V4.** The licence must be in {MIT, BSD-2/3, Apache-2.0} and its text must
  have been read.

**Selection rule.** Every candidate used the same rule: the best V2 on the
194-clip tuning split among grid points meeting V1. The 279 clips include
held-out A, so selecting on all 279 would have used held-out data. No
held-out data was used to choose any operating point. For WebRTC, the looser
readings (V1 on all mixes, V2 on all 279) pick the same point.

## 2. Method

- **The current app.** `dump.mjs` runs the production chain (the real pitch
  worker, DSP worker and `handleAnalysisResult` display decision) over
  4,305 streams in 11 sets. For each 25 ms hop it records whether the trace
  is painted CORRECT, FALSE, WRONG or EDGE.
  - Parity with the published base numbers holds exactly (harness note).
  - Denominators: 122,436 FALSE hops on the 279 clips (43,213 in held-out A)
    and 46,033 on held-out B.
  - CORRECT hops per voice set are in the harness note.
- **Candidates.** Each runner reads exactly the samples the app got, writes
  one probability per frame on a declared causal grid, and declares
  `first_avail_ms`, `frame_ms`, `threshold` and `hangover_ms`.
  - For hop k the scorer uses only the frames available by the hop's time.
    It applies the candidate's threshold and hangover, and vetoes painted hops
    that are not voice.
  - Runners and sweeps:
    - `scripts/voice-detector/silero/`
    - `ten/`
    - `webrtc/`
    - `events/` (YAMNet)
  - Model files and downloads stay under the gitignored `build/vad/`. No
    weights are committed.
- **The judge's checks** (§5) cover the two best candidates and more:
  - Re-scored every candidate from its probability files with the unchanged
    `score.py`.
  - Re-ran the models on a seeded sample.
  - Tested causality by truncating the audio.
  - Re-read the licence texts.

## 3. Results at the selected operating points

These are judge re-scores (`score.py`, then `judge/tables.py`). Every
headline number in the candidates' own reports reproduces exactly. Each V1
cell shows the worse gender group: f, m, or u = unknown (PVQD, vocadito).
**Bold** = fails the bar.

| row | WebRTC | Silero | YAMNet 95 ms | TEN | YAMNet frame | YAMNet ctx | Silero defaults (info) |
|---|---|---|---|---|---|---|---|
| operating point | p ≥ 1/6, hangover 1.25 s | p ≥ 0.002, hangover 45 s | p ≥ 0.01, hangover 0.64 s | p ≥ 0.35, hangover 3 s | p ≥ 0.002, hangover 0.8 s | p ≥ 0.02, hangover 8 s | p ≥ 0.5, hangover 0.1 s |
| V1 FDA speech (≤ 1 %) | f 0.00 | f 0.00 | f 0.00 | f 0.00 | f 0.00 | f 0.00 | f 0.00 |
| V1 PTDB-TUG speech (≤ 1 %) | f 0.00 | f 0.00 | m 0.08 | f 0.00 | m 0.08 | m 0.11 | f 0.00 |
| V1 vocadito singing (≤ 1 %) | u 0.00 | u 0.00 | u 0.00 | u 0.00 | u 0.00 | u 0.00 | **u 11.44** |
| V1 VocalSet long tones / held notes (≤ 1 %) | f 1.00 (0.998) | f 0.00 | m 0.85 | m 0.00 | m 0.12 | f 0.27 | **m 98.67** |
| V1 PVQD + VOICED sustained vowels (≤ 1 %) | u 0.33 | f 0.00 | u 0.45 | m 0.64 | f 0.07 | f 0.20 | **f 94.35** |
| V1 Hillenbrand vowels (≤ 1 %) | f 0.00 | f 0.00 | f 0.04 | f 0.00 | f 0.00 | f 0.00 | **f 4.11** |
| V1 voice in noise +10 dB, lead 20 s (≤ 3 %) | f 0.00 | f 0.00 | f 1.23 | m 0.92 | m 0.11 | f 0.34 | **m 90.54** |
| V1 voice in noise 0 dB, lead 20 s (≤ 3 %) | m 0.04 | f 2.76 | f 2.62 | m 2.84 | u 2.61 | m 2.44 | **m 94.20** |
| V1 voice in noise +10 dB, lead 0 (≤ 3 %) | f 0.00 | f 0.00 | m 1.05 | m 1.32 | m 0.09 | m 0.09 | **m 90.28** |
| V1 voice in noise 0 dB, lead 0 (≤ 3 %) | f 0.16 | f 0.00 | f 2.23 | m 2.67 | u 2.45 | m 2.52 | **m 92.94** |
| V2 all 279 (≥ 60 %) | **13.14** | **10.90** | **9.82** | **9.87** | **12.77** | **24.78** | 98.02 |
| V2 … tuning split 194 (selection) | 11.32 | 11.79 | 8.49 | 10.04 | 14.73 | 27.47 | 99.52 |
| V2 held-out A, 85 (≥ 50 %) | **16.50** | **9.26** | **12.26** | **9.56** | **9.19** | **19.83** | 95.26 |
| V2 held-out B, 119 (≥ 50 %) | **12.58** | **12.76** | **9.98** | **11.51** | **9.55** | **24.58** | 99.69 |
| V2 … held-out B dcaseeval 18 | 52.81 | 0.00 | 16.94 | 7.17 | 4.50 | 9.71 | 100.00 |
| V2 … held-out B fsheld 101 | 7.37 | 14.41 | 9.08 | 12.07 | 10.20 | 26.51 | 99.65 |
| clip-mean painted on the 279 (base 23.93 %) | 20.22 | 22.52 | 21.44 | 21.56 | 21.31 | 18.55 | 0.28 |
| V2 stationary-tonal (102 clips) | 12.87 | 11.87 | 12.78 | 13.08 | 18.80 | 35.00 | 99.72 |
| V2 intermittent-tonal (10) | 15.22 | 1.35 | 1.22 | 9.32 | 0.77 | 15.98 | 98.74 |
| V2 mixed (133) | 11.97 | 11.31 | 8.28 | 7.93 | 5.77 | 15.53 | 96.18 |
| V2 broadband (34) | 23.12 | 3.91 | 3.60 | 2.70 | 27.08 | 26.34 | 99.89 |
| V2 hvac (279 / held-out B) | 4.09 / 26.28 | 8.02 / 1.81 | 3.39 / 34.47 | 9.27 / 21.06 | 3.77 / 41.91 | 39.44 / 44.89 | 99.90 / 100 |
| V2 mains hum (279 / held-out B) | 0.04 / 3.44 | 32.27 / 0.00 | 17.75 / 24.55 | 8.32 / 26.88 | 36.19 / 7.51 | 37.69 / 32.99 | 99.67 / 99.88 |
| V2 microwave (279) | 0.00 | 6.11 | 0.23 | 8.54 | 14.29 | 43.11 | 99.84 |
| V2 refrigerator (279) | 0.75 | 13.64 | 6.45 | 6.54 | 1.38 | 21.65 | 99.73 |
| V2 generator (279) | 0.00 | 3.90 | 21.21 | 0.56 | 0.00 | 20.85 | 100.00 |
| info: false hops next to voice vetoed, +10 dB gaps between phrases | 1.19 | 0.00 | 2.10 | 3.28 | 1.10 | 2.46 | 88.96 |
| info: … 0 dB, tail after the voice (20 s lead / lead 0) | 1.93 / 1.88 | 17.03 / 0.58 | 3.60 / 4.22 | 11.40 / 11.31 | 9.74 / 8.29 | 2.79 / 2.28 | 99.55 / 99.26 |
| V3 frame + lookahead (≤ 100 ms) | 90 | 36 | 95 | 80 | **975** | **975** | 36 |
| V3 onset delay median, worse gender (≤ 100 ms) | 0 | 0 | 0 | 0 | 0 | 0 | **m 750** |
| … onsets > 100 ms / never shown, worst group % | 0.14 / 0.02 | 0.16 / 0.16 | 0.56 / 0.11 | 0.64 / 0.37 | 0.56 / 0.13 | 1.36 / 0.51 | 56.16 / 55.28 |
| V4 licence | BSD-3-Clause | MIT | Apache-2.0 | **Apache-2.0 + Agora conditions** | Apache-2.0 | Apache-2.0 | MIT |
| V4 size | 35,491 B | 2,327,524 B | 4,468,011 B | 288,987 B | 4,468,011 B | 4,468,011 B | 2,327,524 B |
| V4 desktop WASM CPU per 25 ms (declared) | 0.016 ms | 0.44 ms | 1.60 ms | 0.33 ms | 1.60 ms | 1.60 ms | 0.44 ms |
| **verdict V1 · V2 · V3 · V4** | pass · **FAIL** · pass · pass | pass · **FAIL** · pass · pass | pass · **FAIL** · pass · pass | pass · **FAIL** · pass · **FAIL** | pass · **FAIL** · **FAIL** · pass | pass · **FAIL** · **FAIL** · pass | **FAIL** · pass · **FAIL** · pass |

The "onset median 0 ms" entries need care. The painted trace already lags
the audio by about 120 ms, so a detector has usually fired by the time the
trace starts. With the low thresholds that V1 forces, a 0 ms median says
little about speed.

## 4. Per candidate

Trade-off rows marked † come from the candidate runner's own sweep. The judge
re-scored those that can be scored from the existing probability files
(`judge/variant.py`, `judge/webrtc_point.py`); each reproduced exactly.
Unmarked trade-off rows were not re-checked.

### 4.1 Silero VAD v6.2.3

**What it is.**

- Official release tarball, sha256 `bc53dd74…f95b`.
- `silero_vad.onnx`, sha256 `1a153a22…88e3`, 2,327,524 B.
- Reference streaming: 16 kHz, 512-sample chunks plus 64 samples of past
  context, LSTM state carried from stream time 0.
- Licence: MIT. The LICENSE text is standard MIT; pyproject and CITATION
  also say MIT. A README badge's alt text says "CC BY-NC 4.0", but the badge
  shows MIT and links to the MIT LICENSE. It is leftover text, not a term.

**Operating point.** Threshold 0.0005–0.9 × hangover 0–90 s. Every
V1-admissible point needs a hangover of at least 30 s. The pick (0.002 /
45 s) works as a latch.

**Trade-offs** (V1 relaxed to X means clean sets ≤ X and noise cells
≤ max(3, X)):

| V1 relaxed to | best tuning V2 | all 279 / held-out A / B |
|---|---|---|
| 1–2 % | 11.79 % (0.002 / 45 s) † | 10.90 / 9.26 / 12.76 |
| 5 % | 14.95 % (0.005 / 45 s) | 13.30 / 10.27 / 16.33 |
| 10 % / 20 % | 19.09 / 21.73 % | — |

**Practical hangovers fail V1.**

- With a hangover of 5 s or less, the best achievable point has a worst clean
  set of 2.90 % and a worst noise cell of 60.3 % †. The judge re-scored
  0.0005 / 5 s: VocalSet 2.90 %, voice in noise at 0 dB with the 20 s lead
  60.29 %, and V2 only 39.4 %.
- At 2 s or less it is 8.07 / 72.9 %; at 300 ms or less, 23.3 / 86.7 %.

**By voice type** (Silero runner; mixes at 0.5 / 300 ms, share vetoed):

- FDA and PTDB-TUG speech: 0–0.6 % vetoed at +10 dB, 1–27 % at 0 dB.
- vocadito: 11–28 %.
- PVQD: 41–65 %.
- VOICED sustained /a/: 92–100 %.
- VocalSet held notes: 99.6–100 %.

**Desktop CPU** (onnxruntime-web 1.30.0 WASM, 1 thread): 0.38 ms per 25 ms in
headless Chrome 154 and 0.44 ms in Node 24 (the declared figure). WASM output
matches the CPU reference within 9.2e-6. Mobile, estimated: about 1–2 ms.

### 4.2 TEN VAD (TEN-framework/ten-vad @ 22a3bcd)

**What it is.** The official browser build, `ten_vad.wasm` plus its JS glue,
289 KB in total. It matches the native DLL within 6e-4. 16 ms hop, 80 ms
analysis span.

**Licence: rejected.** LICENSE sha256 `9d34f23e…59c9` is Apache-2.0 with
Agora "additional conditions", which the judge re-read:

1. No Deploy that competes with Agora's offerings or lets others compete,
   "including without limitation enabling any third party to develop or deploy
   Applications".
2. Deploy "solely" for your own Application(s) and their direct End Users.
3. Derivative works stay under these terms.

That is a restrictive addition, so V4 fails whatever the accuracy.

**Operating point.** Grid 26 × 21. The pick, 0.35 / 3 s, was bound by the
male 0 dB mix cells. Aggregation `max` was fixed before the sweep.

**Trade-offs:**

| reading | point | V2 tuning / 279 / A / B |
|---|---|---|
| bar (clean ≤ 1 %, mixes ≤ 3 %) | 0.35 / 3 s † | 10.0 / 9.9 / 9.6 / 11.5 |
| every row ≤ 2 % | 0.30 / 2 s | 7.0 / 6.5 / 5.6 / 7.3 |
| every row ≤ 5 % | 0.20 / 0 | 13.2 / 11.8 / 9.3 / 13.3 |
| library default 0.5, no hangover | † | 279 85.75 / A 82.32 / B 91.60 |

At the library default V1 collapses (re-scored by the judge):

- male mixes 33–57 % vetoed;
- PVQD + VOICED 11.8 %, VocalSet 4.7 %;
- 10.2 % of male onsets never shown.

**CPU:** 0.33 ms per 25 ms in headless desktop Chrome.

### 4.3 WebRTC VAD (the best candidate)

**What it is.**

- Reference: py-webrtcvad 2.0.10 API, run through the `webrtcvad-wheels`
  2.0.14.post1 build of the same C sources.
- Browser port: `@echogarden/fvad-wasm` 0.2.0, which is libfvad compiled with
  Emscripten (tarball sha256 `dc381f7d…ac7c`).
- The port's decisions equal the reference on every frame of all 4,305
  streams, in all 4 modes and at 10, 20 and 30 ms frames.

**Licence: BSD-3-Clause.** The judge re-read the libfvad / WebRTC LICENSE.
Google's PATENTS file is an extra royalty-free patent grant that ends only for
a party who sues; it restricts nothing.

**Size:** 35,491 B, with no weights file.

**Operating point.** The sweep covered 7,332 points: 156 decision variants
(4 modes × 10, 20 and 30 ms frames × last / max / k-of-w window) × 47
hangovers from 0 to 3 s. The pick, by the rule, is mode 2, 30 ms frames, at
least 1 of the last 3 frames, 1.25 s hangover. Mode 3 has no point that keeps
VocalSet ≤ 1 % at any hangover up to 3 s.

**Trade-offs:**

| V1 allowance | point | worst V1 row | V2 279 / tuning / A / B |
|---|---|---|---|
| bar | m2-f30-w90k1-h1250 † | VocalSet f 0.998 % | 13.14 / 11.32 / 16.50 / 12.58 |
| 2 % | m1-f30-w90k3-h75 † | VocalSet m 1.93 % | 19.93 / 18.15 / 23.19 / 17.51 |
| 5 % | m2-f20-w100k5-h125 † | VocalSet m 4.83 % | 27.31 / 24.25 / 32.91 / 27.30 |
| 10 % | m3-f30-w90k3-h0 | 8.00 % | 33.63 / 28.58 / 42.89 / 30.05 |
| none (V2 ceiling) | m3-f10-w100k10-h0 † | VocalSet m 33.35 % (FDA 2.99, PTDB 2.56, vocadito 4.93, mixes 7.5–10.9) | 47.17 / 41.77 / 57.08 / 47.91 |

**No point meets V2 even with V1 ignored.** The ceiling point fails on the
279 clips and on held-out B.

**What it leaves on screen.**

- The machine rooms are the weak spot: the GMM accepts their noise as speech.
  - Mains hum, microwave, refrigerator and generator: 0–0.75 % of the false
    line removed.
  - DCASE ToyCar: 0 %.
  - DCASE eval machines: 52.8 %.
- After real voice, the 1.25 s hangover keeps the gate open. Only 0.6–3.6 %
  of the false painting in gaps and tails is removed.

**Its weak spot on voice: held notes.** The adaptive noise model learns a held
tone as background. The worst streams:

| stream | vetoed |
|---|---|
| VocalSet female6 messa_u | 100 % |
| VocalSet female9 straight_a | 56 % |
| VocalSet female9 pp_u | 48 % |
| VocalSet male1 pp_u | 40 % |
| PVQD PT098 | 39 % |

**CPU:** 0.016 ms per 25 ms of audio in Node 24's V8 WebAssembly, the same
engine as Chrome. That is about 100× under the limit.

### 4.4 YAMNet (TF Model Garden `yamnet.h5`; ONNX port of the core network)

**What it is.**

- Voice score = the sum of 41 human-vocal AudioSet class scores. The class
  list was fixed before any output was seen.
- Deployable file: `yamnet_core_pw8d16.onnx`, 4,468,011 B. Pointwise
  convolutions are int8, the dense layer fp16.
- The fp32 model gives the same V2 within 0.3 pp, so quantization is not the
  cause of the failure.
- Licence: Apache-2.0 (tensorflow/models LICENSE; the runner diffed its body
  against the canonical Apache 2.0 text, the judge re-read its header).

**Hop.** 140 ms, the smallest hop that fits 1.8 ms per 25 ms on desktop WASM:

| hop | Node | Chrome |
|---|---|---|
| 120 ms | 1.86 ms | 1.74 ms |
| 140 ms | 1.60 ms | 1.41 ms |

Mobile, estimated: 3–7 ms per 25 ms, over budget.

**Variants.**

- **Frame gate:** the 975 ms patch with a hangover under 1 s.
- **Context gate:** "a voice was around in the last 8 s".
- **95 ms window:** 8 rows of audio and 88 rows of silence. This is the only
  variant inside V3, and it has the weakest discrimination.
- A genuinely short input gives out-of-distribution output: medians of
  0.29–0.44 for noise and voice alike.

**Trade-offs, V2 tuning / 279 / A / B:**

| reading | frame gate | context gate |
|---|---|---|
| bar | 14.7 / 12.8 / 9.2 / 9.6 † | 27.5 / 24.8 / 19.8 / 24.6 † |
| every row ≤ 2 % | 9.8 / 8.9 / 7.3 / 6.0 | — |
| V1 at 5 % | 20.9 / 18.1 / 13.0 / 16.6 (0.002 / 320 ms) | 37.9 / 35.7 / 31.6 / 33.0 (0.03 / 8 s) |

**Where it reaches V2** (judge re-scores, post-hoc, never a selection):

| point | V2 279 / A / B | V1 cost (worse gender) |
|---|---|---|
| frame gate 0.02 / 800 ms | 57.77 / 51.85 / 59.38 | 0 dB mixes 14.5–14.8 %, +10 dB 3.6 %, PVQD + VOICED 2.7 % |
| context gate 0.07 / 8 s | 57.88 / 53.25 / 54.48 | 0 dB mixes 7.1 / 8.7 %, PVQD + VOICED 2.1 %, VocalSet 1.3 % |
| **context gate 0.08 / 8 s** | **60.61 / 56.58 / 56.98** (V2 pass) | 0 dB mixes m 7.59 / 9.15 % (f 4.5 / 5.8), PVQD + VOICED f 2.28 %, VocalSet f 1.48 %, +10 dB m 1.4–1.5 % |
| context gate 0.10 / 8 s | 64.62 / 60.78 / 63.26 | 0 dB mixes m 8.6 / 11.1 %, PVQD + VOICED 3.5 % |

**Context gate at 0.08: the only point that passes V2 on all three sets.**

- It fails V1, with a male-leaning cost in noise, and fails V3 latency by
  construction.
- It removes only 0.5–14 % of the false painting in the gaps and tails next
  to voice: the gate is still open from the speech.
- The classes it removes well are stationary-tonal 72.8 %, microwave 79.9 %
  and generator 87.5 %. It removes less of mains hum (52.5 %) and
  intermittent-tonal (33.8 %).

**Caveat on the noise set itself** (reported by the YAMNet runner, not
re-checked). Six DEMAND scenes in the 279 clips contain real background
talkers: restaurant, cafeteria, bus, square, meeting room. YAMNet's top class
is Speech on 59–100 % of their falsely painted hops: 7,398 of the 122,436 false
hops, or 6 %. A "voice present" gate cannot remove them by design; excluding
them would not change any verdict.

## 5. Judge's verification

| check | what | result |
|---|---|---|
| re-score, all candidates | `score.py` (unchanged since 7cd4e86) over the candidates' probability files: the seven selected / information points, the WebRTC 2 % and 5 % points, and eight post-hoc points via `judge/variant.py` (incl. the WebRTC V2 ceiling) | every headline and every † number reproduces exactly at the printed precision |
| Silero, re-run the model | own streaming loop (onnxruntime 1.25.1 CPU, 1 thread) on 22 seeded streams, 2 per set, at 16 / 20 / 44.1 / 48 kHz | 16,803 frames, max \|Δp\| = 0 (bit-identical); model and tarball sha256 match |
| WebRTC, re-run the reference | py-webrtcvad (wheels build), own frame loop and own p derivation, on the same 22 streams | 17,921 frames identical |
| WebRTC, re-run the browser port | `fvad-wasm` 0.2.0 in V8 on the same int16 input | 17,921 frames identical |
| YAMNet, re-run the model | the runner on 6 streams (noise, held-out B, VocalSet, FDA, voice in noise, PVQD), deployable model sha256 checked | identical for the frame and context gates |
| causality | cut each stream at a random sample (16 / 20 / 44.1 / 48 kHz); every frame declared available before the cut is recomputed from the cut audio | Silero and WebRTC: max \|Δp\| = 0 (the 1 ms margin covers the ≤ 0.63 ms resampler look-ahead) |
| licences | read: Silero MIT; libfvad / WebRTC BSD-3-Clause + PATENTS grant; TEN Apache-2.0 + Agora conditions (sha256 `9d34f23e…`); tensorflow/models Apache-2.0 (sha256 `5b17814b…`) | as declared |
| not re-measured | desktop WASM CPU figures (they are the runners' declarations) | not decisive: no candidate passes V2 |

## 6. Limits

- **The noise-only clips measure only the cold case**: nobody has spoken
  recently. Every gate with a hangover of 1 s or more stays open in the
  pauses of a live session. The "false hops next to voice" rows show this:
  the candidates remove 0–17 % there. A candidate that passed V2 would still
  need the after-speech rows (G3 below) before it could matter in use.
- **Non-16 kHz streams were resampled** with scipy polyphase (WebRTC, Silero,
  YAMNet) or the app's sinc resampler (TEN), not the app's linear worker
  resampler. WebRTC's V1 margin is a single hop, so the resampler choice could
  flip its V1 row. It cannot change the V2 verdict.
- **Mobile CPU is estimated** for every candidate, which V4 allows.
- **The mixes' 20 s lead and lead 0 are both scored**, so the case where the
  voice starts with the stream is included.

## 7. Phase 2

**Not started: no candidate is viable.** If a future candidate passes this
bar, phase 2 would:

- integrate it where it can see the capture chunks: a new worker, or the pitch
  worker for a pure-WASM detector;
- gate fresh painting and the hold bridge first; the readout and the gender
  meter's VAD only after their own guards;
- keep a hangover short enough for G3, and fail open when it stalls or falls
  behind;
- be measured on mobile WASM before shipping (every CPU figure here is
  desktop);
- be judged on the gap-bridge rule's guards G1–G7, measured through the real
  hook, plus the V2 goal. G3 (noise right after speech) is the clause this
  benchmark shows to be the hard one.

Options the evidence leaves open, none measured here:

1. **Stop here.** The false line on real machine noise stays at about 24 %
   clip-mean. The hold-bridge and notch notes already record the display-side
   attempts.
2. **Accept a weaker bar.** The table above prices the trade:
   - about 20 % removal for ≤ 2 % voice loss on held notes (WebRTC);
   - about 27 % for ≤ 5 %;
   - ≥ 60 % only with 7.6–9.2 % male voice loss at 0 dB plus a 975 ms
     window (YAMNet context gate).
3. **A purpose-built detector.** This means training a small model on voice
   including held notes, sustained and dysphonic vowels, and singing, against
   machine-room noise. It is a new project with its own pre-registration. It
   would need noise training data disjoint from all three noise sets here
   (279, 119, and the mixes' noise), so the held-out sets stay clean.

## 8. Reproduction (repo root)

The dumps come from the harness note. The candidate directories under
`build/vad/` come from the runners.

```bash
python scripts/voice-detector/score.py build/vad/webrtc/cand/webrtc-m2-f30-w90k1-h1250 silero --json=build/vad/judge/rescore-webrtc-silero.json
python scripts/voice-detector/score.py ten yamnet yamnet-ctx yamnet-95ms silero-default --json=build/vad/judge/rescore-others.json
python scripts/voice-detector/score.py build/vad/webrtc/cand/webrtc-m2-f20-w100k5-h125 build/vad/webrtc/cand/webrtc-m1-f30-w90k3-h75
python scripts/voice-detector/judge/tables.py build/vad/judge/rescore-webrtc-silero.json build/vad/judge/rescore-others.json \
  --order=webrtc-m2-f30-w90k1-h1250,silero,yamnet-95ms,ten,yamnet,yamnet-ctx,silero-default
python scripts/voice-detector/judge/spot.py --det=silero                       # needs onnxruntime
<venv>/python scripts/voice-detector/judge/spot.py --det=webrtc                # needs webrtcvad(-wheels), scratch venv
FVAD_WASM_JS=<scratch>/node_modules/@echogarden/fvad-wasm/fvad.js node scripts/voice-detector/judge/spot-wasm.mjs
python scripts/voice-detector/judge/webrtc_point.py --mode=3 --fl=10 --w=10 --k=10 --hang=0
python scripts/voice-detector/judge/variant.py build/vad/judge/cand/webrtc-m3-f10-w100k10-h0 0.95 0 \
  yamnet-ctx 0.07 8000 yamnet-ctx 0.08 8000 yamnet-ctx 0.1 8000 silero 0.0005 5000 ten 0.5 0 yamnet 0.02 800 \
  --json=build/vad/judge/variants.json
```

## Process notes

- **Never use `chrome.exe --version` on Windows.** It does not print a
  version; it starts a full browser on the default profile. This happened
  twice during the candidate runs. Each time the instance was closed by its
  own PID, with no name-based kill. Read the version from the headless
  instance's user agent instead.
- **No PR was opened**, and no weights were committed.
