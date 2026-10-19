# Narrowband (phone-quality) audio detector for the resonance cue — 2026-10-19

Branch `cue-strip`. User decision 2026-10-19: detect phone-quality
(narrowband, ~8 kHz sample-rate path) audio and, while it is detected, hold
back the resonance position in the cue strip with a short plain notice.

Background: measurements/resonance-robustness-2026-10-19.md (branch
`resonance-robustness`, 99ff7fc) found that every path that cuts the band
above ~4 kHz — telephone band, AMR-NB, G.711, Opus 8 kbit/s narrowband, and a
4 kHz low-pass — moves the resonance reading 0.6–2.5 G darker (women worse)
and, for the telephone band / AMR-NB / G.711, loses in-session changes, while
wideband paths (100 Hz–7 kHz, AMR-WB, Opus 12 / 24 kbit/s, mSBC) shift
≤ 0.14 G and keep the change. Public data and synthetic signals only.
Nothing under `src/` changes until this note has results (hard rule 3).

## Plan (pre-registered)

Committed and pushed before any result exists. Deviations found later are
added under "Deviations" with a date; this section is not edited afterwards.

### 1. What the user sees

- While narrowband audio is detected, the resonance row shows no dot and no
  "brighter / darker than your start" header, only the notice
  **"Phone-quality audio — resonance paused"**. Its info text: "Your
  microphone sound is cut off above about 4 kHz, as on a phone call or a
  narrowband Bluetooth headset. Resonance readings need the fuller sound, so
  they are paused. Pitch still works. A wired or wideband microphone fixes
  this."
- **Pitch is unaffected:** the pitch worker, pitch trace, readout,
  steadiness and every other row are untouched; only the resonance row's
  display changes. The resonance worker keeps running so the notice can
  clear by itself.
- When the audio stops looking narrowband (hysteresis, §2), the notice clears
  and the row returns to its normal states (warming / settling / live).
- Before the detector has its minimum voiced time it says nothing, and the
  row behaves exactly as it does today.

### 2. Detector

Browsers resample narrowband input to the capture rate (44.1 / 48 kHz), so
the capture sample rate cannot tell. The detector reads the band content of
the audio the resonance path already has: the resonance engine's 16 kHz ring
(`src/resonance-lab/lab-engine.js`, `ring16`, 0–8 kHz) and its voiced 10 ms
grid (the relayed production pitch posts). Causal and cheap:

- On every voiced 10 ms grid frame: 512-sample (32 ms) Hann window ending at
  the frame time, power spectrum, energy in a **high band** and a
  **reference band**.
- Long-term estimate: an exponential average of each band's energy over
  voiced frames only, time constant **τ** seconds of voiced audio (unvoiced
  time does not age it). Feature F = 10·log10(E_high / E_ref) in dB.
- Decision: undecided until **V_min** seconds of voiced audio; then the
  notice turns **on** when F < T_on and **off** when F > T_on + H
  (hysteresis H dB).

Candidate grid (all chosen on the dev half, §4):

| Parameter | Candidates |
|---|---|
| Bands (high / reference) | A: 3.8–6.5 kHz / 1.0–3.5 kHz; B: 4.5–6.5 kHz / 1.0–3.5 kHz; C: 4.5–6.5 kHz / 2.5–3.5 kHz (adjacent reference, less sensitive to overall spectral tilt) |
| τ (voiced s) | 4, 8 |
| V_min (voiced s) | 3, 5 |
| H (dB) | 3, 6 |
| T_on (dB) | −60 to −10 in 1 dB steps |

The high band stops at 6.5 kHz so that 7 kHz wideband paths (AMR-WB, the
100–7000 Hz mask, the 7 kHz low-pass) keep the band and stay negatives. The
4 kHz low-pass (8th-order Butterworth, −5 dB at 4.2 kHz, −16 dB at 5 kHz) is
expected to be the hardest positive and −6 dB/oct tilt the hardest negative;
band C is in the grid for that pair.

The evaluation implementation lives in `scripts/resonance-narrowband/`
(Node): it builds the 16 kHz stream with the engine's own resampler and takes
voiced frames from the REAL pitch worker's posts, as the resonance worker
does. The later `src/` implementation must match it bit-for-bit on the
evaluation streams (parity test) before any ship claim.

### 3. Data

The robustness study's streams, rebuilt with its scripts at 99ff7fc
(`scripts/resonance-robustness/build_streams.py`, same seeds, same 40 s cut,
same condition realisations; audio stays in the gitignored cache / `build/`):
40 LibriSpeech test-clean readers (20 women, 20 men), each with the five
WORLD versions (k = 0.88–1.12) plus the clean original, at 48 kHz (44.1 kHz
for the rate condition).

- **Negatives (wideband):** clean; high-pass 100 / 200 / 300 Hz; 7 kHz
  low-pass; tilt +6 / −6 dB/oct; wideband 100–7000 Hz mask; Opus 24 and
  12 kbit/s WB; AMR-WB; mSBC; compressor, fast AGC, slow AGC; the three room
  bins; babble / fan / street at +20 and +10 dB; level −20 / −10 dB and
  +20 dB clipped; 44.1 kHz capture; the five combinations (laptop, headset
  at home, Bluetooth headset (mSBC), phone on a desk, video-call recording).
- **Positives (narrowband):** telephone band (300–3400 Hz through 8 kHz);
  AMR-NB 7.4 kbit/s; G.711 µ-law; Opus 8 kbit/s narrowband; 4 kHz low-pass;
  and one new condition, **narrowband-Bluetooth-like** = the Bluetooth
  headset combination with mSBC replaced by an 8 kHz path: babble +20 dB
  and the compressor are applied first (the noise is at the talker's side,
  so it goes through the link), then scipy `resample_poly` 48→8→48 kHz.
- **Speaker split:** within each sex, readers sorted by LibriSpeech id;
  even ranks = **dev** (10 women, 10 men), odd ranks = **held-out**
  (10 + 10). All versions of a reader go to the same half.
- Budget: if the dev run projects above 3 h of wall time at two processes,
  only k = 0.88 / 1.00 / 1.12 plus the clean original are used for every
  condition (decided before any detector output is looked at; recorded as a
  deviation).

### 4. Metrics, pass bar (fixed now) and selection

Voiced time = time at which the latest relayed pitch post is voiced.

- **Negatives:** notice-on share = voiced time with the notice on ÷ voiced
  time, pooled per sex per condition. **Pass:** ≤ 1 % for each sex in every
  negative condition, AND the notice never shows on any clean-condition
  stream (all versions and the originals).
- **Positives:** a stream is detected if the notice is on by the time
  10 s of voiced audio has passed. **Pass:** ≥ 95 % of streams detected for
  each sex in every positive condition.
- Reported, not judged: time to notice (voiced s, median / q90), notice
  dropouts on positives after first detection (share of later voiced time
  with the notice off), per-condition F distributions, CPU per second of
  audio.
- **Selection (dev half only):** among grid points that pass both bars on
  dev, take the one with the most negative-side headroom: the lowest worst
  negative notice-on share, then ties broken by the largest worst-sex
  positive detection rate, then larger H, then shorter V_min, then T_on at
  the middle of the passing T_on run. If no grid point passes on dev, the
  result is "no detector meets the bar" and nothing ships; the grid is not
  widened without a dated deviation.
- **Confirmation:** the selected point is run once on the held-out half.
  Pass on held-out = both bars met there. A held-out failure is reported as
  a failure; the threshold is not re-tuned on the held-out half.

### 5. After the result

Only if the held-out confirmation passes: implement the detector in the
resonance worker (state posts carry the notice flag), add the row state and
notice to `src/components/cueStripModel.js`, a bit-exact parity test against
`scripts/resonance-narrowband/`, and the usual lint / unit / build / cue-strip
smoke runs.

## Deviations

(none yet)

## Results

(not run yet)
