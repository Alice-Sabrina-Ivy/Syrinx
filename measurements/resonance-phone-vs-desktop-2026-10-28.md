# Resonance cue: why it reads darker and moves less on a phone than on a headset (2026-10-28)

Branch `resonance-mobile` (from `main` 9e1696b). Diagnosis only: nothing under
`src/` changed. Public data and synthetic conditions only (LibriSpeech
dev-clean, CC BY 4.0; one CC0 air-conditioner clip already in
`tests/dsp/data/notch-real/`).

**The report (owner, 2026-10-27).** The owner ran the app side by side on two
devices at once:
- a desktop with an Audeze Maxwell headset, whose boom mic sits a few cm from
  the mouth and has its own noise filter;
- a Pixel phone (Chrome) held in the hand not far from the mouth.

On the phone the resonance meter "moved a lot less" and typically read darker.

**Answer in short.**

1. **The darker reading has no plausible cause that can be reproduced
   offline.** The following all read the same or BRIGHTER, not darker:
   - distance, room echo, angle below the mouth, the phone body shading its
     mic, the hand;
   - unsuppressed room noise, quiet input with gain control off;
   - device speed, relay lag and capture timing.

   Only two microphone-response shapes read noticeably darker:
   - extra energy around 2–3 kHz (+6 dB: about −0.2 u; +3 dB: about −0.1 u);
   - a steep cut at 4–4.5 kHz.

   Chrome's current Android capture path for streams without echo
   cancellation is a full-band preset, so the steep cut is unlikely. The
   headset boom may itself read bright, but that is a hypothesis. Settling it
   needs a measurement of the two real devices on the same sound.
2. **A smaller swing on the phone also has no single plausible cause
   offline.** Unsuppressed broadband room noise shrinks the swing, but only
   at ≤ 20 dB SNR inside 0.8–5 kHz, and it reads brighter. The restart rule's
   fixed 0.6 u threshold then amplifies any shrinkage on 3–5 s tries. Device
   speed is ruled out at the phone's measured loads.
3. **Two display issues are confirmed in the real hook** (§5). Neither
   changes the resonance value.
   - **On every device the trail is cleared ~10 times a minute** (the "onset
     blink"). The resonance streak therefore shows ~2 points (~4 s), not the
     "last ~30 s" its info text promises.
   - **On a device whose pauses are ≥ −50 dBFS full band** (a phone hearing
     the room with noise suppression off), the thumb and the pitch number
     vanish ~0.8 s into every pause. On a quiet-floor device such as a
     noise-filtered headset they stay dimmed for up to 5 s.

## 1. Method

- **Readers.** LibriSpeech dev-clean, the first 6 men and 6 women by speaker
  id (`faster-prep.py --n=6`).
- **Streams.**
  - WORLD renders N (unchanged), U10 (+12 % formant scale, ≈ +1 u) and D10
    (−12 %).
  - Switch streams N→U10→N and N→D10→N, changing at 18 s and 36 s.
  - Short excursions: U10 / D10 held for 3, 5 or 8 s from 18 s.
  - Each reader's own 150 s recording.
- **Chain** (`scripts/resonance/mobile/chain.mjs`). Every perturbation
  (`perturb.mjs`: filters, gains, noise, impulse responses, modules) is
  applied to the 48 kHz stream *before* both workers see it. The chain runs:
  - the REAL pitch worker with the real FireRedVAD model;
  - the resonance worker's chain replayed with the hint the hook relays, gate
    on and off.

  The unperturbed runner equals `faster.mjs` field for field on 5 streams. The
  REAL resonance worker was run beside it with all posts equal (e.g. 47 952 /
  47 952 in §5).
- **Metrics** (`summarize.mjs`), per condition, against the clean run of the
  same reader:
  - bias of the shown u on N;
  - sensitivity: u(U10) − u(D10) as a ratio to clean;
  - T50 / T90 of the 1.0 u switches;
  - short-excursion peak ratios;
  - admitted bins per second, voiced and hidden shares, narrowband F.
- **Browser.** The built app ran in headless Chrome 156 with a fake mic,
  logging every chunk, pitch message, resonance post and the drawn value.
  - CPU limits: renderer on 1 core, or 2 cores + 4× main-thread throttle.
  - Main-thread load: a busy loop.
  - CDP throttling does not reach workers ("only supported for pages").
- **Display** (§5): the REAL DSP worker, the REAL `useAudioPipeline` hook
  (silence gate, voice gate, 200 ms state throttle) and the REAL cue-strip
  model (`cueRowStates`, `createTrail`, the streak geometry of
  `CueStrip.jsx`) at the 4 Hz tick.
  - It was confirmed by a second, independent driver with a realistic clock:
    0 of 6000 frames differ per stream over 192 streams.
- **Review.** Two independent reviewers re-ran parts of every experiment. Their
  corrections are folded in below; claims that did not survive are dropped.

## 2. Microphone and placement (bias and swing)

Gate on; 6 men / 6 women; u relative to clean.

| condition | bias m / f | sensitivity m / f |
|---|---|---|
| 1st / 2nd-order low-pass, 2–6 kHz | −0.09 … +0.14 | 0.99 – 1.23 |
| tilt −3 / −6 / −9 dB per octave above 1 kHz | +0.07 / +0.15 / +0.23 · +0.22 / +0.44 / +0.57 | 1.05 – 1.14 |
| mouth directivity 30° / 60° / 90° (Monson et al. 2012) | −0.02 / +0.04 / +0.21 · −0.03 / +0.11 / +0.34 | 1.00 – 1.04 |
| high-pass 150 / 300 Hz | ≤ 0.01 | 1.00 |
| +6 dB peak (Q 2) at 2 kHz | −0.24 / −0.17 | — |
| +6 dB peak at 3 kHz | −0.18 / −0.24 | 0.96 / — |
| +3 dB peak at 3 kHz | −0.09 / −0.12 | 0.98 / 0.99 |
| +6 dB shelf from 2 kHz | −0.11 / −0.19 | 0.97 / — |
| 8th-order low-pass 4 / 4.5 / 5 kHz | −0.15 / −0.39 · −0.06 / −0.12 · ≈ 0 | 0.82 / 0.96 at 4 kHz |
| hand-held: 0.2 m, 40° below, RT60 0.6 s, phone-body shadow | +0.18 / +0.18 (0 of 12 readers darker) | 1.05 / 1.05 |
| 15 hand-held / hand cases (0.1–0.3 m, 20–60°, RT60 0.3 / 0.6 s) | −0.01 … +0.33 | 1.01 – 1.33 |
| room echo alone at 0.2 m | ≤ +0.06 | 1.00 – 1.01 |
| 6-band compressor, 3:1 (platform dynamics) | −0.05 / +0.03 | 1.01 / 1.02 |

How to read the table:

- **Bias comes from the spectrum.** Every bias is vtln's own. Swapping in the
  clean pitch track keeps it within 0.03 u. Pitch and the voice gate are
  untouched by every response.
- **Reading darker needs one of two shapes:** a mid-band rise, which is
  roughly linear in dB, or a steep edge at the top of vtln's 0.8–5 kHz band.
  The phone-quality notice never fired on any of them, and its F value does
  not track these shapes (corr(ΔF, bias) 0.30 / 0.18).
- **Hand-held placement reads brighter here, but its sign is open.** That
  result rests on a shadow model with the mic port facing away from the mouth.
  A port facing the mouth, or a cupped hand, would add 2–3 kHz energy, which
  reads darker. The sign depends on the geometry and is unresolved.
- **Chrome's capture preset.** With echo cancellation off, Chromium's Android
  AAudio input currently opens `AAUDIO_INPUT_PRESET_GENERIC`
  (`media/audio/android/aaudio_stream_wrapper.cc`, main, read 2026-10-28;
  CAMCORDER before ~M153, crbug 503025582). Both are full-band recording
  presets, so a steep 4 kHz cut in the phone's path is unlikely.
- **The reference may read bright.** The boom sits at the corner of the mouth,
  60–90° off axis. Far-field directivity puts it at +0.08 / +0.25 u (men /
  women) with sensitivity 1.05 / 1.10. The proximity effect of a directional
  capsule and the Maxwell's noise filter are not modelled.

## 3. Level, noise, device speed

**Level.** Speech level alone does nothing down to a voiced median of about
−55 dBFS: posted pitch is scale-invariant, and vtln removes each frame's mean.
- The voice gate hides about 1 % of voiced hops at −50 … −55 dBFS, 5 % at
  −55 … −60 and 10 % at −60 … −65.
- At 10–30 cm a phone is far above that.

**Noise.** Broadband noise compresses the swing and reads brighter. Values are
for pink noise at the phone's level, with SNR measured on active speech:

| pink SNR | sensitivity m / f | bias m / f |
|---|---|---|
| 30 dB | 0.93 / 0.94 | +0.08 / +0.06 |
| 20 dB | 0.69 – 0.74 / 0.86 – 0.89 | +0.18 / +0.18 |
| 10 dB | 0.33 / 0.60 | +0.45 / +0.19 |

- Low-frequency (brown, fan-like) noise at ≥ 20 dB is negligible.
- Room noise passed through a steep 4 kHz cut: −0.03 / −0.31 u, sensitivity
  0.67 / 0.83. A band-limited mic in a noisy room would therefore read darker
  and compressed, if such a cut existed (see §2).

**Device speed** (built app, Chrome). Phone-like and heavier main-thread load
(586–902 ms/s busy, against the Pixel's measured 250–320) and a renderer on 1–2
cores:
- T50 changed by −0.24 to +0.40 s (run-to-run noise ±0.2 s);
- swing was 0.95–1.12 of base;
- bias was 0.00 ± 0.01 u;
- the overload guard never fired (resonance worker 38–82 ms/s against its
  500 ms/s limit).

The only slow-device path that shrinks the swing is capture loss. The
main-thread MSTP reader drops frames once it falls 10 frames behind. That
needs about 50 % loss, which takes a saturated main thread, and it reads
brighter.

At start-up only, a CPU-limited renderer switched the voice gate off ("slow")
5.6–11.7 s after Start and delayed the first position by 1.5–3 s.

**Relay lag** (Node, real resonance worker). No effect up to 0.3 s of extra
lag. Admitted voiced time falls 6 % at 0.375 s and 25 % at 0.575 s, because
the cue's utterance gate decides at the chunk's time with the hints it has.

## 4. The restart rule amplifies a shrunken swing on short tries

Since 2026-10-26 the shown value is the recency-weighted median. That median
alone is exactly linear: compress the bins by k and the shown move shrinks by
k. The restart rule is not linear. It needs the 1.5 s and 5 s medians to differ
by ≥ 0.6 u, an absolute threshold, on 4 bins in a row.

Replaying the shipped `createRestartReadout` on the logged bins, with every
bin compressed toward the pre-change median by k, gives these peak-sum ratios:

| hold | k = 0.7, m / f | k = 0.5, m / f |
|---|---|---|
| 3 s | 0.59 / 0.61 | 0.31 / 0.40 |
| 5 s | 0.65 / 0.64 | 0.35 / 0.44 |
| 8 s and 18 s | ≈ k | ≈ k |

So a device that shrinks a 1 u change to 0.6–0.8 u loses the restart, and its
3–5 s tries shrink more than its steady swing. Two devices can then disagree
sharply on short changes.

Even on clean audio, half of the men's 3 s changes barely show. That depends
on where the reading pauses fall (n_eff 6 per sex), and the earlier "≈ 18 bins
flips it" claim did not survive review.

## 5. Display: the onset blink and the noisy-pause dropout

The resonance row draws a thumb only while the hook's gated `pitchVoiced` or
`pitchHolding` is true:

- **Quiet pause.** The 5 s dim hold applies only on the silence-gate path:
  full-band 50 ms DSP intensity < −50 dBFS and confidence < 0.5, for ≥ 3
  frames.
- **Noisier pause.** The row goes "idle" after the 400 ms pitch hold plus
  `VOICED_FALL_FRAMES` (16). `createTrail` clears the trail on idle.

**Dose-response.** Stationary noise was added under −32 dBFS active speech;
12 readers × 150 s; medians. The "1–5 s pauses" column is the share in which
the thumb disappears inside the pause.

| noise, measured pause floor | silence gate on in pauses | thumb shown | 1–5 s pauses: thumb gone inside | trail points (mean) |
|---|---|---|---|---|
| none (−66.6 dBFS) | 75 % | 96.1 % | 7.8 % | 2.2 |
| brown −54.3 / pink −54.6 | 75 % | 95.8 % | 8–12 % | 2.0 – 2.1 |
| brown −51.5 | 59 % | 93.4 % | 78 % | 1.8 |
| brown −49.6 / pink −49.8 | 10 – 13 % | 88.8 – 89.3 % | 100 % | 1.7 – 1.8 |
| brown −47.7 / pink −47.8 | 0 % | 90.1 – 90.2 % | 100 % | 2.0 |
| brown −39.8 | 0 % | 86.7 % | 100 % | 1.5 |

- **Threshold.** The step lies between −53.8 and −49.8 dBFS (brown) and
  between −52.4 and −50.2 (pink); its width is the noise's 50 ms window
  spread. Above it the thumb is missing for 44–52 % of the time in a 1–5 s
  pause, against about 10 % in quiet. Men and women are affected alike.
- **Near the threshold** (−52 … −50 dBFS) windows crossing −50 alternately
  re-arm the 5 s hold and expire the fall. The thumb flickers, and noise alone
  shows "keep talking…" 22–88 % of the time.
- **A tonal hum behaves differently.** With a hum (the AC clip) at ≥ −50 dBFS,
  the row instead stays live in pauses: the hum is posted voiced in 36–45 % of
  pause hops and shown under the voice detector's 2 s hangover. That is a
  false-voicing case, not a better display.

**Onset blink (every device).** When speech resumes after a silence-gated
pause longer than about 0.45 s, both rows go idle for about 130 ms. The quiet
frames have already run the voiced-fall counter past 16, and the first speech
frames have no painted pitch yet. Through the 200 ms throttle and the 4 Hz tick
this clears the resonance trail about 10 times a minute even in quiet. The
trail therefore holds about 2 points (~4 s), not the 15 points (~30 s) that
`RESONANCE_TRAIL` and the info text ("The streak shows the last ~30 s") intend.

- It holds in every order and timing variant tried: pitch or DSP message
  first, tick phase, ±8 ms jitter, the phone's 40 ms burst cadence. In those
  variants quiet idle was 3.9–4.7 % and the trail 1.9–2.25 points.
- On rendered frames the thumb vanishes at 40 % of 0.3–1 s pauses and 76 % of
  1–5 s pauses, even in quiet.

**Counterfactual (diagnostic only).** A resonance row that holds for 5 s after
the last shown voiced frame, whatever the floor, without clearing the trail,
gives at every floor:
- 0 % idle and the thumb shown 100 % of the time;
- a mean trail of 12–14 points and a drawable streak on 97–100 % of ticks;
- an identical u.

It removes the onset blink on the desktop too. Its cost on noise that the voice
detector hears as voice is **not measured**: the 2026-10-21 real-noise set (269
clips) was not kept, and on the synthetic noise here nothing is shown voiced.

## 6. What is left, and how to settle it

- **On screen (no tools).** With the phone in hand and the Dashboard
  listening, say a phrase and stay silent for 2–3 s:
  - if the pitch number and the resonance thumb vanish ~1 s into the silence,
    the phone's pause floor is in the dropout regime (≥ about −50 dBFS);
  - if both stay dimmed, it is not.
- **Pause floor, measured.** Take a `?diag=1` snapshot on the phone and run
  `node --import ./scripts/session-oracle/lib/register.mjs
  scripts/resonance/mobile/pause-diag.mjs <snapshot.json>`. It replays the
  frames through the real hook and prints the pause floor and idle causes. The
  snapshot is the user's voice, so it and its results stay outside this repo.
- **Darker / smaller swing, measured.** Play the same public test sound (pink
  noise, a sweep, LibriSpeech switches) from a loudspeaker to the boom and the
  phone side by side. That gives the phone / boom transfer function. Applied
  as an FIR (`perturb.mjs fir:`) to the 12 readers, it predicts the bias and
  swing on public speech.
  - Recording each device's resonance posts and raw capture over time needs
    harness-side logging (CDP injection, no `src/` change); it does not exist
    yet.
  - Decision rules: the phone reads ≥ 0.15 u darker than the boom, or its
    swing is ≤ 0.85 of the boom's, on the same sound → the device / mic path.
    Within ±0.1 u and ≥ 0.9 → look at placement, noise and the reference.
- **Ruled out** at the phone's measured loads:
  - MSTP re-chunking and timestamp jitter (framesDropped 0);
  - 44.1 vs 48 kHz (vtln bit-identical);
  - the overload guard;
  - the meter's pixel scale (1 u = 68 px at 448×890; 35–72 px on desktop
    windows);
  - level above −55 dBFS;
  - CPU and relay lag.

Older phone diagnostic captures (Chrome 147, before the preset change; kept
outside this repo) put speech far above the voice detector's limit and the
noise-only pause floor close to the −50 dBFS threshold.

## 7. Fix options (none adopted; owner decision)

| option | targets | rule | notes |
|---|---|---|---|
| fix the onset blink so the trail keeps its ~30 s | streak on every device | display (`useAudioPipeline.js` voiced-fall on quiet frames / `cueStripModel.js`), not in hard rule 3 | the streak becomes what its info text says |
| resonance row holds 5 s after the last shown voice, whatever the floor | thumb vanishing in noisy pauses | display, not in hard rule 3 | needs a fresh real-noise set to measure its noise-only cost (the 2026-10-21 bar was 7.0 % not-idle) |
| correct the info text ("~30 s"), say readings depend on the microphone | expectations | text | no reading changes |
| restart threshold relative to the recent spread, not 0.6 u | short tries on a compressing channel | hard rule 3 (resonanceCue.js) | changes only the shown value (`uPlain` and the start stay on the plain readout); needs the resonance-faster guards (jitter, false start words) re-run |
| channel-robust vtln (slope-invariant envelope, narrower band) | darker / compressed from a mic shape | hard rule 3 (vtln.js, lab-engine.js) | the shipped arch is `mw` (mean-normalised log envelope); no `drop_c1` switch exists; needs new feature code, a retrain, refitted bands and new exactness goldens; only if the device measurement points there |
| noise-aware envelope / noisy-room note | compression in noise | hard rule 3 | the worker's lazy 16 kHz ring does not see pauses; a pause floor there costs CPU |

## 8. Files

All scripts are under `scripts/resonance/mobile/` and all outputs under the
gitignored `build/resonance-mobile/`. Every script is runnable from the repo
root.

| scripts | purpose |
|---|---|
| `chain.mjs`, `perturb.mjs`, `summarize.mjs`, `verify.mjs` | runner and verification |
| `audit-*`, `gate-lag.mjs`, `gate-sched.mjs`, `diag-timing.mjs` | relay lag / jitter / stalls |
| `channel-*` | mic responses |
| `distance-*` | image-source rooms, directivity, shadow |
| `level-*` | level and noise |
| `timing-*` | built app in Chrome |
| `pause-*` | display dose-response, `pause-diag.mjs` for a phone snapshot |
| `skeptic/*` | reviewers' re-runs (restart replay, multiband compressor, excursion floors) |
