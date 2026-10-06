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
>
> **Fix round (2026-10-06), §9.** A review of V18 and §8 found nine issues;
> all were verified. `src/` is now **`V19g`**: the takeover test no longer
> fires on a line that already read as a voice (vowel changes, settle-then-
> swell), and lines are measured with a 3 Hz margin around 75-400 Hz. The
> new coverage adds voice-like machines (partials sharing 0.5-8 Hz speed
> wobble), real noise from every start offset and the review's takeover
> shapes: on those, V14, V18 and V19g all fail the ship rule — §9.1 for
> the decision.

## Decision

**Historical (superseded 2026-10-05 by §8 and 2026-10-06 by §9):** the
candidate phase's decision. `src/` is now `V19g`; the current verdict is
§9.1.

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
  - **Historical (superseded 2026-10-06, §9.5):** Measured worst cost:
    whine 124015, +1.6 pp painted in noise-only lead segments. That was the
    0 s, first-notch view; from other start offsets the same clip is +15 s
    late and a mains hum +25 pp, and synthetic voice-like machines cost up to
    +82 pp.
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

**Historical (superseded 2026-10-06, §9.1):** the comparison below holds on
the cells measured then. "At least as good as V14 on every voice measure"
is an empirical result on those sets, not a guarantee: a settle-then-swell
shape refutes it (§9.2 #3). The ship-rule rows had no voice-like machine
cell, and the real noise was streamed from 0 s only.

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
   - **No crescendo passes it.** **Historical (superseded 2026-10-06,
     §9.2 #2):** true only for a CONSTANT-slope crescendo from the note's
     start, or one that never rises 6 dB within 0.7 s (≈ 8.6 dB/s). A steady
     soft start followed by a ≥ 10 dB/s crescendo fires it. At a constant
     slope of s dB per observation the 3-sighting reference spans 2s and the
     rise reaches ~7s. Firing needs 2s ≤ 1.5 and 7s ≥ 6, i.e. s ≤ 0.75 and
     s ≥ 0.86: impossible. A voice's attack has no steady level before it.
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
     **Corrected 2026-10-06 (§9.5):** revoked only once a window reads
     MACHINE-confirmed; a hum with ~1-2 c of shared wobble reads "undecided"
     and keeps the timing longer.
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
   line is notched then. bc42ad0 notches it at 5.45 s, mid-note. (This hum
   reads machine-confirmed; one with shared wobble may not: §9.5.)

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
- **The ship rule's interferer cells were not representative** (2026-10-06:
  nor were its real-noise streams or its synthetic families, §9.5). The held-out
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

## 9. Fix round (2026-10-06): review of the follow-up → `V19g`

A review of V18 and of §8 raised nine findings: four medium, five low. All
nine reproduced (§9.2).

- **Fixed in `V19g`** (now `src/`, §9.3): two defects in V18's voice timing.
- **The other seven** are coverage gaps or wrong claims in §8. This round
  adds the missing test families and corrects the text.

The new coverage shows a class that no ship-rule cell contained before:
**voice-like machines**. Their partials share 0.5-8 Hz speed wobble, so they
read as voices. **Every voice-timing variant (V14, V18, V19g) fails the
extended ship rule on them** (§9.5).

Everything below is on public data or synthesis, except the one-line
session-oracle summary in §9.7.

### 9.1 Verdict

**Needs a decision: no variant meets the ship rule.** The rule this note
has used is "no interferer cell (synthetic or real) worse than bc42ad0;
held suite better". With the review's missing families added, **V14, V18
and V19g all fail it, and by construction**:

- **The cause.** A machine whose partials share ≥ ~5 c of 0.5-8 Hz speed
  wobble reads voice-confirmed. If it is already running when the stream
  starts (not onset-born), it gets the 20 s clock instead of 5 s.
- **What it costs.** V19g vs bc42ad0, strict rule per line:

  | cells | V19g fails | worst case |
  |---|---|---|
  | synthetic steady machines (`vmach.mjs --part=steady`) | 248 / 420 | 6 cells never notched in 30 s: at 300 / 390 Hz with 6-10 c of OU wobble, 99.8 % of the stream painted vs 17.7 % |
  | synthetic spin-up / approach ramps (`--part=ramp`) | 102 / 108 | notched 20.45 s instead of 5.45 s, painted FV 17.7 → 67.9 % |
  | real noise, every clip from every 3 s offset (`offsets.mjs`) | 22 / 3 798 streams (2 of 279 clips) | +15 s late; mains hum 438501 from 6 s: +25.2 pp painted FV |
  | held-out real noise, same | 14 / 1 806 streams (1 of 119 clips) | vehicle interior 456092: 14 / 42 offsets, +15 s, +15.6 pp |

- **V14.** It fails the same families, but less often: 212 / 420 steady,
  40 / 108 ramp, 22 / 3 798 and 14 / 1 806 real. Its first-3 guard blocks a
  machine whose level rises at the stream's start. The same guard blocks
  real crescendos (§8.2 #1).
- **The voice side.** Of V14, V18 and V19g, V19g has the best aggregate
  voice numbers (§9.4, §9.6). But the notch's features cannot tell these
  machines apart from a voice.

**The options** (held: % of hold frames at pitch over the 1 804 runs of
§9.4; real: streams where the voice is notched):

| option | voice | voice-like machines |
|---|---|---|
| **bc42ad0** (= `main`) | held 63.9 %; real voice-only 33 / 297, held-out split 2 287 / 407 | passes by definition |
| **V14** | 81.0 %; 5 / 297, 89 / 407 | fails (above) |
| **V18** | 86.0 %; 0 / 297, 83 / 407 | fails more often than V14 |
| **V19g** (`src/`) | **88.58 %; 0 / 297, 81 / 407** | fails like V18, +6 ramp cells |
| V19g + a 10 s voice-timing cap for lines first seen in the stream's first observation (`V19c`, measured as a dial on V19) | 83.5 %: every hold from the stream's start that lasts > ~10 s is notched at ~10.5 s; 463 of the 672 runs in those families lose > 1 pp. Voice notched in 4 / 297 real voice-only and 131 / 407 held-out streams (split 2 max(F_err, M_err) 17.8 pp) | still fails every cell above. Synthetic painted-FV cost +16.4 pp instead of +48.4 pp. Real: the vehicle interior drops to +5 s / +5.8 pp; the whine's worst offsets (+15 s) and the mains hum are not covered (their late lines are first seen in a later observation); the whine's worst painted cost drops 7.5 → 5.1 pp |

**V19g against V18.**

- **Voice.** The review's vowel-change and settle-then-swell voices are
  fixed, and so is a 75.0 Hz voice whose line reads ≥ 75.0 Hz. The three
  new held families go from 63.4 % to 77.4 % of hold frames, and no run is
  below V18.
- **Identical** to V18 on every other cell and stream (notch-only scans,
  §9.5), except:
  - **6 ramp cells.** A ramping machine whose steady part already read as a
    voice no longer fires the takeover test.
  - **3 held-out voice streams.** All male, all better (§9.6).
  - **4 held runs at 78 Hz** (+50 c glide / step: the measurement margin).
    Their notch output differs, but every metric is identical: 100 % on
    V18 and V19g.

**On the binding gender-symmetric metric (finding 4).** Held-out split 2
gives max(F_err, M_err) of 10.55 pp for V14, 10.43 pp for V18 and 10.25 pp
for V19g. The gain over V14 is therefore 0.1-0.3 pp, and the residue is
male (§9.6).

The ship decision is the user's.

### 9.2 The findings, verified

Each finding was reproduced with the real worker before anything changed:
first with probes on the review's own cell definitions, then with the
in-repo families of §9.4-§9.6.

| # | review finding | verified | evidence | action |
|---|---|---|---|---|
| 1 | A vowel change on a not-onset-born hold trips the takeover test | **yes** | H1 +10 dB over 0.15 s, 2.5 s into a hold from t = 0.15 s at 220 Hz: V14 / V18 36.4 % of hold frames, notched at 5.41 s. New `vowelnob` family (240 runs): V18 67.3 %, V14 63.4 %, bc42ad0 44.7 %. Hillenbrand 1995, within talker (`realdata/hillenbrand_h1.py`, the review's script): /ɑ/ → /i/ raises H1 by a median +10.7 dB (men) / +12.9 dB (women); ≥ 6 dB for 87 % / 96 % of talkers. | fixed for changes after the line's first coherence window (§9.3); earlier changes disclosed |
| 2 | "No crescendo passes it" is false | **yes** | -12 dB held 0.5 s then +12 dB/s, and -10 dB held 1 s then +15 dB/s: 36.4 % on bc42ad0, V14 and V18 (120 / 220 Hz). New `crescpp` family: V18 fails 6 of 8 shapes; +8 dB/s and the 2 s logistic pass. | claim corrected (§8.3, §9.8); family added; mostly a known limitation |
| 3 | "V18 at least as good as V14 on every voice measure" is refuted by a settle-then-swell | **yes** | Attack at 0 dB for 0.6 s, settle -3 dB to 1.6 s, then +6.5 dB within 0.4 s: V18 36.4 %, V14 100 % (120 / 180 / 220 Hz). New `settle` family: V18 55.5 %, V14 100 %. In 23 of the 334 new-family runs, V18 is > 1 pp below V14. | claim restated as empirical (§8.1); 28 of the 30 settle runs are ≥ 95 % on V19g (V18 9, V14 30) |
| 4 | On max(F_err, M_err), V18's held-out gain over V14 is ~0.1 pp, and the residue is male | **yes** | `realdata/agg-gender.mjs` on the follow-up's rows. Split 2: V14 10.55 pp, V18 10.43 pp. Split 1: 3.94 / 3.42 pp. Split-2 V18 notches the voice in 79 / 340 male and 4 / 67 female streams. One held-out stream is below bc42ad0 on V14, V16 and V18: `coswara__20200417_mikiKeqF4S_o` (male, 121.6 Hz), 51.61 vs 55.33 %. | reported (§9.6) |
| 5 | A hard 75.0 Hz cutoff; skipped chunks splice windows | **yes** | 75.0 Hz voice from 0.15 s: seed 16 is notched at 5.45 s on V18 (14.1 %, = bc42ad0); seed 15 is kept (50.5 %, the detector's own ceiling for a vibrato centred on its floor). 75.5 Hz: 88-91 %. `cohStep` skipped out-of-band lines without clearing `c1` / `c2`. | fixed in part (§9.3): measured with a 3 Hz margin and the series cleared; voice timing still needs the line inside 75-400 Hz |
| 6 | Real noise only from 0 s and first notch only; voice-like machines fail at other offsets | **yes** | Vehicle interior 456092 (held-out): 14 / 42 offsets fail on V14 and V18. The 298 Hz line is notched at 20.45 s instead of 5.45 s; painted FV 3.3 → 17.2 % at 39 s. Whine 124015 at 9 / 15 s: 0.0 → 5.5 / 7.5 %. Mains hum 438501 at 6 s: V18 only. | `offsets.mjs`: every clip from every 3 s offset, lateness per line (§9.5) |
| 7 | V18 widens the voice-like-machine regression vs V14 | **yes** | Mains hum 438501 from 6 s: the 121 Hz line is notched at 5.85 s on bc42ad0 and V14, 15.95 s on V18; painted FV 11.9 / 12.6 / 37.1 %. Ramping voice-like machines: V18 fails 96 / 108, V14 40 / 108. At 77 Hz: V18 fails 36 / 60 steady cells, V14 0. | measured (§9.5); V14's advantage comes from the guard that blocks real crescendos |
| 8 | No synthetic family has shared in-band FM | **yes** | The suite's wobbles are 0.05-0.27 Hz. New `vmach.mjs`: a 120 Hz stack with shared 2 Hz / 5 c wobble is notched at 20.45 s on V14 / V18 vs 5.45 s; painted FV 17.7 → 67.9 %. | family added to the ship rule and to the test file (§9.4, §9.5) |
| 9 | Takeover failures go beyond an 85 Hz hum; "undecided" keeps the voice timing | **yes** | A 150 Hz hum with 1.2 c of shared OU wobble: V18 notches it at 7.35 s vs 5.45 s, +10.3 pp painted FV after the note; V14 passes. Mains hum 438501 from 6 s, traced: pooled 0.60-0.87 / 4-7 c from 3.7 s to 15 s, never machine; revoked only after a level dip reset its windows. | grids added (§9.5); §8.3 / §8.6 revoke text corrected |

### 9.3 The fix: `V19g`

`src/dsp/noise-notch.js` = variant `V19g` (`cand3-notch.js` +
`variants.mjs`). Parity `V19g` vs `SRC` (`NOTCH_MEMO=0`): 0 mismatches in 189 315 worker
messages (181 scenarios at 16 kHz, 70 at 48 kHz), and 0 in 75 464 more
re-checked on the final file. Two changes over V18:

1. **The takeover test needs the line not to have been a voice already.**
   - **Rule.** V18's conditions still apply: a rise of ≥ 6 dB within 6
     observations, over a level that held within 1.5 dB for 3 sightings and
     was the line's loudest so far (within 3 dB). In addition, the line's
     coherence windows that ended by the FIRST of those steady sightings
     must not pool to the voice verdict. That verdict uses the thresholds
     that grant voice timing: `pcorr` ≥ 0.7 and `pcoh` ≥ 2.5 c. With no
     such window, the test fires as on V18.
   - **Why.**
     - A vowel change, a crescendo after a steady start, or a swell after a
       settle raises a line that already carried the voice's shared
       modulation.
     - A hum taken over by a note had none.
     - The review's alternative (fire only when the pre-jump stretch read
       machine-like) would let an "undecided" hum pass as a voice: one with
       ~1-2 c of shared wobble.
   - **Why the FIRST sighting (`V19` → `V19f`).**
     - `V19` used windows ending by the reference's LAST sighting.
     - One `--sweep` cell (85 Hz hum, 1.2 c wobble, rms 0.035, 48 kHz)
       broke it. The note began 0.1 s before that last sighting, while the
       512 ms observation still read the line as steady.
     - The window ending inside the steady stretch held the note's onset
       transient and read 0.88 / 4.2 c. That cancelled the takeover, and
       the hum was notched at 6.85 s instead of 5.45 s.
     - A loud note cannot start before the first steady sighting without
       breaking the steadiness. Windows ending by that sighting therefore
       hold the old line alone.
     - The cost: 24 voice runs where V19 had a window only inside the
       steady stretch (vowel changes 1.5 s after a speech → hold join or a
       step; the 1.5 s logistic crescendo).
   - **What it cannot fix.** A change in roughly the first 2 s of a
     not-onset-born line. The first 1 s window ends ~1 s after the line's
     first sighting, and the observation buffer itself needs 0.51 s, so
     there is no evidence yet and the test fires as on V18.
2. **The band edge** (`V19f` → `V19g`).
   - **Measured over 72-403 Hz** (`cohMarginHz` = `matchHz` = 3 Hz). A
     line that leaves that band drops its running series, so a window never
     splices chunks that are not adjacent. A voice centred on 75.0 Hz
     wanders across the 75 Hz edge.
   - **Granted only inside 75-400 Hz.**
     - `V19f` granted voice timing anywhere in the measurement margin. That
       delayed voice-like machines at 73 / 74 / 401 / 402 Hz: 138 / 240
       `--part=edge` cells late (V18: 0; `V19g`: 0).
     - `V19h` widened the grant band by half an FFT bin, 74.5-400.5 Hz.
       The test file's 75.0 Hz voice (seed 16) has a line estimate of
       74.90-74.98 Hz and is kept only that way. But `V19h` also granted
       voice timing to 401 Hz machines whose OU wobble reaches 400.5 Hz:
       6 / 240 edge cells, 2 never notched in 30 s, up to +22 pp painted.
       Rejected: a voice centred exactly on the display floor is the
       smaller population.
     - With `V19g`, a 75.0 Hz voice keeps the voice timing whenever its
       line estimate is ≥ 75.0 Hz at a verdict. Both `synth.mjs` seeds do;
       seed 16 of the test's synthesis does not (KNOWN LIMITATION).

Not adopted:

- **`V19l` (revoke on lapse).** Voice timing would also be revoked when the
  pooled windows fall under 0.5 / 2 c. It changes none of the review's
  cases:
  - the real mains-hum line pools 0.60-0.87 / 4-7 c throughout;
  - the wobbling hum's note windows dominate its pool until the first
    hum-alone window.
- **`V19c` (a 10 s cap).** Voice timing of a line first seen in the
  stream's first observation lasts 10 s instead of 20 s. Measured as a dial
  (§9.1), not proposed: it costs every hold from the stream's start that
  lasts > 10 s.

### 9.4 Held notes

`held.mjs`, real worker, 16 + 48 kHz, % of hold frames at pitch. The suite
now has 902 scenarios per rate; the three families marked "new" are this
round's. The notch-only scans find V19g identical to V18 on the 1 470 runs
of §8.4, except four 78 Hz +50 c glide / step runs, which have identical
metrics (100 %). So every V19g number on those runs is V18's.

| family | runs | bc42ad0 | V14 | V18 | V19 | V19f | **V19g** |
|---|---|---|---|---|---|---|---|
| **new** `vowelnob`: a vowel change on a not-onset-born hold | 240 | 44.7 | 63.4 | 67.3 | 85.8 | 81.5 | **81.5** |
| — change 2.5 s into a hold from t = 0 / 0.15 s | 80 | 43.3 | 56.1 | 58.9 | 98.6 | 98.6 | **98.6** |
| — change 3.5 s in (the voice verdict came first) | 40 | 42.7 | 100.0 | 100.0 | 100.0 | 100.0 | **100.0** |
| — change 1.0 s in (no coherence window yet) | 40 | 42.7 | 54.1 | 61.3 | 61.3 | 61.3 | **61.3** |
| — change 1.5 s after a speech → hold join or a step | 80 | 48.1 | 57.1 | 62.4 | 78.1 | 65.4 | **65.4** |
| **new** `crescpp`: steady soft start, then a crescendo | 64 | 36.4 | 36.4 | 52.3 | 60.3 | 53.3 | **53.3** |
| **new** `settle`: attack, settle 2-3 dB, swell | 30 | 36.4 | 100.0 | 55.5 | 95.8 | 95.8 | **95.8** |
| new families, all | 334 | 42.36 | 61.52 | 63.38 | 81.79 | 77.41 | **77.41** |
| the 1 470 runs of §8.4 | 1 470 | 68.74 | 85.37 | 91.12 | 91.12 | 91.12 | **91.12** |
| **all** | 1 804 | 63.85 | 80.95 | 85.98 | 89.39 | 88.58 | **88.58** |
| all, max(F_err, M_err) (male = f0 < 150 Hz: 736 / 1 068 runs) | | 39.2 pp | 23.7 pp | 15.0 pp | 11.8 pp | 12.7 pp | **12.7 pp** |

- **Against V18 and bc42ad0.** No V19g run is more than 1 pp below V18 or
  below bc42ad0.
- **Against V14.** Two `settle` runs are below V14: 140 Hz s3up0.4 at
  48 kHz, and 180 Hz s3up0.7 at 16 kHz.
  - They score 36.4 % vs 100 %.
  - Their single pre-jump window reads 1.00 / 2.30 c, under the 2.5 c
    verdict.
  - V18 was below V14 in 23 runs.
- **By gender**, `vowelnob` max(F_err, M_err):
  - V18: 42.6 pp (male 77.3 %, female 57.4 %);
  - V19: 19.1 pp;
  - V19g: 24.1 pp (87.2 / 75.9 %).
- **Where V19g ≠ V19f.** Seven runs differ: the four 78 Hz runs above and
  three 100 Hz `settle` runs at 48 kHz (a 400 Hz partial in the margin).
  Their notch output differs; every metric is identical (100 %).

**Tests** (`tests/dsp/noise-notch-test.js`): **101 passed, 0 failed** on
V19g. bc42ad0 69 / 32, V14 85 / 16, V18 96 / 5.

New checks, each failing on V18:

- a vowel change (H1 +10 dB) 2.5 s into a hold from t = 0.15 s, at 131 and
  220 Hz;
- a settle-then-swell at 131 and 220 Hz;
- a 75.0 Hz voice (seed 15): no notch on its partials up to 400 Hz. Seed
  16, whose line estimate is 74.9 Hz, is a KNOWN LIMITATION line.

New interferer checks:

- **(o)** a 73 Hz voice-like machine, in the measurement margin, is notched
  by bc42ad0's 5.45 s + 0.3 s. It fails on V19f.
- **(n)** a 120 Hz and a 77 Hz voice-like machine, from t = 0:
  - each is printed as a KNOWN COST (notched at 20.45 s vs 5.45 s);
  - each has a bounding check: notched by 20.75 s.

New KNOWN LIMITATION lines:

- the vowel change 1 s in;
- -12 dB for 0.5 s, then +12 dB/s.

### 9.5 Interferers

**Families that existed before.** Notch-only scans compare V18, V19f and
V19g on every cell:

- `r2int` 668, `int` 652, `handoff-adv` 168 / 432 / 648, FDA 109, grids
  600, `dense` 32;
- the real noise-only / gated / held-series / voice-in-noise / voice-only
  sets and the held-out sets.

Only 3 of the 407 held-out split-2 voice streams differ (§9.6). So every
other §8.4 / §8.6 number stands for V19g.

**The review's takeover shapes** (`handoff-adv.mjs --wobble / --sweep`,
16 + 48 kHz). A cell fails when the hum is notched later than
bc42ad0 + 0.3 s, or when the FV after the note exceeds bc42ad0 + 2 pp.

| grid | cells | V14 | V18 | V19 | **V19g** | worst (V19g) |
|---|---|---|---|---|---|---|
| hum with 0 / 0.7 / 1.2 / 2 c shared wobble, one 4 s note at its level | 96 | 3 | 9 | 9 | **9** | +1.9 s, +5.1 pp painted |
| hum-level sweep, rms 0.015-0.055, wobble 0 / 1.2 c | 336 | 5 | 15 | 16 | **15** | +1.4 s, +3.3 pp |

- **Which hums.** Wobble grid: 6 cells at an 85 Hz hum and 3 at a 150 Hz
  hum with 0.7-2 c of wobble. Sweep: all at an 85 Hz hum but one, a 200 Hz
  hum with 1.2 c of wobble.
- **Why.** This is V18's equal-level takeover (§8.6), now also with a
  wobbling hum. After the note, a wobbling hum reads "undecided", not
  machine, so it keeps the voice timing longer.
- **Correction to §8.3 / §8.6.** The voice timing is revoked only by a
  machine verdict. "After a 1 s window of the hum alone" holds only for a
  hum that reads machine-confirmed.

**Voice-like machines, synthetic** (`vmach.mjs`, 16 + 48 kHz, 30 s, no
voice). A cell fails when any line bc42ad0 notches is notched later than
max(6 s, bc42ad0 + 0.3 s), or when painted FV exceeds bc42ad0 + 2 pp.

| part | cells | bc42ad0 painted FV | V14 | V18 | **V19g** | V19c |
|---|---|---|---|---|---|---|
| steady, 77-390 Hz, shared sin 1-4 Hz x 3-10 c or OU 3-10 c | 420 | 18.2 % | 212 fail (43.5 %) | 248 (46.8 %) | **248 (46.8 %)** | 248 (27.9 %) |
| ramp -8 / -12 dB → 0 over 1-3 s | 108 | 17.7 % | 40 (36.3 %) | 96 (62.3 %) | **102 (65.1 %)** | 102 (33.6 %) |
| edge: 73 / 74 / 401 / 402 Hz | 240 | 2.2 % | — | 0 (2.2 %) | **0 (2.2 %)** | |

- **By modulation depth** (steady, V19g):
  - 3 c sinusoidal and OU 3 c: 0 of 112 fail;
  - 5 c: 28 / 84;
  - 8-10 c: 168 / 168;
  - OU 6-10 c: 52 / 56.
- **Never notched in 30 s.** 6 cells (V14, V18, V19g): 300 and 390 Hz with
  6-10 c of OU wobble. The line's duty over the 20 s clock falls under 0.9,
  and 99.8 % of the stream is painted.
- **V19g vs V18.** 6 more ramp cells fail: a machine at -12 dB for 2.5 s,
  then +12 dB in 1 s. Its steady part already read as a voice, so the
  takeover test no longer fires.
- **The margin.** V19f granted voice timing in the measurement margin and
  failed 138 / 240 edge cells. V19g grants only inside 75-400 Hz and fails
  none.

**Real noise from every start offset** (`offsets.mjs`):

- every clip, every 3 s, 30 s streams, the first 180 s of each clip;
- 16 kHz;
- lateness judged per line;
- the real worker only where a notch output differs from bc42ad0's.

| corpus | streams (clips) | V14 | V18 | **V19g** | V19c |
|---|---|---|---|---|---|
| tuning noise-only | 3 798 (279) | 22 fail (2 clips) | 22 (2) | **22 (2)** | 22 (2) |
| held-out noise (split 1) | 1 806 (119) | 14 (1) | 14 (1) | **14 (1)** | 14 (1) |

V19g's notch output equals V19f's on all 5 604 offset streams. V19f's
equals V19's on all 3 798 tuning streams (`offsets.mjs` with those variant
pairs).

- **Electronics whine 124015.** Its 324 Hz line is notched ~15 s late at
  20 / 30 offsets, on V14, V18 and V19g alike. Painted FV rises by at most
  7.5 pp per 30 s stream (V19c: +5.1).
- **Mains hum 438501, 2 / 6 offsets (6 and 15 s).**
  - V14: +4.7 s, +0.8 pp.
  - V18 / V19g: +10.1 s, +25.2 pp.
  - At 6 s, V14's first-3 guard happens to block it: the stream starts in a
    level dip.
- **Vehicle interior 456092 (held-out).** The review's clip. Its 298 Hz
  line fails at 14 / 42 offsets on every voice-timing variant: +15 s,
  painted FV up to +15.6 pp per stream. V19c gives +5 s / +5.8 pp: this
  line is first seen in the first observation.
- **Exposure.** At any start offset, 2 of 279 tuning clips and 1 of 119
  held-out clips. This matches the review's population check (only the
  whine differed at offsets 5 / 10 / 20 s). §6 / §8.9's "measured worst
  cost +1.6 pp" and §8.4's "0 fail; = V14 in 279 / 279" were the 0 s,
  first-notch view only.

### 9.6 Real voice and the gender-symmetric metric (finding 4)

`realdata/agg-gender.mjs` on the voice-only sets: hold frames painted at
pitch, pooled per gender, and max(F_err, M_err), the binding pitch metric
(CLAUDE.md).

V19g equals V18 on every voice stream except 3 male split-2 streams, where
it notches less (scan, then the real worker):

- `Fi4TZCxqYq_a@10.42`: 48.8 → 100 %;
- `ThEx12Qb23_o@1.34`: 100 → 100 %, now with no notch;
- `chMsCb2Sqa_e`: 94.9 → 94.9 %, notched at 20.8 s instead of 15.7 s.

| set | bc42ad0 | V14 | V18 | **V19g** |
|---|---|---|---|---|
| held-out split 2 (340 male / 67 female streams): max(F_err, M_err) | 37.62 pp | 10.55 pp | 10.43 pp | **10.25 pp** |
| — male / female painted at pitch | 62.4 / 80.4 % | 89.5 / 92.8 % | 89.6 / 96.3 % | **89.8 / 96.3 %** |
| — voice notched, male / female | 259 / 28 | 83 / 6 | 79 / 4 | **77 / 4** |
| held-out split 1 (199 / 61; in-sample for V18's added condition): max(F_err, M_err) | 28.82 pp | 3.94 pp | 3.42 pp | **3.42 pp** |
| — voice notched, male / female | 145 / 31 | 33 / 1 | 29 / 1 | **29 / 1** |

- **Over V14 on split 2, V18 / V19g gain 0.1 / 0.3 pp** on the binding
  metric. The pooled counts (89 → 83 / 81 streams notched) overstate it.
  The female error falls 7.2 → 3.7 pp; the male error, the larger one,
  barely moves (10.55 → 10.25).
- **The residue is male-dominated.** V19g notches the voice in 77 / 340
  male streams (23 %) vs 4 / 67 female (6 %). The cause is not
  established. The voice verdict comes late on these consumer recordings
  (§8.6: p50 4.2 s), but no per-gender latency was measured.
- **Below bc42ad0.** One held-out stream is worse than bc42ad0 on V14, V16,
  V18 and V19g: `coswara__20200417_mikiKeqF4S_o` (male, 121.6 Hz /o/),
  51.6 vs 55.3 %.
  - bc42ad0 notches the voice's 3rd partial (365.8 Hz) at 5.71 s. That
    happens to end the detector's own 3 x F0 error (it was tracking
    ~366 Hz) 0.7 s early.
  - The later variants keep the partial, and the detector stays on 366 Hz
    until ~6.4 s.
  - The error is the detector's own, unmasked; the notch does not touch the
    voice.
- **The 10 s cap (V19c, on V19).** Every not-onset-born line first seen in
  the stream's first observation is notched ~10.5 s in:
  - held families with such holds (start0 / start015 / swell / low / dip /
    vowelnob / crescpp / settle, 672 runs): 89.8 → 73.9 % of hold frames;
    463 runs lose > 1 pp;
  - the whole held suite: 89.4 → 83.5 %;
  - the real voice-only set: the voice is notched in 4 / 297 streams (V18:
    0), all male; max(F_err, M_err) 0.06 → 0.44 pp;
  - held-out: split 1 max(F_err, M_err) 3.42 → 6.87 pp (voice notched in
    30 → 64 streams), split 2 10.43 → 17.76 pp (83 → 131); no stream below
    bc42ad0.

### 9.7 Committed oracles, the session oracle, unit tests

bc42ad0's module vs V19g (= `src/`), otherwise identical trees
(`oracles.sh bc42 src`):

| oracle | result |
|---|---|
| `noise-augment-oracle.js pitch --frontend=tracker`, 8 default classes × 20 / 10 / 5 dB | **byte-identical** apart from wall-clock lines (fan-hum 78.0 / 77.8 / 76.7 % correct) |
| same, 6 extra tonal classes (fan-wobble 0.6 / 1.5, fan-drift, hum-rich 120 / 60, wobble + rich) × 10 / 5 dB | byte-identical apart from wall-clock lines |
| same, vocadito × fan-hum / mains-complex / sleep-birdies | byte-identical apart from wall-clock lines |
| `noise-augment-oracle.js gender` | byte-identical apart from wall-clock lines |
| `voicing-robustness-shootout.js` | byte-identical |
| session oracle | On the private session recordings, V19g's (and V18's) per-hop outputs are byte-identical to bc42ad0's module run on the same tree, on every session (results kept outside this repository). |
| `npm run lint`, `npm run test:unit` (18 / 18 scripts, incl. this test file), `npm run test:dsp` (109 passed), `vite build` (to a scratch outDir) | pass |

### 9.8 Limitations (updated; supersedes §8.9 where they differ)

- **Voice-like machines** (§9.1, §9.5).
  - A machine running when the stream starts, whose partials share
    ≥ ~5 c of 0.5-8 Hz wobble, gets the voice timing.
  - It is notched ~15 s later than on bc42ad0. If its duty over the longer
    clock drops under 0.9, it is not notched within 30 s at all.
  - Real exposure: 2 of 279 tuning clips and 1 of 119 held-out clips, at
    some start offset.
  - Synthetic: 248 / 420 steady and 102 / 108 ramp cells.
  - The notch's features cannot tell these lines apart from voices.
- **Takeover at the hum's own level** (§8.6) persists.
  - A hum with ~1-2 c of shared wobble keeps the voice timing until a
    window reads it as machine.
  - Wobble / sweep grids: 9 / 96 and 15 / 336 cells, ≤ +1.9 s, ≤ +5.1 pp
    painted.
- **Takeover-like voice level changes in a line's first ~2 s keep
  bc42ad0's timing**, because there is no coherence window yet:
  - a vowel change;
  - a subito forte;
  - a crescendo faster than ~8.6 dB/s after a steady stretch.
- **What is guaranteed.** A crescendo never fires the takeover test if its
  level never rises 6 dB within 0.7 s (≈ 8.6 dB/s) after a 0.3 s steady
  stretch, or if it rises at a constant slope from the note's start. Later
  in a line's life, the test also needs the line not to have read as a
  voice.
- **A voice centred exactly on 75.0 Hz** keeps bc42ad0's timing when its
  line estimate sits just under 75 Hz. Granting voice timing in the margin
  delays voice-like machines just outside the band (§9.3).
- **A weakly modulated pre-jump window is not a voice.** A window with
  < 2.5 c of shared modulation does not count (the 2 `settle` runs).
- **Unchanged:**
  - verdict latency on consumer recordings (V19g notches the voice in
    81 / 407 split-2 streams, male-dominated);
  - shared modulation < 2.5 c;
  - breathy low voices;
  - repeated holds with breaths;
  - holds ≥ 20 s.

### 9.9 Reproduction

See `scripts/notch-adversarial/README.md`, "Fix round (2026-10-06)".

- Results not covered by a fresh run were inherited from the follow-up's
  rows (`build/notch-adv/res8`) wherever a notch-only scan showed the
  notch outputs identical (hence identical worker messages).
- Runs used ≤ 3 node processes. The machine was shared, and a resource
  governor paused jobs.
