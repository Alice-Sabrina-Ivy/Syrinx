# Notch adversarial suite (2026-10-04, round 1)

Both sides of the noise-notch trade, through the **real**
`src/dsp/pitch-worker.js` (fake worker `self`, 25 ms chunks, 16 and 48 kHz —
the streaming resampler is live at 48 kHz). Built to decide round 1 of the
held-note notch iteration: 6f8be18's in-sound latch closed three held-note
gaps but a review confirmed it blocks or delays real interferers.
Decision data: [measurements/noise-notch-held-note-robustness-2026-10-04.md](../../measurements/noise-notch-held-note-robustness-2026-10-04.md)
("Round 1").

## Variants (`variants.mjs`)

| id | module |
|---|---|
| `B` | bc42ad0's `noise-notch.js` (onset-born 20 s delay, narrow veto, stable keying) |
| `H` | 6f8be18's (in-sound latch + new-note re-births) |
| `SRC` | the repo's `src/dsp/noise-notch.js` |
| `noNotch` | candidate module with promotion disabled (the voice ceiling) |
| `C1`–`C10` | latch kept, regressions patched (line-gated release, plausible-level pre-roll, floor bounds); the best, `C9`, still equals `H` on `dense.mjs` (the latch's structural cost) |
| `N1`–`N13` | latch removed: bc42ad0 + line-gated breath re-birth (`N2`), + glide/step handoff (`N3`–`N11`), + revokes (`N8`, `N12`, `N13`). **`N13` = shipped** (`src/` parity: 0 mismatches) |
| `P0`, `PH` | `cand-notch.js` reproducing `B` / `H` message-for-message |

`setup.sh` builds `build/notch-adv/trees/{bc42,head,cand}/src` (copies of
`src/` with that notch module). Re-run it after editing `src/` or
`cand-notch.js`.

## Parts

| script | what |
|---|---|
| `held.mjs` | 536 held-note scenarios per rate (`scenarios.mjs`): steady holds; mid-hold glides/steps; speech → hold (0/60/150 ms gaps); phonation from t = 0 / 0.15 s; speech from t = 0 then a hold; 3 × 8/10 s same-pitch holds with 0.15/0.25/0.3/0.5/1/2 s silent breaths and 0.15–1 s audible (−20/−30 dB) inhalations; vowel change; messa di voce. Metric: % of hold frames reported at pitch (±8 %), promotions onto the voice, painted % (median-3 + paint gate). |
| `int.mjs --part=start` | hum (tone3 / fan-hum / mains / wobble / rich60 / drift) present from the first sample, speech from 0.1/0.2/0.4/0.6/1/3 s or none, dense (P4) and sparse (P8) speech; capture pre-roll: 100 ms zeros, 300 ms of 1e-5 dither, 80 ms fade-in. Metrics: notch promotion time, pause false voicing (worker + painted), speech correct. |
| `int.mjs --part=weak` | broadband floor + a hum at +3/+6/+9/+12 dB 50–4000 Hz band energy over it, switching on mid-utterance or in a pause at ~10 s, under dense / sparse / utterance speech (210 and 165 Hz voices). Pause FV scored after the accepted ~21 s switch-on latency too. |
| `int.mjs --part=weak2` | beating (two fans 0.5 Hz apart) / 0.3 Hz AM hums, +6…+18 dB, as `weak` — the breath re-birth's adversary (a line whose own power dips). |
| `handoff-adv.mjs` | 168 cells: a 120 Hz hum beside a held note that stops / fades / glides onto it — the handoff's adversary. |
| `dense.mjs` | a hum switching on during DENSE speech (40–120 ms gaps) — the latch's structural cost case. |
| `fda.mjs` | FDA speech (real voices) × interferer: noise-only, from t = 0, switch-on mid-speech, switch-on in a pause. |
| `grid.mjs` | the 2026-10-03 held-note main / requirement grids through the real worker. |
| `oracles.sh A B`, `sessions.sh`, `extra-preload.mjs` | committed oracles (noise-augment pitch + gender, voicing shootout) and the session oracle on two notch modules. |
| `agg-held.mjs`, `agg-int.mjs`, `agg-noise.mjs` | tables + the round-1 strict-rule check vs `B`. |
| `parity.mjs A B` | message-level equality of two variants. |

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
node $S/parity.mjs N13 SRC 7 16000,48000      # implementation == candidate
bash $S/oracles.sh bc42 src; bash $S/sessions.sh r1b build/notch-adv/otree/bc42/src r1s src
```
