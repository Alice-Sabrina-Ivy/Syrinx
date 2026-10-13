# Voice preview spike (Phase 0) — 2026-10-12

> **Results follow the plan:** see § Results (desktop, 2026-10-12, revised after review) and
> § Review notes. The plan text below, from the status line to the end of §P10, is unchanged
> since commit 7487aea. This pointer was added after review (deviation 19).

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

**Status (2026-10-12, Measure step; revised after review):** everything that runs on the
desktop is done: parity, front-end selection, the desktop timing matrix in Chrome and Firefox,
hum and noise, and the listening set. After review, an in-range tonal-noise test, a render
check at 22.05 and 24 kHz and more identity cases were added (§ Review notes). **The gate
(§P6) is not decided.** It counts only the phone's numbers, and the phone session (with the user
present) is still to come. Every timing below is desktop-only.

**Reported first, as §P7 requires: WORLD adds a tonal peak in rooms with hum inside the pitch
range.** With a 120 Hz fan hum (the repository's own `fanHum` noise class, an addition after
review), the pitch chain posts the hum as voiced in 20–72 % of pause hops. F-S hands that
voicing to WORLD, and WORLD moves the hum with the pitch slider: 47 of the 48 shifted renders
add a peak at the hum × the pitch step (9–29 dB). That is the failure the scoping held against
Signalsmith. By §P7's rule this **reopens the engine question for rooms with in-range hum**.
WORLD's "no added peak" result holds for mains hum (fundamental below 75 Hz) and for broadband
noise. PSOLA does no better: it keeps the hum and adds peaks too. See § Hum and noise.

### Verdict so far (desktop only; the phone decides)

| Decision | Status | Basis |
|---|---|---|
| Engine | WORLD, **pending the phone gate**; **open for rooms with in-range hum** (§ Hum and noise) | Parity passes. Predicted to pass the gate at every rate (§ Desktop timing) |
| F0 front end | **F-S** (Syrinx's posted pitch track + StoneMask), selected on the desktop as §P4 requires | Meets checks 1–4, and is the cheapest of the front ends that do |
| Build | the page's choice: SIMD where supported (both desktop browsers picked it) | SIMD and non-SIMD outputs are identical. SIMD is 5–8 % faster |
| Sample rate | **open until the phone session.** Predicted: 24 kHz | Desktop times × 2.0 (the session phone's measured ratio for JavaScript) pass at 24 kHz on both clip sets. Margin: ×4.8 on the speech-dense clips, ×6.1 on the pre-registered clips. 22.05 and 24 kHz renders read the same as 16 kHz on checks 1, 2 and 4 (§ F0 front ends) |
| Clip sets | **both decide** (deviation 18) | A rate passes only if it passes on the pre-registered clips and on the speech-dense clips. At equal machine load the speech-dense clips take 21–28 % longer to analyse |
| Recording check | informs Phase 1 only | Mains hum: not needed. In-range hum: only the tonal-noise detector after ≥ 5.5 s of listening catches it; the level check does not (§ Hum and noise) |

The phone session times both clip sets at 5 s (deviation 18) on a Pixel 11 Pro XL, a flagship,
so a pass covers phones that fast or faster (deviation 20). It should also note whether 24 kHz
sounds better than 16 kHz in the listening set (§P9).

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
After review, three cases with the gate configuration were added (WORLD with F-S at 24 kHz on
F01 and at 22.05 kHz on M02, and PSOLA with F-S at 24 kHz on F02; the posted track is passed as
the timing page passes it): **36 of 36 outputs bit-identical to Node in both browsers.** The
phone is still to come; it checks the same 36.

**PSOLA arm:** `lib/psola.js` reproduces all 208 of the prototype's stored PSOLA renders bit for
bit (same clips, same stored grids, same cells).

**Every F0 front end (Measure step):** Levels 2 and 3 also pass for F-H, F-D, F-S and F-L
(§ F0 front ends).

### F0 front ends (§P4)

**Selected: F-S, Syrinx's posted pitch track + StoneMask.** F-S and F-L meet checks 1–4; F-H
fails check 3 (false voicing) and F-D fails check 1 (voicing loss). Among F-S and F-L, F-S is
cheaper in desktop Chrome (§ Desktop timing), and it would win a tie anyway.

8 prototype clips, 16 kHz, WORLD WebAssembly (SIMD build). F-L here is this branch's lab replica
grid, not the prototype's stored grid (the stored grid is the Level 2 input above).

| Check | Pass if | F-H Harvest | F-D DIO + StoneMask | **F-S posted track + StoneMask** | F-L lab replica + StoneMask |
|---|---|---|---|---|---|
| 1. Voicing loss at (0, 1.00), median of 8 clips | ≤ F-L + 2 pp (≤ 5.0 %) | 4.1 % | **7.1 %** fail | 2.5 % | 3.0 % |
| 2. Gross pitch errors (> 2 st), median of 193 eligible renders | ≤ F-L + 1 pp (≤ 1.9 %) | 1.3 % | 1.4 % | 0.0 % | 0.9 % |
| 3. PTDB-TUG laryngograph: gross error (> 20 %) | ≤ F-L + 1 pp | 0.0 % | 0.2 % | 0.0 % | 0.0 % |
| 3. … voicing recall | ≥ F-L − 3 pp | 100.0 % | 98.4 % | 99.0 % | 98.8 % |
| 3. … false voicing | ≤ F-L + 3 pp (≤ 7.6 %) | **13.2 %** fail | 4.1 % | 4.4 % | 4.6 % |
| 3. … best lag | within ±30 ms | +25 ms | +15 ms | +20 ms | +20 ms |
| 4. Prototype's VTLN checks (slope / sign / monotonic / leak) | all four pass | 1.156 / 0.925 / 0.800 / 0.134, pass | 1.181 / 0.938 / 0.825 / 0.015, pass | 1.183 / 0.925 / 0.850 / 0.062, pass | 1.173 / 0.938 / 0.825 / 0.154, pass |
| Meets 1–4 | | no | no | **yes** | yes |
| For information: realised pitch within 0.5 st of the request (the prototype's a1) | — | 74.1 % | 68.4 % | 74.6 % | 73.1 % |

- Check 3 used 963 reference-voiced and 3 619–3 623 reference-unvoiced 10 ms frames: `pt_m1`,
  `pt_f1` and the 4 timing clips at 8 s, analysed at 16 kHz.
- Harvest voices 13 % of the reference's unvoiced frames (477): 286 within 100 ms of voiced
  speech and 191 further out, in silence. F-S has 160, all but 3 within 100 ms of speech. WORLD
  synthesises false-voiced frames as buzz.
- DIO loses voicing on the creaky and the noisy clip (`ls_m1` 21.6 %, `ls_mn` 24.6 % of
  originally voiced hops).
- **Checks 1 and 2 cannot separate F-S from F-L.** They read the renders with the real pitch
  chain, and F-S is that chain's own posted track, F-L its replica. So both checks favour F-S
  and F-L by construction. DIO's "fail" on check 1 means it disagrees with Syrinx's voicing, not
  that it is less accurate: on the laryngograph reference (check 3) its voicing recall is
  98.4 % against F-L's 98.8 %. **Check 3 is the only independent accuracy check.** The
  selection still stands: F-S and F-L were separated on cost, and F-H failed check 3.
- **F-S alignment:** the lag that best aligns the mapped F-S track with the mapped F-L track is
  0 ms (1 ms steps, ±20 ms). Pass (±5 ms); no correction.
- **Parity for every front end (an addition to §P3):** pyworld 0.3.5 rendered the same 8 clips ×
  26 cells with each front end, with the mappings rewritten in numpy. Finished renders agree
  with the WebAssembly ones to ≥ 142.9 dB SNR. On the meters, every Level 3 criterion passes for
  all four front ends: clip medians identical, voicing agreement 100 %, VTLN readings within
  6e-8 ln, the four VTLN checks identical (largest statistic difference 7e-8).
- Check 5 (Harvest and DIO against pyworld) passed in the Build step (Level 1).

**Render quality at 22.05 and 24 kHz (addition after review; `fe/rate-check.mjs`,
`fe/rate_score.py`).** Checks 1–4 above ran on 16 kHz renders only, while §P6's rule takes the
highest passing rate. So checks 1, 2 and 4 were re-run with F-S at all three rates, on the same
48 kHz sources: the 4 speech-dense clips at 5 s and the 4 pre-registered timing clips at 8 s,
26 cells each (624 renders). Pitch is read at each render's own rate; the VTLN meter (16 kHz
input) reads each render brought to 16 kHz with the same sinc resampler. Judged against 16 kHz
with §P4's margins (post hoc: 16 kHz is the baseline here).

| Rate | 1. Voicing loss at (0, 1.00), median of 8 | 2. Gross errors, median of 163 eligible (p90) | 4. VTLN slope / sign / monotonic / leak | Holds |
|---|---|---|---|---|
| 16 000 | 1.4 % | 0.0 % (1.3 %) | 1.106 / 0.987 / 0.846 / 0.103, pass | (baseline) |
| 22 050 | 1.1 % | 0.0 % (1.6 %) | 1.121 / 1.000 / 0.895 / 0.128, pass | yes |
| 24 000 | 1.4 % | 0.0 % (1.3 %) | 1.095 / 0.974 / 0.842 / 0.041, pass | yes |

So **a higher rate is not worse on these checks**, which is what the rate rule assumes. One clip
varies most: speech-dense M02 loses 6.1 / 12.2 / 8.2 % of its voiced hops at 16 / 22.05 /
24 kHz; the medians do not move. 1–2 of the 40 VTLN rows per rate have fewer than 10 readable
bins and are left out, as in check 4.

### Desktop timing (§P5) — desktop only, not the gate

**On this desktop, WORLD (SIMD build, F-S, 5 ms frames) analyses a 5 s phrase and makes the first
render in 0.36–0.40 s (median), and re-renders in 0.11 s. The gate (3 s / 1 s) would hold on a
phone up to about 6× slower than this desktop at every rate, and up to 4.8× on speech-dense
clips at 24 kHz.** These are desktop numbers; only
the phone session decides.

**Conditions.**
- Headless Chrome for Testing 154.0.8037.57, with a fresh browser context per run.
- i9-11900K (8 cores, 16 threads), Windows 11. The machine was shared with other heavy jobs:
  whole-machine CPU was 46–51 % busy (median per group) through the Chrome matrix.
- The resource governor suspended the runs 5 times (gaps of 1–6 min in the load log,
  23:10–23:45 UTC). The 8 runs that overlapped a suspension are excluded
  (`timing/analyze.mjs`).
- Single measurements of up to 5.1 s from shorter stalls remain in the maxima and in a few
  worst-clip p90s, such as PSOLA at 22.05 kHz (0.64 s). They do not move the medians.
- Split halves (repeats 0–4 vs 5–9) agree within 10 % on every group median, and within 5 % on
  most.
- 1 080 runs: 10 per (configuration, rate, length, clip). Each run = C0, cold G1, 20 × G2, 5 ×
  warm G1. Pre-registered timing clips.

**WORLD, SIMD build, F-S, 5 ms frames** (the gate configuration). Seconds per phrase; in
brackets, ms per second of audio.

| Rate | Length | C0 median | Cold G1 median (IQR) | Cold G1 worst-clip p90 | Cold G1 min | G2 median | G2 worst-clip p90 | Warm G1 median | Wasm memory |
|---|---|---|---|---|---|---|---|---|---|
| 16 000 | 3 s | 0.04 | 0.18 (0.17–0.20) [61] | 0.21 | 0.15 | 0.07 [24] | 0.09 | 0.13 | 16 MB |
| 16 000 | **5 s** | 0.04 | **0.36** (0.34–0.38) [71] | **0.42** | 0.32 | **0.11** [23] | **0.15** | 0.28 | 23 MB |
| 16 000 | 8 s | 0.04 | 0.51 (0.48–0.54) [64] | 0.64 | 0.44 | 0.19 [23] | 0.23 | 0.41 | 38 MB |
| 22 050 | 3 s | 0.03 | 0.19 (0.17–0.20) [62] | 0.22 | 0.15 | 0.07 [24] | 0.09 | 0.13 | 16 MB |
| 22 050 | **5 s** | 0.04 | **0.39** (0.37–0.41) [77] | **0.44** | 0.34 | **0.11** [23] | **0.15** | 0.31 | 28 MB |
| 22 050 | 8 s | 0.04 | 0.54 (0.51–0.57) [67] | 0.62 | 0.47 | 0.19 [24] | 0.24 | 0.45 | 38 MB |
| 24 000 | 3 s | 0.03 | 0.19 (0.18–0.19) [62] | 0.23 | 0.15 | 0.07 [25] | 0.09 | 0.13 | 16 MB |
| 24 000 | **5 s** | 0.03 | **0.40** (0.37–0.42) [79] | **0.50** | 0.34 | **0.11** [23] | **0.15** | 0.32 | 28 MB |
| 24 000 | 8 s | 0.03 | 0.57 (0.53–0.58) [71] | 0.69 | 0.46 | 0.19 [23] | 0.25 | 0.47 | 46 MB |

- **Where the time goes** (cold G1, 5 s, 16 kHz, medians):
  - resample 28 ms;
  - mapping the F-S track 1 ms;
  - StoneMask 15 ms;
  - CheapTrick 79 ms;
  - D4C 90 ms;
  - first render 144 ms (warp 23, synthesis 118, finish 4).

  A slider change is warp 17 + synthesis 96 + finish 1 ms. Messaging and `AudioBuffer` creation
  add almost nothing.
- **The per-change cost does not depend on the rate.** WORLD synthesises pulse by pulse, with
  the same 1024-point FFT at all three rates.
- **Silence is cheap to analyse but not to render.** The 3 s clips are almost all silence, so
  StoneMask and D4C take 1–4 ms. WORLD synthesises unvoiced stretches with 500 Hz pulses.
- **Memory after analysing 8 s at 24 kHz: 46 MB** of WebAssembly memory (§P5).

**Other configurations, 5 s, desktop Chrome** — cold G1 median / G2 median, in seconds:

| Configuration | 16 000 Hz | 22 050 Hz | 24 000 Hz | Passes the gate on a phone up to (16 / 22.05 / 24 kHz) |
|---|---|---|---|---|
| **WORLD SIMD, F-S** | 0.36 / 0.11 | 0.39 / 0.11 | 0.40 / 0.11 | ×6.5 / ×6.8 / ×6.1 |
| WORLD non-SIMD, F-S | 0.38 / 0.12 | 0.41 / 0.12 | 0.43 / 0.12 | ×6.2 / ×5.5 / ×6.0 |
| WORLD SIMD, F-S, 10 ms frames | 0.27 / 0.10 | 0.28 / 0.10 | 0.29 / 0.10 | — (not gating) |
| WORLD SIMD, F-D | 0.39 / 0.11 | 0.40 / 0.11 | 0.44 / 0.11 | ×6.7 / ×6.1 / ×5.9 |
| WORLD SIMD, F-L | 0.56 / 0.11 | 0.61 / 0.11 | 0.63 / 0.11 | ×4.3 / ×4.1 / ×4.0 |
| WORLD SIMD, F-H | 1.64 / 0.11 | 1.64 / 0.11 | 1.70 / 0.11 | ×1.5 / ×1.4 / ×1.3 |
| PSOLA, F-S | 0.21 / 0.16 | 0.28 / 0.22 | 0.30 / 0.24 | ×5.3 / ×3.8 / ×3.5 |

The last column is the largest desktop-to-phone slowdown at which all four §P6 conditions would
still hold. It is the smallest of 3 s ÷ median cold G1, 3 s ÷ worst-clip p90 cold G1,
1 s ÷ median G2 and 1 s ÷ worst-clip p90 G2.

- **SIMD gains little:** 5–8 % on cold G1 and 0.01 s on G2.
- **The 10 ms frame lever** cuts cold G1 by 25–28 % and G2 by 0.01 s. Its cost is spectral:
  the unchanged rebuild moves from 5.8–6.3 dB from the clip at 5 ms to 6.2–6.8 dB at 10 ms
  (log-spectral distance), so **+0.4–0.5 dB is the useful number.** The distance between the
  10 ms and 5 ms renders themselves (4.8 dB median, p90 5.3 dB, all three rates) is not a
  quality measure. WORLD's synthesis reseeds its noise generator on every call
  (`synthesis.cpp`, `randn_reseed` at the start of `Synthesis()`), so renders are deterministic,
  but the noise is drawn per frame, so its realisation changes with the frame period. (Revised
  after review: an earlier wording said the noise "differs between any two renders".) The lever
  is reported only (§P6).
- **Front-end selection (§P4):** among the two front ends that meet checks 1–4, F-S costs
  0.36 s and F-L 0.56 s (cold G1, 5 s, 16 kHz). F-S is 36 % cheaper, so **F-S is selected.**
  F-L's extra 0.24 s is the lab pitch replica running over the clip.

**Speech-dense clips** (deviation 8; the same speakers with the leading silence trimmed; WORLD
SIMD F-S at 5 and 8 s, PSOLA F-S at 5 s; 10 runs per clip; machine 35–41 % busy, median per
group):

| Speech-dense clips, Chrome | Cold G1 median (worst-clip p90) | G2 median (worst-clip p90) | Passes the gate on a phone up to |
|---|---|---|---|
| WORLD SIMD F-S, 16 000 Hz, 5 s | 0.37 (0.46) s | 0.09 (0.14) s | ×6.5 |
| WORLD SIMD F-S, 22 050 Hz, 5 s | 0.42 (0.55) s | 0.09 (0.16) s | ×5.4 |
| WORLD SIMD F-S, 24 000 Hz, 5 s | 0.43 (0.63) s | 0.09 (0.14) s | ×4.8 |
| WORLD SIMD F-S, 16 000 Hz, 8 s | 0.58 (0.76) s | 0.14 (0.24) s | ×3.9 |
| WORLD SIMD F-S, 22 050 Hz, 8 s | 0.68 (0.90) s | 0.15 (0.27) s | ×3.3 |
| WORLD SIMD F-S, 24 000 Hz, 8 s | 0.71 (0.91) s | 0.15 (0.25) s | ×3.3 |
| PSOLA F-S, 16 000 / 22 050 / 24 000 Hz, 5 s | 0.20 (0.25) / 0.25 (0.34) / 0.27 (0.37) s | 0.14 (0.19) / 0.19 (0.25) / 0.21 (0.28) s | ×5.4 / ×4.0 / ×3.5 |

- **With more speech in the clip, analysis takes 21–28 % longer at 5 s, and its worst-clip p90
  33–53 % longer** (16 / 22.05 / 24 kHz: median +21 / +28 / +23 %, p90 +33 / +39 / +53 %),
  compared with the repeat of the gate cells, which ran at a similar machine load (36–37 %
  busy against 35–41 % here). A slider change takes 7–9 % less. D4C analyses voiced frames
  only: 139 / 180 / 197 ms here, against 78 / 97 / 114 ms on the pre-registered clips in the
  repeat run. Synthesis has fewer 500 Hz pulses to render in silence. (Corrected after review:
  the earlier "3–8 % longer" compared this run with the main run, which ran at 48 % busy, so
  the machine load hid most of the difference.)
- **A real record-then-play phrase looks like the speech-dense clips**, not like 2.5 s of
  leading silence. So both sets decide the phone gate (deviation 18).
- **The worst-clip p90 first render at 24 kHz rises to 0.63 s**, so 24 kHz holds up to ×4.8
  instead of ×6.1.
- **8 s phrases with real speech hold only up to ×3.3** (worst-clip p90 first render
  0.90–0.91 s).

**Repeat of the gate cells** (pre-registered clips, 5 s, WORLD SIMD F-S and PSOLA F-S, 10 runs
per clip, run last, machine 37 % busy, median):

| Gate cells, 5 s | Repeat: cold G1 median (worst-clip p90) | Repeat: G2 median (worst-clip p90) | Main run, same cells | Passes up to: repeat / main run |
|---|---|---|---|---|
| WORLD SIMD F-S, 16 000 Hz | 0.31 (0.35) s | 0.10 (0.12) s | 0.36 (0.42) / 0.11 (0.15) s | ×8.0 / ×6.5 |
| WORLD SIMD F-S, 22 050 Hz | 0.33 (0.40) s | 0.10 (0.12) s | 0.39 (0.44) / 0.11 (0.15) s | ×7.5 / ×6.8 |
| WORLD SIMD F-S, 24 000 Hz | 0.35 (0.41) s | 0.10 (0.13) s | 0.40 (0.50) / 0.11 (0.15) s | ×7.3 / ×6.1 |
| PSOLA F-S, 16 000 / 22 050 / 24 000 Hz | 0.18 / 0.25 / 0.26 s | 0.14 / 0.19 / 0.21 s | 0.21 / 0.28 / 0.30 and 0.16 / 0.22 / 0.24 s | ×6.3 / ×4.4 / ×4.2 against ×5.3 / ×3.8 / ×3.5 |

With the machine at 37 % busy instead of 48 %, the medians are 12–15 % lower. The main run is
the slower of the two, and the predictions below use it.

**Predicted phone result (a prediction, not a measurement; revised after review).** Phone time
is taken as desktop Chrome time × a slowdown factor. The prediction uses **×2.0**, the only ratio
this repository has measured for CPU-bound code like this on the session phone: the JavaScript
resonance worker on the Pixel 11 Pro XL, Chrome 154 (84–96 against ~46 ms of CPU per audio
second; `resonance-cue-cpu-2026-10-07.md`). WORLD runs WebAssembly, not JavaScript, so even this
factor is borrowed.

**Stress cases only:** ×2.4 and ×4.5 are desktop-to-Pixel-8-Pro ratios for ML inference
(ECAPA-TDNN and wav2vec2-base) from the May 2026 gender-model work. INVESTIGATIONS.md calls them
WebAssembly ratios, but `gender-model-latency-2026-07-19.md` §1 found that the mobile figures
behind them were WebGPU numbers, and that mobile WebAssembly was never measured. The same arc
also recorded ~21× for wav2vec2-large. None of these is a CPU ratio for code like WORLD's.
(Corrected after review: an earlier version labelled ×2.4 and ×4.5 as WebAssembly ratios and
called 4.5 the slowest factor this repository had measured.)

| 5 s phrase, cold G1 / G2 median (worst-clip p90) | ×2.0 (prediction) | ×4.5 (stress) | Desktop margin ("passes up to") |
|---|---|---|---|
| WORLD 24 kHz, pre-registered clips | 0.79 (0.99) / 0.23 (0.29) s | 1.78 (2.23) / 0.51 (0.66) s | ×6.1 |
| WORLD 24 kHz, speech-dense clips | 0.85 (1.26) / 0.18 (0.29) s | 1.92 (2.83) / 0.41 (0.65) s | **×4.8** |
| WORLD 22.05 kHz, pre-registered / speech-dense | 0.77 (0.89) / 0.23 (0.29); 0.85 (1.11) / 0.18 (0.31) s | 1.74 (2.00) / 0.51 (0.66); 1.91 (2.49) / 0.40 (0.70) s | ×6.8 / ×5.4 |
| WORLD 16 kHz, pre-registered / speech-dense | 0.71 (0.84) / 0.23 (0.31); 0.74 (0.92) / 0.18 (0.28) s | 1.60 (1.89) / 0.51 (0.69); 1.67 (2.07) / 0.40 (0.63) s | ×6.5 / ×6.5 |
| PSOLA 24 kHz, pre-registered / speech-dense (only if WORLD fails) | 0.60 (0.71) / 0.48 (0.57); 0.53 (0.74) / 0.42 (0.57) s | 1.35 (1.60) / 1.08 (1.28); 1.20 (1.67) / 0.95 (1.28) s: fails (G2) | ×3.5 / ×3.5 |

- **Predicted outcome: WORLD at 24 kHz**, the highest rate, on both clip sets. At ×2.0 the
  binding number is the speech-dense worst-clip p90 first render, 1.26 s against 3 s. The
  desktop margin with both sets deciding is ×4.8 at 24 kHz, ×5.4 at 22.05 kHz and ×6.5 at
  16 kHz, so the phone could run 2.4× slower than the ×2.0 prediction and 24 kHz would still
  pass. C0 (0.03–0.04 s here) stays far below 3 s at any of these factors.
- **8 s phrases** (reported, not gating): WORLD 24 kHz passes up to ×4.0 on the pre-registered
  clips and ×3.3 on the speech-dense clips. At ×2.0 they pass. Phase 1 should cap recordings if
  a phone runs slower than about ×3.
- **Caveats:**
  - The desktop was about half loaded, so these times are slower than a quiet desktop's. How
    loaded the desktop was when the factor was measured is not recorded consistently.
  - The factor comes from another workload (JavaScript, not WebAssembly).
  - **The session phone is a flagship** (Pixel 11 Pro XL, Tensor G6; deviation 20). A pass
    there says little about mid-range phones, which are much slower. The phone summary reports
    its own "passes up to ×N slower than this phone" margin beside the verdict. If that margin
    is small (under ×2), Phase 1 needs a mid-range phone check or a recording-length cap.
  - **WORLD ran alone.** In the app, the DSP, pitch, gender (WebAssembly, about 6 inferences per
    second) and lab workers may still run while the preview analyses, if listening continues.
    Phase 1 should pause the pipeline during analysis, or time one phone block with it running.
  - Thermal throttling and Android's scheduling of a background Worker are not modelled.

### Hum and noise (§P7)

**First, as §P7 requires: with hum inside the pitch range, WORLD adds a tonal peak.** This is a
labelled addition after review: §P7's pre-registered hum conditions are 50 / 60 Hz mains
stacks, whose fundamentals sit below the 75 Hz pitch floor. **WORLD's "no added peak" result
below holds for mains hum and broadband noise only. By §P7's rule, the engine question is
reopened for rooms with in-range hum.**

**In-range tonal noise (addition after review; `hum/make_tonal_conditions.mjs`, `hum-run.mjs
--index=index-tonal.json`).** The repository's own noise classes (`scripts/noise-synth.js`):
fan hum (120 Hz + 240 / 360 Hz over low-passed rumble) and mains complex (60 / 120 / 180 / 240 Hz,
prominent 180 Hz). Each at −40, −30 and −20 dB on the four base clips (24 conditions), plus a
24 kHz spot check (`pt_m1`, `pt_f1` from 48 kHz, both classes at −20 dB). Same cells, measures
and scoring as §P7 (`hum_score.py --index index-tonal.json`).

| Recording only (F-S from the recording, as §P7) | Fan hum, WORLD | Fan hum, PSOLA | Mains complex, WORLD | Mains complex, PSOLA |
|---|---|---|---|---|
| Pause hops the chain posts voiced, in the original-with-noise | 20–72 % (median 120 Hz) | same | 0–1 % | same |
| Shifted renders (16 kHz) that add a ≥ 9 dB peak | **47 of 48** | 47 of 48 | 0 of 48 | 32 of 48 |
| Added peaks, by label | all 87 at the hum × the pitch step (9–29 dB) | 65 hum × step, 9 hum × scale, 72 other | none | 15 hum × step, 5 hum × scale, 88 other |
| 24 kHz spot check: shifted renders with an added peak | 8 of 8 (hum × step, 10–27 dB) | 8 of 8 | 0 of 8 | 5 of 8 |
| Speech hops: voicing loss vs the clean-clip render, median (p90), men / women | 1.3 (4.5) / 0.0 (1.4) % | 4.3 (12.2) / 0.4 (2.7) % | 3.0 (7.3) / 1.4 (2.8) % | 3.4 (10.5) / 1.1 (3.7) % |

- **Fan hum:** the chain voices the hum in pauses, F-S passes that voicing to WORLD, and WORLD
  resynthesises the pauses as a pitched sound at the shifted hum frequency. For example, on
  `pt_f1` at −30 dB the original pauses are voiced on 72 % of hops at 120 Hz; at +6 st / ×1.12
  WORLD adds peaks at 169.9 Hz (27.3 dB) and 339.8 Hz (12.5 dB), at −6 st / ×0.88 at 84.0,
  169.9 and 253.9 Hz (27.3, 20.6, 12.7 dB). The unchanged cell adds nothing, because the hum
  stays where it was; the one shifted render without an added peak is the smallest case
  (`ls_m2`, −40 dB, +2 st, largest pause peak 14.3 dB). This is the failure the scoping held
  against Signalsmith. The listener hears the room hum move with the pitch slider.
- **Mains complex:** the chain leaves its pauses unvoiced (the 60 Hz periodicity is below the
  floor), so WORLD renders them as noise, as with mains hum.
- **PSOLA** keeps the hum and adds peaks in both classes, so it is no way out.
- **Recording checks:** the level check (d2) measures fan hum at −30 dB as 37.0–39.0 dB and at
  −40 dB as 47.0–48.5 dB, inside the clean clips' 39.1–60.1 dB. Neither the pre-registered 25 dB
  nor the post hoc 35 dB threshold flags them (35 dB flags the −20 dB conditions only). The
  notch on the recording alone (d1, "rec") flags 3 of the 8 conditions at −20 dB and none
  below, 5.5 s in. **The notch after a 10 s pre-roll (d1, "live") flags all 24 conditions
  and no clean clip: the only adequate check for in-range hum.**
- **Mitigation tested: listen before recording.** With F-S taken from the chain after 10 s of
  the hum alone (`--track=live`; the notch promotes 4.5 s before the recording starts, and its
  ghost veto unvoices decodes on and near the notched lines), **no WORLD render adds a peak** in
  any fan or mains-complex condition (0 of 120 at 16 kHz, 0 of 20 at 24 kHz), and the pause
  voiced share rises by at most 4.4 pp. **The cost is men's voicing:** the ghost veto also
  unvoices voice within 2 % of a notched line or its octave, and WORLD renders those frames as
  noise. Speech-hop voicing loss is 14.9 % (p90 27.5 %) for men with fan hum and 18.2 % (p90
  24.2 %) with mains complex, against 1.3–3.0 % from the recording alone; women 2.7–6.4 %.
- **For Phase 1** (not decided here): (a) ask for ~6 s of listening before recording, and warn
  when the notch has an active line (the hum is in range), suggesting a quieter spot; (b) the
  same, plus unvoicing F-S frames on notched lines only in pauses (not tested); (c) accept the
  shifted hum. The level check cannot replace (a).

**Mains hum and pink noise (the pre-registered conditions).** WORLD with F-S adds no tonal peak
in pauses and does not raise the pause voiced share in any of these conditions. It turns the hum
in pauses into noise. PSOLA keeps the hum and, in about half of its hum renders, moves some of it
to new frequencies.

160 WORLD and 160 PSOLA renders at 16 kHz: 4 base clips × 8 hum / noise conditions × 5 cells,
plus the clean conditions. The F-S track is the real pitch chain's posted track on the noisy
clip, from the recording alone (worst case: the chain had not heard the hum before).

| Measure (median over renders unless stated) | WORLD, hum (120) | PSOLA, hum (120) | WORLD, pink noise (40) | PSOLA, pink noise (40) |
|---|---|---|---|---|
| m1 pause voiced share, rise over the same cell from the clean clip | 0.0 pp (max +4.8) | −1.0 pp (max +1.0) | −0.5 pp (max +1.0) | 0.0 pp (max +2.2) |
| m2 largest peak in pauses (original-with-noise: 29.8 dB hum, 6.5 dB pink) | 5.0 dB | 28.5 dB | 4.2 dB | 7.1 dB |
| m2 renders that add a ≥ 9 dB peak | **0** | 53 | **0** | 1 |
| m3 speech hops: voicing loss vs the clean-clip render (median / p90) | 1.3 % / 5.3 % | 2.6 % / 10.5 % | 2.0 % / 5.7 % | 4.0 % / 14.9 % |
| m3 speech hops: median pitch difference | 0.005 st | 0.021 st | 0.016 st | 0.036 st |
| m3 VTLN reading shift, \|median\| / p90 | 0.005 / 0.022 ln | 0.005 / 0.019 ln | 0.025 / 0.095 ln | 0.032 / 0.074 ln |

- **Pauses:** 2.2–4.9 s per clip by the pre-registered rule. In the original-with-hum the pauses
  carry the hum's harmonics at 21–37 dB. In WORLD renders, the largest peak in the pauses is
  3.6–7.7 dB for every hum condition and every cell. The pitch chain posts pitch on at most 2 % of
  the original's pause hops, so F-S calls the pauses unvoiced and WORLD synthesises them as
  shaped noise.
- **PSOLA's added peaks** (115 in 53 renders): 7 at the hum's own harmonics (weaker
  harmonics that crossed 9 dB), 11 at the hum × the pitch step, 4 at the hum × the formant
  scale, 93 elsewhere.
- **The peak rule's own false positives:** on the clean clips, WORLD "adds" 2 peaks on `ls_f1`.
  That clip's pauses are digital silence (its level margin is 182 dB), so any synthesis noise
  makes peaks. No hum or noise condition triggers.
- **Large VTLN shifts** (up to 0.18 ln) occur only on `pt_m1` at −6 st / ×0.88. There the reading
  rests on 12–15 non-null 150 ms bins, close to the 10-bin minimum, and the shifted pitch is
  near the 75 Hz floor.
- **24 kHz spot check** (`pt_m1`, `pt_f1` from 48 kHz, 60 Hz hum at −20 dB): the same as at
  16 kHz. WORLD has no added peak and a largest pause peak of 4.6–5.5 dB; PSOLA keeps the hum
  (35.0–35.5 dB) with 19 added peaks. The pause voiced share rises by at most +3.6 pp.
- **`ls_m1`, the natural ~59.5 Hz hum:** no hop meets the 35 dB pause rule, because the hum keeps
  every pause within about 21 dB of the speech peaks. So m1 and m2 are undefined there. With a
  post hoc 20 dB rule (0.8 s of pause), the hum's 25.9 dB peak at 178 Hz drops to 7.7–9.7 dB in
  WORLD renders, and stays at 23–25 dB in PSOLA renders.

**Recording-check candidates.** No condition triggers: no WORLD render adds a tonal peak or
raises the pause voiced share by more than 5 pp. So the pre-registered adequacy test is
vacuous. Every candidate "passes" it, because none flags a clean clip.

| Candidate | Hum −40 / −30 / −20 dB (8 conditions each) | Pink +20 / +10 dB (4 each) | `ls_m1` natural hum | Clean set (9) | Speech-dense timing clips (4, extra) |
|---|---|---|---|---|---|
| d1 notch, recording only | 0 / 0 / 3 | 0 / 0 | no | none | none |
| d1 notch, "live" (10 s pre-roll) | 8 / 8 / 8 | 0 / 0 | not run | none | none |
| d2 level margin < 25 dB (pre-registered) | 0 / 0 / 0 | 0 / 4 | yes (20.8 dB) | none | none |
| d1 live OR d2 | 8 / 8 / 8 | 0 / 4 | yes | none | none |

- **d1, the notch:** with the pre-roll it promotes 5.5 s into the hum, so it is active for the
  whole recording in every hum condition. Recording only, it flags 3 of the 8 −20 dB conditions,
  5.5 s in. So it cannot flag a recording shorter than 5.5 s on its own.
- **d2, the level margin:** clean clips measure 39.1–60.1 dB (`ls_f2` lowest; the
  pre-registered timing clips 49.3–60.1 dB; the speech-dense ones 40.7–54.1 dB). Hum
  at −20 dB measures 26.8–28.9 dB, and pink noise 29.0–31.3 dB at +20 dB SNR and 19.1–21.5 dB at
  +10 dB SNR.
  - **Post hoc** (chosen after seeing the data): a 35 dB threshold would flag every −20 dB hum
    and every pink-noise condition, and no clean clip.
  - Hum at −30 and −40 dB (36.8–48.8 dB) overlaps the clean clips, so a level check cannot
    catch it. The notch can, if the app has been listening for 5.5 s before the recording.
- **For Phase 1 (revised after review):** with WORLD, *mains* hum left the preview's pauses
  and meters almost unchanged, and broadband noise moved the speech meters most (VTLN shift p90
  0.095 ln, against 0.022 ln for mains hum). A level check (d2) is the useful warning for
  broadband noise. It is not enough for hum inside the pitch range, which only the notch catches,
  and only if the app has been listening for about 5.5 s before the recording starts (see the
  in-range results above). (An earlier version said WORLD did not need a recording check for
  hum and that the level check was the more useful warning; that held for mains hum only.)

### Cross-browser (§P8)

| Browser | Status | Output vs Node | WORLD SIMD F-S, 5 s: cold G1 / G2 median (16 / 22.05 / 24 kHz) | PSOLA F-S, 5 s |
|---|---|---|---|---|
| Desktop Chrome for Testing 154.0.8037.57, headless | measured (§ Desktop timing) | bit-identical, 18 of 18 | 0.36 / 0.11, 0.39 / 0.11, 0.40 / 0.11 s | 0.21 / 0.16, 0.28 / 0.22, 0.30 / 0.24 s |
| Desktop Firefox 156.0.1, headless, puppeteer-core | measured: 5 runs per clip, 180 runs, no errors | bit-identical, 18 of 18 | 0.26 / 0.09, 0.29 / 0.09, 0.30 / 0.09 s | 0.08 / 0.05, 0.10 / 0.06, 0.10 / 0.07 s |
| Android Chrome on the phone | **not yet**: the phone session | — | — | — |
| iOS Safari | **untested**: no device | — | — | — |

- **Firefox details:**
  - Non-SIMD WORLD: 0.27 / 0.30 / 0.32 s cold G1 and 0.09 s G2.
  - C0 was 0.03 s.
  - It ran inside one page load, with a fresh Worker and unique URLs per run (deviation 4).
  - The machine was less loaded during the Firefox run (25–30 % busy against 46–51 % for
    Chrome), so the two browsers are not compared like for like.
  - Every condition holds in Firefox with the same margin as in Chrome or more.
- **Both builds use only baseline WebAssembly features** (§ Build). The page picked the SIMD
  build in both desktop browsers.

### Listening set (§P9)

Ten WAVs and a plain-language `index.md`, written to the session scratchpad (`spike-listen/`),
not to this repository (`listen/make-listen.mjs`):
- M01 and F01 at 5 s, from the speech-dense clips (deviation 9);
- the 48 kHz originals;
- WORLD (WebAssembly SIMD, F-S) at 16 and 24 kHz, each as the unchanged rebuild and as one small
  step (M01 +2 st / ×1.03, F01 −2 st / ×0.97);
- RMS-matched and peak-limited as `finish`, with 10 ms fades, as 16-bit WAV.

The question for the user is unchanged: does 24 kHz sound better than 16 kHz, by enough to
matter? Not yet answered.

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

**Decision (Measure step).** The pre-registered rule is kept, and its clips remain the primary
timing set. A speech-dense set was added beside it (deviation 8). The speech-dense set has the
larger worst-clip p90 at 24 kHz (0.63 against 0.50 s), so it is the stricter test. The phone
session times both at 5 s.

**Revised after review (2026-10-12).** At equal machine load the speech-dense clips take
21–28 % longer to analyse, not 3–8 % (§ Desktop timing), and a real phrase looks like them. So
both sets decide the phone gate: a rate passes only if it passes on both (deviation 18).

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

Measure step (2026-10-12):

8. **A speech-dense clip set beside the pre-registered timing clips.** The pre-registered clips
   start with about 2.5 s of PTDB-TUG's leading silence (see the note above). The
   pre-registered rule is kept, and its clips stay the primary timing set. A second set
   (`clips/timing-speech`, `prep/prep_speech_clips.py`) uses the same speakers and files, each
   trimmed to its laryngograph-voiced span ± 0.3 s before joining. Its 5 s cuts are 49–71 %
   voiced, against 29–36 % for the pre-registered cuts. It was timed in desktop Chrome
   (WORLD with the selected front end at 5 and 8 s, PSOLA at 5 s). It is also the source of the
   listening set. The phone session should time both sets at 5 s.
9. **Listening set from the speech-dense clips** (§P9 names the pre-registered 5 s clips), so
   the user hears 5 s of speech rather than 2.5 s of silence first. Everything else is as
   planned.
10. **F-L in the front-end comparison** is this branch's lab replica grid (`proto16/<clip>.grid.f32`),
    the same front end the timing page runs. The prototype's stored grid (the Level 2 input)
    comes from main 134bb34.
11. **Front-end check 3, details the plan left open:**
    - scored at 16 kHz, the selection rate;
    - reference frame j taken at the file's start + j × 10 ms;
    - lags in 5 ms steps (WORLD's frame period); "best" = most reference-voiced frames within
      20 %, chosen per front end over all files.
12. **Selection measure.** "Preview-time analysis cost" is the median cold G1 (analysis + first
    render) in desktop Chrome, 5 s clips, 16 kHz. The first render is the same work for every
    front end.
13. **Hum and noise, F-S track:** the posted track comes from the real pitch chain on the noisy
    clip alone, as if the app started listening when the recording started. That is the worst
    case for the notch and the ghost veto.
14. **Hum and noise, details the plan left open:**
    - A pause hop's energy is taken over 25 ms centred on the hop's window centre.
    - Pause samples are the maximal runs of consecutive pause hops, joined in order.
    - A "peak" is a local maximum ≥ 9 dB, in both the render and the original-with-noise.
    - The noise pre-roll uses the same pink recipe with seed 3, at the clip's noise level.
    - The hum's pre-roll continues the same sinusoids from t = −10 s.
    - Clean clips get 10 s of zeros as their "live" pre-roll.
    - `ls_m1` has no "live" run, because there is no hum-alone source.
15. **d1 on 48 kHz clips** (timing clips, 24 kHz spot check): the notch is fed through the pitch
    worker's own resampler (`createStreamingResampler`), in 1200-sample chunks.
16. **Additions not in the plan:**
    - Levels 2–3 parity for every front end (`parity/pyworld_fe.py`).
    - A machine-load log during the timing runs.
    - Per-run start times on the timing page.
    - A `clipset` page parameter.
    - For the 10 ms lever: the unchanged rebuild's spectral distance to the clip, for scale.
    The 10 ms lever's spectral distance uses a 32 ms Hann window and a 10 ms hop at each rate,
    because the plan named no STFT.
17. **Firefox** ran the matrix inside one page load: a fresh Worker and unique URLs per run, but
    no fresh browser context (deviation 4).

Review (2026-10-12), before the phone session:

18. **Both timing clip sets decide the phone gate.** §P6 names 5 s phrases on the
    pre-registered timing clips, which start with about 2.5 s of silence. At equal machine load
    the speech-dense clips (deviation 8) take 21–28 % longer to analyse, and a real recording
    looks like them. So §P6's four conditions are applied to each set, and an engine passes at a
    rate only if it passes on both: the stricter result decides. Decided before any phone
    number exists, and only in the stricter direction. The phone harness times both sets (WORLD
    on both before PSOLA), tags each run with its `clipset`, and prints the gate per set and
    combined.
19. **A pointer line above the status line** ("Results follow the plan …"). The status line
    still reads "plan only", as committed in 7487aea; no plan sentence changed.
20. **The phone is a Pixel 11 Pro XL** (Tensor G6, Android 17, Chrome 154.0.8037.127), not the
    Pixel 8 Pro that §P5 names: that is the phone available for the session. It is a current
    flagship, so a pass covers phones as fast or faster only. The phone summary reports its
    measured margin ("passes up to ×N slower than this phone") beside the verdict, and flags a
    margin under ×2: then Phase 1 needs a mid-range phone check or a recording-length cap.
21. **Phone order:** all WORLD blocks run before PSOLA, so a short session still finishes
    WORLD's gate. On the desktop `matrix.js` interleaves the engines within each repeat.
    Battery temperature is recorded per run, so any drift between the blocks can be checked.
22. **Additions after review**, each labelled where reported: in-range tonal noise in §P7 (fan
    hum, mains complex; `make_tonal_conditions.mjs`) and a "listen first" F-S track
    (`hum-run.mjs --track=live`); checks 1, 2 and 4 at 22.05 and 24 kHz (`fe/rate-check.mjs`);
    three more identity cases with the gate configuration (F-S at 24 and 22.05 kHz, PSOLA with
    F-S); a `clipset` field on every timing-page run row. The pre-registered hum outputs
    (`detect.json`, `scores.json`, `vtln.jsonl`) were checked unchanged by hash after the new
    runs, and re-scoring them with the extended `hum_score.py` reproduces them.

## Review notes

Two reviews of the branch at 8cfe0c1 (2026-10-12). Both found the core results reproducible:
WORLD's parity with pyworld, the build pins and byte-identical rebuild, the PSOLA port and the
desktop timing. What changed in response:

| Finding | Severity | What was done |
|---|---|---|
| The hum test covered only sub-75 Hz mains hum; in-range tonal noise breaks "WORLD adds no tonal peak" | high | Holds. Fan hum and mains complex added to §P7 as a labelled addition; the result is reported first (Results status and § Hum and noise); the hum verdict and the Phase 1 advice now say they hold for mains hum only; the "listen first" mitigation was tested (it removes the shifted hum and costs men 15–18 % of voiced hops) |
| The phone harness was set to F-L, not the selected F-S | high | Holds. `selected-fe.txt` now says S; the harness reads the front end the note selects ("**Selected: F-X") and refuses to start when they differ; the START scripts print the front end in use. (The phone harness is scratch tooling outside this repository.) |
| The pre-registered clips understate analysis cost; the "3–8 %" comparison was confounded by machine load | medium | Holds. Corrected to 21–28 % (p90 33–53 %) at equal load; both clip sets now decide (deviation 18); the timing page tags rows with `clipset`, the phone harness times both sets and the gate filters on it; the phone site is rebuilt from this commit |
| ×2.4 and ×4.5 are mislabelled; 4.5 is not the slowest factor measured | medium | Holds. The prediction now uses ×2.0 only; ×2.4 / ×4.5 are labelled WebGPU-era ML-inference ratios and shown as a stress case; the "slowest factor" claim is gone and the ~21× is cited. INVESTIGATIONS.md still calls the ratios "WASM"; that file is outside the spike's scope and is left unchanged |
| The gate runs on a flagship (Tensor G6), not the Pixel 8 Pro | medium | Holds. Deviation 20; the phone summary prints its margin and flags a margin under ×2 |
| Front-end checks 1–2 are circular for F-S and F-L | low | Holds. Stated in § F0 front ends; check 3 is the only independent accuracy check; the selection stands |
| Render quality checked at 16 kHz only | low | Holds. Checks 1, 2 and 4 re-run at 16 / 22.05 / 24 kHz: no rate is worse (§ F0 front ends) |
| Identity cases skip F-S and 22.05 kHz | low | Holds. Three cases added; 36 of 36 bit-identical in Chrome and Firefox; the phone checks the same 36 |
| Timing ran with WORLD alone | low | Holds. Stated as a caveat; Phase 1 should pause the pipeline during analysis or time it with the pipeline running |
| Stale "plan only" status; the 10 ms lever's noise sentence | low | Holds. Pointer line added (deviation 19); the lever sentence reworded (WORLD reseeds its noise per render, so renders are deterministic; the realisation changes with the frame period) |
| The desktop timing server could crash on a malformed %-escape | low (note) | Fixed in `timing/serve.mjs` (answered as not found) |
| Phone harness: Ctrl-C under `START-both.sh` skipped the preview's clean-up; a failed restore deleted the saved phone settings; Ctrl-C during the vsync check did not stop the session; adb forward / reverse and the tab could be left behind; tab choice not newest-first; kit stale | medium / low | All hold and were fixed in the scratch harness (outside this repository): tee ignores Ctrl-C and both scripts ignore SIGPIPE; restore verifies every value and keeps the saved file unless all match; Ctrl-C during the vsync check exits; the bash clean-up removes the harness's own forward and reverse; the node handler closes its tab; the tab is the one the intent opened; the site and expected hashes were rebuilt from this branch. A dry run with a simulated Ctrl-C checks all of it |

No finding was judged wrong. One detail differs from the review's numbers: the speech-dense
analysis increase at 22.05 kHz is +28 % (0.424 against 0.333 s), not +27 %, from rounding.
