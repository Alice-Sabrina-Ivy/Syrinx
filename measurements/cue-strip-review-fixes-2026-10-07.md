# Cue strip and "Likely heard as": review-round fixes — 2026-10-07

Three reviews of the `cue-strip` branch (UX / accessibility, correctness /
performance, honesty / licence) found defects that need numbers before the
fix: the vocal-weight dot was mostly frame noise, the resonance bands did not
describe what the dot shows (and favoured women), the pitch–resonance
conflict note almost never fired where it was meant to, the heard-as range
width was chosen partly on data the licence rule excludes, out-of-range
voices were annotated instead of hidden, and the resonance worker's CPU
guard could switch the cue off for a whole session from one cold chunk.
This note records the measurements behind each fix. Public data only:
LibriSpeech test-clean (CC BY 4.0) readers, Praat-resynthesised versions of
two of them, and the public listener data of the heard-as calibration.

## 1. Vocal weight: show a ~5 s level, not single emits

**Data.** The UX review's 12 runs of the built app (`series.json`, the cue
strip's dot sampled at ~4 Hz while live): two LibriSpeech readers (one woman,
one man), each 58 s unchanged then the same 58 s re-synthesised with Praat
"Change gender" — formants ±10 % / +5 %, or pitch ±4 / +2 st.
**Replay.** A running median over the last N live samples (≈ N/4 s of voiced
emits — the aggregator emits once per 250 ms of voiced content), scored on
the same runs: same-voice wobble = q10–q90 of the unchanged half after
calibration (44–58 s); shift = |median(changed) − median(unchanged)|.

| Level over | same-voice wobble (median of runs) | \|shift\| pitch ±4 st | \|shift\| formants ±10 % | shift / wobble |
|---|---|---|---|---|
| single emit (shipped) | **2.28 σ** | 0.38 (0.19–0.65) | 0.45 (0.11–0.60) | 0.17 / 0.20 |
| 2 s | 1.36 σ | 0.45 | 0.34 | 0.33 / 0.25 |
| 3 s | 0.97 σ | 0.43 | 0.40 | 0.44 / 0.41 |
| 4 s | 0.80 σ | 0.34 | 0.27 | 0.43 / 0.33 |
| **5 s (chosen)** | **0.67 σ** | 0.36 (0.06–0.52) | 0.33 (0.07–0.53) | **0.53 / 0.50** |
| 6 s | 0.66 σ | 0.33 | 0.41 | 0.50 / 0.62 |

**Change.** `src/audio/vocal-weight-level.js`: the median CPP of the last 20
voiced aggregate emits (~5 s, the resonance cue's horizon), read against the
session's frozen baseline — the same σ units, so the direction zones keep
their meaning (σ is linear in CPP, so this equals the median of the
per-emit σ values). The hook exposes it as `vocalWeight.sigmaLevel`; the dot,
the trail and the header use it; the header says "about where you started"
inside ±0.3 σ (about half the level's own wobble). The level is fed during
calibration too, so it is ready the moment the baseline freezes.

**Re-measured in the built app** (the review's `drive.mjs`, four of its
stimuli, phone viewport): same-voice wobble of the weight dot 0.62–0.98 σ
q10–q90 (review, single emits: 1.5–3.3 σ); the header said "about where you
started" on 36–58 % of the changed half's live samples, otherwise 0.4–0.7 σ
either way (one run briefly 1.9 σ lighter).

**What this does not fix.** Training-sized changes in these stimuli still
move the 5 s level by only about half its same-voice wobble: pitch ±4 st
moves it ~0.36 σ (the CPP pitch confound is smaller than the frame noise),
formants ±10 % ~0.33 σ. The ±0.5 σ direction zone (restored by user decision
on 2026-10-07) is now crossed by chance far less often (wobble 2.28 → 0.67 σ
q10–q90) but still sometimes. Whether to keep the zone is a product decision
(see "Open decisions").

## 2. Resonance bands from single readings

`reference.json`'s bands are the 10th–90th percentiles of **20 per-speaker
medians** per sex — narrower than the scatter of one 5 s readout, which is
what the dot shows. `node scripts/resonance/gating.mjs --r1=<jobs>` (the
production path: real pitch worker → frames engine → gated cue) on the same
40 LibriSpeech readers, now also sampling the gated readout every 0.2 s of
audio once full (each reader weighted equally):

| Bands | men (u) | women (u) | live readouts inside own band, men / women | end-of-stream readout inside, men / women |
|---|---|---|---|---|
| per-speaker medians (lab, before) | −0.53 … 0.29 | 0.65 … 1.55 | **64 % / 83 %** | 11 / 20, 16 / 20 |
| **distribution of single readouts (cue, now)** | −0.58 … 0.48 | 0.57 … 1.39 | **80 % / 80 %** | 17 / 20, 17 / 20 |

The new bands (`public/resonance-lab/cue-bands.json`, written by
`gating.mjs --bands-out`) treat men and women the same: a typical speaker's
dot is inside their own band ~4 times in 5 either way. The lab's
`reference.json` is unchanged (the u scale still comes from its per-speaker
medians: u 0 = the typical man, 1 = the typical woman). The androgynous
highlight keeps the gap between the per-speaker bands (u 0.29–0.65), "between
typical men's and women's readings" — the single-reading bands nearly touch
(0.48 / 0.57). The info text now says even typical speakers' dots land
outside their band about 1 time in 5.

## 3. Resonance: say the change from the start

The lab benchmark establishes the cue for **in-session change**, not absolute
position. The header now says "brighter / darker than your start" or "about
where you started" (until the start is known: "finding your start…"), with a
0.3 u deadband: the UX review measured the 5 s
readout's same-voice wobble at 0.28–0.36 u (woman) and 0.54–0.65 u
(expressive man) q10–q90, and ±10 % formants moved it ±0.76–0.84 u, +5 %
0.41–0.46 u. So ±10 % formant changes clear the deadband for both readers; a
5 % change is about the size of an expressive reader's own drift. The strip
draws a line from the start ring to the dot, and the resonance trail now
samples every 2 s over ~30 s (the 8-dot / 2 s trail could not show a change
that develops over 5–8 s).

**The start reference.** The first build put the start ring at the first
full readout. Re-measured in the built app, the expressive man's first
readout sat at u −0.75 against his typical −0.10, so his *unchanged* voice
read "brighter than your start" in every live sample of the first half. The
start is now the median of the readouts over the first 12 s of admitted
voiced speech after the readout fills (`resonanceCue.js` `START_COLLECT_S`).
Replayed on the 16 runs (the review's 12 + the 4 re-measured): with the start
taken over the first 0 / 10 / 20 / 30 s of live readouts, an unchanged voice
reads "about where you started" in a median 57 / 67 / **96** / 100 % of live
samples (worst run 10 / 0 / **77** / 100 %), while ±10 % formants still move
the readout 0.7–0.9 u from that start and +5 % 0.45–0.66 u. 12 s of voiced
speech is about 20 s of live reading.

Re-measured in the built app (phone viewport; share of live samples):

| Run | unchanged half, once the start is known | changed half |
|---|---|---|
| woman, formants −10 % *(first start rule)* | about where you started 95 % | darker 100 % |
| woman, pitch −4 st *(first start rule)* | about where you started 97 % | about where you started 100 % |
| man, formants +10 % | about where you started 69 % (darker 31 %) | brighter 81 % |
| man, formants −10 % | about where you started 100 % | darker 43 %, beyond the scale (dark end) 39 %, about 18 % |
| man, pitch +4 st | about where you started 81 % | about 66 %, darker 34 % |

So on the expressive reader a ±10 % formant change shows clearly, but his
own content drift still reads "darker" a third of the time with no
resonance change — the cue is a guide over tens of seconds, not
sentence by sentence, and the info text now says so ("What you say moves it
too, so judge a change over tens of seconds, not sentence by sentence").

**After a long pause.** The readout freezes through silence by design, so a
voice returning after a break (or another speaker) got the earlier value as a
confident live dot for ~6 s (correctness review soak). After ≥ 10 s of audio
with no admitted bin, the cue counts admitted voiced time afresh and the row
shows "settling…" until 2 s of new speech are in
(`resonanceCue.js` `sinceResumeS`; unit test in
`tests/resonance/resonance-cue-test.js`).

## 4. Overload guard

The first guard seeded an EMA (τ 10 s) with the first, coldest chunk and
latched "overloaded" for the session; with 25 ms chunks the seed still carried
~74 % of the EMA at the 3 s grace limit, and in Node the first chunk costs
~2.5× the steady rate. `src/resonance/overloadGuard.js` now:

- ignores the first 3 s of audio entirely, then judges the **mean over the
  trailing 10 s of audio**, only once ≥ 5 s are in the window;
- trips above 500 ms of work per audio second, then **backs off** (no vtln
  work for 20 s of audio, doubling on each repeat up to 160 s) and resumes
  with a fresh engine — a busy moment pauses the cue ("paused — device busy")
  instead of ending it.

`tests/resonance/overload-guard-test.js`: a 20 ms first chunk followed by 2 ms
chunks never trips (the reviewer's case); 3 s of 900 ms/s warm-up then
200 ms/s never trips; a 2 s spike at 1 500 ms/s inside 100 ms/s does not trip;
600 ms/s sustained trips at 8 s, backs off 20 s, resumes, trips again and
backs off 40 s.

**CPU with the panel on** (correctness review, desktop Chrome, ~74 % machine
load, 630 s soak): the resonance worker's own timer read 51.8 ms per audio
second (session mean) with the panel on (the gender worker competing for CPU;
its 10 s EMA peaked ~85) vs 44.1 with it off. That is over the 45 ms/s target
and under the 60 ms/s stop line; the figure is wall time, so time descheduled
behind other threads counts. **Mobile is still unmeasured** (no phone was
attached; `scripts/mobile-diag-capture.js` prints `resonancePerf`).

## 5. "Likely heard as": the conflict note

The note compares the pitch scale u_F0 = (ln F0 − 4.8035) / 0.4451 (0 at the
typical man's, 1 at the typical woman's speaking F0) with the resonance cue's
u. On the 40 matched LibriSpeech readers (their own median posted F0, every
live resonance readout):

| \|u_F0 − u\| above | men's live readouts | women's live readouts |
|---|---|---|
| 0.5 | 47 % | 8 % |
| 0.75 | 14 % | 0 % |
| **1 (kept)** | **2 %** | **0 %** |

A threshold low enough to catch the documented pitch-only failures (RB695
male TTS raised to ~161 Hz: Δ ≈ 0.62; a female voice lowered ×0.59 with
resonance at u ≈ 1: Δ ≈ 0.86; Meyer −6 st: Δ ≈ 0.55) would fire on about half
of ordinary men's readings, because a single resonance readout wobbles by
±0.3–0.6 u — and more for men than for women. So the threshold stays at 1,
and the always-visible caveat, not the note, carries the pitch-only failure;
it is now concrete: "change your pitch without changing resonance and it
shows a bigger change than listeners would hear — sometimes by more than half
of them — in either direction" (measured: 12–62 points too little "man" for
male voices with pitch raised; up to +46 points too much "man" for female
voices with pitch lowered). The note's wording no longer claims the cues
"point different ways" when they sit on the same side: "opposite" (u_F0 and u
on opposite sides of 0.5) vs "apart" (same side, > 1 u apart), and it adds
that where resonance reads depends on the microphone.

## 6. "Likely heard as": the range width on licence-clean data

The half-width 2.25 logit was selected on held-out coverage that included the
CC BY-NC-SA PICKA sets (Jebens, Nagels) and Mooshammer (no data licence),
while the docs said no constant depends on them.
`scripts/heard-as/calibration/final_checks.py` now selects on licence-clean
held-out data only (the fit sources leave-one-source-out + the Hillenbrand &
Clark syllable condition; it asserts no NC / unlicensed set is in the
selection) and reports the others as validation:

| half-width | feminine | ambiguous | masculine |
|---|---|---|---|
| 1.79 | 0.76 (n 31) | 0.67 (n 3) | 0.75 (n 267) |
| 2.00 | 0.81 | 0.67 | **0.76** |
| **2.25** | **0.87** | 0.67 | **0.83** |
| 2.50 | 0.92 | 1.00 | 0.90 |
| *validation only (NC / unlicensed), 2.25* | *0.72 (n 16)* | *0.89 (n 15)* | *1.00 (n 15)* |

2.25 remains the smallest width with ≥ 80 % on the feminine and masculine
sides (2.0 fails the masculine side), so the shipped constant is unchanged;
its stated basis is corrected. The ambiguous side has only 3 licence-clean
held-out data and fails 80 %, so the panel no longer says the ranges hold for
in-between voices ("about 8 in 10 for clearly feminine or clearly masculine
voices; less is known for in-between voices").

## 7. "Likely heard as": hide outside the tested range

The spec says out-of-scope input must hide the estimate; the panel only added
a note. It now hides ("Outside the range it was tested on — no guess shown")
when the 8 s aggregate's F0 is outside 81–293 Hz or the meter logit outside
−7.31…+5.72 — the same rule at both ends. How often that hides natural
adult speech (the calibration's per-item tables): LibriSpeech test-clean 1 of
200 utterances, LibriTTS-P / Mooshammer / Neuenswander natural voices 0 of 52,
RB695 TTS 1 of 16. It does **not** catch most children (bmmb: boys 2 of 54,
girls 0 of 38) or most singing (Kong: 29 % of sung items; 43 % of feminine,
16 % of masculine singers) — those stay disclosed in "More", not detected.

## 8. Display changes without new measurements

- Heard-as ranges are drawn as brackets (end caps, a light band, a dot at the
  central estimate), never a bar filled from the left; a row whose rounded
  range spans ≥ 8 tenths is dimmed and says "can't tell (A–B)"; two or more
  such rows add "Too uncertain to say much about this voice yet". The middle
  row is "neither or unsure" (it counts "another gender" answers too).
- Pitch: the header number is the 1.5 s level (the dot), and off target the
  dot is hollow and the row says "↑ higher" / "↓ lower" ("in target" on it) —
  not colour alone; the same words in every direction.
- Info popovers wrap (they inherited `white-space: nowrap`) and the
  steadiness popover opens downward over its row (it was clipped).
- Contrast: strip and panel text neutral-400 or lighter; bands outlined in
  neutral-400 (dashed for resonance); axis neutral-500; label halos.
- Each cue row is a labelled group with a 1 Hz screen-reader summary.
- Desktop: the cue column is 38 % of the width (420–540 px) and the strip is
  drawn larger (12 px labels, 7 px dots, 58 px rows).
- The panel's "Turn on" says "· 16 MB"; small controls have ≥ 24 px hit areas.
- The gender worker's capture port is disconnected when the panel is
  switched off (`captureSource.disconnectConsumer`).

## Reproduce

```
node tests/audio/vocal-weight-level-test.js
node tests/resonance/overload-guard-test.js
node tests/resonance/resonance-cue-test.js
node tests/audio/cue-strip-model-test.js
node tests/ml/heard-as-test.js
node scripts/resonance/gating.mjs --r1=<jobs_r1.json> --bands-out=public/resonance-lab/cue-bands.json
python scripts/heard-as/calibration/final_checks.py     # in the calibration table folder (scripts/heard-as/README.md)
node scripts/resonance/chrome-cpu.mjs --panel=on        # desktop CPU with the panel on
```
