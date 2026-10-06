# Real-noise false voicing — attribution and candidates (2026-10-05)

Branch `realnoise-false-voicing` (from `notch-voice-discrimination` @ 7998e22,
whose notch is V14 — [noise-notch-voice-discrimination-2026-10-05.md](noise-notch-voice-discrimination-2026-10-05.md)).
Data: the real corpora of [notch-realdata-corpora-2026-10-05.md](notch-realdata-corpora-2026-10-05.md),
public sources only (the opt-in private source is excluded by allowlist in
every script). Tools: [scripts/realnoise-fv/](../scripts/realnoise-fv/README.md).
Per-clip table: [realnoise-false-voicing-2026-10-05/clips.csv](realnoise-false-voicing-2026-10-05/clips.csv).

## Decision

**No production change.** The best candidate — a learned-background voicing
veto, [scripts/realnoise-fv/cand/noise-floor-guard.js](../scripts/realnoise-fv/cand/noise-floor-guard.js) —
**does not meet the ship rule** and is kept as a candidate, not wired into
`src`.

| ship-rule item | anchored candidate (`fgA`) vs base, held-out noise split unless noted | verdict |
|---|---|---|
| noise-only false voicing down, every class | painted 23.52 → 20.96 % (all 279 clips: 23.93 → 21.39 %); stationary-tonal 20.70 → 17.84, mixed 28.40 → 25.29, broadband 10.78 → 10.62; intermittent-tonal (1 held-out clip) 79.20 → 79.20 (all 10 clips: 26.55 → 26.33); 0 clips > base + 2 pp | down in 3 of 4 classes on the held-out split, flat in the 4th |
| FDA / PTDB-TUG / Hillenbrand / vocadito, worker + displayed, max(F_err, M_err), < 160 Hz | identical (every frame) | pass |
| held-note suite (1 196 scenarios, 16 + 48 kHz) | 91.20 → 91.20 %, 0 scenarios > 1 pp below | pass |
| real held series (192), gated real sources (504) | identical 192 / 192, 504 / 504 | pass |
| voice in noise (784 mixes), painted at pitch | +10 dB 82.12 → 82.13, 0 dB 54.99 → 54.93; **< 160 Hz 0 dB 63.75 → 63.57**; 13 / 784 streams lose > 1 pp (worst −4.4 pp: low male voices in low-frequency-heavy machine noise at 0 dB) | **small regression** |
| real-session false-voicing oracle (private) | on the private session recordings false voicing in non-voiced spans went down and low-register displayed accuracy went down slightly, in line with the voice-in-noise row (numbers kept outside this repository) | **small regression** |

The unanchored variant removes more false voicing (all clips 23.93 → 19.89 %,
held-out 23.52 → 20.32 %, intermittent-tonal 26.55 → 20.84 %) with the same
voice-in-noise cost, but blanks 4 held-suite scenarios by 11–21 pp (§3.6).
The trade is listed under *decisions for the user*; what a passing fix would
need is §5.

**The attribution's main findings** (§1): the user-visible false voicing on
real noise is **2× the earlier probe's number** because the 400 ms pitch-hold
bridge paints half of it; **notch capacity is irrelevant** (1 % of false
voicing; unlimited slots change nothing); the notch's misses are line-tracking
(re-born / low-duty tracks, 44 %) and periodicity on no tracked line (46 %);
34 % of the posted false voicing passes the harmonic guard only on its
debounce; the silence term and silence gate are inert by construction; the
first 5.5 s carry 15 % of it; and the gender model scores 40 % of its
inference ticks on noise-only audio.

## 0. Method

**Production chain, not a display replay.** Every number runs the real pitch
worker (notch, ghost veto, above-range null, harmonic guard), the real DSP
worker and the real main-thread display decision (`useAudioPipeline.js`
`handleAnalysisResult`: silence gate, 400 ms pitch-hold bridge, smoothing
restart, paint gate) through `scripts/session-oracle/lib/chain.mjs`.
Observation-only taps record the detector, tracker, harmonic guard and notch
state per hop (`lib/tap-boersma.mjs`, `lib/tap-notch.mjs`; parity: tapped =
untapped on posted pitch, confidence, notch count, painted value, readout,
style and gender verdict). "Painted" = what the live trace draws. The earlier
probe (`probe.mjs`, `realeval.mjs`) replays a display **without** the hold
bridge (§1a).

**Sets** (public, 16 kHz): noise-only — the 279 non-duplicate clips ≥ 10 s
(first 90 s; stationary-tonal 102 / intermittent-tonal 10 / mixed 133 /
broadband 34); voice in noise — 784 mixes (20 s real-noise lead, real voice
program, 5 s tail, +10 / 0 dB); gated real sources — 504; real held series —
192; FDA, PTDB-TUG, Hillenbrand, vocadito (corpus.mjs conventions; `score.py`
reproduces corpus.mjs exactly on FDA); the notch work's synthetic held-note
suite (598 scenarios × 16 / 48 kHz; base reproduces its 91.20 %).

**Split.** Noise *sources* were split before any candidate existed: a noise
group (a DCASE machine id with all its segments; otherwise the clip) is
held out when FNV-1a(group) % 3 = 0 — 85 noise-only clips (only one of them
intermittent-tonal) and 270 voice-in-noise mixes. The offline feasibility
sweeps (§3.4) used all clips; the real-chain variant selection (§3.5) used the
tuning split only; §4 reports held-out and all.

**Gender VAD replay.** `gender-worker.js` `maybeInfer` replayed on the same
audio at its 150 ms cadence with the pitch messages of earlier chunks (0.75 s
window, silence floor, 500 ms voiced recency, sub-floor probe with the relayed
notch frequencies, stale fallback).

## 1. Attribution (step 1, no tuning)

Base = `src` at 7998e22.

### 1a. What the user sees is twice the probe's number — the hold bridge

| class | clips | painted mean | p90 | max | fresh | held (hold bridge) | posted | painted 0–5.5 s | 5.5–20.5 s | ≥ 20.5 s |
|---|---|---|---|---|---|---|---|---|---|---|
| stationary-tonal | 102 | 27.1 % | 72.3 % | 96.8 % | 15.1 % | 12.0 % | 17.1 % | 38.8 % | 27.1 % | 24.5 % |
| intermittent-tonal | 10 | 26.5 % | 80.1 % | 88.2 % | 13.6 % | 12.9 % | 15.2 % | 38.2 % | 20.9 % | 3.4 % |
| mixed | 133 | 24.1 % | 70.1 % | 99.5 % | 11.8 % | 12.3 % | 13.8 % | 25.8 % | 23.9 % | 24.3 % |
| broadband | 34 | 13.1 % | 49.5 % | 63.1 % | 5.6 % | 7.4 % | 7.2 % | 11.2 % | 13.4 % | 11.9 % |
| **all** | 279 | **23.9 %** | 67.9 % | 99.5 % | 12.3 % | **11.6 %** | 14.3 % | 29.2 % | 23.6 % | 22.2 % |

- **The pitch-hold bridge paints half of it.** After a short false-voiced run
  the hook holds the last smoothed value for up to 400 ms on-level
  (`pitchGate.js` `PITCH_HOLD_MAX_MS`); runs a few hundred ms apart join into a
  continuous line. An MS-SNSD air conditioner posts 15.5 % of frames voiced and
  paints 54 % (42 % held). The probe's 12.9 / 9.3 / 4.5 % (stationary / mixed /
  broadband) are the fresh part only.
- **Steady state dominates.** 14.6 % of all painted false-voiced hops fall in
  0–5.5 s (11.7 % of the time, before any line can promote), 27.8 % in
  5.5–20.5 s and 57.6 % after 20.5 s.
- **Concentration.** 55 / 279 clips paint > 50 % of the time, 108 < 5 %; the
  top 10 % of clips carry 49 % of the painted false-voiced seconds.

### 1b. Worker funnel (pooled, % of analysed frames)

| class | frame-local voiced | decoded voiced | ghost-vetoed | above-range null | harmonic guard vetoed | posted | painted fresh | painted held |
|---|---|---|---|---|---|---|---|---|
| stationary-tonal | 51.4 | 46.6 | 5.2 | 13.5 | 10.7 | 17.3 | 15.3 | 11.2 |
| intermittent-tonal | 30.3 | 24.4 | 2.0 | 11.4 | 2.8 | 8.2 | 7.2 | 5.7 |
| mixed | 47.7 | 40.1 | 0.9 | 11.3 | 12.8 | 15.1 | 12.6 | 11.5 |
| broadband | 37.3 | 29.1 | 0.0 | 15.7 | 6.7 | 6.7 | 5.1 | 7.2 |
| all | 47.3 | 40.7 | 2.5 | 12.7 | 10.9 | 14.7 | 12.6 | 10.7 |

- **Detector.** Half of all real-noise frames are frame-locally voiced, with
  real margins: best candidate minus unvoiced strength p10 / p50 / p90 =
  0.04 / 0.26 / 0.61 on posted false-voiced frames. A voicing-threshold change
  cannot fix it.
- **Silence term.** Inert on stationary noise by construction (its reference
  is the running peak of the noise itself): it turned 1.5 % of strong frames
  unvoiced and was active on 0.7 % of posted false-voiced frames.
- **Above-range null** removes 12.7 pp, the **harmonic guard** 10.9 pp, the
  **ghost veto** 2.5 pp, the **paint gate's onset confirmation** ~2 pp.
- **Harmonic-guard debounce.** 34 % of posted false-voiced frames have a
  harmonic count < 2 and pass only on the 4-frame debounce. Tightening it costs
  low voices: 23 % of correct PTDB-TUG male frames at 75–110 Hz also count < 2
  (the ±35 % band median sits inside a low harmonic's main lobe at 80 ms /
  12.5 Hz resolution), vs 1–3 % above 160 Hz (§3.2).

### 1c. Notch: capacity is not the problem

Each posted false-voiced frame vs the lines the notch tracker saw in its last
two observations (a line is *related* when it is h × f, h = 1..8, or f / 2):

| class | posted FV frames | N0 no line seen | N1 no related line | N2 related, none notched | N3 partly notched | N4 all related notched |
|---|---|---|---|---|---|---|
| stationary-tonal | 34 848 | 3.5 | 34.2 | 51.8 | 7.0 | 3.4 |
| intermittent-tonal | 1 417 | 4.1 | 27.4 | 68.2 | 0.1 | 0.1 |
| mixed | 36 800 | 4.4 | 45.9 | 48.2 | 1.1 | 0.3 |
| broadband | 4 315 | 17.5 | 63.0 | 19.5 | 0.0 | 0.0 |
| all | 77 380 | 4.7 | 41.3 | 48.6 | 3.7 | 1.7 |

Why the related lines were not notched (% of all posted false voicing):
**young 26.2** (the track was re-born — a line wobbling past the 3 Hz
association, flickering under the peak tests, or split; only 8.6 of it in the
first 5.5 s), **duty < 0.9: 18.3**, onset / voice timing 4.0, **over capacity
1.0**. All related lines notched yet voiced: 1.7, mostly at f = line / 2 (the
ghost veto covers 1× and 2× a line). 46 % of posted false-voiced frames relate
to no tracked line, 30 % to one.

Counterfactuals (real chain, all 279 clips):

| run | painted | posted |
|---|---|---|
| base | 23.9 % | 14.3 % |
| no notch (promotion disabled) | 29.2 % | 19.4 % |
| unlimited notch capacity (`maxNotches` 99) | 23.9 % | 14.2 % |
| absurdly eager notch (promote at 1 s, duty 0.5, 12 slots, 4 s miss, 5 Hz match, no onset timing) | 15.8 % | 8.2 % |

The shipped notch removes 5.3 pp (12.9 pp on stationary-tonal); more slots buy
nothing; even a notch that would also cut every held note leaves 15.8 %
painted. Worst clips are lines the tracker sees but never promotes: an HVAC
with 5 lines at duty < 0.9 (97 % painted), a pump whose ~97 Hz fundamental
wanders across three tracks (99 %), a microwave whose 60 Hz-family stack is
notched but which then decodes at the unnotched 120 Hz (90 %).

### 1d. Silence gate and gender VAD

- **Silence gate** cannot suppress a voiced frame (AND-logic; a posted pitch
  has confidence ≥ 0.5); it only stops the hold on quiet frames. At the
  recordings' own level 5.7 % of painted false-voiced hops are below −50 dB.
- **The gender model is fed by these frames.** On noise-only audio 39.7 % of
  inference ticks are scored: 30.1 % via a voiced pitch within 500 ms, 9.6 %
  via the sub-floor probe (15.3 % on stationary-tonal, 27.4 % on intermittent:
  unnotched machine periodicity at 40–75 Hz); 198 / 279 clips score > 10 % of
  their ticks; per clip, painted false voicing vs scored ticks r = 0.76.

## 2. Ruled out by the attribution

| lever | evidence |
|---|---|
| more notch slots / harmonic-comb notching of a stack | over-capacity 1 % of posted FV; unlimited slots 23.9 → 23.9 %; 46 % of FV frames relate to no tracked line |
| voicing threshold | FV margins p50 0.26 |
| silence term / silence gate | inert on stationary noise by construction |
| faster / looser promotion alone | eager-notch bound 15.8 % and it would cut held notes; promotion timing is the other branch's subject |

## 3. Candidates (step 2)

### 3.1 Display: restrict the hold bridge (`pitchGate.js`; real hook replayed over the dumps, exact)

| candidate | noise painted | voice in noise painted +10 / 0 dB | FDA / PTDB painted max(F,M) error |
|---|---|---|---|
| base | 23.9 % | 82.12 / 54.99 % | 16.71 / 19.07 % |
| hold ≤ the fresh run before the gap | 16.4 % | −1.31 / −2.95 pp | +0.57 / +2.16 pp |
| hold max 400 → 200 ms | 19.2 % | −0.64 / −1.96 pp | +0.39 / +0.66 pp |

Rejected: in speech, and more in noisy speech, the bridge carries voiced frames
the detector nulls, and an expired hold restarts the paint gate's 3-frame onset
confirmation.

### 3.2 Harmonic-guard variants (offline, exact at worker level: the guard feeds nothing back)

| rule | noise posted | PTDB max(F,M) error | FDA max(F,M) error | voice in noise worker +10 / 0 dB |
|---|---|---|---|---|
| base (≥ 2 of h = 1..4 at 10 dB over the ±35 % median, debounce 4) | 14.26 % | 15.71 % | 14.27 % | 81.80 / 51.02 % |
| debounce 1 | 9.03 % | 27.92 % | 18.12 % | — |
| ≥ 3 harmonics, debounce 4 | 5.88 % | 22.50 % | 17.47 % | — |
| valley prominence: ≥ 3 of h = 1..8 ≥ 10 dB over the inter-harmonic valleys, debounce 2 | 12.51 % | 17.51 % | 15.57 % | −2.48 / −2.90 pp |
| valley ≥ 2 of 8 at 10 dB OR the current count, debounce 2 | 20.87 % | **14.25 %** | **14.01 %** | +0.50 / +1.44 pp |

Frame harmonicity alone sits on one frontier: real machine false voicing is
genuinely harmonic. (The last row is a voice *gain* — noted for low-register
work — paid for with more false voicing.)

### 3.3 Other rejected candidates (offline, worker level)

- **Energy-onset anchoring** (a voiced segment counts only if it starts within
  200 ms of a ≥ 6 dB rise over the 2 s band-energy minimum): noise posted
  14.3 → 7.8 %, clean corpora unchanged, voice in noise −1.5 pp at +10 dB and
  −13 pp at 0 dB (first 149 mixes) — a 0 dB voice raises the band level ~3 dB.
- **Machine-line veto** (veto f / 2f on an un-notched line the notch's line
  verdict calls machine): 14.3 → 13.3 % — related lines are mostly too young
  for a verdict.
- **Pitch persistence** (a pitch posted in ≥ 30 % of the last 5 s ± 1.5 %):
  23 % of noise FV frames vs 31 % of correct voice-in-noise frames — no
  separation.

### 3.4 What a voice adds: harmonic energy above the room's own spectrum (offline)

A stationary background's false voicing is made of the background; a voice
adds energy at its harmonics above what the room has shown there. Per decoded
frame (`floorfeat.py`): excess_h = the frame's power at h·f0 over the minimum,
over the last W s, of the 400 ms-averaged spectrum, h = 1..8. Worker level,
all clips (X dB, ≥ M harmonics, D-frame debounce, 20 s, 2 s fail-open):

| rule | noise posted | voice in noise +10 / 0 dB | FDA / PTDB / vocadito |
|---|---|---|---|
| X 10, M 2, D 4 | 12.95 % | −0.01 / −0.02 pp | 0 |
| X 14, M 1, D 4 | 11.09 % | 0.00 / −0.03 pp | 0 |
| X 16, M 1, D 4 | 9.74 % | −0.03 / −0.13 pp | 0 |
| X 12, M 3, D 2 | 8.53 % | −0.88 / −1.65 pp | −0.4 to −0.7 pp |

Percentile floors, harmonic-minus-valley excess and frequency-dilated floors
moved along the same frontier.

### 3.5 Real-chain implementation (`cand/noise-floor-guard.js`)

Background windows enter the minimum only when all 16 frames of a 400 ms
average were posted unvoiced (the worker's own verdict before this guard).
What the offline model missed, each found on the real chain:

1. **Voice from the stream start** would become its own background if every
   frame taught; background windows only, and fail open until one exists (a
   stream false-voiced throughout keeps its false voicing — the HVAC clip).
2. **Self-teaching.** A run this guard vetoes must not count as background
   (a hold series in a ballast at +10 dB lost 71 frames before the fix).
3. **Empty window = open.**
4. **Window 60 s, not 20 s.** A voice the detector misses at 0 dB is
   "unvoiced"; once the pre-voice background ages out of a 20 s window it can
   enter the floor (a 0 dB male hold series in an HVAC lost 6 pp).
5. **Anchor.** Frames only the harmonic guard removed may join the minimum but
   never found it: the floor is used only while the window holds a background
   window of frames unvoiced already before the harmonic guard. Without it, a
   breathy note sung from the stream start, whose H1 the notch took after
   5.4 s, taught itself as background through its guard-vetoed frames
   (held-suite `start/220/12s/breathy`, 4 scenarios −11 to −21 pp).

Tuning split (194 noise clips, 514 voice-in-noise mixes), before the anchor rule:

| variant | noise painted (stat / int / mixed / broad) | voice in noise painted +10 / 0 dB | < 160 Hz painted 0 dB | streams > 1 pp worse (painted) |
|---|---|---|---|---|
| base | 24.11 (30.18 / 20.70 / 22.29 / 14.29) | 82.04 / 54.22 | 63.92 | — |
| X 14, D 4, W 20 s | 19.10 (23.12 / 14.35 / 18.31 / 11.78) | −0.01 / −0.15 | −0.25 | 15 |
| X 12, D 4, W 20 s | 21.47 | 0.00 / −0.05 | −0.07 | 5 |
| X 14, D 6, W 20 s | 19.62 | −0.02 / −0.11 | −0.19 | 13 |
| X 14, D 4, W 40 s | 19.61 | 0.00 / −0.10 | −0.20 | 11 |
| **X 14, D 4, W 60 s** | **19.70 (24.00 / 14.35 / 18.89 / 11.89)** | **0.00 / −0.06** | **−0.20** | 9 |

Learning restrictions tried instead of the anchor (tuning split, W 60 s):
tracker-unvoiced frames only — 21.26 %, < 160 Hz 0 dB −0.41; all but
harmonic-guard-vetoed frames — 20.62 %, −0.40; all but ghost-vetoed frames —
did not fix the breathy scenarios. A 200 ms guard interval before a background
window (against decay tails) and an "all frames" floor were worse.

### 3.6 Anchor variants, all clips / held-out

| variant | noise painted, all (held-out) | intermittent-tonal, all | held-suite scenarios > 1 pp below base |
|---|---|---|---|
| base | 23.93 (23.52) | 26.55 | — |
| no anchor | 19.89 (20.32) | 20.84 | 4 (−11 to −21 pp) |
| anchor within the 60 s window (`fgA`) | 21.39 (20.96) | 26.33 | 0 |
| anchor once since stream start | 21.36 (20.86) | 26.33 | 0 |

All three have identical voice-in-noise results (painted +10 / 0 dB 82.13 /
54.93 %, < 160 Hz 0 dB 63.57 %, 13 streams > 1 pp worse).

## 4. The anchored candidate in full (`fgA`)

| check | base | `fgA` |
|---|---|---|
| noise painted, held-out (85) / all (279) | 23.52 / 23.93 % | 20.96 / 21.39 % |
| … stationary-tonal / intermittent / mixed / broadband (all) | 27.11 / 26.55 / 24.08 / 13.05 | 24.13 / 26.33 / 21.47 / 11.44 |
| … p90 (all) | 67.9 % | 61.2 % |
| … clips > base + 2 pp | — | 0 |
| gender ticks scored on noise-only audio | 39.9 % | 37.1 % |
| voice in noise, held-out: painted +10 / 0 dB, < 160 Hz 0 dB | 82.28 / 56.47, 63.39 | 82.32 / 56.43, 63.24 |
| voice in noise, all: painted +10 / 0 dB, < 160 Hz 0 dB | 82.12 / 54.99, 63.75 | 82.13 / 54.93, 63.57 |
| … worker at pitch +10 / 0 dB (all) | 81.80 / 51.02 | 81.79 / 50.94 |
| … streams painted > 1 pp worse / better (all 784) | — | 13 / 31 |
| … lead / tail painted false voicing (all) | 30.07 / 26.65 % | 27.00 / 25.12 % |
| FDA, PTDB-TUG, Hillenbrand, vocadito (worker, display, < 160 Hz) | — | identical |
| held-note suite | 91.20 % | 91.20 % (0 scenarios > 1 pp below) |
| real held series / gated real sources | — | identical 192 / 192, 504 / 504 |
| synthetic noise oracle (`noise-fv.mjs`, 13 classes) | — | identical |
| pitch worker cost | 0.90 ms / chunk | 1.00 ms / chunk |

Why it misses: (1) gated real sources switch on over near-silence, so the
learned background never contains them (identical, no gain); (2) a stream
false-voiced throughout never shows a background window; (3) a 0 dB voice whose
harmonics barely clear a low-frequency-heavy machine (excess 5–12 dB) is
vetoed — the losing streams are mostly male voices around 100–130 Hz in
low-frequency-heavy machine noise (a toy car, a refrigerator).

## 5. What a passing fix would need

1. **A voice-proof background.** The floor must never learn a voice the
   detector misses. The notch's own line verdict (shared FM of a line and its
   2nd partial, [noise-notch-voice-discrimination-2026-10-05.md](noise-notch-voice-discrimination-2026-10-05.md))
   generalised to the whole comb would let the floor exclude voice-like spectral
   energy; a per-bin min over 60 s is not enough at 0 dB.
2. **The hold bridge** is half of what the user sees. A hold rule needs a
   speech-vs-noise discriminator that survives noisy speech (run length,
   density and age all cost voice frames, §3.1).
3. **Notch line tracking**, for the other branch: 44 % of posted false voicing
   sits on lines the tracker sees but re-births or rates below 90 % duty
   (wobble past the 3 Hz association, flicker, split tracks). Association
   tolerant of measured wobble and duty measured on a line *family* rather
   than a single track are the obvious next experiments; the eager-notch row
   (15.8 %) bounds them.
4. **Gender VAD:** the sub-floor probe accepts unnotched machine periodicity
   at 40–75 Hz (9.6 % of noise-only ticks); excluding lines the notch tracks
   (not only active notches) would remove most of it.

## 6. Merge notes

- `src/` is unchanged. `src/dsp/noise-notch.js` was never touched. Adopting the
  candidate = `cand/noise-floor-guard.js` into `src/dsp/` plus the worker
  edits `mktree.py` applies (`WIRE`: `observe()` after
  `detector.candidates()`, `decided()` / `check()` after the harmonic guard,
  construction in `init`, a test-only `init` switch `floorGuard: false`). It
  reads the post-notch analysis buffer, so it composes with any notch timing;
  re-run `attr.mjs` / `evalmix.mjs` / `held.mjs` on the merged tree.
- `tests/dsp/data/corpora.js` gained `SYRINX_CORPORA_DIR` (read another
  checkout's gitignored PTDB-TUG / FDA audio in place).

## 7. Reproduction (repo root; real corpora read in place)

```bash
export NOTCHVD_ROOT=<checkout that built them>/build/notchvd SYRINX_CORPORA_DIR=<checkout>/tests/dsp/data
R="node --import ./scripts/realnoise-fv/lib/register.mjs"; F=scripts/realnoise-fv
mkdir -p build/rnfv-trees/base0 && git archive 7998e22 src | tar -x -C build/rnfv-trees/base0
python $F/mktree.py fg fg_noanchor fg_sticky h_run1 h_max200   # candidate trees (CANDS)
# §1: attribution dumps + counterfactuals, then the tables
for i in 0 1 2; do $R $F/attr.mjs --src=build/rnfv-trees/base0/src --tag=base --shard=$i/3 & done; wait
$R $F/attr.mjs --src=build/rnfv-trees/base0/src --tag=cf_nonotch --notch-opts='{"minTrackSec":1e9,"onsetMinTrackSec":1e9}'
$R $F/attr.mjs --src=build/rnfv-trees/base0/src --tag=cf_cap99 --notch-opts='{"maxNotches":99}'
python $F/attr.py base
# voice sets and candidates through the same runner (also --split=tune|held)
for s in noise vin fda ptdb hil voc; do for t in base0 fg; do $R $F/attr.mjs --set=$s --src=build/rnfv-trees/$t/src --tag=$t; done; done
python $F/cmp.py base0 fg --split=held; python $F/vinscore.py base0 fg --split=held; python $F/score.py base0 fg
# §3.1 display candidates: replay the real hook over existing dumps
$R $F/replay.mjs --from=base0 --set=noise --src=build/rnfv-trees/h_run1/src --tag=h_run1
# §3.2-3.4 offline feasibility
python $F/harmfeat.py base0 noise; python $F/simguard.py base0 noise g_v 'vp:10:3:2'
python $F/floorfeat.py base0 noise --fsmooth=16 --suffix=16 --wins=400,800; python $F/simguard.py base0 noise ex 'ex:1:14:1:4:2'
# mixes, held suite, synthetic noise oracle
for s in gated held; do for t in base0 fg; do $R $F/evalmix.mjs --set=$s --src=build/rnfv-trees/$t/src --tag=$t; done; python $F/aggmix.py base0 fg --set=$s; done
node $F/held.mjs --trees=base0=build/rnfv-trees/base0/src,fg=build/rnfv-trees/fg/src --out=build/realnoise-fv/held/h.json
node scripts/notch-adversarial/agg-held.mjs build/realnoise-fv/held --vars=base0,fg --base=base0 --worse
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/noise-fv.mjs --src=build/rnfv-trees/fg/src --tag=fg
python $F/clips_csv.py base0 fg measurements/realnoise-false-voicing-2026-10-05/clips.csv
node $F/cand/noise-floor-guard-test.mjs            # candidate contracts (14 checks)
```

Runs used ≤ 3 concurrent processes (shared machine). `build/` holds every
dump (gitignored).
