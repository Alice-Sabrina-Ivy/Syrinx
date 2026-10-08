# Resonance cue: CPU pass on the always-on resonance worker — 2026-10-07

Branch `resonance-perf` from `origin/cue-strip` 045ec9f. The Dashboard's
resonance cue (`src/resonance/resonance-worker.js`, the lab's vtln_warp
finalist in "frames" mode, measurements/resonance-cue-production-path-2026-10-07.md)
measured **84–96 ms of CPU per audio second on a Pixel 11 Pro XL** (Chrome
154; target 45, stop 60) against ~46 ms/s on desktop. This pass cuts its
CPU. Public data and synthetic stimuli only.

Sections 1–2 were written and committed **before any candidate was
implemented or measured** (pre-registration). Results follow in §3 onward.

## 1. Where the time goes (head 045ec9f)

**Node** (v24.14.1, i9-11900K, other jobs loading the machine):
`node scripts/resonance/bench.mjs --reps=5` — the production row (the real
resonance worker behind a fake `self`, fed the real pitch worker's posted
frames; the three lab fixtures looped to 60 s at 48 kHz, 62 % of pitch frames
voiced): **41.7 ms CPU per audio second** (39.6–44.8). A V8 CPU profile of
the same path (inspector `Profiler`, 100 µs sampling, 3 × 60 s), self time:

| Where | Share |
|---|---|
| CheapTrick envelope per voiced 10 ms frame (`vtln.js` `frame`: F0-adaptive window, 2 × 512 lifter sin/cos, 3 × 513 log/exp, spectra) | 30.4 % |
| Warp search: 25 hypotheses × 32 GMM components × 92 dims per voiced frame + 800 exp (`createVtln().frame`) | 25.9 % |
| FFT (3 × 1024-point complex per voiced frame, `fft.js`) | 15.5 % |
| 16 kHz analysis resampler (Blackman-sinc, 192 taps per output sample at 48 kHz, every sample of the audio) | 13.8 % |
| WORLD's deterministic `randn` safeguards (one 12-step xorshift per window sample and per spectrum bin) | 4.5 % |
| CheapTrick smoothing / DC correction | 1.5 % |
| Engine bookkeeping, utterance gate, readout, message handling, GC | ~7 % |
| Linear resampler run only to count 16 kHz samples (frames mode) | 0.7 % |

**Desktop Chrome** (154, headless, `node scripts/resonance/chrome-cpu.mjs
--wav=<speech-woman.wav> --profile=…`, built app, fake mic, 60 s): the
worker's own busy time **55.9 ms per audio second** (session mean; machine
loaded). Worker-thread CPU profile (CDP `Profiler` on the worker target,
50 s): CheapTrick frame incl. the inlined `randn` 38.0 %, warp search 21.1 %,
sinc resampler 16.3 %, FFT 12.5 %, GC 1.8 %, counting resampler 1.6 %,
everything else ≤ 1 % each.

So ~75 % of the cost scales with **voiced 10 ms frames** (envelope + FFT +
warp search) and ~15 % with **audio duration** (the analysis resampler).
`chrome-cpu.mjs` gained `--profile=<out.cpuprofile>` (the worker profile)
and `--dist=<dir>` (serve a saved build, for interleaved head / candidate
runs).

## 2. Pre-registration

### 2.1 Target

Production-path CPU **≤ 50 % of the head (045ec9f)** on BOTH:

- **Node:** `scripts/resonance/bench.mjs` production row (real worker shim).
  Head tree (`git archive 045ec9f src scripts public/resonance-lab tests`)
  and candidate alternately, 5 invocations each with `--reps=3`; ratio of
  the medians over all reps ≤ 0.50.
- **Desktop Chrome:** `scripts/resonance/chrome-cpu.mjs` session mean at 60 s
  (the worker's `performance.now()` busy time per audio second — the metric
  the phone runs report). Head build (saved `dist/`) and candidate build
  alternately, 3 runs each on `speech-woman.wav` and on `speech-man.wav`
  (public LibriSpeech test-clean readers, `scripts/cue-strip-smoke-wavs.mjs`);
  ratio of the medians (6 runs each) ≤ 0.50.

The phone measured ~2× desktop, so this aims at ≤ ~45–50 ms/s on the phone
(phone re-validation later, with the user). Candidate screening uses
`scripts/resonance/perf-bench.mjs` (the cue + frames engine driven directly,
base and every configuration interleaved in one process, 7 rounds).

### 2.2 Accuracy guards (vs the head, per sex)

`scripts/resonance/perf-eval.mjs` runs the head tree and each candidate
configuration over the same material through the **production path** (real
pitch worker → engine in "frames" mode → gated cue, 48 kHz, 1200-sample
chunks; posted pitch frames computed once per item and shared), with
u = (vtln readout − men's median) / (women's − men's median) from
`public/resonance-lab/reference.json` (the men–women reference spacing):

| Material (public) | Measured |
|---|---|
| **r1stream**: LibriSpeech test-clean, the lab's r1 set (20 women, 20 men, 5 utterances each), each reader's utterances concatenated | the gated cue's u every 0.2 s of audio once full (what the dot shows); time to settling (2 s admitted voiced) and to live (readout full) |
| **r1utt**: the same 200 utterances one by one (+0.5 s silence so the relay drains) | the ungated engine readout at the end |
| **picka**: the feminine-eval PICKA grid rebuild, 20 LibriSpeech women × 2 utterances × F0 0/−6/−12 st × VTL 0/+1.8/+3.6 st (360 items) | per-item ungated readout |
| **hc**: the feminine-eval Hillenbrand & Clark (2009) sentence proxy, LibriSpeech test-clean 20 women + 20 men × 2 utterances × US/PE/PO/EO (320 items) | per-item ungated readout |
| **fixtures**: the three committed lab fixtures | per-item readout (reported, too few for quantiles) |

A configuration **passes** when every one of these holds:

1. **Readout difference** |u_cand − u_head|: median ≤ 0.02 u and q95 ≤ 0.06 u,
   separately for women and men, on each of r1stream (paired live samples at
   the same audio time), r1utt, picka (women) and hc.
2. **Readings vs nulls:** items where exactly one of head / candidate has
   no readout ≤ 1 % (each set, each sex).
3. **Formant-shift sensitivity** R3eq (readout movement in u per ln 1.15 of
   formant scaling; item fixed effects on ln formant factor and ln F0 factor,
   as `feminine-eval/analysis/specificity.py`) within ±0.05 of the head, and
   **F0 leak** R2eq (per octave of F0) within ±0.03, on picka (women), hc
   women and hc men.
4. **Utterance-to-utterance noise** not worse by > 10 %: pooled within-speaker
   SD of the r1utt readouts (per sex) and pooled within talker × cell SD of the
   picka readouts (women).
5. **Time to settling and to live** on r1stream not slower by > 1 s, median and
   q90, per sex.

### 2.3 Candidates (all evaluated configurations are reported)

**E — exact** (must be bit-identical to the head on every evaluated item;
shared modules, so the lab gets them too):

- E1 *lazy analysis resampling*: a 16 kHz analysis sample is computed only
  when the envelope reads it, so unvoiced and silent audio is never resampled
  (the exact form of "early skip of unvoiced frames"); the same filter sum,
  in the same tap order, over a contiguous history (no per-tap index mask).
- E2 *CheapTrick per-F0 cache*: window, lifters and DC-correction axis reused
  while consecutive frames have the same F0 (posted pitch frames are 25 ms
  apart, grid frames 10 ms).
- E3 the final log(exp(c) + 1e-12) only on the ~270 of 513 envelope bins the
  warp model reads.
- E4 warp-search inner loop with 0.5·x hoisted (0.5·x is exact).
- E5 FFT with contiguous per-stage twiddle tables (same butterflies, same order).
- E6 frames mode counts the pitch worker's 16 kHz samples without generating them.
- E7 WORLD `randn` on int32 state (same bits); fewer per-frame allocations.

**N — near-exact** (switches; tolerance via the guards):

- N1 *real-input FFTs*: the power spectrum and the cepstral smoothing pair
  computed with a 512-point complex FFT of the packed real sequence plus the
  standard split (all three transforms halved).
- N2 *no randn safeguards*: WORLD's ±1e-12 random dither on the windowed
  waveform dropped, its |randn|·eps spectral floor replaced by a constant
  0.8·eps.

**R — reduced analysis** (engine options set by the resonance worker; the
lab view keeps its full analysis):

- R1 *every 2nd grid frame*: vtln scores voiced frames on even 10 ms grid
  indices only (20 ms hop), with the estimator's trailing window 50 voiced
  frames (≈ the same ~1 s of voicing) and ≥ 2 scored frames per 150 ms bin.
- R2 *coarse warp grid*: per frame the 13 even warp hypotheses (0.04 ln α
  apart) are scored; the 12 odd ones are filled by 4-point cubic Lagrange
  interpolation along the warp axis (3-point quadratic next to the two ends);
  trailing sum and peak refinement unchanged.

Configurations: E; E+N1; E+N1+N2; E+N1+N2+R2; E+N1+N2+R1; E+N1+N2+R1+R2
(other subsets of the switches may be added; every one run is reported).

### 2.4 Selection rule

Among configurations that pass **every** guard in §2.2 and the CPU target in
§2.1 on Node AND desktop Chrome, implement the one with the least
approximation, in the order E < N1 < N2 < R2 < R1 (fewer non-exact parts
first; ties → lower Node CPU). If none meets the CPU target, implement the
guard-passing configuration with the lowest Node CPU and report the target
as **missed**.

### 2.5 Parity tests

- E and N live in shared modules (`vtln.js`, `fft.js`, `sinc-resampler.js`,
  `lab-engine.js`): the lab's parity with its Python prototypes
  (`tests/resonance-lab/parity-test.js`, vtln tolerance 2e-3 ln α) must still
  pass, and the production path stays **bit-exact** with the lab engine's
  internal path (`tests/resonance/vtln-production-parity-test.js`) because
  both run the same code.
- R1 / R2 are applied to `lab-engine.js` as engine options (not a fork): the
  production parity test runs both paths with the production options and
  stays bit-exact, plus the default options; the lab view keeps the full
  analysis, so its Python parity is unchanged.
