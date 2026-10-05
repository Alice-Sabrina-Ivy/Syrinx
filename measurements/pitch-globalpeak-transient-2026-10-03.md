# Silence-term reference (globalPeak) vs transients — 2026-10-03

**Shipped config:** gated rank reference `kthg12r5`, κ = 1.2 —
`BOERSMA_DEFAULTS.referenceWindow 12 / referenceRank 5 / referenceGain 1.2
/ referencePeriodicR 0.35` in [src/dsp/boersma-ac.js](../src/dsp/boersma-ac.js),
plus five frame-level transient cases in
[tests/dsp/boersma-ac-test.js](../tests/dsp/boersma-ac-test.js).

One of five measured workstreams from the 2026-10-03 "the trace shows half
my pitch" investigation; siblings (integrated in this order on one branch):
this file →
[pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md) →
[pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md) →
[noise-notch-voice-safety-2026-10-03.md](noise-notch-voice-safety-2026-10-03.md) →
[pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md).
Each workstream was measured independently against the then-production
chain (origin/main at f92b11a); numbers below are this change alone, not
the combined branch.

Follow-up to the 2026-10-03 half-pitch investigation (phase-1 finding 5).
**Defect:** the Boersma silence term normalises each frame's `localPeak`
by a streaming "global peak" (`src/dsp/boersma-ac.js`, `globalPeak`,
added 2026-06-09 to fix the quiet-mic bug). It was a running max with
instant attack and a 0.999/frame decay (~17 s half-life):

```js
globalPeak = Math.max(localPeak, globalPeak * 0.999, 1e-4);
```

One click, plosive pop or desk bump far above a quiet AGC-off voice
(e.g. 1.0 full scale vs speech peaks 0.03) latches the reference, and
the silence term (`unvoicedStrength = vt + max(0, 2 - (localPeak/globalPeak)/(0.03/1.35))`)
then out-scores every voiced candidate until the reference decays —
30-50 s of a blank trace. Phase 1 reproduced this on real speech at
speech peak 0.03 from a single click.

Constraints: must not reintroduce the 2026-06-09 quiet-mic bug
(hardcoded 1.0 silenced real AGC-off mics), must not weaken noise
rejection, must leave full sessions / corpora essentially unchanged.

Scratch harnesses (all under `build/measure-2026-10-03/globalpeak/` in
the main checkout — `build/` is gitignored, so they are not in the repo;
the committed equivalents are `scripts/noise-augment-oracle.js` and
`tests/dsp/boersma-ac-test.js`): `boersma-ac-gp.mjs` (production detector with a pluggable
reference tracker, `gp-trackers.mjs`), `worker-sim.mjs` (pitch-worker
mirror: notch → AC → L=2 tracker → ghost veto → harmonic guard),
`transient-oracle.mjs`, `long-silence.mjs`, `corpus-runner.mjs`,
`noise-oracle-gp.mjs` (copy of `scripts/noise-augment-oracle.js` with a
`GP_SPEC` override), the phase-1
`build/investigate-2026-10-03/session-attribution/chain-harness.js` (full
production chain incl. display) + `score-sessions.py`,
`falsepaint.py`, `flips.py`, offline proxies `offline-proxy*.py`.

## 1. Baseline match (before any sweep)

| check | result |
|---|---|
| `worker-sim` (real `src/dsp/boersma-ac.js`) vs the REAL `src/dsp/pitch-worker.js` driven in Node with a fake `self` (16 kHz, 25 ms chunks), 300 s of speech audio per recording (private session audio) + quiet-tone/click fixture | **0 mismatches** (bit-exact incl. the contextTime → frame mapping) |
| `worker-sim` with `boersma-ac-gp.mjs` in `{kind:"prod"}` mode vs real module | 0 mismatches (bit-exact) |
| `chain-harness.js --detector=boersma-ac-gp.mjs --ac-opts='{"gp":{"kind":"prod"}}'` on a session recording vs the phase-1 stored `runs/baseline` | `hops.f32` and `cands.f32` **byte-identical** (so phase-1 baseline runs are reused for every session comparison) |
| proposed production module (`proposed/src/dsp/boersma-ac.js`) vs scratch variant `kthg12r5_k1.2` | 0 mismatches (120 s per recording) |
| `tests/dsp/boersma-ac-test.js` (incl. weak-H1 and the 2026-06-09 quiet-mic fixture) | 25/25 on production and on every candidate below |

## 2. Transient oracle

Speech: 2 FDA concatenations (male, female; 60 s) + 2 excerpts of private
session recordings (the most active 60 s windows). Each scaled so its
99.9th-percentile |x| = P ∈ {0.01, 0.03, 0.1} (AGC-off mic levels) plus a
constant mic floor (white, RMS 1.5e-4). Transients (peak-normalised, mix
clipped to ±1): **click** (5 ms decaying noise burst), **pop** (80 ms
plosive pressure pulse), **bump** (400 ms 55+130 Hz decaying desk thump).
Patterns: single at 10 s (A = 0.3 and 1.0), every 4 s (A = 1.0, 14×),
typing burst (10× at 250 ms, A = 1.0). Metric vs the SAME variant's
no-transient run, with frames whose decode can see the transient (buffer
of f..f+L overlapping the transient + 100 ms) excluded: loss % =
clean-voiced frames that became unvoiced; recovery = time from the (last)
transient to the last lost frame.

The oracle's numbers are means over all four sources, so they include
private session audio; results on the private session recordings are kept outside this repository. In
summary: after a single full-scale transient at quiet-mic levels,
production loses a large share of voiced frames for the rest of the clip;
the recommended `kthg12r5 κ=1.2` keeps the loss near zero in every cell.
The public frame-level evidence for the same behaviour is §4e (0/116,
0/113 and 0/100 post-transient frames voiced in production).

### 2a. Screening (22 + 5 + 2 variants)

Worst cell = max loss over all 12 transient cells × 4 sources × 3 levels.
Verdicts by family:

- **prod** (running max) — the defect.
- **attack-rate limit** `max(gp·d, min(lp, k·gp))`, k ∈ {1.5, 2, 3, 4} — ✗ a
  click lives in ~4 frames → k⁴ growth; decay unchanged so recovery
  unchanged.
- **percentile of frame peaks** (p90 / 10 s, p95 / 30 s, p99 / 30 s) — ✗
  repeated pops/bumps leak; long-silence drift (§4c).
- **hybrid percentile + decay floor** — ✗ inherits the leak and the decay
  latch.
- **opening** (min of last M peaks) + decay — ✗ open6 lets sustained bumps
  pass; open12 lowers the reference.
- **periodicity-gated attack** (aperiodic frame cannot raise) — ✗
  window-EDGE frames of a click are periodic but their localPeak includes
  it.
- **opening + periodicity gate** — openv6 / openv8 (κ=1) ✓ transients, ✗
  level (§3); openv5 ✗ (pops span 6-7 frames).
- **level-calibrated** — openv6 κ=1.3 ✓; **kthg12r5 κ=1.2 (recommended)** ✓.

## 3. The level trap — why the first robust candidates were rejected

`openv6` (κ=1) passed every transient cell but its reference sits below
the running max on running speech (the min-over-6-frames of a syllable is
below its onset peak). Real recordings have a large mass of quiet
inter-phrase frames sitting right at the silence-term threshold, so a
lower reference flips quiet, Praat-unvoiced hops to voiced (false
voicing; measured on the private session recordings, results kept outside
this repository), and the noise oracle's 3 s post-speech tail false
voicing rose (fan-hum 20 dB 88.8 → 99.9 %, babble 30 dB 0 → 4.0 %, §4c).
An offline proxy (`offline-proxy*.py`: recompute localPeak from the WAV,
take best-candidate r from the stored baseline cands, count frame-local
voicing flips vs prod) showed that even a small reference drop flips hops,
so every robust design must be **re-centred on the old running max for
transient-free speech**. Two calibrated designs reached the running-max
level: `openv6 κ=1.3` and `kthg12r5 κ=1.2`.

Important context found on the way: real recordings already run on a
transient-set reference part of the time (the max-hold's source frame was
aperiodic, i.e. a click/bump, not voice), so some changes on real speech
are that latch being removed ("unmasking"), not collateral.

## 4. Recommended design — gated rank reference (`kthg12r5`, κ = 1.2)

Per frame: if the frame's own AC is periodic (best in-range candidate
r ≥ 0.35) its `localPeak` enters a 12-frame (300 ms) ring, otherwise 0
enters. The reference candidate is 1.2 × the **5th-largest** ring value;
`globalPeak = max(candidate, globalPeak·0.999, 1e-4)` (decay and floor
unchanged).

Why it works by construction: an impulse is visible in at most ~4
frames (80 ms window, 25 ms hop), and of those only the window-edge
frames are periodic (the click dominates the AC of the centre frames),
so it can never fill 5 periodic slots; pops and bumps are aperiodic
throughout; a sustained aperiodic sound (1 s of loud noise, a cough)
contributes zeros. Sustained voice fills the window; κ = 1.2 maps the
rank-5 level back onto the running max (offline proxy on the private
session recordings). Startup is unchanged in spirit (the first periodic
frame already sets the reference, so the 2026-06-09 quiet tone decodes
voiced from frame 1). Long silences decay exactly as before.

### 4a. Full sessions

The full production chain (incl. display) was run on the private session
recordings; this change is **not** a half-pitch fix (the session
recordings are near full scale, where the latch is mild) — it is neutral
on the half-pitch metrics, as intended. Its value is the quiet-mic regime
(§2). Results on the private session recordings are kept outside this repository.

### 4b. Corpora (worker mirror, cold stream per track; deltas vs prod, pp)

Unscaled (near full scale): FDA m correct +0.13 (nulls −0.13; <125 Hz
band +0.21), vocadito +0.44 (nulls −0.45); FDA f, PTDB m/f (incl. male
<125 and 125-160 bands), Hillenbrand m/w: 0.00 (Hillenbrand nulls
±0.01). **Octave-up and octave-down deltas: 0.00 on every corpus and
band.** max(F_err, M_err) 37.31 / 35.68 → unchanged. Quiet-scaled
(each track peak 0.02 + mic floor): identical except vocadito +0.22
correct, Hillenbrand m −0.01 / nulls +0.03. (Absolute Hillenbrand
correct is low in this mirror because the worker drops the L trailing
frames of each short track; deltas are what matter here.)

### 4c. Noise-only false voicing (scripts/noise-augment-oracle.js, pitch mode, + 30/40 dB cells)

FDA (100 tracks) speech correct % / false voicing on the 3 s noise-only
tail %, 8 s noise lead, oracle default front-end `none` (no notch — the
harsher condition for tonal noise):

| noise | SNR | prod correct / FV tail | openv6 correct / FV tail | openv6k1.3 correct / FV tail | kthg correct / FV tail | p90_10s correct / FV tail |
|---|---|---|---|---|---|---|
| white | 40 | 86.8 / 0.0 | 86.9 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 | 86.9 / 0.0 |
| white | 30 | 86.7 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 | 86.7 / 0.0 | 86.8 / 0.0 |
| white | 20 | 86.1 / 0.0 | 86.2 / 0.0 | 86.2 / 0.0 | 86.2 / 0.0 | 86.2 / 0.0 |
| white | 10 | 80.7 / 0.0 | 80.7 / 0.0 | 80.7 / 0.0 | 80.7 / 0.0 | 80.7 / 0.0 |
| pink | 40 | 86.6 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 | 86.6 / 0.0 | 86.7 / 0.1 |
| pink | 30 | 86.6 / 0.0 | 86.6 / 0.0 | 86.6 / 0.0 | 86.6 / 0.0 | 86.6 / 0.4 |
| pink | 20 | 86.1 / 1.0 | 86.1 / 0.8 | 86.1 / 0.9 | 86.1 / 0.9 | 86.1 / 0.8 |
| pink | 10 | 81.8 / 0.5 | 81.8 / 0.5 | 81.8 / 0.5 | 81.8 / 0.5 | 81.8 / 0.5 |
| fan-hum | 40 | 86.7 / 0.0 | 86.8 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 | 86.8 / 2.9 |
| fan-hum | 30 | 86.1 / 0.0 | 86.2 / 0.1 | 86.2 / 0.1 | 86.2 / 0.0 | 86.2 / 36.0 |
| fan-hum | 20 | 72.9 / 88.8 | 72.9 / 99.9 | 72.9 / 94.4 | 72.9 / 91.8 | 72.9 / 100.0 |
| fan-hum | 10 | 41.0 / 100.0 | 41.0 / 100.0 | 41.0 / 100.0 | 41.0 / 100.0 | 41.0 / 100.0 |
| mains-complex | 40 | 86.8 / 0.0 | 86.9 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 | 86.9 / 0.0 |
| mains-complex | 30 | 86.6 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 |
| mains-complex | 20 | 85.1 / 0.0 | 85.2 / 0.0 | 85.2 / 0.0 | 85.2 / 0.0 | 85.2 / 0.0 |
| mains-complex | 10 | 70.9 / 0.0 | 70.9 / 0.0 | 70.9 / 0.0 | 70.9 / 0.0 | 70.9 / 0.0 |
| babble | 40 | 86.6 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 | 86.7 / 3.1 |
| babble | 30 | 86.6 / 0.0 | 86.6 / 4.0 | 86.7 / 0.2 | 86.6 / 0.3 | 86.6 / 53.1 |
| babble | 20 | 85.6 / 91.0 | 85.6 / 97.9 | 85.6 / 94.1 | 85.6 / 92.4 | 85.6 / 98.1 |
| babble | 10 | 71.9 / 98.1 | 71.9 / 98.1 | 71.9 / 98.1 | 71.9 / 98.1 | 71.9 / 98.1 |
| crickets | 40 | 86.7 / 0.0 | 86.8 / 0.0 | 86.7 / 0.0 | 86.7 / 0.0 | 86.8 / 0.0 |
| crickets | 30 | 86.6 / 0.0 | 86.7 / 0.1 | 86.7 / 0.0 | 86.7 / 0.0 | 86.7 / 0.7 |
| crickets | 20 | 86.3 / 0.9 | 86.4 / 0.9 | 86.4 / 0.9 | 86.4 / 0.9 | 86.4 / 0.9 |
| crickets | 10 | 81.7 / 0.9 | 81.8 / 0.9 | 81.8 / 0.9 | 81.8 / 0.9 | 81.8 / 0.9 |
| cicadas | 40 | 86.7 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 |
| cicadas | 30 | 86.7 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 | 86.8 / 0.0 |
| cicadas | 20 | 86.3 / 0.0 | 86.3 / 0.0 | 86.3 / 0.0 | 86.3 / 0.0 | 86.3 / 0.0 |
| cicadas | 10 | 80.7 / 0.0 | 80.7 / 0.0 | 80.7 / 0.0 | 80.7 / 0.0 | 80.7 / 0.0 |

Speech accuracy identical in every cell (±0.1). Tail false voicing flat
except the two cells that are already saturated failures in production
without the notch — fan-hum 20 dB 88.8 → 91.8 % and babble 20 dB 91.0 →
92.4 % (babble is real speech, so "voiced" there is defensible) — and
babble 30 dB 0.0 → 0.3 %. Re-run of those cells with the **production
notch front-end** (`--frontend=tracker`): fan-hum 30/20 dB 0.0/0.0 →
0.0/0.1 %, babble 30/20 dB 0.0/91.0 → 0.3/92.4 %. White, pink, mains,
crickets, cicadas: unchanged at every SNR incl. the new 30/40 dB
quiet-room cells. (p90/10 s, by contrast, drifts: fan-hum 30 dB 36 %,
babble 30 dB 53 %.)

### 4d. Long silence and soft onset (`long-silence.mjs`)

20 s speech @P → 60 s noise-only → 10 s soft speech (−10 dB, 300 ms
fade-in); noise = mic floor + {pink, fan-hum, babble, white} at 20/30/40
dB SNR re speech, or floor only; the same 4 speech sources as §2 (incl.
the private session excerpts) × P ∈ {0.03, 0.01}. False voicing in the
silence and the soft-onset voicing were flat or better for kthg vs
production, while p90 / 10 s drifted up during silences. Results on the private session recordings are kept outside this repository.

### 4e. Frame-level tests

`gp-frame-tests.mjs` → proposed block for `tests/dsp/boersma-ac-test.js`
(quiet 200 Hz harmonic voice at peak ~0.02 + mic floor, frame-local
`detect()` at the 25 ms hop):

| case | production | proposed |
|---|---|---|
| voiced in every frame after a full-scale click (5 ms) | ✗ 0/116 | ✓ |
| … after a full-scale plosive pop (80 ms) | ✗ 0/113 | ✓ |
| … after a full-scale desk bump (400 ms) | ✗ 0/100 | ✓ |
| sustained loud voice sets the reference (loud frame voiced) | ✓ | ✓ |
| frame 40 dB below a sustained voice is unvoiced (silence term intact) | ✓ | ✓ |
| voiced after 1 s of loud (0.5) aperiodic noise | ✗ 33/76 | ✓ |
| 2026-06-09 quiet-mic fixture (100 Hz @0.02, kept verbatim) | ✓ | ✓ |

Full proposed test file: 31/31 on the proposed module, 27/31 on
production (the four new transient cases fail, as they should).

### 4f. CPU

Reference update ≈ 0.22 µs/frame in isolation (12-slot ring, 5-pass
selection, zero allocation). `candidates()` 0.60 ms (prod) vs 0.62 ms
(proposed) median of 7 interleaved reps on 60 s of speech under
concurrent load — within run-to-run noise; far under the 25 ms hop.

## 5. Chosen config + why

`kthg12r5, κ = 1.2, periodic r ≥ 0.35` (constants `referenceWindow 12`,
`referenceRank 5`, `referenceGain 1.2`, `referencePeriodicR 0.35` in
`BOERSMA_DEFAULTS`). Quiet-mic transient loss near zero in every oracle
cell (§2; frame-level tests §4e: every post-transient frame voiced, vs
none for production); quiet-mic fixture still voiced; corpora unchanged
within ≤ +0.44 pp (all improvements; octave errors exactly unchanged);
long-silence / soft-onset / noise-oracle false voicing flat or better.
The private-session checks (kept outside this repository) agreed. Over
`openv6 κ=1.3` (statistically tied): kthg rejects aperiodic content by
construction for the WHOLE window (aperiodic frames enter as 0), while
openv only gates the current frame — after a long aperiodic burst its
min-over-6 still contains burst-level peaks on the first periodic frame;
kthg also has the lower worst transient cell.

## 6. Rejected options

- **Attack-rate limiting** (k ∈ {1.5, 2, 3, 4}): an impulse occupies ~4
  analysis frames, so per-frame limiting still grows k⁴; and the decay
  (= recovery) is untouched. rate1.5 still loses heavily on bumps /
  repeated transients.
- **Percentiles** (p90/p95/p99 over 10/30/60 s): single transients fine,
  repeated ones (every 4 s ≈ 9 % of frames, typing bursts) leak; p90/10 s
  (the best) drifts down during silences (noise-oracle tail false voicing:
  fan-hum 30 dB 36 %, babble 30 dB 53 %, §4c).
- **Hybrid percentile + decay floor**: inherits the leak and the decay
  latch.
- **Opening (min over M)**: open6 lets 400 ms bumps through; open12 still
  fails cells and lowers the reference.
- **Periodicity gate alone**: fails clicks via the periodic window-edge
  frames.
- **Uncalibrated robust trackers (openv6/8 κ=1)**: transient-perfect but
  a lower reference → more false voicing on real recordings and higher
  noise-tail false voicing (§3).
- **Faster decay after unvoiced spikes**: subsumed — the periodicity
  gate + rank requirement prevent the spike from entering at all, so no
  special decay path is needed (open8 with decay 0.998 was screened and
  rejected; faster decay drifts in silence).

## 7. Reproduce

Committed guard (runs anywhere):

```
node tests/dsp/boersma-ac-test.js               # 31/31 incl. the 5 transient cases
```

Scratch harnesses (main checkout, gitignored `build/`; the session steps —
transient oracle, chain-harness session runs and scoring, offline proxy,
long silence — need private session recordings and phase-1 references
that live outside the repo and are omitted here):

```
cd build/measure-2026-10-03/globalpeak
node baseline-match.mjs 300                     # §1 (real worker vs mirror, bit-exact)
node verify-proposed.mjs                        # proposed module == kthg variant
# §4b corpora
node corpus-runner.mjs --variants='[{"kind":"prod"},{"kind":"kthg","W":12,"rank":5,"kappa":1.2}]'
node corpus-runner.mjs --variants='[...]' --scale=0.02
# §4c noise oracle
GP_SPEC='{"kind":"kthg","W":12,"rank":5,"kappa":1.2}' node noise-oracle-gp.mjs pitch --snrs=40,30,20,10
GP_SPEC='{"kind":"kthg","W":12,"rank":5,"kappa":1.2}' node noise-oracle-gp.mjs pitch --frontend=tracker --noises=fan-hum,babble --snrs=30,20
# §4e tests
GP_SPEC='{"kind":"kthg","W":12,"rank":5,"kappa":1.2}' node gp-frame-tests.mjs; node gp-frame-tests-prod.mjs
node mirror/tests/dsp/boersma-ac-test.js         # proposed test file on proposed module
node bench2.mjs                                  # §4f
```

## 8. Caveats

- **Known limitation — warm-up (documented 2026-10-04, review split-vote
  finding, reproduced).** Until the ring holds `referenceRank` (5) entries,
  the rank is clamped to the fill count (`Math.min(referenceRank, refFill)`):
  on the very first frame the reference is 1.2 × that frame's own peak if the
  frame is periodic-gated. A click whose periodic window-edge frame is the
  stream's first analysis frame therefore still latches the reference, as
  before this change. Frame-local probe (`createBoersmaAC` directly, 200 Hz
  10-harmonic voice at ~0.03 peak, one 1.0 click; scratch
  `build/gp_warmup_probe*.mjs` in the worktree): a click at 0 or 2 ms
  blanked the voice for ~9 s (first voiced frame at 8.9–9.1 s, whether the
  voice started at 0 or 0.5 s); a click at ≥ 20 ms into the stream (or at
  0.03 s before a voice starting at 0.5 s) did not latch — by then the fill
  minimum includes non-transient frames. In practice the exposure is a
  mic-open pop in the first ~25–50 ms of audio. Not re-measured through the
  real worker (whose first frames include the zero-filled buffer) or the
  transient oracle. Candidate fix (not shipped): do not raise the reference
  until `referenceRank` periodic frames exist (start from the floor) — it
  changes startup behaviour (the 2026-06-09 quiet-tone case decodes voiced
  from frame 1 today), so it needs the transient oracle + soft-onset
  re-measure before shipping.

- Transients are synthetic (speech is real). Field validation with a
  real AGC-off mic and real clicks/pops is the follow-up; the diag
  overlay's confidence sparkline will show the latch if it recurs.
- The rank gate means a *periodic* loud sound lasting ≥ ~5 frames
  (≥ ~45 ms beyond the window) — a sung note, a tonal beep — still
  raises the reference, by design (that is "loud voice-like content").
- The periodicity gate's threshold (0.35) equals today's
  voicingThreshold but is a separate constant, so a future vt re-tune
  does not silently move the reference.
- Measured scratch-only; `npm run lint` / `npm run build` and the
  regression checklist were run when the change was integrated
  (branch `target-voice-pitch-fix`).
- Sibling-workstream interaction: the periodicity gate takes the best
  candidate `r` over the whole search range. With the 2026-10-03 search
  ceiling raise to 800 Hz ([pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md))
  that range includes 400–800 Hz candidates; this file measured the
  400 Hz search. The combined chain is re-validated as a whole after
  integration.
