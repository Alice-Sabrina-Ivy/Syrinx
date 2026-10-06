# Noise notch: voice-vs-machine line verdict — CANDIDATE phase (2026-10-05)

Branch `notch-voice-discrimination`. Follows
[notch-realdata-corpora-2026-10-05.md](notch-realdata-corpora-2026-10-05.md)
(real noise and voice corpora) and
[notch-voice-machine-discrimination-2026-10-05.md](notch-voice-machine-discrimination-2026-10-05.md)
(the offline separability study). Code:
[src/dsp/noise-notch.js](../src/dsp/noise-notch.js), candidate flags in
[scripts/notch-adversarial/cand3-notch.js](../scripts/notch-adversarial/cand3-notch.js),
real-data oracle in
[scripts/notch-adversarial/realdata/](../scripts/notch-adversarial/realdata/README.md).
Every real-data result here is on the public corpora. Results on the private
session recordings are kept outside this repository.

> **Follow-up (2026-10-05), §8.** An adversarial review of V14 found five
> issues (a jump guard that blocked real crescendos, a coherence band
> starting at 80 instead of 75 Hz, test and note claims, a wrong "no real
> evidence" limitation, thresholds scored only in-sample). All were
> verified. `src/` is now **`V18`**: band 75-400 Hz and a takeover test that
> crescendos and dip-and-recover voices cannot trip; it was validated on two
> held-out splits. On those splits a hum taken over by a note of its own
> level fails the strict rule for V14 and V18 alike — §8.1 for the decision.

## Decision

**SHIP `V14`** in `src/dsp/noise-notch.js`. It is bc42ad0's module plus one rule:

- A line that was **not** born at a sound onset gets bc42ad0's onset-born
  20 s clock once it is **voice-confirmed**.
- Voice-confirmed means: ≥ 3 one-second windows, `pcorr` ≥ 0.7 and `pcoh` ≥ 2.5 c.
  These measure how much mid-band (0.5–8 Hz) frequency modulation the line
  shares with its own 2nd partial.
- The voice timing is revoked when the line later reads machine-like
  (`pcorr` < 0.15 or `pcoh` < 1 c), pooled or in its latest window.
- The voice timing is never granted when the line's level rose ≥ 6 dB over
  its first sightings, i.e. a louder source took over a pre-existing line.

Everything else is bc42ad0's. The ship rule holds:

| ship rule | result |
|---|---|
| interferer handling no worse than bc42ad0 in every cell, synthetic | **0 failing cells**. Every metric identical to bc42ad0 in all 1 320 `r2int` / `int` cells, all 168 `handoff-adv` cells, all 600 grid cells and all 32 `dense` cells. FDA: 108 / 109 identical, the 109th notches 0.1 s later with identical metrics. |
| interferer handling no worse than bc42ad0 in every cell, real | **0 failing streams** on 279 noise-only clips and 504 gated sources (gated: identical in 504 / 504). On 784 voice-in-noise mixes, the 3 streams the rule flags are bc42ad0 notching **the voice** (§4c). |
| held notes at least as good as R8 overall | **91.20 %** of hold frames at pitch over the 1 196-scenario held suite (16 + 48 kHz), vs R8 82.61 % and bc42ad0 75.33 %. No scenario is more than 1 pp below bc42ad0. |

**What it does not fix.** Repeated same-pitch holds separated by breaths
stay at bc42ad0's 64–85 %, below R8's ~99 %. Every breath rule tried here
left real gated sources painted (§3).

The brief's other suggested half was a machine-steady line promoting at 5 s
even when onset-born. It was built (`V1`) and rejected (§3).

## 1. The rule and its estimator (online, in the notch)

**Estimator.** Per 25 ms chunk, for each unpromoted track in 80–400 Hz:

- a 64 ms Hann DFT coefficient at the track frequency f and at 2f, on the
  window ending at the chunk boundary and on the one ending a chunk earlier;
- the phase advance between them gives the instantaneous frequency of the
  line and of its 2nd partial.

This is linefeat.py's estimator, ported (`cohIF`). Validated against the
Python on real clips: per window, mean |Δ `corr_mid`| is 0.002 on voice lines
and 0.09 on noisy machine lines. The residual comes from track frequency
differences between the census tracker and the notch's own tracker.

**One-second windows.** 40 consecutive valid chunks form one window. A chunk
is valid when the latest observation, or the one before, saw the line. Each
window gives the mid-band (5-point moving average, detrended) covariances
s12, s11, s22. The last ≤ 5 windows pool into `pcorr` and `pcoh`.

**Additions over the offline study.** Each one was needed in the real worker:

1. **Line-presence gate.**
   - **Rule.** A chunk whose 64 ms line level is ≥ 10 dB under the track's
     running level is invalid.
   - **Why.** Breaths are still inside the 512 ms observation that keeps the
     track "seen", so the 64 ms DFT read noise there.
   - **Measured.** 20 c vibrato holds with 0.15 s breaths got
     machine-classified 11 s in; the breath-straddling window had `coh` −17 c.
2. **Reanchor.**
   - **Rule.** When the line is ≥ 10 dB down for 0.5 s while still seen, the
     running level resets and the windows drop.
   - **Why.** A note that ended over a hum would otherwise freeze the
     measurement.
3. **Revoke.**
   - **Rule.** A voice-timed line that reads machine gets its own timing back.
   - **Why.** In `r2int --part=step`, a fan spinning up reads as shared FM
     until it settles. Without the revoke: 21.45 s vs bc42ad0's 7.75 s.
4. **Last-window revoke.**
   - **Rule.** A voice-timed line is also revoked when its latest single
     window reads machine.
   - **Why.** In `handoff-adv`, a note glided onto a hum; the pooled windows
     still held the glide. Before this rule: 4 / 168 cells ~1.1 s late.
5. **Jump guard (6 dB).**
   - **Rule.** No voice timing for a line whose level rose ≥ 6 dB over the
     median of its first 3 sightings.
   - **Why.** In `handoff-adv` "stop" cells, a hum present from t = 0 is taken
     over by a louder note on the same track, then continues alone.
   - **Measured.** Without the guard: 39 / 168 cells notched at 20 s instead
     of 5.45 s. With a 10 dB guard: 16 / 168 (the hum only ~9 dB under the
     note). With 6 dB: 0.
6. **Strict verdict (0.7 / 2.5 c instead of the study's 0.5 / 2 c).**
   - **Why.** At 0.5 / 2 c, a real pump's 100 Hz motor line was briefly
     voice-confirmed (`pcorr` 0.53). That was 1.1 s of extra painting:
     +3.2 pp on a 20 s noise-only clip, which fails the rule.
   - **Offline trade.** Machine lines ever voice-confirmed fall from 3.4 % to
     1.2 %; real voice at 0 dB falls from 93.5 % to 86 %.

**Cost.** 4 × 1024 complex multiply-adds per measured line per chunk.

## 2. Online verdict on the real corpora (`linecls.mjs`, the shipped estimator)

Promotion is disabled, every observation's verdict is recorded, and a track
counts as voice or machine if **any** observation called it so. Only tracks
reaching ≥ 3 windows get a verdict.

| population | tracks (clips) | ever voice-confirmed | ever machine-confirmed |
|---|---|---|---|
| typical real voice, clean (PVQD < 20, VOICED healthy, VocalSet) | 165 (122) | **100 %** | 0 % |
| same + white noise +20 dB | 166 | 99.4 % | 0.6 % |
| same + white noise +10 dB | 158 | 99.4 % | 0.6 % |
| same + white noise 0 dB | 121 | 97.5 % | 2.5 % |
| real held series (VocalSet, real gaps) | 119 (79) | 100 % | 0 % |
| real machine lines, noise-only clips | 509 (169) | **2.2 %** (6 clips: mains hum ×4, electronics whine ×3, ballast, fan, motor, vacuum) | 98.8 % |
| real gated sources | 1 434 (459) | 1.6 % | 99.2 % |

The ≥ 99 %-of-held-voice operating point the brief asked for holds through
+10 dB. At 0 dB, 97.5 %.

**Superseded 2026-10-05 (§8.5).** This table counts lines *ever*
voice-confirmed. It ran with `--vcorr=0.7 --vcoh=2.5`; the script's default
was still the discovery 0.5 / 2 c. What changes the notch is voice timing by
the 4.9 s promotion point: on V14, 76.5 % of the clean real voice lines that are not
onset-born got it, and 17 were voice-confirmed but blocked by the jump guard.

## 3. Candidates (each one is the evidence for the next)

| id | rule on top of bc42ad0 | held suite | synthetic interferers | real gated (504) | real noise-only (279) |
|---|---|---|---|---|---|
| `R8` | quiet-window breath re-births (round 2) | 82.61 % | `intermit` 25 / 32 fail | **227 fail** | 1 fail |
| `V1` | + machine-confirmed lines promote at 5 s even if onset-born; + voice timing; re-births unless machine | 97.65 % (16 kHz subset) | `step` 4, `weak` 3, `weak2` 2, `handoff` 39 fail | 53 fail | 3 fail |
| `V6` / `V10` | R8 re-births unless machine-confirmed; + voice timing (`V10`: + revoke, jump guard, reanchor) | 98.53 % (`V10`) | `V10`: 0 fail | **99 fail** | 1 fail |
| `V13` / `V12` | re-births only for voice-confirmed lines, 0.5 / 2 c and 0.7 / 2.5 c | 96.42 / 96.22 % (16 kHz) | — | 6 / 3 fail | 1 / 0 fail |
| `V11` | no re-births; voice timing at 0.5 / 2 c | 91.23 % (16 kHz) | — | 0 fail | 1 fail (the pump, +3.2 pp) |
| **`V14`** | no re-births; voice timing at 0.7 / 2.5 c | **91.20 %** | **0 fail** | **0 fail** | **0 fail** |

### Why the machine-confirmed 5 s promotion is not shipped (`V1`)

It would notch switch-on and intermittent sources earlier. It is much faster
on the synthetic `intermit` hum (5.3 s vs 20.3 s) and on 249 / 504 real gated
streams. It failed anyway, on three counts:

1. **Synthetic interferer cells.**
   - In `weak` / `weak2`, it paints 3–7 % more pauses in 5 cells. Notching one
     line of a stack earlier left the rest painting.
   - In `step` dense / spin-up, it fails 4 cells.
   - In `handoff-adv`, 39 / 168 cells are notched late.
2. **Real gated streams.** 53 / 504 fail. A source that settles slowly is
   undecided, then voice-like, then machine.
3. **Held notes.** It notches synthetic zero-wander and breathy holds at
   ~6 s, which bc42ad0 keeps to 20 s. In the steady family, 96.6 % vs 99.9 %
   of hold frames.

The R8-class fix it promised needs the opposite verdict to be safe, and
that verdict cannot be safe (§3, re-births).

### Why no breath re-birth survives (`R8`, `V10`, `V12`, `V13`)

On real sources switched off for 0.15–1 s every 5–8 s, every re-birth rule
leaves some sources painted:

- **Un-gated (`R8`).** 227 / 504 streams, 54 of the 84 sources.
- **Gated "not machine" (`V10`).**
  - 99 / 504.
  - The source cuts out before the line has the 3 windows a verdict needs,
    so the early re-births are allowed and each restarts the clock.
- **Gated "voice-confirmed" (`V12`, `V13`).**
  - 3–6 / 504.
  - An electronics whine and a DCASE fan carry voice-like shared wander;
    these are the ~2 % of machine lines in §2.

Repeated holds with breaths therefore stay a known limitation (bc42ad0's
64–85 %).

## 4. Results of `V14` (= `src/`; parity `V14` vs `SRC`: 0 mismatches in 75 980 messages, 46 held scenarios × 2 rates)

### 4a. Held-note suite

Real worker, 16 + 48 kHz. Cells are % of hold frames at pitch, with the
number of scenarios promoted onto the voice in parentheses.

| family | n | bc42ad0 | R8 | **V14** |
|---|---|---|---|---|
| mid-hold glide / step | 320 | 73.6 (294) | 73.6 (294) | **99.8 (82)** |
| speech → hold | 144 | 66.7 (96) | 66.7 (96) | **93.1 (50)** |
| phonation from 0 / 0.15 s | 96 | 46.2 / 44.9 | 46.2 / 44.9 | **98.4 / 98.6** |
| speech from 0, then a hold | 16 | 54.7 | 54.7 | **100.0** |
| step after a catch breath | 32 | 78.2 | 78.2 | **100.0** |
| ladder through short breaths | 36 | 91.8 | 91.8 | **100.0** |
| repeated holds, 0.15–2 s breaths | 192 | 71.4–85.1 | 98.9–100 | 71.4–85.1 (= bc42ad0) |
| audible inhalations | 80 | 64.5–67.3 | 98.0–100 | = bc42ad0 |
| abrupt-release catch breaths / reverberant repeats | 56 | 66.7 / 65.3 | 91.7 / 91.5 | = bc42ad0 |
| steady, vowel change, messa di voce | 224 | 100.0 | 100.0 | 100.0 |
| **all** | 1 196 | **75.33** | **82.61** | **91.20** |

No scenario is more than 1 pp below bc42ad0. The remaining speech → hold
misses are breathy synthetic notes (H1–H2 12 dB, HNR 10 dB). Their 2nd
partial is too noisy for `pcorr` ≥ 0.7, so they get no verdict and keep
bc42ad0's timing.

### 4b. Synthetic interferers

The parts below were run at 16 and 48 kHz under the strict rule vs bc42ad0.
Every cell's metrics (promotion time, worker / painted FV, speech accuracy) are identical to bc42ad0:

- `r2int` `intermit` / `shared` / `step` / `masked` / `beatpause`: 668 cells;
- `int` `start` / `weak` / `weak2`: 652 cells;
- `handoff-adv`: 168 cells;
- the 2026-10-03 grids: 600 cells;
- `dense`: 2 × 16 cells.

FDA × interferer (4 placements, 109 cells): 108 identical. In the 109th
(fan-hum from t = 0, +10 dB) the first notch comes 0.1 s later, with every
metric identical.

### 4c. Real-noise oracle (`realeval.mjs`, real worker, 16 kHz)

Voice in noise: the 784 data-phase streams whose voice program is public
(recounted 2026-10-05 from the per-stream results; a public-only rebuild draws
the `other` programs afresh).

| set | streams | bc42ad0 | R8 | V14 |
|---|---|---|---|---|
| noise-only, painted FV (mean promotion [never]) | 279 | 10.1 % (10.0 s [143]) | 10.2 %; 1 stream +11 pp (ballast) | 10.1 %; **0 fail** (278 identical) |
| gated real sources, painted FV from switch-on +21 s ([never]) | 504 | 15.0 % [223] | 21.3 % [416]; **227 fail** | 15.0 % [223]; **identical 504 / 504** |
| real VocalSet held series, hold frames at pitch | 192 | 99.4 % (notched onto the voice 1 / 192) | identical | identical |
| voice in real noise (+10 / 0 dB), voice frames painted at pitch | 784 | 52.4 % | identical 784 / 784 | **52.5 %** |

**Voice in noise, stream by stream.** 771 / 784 streams are identical to
bc42ad0. The 13 that differ:

- **7 streams gain on the voice.**
  - bc42ad0 notched a line on the voice during the program; `V14` leaves it
    un-notched. Traced on 3 of the 7.
  - Painted voice +0.7 to +40 pp, held frames up to 100 %.
  - The streams are PVQD /a/ in a hair dryer or an air conditioner, a VocalSet
    series in a vacuum cleaner, and PVQD in mains hum.
  - The strict rule flags 3 of them as "never notched (bc42ad0 37.2 / 25.3 s)".
    Traced, that bc42ad0 notch sits on the voice (195.3 Hz on a 195.5 Hz /a/;
    133–134 Hz on a 132–134 Hz hold series). They are voice wins, not
    interferer failures. `agg-real.mjs` cannot tell which line a promotion is
    on, so those 3 flags are false positives.
- **6 streams cost a little.** These are the electronics whine 124015, a
  voice-like machine line.
  - Its second line is notched up to ~1 s later.
  - Lead painted FV is +1.6 pp, inside the rule's +2 pp.
  - Painted voice is −0.5 to −2 pp.

### 4d. bc42ad0 vs R8 on real recordings (for the open bc42ad0-vs-R8 decision)

**Is R8's failure class present in real recordings?** Only when a tonal
source **switches on** and then cuts out:

- **Natural recordings.** The two noise clips with the R8 signature (freesound
  mains_hum 438501, MS-SNSD CopyMachine_10) behave identically under R8 and
  bc42ad0. The source is present from the start, so its line is not
  onset-born, and R8's re-births never apply.
  - All 279 noise-only clips: R8 = bc42ad0 in 277.
  - All 784 voice-in-noise mixes: identical in 784 / 784.
- **Arranged.** Real sources switched on at 2 s and cut out briefly (the
  `noise_gated` mixes): R8 fails 227 / 504 streams, 54 of 84 sources.
  - Never notched in 416 vs 223 for bc42ad0.
  - Painted FV after the accepted 21 s latency: 21.3 % vs 15.0 %.
  - Worst cases paint 82–97 % of the audio (electric fan, ballasts).
- **R8's gain does not show on real holds.**
  - bc42ad0 never notched 191 / 192 real VocalSet same-pitch hold series. Real
    long tones last 2–3.5 s and their duty falls below 0.9 across real gaps.
  - The repeated-holds failure needs ≥ 8 s holds, which no open corpus has.

### 4e. Committed oracles and sessions (bc42ad0 module vs `V14`, otherwise identical trees)

| oracle | result |
|---|---|
| `noise-augment-oracle.js pitch --frontend=tracker`, 8 default classes × 20 / 10 / 5 dB | **byte-identical** apart from wall-clock lines (e.g. fan-hum 78.0 / 77.8 / 76.7 % correct) |
| same, 6 extra tonal classes (fan-wobble 0.6 / 1.5, fan-drift, hum-rich 120 / 60, wobble + rich) × 10 / 5 dB | byte-identical |
| same, vocadito × fan-hum / mains-complex / sleep-birdies | byte-identical |
| `noise-augment-oracle.js gender` | byte-identical |
| `voicing-robustness-shootout.js` | byte-identical |
| session oracle, 4 private sessions | `.hops.f32` **byte-identical on all 4 sessions**, so every `analyze.py` row is equal (results on the private session recordings are kept outside this repository) |
| `boersma-ac-test` 41 / 41, `pitch-worker-above-range-test` 7 / 7, `pitch-paint-gate-test` 43 / 43, `pitch-gate-test` 26 / 26, `eslint .`, `vite build` (to a scratch outDir) | pass |

## 5. Tests (`tests/dsp/noise-notch-test.js`)

The tests run through the real worker.

**Former KNOWN LIMITATIONs, now checks.**
- Glide / step mid-hold: 15 c vibrato, and 10 c vibrato + 3 c wander.
- Speech → hold, modal.
- Phonation from 0.15 s.

**Still printed as KNOWN LIMITATION.**
- 3 c wander alone: too little shared modulation for a verdict.
- Breathy speech → hold.
- All repeated-hold cases.

**New interferer guards.**
- **(l)** A hum taken over by a louder note on its track: bc42ad0's 5.45 s
  + 0.3 s.
- **(m)** A spinning-up fan: bc42ad0's 21.45 s + 0.3 s.
- The round-1 and round-2 guards (a)–(k) all still pass, including (k), the
  intermittent hum R8 never notched.

**New real-recording cases.** The clips are committed in
`tests/dsp/data/notch-real/`, with licenses and sources in its README. They
are 0.9 MB in all:
- a 10 s CC0 MS-SNSD air-conditioner excerpt;
- VocalSet long tones of two singers, CC BY 4.0.

The cases:
- **(r1)** The real air conditioner from t = 0 is notched by 5.75 s.
- **(r2)** The same source cutting out 0.15 s every 5 s after switching on is
  notched by 20.55 s. R8's failure class, on a real source.
- **(r3)** A real long tone looped into a 10–14 s hold, after 3 s of speech
  and from t = 0.15 s: ≥ 95 % of hold frames. bc42ad0 fails the 128 Hz
  t = 0.15 s case (47.0 %); the other three are not notched by bc42ad0 either.
- **(r4)** The real notes over the real air conditioner at +10 dB: the
  compressor stack is notched by 5.75 s, and the notes keep ≥ bc42ad0's frames.
  - 262 Hz: 58.6 % on both modules; octave errors in this noise.
  - 128 Hz: 100 % vs bc42ad0's 58.2 %; bc42ad0 notched the voice's line.

On bc42ad0 the file fails 12 checks: the 10 glide / speech → hold / phonation
checks, (r3) at 128 Hz from 0.15 s, and (r4) at 128 Hz. On `V14`: **77 passed, 0 failed**, plus 15 KNOWN LIMITATION lines.

## 6. Limitations (honest)

- **Historical (superseded 2026-10-05, wrong — see §8.9):** **No real
  evidence for the shapes it fixes.** The glide / speech → hold /
  early-phonation failures need a line held ≥ 5 s that was not born at an
  onset. Real corpus holds are ≤ 3.5 s (VocalSet) or ≤ 7.6 s (PVQD /a/), and
  bc42ad0 notched only:
  - 1 / 192 real hold series;
  - 3 real voice-in-noise programs (all fixed here).

  The wins in §4a are synthetic, plus test (r3)'s looped real tone. Real long
  holds (≥ 5 s) are still unrecorded.
- **The verdict needs shared modulation.** 2.5 c is the floor:
  - A voice with < ~2.5 c of shared 0.5–8 Hz modulation (3 c of slow wander
    alone, a very straight tone) gets no verdict and keeps bc42ad0's timing.
  - So does a voice whose 2nd partial is weak or noisy (breathy).
  - The offline study's p1 for real voices is 2.4 c; the online census
    called 100 % of clean real voice lines voice.
- **Voice-like machines.** ~2 % of real machine lines (mains buzz, electronics
  whine, a ballast, a fan) can be voice-confirmed.
  - If such a line is present from the stream start and not onset-born, it is
    notched up to 20 s late instead of 5 s.
  - Measured worst cost: whine 124015, +1.6 pp painted in noise-only lead
    segments.
- **Repeated holds with breaths, holds ≥ 20 s** are bc42ad0's limits,
  unchanged.
- **Real data ran at 16 kHz only.** The synthetic suite ran at both rates.

## 7. Reproduction (repo root)

```bash
bash scripts/notch-adversarial/setup.sh
S=scripts/notch-adversarial; RD=$S/realdata; R=build/notch-adv/res7
node $S/parity.mjs V14 SRC 13 16000,48000
bash $S/shards.sh $R/held 6 $S/held.mjs --variants=B,R8,SRC --sr=16000,48000
node $S/agg-held.mjs $R/held --vars=B,R8,SRC --by=sub --worse
for p in intermit shared step masked beatpause; do bash $S/shards.sh $R/r2_$p 6 $S/r2int.mjs --part=$p --variants=B,R8,SRC --sr=16000,48000; done
for p in start weak weak2; do bash $S/shards.sh $R/int_$p 6 $S/int.mjs --part=$p --variants=B,R8,SRC --sr=16000,48000; done
bash $S/shards.sh $R/hadv 6 $S/handoff-adv.mjs --variants=B,SRC --sr=16000,48000
for p in nonly start midsp midpa; do bash $S/shards.sh $R/fda_$p 6 $S/fda.mjs --part=$p --variants=B,SRC; done
for s in main req; do bash $S/shards.sh $R/grid_$s 6 $S/grid.mjs --set=$s --variants=B,SRC; done
node $S/dense.mjs --variants=B,SRC; node $S/dense.mjs --variants=B,SRC --sr=48000
for s in noise gated held vin; do bash $S/shards.sh $R/real_$s 6 $RD/realeval.mjs --set=$s --variants=B,R8,SRC; done
for s in noise gated held vin; do node $RD/agg-real.mjs $R/real_$s --vars=B,R8,SRC --fails=20; done
for s in noise gated held; do bash $S/shards.sh $R/cls_$s 6 $RD/linecls.mjs --set=$s --vcorr=0.7 --vcoh=2.5; done
bash $S/shards.sh $R/cls_voice 6 $RD/linecls.mjs --set=voice --deg=inf,20,10,0 --vcorr=0.7 --vcoh=2.5
bash $S/oracles.sh bc42 src    # (sessions.sh needs the private session recordings, not in this repo)
node tests/dsp/noise-notch-test.js
# candidate variants V1-V14 (variants.mjs) run the same way with --variants=...
```

Runs above used ≤ 6 concurrent node processes. The machine is shared, and a
resource governor may suspend jobs.

## 8. Follow-up (2026-10-05): review of V14 → `V16` → held-out split 1 → `V18` → split 2

An adversarial review of V14 raised five findings. Each was verified, then
fixed (`V16`). `V16` was frozen and run on a first held-out split. That split
showed one real voice on which `V16`'s new guard fired (`V18` fixes it) and
one synthetic takeover cell that neither fixes. `V18` (now `src/`) was frozen
and run on a second, fresh held-out split. Everything below is on public data
or synthesis. Results on the private session recordings are kept outside this
repository.

### 8.1 Verdict

**`V18` is at least as good as V14 on every voice measure, in-sample and on
both held-out splits (no stream or scenario more than 1 pp below V14). It is
identical to V14 on every in-sample synthetic, noise-only and gated cell; on
voice-in-noise it differs in 4 of 784 streams, all voice gains. It meets the
ship rule on every cell the rule was defined on. It does NOT meet the rule on the
held-out takeover grids — and neither does V14:** a hum taken over by a note
of about its own level within ~3 Hz of it (the two beat, so the line never
jumps cleanly) is notched up to 2.1 s later than bc42ad0, with up to +6.3 pp
of painted false voicing in the next pause. Split 1: V14 0 / 432 cells fail,
`V18` 1 / 432. Split 2: V14 6 / 648, `V18` 11 / 648 (all at an 85 Hz hum at
rms 0.04 / 0.07). Shipping `V18` over V14 trades those few takeover cells for
the voice wins below; whether to ship it, keep V14, or go back to bc42ad0 is
the user's decision.

| ship rule (vs bc42ad0, every cell) | V14 (7998e22) | **V18 (= `src/`)** |
|---|---|---|
| synthetic interferer cells: `r2int` 668, `int` 652, `handoff-adv` 168, FDA × interferer 109, 2026-10-03 grids 600, `dense` 32 | 0 fail | **0 fail**; every cell identical to V14 |
| real noise-only 279 / gated 504 | 0 fail | **0 fail**; = V14 in 279 / 279 and 504 / 504 |
| real voice-in-noise 784 | 3 flagged, all bc42ad0 notching **the voice** | 4 flagged, all bc42ad0 notching the voice |
| held-note suite, the 1 196 scenarios V14 was chosen on (16 + 48 kHz) | 91.20 % | **91.30 %** (bc42ad0 75.33 %) |
| new held families: crescendo / messa di voce, dip-and-recover, 76-79 Hz, subito (274 runs) | 59.9 % | **90.3 %** (bc42ad0 40.0 %) |
| real voice only, new (297 streams) | notches the voice in 5 | **in 0** (bc42ad0 33) |
| **held-out 1**: takeover grid (432 cells) | 0 fail | **1 fail** (+0.5 s, +2.2 pp) |
| **held-out 1**: real noise (119 clips) | 0 fail | **0 fail** (identical to bc42ad0) |
| **held-out 1**: real voice (260 streams, 56 new speakers) | notches the voice in 34 | **in 30** (bc42ad0 176) |
| **held-out 2**: takeover grid (648 cells) | **6 fail** (≤ +2.1 s, ≤ +2.1 pp) | **11 fail** (≤ +2.1 s, ≤ +6.3 pp) |
| **held-out 2**: real voice (407 streams, 95 new speakers) | notches the voice in 89 | **in 83** (bc42ad0 287) |

### 8.2 The findings, verified

| # | review finding | verified | evidence |
|---|---|---|---|
| 1 | The 6 dB jump guard (≥ 6 dB over the median of the first 3 sightings) blocks voice timing for a crescendo at the note's start | **yes** | Real PVQD sustained vowels from t ≈ 0 (Sj6001, SJ2012, SJ5009) rise 5-11 dB over their first 1-3 s, trip the guard, and V14 notches the vowel at 5.45-5.85 s like bc42ad0; held on to ~13 s by looping their last steady 2 s: 35.6 / 36.6 / 39.1 % of hold frames on both. The (r3) 128 Hz VocalSet hold with a -6 → 0 dB swell over 2 s: 47.0 % on both. Census (§8.5): 17 of 102 clean real voice lines that are not onset-born are voice-confirmed but blocked by the guard. |
| 2 | `cohLoHz` is 80 Hz, the display / detector band starts at 75 Hz | **yes** | Phonation from t = 0 / 0.15 s at 76-79 Hz (10 c vibrato + 3 c wander): 31.6-31.7 % on V14, notched at 5.45 s (= bc42ad0); 82 / 90 Hz: 100 %. |
| 3 | Test and note claims | **yes** | (a) On bc42ad0 three of the four (r3) holds pass; only the 128 Hz hold from 0.15 s discriminates. (b) §2 counts "ever voice-confirmed", not voice timing by the 4.9 s promotion point. (c) `linecls.mjs` defaulted to the discovery thresholds 0.5 / 2 c. |
| 4 | "No real evidence for the shapes it fixes" (§6) is wrong | **yes** | PVQD sustained vowels are real phonation from t ≈ 0: `pvqd__Sj6002_ENSS` (99.5 Hz) — bc42ad0 paints 198 / 453 hold frames at pitch, V14 453 / 453. §8.4 adds a 297-stream real voice-only set. |
| 5 | Thresholds and guards were scored on the cells used to choose them | **yes** | The 0.7 / 2.5 c verdict, the guard and the revokes were chosen on the 279 noise-only clips and the 168 `handoff-adv` cells. §8.6 adds two held-out splits — and the takeover cells failing there show the in-sample cells did not cover the case. |

### 8.3 The fix

`src/dsp/noise-notch.js` = variant `V18` (`scripts/notch-adversarial/
cand3-notch.js` + `variants.mjs`). Parity `V18` vs `SRC`: 0 mismatches in
89 506 worker messages (57 scenarios × 16 + 48 kHz, no memo).

1. **Band.** `cohLoHz` / `cohHiHz` = `PITCH_DISPLAY_RANGE.low` / `.high`
   (75 / 400 Hz): the verdict covers exactly the band the trace shows.
2. **Takeover guard.** No voice timing for a line that rose ≥ 6 dB
   (`cohJumpDb`) within 6 observations (`cohJumpRiseObs`, ~0.6 s) over a
   level that held within 1.5 dB (`cohJumpStableDb`) for 3 consecutive
   sightings (`cohJumpRefObs`) and was the line's loudest so far: no earlier
   sighting more than 3 dB above it (`cohJumpPeakTolDb`). That is a louder
   source starting on a line that was already there (a note sung on a hum's
   track).
   - **No crescendo passes it.** At a constant slope of s dB per observation
     the 3-sighting reference spans 2s and the rise reaches ~7s. Firing needs
     2s ≤ 1.5 and 7s ≥ 6, i.e. s ≤ 0.75 and s ≥ 0.86: impossible. A voice's
     attack has no steady level before it.
   - **No dip-and-recover passes it** (`V18`'s addition). A voice that fell
     after its onset, steadied and came back was louder before its steady
     stretch; a hum that a note takes over never was.
   - **What it gives up.** A *subito forte* (≥ 6 dB within ~0.5 s after
     ≥ 0.3 s at a steady level that is the loudest so far) in the first
     seconds of a not-onset-born hold is the takeover's own signal. It keeps
     bc42ad0's timing (`subito` family: 36.9 % on bc42ad0, V14 and V18).
   - **What it does not catch.** A note at about the hum's own level on the
     hum's track: the two beat, the line never rises 6 dB cleanly over a
     steady level, the note gets voice timing, and the timing is revoked only
     once a 1 s window of the hum alone has been read after the note (§8.6).
     V14's guard misses 6 of the 11 such split-2 cells; it catches the other
     5 and split 1's one, that one by 0.1 dB.

**How the values were chosen, and when they were frozen.**

| step | what | data |
|---|---|---|
| `V16` | P = 3, R = 6 and 6 dB set first. A 3 dB steadiness let a -12 → 0 dB / 1 s crescendo fire (1.2 dB per observation reads as steady), so the bound above set 1.5 dB. | synthetic crescendos; the 168 in-sample `handoff-adv` cells checked (0 late) |
| frozen | `V16` run on **held-out split 1** (§8.6) | 432 takeover cells, 119 real noise clips, 260 real voice streams |
| `V18` | + the loudest-so-far condition, tolerance 3 dB (half the jump), against the one real-voice false positive split 1 showed: a Coswara /a/ dipped 13 dB after its onset, steadied at ~31 dB, then rose 7 dB in 0.4 s. `V16` notched it 5.4 s in (40.2 % of hold frames vs V14 99.0 %). `V17` (grant voice timing only while the latest window's correlation is ≥ 0.7) was tried on split 1's failing takeover cell and rejected: it does not fix it. | that stream (split 1 is therefore in-sample for `V18`'s addition) |
| frozen | `V18` run on **held-out split 2** (§8.6) | 648 new takeover cells, 407 streams of 95 new Coswara speakers |

`V18` differs from `V16` only by firing the takeover test less often. A
notch-only scan (`lib.mjs` `NOTCH_SCAN=V16:V18`: per cell, do the two notches
hand the worker identical samples and lines?) found **no differing cell** in:

- the whole synthetic suite (`held` 1 406, `r2int` 668, `int` 652,
  `handoff-adv` 168 + 432, FDA 109, grids 600, `dense` 32);
- the real noise-only, gated, held-series and voice-only sets (279 / 504 /
  192 / 297);
- split 1's real noise (119);
- all 784 voice-in-noise streams.

Where the notches agree, the worker messages are byte-identical. So every
`V16` number of §8.4 on those cells is `V18`'s.

### 8.4 Ship rule re-run: bc42ad0 / V14 / V18

All variants run through `lib.mjs`'s notch-level memo: variants whose notch
hands the worker identical samples and lines share one worker run.

- `memo-check.mjs`: 0 mismatches in 66 678 messages.
- The `handoff-adv` rows of a memo-free baseline run match the memo run in
  140 / 140 cells.

bc42ad0, V14 and V16 (= V18, §8.3) ran in one pass at 7998e22 + this change.
Main's merge changed only comments in the pitch path, so V14's worker
messages are unchanged from §4.

**Held-note suite** (`held.mjs`, real worker, 16 + 48 kHz; % of hold frames
at pitch; in parentheses, scenarios with a notch on the voice):

| family | runs | bc42ad0 | V14 | **V18** |
|---|---|---|---|---|
| mid-hold glide / step | 320 | 73.6 (294) | 99.8 (82) | **99.8 (82)** |
| speech → hold | 144 | 66.7 (96) | 93.1 (50) | **94.0 (48)** |
| phonation from 0 / 0.15 s | 96 | 46.2 / 44.9 | 98.4 / 98.6 | **98.4 / 98.6** |
| speech from 0 then a hold / step after a catch breath / ladder | 84 | 54.7 / 78.2 / 91.8 | 100 | **100** |
| repeated holds, inhalations, abrupt / reverberant breaths | 328 | 64.5-85.1 | = bc42ad0 | **= bc42ad0** |
| steady, vowel change, dynamics (onset-born) | 224 | 100.0 | 100.0 | 100.0 |
| **new** swell: crescendo -6 / -10 / -12 → 0 dB, messa di voce; not onset-born (from t = 0 / 0.15 s, or after speech); 78-220 Hz | 146 | 40.5 (142) | 56.4 (120) | **97.4 (62)** |
| **new** dip and recover (-10 / -13 dB after the onset, back within 0.4 s) | 64 | 37.4 | 84.3 | **100.0** (V16 37.4) |
| **new** low: 76 / 77 / 79 Hz from t = 0 / 0.15 s; 78 Hz glide / step | 32 | 45.3 (32) | 50.0 (24) | **92.1 (8)** |
| **new** subito forte (known limitation) | 32 | 36.9 | 36.9 | 36.9 |
| the 1 196 scenarios of §4a | 1 196 | 75.33 | 91.20 | **91.30** |
| **all** | 1 470 | 68.74 | 85.37 | **91.12** |

- No scenario is more than 1 pp below V14 or below bc42ad0.
- 142 scenarios are more than 1 pp above V14: swell 100, low 24, dip 16 (the
  78 Hz ones; V14 keeps the others), speech → hold 2.
- The remaining swell / low misses are breathy synthetic notes (H1-H2 12 dB,
  HNR 10 dB) whose upper partials get no verdict (60-79 %).

**Synthetic interferers.** Every cell is identical to V14 in every metric:
`r2int` 668, `int` 652, `handoff-adv` 168, FDA × interferer 109, grids 600,
`dense` 32 (16 + 48 kHz where the part runs both). Against bc42ad0 every cell
is identical except two:

- **FDA fan-hum from 0, +10 dB.** V14 already had it: the first notch comes
  0.1 s later, every metric equal.
- **One `r2int intermit` cell.** This run's **bc42ad0** row reads 9.15 s
  instead of its documented 20.25 s. Three re-runs of that cell (with and
  without the memo, other variant orders) all give 20.25 s, as in round 2.
  It is a non-reproducible glitch of the run. V14 / V18 pass the rule either
  way (20.25 s ≤ 21 s).

**Real-noise oracle** (`realeval.mjs`, 16 kHz):

| set | streams | bc42ad0 | V14 | **V18** |
|---|---|---|---|---|
| noise-only, painted FV (mean promotion [never]) | 279 | 10.2 % (10.0 s [143]) | 0 fail; 278 identical | **0 fail**; = V14 in 279 / 279 |
| gated real sources, painted FV from switch-on + 21 s | 504 | 15.0 % [223] | identical 504 / 504 | **identical 504 / 504** |
| voice in real noise (+10 / 0 dB), voice frames painted at pitch | 784 | 52.5 % | 52.6 %; 3 flagged | **52.6 %; 4 flagged** |
| real VocalSet held series, hold frames painted at pitch | 192 | 99.36 % (notched onto the voice 1 / 192) | 99.36 % (1 / 192) | **99.61 % (0 / 192)** |
| **new: real voice only** (below) | 297 | notches the voice in 33 | in 5 | **in 0** |

- **Noise-only.** V14 / V18 differ from bc42ad0 on one clip only: the
  electronics whine 124015 (+0.4 pp painted).
- **Voice in noise.** All 4 streams the strict rule flags are bc42ad0
  notching the voice:
  - the 3 traced for V14 (§4c);
  - one where bc42ad0 notches 256.8 Hz at 28.65 s. That is the 2nd harmonic
    of a 128.3 Hz VocalSet hold series in an air conditioner at +10 dB. Lead
    / tail painted FV and voice frames are identical.

  The electronics-whine streams cost +1.6 pp of lead painted FV, as for V14
  (inside the +2 pp rule).
- **Held series.** V18 gains one series: a male singer at 129 Hz with 0.15 s
  gaps. bc42ad0 and V14 notch it at 13.8 s (54.7 % painted); V18 keeps 100 %.

**Real voice only** (`realeval.mjs --set=voice`, finding 4). No noise is
added, so every notch is a cost. In parentheses: hold frames painted at pitch
over the streams where bc42ad0 notches the voice.

| kind | streams | bc42ad0 notches the voice | V14 | **V18** |
|---|---|---|---|---|
| PVQD sustained vowels as recorded (phonation from t ≈ 0) | 65 | 4 (81.3 %) | 3 (97.1 %) | **0 (99.8 %)** |
| PVQD held segments ≥ 5 s, the stream starting 0.3 s in | 38 | 17 (93.2 %) | 0 (100 %) | **0 (100 %)** |
| VocalSet same-note phrase ≥ 14 s, starting mid-note | 48 | 5 (54.9 %) | 1 (96.2 %) | **0 (100 %)** |
| VocalSet messa di voce looped, from the soft start / mid-swell | 146 | 7 (53.2 %) | 1 (94.7 %) | **0 (100 %)** |
| **all** | 297 | **33** (73.0 %) | **5** (97.5 %) | **0** (100.0 %) |

V18 promotes no notch at all in any of the 297 streams. Pooled over all of
them: 96.94 / 99.45 / **99.70 %**. No stream is more than 1 pp below
bc42ad0.

### 8.5 Time to the voice verdict (finding 3)

`linecls.mjs` now runs a variant's own coherence options with voice timing on
(default `V18`, verdict 0.7 / 2.5 c). Every row records the variant, the
thresholds and the band. Per line it records the time from the first sighting
to the first voice verdict, to the voice timing and to the jump guard.

Typical real held voice: PVQD CAPE-V < 20, VOICED healthy, VocalSet,
vocadito; lines with ≥ 3 windows; "not onset-born" = the lines voice timing
is for.

| white noise | lines | voice-confirmed | verdict by 4.9 s (p50 / p90) | not onset-born | **voice timing by 4.9 s, V14** | **V18** | blocked by the guard, V14 / V18 |
|---|---|---|---|---|---|---|---|
| none | 162-163 | 100 % | 85.8 % (3.0 / 5.3 s) | 102 / 103 | 76.5 % | **85.4 %** | 17 / **0** |
| +20 dB | 164 | 100 % | 86.6 % | 106 / 107 | 77.4 % | **86.9 %** | 18 / **0** |
| +10 dB | 160 | 98.8 % | 85.6 % | 112 | 80.4 % | **87.5 %** | 15 / **1** |
| 0 dB | 133 | 96.2 % | 82.7 % | 133 / 134 | 81.2 % | **81.3 %** | 8 / **1** |

- **Lines bc42ad0 would notch.** These are the lines not onset-born and seen
  ≥ 4.9 s at duty ≥ 0.9 (5 clean, 13 at 0 dB). V18 times 4 / 5 and 12 / 13
  of them by 4.9 s; V14 times 2 / 5 and 10 / 13.
- **Why the rest are missed.** They get their verdict after 4.9 s: three
  1 s windows of 40 consecutive valid chunks take ≥ 3 s, longer when gaps
  restart them. They are not blocked by the guard.
- **Real VocalSet held series.** 80 % of not-onset-born voice lines get voice
  timing on V18, 33 % on V14.
- **Machine lines** (real noise-only clips, gated sources) are unchanged. On
  both V14 and V18, 2.1 % of noise-only lines and 1.7 % of gated lines are
  ever voice-confirmed; 1.1 % / 0 % get voice timing. The same 6 sources
  carry a voice-confirmed line: electric motor 824119, electronics whine
  124015, mains hum 438501, electric fan 787708, MS-SNSD VacuumCleaner_5,
  ballast 383657. 3 of them are granted voice timing.

### 8.6 Held-out validation (finding 5)

None of these cells, sources or speakers chose any threshold. Split 1 is
in-sample for `V18`'s added condition only (§8.3).

- **Takeover grids** (`handoff-adv.mjs --heldout` / `--heldout2`, 16 + 48 kHz).
  - **Split 1** (432 cells): hum at 100 / 150 Hz (tuning: 120 Hz), note at
    0.93-1.1 x the hum from 1 or 2.5 s for 3 or 10 s, hum rms 0.005 / 0.02 /
    0.05 (tuning: 0.01 / 0.03), 15 c vibrato + 4 c wander (tuning: 10 + 3),
    new seeds and harmonic phases.
  - **Split 2** (648 cells): hum at 85 / 135 / 180 Hz, note at 0.95-1.07 x
    from 1.5 or 3 s for 4 or 7 s, rms 0.008 / 0.04 / 0.07, 12 c + 2.5 c,
    other seeds and phases.
- **Real noise** (split 1). Two sources:
  - the DCASE 2020 Task 2 *additional training* machines: 18 physical fans /
    pumps / sliders / valves / toy cars / conveyors whose ids the tuning
    corpus does not contain;
  - 101 Freesound clips for 34 queries disjoint from the corpus's (boilers,
    pool pumps, range hoods, shavers, compressors, amplifier hum, vehicle
    interiors and others); sounds already in the corpus were skipped.
- **Real voice**: sustained /a/ /e/ /o/ of Coswara participants (CC BY 4.0;
  healthy, audio-quality label ≥ 1), recorded on their own phones and
  laptops — speakers in no tuning corpus. The stream starts 0.15 s before
  the first ≥ 4 s hold (not onset-born) or 0.3 s into each ≥ 5 s hold.
  - Split 1: one recording date, 260 streams, 56 speakers (41 male / 15
    female).
  - Split 2: another date, 407 streams, 95 speakers (79 / 16).

| held-out | bc42ad0 | V14 | V16 | **V18** |
|---|---|---|---|---|
| split 1 takeover: cells later than bc42ad0 + 0.3 s or FV > + 2 pp | — | 0 / 432 | 1 / 432 | **1 / 432** |
| split 2 takeover: same | — | 6 / 648 | 11 / 648 | **11 / 648** |
| split 1 real noise: streams failing the rule | — | 0 / 119 | 0 / 119 | **0 / 119** (all 119 identical to bc42ad0) |
| split 1 real voice: streams with the voice notched / hold frames painted at pitch | 176 / 72.4 % | 34 / 96.8 % | 32 / 96.9 % | **30 / 97.2 %** |
| split 2 real voice: same | 287 / 65.4 % | 89 / 90.0 % | 86 / 90.5 % | **83 / 90.7 %** |
| split 2 real voice, male / female streams (340 / 67): voice notched (painted %) | 259 (62.4) / 28 (80.3) | 83 (89.5) / 6 (92.8) | 82 / 4 | **79 (89.6) / 4 (96.3)** |

`V18` vs V14 on the held-out voice streams: 0 streams more than 1 pp worse
in either split, 3 (split 1) and 5 (split 2) more than 1 pp better.

**The takeover failures** (split 1: 150 Hz hum at rms 0.05, 150.6 Hz note;
split 2: 85 Hz hum at rms 0.04 / 0.07, note at 85.17 or 87.55 Hz — all on
the hum's track, the note about as loud as the hum). Traced on the split-1
cell (48 kHz; its 16 kHz twin passes):

1. The note joins the hum's line at 1 s. The two beat at 0.6 Hz, so the line
   rises only 4.7 dB within 6 observations of its steady 42.7 dB, and the
   takeover test does not fire.
2. The pooled verdict arrives at 5.0 s, after the note ended (4.0 s), from
   windows that still hold the note.
3. The first window of the hum alone revokes the timing at 6.0 s and the
   line is notched then. bc42ad0 notches it at 5.45 s, mid-note.

V14's first-3 guard fired there on a +6.1 dB beat peak (0.1 dB over its
threshold). On split 2 V14 fails 6 cells of the same kind. In split 2,
`V18` is late by up to 2.1 s (V14 2.1 s), and its painted FV in the pause
after the note is higher by up to 6.3 pp (V14 2.1 pp).

**Margins.**

- **Takeover test** (`takeover-margin.mjs`, notch only, 16 kHz). Among cells
  where the hum's line reads voice-confirmed (where the guard matters), the
  hum's rise over its steady level minus 6 dB:

  | cells | guard relevant | minimum | p10 | median |
  |---|---|---|---|---|
  | tuning | 17 / 84 | +2.6 dB | +2.6 dB | +9.3 dB |
  | split 1 | 40 / 216 | **-2.3 dB** | -0.65 dB | +5.5 dB |
  | split 2 | 81 / 324 | **-6.0 dB** | -2.3 dB | +10.4 dB |

  The steady pre-note reference was within 0.01 dB in every cell (limit
  1.5 dB): the steadiness bound is never the binding condition. The jump is.
- **Voice verdict, real noise** (`linecls.mjs`, V18). Per source, the margin
  is 1 - the largest `min(pcorr / 0.7, pcoh / 2.5)` any of its lines reached.
  - Split-1 noise, 79 sources with a measured line: p50 0.75, p90 0.38.
    4 sources have a voice-confirmed line: two small motors, a vehicle
    interior and an engine idle; 3 of them get voice timing. V14: 3 sources,
    2 with timing. Their realeval streams are identical to bc42ad0 anyway.
  - Tuning noise, 172 sources: p50 0.74, p90 0.40. The same 6 sources and
    3 granted on V14 and V18.
- **Voice verdict, held-out speakers** (`linecls.mjs`, V18). Clean Coswara
  voice lines with ≥ 3 windows: 98.6 % (split 1) / 99.0 % (split 2) reach
  the voice verdict; the p10 line is at 1.25 / 1.24 x the threshold.
  - The verdict comes later than on the corpus voices: p50 3.8 / 4.2 s,
    p90 7.0 / 7.9 s.
  - So only 46 % of not-onset-born lines get voice timing by 4.9 s
    (split 1 / 2; V14: 44 / 46 %).
  - That is why V18 still notches 30 / 83 held-out streams.

### 8.7 Committed oracles and the session oracle

bc42ad0's module vs V18 (= `src/`), otherwise identical trees
(`oracles.sh bc42 src`):

| oracle | result |
|---|---|
| `noise-augment-oracle.js pitch --frontend=tracker`, 8 default classes × 20 / 10 / 5 dB | **byte-identical** apart from wall-clock lines (fan-hum 78.0 / 77.8 / 76.7 % correct) |
| same, 6 extra tonal classes (fan-wobble 0.6 / 1.5, fan-drift, hum-rich 120 / 60, wobble + rich) × 10 / 5 dB | byte-identical |
| same, vocadito × fan-hum / mains-complex / sleep-birdies | byte-identical |
| `noise-augment-oracle.js gender` | byte-identical |
| `voicing-robustness-shootout.js` | byte-identical |
| session oracle | On the private session recordings, V18's per-hop outputs stayed byte-identical to bc42ad0's on every session (results kept outside this repository). |
| `npm run lint`, `npm run test:unit` (18 / 18 scripts, incl. this test file, `boersma-ac-test`, `pitch-gate-test`, `pitch-paint-gate-test`, `pitch-worker-above-range-test`), `npm run test:dsp` (109 passed), `vite build` (to a scratch outDir) | pass |

### 8.8 Tests (`tests/dsp/noise-notch-test.js`)

**93 passed, 0 failed** on V18 (bc42ad0: 66 passed / 27 failed; V14: 80 / 13; V16: 91 / 2, the dip-and-recover checks). New checks:

- **75-80 Hz voices**: 77 Hz from t = 0 and 0.15 s, 76 Hz, 79 Hz (V14
  31.7 %).
- **Crescendo / messa di voce** from t = 0.15 s at 120 and 220 Hz: -12 → 0 dB
  over 1 s, -10 → 0 dB over 3 s, messa di voce (V14 31.7 %).
- **Dip and recover** at 120 and 220 Hz (V16 31.7 %).
- **(r5a)** the (r3) real 128 Hz hold with a -6 → 0 dB swell (V14 47.0 %).
- **(r5b)** two PVQD sustained /a/ as recorded, with a natural onset
  crescendo, held on to ~13 s (V14 35.6 / 36.6 %). The clip is committed:
  `tests/dsp/data/notch-real/pvqd_cresc.wav`, CC BY 4.0, 0.35 MB.
- **(l)** a third takeover guard: a hum at rms 0.02 taken over by a note
  from 3 s (2.4 s of steady hum first). It is notched by bc42ad0's 5.45 s +
  0.3 s.
- **(r3)** the checks are labelled `discriminating` (the 128 Hz hold from
  0.15 s) or `guard` (the three bc42ad0 also passes).

New KNOWN LIMITATION lines: 77 Hz with 3 c of wander and no vibrato; the
subito forte at 120 / 220 Hz.

### 8.9 Limitations (updated; corrects §6)

- **§6's first bullet was wrong.** Real recordings carry the shapes V14 / V18
  fix:
  - PVQD sustained vowels are phonation from the recording's start;
  - real VocalSet same-note phrases and messa di voce run mid-phonation;
  - the held-out Coswara vowels (own phones and laptops) show the same.

  On the 297-stream real voice-only set bc42ad0 notches the voice in 33
  streams (73.0 % of their hold frames), V18 in none. Still unrecorded: real
  holds ≥ 20 s and real repeated same-pitch holds ≥ 8 s.
- **The ship rule's takeover cells were not representative.** The held-out
  grids fail it for V14 and V18 alike (§8.6): a note at a hum's own level on
  its track. Closing it needs a takeover test that does not rely on a clean
  6 dB jump — for example a faster revoke when the line returns to its
  steady pre-note level — validated on a third split.
- **Verdict latency on consumer recordings.** On the held-out phone /
  laptop vowels only ~46 % of not-onset-born voice lines get voice timing by
  the 4.9 s promotion point. V18 notches 83 / 407 split-2 streams (bc42ad0
  287).
- **Subito forte** at the start of a not-onset-born hold keeps bc42ad0's
  timing (§8.3).
- **Breathy low voices.** A breathy synthetic 76-79 Hz voice (H1-H2 12 dB,
  HNR 10 dB) still loses an upper partial to a notch at 5.4 s: 60-72 % of
  hold frames vs ~32 % on bc42ad0.
- Unchanged from §6: shared modulation < 2.5 c, voice-like machines (~2 %),
  repeated holds with breaths, holds ≥ 20 s.

### 8.10 Reproduction

See `scripts/notch-adversarial/README.md`, "V14 follow-up (2026-10-05)".

Held-out data:

- split 1: `python scripts/notch-adversarial/realdata/fetch_heldout.py`
  (`build/notchvd-heldout/`);
- split 2: `NOTCHVD_ROOT=build/notchvd-heldout2 python
  scripts/notch-adversarial/realdata/fetch_heldout.py --sources=coswara
  --coswara-dates=20200417`.

Runs used ≤ 3 node processes.
