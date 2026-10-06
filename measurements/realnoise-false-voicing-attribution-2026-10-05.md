# Real-noise false voicing — attribution and candidates (2026-10-05)

Branch `realnoise-false-voicing` (from `notch-voice-discrimination` @ 7998e22,
whose notch is V14 — [noise-notch-voice-discrimination-2026-10-05.md](noise-notch-voice-discrimination-2026-10-05.md)).
Data: the real corpora of [notch-realdata-corpora-2026-10-05.md](notch-realdata-corpora-2026-10-05.md),
public sources only (the opt-in private source is excluded by allowlist in
every script). Tools: [scripts/realnoise-fv/](../scripts/realnoise-fv/README.md).
Per-clip table: [realnoise-false-voicing-2026-10-05/clips.csv](realnoise-false-voicing-2026-10-05/clips.csv).
Review fixes (same day): §4.1–4.6 — voice cost by noise-only lead, "identical"
rows that cannot exercise the guard, per-stream losses in frames, painted false
voicing after speech, the gender model on voice, the synthetic interferer suites.

## Decision

**No production change.** The best candidate — a learned-background voicing
veto, [scripts/realnoise-fv/cand/noise-floor-guard.js](../scripts/realnoise-fv/cand/noise-floor-guard.js) —
**does not meet the ship rule** and is kept as a candidate, not wired into
`src`. A review round (§4.1–4.6, same day) added two results that the first
version of this note did not have: the voice cost is **4–5× larger when the
voice starts with the stream** (0 dB, worker and painted; still ~2.5× with a
3 s noise-only lead — every voice-in-noise mix had a 20 s one), and on held-out noise the candidate **paints more false
voicing after speech** in some streams, because the 400 ms pitch-hold bridge
joins its sparser frames into longer painted runs.

| ship-rule item | anchored candidate (`fgA`) vs base | verdict |
|---|---|---|
| noise-only false voicing down, every class (held-out split) | painted 23.52 → 20.96 % (all 279 clips: 23.93 → 21.39 %); stationary-tonal 20.70 → 17.84, mixed 28.40 → 25.29, broadband 10.78 → 10.62; intermittent-tonal (1 held-out clip) 79.20 → 79.20 (all 10 clips: 26.55 → 26.33); 0 clips > base + 2 pp — **but 13 of 2 553 five-second windows > base + 2 pp** (3 > base + 10 pp, worst +28 pp on a held-out projector; §4.4) | down in 3 of 4 classes, flat in the 4th; not in every window |
| painted false voicing on the noise segments of the voice-in-noise mixes, per stream, ≤ base + 2 pp (new, §4.4) | 20 s lead: lead segments 0 / 784 worse; **tail 9 / 784 and gaps between phrases 2 / 730 worse by +4 to +39 pp, all on held-out noise**; no lead: tail 6 / 784, gaps 2 / 730 (+3 to +8 pp, half on tuning-set noise) | **fail** |
| voice in noise (784 mixes), by noise-only lead 0 / 1 / 3 / 8 / 20 s (new axis, §4.1) | 0 dB worker at pitch −0.41 / −0.29 / −0.21 / −0.15 / −0.09 pp; painted −0.25 / −0.19 / −0.15 / −0.11 / −0.06 pp; < 160 Hz painted −0.42 / −0.35 / −0.31 / −0.17 / −0.18 pp; max(F_err, M_err) worker +0.48 / +0.39 / +0.29 / +0.20 / +0.11 pp, painted +0.27 / +0.22 / +0.19 / +0.05 / −0.01 pp; streams > 1 pp worse at worker level 37 / 26 / 17 / 14 / 10 (of 784); +10 dB worker −0.02 to −0.04 pp, painted flat | **regression, 4–5× larger without the 20 s lead (2.3× below 160 Hz), reaching female voices and 200–400 Hz** |
| gender model on voice in noise (ticks over ≥ 60 % voiced 0.75 s windows, new, §4.5) | 0 dB, scored share: male −0.40 / female −0.19 pp with no lead, male −0.21 / female 0.00 pp with the 20 s lead; +10 dB ≤ 0.05 pp | small regression, larger for male voices |
| FDA / PTDB-TUG / Hillenbrand / vocadito, worker + displayed, max(F_err, M_err), < 160 Hz | scored accuracy identical; 1 posted FDA frame differs (reference unvoiced there). **Identical largely by construction** — clean studio audio, guard never armed on Hillenbrand (§4.2) | pass; weak evidence of voice safety |
| held-note suite (1 196 scenarios, 16 + 48 kHz) | 91.20 → 91.20 %, 0 scenarios > 1 pp below (full run of the anchored tree) | pass |
| real held series (192) / gated real sources (504) | identical 192 / 192 — **by construction** (holds over a −70 dBFS synthetic floor); 504 / 504 — noise only, guard inert (sources switch on over near-silence) | not voice evidence / no gain |
| synthetic interferer suites (`int` start / weak / weak2, `r2int` × 5, `handoff-adv`, `dense`, FDA × interferer; new, §4.6) | 1 059 cells: 0 worse (no metric moves in the worse direction at all, so the strict rule against bc42ad0 holds as for base0); 121 better (`int` start pause FV 13.96 → 8.73 %); every switch-on cell identical — the guard is inert for up to 60 s after an interferer switches on over a quieter background | pass |
| real-session false-voicing oracle (private) | on the private session recordings false voicing in non-voiced spans went down and low-register displayed accuracy went down slightly, in line with the voice-in-noise row (numbers kept outside this repository) | **small regression** |

The unanchored variant removes more false voicing (all clips 23.93 → 19.89 %,
held-out 23.52 → 20.32 %, intermittent-tonal 26.55 → 20.84 %) with the same
voice-in-noise cost at the 20 s lead (the only lead it was run at), but blanks
4 held-suite scenarios by 11–21 pp (§3.6). With the review results neither
variant is a near-miss: both need a voice-proof background (§5) before the
trade between them matters.

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
program, 5 s tail, +10 / 0 dB), and the same mixes cropped to a 0 / 1 / 3 /
8 s noise-only lead (`attr.mjs --lead`, §4.1); gated real sources — 504; real held series —
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
| … 5 s windows > base + 2 / + 10 pp (all 2 553; §4.4) | — | 13 / 3 |
| gender ticks scored on noise-only audio | 39.9 % | 37.1 % |
| voice in noise, 20 s lead, held-out: painted +10 / 0 dB, < 160 Hz 0 dB | 82.28 / 56.47, 63.39 | 82.32 / 56.43, 63.24 |
| voice in noise, 20 s lead, all: painted +10 / 0 dB, < 160 Hz 0 dB | 82.12 / 54.99, 63.75 | 82.13 / 54.93, 63.57 |
| … worker at pitch +10 / 0 dB (all) | 81.80 / 51.02 | 81.79 / 50.94 |
| … streams > 1 pp worse, worker / painted (all 784; §4.3) | — | 10 / 13 |
| … lead / tail / gaps painted false voicing, pooled (all) | 30.07 / 26.65 / 33.79 % | 27.00 / 25.12 / 32.20 % |
| … tail / gap segments > base + 2 pp, per stream (§4.4) | — | 9 / 2 (all held-out) |
| voice in noise, NO lead, all: worker +10 / 0 dB, painted 0 dB, < 160 Hz painted 0 dB (§4.1) | 82.09 / 50.87, 54.34, 63.16 | 82.05 / 50.46, 54.08, 62.74 |
| FDA, PTDB-TUG, Hillenbrand, vocadito: scored accuracy (worker, display, < 160 Hz) | — | identical; 1 posted FDA frame (reference unvoiced) differs (§4.2) |
| held-note suite | 91.20 % | 91.20 % (0 scenarios > 1 pp below) |
| real held series / gated real sources | — | identical 192 / 192 (by construction), 504 / 504 |
| synthetic noise oracle (`noise-fv.mjs`, 13 classes) | — | identical |
| synthetic interferer suites, 1 059 cells (§4.6) | — | 0 worse, 121 better, 938 identical |
| pitch worker cost | 0.90 ms / chunk | 1.00 ms / chunk |

Why it misses: (1) gated real sources switch on over near-silence, so the
learned background never contains them (identical, no gain); more generally
the guard is inert for the first 60 s after any interferer switches on over a
quieter background (§4.6); (2) a stream false-voiced throughout never shows a
background window; (3) a 0 dB voice whose harmonics barely clear the learned
background is vetoed. With the 20 s noise-only lead of the mixes the losing
streams are mostly male voices around 100–130 Hz in low-frequency-heavy
machine noise, **but that profile is the test design's**: when the voice
starts with the stream the loss is 4–5× larger and reaches female voices and
every register up to 400 Hz (§4.1). (4) Removing sparse worker frames can
*raise* painted false voicing after speech through the hold bridge (§4.4).

### 4.1 Voice cost vs noise-only lead (review fix)

All 784 voice-in-noise mixes start the voice after **20 s of noise alone**:
the guard's best case (its background minimum has had 20 s to settle, and the
notch's onset-born lines promote at `onsetMinTrackSec` 20 s, just as the voice
starts). `attr.mjs --lead=S` crops each mix so the stream starts S s before
the voice (S = 0: the voice starts with the stream), same production chain,
both trees. Candidate − base, all 784 streams per lead
([vinlead.py](../scripts/realnoise-fv/vinlead.py)):

| lead | SNR | worker at pitch, pp (frames) | painted, pp (frames) | painted < 160 Hz | painted ≥ 160 Hz | worker F / M / unknown, pp | max(F_err, M_err) worker / painted, pp | streams > 1 pp worse: worker (frames) / painted (display-only) |
|---|---|---|---|---|---|---|---|---|
| 0 s | +10 dB | −0.04 (−102) | +0.01 (+20) | +0.06 | −0.01 | 0.00 / −0.07 / −0.02 | +0.07 / −0.02 | 5 (−73) / 4 (2) |
| 0 s | 0 dB | −0.41 (−940) | −0.25 (−588) | −0.42 | −0.18 | −0.14 / −0.48 / −0.44 | +0.48 / +0.27 | 32 (−833) / 28 (5) |
| 1 s | +10 dB | −0.03 (−77) | +0.02 (+49) | +0.07 | 0.00 | 0.00 / −0.05 / −0.01 | +0.05 / −0.03 | 3 (−42) / 1 (1) |
| 1 s | 0 dB | −0.29 (−660) | −0.19 (−433) | −0.35 | −0.12 | −0.07 / −0.39 / −0.21 | +0.39 / +0.22 | 23 (−589) / 19 (4) |
| 3 s | +10 dB | −0.04 (−98) | 0.00 (+5) | +0.04 | −0.01 | 0.00 / −0.07 / −0.01 | +0.07 / 0.00 | 2 (−65) / 3 (2) |
| 3 s | 0 dB | −0.21 (−475) | −0.15 (−356) | −0.31 | −0.09 | −0.07 / −0.29 / −0.12 | +0.29 / +0.19 | 15 (−387) / 20 (3) |
| 8 s | +10 dB | −0.02 (−50) | 0.00 (−5) | +0.02 | −0.01 | 0.00 / −0.04 / −0.01 | +0.04 / 0.00 | 1 (−32) / 8 (7) |
| 8 s | 0 dB | −0.15 (−342) | −0.11 (−250) | −0.17 | −0.08 | −0.05 / −0.20 / −0.11 | +0.20 / +0.05 | 13 (−292) / 17 (6) |
| 20 s | +10 dB | −0.02 (−42) | 0.00 (+6) | −0.03 | +0.02 | 0.00 / −0.03 / −0.01 | +0.03 / +0.01 | 1 (−36) / 4 (3) |
| 20 s | 0 dB | −0.09 (−197) | −0.06 (−139) | −0.18 | −0.01 | −0.03 / −0.11 / −0.08 | +0.11 / −0.01 | 9 (−174) / 9 (0) |

Worker level by register, 0 dB (pp, net frames):

| lead | < 100 | 100–130 | 130–160 | 160–200 | 200–260 | 260–330 | 330–400 |
|---|---|---|---|---|---|---|---|
| 0 s | −0.34 (−30) | −0.84 (−299) | −0.68 (−167) | −0.11 (−19) | −0.28 (−154) | −0.36 (−173) | −0.25 (−98) |
| 1 s | −0.20 (−18) | −0.85 (−304) | −0.17 (−41) | −0.10 (−17) | −0.25 (−136) | −0.10 (−50) | −0.24 (−94) |
| 3 s | −0.14 (−12) | −0.56 (−200) | −0.23 (−58) | −0.08 (−15) | −0.19 (−104) | −0.06 (−28) | −0.15 (−58) |
| 8 s | −0.08 (−7) | −0.40 (−141) | −0.08 (−21) | −0.11 (−19) | −0.17 (−93) | −0.04 (−21) | −0.10 (−40) |
| 20 s | −0.03 (−3) | −0.39 (−140) | −0.04 (−11) | −0.02 (−4) | −0.05 (−29) | −0.02 (−8) | −0.01 (−2) |

- **The 20 s lead understates the cost 4–5×.** With no lead the 0 dB worker
  loss is −0.41 pp (−940 frames) against −0.085 pp (−197); max(F_err, M_err)
  rises +0.48 pp against +0.11 pp, and the gender-symmetric painted error
  rises too (+0.27 pp, against −0.01 pp with the lead). Losses shrink
  gradually with the lead; some streams lose until 8 s and recover only at
  20 s.
- **It is not a low-male-only effect.** With no lead female voices lose
  −0.14 pp at worker level (−0.03 pp with the lead) and the 200–400 Hz bins
  −0.25 to −0.36 pp (≤ −0.05 pp with the lead). Of the 37 streams > 1 pp
  worse at worker level, 23 are male, 10 unknown-gender (clinical sustained
  vowels, singing), 4 female; 18 are mostly ≥ 160 Hz.
- **Worst streams with no lead (all 0 dB, worker / painted):** a clinical
  sustained vowel at ~270–283 Hz in an exhaust fan −12.6 / −6.6 pp (−101 /
  −53 frames), a low male forte hold in a toy car −7.6 / −5.5 pp, singing at
  ~116 Hz in an electronics whine −7.1 / −6.3 pp, a male forte hold at
  ~255 Hz in an HVAC −5.5 / −5.8 pp. Three of the four lose nothing with
  the 20 s lead — the exhaust-fan vowel recovers already with a 1 s lead, the
  whine singing with 3 s, the HVAC hold only at 20 s (−5.9 pp at 8 s) — while
  the toy-car hold loses ~7 pp at every lead.
- **+10 dB** stays small at every lead (worker −0.02 to −0.04 pp, painted
  0.00 to +0.02 pp).
- **The set of losing streams changes with the lead**, it does not only
  shrink: a 3 s lead shows losses that neither 0 s nor 20 s shows (a male
  speech phrase in mains hum −13.5 pp at worker level, painted unchanged; a
  male hold in a microwave at +10 dB −4.3 pp, −3.0 pp at 8 s).
- Mechanism not attributed further: the lead changes both how many
  background windows the 60 s minimum has seen before the voice (with no lead
  only the pauses between phrases teach it) and whether the notch's onset-born
  lines have promoted.

**Any future version of this guard must be checked with no lead and with
short leads**, not only with the mixes' 20 s lead.

### 4.2 "Identical" rows that cannot exercise the guard (review fix)

The guard acts only on a decoded-voiced frame, after its 2 s warm-up, once an
anchored background exists — and it vetoes only when no harmonic clears that
background by 14 dB. Counting the checks
([armed.mjs](../scripts/realnoise-fv/armed.mjs) on the `fg_armed` tree:
the candidate plus observation-only counters):

| corpus | clip length | guard checks | in warm-up | no anchored background | armed | armed and failing / vetoed | best harmonic excess over the floor, armed checks p1 / p5 / p50 |
|---|---|---|---|---|---|---|---|
| Hillenbrand | 0.33–0.86 s | 16 183 | 100 % | 0 % | **0 %** | 0 / 0 | — |
| FDA | 1.2–6.0 s | 5 887 | 68.2 % | 6.7 % | 25.1 % | 21 / 1 | 7.7 / 27.0 / 51.9 dB |
| PTDB-TUG | 4.6–9.2 s | 10 922 | 0.1 % | 0 % | 99.9 % | 3 / 0 | 35.5 / 47.6 / 67.9 dB |
| vocadito | 8.7–38.7 s | 24 653 | 8.1 % | 17.3 % | 74.6 % | 85 / 0 | 18.5 / 29.6 / 53.8 dB |

- **Hillenbrand: identical by construction** — every clip is shorter than the
  2 s warm-up.
- **FDA** is armed on only a quarter of its checks (short clips, mostly in
  the warm-up). **PTDB-TUG / vocadito** are armed but clean studio audio: on
  99 % of armed checks the best harmonic clears the background by ≥ 35.5 /
  18.5 dB against the 14 dB threshold. Identity is expected, not evidence.
  FDA is not identical "on every frame": its single veto changes one posted frame (`rl050`,
  male, t = 2.435 s: base 115.3 Hz, candidate unvoiced; the reference is
  unvoiced there, so scored accuracy is unchanged, and the painted value at that
  hop becomes a held 139.1 Hz). PTDB-TUG (48 127 analysed frames) and vocadito
  (32 530) are identical frame for frame.
- **Real held series (192): identical by construction** — VocalSet holds over
  a −70 dBFS synthetic floor (`set_notes` of the mix index), far below any
  voice harmonic.
- **Gated real sources (504)** are noise only: they test false voicing, not
  voice.
- **Held-note suite:** this one does exercise the guard (the unanchored variant
  lost 4 breathy start scenarios by 11–21 pp). It was run in full (1 196 × 2)
  on the anchored tree (91.20 → 91.20 %, 0 scenarios > 1 pp below). It also
  holds structurally: the floor's contents do not depend on the anchor (only
  the anchor flag of a block does), and the anchored check either fails open
  or computes exactly the unanchored verdict, so its debounce streak is never
  higher — the anchored candidate vetoes a subset of the unanchored one's
  frames, and with no feedback from the posted pitch into the worker it can
  only lose frames the unanchored variant lost.
- The only checks that put the guard against a real voice in real noise are
  the voice-in-noise mixes (§4.1, §4.3).

### 4.3 Voice in noise per stream: worker vs painted, in frames (review fix)

20 s lead (the mixes as built). 10 streams lose > 1 pp at worker level
(−210 frames), 13 at the display (−158 painted frames):

| stream (noise / voice) | SNR | split | worker, pp (frames) | painted, pp (frames) | kind |
|---|---|---|---|---|---|
| toy car / low male forte hold (~127 Hz) | 0 | tune | −6.99 (−81 / 1158) | −4.41 (−51 / 1157) | worker loss |
| refrigerator / male speech | 0 | held | −0.66 (−1 / 152) | −4.03 (−6 / 149) | onsets |
| refrigerator / male speech | +10 | held | 0 | −2.68 (−4 / 149) | display only, onsets |
| air conditioner / male speech | 0 | tune | −0.66 (−1 / 152) | −2.68 (−4 / 149) | onsets |
| toy car / singing | 0 | tune | −3.67 (−32 / 871) | −2.40 (−21 / 874) | worker loss |
| air conditioner / clinical vowel | 0 | tune | −1.05 (−6 / 571) | −2.27 (−13 / 572) | worker loss |
| server room / male speech | +10 | tune | 0 | −2.14 (−3 / 140) | display only, onsets |
| air conditioner / female speech | 0 | tune | −1.19 (−2 / 168) | −1.79 (−3 / 168) | onsets |
| vacuum / male hold (≥ 160 Hz) | 0 | held | −1.87 (−19 / 1015) | −1.77 (−18 / 1015) | worker loss |
| HVAC / male hold | 0 | held | −0.10 (−1 / 1050) | −1.34 (−14 / 1047) | mostly onsets |
| air conditioner / singing | +10 | tune | 0 | −1.16 (−5 / 432) | display only, onsets |
| toy car / low male forte hold (~127 Hz) | +10 | tune | **−3.11 (−36 / 1158)** | −1.12 (−13 / 1157) | worker loss |
| air conditioner / female speech | 0 | tune | −0.34 (−1 / 296) | −1.02 (−3 / 293) | onsets |

- **Display-only losses are onset priming.** In 3 streams (all +10 dB) the
  posted pitch is identical on every truth-voiced frame; all 12 lost painted
  frames are within 150 ms after a voice onset, where the base's display was
  already in voiced style because of frames the candidate removes — the
  noise's own false voicing painted just before (~113 Hz on the
  refrigerator) or decodes at a phrase edge. Without them the normal 3-frame
  onset confirmation applies. 5 more streams lose ≤ 2 worker frames but 3–14
  painted frames, 26 of their 30 lost painted frames within 150 ms after an
  onset. The PTDB-TUG streams have only ~140–170 voiced frames, so 1 pp is
  ~1.5 frames.
- **A real +10 dB low-register loss exists:** the toy-car / ~127 Hz male
  forte hold loses 36 of 1 158 worker frames (−3.1 pp) at +10 dB. 4 of the
  13 painted losses are at +10 dB (up to −2.7 pp); the +10 dB aggregate
  (82.12 → 82.13 %) hides them.
- **The held-out gain and the held-out costs share their sources.** The
  largest single contributor to the held-out noise-only gain, a refrigerator
  (painted 48.2 → 3.9 %, −0.52 pp of the −2.56 pp held-out mean change), is
  also the worst held-out voice regression (male speech −4.0 pp painted at
  0 dB, −2.7 pp at +10 dB). The second-largest, a projector (64.2 → 33.9 %,
  −0.36 pp), carries the tail regression of §4.4 (and costs a held-out voiced
  phrase 1 of its 42 painted frames below 160 Hz). Both are low-frequency
  compressor / rumble types — the class the guard is meant for is the class
  where its voice cost sits.

### 4.4 Painted false voicing after speech goes UP on held-out noise (review fix)

Per stream, painted false voicing on each mix's noise segments, candidate vs
base (segments ≥ 20 hops; `vinlead.py` section C):

| lead | lead segment (1.5 s into the stream → voice): pooled 0 dB, base → cand; streams > base + 2 pp at +10 / 0 dB | tail (> 0.5 s after the voice) | gaps between phrases |
|---|---|---|---|
| 0 s | — | 27.2 → 24.2 %; 3 / 3 (3 of 6 held-out; max +7.9 pp) | 34.5 → 31.9 %; 1 / 1 (1 of 2 held-out; max +5.1 pp) |
| 1 s | — | 27.4 → 23.5 %; 3 / 3 (3 of 6 held-out; max +7.9 pp) | 34.2 → 31.2 %; 1 / 1 (2 of 2 held-out; max +5.7 pp) |
| 3 s | 42.3 → 41.3 %; 3 / 3 (0 of 6 held-out; max +5.4 pp) | 26.6 → 23.1 %; 1 / 2 (3 of 3 held-out; max +4.8 pp) | 32.5 → 30.4 %; 1 / 1 (2 of 2 held-out; max +41.7 pp) |
| 8 s | 35.2 → 30.5 %; 0 / 0 | 25.0 → 22.1 %; 3 / 2 (5 of 5 held-out; max +4.2 pp) | 30.6 → 28.1 %; 1 / 0 (1 of 1 held-out; max +43.5 pp) |
| 20 s | 30.2 → 27.1 %; 0 / 0 | 26.4 → 24.6 %; 5 / 4 (9 of 9 held-out; max +27.4 pp) | 31.7 → 30.0 %; 1 / 1 (2 of 2 held-out; max +39.1 pp) |

At the 20 s lead every worse stream is on **held-out** noise (0 tuning-set,
0 lead segments):

| stream (noise / voice) | segment | painted hops, base → cand | worker hops, base → cand |
|---|---|---|---|
| projector / male hold, 0 dB | tail | 71 → 116 of 164 (+27.4 pp) | 99 → 54 |
| projector / male hold, +10 dB | tail | 59 → 103 of 164 (+26.8 pp) | 99 → 54 |
| projector / female speech, 0 and +10 dB | tail | 94 → 114 of 165 (+12.1 pp) | 76 → 36 |
| copy machine / female hold, 0 and +10 dB | tail | 53 → 72 of 164 (+11.6 pp) | 33 → 23 |
| copy machine / male speech, +10 dB | tail | 56 → 71 of 164 (+9.1 pp) | 33 → 33 |
| vacuum / female speech, 0 and +10 dB | tail | 7 → 14 of 165 (+4.2 pp) | 8 → 5 |
| projector / voiced phrase, 0 and +10 dB | gaps | 10 → 19 of 23 (+39.1 pp) | 9–10 → 8–9 |

- **Mechanism: the hold bridge.** The worker posts *less* false voicing in
  every one of these segments (or the same), the display paints more. The
  base's dense octave-hopping noise frames (84 / 128 / 172 Hz on the projector)
  are largely stopped by the paint gate's excursion logic; the candidate
  leaves sparse frames that the 400 ms pitch-hold bridge
  (`pitchGate.js` `PITCH_HOLD_MAX_MS`) joins into long painted runs. Replaying
  the real display hook with the bridge removed (`mktree.py h_max0`,
  `replay.mjs --ids`; parity of the replay with the dumps: 0 mismatches) puts
  the candidate *at or below* the base on every one of them: projector / male tail
  55 → 20 and 35 → 15 hops, projector / female 32 → 15, copy machine 11 → 8
  and 9 → 9, projector gaps 4 → 4, vacuum 2 → 0.
- **The same happens inside noise-only clips, hidden by the 90 s clip mean**
  ([fvwin.py](../scripts/realnoise-fv/fvwin.py)): the held-out projector drops
  64.2 → 33.9 % over the clip, yet its 40–45 s window rises 48 → 76 % and
  50–55 s 39.5 → 63 %. Over all 279 clips, 13 of 2 553 five-second windows are
  > 2 pp worse (6 held-out), 3 > 10 pp (2 held-out), against 267 > 2 pp better.
- With no lead the tail / gap regressions shrink (the projector tails are no
  longer among them) but do not vanish: 6 tail and 2 gap streams +3 to +8 pp,
  half on tuning-set noise. With a 3 s lead the short lead segment itself
  (1.5–3 s into the stream) is worse by up to +5.4 pp in 3 tuning-set streams
  per SNR.

So the noise-only gain does not mean the user-visible noise trace never gets
worse: after speech, on held-out sources, it does. This is a second ship-rule
failure, independent of the voice cost.

### 4.5 Gender model on voice in noise (review fix)

Inference ticks (the replayed `maybeInfer`, `gv` column) whose 0.75 s window
is ≥ 60 % truth-voiced; share scored (fed to the model), base → candidate:

| lead | SNR | female | male | unknown |
|---|---|---|---|---|
| 0 s | +10 dB | 99.95 → 99.95 (0.00, n 6213) | 99.18 → 99.13 (−0.05, n 20065) | 99.57 → 99.57 (0.00, n 8813) |
| 0 s | 0 dB | 97.20 → 97.01 (−0.19, n 6213) | 89.31 → 88.91 (−0.40, n 20065) | 95.81 → 95.51 (−0.31, n 8813) |
| 1 s | +10 dB | 99.94 → 99.94 (0.00, n 6231) | 99.33 → 99.33 (0.00, n 20139) | 99.61 → 99.61 (0.00, n 8873) |
| 1 s | 0 dB | 97.61 → 97.42 (−0.19, n 6231) | 89.50 → 89.09 (−0.41, n 20139) | 95.74 → 95.41 (−0.33, n 8873) |
| 3 s | +10 dB | 99.95 → 99.95 (0.00, n 6249) | 99.22 → 99.21 (−0.01, n 20213) | 99.57 → 99.57 (0.00, n 8835) |
| 3 s | 0 dB | 97.09 → 97.09 (0.00, n 6249) | 89.20 → 88.91 (−0.29, n 20213) | 95.68 → 95.48 (−0.19, n 8835) |
| 8 s | +10 dB | 99.86 → 99.86 (0.00, n 6248) | 99.27 → 99.27 (0.00, n 20144) | 99.46 → 99.46 (0.00, n 8848) |
| 8 s | 0 dB | 97.06 → 97.04 (−0.02, n 6248) | 89.03 → 88.85 (−0.18, n 20144) | 95.50 → 95.29 (−0.21, n 8848) |
| 20 s | +10 dB | 99.92 → 99.92 (0.00, n 6248) | 99.24 → 99.23 (−0.01, n 20179) | 99.45 → 99.45 (0.00, n 8847) |
| 20 s | 0 dB | 97.04 → 97.04 (0.00, n 6248) | 89.14 → 88.93 (−0.21, n 20179) | 95.75 → 95.58 (−0.17, n 8847) |

Small and lopsided: at 0 dB male (and unknown-gender) voices lose scored
ticks at every lead (−0.18 to −0.41 pp), female voices only with a lead of
≤ 1 s (−0.19 pp); +10 dB is flat. It is a voice-side cost the
gender-symmetric rule counts, next to the noise-only row (39.9 → 37.1 % of
noise-only ticks scored).

### 4.6 Synthetic interferer suites (review fix)

The notch work's ship rule is "no interferer cell, synthetic or real, worse
than bc42ad0"; its synthetic suites had not been run on the candidate. Run
through the real worker of both trees (`NOTCH_ADV_TREES=base0=…,fgA=…`; the
suites' own scoring, painted = median-3 + paint gate **without** the hold
bridge), compared cell by cell with
[cmpcells.mjs](../scripts/realnoise-fv/cmpcells.mjs) (false voicing worse
when > 2 pp up, accuracy when > 1 pp down, promotion when > 0.3 s later or
never; "within tolerance" = any smaller change in the worse direction):

| suite | rate | cells | identical | worse / within tolerance | better in some metric | means, base0 → fgA |
|---|---|---|---|---|---|---|
| `int` start (hum from t = 0, speech from 0.1–3 s or none) | 16 + 48 kHz | 380 | 287 | 0 / 0 | 93 | pause FV 13.96 → 8.73 %, painted 12.24 → 7.67 %, steady-state 8.85 → 2.76 %; speech and promotion identical |
| `int` weak / weak2 (switch-on at ~10 s) | 16 kHz | 136 | 136 | 0 / 0 | 0 | — |
| `r2int` step / masked / beatpause / shared / intermit | 16 kHz | 334 | 323 | 0 / 0 | 11 (masked 4, beatpause 7) | beatpause FV 4.76 → 4.52 %, masked 33.84 → 33.71 %; others identical |
| `handoff-adv` | 16 kHz | 84 | 84 | 0 / 0 | 0 | — |
| `dense` (switch-on during dense speech) | 16 kHz | 16 | 16 | 0 / 0 | 0 | — |
| FDA × interferer: noise only / from t = 0 / switch-on in speech / in a pause | 16 kHz | 25 / 28 / 28 / 28 | 18 / 18 / 28 / 28 | 0 / 0 | 7 / 10 / 0 / 0 | noise-only FV 0.76 → 0.51 %; gap FV from t = 0 4.99 → 4.64 % |
| **all** | | **1 059** | **938** | **0 / 0** | **121** | |

- **No metric of any cell moves in the worse direction**, so every cell
  compares with bc42ad0 exactly as base0 (V14, which met the strict rule
  against bc42ad0 in [noise-notch-voice-discrimination-2026-10-05.md](noise-notch-voice-discrimination-2026-10-05.md))
  does; the strict rule holds.
- **The guard is inert after a switch-on**: every cell whose interferer
  switches on mid-stream (`int` weak / weak2, `r2int` step / shared /
  intermit, `dense`, FDA switch-on in speech or in a pause) is identical. The
  background minimum then still holds the quieter pre-switch-on spectrum, so
  the interferer clears it by > 14 dB until those windows age out of the
  60 s minimum — the same reason the 504 gated real sources are identical. Its
  gains are on interferers present from the stream start; the real noise-only
  set (noise from t = 0) is its best case.
- These suites' painted metric has no hold bridge, so — per §4.4 — their
  painted gains are an upper bound on what the live trace shows.

## 5. What a passing fix would need

1. **A voice-proof background.** The floor must never learn a voice the
   detector misses. The notch's own line verdict (shared FM of a line and its
   2nd partial, [noise-notch-voice-discrimination-2026-10-05.md](noise-notch-voice-discrimination-2026-10-05.md))
   generalised to the whole comb would let the floor exclude voice-like spectral
   energy; a per-bin min over 60 s is not enough at 0 dB — and it must hold
   when the voice starts with the stream, where only the pauses between
   phrases can teach it (§4.1: the cost there is 4–5× the 20 s-lead cost).
2. **The hold bridge** is half of what the user sees. A hold rule needs a
   speech-vs-noise discriminator that survives noisy speech (run length,
   density and age all cost voice frames, §3.1). **Any worker-level thinning
   of false voicing has to be judged together with the bridge:** removing
   frames can *increase* painted false voicing, because sparse surviving
   frames get joined into long held runs where the base's dense, octave-
   hopping frames were stopped by the paint gate (§4.4). Worker-level gains
   are not display gains until the painted trace says so per stream and per
   window.
3. **Notch line tracking**, for the other branch: 44 % of posted false voicing
   sits on lines the tracker sees but re-births or rates below 90 % duty
   (wobble past the 3 Hz association, flicker, split tracks). Association
   tolerant of measured wobble and duty measured on a line *family* rather
   than a single track are the obvious next experiments; the eager-notch row
   (15.8 %) bounds them.
4. **Gender VAD:** the sub-floor probe accepts unnotched machine periodicity
   at 40–75 Hz (9.6 % of noise-only ticks); excluding lines the notch tracks
   (not only active notches) would remove most of it.
5. **Test design for the next candidate** (review fixes): voice in noise at
   noise-only leads 0 / 1 / 3 / 8 / 20 s, worker and painted, in frames, by
   register and voice gender (max(F_err, M_err)); painted false voicing per
   stream on the noise segments (lead, tail, gaps between phrases) and per 5 s
   window of the noise-only clips, ≤ base + 2 pp; gender-model ticks over
   voiced audio by gender; the synthetic interferer suites; and the clean
   corpora reported as what they are (rarely or never armed, §4.2).

## 6. Merge notes

- `src/` is unchanged. `src/dsp/noise-notch.js` was never touched. Adopting the
  candidate = `cand/noise-floor-guard.js` into `src/dsp/` plus the worker
  edits `mktree.py` applies (`WIRE`: `observe()` after
  `detector.candidates()`, `decided()` / `check()` after the harmonic guard,
  construction in `init`, a test-only `init` switch `floorGuard: false`). It
  reads the post-notch analysis buffer, so it composes with any notch timing;
  re-run `attr.mjs` (incl. `--lead=0`, `1`, `3`, `8` on the voice-in-noise set) /
  `vinlead.py` / `fvwin.py` / `evalmix.mjs` / `held.mjs` and the synthetic
  suites (`cmpcells.mjs`) on the merged tree.
- `tests/dsp/data/corpora.js` gained `SYRINX_CORPORA_DIR` (read another
  checkout's gitignored PTDB-TUG / FDA audio in place).
- `scripts/notch-adversarial/lib.mjs` gained `NOTCH_ADV_TREES` (run the suite
  on any src trees; without it the fixed tree list is unchanged).

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
# review fixes (§4.1-4.6). Voice in noise by noise-only lead (the 20 s dumps are the --set=vin runs above)
for L in 0 1 3 8; do for t in base0 fg; do $R $F/attr.mjs --set=vin --lead=$L --src=build/rnfv-trees/$t/src --tag=${t}_L$L; done; done
python $F/vinlead.py --pairs=0:base0_L0:fg_L0,1:base0_L1:fg_L1,3:base0_L3:fg_L3,8:base0_L8:fg_L8,20:base0:fg   # §4.1, 4.3-4.5
python $F/fvwin.py base0 fg --win=5                                                                            # §4.4, noise-only windows
python $F/mktree.py h_max0 fg_armed
for t in base0 fg; do $R $F/replay.mjs --from=$t --set=vin --src=build/rnfv-trees/h_max0/src --tag=${t}_h0 --ids=<§4.4 streams>; done
node $F/armed.mjs build/rnfv-trees/fg_armed/src                                                                # §4.2
# §4.6 synthetic interferer suites through the real worker of both trees (int start also at 48 kHz)
export NOTCH_ADV_TREES=base0=build/rnfv-trees/base0/src,fgA=build/rnfv-trees/fg/src MAXJ=3
S=scripts/notch-adversarial; Y=build/realnoise-fv/synth; V=--variants=base0,fgA
bash $S/shards.sh $Y/int_start 8 $S/int.mjs --part=start $V --sr=16000,48000
for p in weak weak2; do bash $S/shards.sh $Y/int_$p 6 $S/int.mjs --part=$p $V --sr=16000; done
for p in step masked beatpause shared intermit; do bash $S/shards.sh $Y/r2_$p 3 $S/r2int.mjs --part=$p $V --sr=16000; done
bash $S/shards.sh $Y/handoff 3 $S/handoff-adv.mjs $V --sr=16000; node $S/dense.mjs $V --out=$Y/dense.json
for p in nonly start midsp midpa; do bash $S/shards.sh $Y/fda_$p 2 $S/fda.mjs --part=$p $V; done
SETS="int=$Y/int_start int=$Y/int_weak int=$Y/int_weak2 handoff=$Y/handoff dense=$Y/dense.json"
for p in step masked beatpause shared intermit; do SETS="$SETS r2=$Y/r2_$p"; done
for p in nonly start midsp midpa; do SETS="$SETS fda=$Y/fda_$p"; done
node $F/cmpcells.mjs --base=base0 --cand=fgA $SETS
```

Runs used ≤ 3 concurrent processes (shared machine). `build/` holds every
dump (gitignored).
