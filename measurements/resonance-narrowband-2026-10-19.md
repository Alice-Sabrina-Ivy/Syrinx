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

Recorded 2026-10-19, during the run.

1. **Base commit.** `origin/cue-strip` was at 7928936 (not fdfa040) when the
   plan was written; the plan (b991def) sits on top of it. No effect on the
   measurement.
2. **Budget rule (plan §3) not triggered.** The first condition (clean, dev
   half, 20 jobs × 6 streams) took 1.6 min at two processes, projecting
   ≈ 1 h for the 39 conditions, below 3 h, so every version (k = 0.88–1.12
   plus the clean original) was used. Decided before any detector output was
   computed. The whole dev run took 62 min.
3. **Choices the plan left open:**
   - Speaker split: within each sex, readers sorted by the numeric
     LibriSpeech id; ranks 0, 2, 4, … = dev.
   - Voiced time = voiced frames of the engine's 10 ms grid (the grid the
     relayed pitch posts are mapped onto); the notice state of a frame is the
     state after that frame's update.
   - "On by the time 10 s of voiced audio has passed" = the notice first
     comes on within the first 1000 voiced grid frames.
   - Window: `ring16.at(c − 512 … c − 1)` of the engine's own ring (zero before
     the stream start), periodic Hann, band bins k with lo ≤ 31.25 k ≤ hi.
   - Selection tie-breaks after V_min (needed only if points tie on band /
     τ): the (band, τ) with the longest run of tied T_on values, then shorter
     τ, band A < B < C; T_on = lower middle of the run. Not used — no point
     passed.
   - Room responses: the study's final (noise-compensated) picks, its
     deviation 8.
4. **Harness.** `extract.mjs` drives the real pitch worker and the real lab
   engine built as `resonance-worker.js` builds it, without the vtln model and
   the cue (neither changes the 16 kHz ring or the grid). With the shipped
   vtln model and reference loaded (`--vtln`) the output file was
   byte-identical on a synthetic test stream. The rebuilt `streams.json` is
   identical to the robustness study's cached copy.
5. **Held-out extraction started early, then stopped.** To save time the
   held-out half's feature extraction was queued to start right after the
   dev run. No detector output on it was computed or looked at. It was
   stopped once the dev grid had no passing point, since the plan then has
   no confirmation to run.

## Results

Run 2026-10-19 on the dev half (10 women, 10 men; 39 conditions; 3920
streams, 51.6 h of audio). Scripts: `scripts/resonance-narrowband/`
(`build_streams.py`, `cut40.py`, `upsample.mjs` copied from the robustness
study at 99ff7fc; `conditions.py` = its `run_all.py` with the new `btnb`
condition, the split and `extract.mjs`; `detector.mjs` = the pure detector;
`sweep.mjs` = grid, selection, confirmation). Audio and features stay in the
gitignored `build/resonance-narrowband/`.

### Verdict: no detector meets the bar — nothing ships

**None of the 1224 grid points passes both bars on the dev half**, so per
§4 there is no selected point, no held-out confirmation, and §5 does not
happen. The grid was not widened.

Why: the **4 kHz low-pass** positive overlaps the wideband negatives. Its
feature at stream end sits at a median of about −21 dB (best band C), the
same range as wideband streams with a falling spectrum (the −6 dB/oct tilt,
the headset combination, the short room) and one male reader whose clean
recording is already dark above 4.5 kHz. Every threshold that catches ≥ 95 %
of the low-pass streams turns the notice on for well over 1 % of wideband
voiced time, and the clean bar fails too. The paths that really go through an
8 kHz link (telephone band, AMR-NB, G.711, the narrowband-Bluetooth-like
path) are far apart from all wideband streams (stream-end F ≤ −39.6 dB vs
≥ −25.3 dB on dev, band C); Opus 8 kbit/s narrowband sits in between (max
−22.1 dB). Those observations are descriptive only — the pre-registered
positive set includes the 4 kHz low-pass, and changing it would be a new plan.

Closest grid points (worst negative share over every condition and sex /
clean streams with the notice / worst positive detection rate):

- C τ4 V3 H3 T-21: neg 5.1 % (tilt-6|m), clean 3, pos 66.0 % (lp4k|m)
- C τ4 V5 H3 T-21: neg 5.0 % (tilt-6|m), clean 3, pos 66.0 % (lp4k|m)
- C τ4 V5 H3 T-20: neg 6.8 % (headset|f), clean 4, pos 70.0 % (lp4k|m)
- C τ8 V3 H3 T-21: neg 5.1 % (headset|f), clean 1, pos 64.0 % (lp4k|m)
- C τ8 V5 H3 T-21: neg 4.7 % (headset|f), clean 1, pos 64.0 % (lp4k|m)

### Closest point in detail (dev): band C, τ 8 s, V_min 5 s, H 3 dB, T_on −21 dB — FAIL

Worst negative: 4.7 % (headset|f); clean streams with the notice: 1; worst positive detection: 64.0 % (lp4k|m).

Negatives (wideband): notice-on share of voiced time (bar ≤ 1 %), streams with any notice, F at stream end (dB, min / median)

| Condition | women share | women streams on | men share | men streams on | F end women min / med | F end men min / med |
|---|---|---|---|---|---|---|
| agcfast | 0.0 % | 0/50 | 1.2 % | 1/50 | -19.3 / -5.9 | -23.2 / -8.1 |
| agcslow | 0.0 % | 0/50 | 1.2 % | 1/50 | -18.3 / -6.5 | -23.9 / -9.7 |
| amrwb | 0.029 % | 1/50 | 1.5 % | 1/50 | -21.1 / -7.8 | -23.5 / -9.6 |
| babble+10 | 0.0 % | 0/50 | 0.0 % | 0/50 | -12.1 / -2.1 | -17.6 / -3.6 |
| babble+20 | 0.0 % | 0/50 | 1.4 % | 1/50 | -18.3 / -5.0 | -22.5 / -7.4 |
| bt | 0.0 % | 0/50 | 0.0 % | 0/50 | -13.6 / -2.2 | -18.7 / -3.9 |
| clean | 0.0 % | 0/60 | 1.0 % | 1/60 | -19.1 / -6.1 | -23.6 / -8.8 |
| comp | 0.0 % | 0/50 | 0.1 % | 1/50 | -14.4 / -3.5 | -20.7 / -5.7 |
| fan+10 | 0.0 % | 0/50 | 0.7 % | 1/50 | -18.4 / -5.8 | -22.3 / -5.6 |
| fan+20 | 0.0 % | 0/50 | 1.5 % | 1/50 | -19.3 / -5.9 | -21.9 / -6.0 |
| headset | 4.7 % | 6/50 | 4.1 % | 3/50 | -21.1 / -9.1 | -21.0 / -9.8 |
| hp100 | 0.0 % | 0/50 | 1.2 % | 1/50 | -19.6 / -5.9 | -23.2 / -8.4 |
| hp200 | 0.0 % | 0/50 | 1.4 % | 1/50 | -19.9 / -6.2 | -24.1 / -8.6 |
| hp300 | 0.0 % | 0/50 | 1.3 % | 1/50 | -19.8 / -6.3 | -24.7 / -9.3 |
| laptop | 0.0 % | 0/50 | 0.037 % | 1/50 | -8.7 / -1.5 | -21.1 / -3.2 |
| lev+20clip | 0.0 % | 0/50 | 0.0 % | 0/50 | -13.1 / -4.6 | -16.5 / -6.0 |
| lev-10 | 0.0 % | 0/50 | 1.2 % | 1/50 | -19.1 / -6.1 | -23.6 / -8.8 |
| lev-20 | 0.0 % | 0/50 | 1.2 % | 1/50 | -19.1 / -6.1 | -23.6 / -8.8 |
| lp7k | 0.0 % | 0/50 | 1.2 % | 1/50 | -19.4 / -6.2 | -23.6 / -8.4 |
| msbc | 0.0 % | 0/50 | 1.3 % | 1/50 | -19.4 / -5.8 | -23.8 / -8.8 |
| opus12wb | 0.0 % | 0/50 | 1.4 % | 1/50 | -20.8 / -7.1 | -24.3 / -9.7 |
| opus24wb | 0.2 % | 1/50 | 1.9 % | 2/50 | -21.8 / -7.7 | -24.8 / -10.9 |
| phone | 0.0 % | 0/50 | 0.0 % | 0/50 | -16.5 / -2.7 | -18.0 / -6.0 |
| room_l | 0.0 % | 0/50 | 0.0 % | 0/50 | -18.2 / -3.6 | -18.7 / -5.7 |
| room_m | 0.0 % | 0/50 | 1.9 % | 2/50 | -10.4 / -1.0 | -23.6 / -1.7 |
| room_s | 1.1 % | 1/50 | 2.9 % | 3/50 | -19.5 / -7.5 | -23.7 / -7.1 |
| sr44k | 0.0 % | 0/50 | 1.2 % | 1/50 | -19.3 / -6.1 | -23.4 / -8.6 |
| street+10 | 0.0 % | 0/50 | 0.9 % | 1/50 | -17.0 / -5.8 | -21.8 / -9.2 |
| street+20 | 0.0 % | 0/50 | 1.2 % | 1/50 | -18.8 / -6.2 | -23.1 / -9.8 |
| tilt+6 | 0.0 % | 0/50 | 0.0 % | 0/50 | -16.5 / -4.4 | -20.1 / -6.6 |
| tilt-6 | 1.3 % | 3/50 | 3.3 % | 3/50 | -23.3 / -9.8 | -25.3 / -10.7 |
| videocall | 0.0 % | 0/50 | 0.9 % | 1/50 | -8.3 / -0.6 | -19.2 / -1.3 |
| wb | 0.0 % | 0/50 | 1.2 % | 1/50 | -19.6 / -6.0 | -23.2 / -8.4 |

Positives (narrowband): detected by 10 s voiced (bar ≥ 95 %), time to notice (voiced s, median / q90), dropouts after first notice, F at stream end (dB, median / max)

| Condition | women detected | men detected | women time med / q90 | men time med / q90 | women dropouts | men dropouts | F end women med / max | F end men med / max |
|---|---|---|---|---|---|---|---|---|
| amrnb | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -57.6 / -50.7 | -54.4 / -48.3 |
| btnb | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -45.6 / -40.9 | -43.5 / -39.6 |
| g711u | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -54.3 / -49.3 | -51.8 / -46.7 |
| lp4k | 33/50 (66.0 %) | 32/50 (64.0 %) | 5.00 / 9.35 | 5.00 / 9.45 | 4.2 % | 4.6 % | -20.9 / -12.3 | -21.5 / -15.6 |
| opus8nb | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -27.8 / -23.2 | -26.0 / -22.1 |
| tel | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -51.8 / -46.9 | -50.0 / -44.7 |

Positive streams with < 10 s of voiced audio in total: 0.


Detector cost: 4.9 ms CPU per second of audio (band energies incl. the lazy 16 kHz samples it reads; Node, desktop). Pitch frames dropped by the engine: 0.

Re-run: `PY -I scripts/resonance-narrowband/build_streams.py --libri …`, `cut40.py`, `node upsample.mjs`, copy the study's final `rirs.json` into `build/resonance-narrowband/`, then `PY -I scripts/resonance-narrowband/conditions.py --cache <Syrinx-cache/resonance-robustness> --half dev` and `node scripts/resonance-narrowband/sweep.mjs --half=dev` (`--point=C,8,5,3,-21` for the table above).

## Round 2 plan (pre-registered, 2026-10-19)

Committed and pushed before any round 2 result exists. Round 1 above (plan,
deviations, results) is not edited. Deviations found during round 2 go under
"Round 2 deviations" below, dated.

**Why a round 2.** User decision 2026-10-19, after round 1 failed: the
detector targets audio that really went through an 8 kHz phone path. A plain
4 kHz low-pass ("dull mic") overlaps dark wideband audio, so it is no longer
a required positive. For such a mic the notice may stay off and the resonance
reading may read darker (the robustness study's finding); that is a known,
accepted limitation of this round.

**What changes from round 1 (only this):**

- **Positives (judged):** the five phone-path conditions — telephone band
  (`tel`), AMR-NB 7.4 kbit/s (`amrnb`), G.711 µ-law (`g711u`),
  narrowband-Bluetooth-like (`btnb`), Opus 8 kbit/s narrowband (`opus8nb`).
- **4 kHz low-pass (`lp4k`):** reported descriptively (detection rate, time
  to notice, dropouts, F at stream end), not judged and not used in
  selection. It is neither a positive nor a negative.
- In `scripts/resonance-narrowband/sweep.mjs` the judged positive set becomes
  the five conditions above, with `lp4k` printed as a descriptive row; the
  detector, the feature extraction and the grid code are unchanged.

**What stays exactly as in round 1:** the user-facing notice and its text
(§1); the detector and its candidate grid (§2: bands A / B / C, τ 4 / 8,
V_min 3 / 5, H 3 / 6, T_on −60…−10 dB in 1 dB steps; 1224 points; not
widened); the data and the streams (§3, every version k = 0.88–1.12 plus the
clean original); the negatives (every wideband / clean / room / noise / level
/ codec / combination condition in §3); the speaker split (§3 and round 1
deviation 3); the metrics, the bar, the selection rule and its tie-breaks
(§4 and round 1 deviation 3); §5.

**The bar (unchanged):**

- Negatives: notice-on share ≤ 1 % of voiced time for each sex in every
  negative condition, AND the notice never shows on any clean-condition
  stream (all versions and the originals).
- Positives: ≥ 95 % of streams detected for each sex in each of the five
  phone-path conditions, detected = the notice is on by the time 10 s of
  voiced audio has passed (within the first 1000 voiced grid frames).

**Selection and confirmation:**

- Selection on the dev half only, with the round 1 rule. The dev half's
  features are the round 1 extraction, reused as they are (same build, same
  scripts; nothing re-extracted).
- **Honest caveat:** the dev half was already looked at in round 1, including
  per-condition F distributions for the phone paths and the wideband
  negatives, and the decision to drop `lp4k` was made after seeing that it
  overlaps. Selection on dev is therefore not blind, and a dev pass is not
  evidence by itself. **The held-out confirmation is what counts.** Round 1
  dev data also shows that a pass is not assured: with band C, Opus 8 kbit/s
  narrowband reached −22.1 dB at stream end while the darkest wideband
  stream was at −25.3 dB.
- If no grid point passes on dev, the result is "no detector meets the bar",
  nothing ships, and there is no held-out run.
- **Held-out half: one look.** Its features are extracted once (round 1
  started and stopped that extraction; no detector output on it was ever
  computed or looked at — round 1 deviation 5), then the selected point —
  only that point — is run once. Pass = both bars met on the held-out half,
  for each sex, on the five phone-path conditions and every negative. A
  held-out failure is reported as a failure; nothing is re-tuned on the
  held-out half and there is no round 3 on it. `lp4k` on the held-out half is
  reported descriptively at the selected point.

**After the result:** as §5 — only on a held-out pass does the detector go
into the resonance worker, with the row state, the notice and a bit-exact
parity test against `scripts/resonance-narrowband/`.

## Round 2 deviations

Recorded 2026-10-19, during the run.

1. **Order.** The round 2 plan (c1d3c1f) and the `sweep.mjs` change (50442a0:
   judged positives = the five phone paths, `lp4k` descriptive, output files
   renamed `sweep-r2-*`) were both committed and pushed before any round 2
   detector output was computed.
2. **Leftover held-out features deleted unread.** The stopped round 1
   held-out extraction (round 1 deviation 5) had written `clean` features for
   5 held-out readers into `build/resonance-narrowband/feat/clean/`. They were
   deleted without being opened, so that the held-out half could be extracted
   once under this plan. Because dev failed (below), no held-out features were
   extracted and no held-out detector output exists.
3. **Closest point shown in detail** = the first point of the closest-points
   list (same practice as round 1); descriptive only.

## Round 2 results

Run 2026-10-19 on the dev half with the round 1 features as they were (10
women, 10 men; 33 negative conditions, 5 judged positives, `lp4k`
descriptive; 3920 streams, 51.6 h of audio). `node
scripts/resonance-narrowband/sweep.mjs --half=dev`, then `--point=C,4,5,3,-24`
for the table below.

### Verdict: no detector meets the bar — nothing ships

**None of the 1224 grid points passes both bars on the dev half.** Per the
round 2 plan there is no selected point, no held-out run, and §5 does not
happen. The grid was not widened; there is no round 3.

Why: with `lp4k` out, the binding pair is **Opus 8 kbit/s narrowband (men)**
against **dark wideband streams** — chiefly one male stream that turns the notice
on in most negative conditions, clean included (round 1 traced this to a
reader whose recording is dark above 4.5 kHz), plus the −6 dB/oct tilt and
the headset combination. Of the 1224 points, 692 pass the negative bar; the
best of those detects only 78 % of the
male Opus 8k streams (C τ4 V3 T−26). 304 points pass the positive bar; the
best of those still puts the notice on for 1.8 % of male voiced time under the
−6 dB/oct tilt and on one clean stream (C τ8 V5 H3 T−23). The four true 8 kHz
links (telephone band, AMR-NB, G.711, narrowband-Bluetooth-like) separate
cleanly from every wideband stream (stream-end F ≤ −39.7 dB vs ≥ −25.4 dB);
Opus 8k does not (max −22.1 dB).

Closest grid points (worst negative share / clean streams with the notice /
worst positive detection):

- C τ4 V5 H3 T−24: neg 1.8 % (tilt-6|m), clean 1, pos 94.0 % (opus8nb|m)
- C τ8 V5 H3 T−24: neg 1.8 % (tilt-6|m), clean 1, pos 92.0 % (opus8nb|m)
- C τ8 V5 H3 T−23: neg 1.8 % (tilt-6|m), clean 1, pos 98.0 % (opus8nb|m)
- C τ4 V3 H3 T−24: neg 2.0 % (tilt-6|m), clean 1, pos 96.0 % (opus8nb|m)
- C τ8 V3 H3 T−23: neg 2.0 % (tilt-6|m), clean 1, pos 100.0 % (amrnb|m)

(H 3 and H 6 give the same numbers at each of these points.)

### Closest point in detail (dev): band C, τ 4 s, V_min 5 s, H 3 dB, T_on −24 dB — FAIL

Worst negative: 1.8 % (tilt-6|m); clean streams with the notice: 1; worst positive detection: 94.0 % (opus8nb|m).

Negatives (wideband): notice-on share of voiced time (bar ≤ 1 %), streams with any notice, F at stream end (dB, min / median)

| Condition | women share | women streams on | men share | men streams on | F end women min / med | F end men min / med |
|---|---|---|---|---|---|---|
| agcfast | 0.0 % | 0/50 | 0.5 % | 1/50 | -22.0 / -5.5 | -23.3 / -7.2 |
| agcslow | 0.0 % | 0/50 | 1.0 % | 1/50 | -21.5 / -6.2 | -23.8 / -9.0 |
| amrwb | 0.0 % | 0/50 | 1.1 % | 1/50 | -22.9 / -7.0 | -23.6 / -8.7 |
| babble+10 | 0.0 % | 0/50 | 0.0 % | 0/50 | -12.0 / -2.4 | -17.6 / -2.8 |
| babble+20 | 0.0 % | 0/50 | 0.8 % | 1/50 | -20.0 / -4.6 | -21.8 / -6.0 |
| bt | 0.0 % | 0/50 | 0.0 % | 0/50 | -14.5 / -2.1 | -18.7 / -3.5 |
| clean | 0.0 % | 0/60 | 0.7 % | 1/60 | -22.1 / -5.7 | -23.5 / -7.8 |
| comp | 0.0 % | 0/50 | 0.0 % | 0/50 | -17.3 / -3.5 | -20.8 / -5.1 |
| fan+10 | 0.0 % | 0/50 | 0.5 % | 1/50 | -21.4 / -5.7 | -21.9 / -5.8 |
| fan+20 | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.2 / -5.6 | -21.3 / -4.6 |
| headset | 1.3 % | 4/50 | 0.4 % | 1/50 | -22.7 / -8.6 | -20.5 / -9.4 |
| hp100 | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.5 / -5.7 | -23.2 / -7.6 |
| hp200 | 0.0 % | 0/50 | 1.0 % | 1/50 | -22.5 / -6.4 | -24.7 / -8.3 |
| hp300 | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.2 / -6.2 | -25.1 / -8.6 |
| laptop | 0.0 % | 0/50 | 0.0 % | 0/50 | -10.2 / -1.4 | -21.5 / -3.2 |
| lev+20clip | 0.0 % | 0/50 | 0.0 % | 0/50 | -14.6 / -4.5 | -17.0 / -5.1 |
| lev-10 | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.1 / -5.7 | -23.5 / -7.8 |
| lev-20 | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.1 / -5.7 | -23.5 / -7.8 |
| lp7k | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.2 / -5.6 | -23.5 / -7.8 |
| msbc | 0.0 % | 0/50 | 1.0 % | 1/50 | -21.6 / -6.0 | -24.0 / -7.8 |
| opus12wb | 0.0 % | 0/50 | 1.4 % | 1/50 | -23.4 / -6.7 | -24.4 / -9.5 |
| opus24wb | 0.2 % | 1/50 | 1.4 % | 1/50 | -24.4 / -7.2 | -24.6 / -9.5 |
| phone | 0.0 % | 0/50 | 0.0 % | 0/50 | -20.3 / -2.5 | -18.3 / -6.1 |
| room_l | 0.0 % | 0/50 | 0.0 % | 0/50 | -22.1 / -3.5 | -19.5 / -4.9 |
| room_m | 0.0 % | 0/50 | 0.8 % | 1/50 | -13.7 / -0.3 | -23.9 / -1.8 |
| room_s | 0.4 % | 1/50 | 0.7 % | 1/50 | -22.1 / -7.6 | -24.1 / -6.9 |
| sr44k | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.1 / -5.6 | -23.4 / -7.8 |
| street+10 | 0.0 % | 0/50 | 0.5 % | 1/50 | -20.8 / -5.5 | -21.2 / -8.4 |
| street+20 | 0.0 % | 0/50 | 0.8 % | 1/50 | -21.7 / -5.7 | -22.6 / -8.9 |
| tilt+6 | 0.0 % | 0/50 | 0.0 % | 0/50 | -18.7 / -4.1 | -20.4 / -6.6 |
| tilt-6 | 0.3 % | 1/50 | 1.8 % | 1/50 | -25.4 / -9.6 | -24.9 / -9.6 |
| videocall | 0.0 % | 0/50 | 0.0 % | 0/50 | -9.6 / 0.1 | -18.4 / -1.2 |
| wb | 0.0 % | 0/50 | 0.9 % | 1/50 | -22.5 / -5.6 | -23.2 / -7.6 |

Positives (the five phone paths, judged): detected by 10 s voiced (bar ≥ 95 %), time to notice (voiced s, median / q90), dropouts after first notice, F at stream end (dB, median / max)

| Condition | women detected | men detected | women time med / q90 | men time med / q90 | women dropouts | men dropouts | F end women med / max | F end men med / max |
|---|---|---|---|---|---|---|---|---|
| amrnb | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -57.5 / -49.7 | -53.8 / -46.7 |
| btnb | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -45.5 / -40.8 | -43.4 / -39.7 |
| g711u | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -54.2 / -48.5 | -52.0 / -46.9 |
| opus8nb | 50/50 (100.0 %) | 47/50 (94.0 %) | 5.00 / 5.00 | 5.00 / 6.27 | 0.0 % | 1.1 % | -28.0 / -22.4 | -25.8 / -22.1 |
| tel | 50/50 (100.0 %) | 50/50 (100.0 %) | 5.00 / 5.00 | 5.00 / 5.00 | 0.0 % | 0.0 % | -51.5 / -45.9 | -49.5 / -44.9 |
| lp4k (descriptive, not judged) | 27/50 (54.0 %) | 25/50 (50.0 %) | 5.00 / 8.91 | 5.34 / 17.63 | 21.2 % | 11.1 % | -20.5 / -10.5 | -20.3 / -14.0 |

Positive streams with < 10 s of voiced audio in total: 0.

The 4 kHz low-pass row is descriptive: at this point about half of the
low-passed streams get the notice, often late and with dropouts — the
expected overlap with dark wideband audio.

Held-out half: not run (dev failed). Detector cost: 4.9 ms CPU per second of
audio (as round 1). Pitch frames dropped by the engine: 0.

## Round 3 plan (pre-registered, 2026-10-19)

Committed and pushed before any round 3 result exists: no edge-sharpness value
has been computed on any stream before this commit. Rounds 1 and 2 above are
not edited. Deviations found during round 3 go under "Round 3 deviations"
below, dated.

**Why a round 3.** User decision 2026-10-19, after round 2 failed (round 2
said "there is no round 3"; the user decided to try one more detector of a
different kind). Rounds 1 and 2 used a band-energy ratio. It separates the
four true 8 kHz links from every wideband stream, but Opus 8 kbit/s
narrowband overlaps dark wideband audio (the −6 dB/oct tilt, the headset
combination, one male reader whose clean recording is dark above 4.5 kHz),
because an energy ratio cannot tell a sharp codec cut-off from a gradual
roll-off. Round 3 measures **edge sharpness** instead: how much more steeply
the long-term voiced spectrum falls across ~3.3–4.75 kHz than it falls just
below, where a dark but wideband voice keeps roughly its own slope.

### R3.1 Detector

Same input as rounds 1–2: on every voiced 10 ms grid frame, the 512-sample
periodic-Hann window of the resonance engine's 16 kHz ring ending at the
frame (round 1 deviation 3), 512-point power spectrum, bin width 31.25 Hz.

- **Sub-bands:** 32 sub-bands of 125 Hz, sub-band j = bins 48 + 4j …
  51 + 4j (j = 0…31, 1500–5500 Hz), centre c_j = 1.5625 + 0.125 j kHz.
  Each sub-band's power is the sum of its 4 bins.
- **Long-term spectrum:** an exponential average of each sub-band's power
  over voiced frames only, the same rule and constant for every sub-band as
  in rounds 1–2 (E ← E + a (e − E), a = 1 − exp(−0.01 / τ), E starts at 0;
  unvoiced time does not age it; the start-up factor is common to all
  sub-bands, so it cancels in every difference below).
  L_j = 10·log10(E_j + 1e-30) dB.
- **Base slope s** (dB/kHz): least-squares line of L_j against c_j over
  j = 0…13 (1.5–3.25 kHz).
- **Feature E1, drop beyond the extrapolated slope** (dB):
  U = mean of L_j, j = 14…17 (3.25–3.75 kHz, mean centre 3.5 kHz);
  V = mean of L_j, j = 21…25 (4.125–4.75 kHz, mean centre 4.4375 kHz);
  E1 = (V − U) − 0.9375·s.
- **Feature E2, steepest local fall beyond the slope** (dB per 500 Hz):
  D_j = L_{j+2} − L_{j−2} (a centred difference over 500 Hz, which is the
  smoothing) for j = 14…23 (centres 3.3125–4.4375 kHz); E2 = min_j D_j − 0.5·s.
- Both are ≈ 0 for a spectrum that keeps its own slope, whatever that slope
  is, and strongly negative for a sharp cut-off near 4 kHz. **Decision** as in
  rounds 1–2, with E in place of F: undecided until V_min seconds of voiced
  frames; then on when E < T_on, off when E > T_on + H.

**Candidate grid (fixed now, 656 points):**

| Parameter | Candidates |
|---|---|
| Feature | E1, E2 |
| τ (voiced s) | 4, 8 |
| V_min (voiced s) | 3, 5 |
| H (dB) | 3, 6 |
| T_on (dB) | −40 to 0 in 1 dB steps |

Not widened during round 3 without a dated deviation; a widened grid would
not count for this round.

### R3.2 Positives, negatives, data, split (as round 2)

- **Positives (judged):** the five phone-path conditions of round 2 —
  `tel`, `amrnb`, `g711u`, `btnb`, `opus8nb`.
- **4 kHz low-pass (`lp4k`):** descriptive only, as in round 2 (neither a
  positive nor a negative, not used in selection).
- **Negatives:** every wideband / clean / room / noise / level / codec /
  combination condition of round 1 §3, unchanged.
- **Data and split:** the same streams (every version k = 0.88–1.12 plus the
  clean original, the same cached build) and the same dev / held-out speaker
  split (round 1 §3 and deviation 3).

### R3.3 Bar (unchanged)

- Negatives: notice-on share ≤ 1 % of voiced time for each sex in every
  negative condition, AND the notice never shows on any clean-condition
  stream (all versions and the originals).
- Positives: ≥ 95 % of streams detected for each sex in each of the five
  phone-path conditions; detected = the notice is on within the first 1000
  voiced grid frames (10 s of voiced audio).

### R3.4 Harness

The round 1–2 features hold only the four band energies, so the dev half is
re-extracted once with the same harness (real pitch worker, real lab engine,
same voiced grid frames) writing the 32 sub-band powers per voiced frame; the
band-energy code paths of `detector.mjs`, `extract.mjs` and `sweep.mjs` stay
as they are, and the round 3 detector and sweep are added beside them. Check
before any detector output is computed: the re-extraction's voiced grid
frames per stream equal round 1's exactly (not an accuracy measure — it only
confirms the same frames are analysed). Reported, not judged: time to notice,
dropouts, per-condition E at stream end, CPU per second of audio.

### R3.5 Selection and confirmation

- **Selection on the dev half only**, with the round 1 rule (§4): among
  points passing both bars on dev, the lowest worst negative notice-on share,
  then the largest worst-sex positive detection rate, then larger H, then
  shorter V_min, then T_on at the middle of the passing T_on run. Tie-breaks
  after V_min as round 1 deviation 3, with "band" read as "feature": the
  (feature, τ) with the longest run of tied T_on values, then shorter τ, then
  E1 before E2; T_on = lower middle of the run.
- **Honest caveat: the dev half has now been looked at twice** (rounds 1 and
  2), including its per-condition band-energy distributions, which streams
  bind (male Opus 8k, the −6 dB/oct tilt, the headset combination, one dark
  male reader), and the fact that the codec paths cut sharply while those
  negatives roll off gradually. The edge-sharpness idea was chosen after
  seeing that. Selection on dev is therefore not blind and **a dev pass is
  not evidence. Only the held-out confirmation counts.**
- If no grid point passes on dev: "no detector meets the bar", nothing ships,
  no held-out run.
- **Held-out half: one look.** No feature or detector output on it has been
  computed or looked at in any round (round 1 deviation 5, round 2 deviation
  2). On a dev pass its features are extracted once and only the selected
  point is run, once. Pass = both bars met on the held-out half for each sex,
  on the five phone paths and every negative. A held-out failure is reported
  as a failure; nothing is re-tuned on it, and the held-out half is not used
  for any later round. `lp4k` on the held-out half is reported descriptively
  at the selected point.

### R3.6 After the result

As §5: only on a held-out pass does the detector go into the resonance
worker, with the row state, the notice (§1, text unchanged) and a bit-exact
parity test against `scripts/resonance-narrowband/`, plus the usual lint /
unit / build / cue-strip smoke runs. Pitch stays untouched either way.
