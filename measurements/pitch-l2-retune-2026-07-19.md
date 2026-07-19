# Pitch re-tune at the deployed operating point + two structural fixes — 2026-07-19

Follow-up to [boersma-ac-tuning-2026-06-09.md](boersma-ac-tuning-2026-06-09.md).
Motivation: the 2026-06-09 tuning locked `voicingThreshold`/`octaveCost`
**frame-local at the legacy 50–600 Hz range**, and stage C swept
`octaveJumpCost` jointly with L — but production has since moved to
75–400 Hz (2026-06-10) and L=2 (user latency decision), and
`voicedUnvoicedCost`, `peakFloor`, and the display-median length were
never swept at all. This pass re-tunes at the operating point actually
deployed, and separately measures two defects found by code review the
same day.

Harnesses: `scripts/ac-tuning-sweep.js` stages D/E/F (new),
`scripts/pitch-median-window-sweep.js` (new). Scoring conventions
unchanged from 06-09 (per-detector response-center attribution, PTDB
+20 ms ref offset, 5 % correct tolerance, session 80–110 Hz band vs
Praat reference).

## 1. Detector edge defect: top ~5 Hz of the search range decoded octave-DOWN

**Bug (src/dsp/boersma-ac.js, candidate scan):** the local-max scan ran
`for (t = minLag + 1; ...)`, making the lag bin of `maxPitchHz` itself
(lag 40 = 400 Hz at 16 kHz) ineligible as a candidate. Any F0 above
~395 Hz therefore had **no fundamental candidate at all**, and the
always-present 2×-period subharmonic peak won — a *confident,
high-strength octave-down* that the Viterbi tracker cannot rescue
(the correct candidate is never generated) and the silence gate trusts
(confidence ≥ 0.5).

Repro (harmonic-rich tone 0.6/0.3/0.15, production frame length):

| stimulus | pre-fix | post-fix |
|---|---|---|
| 394 Hz | 393.99 ✓ | 393.99 ✓ |
| 395 Hz | 395.00 ✓ | 395.00 ✓ |
| 396 Hz | **198.00 (octave-down, voiced, strength 1.014)** | 396.01 ✓ |
| 398 Hz | **199.00** | 398.01 ✓ |
| 400 Hz | **200.00** | 400.00 ✓ |

Fix: scan from `t = minLag` exactly (`rNorm` is computed for lags
0..maxLag, so the `t-1` neighbor always exists). The existing
`freq > maxPitchHz` check still rejects interpolation overshoot.
Frame-level regression cases added to `tests/dsp/boersma-ac-test.js`
(396/398/400 Hz). The low floor is unaffected by construction (scan end
was not changed); exactly-75.0 Hz still returns null on synthetic tones
(interpolated freq lands fractionally under the floor and is honestly
rejected — a null, not a wrong octave; pre-existing, unchanged).

Corpus impact of the fix (stage E vt0.40 vs stage D prod-baseline, only
delta = the fix): vocadito 95.7→96.2 correct, octave-error 3.3→2.9 —
singing is the one corpus with substantial truth near the 400 Hz
ceiling. All other corpora and the session: identical. Live relevance:
upward glides/sirens near the display ceiling previously drew a
confident line at half the true pitch.

## 2. Stage D — OFAT sweep at the deployed operating point (pre-fix detector)

Production config (= `prod-baseline`): 75–400 Hz, vt 0.40, oc 0.01,
pf 0.15, fl 1536, path {ojc 0.15, vuc 0.20, L 2}. Full grid in
`build/pitch-compare/ac-sweep-D.json`.

| cell | minCorrect | FDA | voc | ptdb | sess band | up | null | flip |
|---|---|---|---|---|---|---|---|---|
| prod-baseline | 63.2 | 85.3 | 95.7 | 88.2 | 93.9 | 4.1 | 0.4 | 3.50 |
| vuc 0.10–0.40 | flat | ±0.3 | flat | ±0.3 | 93.6–93.9 | — | — | 3.4–3.6 |
| ojc 0.08–0.30 | flat | −0.4 | −0.5 | flat | 92.8–93.7 | up w/ lower ojc | — | 3.0–4.0 |
| **vt 0.35** | **63.4** | **86.0** | 95.7 | **89.3** | **94.3** | 4.1 | **0.1** | **3.34** |
| vt 0.45 | 62.9 | 84.3 | 95.7 | 86.9 | 92.7 | 4.3 | 1.6 | 3.67 |
| vt 0.50 | 62.6 | 83.4 | 95.7 | 85.4 | 89.9 | 4.4 | 4.5 | 3.84 |
| pf 0.10/0.20 | flat | flat | flat | flat | 93.9 | — | — | — |
| **fl 1280** | 62.1 | **86.1** | 95.6 | **89.7** | **95.1** | **3.5** | 0.2 | 3.50 |

Findings:

- **vuc, ojc, peakFloor: production values confirmed optimal** (vuc/pf
  flat; ojc 0.15 best on session band — lower ojc raises octave-up,
  higher lowers band correct). These axes are now measured-and-closed at
  L=2.
- **vt is NOT flat at the deployed operating point** (stage A's "flat
  0.30–0.45" was frame-local at 50–600): 0.35 beats 0.40 on *every*
  headline metric. Mechanism: fewer nulls on every corpus (hillenbrand
  5.8→4.9, ptdb 5.4→3.7, FDA 4.2→2.4, session band 0.4→0.1) at
  essentially unchanged octave-error rates — the tracker absorbs the
  extra borderline candidates.
- **fl1280 (80 ms window)** beats fl1536 on session band (+1.2 pp),
  octave-up (−0.6 pp), FDA, PTDB — and shortens window-center
  attribution 48→40 ms — at the cost of +0.9 pp hillenbrand *nulls*
  (the corpus of short isolated vowels). Since vt0.35's main effect is
  cutting nulls, stage F tests the combination.

## 3. Stage E — fine vt grid at fl1536, post-fix detector

(`build/pitch-compare/ac-sweep-E.json`)

| vt | minCorrect | FDA | voc | ptdb | sess band | up | null | flip |
|---|---|---|---|---|---|---|---|---|
| 0.28 | 63.6 | 86.5 | 96.2 | 90.2 | 94.4 | 4.1 | 0.0 | 3.15 |
| 0.30 | 63.5 | 86.3 | 96.2 | 90.1 | 94.3 | 4.1 | 0.0 | 3.19 |
| 0.33 | 63.4 | 86.1 | 96.2 | 89.6 | 94.3 | 4.1 | 0.1 | 3.27 |
| **0.35** | 63.3 | 86.0 | 96.1 | 89.3 | 94.2 | 4.1 | 0.1 | 3.33 |
| 0.37 | 63.3 | 85.8 | 96.2 | 88.9 | 94.2 | 4.1 | 0.1 | 3.40 |
| 0.40 (prod) | 63.2 | 85.3 | 96.2 | 88.2 | 93.9 | 4.1 | 0.4 | 3.50 |

- **Fix impact on the exact production config** (this vt0.40 vs stage D
  prod-baseline, only delta = the minLag fix): vocadito 95.7→96.2
  correct, octave-error 3.3→2.9; every other number identical. Singing
  is the only corpus with substantial truth near the 400 Hz ceiling —
  exactly where the missing top-bin candidate bit. (§1's "no measurable
  corpus impact" prediction was wrong in the right direction.)
- vt improvement is **monotone down to 0.28** on the clean corpora
  (mechanism: nulls → correct; octave errors flat at 2.9 throughout;
  flip *drops* as vt falls). 0.28–0.33 are measurably best here, but the
  corpora and sessions are all clean recordings — the cost of a very low
  voicing threshold (false-voicing on marginal periodic noise) is not
  represented in any current oracle. **Chosen: vt 0.35** — takes most of
  the measured gain (+0.4 band, +0.7 FDA, +1.1 ptdb, band nulls 0.4→0.1,
  flip −0.17 vs 0.40) while staying near the validated region; 0.28–0.33
  is documented headroom pending a real-noise oracle. A synthetic
  false-voicing probe (white noise ± faint 120 Hz hum, 20 trials each)
  shows zero voiced frames at any vt in 0.28–0.40 — the probe bounds the
  clean-noise regime only.

## 4. Stage F — fl × vt interaction, post-fix detector

(`build/pitch-compare/ac-sweep-F.json`)

| cell | minCorrect | FDA | voc | ptdb | sess band | up | null | flip |
|---|---|---|---|---|---|---|---|---|
| fl1280 vt0.33 | 62.3 | 87.2 | 95.9 | 90.9 | 95.4 | 3.4 | 0.0 | 3.31 |
| **fl1280 vt0.35** | 62.3 | 87.0 | 96.0 | 90.7 | **95.4** | **3.4** | 0.1 | 3.38 |
| fl1280 vt0.37 | 62.2 | 86.8 | 96.0 | 90.4 | 95.2 | 3.5 | 0.1 | 3.40 |
| fl1280 vt0.40 | 62.1 | 86.1 | 96.0 | 89.7 | 95.1 | 3.5 | 0.2 | 3.51 |
| fl1408 vt0.35 | 62.6 | 86.8 | 96.2 | 89.9 | 94.8 | 3.7 | 0.1 | 3.35 |
| fl1152 vt0.35 | 61.5 | 87.5 | 95.7 | 91.9 | 95.8 | 3.1 | 0.1 | 3.42 |

fl1280+vt0.35 vs the fl1536+vt0.35 stage-E cell: session band +1.2,
octave-up −0.7, FDA +1.0, PTDB +1.4, vocadito −0.1, hillenbrand −1.0
(and window-center attribution 48→40 ms, −8 ms display latency). fl1152
pushes the same trade further (hillenbrand −1.8, vocadito octave-error
3.5) — 1280 is the knee; 1408 is dominated.

**Gender split** (`scripts/ac-gender-split-probe.js`, new) — the
hillenbrand cost is symmetric and mostly nulls, and the running-speech
gains land on BOTH genders, so the gender-symmetric ship rule is
satisfied:

| corpus/gender | fl1536 vt0.35 | fl1280 vt0.35 | Δ |
|---|---|---|---|
| fda f | 87.4 | 87.8 | +0.4 |
| fda m | 84.4 | 86.1 | +1.7 |
| ptdb f | 94.2 | 95.0 | +0.8 |
| ptdb m | 84.5 | 86.4 | +1.9 |
| hillenbrand w | 63.0 | 62.0 | −1.0 (null +0.6, other +0.3) |
| hillenbrand m | 63.7 | 62.7 | −1.0 (null +0.9, other +0.1) |
| vocadito | 96.1 | 96.0 | −0.1 |

Hillenbrand is isolated 2–3 s vowel clips — the least production-like
corpus (Syrinx use is running speech, as are FDA/PTDB/the sessions) and
everyone's noise floor (SwiftF0 61.8 in the 06-09 shootout). Accepted
trade.

## 5. Held-out session validation

Stage H trio (`AC_SESSION_ONLY=1 AC_SESSION_WAV=…`), 80–110 Hz band —
recordings that took no part in any tuning decision:

| recording | pre (fl1536 vt0.40) | fl1536 vt0.35 | fl1280 vt0.35 |
|---|---|---|---|
| 2026-05-07 audit slice | 94.4 (up 1.2, null 3.7) | 97.3 (up 1.2, null 0.7) | **98.3 (up 1.0, null 0.0)** |
| 2025-09-08 session | 97.6 (up 0.3, null 0.8) | 98.1 (up 0.4, null 0.3) | **98.6 (up 0.3, null 0.3)** |

Both steps replicate out of sample; the window change is not an
overfit to the 05-26 session.

## 6. Display median: 5 → 3 (pitchSmoothing.js)

The 5-frame median predates the path tracker — it was sized for
pYIN/SwiftF0-era raw detector output hitting the main thread. Since the
2026-06-09 cutover the L=2 bounded-Viterbi tracker already suppresses
single-frame octave flips *before* the main thread sees them, so the
median's job shrank to residual outliers. `scripts/pitch-median-window-
sweep.js` reconstructs the exact production display chain (decoded
tracker output → median-K → paint gate) and scores it against the Praat
references at each chain's own best alignment (so added median lag can't
masquerade as accuracy loss):

**2026-05-26 session (tuning target, 53 min):**

| K | best-fit display lag | band 80–110 @5% | overall @5% | flip % | painted spikes |
|---|---|---|---|---|---|
| 1 | 100 ms | 96.5 | 88.4 | 0.32 | 16 |
| **3** | **125 ms** | **95.8** | **87.4** | 0.24 | **1** |
| 5 (prod) | 150 ms | 93.6 | 84.9 | 0.18 | 6 |

**Held-out 2026-05-07 audit slice (5 min):** K=1 98.4 / K=3 97.8 /
K=5 97.7 (band); spikes 4 / 0 / 0; lag 100 / 125 / 150 ms.

**Held-out 2025-09-08 session (30 min):** K=1 98.8 / K=3 97.8 /
K=5 95.8 (band); spikes 10 / 1 / 1; lag 100 / 125 / 137.5 ms.

Consistent across all three recordings: **the median-5 is now *costing*
1.4–2.2 pp of displayed band accuracy** (it lags and blurs a contour the
tracker already cleaned) plus 25 ms of display latency vs K=3. K=1 is
most accurate but paints 4–16 isolated spikes per recording and doubles
the flip rate; K=3 keeps within 0.6–1.0 pp of K=1 while suppressing
spikes *better than the production K=5* (1/0/1 vs 6/0/1).

**Decision: `PITCH_SMOOTH_LEN` 5 → 3.** Contract change documented in
`tests/audio/pitch-smoothing-test.js`: a 2-frame outlier now reaches the
smoothed output (at K=3 two of three slots outvote); that duty belongs
to the tracker (which suppresses 1-frame flips upstream) and the paint
gate (which suppresses octave-class excursions at painting). The
measured spike counts above show the display does not regress.

## 7. Deployed-config change summary

Changes shipped by this pass (all in one branch, `pitch-l2-retune`):

1. **minLag candidate-scan fix** (boersma-ac.js) — top-edge 396–400 Hz
   octave-down eliminated; vocadito +0.5 correct.
2. **voicingThreshold 0.40 → 0.35** (boersma-ac.js) — nulls convert to
   correct on every corpus + session; octave errors and flip flat.
3. **frameLength 1536 → 1280** (BOERSMA_FRAME_LENGTH_16K) — session
   band +1.2, octave-up −0.7, FDA/PTDB up for both genders, −8 ms
   attribution; −1.0 hillenbrand accepted (symmetric, mostly nulls).
4. **Display median 5 → 3** (pitchSmoothing.js) — the tracker made the
   long median redundant; K=3 recovers accuracy the median was eating
   and −25 ms display lag, with spike suppression ≥ K=5.

Confirmed optimal and unchanged: octaveCost 0.01, peakFloor 0.15,
octaveJumpCost 0.15, voicedUnvoicedCost 0.20, L=2, search range 75–400.

**End-to-end display chain** (decoded → median → paint gate, scored at
best alignment; `pitch-median-window-sweep.js` re-run at the final
detector config):

| recording | OLD chain (fl1536 vt0.40 K=5, pre-fix) | NEW chain (fl1280 vt0.35 K=3, fix) |
|---|---|---|
| 2026-05-26 band@5% / lag / spikes | 93.6 / 150 ms / 6 | **96.3 / 112.5 ms / 0** |
| 2026-05-07 band@5% / lag / spikes | 97.7 / 150 ms / 0 | **98.2 / 112.5 ms / 0** |
| 2025-09-08 band@5% / lag / spikes | 95.8 / 137.5 ms / 1 | **97.9 / 112.5 ms / 2** |

Displayed band accuracy +0.5 to +2.7 pp, displayed attribution
~150 → ~112 ms (−25 ms median + −8 ms window center + alignment
rounding), painted spikes flat-or-better. Worker-level display latency
~98 → ~90 ms (40 ms window center + 50 ms L=2 decode).

Flip% on the displayed series rises slightly (e.g. 09-08: 0.07 → 0.16)
— the trade for the shorter median; absolute rates remain far below the
raw-decode ~3.4 and the painted-spike counts (the user-visible artifact)
do not regress.

## Reproduction

```
node scripts/ac-tuning-sweep.js D build/pitch-compare/ac-sweep-D.json
node scripts/ac-tuning-sweep.js E build/pitch-compare/ac-sweep-E.json   # post-fix
node scripts/ac-tuning-sweep.js F build/pitch-compare/ac-sweep-F.json   # post-fix
AC_SESSION_WAV=<wav-from-praat-contours> AC_SESSION_ONLY=1 \
  node scripts/ac-tuning-sweep.js E                                     # held-out
node scripts/pitch-median-window-sweep.js [--wav=PATH]
node tests/dsp/boersma-ac-test.js
```
