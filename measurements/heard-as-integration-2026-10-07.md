# "Likely heard as" with the speech detector: built-app check and CPU per worker — 2026-10-07

This note covers the `cue-strip` integration of 2026-10-07. Three branches
were merged into it:
- `cue-strip-cpu`: the 450 ms classifier hop, adopted by user decision F.
- `voice-direction`: the Silero speech-detector gate, the whisper voicing
  requirement (off by default) and the self-hosted ONNX Runtime.
- `resonance-perf`: the resonance cue CPU pass.

In `voice-direction` the speech detector fed an always-on meter. In
`cue-strip` that meter is gone. The gender worker (and with it the detector)
runs **only while the opt-in "Likely heard as" panel is on**. The utterance
gate still decides every 150 ms, the detector still runs per 32 ms frame, and
the classifier runs every 450 ms.

The note answers two questions:
1. In the built app with the panel on, are the windows gated by speech? Does
   whisper get a reading? Does music?
2. What does each worker cost in desktop Chrome with the panel off and on?

Public data only:
- LibriSpeech test-clean (CC BY 4.0);
- EARS whisper (CC BY-NC 4.0);
- MUSDB18 excerpts (CC BY 4.0, the speech-gate probe set).

Scratch tooling, not committed: `gate-probe.mjs` (described in §1) and
the run outputs.

## 1. Built app, panel on: what is gated, what gets a reading

**Method.** Each run uses the built app (`vite preview`), headless Chrome 154
with a temporary profile and `?diag=1`. A WAV is the fake mic (looped). The
training direction is "just exploring". The panel is switched on and the run
waits for the voice model. Then it records, for 70 s (100 s for the phonated
whisper):
- every gender-worker message: `score` = classified window, `scored` =
  window scored between classifier runs, voice-state and speech-detector
  status. These are tapped by wrapping `window.Worker` in the page;
- the panel's DOM state every 250 ms: shown, or the hide reason.

Each clip is run twice:
- **detector**: the shipped app;
- **no detector**: the Silero model request is failed through CDP
  `Fetch.failRequest`. Only that URL is touched. The gate then falls back
  to the pitch-voicing gate, as when the detector is loading or has failed.

The contrast shows which windows the detector gates.

Clips (48 kHz mono):
- speech: three LibriSpeech test-clean women (121, 1221, 1284) and three men
  (1089, 1188, 1320), about 30 s each;
- unphonated whisper: the first three EARS women (p002, p003, p011) and the
  first three EARS men (p007, p023, p031) of the whisper-probe set. Praat
  finds 0.2–7.3 % voiced (phonated) time in these clips;
- phonated whisper: the five EARS women whose "whisper" Praat finds 33–46 %
  voiced (p027, p033, p062, p064, p104);
- music at 0 dB re speech level, nobody at the mic: `mi0` (instrumental) and
  `mv0` (with vocals).

| clip | detector | windows scored / s | classified / s | panel shown (share of samples) | main hide reasons |
|---|---|---|---|---|---|
| speech, women | ready | 5.17 | 1.77 | **90.6 %** | short (start of each utterance) |
| speech, women | none (pitch gate) | 4.99 | 1.74 | 91.3 % | short |
| speech, men | ready | 5.01 | 1.76 | **87.2 %** | short |
| speech, men | none (pitch gate) | 4.43 | 1.56 | 80.6 % | short |
| whisper, women | ready | 3.61 | 1.29 | **0 %** | short (no voiced pitch) |
| whisper, women | none | 0.33 | 0.14 | 0 % | stale / short |
| whisper, men | ready | 3.23 | 1.17 | **0 %** | short |
| whisper, men | none | 0.14 | 0.07 | 0 % | listening / stale |
| phonated whisper, 5 women | ready | 4.05 | 1.43 | **54.0 %** | short |
| music, instrumental 0 dB | ready | **0** | 0 | **0 %** | listening / sustained |
| music, instrumental 0 dB | none | 3.70 | 1.33 | 34.3 % | short |
| music with vocals 0 dB | ready | **0.13** | 0.06 | **0 %** (one run; see the correction below) | stale |
| music with vocals 0 dB | none | 4.41 | 1.57 | 60.0 % | short |

**Correction (2026-10-07 review).** The music-with-vocals row is a single
70 s run. The review re-ran the same harness on the same build three times:
0.53, 0.27 and 0.57 windows scored per second, and the panel showed a
reading on 8.8 % of the samples in one run (about 4 s; windows at 2.8–7.8 s
of audio), 0 % in the other two. Offline (heard-as-voiced-windows-2026-10-08.md,
12 MUSDB18 streams per cell, nobody at the mic) music with vocals at 0 /
−10 dB got 0 % on every stream and at −20 dB one of 12 streams got 32 %.
So music with vocals gets **rare, short readings**, not none; the panel's
"singing … not detected" text covers it. **Mixed speech and whisper:**
whisper on its own gets no reading, but until 2026-10-08 whispered stretches
*between* voiced speech fed the reading (21 / 22 % of the pooled logits,
women / men); the voiced-windows rule (heard-as-voiced-windows-2026-10-08.md)
cuts that to 1.0 / 0.5 %.

**Findings.**
- **Windows are gated by speech.** With the detector ready, every scored
  window was in the gate's `gated` mode, and music windows are almost never
  scored: 0 and 0.13 per second, against 3.7 and 4.4 per second on pitch
  voicing alone. The panel showed no reading on music in this run (other
  runs: rare, short readings with vocals — correction above). Without the
  detector it showed one on 34 % and 60 % of the samples.
- **Speech coverage stays the same or improves.** With the detector, the
  panel showed on 90.6 % (women) and 87.2 % (men) of the speech samples,
  against 91.3 % and 80.6 % without it. The rest is the "keep talking" hide
  at each utterance's start.
- **Unphonated whisper gets no reading, but it is still classified.** The
  speech detector hears whisper, and the whisper voicing requirement
  (`speechMinVoicedMs` / `speechMinVoicedRunMs`) is off by default
  (whisper-voicing-2026-10-07.md, verdict FAIL). So the gate scores 3.2–3.6
  windows per second of whisper, and the classifier runs on them (1.2–1.3 per
  second, CPU spent). The panel never shows them: it needs ≥ 3 s of posted
  voiced pitch in its 8 s pool (`minVoicedMs`). Unphonated whisper has none,
  so the panel stays at "keep talking" (`short`).
- **Phonated whisper is shown about half the time.** For the five EARS women
  who phonate through their "whisper" (33–46 % voiced), the panel showed a
  reading on 54 % of the samples. This matches the user's rule A ("score
  only stretches with SOME voiced (pitched) sound"): their voiced stretches
  are scored. A user who expects no reading for any whisper would see these
  readings.
- **The detector is cheap and runs only with the panel on.** Per classified
  window, the detector ran 16–18 ms. That covers about 450 ms of audio (14
  frames, ~1.2 ms each). Classifier inference took a median 79–95 ms at this
  load.
- **Hosts.** With the panel on: the app origin (including the ONNX Runtime
  WASM, `ort-wasm-simd-threaded.asyncify-*.{mjs,wasm}` from `assets/`),
  `huggingface.co` and `us.aws.cdn.hf.co`. No jsDelivr request. With the
  panel off, the app fetched no model and no ONNX Runtime file at all (the
  `chrome-cpu.mjs` runs below record the files).

**Equivalence with the calibration.** `tests/ml/heard-as-equivalence-test.js`
(22 / 22) and `tests/ml/heard-as-test.js` (47 / 47) pass on the merged tree.
They check that the live aggregation equals the calibration's fit-time
definition, plus the window-set guard. That guard replays `decideMlWindow` on
pitch hints. **Not re-checked:** the form-A constants were fitted on windows
chosen by the pitch-voicing gate. The live panel now pools windows chosen by
the speech detector. On clean speech the two sets mostly coincide: the
scored-window rate is within 0.2 / s for women and 0.6 / s for men (table
above). In noise, they differ by design. A `run_chain.mjs` re-run with the
detector in the loop, then a re-check (or refit) of the constants, is open
work (CLAUDE.md heard-as rule).

## 2. CPU per worker, panel off and on (desktop Chrome)

**Method.** `scripts/resonance/chrome-cpu.mjs`: the built app, Chrome 154
headless, `?diag=1`, the fake mic playing `build/cue-strip-smoke/speech-
{woman,man}.wav` (LibriSpeech test-clean readers). Thread CPU per audio
second comes from a 30 s Chrome trace taken after 20 s of listening (panel
on: after the voice model is ready). The four configurations (woman / man ×
panel off / on) ran interleaved, twice each. Every run is valid: capture kept
real time (0.99–1.01×), and there were no resonance overloads. Other jobs
were loading this PC, so absolute numbers are inflated. Compare within this
table.

ms of thread CPU per second of audio:

| run | main | gender worker (+ speech detector) | resonance worker | pitch worker | DSP worker | app total | renderer process | inferences / s (median ms) |
|---|---|---|---|---|---|---|---|---|
| woman, off (1 / 2) | 314 / 300 | — | 26.6 / 23.2 | 36.4 / 33.8 | 35.9 / 31.6 | 413 / 388 | 596 / 586 | — |
| woman, on (1 / 2) | 355 / 323 | 197 / 175 | 27.8 / 24.1 | 36.8 / 34.1 | 37.4 / 32.8 | 654 / 589 | 862 / 807 | 1.85 (111) / 1.88 (80) |
| man, off (1 / 2) | 335 / 308 | — | 27.3 / 25.2 | 38.2 / 35.9 | 34.8 / 32.0 | 435 / 401 | 630 / 595 | — |
| man, on (1 / 2) | 337 / 327 | 174 / 164 | 25.0 / 24.2 | 37.4 / 36.2 | 33.1 / 32.0 | 607 / 584 | 822 / 800 | 1.72 (89) / 1.75 (84) |
| **median, off** | **311** | — | **25.9** | **36.1** | **33.4** | **407** | **596** | — |
| **median, on** | **332** | **175** | **24.6** | **36.5** | **33.0** | **598** | **814** | ~1.8 |

- **The panel adds about +190 ms of app CPU per audio second** (407 → 598).
  Almost all of it is the gender worker (175 ms/s), which hosts both the
  classifier (every 450 ms) and the speech detector (every 32 ms frame). The
  other workers do not change with the panel on.
- **Compared with the earlier figures:** heard-as-cpu-2026-10-07.md measured
  the gender worker at 383 ms/s at the old 150 ms hop, with no detector. At
  the 450 ms hop it was about −63 %, before the detector was added. Now it is
  175 ms/s with the detector. These runs used different machine loads, so
  the gap between them is indicative only.
- **The resonance worker is ~25 ms/s, panel off or on.** That is about half
  the pre-pass ~51 ms/s from the review-round-2 re-measure, consistent with
  resonance-cue-cpu-2026-10-07.md (0.44× in desktop Chrome). Phone not
  re-measured.
- **The main thread (~310–330 ms/s) remains the largest consumer.** No pass
  so far has covered it.

### 2b. Re-measure without the diag overlay (2026-10-08, review fix)

The table above ran under `?diag=1`, which adds the overlay and its
instrumentation; the review found that inflates the main thread by about
45 ms/s. Re-run on the fixed `cue-strip` build (voiced-windows rule, the
new panel text; nothing on the audio path changed), `chrome-cpu.mjs` with
`--diag=0` (the production URL) and `--diag=1`, interleaved: woman / man ×
panel off / on × diag 0 / 1, two runs each (16 runs, capture 1.00× real
time in every run, no resonance overloads). The machine was less loaded than
in §2, so compare within this table. Median ms of thread CPU per audio
second:

| | main | gender worker | resonance | pitch | DSP | compositor | app total (main + 4 workers) | renderer process |
|---|---|---|---|---|---|---|---|---|
| panel off, **diag=0 (production)** | **139** | — | 16.5 | 25.9 | 23.9 | 53 | **205** | 313 |
| panel off, diag=1 | 172 | — | 16.8 | 25.8 | 23.9 | 60 | 240 | 363 |
| panel on, **diag=0 (production)** | **153** | **115** | 17.4 | 27.2 | 24.8 | 58 | **337** | 462 |
| panel on, diag=1 | 184 | 116 | 17.5 | 27.0 | 25.2 | 63 | 370 | 509 |

- **Production (diag=0) is ~14 % lower than the diag=1 figures** for the
  app total (205 vs 240 off, 337 vs 370 on); the overlay costs the main
  thread ~31–33 ms/s. The production claim is the diag=0 row.
- **The panel adds ~130 ms/s of app CPU in production** (205 → 337), ~115
  of it the gender worker (classifier every 450 ms + speech detector).
- **The main thread is still the largest consumer** (139–153 ms/s in
  production, plus ~55 ms/s on the compositor thread). No pass has covered
  it yet; a pre-registered main-thread / render pass (with
  `chrome-cpu.mjs --main-profile`) is the next CPU item before the phone
  re-validation.

## 3. Open

- **Done 2026-10-08:** the heard-as constants were re-checked on the
  speech detector's windows and hold
  (heard-as-voiced-windows-2026-10-08.md, Part A).
- **Done 2026-10-08:** only windows with ≥ 200 ms of voiced pitch feed the
  reading, so whispered stretches between voiced speech no longer count
  (same note, Part B). Unphonated whisper is still classified (CPU while the
  panel is on), never shown. Phonated whisper is shown about half the time,
  as decision A asks.
- **Done 2026-10-08:** the "More" line on noise was re-worded from this
  panel's own hide rules (same note: men's readings are hidden more in
  noise and on phone / laptop channels — the ≥ 3 s voiced-pitch rule).
- Phone: not re-measured with the merged tree.
- Main thread (~140–150 ms/s in production on desktop, more on a phone):
  not yet profiled or reduced (§2b).
