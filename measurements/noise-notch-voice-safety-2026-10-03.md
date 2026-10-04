# Noise notch: voice-training safety pass (2026-10-03)

**Shipped (configuration `on10_20skWRy`):** onset-born promotion delay (20 s), young-only
re-birth, seen-to-promote, stable track-id cascade keying with in-place retune, per-track
wobble estimate, `activeLines()`, and a narrow track-referenced octave-aware ghost veto
`isNearNotch(f, lines, { tolFrac 0.02, wobbleK 6, rels [1, 2] })` in
[src/dsp/noise-notch.js](../src/dsp/noise-notch.js), used by
[src/dsp/pitch-worker.js](../src/dsp/pitch-worker.js) (the `notchedFreqs` relay is unchanged).
Harmonic guard **unchanged** (the inter-harmonic floor of §8 is NOT shipped). Guards:
[tests/dsp/noise-notch-test.js](../tests/dsp/noise-notch-test.js) (36 checks, incl. held notes
at 120/220 Hz through the real worker). Oracle parity: `scripts/noise-augment-oracle.js`
now runs the notch per chunk and applies the veto in pitch mode and uses `activeLines()` in
gender mode; `scripts/voicing-robustness-shootout.js`, `scripts/pitch-accuracy-decompose.js`
and `scripts/pitch-median-window-sweep.js` use `activeLines()`.

> **Correction (2026-10-04).** The claim that this configuration keeps "every hold ≤ 20 s at
> the ceiling" (§5, §9, the shipped summary) holds only for holds that **start after silence and
> stay within ±3 Hz**. That is the shape of every hold in this file's grids. Three routine
> exercise shapes were notched ~5 s in and then blanked by the veto. Real-worker suite, % of hold
> frames reported:
>
> - a hold that glides or steps > 3 Hz mid-note: 74.3 %;
> - speech running into a hold with gaps < 0.3 s, or phonation from the start of the stream:
>   44.8–66.6 %;
> - repeated same-pitch holds separated by breaths ≤ ~2 s: 65.9–77.0 %.
>
> The reason is that the onset-born test only asked whether a track was first seen *at* an onset.
> Fixed by an in-sound latch and new-note re-births:
> [noise-notch-held-note-robustness-2026-10-04.md](noise-notch-held-note-robustness-2026-10-04.md).
> That file also re-baselines `noise-augment-oracle.js`. Its tail false-voicing previously
> included the tracker's flushed frames, which skipped veto, null and guard (pink 0.7–0.8 % →
> 0.0 %). On the current chain, only the pink tail cells changed; the tonal and sleep-birdies
> cells are identical with the fix. The
> §7e session results (kept outside this repository) are relative to the older veto; with the
> 2026-10-04 change a real room-hum line in one private session recording is no longer notched
> at all.

One of five measured workstreams from the 2026-10-03 half-pitch investigation, integrated in
this order: [pitch-globalpeak-transient-2026-10-03.md](pitch-globalpeak-transient-2026-10-03.md) →
[pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md) →
[pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md) → this file →
[pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md).
Measured independently against the then-production chain (origin/main at f92b11a); numbers
below are this change alone. At integration the merged `noise-notch.js`, `pitch-worker.js`,
`noise-notch-test.js` and the four scripts equal this workstream's measured files exactly,
except for the sibling ceiling change's lines (the above-range null after the veto, and the
`bandHiHz` comment) — the veto and the above-range null both only null a frame, so their
order does not matter. Scratch work lives in `build/measure-2026-10-03/notch/` in the main
checkout (gitignored `build/`, not in the repo).

Follows [noise-robustness-oracle-2026-07-19.md](noise-robustness-oracle-2026-07-19.md). That
pass built the persistent-peak notch (`src/dsp/noise-notch.js`), the ghost-voicing veto
(`isNearNotch` in `pitch-worker.js`) and the harmonic voicing guard. This pass is about the
harm those pieces do to voice-training use. It keeps the measured noise wins.

## 1. Motivation

The phase-1 investigation (2026-10-03, "half-pitch" complaint, finding #4) found four problems:

- **The veto blanks real voice.** The veto blanked any decoded pitch within ±4 % of f/2, f
  and 2f of every active notch. A 120 Hz hum therefore covers 115–125 Hz and 230–250 Hz,
  which overlaps common speaking registers (a voice around 115–125 Hz and its octave).
  On FDA in fan-hum at +10 dB, accuracy was 69.3 % with the veto and 85.5 % without it.
- **Held notes get notched.** A note held for ≥5 s with ≤10 c wander or ≤20 c vibrato was
  promoted to a notch. The veto then blanked it completely. Holding sustained notes is a core
  voice-training exercise.
- **Cascade key churn.** The cascade was keyed on `freq.toFixed(0)`. Every 1 Hz rounding
  crossing rebuilt the cascade and reset its state, which caused leak spikes of up to +16 dB.
- **Guard floor bias at low F0.** The harmonic guard's ±35 % floor band includes the
  neighbouring harmonics. As a result it vetoes correct low-voice frames that an inter-harmonic
  floor keeps (measured on the private session recordings; results kept outside this
  repository).

**Tasks for this pass:**

1. Remove the veto.
2. Add an onset-born promotion delay. Sweep the onset threshold (6/10/15 dB) and the delay
   (10/15/20 s), and test a seen-to-promote rule.
3. Key the cascade by track id and retune coefficients in place.
4. Evaluate the inter-harmonic guard floor against its noise false-voicing cost.

**What the measurements changed:** task 1 as specified is **unsafe**, for the reasons in §3.
The veto is load-bearing outside the committed oracle's idealized hums. This pass therefore
**narrows** the veto instead of removing it.

## 2. Harness and baseline match

### Exact production mirror

`chainlib.mjs` mirrors `pitch-worker.js processChunk` in this order:

- per-chunk notch, applied in place on the 16 kHz stream;
- the 1280-sample buffer;
- `candidates`;
- the L=2 tracker;
- the ghost veto, using the notch state at decode time;
- the debounced guard, run on the delay-line buffer of the decoded frame.

Every variant runs through this one function. An exact shortcut is used only where it is
provably exact: when a variant's notch never activates on a signal, the cascade stays empty
and the veto never fires, so the variant's output equals the no-notch chain. This was
verified with 0 mismatches (`verify-shortcut.mjs`).

### Bit-exact checks against the real worker

1. **Mirror vs real worker.** `chainlib` prod was compared with the real
   `src/dsp/pitch-worker.js`, driven in Node with a fake `self` at 16 kHz so the streaming
   resampler is the identity (`verify-parity.mjs`). Pitch, confidence and `notchedFreqs` were
   compared message by message: **0 mismatches**.
   - Stimuli: fan-hum plus a 121/238 Hz voice (795 messages); a 14 s held note at 220 Hz
     (715); a 100 s slice of a private session recording with a real 120 Hz notch activation.
   - `notch-var.js` at defaults is also identical to production `noise-notch.js` on all
     three stimuli.
2. **Session pipeline vs real worker.** `session-attribution/chain-harness.js` was compared
   with the real worker on the same 100 s session slice (`verify-harness.mjs`): 0 mismatches
   on every message.
3. **Session pipeline rerun vs phase-1 baseline.** chain-harness was rerun with the prod
   wrapper on a private session recording and compared with the phase-1 `runs/baseline`: all 17
   per-hop columns are bit-exact (`cmp-runs.py`).
4. **The proposed worker matches the measured candidate.** The proposed
   `proposed/final/src/dsp/pitch-worker.js` was driven like the real worker and compared with
   the mirrored recommended variant on 4 stimuli. These include a 26 s breathy note that is
   promoted onset-born at 20 s. Result: 0 mismatches. The numbers below therefore are the
   proposed code.

### The committed oracle never applied the veto

`scripts/noise-augment-oracle.js` pitch mode with `--frontend=tracker` runs the notch over the
whole signal first. It then decodes with a bare AC + tracker + guard, and **never applies
`isNearNotch`**.

Reproduced verbatim as the `oracle` column below, it gives FDA fan-hum +10 = **85.5 %**. The
production-exact chain gives **69.3 %**. The 2026-07-19 document's §7/§9 tonal rows therefore
describe a no-veto chain that production was not running (a dated note to that effect is
now at the top of its §7).

The committed `scripts/noise-augment-oracle.js` (as patched by this change) fixes this: the notch runs per chunk inside
the decode loop, and the veto is applied as the worker does. Run against the proposed modules,
the patched script reproduces the mirror's candidate number exactly: fan-hum +10 = 77.8 %.

### References

- **Sessions, primary:** session-attribution consensus (a majority of the AC / SHS / PENN
  families) plus the spectral odd-multiple arbiter.
- **Sessions, sensitivity:** strict R1&CC. This is session-label f0, kept only where Praat CC
  agrees within 5 % (`display-chain/refs_strict`).
- **Corpora:** their own references.

## 3. Why the veto cannot simply be removed

The committed oracle's tonal noises are perfectly stationary and have only 3–4 lines. All of
those lines promote during an 8 s noise-only lead, so the notch removes them completely. Real
conditions break each of these assumptions. In each case below the notch leaves a harmonic
residual that is periodic at the line frequency. The harmonic guard accepts that residual,
because it is harmonic. The cells below are worker false-voicing (FV) / painted % in
noise-only audio:

| condition (not in the committed oracle) | prod (veto) | veto removed |
|---|---|---|
| fan-hum switching on during continuous speech (only the 120 Hz line promotes); pauses voiced | 16.5 % (≈ the pre-promotion 5 s) | **78.0 %** |
| fan hum wobbling ±1.5 Hz (noise-only, 40 s) | 1.1 / 0.0 | **55.9 / 46.1** |
| rich hum wobbling ±0.6 Hz (6 harmonics) | 0 / 0 | **60.7 / 55.4** |
| rich 120 Hz hum (8 harmonics, stable) | 0 / 0 | 3.4 / 1.8 |

### A notch-aware guard makes it worse

The obvious repair for held notes is a guard that skips the notched harmonics when it counts.
That was tried as `proposed/boersma-ac.js`, variant "A", and **rejected**:

- On the rich 120 Hz hum, the harmonics above the notched lines (480, 600, …) count, giving
  **99.8 % false voicing**.
- An aware veto on top of it (variant "AA") still gives 99.8 %.

A held note whose H1–H3 have been notched looks the same, frame by frame, as a rich hum's
residual. Only the temporal context separates them: an onset, and duration.

**Breathy held notes are blanked even with no veto.** Notching H1 leaves too little
periodicity: at 120 Hz breathy, the no-veto variant reports 25–75 % of hold frames, all
decoded nulls. So for breathy phonation, *preventing promotion* is the actual fix.
Frame-level vetoes and guards only decide what happens after a promotion has already happened.

## 4. Veto form: narrow, referenced to the track, octave-aware

Explored on 34 FDA tracks (every 3rd) plus noise-only probes. The cells are
correct % (tail FV / painted %):

| veto | fan-hum +10 | mains +5 | fan-wobble0.6 +10 | wobble ±1.5 noise-only FV / painted | mains switch-on pause FV |
|---|---|---|---|---|---|
| prod ±4 % at f/2, f, 2f | 67.9 | 63.4 | 65.1 (1.5/0) | 1.1 / 0 | 1.5 |
| none | 84.7 | 84.6 | 81.3 (7.8/3.3) | 55.9 / 46.1 | 18.1 |
| ±1.2 % at f (section freq) | 79.8 | 79.6 | 76.6 (5.1/1.2) | 27.3 / 6.4 | — |
| ±2 % at f | 77.2 | 76.9 | 73.8 (4.2/1.0) | 12.3 / 1.4 | 17.1 |
| ±3 % at f | 73.0 | 72.0 | 69.9 (1.7/0.2) | 4.3 / 0 | — |
| track freq, max(1 %, 4·dev) at f | 80.7 | 80.6 | 77.6 (6.1/1.7) | 13.5 / 2.0 | 17.5 |
| same, at f and 2f | 80.6 | 80.6 | 77.6 (6.1/1.7) | 13.5 / 2.0 | **1.5** |
| track freq, max(1 %, 8·dev) at f | — | — | — | 3.3 / 0.1 | — |

Two lessons from this exploration:

- **The ghost does not sit at the notch frequency.** In continuous speech the decoded residual
  wanders about ±2 % around the line (118–122 Hz for a 120.0 Hz line; `dbg-onset2.mjs`). The
  notch's phase response and LF rumble perturb its period. So the tolerance cannot go below
  ~2 %.
- **Mains-style stacks ghost at the line's octave** when the even lines don't promote. That
  case needs rel 2. rel 0.5 adds nothing.

**Chosen veto (W):** compare the decoded pitch with each active line's *current tracked
frequency*, at f and at 2f, with tolerance max(2 %·f, 6·dev). `dev` is the line's wobble,
estimated as an EMA of |observed peak − track frequency|. The window therefore widens only for
lines that are measurably moving. Compared with prod, this blanks one-quarter to one-third of
the frequency range, and keeps prod-level protection on every rich, wobbling or partial-notch
case measured.

## 5. Onset-born promotion delay, seen-to-promote, re-birth

**Onset detector.** The 50 Hz–4 kHz band energy of the observation is compared with its 2 s
running minimum. A track first seen at an onset (≥ onsetDb above that minimum) is
*onset-born* and needs `onsetMinTrackSec` before it can promote. Background hums are present
before any voice onset, so they keep the 5 s promotion.

### Held-note sweep

Synthetic holds use `notch-guard-risk/synth.mjs`: jitter, shimmer, OU wander, vibrato and
drift; modal /a/, breathy /i/ (H1−H2 12 dB, HNR 10 dB) and breathy /u/. Each cell is mean %
of hold frames reported at pitch, with the number of configs below 95 % in parentheses. The
"no notch" row is the synthetic ceiling; the breathy-/i/ shortfall at 260–300 Hz is the
detector itself, not the notch.

| main grid (150–300 Hz × 6/10/14/20 s × 8 modulations × 3 qualities = 480 configs) | 6 s | 10 s | 14 s | 20 s | all |
|---|---|---|---|---|---|
| prod | 81.5 | 50.8 | 38.0 | 27.5 | 49.5 (455) |
| no notch (ceiling) | 94.0 | 93.9 | 94.0 | 94.0 | 94.0 (64) |
| veto removed | 91.4 | 81.0 | 77.2 | 72.3 | 80.5 (214) |
| veto W only | 82.0 | 52.7 | 40.5 | 30.9 | 51.5 (455) |
| onset 10 dB / 10 s + seen | 94.0 | 93.3 | 86.7 | 79.8 | 88.5 (146) |
| onset 10 dB / 15 s, no seen rule | 94.0 | 93.3 | 94.0 (82 configs promoted *after* the note ended) | 87.2 | 92.1 (105) |
| onset 6, 10 or 15 dB / 15 s + seen (identical) | 94.0 | 93.3 | 94.0 | 87.2 | 92.1 (105) |
| onset 10 dB / 15 s + seen + stable + W + re-birth | 94.0 | 93.9 | 94.0 | 74.0 | 89.0 (160) |
| **onset 10 dB / 20 s + seen + stable + W + young re-birth (recommended)** | **94.0** | **93.9** | **94.0** | **94.0** | **94.0 (64) = ceiling** |

| requirement grid (120 & 220 Hz; ≤25 c vibrato, ≤15 c drift, steady, wander 5 c; 3 qualities) | 8 s | 12 s | 20 s | 30 s |
|---|---|---|---|---|
| prod | 63.7 | 43.7 | 24.7 | 22.0 |
| veto removed | 85.1 | 75.4 | 68.0 | 63.1 |
| onset / 15 s + W | 100 | 100 | 77.4 | 55.6 |
| **recommended (20 s)** | **100** | **100** | **100** | 70.6 |

**Rules that came out of the sweep:**

- **onsetDb does not matter.** 6, 10 and 15 dB were identical on every held note (and on the
  private session recordings). 10 dB is kept.
  *(2026-10-05 note: one of two round-2 reviewers of the held-note work reported that `onsetDb`
  does matter for a held note over steady broadband room noise — at ≤ ~9 dB SNR such a note can
  be notched ~5 s after onset. Not independently confirmed; see CLAUDE.md §Tonal-noise notch.)*
- **Seen-to-promote is necessary.** Without it, 82 of 120 14-second notes were promoted 0–2 s
  *after* they ended, on their trailing duty. The notch then lingered for missSec, ready to
  blank a repeat of the same note.
- **Re-birth is necessary.** A random noise peak born less than 2 s before the note onset was
  "adopted" by the note. The note then inherited the peak's not-onset-born status and was
  promoted at ~5 s (8 s req notes: 95.2 → 100 %).
- **Re-birth must be young-only.** Re-birthing old tracks reset the diluted duty of a weak real
  room hum in a private session recording, so the notch fired where production never notched,
  with no accuracy benefit (details kept outside this repository). Restricting re-birth to tracks
  younger than onsetHistSec (2 s) removed those activations and kept the adoption fix. The
  oracle grid is identical with and without the restriction.
- **Delay.** 15 s blanks 15–20 s holds (20 s grid: 74–77 %). 20 s keeps every hold of up to
  20 s at the ceiling. 30 s holds still lose their tail after promotion (70.6 % vs prod 22 %).
  This is the accepted, documented edge.

### Cost of the delay: an interferer that switches on mid-session

70 s of continuous FDA speech; the interferer starts at 20 s. Each cell is speech correct % /
pause false-voicing % over the 30 s after onset. Promotion comes 5.2 s after the onset for
prod and veto W, 20.2 s for the recommended config.

| | prod | veto removed | veto W only | onset 15 s | **recommended (20 s)** |
|---|---|---|---|---|---|
| fan-hum +10 | 69.8 / 16.5 | 79.7 / 78.0 | 74.6 / 18.3 | 75.8 / 48.5 | 75.5 / 66.0 |
| fan-hum +5 | 65.0 / 16.9 | 75.8 / 54.4 | 70.6 / 19.0 | 68.8 / 48.7 | 66.8 / 66.2 |
| mains +10 | 61.3 / 1.5 | 77.9 / 18.1 | 72.1 / 1.3 | 71.8 / 0.5 | 69.2 / 0.7 |
| mains +5 | 56.8 / 0.9 | 74.6 / 2.2 | 69.2 / 1.2 | 63.0 / 1.7 | 58.3 / 0.4 |

Speech is still better than prod in every row, because the narrow veto outweighs the delay.
The cost is pause painting: for the first 20 s after a fan or compressor turns on, its line is
painted in pauses (prod: ~5 s). That is the explicit trade for never blanking a held note
shorter than 20 s.

## 6. Stable cascade keying (in-place retune at > 0.5 Hz)

`churn.mjs`, 120 s per source. **Resets** means full-cascade state resets after the first
promotion. Stable keying never resets surviving sections; it only adds sections when a new
line enters.

| source | prod resets | prod chunks > +10 dB | prod max spike | stable resets / retunes | stable chunks > +10 dB | stable max spike |
|---|---|---|---|---|---|---|
| 120 Hz ± 0.6 Hz wobble | 43 | 117 | +16.4 dB | 0 / 63 | 0 | +8.1 dB |
| 120 Hz ± 1.5 Hz wobble | 186 | 0 | +7.9 dB | 0 / 287 | 0 | +5.8 dB |
| 60 Hz ± 0.5 Hz + h2 | 24 | 56 | +13.8 dB | 0 / 32 | 0 | +5.4 dB |
| pure 120.0 / 120.5, fan-hum, mains | 0 | 0 | ≤ 4.1 dB | identical | 0 | identical |

Stable keying has no effect on stationary sources. It removes every rebuild transient on
drifting ones.

## 7. Results for the recommended configuration (full grids)

### 7a. FDA speech-in-noise

`oracle-pitch.mjs`: committed-oracle cells (100 FDA tracks, 8 s lead, 3 s tail) through the
exact chain. Each cell is correct / oct-down / null %, then noise-only tail FV / painted %.

| cell | committed oracle (no veto) | **prod** | **recommended** | recommended + inter floor | prod + inter floor |
|---|---|---|---|---|---|
| clean | 86.8 / 0.5 / 2.9 | 86.8 / 0.5 / 2.9 | 86.8 / 0.5 / 2.9 | 86.9 / 0.5 / 2.4 | 86.9 / 0.5 / 2.4 |
| fan-hum +20 | 85.8 / 0.6 / 3.4 | 69.4 / 0.6 / 22.1 · 0.01/0.00 | **77.9** / 0.5 / 12.4 · 0.02/0.00 | 78.3 · 0.02/0.00 | 69.8 |
| fan-hum +10 | 85.5 / 0.6 / 4.1 | 69.3 / 0.5 / 22.6 · 0.06/0.01 | **77.8** / 0.4 / 12.8 · 0.09/0.01 | 78.2 · 0.30/0.07 | 69.5 |
| fan-hum +5 | 84.6 / 0.4 / 5.8 | 68.4 / 0.3 / 24.1 · 0.01/0.00 | **76.7** / 0.4 / 14.5 · 0.01/0.00 | 77.1 | 68.8 |
| mains +20 | 85.9 / 0.5 / 3.4 | 65.1 / 0.5 / 26.7 · 0.01/0.00 | **77.7** / 0.5 / 12.6 · 0.03/0.02 | 78.1 | 65.4 |
| mains +10 | 85.9 / 0.5 / 3.4 | 65.1 / 0.5 / 26.8 · 0.01/0.00 | **77.9** / 0.5 / 12.4 · 0.03/0.03 | 78.2 | 65.3 |
| mains +5 | 85.7 / 0.5 / 3.7 | 65.0 / 0.5 / 27.0 · 0.01/0.00 | **77.9** / 0.5 / 12.3 · 0.03/0.03 | 78.2 | 65.3 |
| sleep-birdies +20 | 86.5 | 83.5 / 0.4 / 6.5 · 0.03/0.02 | **85.9** / 0.4 / 4.0 · 0.03/0.02 | 86.2 · 0.03/0.02 | 83.8 |
| sleep-birdies +10 | 86.0 | 83.1 / 0.3 / 7.1 · 0.65/0.03 | **85.5** / 0.3 / 4.4 · 0.63/0.03 | 86.2 · **2.05/0.13** | 83.6 · 2.06/0.14 |
| sleep-birdies +5 | 84.5 | 81.6 / 0.2 / 8.0 · 0.61/0.02 | **84.0** / 0.2 / 5.4 · 0.58/0.02 | 85.1 · **1.99/0.15** | 82.4 · 2.02/0.17 |
| fan-wobble0.6 +10 (extra) | — | 66.8 / 2.8 / 23.1 · 1.53/0.01 | **73.9** / 4.3 / 13.2 · 1.79/0.42 | 74.3 · 17.3/4.4 | 67.2 · 4.8/0.04 |
| hum-rich120 +10 (extra) | — | 65.6 / 2.1 / 24.9 · 0/0 | **73.9** / 2.3 / 14.9 · 0/0 | 74.1 · 0/0 | 65.8 |

- **Every broadband +10 dB cell is bit-identical to prod:** white, pink, brown, sleep-noise,
  resonant-noise, crickets, cicadas and babble. The notch never activates there.
- **Gender split** is shown as M / F correct, with max(F_err, M_err) in parentheses:
  - fan-hum +10: prod 70.8 / 68.0 (32.0) → recommended 77.7 / 77.9 (22.3).
  - mains +10: 61.2 / 68.5 (38.8) → 77.5 / 78.3 (22.5).
  - sleep-birdies +10: 77.9 / 87.5 (22.1) → 82.7 / 87.8 (17.3).
  - The gender-symmetric metric improves 5–16 pp. No male cell falls.
- **Fan-wobble0.6:** octave-down rises 2.8 → 4.3 % in the recommended config. Hum capture
  happens during speech that the old veto had blanked. Correct rises +7.1 pp.

### 7b. Noise-only false voicing

`noise-fv.mjs`: 40 s at 0.05 scale, scored after 10 s. Cells are worker FV % / painted %.

| class | prod | **recommended** | recommended + inter | prod + inter |
|---|---|---|---|---|
| white, pink, sleep-noise, mains, crickets, cicadas, hum-rich60 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| brown | 0 / 0 | 0 / 0 | 0.67 / 0.08 | 0.67 / 0.08 |
| sleep-birdies | 0.33 / 0.08 | 0.33 / 0.08 | 1.42 / 0.33 | 1.42 / 0.33 |
| resonant-noise | 0.33 / 0 | 0.33 / 0 | 0 / 0 | 0 / 0 |
| fan-hum | 0.08 / 0 | 0.08 / 0 | 0.08 / 0 | 0.08 / 0 |
| fan-wobble0.6 (extra) | 0.17 / 0 | 1.50 / 0.33 | 10.6 / 2.5 | 2.42 / 0.17 |
| fan-wobble1.5 (extra) | 1.08 / 0 | 4.42 / 0.17 | 6.51 / 0.25 | 2.67 / 0 |
| fan-drift 118→122 Hz (extra) | 0 / 0 | 1.67 / 0.25 | 7.17 / 1.58 | 2.25 / 0 |
| hum-rich120, fan-wobble0.6+rich (extra) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

**Voicing-shootout noise-only** (`shootout.mjs`, 30 s at 0.03, % voiced / painted, every class
plus babble and resonant q5/q2): the recommended config equals prod in **every** class. The
inter floor adds brown 0.25 → 0.92 / 0.08 and sleep-birdies 0.25 → 2.75 / 0.75.

### 7c. Gender oracle

`oracle-gender.mjs`: the committed gender mode with the production-exact voiced timeline,
31 Hillenbrand speakers, +10 dB.

- Speech accuracy is **31/31** for prod, veto removed and the recommended config, in all 13
  classes and on clean audio. Drift is identical.
- Noise-only VAD pass:
  - identical to prod in 12 of 13 classes;
  - fan-hum 4.4 % for both;
  - fan-wobble0.6 (extra class): 5.9 → 10.3 % (veto removed: 26.5 %);
  - hum-rich120: **100 % in prod and in every variant**. This is a pre-existing gap,
    independent of this change, and listed as an open question.

### 7d. Corpora

- **Clean FDA and PTDB:** the notch never activates (phase-1 `corpus-*.log`), so the
  recommended config is bit-identical to prod there. Every male-band guard (PTDB < 125 and
  125–160, FDA male, Hillenbrand men) is **exactly unchanged**.
- **Hillenbrand:** single short vowels can never reach 5 s, so it is also identical.
- **Vocadito (40 tracks), correct %:**

| condition | prod | veto removed | recommended |
|---|---|---|---|
| clean | 95.5 | 95.8 | 95.7 |
| fan-hum +10 | 73.2 | 94.9 | 87.8 |
| mains +10 | 72.5 | 95.8 | 85.1 |

  - vocadito_29, where a 100 Hz line is promoted in clean audio: 81.4 → 89.0 %
    (fan-hum 85.5 → 96.0).
  - vocadito_34: 53.2 → 53.5 % (fan-hum 41.7 → 51.2).

### 7e. Sessions (both reference conventions)

The recommended configuration was run through the full chain on the private session
recordings under both reference conventions. It suppresses the notch activations on voice-born
holds, keeps a real room-hum line, and leaves the held-out recording bit-identical by
construction (no activation there). **This change does not touch the target-band half-pitch
complaint, and should not**: the notch is active for a small fraction of real recordings, and
the half-pitch frames come from the detector and display-chain causes in phase-1 findings 1–2.
Results on the private session recordings are kept outside this repository.

### 7f. Tests and CPU

- `tests/dsp/boersma-ac-test.js`, including weak-H1: 25 / 25. `boersma-ac.js` is unchanged.
- Proposed `tests/dsp/noise-notch-test.js`: **36 / 36 on the proposed tree.** The same file
  against production modules fails 20, which shows the new checks discriminate:
  - held notes promoted at 6.2 s;
  - real-worker held notes only 27.3 % reported;
  - mid-session hum promoted at 5.2 s;
  - trailing-duty promotion;
  - +16.2 dB rebuild spike;
  - the adoption case.
- ESLint: the proposed `src/` files are clean.
- **CPU.** Full worker step (notch + AC + tracker + veto + guard), best of 3 on a shared
  machine:
  - speech audio: 0.48 ms/frame (prod) vs 0.46–0.48 (recommended);
  - fan-hum with the notch active: 0.33–0.37 vs 0.37–0.39.
  - Both are about 2 % of the 25 ms hop. `activeLines()` adds an O(lines × tracks) lookup per
    frame.

## 8. Item 4: inter-harmonic guard floor. Recommendation: do not ship now

**Gains:**

- Low-voice (75–160 Hz) frames recovered on the private session recordings (decoded and
  displayed; results kept outside this repository).
- Male corpora: FDA male 85.7 → 86.0; PTDB male 60.7 → 62.2.

**Costs:**

1. **More half-pitch frames in the target band**, which is exactly the user's complaint. The
   prod floor was vetoing some half-pitch runs (measured on the private session recordings,
   including the held-out recording; results kept outside this repository).
2. **Noise false voicing** in brown, sleep-birdies and the wobble classes. Oracle tails:
   sleep-birdies 0.63 → 2.05 %; fan-wobble0.6 1.8 → 17.3 %.
3. **Octave-up rises slightly:**
   - FDA male up 0.22 → 0.30 and male < 125 0.34 → 0.48 (the latter is +0.14 pp; the guard
     allows +0.3 pp);
   - PTDB male up 0.13 → 0.15.

**Recommendation:** revisit together with the detector half-pitch fix (the phase-1 SHR
arbitration). Once the half-pitch frames are fixed upstream, the floor's main downside goes
away and its low-band gain is clean. (As integrated, the upstream octave fix that shipped is
the odd/even prominence arbitration —
[pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md) — not the
phase-1 SHR rule; the inter-harmonic floor has not been re-measured on top of it.)

## 9. Chosen configuration and why

**`noise-notch.js`:**

- onset-born promotion delay: `onsetDb` 10, `onsetHistSec` 2, `onsetMinTrackSec` 20;
- young-only onset re-birth (tracks younger than `onsetHistSec`);
- seen-to-promote;
- track-id cascade keying with in-place `setCoefficients` retune at > `retuneHz` 0.5;
- per-track wobble estimate `dev`;
- `activeLines()`;
- `isNearNotch(f, lines, { tolFrac 0.02, wobbleK 6, rels [1, 2] })`. It accepts bare numbers
  for back-compat.

**`pitch-worker.js`:** veto with `noiseNotch.activeLines()`. The `notchedFreqs` relay is
unchanged.

**Guard:** unchanged.

**Why this configuration:**

- It is the only configuration measured that does all of the following:
  - recovers most of the tonal-noise speech loss (fan-hum / mains +8.3 to +12.9 pp; worst
    gender error 32–39 % → 22–23 %);
  - keeps held notes of up to 20 s at the no-notch ceiling at 120 and 220 Hz, modal and
    breathy (prod 22–64 %);
  - keeps every committed noise class at prod false-voicing levels.
- It also keeps the rich, partial-notch and wobbling-hum classes, which this pass added,
  within ≤ 0.4 % painted (veto removed: up to 55 %).

## 10. Rejected options

- **Veto removed** (task 1 as specified): 46–55 % painted on wobbling / rich hums, and 78 %
  pause FV after a mid-session switch-on (§3).
- **Notch-aware guard, with or without an aware veto:** 99.8 % FV on a rich hum (§3).
- **Fixed ±1.2 / ±2 / ±3 % section-frequency vetoes:** dominated by W (§4). ±1.2 % leaks
  6.4 % painted on wobble; ±3 % costs 5 pp more speech.
- **Onset delay 10 s:** 14 s holds fall to 86.7 %.
- **Onset delay 15 s:** 15–20 s holds fall to 74–77 %.
- **Onset delay 30 s:** 100 % pause painting over the first 30 s of a switched-on hum.
- **Onset rule without seen-to-promote:** post-note promotions.
- **Re-birth of any age:** spurious new notching of a weak real room hum in a private session recording.
- **Inter-harmonic floor:** §8, deferred.

## 11. Residual risks

- **Synthetic noise, real speech.** The extra wobble / rich classes are synthetic.
  Field-recorded hum validation is still pending, as in the 2026-07-19 pass.
- **Long holds.** Holds longer than 20 s can still be notched and lose their tail. Breathy
  holds go blank once notched (30 s holds: 70.6 % reported).
- **Mid-session interferers.** An interferer that switches on mid-session is notched after
  ~20 s instead of ~5 s.
- **Voice on a hum line.** Voice within ±2 % of an active line, or of its octave, is still
  vetoed. This is frame-locally indistinguishable from the hum's residual, an accepted
  limitation.
- **Gender VAD on rich hums.** The VAD passes 100 % of rich-120 Hz-hum noise-only windows in
  prod already (the subFloor / recency arms); out of scope here.

## Reproduction

Committed guards (run anywhere):

```
node tests/dsp/noise-notch-test.js                         # 36/36
node scripts/noise-augment-oracle.js pitch --frontend=tracker   # production-exact chain now
```

Scratch harnesses: all commands run from `build/measure-2026-10-03/notch/` in the main
checkout, except the session harness (session WAVs and phase-1 references live outside the
repo).

```
# baseline match
node verify-parity.mjs                                    # real worker vs mirror (prod)
node verify-parity.mjs proposed/final/src/dsp/pitch-worker.js on10_20skWRy   # proposed worker
node verify-shortcut.mjs; node verify-guard.mjs; node verify-harness.mjs
# (cmp-runs.py: session-pipeline rerun vs phase-1 baseline; needs a private session recording)

# oracle grid (one process per cell); variants are named in chainlib.mjs
#   rec = on10_20skWRy, veto-only = vetoW
node oracle-pitch.mjs --variants=oracle,prod,noveto,vetoW,on10_20skWRy,on10_20skWRy+inter,prod+inter \
     --noises=fan-hum --snrs=10 --clean=false --out=final/p_fan-hum_10.json
node oracle-pitch.mjs --corpus=vocadito --pertrack=1 --variants=prod,noveto,vetoW,on10_20skWRy \
     --noises=fan-hum,mains-complex --snrs=10 --out=final/vocadito.json
node oracle-gender.mjs --variants=prod,noveto,on10_20skWRy --noises=fan-hum --snrs=10 --out=final/g_fan-hum.json
node shootout.mjs --part=speech|noise --variants=prod,on10_20skWRy,on10_20skWRy+inter
node noise-fv.mjs --variants=prod,noNotch,noveto,vetoW,on10_20skWRy,on10_20skWRy+inter,prod+inter
node onset-mid.mjs --variants=prod,noveto,vetoW,on10_15skWR,on10_20skWRy
node held.mjs --set=main|req --variants=prod,noNotch,noveto,vetoW,on10_20skWRy --shard=i/n --out=...
node churn.mjs; node cpu.mjs prod on10_20skWRy prod on10_20skWRy

# sessions: the session-attribution chain-harness runs need the private session recordings
# and phase-1 references (not in this repo); omitted here

# proposed tree + tests
python mk_final.py && (cd proposed/final && node tests/dsp/noise-notch-test.js)
python final_tables.py      # final/tables.md
```
