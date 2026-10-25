# Voice Shaper: optional background-noise reduction (RNNoise) — 2026-10-23

> **2026-10-25:** superseded by [voice-shaper-noise-2026-10-25.md](voice-shaper-noise-2026-10-25.md), which measures
> every candidate through the real chain (the pitch track the app posts for the *noisy* recording, held-out real
> noise, 30 / 40 dB quiet rooms, both sexes). §4 below scores the noisy mixes with the *clean* clip's track, which
> overstates the benefit; the switch is now automatic (45 dB) and re-tracks the cleaned audio.

Branch `voice-shaper-denoise`. User request: "is there a way to filter the recorded sample to
remove bg noise?" → "implement RNNoise". Public data only (the committed LibriSpeech clips,
CC BY 4.0, and seeded synthetic noise); no recording of the user's voice was used.

## 1. What shipped

- A **"Reduce background noise"** switch in the Voice Shaper card (preview block, under the
  recording-check notices), **off by default**. On: the recording is run through RNNoise 0.2 before
  the WORLD analysis; the posted pitch track, the hum / noise check and **"Original" stay the
  recording as captured** — only the engine's input changes, so "Unchanged (rebuilt)" and
  "Preview" are made from the cleaned recording.
- Switching it with a preview on screen re-analyses the same recording in the worker (no new
  recording), keeps the sliders, and renders the setting that was showing (or the newest one asked
  for meanwhile) again. The setting stays for the page visit (Discard / Record again keep it); it
  is not stored. With the noise notice showing and the switch off, the notice adds
  "“Reduce background noise” below can help."
- The module (1 440 118 B, ~1.2 MB gzip) is fetched only when the switch is first turned on —
  nothing changes for anyone who never uses it (bundle budget: entry + stylesheet +109 B gzip,
  worker chunk 6.33 KB, tab chunk 11.77 KB; `bundle-budget.mjs --base=main`).
- If the module cannot load or run, the analysis goes ahead without it, the switch turns off and
  shows "Noise reduction couldn't load, so the preview uses the recording as captured."
- Download names carry `-noise-reduced` when the preview was made from the cleaned recording.

Code: [src/voice-preview/denoise.js](../src/voice-preview/denoise.js) (loader, `denoise48`,
`denoiseClip`), [vp-worker.js](../src/voice-preview/vp-worker.js) (`denoise` message,
re-analysis), [controller.js](../src/voice-preview/controller.js) (`setDenoise`, `reanalysing`,
`denoiseError`), the card and [strings.js](../src/voice-preview/strings.js).

## 2. The module

RNNoise 0.2 (xiph/rnnoise `372f7b4b76cde4ca1ec4605353dd17898a99de38`, BSD-3-Clause, model
weights included) as compiled by the npm package `@jitsi/rnnoise-wasm` 0.2.1 (git `cb529a5`,
Emscripten 3.1.14, Apache-2.0 build scripts). The package's separate `dist/rnnoise.wasm` (112 KB)
was last rebuilt in 2022 and carries the **old** model; the RNNoise 0.2 model ships only inside
`dist/rnnoise-sync.js` as a base64 data URI. `scripts/voice-preview/extract-rnnoise.mjs` takes
those bytes out unchanged (sha256 `4f513a50…`, pinned with the package version and the sync
file's sha256 in `RNNOISE_PINS`) into `src/voice-preview/rnnoise/rnnoise.wasm`; `--check`
re-extracts and compares. The package is a devDependency only (the app never imports it).

The module is loaded without Emscripten's glue: it imports two functions (heap growth, a large
memcpy) and exports its memory and the entry points under minified names tied to these bytes
(`EXPORTS`; `tests/voice-preview/denoise-test.js` checks imports, exports and the hash).

Licences: `licenses/rnnoise/COPYING` (RNNoise's, at the pinned commit) and the package's
`LICENSE` ship in the built `THIRD_PARTY_NOTICES.txt` whenever the build contains the module
(`NON_NPM_COMPONENTS` "RNNoise"; Emscripten's text covers its emmalloc / libc routines);
THIRD_PARTY_NOTICES.md lists it. Run-time hosts unchanged (the app's own origin).

## 3. Signal path, measured

| | |
|---|---|
| frame | 480 samples at 48 kHz, int16-scaled floats (×32768 in, ÷32768 out) |
| output delay | **960 samples** (2 frames; old model 480) — `denoise48` feeds 960 zeros after the clip and drops the first 960 outputs; lag 0 against the input checked by cross-correlation at 48, 44.1 and 16 kHz |
| other capture rates | sr → 48 kHz → RNNoise → sr with the engine's zero-phase sinc resampler (`resampleClip`); length kept |
| level, clean speech | −0.10 dB (48 kHz), −0.41 / −0.52 dB (44.1 / 16 kHz) |
| state | a fresh RNNoise state per clip: deterministic, bit-identical reruns |
| WebAssembly memory | 16 MB at instantiation (old model too), in the voice-preview worker; freed with the worker on Discard / Record again |
| CPU, Node | 36.7 ms per audio second (old model 13.6) |
| CPU, desktop Chrome | 311 ms for an 8 s, 48 kHz recording (~39 ms per audio s; headless Chrome on macOS, `voice-preview-smoke.mjs --parts=denoise`) |
| phone | **unmeasured.** The VP1 gate's phone figures were 1.66 s median for an 8 s recording (analysis + first render); at a 2–4× phone slowdown RNNoise would add ~0.6–1.2 s on the first switch-on, plus the 1.4 MB download — close to the 3 s gate for 8 s recordings |

## 4. Model choice: old model vs RNNoise 0.2, through the real engine

`node scripts/voice-preview/denoise-eval.mjs` — the three committed LibriSpeech clips at 48 kHz
(`ls_woman_high`, `ls_man_low`, `ls_man_hi8_f105`) with their posted tracks, mixed with seeded
white, pink and fan-hum (120 Hz + harmonics over low-passed rumble) noise at 0 / 10 / 20 dB SNR
(active-speech level); each version's unchanged rebuild (WORLD, 0 st, 0 %) is scored against the
rebuild of the clean clip:

- **LSD**: log-spectral distance on the clean clip's speech frames (20 ms Hann, 100 Hz–8 kHz,
  each frame's bins floored 40 dB below the clean frame's peak), dB, lower = closer.
- **pause**: the rebuild's level in the clean clip's pauses, dB re its active speech (`ls_man_low`
  has no pauses). The clean rebuild's own pause level is −27.4 / −26.4 dB.

| subset (rows) | LSD raw | old | **0.2** | pause raw | old | **0.2** | 0.2 worse than raw (LSD) |
|---|---|---|---|---|---|---|---|
| all (27) | 7.56 | 3.84 | **3.87** | −11.6 | −22.8 | **−27.6** | 4 / 27 |
| white (9) | 9.72 | 4.43 | 4.18 | −10.5 | −18.4 | −29.4 | 0 / 9 |
| pink (9) | 9.40 | 4.20 | 4.36 | −12.1 | −27.4 | −28.2 | 0 / 9 |
| fan (9) | 3.57 | 2.88 | 3.07 | −12.4 | −22.6 | −25.2 | 4 / 9 |
| 0 dB (9) | 12.68 | 5.15 | 5.07 | −1.5 | −16.6 | −25.8 | 0 / 9 |
| 10 dB (9) | 6.64 | 3.55 | 3.60 | −12.3 | −24.7 | −28.6 | 1 / 9 |
| 20 dB (9) | 3.37 | 2.80 | 2.94 | −21.2 | −27.1 | −28.3 | 3 / 9 |

Clean clips through each model (LSD vs the clean rebuild): `ls_woman_high` 1.57 / **1.97**,
`ls_man_low` 3.60 / **3.78**, `ls_man_hi8_f105` 1.96 / **2.12** dB (old / 0.2).

Reading: in speech the two models are equal (3.84 vs 3.87 dB) and both halve the noise's damage;
in pauses RNNoise 0.2 brings the rebuild down to the clean rebuild's own floor (−27.6 vs −27.4 dB),
where the old model leaves broadband noise 10–20 dB above it (white 0 dB: −10.5 vs −30.5 dB). The
pause residue is what a listener hears as "background noise" in the preview, so **RNNoise 0.2 was
chosen**, at 2.7× the CPU and a 1.4 MB (vs 112 KB) first download.

A first scratch comparison scored the raw waveform SNR against the clean clip; it is dominated by
the vocoder's phase changes (a clean clip through RNNoise reads 11–19 dB) and is not reported.

## 5. Costs and limits (why it is opt-in)

- **It can make a mildly noisy preview slightly worse**: with fan hum at 10–20 dB SNR, 4 of 9
  cases score worse in speech than leaving the noise in (e.g. `ls_man_low` fan 20 dB: 2.2 → 3.8 dB).
- **Low voices pay more**: on clean speech the low male clip (`ls_man_low`) takes 3.8 dB of
  distortion vs 2.0 dB for the female clip. Three clips (two men, one woman) are far too few to
  call this a sex difference, but it is in the direction that matters for the project's
  gender-symmetry rule, and it is disclosed in the About text ("more so for low voices").
- Synthetic noise only; no babble, music, reverberant rooms or real field noise; no listening test.
  The objective scores are a proxy for what a listener hears.
- Phone CPU and the first-use download time on a phone are unmeasured (§3).
- The About text says: helps most with loud background noise (fan, hiss, traffic); with little
  noise it can make the preview slightly rougher, more so for low voices; it can soften quiet or
  breathy parts; compare it on and off.

## 6. Checks

- `tests/voice-preview/denoise-test.js` (new, in `test:unit`): pins, glue-free loading, delay
  compensation (lag 0), level, noise reduction on white noise at 0 dB (residual 0 → 11.6 dB,
  noise alone −47.7 dB), determinism, 44.1 / 16 kHz.
- `worker-test.js`: record with noise reduction = the engine's rebuild of `denoiseClip(recording)`
  bit for bit; original / check / pitch from the recording as captured; switching off re-analyses
  to the plain rebuild bit for bit and renders equal the plain worker's; on → off while running
  ends without it; a module that cannot load → `denoise-error`, then the spike's rebuild.
- `controller-test.js` (real worker): re-analysis keeps the take, the original and the setting
  (+2, +3 re-rendered; off again = the spike's bytes); Discard keeps the setting; a module that
  cannot load turns the switch off and refuses it.
- `strings-test.js`, `tests/site/third-party-notices-test.js` updated; `parity-test.js` unchanged
  and passing (the off path is the shipped path).
- Browser: `voice-preview-smoke.mjs --parts=checks,denoise` all pass in headless Chrome on macOS
  (noise.wav, 448 × 890, touch): no RNNoise request while off, exactly one when turned on, the
  re-analysis with the showing setting re-rendered, Original plays, off again without a new
  request, Record again keeps it on, no console errors. `--parts=layout --viewports=p360,desktop`:
  98 / 99, the one failure (five tabs overflow by ~11 px at 320 px) is the same on the unchanged
  code on this machine.
- New smoke option `--inject-wav` (default on macOS): Chrome's `--use-file-for-fake-audio-capture`
  delivers digital silence on macOS here (Chrome 154.0.8037.98, checked with an AnalyserNode probe, also
  with the WAV on the system disk), so every recording part read "not enough voice" — on the
  unchanged code too. The option replaces the page's `getUserMedia` with a looping Web Audio
  stream of the same WAV.
