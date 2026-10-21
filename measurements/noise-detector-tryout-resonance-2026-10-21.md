# Noise-detector try-out: gate the resonance row too? (2026-10-21)

Branch `noise-detector-tryout-res` (from `noise-detector-tryout`, c24a6be).
Public data and synthetic stimuli only.

## Why

User report, 2026-10-21, trying the FireRedVAD try-out on the PC: with no
speech, only PC fans and GPU coil whine, the pitch line is hidden as it
should be, but the Dashboard's resonance row ("Resonance · approx.") moves
around and shows "beyond the scale" at the brighter end.

Cause: the resonance worker (`src/resonance/resonance-worker.js`) takes the
pitch worker's posted `voiced` / `pitch`, relayed by `useAudioPipeline` as
a `pitch-hint`. Its utterance gate (`resonanceCue.js` +
`src/ml/utterance-gate.js`) only keeps out held phonation. So a wandering
tonal noise that the pitch worker voices becomes vtln bins and moves the
readout. The try-out's voice gate hides only the pitch display.

## Plan (fixed before any result)

**Candidate (GATED).** The hook's `pitch-hint` to the resonance worker
carries `voiced: false` on every hop whose detector decision is "no voice"
while the setting is on. `pitch` and `contextTime` are unchanged. Hops with
no decision (detector loading / missing / off / slow) are unchanged. The ML
and DSP hints are unchanged. **BASE** = today's hint.

**Driver.** `scripts/resonance/voice-gate-resonance.mjs` (new):

- the REAL pitch worker in Node (fake `self`), with the real FireRedVAD
  model through the worker's test seam `setVadModelLoaderForTests` (the same
  ORT-web WASM session the app builds; model ready before the first chunk —
  in the app it loads in well under a second and hops before that carry no
  decision);
- the REAL resonance worker (fake `self`, `fetch` reading `public/`), fed
  the same 48 kHz audio in 1200-sample chunks, each chunk followed by that
  chunk's pitch hints (relay delay 0), run twice per stream: BASE hints,
  then GATED hints (a fresh `init` each time);
- a "position" = a worker `state` post (every 0.2 s of audio) with
  `u !== null` — the dot the row can show. Fresh start per stream.
- The run stops if the detector ever reports "slow" or "error".

**Audio.** Everything resampled to 48 kHz (scipy `resample_poly`), level
as is. Clips shorter than 20 s are joined in id order within their set and
class into streams of at least 30 s.

| Set | What |
|---|---|
| N1 tuning noise | the 2026-10-20 screen's tuning-194 noise clips (split "tune", branch `voice-detector` build data), per class: stationary-tonal / mixed / broadband / intermittent-tonal |
| N2 fresh noise | the confirmation run's fresh noise (175 clips: Freesound computer / fans / fridge / hvac / mains / traffic, DCASE 2025 machines), per class |
| S1 LibriSpeech | test-clean, the resonance lab's r1_test readers (20 women, 20 men); each reader's utterances in order until ≥ 60 s |
| S2 PTDB-TUG | mic signals, 20 speakers (10 / 10), each speaker's sentences joined (native 48 kHz) |
| S3 FDA | 2 speakers (1 / 1), 50 utterances each, joined |
| H1 held, synthetic | the 24 synthetic 4 s holds of `scripts/resonance/gating.mjs` (after 0.5 s of silence) |
| H2 held, real | PVQD sustained /a/ and /i/ (annotated holds), voices with CAPE-V severity ≤ 15 |
| D1 speech then noise | information only: 10 LibriSpeech readers' first 30 s, then 30 s of an N2 fan / computer / hvac clip |

**Metrics.**

- Noise: share of posts with a position, BASE vs GATED, pooled (time
  weighted) and per class; reduction = 1 − GATED / BASE.
- Speech, per sex (S1–S3 pooled; per corpus shown too):
  - |Δu| = |u GATED − u BASE| on posts where both have a position: median,
    p95;
  - time to first position (from the stream start), GATED − BASE, median
    over streams (a stream where GATED never shows a position but BASE does
    is reported and counts as a fail of that sex);
  - share of posts with a position.
- Held: H1 — positions per hold stream, bins admitted, share of the hold
  after its first second with verdict "sustained" (information); H2 — vtln
  bins admitted during annotated holds (the worker's diag counters).
- D1: how far the readout moves during the noise part (max − min of u),
  BASE vs GATED. Information only.

**Pass bar.** All of:

1. Speech, each sex: median |Δu| ≤ 0.02 and median time-to-first-position
   increase ≤ 0.5 s.
2. Noise only (N1 + N2 pooled): GATED shows a position at least 80 % less of
   the time than BASE. Per set and per class shown, not judged.
3. Held vowels still excluded: GATED shows a position on no H1 stream, and
   admits no more H2 hold bins than BASE.

Pass → implement on this branch (gate the resonance worker's hint in the
hook; detector missing / off / slow → exactly today's behaviour), with a
hook unit test that fails on the old code. Fail → no implementation; this
note reports.

**Private check.** The user's own room recording (fans + coil whine) runs
through the same driver, descriptive only; its results are kept outside
this repository.

## Results

(pending)
