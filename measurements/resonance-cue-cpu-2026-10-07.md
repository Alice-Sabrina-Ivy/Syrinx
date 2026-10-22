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

## 3. Results (after the pre-registration commit 474323f)

Machine: i9-11900K, Node v24.14.1, Chrome 154 (headless), shared with other
jobs that held it at 75–100 % CPU throughout, so absolute ms/s figures are
upper-side and noisy; every comparison was interleaved head / candidate.

### 3.1 What was implemented

**E (exact, bit-identical — verified `===` on every evaluated item: 3
fixtures, 40 reading streams, 200 utterances, 680 rebuild items):** E1 lazy
analysis ring (`createLazySincRing`, `sinc-resampler.js`); E2 per-F0
CheapTrick cache (window, lifters, and the interpolation geometry of the DC
correction and linear smoothing — interp1Q split into a cached geometry part
and an apply part that evaluates the same expression); E3 final log/exp on
envelope bins 51–321 only; E4 0.5·x hoisted, sub-models flattened into typed
arrays; E5 FFT per-stage twiddle tables (stage loop twiddle-outer, same
butterflies); E6 `createStreamingSampleCounter` (`lab-engine.js`); E7 int32
`randn`; plus `exp()` skipped where its argument is below −750 (exactly 0
there). Tried and dropped (no gain on the bench): two GMM components per
pass sharing the x loads; recomputing the sub-model terms from compact
per-component columns (the warp search is compute-bound, not memory-bound).

**N (near-exact switches, `createVtln` options):** N1 `realFft`
(`createRealFFT`, `fft.js`), N2 `noDither`, and — **added after the first
results, not in the pre-registered set** — **N3 `prune`**: each component's
log-likelihood rewritten as log w − ½Σ log 2πv − ½Σ prec·(x − μ)² (the same
value, other rounding), whose partial sum only falls; components are visited
best-first (the last frame's best for that hypothesis first) and abandoned
once 40 nats below the running best (each such component adds < e⁻⁴⁰ to the
log-sum-exp). 78 % of components are abandoned, after ~35 of 92 dims on
average. Visiting the dims in bit-reversed or precision-sorted order did not
prune earlier (57 / 48 dims per component vs 48) and was dropped.

**R (reduced analysis):** R1 (`stride: 2, trail: 50, minFrames: 2`) and R2
(`coarse: true`) as registered.

### 3.2 Accuracy guards (production path, vs the head, per sex)

Head values: time to settling women / men median 3.70 / 4.22 s (q90 4.35 /
5.25), to live 8.27 / 10.30 s (q90 10.46 / 12.57); utterance noise r1 women
0.241 u, men 0.265 u, picka (women) 0.462 u; R3eq picka 1.141, hc women
1.156, hc men 1.125; R2eq −0.019 / −0.001 / +0.067.

| Configuration | Result | Largest \|Δu\| anywhere | Worst guard values |
|---|---|---|---|
| E | **pass**, bit-identical | 0 | all 0 |
| E+N1 | **pass** | 1.8e-11 | all 0.000 |
| E+N3 | **pass** | 4.5e-13 | all 0.000 |
| E+N1+N3 | **pass** | 1.8e-11 | all 0.000 |
| E+N1+N2 | **pass** | 2.6e-6 | all 0.000 |
| E+N2+N3 | **pass** | 2.6e-6 | all 0.000 |
| **E+N1+N2+N3** | **pass** | 2.6e-6 | all 0.000 (noise ratios 1.000, timing Δ 0.0 s, \|ΔR3eq\|, \|ΔR2eq\| < 0.0005) |
| E+N1+N2+R2 | **FAIL** (1 of 36 checks) | 0.29 | readout \|Δu\| median ≤ 0.012 everywhere, q95 0.035–0.047 except **r1utt men q95 0.063 > 0.06**; \|ΔR3eq\| ≤ 0.004, \|ΔR2eq\| ≤ 0.010; noise ratio ≤ 1.025; timing Δ 0 |
| E+N1+N2+R1 | **FAIL** (15 of 36 checks) | 1.3 | readout \|Δu\| median up to 0.044, q95 up to 0.268; r1 noise men × 1.121; ΔR3eq up to −0.029, ΔR2eq up to +0.022 |
| E+N1+N2+R1+R2 | **FAIL** (15 of 36 checks) | 1.3 | median up to 0.050, q95 up to 0.265; noise men × 1.146 |

R2 per sex (median / q95 of \|Δu\|): r1 live women 0.008 / 0.035, men 0.009 /
0.039; r1utt women 0.009 / 0.047, men 0.010 / **0.063**; picka women 0.010 /
0.045; hc women 0.012 / 0.046, men 0.009 / 0.042. Reading / null mismatches
were 0 for every configuration.

### 3.3 CPU screening (`perf-bench.mjs`, in-process, interleaved; ratio to the head)

| Configuration | Run 1 (5 rounds) | Run 2 (7) | Run 3 (7) |
|---|---|---|---|
| E | 0.606 | 0.637 | — |
| E+N1 | 0.538 | — | — |
| E+N1+N2 | 0.500 | — | — |
| E+N3 | — | 0.554 | — |
| E+N1+N3 | — | 0.466 | 0.472 |
| E+N2+N3 | — | — | 0.439 |
| E+N1+N2+N3 | — | 0.412 | 0.422 |
| E+N1+N2+R2 | 0.380 | — | — |
| E+N1+N2+R1 | 0.284 | — | — |
| E+N1+N2+R1+R2 | 0.231 | — | — |

### 3.4 The pre-registered target

**Node** (`scripts/resonance/bench.mjs` production row, the real worker shim;
head tree and candidate trees alternately, 5 invocations each with
`--reps=3`; `bench.mjs` prints each invocation's median of its 3 reps, so the
ratio is of the medians of those 5 per-invocation medians):

| Session | Head ms/s | E+N1+N3 | E+N2+N3 | **E+N1+N2+N3** |
|---|---|---|---|---|
| 1 | 47.1 (43.2–52.6) | 23.9 → 0.507 | — | 21.9 → **0.465** |
| 2 | 53.9 (53.1–54.9) | — | 30.7 → 0.570 | — |
| 3 (all interleaved) | 45.9 (43.8–49.5) | 24.5 → 0.534 | 24.5 → 0.534 | 18.8 → **0.410** |

(The worker shim adds per-chunk message handling, the 200 ms state posts and
the overload guard, which the in-process screening leaves out — hence higher
ratios than §3.3.)

**Desktop Chrome** (`chrome-cpu.mjs`, built app, 60 s, the worker's own busy
time per audio second, session mean; head dist and candidate dist
alternately, 3 runs each per reader):

| ms per audio s | Head | E+N1+N2+N3 |
|---|---|---|
| woman reader (`speech-woman.wav`) | 44.3, 50.1, 44.1 | 18.5, 23.2, 24.4 |
| man reader (`speech-man.wav`) | 54.3, 55.1, 54.3 | 23.4, 22.8, 22.1 |
| **median of 6** | **52.2** | **23.0 → ratio 0.441** |

Per reader the ratio of medians is 0.52 (woman: 44.3 vs 23.2) and 0.42 (man:
54.3 vs 22.8) — the head's woman runs read lower than its man runs under the
same load; the pre-registered criterion is the 6-run median. Overloads: 0 in
every run.

### 3.5 Selection (§2.4)

- Every R configuration fails an accuracy guard (R2 narrowly: one of 7 q95 checks,
  0.063 vs 0.06; R1 broadly). None is eligible.
- Guard-passing configurations, least approximate first: E (screening
  0.61–0.64, misses), E+N1 (0.54, misses), E+N3 (0.55, misses), E+N1+N3
  (official Node 0.507 / 0.534, misses), E+N2+N3 (official 0.570 / 0.534,
  misses), E+N1+N2 (screening 0.50 in-process, so above 0.50 on the worker
  path; not run officially), **E+N1+N2+N3 (official Node 0.465 / 0.410,
  Chrome 0.441 — meets both)**.
- **Implemented: E+N1+N2+N3.** N3 is a post-hoc addition to the registered
  candidate set; alone it moves readouts by ≤ 4.5e-13 u, and the
  configuration was held to every pre-registered guard unchanged.

**Target: PASS with a post-hoc candidate (N3)** — production-path CPU
0.41–0.47 × the head on the Node bench and 0.44 × on desktop Chrome, with
every accuracy guard passing and the readouts within 2.6e-6 u of the head for
women and men alike. **Every configuration built only from pre-registered
candidates missed the ≤ 0.50 target** (E+N1+N3 0.507 / 0.534; E+N1+N2 was
not run on the official bench); only E+N1+N2+N3 meets it, and N3 was added
after the first results (relabelled in the 2026-10-07 review; the earlier
heading read "Target: PASS"). N3 is numerically near-exact (≤ 4.5e-13 u
alone: it abandons only GMM components more than 40 nats below the best,
each contributing < e^-40). **Out-of-sample confirmation** (review
2026-10-07, after the selection): 40 fresh LibriSpeech dev-clean readers
(20 women, 20 men, 200 utterances, streams and single utterances) — every
pre-registered guard passes for both sexes, largest readout change
3.1e-6 u, 0 reading / null mismatches; at 44.1 kHz (not in the original
pass) the largest change is 1.1e-6 u.

### 3.6 Where the time goes now (E+N1+N2+N3, Node profile, 4 × 60 s)

GMM warp search (pruned) ~47 %, CheapTrick frame incl. the lazy 16 kHz
filtering of the voiced audio it reads ~23 %, real-input FFTs ~14 %, per-F0
geometry rebuilds ~4 %, linear smoothing ~2 %, gate / readout / engine
bookkeeping ~6 %. What is left scales with voiced 10 ms frames; silence and
unvoiced audio now cost almost nothing (no filtering, no envelopes).

### 3.7 Code and parity tests

- The adopted switches are the **defaults of `createVtln`** (`vtln.js`), so
  the cue and the resonance lab run the same analysis; with all three off it
  is the exact WORLD / prototype port, bit-identical to the pre-pass engine.
  The resonance worker passes no options.
- `tests/resonance/vtln-production-parity-test.js`: **unchanged and still
  bit-exact** (89 / 89) — the route taken is "apply the same change to the
  shared lab engine", not a tolerance: both paths run the same code.
- `tests/resonance-lab/parity-test.js` (lab vs the Python prototypes, vtln
  tolerance 2e-3 ln α): passes with the near-exact defaults; max vtln
  difference 1.24e-6 / 4.03e-6 / 8.13e-7 ln α on the three fixtures (as
  before the pass — the gap is the prototype's float32 GMM).
- New `tests/resonance/vtln-cpu-exactness-test.js` (in CI): lazy ring ===
  eager resampler at 48 / 44.1 / 32 / 16 kHz with uneven chunks; the sample
  counter === the pitch worker resampler's lengths; real FFT within 1e-12
  (8.2e-16); per-stage FFT === the original loop order; the exact switches
  reproduce the pre-pass engine's vtln bins bit-exactly
  (`tests/resonance/fixtures/vtln-exact-golden.json`, generated from 045ec9f)
  and the defaults stay within 1e-6 ln α of them (≤ 2.2e-8 measured).
- The reduced variants stay available as options (`stride`, `trail`,
  `minFrames`, `coarse`), off, so §3.2 reproduces. Every configuration with
  its switches spelled out (the defaults changed, so `{}` now means the
  adopted analysis): `scripts/resonance/perf-configs.json` —
  `node scripts/resonance/perf-eval.mjs --base=<045ec9f tree> --cand=.
  --configs=scripts/resonance/perf-configs.json --r1=… --picka=… --hc=…`
  and `perf-bench.mjs` with the same file.

### 3.8 Phone, and what is not measured

At the measured desktop ratio the phone's 84–96 ms/s would come down to
roughly 35–45 ms/s — an expectation, not a measurement; phone re-validation
is planned with the user. The cue bands (`public/resonance-lab/cue-bands.json`)
were not regenerated: readouts moved by at most 2.6e-6 u. 44.1 kHz capture
is covered by the parity and exactness tests but the accuracy guards ran at
48 kHz only. No private session recordings were used.
