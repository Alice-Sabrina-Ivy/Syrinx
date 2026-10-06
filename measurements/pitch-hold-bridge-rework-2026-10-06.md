# Pitch-hold bridge rework — integration (2026-10-06)

Branch `gap-bridge-rework` from 21d0117 (main + the V19g hum-filter PR #102 +
the real-noise attribution tooling). Problem statement and attribution:
[realnoise-false-voicing-attribution-2026-10-05.md](realnoise-false-voicing-attribution-2026-10-05.md)
§1a, §3.1, §5. Public data only: the real-noise / voice-in-noise corpora of
[notch-realdata-corpora-2026-10-05.md](notch-realdata-corpora-2026-10-05.md)
(+ the second held-out set `notchvd-heldout`), FDA, PTDB-TUG, Hillenbrand,
vocadito, the notch work's synthetic held-note suite. Results on the private
session recordings are kept outside this repository (one aggregate sentence
below). Tools: [scripts/realnoise-fv/](../scripts/realnoise-fv/README.md).

## Decision

**The change does NOT meet the pre-registered ship rule.** It is implemented on
this branch (the closest variant, as the rule directs when none passes) and
measured in full. It is not proposed for merge as is.

Chosen: **CPP-evidence drawing of the hold bridge**
([src/audio/bridgeEvidence.js](../src/audio/bridgeEvidence.js), wired in
`useAudioPipeline.js` `handleAnalysisResult`). The 400 ms hold window, the held
value, the paint gate's `push(held, { fresh: false })`, the smoothing buffer
and the recorded session frames are unchanged. What changes is whether a held
frame is drawn. A frame is drawn when any of these holds:

- it is in the first 50 ms of the gap;
- it is in the first 200 ms after a voiced run of at least 250 ms;
- the stream showed a strongly harmonic voiced frame in the last 20 s. A
  frame counts as strong when the mean DSP-worker CPP of the voiced frames
  among the last 4 DSP frames, with at least 2 of them voiced, is at least
  0.50;
- the DSP worker has posted no CPP for 1 s (input below 16 kHz). The rule
  then fails open.

Any other held frame is hidden. The paint gate still sees it, so a voice that
resumes inside the window paints at once, with no onset re-confirmation. By
construction the painted trace is the old trace minus some held frames, with
identical values.

It is behaviour-identical to the explorers' `evB` (0 mismatches in paint,
readout and style on all 3 402 streams).

| rule item | base | chosen | verdict |
|---|---|---|---|
| goal: noise-only painted FV, all 279 clips (≥ 25 % rel.) | 23.93 % | 17.67 % (−26.2 %) | **pass** |
| goal: held-out splits "comparable" | 23.52 / 20.41 % | in-set held-out 85: 18.06 (−23.2 %); held-out 2 (119): 15.41 (−24.5 %), of which dcaseeval −49.7 %, fsheld −20.5 % | comparable, but below 25 % on every held-out split (strict reading: fail) |
| G1 corpora max(F_err, M_err) ≤ +0.15 pp; vocadito ≥ −0.3 pp | — | FDA +0.000, PTDB +0.021, Hillenbrand +0.000; vocadito +0.00 | pass |
| G2 voice in noise, pooled ≤ −0.3 pp per SNR | — | worst −0.297 pp (lead 0, held-out, 0 dB) | pass (at the limit on held-out) |
| G2 < 160 Hz ≤ −0.5 pp | — | −0.26 / −0.33 (all, lead 20 / 0); **−0.57 (held-out, lead 0, 0 dB)** | **fail** (one cell) |
| G2 ≤ 2 % of streams worse by > 2 pp | — | **0 dB: 4.8 % / 4.6 % (all, lead 20 / 0), 6.7 % / 5.9 % (held-out)**; +10 dB: 0 % | **fail** (all four 0 dB cells) |
| G3 noise after speech: pooled ≤ +1 pp, no stream > +10 pp | — | tail −0.09 to 0.00, gaps −0.69 to −1.35 pp; worst stream +0.0 | pass (subset by construction) |
| G4 fragmentation ≤ +5 %, median within-word gap not longer | 0.842 seg / voiced s | pooled +4.91 %; **PTDB-TUG alone +9.18 %**, FDA +4.38 %, vocadito +0.96 %; medians not longer | pass on the pooled reading, fail per corpus (PTDB) |
| G5 display tests; private switch latency / never-shown | — | display-hook 23 / 23 (3 new, one fails on the base hook), paint-gate 112 / 112, pitch-gate 26 / 26, new bridge-evidence 19 / 19; private: identical | pass |
| G6 held-note suite (full: 902 scenarios × 16 + 48 kHz, painted, with CPP) ≤ −0.5 pp | 89.99 % | 89.86 % (−0.13 pp); **17 of 1 804 runs −6.8 to −21.6 pp** (breathy notes at 76–79 Hz) | pass on the suite mean, fail per scenario |
| G7 private displayed band accuracy ≤ −0.3 pp | — | 0.00 pp on every band, tuning and held-out | pass |

**What fails:**

- **G2, per stream.** At 0 dB, 18–19 of 392 streams lose more than 2 pp
  (limit 7), and 8–9 of the 135 held-out streams (limit 2). The pooled cost
  is small (−0.15 to −0.30 pp) but concentrated. Male voices lose −0.18 /
  −0.23 pp against −0.07 / −0.03 pp for female voices; voices below 100 Hz
  lose −0.52 / −0.77 pp. PTDB-TUG speaker M02's short phrases (140 voiced
  frames: 3 lost frames are 2.1 pp) and clinical dysphonic vowels (PVQD) are
  over-represented. CPP is the clinical breathiness measure, so weak, breathy
  or dysphonic phonation in loud noise is the class that loses its bridge.
- **G2, low register held-out.** −0.57 pp (limit −0.5).
- **G6, per scenario.** The suite mean passes (−0.13 pp), but breathy
  low notes (76–79 Hz, `low` and `swell` families) drop 7–22 pp. The
  detector posts only 60–85 % of their hold frames; the base's bridge drew
  the rest, and these notes never reach the CPP evidence level (§4.4).
- **G4 per corpus.** Each clean-corpus clip is a new stream, and its first
  gaps before the first strong-CPP frame are hidden (a cold start, paid once
  per session in live use). PTDB-TUG clips start ~3 s into silence, so the
  first word pays it.
- **Goal, strictly read.** All held-out splits fall 20–25 %, not 25 %.

No measured variant passes. The frontier (§3): every combination that keeps
the per-stream voice guard gives up the goal, and every variant that reaches
the goal breaks the per-stream guard.

## 1. Pre-registered ship rule (verbatim, decided before any result)

One folder name in G5 is redacted (it names the private project).

> Goal: painted false voicing on real noise-only audio (all 279 clips, AND each held-out noise split separately) must fall by >= 25 % relative (23.9 % -> <= 17.9 % on the tuning set) — and the held-out splits must show a comparable relative fall.
>
> Guards (every one must hold; tuning set AND held-out where applicable):
>  G1 corpora displayed accuracy (FDA, PTDB-TUG, Hillenbrand, vocadito; real worker + real hook): gender-symmetric max(F_err, M_err) not worse by > 0.15 pp on any corpus; vocadito correct not worse by > 0.3 pp.
>  G2 voice in real noise (the 784 voice_in_noise mixes, +10 and 0 dB, AND with the voice starting at the stream start — the lead-0 case the last round missed): painted accuracy not worse by > 0.3 pp pooled per SNR, low register (< 160 Hz) not worse by > 0.5 pp, and <= 2 % of streams worse by > 2 pp.
>  G3 noise right after speech (tail/gap segments of the voice_in_noise mixes): painted false voicing not worse by > 1 pp pooled and no stream worse by > 10 pp.
>  G4 trace continuity in clean speech (FDA + PTDB + vocadito): painted segments per voiced second (fragmentation) not worse by > 5 %, median within-word gap not longer.
>  G5 register-switch display behaviour: tests/audio/display-hook-test.js and tests/audio/pitch-paint-gate-test.js pass; session-oracle switch latency / never-shown not worse (private results -> [private measurements folder]).
>  G6 held notes (scripts/notch-adversarial held suite, a 16 kHz subset is fine for exploration, full for integration): not worse by > 0.5 pp.
>  G7 the private session oracle displayed band accuracy not worse by > 0.3 pp (aggregate only in Syrinx).
>
> Choose by the pre-registered rule: the variant (or a principled combination of two — then measure the combination) with the largest held-out noise reduction among those that pass every guard; if none passes, pick the closest and say exactly which guard fails.

Readings applied here (the rule text leaves them open; they are fixed in
`shiprule.py`, written before the integration runs but after the explorers'
reports): "held-out" = the in-set
FNV split (85 noise clips / 270 mixes) and the second held-out set (119 clips:
dcaseeval 18, fsheld 101). G2 is scored on all 784 mixes and on the held-out
mixes separately, at the mixes' 20 s noise-only lead and at lead 0. G3 =
tail and gaps-between-phrases segments of ≥ 20 hops. G4 is reported pooled and
per corpus (the rule does not say which), with two within-word-gap readings
(defined in `shiprule.py`). G6 is reported as the suite mean of the painted
hold-frame accuracy and per run (the rule does not say which).

## 2. Method

**Production chain.** Every number comes from the REAL pitch worker (V19g
notch, ghost veto, above-range null, harmonic guard), the REAL DSP worker and
the REAL `handleAnalysisResult` of each tree (`attr.mjs` →
`scripts/session-oracle/lib/chain.mjs`).

- Base (`git archive 21d0117 src`) and the chosen tree (= the committed
  `src`) were each run **end to end**: worker and hook, regenerated on this
  branch, 3 402 streams per tree.
- The worker columns of the two runs are bit-identical. The display is the
  only change.
- The regenerated base dumps are bit-identical to the explorers' V19g dumps
  (all worker and display columns, 3 402 streams).
- Runner-ups (display-only) were replayed through their real hooks over the
  regenerated base dumps (`replay.mjs`). Base replay parity: 0 mismatches. The
  chosen tree's replay equals its end-to-end run: 0 mismatches.

**Tooling fixes** (committed with this file):

- `lib/chain.mjs`, `attr.mjs` and `replay.mjs` now hand the DSP worker's
  `cpp`, `hnr` and `spectralTilt` to the hook, as production does. They
  passed null before, which would have made the CPP evidence fail open, so
  the variant would have measured as identical to base.
- `lib/tap-notch.mjs` resolves V19g's relative imports.
- `attr.mjs --set=noiseho` adds the second held-out set.
- `paintF` is a new dump column: the trace as it stands at the end of the
  stream. Deferred variants fill entries late, and §3 scores them on it.
- `shiprule.py` scores the rule. `held-painted.mjs` scores the held-note
  suite on the PAINTED trace; `held.mjs` scores posted pitch, which a display
  change cannot move. `bridge-rate-check.mjs` checks transfer to 44.1 and
  48 kHz.

The explorers' held-suite run of `evB` drove the hook without CPP
(`runWorkers` did not collect it). Its "identical" G6 result was therefore
fail-open by construction. It is re-measured here with CPP.

**Selection.** Three explorers ran three families:

- A: deferred drawing, best `B7`.
- B: evidence-gated drawing, best `evB`; `evC46` is the same rule at CPP
  ≥ 0.46.
- C: a continuity bridge with a restricted painted hold, best `C5`.

None passed. Two principled combinations were measured as well:

- `evB ∪ C5`: a held frame is drawn when either the CPP evidence or C5's
  segment confidence (≥ 0.68) earns it. These are two independent voice
  signals, and a frame is hidden only when both say no.
- `evB ∪ deferred`: frames that evB hides are deferred (B7's machinery) and
  filled when a painted fresh pitch resumes inside the window or an offset
  follows. A gap without evidence is drawn once speech proves itself.

Both run through the real hook. On the explorers' parameters no variant or
combination passes. The chosen variant is the closest one that reaches the
goal; §3 shows why.

## 3. Full table — base vs chosen vs runner-ups

Δ = candidate − base. The rows are measured on the regenerated dumps described
in §2.

- **Deferred variants** (B7, evB ∪ deferred) are scored on the final trace
  (`paintF`): their late fills count as painted. Their live trace at each hop
  shows less (B7 live: noise −47.5 %, G2 −7.7 pp at 0 dB).
- **Base rows** are absolute values, with no Δ. In the goal rows, every other
  cell gives the candidate's value and its relative change.

| row | base | **chosen (evB)** | evC46 | C5 | B7 (final trace) | evB ∪ C5 | evB ∪ deferred (final trace) |
|---|---|---|---|---|---|---|---|
| GOAL all 279 | 23.93 % | **17.67 (−26.2 %)** | 18.68 (−22.0 %) | 17.83 (−25.5 %) | 17.80 (−25.6 %) | 19.54 (−18.4 %) | 19.89 (−16.9 %) |
| … tuning 194 | 24.11 | 17.50 (−27.4 %) | 18.60 (−22.9 %) | 17.85 (−26.0 %) | 17.69 (−26.6 %) | 19.41 (−19.5 %) | 19.82 (−17.8 %) |
| … held-out 85 | 23.52 | 18.06 (−23.2 %) | 18.86 (−19.8 %) | 17.78 (−24.4 %) | 18.06 (−23.2 %) | 19.82 (−15.7 %) | 20.07 (−14.7 %) |
| … held-out 2 (119) | 20.41 | 15.41 (−24.5 %) | 16.13 (−20.9 %) | 15.58 (−23.7 %) | 14.98 (−26.6 %) | 17.02 (−16.6 %) | 16.93 (−17.0 %) |
| … dcaseeval 18 / fsheld 101 | 18.12 / 20.81 | −49.7 / −20.5 % | −45.0 / −17.2 % | −51.0 / −19.4 % | −47.9 / −23.3 % | −41.7 / −12.7 % | −37.2 / −13.9 % |
| … stat / int / mixed / broad (all) | 27.1 / 26.5 / 24.1 / 13.1 | 20.5 / 18.1 / 17.5 / 9.7 | 21.8 / 18.8 / 18.4 / 10.4 | 21.2 / 17.9 / 17.3 / 9.8 | 20.5 / 22.1 / 17.7 / 8.7 | 22.8 / 19.7 / 19.2 / 11.1 | 22.9 / 23.1 / 19.7 / 10.7 |
| … held (bridge) share | 11.62 | 5.36 | 6.37 | 5.52 | 5.49 | 7.23 | 7.58 |
| … clips / 5 s windows > base + 2 pp (398 / 3 728) | — | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| G1 FDA / PTDB / Hil max(F,M) Δ pp | 16.71 / 19.07 / 36.42 | +0.000 / +0.021 / +0.000 | +0.000 / +0.021 / +0.000 | +0.000 / +0.021 / +0.000 | +0.044 / +0.043 / +0.000 | 0 / 0 / 0 | 0 / 0 / 0 |
| G1 vocadito correct Δ pp | 96.57 | 0.00 | 0.00 | 0.00 | −0.02 | 0.00 | 0.00 |
| G2 L20 all +10 dB: pooled / < 160 / streams > 2 pp | 82.13 / 89.97 | −0.002 / −0.003 / 0 % | −0.001 / 0.000 / 0 % | −0.077 / −0.135 / **2.3 %** | −1.09 / −1.71 / 24.7 % | 0 / 0 / 0 % | 0 / 0 / 0 % |
| G2 L20 all 0 dB | 55.00 / 63.77 | −0.150 / −0.262 / **4.8 %** | −0.054 / −0.098 / 1.5 % | −1.52 / −2.62 / 23.5 % | −3.14 / −4.26 / 53.8 % | −0.076 / −0.136 / **2.8 %** | −0.057 / −0.068 / **2.6 %** |
| G2 L20 held-out 0 dB | 56.47 / 63.39 | −0.254 / −0.427 / **6.7 %** | −0.080 / −0.205 / **2.2 %** | −1.67 / −3.15 / 23.7 % | −3.13 / −4.26 / 50.4 % | −0.134 / −0.289 / **3.7 %** | −0.090 / −0.071 / **3.7 %** |
| G2 L0 all 0 dB | 54.34 / 63.16 | −0.185 / −0.333 / **4.6 %** | −0.084 / −0.165 / 1.8 % | −1.48 / −2.59 / 24.2 % | −3.03 / −4.10 / 53.8 % | −0.103 / −0.208 / **2.8 %** | −0.077 / −0.125 / **2.3 %** |
| G2 L0 held-out 0 dB | 55.58 / 61.02 | −0.297 / **−0.570** / **5.9 %** | −0.120 / −0.360 / **2.2 %** | −1.69 / −3.18 / 26.7 % | −3.06 / −4.18 / 51.9 % | −0.201 / −0.401 / **4.4 %** | −0.120 / −0.156 / **2.2 %** |
| G2 +10 dB, other cells (L0 all, held-out L20 / L0) | ~82 / ~90 | ≤ 0.003 / ≤ 0.004 / 0 % | ≤ 0.001 / 0 / 0 % | −0.08 / −0.14 / **2.0–2.2 %** | ~−1.0 / ~−1.5 / ~24 % | 0 / 0 / 0 % | 0 / 0 / 0 % |
| G2 painted max(F_err, M_err) Δ, 0 dB (L20 all / L0 all / L0 held) | 47.14 / 46.48 / — | +0.066 / +0.230 / +0.414 | +0.023 / +0.112 / +0.157 | +0.87 / +1.58 / +1.66 | +2.38 / +3.15 / +3.29 | +0.034 / +0.135 / +0.277 | +0.039 / +0.090 / +0.184 |
| G3 tail / gaps FV pooled Δ pp, 0 dB (L20 all; L0 all) | 26.37 / 31.72; 27.21 / 34.50 | −0.09 / −1.03; −0.09 / −1.33 | 0.00 / −0.57; −0.02 / −1.10 | −4.34 / −5.04; −4.69 / −5.16 | −6.10 / −10.57; −6.52 / −10.65 | −0.07 / −0.66; −0.07 / −0.80 | −0.09 / −0.74; −0.09 / −0.82 |
| G3 worst stream Δ / streams > +10 pp (all cells) | — | +0.0 / 0 | +0.0 / 0 | +0.0 / 0 | +0.0 / 0 | +0.0 / 0 | +0.0 / 0 |
| G4 seg / voiced s, pooled Δ | 0.8422 | +4.91 % | +3.98 % | +1.46 % | 0.00 % | +0.80 % | 0.00 % |
| G4 per corpus FDA / PTDB / voc Δ | 1.117 / 1.306 / 0.579 | +4.4 / **+9.2** / +1.0 % | +3.7 / **+7.2** / +1.0 % | +1.5 / +2.3 / +0.6 % | 0 / 0 / 0 | +0.7 / +1.0 / +0.6 % | 0 / 0 / 0 |
| G4 median within-word gap (strict; ≤ 500 ms FDA / PTDB / voc) | 100; 200 / 175 / 175 ms | 100; 175 / 150 / 175 | 100; 175 / 150 / 175 | 100; 175 / 175 / 175 | 100; 200 / 175 / 175 | 100; 188 / 175 / 175 | 100; 200 / 175 / 175 |
| G5 tests | pass | pass (+ new tests) | — | pass (explorer) | pass (explorer) | — | — |
| G5 / G7 private sessions | — | identical / 0.00 pp | identical (explorer) | identical (explorer) | identical / within 0.3 pp, low band ◐ (explorer) | — | — |
| G6 held-note suite, painted mean (16 + 48 kHz, 1 804 runs); runs > 0.5 pp below; worst | 89.99 % | 89.86 (−0.13); 17; −21.6 | 89.86 (−0.13); 17; −21.6 | 89.83 (−0.16); 45; −20.8 | **89.25 (−0.75)**; 374; −17.7 | 89.99 (0.00); 0; 0 | 89.96 (−0.03); 9; −9.0 |
| **rule** | — | **FAIL**: G2 per-stream (4 cells), G2 held-out < 160 (1 cell); G4 per corpus; G6 per scenario; goal held-out < 25 % | FAIL: goal (−22 %); G2 held-out per-stream (3 / 135) | FAIL: G2 (all cells, ~5×) | FAIL: G2 (all cells, ~10×); G6 mean | FAIL: goal (−18 %); G2 per-stream | FAIL: goal (−17 %); G2 per-stream |

Reading:

- **The two levers share one frontier.** Every combination that rescues the
  per-stream voice guard (`evC46`, `evB ∪ C5`, `evB ∪ deferred`) gives back
  most of the goal:
  - In noise, the deferred fill re-joins exactly the false-voiced runs the
    bridge used to join (fresh pitch resumes within 400 ms).
  - Confidence-earned holds re-admit the confident machine lines.
- **Per-stream losses persist under every union.** Even `evB ∪ deferred`
  leaves 2.2–3.7 % of 0 dB streams worse by > 2 pp. Of the chosen variant's
  lost voice frames, 70 % sit in gaps that a fresh pitch ends within 400 ms;
  30 % are offsets that no later evidence can recover.
- **C5 and B7 meet the goal only by costing voice 5–10× the tolerance.**
- **evC46 is the guard-side point of the same family.** It passes every G2
  cell except the held-out per-stream share (3 of 135 streams, limit 2.7).
  It misses the goal by 3 pp relative (18.68 % against ≤ 17.9 %). It has the
  chosen variant's G6 losses and +7.2 % PTDB fragmentation. It is listed so
  that the trade can be chosen deliberately. It is not chosen here because it
  does not deliver the goal.

## 4. Chosen variant in detail

### 4.1 Voice in noise (0 dB; the +10 dB cells move ≤ 0.004 pp)

| | lead 20 s, all | lead 0, all | lead 20 s, held-out | lead 0, held-out |
|---|---|---|---|---|
| painted at pitch (pooled) | 55.00 → 54.85 (−0.150) | 54.34 → 54.15 (−0.185) | 56.47 → 56.22 (−0.254) | 55.58 → 55.28 (−0.297) |
| female / male / unknown voice, Δ pp | −0.066 / −0.178 / −0.150 | −0.032 / −0.230 / −0.198 | — | — |
| < 100 / 100–130 / 130–160 Hz, Δ pp | −0.52 / −0.25 / −0.19 | −0.77 / −0.30 / −0.21 | — | — |
| ≥ 160 Hz bins, Δ pp | −0.08 to −0.13 | −0.07 to −0.25 | — | — |
| streams worse > 2 pp | 19 / 392 (221 frames lost) | 18 / 392 (276 frames) | 9 / 135 | 8 / 135 |
| … by voice: male / female / unknown | 11 / 4 / 4 | 12 / 2 / 4 | — | — |
| worker at pitch | identical | identical | identical | identical |

Worst streams (lead 0, 0 dB):

| voice | noise | change | frames lost |
|---|---|---|---|
| a clinical sustained vowel (PVQD) | electronics whine | −7.5 pp | 28 / 375 |
| PTDB-TUG male M02 | pump | −7.0 pp | 10 / 142 |
| PTDB-TUG male M02 | toy car | −5.6 pp | 8 / 142 |
| PTDB-TUG male M02 | computer fan | −4.9 pp | 7 / 142 |
| VocalSet male held note | valve | −4.5 pp | 45 / 1 002 |
| vocadito singer | vacuum | −3.8 pp | 26 / 690 |

Every lost frame is a held frame; the posted pitch is identical.

### 4.2 Noise right after speech and noise-only windows

The painted trace is a subset of the base's painted frames, with identical
values. Painted false voicing therefore cannot rise anywhere:

- 0 noise-only clips and 0 of 3 728 five-second windows are worse.
- 0 tail or gap segments are worse.
- The tail and gap segments fall on average (−0.09 / −1.0 to −1.35 pp at
  0 dB; gaps −0.7 to −1.0 pp at +10 dB).
- The 20 s noise-only lead segment falls 30 → 23 %.

### 4.3 Clean speech

- **Displayed accuracy.** Identical except PTDB-TUG +0.021 pp (2 frames).
- **Fragmentation.** It rises on PTDB-TUG (+9.2 %), with 105 frames hidden
  in 17 of 180 clips, all near the first word. The median hidden frame is
  3.1 s into its clip, at about the first strong-CPP frame (median 2.9 s:
  the clips open on silence). FDA rises +4.4 % (19 frames in 5 clips) and
  vocadito +1.0 %.
- **Effect in a live session.** Each clip is a fresh stream, so this is the
  rule's cold start. A live session pays it once, then again only after
  20 s without a strong voiced frame.

### 4.4 Held notes (G6) and sample rate

**Held notes.** `held-painted.mjs`: one real-worker run per scenario and
rate, with every tree's real hook driven over the same frames and the DSP
worker's CPP passed.

| scenarios | base | chosen | change |
|---|---|---|---|
| all 1 804 runs | 89.99 % | 89.86 % | −0.13 pp |
| `low` family | 99.18 % | 94.88 % | −4.31 pp |
| `swell` family (146 runs) | 99.80 % | 99.11 % | −0.69 pp |
| every other family | — | — | identical |

The 17 runs that lose more than 0.5 pp are all breathy notes at 76–79 Hz:

- 8 low holds, −13.6 to −21.6 pp;
- 9 swells (crescendos and one messa di voce), −6.8 to −20.4 pp.

The worker posts only 60–85 % of their hold frames. The base bridge drew the
nulls in between (92–100 % painted). These notes never produce a voiced frame
with CPP ≥ 0.5, so the chosen rule hides the bridge and the painted share
falls to about the worker's.

These scenarios hold over a −70 dBFS synthetic floor, with no interferer.
This is the G2 finding in a clean signal: **breathy low phonation is exactly
the class the CPP evidence cannot see.** The base and the chosen variant post
identical pitch (worker mean 88.58 %).

- `evC46` loses the same runs.
- `evB ∪ deferred` (final trace) recovers about half of the loss (9 runs,
  worst −9.0 pp).
- `B7` fails the suite mean (−0.75 pp; 374 runs).

**Sample rate** (`bridge-rate-check.mjs`):

- **Set.** 56 noise-only clips (every 5th, first 60 s) and 79 voice-in-noise
  mixes (0 dB, every 5th, voice from the stream start), resampled from the
  16 kHz corpus. Real worker; base and chosen hook.
- **Noise.** Painted false voicing falls −24.1 / −23.5 / −23.6 % at 16 /
  44.1 / 48 kHz.
- **Voice.** Painted at pitch changes −0.185 / −0.155 / −0.185 pp; 4 / 3 / 4
  of the 79 streams are worse by > 2 pp.
- **Verdict.** The CPP rule transfers to mic rates within this subset's
  noise. The 0.50 threshold sits where a few streams flip, which is already
  visible as the 4 vs 3 count.

### 4.5 Private sessions (G5, G7)

On the private session recordings, displayed voice accuracy and
register-switch behaviour were unchanged (0.00 pp), and painted false voicing
in non-voiced spans went down. The runs are fresh real-worker runs of both
trees with CPP; details are outside this repository.

## 5. Limitations

- **The ship rule is not met.** §Decision lists what fails.
- **Held-out hygiene.** The explorers chose the CPP rule's parameters with
  feature searches over all 279 noise clips, including the 85 in-set held-out
  clips. Only the second held-out set (dcaseeval, fsheld) is unseen by
  every choice. The in-set and unseen sets fall alike (−23.2 % / −24.5 %).
- **The per-stream G2 guard is coarse on short streams.** PTDB-TUG phrases
  carry ~140 voiced frames, so 3 frames are 2.1 pp. It was applied strictly,
  as registered.
- **Who pays the voice cost.** It is gender-asymmetric (male −0.18 to
  −0.23 pp, female −0.03 to −0.07 pp at 0 dB) and concentrated below 100 Hz.
  CPP is low for breathy and dysphonic phonation, which voice training
  sometimes targets on purpose (a lighter, breathier voice). In loud noise
  that phonation loses its bridge frames, not its fresh ones. Breathy low
  held notes (76–79 Hz, synthetic, over a −70 dBFS floor) lose them even
  in quiet (§4.4).
- **Sample rates.** Every corpus except PTDB-TUG (48 kHz), FDA (20 kHz) and
  vocadito (44.1 kHz) is 16 kHz. §4.4 checks a resampled subset at 44.1 and
  48 kHz. It is not a native mic recording.
- **Deferred variants and live drawing.** They are scored on the final trace.
  At each hop the live trace shows fewer frames (B7: 17–28 % of the painted
  hops arrive 25–400 ms late).
- **Not re-run.** The gender model (the display does not feed it), the
  steadiness readout (it reads posted pitch), and the synthetic interferer
  suites (their painted metric has no hold bridge).
- **Explorer data.** The private-session rows for the runner-ups are the
  explorers' own runs.

## 6. Reproduction (repo root)

```bash
export NOTCHVD_ROOT=<checkout that built them>/build/notchvd SYRINX_CORPORA_DIR=<checkout>/tests/dsp/data
R="node --import ./scripts/realnoise-fv/lib/register.mjs"; F=scripts/realnoise-fv; A=build/gap-bridge
mkdir -p $A/trees/base && git archive 21d0117 src | tar -x -C $A/trees/base
mkdir -p $A/trees/final && cp -r src $A/trees/final/
# end-to-end dumps (real worker + real hook) per tree; shard --shard=i/n for speed
for t in base final; do
  for s in noise vin fda ptdb hil voc; do $R $F/attr.mjs --set=$s --src=$A/trees/$t/src --tag=$t --out=$A/e2e; done
  $R $F/attr.mjs --set=vin --lead=0 --src=$A/trees/$t/src --tag=${t}_L0 --out=$A/e2e
  NOTCHVD_ROOT=<...>/build/notchvd-heldout $R $F/attr.mjs --set=noiseho --src=$A/trees/$t/src --tag=$t --out=$A/e2e
done
# runner-ups: their hooks replayed over the base dumps (display-only; --parity on the base tree checks the replay)
$R $F/replay.mjs --in=$A/e2e/base --out=$A/e2e/rp_<name> --set=<set> --src=<tree>/src
python $F/shiprule.py --attr=$A/e2e base final rp_<name> ...            # goal, G1-G4
python $F/shiprule.py --attr=$A/e2e --paint=paintF base rp_<deferred>   # deferred variants, final trace
python $F/vinlead.py --attr=$A/e2e --pairs=20:base:final,0:base_L0:final_L0   # by gender / register / stream
node --import ./scripts/session-oracle/lib/register.mjs $F/held-painted.mjs --worker=$A/trees/base/src \
  --trees=base=$A/trees/base/src,final=$A/trees/final/src --sr=16000,48000 --out=$A/held.json   # G6
node --import ./scripts/session-oracle/lib/register.mjs $F/bridge-rate-check.mjs --worker=$A/trees/base/src \
  --base=$A/trees/base/src --cand=$A/trees/final/src --noise-every=5 --vin-every=5 --out=$A/rate.json
# private (results stay outside this repository): scripts/session-oracle/run.mjs per tree, analyze.py
node tests/audio/bridge-evidence-test.js && node tests/audio/display-hook-test.js && node tests/audio/pitch-paint-gate-test.js
```

Runs used ≤ 3 concurrent heavy processes.
