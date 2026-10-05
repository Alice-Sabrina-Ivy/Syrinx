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
| interferer handling no worse than bc42ad0 in every cell, real | **0 failing streams** on 279 noise-only clips and 504 gated sources (gated: identical in 504 / 504). On 798 voice-in-noise mixes, the 3 streams the rule flags are bc42ad0 notching **the voice** (§4c). |
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

| set | streams | bc42ad0 | R8 | V14 |
|---|---|---|---|---|
| noise-only, painted FV (mean promotion [never]) | 279 | 10.1 % (10.0 s [143]) | 10.2 %; 1 stream +11 pp (ballast) | 10.1 %; **0 fail** (278 identical) |
| gated real sources, painted FV from switch-on +21 s ([never]) | 504 | 15.0 % [223] | 21.3 % [416]; **227 fail** | 15.0 % [223]; **identical 504 / 504** |
| real VocalSet held series, hold frames at pitch | 192 | 99.4 % (notched onto the voice 1 / 192) | identical | identical |
| voice in real noise (+10 / 0 dB), voice frames painted at pitch | 798 | 52.4 % | identical 798 / 798 | **52.5 %** |

**Voice in noise, stream by stream.** 785 / 798 streams are identical to
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
  - All 798 voice-in-noise mixes: identical in 798 / 798.
- **Arranged.** Real sources switched on at 2 s and cut out briefly (the
  `noise_gated` mixes): R8 fails 227 / 504 streams, 54 of 84 sources.
  - Never notched in 416 vs 223 for bc42ad0.
  - Painted FV after the accepted 21 s latency: 21.3 % vs 15.0 %.
  - Worst cases paint 82–97 % of the audio (electric fan, ballasts).
- **R8's gain does not show on real holds.**
  - bc42ad0 never notched 191 / 192 real VocalSet same-pitch hold series. Real
    long tones last 2–3.5 s and their duty falls below 0.9 across real gaps.
  - The repeated-holds failure needs ≥ 8 s holds, which no open corpus has.
  - Alice's own holds are absent: none of hers produced a trackable line in
    the data phase.

### 4e. Committed oracles and sessions (bc42ad0 module vs `V14`, otherwise identical trees)

| oracle | result |
|---|---|
| `noise-augment-oracle.js pitch --frontend=tracker`, 8 default classes × 20 / 10 / 5 dB | **byte-identical** apart from wall-clock lines (e.g. fan-hum 78.0 / 77.8 / 76.7 % correct) |
| same, 6 extra tonal classes (fan-wobble 0.6 / 1.5, fan-drift, hum-rich 120 / 60, wobble + rich) × 10 / 5 dB | byte-identical |
| same, vocadito × fan-hum / mains-complex / sleep-birdies | byte-identical |
| `noise-augment-oracle.js gender` | byte-identical |
| `voicing-robustness-shootout.js` | byte-identical |
| session oracle, 4 recorded practice sessions | `.hops.f32` **byte-identical on all 4 sessions**, so every `analyze.py` row is equal. For example, the primary user's 160–400 Hz cons pooled: posted / painted 91.37 / 78.73 %; strict 96.01 / 82.97 %. The second speaker's 160–400 Hz painted 85.30 %. |
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

- **No real evidence for the shapes it fixes.** The glide / speech → hold /
  early-phonation failures need a line held ≥ 5 s that was not born at an
  onset. Real corpus holds are ≤ 3.5 s (VocalSet) or ≤ 7.6 s (PVQD /a/), and
  bc42ad0 notched only:
  - 1 / 192 real hold series;
  - 3 real voice-in-noise programs (all fixed here).

  The wins in §4a are synthetic, plus test (r3)'s looped real tone. Alice's
  own long holds are still unrecorded.
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
bash $S/oracles.sh bc42 src; bash $S/sessions.sh fb42 build/notch-adv/otree/bc42/src fsrc src
node tests/dsp/noise-notch-test.js
# candidate variants V1-V14 (variants.mjs) run the same way with --variants=...
```

Runs above used ≤ 6 concurrent node processes. The machine is shared, and a
resource governor may suspend jobs.
