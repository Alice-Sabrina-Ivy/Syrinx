# Notch adversarial suite (2026-10-04, rounds 1-2)

Both sides of the noise-notch trade, through the **real**
`src/dsp/pitch-worker.js` (fake worker `self`, 25 ms chunks, 16 and 48 kHz —
the streaming resampler is live at 48 kHz). Built to decide round 1 of the
held-note notch iteration: 6f8be18's in-sound latch closed three held-note
gaps but a review confirmed it blocks or delays real interferers.
Decision data: [measurements/noise-notch-held-note-robustness-2026-10-04.md](../../measurements/noise-notch-held-note-robustness-2026-10-04.md)
("Round 1", "Round 2"). Round 2 decides on round 1 (`cb00425`, `N13`) after its
review confirmed six findings: four interferer delays (a hum that steps
frequency after switching on, a hum masked by a note that moves / ends into
continuous speech, a beating hum whose trough meets a short pause, a hum on a
held note's track), a doc overstatement and a catch-breath / handoff
interaction.

## Variants (`variants.mjs`)

| id | module |
|---|---|
| `B` | bc42ad0's `noise-notch.js` (onset-born 20 s delay, narrow veto, stable keying) |
| `H` | 6f8be18's (in-sound latch + new-note re-births) |
| `SRC` | the repo's `src/dsp/noise-notch.js` (round 1: N13; round 2 runs: r8-notch.js; after round 2: bc42ad0's module) |
| `noNotch` | candidate module with promotion disabled (the voice ceiling) |
| `C1`–`C10` | latch kept, regressions patched (line-gated release, plausible-level pre-roll, floor bounds); the best, `C9`, still equals `H` on `dense.mjs` (the latch's structural cost) |
| `N1`–`N13` | latch removed: bc42ad0 + line-gated breath re-birth (`N2`), + glide/step handoff (`N3`–`N11`), + revokes (`N8`, `N12`, `N13`). **`N13` = shipped** (`src/` parity: 0 mismatches) |
| `P0`, `PH` | `cand-notch.js` reproducing `B` / `H` message-for-message |
| `R1` | cb00425's module (round 1 = `N13`; tree `r1`) |
| `R1c`, `R2h`, `R2q`, `R2`–`R8` | `cand2-notch.js` (round 2: cb00425 + flags): `R2h` handoff off; `R2q` + quiet-window line gate on breath re-births; `R2` the gate replacing cb00425's revokes with a quiet-window STEADY revoke; `R3`/`R4` run-scoped 3 / 5-window steady; `R5` + fast-decay counts as absent; `R6` + provisional re-births voided when the line comes back inside the pause; `R7` stricter "back" (+6 dB, 13 dB prominence); `R8` = the round-2 candidate (fast decay counts as absent only at >= 3 dB / 50 ms on average since the pause began). **Not shipped**: it never notches a tonal source that itself cuts out for 0.15-1 s every few seconds (`r2int.mjs --part=intermit`, bc42ad0 ~20 s), the repeated-holds signal by construction. The flag-free drop-in is [`r8-notch.js`](r8-notch.js) (parity with `R8`: 0 mismatches). Round 2 reverted `src/` to bc42ad0's module (`B`) |
| `V0`–`V14` | `cand3-notch.js` (2026-10-05 voice-vs-machine CANDIDATE phase: `r8-notch.js` + per-track line coherence — shared mid-band FM of a line and its own 2nd partial, pooled over the last <= 5 1-s windows; `measurements/noise-notch-voice-discrimination-2026-10-05.md`): `V0` = `R8`, `VB0` = `B` (parity 0 mismatches); `V1` machine-confirmed lines promote at 5 s even if onset-born (fails the strict rule: synthetic `weak` / `weak2` / `step` FV cells, `handoff-adv`, 53 / 504 real gated streams); `V6`–`V10` voice timing + R8 re-births unless machine-confirmed (`V10`: + revoke, jump guard, reanchor; 99 / 504 real gated streams later than `B` — real sources re-birth while still undecided); `V11` = `B` + voice timing only; `V12` / `V13` re-births only for voice-confirmed lines (3 / 6 real gated streams fail); `V14` = `V11` with the strict 0.7 / 2.5 c voice verdict (shipped 2026-10-05, `src/` parity: 0 mismatches in 75 980 messages). Follow-up (review of V14): `V15` = `V14` with the coherence band from 75 Hz (`PITCH_DISPLAY_RANGE.low`; was 80); `V16` = `V15` with the takeover jump guard (`jumpMode: "plateau"`: >= 6 dB within 6 observations over a level that held within 1.5 dB for 3 consecutive sightings; frozen, then run on held-out split 1); `V16s3` / `V16r4` / `V16r10` = guard sensitivity; `V17` = `V16` + a latest-window grant condition (tried on split 1's failing takeover cell, does not fix it, rejected); **`V18` = `V16` + the steady reference must be the line's loudest so far (within 3 dB; split 1 showed a real voice that dipped 13 dB and recovered firing `V16`'s test) = shipped**, run on held-out split 2 (`src/` parity: 0 mismatches in 89 506 messages, `NOTCH_MEMO=0`; `V16` vs `V18` notch scan: no differing cell in any suite family or real set). Fix round (2026-10-06, review of the follow-up): `V19p` = `V18` + the takeover test needs the line NOT to have read as a voice before the jump (`jumpPreVoice`: its windows completed by the end of the steady reference must not pool to the voice verdict); `V19` = `V19p` + the coherence band measured within 3 Hz (matchHz) of 75 / 400 Hz and a line leaving it drops its running series (`bandMarginHz`, `clearOob`); `V19f` = `V19` with those windows ending by the reference's FIRST sighting (`jumpPreFirst`: a takeover note's onset transient can sit in a window that ends inside the steady stretch); **`V19g` = `V19f` with voice timing granted only to a line inside 75-400 Hz itself (`grantInBand`; the margin is for measurement only: `V19f` delayed machines at 73-74 / 401-402 Hz, `vmach --part=edge` 138 / 240 cells) = `src/` after the fix round**; `V19h` = `V19g` with the grant band widened by half an FFT bin (`grantTolHz` 0.5: keeps a 75.0 Hz voice whose line estimate sits at 74.9 Hz; rejected, 6 / 240 edge cells: 401 Hz machines whose wobble reaches 400.5 Hz); `V19l` = `V19` + voice timing revoked when the pooled windows fall under 0.5 / 2 c (tried, changes none of the review's cases, rejected); `V19c` = `V19` + a 10 s cap on the voice timing of lines first seen in the stream's first observation (`capSec`; the voice-like-machine dial, measured, not a candidate) |

`setup.sh` builds `build/notch-adv/trees/{bc42,head,cand,r1,cand2}/src` (copies of
`src/` with that notch module). Re-run it after editing `src/`,
`cand-notch.js` or `cand2-notch.js`.

`NOTCH_ADV_TREES=name=path[,name=path...]` (paths from the repo root) replaces
that tree list with any src trees, each also a variant of its name — e.g. the
real-noise false-voicing candidate on the whole suite
(`--variants=bc42,base0,fgA`, [measurements/realnoise-false-voicing-attribution-2026-10-05.md](../../measurements/realnoise-false-voicing-attribution-2026-10-05.md) §7).

## Parts

| script | what |
|---|---|
| `held.mjs` | 598 held-note scenarios per rate (`scenarios.mjs`; round 2 adds a step after a 0.15 / 0.2 s catch breath, a 3 × 8 s ladder through short breaths, abrupt-release catch breaths and repeated holds under Schroeder reverb RT60 0.3 / 0.6 s): steady holds; mid-hold glides/steps; speech → hold (0/60/150 ms gaps); phonation from t = 0 / 0.15 s; speech from t = 0 then a hold; 3 × 8/10 s same-pitch holds with 0.15/0.25/0.3/0.5/1/2 s silent breaths and 0.15–1 s audible (−20/−30 dB) inhalations; vowel change; messa di voce. Metric: % of hold frames reported at pitch (±8 %), promotions onto the voice, painted % (median-3 + paint gate). |
| `int.mjs --part=start` | hum (tone3 / fan-hum / mains / wobble / rich60 / drift) present from the first sample, speech from 0.1/0.2/0.4/0.6/1/3 s or none, dense (P4) and sparse (P8) speech; capture pre-roll: 100 ms zeros, 300 ms of 1e-5 dither, 80 ms fade-in. Metrics: notch promotion time, pause false voicing (worker + painted), speech correct. |
| `int.mjs --part=weak` | broadband floor + a hum at +3/+6/+9/+12 dB 50–4000 Hz band energy over it, switching on mid-utterance or in a pause at ~10 s, under dense / sparse / utterance speech (210 and 165 Hz voices). Pause FV scored after the accepted ~21 s switch-on latency too. |
| `int.mjs --part=weak2` | beating (two fans 0.5 Hz apart) / 0.3 Hz AM hums, +6…+18 dB, as `weak` — the breath re-birth's adversary (a line whose own power dips). |
| `r2int.mjs --part=step\|masked\|beatpause\|shared\|intermit` | round 2: the review's interferer adversaries (a hum stepping / alternating / spinning up after switching on, noise-only / dense / sparse speech; a hum masked by a note that glides / steps / runs into speech with 0.3 / 0.9 / 1.5 s pauses; steady / AM / 2:1 and 1:1 beating hums with 0.25–0.6 s pauses, 12 seeds; a hum on a held note's track 16–30 dB under the voice; a hum that itself switches off 0.15–1 s every 5 / 8 s — the signal of repeated steady holds). `agg-r2.mjs` applies the strict rule. |
| `handoff-adv.mjs` | 168 cells: a 120 Hz hum beside a held note that stops / fades / glides onto it — the handoff's adversary. |
| `dense.mjs` | a hum switching on during DENSE speech (40–120 ms gaps) — the latch's structural cost case. |
| `fda.mjs` | FDA speech (real voices) × interferer: noise-only, from t = 0, switch-on mid-speech, switch-on in a pause. |
| `grid.mjs` | the 2026-10-03 held-note main / requirement grids through the real worker. |
| `oracles.sh A B`, `sessions.sh`, `extra-preload.mjs` | committed oracles (noise-augment pitch + gender, voicing shootout) and the session oracle on two notch modules. |
| `realdata/` | (2026-10-05) REAL noise + REAL held-voice corpora, census of the real noise, end-to-end mixes and JS loaders for the voice-vs-machine discrimination phase — [realdata/README.md](realdata/README.md), [measurements/notch-realdata-corpora-2026-10-05.md](../../measurements/notch-realdata-corpora-2026-10-05.md). Line discrimination (`linefeat*.py`, shared mid-band FM across partials): [measurements/notch-voice-machine-discrimination-2026-10-05.md](../../measurements/notch-voice-machine-discrimination-2026-10-05.md). |
| `realdata/realeval.mjs`, `realdata/agg-real.mjs` | (2026-10-05) the REAL-noise oracle: the real worker over the real corpora — `noise` (279 noise-only clips: promotion, painted false voicing), `gated` (504 real stationary-tonal sources switched off 0.15–1 s every 5 / 8 s: the R8 failure class on real audio), `held` (192 real VocalSet same-pitch hold series), `vin` (798 real voice programs in real noise at +10 / 0 dB); per-stream strict rule vs `B` |
| `realdata/linecls.mjs`, `realdata/agg-cls.mjs` | census of the ONLINE coherence verdict (`cand3-notch.js` with a variant's options, default `V18`; promotion disabled, voice timing on) on real voice / noise / mixes: verdicts, time to the voice verdict vs the 4.9 s promotion point, jump-guard blocks, at-risk lines, each line's margin to the verdict (`vmax`) |
| `takeover-margin.mjs` | (2026-10-05 follow-up) notch-only: on every `handoff-adv` cell (tuning or `--heldout`), the hum line's rise over its steady pre-note level minus the 6 dB takeover threshold, and whether the guard mattered (the line read voice-confirmed) |
| `handoff-adv.mjs --heldout` / `--heldout2` | (2026-10-05 follow-up) held-out takeover grids: split 1 hum at 100 / 150 Hz, note at 0.93-1.1 x the hum from 1 / 2.5 s, hum rms 0.005 / 0.02 / 0.05, 15 c vibrato + 4 c wander, new seeds (216 cells per rate); split 2 hum at 85 / 135 / 180 Hz, note at 0.95-1.07 x from 1.5 / 3 s, rms 0.008 / 0.04 / 0.07, 12 c + 2.5 c (324 cells per rate) |
| `realdata/fetch_heldout.py` | (2026-10-05 follow-up) held-out real data under `build/notchvd-heldout/`: DCASE 2020 T2 additional-training machine ids, Freesound queries disjoint from `fetch_noise.py`'s, Coswara sustained vowels (new speakers, own phones / laptops) |
| `memo-check.mjs` | `lib.mjs`'s notch-level memo == un-memoized worker, message for message |
| `vmach.mjs`, `agg-vmach.mjs` | (2026-10-06 fix round) VOICE-LIKE MACHINES: a harmonic stack (1 / 0.5 / 0.3) whose speed wobbles in the 0.5-8 Hz band, shared by every partial, from t = 0 (not onset-born), 30 s, no voice. `--part=steady` (77-390 Hz; sin 1 / 2 / 4 Hz x 3-10 c or OU 3 / 6 / 10 c; +- white noise; 210 cells per rate), `--part=ramp` (the level ramps -8 / -12 dB -> 0 over 1-3 s from 0 / 1 / 2.5 s: spin-up / approach; 54), `--part=edge` (73 / 74 / 401 / 402 Hz: inside the coherence band's 3 Hz margin; 120). Strict rule per LINE vs bc42ad0, painted FV +2 pp |
| `handoff-adv.mjs --wobble` / `--sweep` | (2026-10-06 fix round) the review's takeover shapes: a hum with a small SHARED speed wobble (OU 0 / 0.7 / 1.2 / 2 c) under one 4 s note at its own level (48 cells per rate); a hum-level sweep, rms 0.015-0.055 in 7 steps, hum 85-200 Hz, wobble 0 / 1.2 c (168 per rate). Rows add painted FV after the note; `agg-handoff.mjs` applies late / FV / painted-FV |
| `held.mjs` families `vowelnob` / `crescpp` / `settle` | (2026-10-06 fix round) a vowel change on a hold whose line is NOT onset-born (phonation from t0 = 0 / 0.15 s, speech -> hold, a mid-hold step; formant-model /a/ -> /i/, /a/ -> /u/, or an H1-only +6 / +8 / +12 dB rise; 98 / 131 / 196 / 247 Hz); a steady soft start then a fast crescendo; attack -> settle 2-3 dB -> swell. 167 scenarios per rate (902 in all) |
| `realdata/offsets.mjs` | (2026-10-06 fix round) the real noise-only clips from MANY start offsets (every 3 s, 30 s streams, the first 180 s of each clip), notch-only per variant + the real worker where a variant's notch output differs from bc42ad0's; strict rule per LINE (every line bc42ad0 notches, notched by max(6 s, its time + 0.3 s)), painted FV +2 pp; `--agg` lists the failing clips and offsets |
| `realdata/agg-gender.mjs` | (2026-10-06 fix round) the gender-symmetric metric on `realeval.mjs --set=voice` rows: hold frames painted at pitch per gender, max(F_err, M_err), voice notched per gender, streams below the base |
| `NOTCH_SCAN=A:B` (`lib.mjs`) | scan mode: any family script, no worker runs — per cell, whether variants A and B hand the worker identical notch output (`NOTCH_SCAN_OUT` jsonl); identical cells have identical worker messages |
| `cmp-vars.mjs` | per-cell identity of variants in any results directory |
| `agg-held.mjs`, `agg-int.mjs`, `agg-noise.mjs` | tables + the round-1 strict-rule check vs `B`. |
| `parity.mjs A B` | message-level equality of two variants (run with `NOTCH_MEMO=0`: with the memo two variants whose notches agree share one worker run). |

**Notch-level memo (2026-10-05 follow-up).** `lib.mjs` `runWorker()` first runs
only the variant's notch, exactly as the worker drives it, and hashes what
the worker consumes from it per chunk (notched samples, `activeLines()`,
`activeFreqs()`, plus the tree's `isNearNotch` source); variants with the
same hash on the same audio share one worker run (a notch-only pass is ~25 %
of a worker run). `NOTCH_MEMO=0` disables it; `memo-check.mjs`: 0 mismatches
in 66 678 messages (B / V14 / V16, 13 scenarios x 16 + 48 kHz).

All runners keep at most `MAXJ` (default 4) node processes alive at once — the suite shares a
workstation; leave ~10 % CPU / RAM free.

## Commands (repo root)

```bash
bash scripts/notch-adversarial/setup.sh
S=scripts/notch-adversarial; R=build/notch-adv/res
bash $S/shards.sh $R/held 16 $S/held.mjs --variants=B,H,SRC,noNotch --sr=16000,48000
bash $S/shards.sh $R/start 16 $S/int.mjs --part=start --variants=B,H,SRC --sr=16000,48000
bash $S/shards.sh $R/weak 16 $S/int.mjs --part=weak --variants=B,H,SRC --sr=16000,48000
node $S/agg-held.mjs $R/held --by=sub; node $S/agg-int.mjs $R/start $R/weak --fails
node $S/dense.mjs --variants=B,H,SRC
for p in nonly start midsp midpa; do bash $S/shards.sh $R/fda_$p 8 $S/fda.mjs --part=$p --variants=B,H,SRC; done
node $S/agg-noise.mjs $R/fda_start            # per part
node $S/parity.mjs N13 SRC 7 16000,48000      # implementation == candidate (round 1)
# round 2
for p in step masked beatpause shared intermit; do bash $S/shards.sh $R/r2_$p 4 $S/r2int.mjs --part=$p --variants=B,H,R1,R8 --sr=16000,48000; done   # the round-2 run used SRC = r8-notch.js
node $S/agg-r2.mjs $R/r2_step $R/r2_masked $R/r2_beatpause $R/r2_shared $R/r2_intermit --fails
node $S/parity.mjs R8 SRC 17 16000,48000      # with r8-notch.js copied over src/dsp/noise-notch.js
bash $S/oracles.sh bc42 src; bash $S/sessions.sh r1b build/notch-adv/otree/bc42/src r1s src
```

### Voice-vs-machine candidate (2026-10-05)

```bash
bash scripts/notch-adversarial/setup.sh            # builds trees/cand3 too
S=scripts/notch-adversarial; R=build/notch-adv/res7; RD=$S/realdata
node $S/parity.mjs V14 SRC 13 16000,48000           # src/ == V14
for s in noise gated held vin; do bash $S/shards.sh $R/real_$s 6 $RD/realeval.mjs --set=$s --variants=B,R8,SRC; done
node $RD/agg-real.mjs $R/real_gated --vars=B,R8,SRC --fails=20
for s in noise gated held; do bash $S/shards.sh $R/cls_$s 6 $RD/linecls.mjs --set=$s --vcorr=0.7 --vcoh=2.5; done
bash $S/shards.sh $R/cls_voice 6 $RD/linecls.mjs --set=voice --deg=inf,20,10,0 --vcorr=0.7 --vcoh=2.5
# synthetic suite as in round 2 with --variants=B,R8,SRC; merge.mjs joins runs of different variants
node $RD/export_test_clips.mjs                       # tests/dsp/data/notch-real (committed)
```

### V14 follow-up (2026-10-05)

```bash
bash scripts/notch-adversarial/setup.sh
S=scripts/notch-adversarial; R=build/notch-adv/res8; RD=$S/realdata; V=B,V14,SRC
NOTCH_MEMO=0 node $S/parity.mjs V18 SRC 13 16000,48000     # src/ == V18
NOTCH_SCAN=V16:V18 NOTCH_SCAN_OUT=$R/scan_held.jsonl node $S/held.mjs --variants=B --sr=16000,48000   # V16 vs V18, notch only (any family script)
node $S/memo-check.mjs B,V14,V16 47 16000,48000
bash $S/shards.sh $R/hadv 6 $S/handoff-adv.mjs --variants=$V --sr=16000,48000
bash $S/shards.sh $R/hadv_ho 6 $S/handoff-adv.mjs --variants=$V --sr=16000,48000 --heldout
bash $S/shards.sh $R/held 12 $S/held.mjs --variants=$V --sr=16000,48000     # 735 scenarios incl. swell / subito / low / dip
# r2int / int / fda / grid / dense as above with --variants=$V
for s in voice noise held gated vin; do bash $S/shards.sh $R/real_$s 6 $RD/realeval.mjs --set=$s --variants=$V; done
python $RD/fetch_heldout.py                                  # build/notchvd-heldout
for s in noise voice; do NOTCHVD_ROOT=build/notchvd-heldout bash $S/shards.sh $R/ho_$s 6 $RD/realeval.mjs --set=$s --variants=$V; done
for v in V14 V16; do bash $S/shards.sh $R/cls_${v}_voice 6 $RD/linecls.mjs --set=voice --deg=inf,20,10,0 --variant=$v; done
node $RD/agg-cls.mjs $R/cls_V16_voice; node $S/takeover-margin.mjs --heldout
node $RD/agg-real.mjs $R/real_voice --vars=B,V14,SRC --fails=20
```

### Fix round (2026-10-06)

```bash
bash scripts/notch-adversarial/setup.sh
S=scripts/notch-adversarial; R=build/notch-adv/res9; RD=$S/realdata
NOTCH_MEMO=0 node $S/parity.mjs V19g SRC 5 16000; NOTCH_MEMO=0 node $S/parity.mjs V19g SRC 13 48000   # src/ == V19g
# which cells can differ at all: notch-only scan, several variants vs the first in one pass (every family / real set)
NOTCH_SCAN=V18:V19:V19f NOTCH_SCAN_OUT=$R/scan_r2.jsonl node $S/r2int.mjs --part=step --variants=B --sr=16000,48000
bash $S/shards.sh $R/held_new 1 $S/held.mjs --variants=B,V14,V18,V19,V19f --sr=16000,48000 --family=vowelnob,crescpp,settle
bash $S/shards.sh $R/vmach_steady 6 $S/vmach.mjs --part=steady --variants=B,V14,V18,V19,V19c --sr=16000,48000   # also --part=ramp / edge
bash $S/shards.sh $R/hadv_wob 3 $S/handoff-adv.mjs --wobble --variants=B,V14,V18,V19 --sr=16000,48000           # also --sweep
bash $S/shards.sh $R/off_main 12 $RD/offsets.mjs --variants=B,V14,V18,V19,V19c
NOTCHVD_ROOT=build/notchvd-heldout bash $S/shards.sh $R/off_ho 6 $RD/offsets.mjs --variants=B,V14,V18,V19,V19c
node $S/agg-vmach.mjs $R/vmach_steady --fails=10; node $S/agg-handoff.mjs $R/hadv_wob; node $RD/offsets.mjs --agg $R/off_main --fails=10
node $RD/agg-gender.mjs build/notch-adv/res8/ho2_voice@SRC:V18 --vars=B,V14,V18
```
