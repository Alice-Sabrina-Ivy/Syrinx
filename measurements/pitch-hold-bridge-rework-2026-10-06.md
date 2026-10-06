# Pitch-hold bridge rework — integration and review fix round (2026-10-06)

Branch `gap-bridge-rework` from 21d0117 (main + the V19g hum-filter PR #102 +
the real-noise attribution tooling). Problem statement and attribution:
[realnoise-false-voicing-attribution-2026-10-05.md](realnoise-false-voicing-attribution-2026-10-05.md)
§1a, §3.1, §5. Public data only: the real-noise / voice-in-noise corpora of
[notch-realdata-corpora-2026-10-05.md](notch-realdata-corpora-2026-10-05.md)
(+ the second held-out set `notchvd-heldout`), FDA, PTDB-TUG, Hillenbrand,
vocadito, the notch work's synthetic held-note suite (+ a new 80–120 Hz
extension). Results on the private session recordings are kept outside this
repository (one aggregate sentence below). Tools:
[scripts/realnoise-fv/](../scripts/realnoise-fv/README.md).

This file was rewritten in the review fix round. The integration's variant
(`evB`: 50 ms CPP, threshold 0.50) is kept as the "reviewed" column; §5 lists
the 13 review findings, how each was verified and what changed.

## Decision

**The change does NOT meet the pre-registered ship rule, and no measured
variant does.** It stays on this branch, not proposed for merge.

- Made speech-safe, the evidence rule cuts painted false voicing on
  noise-only audio by about 13 %. The goal is 25 %.
- Every variant that reaches about 25 % breaks a voice guard (per-stream
  voice-in-noise losses, and breathy low held notes).
- In a live session the cut is smaller still. After the user has spoken, the
  evidence stays open for 20 s, and the bridge is drawn exactly as before.
  - Warm-start counterfactual: −3.5 % (all 279 clips), −4.7 % (held-out 2).
  - After-speech runs (§4.4): with a sentence every 15 s, painted false
    voicing in the pauses is unchanged (21.89 → 21.89 %). After one sentence
    it is unchanged for 10 s and falls 5.2 % pooled over the following ~80 s
    (the reviewed variant: 12.3 %).

**Committed: the pre-registered rule's own selection.** The rule picks the
variant with the largest held-out noise reduction among those that pass
every guard. That is the 64 ms, aligned, low-F0-corrected CPP evidence at
threshold 0.39 (`bridgeEvidence.js`, `dsp-worker.js` `bridgeCpp`):

- A held frame (the 400 ms hold window, detector null) is drawn when any of
  these holds:
  - it is in the first 50 ms of the gap;
  - it is in the first 200 ms after a voiced run of at least 250 ms;
  - CPP evidence: a strong voiced frame occurred in the last 20 s;
  - no CPP arrived for 1 s (input below 16 kHz). The rule then fails open.
- A voiced frame is strong when, among the last 4 pairings, at least 2
  voiced flags carry a CPP and their mean is ≥ 0.39.
  - The CPP is the DSP worker's `bridgeCpp`, a second CPP on the last
    64 ms of audio. `cpp` (50 ms) still feeds the vocal-weight gauge,
    unchanged.
  - Each voiced flag is paired with the CPP of the capture chunk its pitch
    frame ended on (by contextTime). The integration paired it with the CPP
    of the frame it arrived on, about 65 ms later.
  - Below 100 Hz each CPP is first divided by a gain of 0.80–1.0
    (`BRIDGE_LOW_F0_GAIN`, §4.1).
- A hidden held frame still goes through the paint gate (continuity kept).
  The readout now blanks with it, and the trace's glow dot ends at it
  (finding 9).

| rule item | base | reviewed (`evB`) | **committed** | verdict (committed) |
|---|---|---|---|---|
| goal: all 279 (≥ 25 % rel.) | 23.93 % | −26.2 % | **−12.9 %** (95 % CI −16.2 to −10.0) | **FAIL** |
| goal: held-out 85 | 23.52 % | −23.2 % (CI −30.8 to −16.7) | **−12.4 %** (CI −19.2 to −7.3) | **FAIL** |
| goal: held-out 2 (119) | 20.41 % | −24.5 % (CI −31.5 to −18.5) | **−12.8 %** (CI −18.0 to −8.7) | **FAIL** |
| … fsheld 101 (the only fully unseen, diverse split) / dcaseeval 18 | 20.81 / 18.12 % | −20.5 / −49.7 % | −10.3 / −28.7 % | FAIL / pass |
| G1 corpora: max(F_err, M_err) not worse by > 0.15 pp; vocadito correct not worse by > 0.3 pp | — | PTDB +0.021, others 0 | all +0.000 | pass |
| G2 pooled: not worse by > 0.3 pp per SNR (registered: gender-pooled) | — | worst −0.297 | worst −0.078 | pass |
| G2 pooled, gender-symmetric reading: max(F_err, M_err) not worse by > 0.3 pp | — | **+0.414 (L0 held-out), +0.329 (L20 held-out)** | worst +0.119 | pass |
| G2 < 160 Hz: not worse by > 0.5 pp | — | **−0.570** (L0 held-out) | worst −0.276 | pass |
| G2 ≤ 2 % of streams worse by > 2 pp | — | **4.6–6.7 %** (all four 0 dB cells) | worst 1.5 % (2 / 135), 0.8 % (3 / 392) | pass |
| G3 noise after speech: pooled not worse by > 1 pp, no stream by > 10 pp | — | pass | tail 0.00, gaps −0.07 to −0.89 pp; worst +0.0 | pass (subset by construction) |
| G4 fragmentation not worse by > 5 % (pooled and per corpus); median gap not longer | 0.842 seg / voiced s | **PTDB +9.18 %** | +1.19 % (FDA +0.73, PTDB +1.64, voc +0.96); medians not longer | pass |
| G5 display tests; private switch latency / never-shown | — | pass; identical | tests pass (31 / 23 / 112 / 26); private: §4.8 | pass |
| G6 held-note suite (1 804 runs): not worse by > 0.5 pp, mean and per scenario | 89.99 % | −0.13 pp; **17 runs −6.8 to −21.6 pp** | 89.99 % (0.00 pp); 0 runs below −0.5 pp | pass |
| G6 extension: 80–120 Hz breathy holds (420 runs, added in this round) | 99.51 % | −1.79 pp; **57 runs, worst −27.6 pp** | 0 runs below −0.5 pp | pass |
| G7 private displayed band accuracy: not worse by > 0.3 pp | — | 0.00 pp | §4.8 | pass |

**What fails:** the goal, on every split except dcaseeval: −12.9 % on all
279 clips and −12.4 / −12.8 % on the two held-out sets, against ≥ 25 %. Every
guard holds.

**What the numbers do not show** (§4.3–§4.6):

- **The cut is mostly a cold start.** It acts only where no strong voiced
  frame occurred in the last 20 s, and every Stop / Start and every pause
  over 20 s pays it again.
  - Time-weighted: −10.1 %. Steady state (45–90 s into long clips): −6.3 %
    tuning, −11.1 % held-out 2.
  - Warm start (the user spoke just before): −3.5 %.
- **The noise that most needs it gets almost none.** In 152 of 279 clips the
  noise itself produces a strong frame, and 82 % of the base's painted false
  voicing lies in the spans those frames keep open. Those clips fall only
  5.3 %; the other 127 fall 61 %. The worst rooms are unchanged (hvac 96.8 →
  96.8 %, mains hum 89.6 → 89.6 %, microwave, refrigerator, generator:
  unchanged).
- **What the user sees falls more than the trace.** On all 279 clips, any
  false-pitch indicator (trace, readout number or glow dot) falls 17.6 %
  (35.03 → 28.85 %). The hidden frames now blank the readout and end the dot.
- **The voice cost leans male.** Of the 3 streams worse by > 2 pp, all 3 are
  male voices (3 / 184 male, 0 / 108 female). The pooled change is −0.083 pp
  for male and 0.000 for female voices (L0, 0 dB). All stay within the guards.

**Other operating points, for the user's choice** (all measured through the
real hook; §3):

| variant | goal all / held-out 85 / held-out 2 | fails |
|---|---|---|
| **committed** (64 ms, aligned, low-F0 gain, 0.39) | −12.9 / −12.4 / −12.8 % | goal only |
| same without the low-F0 gain, 0.39 | −13.9 / −12.8 / −13.8 % | goal; G6: 1 registered run (−6.8 pp), 6 of the 80–120 Hz runs (to −24.4 pp) |
| 64 ms, aligned, 0.45 | −22.8 / −21.6 / −21.9 % | goal; G2 per stream (L0: 8 / 392 = 2.04 %, 4 / 135 = 3.0 %); G6: 15 runs; 80–120 Hz: 20 runs |
| 50 ms, aligned, 0.50 (the reviewed variant with only the alignment fix) | −25.0 / −21.8 / −25.1 % | goal held-out 85 and fsheld; G2 per stream in all four 0 dB cells (3.1–4.4 %); G2 gender-symmetric L0 held-out +0.328; G6: 17 runs; 80–120 Hz: 54 runs |
| reviewed `evB` (50 ms, misaligned, 0.50) | −26.2 / −23.2 / −24.5 % | goal held-out; G2 per stream (4 cells), symmetric (2 cells), < 160 Hz (1 cell); G4 PTDB; G6: 17 runs; 80–120 Hz: 57 runs |

To reach the goal, the evidence would need a voice-versus-machine
discriminator that strongly tonal machine rooms do not pass. CPP is not that
discriminator (§4.3).

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

**Readings applied** (fixed in `shiprule.py`; this round makes each the
strict one):

- **Held-out.** The in-set FNV split (85 noise clips / 270 mixes) and the
  second held-out set (119 clips: dcaseeval 18, fsheld 101). Every held-out
  split must fall ≥ 25 %, each read separately.
- **G2.**
  - Scored on all 784 mixes and on the held-out mixes, at the mixes' 20 s
    noise-only lead and at lead 0.
  - The pooled clause is read twice: gender-pooled as registered, and
    gender-symmetric (max(F_err, M_err)), as the project's binding rule for
    ship decisions asks. Both must hold.
- **G3.** Tail and gaps-between-phrases segments of ≥ 20 hops.
- **G4.** Pooled and per corpus, both. The registered median clause is kept,
  with a context measure next to it (finding 6, §4.5).
- **G6.** Per scenario (no run more than 0.5 pp below base), as well as the
  suite mean.
  - The 80–120 Hz breathy-hold extension was built in this round (finding 3).
    It is counted as part of G6. That did not change the selection: with the
    low-F0 gain both suites pass up to 0.40, and the voice-in-noise guard binds
    first, at 0.39. Without the gain it would have mattered: the registered
    suite alone allows 0.37, both together 0.35 (§3).
- **Selection.** "Largest held-out noise reduction among those that pass
  every guard", literally.
  - The goal is the ship criterion, not a guard, so a variant can be
    selected and still fail the rule. That is the case here.
  - The integration read "closest" as "the closest variant that reaches the
    goal". The reviewed variant did not reach it either (finding 10).

## 2. Method

**Production chain.** Every number comes from the REAL pitch worker (V19g
notch, ghost veto, above-range null, harmonic guard), the REAL DSP worker and
the REAL `handleAnalysisResult` (`attr.mjs` → `scripts/session-oracle/lib/chain.mjs`).

- **End to end, fix round.** The tree `x64a` was run end to end on all
  3 402 streams: the new DSP worker (`bridgeCpp`) plus the aligned 64 ms
  evidence at 0.50.
  - Its pitch-worker and DSP columns (incl. `cpp`) are bit-identical to the
    integration's base dumps. So the second CPP call leaves `cpp`
    untouched.
  - Its own hook replayed over its dumps reproduces its display columns
    exactly (0 mismatches).
- **Every other display tree was replayed over those dumps through its real
  hook** (`replay.mjs`):
  - base: matches the integration's base display exactly, all 8 sets;
  - the committed `src`;
  - the comparison variants.
- **Committed `src` vs the measured readout-blanking variant**: identical
  paint, readout, style and final trace on every stream.
- **Exploration.** Thresholds and options were scanned with an offline replica
  of the rule (`evidence.py`): base dumps minus the hidden held frames.
  - Before any number built on it is quoted, `evidence.py check` must show
    0 mismatching hops against the real hook. It does, on every set and every
    variant checked: the reviewed rule, `x64a`, the committed rule, and 0.39
    without the gain.
  - The final numbers are the real-hook replays.
- **Production wiring** (contextTime pairing, `bridgeCpp`) reaches the hook
  in every tool that drives it: `lib/chain.mjs`, `attr.mjs`, `replay.mjs` and
  `lowband-attr.mjs`. `replay.mjs` refuses a dump without the `bcpp` column,
  since the evidence would silently fail open.

**Tooling added or changed in this round** (committed with this file):

- `evidence.py`: the rule replica and its parity check.
- `bridge-review.py`: the rows the rule does not score:
  - goal with CIs, time-weighted, steady state, by duration, source and class;
  - the strong-CPP split and the warm start;
  - user-visible indicators and notch timing;
  - per-stream G2 by F0 bin and gender, and flicker.
- `afterspeech.mjs` / `afterspeech.py`: noise after and between real speech.
- `cpp-vs-f0.mjs`: §4.1.
- `held-painted-agg.py`.
- `held-painted.mjs --suite=lowband`, with the 80–120 Hz scenarios in
  `scripts/notch-adversarial/scenarios.mjs` `lowBandScenarios()`. They sit
  outside `heldScenarios()`, so the notch work's 902-scenario suite is
  unchanged.
- `shiprule.py`: a gender-symmetric G2 verdict row and the G4 context
  columns.

## 3. Variants and selection

**Fix-round variants.** All differ from the reviewed variant in the evidence
only. The paint gate, the hold window and the graces are unchanged.

| variant | CPP window | pairing | low-F0 gain | threshold |
|---|---|---|---|---|
| reviewed `evB` | 50 ms (`cpp`) | frame of arrival | — | 0.50 |
| aligned 50 ms | 50 ms | own chunk | — | 0.38–0.60 scanned |
| aligned 64 ms | 64 ms (`bridgeCpp`) | own chunk | — | 0.30–0.50 scanned |
| 64 ms + gain | 64 ms | own chunk | < 100 Hz | 0.37–0.41 scanned |
| F0-compensated (both ends) | 50 / 64 ms | own chunk | < 100 Hz and > 250 Hz | 0.46–0.55 scanned |

**Frontier** (replica scan, then real-hook replays for the rows marked †).
"G2 L0 held" is the binding guard: the per-stream share at lead 0, 0 dB,
135 held-out streams, limit 2 (2.7) streams.

| variant | goal all / held-out 85 / held-out 2 | G2 per stream at lead 0, 0 dB (all / held-out) | G6 registered / 80–120 Hz runs > 0.5 pp worse | passes every guard |
|---|---|---|---|---|
| 64 ms + gain, 0.37 | −10.1 / −10.5 / −9.6 % | 1 / 1 | 0 / 0 | yes |
| **64 ms + gain, 0.39** † | **−12.9 / −12.4 / −12.8 %** | 3 / 2 | 0 / 0 | **yes — selected** |
| 64 ms + gain, 0.40 | −14.9 / −13.8 / −15.0 % | 4 / 3 | 0 / 0 | no (G2) |
| 64 ms, 0.35 | −8.2 / −6.2 / −6.9 % | 1 / 1 | 0 / 0 | yes |
| 64 ms, 0.37 | −11.1 / −11.2 / −10.5 % | 1 / 1 | 0 / 3 | no (80–120 Hz) |
| 64 ms, 0.39 † | −13.9 / −12.8 / −13.8 % | 3 / 2 | 1 / 6 | no (G6) |
| 64 ms, 0.45 † | −22.8 / −21.6 / −21.9 % | 8 / 4 | 15 / 20 | no |
| 64 ms, 0.50 (`x64a`, end to end) | −25.8 / −23.2 / −25.8 % | 17 / 10 | 17 / 50 | no |
| 50 ms aligned, 0.40 | −12.7 / −9.2 / −10.7 % | 3 / 1 | 16 / 9 | no (G6) |
| 50 ms aligned, 0.45 | −21.1 / −18.4 / −20.1 % | 6 / 3 | — | no (G2) |
| 50 ms aligned, 0.50 † | −25.0 / −21.8 / −25.1 % | 14 / 6 | 17 / 54 | no |
| 50 ms, F0-compensated, 0.55 | −22.3 / −18.5 / −21.4 % | 14 / 5 | — | no (G2) |
| reviewed `evB` (50 ms, misaligned, 0.50) | −26.2 / −23.2 / −24.5 % | 18 / 8 | 17 / 57 | no |

What decided it:

- **Alignment is a pure improvement.** At the reviewed threshold (50 ms,
  0.50), pairing each flag with its own chunk's CPP changes these:
  - G2 per stream: 18 → 14 (all) and 8 → 6 (held-out);
  - streams below 100 Hz that lose: 7 → 3 of 29;
  - PTDB-TUG fragmentation: +9.2 → +2.6 %;
  - the goal: −26.2 → −25.0 %.
  The reviewers' scratch "lag 3" variant gave the same picture.
- **The 64 ms window is what fixes the low held notes.** At every threshold,
  the 50 ms evidence loses the registered suite's breathy 76–79 Hz holds:
  16 runs even at 0.40. The 64 ms evidence loses none at ≤ 0.37, and with
  the low-F0 gain none at 0.40.
  - At matched noise reduction, the voice-in-noise per-stream costs of
    50 ms and 64 ms are about the same: 50 ms at 0.45 gives −21.1 %, 6 / 3
    streams; 64 ms at 0.43 gives −21.2 %, 7 / 4.
- **An F0-dependent threshold over the whole range was rejected.** It also
  lowers the bar for high voices, which admits noise. To keep the same noise
  cut the threshold must rise, and more mid-range voices lose: 50 ms with the
  compensation at 0.55 gives −22.3 % with 14 / 5 streams, against 6 / 3 for
  the uncompensated 0.45 at −21.1 %. Only the < 100 Hz part was kept, where
  the 64 ms CPP still reads low (§4.1).
- **Speaker-relative thresholds were not tried.** A threshold relative to
  the stream's own CPP would let a stationary machine room set its own bar.
  The design excludes learning from the background.
- **Previous round's runner-ups** (deferred drawing `B7`, continuity bridge
  `C5`, the unions `evB ∪ C5` / `evB ∪ deferred`): measured on the misaligned
  50 ms evidence and not re-run.
  - Each failed G2 or the goal by a wider margin than the variants above.
  - Their numbers are in this file's integration version (git history at
    cee02f1).

## 4. Committed variant in detail

### 4.1 The evidence signal

**CPP depends on F0, and the window decides how much** (`cpp-vs-f0.mjs`:
production cpp.js, one synthetic /a/, median over 25 ms hops). Ratio to the
100–250 Hz mean:

| window, rate, aspiration | 76 Hz | 82 Hz | 90 Hz | 100 Hz | 300 Hz | 350 Hz |
|---|---|---|---|---|---|---|
| 50 ms, 16 kHz, modal | 0.65 | 0.78 | 0.83 | 0.93 | 0.77 | 0.72 |
| 50 ms, 16 kHz, −6 dB | 0.57 | 0.64 | 0.74 | 0.89 | 0.88 | 0.85 |
| 64 ms, 16 kHz, modal | 0.90 | 0.90 | 1.01 | 1.03 | 0.76 | 0.66 |
| 64 ms, 16 kHz, −6 dB | 0.75 | 0.78 | 0.89 | 0.98 | 0.85 | 0.79 |
| 64 ms, 48 kHz, modal | 0.76 | 0.81 | 0.88 | 0.96 | 0.83 | 0.76 |
| 64 ms, 48 kHz, −6 dB | 0.79 | 0.85 | 0.92 | 1.00 | 0.80 | 0.75 |

- The reviewers' figures reproduce exactly: on 50 ms, CPP at 76–82 Hz is
  35–48 % lower than at 140–200 Hz.
- Longer windows (80 / 100 ms, a scratch copy of cpp.js) flatten the low end
  further but penalise 300–350 Hz.
- 64 ms is cpp.js's own preferred input length and needs no change to cpp.js.
- `BRIDGE_LOW_F0_GAIN` (0.80 / 0.82 / 0.92 / 1.0 at 75 / 82 / 90 / 100 Hz)
  was set from the 16 kHz readings before any variant using it was scored.
  With the 48 kHz readings added afterwards, the mean of all four 64 ms rows
  is 0.80 / 0.83 / 0.93 / 0.99.
- High voices read low too (0.66–0.85 at 300–350 Hz) and are not corrected
  (§3: correcting them admitted more noise than it saved voice).

**Cost.** One more `computeCPP` per DSP frame, on the last 64 ms of the
ring buffer (100 ms). In Node: 0.12 ms at 16 kHz, 0.39 ms at 44.1 kHz and
0.42 ms at 48 kHz per call. The anti-alias resampling dominates at mic rates.
That is 1.7 % of a 25 ms frame on a desktop; mobile is unmeasured.

**Alignment.** A DSP frame consumes the latest pitch message. That message
describes the frame L = 2 hops back, centred about 90 ms before the chunk
end. The DSP frame's own 50 ms CPP is centred about 25 ms before the chunk
end.

- Both messages carry their chunk's contextTime, so the evidence now pairs
  each voiced flag with the CPP of that same chunk. The 64 ms CPP window lies
  inside the 80 ms pitch window.
- Without timestamps the rule falls back to a lag of 2 frames.

### 4.2 Voice in noise (G2)

Lead 0, 0 dB (the +10 dB cells move ≤ 0.001 pp, and no stream there is
worse by > 2 pp):

| | all 392 | held-out 135 |
|---|---|---|
| painted at pitch (pooled) | 54.34 → 54.29 (−0.051) | 55.58 → 55.50 (−0.078) |
| < 160 Hz | −0.098 | −0.276 |
| max(F_err, M_err) | +0.083 | +0.119 |
| streams worse > 2 pp | 3 (0.8 %) | 2 (1.5 %) |

Lead 20 s, 0 dB: pooled −0.010 / −0.001 pp, 0 streams worse.

Per stream by the stream's median truth F0 and by voice gender (lead 0, 0 dB,
all 392; `bridge-review.py f0`):

| | < 100 Hz | 100–130 | 130–160 | 160–220 | ≥ 220 | male | female | unknown |
|---|---|---|---|---|---|---|---|---|
| streams | 29 | 85 | 21 | 103 | 154 | 184 | 108 | 100 |
| reviewed: worse > 2 pp | 7 (24 %) | 3 | 0 | 4 | 4 | 12 (6.5 %) | 2 (1.9 %) | 4 |
| committed: worse > 2 pp | 0 | 1 | 0 | 0 | 2 | 3 (1.6 %) | 0 | 0 |
| committed: pooled change, pp | 0.000 | −0.136 | −0.020 | 0.000 | −0.043 | −0.083 | 0.000 | −0.021 |

The 3 streams that lose are all male voices, mixed at 0 dB with no noise lead:

- a VocalSet male held note in DCASE fan;
- a VocalSet male held note in DCASE valve;
- a VOICED clinical voice in a freesound hvac.

The low-register concentration that the review found (24 % of < 100 Hz
streams) is gone. A male-leaning residue remains, inside the guard.

### 4.3 Noise-only audio (the goal)

**Registered metric with uncertainty** (clip mean; bootstrap over clips):

| split | base | committed | change | 95 % CI | time-weighted |
|---|---|---|---|---|---|
| all 279 | 23.93 | 20.84 | −12.9 % | −16.2 to −10.0 % | −10.1 % |
| tuning 194 | 24.11 | 20.94 | −13.2 % | −17.2 to −9.4 % | −10.3 % |
| held-out 85 | 23.52 | 20.59 | −12.4 % | −19.2 to −7.3 % | −9.6 % |
| held-out 2 (119) | 20.41 | 17.79 | −12.8 % | −18.0 to −8.7 % | −12.7 % |
| dcaseeval 18 | 18.12 | 12.93 | −28.7 % | −45.3 to −15.5 % | −29.1 % |
| fsheld 101 | 20.81 | 18.66 | −10.3 % | −15.4 to −6.5 % | −10.6 % |

No clip and no 5 s window is worse than base: the trace is a subset of the
base trace, with identical values.

**By stream time** (hop-pooled, clips ≥ 60 s):

| set | 0–5.5 s | 5.5–20.5 s | 20.5–45 s | 45–90 s |
|---|---|---|---|---|
| tuning (89 clips) | −14.6 % | −6.4 % | −9.0 % | −6.3 % |
| held-out 2 (42 clips) | −26.6 % | −11.5 % | −8.1 % | −11.1 % |

By clip duration (all 279): 10 s clips −24.0 %, 10.5–20 s −17.0 %, 20–45 s
−11.9 %, ≥ 45 s −9.5 %. The per-clip mean favours short clips and early
seconds. A live session is the steady-state row.

**By source:** DCASE −23.5 %, dcaseeval −28.7 %, MS-SNSD −20.6 %, freesound
−7.7 %, fsheld −10.3 %, DEMAND −3.4 %. **By class:** stationary-tonal
−11.9 %, intermittent-tonal −22.4 %, mixed −13.3 %, broadband −11.2 %.

**All or nothing per clip.** The cut depends on whether the noise ever
produces a strong-evidence frame (replica):

| | clips | base | change | median clip change |
|---|---|---|---|---|
| all 279: the noise gives strong frames | 152 | 37.90 % | −5.3 % | 0.0 % |
| all 279: never | 127 | 7.21 % | −61.0 % | −70.3 % |
| stationary-tonal: strong / never | 62 / 40 | 38.04 / 10.17 % | −4.9 / −52.4 % | — |
| mixed: strong / never | 68 / 65 | 40.39 / 7.02 % | −4.4 / −67.3 % | — |
| held-out 2: strong / never | 73 / 46 | 29.63 / 5.77 % | −6.9 / −60.8 % | — |

- 81.7 % of the base's painted false voicing lies in spans the noise's own
  strong frames keep open. The reviewed variant's 0.50 threshold left 51 %
  there; the speech-safe threshold opens more.
- Of the 15 worst rooms, 11 change by less than 2 pp, among them hvac,
  mains hum, microwave, refrigerator, generator, exhaust fan and an MS-SNSD
  air conditioner. All 15 produce strong frames.
- The cut that remains comes from the sparse, broadband-ish machine noise
  whose CPP never reaches the bar.

**Notch timing** (finding 13). `bridgeCpp` is computed on un-notched audio,
while the pitch worker analyses notched audio.

- In the 136 of 279 clips that ever get a notch, 26.8 % of the strong frames
  occur before the clip's first notch and 48.5 % while a notch is active.
- Held frames drawn on such evidence: 1.01 pp (before the first notch) and
  1.59 pp (during an active notch), clip mean over all 279; 76 clips have
  any.
- It is concentrated in a few clips, up to 37 pp per clip: freesound
  generator, a DCASE slider and pump, an MS-SNSD air conditioner.
- A limitation. Evaluating CPP on the notched buffer, or excluding frames
  near notched lines, is the lever if this rule were pursued.

### 4.4 Noise in a live session: after speech and between phrases

The voice-in-noise mixes cannot test this. Their noise tails and gaps all lie
within 5 s of speech, inside the 20 s evidence window. G3 passes by
construction, since the trace only loses frames.

**Warm-start counterfactual** (exact for a hide-only rule). Suppose the user
spoke just before each clip, so the evidence is open from t = 0 for 20 s:

| split | committed, as measured (cold start) | warm start |
|---|---|---|
| all 279 | −12.9 % | −3.5 % |
| held-out 85 | −12.4 % | −4.0 % |
| held-out 2 (119) | −12.8 % | −4.7 % |
| fsheld 101 | −10.3 % | −3.5 % |

The reviewed variant's warm start was −8.1 / −8.6 / −11.1 %, and that of the
alignment-only 0.50 variant −7.7 %.

**After-speech runs** (`afterspeech.mjs`). The real workers run once per
condition on all 89 noise-only clips of ≥ 60 s (58 tuning, 31 held-out; first
90 s), with PTDB-TUG sentences mixed in at +10 dB, and the base, reviewed and
committed hooks are driven over the same frames. Painted false voicing on the
noise-only hops (≥ 0.5 s from any sentence), by time since the last sentence
ended:

| condition | since the last sentence | hops | base | reviewed | committed |
|---|---|---|---|---|---|
| C0 noise only | — | 299 579 | 23.26 % | −17.7 % | −7.7 % |
| C1 one sentence at t = 1 s | before it (first 0.5 s) | 1 975 | 22.63 % | −35.3 % | −33.8 % |
| | 0–5 s | 15 801 | 23.30 % | 0.0 % | 0.0 % |
| | 5–10 s | 17 503 | 21.02 % | 0.0 % | 0.0 % |
| | 10–20 s | 35 224 | 22.44 % | −3.2 % | −1.5 % |
| | 20–40 s | 70 476 | 23.13 % | −16.5 % | −8.1 % |
| | 40 s + | 133 004 | 22.41 % | −15.4 % | −5.8 % |
| | pooled after the sentence | 272 008 | 22.56 % | −12.3 % | −5.2 % |
| C2 a sentence every 15 s | pooled over the pauses | 149 891 | 21.89 % | 0.0 % | 0.0 % |

- **Between phrases the change does nothing.** The pauses of a session are
  inside the 20 s evidence window. The reviewers' own run found the same for
  the reviewed variant.
- **After a single sentence** the cut returns only once 20 s have passed
  without a strong frame, and it is smaller at the safe threshold, where the
  noise itself more often reopens the evidence (§4.3).
- **Sentence hops.** The painted share of all hops inside the sentence spans,
  voiced or not, goes 45.66 → 43.57 % (C1) and 44.42 → 44.06 % (C2). This is
  the cold start hiding held frames between the first sentence's words. Voice
  accuracy on truth-voiced frames is what G2 scores: PTDB-TUG in the mixes at
  +10 dB, lead 0, changes by −0.001 pp.

### 4.5 Clean speech (G1, G4)

- **Displayed accuracy.** Identical on all four corpora: 0.000 pp on every
  max(F_err, M_err), < 160 Hz and vocadito row.
- **Fragmentation.** FDA +0.73 %, PTDB-TUG +1.64 %, vocadito +0.96 %,
  pooled +1.19 %. Hidden frames: 4 (FDA), 23 (PTDB-TUG), 50 (vocadito); the
  reviewed variant hid 19 / 105 / 50.
- **The registered median clause cannot see this change** (finding 6).
  Hiding held frames adds short gaps, which pulls the median gap length
  down; the reviewed variant's ≤ 500 ms median went 200 → 175 ms (FDA) and
  175 → 150 ms (PTDB-TUG) while its segment count rose 9 %.
  - `shiprule.py` therefore prints context columns that grow with
    fragmentation: gaps ≤ 500 ms between painted segments per voiced second,
    and their total time per voiced second.
  - Committed: +1.9 % and +0.8 %. Reviewed: +9.0 % and +3.2 %.
- **Cold start.** Each corpus clip is a new stream, and its first gaps before
  the first strong frame can be hidden. A live session pays this again on
  every Stop / Start (the hook rebuilds the evidence on `start()`) and after
  every pause longer than 20 s without a strong voiced frame.

### 4.6 What the user sees (findings 5 and 9)

The reviewed variant hid held frames from the trace only.

- The readout kept the held value, dimmed, for the 400 ms fall time
  (`VOICED_FALL_FRAMES`).
- The glow dot stayed at the last painted point for 500 ms.
- So on noise-only audio the false pitch the user saw fell 8.7 %, while the
  trace fell 26.2 %.

**Changed:** a hidden held frame now blanks the readout and ends the dot. The
readout uses `heldReadoutStaleRef`, the existing "—" state; the trace entry is
marked `hidden`, and `PitchTrace.jsx` stops the dot scan there. The style
(dim / grey hysteresis) is unchanged.

| noise-only, clip mean | base | committed, readout kept | **committed** |
|---|---|---|---|
| trace, all 279 | 23.93 % | −12.9 % | −12.9 % |
| readout number | 32.14 % | −5.7 % | **−17.4 %** |
| glow dot | 32.58 % | −5.4 % | **−17.6 %** (modelled from the trace entries) |
| any of the three | 35.03 % | −5.0 % | **−17.6 %** |
| any, held-out 2 | 32.43 % | −5.0 % | **−18.1 %** |

Cost in speech (voice in noise, 0 dB, lead 0, truth-voiced frames). It is
small because the evidence is open during speech:

| | base | committed |
|---|---|---|
| readout number shown | 81.91 % | 81.67 % |
| number → blank transitions | 2 773 | 2 811 (+1.4 %) |
| dim-style share | 10.18 % | 10.27 % |
| bright → dim transitions | 2 997 | 3 032 (+1.2 %) |
| painted dashes ≤ 3 frames | 384 | 397 (+3.4 %) |

The reviewed variant's flicker on the same streams was larger: dim
transitions +5.3 %, dashes +14.3 %. No guard measures readout flicker; the
increase above is an accepted cost.

### 4.7 Held notes (G6) and sample rate

**Registered suite** (`held-painted.mjs`, 902 scenarios × 16 + 48 kHz, every
tree's real hook over one real-worker run per scenario, DSP CPP passed):

| tree | painted mean | runs > 0.5 pp below base | worst run |
|---|---|---|---|
| base | 89.99 % | — | — |
| reviewed `evB` | 89.86 % (−0.13 pp) | 17 | −21.6 pp |
| 50 ms aligned, 0.50 | 89.86 % | 17 | −21.6 pp |
| 50 ms aligned, 0.40 | 89.87 % | 16 | −21.6 pp |
| 64 ms aligned, 0.50 / 0.45 | 89.86 / 89.90 % | 17 / 15 | −21.6 pp |
| 64 ms aligned, 0.39 / 0.38 | 89.99 % | 1 / 1 | −6.8 pp (swell/78/cresc12/t0=0/breathy, 16 kHz) |
| 64 ms aligned, ≤ 0.37 (low / swell families) | — | 0 | — |
| **committed** | **89.99 % (0.00 pp)** | **0** | — |

Every family other than `low` and `swell` is identical for every tree.

The reviewed variant's 17 losing runs were all breathy holds at 76–79 Hz
(`low`, `swell`). The worker posts only 60–85 % of their hold frames, and
these notes never reached the 50 ms evidence level.

**80–120 Hz extension** (finding 3; `lowBandScenarios()`, 210 scenarios ×
2 rates):

- F0s: 82, 88, 94, 100, 106, 112, 118 Hz.
- Vowels /i/, /u/ and /a/.
- Two qualities: breathy (HNR 10 dB) and very breathy (HNR 6 dB, steeper
  source).
- Shapes: flat from t0 = 0 / 0.15 s, soft (−12 dB), crescendo and messa di
  voce.

| | worker | base | reviewed | 64 ms, 0.39, no gain | committed |
|---|---|---|---|---|---|
| breathy (210 runs) | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| very breathy (210 runs) | 89.2 % | 99.02 % | 95.45 % | 98.73 % | 99.02 % |
| runs > 0.5 pp below base (of 420) | — | — | 57 (worst −27.6 pp) | 6 (worst −24.4 pp) | 0 |

- The reviewers' grid saw no loss because the detector posted every frame on
  their notes. Very breathy phonation does make it drop frames (worker
  56–85 % on the losing runs, 82–118 Hz). There the reviewed variant lost up to 27.6 pp, for
  example 82 Hz /a/ held flat: 89.0 → 61.4 %.
- The 64 ms evidence without the gain still lost 6 runs, all at 82–88 Hz and
  16 kHz input.

**Sample rate** (`bridge-rate-check.mjs`, 56 noise-only clips and 79 voice-in-
noise mixes at 0 dB, voice from the stream start, resampled to each rate):

| rate | noise-only painted FV (56 clips) | change | voice painted at pitch (79 mixes) | change | mixes worse > 2 pp |
|---|---|---|---|---|---|
| 16 kHz | 27.69 → 25.18 % | −9.1 % | 61.73 → 61.64 % | −0.093 pp | 1 |
| 44.1 kHz | 28.28 → 25.53 % | −9.7 % | 62.09 → 62.02 % | −0.073 pp | 0 |
| 48 kHz | 27.96 → 25.73 % | −8.0 % | 61.68 → 61.59 % | −0.093 pp | 1 |

- The rule transfers to mic rates within this subset's noise. The subset
  (every 5th clip, first 60 s) falls 9.1 % at 16 kHz, the full set 12.9 %.
- At 48 kHz the CPP of the same audio reads higher (§4.1: the anti-alias
  resampling), and the noise cut is about 1 pp smaller.
- The reviewed variant on the same subset: −24.1 / −23.5 / −23.6 % noise,
  −0.185 / −0.155 / −0.185 pp voice, 4 / 3 / 4 mixes.

### 4.8 Private sessions (G5, G7)

On the private session recordings, displayed voice accuracy (trace and
readout, every band) and register-switch behaviour were unchanged (0.00 pp),
and painted false voicing in non-voiced spans fell about 1 % relative (about
10 % for the integration's variant); details are outside this repository.

## 5. Review fix round: the 13 findings

Each finding was re-derived with the integration's own dumps before anything
changed. Every number the reviewers gave was reproduced, except where noted.

1. **Low voices pay most; CPP on 50 ms depends on F0 (high).**
   - *Verified.* The synthetic probe reproduces exactly. The per-stream rows
     reproduce too: < 100 Hz 7 / 29, male 12 / 184, female 2 / 108. The
     reviewers' "≥ 220 Hz: 5 of 187" used a different bin edge; here
     ≥ 220 Hz is 4 / 154.
   - *Fixed.* The evidence moved to a separate 64 ms CPP (§4.1), and the
     threshold is lowered below 100 Hz. Per-stream G2 rows by F0 bin and
     gender were added (§4.2).
   - A full-range F0-dependent threshold was measured and rejected (§3).
     Speaker-relative thresholds were not tried, by design.
   - After the fix: 0 of 29 low streams lose. A male-leaning residue remains
     (3 / 184 vs 0 / 108).
2. **G2 fails gender-symmetrically on held-out lead 0 (medium).**
   - *Verified:* +0.414 pp. The same reading also fails at the 20 s lead on
     held-out: +0.329 pp.
   - *Fixed.* `shiprule.py` has a gender-symmetric verdict row, and the
     Decision table carries it. Committed: worst +0.119 pp.
3. **Breathy low holds lose their bridge; 80–120 Hz untested (medium).**
   - *Verified:* low 99.18 → 94.31 %, the same 17 runs.
   - *Fixed.* The 80–120 Hz extension was built (§4.7); it exposes losses up
     to 27.6 pp in the reviewed variant. It counts as part of G6 here.
   - Committed: 0 losing runs in both suites.
4. **The voicing flag is paired with CPP from about 65 ms later (medium).**
   - *Verified.* Replica of the reviewers' "lag 3" variant: streams 18 → 14,
     < 100 Hz 7 → 3, max(F,M) +0.230 → +0.210 and +0.414 → +0.333, goal
     −25.0 %. The reviewers quote −24.7 % on clips capped at 60 s.
   - *Fixed.* The pairing is by contextTime (§4.1), and every threshold and
     option was re-scanned after it.
5. **Hidden held frames dim the readout mid-word (low).**
   - *Verified* on all 392 streams: dim transitions +5.3 %, short dashes
     +14.3 %. The reviewers measured 196 streams with a different dash count.
   - *Resolved* together with finding 9. The style is unchanged. The extra
     flicker is small at the committed threshold (+1.2 % transitions, +3.4 %
     dashes) and is stated as an accepted cost (§4.6).
6. **The G4 median clause cannot catch this regression (low).**
   - *Verified:* the ≤ 500 ms medians fall while segments rise.
   - *Fixed.* Context columns were added that grow with fragmentation, and
     the median is no longer cited as evidence of continuity (§4.5).
7. **No regression found in clean speech, realistic timing, 48 kHz, reverb
   or recorded frames (low, informational).**
   - *Verified in code:* `start()` rebuilds the evidence.
   - *Added* the cold-start sentence (§4.5, Decision).
8. **The cut does not reach noise during or after speech (high).**
   - *Verified.* The warm-start counterfactual reproduces exactly: −8.1 /
     −11.1 / −9.2 % for the reviewed variant.
   - *Fixed in the report:* the warm start and the after-speech runs (§4.4),
     plus a Decision sentence. Committed warm start: −3.5 %.
   - The 20 s window was not changed. A shorter window would open less after
     speech and cost cold-start voice. The rule does not score after-speech
     noise.
9. **Readout and glow dot still show the false pitch (high).**
   - *Verified* exactly: any indicator −8.7 % against the trace's −26.2 %.
   - *Fixed in code.* Hidden held frames blank the readout and end the dot.
     Committed: −17.6 % on any indicator, against −12.9 % on the trace
     (§4.6).
10. **The goal fails on every held-out split (high).**
    - *Verified:* the CIs reproduce exactly.
    - *Fixed.* The goal rows read FAIL. The selection was redone as the
      registered rule states it, largest held-out cut among guard-passing
      variants (§1, §3), and a per-item miss table is given for the
      alternatives (Decision).
    - fsheld is reported separately.
11. **The noisiest rooms get almost nothing (medium).**
    - *Verified* exactly: 117 of 398 clips; stationary-tonal −7.9 % vs
      −45 %.
    - *Fixed in the report* (§4.3): split by strong-CPP clips, by source and
      class, and the worst rooms.
    - At the safe threshold the split is starker: 152 of 279 clips produce
      strong frames, and they fall 5 %.
12. **The goal pass depends on the per-clip mean (medium).**
    - *Verified:* time-weighted −21.7 %; steady state −15.6 %. The duration
      buckets differ slightly from the reviewers' in edge handling.
    - *Fixed in the report:* time-weighted, stream-time and duration rows
      (§4.3).
13. **Notch timing (low).**
    - *Verified in kind.* Own definitions, restricted to clips that get a
      notch: 0.25 pp drawn on pre-notch evidence and 0.63 pp on
      active-notch evidence for the reviewed variant; up to 27 pp in single
      clips. The reviewers' split (59 % / 22 %) used another definition of
      notch promotion.
    - *Noted* as a limitation (§4.3, §6).

## 6. Limitations

- **The ship rule is not met** (Decision). The evidence cannot tell a strongly
  tonal machine room from a voice. A discriminator beyond CPP would be needed.
- **Held-out hygiene.**
  - The threshold is the largest that passes every guard, and the guards
    include the held-out voice-in-noise streams: the binding guard is the
    held-out G2 per-stream share, at 2 of 135 streams.
  - The low-F0 gain was fixed from a synthetic probe, not from the corpora.
  - The second held-out noise set (dcaseeval, fsheld) was not used for any
    choice.
- **A knife-edge guard.** At 0.40, a third held-out stream crosses −2 pp and
  G2 fails. The per-stream guard on short streams (PTDB-TUG phrases of about
  140 voiced frames, where 3 frames are 2.1 pp) is coarse, and was applied
  strictly, as registered.
- **The reviewed variant's numbers** are the integration's end-to-end dumps.
  Every fix-round number comes from the `x64a` end-to-end dumps plus
  real-hook replays (§2).
- **Synthetic held notes** sit over a −70 dBFS floor. The 80–120 Hz
  extension's "very breathy" quality (HNR 6 dB) is harsher than the
  registered suite's breathy quality (10 dB).
- **High voices** (≥ 300 Hz) read 15–34 % lower CPP on 64 ms and are not
  corrected. No loss was measured: female voice-in-noise streams, vocadito
  and the held suite up to 280 Hz show none. Breathy phonation above 300 Hz
  with detector dropouts is untested.
- **Sample rates.** Every corpus except PTDB-TUG (48 kHz), FDA (20 kHz) and
  vocadito (44.1 kHz) is 16 kHz. §4.7 checks a resampled subset; it is not a
  native mic recording. Mobile CPU cost of the second CPP is unmeasured.
- **Not re-run.**
  - The gender model: the display does not feed it.
  - The steadiness readout: it reads posted pitch.
  - The synthetic interferer suites: their painted metric has no hold
    bridge.

## 7. Reproduction (repo root)

```bash
export NOTCHVD_ROOT=<checkout that built them>/build/notchvd SYRINX_CORPORA_DIR=<checkout>/tests/dsp/data
R="node --import ./scripts/realnoise-fv/lib/register.mjs"; F=scripts/realnoise-fv; A=build/gap-bridge
mkdir -p $A/trees/base && git archive 21d0117 src | tar -x -C $A/trees/base
mkdir -p $A/trees/final && cp -r src $A/trees/final/
# end-to-end dumps of the final tree (real worker incl. bridgeCpp + real hook); shard --shard=i/n for speed
for s in noise vin fda ptdb hil voc; do $R $F/attr.mjs --set=$s --src=$A/trees/final/src --tag=final --out=$A/e2e; done
$R $F/attr.mjs --set=vin --lead=0 --src=$A/trees/final/src --tag=final_L0 --out=$A/e2e
NOTCHVD_ROOT=<...>/build/notchvd-heldout $R $F/attr.mjs --set=noiseho --src=$A/trees/final/src --tag=final --out=$A/e2e
# base (and any display variant): its real hook replayed over those dumps
for s in noise noiseho vin fda ptdb hil voc; do $R $F/replay.mjs --in=$A/e2e/final --out=$A/e2e/base --set=$s --src=$A/trees/base/src; done
$R $F/replay.mjs --in=$A/e2e/final_L0 --out=$A/e2e/base_L0 --set=vin --src=$A/trees/base/src
python $F/evidence.py check --attr=$A/e2e base final --set=noise,noiseho,vin,vinL0,fda,ptdb,voc,hil   # replica parity: 0 mismatches
python $F/shiprule.py --attr=$A/e2e base final                                                         # goal, G1-G4
python $F/bridge-review.py --attr=$A/e2e --base=base final --dot-ends-hidden=final                       # §4.2-§4.6 rows
node --import ./scripts/session-oracle/lib/register.mjs $F/held-painted.mjs --worker=$A/trees/final/src \
  --trees=base=$A/trees/base/src,final=$A/trees/final/src --sr=16000,48000 --out=$A/held.json          # G6 (shard it)
node --import ./scripts/session-oracle/lib/register.mjs $F/held-painted.mjs --suite=lowband --worker=$A/trees/final/src \
  --trees=base=$A/trees/base/src,final=$A/trees/final/src --sr=16000,48000 --out=$A/low.json
python $F/held-painted-agg.py $A/held.json --detail; python $F/held-painted-agg.py $A/low.json --by=f0
$R $F/afterspeech.mjs --worker=$A/trees/final/src --trees=base=$A/trees/base/src,final=$A/trees/final/src --every=1 --out=$A/as.json
python $F/afterspeech.py $A/as.json
$R $F/bridge-rate-check.mjs --worker=$A/trees/final/src --base=$A/trees/base/src --cand=$A/trees/final/src \
  --noise-every=5 --vin-every=5 --out=$A/rate.json
node $F/cpp-vs-f0.mjs; node $F/cpp-vs-f0.mjs --sr=48000                                                 # §4.1
# private (results stay outside this repository): scripts/session-oracle/run.mjs per tree, analyze.py
node tests/audio/bridge-evidence-test.js && node tests/audio/display-hook-test.js && node tests/audio/pitch-paint-gate-test.js
```

Exploration (thresholds, options) used the replica over the base dumps plus
the end-to-end run's DSP columns; every row quoted from it was checked
against a real-hook replay at the chosen points. Worker runs used ≤ 3
concurrent processes.
