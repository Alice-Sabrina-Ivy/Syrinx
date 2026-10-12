# Voice preview spike (Phase 0) — 2026-10-12

**Status: plan only.** This section was written and committed before any spike code existed and
before any result was measured. Results go in later sections of this file. The plan is not edited
afterwards. Any change is recorded under "Deviations from the plan", with its date and reason.

**What the spike decides:**

- whether WORLD (a speech vocoder), compiled to WebAssembly, is fast enough on a Pixel-class phone
  for a record-then-play voice preview;
- which sample rate to use (16 000, 22 050 or 24 000 Hz);
- which F0 front end to use;
- whether the WebAssembly build matches the pyworld reference that the scratch prototype used.

It also collects the data for a "recording check" against hum and noise. If WORLD fails the
phone gate (§P6), the PSOLA fallback is the engine.

**Scope:**

- No app feature code. Nothing under `src/` changes.
- Spike code goes under `scripts/voice-preview/`.
- Public data only.
- No PR. The branch is `voice-preview-spike`, started from `cue-strip` at a9ddd6b.

## Plan (pre-registered)

### P0. Background and decisions so far

- **Scoping (2026-10-12)**: scratch research on public data, not in this repo. A prototype rendered
  8 public clips × 26 pitch/formant settings with three engines:
  - WORLD through pyworld 0.3.5, as native code;
  - TD-PSOLA plus resampling, our own JavaScript;
  - Signalsmith Stretch.

  It measured the renders with Syrinx's real pitch chain, the Resonance lab's VTLN meter and the
  deployed gender model.
  - WORLD passed all four pre-registered VTLN meter checks.
  - WORLD resynthesised a mains hum in a clip's pauses as noise. PSOLA left the hum at its
    original pitch. Signalsmith shifted it into Syrinx's pitch range.
  - Phone speed was only estimated, from native desktop timings. For WORLD at 16 kHz, a 5 s phrase
    came to 1.4–4.5 s for analysis + first render and 0.45–1.7 s per slider change. That is
    borderline against the gate.
- **Listening check (user, 2026-10-12)** of the prototype renders (public clips):
  - WORLD was acceptable as "a rough sketch";
  - PSOLA distorted at large shifts;
  - Signalsmith was rejected.
- **User decisions (2026-10-12)**:
  - this Phase 0 spike is approved;
  - the first-version scope is approved:
    - an experimental card in the Resonance lab tab;
    - pitch and resonance sliders, with small default steps;
    - presets that don't assume a direction, and a pitch target the user chooses;
    - recordings made in the app only;
    - playback compared against the engine's unchanged rebuild;
    - record, then play only. The voice is never altered live.

### P1. Data (public only)

No audio is committed. The spike never uses the private session recordings or any recording of the
user's voice.

| Set | Clips | Use |
|---|---|---|
| **Prototype clips** (16 kHz mono; rebuilt by the prototype's selection rules, `prep_clips.py`, copied to `scripts/voice-preview/`) | `ls_m1` (LibriSpeech test-clean 61-70968-0005), `ls_m2` (260-123286-0000), `ls_f1` (121-121726-0001), `ls_f2` (237-126133-0003), `pt_m1` (PTDB-TUG mic_M01_sx10, 48 → 16 kHz), `pt_f1` (mic_F01_sx10), `ls_fb` (1995-1826-0005, the breathiest of 18 by a D4C aperiodicity proxy), `ls_mn` (672-122797-0007 + synthetic pink noise at +10 dB SNR, seed 1). `ls_m1` contains a natural ~59.5 Hz mains hum in its pauses. | Parity (P3), F0 front ends (P4), hum/noise base (P7) |
| **Timing clips** (48 kHz, full band) | PTDB-TUG M01, M02 (men), F01, F02 (women). For each speaker, join the `mic_*_sx*.wav` files in sorted order (keeping each file's own leading and trailing silence) until the total is ≥ 8.0 s. Then cut the first 3.0, 5.0 and 8.0 s. | Timing (P5), parity at 22.05 / 24 kHz (P3), listening set (P9) |
| **Prototype grid** | Pitch st ∈ {−6, −3, 0, +3, +6} × formant scale a ∈ {0.88, 0.94, 1.00, 1.06, 1.12}, plus one full-gap cell: men +9 st & a = 1.15, women −9 st & a = 0.87. That is 26 cells per clip. | Parity, F0 front ends |

Licences and attribution:

- **LibriSpeech** (Panayotov, Chen, Povey & Khudanpur, ICASSP 2015): CC BY 4.0.
- **PTDB-TUG** (Pirker, Wohlmayr, Petrik & Pernkopf, Interspeech 2011): Open Data Commons licence,
  as stated in `tests/dsp/data/ptdb-tug/README.md`. PTDB-TUG also supplies the laryngograph F0
  reference (`REF`, 10 ms).

FDA is not used, because its licence is unstated.

### P2. What gets built

**2a. WORLD compiled to WebAssembly.**

- **Source:** `mmorise/World` at commit `8d79b88b7dd92e8a132996cf74080b2d6f881b98` (2024-10-23).
  - This is the exact commit pyworld 0.3.5 bundles as `lib/World`, so the WebAssembly build and
    the reference compile the same C++.
  - Upstream `master` has 3 commits after it, up to c794856 (2026-10-09). All 3 change only
    `README.md`.
  - Licence: modified BSD (3-clause), `LICENSE.txt`.
  - Fetched by the build script into `C:/Coding Projects/Syrinx-cache/voice-preview/world/`. The
    script checks the commit hash. WORLD source is not committed to this repo.
- **Toolchain:** emsdk **6.0.10** (emsdk commit `a2b92777574c2feda07994cd4f1079a3dfc151f8`,
  2026-09-21).
  - Rule: the newest emsdk release at least two weeks old on 2026-10-12. 6.0.11 (2026-10-02)
    and 6.0.12 (2026-10-08) are too new.
  - Installed under `C:/Coding Projects/Syrinx-cache/voice-preview/emsdk/`.
  - The note records the sha256 of every archive emsdk downloads.
  - If 6.0.10 cannot build WORLD for a toolchain reason, Build uses 6.0.9 (commit `5eb0bde`,
    2026-09-01) and records why as a deviation.
- **Two builds, both single-threaded.** GitHub Pages serves no cross-origin-isolation headers,
  so there is no SharedArrayBuffer and no pthreads.
  - **SIMD build:** `-O3 -msimd128`.
  - **Non-SIMD build:** `-O3`.
  - Both builds use: no `-ffast-math`, no relaxed SIMD, `-fno-exceptions`, no filesystem, memory
    growth allowed, ES-module output that runs in a Worker and in Node 24.
  - The exact command lines are recorded in the results.
  - **Reproducibility check:** two builds from a clean tree must produce byte-identical `.wasm`
    files (sha256 reported).
- **C API (own code, MIT)**, float64 throughout like pyworld. Flat buffers in WebAssembly memory:
  - analysis: `dio`, `harvest`, `stonemask`, `cheaptrick`, `d4c`;
  - `warp`;
  - `synthesize`.

  Defaults are pyworld's:
  - DIO and Harvest: floor 71 Hz, ceiling 800 Hz; DIO channels_in_octave 2, speed 1,
    allowed_range 0.1;
  - CheapTrick: floor 71 Hz, with the FFT size from WORLD's own rule (expected 1024 at all three
    rates; Build records it);
  - D4C: threshold 0.85.

  Frame period: 5 ms primary; 10 ms only as a reported lever (§P5). The output length follows
  pyworld's `synthesize` rule, then is trimmed or zero-padded to the input length.
- **Formant envelope warp, exactly as the prototype does it** (`world_render.py`, `World._warp`).
  Bin k has frequency f_k = k·fs/fft_size (k = 0 … fft_size/2).
  - Envelope: ln S′(f_k) = interp(f_k / a; f, ln max(S, 1e-16)), then S′ = exp(·). interp is
    linear interpolation that clamps to the end values, like `np.interp`.
  - Aperiodicity: A′(f_k) = clip(interp(f_k / a; f, A), 0, 1).
  - a = 1 is a copy.
  - Pitch: f0′ = f0 · 2^(st/12) on voiced frames. Unvoiced frames stay 0.
  - Output finish (as the prototype's `finish`): RMS-match to the input over the whole clip, then
    scale down if the absolute peak exceeds 0.99.
- **Worker wrapper.** A module Worker holds f0 / envelope / aperiodicity in WebAssembly memory
  between renders. It has three messages, and every PCM buffer is transferred:
  - `init`: picks the SIMD or non-SIMD build with `WebAssembly.validate` on a tiny SIMD probe
    module;
  - `analyse`: 48 kHz PCM in; it resamples to the WORLD rate with the lab's
    `createSincResampler(48000, r, { cutoffHz: 0.45·r })`, runs the F0 front end and the analysis,
    then renders the first preview;
  - `render`: (st, a) in, rendered PCM out.

  Per-stage timings come back with each reply.

**2b. PSOLA fallback arm.**

- The prototype's `psola.mjs` (own code, MIT; TD-PSOLA plus windowed-sinc resampling, written from
  Moulines & Charpentier 1990), unchanged, in the same Worker shape.
- Its pitch marks come from the same F0 front end as WORLD, mapped to its 10 ms grid by the
  prototype's `f0At` rule.

**2c. Tooling (under `scripts/voice-preview/`, all own code):**

- the build script (pins and hash checks);
- the C API source;
- the Worker;
- a timing page and its Node driver;
- the Node parity runner, which loads the same `.wasm` in Node 24;
- the pyworld reference script (the prototype's `world_render.py` logic, run with the prototype's
  local pyworld 0.3.5 / numpy 2.4.4 / Python 3.14.3);
- the meter runners.

Built `.wasm` files and all outputs stay outside the repo, under
`C:/Coding Projects/Syrinx-cache/voice-preview/`. The build sha256 values are recorded here.
Meters run on this branch's `src/` (a9ddd6b), read-only.

### P3. Parity criteria (WebAssembly vs pyworld)

What parity means: the WebAssembly build computes what pyworld computes, apart from rounding (math
library differences of about 1 ULP), so the prototype's findings carry over.

Inputs are identical on both sides. The Node runner writes the exact float64 samples, and the F0
tracks where a stage takes one, and pyworld reads the same files. The pyworld renders are made
fresh, not taken from the prototype's stored files.

**Level 1: each stage on identical inputs**, so errors do not compound.

- 16 kHz: the 8 prototype clips.
- 22.05 and 24 kHz: the 4 timing clips at 5 s, resampled in Node with the same resampler the page
  uses.
- Synthesis runs on the 26 grid cells (16 kHz) and on (0, 1.00), (+2, 1.03) and (−2, 0.97) at
  22.05 and 24 kHz.

| Stage | Compared | Pass |
|---|---|---|
| StoneMask (same initial F0) | refined F0 | voicing identical on 100 % of frames; \|12·log2(f_wasm/f_py)\| ≤ 0.001 st on ≥ 99.9 % of voiced frames |
| DIO, Harvest (same waveform) | F0 | voicing identical and \|Δ\| ≤ 0.001 st on ≥ 99.5 % of frames (tracker decisions may flip on near-ties; every flip is listed) |
| CheapTrick (same refined F0) | envelope | \|10·log10(S_wasm/S_py)\| ≤ 0.01 dB on ≥ 99.9 % of frame × bin elements |
| D4C (same refined F0) | aperiodicity | \|Δ\| ≤ 1e-4 on ≥ 99.9 % of elements |
| Warp (same S, A, a) | S′ (as ln), A′ | \|Δ\| ≤ 1e-9 on 100 % of elements |
| Synthesis (same f0, S, A) | waveform before `finish` | SNR ≥ 60 dB per render, with pyworld as the reference and the difference as the error |

**Level 2: end to end, 16 kHz.**

- Both pipelines start from the same waveform and the prototype's stored F0 grid. That grid is the
  front end the user listened to: the lab's production pitch replica on a 10 ms grid, mapped to
  5 ms by the prototype's `grid_to_frames` rule, then StoneMask.
- Scope: the 8 clips × 26 cells = 208 renders.
- **Pass:** waveform SNR ≥ 40 dB on every render, before `finish`. The median is also reported.

**Level 3: Syrinx's meters read the WebAssembly renders like the pyworld renders.**

Both render sets are measured with this branch's meters. The meter code changed between the
prototype's base (main 134bb34) and a9ddd6b (`noise-notch.js`, `vtln.js`, `lab-engine.js`), so the
prototype's stored numbers are not the reference. Over the 208 finished renders:

| Meter | Pass |
|---|---|
| Real pitch chain (`scripts/session-oracle/lib/chain.mjs` `runWorkers`: real pitch worker + DSP worker), posted pitch | clip median of the voiced posted pitch: \|Δ\| ≤ 0.05 st on every render; frame-wise posted-voicing agreement ≥ 98 % on every render |
| Resonance lab VTLN meter (`scripts/resonance-lab/node/lab_live.mjs … vtln`, the lab's full live path) | clip reading (median of non-null 150 ms bins) \|Δ\| ≤ 0.01 ln on every render |
| The prototype's VTLN checks, recomputed on each render set (normalised slope; sign accuracy at ±6 %; monotonicity; pitch leak in G/oct) | same four pass/fail verdicts for WebAssembly and pyworld; each statistic within ±0.02 |

**Cross-engine checks.**

- **Browsers vs Node:** the same `.wasm`, given the same inputs (2 clips × 3 cells per build), must
  give bit-identical output PCM (sha256) in Node, desktop Chrome, desktop Firefox if driven, and on
  the phone.
- **SIMD vs non-SIMD:** each build must meet every Level 1–3 criterion. Bit-identity is expected
  and reported.

**If a criterion fails:** Build looks for a build or wrapper bug and fixes it, for example
marshalling, float32 truncation, wrong defaults or a wrong output length, then re-runs everything.

- A Level 1 or Level 2 failure with no traceable bug is reported with its size and location.
  Example: a synthesis render below 60 dB whose error sits in 3 or fewer pitch pulses (a discrete
  pulse-timing flip).
- **Level 3 decides.** If Level 3 fails, the WebAssembly engine does not stand in for the prototype.
  The spike stops before the phone session and reports.

### P4. F0 front ends

Each front end is followed by CheapTrick, D4C and synthesis at 5 ms.

| ID | Front end | Cost at preview time |
|---|---|---|
| **F-H** | WORLD Harvest (71–800 Hz), used directly | Harvest |
| **F-D** | WORLD DIO (71–800 Hz) + StoneMask | DIO + StoneMask |
| **F-S** | Syrinx's posted pitch track + StoneMask: the real pitch worker's `post` values, one per 25 ms hop, as the live chain already posts them while the user records (75–400 Hz reported range; null above 400 Hz) | mapping + StoneMask only. The live chain has already paid for the track. |
| **F-L** (baseline; also the last-resort choice) | the prototype's front end: the lab's production pitch replica (`lab-engine.js` `gridTrack`, 10 ms) + StoneMask | the replica (JS) + StoneMask |

**F-S mapping.**

- Hop k describes the analysis window centred at (k+1)·25 ms − 40 ms. This is the session-oracle
  `post` column's convention.
- Each 5 ms WORLD frame gets a log-linear interpolation between two voiced neighbouring hops. If
  only one hop is near, it takes the nearest hop within 18.75 ms. Otherwise the frame is unvoiced.
  This is the prototype's rule, scaled to a 25 ms hop.
- **Alignment check:** on the 8 clips, the lag that best aligns F-S with F-L must be within ±5 ms.
  Otherwise it is corrected and reported.

**How each front end is judged.** All checks are on the 8 prototype clips; the PTDB check also uses
the timing clips.

1. **Voicing loss** (P1: share of frames posted voiced on the original that are posted unvoiced on
   the render), at (0, 1.00). Median over clips ≤ F-L's + 2 pp.
2. **Gross pitch errors** (P2: frames voiced in both where \|12·log2(render/orig) − st\| > 2 st), on
   the prototype's eligible cells. Median over renders ≤ F-L's + 1 pp.
3. **Against the PTDB-TUG laryngograph reference.** Covers the sx files in the timing clips plus
   `pt_m1` / `pt_f1`, on 10 ms reference frames, each front end scored at its own best lag within
   ±30 ms (PTDB references sit about +20 ms late).
   - Gross error rate (\|Δ\| > 20 %, on frames voiced in both) ≤ F-L's + 1 pp.
   - Voicing recall ≥ F-L's − 3 pp.
   - False voicing ≤ F-L's + 3 pp.
4. **VTLN meter:** all four prototype checks pass on the 8-clip × 25-cell grid.
5. **Parity**, where it applies: F-H and F-D meet Level 1 against pyworld's `harvest` / `dio`.
   F-S and F-L run Syrinx's own JavaScript and are identical by construction.

**Selection.**

- Among the front ends that meet 1–4, take the one with the lowest preview-time analysis cost in
  desktop Chrome (§P5, 5 s clips, 16 kHz).
- F-S wins any tie within 10 %, because it adds no analysis code to the app.
- If only F-L meets 1–4, F-L is used.
- The choice is made on desktop, before the phone session. The phone times all four front ends
  anyway (priority 5 in §P5).

**Known weakness of F-S:** frames outside 75–400 Hz are unvoiced, so they become noise in the
preview. Checks 1 and 3 measure this, mainly on `ls_m1` (creaky ~86 Hz) and `ls_fb` (135–354 Hz).

### P5. Timing protocol

**Page.**

- A static timing page (`scripts/voice-preview/timing/`) served from localhost by a small Node
  static server.
- The page holds the timing clips at 48 kHz (the app's capture rate on desktop and Pixel Chrome)
  and the F-S / F-L tracks, which are precomputed in Node.
- The page passes the precomputed track to the Worker for F-S. In the app, the live track already
  exists by the time the recording ends.
- Clock: `performance.now()` on the main thread for end-to-end times. The Worker reports the
  per-stage times: resample, front end, StoneMask, CheapTrick, D4C, warp, synthesis, finish.

**Quantities.**

| Name | Definition |
|---|---|
| **C0**: module load | fetch (localhost) + compile + instantiate of the glue + `.wasm` in a fresh Worker. Uses a fresh browser context and a unique query string, so neither the HTTP cache nor the compiled-code cache helps. |
| **G1**: analysis + first render | from posting `analyse` (48 kHz PCM transferred) to an `AudioBuffer` holding the first render being ready on the main thread. Includes the resample to r, the front end, StoneMask / CheapTrick / D4C, one warp + synthesis + finish at **(+2 st, ×1.03)**, and the transfer back. **Cold G1** = the first analysis in a freshly instantiated Worker. **Warm G1** = repeat analyses in the same Worker. |
| **G2**: per slider change | from posting `render` to the `AudioBuffer` being ready, in a warm Worker. Covers warp + synthesis + finish + messaging. Playback is not included. The settings cycle twice through (+2, 1.03), (−2, 0.97), (+4, 1.00), (−4, 1.00), (0, 1.06), (0, 0.94), (+6, 1.12), (−6, 0.88), (+9, 1.15), (−9, 0.87), so 20 changes per run. |

The unchanged rebuild is a second render. The app makes it after the first preview, so its cost
is one G2.

**One run** = one fresh context and Worker: C0, then cold G1, then 20 × G2, then 5 × warm G1.

**Matrix.** Sample rates r ∈ {16 000, 22 050, 24 000} Hz. Phrase lengths 3, 5 and 8 s. Clips M01,
M02, F01, F02. 5 ms frames unless stated. Rates and clips are interleaved in rotated order within
each repeat, to spread drift.

| Platform | Runs per (rate, length, clip) | Coverage |
|---|---|---|
| Desktop Chrome, headless (Chrome for Testing, pinned) | 10 | WORLD SIMD at all lengths, with the selected front end; WORLD non-SIMD at 5 s; PSOLA at 5 s; each other front end at 5 s; the 10 ms frame lever at 5 s |
| Desktop Firefox (pinned), if puppeteer can drive it | 5 | WORLD SIMD and non-SIMD, 5 s; PSOLA, 5 s |
| Android Chrome on the phone (later session, user present) | 10 | in this priority order, stopping when time runs out: (1) 5 s, all rates, WORLD with the selected front end and the build the page picks, plus PSOLA; (2) 3 s and 8 s; (3) the other build; (4) the 10 ms lever; (5) the other front ends |

**Statistics.**

- For every quantity: median and p90 per (platform, engine, build, front end, rate, length), pooled
  over clips and per clip.
- p90 uses linear interpolation between order statistics (numpy's default). The minimum is also
  reported.
- Units: seconds per phrase and ms per second of audio.

**Also reported:**

- `.wasm` and glue size per build: raw, gzip −9 and brotli q11;
- WebAssembly memory size after analysing 8 s at 24 kHz;
- for the 10 ms lever: timing, plus the log-spectral distance between the 10 ms and 5 ms renders.

**Conditions.**

- **Desktop:** i9-11900K, Windows 11, shared with other heavy jobs. A resource governor may pause
  processes, so desktop numbers are reported, not gating.
- **Phone:** the Pixel 8 Pro harness phone with its current Chrome stable (version recorded).
  - The page is served through `adb reverse`, so the phone loads it from `http://localhost`: a
    secure context with no certificate prompt.
  - Puppeteer attaches over CDP via `adb forward`, as `scripts/mobile-diag-capture.js` does.
  - Plugged in, screen on, "Stay awake while charging", other apps closed, page in the foreground.
  - 60 s idle before each block. Battery temperature (`dumpsys battery`) is logged per block. Pause
    while it is above 40 °C and resume at 38 °C or below.

**Desktop browsers (hard rule 2).**

- puppeteer-core 24.42.0 launches only pinned browsers that @puppeteer/browsers 2.13.0 installs
  under `C:/Coding Projects/Syrinx-cache/voice-preview/browsers/`.
- Version rule: the newest Chrome for Testing Stable, and the newest Firefox stable, released at
  least two weeks before the run. Exact versions are recorded.
- Every launch gets a new temporary `--user-data-dir`.
- The spawned PID is recorded. Cleanup is `browser.close()`, then `taskkill /pid <PID> /T /F` on any
  abnormal exit (handlers for exit, SIGINT, SIGTERM and uncaughtException), then the temp profile
  is deleted.
- No kill by image name. The installed Chrome is never started or queried.

### P6. The gate and the sample-rate rule

The gate comes from the scoping. Only the phone's numbers count.

At sample rate r, the engine passes on the Pixel-class phone with 5 s phrases (4 clips × 10 runs)
**if and only if all four hold:**

1. median of cold G1, pooled over all 40 runs ≤ **3.0 s**;
2. the worst clip's p90 of cold G1 (the largest of the 4 per-clip p90 values) ≤ **3.0 s**;
3. median of G2, pooled over all 800 changes ≤ **1.0 s**;
4. the worst clip's p90 of G2 ≤ **1.0 s**.

**Module load.** C0 is hidden behind the recording, because the card loads the module when it
opens. The phone's median C0 must therefore be ≤ 3.0 s, the shortest allowed recording. If it is
longer, the excess is added to every cold G1 before conditions 1 and 2 are applied.

**Settings for the gate.**

- Engine: WORLD with the front end chosen in §P4.
- Build: the one the page picks by feature detection (SIMD on Pixel Chrome).
- Frame period: 5 ms. The 10 ms lever cannot rescue a failing configuration in this spike. It is
  reported for a later decision.

**Sample-rate rule.**

- WORLD runs at the highest of 24 000, 22 050 and 16 000 Hz that passes.
- **If WORLD fails at all three rates,** PSOLA takes over. PSOLA's own gate check uses the same four
  conditions and the same G1 / G2 definitions. Its "analysis" is the resample, the same front end
  and its pitch marks; its render is PSOLA plus resampling. PSOLA runs at the highest rate where it
  passes.
- The engine comes first: WORLD at 16 kHz beats PSOLA at 24 kHz.
- **If PSOLA also fails at every rate,** no engine passes. The spike stops and reports to the user.

The 3 s and 8 s numbers are reported, not gating. If 8 s misses the gate, that is a reason to cap
the recording length in Phase 1.

### P7. Hum and noise

Synthetic additions to public clips.

**Base clips:** `ls_m2`, `pt_m1` (men) and `ls_f1`, `pt_f1` (women), 16 kHz. `ls_m1` is reported
separately as a natural-hum case.

**Conditions:**

- clean;
- mains hum at 50 Hz and at 60 Hz, each at −40, −30 and −20 dB;
- pink noise at +20 and +10 dB SNR.

That is 9 conditions per clip.

- **Hum:** Σ_{k=1..6} (1/k)·sin(2π·k·f_mains·t + φ_k), with φ_k from numpy `default_rng(2)`. It is
  continuous over the whole clip, so it sits both in the pauses and under the speech. Its RMS =
  clean clip RMS × 10^(level/20).
- **Pink noise:** the prototype's recipe (`default_rng(1)`, 1/f power), with SNR relative to the
  clean clip RMS.

**Renders.** WORLD (WebAssembly, the selected front end) and PSOLA (same front end), at cells
(0, 1.00), (+2, 1.03), (−2, 0.97), (+6, 1.12) and (−6, 0.88). That is 360 renders, plus `ls_m1`.

One spot check at 24 kHz: `pt_m1` and `pt_f1` rebuilt from their 48 kHz sources, 60 Hz hum at
−20 dB.

**Measured.** Pauses are 25 ms hops whose clean-clip energy is ≥ 35 dB below the clean clip's
95th-percentile 20 ms-frame energy. They are defined on the clean clip, so the added noise does not
change which frames count as pauses.

- **m1. Pause voiced share:** the share of pause hops that the real pitch chain posts voiced, in the
  original-with-noise and in each render.
- **m2. Added tonal energy in pauses:** Welch spectrum of the pause samples (8192-point Hann, 50 %
  overlap; needs ≥ 0.5 s of pause in total). Peak prominence = the largest bin power in 75–400 Hz
  over the median power in 50–460 Hz, in dB.
  - A render "adds a tonal peak" if it has a peak ≥ 9 dB (8×, the notch's prominence rule) with no
    peak in the original-with-noise within ±3 Hz.
  - The posted pitch values in pauses are also listed. They show whether a hum was shifted.
- **m3. Speech frames:** frame-wise pitch error and voicing loss against the same cell rendered
  from the clean clip; VTLN reading shift against that clean render.

**Recording-check candidates.**

- **d1. Syrinx's tonal-noise detector** (`createNoiseNotch(16000)` from this branch's
  `src/dsp/noise-notch.js`, defaults, 400-sample chunks as the pitch worker feeds it). Run two ways:
  - "live": after a 10 s pre-roll of the same hum or noise alone, as if the app had been listening
    before the recording;
  - "recording only".

  Flag = any active notch line during the recording. The time to the first promotion is reported.
  With defaults, a hum present from the start needs about 5 s of stability before promotion.
- **d2. Simple level check.** Margin = 95th − 10th percentile of 20 ms frame energies over the
  recording, in dB. Flag if the margin is < 25 dB. The 25 dB threshold is a pre-registered
  candidate. All margins are reported, so a better threshold can be picked later and labelled post
  hoc.

**Judged.**

- **Expected:** WORLD renders do not add a tonal peak in pauses, and do not raise the pause voiced
  share. This is the prototype's finding, re-checked on the WebAssembly build.
  - If a WORLD render adds a tonal peak in any hum condition, the result says so first. That
    reopens the engine question for rooms with hum.
- **Adequacy of a recording check.** A detector, or d1 OR d2, is adequate if:
  - it flags every condition in which any WORLD render raises the pause voiced share by > 5 pp over
    the same cell rendered from the clean clip, or adds a tonal peak;
  - it flags none of the clean clips. The clean set is the 4 clean base clips, `ls_f2` and the 4
    timing clips at 5 s.

  The result informs Phase 1's recording check. No engine decision depends on it.

### P8. Cross-browser

**Measured:**

- desktop Chrome (headless);
- Android Chrome (phone session);
- desktop Firefox, if puppeteer-core can launch and drive it. If not, the reason is reported and
  Firefox is listed as untested.

**Untested:** iOS Safari. There is no device. The note states this.

**WebAssembly features (must be baseline):**

- The non-SIMD build uses only features every current engine ships: MVP plus sign-extension,
  mutable globals, bulk memory and non-trapping float-to-int.
- The SIMD build adds only fixed-width SIMD128, shipped in Chrome 91, Firefox 89 and Safari 16.4.
- Neither build uses threads or SharedArrayBuffer, relaxed SIMD, exception handling, GC, memory64,
  tail calls or JSPI.
- The feature list of each `.wasm` is read with binaryen and recorded.

**Other APIs the page uses:**

- module Workers;
- transferable ArrayBuffers;
- `AudioBuffer` at 16 000, 22 050 and 24 000 Hz, all inside the 8–96 kHz range the Web Audio spec
  requires.

### P9. Listening set (scratch only, not committed)

Ten files go in the session scratchpad (`…/scratchpad/voice-preview/spike-listen/`, outside the
repo), with an `index.md`:

- **Clips:** M01 and F01 timing clips at 5 s.
- **Originals:** the 48 kHz sources (2 files).
- **Renders:** WORLD WebAssembly, SIMD build, the selected front end, at **16 kHz and 24 kHz**. For
  each clip and rate, two renders (8 files):
  - the unchanged rebuild;
  - one small step: M01 at **+2 st / ×1.03**, F01 at **−2 st / ×0.97**.
- **Format:** RMS-matched and peak-limited as `finish`, 10 ms fades, 16-bit WAV at the render's
  rate.
- **Question for the user:** does 24 kHz sound better than 16 kHz, enough to matter? 16 kHz carries
  sound only up to 8 kHz. The answer only matters if the gate passes at more than one rate.

### P10. Reporting and what is committed

- **Committed:** this note and `scripts/voice-preview/`:
  - own code: build script, C API, Worker, timing page and driver, parity and meter runners,
    `psola.mjs`, clip preparation;
  - third-party notices for any committed file that came from elsewhere.
- **Not committed:** audio, `.wasm` binaries, WORLD source, emsdk.
- Any test added under `tests/` must be self-contained or skip gracefully.
- `npm run lint`, `npm run test:unit` and `npm run build` stay green.
- **Results are reported in this order:**
  1. the verdict: engine, sample rate, front end, build;
  2. parity;
  3. front ends;
  4. desktop timing;
  5. hum and noise;
  6. cross-browser.

  The phone section is added after the phone session.
- Every deviation from this plan is dated and explained.

## Results

**Status (2026-10-12, Build step):** the WebAssembly build and every parity check are done.
Front-end selection (§P4), the desktop timing matrix (§P5), hum and noise (§P7), the listening
set (§P9) and the phone session are not yet run. The verdict comes after the phone session.

### Parity (§P3)

**WebAssembly WORLD computes what pyworld 0.3.5 computes. Every Level 1, 2 and 3 criterion
passes; the differences are float rounding (about 1e-12 or smaller).** So the prototype's
WORLD findings carry over to the WebAssembly build.

**Level 1, each stage on identical inputs.** 16 cases: the 8 prototype clips at 16 kHz and the
4 timing clips at 5 s, at 22.05 and 24 kHz. CheapTrick's FFT size is 1024 at all three rates.

| Stage | Pass if | Result | |
|---|---|---|---|
| DIO | ≥ 99.5 % of frames agree | 100 % of 18 096 frames; no disagreement; largest difference 7e-12 st | pass |
| Harvest | ≥ 99.5 % of frames agree | 100 % of 18 096 frames; no disagreement; largest 1.3e-13 st | pass |
| StoneMask | voicing identical; ≤ 0.001 st on ≥ 99.9 % | voicing identical on all frames; largest 1.2e-14 st | pass |
| CheapTrick | ≤ 0.01 dB on ≥ 99.9 % | 100 % of 9 283 248 elements; largest 4.4e-9 dB | pass |
| D4C | ≤ 1e-4 on ≥ 99.9 % | 100 %; largest 8.4e-12 | pass |
| Warp | ≤ 1e-9 everywhere | 56 warps: largest \|Δ ln S′\| 2.2e-16, \|ΔA′\| 0 | pass |
| Synthesis | SNR ≥ 60 dB per render | 232 renders: lowest 281.7 dB, median 303.8 dB; same lengths | pass |

**Level 2, end to end at 16 kHz** (stored F0 grid → StoneMask → CheapTrick → D4C → warp →
synthesis, before `finish`): 208 renders, SNR lowest 222.6 dB, median 283.0 dB. Pass (≥ 40 dB).

**Level 3, Syrinx's meters on this branch** (208 finished renders per engine):

| Meter | Pass if | Result | |
|---|---|---|---|
| Real pitch chain | clip median within 0.05 st; voicing agreement ≥ 98 % | medians identical on every render (largest difference 0.000 st); voicing agreement 100 % on every render | pass |
| Lab VTLN meter | reading within 0.01 ln | largest difference 2.1e-8 ln; no missing readings | pass |
| Prototype's 4 VTLN checks | same verdicts; each statistic within ±0.02 | both sets: slope 1.173, sign 0.938, monotonic 0.825, leak 0.154 G/oct, all four pass; largest difference 7e-8 | pass |

The finished float32 renders are bit-identical on 87 of 208 renders. The rest differ by at most
6e-8 (one float32 step), from the RMS match in `finish` (numpy vs JavaScript summation).

**SIMD vs non-SIMD:** all 1 152 parity outputs (every Level 1 and 2 array and finished render)
have identical sha256. So the non-SIMD build meets every criterion as well.

**Browsers vs Node:** the output PCM of the identity cases (M01 at 16 kHz with F-L, F01 at 24 kHz
with F-H, both WORLD; M01 PSOLA with F-L; 3 cells each; both builds) is bit-identical to Node's:
18 of 18 in headless Chrome for Testing 154.0.8037.57 and 18 of 18 in headless Firefox 156.0.1.
The phone is still to come.

**PSOLA arm:** `lib/psola.js` reproduces all 208 of the prototype's stored PSOLA renders bit for
bit (same clips, same stored grids, same cells).

### Build (§P2a)

- **WORLD:** mmorise/World `8d79b88b7dd92e8a132996cf74080b2d6f881b98`; `LICENSE.txt` sha256
  `cb19c28611fcee6ce200c075a0e5bc91f0dcb0637985797b830990d2fe2fcffe`.
- **emsdk:** 6.0.10, commit `a2b92777574c2feda07994cd4f1079a3dfc151f8`. emcc 6.0.10
  (`d6c521a7f05449857c76bd99e396895583cf2083`), clang 24.0.0git (`a06d9165905c`), binaryen
  version_132. The three archives it downloaded on Windows x64 (sha256):
  - `666337b525e673e769121856d175f6f52b8ead64-wasm-binaries.zip` `6de0bf6bad8214a89dedafb5db3cdcfbdf8c395e421ba257e83cb21b77030931`
  - `node-v24.19.0-win-x64.zip` `57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`
  - `python-3.13.3-0-win-amd64.zip` `6fe7a540c6b8b185780467cf7495e884ee62316ec4abb19e1c735b8a77c62465`

Command line (SIMD; the non-SIMD build drops `-msimd128`):

```
em++ -O3 -msimd128 -fno-exceptions -I<world>/src -ffile-prefix-map=<world>=world
  -ffile-prefix-map=<repo>/scripts/voice-preview=vp -sMODULARIZE=1 -sEXPORT_ES6=1
  -sEXPORT_NAME=createVpWorld -sENVIRONMENT=web,worker,node -sFILESYSTEM=0
  -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=_malloc,_free,_vp_version,_vp_dio_frames,
  _vp_harvest_frames,_vp_dio,_vp_harvest,_vp_stonemask,_vp_cheaptrick_fft_size,_vp_cheaptrick,
  _vp_d4c,_vp_warp,_vp_synthesis_length,_vp_synthesize -sEXPORTED_RUNTIME_METHODS=HEAPF64
  scripts/voice-preview/wasm/vp_world.cpp <world>/src/{cheaptrick,common,d4c,dio,fft,harvest,
  matlabfunctions,stonemask,synthesis}.cpp -o vp_world.mjs
```

| File | sha256 | raw | gzip −9 | brotli q11 |
|---|---|---|---|---|
| SIMD `.wasm` | `fa3a29cf0ef75145ebe7fa6ab2b5dfa526ce9d1e5eb1a6409f291e863a7d3a25` | 115 874 B | 53 415 B | 46 038 B |
| non-SIMD `.wasm` | `09cf5e8ae0bb2d4ae1fb11eb2e11a32fddd3a94f767365bad47c84b40e33598d` | 111 276 B | 51 502 B | 43 736 B |
| glue `.mjs` (same for both) | `5e7a7a209e4a88ceb765a8d5c64cf2af33ad5abe8700cd38071d2ed117d988c5` | 7 747 B | 2 675 B | 2 405 B |

- **Reproducible:** a second build from clean output folders, with a fresh Emscripten
  system-library cache, gave byte-identical `.wasm` and glue for both builds.
- **WebAssembly features** (binaryen; the smallest set each module validates with):
  SIMD build: bulk memory (`memory.copy` / `memory.fill`), non-trapping float-to-int, SIMD128.
  Non-SIMD build: bulk memory, non-trapping float-to-int. Neither uses threads, exception
  handling, GC, memory64, relaxed SIMD, tail calls, multi-value or reference types.
- **Linked runtime:** Emscripten's libc (musl-based), dlmalloc, compiler-rt builtins and the
  no-exceptions libc++ / libc++abi (for `new` / `delete`).
- **Memory:** 23 MB after analysing 5 s at 16 kHz, 28 MB at 24 kHz, 40–46 MB after 8 s at 24 kHz
  (Node; F-H and F-L).
- **What is committed:** code only. The `.wasm` is not committed (§P10); `build.mjs` rebuilds it
  byte for byte. `scripts/voice-preview/README.md` lists the notices a later phase must add if it
  commits or ships the module.

**Browsers for the timing runs** (under `VP_CACHE/browsers`):

- Chrome for Testing **154.0.8037.57**. Archive `chrome-win64.zip` sha256
  `676f51fb82608330db5510ffba53d9e2762d3d7a99464afce54f9e9e25ad6bf7`; the installed
  `chrome.exe` is the archive's (sha256 `6b5da320179b656aefdb74ff10bc0bd33ba8d5ea869347e04e0a6b2bdd815e96`).
  Chrome for Testing builds are not code-signed.
- Firefox **156.0.1**. Installer sha256
  `e69ff3fb4c585f88c947a673dedcfa6c346a5092881a6e6b618005821030bc67`, equal to Mozilla's
  `SHA256SUMS`; Authenticode signature valid (Mozilla Corporation).

### Timing page smoke run (not the pre-registered matrix)

The page, Worker and driver work end to end in both desktop browsers: 28 runs in headless Chrome
(one run per cell; 5 s; M01 and F01; 16 and 24 kHz; every block) and 6 in headless Firefox,
with no errors. A fresh browser context per run (`--per-run-context`) also works. The numbers
below are single runs on a shared machine and are **not** results:

| Headless Chrome, 5 s, 16 kHz | C0 | cold G1 | G2 (median of 40) |
|---|---|---|---|
| WORLD SIMD, F-L | 0.06 s | 0.69 s | 0.13 s |
| WORLD SIMD, F-S | 0.03 s | 0.39 s | 0.14 s |
| WORLD SIMD, F-D | 0.04 s | 0.47 s | 0.14 s |
| WORLD SIMD, F-H | 0.04 s | 2.18 s | 0.14 s |
| PSOLA, F-L | 0.07 s | 0.57 s | 0.19 s |

### Note for the next steps: the timing clips are mostly silence

PTDB-TUG sentence files carry about 2.5 s of silence before and after the speech. With §P1's rule
(files joined with their own silence kept, then cut from the start), the 3 s cuts are almost all
silence: 0, 7, 0 and 2 voiced 25 ms hops for M01, M02, F01 and F02 (posted by the real pitch
worker). The 5 s cuts hold 57–72 voiced hops (about 1.4–1.8 s) and the 8 s cuts 71–76. WORLD's
cost barely depends on content, but the 3 s numbers for F-S and F-L, and the 5 s listening clips,
are not typical of a real recording, which starts near the speech. The rule is unchanged here;
the next step should decide whether to keep it.

## Deviations from the plan

All dated 2026-10-12 (Build step).

1. **WORLD source folder:** `VP_CACHE/world-src/` instead of `…/world/`, as the Build task asked.
   No effect on the build.
2. **Firefox install:** `@puppeteer/browsers` 2.13.0 reported Firefox 156.0.1 as installed but left
   an empty folder. Its unpack step runs the installer through a shell without quoting the
   extract path, and the cache path contains a space. The same Mozilla-signed installer was
   extracted the same way (`/ExtractDir=`) by hand, after checking its sha256 against Mozilla's
   list and its signature. Chrome for Testing was installed by `@puppeteer/browsers` as planned.
3. **Browser version rule, as applied:** Chrome for Testing 154.0.8037.57 was first served on the
   Windows stable channel on 2026-09-22 (a 10–25 % rollout); 154.0.8037.92 first appeared on
   2026-09-29, 13 days before the run. On 2026-09-28 most users were still on Chrome 153.
   Firefox 156.0.1 was released on 2026-09-22; 157.0 (2026-09-29) is too new.
4. **Fresh context for C0:** within one page load, each run gets a fresh Worker, a unique query
   string on the Worker, glue and `.wasm`, and `no-store` responses. A fresh browser context per
   run is available on desktop Chrome (`--per-run-context`). Android Chrome may not allow extra
   browser contexts over CDP; if not, the phone uses the in-page form.
5. **PSOLA's front end (§P2b, clarified):** PSOLA uses the front end without StoneMask (WORLD's
   refinement step), on its 10 ms grid: F-L is the replica's own grid (exactly the prototype's
   PSOLA input); F-S is mapped to the grid times by the F-S rule; F-H and F-D take WORLD frame
   2j + 1.
6. **Level 1 at 22.05 / 24 kHz, StoneMask's initial F0 (not specified in the plan):** the lab
   replica's grid on the 48 kHz clip (this branch), mapped to 5 ms frames by the prototype's
   rule.
7. **F-S mapping, a note:** with nearest-hop rounding the nearest hop is always within 12.5 ms,
   so the 18.75 ms limit never binds. The rule is implemented as written (numpy's
   round-half-even included).
