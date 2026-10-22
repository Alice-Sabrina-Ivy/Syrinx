# Noise-detector try-out: gate the resonance row too? (2026-10-21)

Branch `noise-detector-tryout-res` (from `noise-detector-tryout`, a9ebe95).
Public data and synthetic stimuli only.

**Note 2026-10-21:** branches `noise-detector-tryout` (merged; its commits remain in
`cue-strip`'s history) and `voice-detector` were deleted on 2026-10-21 by the owner's
decision. `voice-detector`'s worktree `build/` data (set N1 and the `--vad-build` input
of the reproduce steps) were not kept.

**User decision (2026-10-21): build it anyway.** The resonance-hint gate is
built exactly as measured here (the "GATED" hint below) at **73 %** less
noise-only position time — the pre-set 80 % bar was missed — with speech
unchanged (median |Δu| 0.000 for both sexes, +0.00 s to the first position)
and held vowels still excluded. It went into `cue-strip` with the voice gate
on 2026-10-21 (branch `firered-merge`; hook test
`tests/audio/voice-gate-resonance-hint-test.js`, browser check in
`scripts/voice-gate-smoke.mjs`). The plan, verdict and results below are
unchanged.

**Correction (2026-10-21, later):** "position" below is the resonance
worker's stored u, not the dot the row draws; "beyond the scale" counted
only the vtln clamp; and "the dot stays for the rest of the clip" is wrong
for the drawn dot. The figures are unchanged (re-run: identical). Corrected
wording and the drawn-dot figures: §"Correction (2026-10-21)" at the end.

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

**Verdict: FAIL** (noise). Speech and held vowels pass; noise-only time
with a position falls 73.2 %, short of the 80 % bar. **Nothing is
implemented**; the try-out is unchanged. (Built anyway by user decision
2026-10-21 — top of this note.)

Run: 462 streams, 7.7 h of audio, every pitch message with a detector
decision (none late). Under machine load the first attempt of one noise
stream tripped the detector's "slow" switch (a wall-clock safeguard); the
driver now runs such a stream again, and no stream in the final rows
needed it.

Changes from the plan, made while preparing the audio, before any result:
the local PTDB-TUG copy has 4 speakers (2 / 2), not 20, so each speaker's
sentences (and each FDA speaker's utterances) are split, in order, into
streams of ≥ 60 s (S2 17, S3 5 streams); the H2 check counts the voiced time
admitted to the readout (a stamped bin without a value carries none)
instead of bins; D1's ten noise clips are all Freesound "computer" clips
(the first ten fan / computer / hvac clips in id order).

### Noise only (judged: N1 + N2 pooled)

| set | streams | audio s | voiced hops hidden | position BASE | GATED | reduction |
|---|---|---|---|---|---|---|
| N1 broadband | 22 | 1810 | 85.8 % | 21.7 % | 13.6 % | 37.3 % |
| N1 intermittent-tonal | 8 | 782 | 81.6 % | 29.3 % | 4.8 % | 83.7 % |
| N1 mixed | 76 | 6912 | 74.7 % | 38.8 % | 13.2 % | 66.0 % |
| N1 stationary-tonal | 60 | 4565 | 72.2 % | 56.2 % | 13.0 % | 76.9 % |
| **N1 pooled** | 166 | 14069 | 74.6 % | 41.7 % | 12.7 % | 69.6 % |
| N2 computer | 10 | 696 | 84.2 % | 7.3 % | 0.0 % | 100 % |
| N2 fans | 15 | 901 | 42.0 % | 36.5 % | 13.8 % | 62.3 % |
| N2 fridge | 15 | 1165 | 97.9 % | 54.6 % | 1.5 % | 97.2 % |
| N2 hvac | 9 | 699 | 51.5 % | 0.0 % | 0.0 % | — |
| N2 mains | 15 | 856 | 85.8 % | 32.2 % | 6.8 % | 78.9 % |
| N2 traffic | 15 | 1255 | 81.0 % | 18.6 % | 2.4 % | 87.1 % |
| N2 DCASE 2025 machines (8 classes) | 24 | 768 | 88.1 % | 26.4 % | 2.0 % | 92.4 % |
| **N2 pooled** | 103 | 6341 | 77.9 % | 27.3 % | 3.9 % | 85.8 % |
| **N1 + N2 pooled (judged)** | 269 | 20410 | 75.4 % | 37.2 % | 10.0 % | **73.2 %** |

("voiced hops hidden": share of the pitch worker's voiced hops that the
detector called "no voice", i.e. that GATED sends as unvoiced.)

Why it falls short:

- **A position, once there, stays.** The readout is a window of voiced
  time; it freezes, it does not clear. So a few seconds of noise that get
  through give a dot for the rest of the stream. A position ever shown:
  128 of 269 streams BASE, 30 GATED. In a stream where the detector hid
  93 % of the voiced noise hops (a hair dryer), the rest still gave a
  position after 32 s, and it stayed for 73 % of the clip.
- **Noise the detector hears as voice.** The 30 streams are mostly DEMAND
  recordings of places with people in them (restaurant, metro, public
  square — the only DEMAND streams with a GATED position: 31 % of the
  GATED position time) and steady tonal sources
  FireRedVAD scores as voice (a light ballast, a refrigerator, two hvac
  clips, some fans and mains hums; 4 streams get a position within 5 s).

Information: the share of noise time the dot sits at the clamp ("beyond
the scale") falls from 5.0 % to 1.2 %; the share of noise time it moves
(> 0.01 u between 0.2 s posts) from 3.3 % to 0.8 %.

### Speech, per sex (judged pooled; median |Δu| ≤ 0.02, time to first position +≤ 0.5 s)

| | streams | median \|Δu\| | p95 \|Δu\| | first position BASE (median) | GATED − BASE (median) | largest increase | GATED never | position share BASE / GATED | voiced hops hidden |
|---|---|---|---|---|---|---|---|---|---|
| women S1 LibriSpeech | 20 | 0.000 | 0.000 | 5.0 s | 0.00 s | 0.67 s | 0 | 92.8 / 92.7 % | 0.1 % |
| women S2 PTDB-TUG | 9 | 0.000 | 0.000 | 11.9 s | 0.00 s | 0.00 s | 0 | 82.3 / 82.3 % | 0.0 % |
| women S3 FDA | 3 | 0.000 | 0.000 | 7.9 s | 0.00 s | 0.00 s | 0 | 88.1 / 88.1 % | 0.0 % |
| **women** | 32 | **0.000** | 0.000 | 5.6 s | **0.00 s** | 0.67 s | 0 | 89.4 / 89.3 % | 0.1 % |
| men S1 LibriSpeech | 20 | 0.000 | 0.000 | 5.6 s | 0.00 s | 0.00 s | 0 | 91.3 / 91.3 % | 0.0 % |
| men S2 PTDB-TUG | 8 | 0.000 | 0.014 | 14.7 s | 0.00 s | 0.00 s | 0 | 79.6 / 79.6 % | 0.1 % |
| men S3 FDA | 2 | 0.000 | 0.000 | 6.1 s | 0.00 s | 0.00 s | 0 | 92.0 / 92.0 % | 0.0 % |
| **men** | 30 | **0.000** | 0.000 | 6.3 s | **0.00 s** | 0.00 s | 0 | 87.9 / 87.9 % | 0.0 % |

Speech: PASS. The detector hides almost no voiced speech hop, so the
readout is unchanged.

### Held vowels

- H1 (24 synthetic holds): a position on no hold, BASE or GATED; at most
  0.13 s (BASE) / 0.08 s (GATED) of a hold's voiced time reaches the
  readout. The detector hides 91 % of the holds' voiced hops, so the
  utterance gate no longer sees them: the verdict "sustained" covers 100 %
  of the hold after its first second in BASE, 0 % in GATED. **Now live
  (built 2026-10-21):** with the gate on, the row says "keep talking…" on
  such a hold instead of "needs running speech". (Written before the build
  as "Had this been built, the row would say …".)
- H2 (97 PVQD recordings, 579 s of annotated holds): voiced time admitted
  to the readout inside the holds 65.9 s BASE, 64.5 s GATED.

Held: PASS (still excluded).

### Speech, then noise (information)

Ten readers' first 30 s, then 30 s of a computer-noise clip: the position
is shown through the whole noise part in both arms (the readout keeps the
reader's value). It moves by at most 0.71 u (median 0.015) in BASE and
0.14 u (median 0.000) in GATED.

### Private check

On the user's own room recording (fans and coil whine, 60 s; results kept
outside this repository) BASE showed a position most of the time and GATED
none.

### Not done

Nothing was implemented (plan: fail → report; built afterwards by user
decision 2026-10-21, top of this note). The hint change, its hook
test and the smoke extension were drafted and are not committed. What the
numbers point at, untested: the stickiness, not the hint, is most of the
remaining noise time — for example clearing the resonance position after a
long stretch the detector calls "no voice" would need its own measurement.

## Correction (2026-10-21)

Re-run on regenerated audio with the same driver (now
`voice-gate-resonance.mjs --row`, which also drives the real DSP worker,
the hook and the row logic of `cueStripModel.js`; details in
[voice-gate-resonance-row-2026-10-21.md](voice-gate-resonance-row-2026-10-21.md)).
The tables above reproduce exactly (37.2 % → 10.0 %, 73.2 %; clamp 5.0 % →
1.2 %). Below, BASE = the ungated hint and GATED = the gated hint (as
built), both with the row on the raw pitch display flags, per 25 ms of
noise-only audio (N1 + N2, 269 streams).

1. **"Position" was the worker's stored u, not the drawn dot.** The row
   draws the dot only while its state allows one (the raw pitch display
   voiced or holding, and the readout warm).

   | | worker position BASE | GATED | less | drawn dot BASE | GATED | less |
   |---|---|---|---|---|---|---|
   | N1 | 41.6 % | 12.7 % | 69.6 % | 22.7 % | 7.9 % | 65.3 % |
   | N2 | 27.1 % | 3.9 % | 85.8 % | 14.4 % | 2.7 % | 81.2 % |
   | **N1 + N2** | 37.1 % | 9.9 % | **73.2 %** | 20.1 % | 6.3 % | **68.8 %** |

   So the built gate cuts the noise-only worker position time by 73 % and
   the drawn-dot time by 69 %.
2. **"Beyond the scale" is the clamp OR u off the axis.** The row pins the
   dot at an end (chevron) when the vtln clamp is on or u is below −1 or
   above 2.2 (`axisPos`). The "5.0 % → 1.2 %" above counted the clamp only.
   With both: worker position beyond the scale 8.9 % → 1.8 % of noise time;
   drawn dot pinned at an end 4.7 % → 1.1 %; the header text "beyond the
   scale" (shown in the live / holding states) 2.7 % → 0.3 %.
3. **The dot does not stay for the rest of the clip.** The worker keeps
   (freezes) its position; the row draws it only while the raw pitch
   display is voiced or holding: on 54 % (BASE) / 63 % (GATED) of the
   noise time with a worker position. In the hair-dryer stream (GATED) the
   worker position covered 73 % of the clip and the drawn dot 65 %. A position
   was shown ever in 128 / 30 streams (BASE / GATED), a drawn dot in
   124 / 29.
4. **Never worse.** The gated hint is never worse than the ungated one on
   any of the 269 noise streams, for worker-position time and for
   drawn-dot time. (Worker position beyond the scale: 3 streams have more
   time with the gated hint — a copy machine, the hair dryer and a mains
   hum.)
5. **The row still reacted to noise.** With the built gate the row left
   "idle" on 33.3 % of noise-only time ("keep talking…" 26.9 %), because
   its state used the raw flags. Measured fix (the row on the gated flags):
   [voice-gate-resonance-row-2026-10-21.md](voice-gate-resonance-row-2026-10-21.md).

### Reproduce

```
python scripts/resonance/voice-gate-prep.py --vad-build=<voice-detector worktree>/build \
    --ls=<resonance-lab cache root> --corpora=<tests/dsp/data with fda/ ptdb-tug/>
node scripts/fetch-firered-model.mjs
node scripts/resonance/voice-gate-resonance.mjs --shard=i/5          # i = 0..4, in parallel
node scripts/resonance/voice-gate-resonance.mjs --report=build/resonance-voicegate/rows-0of5.jsonl,...
```
