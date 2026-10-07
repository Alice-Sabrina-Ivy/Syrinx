# CPU with the "Likely heard as" panel on — 2026-10-07

> **Status on branch `cue-strip` (2026-10-07; corrected in review round 2):
> not merged — the pass did not meet its own pre-registered bar.** §1's
> decision rule adopts a change only if it "meets the target with every guard
> passing". Against the bar as written:
>
> | hop | target 1 (app CPU −30 %) | target 2 (resonance) | guard 1 (Palette ≤ 1.0, audio clock) | guard 6 (every guard number for women and men separately) |
> |---|---|---|---|---|
> | 300 ms | −21.5 %, **missed** | — | 0.49, passes | heard-as-man 0.45 / heard-as-woman 0.61, passes |
> | 450 ms | −28.6 %, **missed** | passes under the pre-registered fallback (63.6 ≤ 64.0) | 0.81, passes | 0.79 / 0.90, passes |
> | 600 ms | −32.5 %, met | — | 0.99, passes | 0.95 / **1.15, fails** |
>
> So 450 ms fails only target 1, and **600 ms fails guard 6** (the
> heard-as-woman Palette stimuli move 1.15 points). An earlier version of
> this block said 600 ms "failed guard 1 under bursty capture (1.10)": the
> bursty-capture check (40 ms bursts + jitter; 600 ms: 1.02 / 1.38, 450 ms:
> 0.92 / 0.81) was added after the pre-registration and is not guard 1.
> Target 2 under the fallback is met at 450 ms, but the head meets it too in
> these runs (59.7 on), so it shows nothing about the variant. "Heard-as-man"
> / "heard-as-woman" = the Palette listeners' majority (188 / 52 stimuli).
>
> Per the user's instruction ("if neither can be improved, ship as is"),
> `cue-strip` keeps the 150 ms hop and the gender worker exactly as before
> this pass. The variant, its tooling (`chrome-cpu.mjs` thread-CPU extension,
> `ort-bench.mjs`, `hop-study.mjs`, `compare_hop.py`, `hop_study_report.py`,
> the `run_chain.mjs --hop/--logits` options) and the regenerated golden file
> live on branch **`cue-strip-cpu`** only (commits 4f213b6, 00d130d, 591da94,
> 548d9f8), so §3–§5 below describe that branch, not `cue-strip`. "Adopted"
> in §4 means adopted on that branch. Open decisions for the user: accept
> −28.6 % at 450 ms (the panel's own increment over panel off falls 57 %), or
> take 600 ms despite guard 6 (the heard-as-woman stimuli move 1.15 points
> against the 1.0 bar). The main thread (~300–350 ms per audio second at this
> load, panel on or off) is now the largest consumer and was outside this
> pass.
>
> **What the panel costs (review round 2 re-measure at e664eb9, desktop
> Chrome 154, built app, 8 interleaved runs, ~100 % machine load):** about
> **+400 ms of CPU per audio second, almost all of it the gender worker**
> (383 ms/s; 4.5–5.1 inferences per second at a median 78–86 ms each at this
> load — ~49 ms on a quiet machine). App threads 418 → 816 ms/s, renderer
> process 602 → 993 ms/s. The resonance worker's thread CPU does **not**
> change with the panel on (51.4 off / 51.7 on; its own busy-time figure
> 54.9 / 49.6). The 44.1 → 51.8 ms/s "contention" pair from the first
> correctness review (~74 % load) did not reproduce, here or in §2.

With the experimental, opt-in "Likely heard as" panel on, the gender worker
runs the q8-v2 ECAPA classifier on a 0.75 s window every 150 ms of scored
speech (~49 ms per inference on desktop at low load), and the resonance
worker's own busy time rose from 44.1 to 51.8 ms per audio second in the
correctness review (read then as contention; it did not reproduce — §2 and
the status block). The user asked (2026-10-07) to try to reduce
the panel-on CPU, and to ship as is if no change passes. This note
pre-registers the targets, guards and variants **before any code change**,
then records the baseline and every variant tried. Public data only:
LibriSpeech test-clean readers (CC BY 4.0), the Palette of Voices stimuli
(Munson & Dolquist 2025, CC BY 4.0) and synthetic signals.

## 1. Pre-registration (written before any change to src/)

### Metrics

- **Thread CPU per second of audio**, desktop Chrome, the BUILT app under
  `?diag=1`, fake mic = a public LibriSpeech reader (one woman, one man:
  `build/cue-strip-smoke/speech-{woman,man}.wav`, ~72 s each, looped by
  Chrome), `scripts/resonance/chrome-cpu.mjs` (extended in this pass): a
  Chrome trace of 30 s taken after 20 s of listening (and, panel on, after
  the model is ready); per thread, the sum of the thread-clock durations
  (`tdur`) of the outermost scheduler tasks (category `toplevel`), divided
  by the traced span (the fake mic runs in real time, so traced seconds =
  audio seconds). Threads are identified by the script URL of their tasks
  (`gender-worker`, `resonance-worker`, `pitch-worker`, `dsp-worker`) and
  `CrRendererMain` (main thread).
- **App CPU** = main thread + gender + resonance + pitch + DSP workers (the
  sum of the five rows). Also reported: the renderer / GPU / browser
  **process** CPU over the same window (`SystemInfo.getProcessInfo`), and
  the gender worker's inferences per second and median `inferMs`.
- **Resonance worker's own figure** = `resonancePerf.meanMsPerAudioS` (its
  busy time per audio second, session mean, wall clock) — the metric the
  44.1 / 51.8 figures were taken with.
- Runs are interleaved (panel off / on, baseline / variant, woman / man) and
  repeated; the figure per condition is the median over runs. Other jobs
  share the machine (load 70–100 %), which inflates wall-clock figures more
  than thread-clock ones; the panel-off figure from the same session is
  always reported next to the panel-on one.

### Target

1. **Panel-on app CPU reduced by ≥ 30 %** vs the current head (370d107),
   median over the interleaved runs.
2. **Resonance worker panel-on ≤ 45 ms per audio second**
   (`meanMsPerAudioS`). If machine load pushes the same session's panel-off
   figure above 45, the target is read as panel-on ≤ panel-off × 45 / 44.1
   (the review's ratio at ~74 % load), and both numbers are reported.

### Guards (a variant is kept only if it passes all of them)

1. **Palette through the production chain**: the panel's two-way share
   ("man", unsure counted half; the centre of the shown range), per stimulus,
   pooled over the whole stimulus as `scripts/heard-as/run_chain.mjs` does,
   changes by **≤ 1.0 point MAE** vs the current head (240 stimuli). The
   error vs the Palette listeners (head: 6.33 points) is reported too.
2. **Calibration equivalence**: `tests/ml/heard-as-equivalence-test.js`
   passes. Its window-set guard fails by design if the scored-window set
   changes; then the golden file is regenerated
   (`scripts/heard-as/make_golden.mjs` + `golden_check.py`) with the
   justification written here, and the JS-vs-Python aggregate checks
   (≤ 1e-9) must still pass on the new golden file.
3. **Time to first estimate** on continuous public speech (the 40 LibriSpeech
   test-clean readers of the calibration's hide-rule check, each reader's
   utterances concatenated with 0.3 s gaps, through the production chain in
   Node with the panel's 2 s update ticks): the median time to the first
   shown estimate is **not later by > 1 s** than at the head, for women and
   men separately.
4. **Hide rules unchanged**: on a synthetic held vowel (1 s silence + 6 s /a/
   at 200 Hz), pink noise (−30 dBFS), digital silence, and short speech (each
   reader's single utterances of ≤ 2.5 s voiced, followed by silence), the
   panel's hidden / shown state and hide reason at every tick (2 s updates +
   the 250 ms held-note check) are identical to the head's.
5. **Resonance parity unchanged**: `tests/resonance/vtln-production-parity-test.js`
   and `npm run test:resonance-lab` pass unchanged; `npm run lint`,
   `npm run test:unit`, `npm run build` pass.
6. **Gender symmetry**: every guard number is reported for women and men
   separately; a variant that passes for one and not the other fails.

### Variants (every one is reported, kept or not)

- **A. Longer classifier hop while only the panel uses the model** (the meter
  bar is gone; the estimate pools 8 s and updates every 2 s): the utterance
  gate keeps deciding every 150 ms (so held-note detection, voice states and
  span onsets are untouched), but the classifier runs only on a scored window
  at least `hop` after the previous classified one — 300 / 450 / 600 ms. The
  hide rule "≥ 10 scored windows" (which assumed a 150 ms hop) is rescaled to
  the same scored time (10 × 150 ms = 1.5 s, i.e. ⌈1500 / hop⌉ windows) if
  the time-to-first-estimate guard needs it; the 3 s voiced rule is unchanged.
- **B. Skip windows the utterance gate would not score before running
  inference** — check whether the worker already does this.
- **C. ONNX Runtime options**: the non-asyncify WASM build (transformers.js
  4.x loads the asyncify build in Chrome / Firefox, the plain one on Safari),
  graph optimisation level, CPU memory arena, a fixed input shape
  (`freeDimensionOverrides`). Threads: the app is not cross-origin isolated,
  so ORT-web runs single-threaded; not a lever without COOP / COEP headers.
- **D. Shared resampling between workers**: measure the resamplers' cost
  first; pursue only if it is material.
- **E. The resonance worker's own cost**: profile; a bit-exact speed-up is
  kept only with the parity tests unchanged; computing vtln less often would
  change the readout and needs its own tolerance guard — reported, not
  adopted, unless it passes one.

Decision rule: adopt the smallest change set that meets the target with
every guard passing; prefer the shortest hop that does.

## 2. Baseline (head 370d107)

Desktop Chrome 154, built app, `?diag=1`, the two LibriSpeech readers, runs
interleaved with the variants (§3), **8 runs per condition** (2 speakers × 4),
median. Other jobs held the machine at **~100 % CPU load** throughout, which
inflates every figure (a quieter first run, at ~70–90 % load, read main ~230,
gender ~265, resonance ~32 ms/s); the comparisons below are between
interleaved runs under the same load.

Thread CPU, ms per second of audio:

| | main | gender | resonance | pitch | DSP | **app** | renderer process | gender inferences / s, median `inferMs` |
|---|---|---|---|---|---|---|---|---|
| panel off | 312.5 | — | 56.1 | 39.5 | 36.2 | **445.0** | 638 | — |
| panel on | 335.4 | 420.8 | 56.5 | 39.0 | 36.5 | **889.5** | 1093 | 4.8, 94 ms (~88 ms CPU each) |

The panel doubles the app's CPU: +445 ms/s, of which the gender worker is
421. The resonance worker's **thread** CPU is the same with the panel on or
off (56.5 / 56.1); its wall-clock busy figure (`meanMsPerAudioS`) was 59.7 on
/ 62.7 off — at this load the contention effect the review measured (51.8 on
vs 44.1 off at ~74 % load) is not visible, and the absolute 45 ms/s target is
out of reach with the panel off too.

Where the main thread goes (one 5.8 s `devtools.timeline` trace, panel on,
450 ms variant): JS 140 ms/s (mostly the pitch trace's per-frame canvas
drawing and React), Paint 44, Commit 29, PrePaint 26, style 16, layout 14.
The main thread costs about the same with the panel off (312 vs 335 ms/s).
It is not panel work and is not changed here.

## 3. Variants

### A. Longer classifier hop — 300 / 450 / 600 ms

Built as pre-registered, with one design change found while measuring: the
worker still posts every window the gate scores but the classifier skips
(`{ type: "scored" }`, no logit), and `heard-as.js` counts those windows for
the window count, the voiced time and the F0 spans — only `meterLogit`
averages the classified subset. A first version that counted only the
classified windows moved ln F0 as well (the last classified window ends up to
450 ms before the last scored one) and gave Palette MAE 0.52 / 0.94 / 1.12 at
300 / 450 / 600 ms. Counting the scored windows makes ln F0, the voiced time,
the window-count hide rule and the time to the first estimate identical to
the 150 ms schedule **by construction**, so the window-count rule did not need
rescaling.

**CPU** (§2 method, medians; 300 ms: 3 runs, the others 8):

| hop | gender | main | app | vs head | workers only vs head | renderer process | inferences / s |
|---|---|---|---|---|---|---|---|
| 150 (head) | 420.8 | 335.4 | 889.5 | — | — | 1093 | 4.8 |
| 300 | 219.5 | 354.4 | 698.4 | −21.5 % | −36.3 % | 901 | 2.4 |
| **450** | **156.2** | 349.6 | **634.9** | **−28.6 %** | −47.3 % | 851 | 1.7 |
| 600 | 120.9 | 351.4 | 600.2 | −32.5 % | −53.9 % | 826 | 1.3 |

The panel's own increment over panel off falls from +445 to +190 ms/s at
450 ms (−57 %) and to +155 at 600 ms.

**Guard 1 — Palette through the production chain** (`run_chain.mjs --hop=…`
with the head's logits reused for the same windows — `--hop=150` reproduces
the head's file exactly; `compare_hop.py`), two-way share "man", 240 stimuli:

| hop | \|Δ\| vs head: MAE (q90, max), points | stimuli whose "x in 10" rows differ | MAE vs listeners (head 6.33) |
|---|---|---|---|
| 300 | 0.49 (1.35, 4.0) | 37 / 240 | 6.32 |
| **450** | **0.81** (2.39, 5.7) | 58 / 240 | 6.37 |
| 600 | 0.99 (2.47, 10.6) | 64 / 240 | 6.31 |

**Guard 6 split of guard 1** (added in review round 2 — the pass reported
guard 1 pooled only): |Δ| vs head in points, by the Palette listeners'
majority (heard-as-man 188 stimuli / heard-as-woman 52;
`hopsplit`-style recomputation from the same `run_chain.mjs` outputs):

| hop | audio clock: heard-as-man / heard-as-woman | 40 ms bursts: heard-as-man / heard-as-woman | guard 6 |
|---|---|---|---|
| 300 | 0.45 / 0.61 | — | passes |
| 450 | 0.79 / 0.90 | 0.92 / 0.81 | passes |
| 600 | 0.95 / **1.15** | 1.02 / 1.38 | **fails** |

With 40 ms capture bursts plus 0–5 ms jitter (the live tick clock), against
the head under the same bursts (head 6.38 vs listeners): 450 ms 0.90 (2.40,
7.0), 61 / 240 stimuli with different rows, 6.44 vs listeners; 600 ms
**1.10** (2.92, 9.4), 71 / 240, 6.46.

For scale: burst jitter alone at the 150 ms hop moves the share by |Δ| q90
1.6, max 5.0 points (heard-as-calibration note, "Burst jitter"). The Palette
stimuli are single ~2–3 s utterances (median 16 scored windows); the live
estimate pools 8 s.

**Guards 3 and 4 — hide rules and time to the first estimate**
(`hop-study.mjs` + `hop_study_report.py`: the 40 LibriSpeech test-clean
readers as continuous streams, 768 s women / 966 s men; 13 short single
utterances with ≤ 2.5 s voiced; a synthetic held vowel, pink noise and
silence; the panel's 2 s updates + 250 ms held-note check). At every hop:

- the first estimate appears at the same time on all 40 readers (median
  6.0 s, women and men; change 0 s);
- the hidden / shown state is identical on every 2 s tick (women 332 / 374
  shown, men 417 / 474);
- short speech, the held vowel, noise and silence give tick-by-tick
  identical states and reasons (never shown; "short" / "stale" /
  "sustained" / "listening").

**The shown estimate on the reader streams** (ticks shown in both, share
"man", |Δ| in points):

| hop | women: mean, q90, max | men: mean, q90, max | ticks whose "x in 10" rows differ (women / men) |
|---|---|---|---|
| 300 | 0.27, 0.68, 2.2 | 0.16, 0.33, 1.9 | 9.9 % / 13.2 % |
| 450 | 0.44, 1.00, 4.4 | 0.27, 0.63, 2.6 | 16.3 % / 15.3 % |
| 600 | 0.57, 1.28, 7.2 | 0.34, 0.72, 5.2 | 18.4 % / 20.9 % |

**Guard 2 — equivalence.** The window-set guard fails by design (which
windows are classified changed), so the golden file was regenerated
(`make_golden.mjs`, hop 450). Against the head's golden file:

- the scored-window times, the posted pitch and ln F0 are identical;
- the logits of the classified windows are identical;
- the classified subset moves meterLogit on the three 5 s fixtures 3.241 →
  3.214, −5.425 → −5.142 and −1.574 → −2.098 (share "man" 3.2 → 3.2,
  85.9 → 84.7 and 58.7 → 63.1 points; each fixture has 9–10 classified
  windows);
- JS vs the independent Python aggregate: all checks pass (25 / 25, incl. a
  new classified-count check).

### B. Skip windows the gate would not score

Already the case since the utterance gate (2026-10-07): the classifier runs
only on windows `decideMlWindow` scores (in the Node chain at the 150 ms hop
it ran on exactly the 5.45 / 5.31 scored windows per second of women's /
men's reading). Nothing to gain.

### C. ONNX Runtime options

`scripts/heard-as/ort-bench.mjs`: Node 24, single thread, 40 inferences per
variant, under the same machine load.

| variant | CPU median per inference | session create | logits vs asyncify |
|---|---|---|---|
| asyncify build (what Chrome loads today) | 63 ms | 1.7 s | — |
| plain build (what Safari loads) | 63 ms | 0.5 s | identical |
| plain + graph optimisation "basic" / "disabled" | 77 / 78 ms | | identical |
| plain + no CPU memory arena | 93 ms | | identical |
| plain / asyncify + fixed input shape | 63 / 78 ms | | identical |

No option lowers the per-inference cost. Windows CPU-time granularity is
~16 ms, so equal medians mean "no difference found", not a precise tie.
Threads are not available (the page is not cross-origin isolated). Not
adopted. Aside, not a CPU change: the plain build is 12.9 MB instead of
23.6 MB (uncompressed) and creates its session ~1 s faster.

### D. Shared resampling

The gender worker's streaming resampler + ring cost 0.23 ms per audio second
at 48 kHz (0.46 at 44.1 kHz); the per-tick window copy + peak 0.45 ms/s.
That is under 0.1 % of the panel-on total. Not pursued.

### E. The resonance worker's own cost

Node profile of the production path (`bench.mjs`): CheapTrick envelope ~57 %
(its three 1024-point FFTs included), the 25 × 32-component GMM scoring
~27 %, the 48 → 16 kHz sinc resampler ~15 %. One bit-exact candidate —
hoisting 0.5·x out of the GMM loop — kept the parity test at 89 / 89 but ran
slower in V8 (53.9 / 55.2 vs 46.9 / 47.4 ms per audio second, alternating
runs) and was reverted. Computing vtln less often was not tried: the parity
guard requires bit-exact readouts, and the worker's thread CPU does not grow
with the panel on (§2), so there is no panel cost to remove there.

## 4. Decision

**Adopted: A at 450 ms** (`ML_CLASSIFY_HOP_MS = 450` and `classifyDue` in
`src/ml/audio-utils.js`; the `"scored"` message; the `classified: false`
windows in `heard-as.js`). It passes every guard, including under bursty
capture: Palette 0.81 / 0.90 points (audio clock / bursts; by listeners'
majority heard-as-man 0.79 / heard-as-woman 0.90 on the audio clock — guard
6); hide rules and first-estimate time
unchanged; the resonance code untouched, its parity tests unchanged.

- **Target 1 is narrowly missed.** App CPU with the panel on is −28.6 %
  (889.5 → 634.9 ms per audio second). For the workers alone it is −47 %, for
  the whole renderer process −22 %, and for the panel's own increment −57 %.
  - The 600 ms hop meets the target (−32.5 %) but is not adopted: its Palette
    change is 0.99 points on the audio clock (guard 1 passes as
    pre-registered), but split by the listeners' majority it is 0.95
    (heard-as-man) / **1.15 (heard-as-woman)**, so it fails guard 6. (This
    bullet first gave the 40 ms-burst figure, 1.10, as the reason; that check
    was added after the pre-registration — corrected in review round 2.)
  - 450 ms and 525 ms give the same schedule (every 3rd 150 ms tick), so there
    is no step between 450 and 600.
  - The rest of the panel-on total is the main thread (~350 ms/s at this load,
    panel on or off), outside this pass.
- **Target 2 passes under the pre-registered fallback, but shows nothing
  about the variant.** At ~100 % machine load the resonance
  worker's busy figure is 60–69 ms per audio second with the panel off too.
  - With the panel on it is 63.6 (450 ms) vs 62.7 off. That is within the
    pre-registered fallback (≤ off × 45 / 44.1 = 64.0), but the head also
    passes it in these runs (59.7 on).
  - The worker's thread CPU is the same on and off (56.2 / 56.1).
  - Fewer inferences mean less contention by construction (the gender thread
    is busy ~15 % of the time instead of ~42 %); showing it needs a quieter
    machine.

## 5. Reproduce

```
# variant builds: ML_CLASSIFY_HOP_MS = 150 / 300 / 450 / 600, npx vite build --outDir dist-<name>
node scripts/resonance/chrome-cpu.mjs --panel=on|off --dist=<dir> --wav=build/cue-strip-smoke/speech-{woman,man}.wav --seconds=60 --warmup=20 --trace=30 --out=<json>
node scripts/heard-as/run_chain.mjs <jobs_pov.json> build/heard-as/palette_hopN.jsonl --hop=N [--burst=40 --jitter=5] [--logits=<head chain.jsonl>]
python scripts/heard-as/compare_hop.py <pov_stimuli.csv> build/heard-as/palette_hop150.jsonl build/heard-as/palette_hop{300,450,600}.jsonl
node scripts/heard-as/hop-study.mjs --r1=<jobs_r1.json> && python scripts/heard-as/hop_study_report.py build/heard-as/hop-study.json
node scripts/heard-as/ort-bench.mjs
```
