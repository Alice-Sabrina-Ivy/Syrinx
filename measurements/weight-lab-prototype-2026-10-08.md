# Weight × clarity lab prototype (Resonance lab tab only) — 2026-10-08

Written 2026-10-11, before any prototype code (hard rule 3). The plan and the acceptance checks in §1–§6
are fixed here first; the results are added in §7 after the code exists. The date in the filename
is the date of the user decision this note implements (2026-10-08, decision 2).

## 0. What this is, and what it is not

- **What it is:** an *experimental* research view inside the Resonance lab tab. It shows a 2-D dot:
  - x = how "light ↔ heavy" the voice's harmonic balance sounds **compared with the user's own usual
    voice at the same pitch and loudness**;
  - y = how "breathy ↔ clear" it is, compared the same way.
- **What it is not:** a measurement of vocal-fold weight, thickness or contact. Every detector the
  sceptic checks examined reads mainly loudness (effort). None tracks EGG contact at fixed pitch and
  loudness in both sexes (§2). The view says this in its header and info panel.
- **Where it runs:**
  - only in the Resonance lab tab, never on the Dashboard or the cue strip, and never in coaching,
    zones, targets or session stats;
  - it starts only when the user opens the lab tab **and** then switches to the "Weight × clarity"
    view. Users who never open the tab fetch and run nothing. Lab users who never open the view do not
    fetch its model and do not run its analysis.
- **Colours and direction:** neutral colours, no zones and no targets for any training direction.
  The axes are symmetric: "lighter" and "heavier" carry no value judgement.

## 1. Decision trail

- **2026-10-08, user decision 2:** build an experimental weight × clarity view in the Resonance lab
  tab only. Use the best candidates, after the remaining sceptic checks: loudness at fixed contact,
  vowels, resonance direction, women's voices, phone microphones.
- **2026-10-11, sceptic checks** (scratch research under a sha256-pinned pre-registration). Data: AVID
  (CC BY 4.0, 50 speakers, speech + EGG at four loudness levels; sex-balanced 12 F + 12 M test
  split), Hillenbrand vowels, formant-shifted public speech, and the VVD/DSFD teacher demos
  (evaluation only).
  - **Pre-registered rule pick:** NAQ+ClQ with voice-map cells (C1a) and the resonance gate (C3b).
    It passes 2 of 6 criteria. The tie-break among four 2-of-6 detectors is within noise, and it
    depends on how one criterion (P6) is read.
  - **Sceptic's recommendation (judgement):** learned v5 with C1a cells and the C3b gate, on a device
    with gain control confirmed off. Reasons:
    - NAQ+ClQ breaks under a 120 Hz roll-off in men (+5.4 steps per octave; clean-vs-phone r 0.56);
    - two NAQ+ClQ constants were fitted on PTDB-TUG (ODbL);
    - v5 is licence-clean and has the only contact signal whose CI excludes zero (women only);
      **Correction (2026-10-11 review, §8):** not the only one — the plain level meter's CI also
      excludes zero in women (+0.11 [+0.08, +0.15]; its best package +0.12 [+0.08, +0.16]), so v5's
      women contact signal (+0.13 [+0.07, +0.19]) cannot be told apart from loudness;
    - v5's device leak is 6× smaller and v5 brings its own clarity head.
- **This prototype follows the recommendation (v5).** The rule's pick would need its PTDB-fitted
  constants refitted before it could ship in any form.

## 2. Sceptic numbers, per sex (AVID test speakers; women / men)

Unit: one *weight step* = the detector's median change on the teachers' weight-only pairs (VVD+DSFD).

**(i) Loudness at fixed contact (AVID clean)**

| detector | partial r(W, CQ given F0, level) | steps per +10 dB at fixed CQ, F0 | 1-s needle noise (steps) |
|---|---|---|---|
| **v5** | **+0.13 [+0.07, +0.19]** / −0.04 [−0.14, +0.06] | +1.83 / +1.72 | 1.05 / 0.94 |
| NAQ | −0.07 / −0.13 [−0.20, −0.04] | +1.05 / +1.57 | 0.74 / 0.73 |
| NAQ+ClQ | +0.07 / +0.02 | +1.43 / +1.70 | 0.82 / 0.86 |
| H1\*−H2\* | −0.04 / −0.02 | +1.07 / +2.56 | 1.56 / 1.29 |
| voice map | −0.05 / −0.05 | +2.20 / +3.23 | 1.46 / 1.28 |
| plain level meter | +0.11 / +0.04 | +3.94 / +3.88 | 1.73 / 1.90 |

- Truth: contact itself rises with loudness, by +0.046 / +0.033 CQ per 10 dB.
- Pitch + loudness explain 62 % / 40 % of the contact variance. What is left is small (SD ≈ 0.03).

**(ii) Vowels (Hillenbrand, median within-speaker range across 12 vowels, steps)**

| v5 | NAQ | H1\*−H2\* | voice map |
|---|---|---|---|
| 7.97 / 7.34 | 5.34 / 6.69 | 19.13 / 5.20 | 11.85 / 4.31 |

- Every detector fails the pre-registered bound (≤ 2 steps).
- In running speech, the vowel mix becomes part of the 1-s needle noise.

**(iii) Resonance direction**

- **LPC formant shift** (steps per +10 % formant scale): v5 +0.00 / −0.18; NAQ +0.27 / +0.11;
  H1\*−H2\* −0.19 / +0.06; voice map +0.22 / +0.18.
- **WORLD resynthesis disagrees** for H1\*−H2\* and the voice map (+0.5 to +0.7).
- **Teachers' resonance-only pairs read heavier** (ideal 50 %): v5 75 %, H1\*−H2\* 55 %, others
  74–79 %.
- **The C3b gate** (no reading when the lab's VTLN reading moves > 0.05 ln from the user's median)
  blanks 74–98 % of shifted utterances. It also keeps only 33 of 157 teacher weight pairs.

**(iv) Women vs men**

- The only CI-positive contact signal at fixed loudness is v5 in women. Men show none for any
  detector.
- **Correction (2026-10-11 review, §8):** the plain level meter is CI-positive in women too
  (+0.11 [+0.08, +0.15] vs v5 +0.13 [+0.07, +0.19]); v5 does not follow contact better than a
  loudness meter. Men: v5 −0.04, level meter +0.04.
- The loudness slope is larger in men for every spectral detector.
- The read-speech bench said the opposite (men carried the signal). Neither data set gives a
  both-sex contact signal at fixed loudness.

**(v) Phone-style low-frequency loss** (device-induced pitch leak, steps per octave)

| detector | 120 Hz high-pass | phone (hp120 + presence + AGC + noise) | 200 Hz high-pass |
|---|---|---|---|
| v5 | −0.18 / −0.85 | +0.07 / −0.79 | −0.95 / −2.01 |
| NAQ | +0.86 / +1.67 | +0.95 / +1.78 | +1.30 / +1.17 |
| NAQ+ClQ | +1.87 / +5.41 | +2.05 / +5.42 | +3.55 / +3.05 |
| H1\*−H2\* | −0.45 / −1.89 | −0.46 / −1.73 | −2.20 / −5.16 |

**Compensations**

- **C1a voice-map cells** (2 st × 4 dB, per user) cut the clean-audio loudness slope by 75–100 %.
  v5: +1.75 / +1.85 → +0.38 / +0.43 steps per 10 dB. They create no contact signal.
- **Under automatic gain control the cells remove nothing:** 1–3 steps per 10 dB remain, because
  the level axis is the compressed level.
- **Blind device correction failed.** It fired on 7 of 12 clean women and on 0 of 12 men under a
  120 Hz high-pass.
- **Removing pitch and loudness** with population slopes drops the teachers' weight-pair accuracy
  from 81–95 % to 50–68 % (v5 0.55).

**Can claim** (public data only):

- within one session, on one microphone with gain control off, and only between moments at the same
  pitch (2-st band) and loudness (4-dB band), the reading shows whether the voice's harmonic balance
  is above or below the user's usual there;
- v5 is nearly neutral to LPC formant shifts;
- v5's weight head is close to breathiness-neutral (PVQD ρ −0.08).

**Cannot claim:**

- contact or "weight" as such;
- absolute or population-referenced positions;
- anything across devices or sessions;
- anything on devices with automatic gain control;
- readings on held vowels or single words;
- independence from resonance;
- gender symmetry (the contact signal is women-only);
- children, singing, falsetto.

## 3. Licences of every shipped constant

**The v5 model** (`public/resonance-lab/weight_v5.json`: 753 weights in a 45-input tanh MLP with
16 hidden units, plus a 6-weight linear clarity head on 5 inputs, plus per-input standardisation):

- **Training data, train split only, `use_ptdb = False`:**
  - synthetic LF-source stimuli generated in the research bench (674);
  - CMU ARCTIC bdl + slt speech + EGG: "free for use for any purpose (commercial or otherwise)".
    The CMU notice is kept in the model file and in §8;
  - VocalSet, CC BY 4.0, 11 training singers;
  - PVQD, CC BY 4.0, 70 training recordings (clarity head and the pairwise task).
  - The bench manifest marks every one of these `ship_train_ok`.
- **Never trained on:** PTDB-TUG (ODbL; excluded by `use_ptdb = False`), CSTR FDA, VVD, DSFD,
  Traser, AVID. Variant selection used 3-fold speaker-grouped CV on the train split.
  - The weight head's per-input standardisation (median / IQR) was computed on the same training
    frames.
  - The clarity head was fitted on synthetic aspiration plus PVQD-train breathiness ratings.
- **The mel filterbank** (16 Slaney-mel bands, 80–7000 Hz) is computed from its formula, not
  fitted.

**Constants the spec names that are NOT shipped:**

- **0.268 (v5's teacher weight step)** is the median change on the VVD/DSFD teacher demos, which have
  no licence. A display scale estimated from them is a fitted constant, so the prototype does not
  ship it. Instead, both axes are shown in units of **the user's own 1-s variation**: the pooled
  within-cell SD of the calibration bins. This needs no data at all.
  - The sceptic's 1-s needle noise for v5 was 1.05 / 0.94 teacher steps, so one own-SD unit is about
    one teacher step for a typical voice.
  - Expected display noise after the 3-bin median: ≈ 0.6 units.
  - The ±1 band therefore means what the spec intends: "changes smaller than this are noise".
  - **Correction (2026-10-11 review, §8):** measured, the 3-bin display noise is ≈ 0.77 units per
    axis on AVID, and the ±1 box is left by chance by ~37 % of displayed readings (either axis). The
    box is widened to ±2 units (§8).
- **No constant is fitted on AVID.** The voice map is per user. AVID results are cited in §2 under
  CC BY 4.0: M. Kodali, P. Alku, S. R. Kadiri, *AVID: Aalto Vocal Intensity Database*, Zenodo,
  doi:10.5281/zenodo.10524873, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).

## 4. The prototype as specified (and where it deviates)

**Inputs**

- The lab engine's 16 kHz analysis stream: the anti-aliased sinc ring the four finalists read.
- The posted production pitch frames: the lab's internal pitch replica, bit-identical to the pitch
  worker's posted decisions (25 ms; voiced frames only).
- Per voiced frame:
  - a 50 ms Hann frame centred on the frame time;
  - the v5 features: an exact port of the research `feats.py` frame path, with a 4096-point FFT,
    order-16 Burg LPC poles and the Iseli–Alwan correction, CPP and the harmonic-to-interharmonic
    ratios, and 16 log-mel bands;
  - weight w and clarity c from the frozen model;
  - frame level L = 10·log10(mean square) in dBFS.
- The lab's VTLN reading (ln α, 150 ms bins).
- `track.getSettings()`: `autoGainControl` and `deviceId`.

**Aggregation**

- 1-s bins (absolute, on the frame time) of posted frames.
- A bin is valid with ≥ 3 voiced frames that gave features and a voiced fraction ≥ 0.3.
- Per bin: mean w, mean c, mean log2 F0, power-mean level, median VTLN.
- A bin is closed 1.5 s after its end, so the VTLN bins for it have arrived.

**Voice map** (C1a, per page visit and per microphone)

- Cells are 2 st × 4 dB: `(floor(12·F/2), floor(Lb/4))`.
- A guided "map your voice" step has five prompts: usual voice, softer, louder, a little higher, a
  little lower. Each prompt runs until 30 valid running-speech bins (≈ 35–40 s of speaking), or until
  the user taps Next. That is about 3 minutes in all.
- A cell is ready at ≥ 5 bins. After the last prompt the map is **frozen** (no sliding window).
- The frozen map is kept in the page for the rest of the visit, with the deviceId it was made on, so
  stopping and restarting listening on the same microphone does not need a new map.

**Reading**

- Per bin: `Rw = (w − cell mean w) / sdW` and `Rc = (c − cell mean c) / sdC`. sdW and sdC are the
  pooled within-cell SDs of the ready cells (deviation from 0.268, §3).
- The display shows the median of the last 3 readable bins inside the last 5 s.
- **No reading** ("—" plus a reason) when:
  1. the cell is not ready;
  2. the bin's VTLN is more than 0.05 ln from the cell's median, or is missing ("resonance changed:
     comparison paused");
  3. `autoGainControl` is true or unknown. Mapping is also blocked then;
  4. the deviceId differs from the map's;
  5. fewer than 3 of the last 5 bins are running speech.

**"Running speech" (operationalised; the spec gives no rule):**

- A running-speech bin is a valid bin with voicing breaks: voiced fraction ≤ 0.95, i.e. at least 2
  unvoiced 25 ms frames in the second.
- Sentences have many breaks. A held vowel has none, so a held vowel reads "speak in sentences".
- Calibration bins must also pass the 3-of-5 rule.

**Display**

- A square with the dot, a 10-s fading trail and a neutral ±1 band ("changes smaller than this are
  noise").
- Beside it:
  - the current cell (≈ Hz, dBFS) and its readiness;
  - a live loudness number;
  - the map's cell grid (pitch × loudness, ready cells marked).
- Header: "Experimental — not a measurement of vocal-fold weight or contact".
- The caveats (loudness, pitch, one microphone and one session, vowels, resonance, agreement with
  teachers, women vs men, the clarity head's unmeasured leaks) are listed visibly under the dot.

## 5. Acceptance checks (fixed before the code)

1. **Port parity.** The JS frame path is compared with the Python reference (`feats.py`
   `frame_feats` + the frozen-model forward pass, committed as
   `scripts/resonance-lab/weight/v5_ref.py`). Material: the three committed LibriSpeech fixtures
   (CC BY 4.0) at the reference's Praat AC frames.
   - Bounds: |Δw| and |Δc| ≤ 1e-3 head units on ≥ 99 % of frames, and ≤ 0.01 on all. For scale, the
     weight step is 0.268.
   - Every non-formant feature within 1e-6 dB.
2. **Map and gate logic.** Unit tests on synthetic bin streams:
   - cell indices, ≥ 5-bin readiness, freeze, pooled SDs, the 3-bin median;
   - each of the five no-reading reasons, map restore by deviceId, and calibration prompts.
3. **Engine glue.**
   - With the weight analysis off, the engine's outputs are bit-identical to before
     (`test:resonance-lab` unchanged).
   - With it on, bins appear at 1-s spacing from the internal pitch path.
4. **Isolation** (`scripts/resonance-lab/lab-smoke.mjs`, extended):
   - the existing four runs still pass;
   - a new run opens the weight view, maps (prompts skipped with Next) and checks that the view
     renders without page errors and that `weight_v5.json` is fetched only then;
   - in the tab-opened run (weight view never opened), `weight_v5.json` is never requested.
5. **CPU** (desktop; mobile not measured):
   - lab ms per s of audio with the weight view off and on, in Node (the engine over a fixed 48 kHz
     speech file) and in the built app (the lab's own cost line, no `?diag=1`);
   - budget: the weight analysis adds ≤ 15 ms CPU per s of audio.
6. **Layout.** At 448×890, 402×750, 360×690, 890×360 and 1280×800 the weight view shows no
   horizontal page overflow. The resonance view's phone fit (402×750) is unchanged.
7. **Repo gates:** `npm run lint`, `npm run test:unit`, `npm run test:resonance-lab`,
   `npm run build`.

## 6. Before any wider use (not done here)

- Mobile CPU.
- The C3b gate's false-pause rate on ordinary running speech.
- The clarity head against the clarity study's B1–B7 bar. The 2026-10-11 clarity study failed every
  candidate on vowel range and phone rank; the v5 clarity head was not among those candidates.
- Listener labels of same-pitch, same-loudness light/heavy pairs by the user and a second listener.

## 7. Results (2026-10-11, after the code)

All checks ran on `weight-lab` (branched from `origin/cue-strip` 53704cc), desktop Windows, Node 24 and
headless Chrome. The machine was shared with other jobs throughout, so CPU figures are noisy.

**1. Port parity: pass.** `tests/resonance-lab/weight-test.js` compared 104 reference frames across the
three LibriSpeech fixtures.

| quantity | bound | max difference |
|---|---|---|
| weight w | ≤ 1e-3 on 99 %, ≤ 0.01 on all | 3.2e-13 |
| clarity c | ≤ 1e-3 on 99 %, ≤ 0.01 on all | 1.7e-13 |
| non-formant features | ≤ 1e-6 dB | 6.7e-12 dB |
| formant poles | ≤ 1e-4 Hz | 6.4e-11 Hz |

The port is exact to rounding: the same Burg recursion, polynomial roots via Aberth–Ehrlich plus Newton
polishing, float32 mel weights and half-to-even rounding.

**2. Map and gate logic: pass.** The unit tests cover:

- cell indices, the ≥ 5-bin readiness rule, prompt auto-advance, freezing, and the pooled-SD units;
- the 3-bin median and the 10-s trail;
- each no-reading reason: gain control, microphone, not mapped, held vowel, unmapped cell, resonance
  gate;
- restoring a map, and refusing a map when there is too little speech.

**3. Engine glue: pass.**

- With a tap attached, the engine's vtln readout is bit-identical to running without one.
- `test:resonance-lab` (89 checks, including the production vtln parity test) is unchanged.
- The tap produces 1-s bins from the internal pitch path: 15 bins over 15 s of fixture audio.

**4. Isolation: pass.** `scripts/resonance-lab/lab-smoke.mjs` passes all five runs on the built app.

- **Fix to run 1:** the isolation check failed on `origin/cue-strip` before this branch. Since
  2026-10-07, the Dashboard's resonance cue loads three of the lab's assets (`reference.json`,
  `cue-bands.json`, `vtln_warp.json`). The check now ignores exactly those three; every other lab chunk
  and asset still counts.
- **Weight model on demand:** `weight_v5.json` was requested 0 times in runs 1–4 (including the lab
  opened while listening and before listening) and only after the weight view was opened in run 5.
- **Run 5, the weight view:**
  - gain control was reported off, so mapping was allowed;
  - mapping used five prompts of 20 s each on a looped LibriSpeech speech file (woman + man, CC BY 4.0)
    and produced a map of 5–7 cells;
  - over the ~145 one-second bins of the run, 124–126 were valid. After mapping, the readings and pauses
    were:

    | outcome | bins |
    |---|---|
    | readable | 5–13 |
    | unmapped cell | 21–28 |
    | waiting for voiced speech | 6–7 |
    | held vowel / single words | 2–4 |
    | resonance gate | 1–4 |

  - With a 100-s mapping on a clip whose pitch and level vary, most bins fall into cells the map never
    filled. A real user maps for ~3 minutes with deliberate softer / louder / higher / lower prompts. The
    resonance gate paused 1–4 bins of ordinary read speech here. That is not a measured false-pause rate
    (§6).
  - No page errors.

**5. CPU** (desktop; mobile not measured).

**Node** (`scripts/resonance-lab/weight/cpu.mjs`, 74.7 s of 48 kHz speech, le + vtln + fv finalists,
5 interleaved repetitions, medians):

| | lab DSP, ms CPU per s of audio |
|---|---|
| weight view never opened | 74.1 |
| weight analysis on (mapping) | 86.5 |
| difference | **+12.4** |

- The analysis's own counter reads 16.7–18.3 ms per s across runs. That breaks down as ≈ 11 ms of
  features (24 voiced frames per s × ≈ 0.45 ms) plus 3–5 ms of 48 → 16 kHz sinc filtering for samples
  only the weight frames read, plus timer overhead.
- Against the pre-stated budget (≤ 15 ms CPU per s added), the lab-total difference passes. The
  analysis's own counter is 2–3 ms over.
- Isolated per-frame cost (no engine, fixture frames): 0.31–0.35 ms.

**Built app** (lab "DSP" cost line, no `?diag=1`, headless Chrome, same file):

| smoke run | weight view never opened | weight on | model inference |
|---|---|---|---|
| a | 50 | 54 | 46 ms in both |
| b | 85 | 90 | 94 / 90 ms (machine loaded) |
| c | 50 | 75 | 45 / 88 ms (load doubled the inference time as well) |

The runs where inference time was steady put the added cost at ≈ 4–5 ms per s. The browser comparison
is too noisy to support more than "of the order of the Node figure or below".

**6. Layout: pass.**

- At 448×890, 402×750, 360×690, 890×360 and 1280×800 the weight view has no horizontal page overflow,
  and the plot lies inside the viewport.
- Phones and short screens scroll the view (the caveats sit below the plot); 1280×800 shows the plot
  and readouts side by side.
- The resonance view's phone fit is unchanged: all four cards sit above Stop Listening at 402×750, with
  no scrolling.

**7. Repo gates.** `npm run lint`, `npm run test:unit` (40/40 scripts, including the new
`weight-test.js`), `npm run test:resonance-lab` (89 passed) and `npm run build` all pass.

### Deviations from the sceptic's spec (all in §3–§4)

1. **Units:** the user's own pooled within-cell 1-s SD, not the 0.268 VVD step. The VVD step comes from
   unlicensed teacher demos and would be a shipped fitted constant.
2. **"Running speech" rule:** a bin is running speech when it is valid with voicing breaks (voiced
   fraction ≤ 0.95). The gate needs ≥ 3 such bins in the last 5 s, and the same rule applies to mapping
   bins.
3. **A bin with no VTLN value pauses** like a moved one (the conservative reading of C3b).
4. **The map is kept for the page visit**, with its deviceId, across stop / start of listening.
5. **Mapping prompts** advance at 30 running-speech bins, or when the user taps Next / Done.
6. **The analysis starts when the view is first opened**, not when the lab starts. Lab users who stay
   in the resonance view pay nothing for it.

### Still open (unchanged from §6)

- mobile CPU;
- the resonance gate's false-pause rate on ordinary speech;
- the clarity head against the clarity study's B1–B7 bar;
- listener labels of same-pitch, same-loudness light/heavy pairs.

AVID results in §2: M. Kodali, P. Alku, S. R. Kadiri, *AVID: Aalto Vocal Intensity Database*, Zenodo,
doi:10.5281/zenodo.10524873, CC BY 4.0.

## 8. Review fixes (2026-10-11) — plan, written before the code changes

An independent review of `weight-lab` at 6b56b9a reproduced the port and the AVID numbers exactly and
confirmed isolation and licences. It found the caveat text and the noise box wrong in places, and a
few logic gaps. Numbers below are from the sceptic's existing AVID outputs (12 W + 12 M test speakers,
clean, medians over speakers), recomputed for this note.

**A. Measurements behind the text and display changes**

| quantity (AVID test, clean; women / men) | value | source |
|---|---|---|
| v5 partial r(W, contact given F0, level) | +0.13 [+0.07, +0.19] / −0.04 [−0.14, +0.06] | sceptic report |
| plain level meter, same | +0.11 [+0.08, +0.15] / +0.04 [−0.01, +0.09] | sceptic report |
| v5 clarity head: partial r with level at fixed contact, pitch | +0.33 / +0.32 | per-speaker medians |
| v5 clarity head: r with level | +0.58 / +0.60 | per-speaker medians |
| v5 clarity head: change per +10 dB (head units; between-bin SD 0.45 / 0.38) | +0.38 / +0.34 | per-speaker medians |
| v5 weight: change per octave at fixed contact, level (teacher steps) | −1.54 / −1.34 | per-speaker medians |
| v5 vowel range across 12 Hillenbrand hVd words (teacher steps) | 7.97 / 7.34 | §2 (ii) |
| one own-SD unit in teacher steps (weight) | 0.87 / 0.74 | display simulation below |

**Display simulation** (the shipped scheme on each AVID test speaker: 2 st × 4 dB cells from the first
half of the recording, ≥ 5 bins per cell, pooled within-cell SD as the unit, median of 3 bins scored on
the second half; cells already match pitch and loudness, so any departure is chance):

| | women | men |
|---|---|---|
| 1-bin reading SD (units; weight / clarity) | 1.09 / 1.05 | 1.09 / 1.05 |
| 3-bin display SD (units; weight / clarity) | 0.76 / 0.78 | 0.77 / 0.76 |
| displayed readings outside the box by chance, box ±1 (either axis) | 36.5 % | 36.9 % |
| box ±1.5 | 13.5 % | 11.4 % |
| **box ±2** | **3.0 %** | **2.5 %** |

So the box becomes ±2 units, labelled as typical chance spread ("about 1 reading in 30 lands outside
it with no real change, in tests"). This is clean studio audio of read text; a real room and a
different text will be noisier.

**B. Changes (code follows this note)**

1. **Caveats** (view text), replaced with measured statements:
   - women / men: "In tests it did not follow vocal-fold contact any better than a plain loudness
     meter (women +0.13 vs +0.11; men −0.04)";
   - clarity: louder reads clearer (AVID partial r +0.33 / +0.32 at fixed contact); every similar
     clarity measure in the clarity study also moved with the vowel by about a clear → breathy step
     (men 2–4×); the clarity head has not passed the clarity study's bar;
   - vowels: about 8 units between vowels in tests (words, not only held vowels); compare with the
     same sentences you mapped with;
   - pitch: higher pitch reads lighter (in tests ~1.3–1.5 light/heavy demonstration steps per octave),
     which is why it compares only within 2-semitone bands;
   - gain control: the browser can report only its own gain control; the system or a headset may
     still compress loudness.
2. **Noise box** ±1 → ±2 units, relabelled (A).
3. **Measured gain-control check.** At the end of mapping, if the "a little softer" and "a little
   louder" prompts each gave ≥ 5 mapped bins and their median levels differ by < 4 dB, the map is
   marked "compression suspected" and readings stay off (reason shown, with the measured dB). If either
   prompt has < 5 bins the check is "not done" and shown as such. The 4 dB threshold is a heuristic,
   not measured: AVID's phone-like AGC squeezed a ~19 dB soft-to-very-loud spread to ~4.7 dB, so a
   "little" softer-to-louder change under compression should fall well below 4 dB, while an
   uncompressed deliberate change should exceed it.
4. **Microphone identity.** The map stores the track's label and groupId as well as its deviceId.
   A map is reused only when the labels match (and, when both deviceIds are real ids, they match);
   `default`, `communications` or an empty deviceId is treated as unknown. Chrome's default-device
   label names the physical microphone, so switching the system default is caught.
5. **Stale display.** Starting a new mapping clears the reading, the readings and the trail; the
   snapshot shows a reading only in the mapped phase; trail points older than 10 s are dropped on
   every closed bin and in the snapshot.
6. **Readout wording:** "Light↔heavy sound −0.3 · Breathy↔clear +2.0 (your units)"; the name
   "Weight × clarity" stays only with the experimental tag.
7. **Short landscape** (height < 30rem and width ≥ 40rem, e.g. 890×360): the plot sits beside the
   header and readouts at a smaller size so it is in the first screen.
8. **lab-smoke run 5:** requires ≥ 1 readable bin after mapping and reports the readable share; the
   viewport check also requires the plot to be fully visible vertically (above the Stop Listening row)
   at scroll position 0.

**Not changed (rejected or deferred):** none of the review's findings is rejected. The process hazard
it reports (a failed junction removal followed by `git worktree remove` deleting the shared
`node_modules`) is a workflow issue, not a code issue; it is reported to the user.
