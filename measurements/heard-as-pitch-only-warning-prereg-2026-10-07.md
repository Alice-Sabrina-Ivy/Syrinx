# Pre-registration — live "pitch-only change" warning for the heard-as panel

Written 2026-10-07, **before any candidate rule was evaluated on any data**. At the time of
writing, the only chain output that exists is one smoke session (LibriSpeech reader 1089,
natural, used to check that the harness runs); no rule has been computed on it or on anything
else. The prior numbers quoted below (conflict note at |u_F0 − u| 0.5 / 1.0 on LibriSpeech)
come from the previous round's measurement note, not from this study.

Code under test: branch `cue-strip` @ 370d107 (source snapshot in `snap/`). Harness:
`session.mjs` (real pitch worker; the gender worker's window schedule with `decideMlWindow` and
the real utterance gate; the deployed q8-v2 classifier; `heard-as.js` aggregator and
`estimate()`; the resonance worker path = lab engine "frames" mode + gated `resonanceCue.js`).
Every 2 s of audio (the panel's update cadence) a tick records the panel estimate (or its hide
reason) and the resonance cue snapshot; posted pitch frames and scored windows are stored so
every rule below is evaluated offline from causal inputs only (nothing after the tick).
Public data only.

## 1. Sessions

| Set | Material | Sessions | Phases |
|---|---|---|---|
| `nat` | LibriSpeech test-clean, all 40 readers (20 W, 20 M), natural | 40 | one phase, first ≥ 180 s of the reader's utterances in corpus order (0.25 s gaps) |
| `ptdb` | PTDB-TUG mic, F01 F02 M01 M02, natural | 4 | one phase, all local sentences |
| `hcs` | Hillenbrand & Clark 2009 manipulations on LibriSpeech test-clean (sentence proxy), 40 readers | 160 | base: first ≥ 50 s natural (7.2 kHz low-pass); shift: next ≥ 40 s, WORLD, conditions US (vocoder control), PO (pitch only), PE (pitch + envelope), EO (envelope only); men up (F0 × 1.7041, envelope × 1.168), women down (inverse) |
| `picka` | PICKA grid (Jebens/VTServer pyworld transform) on the 20 test-clean women | 140 | base: first ≥ 50 s natural; shift: next ≥ 40 s at cells (ΔF0 st, ΔVTL st) (0,0) control, (−6,0) (−12,0) pitch only, (−6,+1.8) (−12,+3.6) together, (0,+1.8) (0,+3.6) resonance only |
| `hcc` | H&C syllable concatenations (existing rebuilt audio), 20 men + 20 women (lowest ids with all conditions) | 120 | base: the talker's US concat looped to ≥ 50 s (0.4 s gaps); shift: US / PO / PE concat looped to ≥ 40 s |
| `rb` | RB695 TTS (CC BY 4.0 listener data) | 5 | Google male lowered → raised (+3.6 st); Sophie +1 st → −1 st (Study 2 × 2 scripts, Study 5 × 2 scripts); each file looped (0.5 s gaps) |

Skuk F0-only continuum: **not built** — single 0.5 s syllables (out of the panel's scope), and
the documented form-A errors on every F0-only level are ≤ 5 points (CALIBRATION.md §4), so no
Skuk F0-only item can enter the failure set (§4) by its definition.

**Dev / test split** (fixed now): within each sex, speakers sorted numerically (LibriSpeech ids)
or by id (H&C talkers); even positions = dev, odd = test. `rb` and `ptdb` are test only.

## 2. Live inputs (all causal, all computable in the app)

- **Tick**: every 2 s of audio. **Panel visible**: `estimate()` not hidden.
- **Resonance**: u = cue readout (5 s voiced, gated), R0 = `startU` (shipped: median of the
  readouts over the first 12 s of admitted voiced speech after the readout fills).
- **Start window** = audio interval [t_fill, t_start]: from the first tick with fill ≥ 1 to the
  first tick with `startU` set (the interval the cue collected its start in).
- **Pitch start** P0 = ln median of posted voiced F0 frames inside the start window.
- **Meter start** M0 = mean logit of the scored windows whose end lies inside the start window.
- **Pitch now**: P8 = the panel's own ln F0 (8 s aggregate, `estimate().lnF0`) [primary];
  P5v = ln median of the last 200 posted voiced frames (≈ the last 5 s of voiced pitch, matched
  to the resonance readout's 5 s voiced horizon) [variant].
- ΔP_st = 12·(P − P0)/ln 2; ΔP_u = (P − P0)/0.4451 (pitch change in units of the typical
  man-to-woman speaking-F0 spacing, the panel's u_F0 scale); ΔR = u − R0.
- M = the panel's meter logit (8 s mean).
- **Eligible tick**: panel visible AND R0 known AND u known AND resonance fill ≥ 1 AND resonance
  verdict ≠ "sustained" AND sinceResumeS ≥ 2.

## 3. Candidate rules (all reported)

Condition evaluated at each eligible tick; the **warning is on** at tick i iff the condition
holds at the last K eligible ticks (i included, consecutive ticks, no ineligible tick between).

- **(a) change since start**: |ΔP_st| ≥ X AND |ΔR| ≤ Y.
  X ∈ {3, 4, 5, 6} st, Y ∈ {0.3, 0.45, 0.6} u, pitch ∈ {P8, P5v}, K ∈ {1, 2}.
- **(d) pitch excess** (pitch moved further than resonance in the pitch's direction):
  |ΔP_u| ≥ Xu AND sgn(ΔP_u)·(ΔP_u − ΔR) ≥ T.
  Xu ∈ {0.4, 0.5, 0.65, 0.8}, T ∈ {0.4, 0.55, 0.7, 0.85}, pitch ∈ {P8, P5v}, K ∈ {1, 2}.
- **(b) estimate attribution**: Δη_F = −3.53735·(P8 − P0), Δη_M = −0.34910·(M − M0);
  |Δη_F| ≥ A AND sgn(Δη_F)·Δη_M ≤ B·|Δη_F|.
  A ∈ {1.0, 1.5, 2.0, 2.5} logit, B ∈ {0, 0.25, 0.5}, K ∈ {1, 2}.
- **(c) position disagreement** (the shipped conflict-note signal):
  |u_F0 − u| > C with u_F0 = (P8 − 4.8035)/0.4451.
  C ∈ {0.5, 0.75, 1.0, 1.25}, K ∈ {1, 2, 3}. (C 1.0, K 1 = the shipped note.)

## 4. Outcomes

**Failure set.** Pitch-only sessions: `hcs` PO, `hcc` PO, `picka` (−6,0) and (−12,0), all `rb`.
A session is a *failure* when the panel's shifted-phase estimate — the median of the central
two-way share s over visible ticks with t ≥ t_shift + 10 s — differs from the listener two-way
share (man + unsure/2) by ≥ 20 points in either direction. Sessions with fewer than 3 such
visible ticks are excluded (nothing shown to be wrong). Listener references:
H&C sentences (Exp 1, TIMIT; transfer by condition): MPO 65.7, WPO 19.1 (PE 18.1 / 82.1,
EO 81.1 / 11.7, US 99.6 / 0.4). H&C syllables (Exp 2): MPO 43.7, WPO 68.2 (PE 18.3 / 92.3,
US 97.5 / 3.0). PICKA cells: **Meyer 2023** (mean of the two digitised interfaces; the fit
source, CC BY) primary — (−6,0) 6.3, (−12,0) 54.8; Jebens 2022 (26.0 / 65.1) and Nagels 2020
(6.7 / 45.0) as sensitivity. RB695: Google raised 83.5 + 11.9/2 = 89.5; Sophie −1 st Study 2
38.2 + 28.5/2 = 52.4, Study 5 58.9 + 23.3/2 = 70.6. The direction of each failure (panel shows
too little "man" = optimistic for a raised male voice; too much "man" for a lowered female
voice; or the reverse = pessimistic) is recorded.

**Hit** (primary): the warning is on at ≥ 1 eligible tick with t_shift < t ≤ t_shift + 10 s
("within ~8 s" plus one 2 s update), AND it was off at the last eligible tick before the shift.
Also reported: hit within 8 s, time to first warning, persistence (share of eligible ticks with
t ≥ t_shift + 10 s on which it is shown).

**False alarm (natural speech)**: per reader, share of eligible ticks with the warning on;
averaged over readers within each sex (reader-balanced). Also reported: share over all
panel-visible ticks, per-reader max, `ptdb`, and the baseline phase of every shift session.

**Expressive set** (selected before any rule is evaluated, from the `nat` pitch frames only):
the 5 women and 5 men of `nat` with the widest spread of posted voiced F0 (q90 − q10 in st over
the whole stream). (No spoken expressive public corpus with long same-speaker streams is
available locally; vocadito is singing.)

## 5. The bar (a rule ships only if ALL hold on the TEST split)

1. **Hits** ≥ 60 % of failure sessions, **separately** for male-base (pitch raised) and
   female-base (pitch lowered) failure sessions (gender symmetry). If a direction has fewer
   than 5 failure sessions in the test split, that direction is judged on dev + test pooled
   and the fact reported.
2. **Natural false alarms** ≤ 5 % of eligible ticks, women and men separately (`nat` test readers).
3. **Expressive false alarms** ≤ 10 %, women and men separately (expressive readers, dev + test
   pooled — 10 readers are too few to split).
4. *(Added by this pre-registration — a warning that says pitch moved more than resonance must
   not fire when both moved.)* **Together shifts** (`hcs` PE, `hcc` PE, `picka` (−6,+1.8) and
   (−12,+3.6)): ≤ 15 % of eligible ticks with t ≥ t_shift + 10 s, per base sex.
5. *(Added.)* **Resonance-only shifts** (`hcs` EO, `picka` (0,+1.8), (0,+3.6)): ≤ 10 % of
   eligible ticks with t ≥ t_shift + 10 s, per base sex.

**Selection.** All configurations are evaluated on the DEV split. Among configurations that
pass all five criteria on dev, the one with the highest min(hit rate male-base, hit rate
female-base) is chosen (ties: lowest max(natural FA women, men), then simplest family in the
order a, d, c, b). That single configuration is then evaluated once on TEST; it ships iff it
passes all five criteria there. If no configuration passes on dev, nothing ships; the best
configuration per family (by the same ordering, ignoring failed criteria) is reported on
dev and test so the gap is visible. Every configuration's full-data numbers are also reported.

## 6. If it ships — what is specified

Inputs, thresholds, K, eligibility exactly as above for the chosen configuration; it shows in
the panel's `extraNote` slot (under the axis, only while the estimate is shown), clears when
the condition fails. Default wording (same words in every direction):
"Your pitch has moved a lot more than your resonance since you started — in published tests,
listeners heard less change than this shows when only pitch changed."
That direction claim ("less change") is used only if ≥ 80 % of the failure sessions the rule
catches are optimistic-direction failures; otherwise the wording is direction-neutral
("… — this guess can be far off, in either direction, when only pitch changes").
Unit tests to specify: eligibility gates, K-consecutive logic, start-window references, symmetry
(mirror inputs in both directions give mirrored decisions), no firing before R0 / P0 exist,
clearing.
