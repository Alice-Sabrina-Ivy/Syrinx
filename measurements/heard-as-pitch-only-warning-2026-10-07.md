# "Likely heard as": a live warning when pitch moved without resonance — 2026-10-07

> **Update 2026-10-07 (§8.2):** on fresh speakers (LibriSpeech test-other)
> the shipped rule catches only **0.59 (male base) / 0.65 (female base)** of
> pitch-only shifts within 10 s, below the pre-registered 0.85 bar, and an
> expressive reader can see it on up to 17.5 % of updates depending on where
> the session starts. "Passes" below applies to the round-1/2 data only. The
> panel's "More" list says it does not catch every case.
>
> **Update 2026-10-08 (§8.3):** the post-hoc steadier start reference D2-0.1
> failed its pre-registered confirmation on 66 fresh LibriSpeech
> train-other-500 readers (2 of 10 checks), so the shipped rule S0 is kept.
>
> **Update 2026-10-11 (§8.4):** a pre-registered fix for men's false alarms
> (A40+KP8-3+DS10: a start reference that grows for 40 s, a reader-variability
> threshold and a panel-moved gate), chosen on a dev split where it passed all
> 15 checks, failed its single held-out test evaluation (11 of 15; men's
> reader max 23.8 %, worst start 33.3 %, one early-shift hit lost, gap
> 1.73 pp), so S0 is kept.
>
> **Update 2026-10-12 (§8.5):** round 2 of that study, at the app's 0.2 s
> resonance cadence and with a drift-stratified split, again picked
> A40+KP8-3+DS10 (no candidate passed all 15 dev checks). On the held-out
> test it removed nearly all false alarms (natural FA men 3.39 → 0.27 %,
> women 0.33 → 0 %) but warned later on real pitch-only shifts and failed
> 2 of 15 checks (male-base hits −0.036, female-base early-shift hits
> −0.050), so S0 is kept. The panel's "More" list now says the note can
> appear for voices whose pitch varies a lot, more often men's.
>
> **Update 2026-10-12 (§8.6): adopted by user override.** The user adopted
> A40+KP8-3+DS10 despite §8.5's two narrow hit misses (male-base hits
> 0.863 vs 0.898, −0.036 against −0.03; female-base early-shift hits 0.863
> vs 0.913, −0.050): it brings men's natural false alarms from 3.39 to
> 0.27 % (women 0.33 → 0 %) at the cost of some warnings arriving a few
> seconds later. The recorded verdict stays FAIL; the panel's "More" list
> gives the adopted rule's test figures. A review addendum (§8.6) records a
> gap the study did not cover: the adopted rule cannot warn for the rest of
> a session whose start window had no shown panel estimate (panel off,
> still loading or hidden then); S0 could.
>
> **Update 2026-10-12 / 2026-10-13 (§8.7, §8.8): late switch-on.** Two
> pre-registered fallbacks for a panel switched on after the start window
> failed their fresh-pool tests, 29 of 30 checks each. §8.7's F4-Q5 missed
> men's hits within 10 s with the panel switched on at ~120 s (0.853 vs bar
> 0.867). §8.8's KS-Q5 (F4-Q5 plus KP8's quiet history seeded from the
> posted pitch) passed every hit check but one man's natural false alarms
> at ~120 s were 16.76 % (limit 15 %). The shipped rule and the panel's
> "More" line are unchanged; KS-Q5's numbers are in §8.8 for a user
> decision.
>
> **Update 2026-10-13 (§8.9): KS-Q5 adopted by user decision,** overriding
> §8.8's recorded FAIL (the one failed check: that man's 16.76 % at ~120 s;
> post hoc, not pre-registered: the shipped rule with the panel on from the
> start gives him 18.57 % over the same span), together with a bound on the
> pitch frames the module keeps while the panel is off. §8.9 lists what
> changes and the acceptance requirements; it was committed before the code
> change. The code change met every requirement (§8.9, results): with the
> panel on from the start the warning is the shipped rule tick for tick (0
> mismatches on 1,596,129 recorded updates), on every late panel it is the
> study harness's KS-Q5 (0 mismatches on 975,519), and the module keeps at
> most 7,522 pitch frames (about 74 KB after an hour with the panel off,
> against 7.1 MB before). The panel's "More" list now says it can be turned
> on at any time. A review then found that the 180 s start cap counts
> silence: a pause of about 3 minutes after the cue fills ends the warning
> for the session, also with the panel on from the start. The fix (a cap on
> voiced frames, §8.9 "Review fixes") was stopped before the code change,
> because one pre-committed check cannot hold with it; it awaits a user
> decision. Decided the same day (§8.9, "Decisions 2026-10-13"): the
> voiced-frame cap is adopted, with that check run at 15 s instead of
> 30 s, and the review's three wording changes to the panel's "More" text
> are applied. That part, with the requirements for the code change, was
> committed before the code change. The code change then met every
> requirement (results at the end of §8.9): 0 mismatches on every recorded
> stream as before, the review's 200 s-pause case warns at 306 s as the
> shipped module does, and the module keeps at most 7,521 pitch frames.
> Review round 3 found no fault in the code (§8.9, "Review notes, round
> 3"). The docs now say that the voiced-frame cap is the one exception to
> "tick for tick" with the panel on from the start, and that the 7,521
> bound is for the production 25 ms frame spacing. A test of the built app
> showed that the late line's "another tab" holds for the app's own tabs
> but not for a different browser tab; that wording, and "first few
> seconds of listening", await a user decision.

The experimental, opt-in "Likely heard as" panel follows pitch more than
listeners do. When a voice changes pitch without changing resonance, the panel
shows a bigger change than listeners hear, in either direction (known failure
1 in `heard-as-calibration-2026-10-07.md` §6). Until now only the
always-visible caveat disclosed this. The conflict note (|u_F0 − u| > 1) rarely
fires in the documented cases, and a threshold low enough to catch them
(0.5) fires on 47 % of men's and 8 % of women's ordinary live readings.

The user asked (2026-10-07) to try a live warning based on change since the
session's start, and to keep the caveat as the only disclosure if no rule
works. This note records:

- the pre-registered study;
- its result (a rule **passes** on the round-1/2 data; it did not replicate at
  the 0.85 bar on fresh speakers, §8.2);
- the flagged deviations (K = 2, §5; the hold through brief panel hides,
  §6 — review round 2);
- the wording (since review round 2 the pre-registered direction-neutral
  sentence, §4);
- how the app implements it.

Public data only: LibriSpeech test-clean (CC BY 4.0) and resyntheses of it,
PTDB-TUG, the Hillenbrand & Clark 2009 syllable concatenations rebuilt from
the Hillenbrand et al. 1995 recordings, ResearchBox 695 TTS stimuli, and
the PICKA voice grid applied to LibriSpeech. Listener references are
published condition rates (Hillenbrand & Clark 2009; Meyer 2023, CC BY;
Jebens 2022 and Nagels 2020 as sensitivity checks; RB695, CC BY 4.0). No
private recordings were used.

## 1. Pre-registration

[`heard-as-pitch-only-warning-prereg-2026-10-07.md`](heard-as-pitch-only-warning-prereg-2026-10-07.md)
is the pre-registration, copied verbatim. It was written at 13:22 and hashed
before any candidate rule was computed on any data: sha256
`4c429161546071fac45b9ade99620f9fe8745445299d14233fdf0acbd14d38f3`, the
same as the committed blob. Its paths `snap/` and `CALIBRATION.md` refer to
the study's working folder. It fixes:

- the sessions and the dev/test split;
- the causal inputs;
- four rule families with a 148-configuration grid:
  - (a) change since start;
  - (d) pitch excess;
  - (b) estimate attribution;
  - (c) position disagreement, i.e. the shipped conflict note;
- the failure-set definition;
- the five-criterion bar;
- a mechanical selection rule: best min(hit rate) among configurations that
  pass on dev, then one evaluation on test;
- the default wording and the condition for its direction claim.

**The bar.** All five criteria had to hold on TEST:

1. Hits ≥ 60 % of failure sessions, separately for male-base and
   female-base sessions.
2. Natural false alarms ≤ 5 %, women and men separately.
3. Expressive readers ≤ 10 %, women and men separately.
4. Together shifts ≤ 15 % of eligible updates from shift + 10 s.
5. Resonance-only shifts ≤ 10 % of eligible updates from shift + 10 s.

## 2. Sessions and chain

469 simulated sessions ran through the production chain at branch
`cue-strip` @ 370d107:

- the real pitch worker;
- the gender worker's window schedule, with the real utterance gate and the
  deployed q8-v2 classifier;
- `heard-as.js` `estimate()`;
- the resonance worker path: the lab engine in "frames" mode plus the gated
  `resonanceCue.js`.

A tick every 2 s of audio, the panel's cadence, records the panel estimate
(or why it is hidden) and the resonance snapshot.

Each shift session is about 50 s of natural speech, then about 40 s
shifted. The sets:

| Set | Material | Sessions |
|---|---|---|
| nat | 40 LibriSpeech test-clean readers (20 W, 20 M), ≥ 180 s natural | 40 |
| ptdb | PTDB-TUG F01 F02 M01 M02, natural | 4 |
| hcs | Hillenbrand & Clark sentence proxy (WORLD resynthesis) on 40 LibriSpeech readers: vocoder control, pitch only, pitch + envelope, envelope only. Men shifted up, women down (F0 × 1.7041, envelope × 1.168) | 160 |
| picka | PICKA grid on the 20 women: (0,0), (−6,0), (−12,0), (−6,+1.8), (−12,+3.6), (0,+1.8), (0,+3.6) (ΔF0, ΔVTL in st) | 140 |
| hcc | H&C syllable concatenations, 20 men + 20 women: control, pitch only, pitch + envelope | 120 |
| rb | RB695 TTS: Google male lowered → raised; Sophie +1 → −1 st (4 scripts) | 5 |

**Failure set.** A pitch-only session counts as a failure when the panel's
shifted-phase estimate differs from the listeners' two-way share by
≥ 20 points. There are 72, with the Meyer reference for PICKA:

- male base: 19 (H&C sentence 11, H&C concatenation 7, RB695 Google 1);
- female base: 53 (H&C sentence 18, H&C concatenation 12, PICKA 23);
- direction: 60 optimistic (the panel shows more change than listeners
  heard) and 12 pessimistic. All 12 pessimistic ones are female-voice H&C
  syllable concatenations.

Median panel error in the shifted phase, in points:

| Condition | Error |
|---|---|
| H&C sentence pitch only, men raised | −22.9 |
| H&C sentence pitch only, women lowered | +41.9 |
| PICKA (−6,0) | +29.7 |
| PICKA (−12,0) | +18.3 |
| H&C concatenation, men raised | −14.3 |
| H&C concatenation, women lowered | −27.7 |
| RB695 Google | −62.5 |

## 3. Result: rule (a) passes

On dev, 84 of the 148 configurations passed all five criteria. The mechanical
choice was **rule (a): |12·(P8 − P0)/ln 2| ≥ 4 st AND |u − startU| ≤ 0.6 u,
K = 1**. Here:

- P8 is the panel's own ln F0 (`estimate().lnF0`).
- P0 is the ln median of the posted voiced pitch over the resonance cue's
  start window.

Evaluated once on test, it passed every criterion:

| | Dev | TEST | All data |
|---|---|---|---|
| Hits, male base | 8/8 | 10/11 (0.91) | 18/19 |
| Hits, female base | 23/23 | 30/30 (1.00) | 53/53 |
| Natural false alarms W / M | 1.3 / 2.0 % | 1.8 / 0.4 % | 1.5 / 1.2 % |
| Expressive readers W / M (dev + test) | | 3.8 / 4.7 % | |
| Together shifts W / M (from shift + 10 s) | 2.5 / 0.3 % | 4.7 / 0 % | 3.6 / 0.1 % |
| Resonance-only shifts W / M | 0 / 0 % | 3.2 / 0 % | 1.6 / 0 % |
| Vocoder-only controls W / M | 0 / 1.1 % | 2.7 / 0.6 % | 1.3 / 0.8 % |
| Baseline phase of shift sessions W / M | 0.7 / 0 % | 0.6 / 0 % | 0.7 / 0 % |
| PTDB-TUG (12 eligible updates W, 2 M — too few to count) | 0 % | 0 % | 0 % |

**The one miss.** The RB695 Google male TTS was raised by 4.0 st, but the
resonance cue read a change of 1.72 u. The pitch change was read as a
resonance change, so the condition |Δu| ≤ 0.6 is false.

**PTDB-TUG** contributes almost nothing: over ~21 min of audio its short
sentences gave 12 eligible updates for the two women and 2 for the two men
(none for M02), so its "0 %" is not evidence. The natural-speech checks are
the LibriSpeech readers above, FDA and the fresh LibriSpeech dev-clean set in
§5.

**Timing (K = 1).** The first warning came a median 6 s after a pitch-only
shift (q90 8 s, max 10 s). Once on, it stayed on for 95 % / 97 % of later
updates (male / female base).

**Natural reading.** Readers who ever saw the warning: 6 of 20 women and 4 of
20 men, with 24 warning episodes in 128 min of reading. The per-reader
maximum was 11.9 % for a woman and 13.2 % for a man; these are the two
readers with the widest F0 spread.

**Sensitivity to the PICKA listener reference.** With Jebens the hits are
18/19 and 37/37; with Nagels, 18/19 and 58/58.

**Other families** (best dev configuration, TEST hits male / female base):

| Family | Best configuration | TEST hits M / F | Verdict |
|---|---|---|---|
| (d) pitch excess | Xu 0.5, T 0.4, P5v | 0.91 / 1.00 | Passes, but one man's natural reading warns on 38 % of updates |
| (b) η attribution | — | 0.45 / 0.70 | Fails |
| (c) position disagreement | best C 1.25 | 0.55 / 0.63 | Fails; fires on 40–54 % of resonance-only updates |

**The shipped conflict note** (c, C 1.0, K 1), all data:

- hits 0.68 (male base) / 0.62 (female base);
- natural false alarms 0.2 % (women) / 8.9 % (men);
- expressive men 17.5 %;
- fires on 66 % / 64 % of resonance-only updates.

It is kept unchanged. Whether to drop or rethink it is a separate decision.

## 4. Wording

The pre-registration allows the direction claim ("listeners heard less
change") only if ≥ 80 % of the failure sessions the rule catches are
optimistic. Pooled they are **83 %** (59 of 71); with the Jebens reference
78 %. **Split by base sex** (review round 2; the house rule asks for error
rates by sex):

| Caught failures that are optimistic | Meyer reference | Jebens reference |
|---|---|---|
| Male base (pitch raised) | 18 / 18 (100 %) | 18 / 18 (100 %) |
| Female base (pitch lowered) | 41 / 53 (77 %) | 25 / 37 (68 %) |

Every pessimistic case is a lowered female voice (the H&C syllable
concatenations): for a user lowering pitch the claim "listeners heard less
change" is wrong in about 1 caught case in 4. (The first version of this note
called those 12 sessions "outside the panel's scope because it hides on
single words". That was wrong: a session counts as a failure only if it had
at least 3 shown updates after the shift, so the panel did show estimates on
them.)

So the pooled bar was met but the claim does not hold for both directions.
Since review round 2 the app shows the **pre-registered direction-neutral
wording**, the same in every direction:

> Your pitch has moved a lot more than your resonance since you started —
> this guess can be far off, in either direction, when only pitch changes.

It names no direction or target and has no percent sign. It also refers to
the guess in general, not to "this" reading: about 80–90 % of the warning's
appearances in the built app came while the axis said "Can't tell yet", where
"less change than this shows" read as a contradiction (review round 2,
built-app timelines). Screen readers get the same sentence. **Historical
(superseded 2026-10-07, review round 2):** "… — in published tests, listeners
usually heard less change than this shows when only pitch changed."

## 5. Deviation, flagged: K = 2 instead of K = 1

This deviation is post hoc and was not pre-registered. Right after a
**together** shift (pitch and resonance both moved), K = 1 briefly flashes
the warning:

- in 44 % of together sessions;
- on 11 % of the updates in the first 10 s.

The 8 s pitch median moves about 4 s before the 5 s resonance readout catches
up. Pre-registered criterion 4 scored together shifts only from shift + 10 s,
so it could not see this.

**K = 2** shows the warning only when the condition holds on 2 consecutive
eligible updates (about 2–4 s). K = 2 is in the pre-registered grid and
passes **every criterion on both dev and test**:

| X 4, Y 0.6, P8, K = 2 (chosen after the test split was seen: its TEST column is a post-selection look, not an untouched check) | Dev | TEST (post-selection) | All data |
|---|---|---|---|
| Hits, male / female base | 0.88 / 0.78 | 0.91 / 0.90 | 0.89 / 0.85 |
| Natural false alarms W / M | 0.4 / 1.1 % | 1.0 / 0 % | 0.7 / 0.5 % |
| Expressive W / M | | 1.9 / 2.1 % | |
| Together W / M (from shift + 10 s) | 1.3 / 0 % | 3.5 / 0 % | 2.4 / 0 % |
| Resonance-only W / M | 0 / 0 % | 2.2 / 0 % | 1.1 / 0 % |
| Per-reader maximum, natural W / M | | | 7.1 / 6.6 % |

What K = 2 changes:

- The flash right after a together shift falls from 44 % to 9 % of sessions
  (on-share in the first 10 s: 11 % → 2 %).
- Hits within 10 s fall from 0.95 / 1.00 to 0.89 / 0.85. Within 14 s they
  are 0.95 / 0.96.
- First warning: median 7 s (q90 8 s) for male base, 8 s (q90 10 s) for
  female base. One female-base session took 34 s.
- Natural reading: 11 episodes in 128 min (24 with K = 1). 4 of 20 women and
  2 of 20 men ever see the warning.

**Out-of-sample check for K = 2 (false alarms only).** Review round 2 ran
fresh public speech the study never used — LibriSpeech dev-clean, 20 women
and 20 men, ~190 s each, plus FDA rl / sb — through the same production-chain
harness and the shipped module: natural false alarms **0.77 % women / 1.07 %
men** (reader-balanced; K = 1: 1.30 / 1.67 %), FDA 0 / 0 % (49 eligible
updates each). That is independent support for K = 2's false-alarm rate, not
for its hit rate (that would need new pitch-only material). **But the worst
fresh readers are well above the study's worst (7.1 % W / 6.6 % M):** dev
reader 251 (a man) saw the warning on **21.4 %** of eligible updates (18 of
84; K = 1: 31 %), dev reader 3081 (a woman) on **10.3 %** (6 of 58). Reader
251's start window fell on an expressive passage (median 170.8 Hz against his
session median 140.8 Hz, +3.35 st), so his ordinary reading near 120–130 Hz
sat ≥ 4 st from P0 while resonance did not move. Any user whose first ~15 s
are not at their usual pitch can see a persistent false warning — §7. With
the hold through brief hides (§6) the same fresh set gives **0.94 % women /
1.07 % men** (worst 13.8 % — reader 3081, 8 of 58 instead of 6 — / 21.4 %);
no other reader changes.

**The app ships K = 2** (`PITCH_ONLY_WARNING.consecutive`). A brief false
warning right after the user changes pitch and resonance together, which is
the change this tool coaches, would undermine the warning. K = 3 would remove
that flash entirely, but hits within 10 s for female base fall to 0.55.

## 6. Implementation

The logic is in `src/ml/pitch-only-warning.js`, a pure module.

**Inputs.**

- `addPitch` receives every posted pitch frame (never painted or held
  values). It is fed by `useAudioPipeline` whether or not the panel is on, so
  the pitch reference exists when the panel is turned on later. (Since
  2026-10-12 that is not enough: the adopted rule's DS10 gate also needs a
  start share, which only shown panel updates in the start window give — a
  panel turned on after that window never warns in that session; §8.6
  addendum.)
- `noteResonance` receives every resonance-cue state message, stamped with the
  audio clock.
- `update` runs at each panel update, with the panel's `estimate().lnF0`
  (null while the panel is hidden) and the latest snapshot.

**Pitch start P0.**

- P0 is the ln median of the posted voiced frames between the first snapshot
  with fill ≥ 1 and the first snapshot with `startU` set.
- With fewer than 20 voiced frames, P0 is null and there is no warning.
- P0 is frozen once a later frame arrives.

**Eligible update.** All of these must hold:

- the panel shows an estimate;
- `startU`, `u` and P0 are known;
- fill ≥ 1;
- verdict ≠ "sustained";
- `sinceResumeS` ≥ 2.

**Showing and clearing.** The warning shows after K = 2 consecutive shown
updates that are both eligible and meet the condition. It clears on the first
shown update that fails either.

**Brief panel hides (flagged post-hoc deviation, review round 2).** Until
review round 2 a hidden-panel update ("Keep talking", "stale", …; lnF0 null)
counted as ineligible and reset the run, so each time the panel came back the
estimate the warning qualifies showed for ≥ 2 s without it: in the built app
7–24 % of the shown estimates from shift + 10 s on had no warning. Now a
hidden update is **neutral**: nothing is shown, the run is kept, and the
warning is back at once if the first shown update still meets the condition;
more than 5 hidden updates in a row (~10 s) drop the run
(`PITCH_ONLY_WARNING.maxHiddenUpdates`). A shown update that is ineligible on
the resonance side or fails the condition still clears it. This was not
pre-registered. Replayed on the study's 469 sessions
(`rules.display(hold=True)`; heard-as-panel-review-2-2026-10-07.md §2): shown
estimates in failure sessions after shift + 10 s that carry the warning
**0.91 / 0.92 → 0.95 / 0.96** (male / female base; worst female session
0.33 → 0.53); every criterion number in §3 and §5 — hits, natural, expressive,
together, resonance-only, PTDB, the together flash — is unchanged on dev,
test and all data.

**Resets.**

| Event | Effect |
|---|---|
| Resonance worker backs off (overload) or its `startU` returns to null | P0 and the run are dropped |
| Panel switched off and on | Only the run is dropped |
| Stop / start listening | Everything is dropped |

**Display (since review round 2).** The warning renders directly under the
axis (`[data-heard-as-note="pitch-only"]`, `data-pitch-only="1"`), before the
range and unsure lines, only while the estimate is shown — so it is on the
first screen wherever the axis is. At most one note shows: while the warning
is on, the conflict note and any `extraNote` are left out. Screen readers get
it through a live region that stays mounted while the panel is on
(`[data-heard-as-live]`, `role="status"`, polite, atomic), filled when the
warning switches on and kept through brief hides. **Historical (superseded
2026-10-07, review round 2):** the `extraNote` slot under the range lines,
alongside the conflict note, with `role="status"` on the note itself (a live
region mounted already filled is often not announced).

**Live vs study.** Small differences:

- The start-window bounds are the arrival times of the worker's state
  messages (every 0.2 s of audio) instead of the study's 2 s ticks.
- At the update where `startU` first appears, P0 uses the frames received so
  far (the study used all frames up to that tick).
- The panel's 2 s timer runs on the wall clock, and switching the panel on
  runs one extra update.

None of these changes the rule.

**Tests** (`tests/ml/pitch-only-warning-test.js`, picked up by CI):

- no warning before the references exist;
- how P0 is computed: voiced frames only, the 20-frame minimum, frames after
  `startU` ignored, posted values only;
- threshold boundaries: 4.00 st with 0.60 u fires; 3.99 st or 0.61 u does
  not;
- mirror symmetry;
- the K-run, including restarts after ineligible updates;
- clearing, and the hold through brief hides (on → hidden → shown keeps it;
  more than 5 hidden updates drop it; a resonance-side ineligible update still
  clears it);
- every reset;
- the panel wiring (slot under the axis, one note at a time, the
  always-mounted live region, a resonance worker error dropping the stale
  snapshot);
- a **golden replay** of 8 public sessions
  (`tests/ml/fixtures/pitch-only-golden.json`; LibriSpeech and H&C sentence
  proxies only, no NC material).

The golden replay checks that the module reproduces the study's own Python
rule (`rules.condition`) tick for tick, for both K = 1 and K = 2, and checks
P0 against the Python value to 1e-12. Its sessions:

- a man raised and a woman lowered, pitch only: the warning comes on within
  10 s and persists;
- one together session per sex: K = 1 flashes and K = 2 does not;
- one resonance-only session per sex: never on;
- one natural reader per sex: on for ≤ 5 % of eligible updates;
- (review round 2) one pitch-only session per sex with brief hides while the
  warning is on (hcs_260_PO man, hcs_2961_PO woman), where the hold differs
  from reset-on-hide; the fixture's rule is now the shipped one
  (`hold: true, maxHidden: 5`).

`scripts/cue-strip-smoke.mjs --pitch-only=man,woman` plays a pitch-only
session through the built app and checks that the note appears in the panel
after the shift and not before, directly under the axis, as the only note,
mirrored in the live region, on the first screen (448×890, 1280×800;
elsewhere wherever the axis is), and on ≥ 80 % of the shown estimates in the
next 20 s.

## 7. Limits

- **Relative to the session start only.** A user who starts in an already
  pitch-shifted voice gets no warning. The caveat still covers this case.
- **The start reference is one ~15 s window, so it depends on where the
  session starts** (review round 2). Four expressive public readers replayed
  through the production chain with the start moved by skipping their first
  0, 1, 2, 3 or 5 utterances (shipped module, K = 2 with the hold; share of
  eligible updates with the warning on natural reading):

  | Reader | Shares over the 5 starts | P0 vs the reader's session median |
  |---|---|---|
  | LibriSpeech test-clean 672 (man, character voices) | 6.6 / 9.6 / 23.5 / 61.3 / 45.5 % | −2.8 … +1.8 st |
  | LibriSpeech dev-clean 251 (man) | 21.4 / 4.9 / 12.5 / 18.2 / 10.3 % | −1.6 … +3.4 st |
  | LibriSpeech dev-clean 3081 (woman) | 13.8 / 0 / 11.5 / 33.3 / 0 % | −1.7 … +3.5 st |
  | LibriSpeech test-clean 3575 (woman) | 0 / 0 / 0 / 0 / 0 % | −0.3 st every time |

  So for a lively, wide-ranging speaker the warning can appear on a large
  share of ordinary speech, for women and men alike, and how often depends on
  the first ~15 s. The study's per-reader figures (one pass per session, max
  7.1 / 6.6 %) do not show this spread. A steadier start reference (a longer
  window, or no warning when the start window's own pitch spread is wide)
  would need its own pre-registered study. It was run on 2026-10-07, and no
  reference passed (§8.2).
- **A brief false warning right after pitch and resonance change together
  can still show for some voices.** In the built app, a man's (LibriSpeech
  260) pitch-and-resonance shift showed it for 1–4 s about 6 s after the
  shift in 3 of 5 runs (always with the conflict note, before review round 2
  suppressed that note while the warning shows; the note was removed
  altogether on 2026-10-07, §8.1); the woman's never did.
  Consistent with the study's 9 % of together sessions, but speaker-dependent.
  Gating on the resonance readout having caught up was suggested and not
  tried (it needs its own check on the together set).
- **Pitch read as resonance.** It cannot see a pitch change that the
  resonance reading mistakes for a resonance change (the RB695 Google miss).
- **Partial resonance change.** Changes of 0.6–1.2 u in resonance alongside a
  large pitch move do not warn.
- **Test material.** The failure data are 6–12 st step shifts from
  resynthesis or TTS, not gradual real-trainee changes. Expressive natural
  readers can see the warning (K = 2: at most 7.1 % of one reader's updates).
- **No new CPU.** It is arithmetic on outputs the app already computes, so it
  adds no worker cost. Panel-on CPU: `heard-as-cpu-2026-10-07.md`.

## 8. Follow-ups, 2026-10-07 (integration)

### 8.1 Conflict note removed (user decision E)

The pitch–resonance conflict note (|u_F0 − u| > 1, "opposite" / "apart") was
removed from the panel, from `src/ml/heard-as.js` (`conflictNote`,
`CONFLICT_U`, `U_F0`) and from the tests. The pitch-only warning is now the
panel's only built-in note. Its rule, wording and display are unchanged.

### 8.2 A steadier start reference — pre-registered study, nothing passed; the shipped rule is kept

§7 noted that the start reference P0 comes from one ~15 s window, so the
false-alarm share for a lively speaker depends on where the session starts.
The user asked for a pre-registered study of a steadier reference (decision
G). The pre-registration is reproduced verbatim in Appendix A
(sha256 `7c53fcd5b4e2c38f41ba92a4c9b2eb769a025f28fd5624692d37e096298d6838`).
It was hashed in scratch before any rule was evaluated. The dev selection
(`selection.json`, sha256 `4183d454…`) was recorded before any test number
was computed.

**Data.** LibriSpeech dev-other (dev, 16 W / 17 M) and test-other (test,
17 W / 16 M), CC BY 4.0. Neither set was used in rounds 1–2. 908 sessions
went through the `cue-strip` chain with the adopted 450 ms classifier hop.
The Python rule reproduces the shipped JS module bit-exact on all 416 dev
sessions (23,875 ticks, 0 differences). Full per-configuration tables:
[heard-as-steady-start-dev-2026-10-07.csv](heard-as-steady-start-dev-2026-10-07.csv),
[heard-as-steady-start-test-2026-10-07.csv](heard-as-steady-start-test-2026-10-07.csv).

**Result: no configuration passed on dev, so none was selected or tested
"once".** The only criterion that fails for every configuration is
criterion 1 (hits ≥ 0.85 per base sex within 10 s), and the shipped rule S0
fails it too. No change to the start reference moves the hit rates, because
the misses are not caused by the reference. As pre-registered, the test split
only describes S0 and the best dev configuration of each family.

| | hits male / female base (≤ 10 s) | natural FA W / M | per-reader max W / M | worst start, expressive readers W / M | together W / M |
|---|---|---|---|---|---|
| S0, dev | 0.79 / 0.96 | 0.1 / 0.7 % | 1.3 / 5.3 % | 7.7 / 7.4 % | 6.3 / 1.1 % |
| S0, test | **0.59 / 0.65** | 0.2 / 0.2 % | 2.7 / 3.9 % | 3.7 / **17.5 %** | 8.3 / 0.4 % |
| D2-0.1 (post hoc), dev | 0.79 / 0.96 | 0.0 / 0.0 % | 0 / 0 % | 0 / 1.5 % | 5.7 / 1.1 % |
| D2-0.1 (post hoc), test | 0.59 / 0.65 | 0.1 / 0.0 % | 1.3 / 0 % | 1.4 / 0 % | 8.0 / 0.4 % |
| A60, test | 0.59 / 0.65 | 0.1 / 0.2 % | 1.3 / 3.9 % | 2.6 / 3.9 % | 7.9 / 0.4 % |

- **The shipped rule's round-2 hit rate does not replicate on new speakers.**
  Test-other gives 0.59 / 0.65, against 0.91 / 0.90 in round 2. The 450 ms
  hop is not the cause: rerunning the 99 test pitch-only sessions at the old
  150 ms hop gives the same hits (10 / 17 male base, 15 / 22 female base).
  With the Jebens and Nagels listener references, test S0 hits are
  0.59 / 0.71 and 0.59 / 0.67.
- **S0 also fails the start-offset bar on test.** One expressive man
  (test-other reader 1688) gets 0 / 0 / 14.1 / 17.5 / 8.9 % over his five
  starts.
- **Why S0 misses** (descriptive, post hoc, dev and test misses):
  1. The panel is hidden ("short") for 4–10 s right after the shift.
  2. The pitch detector reads the resynthesised shifted voice an octave off,
     so the measured shift is under 4 st. For example, a man raised ×1.7 was
     read 3.7 st lower, and a PICKA −12 st cell was read +2.9 st.
  3. The resonance reading had already drifted more than 0.6 u from its
     start.
  4. Only one shown update met the condition within 10 s.
- **Best reference seen, post hoc and flagged:** D2-0.1, a slowly tracking
  start. P0 starts as the shipped value. After each shown, eligible update
  (after that update's decision), if |ΔP| < 4 st, then
  P0 ← P0 + 0.1·(ln F0 − P0). It removes most start-dependent false alarms
  (reader 1688: 17.5 → 0 %) at the same hits. It was picked after the test
  numbers were seen, so it needs a fresh confirmation before it could ship.
- Other families on test: A30 gives no gain (worst man 20.5 %). A45 gives a
  worst start of 5.9 / 9.0 %. A60-wait drops hits to 0.00 / 0.04, because its
  window overlaps the shift. B (median of phrase medians, shipped window) is
  unstable: one test man's false alarms go from 0 % to 89.5 %. B-A60 gives
  0.65 / 0.65 hits and a worst start of 6.2 / 3.9 %. C (suppress after a
  variable start) brings false alarms near 0 but drops hits to 0.06–0.59 at
  every threshold. E-K3 gives 0.41 / 0.43 hits, E-K4 0.18 / 0.09. D1 (adapt
  only while pitch and resonance move together) does nothing for
  start-offset false alarms.

**Decision.** Nothing passed, so `src/ml/pitch-only-warning.js` keeps the
shipped rule (S0) unchanged. What remains open needs its own study, because
the start reference cannot fix it:
- the hit rate on fresh speakers;
- the panel hiding right after a shift;
- octave misreads of shifted voices;
- resonance drift before the shift.

Adopting D2-0.1 would need a fresh confirmation set and a measurement note
before any code change (hard rule 3). The tests it would need are listed in
the study's result record.

### 8.3 D2-0.1 on fresh speakers — pre-registered confirmation FAILED; S0 kept (2026-10-08)

User decision 3 (2026-10-08): confirm D2-0.1 on recordings no Syrinx study
has used, and ship it only if it passes. The pre-registration is reproduced
verbatim in Appendix B (sha256
`73850d11694d78c93bd3bc8c89639114ffda6f71d0328ae7aa4e5704ef83fa45`,
recorded in scratch at 2026-10-08T03:38:15-05:00, before any chain output on
this data and before either rule was evaluated on it). The bar is fixed
there: 10 checks (2 sexes × 5), all required.

**Data.** LibriSpeech train-other-500 (CC BY 4.0), Hugging Face parquet copy
`openslr/librispeech_asr`, shards 0000–0005 (108 speakers). 42 speakers
whose id appears anywhere in earlier Syrinx study material were excluded
(deliberately over-inclusive). Mechanical selection: ≥ 330 s of audio, first
33 per sex by speaker id — **33 women, 33 men**, 856 sessions (66 `nat`,
64 `off`, 528 `hcs`, 198 `picka`). Chain: `cue-strip` @ adf19c3 (speech
detector in the gender worker, V200 voiced-window rule, 450 ms classifier
hop), driven by the steady study's harness plus the Silero detector fed as
the gender worker feeds it; `evaluate.py` byte-identical to the steady
study's. A JS version of D2-0.1 in `pitch-only-warning.js` (scratch only,
not committed) matches the Python rule on all 50,150 ticks for both rules,
so the result is the rule's, not the implementation's.

**Verdict: FAIL — 2 of 10 checks fail.**

| Check (per sex) | Bar | Women: S0 → D2-0.1 | Men: S0 → D2-0.1 |
|---|---|---|---|
| 1. Worst start, every expressive reader | ≤ 15 % | 2.6 → 1.3 % ✓ | 74.7 → **30.3 %** ✗ (reader 6652) |
| 2. Natural false alarms (reader-balanced) | ≤ 2 % | 0.46 → 0.22 % ✓ | 4.06 → 1.79 % ✓ |
| 3. Hits ≤ 10 s, Meyer reference (female base / male base) | ≥ S0 − 0.05 | 0.862 → **0.800** ✗ (bar 0.8115; n = 65) | 0.833 → 0.806 ✓ (bar 0.783; n = 36) |
| 4a. Together false alarms | ≤ S0 + 2 pp | 2.32 → 2.15 % ✓ | 1.18 → 1.18 % ✓ |
| 4b. Resonance-only false alarms | ≤ S0 + 2 pp | 0 → 0 % ✓ | 0 → 0 % ✓ |

Row 3 is by base voice (female base = pitch lowered, male base = pitch
raised); the other rows are by reader sex. S0 against the same bar, as a
description: it fails check 1 for men (74.7 %) and check 2 for men (4.06 %).

Full table, S0 → D2-0.1 (male base / female base, or women / men):

| | S0 | D2-0.1 |
|---|---|---|
| Hits ≤ 10 s, Meyer (primary) | 0.833 / 0.862 | 0.806 / 0.800 |
| Hits ≤ 10 s, Jebens (n 36 / 52) | 0.833 / 0.885 | 0.806 / 0.827 |
| Hits ≤ 10 s, Nagels (n 36 / 75) | 0.833 / 0.867 | 0.806 / 0.813 |
| Hits ≤ 14 s | 0.861 / 0.954 | 0.861 / 0.923 |
| Median time to first warning | 6.4 / 8.0 s | 6.6 / 8.4 s |
| Persistence | 0.937 / 0.944 | 0.937 / 0.902 |
| Natural FA, women / men | 0.46 / 4.06 % | 0.22 / 1.79 % |
| Per-reader max natural FA, women / men | 7.9 % (3479) / 54.0 % (6652) | 3.6 % (3179) / 30.3 % (6652) |
| Worst start, expressive readers, max W / M | 2.6 / 74.7 % | 1.3 / 30.3 % |
| Worst start, expressive readers, mean W / M | 0.63 / 15.9 % | 0.16 / 6.0 % |
| Together W / M | 2.32 / 1.18 % | 2.15 / 1.18 % |
| Resonance only W / M | 0 / 0 % | 0 / 0 % |
| Vocoder control W / M | 0.62 / 3.08 % | 0.07 / 1.57 % |
| Flash after a together shift W / M | 15.9 / 31.8 % | 12.9 / 25.8 % |
| FA in the baseline phase of shift sessions W / M | 0.41 / 0.87 % | 0.41 / 0.50 % |

Expressive readers (chosen from posted pitch only, before either rule ran),
false-alarm share at starts k = 0, 1, 2, 3, 5:

| Reader | S0 | D2-0.1 |
|---|---|---|
| M 6652 | 53.9, 39.0, 14.3, 61.7, 74.7 | 30.3, 19.5, 11.7, 8.6, 10.8 |
| M 6482 | 20.0, 24.7, 24.0, 19.2, 5.2 | 9.3, 11.0, 9.3, 3.8, 5.2 |
| M 7009 | 7.3, 6.4, 3.7, 2.4, 14.0 | 1.2, 2.6, 1.2, 1.2, 1.2 |
| M 3238 | 3.7, 4.2, 4.2, 12.0, 4.1 | 3.7, 4.2, 2.8, 2.7, 4.1 |
| M 4172 | 1.8, 0, 0, 0, 0 | 0, 0, 0, 0, 0 |
| M 8413, 5152, 8033 | 0 at every start | 0 at every start |
| W 7514 | 1.2, 0, 0, 2.5, 0 | 1.2, 1.2, 1.3, 1.2, 0 |
| W 4959 | 2.6, 0, 0, 1.2, 1.2 | 0, 0, 0, 0, 0 |
| W 6853, 6943, 7387, 7255, 7250, 5233 | 0 at every start | 0 at every start |

**Post hoc, descriptive only (not part of the bar):**
- *Why female-base hits drop.* When the pitch moves gradually through the
  first 4 st after the shift, the tracking reference follows it for a tick or
  two, delaying the first warning by about 2 s — past the 10 s hit window.
  Three of the lost sessions are PICKA (−6, 0); in one H&C PO session the
  reference had drifted −1.9 st before the shift and the warning came about
  10 s later.
- *Why reader 6652 still fails.* About 20 % of his posted frames lie more than
  6 st above his median, and his start reference lands anywhere from −4.3 to
  +5.4 st from his session median depending on the start. Tracking at 0.1
  roughly halves his false alarms but does not bring them under 15 %.
- *S0's hits here (0.83 / 0.86)* are well above the test-other replication's
  0.59 / 0.65 (§8.2). This run does not separate whether the chain (speech
  detector, V200) or the data explains the difference; the panel text
  ("on new voices it missed about 4 in 10") stays, as the conservative
  figure.
- *S0 on this data* would itself fail the men's natural-false-alarm bar
  (4.06 %, driven by readers 6652 and 6482): a very expressive man can see the
  warning on most updates (6652: 14–75 % depending on the start). This
  extends §7's limit; it is not addressed here.

**Decision.** D2-0.1 is not shipped. `src/ml/pitch-only-warning.js`,
`PITCH_ONLY_WARNING` and the golden replay fixture are unchanged; nothing
was re-tuned on this data. Every artefact (pre-registration, speaker lists,
session outputs, `verdict.json`, `tables.md`, the JS draft and its parity
check) stays in the study's scratch folder; only this summary is committed.

### 8.4 Men's false alarms — diagnosis, pre-registered selection, confirmation FAILED; S0 kept (2026-10-11)

User decision (2026-10-11): study why S0 gives men far more natural false
alarms than women (§8.3: 4.06 % vs 0.46 %, one reader 54 %, expressive
readers' worst start 74.7 % vs ≤ 2.6 %) and look for a fix that keeps hits
for both base sexes. Public data only (LibriSpeech, Multilingual LibriSpeech
German, both CC BY 4.0); no private recordings.

**Diagnosis — exploratory, post hoc, on already-seen data** (the §8.3
confirmation and the §8.2 steady-start sessions, 324 natural-reading
sessions, 476 S0 false-alarm ticks; candidates and parameters were picked
after seeing it, so its candidate numbers are optimistic and are not
evidence for any rule):
- Octave errors in the posted pitch are not the cause. Replacing posted
  frames that are ≥ 6 st off a Praat CC / AC / pYIN consensus removes 1.2 %
  of men's false-alarm time (women 6 %); men's posted octave-up rate is
  0.95 % vs women's 0.85 %.
- About 72 % of men's false-alarm time is the start reference (the ~20 s
  start span sits away from the reader's typical pitch while the trailing
  8 s is typical), another 16 % is start and a real excursion together, and
  11–27 % is genuine wide intonation (the 8 s median really is ≥ 4 st from
  the reader's typical pitch, confirmed by pYIN — the warning's literal
  claim is then true).
- It is male-skewed because men's passage-level pitch wanders more in
  semitones (SD of 20 s block medians 0.70 vs 0.56 st, Mann–Whitney
  p = 0.004), mostly upward, so men's start spans are atypical more often
  (≥ 2 st from the session median: 9.3 % vs 0.6 % of starts). The false
  alarms are concentrated: one reader (6652) is 45 % of men's false-alarm
  time, the top five 81 %. The resonance gate does not explain the skew.
- No frozen reference brings 6652 under 15 % (hindsight-best frozen P0:
  15.8 %); only a reader-variability threshold (KP8-3) did, at a cost in
  borderline hits. The diagnosis flagged that a growing reference (A40) was
  untested against a shift in its first ~50 s; the study below added an
  early-shift set for that.

**Pre-registration.** Reproduced verbatim in Appendix C (sha256
`6f86c692adc8888c711ca1f5e9b815a78845fc41cd934e3c3af9a8c26c683e8f`), written
before any chain output on its speakers and before any candidate was
evaluated on them; `study.py` refuses to run unless the 15 file hashes it
lists match. Chain: `cue-strip` @ 53704cc (no chain change since the §8.3
run's adf19c3), the §8.3 harness (header and one error message differ),
`evaluate.py` and `features.py` byte-identical to §8.3's. Candidates: 17
rules = {S0, A40, CUMg} references × {—, KP8-2.5, KP8-3} thresholds ×
{—, DS10} panel gate, minus S0 alone, where

| Part | Rule |
|---|---|
| A40 | P0 = ln median of posted voiced frames over [t_fill, max(t_start, min(t, t_fill + 40 s))] — grows, then frozen |
| CUMg | P0 = median of a pool that starts as S0's start frames and adds the frames of later shown, eligible ticks with \|ΔP\| < 4 st (never fed during an excursion) |
| KP8-k | X = max(4 st, k × RMS of the earlier quiet shown ticks' ΔP) once ≥ 5 such ticks exist, else 4 st |
| DS10 | also require the panel's shown share to have moved ≥ 10 points from its start-span median |

The bar: 15 checks, per sex against S0 on the same sessions — natural FA
≤ 2 % each sex and |men − women| ≤ 1.5 pp; per-reader maximum ≤ 15 %; every
expressive reader's worst start (k = 0, 1, 2, 3, 5 utterances skipped)
≤ 15 %; hits within 10 s (Meyer) ≥ S0 − 0.03 per base sex; early-shift hits
(new `ehcs` set: the shift lands at ~36 s, while A40 is still growing)
≥ S0 − 0.03 per base sex; together and resonance-only FA ≤ S0 + 2 pp.
Selection on a dev split, then **one** test evaluation; FAIL keeps S0.

**Data.** 100 speakers no earlier Syrinx study used (82 of 208 downloaded
candidates excluded by an over-inclusive id scan), selected mechanically
from metadata: LibriSpeech train-other-500 shards 0006–0009 and
train-clean-360 shards 0000–0003 (alternating dev / test by speaker id) and
MLS German (its own dev / test partitions). Dev 26 F / 26 M (784 sessions),
test 24 F / 24 M (720 sessions).

**Dev selection** (`CHOICE.md`, reproduced verbatim in Appendix D, sha256
`aedd7c46af52008d9cf4212576b9a9767b8bf8ef1e1d4666a2343742b9b2855a`, created
and hashed 2026-10-11 19:08:22 −05:00, before any test-split session audio,
job or chain output existed — the earliest test session audio file is from
19:08:53; the test speakers' source files had been extracted at 17:38, see
"Corrections after review" below). 15 of the 17 candidates passed all 15
dev checks (A40 and A40+KP8-2.5 failed the women's reader-max and
worst-start checks); by the §6 order **A40+KP8-3+DS10** was chosen (dev:
men's worst start 53.0 → 8.4 %, women's 41.8 → 7.3 %, natural FA
0.6 → 0.2 % each sex, hits and early hits unchanged). S0 itself passed 13
of 15 on dev: dev men's natural FA was only 0.6 % and the per-reader
maximum 6.0 %, so the male problem the study targets appeared on dev mainly
as one expressive reader's late start (mls5595 at k = 5, 53 %), which every
A40 / KP8 / DS candidate removed.

**Test verdict: FAIL — 11 of 15 checks** (run once, 2026-10-11 19:26–20:25
−05:00, all 720 sessions, no errors). Chosen rule vs S0 on the same
sessions:

| Check | Bar | Women: chosen | Women: S0 | Men: chosen | Men: S0 |
|---|---|---|---|---|---|
| Natural FA (reader-balanced) | ≤ 2 % | 0.05 % ✓ | 0.48 % | 1.79 % ✓ | 2.50 % |
| Gap \|men − women\| | ≤ 1.5 pp | | | **1.73 pp ✗** | 2.02 pp |
| Per-reader natural-FA max | ≤ 15 % | 1.3 % (ls8300) ✓ | 9.0 % (ls5740) | **23.8 % (ls5304) ✗** | 27.4 % (ls5304) |
| Expressive readers' worst start | ≤ 15 % | 1.3 % (ls8300) ✓ | 3.5 % (ls3675) | **33.3 % (ls6368) ✗** | 37.3 % (ls6368) |
| Hits ≤ 10 s, Meyer (by base sex) | ≥ S0 − 0.03 | 0.745 (41/55) ✓ | 0.764 (42/55) | 0.852 (23/27) ✓ | 0.852 |
| Early-shift hits (by base sex) | ≥ S0 − 0.03 | 0.941 (16/17) ✓ | 0.941 | **0.833 (10/12) ✗** | 0.917 (11/12) |
| Together FA | ≤ S0 + 2 pp | 5.1 % ✓ | 5.3 % | 0.6 % ✓ | 0.6 % |
| Resonance-only FA | ≤ S0 + 2 pp | 0.0 % ✓ | 0.1 % | 0.0 % ✓ | 0.0 % |

Hit rows are by base voice (female base = pitch lowered, male base = pitch
raised); the other rows by reader sex. With 12 male-base early-shift
sessions, one lost hit is −0.083, so check 5 forbids any net loss. S0
against the same absolute bars (descriptive) also passes 11 of 15: it fails
men's natural FA (2.50 %), the gap, and men's reader max and worst start.

Full table, test split (male base / female base for hit rows, men / women
otherwise):

| | S0 | A40+KP8-3+DS10 |
|---|---|---|
| Hits ≤ 10 s, Meyer (n 27 / 55) | 0.852 / 0.764 | 0.852 / 0.745 |
| Hits ≤ 10 s, Jebens | 0.852 / 0.822 | 0.852 / 0.800 |
| Hits ≤ 10 s, Nagels | 0.852 / 0.746 | 0.852 / 0.729 |
| Hits ≤ 14 s | 0.926 / 0.909 | 0.926 / 0.909 |
| Early-shift hits (n 12 / 17) | 0.917 / 0.941 | 0.833 / 0.941 |
| Median time to first warning | 6.97 / 8.03 s | 6.61 / 8.07 s |
| Persistence | 0.949 / 0.920 | 0.932 / 0.908 |
| Natural FA, men / women | 2.50 / 0.48 % | 1.79 / 0.05 % |
| Per-reader max, men / women | 27.4 % (ls5304) / 9.0 % (ls5740) | 23.8 % (ls5304) / 1.3 % (ls8300) |
| Worst start, max, men / women | 37.3 / 3.5 % | 33.3 / 1.3 % |
| Worst start, mean, men / women | 9.0 / 1.2 % | 7.6 / 0.2 % |
| Together, men / women | 0.6 / 5.3 % | 0.6 / 5.1 % |
| Resonance only, men / women | 0.0 / 0.1 % | 0.0 / 0.0 % |
| Vocoder control, men / women | 1.4 / 0.4 % | 0.8 / 0.0 % |
| Early-shift together, men / women | 1.6 / 4.4 % | 1.6 / 4.4 % |
| Flash after a together shift, men / women | 22.9 / 16.7 % | 20.8 / 16.7 % |
| FA in the baseline phase of shift sessions | 0 / 0 % | 0 / 0 % |

Expressive readers (test: chosen from the real pitch worker's posted pitch
alone, after the choice), false-alarm share at starts k = 0, 1, 2, 3, 5:

| Reader | S0 | Chosen |
|---|---|---|
| M ls6368 | 9.2, 17.1, 18.7, 31.6, 37.3 | 9.2, 17.1, 18.7, 29.1, 33.3 |
| M ls4420 | 9.9, 12.0, 11.0, 8.4, 10.4 | 9.9, 12.0, 9.8, 7.2, 10.4 |
| M mls3052 | 0, 2.3, 4.5, 4.1, 0 | 0 at every start |
| M ls5767, ls6506, ls5183 | 0 at every start | 0 at every start |
| W ls8300 | 2.5, 0, 0, 0, 0 | 1.3, 0, 0, 0, 0 |
| W ls4443 | 0, 0, 1.2, 0, 0 | 0 at every start |
| W ls3675 | 0, 0, 0, 0, 3.5 | 0 at every start |
| W ls8414, ls5588, ls3513 | 0 at every start | 0 at every start |

Natural FA by corpus (S0 → chosen): men train-clean-360 3.04 → 2.65 %,
train-other-500 2.39 → 2.39 %, MLS German 1.93 → 0.00 %; women
1.28 → 0.14 %, 0 → 0 %, 0 → 0 %. Readers above 2 % under either rule:
men ls5304 27.4 → 23.8 % (not an expressive reader), ls4420 9.9 → 9.9 %,
ls6368 9.2 → 9.2 %, mls4911 13.5 → 0 %; women ls5740 9.0 → 0 %, ls8300
2.5 → 1.3 %.

**Why it failed (descriptive, after the verdict; nothing was re-tuned):**
- *The dev split did not exercise the male false alarms.* On dev S0 already
  met men's natural-FA and reader-max bars (0.6 %, 6.0 %); the only dev
  male failure was one late start, which a growing or variability-aware
  reference fixes. On test, men's false alarms came back at the §8.3 level
  of disparity (S0 2.50 vs 0.48 %), mostly from three LibriSpeech readers
  whose false alarms the chosen rule leaves nearly unchanged.
- *Those readers do not look like a start-reference problem.* ls4420 sees
  the warning on 7–12 % of updates from every start, and ls6368 already on
  9.2 % from the first start — closer to the diagnosis' "genuine wide
  intonation" share than to its dominant start-offset share, which A40
  targets. ls6368's false alarms rise with later starts under both rules
  (k = 5: 37.3 / 33.3 %). The rule removed most women's false alarms
  (0.48 → 0.05 %) and MLS German men's (1.93 → 0 %), so the gap between the
  sexes barely narrowed (2.02 → 1.73 pp).
- *Early-shift hit lost* (ehcs_ls6368_PO, male base, shift at 38.0 s): S0
  warns from 46 s; A40 alone and KP8-3 alone each still warn, but together
  never — the growing reference absorbs part of the shift while the
  expressive reader's history raises the threshold. This is the risk the
  diagnosis flagged for A40 and the reason the `ehcs` set was added.
- *Female-base hit lost* (hcs_ls5740B_PO, shift at 58.3 s): A40 delays the
  first warning to 11.7 s after the shift, just outside the 10 s window
  (S0: at 9.7 s). Within the −0.03 tolerance.

**Implementation check (scratch only, not committed).** A JS version of the
chosen rule in a copy of `src/ml/pitch-only-warning.js` matches the study's
Python rule tick for tick on all 1,504 dev + test sessions (85,648 ticks, 0
mismatches; S0 likewise) with frames replayed by audio time, the study's
information set, and with the resonance state fed at the study's 2 s panel
updates (production feeds it every 0.2 s — see "Corrections after review"). With frames delayed 50 ms as they arrive live, 1 tick in 1
non-failure-set session differs (the Python A40 used frames ≤ 50 ms not yet
posted at the tick), changing no outcome. An independent recomputation of
every bar outcome from the JS module's output reproduces the numbers above.
The verdict is therefore the rule's, not the implementation's.

**Decision.** A40+KP8-3+DS10 is not shipped, and the DS10 product question
does not arise. `src/ml/pitch-only-warning.js`, `PITCH_ONLY_WARNING`, its
tests, the golden replay fixture and the panel text are unchanged; S0 stays.
The male false-alarm disparity on expressive male readers (§7, §8.3) remains
a known limit: on this test split S0's natural false alarms are 2.50 % for
men vs 0.48 % for women, one man 27.4 %. Every artefact (speaker pool, session
outputs, dev table, diagnosis, verdict, the JS draft and its parity check)
stays in the study's scratch folder; only this summary and the two verbatim
files in Appendices C and D are committed.

**Corrections after review (2026-10-11, after the verdict; the verdict is
unchanged).** An independent review re-checked the hashes, the file times,
the speaker pools and every bar number (all reproduced), and found:
- *Update cadence of the replay.* The harness (`session.mjs`) reads the
  resonance state only at the 2 s panel updates, and every replay (the study's
  Python rules, `evaluate.py`, the JS parity check) passes it to
  `noteResonance` only then. In production the resonance worker posts every
  0.2 s of audio and `useAudioPipeline` calls `noteResonance` on each post,
  so the start-collection span (t_fill, t_start) can end up to ~2 s earlier
  live; the panel's extra `HIDE_CHECK_MS` updates are not emulated either.
  On 24 test sessions picked by the reviewer (mostly the expressive readers,
  the readers above 2 % and the shift sessions behind the lost hits) re-run through the full chain with the shipped module
  fed at the live 0.2 s cadence, the chain output was identical and 5 of
  1,944 ticks differed, in 3 sessions: natural FA ls5304 27.4 → 29.8 %,
  mls4911 13.5 → 16.2 %, ls6368 (k = 3) 31.6 → 29.1 %; every shift hit was
  unchanged. So the per-reader false-alarm numbers in §8.2–8.4 are those of
  the 2 s replay and can move by about 2–3 pp per reader live, and "tick for
  tick" above holds for the replay, not for the live cadence. S0 is kept
  either way (live it is, if anything, slightly worse for men).
- *Dev could not test the fix.* On dev, S0 already met men's natural-FA and
  reader-max bars, so 15 of 17 candidates passed and the choice came down to
  the tie-break order. With ~25 readers per sex the reader-max and
  worst-start checks hang on one or two readers, so whether a split happens
  to contain an atypical man decides the outcome. The pre-registration had
  no rule for this.
- *Test source audio existed at registration.* The pre-registration
  (Appendix C) says "No test-split audio or job exists", but the test
  speakers' source files had been extracted from the downloaded shards at
  17:38, 15 minutes before it was hashed (17:53:04). No test session audio,
  job, posted pitch or analysis existed before the choice: the pool
  inventory used durations only, the dev expressive readers came from dev
  outputs only, and the first test chain output is from 19:23, after
  `CHOICE.md` (19:08:22). An inaccurate statement, not a leak.
- *Hashes anchored only in scratch.* `PREREG.sha256` and `CHOICE.sha256`
  sit next to the files they hash; the first record outside the scratch
  folder is commit 317243f, after the test run. File times agree with the
  stated order, but nothing external proves it. The harness also loaded
  packages from the worktree's `node_modules`, which the hash list did not
  cover: `@huggingface/transformers` 4.2.0, `onnxruntime-web`
  1.26.0-dev.20260416-b7804b056c (`onnxruntime-common` 1.24.3), voice model
  `onnx/model_quantized.onnx` sha256
  `fdc2dbdcf99b9217977f7472f7d677dd48219c4759ca3f38d0626b600d86c252`; every
  one of these files was last written 2026-10-07, before the study, so the
  other workflows' commits to `cue-strip` during the test run (19:34–19:56)
  did not touch them, and the chain itself came from the hashed `snap/`
  archive. (The Silero model is sha256-checked by the harness against
  `SPEECH_DETECTOR.modelSha256`.)

**Rules for any next round of this study** (from the review; not yet used):
1. Replay at the live cadence: record the resonance snapshot and the audio
   clock at every 0.2 s post in `session.mjs`, feed `noteResonance` at that
   cadence in every replay, and emulate the panel's `HIDE_CHECK_MS` updates.
2. Pre-register a stop condition: if S0 does not fail men's natural-FA or
   reader-max check on dev, stop before the test run and report that dev
   cannot measure the problem.
3. Make dev contain the readers the fix is for: stratify the dev / test
   split by how much each reader's pitch drifts across the reading
   (computed from posted pitch, on dev candidates only, before any rule is
   evaluated), or use larger pools.
4. Anchor the order outside the scratch folder: commit (and push) the
   pre-registration or its sha256 before any chain output, and the choice
   before any test session audio is built; list extracted source audio
   separately from session audio; add the package versions and the model
   sha256 to the hash list.

### 8.5 Men's false alarms, round 2 — app-cadence harness, drift-stratified split, confirmation FAILED; S0 kept (2026-10-12)

User decision (2026-10-11): run the §8.4 study again under the three rules
its review set (live cadence, a dev split that contains the problem with an
early stop if it does not, hashes anchored outside the scratch folder).
Public data only (LibriSpeech, Multilingual LibriSpeech, OpenSLR 83 — CC BY
4.0 / CC BY-SA 4.0); no private recordings. Every number below is per sex.

**Harness and cadence parity.** A new harness drives the REAL
`src/ml/pitch-only-warning.js` inside the chain loop exactly as
`useAudioPipeline` and `HeardAsPanel` do: every posted pitch frame on
arrival, the resonance state every 0.2 s of audio (the resonance worker's
post cadence, `noteResonance` on every post with the hook's audio clock),
the panel's 2 s updates plus its 250 ms hide checks (`HIDE_CHECK_MS`) and
the switch-on update, the deployed q8-v2 classifier (`--classifier=real`).
It logs every main-thread event, so every candidate is replayed over the
same event stream. Chain = a clone of `cue-strip` @ cf76c58 (module sha256
`5a7a5814f827c48d019b8bfe450de85ffb0855220c88e7e57440df4fc6c43a6a`, the
module still on `cue-strip`; no file on the warning's input path has changed
since — `HeardAsPanel.jsx` later gained only the text-only false-alarm line,
56c886c, and its rewording after review).
Because the panel's 2 s timer phase is arbitrary in the app and moves
per-reader figures by about ±2–6 pp, every session ran with four panel
phases (0 / 500 / 1000 / 1500 ms, each its own warning instance and timers)
and every outcome is the mean over the four. Validation before
registration, on all 1,504 §8.4 sessions: chain output identical to §8.4's
recorded output (posted pitch, classified windows, all 85,648 ticks); the
real module live vs the real module replayed vs the S0 variant module:
0 mismatches in on / `held()` / `pitchStart()` over 87,729 updates; the
variant module in §8.4's 2 s mode vs §8.4's Python rules: 0 mismatches,
all 18 rules. Parity in this round's runs (the same three-way check):

| Run | Sessions | Updates per phase (0 / 500 / 1000 / 1500 ms) | Mismatches |
|---|---|---|---|
| Dev | 1,480 | 87,544 / 87,172 / 86,787 / 86,458 | 0 at every phase |
| Test | 1,492 | 88,957 / 88,543 / 88,148 / 87,897 | 0 at every phase |

The confirmation agent also fed round 1's scratch JS implementation of
A40+KP8-3+DS10 (sha256 `a53b13da…3a79`) the recorded main-thread events at
live cadence on all 1,492 test sessions × 4 phases (353,545 updates):
0 mismatches against the harness variant module, 0 against the scored
replay strings (5,968 session-phases), and, in its S0 configuration,
0 against the real module's live output. So the numbers below are the
rules' at the app cadence, not an artefact of the replay.

**Pools and stratification.** 192 speakers no earlier Syrinx study used
(165 of 481 downloaded candidates excluded by an over-inclusive id scan),
selected mechanically from metadata, 96 women and 96 men: LibriSpeech
train-other-500 shards 0010–0017 (24 per sex) and train-clean-360 shards
0004–0011 (24 per sex), MLS French / Spanish / Italian / Dutch / Portuguese
/ Polish (32 per sex), OpenSLR 83 UK and Ireland dialects (16 per sex).
Before any warning result, the real pitch worker alone ran over each
speaker's first 125 s; **drift D** = SD of the medians of posted voiced
pitch (st) in six 20 s blocks. The split is stratified by sex × D tercile ×
corpus group, pairs assigned by a sha256 coin, so both splits contain the
drifting male readers (but see "For any further round" below: a full-span
drift measure shows the test held the two most-drifting men):

| Split | Sex | n | D median | D q90 | D max | n with D ≥ 1 st |
|---|---|---|---|---|---|---|
| Dev | Women | 48 | 0.48 st | 1.00 | 1.33 | 5 |
| Dev | Men | 48 | 0.50 st | 1.07 | 2.30 | 8 |
| Test | Women | 48 | 0.50 st | 1.11 | 1.79 | 6 |
| Test | Men | 48 | 0.49 st | 1.08 | 3.15 | 7 |

Expressive readers (replayed from 5 starts, k = 0, 1, 2, 3, 5 utterances
skipped) = per split and sex the union of the top quarter by 60 s pitch
spread and the top quarter by D, fixed at registration: dev 19 W / 15 M,
test 20 W / 17 M. Sessions (§8.4's constructions, unchanged): dev 1,480
(nat 96 + off 136, hcs 768, ehcs 192, picka 288), test 1,492 (nat 96 +
off 148, hcs 768, ehcs 192, picka 288).

*Exclusion scan, disclosed after review.* The scan's regular expression did
not find overlapping matches (a match consumes the `/` a following id
needs), so one test man the written rule would have excluded was kept:
mlsfr7142. His number appears in an earlier study's paths only as a
LibriSpeech chapter id of another speaker (`…/train-other-500/3179/7142/`),
not as a reused speaker; an overlapping scan finds no other case. He has
0 % natural false alarms under both rules, so no outcome changes.

**Pre-registration.** Reproduced verbatim in Appendix E, sha256
`c6fb5e3f908963b91616246439236005ecb68cf38efa02f43eaba3dd936c049a`, hashed
2026-10-12 01:55:18 −05:00 and logged outside the scratch folder at that
time, before any chain session of this round and before any rule (S0
included) was evaluated on a round-2 speaker. Its §9 lists 39 file hashes
(harness, variant module, real module, outcome code, pool, split, jobs);
`study2.py` refused to run unless all matched, and all 39 still match after
the test run. Candidates: §8.4's 17 ({S0, A40, CUMg} × {—, KP8-2.5,
KP8-3} × {—, DS10} minus S0) plus 6 new two-reference rules (2R: the pitch
must also have moved ≥ 4 st, the same way, from the reader's running
long-term median; 2RV-k: with a variability-scaled threshold on that side;
each also with DS10). The bar is §8.4's 15 checks per sex, phase-averaged.
Early stop: if S0 passed all men's false-alarm checks on dev, stop before
any test session.

**Dev table** (phase-averaged; `dev_table.csv` sha256
`793746dc49c47f6f9037e1a1cc560818ab9983f76143f20ab8254aad2f02e496`;
hits by base sex, the rest by reader sex):

| Rule | Hits M | Hits F | Early M | Early F | Nat FA M % | Nat FA F % | Reader max M % | Reader max F % | Worst start M % | Worst start F % | Together M / F % | Checks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S0 | 0.882 | 0.841 | 0.816 | 0.949 | 1.15 | 0.35 | 39.9 (ls3541) | 6.9 (ls5054) | 39.9 (ls3541) | 25.6 (ls5054) | 1.23 / 5.81 | 12/15 |
| DS10 | 0.882 | 0.838 | 0.816 | 0.949 | 1.01 | 0.09 | 35.2 | 3.4 | 35.2 | 17.7 | 1.23 / 5.81 | 12/15 |
| KP8-2.5 | 0.856 | 0.841 | 0.789 | 0.949 | 0.78 | 0.31 | 24.9 | 5.0 | 24.9 | 10.7 | 1.23 / 5.72 | 13/15 |
| KP8-2.5+DS10 | 0.856 | 0.838 | 0.789 | 0.949 | 0.75 | 0.09 | 24.9 | 3.4 | 24.9 | 7.3 | 1.23 / 5.72 | 13/15 |
| KP8-3 | 0.821 | 0.829 | 0.780 | 0.941 | 0.27 | 0.23 | 6.5 | 4.7 | 9.8 | 3.5 | 1.23 / 5.72 | 13/15 |
| KP8-3+DS10 | 0.821 | 0.827 | 0.780 | 0.941 | 0.27 | 0.09 | 6.5 | 3.4 | 9.8 | 0.9 | 1.23 / 5.72 | 13/15 |
| A40 | 0.878 | 0.841 | 0.826 | 0.934 | 0.95 | 0.41 | 30.8 | 10.9 | 30.8 | 19.6 | 1.23 / 5.78 | 12/15 |
| A40+DS10 | 0.878 | 0.838 | 0.826 | 0.934 | 0.87 | 0.09 | 30.8 | 3.4 | 30.8 | 10.1 | 1.23 / 5.78 | 13/15 |
| A40+KP8-2.5 | 0.865 | 0.841 | 0.826 | 0.926 | 0.80 | 0.40 | 26.4 | 10.3 | 26.4 | 11.7 | 1.23 / 5.71 | 13/15 |
| A40+KP8-2.5+DS10 | 0.865 | 0.838 | 0.826 | 0.926 | 0.77 | 0.09 | 26.4 | 3.4 | 26.4 | 7.9 | 1.23 / 5.71 | 13/15 |
| A40+KP8-3 | 0.825 | 0.834 | 0.789 | 0.926 | 0.31 | 0.21 | 6.1 | 4.4 | 7.8 | 3.8 | 1.23 / 5.71 | 14/15 |
| **A40+KP8-3+DS10** | 0.825 | 0.831 | 0.789 | 0.926 | 0.30 | 0.09 | 6.1 | 3.4 | 7.8 | 0.9 | 1.23 / 5.71 | **14/15** |
| CUMg | 0.864 | 0.829 | 0.826 | 0.941 | 0.85 | 0.22 | 27.7 | 6.9 | 27.7 | 11.4 | 1.23 / 5.63 | 13/15 |
| CUMg+DS10 | 0.864 | 0.827 | 0.826 | 0.941 | 0.82 | 0.04 | 27.7 | 0.9 | 27.7 | 7.9 | 1.23 / 5.63 | 13/15 |
| CUMg+KP8-2.5 | 0.856 | 0.824 | 0.826 | 0.934 | 0.67 | 0.19 | 18.8 | 5.3 | 21.7 | 10.4 | 1.23 / 5.63 | 13/15 |
| CUMg+KP8-2.5+DS10 | 0.856 | 0.822 | 0.826 | 0.934 | 0.64 | 0.04 | 18.8 | 0.9 | 21.7 | 6.9 | 1.23 / 5.63 | 13/15 |
| CUMg+KP8-3 | 0.821 | 0.810 | 0.780 | 0.934 | 0.24 | 0.10 | 6.1 | 1.5 | 9.6 | 3.8 | 1.23 / 5.63 | 12/15 |
| CUMg+KP8-3+DS10 | 0.821 | 0.808 | 0.780 | 0.934 | 0.23 | 0.04 | 6.1 | 0.9 | 7.0 | 0.9 | 1.23 / 5.63 | 12/15 |
| 2R | 0.864 | 0.815 | 0.816 | 0.934 | 0.65 | 0.18 | 23.0 | 5.0 | 23.0 | 7.3 | 0.95 / 4.28 | 13/15 |
| 2R+DS10 | 0.864 | 0.813 | 0.816 | 0.934 | 0.64 | 0.04 | 23.0 | 0.9 | 23.0 | 5.0 | 0.95 / 4.28 | 13/15 |
| 2RV-2.5 | 0.847 | 0.815 | 0.807 | 0.934 | 0.61 | 0.16 | 20.8 | 3.8 | 20.8 | 6.3 | 0.93 / 4.03 | 12/15 |
| 2RV-3 | 0.825 | 0.801 | 0.762 | 0.934 | 0.46 | 0.10 | 16.4 | 1.5 | 16.4 | 2.5 | 0.93 / 3.94 | 10/15 |
| 2RV-2.5+DS10 | 0.847 | 0.813 | 0.807 | 0.934 | 0.59 | 0.04 | 20.8 | 0.9 | 20.8 | 3.5 | 0.93 / 4.03 | 12/15 |
| 2RV-3+DS10 | 0.825 | 0.799 | 0.762 | 0.934 | 0.45 | 0.04 | 16.4 | 0.9 | 16.4 | 0.9 | 0.93 / 3.94 | 10/15 |

Resonance-only false alarms were ≤ 0.03 % for every rule and sex.

**Early-stop outcome: continue.** On dev S0 failed two of the four men's
false-alarm checks — per-reader maximum (39.9 %, ls3541) and worst start
(39.9 %) — so dev contained the problem and the study went on (S0 also
failed the women's worst start, 25.6 %, ls5054). Unlike §8.4, the dev
split exercised the male false alarms.

**Choice.** `CHOICE.md`, reproduced verbatim in Appendix F, sha256
`d7e2fe93841715953eaf6bd906bd4b4f2ff474d97ea22998fd2a9d2068d3dc24`, written
and logged outside the scratch folder at 2026-10-12 03:55:44 −05:00, before
any test-split job or chain output existed (only the pre-registered
offset-0 natural audio used for the drift statistic did). **No candidate
passed all 15 dev checks.** Every rule that brought men's false alarms under
the bars (the KP8-3 family) cost more than 0.03 of male-base hits on dev.
By the PREREG §7 fallback (most checks passed, then the §7 order) the pick
was **A40+KP8-3+DS10** (14/15; it failed the male-base hit check on dev,
0.825 vs 0.882) — the same rule as §8.4.

**Test verdict: FAIL — 13 of 15 checks** (run once, 2026-10-12 04:20–06:12
−05:00, all 1,492 sessions, no errors). Before the run the confirmation
agent re-verified both hashes against the task, the `.sha256` files and the
external log, all 39 §9 file hashes, and recomputed the split and the four
expressive lists independently from the pitch-only pass (0 of 192
mismatches); no dev input, table or the choice contains a test speaker.
Chosen rule vs S0 on the same sessions, phase-averaged:

| Check | Bar | Women: S0 | Women: chosen | Men: S0 | Men: chosen |
|---|---|---|---|---|---|
| Natural FA (reader-balanced) | ≤ 2 % | 0.33 % | 0.00 % ✓ | 3.39 % | 0.27 % ✓ |
| Gap \|men − women\| | ≤ 1.5 pp | | | 3.06 pp | 0.27 pp ✓ |
| Per-reader natural-FA max | ≤ 15 % | 6.2 % (ls6300) | 0.0 % ✓ | 85.0 % (mlsdu4429)¹ | 6.6 % (ls3783) ✓ |
| Expressive readers' worst start | ≤ 15 % | 16.6 % (mlsfr7400) | 0.6 % (ls2598) ✓ | 95.2 % (mlsdu4429)¹ | 5.6 % (mlsit7372) ✓ |
| Hits ≤ 10 s, Meyer (by base sex) | ≥ S0 − 0.03 | 0.867 | 0.843 ✓ (−0.024) | 0.898 | **0.863 ✗ (−0.036)** |
| Early-shift hits (by base sex) | ≥ S0 − 0.03 | 0.913 | **0.863 ✗ (−0.050)** | 0.903 | 0.874 ✓ (−0.029) |
| Together FA | ≤ S0 + 2 pp | 6.3 % | 5.0 % ✓ | 1.1 % | 1.1 % ✓ |
| Resonance-only FA | ≤ S0 + 2 pp | 0.3 % | 0.2 % ✓ | 0.0 % | 0.0 % ✓ |

¹ Few eligible updates. mlsdu4429's natural session had 6–8 eligible
updates per panel phase (7 of 8 on at phase 0) out of ~93: the panel was
hidden ("short") on the rest. 85.0 % is about 7 of 8, i.e. the warning
showed on about 6 % of his session's panel updates. His worst start
(95.2 %, k = 3 and 5) is 18–22 of 19–23 eligible updates out of ~91.
Without him, the men's test reader max is 39.9 % (ls4402, ~32 of 80
eligible). Readers' eligible counts are listed with the per-reader figures
below.

The two failing checks are hit checks, on opposite base sexes. S0 against
the same absolute bars (descriptive) passes 10 of 15: men's natural FA,
the gap, men's reader max, men's worst start and women's worst start fail.

Hit counts per panel phase (S0 / chosen; n varies by phase because the
failure set depends on the shown estimate):

| Phase | Male base | Female base | Early shift, male base | Early shift, female base |
|---|---|---|---|---|
| 0 ms | 44 / 42 of 49 | 98 / 93 of 115 | 23 / 22 of 27 | 31 / 27 of 35 |
| 500 ms | 45 / 43 of 50 | 98 / 97 of 116 | 23 / 22 of 25 | 32 / 31 of 35 |
| 1000 ms | 45 / 43 of 49 | 98 / 96 of 111 | 23 / 22 of 25 | 32 / 31 of 34 |
| 1500 ms | 43 / 42 of 49 | 103 / 100 of 116 | 23 / 23 of 25 | 31 / 30 of 34 |

Full test table (male base / female base for hit rows, men / women
otherwise):

| | S0 | A40+KP8-3+DS10 |
|---|---|---|
| Hits ≤ 10 s, Meyer | 0.898 / 0.867 | 0.863 / 0.843 |
| Hits ≤ 10 s, Jebens | 0.898 / 0.868 | 0.863 / 0.849 |
| Hits ≤ 10 s, Nagels | 0.898 / 0.873 | 0.863 / 0.851 |
| Hits ≤ 14 s | 0.919 / 0.932 | 0.909 / 0.902 |
| Early-shift hits | 0.903 / 0.913 | 0.874 / 0.863 |
| Median time to first warning | 7.27 / 7.70 s | 7.29 / 7.80 s |
| Persistence | 0.879 / 0.929 | 0.846 / 0.889 |
| Natural FA, men / women | 3.39 / 0.33 % | 0.27 / 0.00 % |
| Per-reader max, men / women | 85.0 / 6.2 % | 6.6 / 0.0 % |
| Worst start, max, men / women | 95.2 / 16.6 % | 5.6 / 0.6 % |
| Worst start, mean, men / women | 10.9 / 2.5 % | 0.5 / 0.0 % |
| Together, men / women | 1.1 / 6.3 % | 1.1 / 5.0 % |
| Resonance only, men / women | 0.0 / 0.3 % | 0.0 / 0.2 % |
| Vocoder control, men / women | 1.5 / 0.7 % | 0.1 / 0.2 % |
| Early-shift together, men / women | 0.4 / 5.1 % | 0.4 / 3.4 % |
| Flash after a together shift, men / women | 18.5 / 15.5 % | 15.4 / 12.0 % |
| FA in the baseline phase of shift sessions, men / women | 0.2 / 0.2 % | 0.0 / 0.0 % |

Natural FA by reader (phase-averaged; readers above 0; in brackets the
reader's eligible updates per panel phase, mean over the four phases —
eligibility does not depend on the rule; median over all readers 78 men /
80 women, below 30 for 3 men and 1 woman):
- Men, S0: mlsdu4429 85.0 (7), ls4402 39.9 (80), mlsit7372 10.0 (70),
  ls3783 8.6 (76), ls5918 6.9 (69), ls5894 5.8 (77), ls5765 4.2 (42),
  ls3088 1.2 (86), mlspo6566 0.6 (82), mlsfr4482 0.3 % (78) (10 of 48).
  Chosen: ls3783 6.6, mlsit7372 5.0, ls5918 1.1 % (3 of 48).
- Women, S0: ls6300 6.2 (81), ls5060 5.4 (79), ls2598 2.2 (81),
  mlsfr7400 1.0 (79), ls6696 0.9 % (83) (5 of 48). Chosen: none.
- Dev, S0, for comparison: men's maximum ls3541 39.9 % (80), then
  mlsdu4396 6.9 % (65); women's ls5054 6.9 % (80).

Expressive readers' false-alarm share at starts k = 0, 1, 2, 3, 5 (readers
with any under either rule, the larger ones):

| Reader | S0 | Chosen |
|---|---|---|
| M mlsdu4429 | 85.0, 89.7, 95.1, 95.2, 95.2 | 0 at every start |
| M ls4402 | 39.9, 1.5, 0, 0, 0 | 0 at every start |
| M mlsit7372 | 10.0, 16.5, 13.9, 8.7, 7.5 | 5.0, 5.0, 5.6, 4.5, 0 |
| M ls5894 | 5.8, 5.1, 7.5, 14.3, 1.0 | 0 at every start |
| M ls5918 | 6.9, 7.4, 7.3, 7.4, 5.6 | 1.1, 1.7, 0.4, 0, 0 |
| W mlsfr7400 | 1.0, 1.9, 3.8, 2.8, 16.6 | 0 at every start |
| W ls6300 | 6.2, 11.2, 0, 6.0, 6.8 | 0 at every start |
| W ls5060 | 5.4, 4.7, 5.1, 0.3, 6.6 | 0 at every start |
| W ls2598 | 2.2, 1.0, 8.8, 0, 0 | 0, 0, 0.6, 0, 0 |

Natural FA by corpus group, S0 → chosen (mean / max %): men LS-other
4.98 / 39.9 → 0.55 / 6.6, LS-clean 0.63 / 6.9 → 0.10 / 1.1, MLS
6.00 / 85.0 → 0.31 / 5.0, SLR83 0 → 0; women LS-other 0.45 / 5.4 → 0,
LS-clean 0.77 / 6.2 → 0, MLS 0.06 / 1.0 → 0, SLR83 0 → 0.

**Why it failed (descriptive, after the verdict; nothing was re-tuned):**
- *It trades timeliness for false alarms, for both base sexes.* The rule
  removes nearly all natural false alarms on fresh speakers (men
  3.39 → 0.27 %, women 0.33 → 0 %; the gap 3.06 → 0.27 pp) — unlike §8.4,
  where at the 2 s replay it moved men only 2.50 → 1.79 % — but it warns
  later on real pitch-only shifts. It cost male-base hits on both splits
  (dev −0.057, test −0.036), and on test also female-base early-shift hits
  (−0.050; dev −0.023).
- *Most lost hits are late, not missing.* The first warning lands 0.1–5 s
  after the 10 s window (mostly 10.1–12.5 s), which fits KP8's raised
  threshold for a varied reader and DS10's requirement that the shown share
  has also moved: hits within 14 s fall less (men 0.919 → 0.909, women
  0.932 → 0.902). A few shifts never warn (mlspo4067's early shift; the
  −6 st PICKA cell for ls6300 and the −12 st cell for mlspo12114).
- *Concentrated losses.* One reader, mlspo5090, is 7 of the 8 lost
  male-base hits across phases (hcs A and B, ehcs; first warning at
  10.2–14.2 s); the female early-shift failure is phase-sensitive (phase 0
  loses 4 of 31, the other phases 1 each). One male and two female hits
  are gained.

**Decision.** Per PREREG §7, FAIL keeps S0: `src/ml/pitch-only-warning.js`,
`PITCH_ONLY_WARNING`, its tests and the golden replay fixture are
unchanged, and the DS10 product question does not arise. Whether to accept
later warnings for far fewer false alarms would be a new decision with a
new pre-registration and fresh speakers, not a re-reading of this test.
The panel's "More" list gains one line disclosing the false alarms (below).
Every artefact (pool, sessions, harness, replays, dev table, test result,
the confirmation report `RESULT.md` sha256
`9cfcf4da31d875e8533568d603602584a69fe58776de2c8601d79e044374fb17`, the
scratch implementation and its parity check) stays in the study's scratch
folder; only this summary and Appendices E and F are committed. Hashes
anchored outside the scratch folder: the hash log (PREREG 01:55:18, dev
table and CHOICE 03:55:44, the test job list / run script / parity script
04:19:57 before any test chain output, `test_result.md` 06:12:51, the
confirmation report 06:15:48, all 2026-10-12 −05:00) and the commit
message of this section.

**False alarms of the shipped rule (S0) at the app cadence, this round.**
Natural reading, share of eligible updates (panel showing an estimate),
phase-averaged:

| | Dev men | Test men | Pooled men | Dev women | Test women | Pooled women |
|---|---|---|---|---|---|---|
| Reader-balanced (the bar's statistic) | 1.15 % | 3.39 % | 2.27 % | 0.35 % | 0.33 % | 0.34 % |
| Update-weighted (all eligible updates of the sex) | 1.19 % | 1.82 % | 1.50 % | 0.35 % | 0.33 % | 0.34 % |
| Readers with any | 8 / 48 | 10 / 48 | | 5 / 48 | 5 / 48 | |
| Per-reader maximum (eligible updates per phase) | 39.9 % (80) | 85.0 % (7)¹ | | 6.9 % (80) | 6.2 % (81) | |

The men's two statistics differ on test because one reader with few
eligible updates (mlsdu4429, ¹ above) weighs 1/48 in the reader-balanced
mean however few updates he has; for women they agree. The false alarms
concentrate in readers whose pitch varies a lot: both men's maxima are
expressive readers (selected by pitch spread or drift), and the other two
men above 15 % (ls3541 dev, ls4402 test) see it on ~40 % of ~80 eligible
updates.
mlsdu4429's case is not an octave error: the review's WORLD Harvest
cross-check of three of his utterances gives medians of 149–159 Hz against
about 85 Hz for the others — he genuinely reads those passages higher.

**Panel text (new "More" line, `PITCH_ONLY_FALSE_ALARM_TEXT` in
`HeardAsPanel.jsx`; reworded after review):** "The note about pitch-only
changes can also appear when you haven't deliberately changed your voice,
if your pitch varies a lot as you talk. In tests on 192 people reading
aloud that happened more often for men's voices (about 1 to 2 in 100
updates) than for women's (fewer than 1 in 100), and for a few voices far
more often — up to most of the updates where the panel showed an
estimate." "About 1 to 2 in 100" spans the men's pooled update-weighted
(1.50 %) and reader-balanced (2.27 %) figures. The first version said
"about 2 in 100" (reader-balanced only) and "for a few voices much of the
time", which overstated the one reader at 85 % (7 of 8 eligible updates,
about 6 % of his panel updates). The wording names no sex except in that
measured comparison.

**Which miss figure stands.** The "More" list's "on new voices it missed
about 4 in 10" (`PITCH_ONLY_MISSES_TEXT`) is §8.2's S0 test result on
LibriSpeech test-other: 0.59 / 0.65 within 10 s on 17 male-base and 22
female-base failure-set sessions, with the chain and replay of that time.
The same definitions (failure set, hit within 10 s) give higher hit rates
on the larger later sets: §8.3 0.83 / 0.86, and here, at the app cadence,
0.88 / 0.84 on dev and 0.90 / 0.87 on test (about 49 male-base and 115
female-base failure-set sessions per phase on test). The runs differ in
speakers, set size, chain and cadence, and none re-ran §8.2's sessions, so
which of these explains the gap is not separated. The panel keeps "about 4
in 10" as the largest miss rate measured (conservative); changing it to the
larger sets' "about 1 in 10" is left to the user.

**For any further round (from the review of this round; not applied
retroactively).**
1. *Stratify on the full span.* The pre-registered D used only the first
   125 s. Over each full natural session (descriptive, computed after the
   verdict; SD of 20 s block medians of posted voiced pitch), the two
   most-drifting men of all 96 are both test readers — mlsdu4429 3.79 st
   (pre-registered D 0.55 st, rank 44, middle tercile; his high passages
   start at 157 s) and ls4402 2.83 st — then ls3541 (dev) 2.51 st; on the
   pre-registered D the top two were one per split (ls4402 3.15, ls3541
   2.30), so only mlsdu4429 was misplaced. In the top third of men on the
   full-span measure, 13 are dev and 19 test (women 18 / 14).
   So dev held a milder form of the problem (S0 men's natural FA 1.15 % dev
   vs 3.39 % test). Next time: stratify on the full span each speaker
   contributes (or the maximum |20 s block median − start-window median|
   over it), and before writing CHOICE report dev/test balance on that
   statistic and on pitch-only proxies of S0's false alarms.
2. *Stop before the test when no candidate passes every dev check*, and
   keep the test split fresh — unless the user has first pre-registered a
   different trade (e.g. a 14 s hit window or a larger hit tolerance). This
   round's fallback spent the test on a rule that had already failed the
   same check on dev (male-base hits −0.057); it failed it again (−0.036).
3. *Anchor hashes in git before results.* Push a pre-registration-only
   commit carrying PREREG's sha256 before the dev run, and one carrying
   CHOICE's before any test job is built. This round's external hash log is
   an editable file; the first git-anchored copy (e7cd062) postdates the
   test.
4. *Few-update readers.* Pre-register a minimum eligible-update count (for
   example ≥ 30 per phase) for a reader to count toward the per-reader
   maximum, and report update-weighted natural FA beside reader-balanced.
5. *Exclusion scan with overlapping matches* (lookahead patterns, e.g.
   `(?<![\d.])(?=(IDS)[-_/]\d{2,6}[-_/])` and `(?=/(IDS)/)`).

### 8.6 Adopted by user override (2026-10-12)

**Decision.** On 2026-10-12 the user adopted **A40+KP8-3+DS10** for the
app, overriding the two narrow misses of §8.5's held-out test. The
recorded verdict stays **FAIL (13 of 15 checks)**; this section does not
re-read the test. The precedent is the speech-detector override in
`low-voice-noise-2026-10-07.md` ("Decision (2026-10-07): adopted,
overriding the H3 miss"): the verdict is kept as recorded, and the facts
behind it stay attached to the adoption.

**The two failed checks** (§8.5, test split, chosen rule vs S0 on the same
sessions, phase-averaged over the four panel phases; the full per-sex test
table is §8.5's "Full test table", with the per-phase hit counts and
per-reader figures beside it):

| Check | Bar | S0 | Adopted | Change | Per phase (S0 → adopted) |
|---|---|---|---|---|---|
| Hits ≤ 10 s (Meyer), **male base** | ≥ S0 − 0.03 | 0.898 | 0.863 | **−0.036** | 44 → 42 of 49, 45 → 43 of 50, 45 → 43 of 49, 43 → 42 of 49 |
| Early-shift hits, **female base** | ≥ S0 − 0.03 | 0.913 | 0.863 | **−0.050** | 31 → 27 of 35, 32 → 31 of 35, 32 → 31 of 34, 31 → 30 of 34 |

- The male-base miss exceeds the tolerance by 0.006. One reader, mlspo5090,
  accounts for 7 of the 8 male-base hits lost across phases (first warning
  10.2–14.2 s after the shift). The rule had failed the same check on dev
  (0.825 vs 0.882), so this miss was foreseeable when it was picked by the
  PREREG §7 fallback.
- The female-base early-shift miss is phase-sensitive: phase 0 loses 4 of
  31, the other phases 1 each. On dev this check passed (−0.023).
- The other two hit checks pass: female-base hits 0.867 → 0.843 (−0.024),
  male-base early-shift hits 0.903 → 0.874 (−0.029).

**Why the user overrode them: false-alarm fairness against warnings a few
seconds later.**

- *False alarms, per sex* (natural reading, share of eligible updates;
  test unless marked):

  | | Men: S0 | Men: adopted | Women: S0 | Women: adopted |
  |---|---|---|---|---|
  | Reader-balanced (the bar's statistic) | 3.39 % | 0.27 % | 0.33 % | 0.00 % |
  | Update-weighted | 1.82 % | 0.26 % | 0.33 % | 0.00 % |
  | Update-weighted, dev (in-sample) | 1.19 % | 0.29 % | 0.35 % | 0.09 % |
  | Per-reader maximum | 85.0 % | 6.6 % (ls3783) | 6.2 % | 0.0 % |
  | Per-reader maximum, dev (in-sample) | 39.9 % | 6.1 % | 6.9 % | 3.4 % |
  | Expressive readers' worst start | 95.2 % | 5.6 % | 16.6 % | 0.6 % |
  | Readers with any (test) | 10 / 48 | 3 / 48 | 5 / 48 | 0 / 48 |

  The gap between the sexes falls from 3.06 to 0.27 pp. Under S0 the false
  alarms fell mostly on men (and a few readers saw it on most of their
  eligible updates); the adopted rule brings both sexes near zero. §8.4's
  first round (48 fresh speakers, 2 s replay cadence) moved the same way
  (men 2.50 → 1.79 %), though less.
- *Hits, per base sex* (test; Meyer failure set, phase-averaged; the
  15 s column is computed from `confirm/detail_test.json`'s first-warning
  times after the verdict — descriptive):

  | | Male base: S0 | Male base: adopted | Female base: S0 | Female base: adopted |
  |---|---|---|---|---|
  | Hits ≤ 10 s | 0.898 | 0.863 | 0.867 | 0.843 |
  | Hits ≤ 14 s | 0.919 | 0.909 | 0.932 | 0.902 |
  | Hits ≤ 15 s | 0.919 | 0.919 | 0.939 | 0.906 |
  | Early-shift hits ≤ 10 s | 0.903 | 0.874 | 0.913 | 0.863 |
  | Early-shift hits ≤ 15 s | 0.903 | 0.903 | 0.950 | 0.921 |
  | Median time to first warning | 7.27 s | 7.29 s | 7.70 s | 7.80 s |
  | Persistence | 0.879 | 0.846 | 0.929 | 0.889 |

  Most lost hits arrive 0.1–5 s after the 10 s window (mostly
  10.1–12.5 s). A few shifts never warn under the adopted rule
  (mlspo4067's early shift at three phases; the −6 st PICKA cell for
  ls6300 and the −12 st cell for mlspo12114).
- The cost falls on both base sexes, and so does the benefit; neither sex
  is traded for the other.

**What changes in the app.** `src/ml/pitch-only-warning.js` gets the
adopted rule exactly as the confirmation's scratch module (round 1's
`confirm/impl/pitch-only-warning.js`, sha256 `a53b13da…3a79`), which
matched the harness tick for tick on all 1,492 test sessions × 4 phases
(§8.5):

- **A40:** the pitch reference P0 is the ln median of the posted voiced
  frames from t_fill to min(t, t_fill + 40 s) (never shorter than S0's
  start window), then frozen. It exists, as S0's does, only from t_start on
  and only when S0's start window holds ≥ 20 voiced frames.
- **KP8-3:** the pitch threshold is max(4 st, 3 × RMS of this reader's
  quiet ΔP so far) once ≥ 5 quiet values exist, else 4 st. A quiet value is
  the ΔP of a shown update whose |ΔP| was below that update's threshold;
  shown updates before t_start are back-filled against S0's P0 once it is
  known.
- **DS10:** the panel's shown share (heard-as `heardAsShares(…).s`, the
  value the panel draws) must also have moved ≥ 10 points from its median
  over the shown updates in [t_fill, t_start].
- Unchanged: K = 2, the hold through ≤ 5 hidden updates, eligibility, the
  0.6 u resonance bound, the resets.

`update()` gains two inputs, `share` and `audioMs`; `HeardAsPanel` passes
the share it draws and the hook's audio clock at every update (hidden ones
included), as the harness did.

**Port parity (2026-10-12).** The committed module (sha256
`94554a8ef18549a250f16430f792fe19557b55f64bca0d10e233224961eaff67`) against
the confirmed scratch module (`a53b13da…3a79`): both fed the same calls,
compared on every update for on / off, `held()` after the update and
`pitchStart()` before it.

- *Recorded streams* (the study's app-cadence event logs replayed through
  both modules; also against the study's scored `A40+KP8-3+DS10|app`
  strings):

  | Streams | Sessions (men / women) | Panel phases | Updates | Warning on | Mismatches |
  |---|---|---|---|---|---|
  | Round 2 test | 1,492 (596 / 896) | 0 / 500 / 1000 / 1500 ms | 353,545 | 25,106 | 0 (and 0 of 5,968 scored strings) |
  | Round 2 dev | 1,480 (588 / 892) | 0 / 500 / 1000 / 1500 ms | 347,961 | 24,802 | 0 (0 of 5,920) |
  | Round 1 (§8.4) sessions | 1,504 (602 / 902) | 0 ms | 87,729 | 7,056 | 0 (0 of 1,504) |
  | Round 1 natural sessions | 204 (102 / 102) | 1000 ms | 19,543 | 185 | 0 (0 of 204) |

- *Live in the harness.* `session_app.mjs` with only the panel call changed
  to the new `HeardAsPanel` wiring (`update({ lnF0, resonance, share,
  audioMs })`, share = `heardAsShares(…).s`, audioMs = the audio clock) ran
  the production tree (chain files identical to the study's clone) with the
  production module live in the loop:

  | Run | Sessions (men / women) | Panel phases | Updates | Warning on | Mismatches vs scratch | Event stream = the study's recorded one | = the scored strings |
  |---|---|---|---|---|---|---|---|
  | Round 2 test sample (deployed q8-v2 classifier): all 96 natural sessions, every 4th expressive start, every 8th hcs / ehcs / PICKA | 289 (129 / 160) | 0 / 500 / 1000 / 1500 ms | 83,769 | 2,436 | 0 | 1,156 of 1,156 | 1,156 of 1,156 |
  | Round 1 (§8.4) sessions (cached logits, as in round 1) | 1,504 (602 / 902) | 0 / 1000 ms | 174,660 | 14,108 | 0 | 1,708 of 1,708 (phase 0 all; phase 1000 the 204 recorded) | 1,708 of 1,708 |

  A comparison script that perturbs one constant (DS 10 → 9.9, growMs
  40,000 → 39,900, KP8 k 3 → 2.99) finds mismatches on the round-2 test
  streams, so the 0 is not a blind check.

**Checks.** `tests/ml/pitch-only-warning-test.js` (141 checks: the A40
growth and inclusive freeze at t_fill + 40 s, KP8 growth / floor /
back-fill / hidden updates, the DS10 start-share median, both window ends
and the 10-point boundary, mirror symmetry on 20 random sessions, K, the
hold, clearing, resets, the panel wiring, and the golden replay — 14 public
test-split session-phases at the app cadence, regenerated by
`scripts/heard-as/pitch-only/make_fixture_app.mjs`, whose expected
timelines are the study's scored strings for both the adopted rule and S0;
dropping A40, KP8 or DS10 each changes at least one of them); lint, the
40 unit-test scripts and the build pass. The cue-strip smoke with
`--pitch-only=man,woman` passes 95 / 95 at all five viewports (448 × 890,
402 × 750, 360 × 690, 890 × 360, 1280 × 800): the warning first shows
6.3–6.5 s after the man's pitch-only shift and 7.6–9.6 s after the
woman's, and stays on 72–76 of 72–76 shown samples in the next 20 s.

**What users are told** (the panel's "More" list; replacing "on new voices
it missed about 4 in 10" and the S0 false-alarm line):

- Misses: "The note about pitch-only changes doesn't catch every change: in
  tests on 96 people it caught about 85 in 100 pitch-only changes within
  10 seconds and about 90 in 100 within 15 seconds, and fewer for some
  voices — so no note doesn't mean the guess is right." (Test, adopted
  rule: ≤ 10 s 0.863 / 0.843 male / female base, ≤ 15 s 0.919 / 0.906;
  some readers lose most of their hits, e.g. mlspo5090.)
- False alarms: "The note about pitch-only changes can also appear when you
  haven't deliberately changed your voice, if your pitch varies a lot as you
  talk. In tests on 192 people reading aloud that happened on about 3 in
  1,000 updates for men's voices and almost never for women's, and more
  often for a few voices — up to about 1 in 15 updates where the panel
  showed an estimate." (Update-weighted, dev + test pooled: men 79 of
  28,366 = 0.28 %, women 14 of 29,907 = 0.05 %; per-reader maximum men
  6.6 % test, women 3.4 % dev.)

The words name a sex only in the measured comparison and are otherwise the
same in every direction.

**Addendum (2026-10-12, review of the adoption): the warning needs a shown
estimate in the start window.** Found by the read-only review of the port,
not by the study; nothing in the rule was changed for it (Hard rule 3).

- *Mechanism.* DS10 compares the drawn share with the median of the shares
  of the **shown** panel updates in [t_fill, t_start]. `HeardAsPanel` calls
  `update()` only while the panel is on, and while the model loads it
  passes no estimate. So when the panel is off, still loading (the first
  switch-on downloads the model) or hidden through the whole start window,
  the start share stays empty and the DS10 check fails on every later
  update: the warning cannot appear until stop / start listening or a
  resonance-cue restart. A40's pitch reference does not have this problem
  (posted pitch frames arrive whether or not the panel is on). KP8's quiet
  history does not block the warning, but it is built from shown panel
  updates too, so for a late panel it starts at switch-on (4 st until 5
  quiet values exist, then 3 × RMS of a short history; *corrected
  2026-10-12 after the §8.7 review — this sentence said the KP8 history
  only leaves the threshold at 4 st; §8.7 shows the short late history
  costs hits*). Under S0 a panel
  switched on late still warned. The module, the hook comment and the
  CLAUDE.md row said the start reference was the session's start; they now
  state this limit.
- *Synthetic check* (the review's repro: a steady 120 Hz voice, `startU`
  set at 20 s, an 8 st pitch-only shift at 60 s with the drawn share moving
  0.2 → 0.6, updates every 2 s): with the panel on from 0, 10 or 19 s both
  rules first warn at 62 s; with the panel on from 22 or 30 s S0 warns at
  62 s and the adopted rule never does.
- *When the start window closes* (round-2 natural sessions, panel phase 0,
  read from the recorded 2 s panel ticks, session time from the start of
  listening; 48 readers per sex and split): t_fill median 10 s for women
  (dev and test), 10 s / 12 s for men (dev / test); t_start median 30 s for
  women, 34 s / 36 s for men; 95th percentile 42 / 44 s for women and
  50 / 48 s for men; latest 50 / 74 s for women and 58 / 100 s for men.
  So a panel turned on more than about half a minute into a session will
  usually not get a start share.
- *Coverage of the published figures.* Every study session ran with the
  panel on from its first 0–1.5 s and the model ready, so §8.5's and this
  section's hit rates (about 85 / 90 in 100) do not hold on this path;
  there the catch rate is 0. Inside the study one reader met it anyway:
  test man mlsdu4429 (the reader with 7 of 8 eligible updates warned under
  S0) had no shown estimate before his start window closed at 90–100 s,
  in his natural session, its four later starts and his two hcs sessions at
  phase 0; no woman did. Part of the men's worst-reader improvement
  (85.0 → 6.6 %) is therefore this gap, not the rule's design: his 0 % under
  the adopted rule means "cannot warn".
- *Disclosed.* The panel's "More" list gains: "The note about pitch-only
  changes needs this panel to be on, and finished loading, when you start
  talking: if you turn it on after you've started, the note may not appear
  until you stop and start listening again." (Direction- and sex-neutral.)
- *Follow-up, not done.* A fallback for an empty start share needs its own
  pre-registered check in the round-2 app-cadence harness with the panel
  switched on late (e.g. at 30 and 60 s), per sex. Candidates: A40+KP8
  without the DS gate while the start share is empty; or the median of the
  first N shown shares after switch-on, taken while the resonance is still
  within 0.6 u of `startU`. **Done 2026-10-12 (§8.7): the pre-registered
  fallback failed its fresh-pool test; the shipped rule is kept. Round 2,
  which also seeded KP8, failed too, 2026-10-13 (§8.8). Its rule, KS-Q5,
  was adopted by user decision the same day (§8.9).**

**Addendum (2026-10-12, review): the "More" list's sources.** The rule was
selected on the dev split, so dev figures are in-sample. The user-facing
false-alarm line now rests on the **test** split only — 96 readers (48 men,
48 women), update-weighted men 0.26 % (reader-balanced 0.27 %), women
0.00 %, worst reader a man at 6.6 % (ls3783), no woman above 0 % — which
gives the same words ("about 3 in 1,000", "almost never", "up to about 1 in
15"); the line now says "in tests on 96 people" instead of 192. The pooled
dev + test figures above (men 0.28 %, women 0.05 %, women's per-reader
maximum 3.4 % on dev) stay as context. The misses line's hit rates come
from the test split's pitch-only sessions in the Meyer failure set, which
cover 71 of the 96 test readers (42 women, 29 men, across the four panel
phases; 68 at phase 0), not all 96; the line now says "in tests on about 70
people".

### 8.7 Late switch-on: a fallback for the empty start share — pre-registered, confirmation FAILED; the shipped rule is kept (2026-10-12)

User decision (2026-10-12): test a fallback for §8.6's addendum (the
warning cannot appear when the panel has no shown estimate in the start
window) with its own pre-registration, and adopt it only if it passes.
Public data only (LibriSpeech, Multilingual LibriSpeech — CC BY 4.0); no
private recordings. Every number below is per sex. **Verdict: FAIL, 29 of
30 checks. `src/ml/pitch-only-warning.js` is unchanged (A40+KP8-3+DS10,
module sha256 `2a1f4022…` (36202c2; code-identical to the
port-parity-checked `94554a8e…`, comments only)), and the panel's "More" line about turning the
panel on before you start talking stays.**

**Mechanism.** DS10 takes its start share only from **shown** panel
updates in [t_fill, t_start]. `HeardAsPanel` calls `update()` only while
the panel is on, and passes no estimate while the model loads, so a panel
that is off, loading or hidden throughout that window (it closes at a
median ~30 s for women and ~34–36 s for men, p95 42–50 s, latest 100 s;
§8.6 addendum) leaves the start share empty, and the DS gate then fails on
every later update until stop / start or a cue restart. A40's pitch
reference is fed by every posted pitch frame whatever the panel does, so
it is the same for a late panel. KP8's quiet history is built from shown
panel updates, so for a late panel it starts at switch-on: 4 st until 5
quiet values exist, then 3 × RMS of a short history. Only the DS gate
blocks the warning outright, so the fallbacks below target it; the
Descriptive section shows the late KP8 history costs hits too
(*corrected 2026-10-12 after review: this paragraph said KP8's threshold
was fed by every pitch frame*). The
panel's on/off setting persists, so this hits mainly the session in which
it is first turned on, or sessions where the model is still loading.

**Pre-registration and choice** (verbatim in Appendices G and H):

- PREREG.md sha256
  `9a09b4de49bc5a68081d61f051005f6c0586eba124dcd9a13890d02e4ccf985f`,
  written and logged outside the scratch folder at 2026-10-12 10:38:18
  −05:00, before any candidate (or the shipped rule) was evaluated on any
  session of this study.
- CHOICE.md sha256
  `eb8721cf982844f3aae6509c9673e42438ccda0984ce6fca15cf28fe4300c668`,
  written by `late_eval.py dev` and logged at 14:18:55, before any fresh
  test-pool session ran through the chain. The dev table's hashes
  (`dev_table.md` `7cc003d3…`, `dev_table.csv` `7e1ebfb5…`) are in it.
- The test output `test_result.md` sha256
  `5d3807649a9598eca11eeb7011ca384807e7f014b245aa564b8c7f059cf535bc`
  (logged 18:30:04).

**Harness.** Round 2's app-cadence harness (§8.5: pitch messages, the
gender worker on the audio clock, resonance posts every 0.2 s of audio,
the panel's 2 s interval and 250 ms hide check, the deployed q8-v2
classifier), extended with late switch-on and model loading as the app
does it at 36202c2: switching the panel on at audio time A starts a new
gender worker (and `heardAs.reset()`), every panel compute is a hidden
"loading" update until the model is ready at A + L, then the panel
computes on its 2 s interval from A. The warning object gets every pitch
frame and resonance post from the start of listening. Conditions, every
session in one chain pass:

- `on0` — panel on before listening, model ready (round 2's runs; panel
  phases 0 / 500 / 1000 / 1500 ms).
- `on0L` — panel on before listening, model ready at 7.95 s.
- `T30`, `T60`, `T120` — panel switched on at T + 0 / 0.45 / 1.05 / 1.5 s,
  model ready 4.05 / 5.40 / 6.60 / 7.95 s later (phase index j = 0..3).

Every outcome is computed per phase and then averaged over the four. The
candidates are generated from the shipped module by asserted exact string
replacements and replayed over each panel's recorded call stream.
Validation before registration (no outcome of any rule):

- on0 is round 2 tick for tick on 21 round-2 dev sessions: 158,612
  main-thread events and 6,230 panel updates, 0 mismatches, with the live
  shipped column equal to round 2's scored strings.
- Parity on 17 round-1 sessions: 0 mismatches.
- An independent Python implementation written from the rule text matches
  the JS strings for the shipped rule and all five candidates (16,619
  updates, 0 mismatches).
- The outcome code reproduces round 2's dev table for S0 and the shipped
  rule.

**Candidates.** Each departs from the shipped rule only at an update where
(a) t_start is known and the update's audio time is after it, (b) the
start share is empty, and (c) the panel came on late: the module's first
`update()` since creation or `reset()` arrived when t_fill was already
known (a cue restart keeps this flag). Condition (c) keeps a panel that was
on from the start but hidden through the whole start window (round 2's
test man mlsdu4429) on the shipped rule, as the "panel on at 0 identical"
check requires.

| Name | Fallback when triggered |
|---|---|
| `F1` | Fallback start share: median of the drawn shares of the shown updates in [fbT0, fbT0 + 20 s], fbT0 = the first shown update after the start window closed; DS gate fails while the window is open, then DS10 against the fallback share |
| `F2` | No DS gate: A40 + KP8-3 alone |
| `F3-5`, `F3-10` | F1, but the window stays open past fbT0 + 20 s until ≥ 5 / ≥ 10 shares are collected |
| `F4-Q5` | F3-5, collecting only "quiet" shares: shown, eligible, \|u − startU\| ≤ 0.6 u, and \|ΔP\| below that update's own KP8 threshold |

**The bar** (PREREG §5; 30 checks, all required). For each of T30, T60,
T120 and their pooled values:

- Hits within 10 s per base sex ≥ the shipped rule's hits with the panel on
  from 0 (`on0`) on the same sessions − 0.05.
- Natural false alarms ≤ 2 % per sex.
- \|men − women\| ≤ 1.5 pp.
- Per-reader maximum ≤ 15 % per sex.

Plus identity:

- On every on0 panel, candidate = shipped on every update.
- Before the first triggered update, candidate = shipped on every update.

The hit definitions, failure set (Meyer) and natural-FA statistic are
round 1's (§8.4).

**Dev** (round 2's 96 dev speakers, 48 per sex; 288 lengthened sessions:
`natL` ≥ 300 s natural reading, `hcsL` ≥ 170 s natural + ≥ 40 s WORLD
pitch-only shift (men up × 1.7041, women down), `pickaL` women ≥ 170 s +
≥ 40 s in the PICKA (−6, 0) / (−12, 0) cells; ~70,000 s of audio).

- Replay parity: 625,687 updates, 0 mismatches.
- on0 prefix identity against round 2's recorded dev outputs: 1,500,039
  events and 59,274 panel updates, 0 mismatches.
- Failure sets per phase: male base 28 / 29 / 29 / 29, female base
  75 / 74 / 73 / 75.
- Panels on the no-start-share path: T30 1,090 / 1,152, T60 and T120
  1,152 / 1,152, on0 and on0L 0.
- Identity: 149,644 on0 updates and 308,026 updates before the first
  trigger, 0 mismatches for every candidate.

Dev table (`dev_table.md`; phase-averaged; reader with the maximum in
brackets):

| Rule | Condition | Hits ≤ 10 s, male base | Hits ≤ 10 s, female base | Hits ≤ 15 s, male base | Hits ≤ 15 s, female base | Nat. FA men % | Nat. FA women % | \|M − F\| pp | Reader max men % | Reader max women % |
|---|---|---|---|---|---|---|---|---|---|---|
| shipped | on0 | 0.852 | 0.778 | 0.905 | 0.882 | 0.19 | 0.05 | 0.14 | 3.35 (ls3541) | 1.93 (ls7717) |
| shipped | on0L | 0.852 | 0.774 | 0.905 | 0.886 | 0.17 | 0.05 | 0.12 | 3.34 (mlsdu4396) | 2.11 (ls7717) |
| shipped | T30 | 0.017 | 0.013 | 0.017 | 0.020 | 0.00 | 0.00 | 0.00 | 0.00 (ls1226) | 0.00 (ls3003) |
| shipped | T60 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 (ls1226) | 0.00 (ls3003) |
| shipped | T120 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 (ls1226) | 0.00 (ls3003) |
| shipped | pooled | 0.006 | 0.004 | 0.006 | 0.007 | 0.00 | 0.00 | 0.00 | 0.00 (ls1226) | 0.00 (ls3003) |
| S0 | on0 | 0.869 | 0.815 | 0.922 | 0.929 | 1.37 | 0.48 | 0.89 | 47.00 (ls3541) | 14.74 (ls7717) |
| S0 | T30 | 0.869 | 0.818 | 0.913 | 0.929 | 1.40 | 0.49 | 0.92 | 48.28 (ls3541) | 15.11 (ls7717) |
| S0 | T60 | 0.869 | 0.818 | 0.913 | 0.929 | 1.48 | 0.52 | 0.96 | 50.11 (ls3541) | 16.90 (ls7717) |
| S0 | T120 | 0.869 | 0.818 | 0.913 | 0.929 | 1.48 | 0.51 | 0.97 | 48.53 (ls3541) | 20.21 (ls7717) |
| S0 | pooled | 0.869 | 0.818 | 0.913 | 0.929 | 1.46 | 0.51 | 0.95 | 48.97 (ls3541) | 17.41 (ls7717) |
| F1 | T30 | 0.861 | 0.778 | 0.887 | 0.892 | 0.40 | 0.04 | 0.35 | 13.36 (ls3541) | 1.62 (ls7717) |
| F1 | T60 | 0.852 | 0.778 | 0.878 | 0.892 | 0.14 | 0.01 | 0.13 | 2.80 (ls3541) | 0.64 (ls5968) |
| F1 | T120 | 0.774 | 0.774 | 0.818 | 0.892 | 0.05 | 0.00 | 0.05 | 1.18 (ls3541) | 0.00 (ls3003) |
| F1 | pooled | 0.829 | 0.777 | 0.861 | 0.892 | 0.20 | 0.02 | 0.18 | 5.78 (ls3541) | 0.54 (ls7717) |
| F2 | T30 | 0.861 | 0.781 | 0.887 | 0.896 | 0.46 | 0.06 | 0.41 | 15.27 (ls3541) | 1.62 (ls7717) |
| F2 | T60 | 0.852 | 0.781 | 0.878 | 0.896 | 0.23 | 0.14 | 0.09 | 6.04 (ls3541) | 2.93 (ls5054) |
| F2 | T120 | 0.792 | 0.774 | 0.826 | 0.892 | 0.20 | 0.05 | 0.15 | 5.29 (ls3541) | 1.86 (ls7717) |
| F2 | pooled | 0.835 | 0.779 | 0.864 | 0.895 | 0.30 | 0.08 | 0.22 | 8.87 (ls3541) | 2.10 (ls7717) |
| F3-5 | T30 | 0.861 | 0.778 | 0.887 | 0.892 | 0.40 | 0.04 | 0.35 | 13.36 (ls3541) | 1.62 (ls7717) |
| F3-5 | T60 | 0.852 | 0.778 | 0.878 | 0.892 | 0.14 | 0.01 | 0.13 | 2.80 (ls3541) | 0.64 (ls5968) |
| F3-5 | T120 | 0.774 | 0.774 | 0.818 | 0.892 | 0.05 | 0.00 | 0.05 | 1.18 (ls3541) | 0.00 (ls3003) |
| F3-5 | pooled | 0.829 | 0.777 | 0.861 | 0.892 | 0.20 | 0.02 | 0.18 | 5.78 (ls3541) | 0.54 (ls7717) |
| F3-10 | T30 | 0.861 | 0.778 | 0.887 | 0.892 | 0.40 | 0.04 | 0.35 | 13.36 (ls3541) | 1.62 (ls7717) |
| F3-10 | T60 | 0.852 | 0.778 | 0.878 | 0.892 | 0.14 | 0.01 | 0.13 | 2.80 (ls3541) | 0.64 (ls5968) |
| F3-10 | T120 | 0.774 | 0.774 | 0.809 | 0.892 | 0.05 | 0.00 | 0.05 | 1.18 (ls3541) | 0.00 (ls3003) |
| F3-10 | pooled | 0.829 | 0.777 | 0.858 | 0.892 | 0.20 | 0.02 | 0.18 | 5.78 (ls3541) | 0.54 (ls7717) |
| F4-Q5 | T30 | 0.861 | 0.778 | 0.887 | 0.892 | 0.40 | 0.04 | 0.35 | 13.36 (ls3541) | 1.62 (ls7717) |
| F4-Q5 | T60 | 0.852 | 0.778 | 0.878 | 0.896 | 0.12 | 0.01 | 0.10 | 2.39 (mlsdu4396) | 0.64 (ls5968) |
| F4-Q5 | T120 | 0.774 | 0.774 | 0.818 | 0.892 | 0.05 | 0.00 | 0.05 | 1.18 (ls3541) | 0.00 (ls3003) |
| F4-Q5 | pooled | 0.829 | 0.777 | 0.861 | 0.893 | 0.19 | 0.02 | 0.17 | 5.35 (ls3541) | 0.54 (ls7717) |

The on0 / on0L rows of every candidate equal the shipped rule's. Hit
reference: shipped on0 0.852 male base / 0.778 female base, so the bars are
0.802 / 0.728. Dev checks passed: F1, F3-5, F3-10 and F4-Q5 29 / 30 (each
fails only male-base hits at T120, 0.774 vs 0.802); F2 28 / 30 (also men's
reader max at T30, 15.27 %). No candidate passed every dev check, so the
PREREG §6 order picked the test candidate: F4-Q5 ties F1, F3-5 and F3-10
on checks passed and on the rounded hit and FA keys, and has the lowest
pooled per-reader maximum (men 5.35 % vs 5.78 %). CHOICE.md said before the
test that the chosen rule had failed a dev check.

Dev-run deviations, written after CHOICE.md (they change nothing in the
choice):

- The hashed `compare_on0.py` crashed in prefix mode; its PREREG role is
  report-only. A copy with only the event-time helper fixed ran the
  prefix-identity check (the 0 mismatches above), and the hashed file
  stayed unchanged.
- `late_eval.py dev` wrote every output and logged the hashes, then failed
  only at its final console print (cp1252 cannot print "≤").

**Fresh test pool** (PREREG §2.2, built mechanically after the choice).

- Sources never used by a Syrinx study: LibriSpeech train-other-500 shards
  0018–0025 and train-clean-360 shards 0012–0019, the first MLS train
  parquet of fr / es / it / nl / pt / pl, and the OpenSLR 83 archives
  northern_english_male / southern_english_female / southern_english_male
  (round 2 used other OpenSLR 83 material, and its downloaded line index
  lists every speaker, so the over-inclusive scan excluded all 71;
  *corrected 2026-10-12: this line said OpenSLR 83 was never used*).
- 410 candidates; 219 excluded by the over-inclusive id scan. That
  includes **all 71 OpenSLR 83 speakers**, because round 2's downloaded
  corpus index lists every one of them, so the OpenSLR 83 group was empty.
- 190 eligible; drift-stratified by round 2's tercile boundaries, 16 per
  stratum. Pool: **48 women, 48 men** (LS-other 20 F / 21 M, LS-clean
  19 F / 18 M, MLS 9 F / 9 M). 0 numeric-id overlap with the round-1 and
  round-2 pools and the §8.3 confirmation's readers.
- Drift D: women median 0.415 st (q90 0.834, 3 with D ≥ 1); men median
  0.527 st (q90 1.097, 7 with D ≥ 1).
- 288 sessions, 73,561 s of audio.
- Wording deviation: the PREREG says the pool "is built … after the
  choice". The raw archive downloads ran at 10:38–10:47, before the
  choice. Every derived file (inventory, exclusion scan, drift, pool,
  jobs, audio) dates from 14:20–15:40, after CHOICE.md: nothing read the
  downloads before CHOICE.md (the first derived file, inventory.json, is
  14:20:19; download.log ends 10:47:27).

**Test run** (once, 15:44–18:30, the dev command; checked by an
independent evaluator).

- Replay parity: 621,135 updates, 0 mismatches (shipped, fallback-null,
  S0, held, pitchStart).
- Identity: 148,630 on0 updates and 301,168 updates before the first
  trigger, 0 mismatches.
- Panels on the no-start-share path: T30 1,134 / 1,152, T60 1,144 / 1,152,
  T120 1,152 / 1,152; on0 and on0L 0.
- Failure sets per phase: male base 27 / 28 / 27 / 27, female base
  71 / 73 / 70 / 72.

Test table (`test_result.md`; phase-averaged):

| Rule | Condition | Hits ≤ 10 s, male base | Hits ≤ 10 s, female base | Hits ≤ 15 s, male base | Hits ≤ 15 s, female base | Nat. FA men % | Nat. FA women % | \|M − F\| pp | Reader max men % | Reader max women % |
|---|---|---|---|---|---|---|---|---|---|---|
| shipped | on0 | 0.917 | 0.804 | 0.917 | 0.895 | 0.50 | 0.00 | 0.50 | 12.22 (ls6276) | 0.18 (ls5570) |
| shipped | on0L | 0.908 | 0.797 | 0.908 | 0.895 | 0.45 | 0.01 | 0.44 | 12.24 (ls6276) | 0.36 (ls5570) |
| shipped | T30 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 (ls1473) | 0.00 (ls3196) |
| shipped | T60 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 (ls1473) | 0.00 (ls3196) |
| shipped | T120 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 (ls1473) | 0.00 (ls3196) |
| shipped | pooled | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 (ls1473) | 0.00 (ls3196) |
| S0 | on0 | 0.918 | 0.811 | 0.918 | 0.888 | 1.46 | 0.66 | 0.80 | 17.50 (ls2946) | 13.19 (ls5570) |
| S0 | T30 | 0.918 | 0.808 | 0.918 | 0.885 | 1.49 | 0.70 | 0.79 | 18.75 (ls2946) | 13.69 (ls5570) |
| S0 | T60 | 0.918 | 0.808 | 0.918 | 0.888 | 1.65 | 0.78 | 0.87 | 21.14 (ls2946) | 15.39 (ls5570) |
| S0 | T120 | 0.918 | 0.804 | 0.918 | 0.888 | 1.68 | 1.00 | 0.68 | 20.00 (ls2946) | 20.52 (ls5570) |
| S0 | pooled | 0.918 | 0.807 | 0.918 | 0.887 | 1.61 | 0.83 | 0.78 | 19.96 (ls2946) | 16.53 (ls5570) |
| F4-Q5 | T30 | 0.890 | 0.797 | 0.899 | 0.878 | 0.48 | 0.00 | 0.48 | 12.57 (ls6276) | 0.00 (ls3196) |
| F4-Q5 | T60 | 0.871 | 0.787 | 0.890 | 0.874 | 0.35 | 0.02 | 0.33 | 13.27 (ls6276) | 1.03 (mlsit13092) |
| F4-Q5 | T120 | 0.853 | 0.783 | 0.890 | 0.857 | 0.09 | 0.00 | 0.09 | 2.78 (ls2946) | 0.00 (ls3196) |
| F4-Q5 | pooled | 0.871 | 0.789 | 0.893 | 0.870 | 0.31 | 0.01 | 0.30 | 8.61 (ls6276) | 0.34 (mlsit13092) |

Bars: hits ≥ 0.867 male base and ≥ 0.754 female base (the shipped on0 rule
− 0.05).

F4-Q5 hits within 10 s per phase (hit sessions of the failure set,
j0 / j1 / j2 / j3):

| Base sex | on0 | T30 | T60 | T120 |
|---|---|---|---|---|
| Male | 25/27, 26/28, 24/27, 25/27 | 24, 25, 23, 25 | 24, 25, 23, 23 | 23, 25, 22, 23 |
| Female | 57/71, 58/73, 56/70, 59/72 | 56, 57, 57, 58 | 56, 56, 55, 58 | 55, 56, 56, 57 |

**Bar for F4-Q5: 29 of 30.** The one failed check is **male-base hits
within 10 s at T120: 0.853 vs 0.867**, the same check it failed on dev.
Every other check passes:

- Male-base hits: T30 0.890, T60 0.871, pooled 0.871.
- Female-base hits: 0.797 / 0.787 / 0.783 at T30 / T60 / T120, pooled
  0.789.
- Natural false alarms: men ≤ 0.48 %, women ≤ 0.02 %; gap ≤ 0.48 pp.
- Per-reader maximum: men ≤ 13.27 % (ls6276, who has 12.22 % under the
  shipped rule with the panel on from 0), women ≤ 1.03 %.
- Both identity checks pass.

**Descriptive (not in the bar; nothing re-tuned on it).**

- *The miss comes from the late panel, not the fallback.* Every candidate
  replayed on the test sessions has the same male-base T120 hit rate,
  0.853, F2 included, which drops the DS gate entirely (the other
  candidates' test rows are below). At T120 the panel's KP8 history and
  its gender worker start at switch-on (120–121.5 s; model ready by
  ~129.5 s), and the shift comes only ~40–60 s after the model is ready. No DS-gate fallback of
  this family could have passed that check on this pool.
- *Post hoc, descriptive (added 2026-10-12 after review; nothing re-tuned
  or re-scored against the bar):* replaying the shipped module (sha256
  `2a1f4022…`) without the DS gate and without KP8 on the four sessions
  below recovers all 8 lost male-base phase-hits at T120 (warning 3.3–8.6 s
  after the shift); without the DS gate alone, none of them (the same
  misses as F2; hcsL_mlssp8882_PO warns at 12.4–13.8 s). The T120 loss
  comes from KP8's late-started quiet history, not from the fallback or
  the gender worker. S0, which has no KP8, keeps its hits at T120 (below).
- Male-base sessions the on0 panel hits and F4-Q5 at T120 misses:
  - hcsL_ls4687_PO (j0), hcsL_ls2946_PO (j2) and hcsL_ls4039_PO (j2, j3)
    do not warn after the shift.
  - hcsL_mlssp8882_PO (j0–j3) warns 12.4–13.8 s after the shift, so
    within 15 s.

  One phase gains: hcsL_ls4196_PO, j2.
- *What the fallback would have bought.* With the shipped rule a late
  panel never warns: hits 0.000 at T30 / T60 / T120 for both base sexes
  on test (dev 0.017 / 0.013 at T30, from the 62 T30 panels that still got
  a start share). F4-Q5 restores 0.853–0.890 (male base) and 0.783–0.797
  (female base) within 10 s, and 0.890–0.899 / 0.857–0.878 within 15 s.
  Its natural false alarms stay at or below the shipped on0 level (men
  0.09–0.48 % vs 0.50 %, women 0.00–0.02 % vs 0.00 %). F2 (no DS gate)
  has the same hits, with more false alarms, women's especially: pooled
  men 0.61 %, women 0.40 %, reader max 14.97 % / 7.41 %. S0 (descriptive)
  keeps its hits at every switch-on time (male base 0.918, female base
  0.804–0.811), with pooled late-panel false alarms of men 1.61 % and
  women 0.83 % (reader max 19.96 % / 16.53 %).

Other candidates on the test pool (descriptive):

| Rule | Condition | Hits ≤ 10 s, male base | Hits ≤ 10 s, female base | Hits ≤ 15 s, male base | Hits ≤ 15 s, female base | Nat. FA men % | Nat. FA women % | \|M − F\| pp | Reader max men % | Reader max women % |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | T30 | 0.890 | 0.797 | 0.899 | 0.878 | 0.48 | 0.00 | 0.48 | 12.57 (ls6276) | 0.00 (ls3196) |
| F1 | T60 | 0.871 | 0.787 | 0.890 | 0.874 | 0.34 | 0.02 | 0.32 | 13.27 (ls6276) | 1.03 (mlsit13092) |
| F1 | T120 | 0.853 | 0.783 | 0.890 | 0.857 | 0.08 | 0.00 | 0.08 | 2.50 (ls2946) | 0.00 (ls3196) |
| F1 | pooled | 0.871 | 0.789 | 0.893 | 0.870 | 0.30 | 0.01 | 0.29 | 8.61 (ls6276) | 0.34 (mlsit13092) |
| F2 | T30 | 0.890 | 0.797 | 0.899 | 0.878 | 0.65 | 0.46 | 0.19 | 14.93 (ls6276) | 11.25 (ls5570) |
| F2 | T60 | 0.871 | 0.787 | 0.890 | 0.874 | 0.57 | 0.46 | 0.11 | 15.59 (ls6276) | 10.97 (ls5570) |
| F2 | T120 | 0.853 | 0.794 | 0.890 | 0.857 | 0.62 | 0.27 | 0.35 | 14.39 (ls6276) | 5.71 (ls5569) |
| F2 | pooled | 0.871 | 0.793 | 0.893 | 0.870 | 0.61 | 0.40 | 0.21 | 14.97 (ls6276) | 7.41 (ls5570) |
| F3-5 | T30 | 0.890 | 0.797 | 0.899 | 0.878 | 0.48 | 0.00 | 0.48 | 12.57 (ls6276) | 0.00 (ls3196) |
| F3-5 | T60 | 0.871 | 0.787 | 0.890 | 0.874 | 0.34 | 0.02 | 0.32 | 13.27 (ls6276) | 1.03 (mlsit13092) |
| F3-5 | T120 | 0.853 | 0.783 | 0.890 | 0.857 | 0.08 | 0.00 | 0.08 | 2.50 (ls2946) | 0.00 (ls3196) |
| F3-5 | pooled | 0.871 | 0.789 | 0.893 | 0.870 | 0.30 | 0.01 | 0.29 | 8.61 (ls6276) | 0.34 (mlsit13092) |
| F3-10 | T30 | 0.890 | 0.797 | 0.899 | 0.878 | 0.49 | 0.00 | 0.49 | 12.83 (ls6276) | 0.00 (ls3196) |
| F3-10 | T60 | 0.871 | 0.787 | 0.890 | 0.874 | 0.34 | 0.02 | 0.32 | 13.27 (ls6276) | 1.03 (mlsit13092) |
| F3-10 | T120 | 0.853 | 0.783 | 0.890 | 0.857 | 0.08 | 0.00 | 0.08 | 2.50 (ls2946) | 0.00 (ls3196) |
| F3-10 | pooled | 0.871 | 0.789 | 0.893 | 0.870 | 0.30 | 0.01 | 0.30 | 8.70 (ls6276) | 0.34 (mlsit13092) |

**Consequence.** The pre-registered bar decides (PREREG §6), so the
shipped rule stays: a panel switched on after the start window has
closed still cannot show the pitch-only warning until stop / start
listening or a cue restart, and the
"More" line still says so ("The note about pitch-only changes needs this
panel to be on, and finished loading, when you start talking: if you turn
it on after you've started, the note may not appear until you stop and
start listening again."). Any next attempt needs a new pre-registration
and fresh speakers; nothing here was tuned on the test pool. The
binding limit on this pool is the T120 case: KP8's quiet history starts
at switch-on (post-hoc replay above), while the bar compares against a
panel that had been on for two minutes. A next pre-registration needs a
KP8 fallback as well as a DS fallback (for example seeding the KP8
history from the posted pitch frames), or a hit reference a late panel
can reach.

Tooling (scratch, not committed): the harness (`session_late.mjs`,
`replay_late.mjs`, `late-variants.js`, `indep_late.py`) and
`late_eval.py`, with their sha256 in PREREG §9 (Appendix G).

### 8.8 Late switch-on, round 2: a KP8 fallback as well — pre-registered, confirmation FAILED; the shipped rule is kept (2026-10-13)

User decision (2026-10-12): one more round that also gives KP8 a late-panel
fallback (for example seeded from the pitch the app already tracks), with
§8.7's bar unchanged and a brand-new fresh pool. Public data only
(LibriSpeech, Multilingual LibriSpeech — CC BY 4.0); no private recordings.
Every number below is per sex. **Verdict: FAIL, 29 of 30 checks.** The
chosen rule, KS-Q5, passed every hit check (including men's hits with the
panel switched on at ~120 s, the check §8.7 failed), but one man's natural
false-alarm rate at that switch-on time was 16.76 % against the 15 % limit.
**`src/ml/pitch-only-warning.js` is unchanged (A40+KP8-3+DS10, module
sha256 `2a1f4022…`), and so is the panel's "More" line about turning the
panel on before you start talking.**

**Mechanism.** §8.7 found two things a late panel lacks: DS10's start
share (empty, so the DS gate fails), and, post hoc, KP8's quiet history,
which is built from shown panel updates only and so starts at switch-on;
that late history cost men's hits at T120. Before a late switch-on the
warning object already has, from the start of listening:

- every posted pitch frame (time, and the pitch when voiced; `addPitch`
  from the hook's `handlePitchMessage`);
- every resonance post (u, startU, fill, the utterance-gate verdict,
  sinceResumeS).

It has no classifier output, because the gender worker runs only while the
panel is on. So KP8's history can be seeded from the posted pitch frames
(plus the resonance verdict for the panel's "sustained" hide rule), but
the DS start share cannot. DS keeps round 1's fallbacks after switch-on,
or none.

**Pre-registration, choice and outputs** (PREREG and CHOICE verbatim in
Appendices I and J). Each sha256 was appended, when the file was written,
to a hash log outside the scratch folder; times are −05:00.

- PREREG.md sha256
  `dd3cf7bc6c211f1bf576e6e27f04d9942826e382f791752c55de77c50d279785`,
  logged 2026-10-12 21:14:16, before any round-2 candidate was scored on
  any session and before anything of the fresh pool existed. Its §11 fixes
  the sha256 of 44 harness, input and tool files; `late_eval_r2.py check`
  verified them before the dev run, the pool build and the test.
- CHOICE.md sha256
  `17b948d9b2e00665c33b2a7db52a4e22b3031fc825846848b22cc44480816ef9`,
  written by `late_eval_r2.py dev` and logged 21:21:13, with the dev tables
  in it (`dev_table.md` `1f007c85…` 21:21:12, `dev_table.csv` `9cad1032…`
  and `dev_bars.json` `7ca2de7e…` 21:21:13). The first fresh-pool file (a
  download) was created at 21:24:46.
- Fresh pool: `pool.json` `b5642f68…` and `jobs_test_all.json`
  `7849ac8c…` (22:34:16), `run_test.sh` `6e33e834…` (22:34:33; also fixed
  in PREREG §11).
- Test output `test_result.md` sha256
  `5d196daf8dc1f5021cffc06f384bddeac4278f0722abc3e1c96eddb112b7c320`,
  written and logged by `late_eval_r2.py test` at 2026-10-13 01:29:02.
- Notes: `DEV_NOTES.md` `b625b815…` (2026-10-12 21:22:37),
  `DEVIATIONS_pool.md` `c53f5c13…` (22:35:44), the confirmation write-up
  `RESULT.md` `191b585f…` and `DEVIATIONS_confirm.md` `6a8a7915…`
  (2026-10-13 01:33:30).

**Harness.** §8.7's, with the chain harness `session_late.mjs`
byte-identical (sha256 `14cc38df…`): the same conditions (on0, on0L, T30,
T60, T120, four phases each) and the deployed q8-v2 classifier. New:

- `late-variants-r2.js`: the candidates, generated from the shipped module
  by asserted exact string replacements (with no fallback it is the shipped
  code path);
- `replay_r2.mjs`: drives the shipped copy, the repo module (cue-strip
  4c81fea, sha256 asserted), the variants with no fallback, S0, the six
  candidates and round 1's F4-Q5 over each panel's recorded call stream;
- `indep_r2.py`: an independent Python implementation from the rule text;
- `late_eval_r2.py`: round 1's outcome definitions, unchanged.

Checks before registration (counts only, no outcome):

- Replay parity on both dev pools (625,687 and 621,135 updates): the
  shipped copy, the repo module and the variants with no fallback equal
  the live shipped column, and S0 the live S0 column: 0 mismatches.
- Identity: every candidate equals the shipped rule on on0 + on0L
  (299,233 / 297,218 updates) and before its first triggered update
  (308,026 / 301,168): 0 mismatches.
- Round 1's five candidates rebuilt from the new variants file equal
  round 1's recorded strings on every update: 0 mismatches.
- `indep_r2.py` vs the JS on three samples (16,619, 17,478 and 17,248
  updates; the seed taken on 155, 92 and 96 panels): 0 on/off and 0 state
  mismatches (thresholds and history lengths included).
- The outcome code equals round 1's `late_eval.py` on 306 values per pool
  (shipped, S0, F4-Q5): 0 differ.
- Seed sanity check (non-study sessions, panel on from 0): the seeded
  threshold tracks the panel's own; median difference per session
  0.00–0.28 st, at most 1.22 st.

**Candidates.** Every candidate uses §8.7's trigger unchanged: it departs
from the shipped rule only at an update where the start window has closed,
the start share is empty, and the panel's first `update()` since creation
or `reset()` came after t_fill (a cue restart keeps that flag). With the
panel on from the start it is the shipped rule. KP8 options:

- **K-seed.** From creation or `reset()` the module keeps a shadow KP8
  history. At every 2 s of audio clock (computed when the first later
  posted frame arrives, so only earlier frames are used) a pseudo update
  takes lnF0 = ln of the median of the posted voiced frames in the last
  8 s. It counts as shown when those frames' voiced time is ≥ 3 s (frame
  gaps capped at 100 ms), the newest voiced frame is ≤ 5 s old, F0 is
  81–293.1 Hz and the latest resonance verdict is not "sustained": the
  panel's own pooling window and hide rules, without the classifier. Shown
  pseudo updates go through the shipped KP8 bookkeeping: before t_start
  they pend and are back-filled against S0's P0; after it, |ΔP| from the
  A40 reference is kept if it is below the shadow's own max(4 st, 3 × RMS)
  (once it holds ≥ 5 values). At the first triggered update the shadow's
  history and pending values replace the panel's; after that the panel's
  shown updates add to it as shipped. A cue restart clears it.
- **K-hold-20.** KP8 held at 4 st until the panel's own quiet history has
  20 values, then as shipped.
- **K-off.** A fixed 4 st at triggered updates (no KP8).

DS options (round 1's): **Q5** = round 1's F4-Q5 (the median of ≥ 5
"quiet" shown shares collected for ≥ 20 s from the first shown update
after the start window; no warning while the window is open), **F1**
(every shown share in that 20 s), **N** (no DS gate).

| Name | KP8 | DS |
|---|---|---|
| `KS-Q5` | K-seed | Q5 |
| `KS-F1` | K-seed | F1 |
| `KH20-Q5` | K-hold-20 | Q5 |
| `KO-Q5` | K-off | Q5 |
| `KO-F1` | K-off | F1 |
| `KS-N` | K-seed | none |

Round 1's F4-Q5 (`R1-F4-Q5`) is replayed as a descriptive row only.

**The bar** (§8.7's 30 checks, unchanged; all required on the evaluated
pool). For T30, T60, T120 and their pooled values:

- Hits within 10 s per base sex ≥ the shipped rule's hits with the panel
  on from 0 (`on0`) on the same sessions − 0.05.
- Natural false alarms ≤ 2 % per sex.
- \|men − women\| ≤ 1.5 pp.
- Per-reader maximum ≤ 15 % per sex.

Plus identity on every on0 update and on every update before the trigger.

**Dev.** A replay, not a chain run: the candidates change only the warning
module, which never feeds back into the chain, so round 1's recorded chain
outputs (deployed q8-v2 classifier) were replayed. Two pools, each scored
on the 30 checks against its own on0 hit reference (60 checks):

- **Pool A**: round 1's dev pool (96 speakers, 48 per sex; 288 sessions,
  73,827 s of audio).
- **Pool B**: round 1's spent fresh test pool (48 + 48 speakers; 288
  sessions, 73,561 s). Dev only here, because round 1's result on it
  shaped this round's candidates.

`run_dev.sh` ran once, 21:15–21:21. Parity was 0 on both pools; identity
was 0 mismatches for every candidate.

| Candidate | Dev checks passed (A + B, of 60) | Failing checks |
|---|---|---|
| KS-Q5 | 60 (30 + 30) | none |
| KS-F1 | 60 (30 + 30) | none |
| KH20-Q5 | 58 (28 + 30) | A: men's reader max at T30 17.75 % (ls3541); male-base hits at T120 0.800 vs 0.802 |
| KO-Q5 | 56 (26 + 30) | A: men's reader max 37.02 / 32.40 / 35.58 / 35.00 % at T30 / T60 / T120 / pooled (ls3541) |
| KO-F1 | 56 (26 + 30) | A: men's reader max 36.64 / 23.54 / 29.98 / 30.05 % (ls3541) |
| KS-N | 56 (30 + 26) | B: men's reader max 15.46 / 16.73 % at T30 / T60 and 15.52 % pooled (ls6276); women's 18.26 % at T120 (ls5570) |

Dev, pooled over T30 / T60 / T120 (pool A ; pool B):

| Rule | Hits ≤ 10 s, male base | Hits ≤ 10 s, female base | Nat. FA men % | Nat. FA women % | Reader max men % | Reader max women % |
|---|---|---|---|---|---|---|
| KS-Q5 | 0.846 ; 0.908 | 0.786 ; 0.802 | 0.12 ; 0.37 | 0.03 ; 0.00 | 3.06 ; 8.71 | 0.84 ; 0.21 |
| KS-F1 | 0.846 ; 0.908 | 0.786 ; 0.802 | 0.12 ; 0.37 | 0.03 ; 0.00 | 2.95 ; 8.83 | 0.84 ; 0.21 |
| KH20-Q5 | 0.846 ; 0.890 | 0.777 ; 0.789 | 0.38 ; 0.35 | 0.04 ; 0.01 | 14.35 ; 8.61 | 1.08 ; 0.34 |
| KO-Q5 | 0.864 ; 0.936 | 0.802 ; 0.815 | 1.02 ; 0.81 | 0.15 ; 0.01 | 35.00 ; 11.26 | 3.78 ; 0.48 |
| KO-F1 | 0.864 ; 0.936 | 0.802 ; 0.815 | 0.89 ; 0.73 | 0.14 ; 0.01 | 30.05 ; 9.41 | 3.78 ; 0.48 |
| KS-N | 0.852 ; 0.908 | 0.788 ; 0.805 | 0.19 ; 0.74 | 0.10 ; 0.57 | 4.64 ; 15.52 | 2.40 ; 14.66 |
| R1-F4-Q5 (descriptive) | 0.829 ; 0.871 | 0.777 ; 0.789 | 0.19 ; 0.31 | 0.02 ; 0.01 | 5.35 ; 8.61 | 0.54 ; 0.34 |
| shipped, panel on from 0 (on0) | 0.852 ; 0.917 | 0.778 ; 0.804 | 0.19 ; 0.50 | 0.05 ; 0.00 | 3.35 ; 12.22 | 1.93 ; 0.18 |

Hit bars: male base 0.802 (A) / 0.867 (B), female base 0.728 / 0.754.

KS-Q5 on dev per switch-on time (reader with the maximum in brackets;
none named where every reader of that sex is at 0.00 %):

| Pool | Condition | Hits ≤ 10 s, male base | Hits ≤ 10 s, female base | Hits ≤ 15 s, male base | Hits ≤ 15 s, female base | Nat. FA men % | Nat. FA women % | \|M − F\| pp | Reader max men % | Reader max women % |
|---|---|---|---|---|---|---|---|---|---|---|
| A | T30 | 0.852 | 0.784 | 0.896 | 0.892 | 0.13 | 0.07 | 0.06 | 3.77 (mlsdu4396) | 2.52 (ls7717) |
| A | T60 | 0.852 | 0.784 | 0.896 | 0.899 | 0.15 | 0.02 | 0.13 | 4.07 (mlsdu4396) | 0.85 (ls5968) |
| A | T120 | 0.835 | 0.788 | 0.879 | 0.899 | 0.09 | 0.00 | 0.09 | 1.68 (ls4010) | 0.00 |
| A | pooled | 0.846 | 0.786 | 0.890 | 0.897 | 0.12 | 0.03 | 0.09 | 3.06 (mlsdu4396) | 0.84 (ls7717) |
| B | T30 | 0.908 | 0.804 | 0.908 | 0.892 | 0.51 | 0.00 | 0.51 | 12.57 (ls6276) | 0.00 |
| B | T60 | 0.899 | 0.801 | 0.899 | 0.892 | 0.42 | 0.01 | 0.41 | 13.55 (ls6276) | 0.62 (mlsit13092) |
| B | T120 | 0.917 | 0.801 | 0.927 | 0.892 | 0.19 | 0.00 | 0.19 | 3.78 (mlsit4998) | 0.00 |
| B | pooled | 0.908 | 0.802 | 0.911 | 0.892 | 0.37 | 0.00 | 0.37 | 8.71 (ls6276) | 0.21 (mlsit13092) |

**The choice.** KS-Q5 and KS-F1 both pass all 60 dev checks. They tie on
the next two keys of the pre-registered order: the smallest pooled hit
rate (0.786, rounded to 0.79) and the largest pooled natural FA (0.374 %
vs 0.370 %, both 0.004 rounded). The fourth key, the largest pooled
per-reader maximum, decides: KS-Q5 8.71 % vs KS-F1 8.83 % (pool B men,
ls6276), a 0.12 pp margin. The two differ only in the DS window; the KP8
seed is the same. Round 1's F4-Q5 again fails men's hits at T120 on both
pools (0.774 vs 0.802 on A; 0.853 vs 0.867 on B, round 1's test failure);
KS-Q5 has 0.835 and 0.917 there.

**Fresh test pool** (PREREG §2.3; built once by `build_pool.sh` after
CHOICE.md, 2026-10-12 21:24–22:34).

- Sources no earlier study downloaded: LibriSpeech train-other-500 shards
  0026–0033 and train-clean-360 shards 0020–0027; the second MLS train
  parquet of fr / es / it / nl / pt / pl (22 parquet files, 10.5 GB).
  OpenSLR 83 was dropped (round 1 found all of its speakers listed by an
  earlier study). The reserve shard sets were not needed.
- 371 candidates (176 women, 195 men). Excluded: 155 by the over-inclusive
  id scan and the explicit earlier-pool lists, 16 with under 330 s of
  audio, 1 with no drift value: 199 eligible (92 women, 107 men).
- Drift-stratified with round 2's tercile boundaries (§8.5), 16 per
  stratum: **48 women, 48 men** (LS-other 20 / 20, LS-clean 18 / 18, MLS
  10 / 10). 0 id overlap with both dev pools and with all 192 speakers of
  the men's-FA round-2 pool.
- Drift D: women median 0.452 st (q90 0.917, 3 with D ≥ 1); men median
  0.601 st (q90 1.163, 11 with D ≥ 1). Median F0 over the first 120 s:
  women 204 Hz (151–244 Hz), men 118 Hz (95–209 Hz).
- 288 sessions (natL 96, hcsL 96, pickaL 96), 73,818 s of audio.

**Test run** (once, `run_test.sh`, 2026-10-12 22:39 – 2026-10-13 01:29,
2 shards, deployed q8-v2 classifier).

- Replay parity: 623,320 updates, 0 mismatches (shipped copy, repo module,
  variants with no fallback, S0, held, pitchStart).
- Identity: on0 149,107, on0L 149,065 and 306,625 updates before the first
  trigger: 0 mismatches for every candidate.
- Panels on the trigger path: T30 1,095 / 1,152, T60 and T120
  1,152 / 1,152; on0 and on0L 0.
- Failure sets per phase: male base 32 / 31 / 32 / 32, female base
  66 / 66 / 67 / 65.

Test table (`test_result.md`; phase-averaged; only KS-Q5 is judged; its
on0 / on0L rows equal the shipped rule's):

| Rule | Condition | Hits ≤ 10 s, male base | Hits ≤ 10 s, female base | Hits ≤ 15 s, male base | Hits ≤ 15 s, female base | Nat. FA men % | Nat. FA women % | \|M − F\| pp | Reader max men % | Reader max women % |
|---|---|---|---|---|---|---|---|---|---|---|
| shipped | on0 | 0.929 | 0.746 | 0.961 | 0.833 | 0.36 | 0.01 | 0.35 | 11.84 (ls3792) | 0.52 (ls3094) |
| shipped | on0L | 0.929 | 0.731 | 0.961 | 0.833 | 0.36 | 0.01 | 0.35 | 11.84 (ls3792) | 0.52 (ls3094) |
| shipped | T30 | 0.103 | 0.004 | 0.103 | 0.004 | 0.02 | 0.00 | 0.02 | 0.71 (ls2854) | 0.00 |
| shipped | T60 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| shipped | T120 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| shipped | pooled | 0.034 | 0.001 | 0.034 | 0.001 | 0.01 | 0.00 | 0.01 | 0.24 (ls2854) | 0.00 |
| S0 | on0 | 0.913 | 0.769 | 0.945 | 0.860 | 0.65 | 0.35 | 0.30 | 13.85 (ls3792) | 7.91 (ls3119) |
| S0 | T30 | 0.921 | 0.773 | 0.945 | 0.860 | 0.67 | 0.35 | 0.31 | 14.34 (ls3792) | 8.17 (ls3119) |
| S0 | T60 | 0.913 | 0.773 | 0.945 | 0.860 | 0.73 | 0.40 | 0.33 | 16.10 (ls3792) | 9.26 (ls3119) |
| S0 | T120 | 0.913 | 0.769 | 0.937 | 0.860 | 0.83 | 0.46 | 0.38 | 21.59 (ls3792) | 12.81 (ls3119) |
| S0 | pooled | 0.916 | 0.771 | 0.942 | 0.860 | 0.74 | 0.40 | 0.34 | 17.35 (ls3792) | 10.08 (ls3119) |
| **KS-Q5** | T30 | 0.945 | 0.750 | 0.961 | 0.833 | 0.34 | 0.01 | 0.33 | 12.45 (ls3792) | 0.54 (ls3094) |
| **KS-Q5** | T60 | 0.937 | 0.742 | 0.961 | 0.829 | 0.37 | 0.00 | 0.37 | 14.19 (ls3792) | 0.00 |
| **KS-Q5** | T120 | 0.921 | 0.746 | 0.937 | 0.833 | 0.39 | 0.02 | 0.38 | **16.76 (ls3792)** | 0.80 (ls3094) |
| **KS-Q5** | pooled | 0.935 | 0.746 | 0.953 | 0.832 | 0.37 | 0.01 | 0.36 | 14.47 (ls3792) | 0.45 (ls3094) |

Bars: hits ≥ 0.879 male base and ≥ 0.696 female base (the shipped on0
rule − 0.05). Where every reader of a sex is at 0.00 %, no reader is named.

KS-Q5 hits within 10 s per phase (hit sessions of the failure set,
j0 / j1 / j2 / j3):

| Base sex | on0 | T30 | T60 | T120 |
|---|---|---|---|---|
| Male | 30/32, 29/31, 29/32, 30/32 | 30, 30, 30, 30 | 30, 30, 29, 30 | 30, 29, 28, 30 |
| Female | 46/66, 49/66, 52/67, 50/65 | 46, 50, 52, 50 | 46, 50, 51, 49 | 46, 50, 51, 50 |

Median time to the first warning after the shift, KS-Q5 at T30 / T60 /
T120: men 7.2 s, women 8.2 s (shipped on0: men 7.2 s, women 8.4 s).

**Bar for KS-Q5: 29 of 30.** The one failed check is **men's per-reader
natural false-alarm maximum at T120: 16.76 % against ≤ 15 %**, one reader
(ls3792); by hand from his four T120 panels,
(15/87 + 16/89 + 14/88 + 14/88) / 4 = 16.76 %. Every other check passes:

- Male-base hits: 0.945 / 0.937 / 0.921 at T30 / T60 / T120, pooled
  0.935 (bar 0.879).
- Female-base hits: 0.750 / 0.742 / 0.746, pooled 0.746 (bar 0.696).
- Natural false alarms: men 0.34–0.39 %, women 0.00–0.02 %; gap
  ≤ 0.38 pp.
- Per-reader maximum: men 12.45 / 14.19 % at T30 / T60 and 14.47 %
  pooled; women ≤ 0.80 %.
- Both identity checks.

Other candidates on the test pool (descriptive; values at T30 / T60 /
T120 / pooled):

| Rule | Hits ≤ 10 s, male base | Hits ≤ 10 s, female base | Nat. FA men % | Nat. FA women % | Reader max men % | Reader max women % |
|---|---|---|---|---|---|---|
| KS-F1 | 0.945 / 0.937 / 0.937 / 0.940 | 0.750 / 0.742 / 0.742 / 0.745 | 0.34 / 0.40 / 0.39 / 0.38 | 0.01 / 0.00 / 0.02 / 0.01 | 12.45 / 14.19 / 16.76 / 14.47 | 0.54 / 0.00 / 0.80 / 0.45 |
| KH20-Q5 | 0.937 / 0.929 / 0.882 / 0.916 | 0.735 / 0.716 / 0.708 / 0.720 | 0.36 / 0.36 / 0.37 / 0.36 | 0.01 / 0.00 / 0.01 / 0.01 | 12.45 / 14.19 / 16.48 / 14.37 | 0.54 / 0.00 / 0.27 / 0.27 |
| KO-Q5 | 0.945 / 0.937 / 0.921 / 0.935 | 0.777 / 0.769 / 0.769 / 0.771 | 0.40 / 0.44 / 0.48 / 0.44 | 0.02 / 0.03 / 0.02 / 0.02 | 12.45 / 14.19 / 16.76 / 14.47 | 0.54 / 0.83 / 0.80 / 0.45 |
| KO-F1 | 0.945 / 0.937 / 0.937 / 0.940 | 0.777 / 0.769 / 0.765 / 0.770 | 0.40 / 0.46 / 0.48 / 0.45 | 0.02 / 0.03 / 0.02 / 0.02 | 12.45 / 14.19 / 16.76 / 14.47 | 0.54 / 0.83 / 0.80 / 0.45 |
| KS-N | 0.945 / 0.937 / 0.937 / 0.940 | 0.750 / 0.754 / 0.750 / 0.751 | 0.40 / 0.48 / 0.55 / 0.48 | 0.09 / 0.10 / 0.10 / 0.09 | 14.91 / 16.53 / 22.16 / 17.87 | 2.23 / 2.53 / 3.34 / 2.70 |
| R1-F4-Q5 | 0.937 / 0.929 / 0.882 / 0.916 | 0.735 / 0.716 / 0.705 / 0.718 | 0.34 / 0.36 / 0.37 / 0.36 | 0.01 / 0.00 / 0.01 / 0.01 | 12.45 / 14.19 / 16.48 / 14.37 | 0.54 / 0.00 / 0.27 / 0.27 |

**Descriptive (post hoc, not pre-registered; nothing re-tuned or
re-scored against the bar).**

- *The seed did what it was built for.* Men's hits at T120 are 0.921 with
  KS-Q5 against 0.882 for round 1's F4-Q5 (history from switch-on) on this
  pool, and 0.917 against 0.853 on pool B. With the shipped rule a late
  panel almost never warns: male base 0.103 / 0.000 / 0.000 at T30 / T60 /
  T120, female base 0.004 / 0.000 / 0.000 (the 57 T30 panels that still
  got a start share).
- *The failing cell is one reader with fewer updates to divide by.*
  ls3792 (natL, ~315 s of reading; next man at T120 1.26 %, ls2654)
  raises his pitch 6.3–9.5 st above his A40 reference (104.6 Hz) in three
  stretches of natural reading (154–168 s, 224–234 s, 296–308 s). The
  drawn share falls there from ~0.95 to 0.64–0.82, and KP8's threshold
  stays at 4.00 st. So the warning shows on about the same updates under
  every rule that can warn: 16 / 17 / 16 / 16 (shipped rule, panel on from
  0, j0–j3) and 15 / 16 / 14 / 14 (KS-Q5 at T120), none before 150 s.
  With the panel on from 0 he has 135–139 eligible updates (11.84 %); a
  panel switched on at ~120 s has 87–89 (16.76 %). At T30 he is at
  12.45 %, at T60 14.19 %.
- *Not the seed or the fallback share.* His start share with the panel
  on from 0 is 0.951–0.953; KS-Q5's fallback share at T120 is 0.947–0.950
  (closed at 152–156 s after 9–11 quiet shares). R1-F4-Q5 and KH20-Q5 give
  him 16.48 % at T120, KO-Q5, KO-F1 and KS-F1 16.76 %, KS-N 22.16 %, S0
  21.59 %. Replaying the shipped module from the repo on his four T120
  panels: as shipped 0 % (no start share), without DS 19.3 %, without DS
  and KP8 22.2 %. Every rule that can warn on a late panel puts him above
  15 % at T120, so no candidate in this family could have passed that
  check on this pool: the per-reader maximum is a share of eligible
  updates, and a late panel has fewer.
- *Same span (added 2026-10-13 after review).* Scored only over the span
  each T120 panel covers (eligible updates from 130.0 / 130.5 / 133.1 /
  133.5 s), the shipped rule with the panel on from 0 warns him on
  16/87, 17/88, 16/87 and 16/88 updates: 18.57 %, above both the 15 %
  limit and KS-Q5's 16.76 % over the same stretch (15/87, 16/89, 14/88,
  14/88). KS-Q5 warns him slightly less often, not more: 59 against 65
  warnings over the four phases. The 11.84 % with the panel on from the
  start includes his first ~130 s, which have no warning; a late panel's
  eligible updates leave them out. The bar's per-reader maximum is scored
  only after switch-on, so it is stricter for a reader whose natural
  pitch excursions come late. That is a property of the unchanged bar,
  not of this round, and it does not change the FAIL (`fix/same_window.py`,
  sha256 `bdc8272d…`; output `fix/same_window_ls3792.txt`, both in the
  hash log).
- *Passing cells.* At T120 KS-Q5 loses 2 male-base phase-hits against
  shipped-on0 and gains 1. The losses are hcsL_ls2473_PO in j1 and j2: the
  shift came 55 s after switch-on, and the Q5 window had only 3–4 of the
  5 quiet shares it needs, so it never closed (KS-F1 and KS-N warn there at
  7.3–7.9 s). The gain is hcsL_ls6346_PO in j1. Female base: −2 / −2 / −2
  and +3 / +1 / +2 phase-hits at T30 / T60 / T120; the losses are mostly
  pickaL_ls3926 (−6 st), whose first warning comes at 10.05–10.5 s, just
  outside 10 s.

**Deviations** (in DEV_NOTES.md, DEVIATIONS_pool.md and
DEVIATIONS_confirm.md; none changes the choice or the verdict):

- Dev: the frozen `late_eval_r2.py dev` hashes only the dev tables,
  `dev_bars.json` and CHOICE.md. The replay outputs, features files, logs,
  console output and CHOICE.sha256 were hashed by hand at 21:21:40, up to
  ~1.5 min after each was written and before any was read. Three files
  were added (console output, start / end time, and a descriptive helper
  run after the choice); all are in the hash log.
- Pool build: `build_pool.sh` hashes `pool.json`, `strata.json`,
  `used_speakers.json`, `candidates.json` and `jobs_test_all.json` itself;
  the other build files and logs were hashed by hand at 22:34:33–35,
  before any was read. A descriptive pool-summary helper was added (not
  pre-registered). The over-inclusive scan also excludes numeric id 2026,
  because ISO dates in earlier files match its pattern (by design).
- Test: `test_started_at.txt` was hashed at 22:43:14 with only the start
  time, then again at 01:29:13 after the pre-set command appended the end
  time, so the first log entry no longer matches the file. The chain
  outputs were hashed 4–5 min after they were written (01:28:41–43) and
  the replay, features and evaluation logs 11 s after the evaluation
  ended, all before they were read. The checking and attribution tools
  were not pre-registered: those written before the test outputs existed
  were hashed at 22:43–22:44; two (`attrib_reader.mjs`, `attrib_times.py`)
  were written after the verdict, for the post-hoc attribution only. One
  launch of `attrib_times.py` failed on a wrong path before running.
- Hash log at the confirmation: all 72 entries made before the test
  matched the files on disk; afterwards 109 of 110 match. Only the
  22:43:14 `test_started_at.txt` entry is stale (logged before the end
  time was appended); the 01:29:13 entry matches. **Corrected 2026-10-13
  after review:** the confirmation step's report and the first version
  of this note said 108, because `verify_hashlog.py` read the 01:29:13
  entry's "(start+end)" label as part of the path (DEVIATIONS_confirm.md
  §2 describes the two entries correctly and gives no count). The
  correction is recorded in `fix/DEVIATIONS_fix.md`; no hashed file was
  edited.
- Python that reads downloaded data ran with `-I` through a launcher that
  adds back only the fixed per-user site-packages path (numpy, pyarrow);
  this is in PREREG §2.3, not a deviation.

**Consequence.** The pre-registered bar decides (PREREG §6), so nothing
is adopted: the shipped rule stays, a panel switched on after the start
window has closed still cannot show the pitch-only warning until stop /
start listening or a cue restart, and the "More" line still says so. For
a user decision, the best candidate (KS-Q5, first by the pre-registered
order and the only one tested) on the fresh pool:

- Panel switched on late (T30 / T60 / T120), hits within 10 s: male base
  0.945 / 0.937 / 0.921, pooled 0.935 (the shipped rule with the panel on
  from the start: 0.929); female base 0.750 / 0.742 / 0.746, pooled 0.746
  (0.746). Within 15 s, pooled: 0.953 male base, 0.832 female base. First
  warning a median 7.2 s (men) and 8.2 s (women) after the shift.
- Natural false alarms: men 0.34–0.39 % (panel on from the start 0.36 %),
  women 0.00–0.02 % (0.01 %). Worst man 12.45 / 14.19 / 16.76 % at T30 /
  T60 / T120, the same reader who has 11.84 % with the panel on from the
  start; worst woman ≤ 0.80 % (0.52 %).
- Without it a late panel almost never warns (male base 0.000–0.103,
  female base 0.000–0.004).
- With the panel on from the start it is the shipped rule tick for tick
  (0 mismatches on 149,107 on0 and 149,065 on0L updates).

Adopting it would be a user override of a recorded FAIL (as in §8.6).
PREREG §6.5 then sets the port: the FALLBACK blocks of
`late-variants-r2.js` in `src/ml/pitch-only-warning.js` with the K-seed
constants taken from HEARD_AS_CALIBRATION, a port-parity replay of the repo
module against `late-variants-r2.js` on the test sessions (0 mismatches),
and the panel's "More" lines updated to these numbers. Post hoc (see the
descriptive block above, not pre-registered): on this pool every rule
that can warn on a late panel puts the same man above the per-reader
limit at T120, while the hit checks pass. Any further round needs its own
pre-registration and fresh speakers (see the review notes below).

Tooling (scratch, not committed): `late-variants-r2.js`,
`make_variants_r2.py`, `replay_r2.mjs`, `indep_r2.py`, `seed_diag.mjs`,
`iso.py` and `late_eval_r2.py`, with round 1's `session_late.mjs`; their
sha256 are in PREREG §11 (Appendix I).

**Review notes (2026-10-13).** Two independent reviews (validity, and
code / repo state) both found that the result holds, with small fixes;
they reproduced the tables, the choice, the hash order and the replay
with their own code. All their findings were low severity. Changed after
review:

- *Post-hoc labels.* The ls3792 explanation appeared without a post-hoc
  label in the CLAUDE.md row and at the end of the Consequence paragraph.
  Both are now labelled. The CLAUDE.md row also now says "about the same
  warnings": KS-Q5 at T120 gives him 59 warnings over the four phases,
  the shipped rule with the panel on from the start 65. Commit 098a401's
  message says "(the same warnings over 87-89 instead of 135-139 eligible
  updates; 11.84 % with the panel on from the start)" without a label; it
  is pushed, so it is left as it is and corrected here.
- *Same-window figure.* Added inside the descriptive block (18.57 %, see
  "Same span").
- *Hash-log count.* 109 of 110, not 108 (Deviations above).
- *Pointers.* The §8.6 follow-up bullet and the header now mention
  §8.7 and §8.8.

No change, with the reason:

- *Exclusion scan blind spots.* The pre-registered id scan
  (`fresh/tools/used_speakers.py`) reads only 12 file types under 8 MB,
  and its patterns miss a speaker id stored as a bare number in a CSV or JSON
  column. A reviewer closed these gaps by hand: files over 8 MB (222,
  5.8 GB, including every earlier study's session jsonl), 11,679 text
  files with other extensions, a wider pattern over the rest, every file
  and directory name, 651 parsed earlier speaker lists, and every Syrinx
  worktree. No fresh-pool speaker had been used by an earlier study, so
  the pool stands. A future round should add a bare-number column pattern
  and scan large files, or keep explicit per-study speaker lists as the
  primary exclusion.
- *Candidate strings before PREREG.* PREREG says no candidate outcome
  existed at registration. That holds for scored outcomes (hits, false
  alarms, bar). But the implementation-check replays written at
  20:53–20:58 (`impl_rep.json` on 16 non-study sessions,
  `sampleA_rep.json` and `sampleB_rep.json` on 8 sessions of each dev
  pool) hold the six candidates' per-update on/off strings. These are dev
  data only and cannot touch the fresh test. A future PREREG should say
  that its implementation checks contain candidate strings on N named dev
  sessions.
- *Two hashed files rewritten after hashing* (both disclosed in
  DEVIATIONS_confirm.md). `test_started_at.txt` gained its end time
  after the first hash. The debug copy `confirm/tmp/late-variants-r2-dbg.mjs`
  was rewritten with identical bytes, so its hash still matches. Neither
  feeds the verdict. In future, start and end times go to separate files,
  and debug copies go outside hashed paths.
- *Per-reader maximum after switch-on.* The same-window figure shows
  that the bar's per-reader maximum, scored only after switch-on, is
  stricter for a reader whose natural pitch excursions come late. This
  round does not re-score anything. A future round that means to compare
  like with like should pre-register a window-matched per-reader
  reference (for example, the shipped rule with the panel on from 0,
  scored over the same span).
- *Found in review, older than this round: the module keeps every voiced
  pitch frame while the panel is off.* In `src/ml/pitch-only-warning.js`
  the `frames` buffer is emptied only in `refAt()`, which only `update()`
  calls, and only `HeardAsPanel` calls `update()`, only while the panel
  is on. The hook calls `addPitch()` for every posted pitch frame and
  `noteResonance()` for every resonance-cue state, whether or not the
  panel is on. So with the panel off (the default), every voiced frame
  after the cue's first fill is kept until stop / start, a cue restart, or
  an "overloaded" or "error" status from the resonance worker: up to 40
  small objects per second of voiced audio, about 144,000 per hour (a few
  MB; not measured). When the panel is switched on, the first `update()` scans the buffer
  once, freezes A40 and empties it. Not fixed here. A fix that freezes
  A40 inside `addPitch()` would change the module, so hard rule 3 applies:
  a replay-parity run showing the same warning strings comes first. It
  also matters for any KS-Q5 port, whose K-seed reads the same buffer.
  CLAUDE.md lists it under known issues.

### 8.9 Adopted 2026-10-13 by user decision: KS-Q5 + bounded pitch buffer

**Decision.** On 2026-10-13 the user adopted §8.8's chosen candidate
**KS-Q5** for the app, together with a fix for the pitch frames the module
keeps while the panel is off (§8.8, last review note), and asked for the
panel's "turn it on before you start talking" line to go. This overrides
§8.8's recorded verdict, which stays **FAIL, 29 of 30 checks**; this
section does not re-read the test. The precedent is §8.6: the verdict is
kept as recorded, and the facts behind it stay attached to the adoption.

This section is committed and pushed before any code change (Hard rule 3).
The code commit changes only what "What changes" below lists, and must meet
every "Acceptance requirement" below; its results are added to this
section. If a requirement cannot be met, the code is not committed and the
failure is reported for a user decision. No requirement is relaxed
afterwards.

**The failed check, with its same-window context** (§8.8, fresh test pool,
48 men and 48 women; a reader's natural false alarms = the share of their
eligible 2 s updates with the warning on, averaged over the four phases):

| Check | Bar | KS-Q5 | Context (shipped rule, panel on from the start) |
|---|---|---|---|
| Men's per-reader maximum, panel switched on at ~120 s (T120) | ≤ 15 % | **16.76 %** (ls3792: 15/87, 16/89, 14/88, 14/88) | 11.84 % over his whole session (135–139 eligible updates); **18.57 %** over the same span as his T120 panels (eligible updates from 130.0–133.5 s: 16/87, 17/88, 16/87, 16/88) |

- Post hoc, not pre-registered (§8.8, "Same span"): over that span KS-Q5
  warns him on 59 updates in the four phases, the shipped rule on 65. His
  three natural pitch rises (6.3–9.5 st above his reference) all come
  after 150 s, and a panel switched on at ~120 s has fewer eligible updates
  to divide them by.
- Next man at T120: 1.26 % (ls2654). Women: at most 0.80 % at every
  switch-on time.

**What the decision gains and costs, per sex** (§8.8 test pool, phase
averaged; a hit = a pitch-only shift warned within 10 s):

| | Men (male base) | Women (female base) |
|---|---|---|
| Hits, panel switched on at ~30 / 60 / 120 s, shipped rule | 0.103 / 0.000 / 0.000 | 0.004 / 0.000 / 0.000 |
| Hits, the same, KS-Q5 | 0.945 / 0.937 / 0.921 (pooled 0.935) | 0.750 / 0.742 / 0.746 (pooled 0.746) |
| Hits, panel on from the start (shipped = KS-Q5) | 0.929 | 0.746 |
| Hits within 15 s, KS-Q5, pooled over the switch-on times | 0.953 | 0.832 |
| Median time to the first warning after the shift, KS-Q5 late | 7.2 s | 8.2 s |
| Natural false alarms, KS-Q5 late (panel on from the start) | 0.34–0.39 % (0.36 %) | 0.00–0.02 % (0.01 %) |
| Worst reader, KS-Q5 at ~30 / 60 / 120 s (panel on from the start) | 12.45 / 14.19 / 16.76 % (11.84 %), all ls3792 | ≤ 0.80 % (0.52 %) |

The hit rates come from the 32 men and 37 women whose pitch-only sessions
are in the failure sets (31–32 men and 35–36 women per phase;
`fs_readers.txt` below). With the panel on from the start KS-Q5 is the
shipped rule tick for tick (0 differences on this pool's 149,107 on0 and
149,065 on0L updates, and on 299,233 and 297,218 on0 + on0L updates of dev
pools A and B).

**What the rule reads, and the smallest state that gives the same
answers.** Measured first on the recorded call streams (inputs only; no
rule was evaluated): the late-panel pools A, B and the round-2 fresh pool
(864 sessions, 17,280 panels, 1,870,142 updates) and §8.5's app-cadence
pools (2,972 sessions, 11,888 panels, 701,506 updates), with
`scan_streams.mjs` (outputs listed below).

| Input property | On the recorded streams |
|---|---|
| Posted pitch frames in time order | always (0 out of order); one every 25 ms |
| Posted frames in any 8 s span | at most 321 |
| An update's audio time earlier than the newest frame already passed to `addPitch` | never (0 of 2,571,648 updates). In the hook every write to the audio clock takes the maximum, and the pitch handler writes it right after `addPitch` |
| t_start − t_fill | median 20.4–21.4 s per pool, maximum 81.5 s; 16 panels (4 short §8.5 sessions) never reach t_start |
| Voiced frames in A40's window [t_fill − 2 s, max(t_start, t_fill + 40 s)] | median 981–1,049 per pool, maximum 1,450 |
| Resonance-cue restarts | none |
| Voiced frames the shipped module holds at the end of a session with the panel off | late-panel pools (sessions ≤ 325 s, 56–60 % of frames voiced): median 5,311–5,672, maximum 10,079; at that rate about 81,000–87,000 per hour of reading, 144,000 per hour if every frame is voiced |

What each part of the rule needs:

- **S0's P0 and A40's reference** are medians of the posted voiced frames
  in [t_fill, t_start] and in [t_fill, E], E = max(t_start, t_fill +
  40 s). An exact median needs the values themselves, but only until the
  last frame of its span has arrived (frames arrive in time order); after
  that each is one number. The shipped module freezes A40 only inside
  `update()`, so with the panel off it never lets go of the frames.
- **K-seed** reads, at each 2 s pseudo update t, the posted frames in
  (t − 8 s, t] (pitch or unvoiced, and the spacing to the previous frame)
  and the latest resonance verdict. t is always earlier than the newest
  frame, so a ring holding the posted frames of the last **N = 8 s** is
  enough. 8 s is the panel's own pooling window
  (`HEARD_AS_CALIBRATION.windowMs`), which the pseudo update reproduces:
  at most 321 frames at the 25 ms cadence. Its A40 value is the one above.
- **KP8's threshold** uses only the number of quiet values and the sum of
  their squares (summed in order from 0), so a quiet history is two
  numbers. The pending values (shown updates before t_start), the start
  shares (shown updates in [t_fill, t_start]) and the Q5 shares (20 s and
  then until 5 are collected) are lists limited by their windows.
- Nothing else of the pitch stream is read.

**What changes in `src/ml/pitch-only-warning.js`.** Everything not listed
stays as shipped (sha256 `2a1f4022…`): A40, KP8-3, DS10, K = 2, the
≤ 5 hidden-update hold, eligibility, the 0.6 u bound, EPS, the resets,
`S0_CONFIG`'s S0 rule, `pitchOnlyCondition`, `pitchOnlyEligible` and
`PITCH_ONLY_TEXT`.

1. **KS-Q5**, ported from the FALLBACK blocks of `late-variants-r2.js`
   (sha256 `956061543a15b0372543fc32e797edbf316ac05632129bbf528a501d1d5de241`)
   for `LATE_CANDIDATES["KS-Q5"]` only (round 1's trigger, K-seed and Q5;
   §8.8 "Candidates", Appendix I §3), in the same order of operations:
   - *Late flag.* At the first `update()` since creation or `reset()`, the
     panel counts as switched on late if t_fill is already known. A cue
     restart keeps the flag; `reset()` clears it.
   - *Trigger.* An update whose audio time is later than a known t_start,
     with an empty start share and the late flag set.
   - *K-seed.* §8.8's shadow KP8 state, with its constants taken from
     `HEARD_AS_CALIBRATION` (updateMs 2,000, windowMs 8,000, minVoicedMs
     3,000, freshMs 5,000, range.lnF0 = [ln 81, ln 293.1]): every 2 s of
     audio time t, computed when the first posted frame later than t
     arrives, a pseudo update with lnF0 = ln median of the voiced posted
     frames in (t − 8 s, t], counted as shown when their voiced time is
     ≥ 3 s, the newest of them is ≤ 5 s old, lnF0 is in range and the
     latest resonance verdict is not "sustained"; it goes through the
     shipped KP8 bookkeeping against the A40 reference at t. A frame's
     spacing is 25 ms for the first frame, else the gap to the previous
     posted frame, capped at 100 ms; voiced time is summed from the oldest
     frame to the newest. At the first triggered update the panel's quiet
     history and pending values are replaced by the shadow's. The shadow's
     history and pending values are cleared with the references (cue
     restart); its frame ring only by `reset()`.
   - *Q5.* At triggered updates the DS10 start share is replaced by the
     median of quiet drawn shares (eligible, |u − startU| ≤ 0.6 u,
     |ΔP| < X − EPS) collected from the first shown triggered update (fbT0)
     until fbT0 + 20 s, and after that until 5 are collected. The window
     closes at the first update, shown or hidden, later than fbT0 + 20 s
     with at least 5 shares; while it is open the gate fails. Each update
     is gated before its own share is collected. The state is cleared with
     the references.
   - New configuration: `PITCH_ONLY_WARNING.late` (the seed constants and
     Q5's 20,000 ms / 5 shares) and `maxStartWaitMs` (2c below);
     `S0_CONFIG` sets `late: null`.
2. **Bounded pitch storage.** The outputs equal (1)'s whenever frames
   arrive in time order and no update's audio time is earlier than the
   newest frame (both always hold above and in the app), unless the cap
   in 2c applies.
   - a. *S0's P0 decided in `addPitch`*, at the first posted frame later
     than t_start (t_fill and t_start known), from the buffered frames,
     with the value `s0P0()` would give at its next call. If it is null
     (fewer than 20 voiced frames), the buffer is emptied and no frames are
     kept until a cue restart or `reset()`: nothing can read them, since
     the reference stays null. With `ref: "S0"` (`S0_CONFIG`) the buffer
     is emptied once P0 is decided, whatever its value. For a frame that
     passes both t_start and E, 2a comes before 2b.
   - b. *A40 frozen in `addPitch`*, at the first posted frame later than
     E (P0 known): A40 = ln median of the buffered voiced frames in
     [t_fill, E]; then the buffer is emptied and no more frames are kept,
     as the shipped `refAt()` does at the first update after that point.
     This comes after that frame's K-seed pseudo updates (which may still
     read the buffer for times up to E) and before the frame would be
     buffered. `refAt()` keeps its own freeze (now redundant).
   - c. *Cap: the one change in behaviour outside KS-Q5.* If the start
     window has not closed by t_fill + **180 s** (`maxStartWaitMs`; t_start
     unknown or later than that) when a posted frame later than t_fill +
     180 s arrives, the module gives up on this start: S0's P0 is decided
     null, as with fewer than 20 start frames, so the warning cannot appear
     until a cue restart or `reset()`, and `pitchStart()` is null. Without
     a cap the buffer is limited only by how long the cue takes to set its
     start, and a session of held notes (which the cue does not admit) can
     stretch that without limit. 180 s is 2.2 × the longest t_start − t_fill
     on the recorded streams (81.5 s), so it never applies there.
   - d. *After P0 is decided null* (2a or 2c), pending values (the
     panel's and the shadow's) and start shares are no longer collected:
     they cannot be read before the next cue restart or `reset()`, which
     clear them.
   - e. *K-seed ring.* The posted frames of the last 8 s (time, pitch or 0,
     spacing) in preallocated typed arrays, grown only if more frames than
     their capacity arrive within 8 s; no allocation per frame. When the
     first `update()` came before t_fill (late flag false) the shadow can
     never be used before `reset()`, so it stops and its ring is released.
   - f. *Storage form.* Buffered frames as numbers in parallel arrays (time,
     pitch) instead of one object each. The KP8 quiet histories (the
     panel's and the shadow's) as a count and a running sum of squares,
     which give the shipped loop's threshold bit for bit.
   - g. *For tests:* `retained()` → `{ a40Frames, ringFrames }`.
3. **Comments.** The header describes KS-Q5, the bounded storage and the
   cap and cites this section. The §8.6-addendum paragraph on the empty
   start share is replaced by the limit that remains (below).

**What changes in the wiring and the panel.**

- `src/audio/useAudioPipeline.js`: comments only. The calls stay as they
  are: `addPitch` for every posted pitch frame and `noteResonance` for
  every resonance-cue state message (it carries `verdict`) from the start
  of listening, `reset()` at start and stop.
- `src/components/HeardAsPanel.jsx`: the `update()` calls stay as they
  are. In the "More" list, `PITCH_ONLY_START_TEXT` and its item
  (`data-heard-as-pitch-only-start`) are removed; `PITCH_ONLY_LATE_TEXT`
  takes their place (`data-heard-as-pitch-only-late`);
  `PITCH_ONLY_FALSE_ALARM_TEXT` is replaced; `PITCH_ONLY_MISSES_TEXT` stays
  (its figures are §8.6's, panel on from the start, where nothing
  changes). Comments cite this section.
- `scripts/cue-strip-smoke.mjs` (and `scripts/cue-strip-smoke-wavs.mjs`
  for its audio): the "More" checks also find the late line; the late
  switch-on run of (g).
- New: `tests/ml/fixtures/pitch-only-warning-shipped-2a1f4022.js` (a byte
  copy of the shipped module, the test's comparison module); the late-panel
  fixture and its generator `scripts/heard-as/pitch-only/make_fixture_late.mjs`;
  the measurement script for (c) and (d) under
  `scripts/heard-as/pitch-only/`. `tests/ml/pitch-only-warning-test.js` is
  extended; its checks that encode the old late-panel limit get their KS-Q5
  expectations.
- `CLAUDE.md`: the "Likely heard as" row and the HeardAsPanel entry; the
  known issue "Pitch-only warning keeps every voiced pitch frame while the
  panel is off" is marked resolved.
- This note: the header update, the results of (a)–(g) in this section and
  the "Reproduce" commands for them.

**Limits that remain.** A panel that was already on before t_fill (first
`update()` before the cue filled) but showed no estimate in the start
window — hidden throughout, or its model still downloading — still cannot
warn until stop / start or a cue restart (test man mlsdu4429, §8.6
addendum). Not covered by any study: a panel switched off and on again
later in a session (the late flag stays as it was first set), model loads
longer than 7.95 s, the speech detector loading separately, and the cap's
path (it never ran on recorded data).

**The panel's new wording** (fixed now; plain words, no percent signs; the
code uses these strings verbatim):

- `PITCH_ONLY_LATE_TEXT`, replacing the "turn it on before you start
  talking" line:

  > You can turn this panel on at any time. If you turn it on after you've
  > started talking, the note about pitch-only changes still compares with
  > how you sounded at the start, but it needs about 20 seconds of readings
  > before it can appear. In a test on about 70 other people with the panel
  > turned on half a minute to two minutes in, it then caught about 9 in 10
  > pitch-only changes in men's voices and about 3 in 4 in women's voices
  > within 10 seconds — about as many as with the panel on from the start.
  > If the panel is already on when you start talking but shows no reading
  > during roughly your first half-minute to a minute (for example while it
  > is still downloading), the note may not appear until you stop and start
  > listening again.

  Numbers (§8.8 test pool): within 10 s, male base 0.945 / 0.937 / 0.921
  at T30 / T60 / T120 ("about 9 in 10"), female base 0.750 / 0.742 / 0.746
  ("about 3 in 4"); with the panel on from the start 0.929 / 0.746 ("about
  as many"); 69 readers in the failure sets (32 men, 37 women; "about 70
  other people": none of them is in §8.6's test pool, which the misses
  line's "about 70 people" describes); "about 20 seconds of readings" = the
  Q5 window (20 s of shown estimates after switch-on and at least 5 quiet
  ones); "half a minute to a minute" = when the start window closes (§8.6
  addendum: median 30–36 s, 95th percentile 42–50 s into a session).
- `PITCH_ONLY_FALSE_ALARM_TEXT`, replacing the current false-alarm line:

  > The note about pitch-only changes can also appear when you haven't
  > deliberately changed your voice, if your pitch varies a lot as you
  > talk. In tests on 192 people reading aloud that happened on about 3 to
  > 4 in 1,000 updates for men's voices and almost never for women's, also
  > when the panel was turned on later. A single expressive speaker can see
  > it much more often: one man whose pitch rose a long way in a few places
  > saw it on about 1 in 8 to 1 in 6 updates where the panel showed an
  > estimate.

  Numbers: 192 = §8.6's test split (96 readers, panel on from the start)
  + §8.8's test pool (96 other readers). Men 0.26 % (§8.6, update weighted;
  0.27 % reader balanced), 0.36 % (§8.8, panel on from the start),
  0.34–0.39 % (§8.8, KS-Q5 at ~30 / 60 / 120 s) — "about 3 to 4 in 1,000";
  women 0.00 %, 0.01 %, 0.00–0.02 % — "almost never". The man is ls3792:
  11.84 % with the panel on from the start ("about 1 in 8") up to 16.76 %
  with KS-Q5 at ~120 s ("about 1 in 6"); his pitch rose 6.3–9.5 st above
  his reference in three stretches.
- `PITCH_ONLY_MISSES_TEXT` and `PITCH_ONLY_TEXT`: unchanged.

**Acceptance requirements for the code commit** (fixed now; all must hold):

- **(a) Panel on from the start: identical to the shipped module.** The
  new module and the shipped module (sha256 `2a1f4022…`), fed the same
  calls (rebuilt as `replay_r2.mjs` does; as `warning-male-fa-r2/select/replay2.mjs`
  does in mode `app` for §8.5's streams), give the same on/off at every update, the same `held()` after
  it and the same `pitchStart()` before it (`Object.is`), with **0
  mismatches**, on every on0 and on0L panel (four phases each) of every
  recorded session of:
  - dev pool A: `warning-late-panel/select/out/dev_{0,1}.jsonl` (sha256
    `5af5bafd…` / `3850c8b4…`), 299,233 updates;
  - dev pool B: `warning-late-panel/fresh/out/test_{0,1}.jsonl`
    (`da9271d9…` / `f4527a78…`), 297,218 updates;
  - the round-2 fresh pool: `warning-late-panel-r2/fresh/out/test_{0,1}.jsonl`
    (`839310cf963b…` / `0d1a5a754edc…`), 298,172 updates;
  - and §8.5's app-cadence streams `warning-male-fa-r2/select/out/{dev,test}_{0,1}.jsonl`
    (`193f18e8…`, `e4cb9ec7…`, `3c7cefcf…`, `b1554d7f…`; 2,972 sessions
    × 4 phases, 701,506 updates);

  and on every T30 / T60 / T120 panel of the three late-panel pools before
  its first triggered update. Reported per pool: panels, updates, updates
  with the warning on.
- **(b) Late panel: identical to the harness's KS-Q5.** On every T30, T60
  and T120 panel of the three late-panel pools — switch-on offsets 0 / 450
  / 1,050 / 1,500 ms with model-load times 4.05 / 5.40 / 6.60 / 7.95 s;
  326,454 + 323,917 + 325,148 updates — and on every on0 and on0L panel,
  the new module equals `late-variants-r2.js` (sha256 `956061543a…`)
  created with `fallback = LATE_CANDIDATES["KS-Q5"]`: on/off at every
  update, `held()` after it, `pitchStart()` before it, **0 mismatches**.
  Its on/off strings also equal the recorded KS-Q5 strings of
  `warning-late-panel-r2/select/out/rep_devA.json` (`9fc85a65…`),
  `rep_devB.json` (`edd9bc74…`) and `warning-late-panel-r2/fresh/out/rep_test.json`
  (`67081cfb…`): 0 mismatches. Reported: panels on the trigger path per
  condition (the fresh pool must give §8.8's T30 1,095, T60 1,152, T120
  1,152 of 1,152) and panels on which the 180 s cap applied (must be 0 on
  every recorded stream, §8.5's included). Not a blind check: the same
  comparison with one constant changed (seed window 8 → 7.9 s, Q5 window
  20 → 19.9 s, Q5 minimum 5 → 4 shares, cap 180 → 30 s) finds mismatches.
- **(c) Memory: retained pitch frames bounded.** The bound, at the
  production 25 ms cadence: the K-seed ring holds the posted frames of at
  most the last 8 s (≤ 321), and the A40 buffer at most the voiced frames
  of [t_fill, t_fill + 180 s] (≤ 7,201), so **≤ 7,522 frames at any time**;
  **≤ 321 once A40 is final** (on the recorded streams 40–82 s after
  t_fill); and no ring at all once the first panel update came before
  t_fill. Measured with a committed script under
  `scripts/heard-as/pitch-only/` on a simulated session of at least 1 h
  (deterministic; a posted frame every 25 ms, speech-like voicing of about
  60 %; resonance states every 200 ms with t_fill at ~10 s and t_start at
  ~30 s) in three panel scenarios — off throughout, on from the start
  (updates every 2 s), switched on at 30 min — for the shipped and the new
  module:
  - the new module's `retained()` after every call ≤ the bound, and ≤ 321
    once A40 is final; the shipped module's buffer size reported (from the
    stream: with the panel off, every voiced frame after t_fill);
  - the heap the warning object holds after the hour (Node `--expose-gc`:
    heapUsed + arrayBuffers after a forced GC with the object alive, minus
    the same after dropping it; median of 3 runs): **new ≤ 100 KB** in
    every scenario; the shipped module's figure reported.
- **(d) CPU of the background seed.** In (c)'s panel-off scenario, the
  time spent in the new module's `addPitch` and `noteResonance` is **≤ 1.0 s
  per audio hour** (≤ 0.03 % of one core; for scale, the pitch worker
  spends ~23 ms per audio second, ~83 s per hour), median of 5 runs after
  a warm-up run, both in Node 24 and in desktop Chrome (headless, via
  puppeteer with a temp profile, closed with `browser.close()`). Reported
  beside it: the shipped module on the same stream, the other two
  scenarios, and the longest single call.
- **(e) The panel's text.** `PITCH_ONLY_LATE_TEXT` and
  `PITCH_ONLY_FALSE_ALARM_TEXT` exactly as written above;
  `PITCH_ONLY_MISSES_TEXT` and `PITCH_ONLY_TEXT` unchanged;
  `PITCH_ONLY_START_TEXT` gone from the source. The comments above the
  constants give the numbers and their sources as listed above. The
  cue-strip smoke's "More" check (it opens, the lines wrap inside the
  panel, no horizontal page scroll) passes at all five viewports with the
  new list.
- **(f) Tests** (`tests/ml/pitch-only-warning-test.js`, self-contained, in
  `npm run test:unit`):
  1. *Identity with the shipped module on committed fixtures.* The existing
     golden replay (14 public session-phases, panel on from the start)
     still reproduces the study's scored strings for A40+KP8-3+DS10 and S0;
     and the new module equals the shipped copy
     (`tests/ml/fixtures/pitch-only-warning-shipped-2a1f4022.js`, its
     sha256 asserted) in on/off, `held()` and `pitchStart()` on the golden
     streams and on deterministic synthetic sessions with the panel on from
     the start (including hidden runs, a cue restart, a null snapshot and a
     null P0).
  2. *The late-panel path on deterministic fixtures.* (i) A committed
     fixture of public late-panel streams from §8.8's test pool
     (LibriSpeech / MLS, CC BY 4.0; derived numbers only; ≤ 1 MB) with at
     least: a male-base and a female-base pitch-only hit at T30, T60 and
     T120; `natL_ls3792` at T120; `hcsL_ls2473_PO` at T120 phase 1 (the Q5
     window never closes); a T30 panel that got a start share; a natural
     woman with no warning. Expected values: the harness KS-Q5 variant's
     on/off, `held()` and `pitchStart()` per update (its on/off equal to
     `rep_test.json`'s KS-Q5 strings). The generator refuses to write
     unless the new module reproduces them on the pruned and on the full
     streams. (ii) Synthetic: §8.6's repro (steady 120 Hz, t_start at 20 s,
     an 8 st pitch-only shift at 60 s, drawn share 0.2 → 0.6) with the
     panel on from 0, 10 or 19 s (first warning at 62 s, as shipped) and
     from 22 or 30 s (the harness variant's first-warning time; the shipped
     rule never warns); a cue restart after a late switch-on; a late
     switch-on during held notes. Expected values computed with the harness
     variant and committed.
  3. *The bound.* (c)'s three scenarios at ≥ 1 h: `retained()` ≤ the bound
     after every call, 0 A40 frames once A40 is final, no ring once the
     first update came before t_fill; a session whose t_start never comes
     (the buffer never holds frames past t_fill + 180 s and is then
     emptied; `pitchStart()` null; no warning); a session whose t_start
     comes at t_fill + 170 s (the same outputs as the shipped copy).
  4. *Mutation check.* Run against the shipped module (import swapped), the
     test file passes its identity and golden checks and fails its
     late-panel and bound checks. Each of these mutants of the new module
     fails at least one check: no K-seed (KP8 history from switch-on); seed
     window 7.9 s; Q5 window 19.9 s; Q5 minimum 4; trigger without the late
     flag; no freeze in `addPitch`; no cap; the shadow kept running when
     the late flag is false. Reported: which checks fail for each.

  `npm run lint`, `npm run test:unit` and `npm run build` pass.
- **(g) The production path.** In the built app, with the cue-strip smoke
  harness (puppeteer, temp profile, cleanup of its own PID only): (1) the
  existing `--pitch-only=man,woman` run passes at all five viewports (panel
  on from the start; the warning never before the shift, within 25 s after
  it); (2) a late run at the desktop viewport on two `hcsL` PO sessions of
  §8.8's test pool — for each base sex, the first by key order that KS-Q5
  hit (§8.8's definition: warned within 10 s) at T120 in all four phases
  (≥ 170 s of natural reading, then the shift): the panel is turned on at ~120 s, after the
  cue's start window has closed; the warning never shows before the shift
  and appears within 25 s after it, for both.

**Commit messages.** The code commit's message cites PREREG
(`dd3cf7bc…`), CHOICE (`17b948d9…`), `late-variants-r2.js`
(`956061543a…`) and this note commit.

**Inputs of this section** (scratch folder `warning-ks-q5-adopt/`):
`scan_streams.mjs` sha256
`9a273df2026b7f41ec0561b802bf944ab4730503ba49fc971a0209229653ae58`, its
outputs `scan_A.json` (`ffce7a9c…`), `scan_B.json` (`07f922ce…`),
`scan_F.json` (`2a093319…`), `scan_R2dev.json` (`4de71be4…`),
`scan_R2test.json` (`19328ae5…`); `fs_readers.py` (`958d17a9…`, run with
`python -I` through the study's `iso.py`) and its output `fs_readers.txt`
(`959380ef…`). The recorded streams, strings and harness files, sha256
taken on 2026-10-13 before this section was written (paths relative to
the scratchpad):

- `warning-late-panel/select/out/dev_0.jsonl` `5af5bafdf1b6897d2d1bc9c60539e49ac2f0aa4442138521dc58ff40ccbb4e76`
- `warning-late-panel/select/out/dev_1.jsonl` `3850c8b4f66432120ab0c4468a7d78c9351bcc2bad1502dbb49a69212ce496ed`
- `warning-late-panel/fresh/out/test_0.jsonl` `da9271d9ffb8be9e2476f7c574fe310a2aa34dd73e2c387ef125851f028939d8`
- `warning-late-panel/fresh/out/test_1.jsonl` `f4527a789466bf5b309d1e7ac15172c7bf51bdad49e8bdd9fce06d6d0ee7f30f`
- `warning-late-panel-r2/fresh/out/test_0.jsonl` `839310cf963bbfe5b11ccbc35d1e5f365b322ccd32bfcc69325efff0d17952e1`
- `warning-late-panel-r2/fresh/out/test_1.jsonl` `0d1a5a754edcac62543407bdb060d4e28cc9d9a7305395b46a9e572610c954fa`
- `warning-male-fa-r2/select/out/dev_0.jsonl` `193f18e86dc8351a530b3ef97e540397abbb1d6221ae8f799dccebcae5b6cd49`
- `warning-male-fa-r2/select/out/dev_1.jsonl` `e4cb9ec74ec8b518d47ad2d0738ee588310f9b13eabcb426f83ea2bdb4442573`
- `warning-male-fa-r2/select/out/test_0.jsonl` `3c7cefcfc1a6cb51381f68d3c705cd18270dd719a045b4ed91a1d74cbb54fedd`
- `warning-male-fa-r2/select/out/test_1.jsonl` `b1554d7f9f5ebcbf834e93353b631ca11b5574871f92b9e3550bcbea949d6ea6`
- `warning-late-panel-r2/select/out/rep_devA.json` `9fc85a654f76286fd4bbe52246f47ec2350795232c5e105112b1bd43b46421b3`
- `warning-late-panel-r2/select/out/rep_devB.json` `edd9bc74a2d28ee392813afb59dcf576767faf8224f9cfc646d0ca82a0374f9d`
- `warning-late-panel-r2/fresh/out/rep_test.json` `67081cfbbce02628c4c737b81ea4d279aa51d3868a3d2f9f3188b421ae7b5c69`
- `warning-late-panel-r2/harness/late-variants-r2.js` `956061543a15b0372543fc32e797edbf316ac05632129bbf528a501d1d5de241`
- `warning-late-panel-r2/harness/replay_r2.mjs` `a3ec703cf6cedb12f7c033f700582a5a4a8328d8fef7f98eadeca786da5205e8`
- `warning-male-fa-r2/select/replay2.mjs` `2569245ba2ddf163a0d1fc8da11cc0c3e398af589be5b9ab644bfa0bb016f122`
- `warning-late-panel-r2/harness/shipped/pitch-only-warning.js` `2a1f4022db77599731cfcf6de4d42758d531239188bce20ddfdf991a868e658f`
- `warning-late-panel-r2/select/PREREG.md` `dd3cf7bc6c211f1bf576e6e27f04d9942826e382f791752c55de77c50d279785`
- `warning-late-panel-r2/select/CHOICE.md` `17b948d9b2e00665c33b2a7db52a4e22b3031fc825846848b22cc44480816ef9`
- `warning-late-panel-r2/fresh/test_result.md` `5d196daf8dc1f5021cffc06f384bddeac4278f0722abc3e1c96eddb112b7c320`

None of the study's hashed files was edited.

**Results of the code commit (2026-10-13).** Every requirement (a)–(g)
holds; nothing above was changed. The new module
`src/ml/pitch-only-warning.js` has sha256
`1cd8b3ad25a962284cee63de44a9abefde559cf00219c1bd904dc6464f834472`
(the shipped one was `2a1f4022…`). The replay (a)–(b) drives the repo
module, the shipped module and the harness's KS-Q5 over the recorded call
streams, rebuilt as `replay_r2.mjs` and `replay2.mjs` (mode `app`) build
them (`warning-ks-q5-adopt/impl/replay_adopt.mjs`; hashes below).

- **(a) Panel on from the start: identical to the shipped module.**
  0 mismatches in on/off, `held()` and `pitchStart()`.

  | Streams | Panels (on0 + on0L) | Updates | Updates with the warning on (new = shipped) |
  |---|---|---|---|
  | Dev pool A | 2,304 | 299,233 | 22,579 |
  | Dev pool B | 2,304 | 297,218 | 23,798 |
  | Round-2 fresh pool | 2,304 | 298,172 | 21,818 |
  | §8.5's app-cadence streams | 11,888 (2,972 sessions × 4 phases) | 701,506 | 49,908 |

  Late panels before their first triggered update (3,456 T30 / T60 / T120
  panels per pool): 8,793 + 3,950 + 8,453 updates, 0 mismatches.
- **(b) Late panel: identical to the harness's KS-Q5.** 0 mismatches on
  every panel of the three pools (5,760 each, on0 and on0L included), and
  the on/off strings equal the recorded KS-Q5 strings of `rep_devA.json`,
  `rep_devB.json` and `rep_test.json` (0 mismatches, none missing).

  | Pool | T30 updates (panels on the trigger path) | T60 | T120 | Warning on at T30 / T60 / T120 |
  |---|---|---|---|---|
  | Dev pool A | 132,190 (1,090 of 1,152) | 114,652 (1,152) | 79,612 (1,152) | 11,301 / 11,254 / 11,207 |
  | Dev pool B | 131,225 (1,134) | 113,797 (1,144) | 78,895 (1,152) | 11,864 / 11,829 / 11,620 |
  | Round-2 fresh pool | 131,638 (**1,095**) | 114,173 (**1,152**) | 79,337 (**1,152**) | 10,904 / 10,960 / 10,896 |

  The fresh pool's trigger counts are §8.8's. The first triggered update
  computed from the inputs alone agrees with the harness on every panel.
  The 180 s cap applied on **0** panels of every recorded stream (§8.5's
  16 panels that never reach t_start — 4 short sessions — end 68–69 s
  after t_fill). No stream
  has a resonance-cue restart. Not a blind check: with one constant
  changed the same comparison finds mismatches (updates / panels; pools A,
  B, fresh): seed window 7.9 s 4 / 3, 25 / 15, 18 / 12; Q5 window 19.9 s
  45 / 32, 38 / 24, 62 / 42; Q5 minimum 4 shares 14 / 3, 61 / 5, 61 / 10;
  cap 30 s 59,099 / 600, 7,394 / 80, 36,233 / 360.
- **(c) Memory.** `scripts/heard-as/pitch-only/warning_bound.mjs` on a
  simulated 1 h session (144,000 posted frames, 61.5 % voiced, t_fill
  10 s, t_start 30 s, so A40 is final after 50 s), Node 24.14.1:

  | Panel | New: retained frames, max (A40 buffer + ring) | New: after A40 is final | New: heap held after 1 h | Shipped: buffer, max / at 1 h | Shipped: heap held after 1 h |
  |---|---|---|---|---|---|
  | Off throughout | 1,318 (998 + 320) | 320 (ring only) | **73.7 KB** | 88,310 / 88,310 | 7,114.8 KB |
  | On from the start | 998 (A40 buffer; the ring held at most 80 and was released at the first update, 2 s) | 0 | **33.7 KB** | 1,052 / 0 | 31.4 KB |
  | Switched on at 30 min | 1,318 (998 + 320) | 320 | **75.5 KB** | 44,089 / 0 | 36.4 KB |

  `retained()` was checked after every call (162,000–163,800 per
  scenario): 0 calls over the bound. The heap figure is the median of 3
  runs (one object alive, then dropped; a warm-up run first). It includes
  what V8 keeps for the object's closures and frees with the last instance;
  with 10 objects alive the per-object figure is 25.5 / 13.7 / 29.0 KB
  (shipped 7,105.8 / 21.3 / 15.2 KB). The shipped module's buffer cannot
  be observed; it is counted from the stream by its rule.
- **(d) CPU** (the whole call loop, median of 5 runs after a warm-up run,
  ms per audio hour; the panel-off loop is only `addPitch` +
  `noteResonance`):

  | Panel | Node 24.14.1: new / shipped | Chrome 155 headless: new / shipped | Longest single call, new (Node / Chrome) |
  |---|---|---|---|
  | Off throughout | **19.7** / 4.9 | **22.9** / 8.0 | 0.12 / 0.10 ms (`addPitch`) |
  | On from the start | 17.0 / 27.0 | 17.0 / 23.6 | 0.07 / 0.08 ms |
  | Switched on at 30 min | 28.3 / 13.9 | 27.1 / 12.5 | 0.10 / 0.09 ms |

  The bar was 1.0 s per audio hour. The shipped module's longest call was
  0.41 / 0.28 ms (on from the start) and 1.17 / 0.93 ms (switched on at
  30 min: the first update sorts the whole half-hour buffer).
- **(e) Text.** `PITCH_ONLY_LATE_TEXT` and `PITCH_ONLY_FALSE_ALARM_TEXT`
  are the strings above, verbatim (the test compares them with copies of
  the quotes above); `PITCH_ONLY_START_TEXT` and its item are gone;
  `PITCH_ONLY_MISSES_TEXT` and `PITCH_ONLY_TEXT` are unchanged. The smoke's
  "More" check passed at all five viewports (both lines inside the panel,
  no horizontal page scroll, no start line).
- **(f) Tests.** `tests/ml/pitch-only-warning-test.js`: 197 checks pass
  (141 before). The late-panel fixture `tests/ml/fixtures/pitch-only-late.json`
  is 632 KB: 6 sessions, 16 panels (hcsL_ls2654_PO on0p0 / T30p0 / T60p0 /
  T120p0, male base; hcsL_ls1474_PO T30p0 — it got a start share — / T60p0
  / T120p0, female base; natL_ls3792 on0p0 and T120 in four phases;
  hcsL_ls2473_PO T120p450; hcsL_ls3171_PO T60p1050, where a 7.9 s seed
  window changes the output; natL_ls1474 T30p0 / T120p0, a woman with no
  warning), and 11 synthetic cases. §8.6's repro: first warning at 62 s
  with the panel on from 0, 10 or 19 s (shipped too) and from 22 or 30 s
  (shipped: never). The generator refused nothing: the harness gives the
  same values on the pruned and the full streams, and the new module
  reproduces them on both. Mutation check (the test run against another
  copy of the module):

  | Module under test | Groups that fail (checks) |
  |---|---|
  | Shipped module (2a1f4022…) | late (18), bound (1); identity, golden, rule and wiring pass |
  | No K-seed | late (2: hcsL_ls3171_PO T60p1050, natL_ls3792 T120p1500) |
  | Seed window 7.9 s | late (2: the constants, hcsL_ls3171_PO T60p1050) |
  | Q5 window 19.9 s | late (6: the constants, natL_ls3792 T120 × 4, synthetic q5_edge) |
  | Q5 minimum 4 | late (3: the constants, hcsL_ls2473_PO T120p450, synthetic q5_four) |
  | Trigger without the late flag | identity (1: hidden through the start window), late (2: synthetic early_hidden, the remaining limit) |
  | No freeze in `addPitch` | bound (4: the three 1 h scenarios, the 170 s case's buffer) |
  | No cap | bound (2: t_start never comes, panel off and on) |
  | Shadow kept running when the late flag is false | bound (1: 1 h, panel on from the start) |

  `npm run lint`, `npm run test:unit` (40 of 40 scripts) and `npm run build`
  pass.
- **(g) Built app** (`scripts/cue-strip-smoke.mjs`, puppeteer with a
  temporary profile, its own PIDs only).
  1. `--pitch-only=man,woman`, panel on from the start: 95 / 95 checks at
     448 × 890, 402 × 750, 360 × 690 and 890 × 360, and the same checks
     at 1280 × 800 (113 / 113 there with the late runs). The warning never
     showed before the shift and first showed 6.2–6.3 s after the man's
     shift and 7.4–7.7 s after the woman's; it stayed on 76–77 of 76–77
     shown samples in the next 20 s.
  2. Late switch-on at 1280 × 800 (`--pitch-only-late=man,woman
     --panelOnAt=120`; the smoke option is new): hcsL_ls2654_PO (male
     base, shift at 174.0 s) and hcsL_ls1474_PO (female base, shift at
     180.6 s), the first by key order that KS-Q5 hit at T120 in all four
     phases. The panel was off when listening started and stayed off (no
     gender worker) until 120 s, when the cue's start marker was already
     shown; it was turned on at 120.0 / 120.1 s and showed its first
     estimate at 128.2 / 128.3 s. The warning never showed before the
     shift and first showed **6.3 s** (man) and **7.6 s** (woman) after
     it, under the axis with the shipped words and in the live region.
  The first 1280 × 800 attempt is not counted: its late runs tried to
  switch the panel off before listening, where the panel is not rendered,
  so both ran with the panel on from the start (4 setup checks failed; the
  other 109 passed). The run now switches the panel off in Settings on the
  previous page before relaunching Chrome; the rerun passed 113 / 113.
  Logs (`warning-ks-q5-adopt/impl/smoke/`): `phone.log` `f5f048a4…`,
  `p402.log` `2388f68a…`, `p360.log` `152986a9…`, `landscape.log`
  `a43c472c…`, `desktop.log` `fc8906f1…`, the attempt not counted
  `desktop_try1_late_setup_broken.log` `2e761fbb…`.

Not bounded by the cap, and unchanged: the pending lnF0 values of shown
updates before t_fill (the panel's and the shadow's) grow by at most one
number per 2 s of audio until the cue first fills (about 10 s into a
session on the recorded streams).

Deviations: the heap measurement adds a warm-up run and reports the
10-object figure beside the one the requirement names; the test checks the
two strings against copies of this section's quotes instead of reading
this note, because CI skips pushes that only change Markdown.

Inputs and outputs of this step (scratch folder `warning-ks-q5-adopt/impl/`):
`replay_adopt.mjs` `8efb9653f81511a5f8f3f4ed8ec4f7184095090db78923994b21352135ed64e7`,
`agg.mjs` `792b4e885e42e19ea343f7c9844ccc6fe0739e198fee6749dcf16b451c8bf1e8`,
`out/parity_summary.json` `df699d840670f220006d82a71c077281b5732dc15934120715925b86299e7556`,
`mutate.mjs` `8bd9589d88e20564bd5e67609b8349d1e5241b17408218735451770be126daec`,
`mut/mutate_result.json` `c9860403797fbc1f363e7fc2a92a438f33def30d443fc0b00b41a4bcd923b3c8`,
`out/bound_1h.json` `a44410ee62127795bafdab39397644dc3d308d27f8c93c5818f238771718372e`,
`select_fixture.mjs` `c0f4f9145203f94947dd1bb0137f2be41c8db7f072c5a267c3d989ea790c0cfd`
(descriptive: hits, start shares and the panels each one-constant change
affects, used to pick the fixture panels and the smoke sessions) and its
output `out/select_fixture.txt` `a3de55e894403f089f065e719bca56abd61820b68b6ad733c490b6a588e2a51f`.
Committed: the fixture `c1a0bd7594558b0c7a22610cb92ba0cf4cd1a5ea0fb147410f7acbe0126582ed`,
the shipped copy `2a1f4022…`, `make_fixture_late.mjs`, `late_synthetic.mjs`,
`warning_bound.mjs` and `warning_bound_sim.mjs` in `scripts/heard-as/pitch-only/`.

**Review fixes (2026-10-13), committed before the code change.** Two
read-only reviews of 312c36d found one medium issue in the cap, one
medium issue in the labels, and several low ones. Nothing above is
edited. This part adds one change to "What changes" (2c′, which replaces
2c's time test), the requirements that change must meet, and the review
notes. Hard rule 3 applies as before: this part is committed and pushed
first, and the code commit changes only what it lists.

*The issue.* 2c gives up on the start when no frame has passed t_start by
t_fill + 180 s of audio time. The cue sets its start only after 12 s of
admitted speech after it fills, so a pause pushes t_start back by the
length of the pause. A user who says a few words (so the cue fills) and
then stops for about 3 minutes loses the warning until stop / start — also
with the panel on from the start, where the module is meant to be the
shipped rule tick for tick. The reviewer's simulation (panel on from the
start; 9 s of speech, a 200 s pause, 90 s of speech, then an 8 st
pitch-only shift; seeds 1–3): the shipped module and the harness's KS-Q5
first warn at 306 s and are on for 12 updates; 312c36d never warns. With a
100 s pause all three first warn at 206 s. The cap saved no memory there:
the buffer keeps voiced frames only, and silence adds none (its A40 buffer
peaked at 63–68 frames).

*2c′, replacing 2c's time test: the cap counts voiced frames, not time.*
While S0's P0 is not decided and t_fill is known, a voiced posted frame
that would make the buffer hold more than **7,200** frames ends the start
exactly as 2c did: P0 null, no warning and `pitchStart()` null until a cue
restart or `reset()` (2d unchanged). 7,200 = `maxStartVoicedMs`
(180,000 ms, the configuration key that replaces `maxStartWaitMs`) ÷ the
25 ms frame spacing. Unvoiced frames and silence never count. On a session
where every frame is voiced (held notes, the case 2c was written for) it
gives up within one frame of where 2c did (the 7,201st voiced frame comes
at least 180 s after the first); after pauses it waits as long as they
last.

*What this means for (c) and (f) 3.* (c)'s bound gets tighter and holds at
44.1 kHz too. The A40 buffer holds at most 7,200 frames: before P0 by the
cap, after it at most the voiced frames up to t_fill + 40 s (≤ 1,602 at
25 ms chunks). The ring holds the posted frames of the last 8 s: ≤ 321 at
25 ms chunks, also at 44.1 kHz, where a chunk is 1,102 samples (24.989 ms).
So **≤ 7,521 frames** at any time (requirement (c): ≤ 7,522). (c)'s words
"the voiced frames of [t_fill, t_fill + 180 s]" no longer say which frames
they are: after a pause they can span more than 180 s of audio, which is
the point of the change. (f) 3's "a session whose t_start never comes (the
buffer never holds frames past t_fill + 180 s …)" holds as written on a
session where every frame is voiced; on a session with pauses the buffer
now keeps up to 7,200 voiced frames past that time, and the test checks
that case too. The `?chunk=N` diagnostic URL flag (5–50 ms chunks) changes
the frame spacing: the ring then holds 8 s of frames (1,601 at
`?chunk=5`), and the cap comes after proportionally less voiced audio (36 s
at `?chunk=5`). It is a measurement-only flag.

*What else changes.*

- `src/ml/pitch-only-warning.js`: 2c′ (`maxStartVoicedMs`, a 25 ms
  `FRAME_MS` constant). Header comments: the cap and the bound as above;
  "(post hoc, not pre-registered)" on the 18.57 % figure; the limits
  below.
- `tests/ml/pitch-only-warning-test.js`:
  - The constants check names `maxStartVoicedMs`. The bound figure is
    7,521.
  - Section 15's "t_start never comes" runs on held notes (every frame
    voiced) at 25 ms and at 24.989 ms frame spacing: (f) 3 as written, and
    the buffer ≤ 7,200. It also runs on speech with pauses: the buffer
    ≤ 7,200, emptied when the 7,201st voiced frame arrives, `pitchStart()`
    null, no warning.
  - New: the reviewer's pause case (panel on from the start; 9 s of
    speech, a 200 s pause, 90 s of speech, an 8 st pitch-only shift)
    equals the shipped copy, and it warns.
- The late fixture (`make_fixture_late.mjs`) gets public panels of §8.8's
  fresh pool on which three K-seed rules change the output (no current
  fixture panel does):
  - hcsL_mlspo3492_PO T30p1500 and T120p1500: the seed's F0 range check;
  - hcsL_ls2853_PO T30p1500 and hcsL_ls2694_PO T30p0: copying the shadow's
    pending values at the first triggered update;
  - hcsL_ls2853_PO T60p1500: the shadow's back-fill of its pending values.

  The fixture stays ≤ 1 MB (about 0.9 MB).
- `late_synthetic.mjs` gets a `frames` option (posted-frame segments:
  voiced at a given pitch, unvoiced, or no frame posted) and seven cases.
  Each is built so that one seed rule changes the output, and as before
  the harness gives the expected values:
  - `seed_sustained`: held notes at +3.5 st while the panel is off are not
    seeded (verdict "sustained");
  - `seed_spoken`: the same notes spoken are seeded;
  - `seed_fresh`: a voiced burst whose newest frame is over 5 s old is not
    shown;
  - `seed_gap`: after a 100 ms stall a frame's spacing counts 100 ms;
  - `seed_first`: the session's first frame counts 25 ms;
  - `seed_edge`: a frame exactly 8 s before a pseudo update is outside its
    window;
  - `seed_restart`: the ring is kept across a cue restart.
- `scripts/heard-as/pitch-only/warning_bound.mjs`: the bound 7,521 and its
  comment.
- `CLAUDE.md`:
  - The cap is described as 2c′. It read "ends a start window that never
    closes", but it also ended start windows that close late.
  - The Q5 window reads "collected for 20 s from the first shown estimate
    after the start window and the switch-on, then until 5 are in". It
    read "of the first 20 s of shown updates after switch-on".
  - The limits below, and the bound 7,521.
- This note: the results of the requirements below.

*Requirements for this change.* All must hold. (a)–(g) above are unchanged
and still apply to the new module.

- **(h1) Parity.** (a) and (b) are re-run in full with the new module:
  - 0 mismatches on every stream and panel named there;
  - the same update and trigger counts;
  - the cap (2c′) applies on 0 panels of every recorded stream (reported:
    the most voiced frames a start window still open held);
  - not blind: the same comparison with `maxStartVoicedMs` 30,000 (1,200
    frames) finds mismatches, and so do (b)'s other three one-constant
    changes.
- **(h2) Adversarial simulation.** The reviewer's
  `warning-ks-q5-adopt/review-parity/bound_adv.mjs` (read-only), run with
  the new module:
  - pause after fill, seeds 1–3: the new module, the shipped module and
    the harness first warn at the same time (306 s);
  - every scenario of the script (long, lateRestarts, pauseAfterFill,
    heldAfterFill, drill, pause100; seeds 1–3; also at 24.989 ms frames):
    0 calls over the bound (A40 buffer ≤ 7,200, ring ≤ 321) and 0 A40
    frames once A40 is final.
- **(h3) Memory and CPU.** (c) and (d) are re-measured
  (`warning_bound.mjs`, Node 24 and headless Chrome):
  - `retained()` ≤ 7,521 after every call, and ≤ 321 once A40 is final;
  - heap ≤ 100 KB in every scenario;
  - ≤ 1.0 s of CPU per audio hour with the panel off.
- **(h4) Tests.**
  - Every check passes.
  - Run against the shipped module, the identity and golden groups pass
    and the late and bound groups fail.
  - Each of (f) 4's eight mutants still fails at least one check.
  - So does each of these: the cap as 2c (312c36d's time test; it must
    fail the pause case); no F0 range check in the seed; no copy of the
    shadow's pending values; no back-fill of them; no verdict check; no
    freshness check; a 50 ms gap cap; a 0 ms first gap; the window edge
    (t − 8 s) counted inside the window; the ring cleared at a cue restart.
  - Reported: which checks fail for each.
  - The 2 s grid's first-step rule (`ceil` instead of `floor + 1`) is an
    equivalent mutant: the extra pseudo update it adds can only read one
    frame. It is reported, not required.
- **(h5) The built app.** The cue-strip smoke's desktop run
  (`--pitch-only=man,woman` and (g) 2's late run) passes again.
- `npm run lint`, `npm run test:unit` and `npm run build` pass.

*Review notes.*

- **Applied.**
  - The cap (medium): 2c′ above.
  - Its frame figure at 44.1 kHz (low): the bound above.
  - The post-hoc label (medium): added to this note's header update and to
    the module's header. The 4fed00a commit message also gives the 18.57 %
    figure without the label and cannot be changed without rewriting
    pushed history. That figure is post hoc there too.
  - The unpinned K-seed rules (low): the fixture panels and synthetic
    cases above.
  - The Q5 window's description (low): corrected in CLAUDE.md. In this
    section's text-numbers paragraph above, "(20 s of shown estimates after
    switch-on and at least 5 quiet ones)" should read "20 s of audio from
    the first shown estimate after the start window and the switch-on,
    then until at least 5 quiet ones are in". The panel's "about 20 seconds
    of readings" stands.
  - Edge paths (low): added to the limits below.
- **Why the recorded FAIL is overridden, in one sentence.** This is the
  note's summary of the trade, not the user's words; the user adopted
  KS-Q5 as §8.6 adopted A40+KP8-3+DS10 and gave no further reason. With the
  panel switched on late the shipped rule caught almost no pitch-only
  changes (men 0.103 / 0 / 0, women 0.004 / 0 / 0 at ~30 / 60 / 120 s),
  and KS-Q5 brings that up to the panel-on-from-the-start level (men
  0.945 / 0.937 / 0.921 vs 0.929, women 0.750 / 0.742 / 0.746 vs 0.746), at
  the cost of the one failed check: a reader whom the shipped rule warns at
  least as often over the same span (18.57 % vs 16.76 %; post hoc, not
  pre-registered).
- **Not applied: they need a user decision.** (e) fixes the two strings
  verbatim, and this step may not change a requirement. Each change would
  change §8.9's quote, the test's copy and the constant together, with a
  dated entry.
  1. Late line: "— about as many as with the panel on from the start" →
     "— about as many as in the same test with the panel on from the
     start". The misses line just above gives about 85 in 100 from §8.6's
     other test, so 3 in 4 for women's voices reads as fewer.
  2. Late line, last sentence → "If the panel is on from your first few
     seconds of listening but shows no reading during roughly your first
     half-minute to a minute (for example while it is still downloading,
     or while you are on another tab), the note may not appear until you
     stop and start listening again."
  3. False-alarm line, last sentence → "Some expressive speakers see it
     much more often — up to about 1 in 6 updates for one man whose pitch
     rose a long way in a few places." Among the 192 readers at least two
     men are far above 3–4 in 1,000: ls3792 at 11.8–16.8 % and §8.6's worst
     test man at 6.6 %.
- **Noted, no change.** Run against the shipped module, the bound group
  fails only because the shipped module has no `retained()` (the section
  throws). The group's real checks are the mutants: no freeze, no cap, the
  shadow kept running, and now the time cap.

*Limits that remain, added.* Neither was studied, and the panel's text does
not mention them.

- The panel is part of the practice view, so on another tab it makes no
  updates. A panel on at start whose user is on the Pitch or History tab
  through the start window cannot warn that session. The reverse (starting
  on another tab and coming back after the cue filled) takes the late path,
  which works.
- A panel on before the cue filled, then switched off; a resonance
  overload restarts the cue; the panel is switched on after the new fill.
  The late flag stays false, so it cannot warn until stop / start.

*Status of this step (2026-10-13): stopped before 2c′; a user decision is
needed.*

- **Why it stopped.** (b)'s not-blind clause ("the same comparison with
  one constant changed (… cap 180 → 30 s) finds mismatches"), restated in
  (h1) as `maxStartVoicedMs` 30,000, cannot hold with 2c′. The most voiced
  frames that a still-open start window held on any recorded stream is 666,
  about 16.7 s of voiced audio:

  | Streams | Most voiced frames in a still-open start window |
  |---|---|
  | Pool A | 666 |
  | Pool B | 603 |
  | Fresh pool | 614 |
  | §8.5's streams | 666 / 624 (dev / test) |

  So a 30 s voiced-frame cap (1,200 frames) never applies, and the
  comparison finds 0 mismatches. The replay is not blind: with 15 s (600
  frames) it finds mismatches on every pool (pool A 1,876 + 2,866
  mismatching updates, pool B 2,885 + 1,908, fresh pool 4,259 + 3,508;
  with 16 s only on pool A). §8.9's requirements are not edited, so 2c′ is
  not committed. The module keeps 2c (the time cap), and the pause issue
  stays open.
- **What 2c′ did meet before the stop.** Measured in scratch on the
  module with 2c′ (sha256 `c1dbeba33e…`, kept with the full patch in
  `warning-ks-q5-adopt/fix/countcap/`):
  - (a) and (b): 0 mismatches, with the same update and trigger counts
    as the results above.
  - The cap applied on 0 recorded panels.
  - The seed-window, Q5-window and Q5-minimum changes found mismatches as
    before.
  - The reviewer's pause case (seeds 1–3): the new module, the shipped
    module and the harness all first warn at 306 s.
  - Every scenario of `bound_adv.mjs` (25 ms frames, seeds 1–3): 0 calls
    over the bound; the A40 buffer peaked at 7,200, in "long".
  - Node 24, 1 h: retained ≤ 1,318 frames; heap 74.0 / 35.0 / 75.8 KB
    (panel off / on from the start / on at 30 min); 20.4 ms of CPU per
    audio hour with the panel off.
  - The unit test with 2c′: 217 of 217 checks.

  Not run: Chrome CPU, `bound_adv.mjs` at 24.989 ms frames, the smoke.
- **The decision.**
  1. Adopt 2c′, with (b)'s not-blind cap check run at a value that reaches
     the recorded data (15 s). That changes a requirement, so it is the
     user's call. The patch is ready.
  2. Keep the time cap, and say in the panel's "More" text that a pause
     of about 3 minutes after starting can turn the note off until stop /
     start. The wording needs approval.
  3. Something else.

  The three wording proposals above also wait for a decision.

*Committed in this step: no behaviour change.* The module's code is
unchanged; only its header comments changed. `git diff` shows no
non-comment line. The new module hashes to
`a5879f5a54b5dd40bb32c6990476531273b5e8c58f229c1b9d327c014909f6a5`.

- **Module header.** The post-hoc label on the 18.57 % figure; the limits
  below; a sentence that the time cap counts silence, with the open
  decision.
- **`CLAUDE.md`.**
  - The cap is now described as counting audio time, silence included,
    with the open issue (it read "ends a start window that never
    closes").
  - The Q5 window is described correctly.
  - The two added limits.
- **Tests.** The K-seed pins: the fixture panels and the seven synthetic
  cases above, plus three checks that they are present and give the
  designed first warnings.
  - `tests/ml/pitch-only-warning-test.js`: 212 of 212 checks (197 before).
  - The fixture is 879 KB (sha256 `106822e0…`; 9 sessions, 21 panels, 18
    synthetic cases). The generator's checks passed: the harness and the
    repo module agree on the pruned and full streams.
  - The bound section is unchanged, since the cap is unchanged.
  - `npm run lint`, `npm run test:unit` (40 of 40) and `npm run build`
    pass.
- **Parity of the committed module.** `replay_adopt.mjs`, unchanged, run
  on every stream of (a) and (b): 0 mismatches.
  - The counts equal the results above (for example pool A on0 + on0L:
    299,233 updates, 22,579 with the warning on).
  - Trigger path on the fresh pool: 1,095 / 1,152 / 1,152.
  - The cap applied on 0 panels.
- **Mutation check.** `mutate_fix.mjs` runs the test against other copies
  of the module.

  | Module under test | Groups that fail (checks) |
  |---|---|
  | Shipped module (2a1f4022…) | late (25), bound (1); identity, golden, rule and wiring pass |
  | No K-seed | late (11) |
  | Seed window 7.9 s | late (3; now also `seed_first`) |
  | Q5 window 19.9 s | late (6) |
  | Q5 minimum 4 | late (3) |
  | Trigger without the late flag | identity (1), late (2) |
  | No freeze in `addPitch` | bound (4) |
  | No cap | bound (2) |
  | Shadow kept running when the late flag is false | bound (1) |
  | No F0 range check in the seed | late (2: hcsL_mlspo3492_PO T30p1500, T120p1500) |
  | No copy of the shadow's pending values | late (2: hcsL_ls2694_PO T30p0, hcsL_ls2853_PO T30p1500) |
  | No back-fill of them | late (1: hcsL_ls2853_PO T60p1500) |
  | No verdict check in the seed | late (1: `seed_sustained`) |
  | No freshness check in the seed | late (1: `seed_fresh`) |
  | A 50 ms gap cap | late (1: `seed_gap`) |
  | A 0 ms first gap | late (1: `seed_first`) |
  | The window edge counted inside the window | late (1: `seed_edge`) |
  | The ring cleared at a cue restart | late (1: `seed_restart`) |
  | The 2 s grid's first step by `ceil` (equivalent) | none (212 of 212 pass, as expected) |

Inputs and outputs of this step (scratch folder `warning-ks-q5-adopt/`):

- `fix/replay_fix.mjs` `201bd5a008b543afd116db26a92719348c108dd0fc749d13e7c210cd763c58d4`
- `fix/replay_fix_cap.mjs` `9df3d19f1d5f1569227ab15aa97438440650b2385bb83ee3c6e0b1018b4791f6`
  (the 15 / 16 s caps)
- `fix/mutate_fix.mjs` `c8f191dbfd39fbccd3434ebfb98ed83e0769c5e3bcac332afd170c1826d4e6f7`
  and its output `fix/mut2/mutate_result.json` `654aba3f5d3cc60b40476b63613be111a9fe7402f4d1294705277d55365b2086`
- the reviewer's `review-parity/bound_adv.mjs` `98eb60cedcb820a4f06ce1ad359f2926d474e101e579b55d35062dc34389bf85`
- `fix/syn_eval.mjs` `d60c21225cf5700c451d5c792f765a480681ded840a002bb5846ce4f3146b2f1`
  (the synthetic cases against the harness and each mutant)
- `fix/mut_panels.mjs` `e201c97cf8a172487e2271ce30b6f3ef429a463d8004d368af6ac34d13c94a45`
  (the fresh-pool panels each K-seed mutant changes)
- the 2c′ patch `fix/countcap/countcap-full.patch` `03a6c8bda5ceb336223db0094d05084a93722e64de6b9d0de2730d1e58af0c4f`
  and its Node memory and CPU output `fix/out/bound_countcap.json` `36a730fdd0c6600b2722251ecb406b911f767958d91159e9e4c187be4abd90e6`

#### Decisions 2026-10-13: voiced-time cap and help-text edits

This part records two user decisions on the status above and the
requirements the code commit must meet. It is committed and pushed before
the code change (Hard rule 3). Nothing above is edited. Where a
requirement above changes, this part says so.

**Decision 1: adopt 2c′, the voiced-frame cap.** The user chose option 1
of the status list. The start gives up when a voiced posted frame would
make the buffer hold more than 7,200 frames (`maxStartVoicedMs` 180,000 ms
÷ 25 ms), as 2c′ above describes. Unvoiced frames and silence never count.
The time cap 2c goes.

*A change to one check, made by user decision before the code change.*
(b)'s not-blind clause ("… cap 180 → 30 s) finds mismatches"), which (h1)
restates as `maxStartVoicedMs` 30,000 (1,200 frames), now runs at **15 s**:
`maxStartVoicedMs` 15,000 (600 voiced frames). The reason: with a voiced
cap, 30 s never applies on the recorded streams. A start window still open
held at most 666 voiced frames, about 16.7 s (table above), so that
comparison cannot find mismatches. At 15 s it finds them on every pool
(measured before this decision with `fix/replay_fix_cap.mjs`: pool A
1,876 + 2,866 mismatching updates, pool B 2,885 + 1,908, fresh pool
4,259 + 3,508). The check's purpose is unchanged: to show that the
comparison would notice a wrong cap. The other three one-constant changes
stay as written.

**Decision 2: apply the review's three wording changes** ("Not applied:
they need a user decision", 1–3 above). The strings below are final. They
replace §8.9's two quotes above as the reference for (e), and the code uses
them verbatim.

- `PITCH_ONLY_LATE_TEXT`:

  > You can turn this panel on at any time. If you turn it on after you've
  > started talking, the note about pitch-only changes still compares with
  > how you sounded at the start, but it needs about 20 seconds of readings
  > before it can appear. In a test on about 70 other people with the panel
  > turned on half a minute to two minutes in, it then caught about 9 in 10
  > pitch-only changes in men's voices and about 3 in 4 in women's voices
  > within 10 seconds — about as many as in the same test with the panel on
  > from the start. If the panel is on from your first few seconds of
  > listening but shows no reading during roughly your first half-minute to
  > a minute (for example while it is still downloading, or while you are
  > on another tab), the note may not appear until you stop and start
  > listening again.

  What changed from the quote above:
  - (i) "about as many as in the same test with the panel on from the
    start" (it read "about as many as with the panel on from the start").
    The misses line just above it gives about 85 in 100 from §8.6's other
    test, so women's 3 in 4 read as fewer. Same test: §8.8's test pool,
    panel on from the start 0.929 (male base) / 0.746 (female base).
  - (ii) The last sentence, as the review wrote it. "Is on from your first
    few seconds of listening" replaces "is already on when you start
    talking": the limit is a panel whose first update came before the cue
    filled, about 10 s into a session on the recorded streams. "Or while
    you are on another tab" is added as a second example.
  - The other numbers are as listed under the quote above.

  "Another tab" is the review's word and is kept. The limit behind it is
  the app's own tabs (Pitch, History, Resonance lab): off the practice
  view `CombinedDashboard` renders nothing, so the panel makes no updates
  there (§8.9, "Limits that remain, added"). The decision as relayed to
  this step said "another browser tab". A different browser tab was not
  tested, so the text does not single it out: there the panel stays
  mounted, and whether it keeps updating depends on how the browser
  treats a hidden page.

- `PITCH_ONLY_FALSE_ALARM_TEXT`:

  > The note about pitch-only changes can also appear when you haven't
  > deliberately changed your voice, if your pitch varies a lot as you
  > talk. In tests on 192 people reading aloud that happened on about 3 to
  > 4 in 1,000 updates for men's voices and almost never for women's, also
  > when the panel was turned on later. Some expressive speakers see it
  > much more often — up to about 1 in 6 updates where the panel showed an
  > estimate, for one man whose pitch rose a long way in a few places.

  What changed from the quote above: (iii) the last sentence only. It read
  "A single expressive speaker can see it much more often: one man whose
  pitch rose a long way in a few places saw it on about 1 in 8 to 1 in 6
  updates where the panel showed an estimate." Its numbers:
  - "Some expressive speakers": among the 192 readers at least two men are
    far above 3–4 in 1,000. ls3792 (§8.8 test pool) is at 11.84 % with the
    panel on from the start and up to 16.76 % with KS-Q5 at ~120 s. ls3783
    (§8.6 test split) is at 6.6 %.
  - "Up to about 1 in 6" = ls3792's 16.76 % (1 in 5.97; the check KS-Q5
    failed).
  - "Updates where the panel showed an estimate" = eligible updates (§6),
    the base of every false-alarm figure in this line.
  - "Whose pitch rose a long way in a few places" = 6.3–9.5 st above his
    reference in three stretches.
  - The first two sentences and their numbers are unchanged.

- `PITCH_ONLY_MISSES_TEXT` and `PITCH_ONLY_TEXT`: unchanged.

**What the code commit changes.** Only these:

- `src/ml/pitch-only-warning.js`: 2c′ (`maxStartVoicedMs` 180,000
  replaces `maxStartWaitMs`; a 25 ms `FRAME_MS` constant), as in the ready
  module (`fix/countcap/`, sha256 `c1dbeba33e…`). The header describes the
  cap as 2c′ and drops the sentence on the open decision.
- `src/components/HeardAsPanel.jsx`: the two strings above, and the
  comments above them. The comments give the numbers and sources listed
  here, the Q5 window as the review notes correct it ("20 s of audio from
  the first shown estimate after the start window and the switch-on, then
  until at least 5 quiet ones are in"), and the replaced wording in their
  "Until 2026-10-13" lines.
- `tests/ml/pitch-only-warning-test.js`: the 2c′ items of "What else
  changes" in the review fixes (the constants check, the bound 7,521,
  section 15's held-note and pause cases, the reviewer's pause case), and
  its copies of the two strings. The K-seed pins are already in (b72bb8a).
- `scripts/heard-as/pitch-only/warning_bound.mjs`: the bound 7,521 and its
  comment.
- `scripts/cue-strip-smoke.mjs`: only if its "More" check needs the new
  text.
- `CLAUDE.md`: the cap as 2c′ (the open issue goes; the bound 7,521); the
  "More" wording in the "Likely heard as" row and the HeardAsPanel entry
  (about as many as in the same test with the panel on from the start; up
  to about 1 in 6 for some expressive speakers; on another tab).
- This note: the header and the results of the requirements below.

**Requirements for the code commit.** All must hold. If one cannot be met,
the code is not committed and the failure is reported for a user
decision. No requirement is relaxed afterwards.

- **(a)–(g)** as written above, with only these changes:
  - (b): the not-blind cap change is `maxStartVoicedMs` 15,000 (600 voiced
    frames), per Decision 1, reported per pool. "Panels on which the 180 s
    cap applied (must be 0 on every recorded stream, §8.5's included)"
    now means panels on which 2c′ applied (still must be 0). Reported
    beside it: the most voiced frames a start window still open held.
  - (c): the limits are unchanged: ≤ 7,522 frames at any time (2c′ gives
    ≤ 7,521: 7,200 buffered + 321 in the ring), ≤ 321 once A40 is final,
    no ring once the first update came before t_fill, and a heap of
    ≤ 100 KB in every scenario.
  - (d): unchanged: ≤ 1.0 s of CPU per audio hour with the panel off,
    median of 5 runs, in Node 24 and in headless desktop Chrome.
  - (e): the two strings of this part, verbatim (the test compares them
    with copies of this part's quotes); the smoke's "More" check passes at
    all five viewports with them.
  - (f) 3: as the review fixes restate it for 2c′ (held notes at 25 and
    24.989 ms frames; speech with pauses).
  - (g): re-run on the code commit's build: (1) at all five viewports, (2)
    at the desktop viewport.
- **(h1)–(h5)** of the review fixes as written, except (h1)'s not-blind
  value: `maxStartVoicedMs` 15,000 (600 frames) instead of 30,000 (1,200
  frames).
- **(h6) The ~3-minute pause warns exactly when the shipped module does.**
  The scenario, from the review: the panel is on from the start of
  listening; 9 s of speech, which fills the cue; a 200 s pause; 90 s of
  speech, during which the cue sets its start, more than 180 s after it
  filled; a 30 s pitch-only shift of +8 st; 60 s of speech. 2c's time cap
  gives up on this start, so the module as committed now (b72bb8a) never
  warns. The new module must equal the shipped module (`2a1f4022…`): on/off
  at every update, `held()` after it and `pitchStart()` before it
  (`Object.is`), **0 mismatches**, and it must warn after the shift.
  Checked in two places:
  1. the unit test's pause case (`pauseCalls`, seeds 1–3, 25 ms frames),
     every update compared;
  2. `review-parity/bound_adv.mjs --scenario=pauseAfterFill` (read-only,
     run with `--newmod=` on the committed module; seeds 1–3; 25 and
     24.989 ms frames): the new module, the shipped module and the
     harness first warn on the same update, at 306 s with 25 ms frames,
     and are on for the same number of updates (12), with 0 mismatches
     on the updates the script compares. Its control `pause100` (a 100 s
     pause) the same, at 206 s.

  `bound_adv.mjs` compares the new module with the shipped one only
  outside the cue epoch that its own 180 s time model calls capped (94 of
  195 updates in pauseAfterFill), so (1) is the every-update check.
- **Memory and CPU limits: unchanged** ((c), (d), (h3)).
- `npm run lint`, `npm run test:unit` and `npm run build` pass.

The code commit's message cites PREREG (`dd3cf7bc…`), CHOICE
(`17b948d9…`), `late-variants-r2.js` (`956061543a…`) and this part's
commit.

*Checked while writing this part* (scratch only, no code change):
`bound_adv.mjs --newmod=` a copy of the ready module (`c1dbeba33e…`,
beside the repo's `heardAsCalibration.js`, `a813cf6a…`) in
`warning-ks-q5-adopt/decide/ml/`, scenarios pauseAfterFill and pause100,
seeds 1–3, at 25 and 24.989 ms frames:

| Scenario | Frames | First warning: new = shipped = harness | Updates on (each) | Updates compared, mismatches | Calls over the bound |
|---|---|---|---|---|---|
| pauseAfterFill | 25 ms | 306.000 s | 12 | 94 of 195, 0 | 0 |
| pauseAfterFill | 24.989 ms | 306.015 s | 12 | 94 of 195, 0 | 0 |
| pause100 | 25 ms | 206.000 s | 12 | 145 of 145, 0 | 0 |
| pause100 | 24.989 ms | 206.009 s | 12 | 145 of 145, 0 | 0 |

The same for all three seeds. This covers the status's "not run" item
for these two scenarios at 24.989 ms. The other scenarios at 24.989 ms,
Chrome CPU and the smoke are left to the code commit.

Inputs of this part: `review-parity/bound_adv.mjs` `98eb60cedcb820a4f06ce1ad359f2926d474e101e579b55d35062dc34389bf85`,
`decide/ml/pitch-only-warning.js` `c1dbeba33e8a449f45cf8dd32b4b183cf152d50b7a93282c348edc6e9ad87d32`
(a byte copy of `fix/countcap/pitch-only-warning.countcap.js`),
`decide/ml/heardAsCalibration.js` `a813cf6a5b542504bb57ba3991d20813c5758d94138fe1af6b6d54b7fd17475c`
(the same bytes as `src/ml/heardAsCalibration.js` at b72bb8a).

**Results of the code commit (2026-10-13, 2c′ and the wording).** Every
requirement of this part holds; nothing above was changed. The module
`src/ml/pitch-only-warning.js` has sha256
`c1dbeba33e8a449f45cf8dd32b4b183cf152d50b7a93282c348edc6e9ad87d32`, the
same bytes as the ready module in `fix/countcap/` (b72bb8a's module was
`a5879f5a…`). The ready patch did not apply cleanly at b72bb8a: it was made
on an earlier tree and also carried the K-seed pins b72bb8a had already
committed. The patched files in `fix/countcap/` (module, test, bound
script) differ from b72bb8a only by 2c′, so they were copied over, and the
two strings and the comments were then changed as this part lists.

- **(a) Panel on from the start: identical to the shipped module.**
  0 mismatches in on/off, `held()` and `pitchStart()`; the counts are the
  ones in the first results above.

  | Streams | Panels (on0 + on0L) | Updates | Updates with the warning on (new = shipped) |
  |---|---|---|---|
  | Dev pool A | 2,304 | 299,233 | 22,579 |
  | Dev pool B | 2,304 | 297,218 | 23,798 |
  | Round-2 fresh pool | 2,304 | 298,172 | 21,818 |
  | §8.5's app-cadence streams | 11,888 | 701,506 | 49,908 |

  Late panels before their first triggered update: 8,793 + 3,950 + 8,453
  updates, 0 mismatches.
- **(b) and (h1) Late panel: identical to the harness's KS-Q5.** 0
  mismatches on every panel of the three pools (5,760 each, on0 and on0L
  included); the on/off strings equal the recorded KS-Q5 strings of
  `rep_devA.json`, `rep_devB.json` and `rep_test.json` (0 mismatches, none
  missing). Updates, trigger counts and warnings are the ones in the first
  results above (fresh pool on the trigger path: **1,095 / 1,152 / 1,152**
  at T30 / T60 / T120). The first triggered update computed from the
  inputs alone agrees with the harness on every panel. No stream has a
  cue restart.
  - 2c′ applied on **0** panels of every recorded stream. The most voiced
    frames a start window still open held: pool A 666, pool B 603, fresh
    pool 614, §8.5's streams 666 / 624 (dev / test); the cap is 7,200.
  - Not blind (mismatching updates / panels, pools A, B, fresh): seed
    window 7.9 s 4 / 3, 25 / 15, 18 / 12; Q5 window 19.9 s 45 / 32,
    38 / 24, 62 / 42; Q5 minimum 4 shares 14 / 3, 61 / 5, 61 / 10;
    **`maxStartVoicedMs` 15,000** (600 voiced frames; Decision 1)
    4,742 / 40, 4,793 / 40, 7,767 / 80.
- **(h2) The reviewer's adversarial simulation**
  (`review-parity/bound_adv.mjs`, unchanged, `--newmod=` the committed
  module; every scenario, seeds 1–3, at 25 ms frames, at exactly 24.989 ms
  as in the pre-check above, and at 1,102 samples / 44.1 kHz = 24.9887 ms;
  "lateRestarts" also with `--expr=1`; 63 runs): 0 calls over the bound in
  every run, the A40 buffer at most **7,200** (in "long"; the script's own
  check allows 7,201), the ring at most 321, 0 A40 frames once A40 is
  final, no ring after its release, and 0 mismatches against the harness
  and against the shipped module on the updates the script compares.

  | Scenario | Updates (compared with the harness / shipped) | Most A40 frames | First warning, new = shipped = harness (25 / 24.989 / 24.9887 ms) | Updates on (each) |
  |---|---|---|---|---|
  | long | 2,741 (2,525 / 2,375) | 7,200 | new = shipped at 1,361.0 s (25 ms); see below | 29–31 |
  | lateRestarts | 864 (864 / 213) | 1,153–1,203 | new = harness, 318–320 s | 61–64 |
  | pauseAfterFill | 195 (94 / 94) | 478–484 | **306.000 / 306.015 / 306.011 s** | **12** |
  | heldAfterFill | 190 (94 / 94) | 5,278–5,289 | none of the three warns | 0 |
  | drill | 241 (241 / 241) | 4,080–4,092 | none of the three warns | 0 |
  | pause100 | 145 (145 / 145) | 478–484 | **206.000 / 206.009 / 206.007 s** | **12** |

  In "long" the harness warns on 12–13 more updates than the new module.
  All of them are in the one cue epoch the script does not compare (216
  updates; its 180 s time model calls it capped): after a cue restart, 8 s
  of speech and then 200 s of held notes, every frame voiced. There the new
  module's buffer reaches the 7,200 cap and it gives up, as 2c did; the
  harness has no cap. In every other epoch the new module and the harness
  warn on the same updates (checked per epoch with `code/adv_probe.mjs`, a
  copy of the script that also counts per epoch).
- **(h3), (c), (d) Memory and CPU** (`warning_bound.mjs`, simulated 1 h,
  144,000 posted frames, 61.5 % voiced, A40 final after 50 s; Node
  24.14.1 and headless Chrome 155 via puppeteer with a temporary profile,
  closed with `browser.close()`):

  | Panel | Retained frames, max (A40 buffer + ring) | After A40 is final | Heap held after 1 h (10 objects: per object) | CPU, ms per audio hour, Node / Chrome (shipped) | Longest call, Node / Chrome |
  |---|---|---|---|---|---|
  | Off throughout | 1,318 (998 + 320) | 320 | **74.0 KB** (24.9 KB) | **23.9 / 28.1** (4.6 / 7.6) | 0.10 / 0.30 ms |
  | On from the start | 998 (ring ≤ 80, released at the first update) | 0 | **35.0 KB** (13.8 KB) | 20.7 / 19.4 (26.6 / 23.5) | 0.32 / 0.08 ms |
  | Switched on at 30 min | 1,318 (998 + 320) | 320 | **75.8 KB** (29.0 KB) | 27.9 / 27.0 (16.8 / 12.9) | 0.09 / 0.10 ms |

  `retained()` was checked after every call (162,000–163,800 per
  scenario): 0 over 7,521. The shipped module held 7,114.7 KB after the
  hour with the panel off. Limits: ≤ 100 KB and ≤ 1.0 s per audio hour
  with the panel off. The simulated session never reaches the cap (its
  start window closes 20 s after the fill). The CPU figures differ from
  the first results (19.7 / 22.9 ms with the panel off) by a few ms per
  audio hour.
- **(e) Text.** `PITCH_ONLY_LATE_TEXT` and `PITCH_ONLY_FALSE_ALARM_TEXT`
  are this part's two quotes, verbatim (the test compares them with copies
  of the quotes); `PITCH_ONLY_MISSES_TEXT` and `PITCH_ONLY_TEXT` are
  unchanged; no `PITCH_ONLY_START_TEXT`. The comments above the two
  constants give this part's numbers and sources, the corrected Q5 window
  and the replaced wording. The smoke's "More" check matched only phrases
  the edits left alone, so it would have passed with the old text too; it
  now also matches the three edited phrases ("about as many as in the same
  test with the panel on from the start", "or while you are on another
  tab", "Some expressive speakers see it much more often — up to about 1
  in 6 updates"). It passed at all five viewports (both lines inside the
  panel, no horizontal page scroll, no start line), and the built bundle
  holds both new strings.
- **(f), (h4) Tests.** `tests/ml/pitch-only-warning-test.js`: **217 of
  217** checks (212 at b72bb8a). New or changed: the constants check names
  `maxStartVoicedMs`; the bound is 7,521; "t_start never comes" runs on
  held notes at 25 and 24.989 ms frames, panel off and on (buffer ≤ 7,200,
  nothing kept past t_fill + 180 s, emptied, `pitchStart()` null, no
  warning) and on speech with pauses, panel off and on (frames kept past
  t_fill + 180 s, never more than 7,200, emptied at the 7,201st voiced
  frame, at 304.7 s); the review's pause case (below). Mutation check
  (`code/mutate_code.mjs`: the test run against other copies of the
  module):

  | Module under test | Groups that fail (checks) |
  |---|---|
  | Shipped module (2a1f4022…) | late (25), bound (1: the section throws, the shipped module has no `retained()`); identity, golden, rule and wiring pass |
  | No K-seed | late (11) |
  | Seed window 7.9 s | late (3) |
  | Q5 window 19.9 s | late (6) |
  | Q5 minimum 4 | late (3) |
  | Trigger without the late flag | identity (1), late (2) |
  | No freeze in `addPitch` | bound (4) |
  | No cap | bound (6: held notes at 25 / 24.989 ms, panel off / on — up to 15,601 frames —, speech with pauses, panel off / on) |
  | Shadow kept running when the late flag is false | bound (1) |
  | **The cap as 2c** (312c36d's time test, t_fill + 180 s) | bound (7: the six "t_start never comes" checks — 7,201 frames at 25 ms, 7,204 at 24.989 ms; with pauses it empties at t_fill + 180 s, not at the 7,201st voiced frame — and **the 200 s pause case**) |
  | No F0 range check in the seed | late (2) |
  | No copy of the shadow's pending values | late (2) |
  | No back-fill of them | late (1) |
  | No verdict check in the seed | late (1) |
  | No freshness check in the seed | late (1) |
  | A 50 ms gap cap | late (1) |
  | A 0 ms first gap | late (1) |
  | The window edge counted inside the window | late (1) |
  | The ring cleared at a cue restart | late (1) |
  | The 2 s grid's first step by `ceil` (equivalent, not required) | none (217 of 217) |

  `npm run lint`, `npm run test:unit` (40 of 40 scripts) and
  `npm run build` pass.
- **(g), (h5) Built app** (`scripts/cue-strip-smoke.mjs` on this commit's
  build, puppeteer with a temporary profile, its own PIDs only):
  1. `--pitch-only=man,woman`, panel on from the start: **95 / 95** checks
     at 448 × 890, 402 × 750, 360 × 690 and 890 × 360, and the same checks
     at 1280 × 800 (**113 / 113** there with the late runs). The warning
     never showed before the shift and first showed 6.2–6.3 s after the
     man's shift and 7.4–7.7 s after the woman's; it stayed on 76 of 76
     shown samples in the next 20 s.
  2. Late switch-on at 1280 × 800 (`--pitch-only-late=man,woman
     --panelOnAt=120`; hcsL_ls2654_PO, male base, shift at 174.0 s;
     hcsL_ls1474_PO, female base, shift at 180.6 s): the panel was off when
     listening started and stayed off (no gender worker) until 120 s, when
     the cue's start marker was already shown; it was turned on at 120.1 s
     and showed its first estimate at 128.3 s. The warning never showed
     before the shift and first showed **6.3 s** (man) and **7.6 s**
     (woman) after it, under the axis with the shipped words and in the
     live region.
- **(h6) The ~3-minute pause warns exactly when the shipped module does.**
  1. Unit test (`pauseCalls`, seeds 1–3, 25 ms frames, every update
     compared): the new module equals the shipped copy in on/off, `held()`
     and `pitchStart()` at every one of the case's updates, and it first
     warns at **306 s** for each seed, after the shift (which starts at
     299 s). The check also requires the first warning to come after the
     shift. b72bb8a's module never warns there, and the "cap as 2c" mutant
     fails this check.
  2. `bound_adv.mjs --scenario=pauseAfterFill` (seeds 1–3; 25 ms, 24.989
     ms and 24.9887 ms frames): the new module, the shipped module and the
     harness first warn on the same update, at 306.000 / 306.015 /
     306.011 s, and are on for 12 updates each, with 0 mismatches on the 94
     updates the script compares (of 195). The control `pause100`: 206.000
     / 206.009 / 206.007 s, 12 updates each, 0 mismatches on all 145.

Changed in this commit: the module (2c′; header: the cap as 2c′, the bound
7,521, the `?chunk=N` note, the open-decision sentence dropped);
`HeardAsPanel.jsx` (the two strings and their comments); the test (the 2c′
items, the pause case, the two string copies); `warning_bound.mjs` (the
bound 7,521); `cue-strip-smoke.mjs` (the "More" check also matches the
three edited phrases, as above); `CLAUDE.md` (the cap as 2c′ with the time
cap marked historical, the bound 7,521, ~20–30 ms of CPU per audio hour
with the panel off, the "More" wording); this note (the header and these
results). One addition to (h6) 1: the test also checks that the first
warning comes after the shift, which (h6) states but the ready test did
not check.

Inputs and outputs of this step (scratch folder `warning-ks-q5-adopt/code/`):

- `replay_code.mjs` `b743dbbd7ed8a40de865ceb30ae7b3efca2e4ff12195ae557fb903224db9a150`
  (`fix/replay_fix.mjs` with the 15 s cap variant) and its outputs
  `out/{A0,A1,B0,B1,F0,F1,Pdev0,Pdev1,Ptest0,Ptest1}.json`
  (`538ae686…`, `58ae43ee…`, `87b766ac…`, `cdcaf4bb…`, `35281372…`,
  `d26167e9…`, `b43666b1…`, `f1c24431…`, `6b263c28…`, `619eb6a4…`)
- `run_adv.mjs` `3dc57a7e846cf6d80b6ccdf394b2340907545c848a350f97a035986b6d24dcc4`
  (runs `review-parity/bound_adv.mjs` `98eb60ce…`) and its outputs
  `adv.json` `cd5eb22201c74fb41ce7d98d15821272b15f2f4377201a91b761d77b65b5ed62`,
  `adv_24989.json` `c1e8c412f98d8073197f04c3cba98a7efa816703c51c214b727894d678032317`
- `mutate_code.mjs` `9f62d34cfbdc8c5b05908e187e44467b502069001a4b1184edf8640330ed8793`
  and its output `mut/mutate_result.json` `7643f73bc99e042960067d8acf374b656cf4c73977f6bc7c12245fb5c8aa5c9d`
- `bound_1h.json` `40380b2d608cdeef50a3184b9c8ffa8ca3d439efc3a447cd224792ae07472e8f`
  (`warning_bound.mjs --hours=1 --runs=5 --chrome`)
- `adv_probe.mjs` `848988925809b28c9efe6a99994f58e1bf27bcc203ac3f9f90361bf5f4646cce`
  (the per-epoch count for "long")
- smoke logs `smoke/`: `phone.log` `3a0cdd96…`, `p402.log` `c455c30c…`,
  `p360.log` `e2feb30f…`, `landscape.log` `9e6a53f2…`, `desktop.log`
  `80477749…`


#### Review notes, round 3 (2026-10-13)

The third review (of f98a4d3) re-ran the parity replays, the pause and
frame-timing simulations, the text checks and the suite. It found the code
correct: 0 mismatches everywhere it compares, the counts above, and
`retained()` never over the bound. Its five findings are about wording and
documentation. Nothing above is edited and no requirement changes. The
module's code is unchanged: only its header comments change (sha256
`f9c1573462b3e496566fb89147c18aa1afa8212117d97c9990690a7963f01ad4`; with
the comments removed it is identical to `c1dbeba33e…`), and the built
bundle is byte-identical (`index-DFsFzVEq.js`, `8c562211…`).

1. **"Another tab" in the late line (medium): needs a user decision; the
   text is not changed.** The decision as relayed said "another browser
   tab"; the text says "another tab" (Decisions, above). The review asked
   for a test before a browser tab is named. Tested now on the built app
   (`r3fix/tabaway.mjs`: headless Chrome 155 via puppeteer with a temporary
   profile, Chrome's background throttling left on; the smoke's pitch-only
   WAVs; panel on from the start; away from 4 s to about 45 s, which covers
   the cue's fill and its start marker at 30–38 s):

   | Voice (shift at) | Stayed on the Dashboard | Another browser tab in front (the app's page hidden) | The app's Pitch tab |
   |---|---|---|---|
   | Man (57.7 s) | warning 6.4 s after the shift | 6.4 s; the panel showed an estimate on 38 of 41 one-second samples while hidden | no warning within 25 s |
   | Woman (68.4 s) | 7.5 s | 7.6 s; 39 of 41 | no warning within 25 s |

   So the limit is the app's own tabs, where the panel is not mounted. A
   different browser tab did not stop the warning: the hidden page kept
   making its 2 s updates (Chrome's heavier throttling, to about once a
   minute, starts only after about 5 minutes hidden). Not tested: more than
   about 40 s hidden, a minimised window, other browsers, phones (where a
   background tab may be frozen). "Another tab" is true only when read as
   the app's tabs; "another browser tab" would be wrong by this test.
   Options for the user: keep "another tab", or name the app's tabs as the
   review suggests ("while you are on the Pitch, History or Resonance lab
   tab"). The module header and CLAUDE.md now say "another of the app's
   tabs" and give this result.

2. **"On from your first few seconds of listening" (low): needs a user
   decision; the text is not changed.** The limit applies when the panel's
   first update came before the cue filled (about 5 s of voiced speech,
   however long listening has run) and it showed no estimate in the start
   window. A user who starts listening with the panel off, turns it on
   before talking, and then talks while the first download runs past the
   start window gets no warning that session, and neither sentence of the
   late line describes them (the old "already on when you start talking"
   did). The review suggests: "If the panel is on before you start talking
   but shows no reading during roughly your first half-minute to a minute
   of talking …".

3. **"Tick for tick" without the cap's exception (low): applied in the
   docs.** With the panel on from the start the module equals the shipped
   module except after the voiced-frame cap applies. The review's
   simulation (`review-r3/sim3.mjs`, re-run on the edited module as
   `r3fix/sim3r.mjs`: 40 scenarios × 7 frame timings × 3 seeds, 840 runs,
   every row identical to the review's output) finds the new module
   different from the shipped one only in its four scenarios with more than
   7,200 voiced frames before t_start (held170, held200, heldPauseHeld170,
   heldPauseHeld190: 9 s of speech, then 170–200 s of held notes, in two
   cases split by a 300 s pause). In held170 (then speech and a +8 st
   shift) the shipped module warns at 272 s in 17 of 21 runs, the new
   module in 3 (the "drops" timing, whose stalls keep the voiced count
   under the cap) and b72bb8a's time cap in none. Added: the exception to
   "tick for tick" in the module header, the CLAUDE.md row and its
   resolved-issue entry, and this note's header; the cap as a limit in the
   module header's and CLAUDE.md's limits. Not changed: the panel's "More"
   text, which says held vowels are not supported but not this; its wording
   is the user's.

4. **The f98a4d3 commit message's "every mutant fails a check" (nit): no
   change.** It leaves out the `ceil` mutant, which is equivalent and
   expected to pass. The results above have it right; the commit is pushed
   and is not rewritten.

5. **The 7,521 bound at other frame spacings (nit): applied.** The module
   header and CLAUDE.md now say the bound is for the production ~25 ms
   spacing. With the measurement-only `?chunk=N` (5–50 ms) the buffer
   between S0's P0 and A40's freeze holds up to 40 s of voiced frames.
   `r3fix/chunkbound.mjs` (panel off, every frame voiced, the cue fills at
   10 s and sets its start 12, 39, 60 or 400 s later; the f98a4d3 module
   and the edited one give the same output):

   | Frame spacing | Most frames retained (buffer + ring) |
   |---|---|
   | 5 ms | 9,601 (8,001 + 1,600) |
   | 10 ms | 8,000 (7,200 + 800) |
   | 25 ms | 7,520 (7,200 + 320) |
   | 50 ms | 7,360 (7,200 + 160) |

Checks on this step's tree: `node tests/ml/pitch-only-warning-test.js`
217 of 217; `npm run lint`, `npm run test:unit` (40 of 40) and
`npm run build` pass.

Inputs and outputs of this step (scratch folder `warning-ks-q5-adopt/r3fix/`):

- `tabaway.mjs` `492081f566385e11a0a3013b5502afd92aa4f8931f99b0532dca105b02c0487c`
  and its output `tabaway.json` `65677d87067eafddb145937eeb60f2fdac3e43d62adab0ffee53ee9428ea54ed`
- `sim3r.mjs` `029e695b54a95b5f9d924781df9dbbec26a1cc377fb8a9aa7239b092b7dabfe7`
  (the review's `sim3.mjs` with the module path and output folder changed)
  and its output `sim3r.json` `66b3391430d252ba183c1e46f610148a127fe475f4d21f983908c64e49e13946`
- `chunkbound.mjs` `dce5b6b4f79183aed47038f127a7d522f8752c8fccc1a11d89cf1428c1ecbac5`
  and its output `chunkbound.txt` `5bbd879a04167a6534d2b8236f0431e85bf913781efb10055e8cb1856c7a02e4`


## Reproduce

The study scripts are in `scripts/heard-as/pitch-only/`. Run them in an
output directory under the gitignored `build/`, with `SYRINX_LIBRISPEECH`
and `SYRINX_HEARD_AS_DATA` set (see the calibration README):

```
python <repo>/scripts/heard-as/pitch-only/build_jobs.py nat,ptdb,hcs,picka,hcc,rb
node   <repo>/scripts/heard-as/pitch-only/session.mjs jobs_<set>.json out/<set>.jsonl   # per set
python <repo>/scripts/heard-as/pitch-only/features.py out/*.jsonl                       # -> features.pkl
python <repo>/scripts/heard-as/pitch-only/rules.py                                      # -> rules_all.csv
python <repo>/scripts/heard-as/pitch-only/select_report.py > report.txt
python <repo>/scripts/heard-as/pitch-only/details.py > details.txt
python <repo>/scripts/heard-as/pitch-only/posthoc.py                                    # the K = 1 / 2 / 3 flash check
python <repo>/scripts/heard-as/pitch-only/make_fixture.py out/*.jsonl                   # golden replay fixture
node tests/ml/pitch-only-warning-test.js
```

§8.9 (KS-Q5 and the bounded buffer; the study files are in the round-2
late-panel scratch folder, `<r2>` = `warning-late-panel-r2`):

```
node tests/ml/pitch-only-warning-test.js                                   # (f); PITCH_ONLY_WARNING_MODULE=<file> for the mutation check
node --expose-gc scripts/heard-as/pitch-only/warning_bound.mjs --hours=1 --runs=5 --chrome   # (c), (d)
node scripts/heard-as/pitch-only/make_fixture_late.mjs --harness=<r2>/harness/late-variants-r2.js \
     --rep=<r2>/fresh/out/rep_test.json <r2>/fresh/out/test_0.jsonl <r2>/fresh/out/test_1.jsonl
npm run build && node scripts/cue-strip-smoke-wavs.mjs --pitch-only-late=<r2>/fresh/jobs_test_hcsL.json
node scripts/cue-strip-smoke.mjs --viewport=desktop --pitch-only=man,woman --pitch-only-late=man,woman --panelOnAt=120   # (g)
```


## Appendix A. Steady-start study pre-registration (verbatim)

sha256 `7c53fcd5b4e2c38f41ba92a4c9b2eb769a025f28fd5624692d37e096298d6838` (of the file below, as hashed in scratch before any rule
was evaluated). Paths and branch names in it are as written then.

````markdown
# Pre-registration — a steadier start reference for the pitch-only warning

Written 2026-10-07, **before any candidate rule (or the shipped rule) has been evaluated on any
of the data below.** At the time of writing the only chain output in this study is one 8 s smoke
session (LibriSpeech test-other reader 6938, its first two utterances, used only to check that the
harness runs; no rule was computed on it). The shipped rule's numbers quoted below come from
rounds 1–2 (`measurements/heard-as-pitch-only-warning-2026-10-07.md` on branch `cue-strip`), not
from this study.

**Question (user decision G, 2026-10-07).** The shipped pitch-only warning compares the panel's
pitch with a pitch start P0 taken over the resonance cue's ~15 s start window. For a lively,
wide-ranging speaker its false-alarm share depends on where the session starts (round-2 review:
one expressive man 6.6 / 9.6 / 23.5 / 61.3 / 45.5 % over five starts). Is there a steadier start
reference that keeps the warning's hits?

## 1. Code under test and harness

- Chain: branch `cue-strip` @ 045ec9f, with `src/ml/heard-as.js` and `src/ml/audio-utils.js` from
  `cue-strip-cpu` @ 591da94 (the adopted 450 ms classifier hop, user decision F; on the files the
  chain imports, the two branches otherwise differ only by comments in heard-as.js). Source
  snapshot: `snap/`.
- Harness `session.mjs` = the round-3 replay harness (`cue-strip-r3/session_r.mjs`, itself the
  round-2 `scripts/heard-as/pitch-only/session.mjs`) with the classifier run only when
  `classifyDue(now, lastClassify, 450)` (other scored windows enter heard-as.js with
  `classified: false`). Real pitch worker; the gender worker's window schedule with the real
  utterance gate; deployed q8-v2 classifier; heard-as `estimate()`; the resonance worker path
  (lab engine "frames" mode + gated `resonanceCue.js`). A tick every 2 s of audio records the
  panel estimate (or its hide reason) and the resonance snapshot; posted pitch frames are stored,
  so every rule below is evaluated offline from causal inputs only.
- Rules are evaluated tick by tick in Python (round-2 method; the round-2 golden replay showed the
  JS module reproduces this tick for tick).

## 2. Data — fresh, public, never used in rounds 1–2

LibriSpeech **dev-other** and **test-other** (CC BY 4.0, downloaded for this study; rounds 1–2
used test-clean and dev-clean only). Speaker split, fixed now: **dev = dev-other (16 W, 17 M),
test = test-other (17 W, 16 M)** — speaker-disjoint by LibriSpeech construction. Sex from
`SPEAKERS.TXT`. Utterances in corpus order (numeric sort of the file name).

| Set | Construction | Sessions |
|---|---|---|
| `nat` | every reader, offset 0: first ≥ 180 s of utterances (0.25 s gaps; reader 6938 has 158 s — all of it) | 66 |
| `off` | the expressive readers (§4), replayed from start offsets: skip the first k ∈ {1, 2, 3, 5} utterances, then ≥ 180 s (with offset 0 = `nat`: 5 starts per reader) | 32 × 4 |
| `hcs` | the round-2 H&C sentence-proxy construction on every reader: base ≥ 50 s natural (7.2 kHz low-pass), shift = next ≥ 40 s through WORLD (dio + stonemask) in US (vocoder control) / PO (pitch only) / PE (pitch + envelope) / EO (envelope only); men up, women down (F0 × 1.7041, envelope × 1.168). **Rep A** from utterance 0; **rep B** from the first utterance after the `nat` span, when ≥ 90 s remain | ≤ 66 × 2 × 4 |
| `picka` | the round-2 PICKA construction (Jebens/VTServer pyworld transform) on every fresh woman, rep A: cells (ΔF0, ΔVTL st) (−6,0) (−12,0) pitch only; (−6,+1.8) (−12,+3.6) together; (0,+1.8) (0,+3.6) resonance only | 33 × 6 |

hcc (H&C syllable concatenations) and rb (RB695 TTS) are not speaker-based and were used in
round 2; they are not rebuilt.

## 3. Inputs (round-2 definitions, unchanged)

Tick = 2 s of audio. Visible = `estimate()` not hidden. u = resonance readout, R0 = `startU`.
Start window [t_fill, t_start] = first tick with fill ≥ 1 … first tick with `startU` set.
P8 = the panel's own ln F0. ΔP_st = 12·(P8 − P0)/ln 2, Δu = u − R0.
**Eligible (denominator, identical for every candidate)** = visible AND R0, u known AND fill ≥ 1
AND verdict ≠ "sustained" AND sinceResumeS ≥ 2 AND the **shipped** P0 known (≥ 20 voiced frames
in the start window). A candidate can additionally be "not ready" (its own P0 unknown or
suppressed) on an eligible tick: then its condition is false there.
Display = the shipped display: condition on K consecutive shown eligible ticks (hidden ticks
neutral, the run dropped after more than 5 hidden ticks in a row; a shown tick that is
ineligible, not ready or fails the condition drops the run). Condition = |ΔP_st| ≥ 4 st AND
|Δu| ≤ 0.6 u (X, Y fixed at the shipped values in every candidate). K = 2 unless stated.

## 4. Outcomes

**Failure set** (round-2 definition). Pitch-only sessions — `hcs` PO (reps A and B) and `picka`
(−6,0), (−12,0) — whose shown panel estimate (median two-way share over visible ticks with
t ≥ t_shift + 10 s; ≥ 3 such ticks, else excluded) differs from the listener two-way share by
≥ 20 points. Listener references: H&C sentences MPO 65.7, WPO 19.1; PICKA Meyer 2023 (−6,0) 6.3,
(−12,0) 54.8 (primary), Jebens 2022 26.0 / 65.1 and Nagels 2020 6.7 / 45.0 (sensitivity).
Base sex: male base = pitch raised, female base = pitch lowered.

**Hit**: the warning is on at ≥ 1 tick with t_shift < t ≤ t_shift + 10 s AND it was off at the
last eligible tick at or before t_shift. Also reported: hit within 14 s, time to first warning,
persistence (share of eligible ticks from t_shift + 10 s with the warning on).

**Natural false alarms**: per reader, share of eligible ticks with the warning on, `nat`
(offset 0). Reader-balanced mean per sex; per-reader maximum per sex.

**Expressive readers** (selected from the posted pitch frames only, before any rule is
evaluated): per split and sex, the **8** `nat` readers with the widest spread of posted voiced F0
(q90 − q10 in st over the whole offset-0 stream). **Start-offset robustness** per expressive
reader = the maximum, over its 5 starts (k = 0, 1, 2, 3, 5), of its natural false-alarm share.

**Guards**: together shifts (`hcs` PE, `picka` (−6,+1.8), (−12,+3.6)) and resonance-only shifts
(`hcs` EO, `picka` (0,+1.8), (0,+3.6)) — mean over sessions of the share of eligible ticks with
t ≥ t_shift + 10 s with the warning on, per base sex. Also reported: share of together sessions
warned within the first 10 s after the shift (the "flash"), vocoder controls (`hcs` US), the
baseline phase of shift sessions.

## 5. Candidates (all reported). Everything not named is the shipped rule.

- **S0 shipped**: P0 = ln median of the voiced frames in [t_fill, t_start]; K = 2.
- **A — longer start window.** P0(t) = ln median of the voiced frames in
  [t_fill, min(t, t_fill + W)] (expanding from t_start on, frozen at t_fill + W; never shorter
  than the shipped window), W ∈ {30, 45, 60} s of audio. **A-wait**: the same window, but not
  ready until t ≥ t_fill + W (no warning before), W ∈ {30, 45, 60}.
- **B — robust start statistic**: per-phrase medians. Phrases = runs of voiced frames split
  wherever two consecutive voiced frames are > 0.25 s apart; phrases with ≥ 8 voiced frames
  count. P0 = ln median of the phrase medians when ≥ 3 phrases count, else the frame median
  (S0's statistic). Windows: shipped, A30, A45, A60 (expanding), A45-wait.
- **C — suppress when the start was variable** (start = the shipped window): no warning while
  this P0 is in force when
  C1: the robust frame spread (q75 − q25)/1.349 of 12·log2 f over the start-window voiced frames
  > S, S ∈ {2.0, 2.5, 3.0, 3.5, 4.0} st;
  C2: the SD (st) of the phrase medians (B's phrases; needs ≥ 3 phrases, else not suppressed)
  > S, S ∈ {1.0, 1.5, 2.0, 2.5, 3.0} st.
- **D — slowly-updating reference.** Starts at S0's P0. After each shown eligible tick (after
  that tick's decision): P0 ← P0 + α·(P8 − P0) when
  D1 (adapts only while resonance and pitch move together): |Δu| > 0.6 AND
  sign(Δu) = sign(ΔP_st) AND |ΔP_st| ≥ 1, α ∈ {0.1, 0.25, 0.5};
  D2 (tracks while pitch is near the reference): |ΔP_st| < 4, α ∈ {0.05, 0.1, 0.2};
  D3 (D1 or D2), α ∈ {0.05, 0.1, 0.2}.
- **E — longer persistence**: K ∈ {3, 4}.

32 configurations + S0 (A 6, B 5, C 10, D 9, E 2).

## 6. Criteria (on a split; ALL must hold)

1. **Hits ≥ 0.85**, separately for male-base and female-base failure sessions of the split.
2. **Natural false alarms ≤ 2 %**, women and men separately (reader-balanced).
3. **Per-reader maximum ≤ 10 %** on natural reading (offset 0), every reader of the split.
4. **Start-offset robustness**: for every expressive reader of the split, the maximum share over
   its 5 starts ≤ 15 %.
5. **Together** and **resonance-only** shares not worse than S0's on the same split: ≤ S0 + 1.0
   percentage point, per base sex.

## 7. Selection and the one test evaluation

1. Every configuration (S0 included) is evaluated on **DEV only**. The dev table is written and
   the selection is made and recorded (file + sha256) before any test number is computed.
2. Among configurations passing all five criteria on dev: the lowest **mean worst-start share**
   (per sex, the mean over that sex's dev expressive readers of their max-over-starts share; then
   the mean of the two sexes); ties (≤ 0.001) → higher min(hit male, hit female) → lower
   max(natural FA W, M) → family order S0, A, B, C, D, E → the parameter closest to S0.
3. If S0 is selected, the answer is "keep the shipped reference". If no configuration passes on
   dev, nothing is selected; the test split then only describes S0 and each family's best dev
   configuration (ranked by number of criteria passed, then the same ordering) — no ship claim.
4. The selected configuration is evaluated **once** on TEST against the same five criteria (S0
   evaluated on test alongside, as the criterion-5 reference). It passes iff all five hold.
   After that, every configuration's test numbers are reported (descriptive only).

## 8. Reported in addition

Per sex everywhere; the Jebens / Nagels hit sensitivity; the start reference vs the reader's
session median (st); flash after together shifts; time to first warning. Public data only;
no private recordings.
````

## Appendix B. D2-0.1 confirmation pre-registration (verbatim)

sha256 `73850d11694d78c93bd3bc8c89639114ffda6f71d0328ae7aa4e5704ef83fa45` (of the file below, as hashed in scratch
at 2026-10-08T03:38:15-05:00, before any chain output on its data). Paths in it refer to the study's scratch folder.

````markdown
# Pre-registration: confirming D2-0.1 for the pitch-only warning on new speakers

Written 2026-10-08, **before any chain output on the data below and before either rule (S0, D2-0.1) has been
evaluated on it.** The only chain output so far in this directory is `smoke.jsonl`: 8 s of LibriSpeech test-other reader
6938, already used in the steady study. It was used only to check that the harness runs and matches
`scripts/heard-as/chain.mjs` (`parity.mjs`: same posted pitch, same 16 classified window times). No rule was computed on it.

**Question (user decision 3, 2026-10-08).** The 2026-10-07 steady-start study found no pre-registered winner. Post hoc,
**D2-0.1** removed the start-offset false alarms for expressive readers (worst start 17.5 % → 0 % on test-other) and kept
the shipped rule's hits. Does D2-0.1 hold up on speakers that no Syrinx study has used? Ship it only if it passes.

## 1. Code under test and harness

- Chain: branch `cue-strip` @ **adf19c3** (`git archive` → `snap/`; aggregate sha256 of the snapshot's file hashes
  38008ec5…a521b0). Compared with the steady study's chain, this one adds the Silero speech detector in the gender
  worker's utterance gate (voice-direction 25ad5e5) and the V200 voiced-window rule in `heard-as.js`
  (`HEARD_AS_CALIBRATION.logitMinVoicedMs` 200; the harness checks this value and `ML_CLASSIFY_HOP_MS` 450 at startup).
  It also has the resonance-perf engine (fft.js / sinc-resampler.js).
- Harness `session.mjs` = the steady study's `session.mjs` with three changes. (1) It imports from the adf19c3 snapshot.
  (2) It feeds the speech detector exactly as `gender-worker.js` handleChunk and `scripts/heard-as/chain.mjs` do: after
  the relayed pitch hints, the chunk's 16 kHz resampler output goes through `createSpeechFramer`, and each 32 ms frame's
  Silero probability goes to `gate.noteSpeech` before the 150 ms decision. The Silero file is checked against
  `SPEECH_DETECTOR.modelSha256`; onnxruntime-web runs as WASM with 1 thread; each session gets a fresh framer and LSTM state.
  (3) It loads the classifier and ORT from the cue-strip worktree's node_modules.
  Everything else is unchanged: the real pitch worker, the gender worker's window schedule, the real utterance gate,
  the 450 ms classifier hop, the deployed q8-v2 classifier, heard-as `estimate()`, the resonance worker path
  (lab engine "frames" + `resonanceCue.js`), and a tick every 2 s of audio.
- Rules are evaluated tick by tick in Python. `evaluate.py` is copied byte for byte from the steady study
  (sha256 652dc467…3893); `features.py` is likewise unchanged. `evaluate_confirm.py` only applies the bar in §5.
- File hashes at registration: session.mjs 8ccbfa83…5d9, build_jobs.py f4914280…f535, features.py 02f5786b…d4af635,
  evaluate_confirm.py c19c2458…bac632, select_extract.py 9374b96c…c5e8, used_speakers.py 400bbfa0…532b,
  used_speakers.json c10563f9…6a21, speakers.json fb3f6a0a…127d.

## 2. Data: public speakers no Syrinx study has used

**LibriSpeech train-other-500** (CC BY 4.0), from the Hugging Face parquet copy `openslr/librispeech_asr`,
`all/train.other.500` shards 0000–0005 (108 speakers). No Syrinx study has used train-other-500 as a subset.

**Exclusion** (`used_speakers.py` → `used_speakers.json`). A candidate is excluded if its id matches
`<spk>[-_/]<2–6 digits>[-_/]`, `ls<spk>` or `/<spk>/` anywhere in:
- every file and directory name under the scratchpad (all prior studies);
- the voice-detector branch's `build/`, whose training and validation manifests list its LibriSpeech, VCTK and other
  speakers;
- cue-strip's measurements/, scripts/ and tests/;
- the contents of every text file under 8 MB in those places, except the gap-bridge and vocal-weight per-frame dumps,
  where only names are checked.

The test is over-inclusive on purpose. It excludes 42 of the 108, including the LibriTTS-P study's readers
(2237, 2407, 2491, 2748, 6627, 7138). Most other hits are coincidental numbers, for example in the Saarbrücken
manifest; they are excluded anyway. VCTK is not used because the voice-detector training set contains almost all of
its speakers. Common Voice is not used.

**Selection** (`select_extract.py`, mechanical). Keep speakers that are not excluded and have ≥ 330 s of audio in the
shards. Per sex, sort by speaker id and take n = min(#F, #M) = **33 women, 33 men**:
- F: 3179 3290 3479 3564 3598 3647 4211 4225 4234 4280 4513 4959 4991 5233 5890 6087 6138 6227 6254 6549 6610 6853
  6943 6967 6978 7012 7250 7255 7360 7387 7514 8148 8296
- M: 3238 3665 3894 3912 4172 4480 4741 5118 5152 5245 5328 5791 6065 6184 6311 6356 6482 6652 6752 7009 7107 7307
  7389 7502 7585 7823 8033 8273 8291 8367 8413 8587 9000

Sex comes from `SPEAKERS.TXT`. Utterances are taken in corpus order (numeric sort of the file name) over the
utterances present in the six shards. All 66 speakers form one set, `confirm`. There is no dev/test split: this is a
single confirmatory evaluation of one fixed rule.

**Sets** (`build_jobs.py`, the steady study's construction unchanged):

| Set | Construction |
|---|---|
| `nat` | Every reader at offset 0: the first ≥ 180 s of utterances, with 0.25 s gaps. |
| `off` | The expressive readers (§4) replayed from start offsets: skip the first k ∈ {1, 2, 3, 5} utterances, then ≥ 180 s. With offset 0 = `nat`, that is 5 starts per reader. |
| `hcs` | The H&C sentence-proxy shift on every reader. Base = ≥ 50 s of natural speech (7.2 kHz low-pass). Shift = the next ≥ 40 s through WORLD (dio + stonemask) in four conditions: US (vocoder control), PO (pitch only), PE (pitch + envelope), EO (envelope only). Men's voices go up, women's go down (F0 × 1.7041, envelope × 1.168). Rep A starts at utterance 0. Rep B starts after the `nat` span, when ≥ 90 s remain. |
| `picka` | PICKA cells on every woman, rep A, cells (ΔF0, ΔVTL st): pitch only (−6,0) and (−12,0); together (−6,+1.8) and (−12,+3.6); resonance only (0,+1.8) and (0,+3.6). |

## 3. Inputs and the two rules

Inputs, eligibility and display are the steady study's §3, unchanged:
- Tick = 2 s. P8 = the panel's ln F0. ΔP_st = 12·(P8 − P0)/ln 2. Δu = u − startU.
- An eligible tick is visible, has startU and u, fill ≥ 1, verdict ≠ "sustained", sinceResumeS ≥ 2, and a known
  shipped P0 (≥ 20 voiced frames in [t_fill, t_start]).
- The condition is |ΔP_st| ≥ 4 st AND |Δu| ≤ 0.6 u.
- The warning shows when the condition holds on K = 2 consecutive shown eligible ticks. Hidden ticks are neutral; the
  run is dropped after more than 5 hidden ticks in a row; a shown tick that is ineligible or fails the condition
  drops the run.

The two rules:
- **S0 (shipped)**: P0 = ln median of the posted voiced frames in [t_fill, t_start], frozen.
- **D2-0.1**: starts at S0's P0. After each shown eligible tick, and after that tick's decision: if |ΔP_st| < 4 st,
  then P0 ← P0 + 0.1·(P8 − P0). Everything else is as in S0. This is `evaluate.py` configuration `D2-0.1`
  (fam D, kind D2, a 0.1).

## 4. Outcomes (steady study §4 definitions)

- **Failure set.** Pitch-only sessions (`hcs` PO reps A and B; `picka` (−6,0) and (−12,0)) whose shown panel estimate
  differs from the listener two-way share by ≥ 20 points. The shown estimate is the median share over visible ticks
  with t ≥ t_shift + 10 s; sessions with fewer than 3 such ticks are excluded. Listener references: H&C MPO 65.7,
  WPO 19.1; PICKA Meyer 2023 6.3 / 54.8 (primary); Jebens and Nagels as sensitivity checks. Male base = pitch
  raised; female base = pitch lowered.
- **Hit.** The warning is on at ≥ 1 tick in (t_shift, t_shift + 10 s], and it was off at the last eligible tick
  at or before t_shift.
- **Natural false alarms.** Per reader, the share of eligible ticks with the warning on in `nat` (offset 0).
  Reported as the reader-balanced mean per sex.
- **Expressive readers.** Per sex, the **8** `nat` readers with the widest spread of posted voiced F0 (q90 − q10 in st
  over the whole offset-0 stream). They are chosen from posted pitch frames only (`evaluate_confirm.py expressive`),
  before any rule is evaluated. Each reader's **worst-start share** is the maximum over its evaluable starts
  (k = 0, 1, 2, 3, 5; a start with no eligible tick is skipped) of its natural false-alarm share.
- **Together / resonance-only.** Together = `hcs` PE and `picka` (−6,+1.8), (−12,+3.6). Resonance only = `hcs` EO and
  `picka` (0,+1.8), (0,+3.6). The outcome is the mean over sessions of the share of eligible ticks with
  t ≥ t_shift + 10 s on which the warning is on. Reported per sex of the base voice.

## 5. Pre-registered bar (all required, per sex; applied to D2-0.1 with S0 on the same sessions as reference)

1. **Start-offset robustness**: every expressive reader's worst-start share ≤ 15 %. Women and men separately.
2. **Natural false alarms** ≤ 2 % (reader-balanced mean). Women and men separately.
3. **Hits non-inferior to S0**: D2-0.1 hits ≥ S0 hits − 0.05. Primary listener reference (Meyer), male base and
   female base separately. The bar applies whatever the failure-set size; n is reported.
4. **Together** false alarms ≤ S0 + 2 pp and **resonance-only** false alarms ≤ S0 + 2 pp. Women and men separately.

Boundaries are inclusive (tolerance 1e-12). **PASS** means all 10 checks hold (2 sexes × 5). Otherwise **FAIL**, and
D2-0.1 is not shipped. Nothing is re-tuned on this data: no other α, threshold or rule is evaluated for selection.
Any further number is descriptive.

## 6. Reported

- Full tables for both rules: hits (Meyer, Jebens, Nagels), hit within 14 s, time to first warning, persistence,
  natural false alarms (mean, maximum and argmax reader), offset detail per expressive reader, together, resonance-only
  and vocoder-control shares, flash after together shifts, and the baseline phase of shift sessions.
- S0 against the same bar, as a description only.
- Public data only; no private recordings.
````

**Erratum (2026-10-08, after review; the verbatim block above is left
untouched).** Two truncated hashes in its §1 were mistyped when the file was
written: "build_jobs.py f4914280…f535" and "features.py 02f5786b…d4af635"
(the "d4af635" suffix belongs to build_jobs.py; "f535" matches neither
file). Both files predate the registration (modified 02:20 and 02:19, the
registration was hashed at 03:38:15) and features.py is byte-identical to
the steady study's copy. Full sha256 of every file the registration lists,
as they are in the study's scratch folder:

| file | sha256 |
|---|---|
| session.mjs | `8ccbfa834d058db0b7e78385520374e37cd2fe2da1d978f3df1a28f8e46365d9` |
| build_jobs.py | `f49142802a3f86c1d7d4136b0dbebe3796305cf71fb20adccf3bf700dd4af635` |
| features.py | `02f5786b1be1688a432595291cebeef08e35fa5fcad1d9eabb212c3ab894aee5` |
| evaluate.py | `652dc467314d46a0a201392e77db6b4b8002183f6813334fc337222dde223893` |
| evaluate_confirm.py | `c19c24583bcbf9a9c95e780c4423ff030a7c181c9e86fd14357dd9edd6bac632` |
| select_extract.py | `9374b96c6160368db04388985798db7e15da1771fabbe81a9ef1d08d7726c5e8` |
| used_speakers.py | `400bbfa0ec6a8509d1707f7638fa110048c8e6ae2f0247910de3a33ae26a532b` |
| used_speakers.json | `c10563f968bee5bd94e876bbdff24b2288e53d9ffc18c780a101acc79cce6a21` |
| speakers.json | `fb3f6a0aa4d52adcc571ffc9493998fca31ca8b49f57ac829a6abf901be2127d` |

## Appendix C. Men's false-alarm study pre-registration (verbatim)

sha256 `6f86c692adc8888c711ca1f5e9b815a78845fc41cd934e3c3af9a8c26c683e8f` (of the file below, as hashed in scratch
before any chain output on its speakers and before any candidate was evaluated on them). Relative paths in it refer to
the study's scratch folder. The scratch file has CRLF line endings; the block below, with its lines ended CRLF
(including the last), hashes to this value. **Correction (review, 2026-10-11):** its "State at registration" line
"No test-split audio or job exists" is inaccurate — the test speakers' source files (LibriSpeech FLACs, MLS audio) had
already been extracted from the downloaded shards at 17:38, 15 minutes before it was hashed. No test *session* audio,
job, posted pitch or analysis existed; see §8.4 "Corrections after review".

````markdown
# Pre-registration: a pitch-only-warning rule that removes the male false alarms and keeps hits for both sexes

Written 2026-10-11, **before any chain output on the speakers below and before any candidate has been evaluated on
them.** Hard rule 3: `src/ml/pitch-only-warning.js` is a tuned cue-strip module, so the rule is selected on a dev split
and tested once on a held-out test split, both from public speakers no earlier study has used.

**State at registration.** The dev split's session audio and job files (`nat`, `hcs`, `ehcs`, `picka`) are built
(`build_jobs.py`; WORLD / PICKA transforms only). No session has been run through the chain on any speaker of this
pool, no posted pitch has been computed, and no rule has been evaluated. No test-split audio or job exists.

**Question (user decision, 2026-10-11).** The shipped rule S0 gives men far more natural false alarms (FA) than women
(confirmation: 4.06 % vs 0.46 %, one reader 54 %, expressive readers' worst start 74.7 % vs ≤ 2.6 %). The post-hoc
diagnosis (`../diagnose/DIAGNOSIS.md`) attributes about 72 % of men's FA time to an unrepresentative ~20 s start
reference and about 11–27 % to genuine wide intonation; octave errors are not the cause. Which fix, if any, brings men's
FA down to women's level without costing hits for either base sex?

Everything the diagnosis reported was computed on the confirmation and steady-start data, with candidates and
parameters chosen after seeing it. None of that data is used here.

## 1. Code under test and harness

- Chain: branch `cue-strip` @ **53704cc** (`git archive 53704cc src public/resonance-lab scripts/resonance-lab/candidates/formant-vtl scripts/heard-as package.json`
  → `snap/`). No chain file changed since the confirmation's adf19c3 (`git diff --stat adf19c3 53704cc -- src/ml src/dsp
  src/resonance src/resonance-lab public/resonance-lab scripts/resonance-lab/candidates/formant-vtl` is empty); the
  commits in between touch only UI files (trace drawing, panel rendering).
- `session.mjs` = the confirmation's harness byte for byte except a header comment and one error message (4 added
  comment lines, 1 changed message string; `diff ../../mainthread-warning/confirm/session.mjs session.mjs`). It runs the real pitch worker, the gender
  worker's window schedule with the real utterance gate and the Silero speech detector, the 450 ms classifier hop, the
  deployed q8-v2 classifier, heard-as `estimate()`, the resonance worker path (lab engine "frames" + `resonanceCue.js`),
  and a tick every 2 s of audio.
- `evaluate.py` and `features.py` are the confirmation's files, byte-identical (sha256 652dc467…3893 and 02f5786b…aee5).
  `rules.py` implements the candidates (§3) and `study.py` applies the outcomes (§4), the bar (§5) and the selection (§6).
- `rules.py` was checked before registration against `evaluate.py` and the diagnosis' `cand.py` on the ALREADY-SEEN
  confirmation / steady data only (`tools/check_rules.py`): S0 tick-identical to `evaluate.py` (0 mismatches in all
  three splits); A40, CUM-g, DS10, KP8-2.5, KP8-3, A40+KP8-2.5 and A40+KP8-2.5+DS10 reproduce the diagnosis' numbers.
  One deliberate difference: KP8 is applied uniformly with the history back-filled against S0's P0 for ticks before
  t_start (the diagnosis' CUM-g+KP8 used no pre-start history), so CUMg+KP8-2.5 differs from the diagnosis' row.

File hashes at registration (`study.py` refuses to run if any changed):
- hash session.mjs a307f583b55e3539313c2c44cc0c55b425f62e1a5dc5a007de2ba73035f07d5f
- hash pitch_only.mjs e34a6701a511ba4ede5e05b629d6817fc8ce035aaa3c6b856dd58447f6b4590c
- hash build_jobs.py bfa8b21a652f8e8f1a71cfac163594511929786a0989cad51e7f2ff728009f10
- hash rules.py 480b17ca42f30db06ee75e6de0fef0a625ba6304c1b8e7a4c88bf68c07a13902
- hash study.py 38e0e031d884526db4aca3e9c9e754965b7297c034a550a79f3123f2b40f266a
- hash evaluate.py 652dc467314d46a0a201392e77db6b4b8002183f6813334fc337222dde223893
- hash features.py 02f5786b1be1688a432595291cebeef08e35fa5fcad1d9eabb212c3ab894aee5
- hash pool.json 8e6b4eee015d9e8d058850612e3886c3b675eb28fb85553cb4cddc003e7d03ca
- hash inventory.json 6a097a441281a862035e7934ee710b5802f976522d625aadc5c0f7fe0760a585
- hash used_speakers.json abe515fb47ef129572eb43c560bc85edf4af1fc404530628a446985082dbece6
- hash tools/inventory.py 684116d0aa337bc116a6529709ed7ba170583645617b252205fdd0b51de425f0
- hash tools/used_speakers.py e5b7a7b9fa7893ba11055c344fd10798ec2a7f33a1fb344c6fe923466ac3225b
- hash tools/pool.py 0d8d245c757576b7ef820d8a82afeb33647bb2a2a91415ddb9c41300e5380b9c
- hash tools/check_rules.py 2315a9a1905b7127f41a46dc97de034c46fc211150895ec8b2d3c70c22c6d871
- hash snap.sha256list fd540a53123ae547f58168f375a9f8cf441e063427f0f620349b825cffa6a849

## 2. Data: public speakers no earlier study has used

| Source | Licence | Partition used | Why |
|---|---|---|---|
| LibriSpeech train-other-500 shards 0006–0009 and train-clean-360 shards 0000–0003 (Hugging Face `openslr/librispeech_asr`, parquet) | CC BY 4.0 | train | the confirmation used train-other-500 shards 0000–0005 only; train-clean-360 was never used |
| Multilingual LibriSpeech, German (`facebook/multilingual_librispeech`, parquet; sex from MLS `metainfo.txt`) | CC BY 4.0 | MLS dev → our dev, MLS test → our test | a second open corpus, another language and another reader population; never used in any Syrinx study |

VCTK is not used: the voice-detector training manifests contain all 110 of its speakers. Common Voice is not used:
its download is gated and few speakers have ≥ 330 s. VoxPopuli was checked and dropped: its test/validation speakers
have < 330 s each, and its train shards shuffle each speaker's segments across 30 × 3.2 GB files, so a per-speaker
session would splice segments from different years.

**Exclusion** (`tools/used_speakers.py`, the confirmation's scan with this folder skipped and the Syrinx main repo's
measurements/, scripts/ and tests/ added). A candidate is excluded if its id matches `<id>[-_/]<2–6 digits>[-_/]`,
`ls<id>` or `/<id>/` in any file or directory name under the scratchpad (every earlier study, incl. the diagnosis),
the voice-detector branch's `build/` (its training and validation manifests), cue-strip's and main's measurements/,
scripts/ and tests/, or in the contents of their text files under 8 MB; and any of the confirmation's 66 readers is
excluded explicitly. The earlier studies' LibriSpeech subsets (test-clean, dev-clean, dev-other, test-other) are disjoint
from train-* by LibriSpeech construction. Over-inclusive on purpose; 82 of the 208 downloaded candidates are excluded: ls1052, ls1112, ls1160, ls1222, ls1289, ls1291, ls1316, ls1341, ls1347, ls1382, ls1425, ls1446, ls1456, ls1487, ls1569, ls1572, ls159, ls1595, ls1603, ls1653, ls1664, ls167, ls1699, ls1731, ls177, ls1825, ls1859, ls1974, ls203, ls2050, ls2127, ls2229, ls2246, ls2299, ls2364, ls252, ls2638, ls2971, ls30, ls3307, ls339, ls36, ls432, ls510, ls511, ls56, ls6111, ls6673, ls6914, ls720, ls766, ls782, ls7839, ls8195, ls846, ls8664, ls876, ls899, ls923, ls969, mls1054, mls1163, mls11695, mls1262, mls135, mls137, mls138, mls140, mls141, mls144, mls145, mls1593, mls1660, mls1757, mls1844, mls1874, mls1946, mls2252, mls278, mls4730, mls5295, mls91..

**Selection** (`tools/pool.py`, mechanical, from metadata only: sex labels and durations; no audio analysis).
Eligible = not excluded, sex f/m, ≥ 330 s of audio in the downloaded files.
- LibriSpeech: per sex, sort by numeric speaker id; n_LS = min(#F, #M, 34), rounded down to even; take the first n_LS
  per sex; alternate dev / test in that order (positions 0, 2, … dev; 1, 3, … test).
- MLS German: every eligible speaker; MLS's own dev partition → dev, test partition → test.
- Utterance order: LibriSpeech = numeric sort of the file name (the confirmation's rule); MLS = chapter id, source file,
  begin time (reading order within a chapter).

| Split | Sex | LibriSpeech train-other-500 | LibriSpeech train-clean-360 | MLS German | Total | Speakers |
|---|---|---|---|---|---|---|
| dev | f | 11 | 6 | 9 | 26 | ls3025 ls3411 ls3551 ls3698 ls4156 ls4936 ls5045 ls5296 ls5487 ls5725 ls5831 ls6544 ls6676 ls7515 ls7945 ls8012 ls8329 mls2974 mls3277 mls3862 mls5934 mls7320 mls8325 mls8769 mls9514 mls10349 |
| dev | m | 9 | 8 | 9 | 26 | ls296 ls3132 ls3691 ls3989 ls4243 ls4428 ls4836 ls5147 ls5181 ls5242 ls5460 ls5746 ls5781 ls5935 ls6115 ls6199 ls6436 mls4001 mls5595 mls7002 mls7272 mls8743 mls9948 mls10870 mls13255 mls13494 |
| test | f | 8 | 9 | 7 | 24 | ls3380 ls3513 ls3675 ls3905 ls4443 ls5007 ls5082 ls5471 ls5588 ls5740 ls6106 ls6568 ls7245 ls7644 ls7994 ls8300 ls8414 mls3588 mls4739 mls6067 mls7120 mls7261 mls7456 mls7624 |
| test | m | 8 | 9 | 7 | 24 | ls2774 ls3289 ls3845 ls4054 ls4420 ls4590 ls4931 ls5157 ls5183 ls5304 ls5637 ls5767 ls5840 ls6075 ls6177 ls6368 ls6506 mls3040 mls3052 mls3363 mls4705 mls4748 mls4911 mls7406 |

`pool.json` (sha256 in the hash list) holds the exact speakers, splits and ordered file lists.

**Expressive readers** (the start-offset outcome). Per split and sex, the top quartile (ceil(n/4)) of readers by the
spread q90 − q10 (st) of their **posted voiced pitch in the first 60 s** of the offset-0 (`nat`) session; ties by
speaker key. Dev: from the dev `nat` session outputs, before any rule is evaluated (`study.py expressive dev`). Test:
from `pitch_only.mjs`, the real pitch worker alone over the same audio (no ML, resonance, panel or warning), after the
choice is written. Each expressive reader is replayed from 5 starts (k = 0, 1, 2, 3, 5 utterances skipped).

**Sets** (`build_jobs.py`; the confirmation's construction, plus `ehcs`):

| Set | Construction |
|---|---|
| `nat` | Every reader at offset 0: the first ≥ 180 s of utterances, 0.25 s gaps. |
| `off` | Expressive readers from start offsets k ∈ {1, 2, 3, 5}, then ≥ 180 s. With `nat`, 5 starts per reader. |
| `hcs` | H&C sentence-proxy shift on every reader. Base = ≥ 50 s natural speech (7.2 kHz low-pass); shift = the next ≥ 40 s through WORLD (dio + stonemask) in US (vocoder control), PO (pitch only), PE (pitch + envelope), EO (envelope only); men up, women down (F0 × 1.7041, envelope × 1.168). Rep A from utterance 0; rep B after the `nat` span when ≥ 90 s remain. |
| `picka` | PICKA cells on every woman, rep A: pitch only (−6,0) (−12,0); together (−6,+1.8) (−12,+3.6); resonance only (0,+1.8) (0,+3.6). |
| `ehcs` | **Early shift (new).** Base = ≥ 36 s natural speech from utterance 0 (7.2 kHz low-pass); shift = the next ≥ 40 s in PO and PE (the hcs WORLD transform, same files where the utterances coincide). The shift lands while A40's reference is still growing (t_fill + 40 s ≈ 50 s) and, for some sessions, before t_start. |

## 3. Inputs and rules

Inputs, eligibility and display are the confirmation's §3, unchanged: tick = 2 s; P8 = the panel's ln F0 (heard-as
`estimate().lnF0`, median of posted pitch over the trailing 8 s); ΔP = 12·(P8 − P0)/ln 2; Δu = u − startU; an eligible
tick is visible with startU and u known, fill ≥ 1, verdict ≠ "sustained", sinceResumeS ≥ 2 and S0's P0 known (≥ 20
voiced frames in [t_fill, t_start]); condition |ΔP| ≥ X AND |Δu| ≤ 0.6 u; shown after K = 2 consecutive shown
eligible ticks meeting it; hidden ticks neutral, the run dropped after more than 5 hidden ticks in a row; a shown tick
that is ineligible or fails the condition drops the run.

**Reference S0 (shipped).** P0 = ln median of the posted voiced frames in [t_fill, t_start], frozen; X = 4 st.

**Candidates** (`rules.py`; each = a reference × an optional pitch-threshold rule × an optional panel gate):

| Part | Definition |
|---|---|
| ref S0 | as above |
| ref A40 | P0(t) = ln median of the posted voiced frames in [t_fill, max(t_start, min(t, t_fill + 40 s))]: grows until t_fill + 40 s, then frozen |
| ref CUMg | a pool starts as the posted voiced frames in [t_fill, t_start]; at each tick at or after t_start, P0 = ln median of the pool (before this tick's frames); after the decision, if the tick is shown, eligible and \|ΔP\| < 4 st, the posted voiced frames since the previous tick join the pool (frames of every other tick never do) |
| KP8-k | X(t) = max(4 st, k × RMS of the history) once the history holds ≥ 5 values, else 4 st. History = ΔP of the earlier shown ticks (P8 known) whose \|ΔP\| was below that tick's X, in tick order; ticks before t_start count with ΔP against S0's P0 (the panel stores their P8 and back-fills them when P0 becomes known). k ∈ {2.5, 3} |
| DS10 | also require \|s − s0\| ≥ 10 points, s = the panel's shown share, s0 = median s over the shown ticks in [t_fill, t_start] |

The 17 candidates = {S0, A40, CUMg} × {—, KP8-2.5, KP8-3} × {—, DS10} minus S0 alone:
- `DS10`: {"ref": "S0", "kp8": null, "ds": 10}
- `KP8-2.5`: {"ref": "S0", "kp8": 2.5, "ds": null}
- `KP8-2.5+DS10`: {"ref": "S0", "kp8": 2.5, "ds": 10}
- `KP8-3`: {"ref": "S0", "kp8": 3.0, "ds": null}
- `KP8-3+DS10`: {"ref": "S0", "kp8": 3.0, "ds": 10}
- `A40`: {"ref": "A40", "kp8": null, "ds": null}
- `A40+DS10`: {"ref": "A40", "kp8": null, "ds": 10}
- `A40+KP8-2.5`: {"ref": "A40", "kp8": 2.5, "ds": null}
- `A40+KP8-2.5+DS10`: {"ref": "A40", "kp8": 2.5, "ds": 10}
- `A40+KP8-3`: {"ref": "A40", "kp8": 3.0, "ds": null}
- `A40+KP8-3+DS10`: {"ref": "A40", "kp8": 3.0, "ds": 10}
- `CUMg`: {"ref": "CUMg", "kp8": null, "ds": null}
- `CUMg+DS10`: {"ref": "CUMg", "kp8": null, "ds": 10}
- `CUMg+KP8-2.5`: {"ref": "CUMg", "kp8": 2.5, "ds": null}
- `CUMg+KP8-2.5+DS10`: {"ref": "CUMg", "kp8": 2.5, "ds": 10}
- `CUMg+KP8-3`: {"ref": "CUMg", "kp8": 3.0, "ds": null}
- `CUMg+KP8-3+DS10`: {"ref": "CUMg", "kp8": 3.0, "ds": 10}

DS10 depends on the ML meter's shown share; adopting a DS10 candidate also needs a product decision (warn only when the
panel itself moved). **D2-0.1** (the slowly tracking start, `evaluate.py` fam D, kind D2, a 0.1) is reported for
comparison only and cannot be chosen.

## 4. Outcomes (the confirmation's §4 definitions, computed by its `evaluate.py`)

- **Failure set / hit.** Pitch-only sessions (`hcs` PO reps A and B; `picka` (−6,0), (−12,0)) whose shown panel
  estimate (median share over visible ticks at t ≥ t_shift + 10 s, ≥ 3 ticks) differs from the listener two-way share
  by ≥ 20 points (H&C MPO 65.7 / WPO 19.1; PICKA Meyer 2023 6.3 / 54.8 primary; Jebens and Nagels reported). Hit = the
  warning is on at ≥ 1 tick in (t_shift, t_shift + 10 s] and was off at the last eligible tick at or before t_shift.
  Male base = pitch raised; female base = pitch lowered.
- **Early-shift hit** (new): the same failure-set rule and hit definition on `ehcs` PO (H&C references).
- **Natural FA**: per reader, the share of eligible ticks with the warning on in `nat` (offset 0); reader-balanced mean
  per sex; **per-reader max** per sex.
- **Worst start**: per expressive reader, the maximum over its evaluable starts (k = 0, 1, 2, 3, 5) of the natural-FA
  share; per sex, the maximum over its expressive readers.
- **Together / resonance-only**: mean over sessions of the share of eligible ticks with t ≥ t_shift + 10 s with the
  warning on (together = `hcs` PE + `picka` (−6,+1.8), (−12,+3.6); resonance only = `hcs` EO + `picka` (0,+1.8),
  (0,+3.6)), per sex of the base voice.
- Reported too (descriptive): hits with the Jebens and Nagels references, hit within 14 s, time to first warning,
  persistence, vocoder control, flash after together shifts, baseline-phase FA, early-shift together, and (after the
  choice, descriptive) the per-corpus breakdown.

## 5. The bar (all checks, per sex; the candidate against S0 on the SAME sessions)

1. Natural FA ≤ 2 % for women and for men, **and** |men − women| ≤ 1.5 pp.
2. Per-reader natural-FA maximum ≤ 15 % for each sex.
3. Every expressive reader's worst start ≤ 15 %, each sex.
4. Hits within 10 s (Meyer primary) ≥ S0's hits − 0.03, for each base sex (non-inferior).
5. Early-shift hits ≥ S0's early-shift hits − 0.03, for each base sex.
6. Together FA ≤ S0 + 2 pp and resonance-only FA ≤ S0 + 2 pp, each sex.

That is 15 checks: natFA F, natFA M, the gap, reader max F/M, worst start F/M, hits F/M, early hits F/M, together F/M,
resonance-only F/M. Boundaries inclusive (tolerance 1e-12). A hit check whose failure set is empty (for the candidate or
S0) passes vacuously and is reported with n = 0. **PASS** = all 15 hold.

## 6. Selection on dev (`study.py dev`), then one test evaluation

1. Run every session of the dev split; compute the expressive readers from the dev `nat` outputs; run their `off`
   sessions; build features; evaluate S0, the 17 candidates and D2-0.1 on dev.
2. **Choice.** Among the candidates that pass all 15 checks on dev (S0 on dev as the reference), order by: (a) the
   larger of the two sexes' worst-start maxima, lower first; (b) the larger of the two sexes' natural FA, lower first;
   (c) the smaller of the two sexes' hit change vs S0, higher first; (d) fewer parts; (e) the listing order in §3.
   Take the first. **If none passes**, take the candidate with the most checks passed, ties by the same order (a)–(e),
   and say so in CHOICE.md; it still goes to the single test evaluation, where only the bar decides.
3. CHOICE.md (with the dev table's sha256 and this file's sha256) and CHOICE.sha256 are written **before** any
   test-split audio, job or chain output exists.
4. Then the test split is prepared: audio, `nat` / `hcs` / `picka` / `ehcs` jobs, the expressive readers by
   `pitch_only.mjs` (posted pitch only) and their `off` jobs. **The test sessions are not run in this step.**
5. The test evaluation is run once (`study.py test`) on the chosen rule with S0 on the same sessions. PASS → the rule is
   proposed for cue-strip (with the DS10 product decision if it contains DS10); FAIL → S0 stays. Nothing is re-tuned on
   test data; any other number on test is descriptive.

## 7. Notes

- The diagnosis found that no frozen reference can bring its worst reader (6652) under 15 % and that only KP8-3 did so on
  that data, at a cost of borderline female hits. Bar check 3 may be unreachable on fresh data as well; the study
  reports that if so.
- Hit checks have 1/n resolution: with fewer than 34 failure-set sessions for a base sex, one session is more than
  0.03, so checks 4 and 5 forbid a net loss of even one hit for that base sex.
- Public data only (LibriSpeech, MLS); no private recordings, no names.
````

## Appendix D. Men's false-alarm study choice (verbatim)

sha256 `aedd7c46af52008d9cf4212576b9a9767b8bf8ef1e1d4666a2343742b9b2855a` (of the file below, written by `study.py dev`;
the file was created and hashed at 2026-10-11 19:08:22 −05:00 — its `CHOICE.written_at` stamp, 19:08:34, was written
12 s later — before any test-split session audio, job or chain output existed). Same CRLF convention as Appendix C.

````markdown
# Choice (male-FA selection study, dev split)

Written by `study.py dev` before any test-split session audio, job or chain output exists.

- PREREG.md sha256: `6f86c692adc8888c711ca1f5e9b815a78845fc41cd934e3c3af9a8c26c683e8f`
- dev_table.csv sha256: `cad2a5478323b0e1619b643bb6fa080db48f62d1c620e007cf30a762f0f3a32a`
- **Chosen: `A40+KP8-3+DS10`** = {"ref": "A40", "kp8": 3.0, "ds": 10}
- How: passes every dev check; first by the PREREG §6 order among the passing candidates.
- Candidates passing every dev check: ['DS10', 'KP8-2.5', 'KP8-2.5+DS10', 'KP8-3', 'KP8-3+DS10', 'A40+DS10', 'A40+KP8-2.5+DS10', 'A40+KP8-3', 'A40+KP8-3+DS10', 'CUMg', 'CUMg+DS10', 'CUMg+KP8-2.5', 'CUMg+KP8-2.5+DS10', 'CUMg+KP8-3', 'CUMg+KP8-3+DS10']

Dev checks of the chosen rule (S0 on the same dev sessions as reference):

```
{
 "natfa_f": true,
 "readermax_f": true,
 "worststart_f": true,
 "hits_female": true,
 "ehits_female": true,
 "together_f": true,
 "resonance_f": true,
 "natfa_m": true,
 "readermax_m": true,
 "worststart_m": true,
 "hits_male": true,
 "ehits_male": true,
 "together_m": true,
 "resonance_m": true,
 "natfa_gap": true,
 "n_pass": 15,
 "all": true
}
```

Dev outcomes of the chosen rule and S0:

| field | S0 | chosen |
|---|---|---|
| hit_male | 0.917 | 0.917 |
| hit_female | 0.920 | 0.920 |
| n_male | 36 | 36 |
| n_female | 50 | 50 |
| ehit_male | 0.875 | 0.875 |
| ehit_female | 0.929 | 0.929 |
| en_male | 16 | 16 |
| en_female | 14 | 14 |
| fa_m | 0.006 | 0.002 |
| fa_f | 0.006 | 0.002 |
| fa_max_m | 0.060 | 0.060 |
| fa_argmax_m | mls5595 | mls5595 |
| fa_max_f | 0.110 | 0.049 |
| fa_argmax_f | ls4936 | ls4936 |
| off_worst_max_m | 0.530 | 0.084 |
| off_worst_max_f | 0.418 | 0.073 |
| off_worst_mean_m | 0.081 | 0.014 |
| off_worst_mean_f | 0.078 | 0.010 |
| together_m | 0.002 | 0.002 |
| together_f | 0.027 | 0.025 |
| resonance_m | 0.000 | 0.000 |
| resonance_f | 0.002 | 0.000 |
| control_m | 0.011 | 0.011 |
| control_f | 0.005 | 0.000 |
| etogether_m | 0.000 | 0.000 |
| etogether_f | 0.008 | 0.008 |
| pers_male | 0.947 | 0.947 |
| pers_female | 0.930 | 0.921 |
| first_med_male | 7.160 | 7.160 |
| first_med_female | 7.820 | 7.940 |
| hit14_male | 0.944 | 0.944 |
| hit14_female | 0.960 | 0.960 |
| hit_male_jebens | 0.917 | 0.917 |
| hit_female_jebens | 0.950 | 0.950 |
| hit_male_nagels | 0.917 | 0.917 |
| hit_female_nagels | 0.922 | 0.922 |
| flash_m | 0.173 | 0.154 |
| flash_f | 0.183 | 0.173 |
| basefa_m | 0.000 | 0.000 |
| basefa_f | 0.002 | 0.000 |

Full dev table: `dev_table.md` / `dev_table.csv`.
````

## Appendix E. Men's false-alarm study, round 2: pre-registration (verbatim)

sha256 `c6fb5e3f908963b91616246439236005ecb68cf38efa02f43eaba3dd936c049a` (of the file below, written and hashed in
scratch at 2026-10-12 01:55:18 −05:00 and logged outside the scratch folder at that time, before any chain session of
round 2 and before any rule was evaluated on a round-2 speaker; see §8.5). Relative paths in it refer to the study's
scratch folder. The scratch file has CRLF line endings; the block below, with its lines ended CRLF (including the
last), hashes to this value.

````markdown
# Pre-registration, round 2: a pitch-only-warning rule that removes the male false alarms and keeps hits for both sexes

Written 2026-10-12 01:55 -0500, **before any chain session of this round has run and before any candidate (or S0) has been evaluated
on any round-2 speaker.** Hard rule 3 covers `src/ml/pitch-only-warning.js` (a tuned cue-strip module): the rule is
selected on a dev split and tested once on a held-out test split, both from public speakers no earlier study used.

**State at registration.** The pool is fixed (§2) and split into dev and test by a drift statistic (§2.4). The only
chain code run on any round-2 speaker so far is the REAL pitch worker alone over each pool speaker's first ~125 s of
offset-0 reading (`pitch_only.mjs`; no ML, resonance, panel or warning), for the drift and spread statistics that fix
the split and the expressive readers. The dev split's session audio and job files are built (`build_jobs.py`; WORLD /
PICKA transforms only). No session of this round has been run through the chain, and no rule has been evaluated on
it. No test-split session audio beyond the offset-0 natural audio used for the drift statistic, and no test job, exists.

**Question (user decision, 2026-10-11).** Round 1 (`../../warning-male-fa/`) chose A40+KP8-3+DS10 on dev; it failed
the held-out test (11/15: men's reader max 23.8 %, worst start 33.3 %, one early-shift male hit lost, sex gap 1.73 pp).
Its diagnosis attributes about 72 % of men's false-alarm (FA) time to an unrepresentative ~20 s start reference and
11–27 % to genuinely wide intonation; octave errors are about 1 %. Which rule, if any, brings men's natural FA down to
women's level without costing hits for either base sex?

**Round-1 review lessons, now rules of this round.**
1. **App cadence.** Round 1 fed the warning the resonance state every 2 s; the app posts it every 0.2 s of audio and
   calls `noteResonance` on every post, and the panel also updates from its 250 ms hide check. This round runs the
   app-cadence harness (`../harness/`, README there), which drives the REAL module inside the chain loop exactly as
   `useAudioPipeline` + `HeardAsPanel` do and replays every candidate over the same recorded main-thread event stream.
   Its parity (real module live vs real module replayed vs the S0 variant) must be 0 mismatches on every run (§1).
2. **The dev split must contain the problem.** The pool is stratified by a pitch-drift statistic computed before any
   warning result, so that dev and test both contain the drifting male readers (§2.4); and the study **stops before
   the test run if S0 does not fail at least one men's false-alarm check on dev** (§6).
3. **Hashes are recorded outside the scratchpad too** (§9).

Timing noise: the harness review found that the panel's 2 s timer phase (arbitrary in the app) moves per-reader
figures by about ±2–6 pp. Every outcome of this round is therefore computed at four panel phases and averaged (§5).

## 1. Code under test and harness

- **Chain** = the harness's clone `../harness/src-cue` of origin/cue-strip @ **cf76c58** (chain + the REAL
  `src/ml/pitch-only-warning.js`, sha256 `5a7a5814…`). origin/cue-strip is now at c925457; `git diff --stat cf76c58
  c925457` over src/ml, src/dsp, src/resonance, src/resonance-lab, public/resonance-lab,
  scripts/resonance-lab/candidates/formant-vtl, src/components/HeardAsPanel.jsx and src/audio/useAudioPipeline.js is
  empty.
- **Sessions** run through `../harness/session_app.mjs` (hash below) with `--classifier=real` (the deployed q8-v2
  classifier from Syrinx-cue's node_modules; round 1's logit cache holds no round-2 speaker) and
  `--phases=0,500,1000,1500` (four HeardAsPanel timer phases on one chain run; each its own warning instance and
  timers; phase 0 = round 1's tick grid). Every other option at its default (`--inferMs=50`, ML messages before the
  resonance post). Two node shards (`--shard=0/2`, `1/2`) over `jobs_dev_all.json` (the sets interleaved,
  `tools/interleave.py`).
- **Replay** per phase: `replay2.mjs` = the harness's `replay.mjs` with its module paths pointed at `../harness` and
  factory support for `--extra` modules (diff: a header comment, the two module paths, an `--export` option on the
  `--extra` import, a `make()` helper and the per-variant creation line);
  `--variants=round1 --extra=extra-r2.mjs --modes=app --phase=<ms>`. Round-1 candidates run in the harness's
  `variants/pitch-only-warning-variants.js` (matches round 1's Python rules on round 1's information set, 0 mismatches,
  all 18 rules); the new candidates are `extra-r2.mjs` factories built on the same module (hooks + a thin wrapper).
  Each replay's parity block must be all zero, else `study2.py` refuses to build features.
- **New-candidate implementation check** (done before registration, on round 1's already-seen harness logs,
  `../harness/out/app_0.jsonl`, 752 sessions, 43,922 panel updates; on/off strings only, no outcome computed):
  `tools/indep2r.py` (an independent Python re-implementation of S0's state machine + the 2R / 2RV / DS10 gates)
  equals `replay2.mjs` + `extra-r2.mjs` with 0 mismatches for all six new candidates and S0; `2R` with its gate
  disabled equals S0 on every update (plumbing check).
- **Outcomes**: `study2.py` (hash below): round 1's outcome code — `warning-male-fa/select/evaluate.py` (unchanged,
  sha256 652dc467…3893) via the harness's `evaluate_app.py` (`run_rule_wf` = round-1 `study.py` run_rule body incl.
  early-shift hits; `bar()` = round-1 `study.py` bar(), imported unchanged) — per phase, then the phase averaging of
  §5. Checked before registration on round 1's (already-seen) app-cadence data at phase 0 (`tools/check_study2.py`):
  identical to the harness's `cadence_table.md` app rows for S0, KP8-3, A40+KP8-3+DS10 and CUMg+DS10 on both splits.

## 2. Data: public speakers no earlier study has used

### 2.1 Sources

| Source | Licence | Partition used | Why |
|---|---|---|---|
| LibriSpeech train-other-500 shards 0010–0017 and train-clean-360 shards 0004–0011 (Hugging Face `openslr/librispeech_asr`, parquet; sex from SPEAKERS.TXT) | CC BY 4.0 | train | round 1 used train-other-500 0006–0009 and train-clean-360 0000–0003, the D2-0.1 confirmation train-other-500 0000–0005; the earlier studies' test-clean, dev-clean, dev-other, test-other are disjoint from train-* by construction |
| Multilingual LibriSpeech French, Spanish, Italian, Dutch, Portuguese, Polish (`facebook/multilingual_librispeech`, parquet; sex from each language's MLS metainfo.txt) | CC BY 4.0 | dev + test partitions | other languages and reader populations; round 1 used MLS German only, no Syrinx study used these languages |
| OpenSLR 83, crowdsourced UK and Ireland English dialects (welsh, scottish, northern, midlands female; welsh, scottish, midlands, irish male archives) | CC BY-SA 4.0 | all | a third open corpus: crowdsourced read sentences (not audiobooks), British / Irish accents; never used in Syrinx |

VCTK is not used (the voice-detector training manifests contain all 110 of its speakers); Common Voice is not used (gated download, few speakers with ≥ 330 s). SLR83 recordings carry ~1 s of leading and ~0.5–1 s of trailing silence per sentence; each utterance is edge-trimmed (`tools/slrtrim.py`: 20 ms frames, keep [first frame above −35 dB re the loudest frame − 0.15 s, last such frame + 0.15 s]) and resampled 48 → 16 kHz (`resample_poly` 1:3).

### 2.2 Exclusion

`tools/used_speakers.py` (round 1's scan with this folder skipped and an SLR83 pattern added): a candidate is excluded if its numeric id matches `<id>[-_/]<2–6 digits>[-_/]`, `ls<id>` or `/<id>/` (any corpus: a hit on a number excludes every candidate with that number), or, for SLR83, `<code>_<id>` / `slr<code><id>`, in any file or directory name under the scratchpad (every earlier study, incl. round 1, its harness, the confirmation and the diagnosis), the voice-detector branch's `build/` (training and validation manifests), Syrinx-cue's and Syrinx main's measurements/, scripts/ and tests/, or in the contents of their text files under 8 MB; and every numeric id of the confirmation's 66 readers and of round 1's 100 pool speakers is excluded explicitly. Over-inclusive on purpose: 165 of the 481 downloaded candidates are excluded: ls1012, ls1028, ls104, ls1065, ls110, ls112, ls115, ls1165, ls1184, ls119, ls1195, ls1224, ls1225, ls1283, ls1311, ls1323, ls133, ls1337, ls1348, ls1373, ls1383, ls14, ls1472, ls1482, ls1509, ls1544, ls1547, ls1556, ls1607, ls1618, ls1629, ls1634, ls1638, ls1643, ls1649, ls167, ls1674, ls1704, ls1714, ls1721, ls1726, ls173, ls175, ls1757, ls1815, ls1825, ls1827, ls1849, ls1913, ls1920, ls1985, ls2068, ls2074, ls2090, ls2113, ls2148, ls2194, ls2195, ls2234, ls225, ls2276, ls2294, ls2411, ls2445, ls246, ls2488, ls2494, ls2498, ls2512, ls2592, ls264, ls265, ls3521, ls353, ls359, ls37, ls3790, ls3977, ls4290, ls44, ls451, ls472, ls4824, ls497, ls500, ls534, ls5445, ls5635, ls576, ls580, ls614, ls6286, ls6773, ls688, ls713, ls718, ls727, ls731, ls7315, ls7398, ls7481, ls7687, ls77, ls770, ls79, ls803, ls8071, ls8075, ls815, ls8250, ls8778, ls884, ls8846, ls90, ls9023, ls920, ls922, ls93, ls948, ls949, ls954, ls960, ls968, ls976, ls978, ls984, ls986, mlsdu880, mlsfr1406, mlsfr1591, mlsfr1770, mlsfr2085, mlsfr2114, mlsfr2154, mlsfr2216, mlsfr2223, mlsfr2465, mlsfr296, mlsfr4193, mlsfr577, mlsfr579, mlsfr7601, mlsfr7762, mlsfr928, mlsit1131, mlsit280, mlsit428, mlsit642, mlsit645, mlsit646, mlsit875, mlspo12707, mlspo13063, mlspo1889, mlspo6549, mlspo7925, mlssp1075, mlssp1227, mlssp133, mlssp1448, mlssp2308, mlssp2592, mlssp3471, mlssp676, mlssp97.

### 2.3 Selection (`tools/pool.py`, mechanical, from metadata only)

Eligible = not excluded, sex f / m, ≥ 330 s of audio in the downloaded files (SLR83 after the trim). Per group and sex: LS-other / LS-clean by numeric id; MLS round robin over French, Spanish, Italian, Dutch, Portuguese, Polish (numeric id within a language); SLR83 round robin over the welsh, scottish, northern, midlands, irish archives (numeric id within). n_group = min(#F eligible, #M eligible, cap), caps LS-other 24, LS-clean 24, MLS 32, SLR83 16; the first n_group per sex. Utterance order: LibriSpeech = numeric sort of the file name; MLS = (chapter, source file, begin time); SLR83 = numeric sort of the file name.

| Group | eligible F | eligible M | taken per sex |
|---|---|---|---|
| LS-other | 48 | 45 | 24 |
| LS-clean | 33 | 42 | 24 |
| MLS | 50 | 48 | 32 |
| SLR83 | 21 | 28 | 16 |

### 2.4 Dev / test split stratified by pitch drift (`tools/stratify.py`)

Before any warning result, the REAL pitch worker alone (`pitch_only.mjs`, chain = `../harness/src-cue`) is run over each pool speaker's offset-0 `nat` session audio, first 125 s (`pitch_all.jsonl`). **Drift D** = population SD of the medians of 12·log2 f0 of the posted voiced frames in the six 20 s blocks [0, 20) … [100, 120) s (a block counts with ≥ 100 voiced frames; D needs ≥ 4 blocks, else the speaker is dropped). Per sex, terciles of D (rank by (D, key); tercile = floor(3·rank/n)). Cells = sex × tercile × group; within a cell, consecutive pairs in (−D, key) order go one to dev and one to test by `sha256("warning-male-fa-r2|a|b")` parity; per sex, a cell's odd leftover goes by `sha256("warning-male-fa-r2|key")` parity for the first and alternates after that.

| Split | Sex | n | D median (st) | D mean | D q90 | D max | n D ≥ 1 st | n top tercile |
|---|---|---|---|---|---|---|---|---|
| dev | f | 48 | 0.481 | 0.546 | 1.0 | 1.328 | 5 | 16 |
| dev | m | 48 | 0.504 | 0.637 | 1.068 | 2.302 | 8 | 16 |
| test | f | 48 | 0.497 | 0.569 | 1.111 | 1.787 | 6 | 16 |
| test | m | 48 | 0.489 | 0.632 | 1.084 | 3.148 | 7 | 16 |

The ten highest-drift men: ls4402 (3.15 st, test), ls3541 (2.30 st, dev), ls4059 (2.09 st, dev), ls559 (1.62 st, dev), ls5918 (1.44 st, test), ls5894 (1.28 st, test), ls5940 (1.18 st, test), mlsit7372 (1.16 st, test), mlssp2767 (1.13 st, dev), mlspo5739 (1.07 st, dev).

| Split | Sex | LS-other | LS-clean | MLS | SLR83 | Speakers |
|---|---|---|---|---|---|---|
| dev | f | 12 | 12 | 15 | 9 | ls3003 ls3125 ls3394 ls3848 ls3969 ls4005 ls4071 ls4238 ls4422 ls4455 ls4546 ls4703 ls4791 ls4899 ls5036 ls5054 ls5230 ls5604 ls5618 ls5724 ls5968 ls7316 ls7416 ls7717 mlsdu3034 mlsdu3798 mlsdu7432 mlsfr3267 mlsfr5207 mlsfr7591 mlsit10362 mlsit4009 mlsit5537 mlsit7458 mlsit8613 mlspo11247 mlspo11295 mlspo9056 mlssp3473 slrnof03397 slrnof05223 slrscf02484 slrscf04310 slrscf06136 slrwef03397 slrwef04310 slrwef05223 slrwef06136 |
| dev | m | 12 | 13 | 16 | 7 | ls1226 ls2673 ls2688 ls2990 ls3285 ls3288 ls3368 ls3541 ls3618 ls3650 ls3825 ls4010 ls4059 ls4344 ls4484 ls4659 ls4719 ls480 ls4854 ls4969 ls5189 ls559 ls5854 ls6060 ls663 mlsdu11290 mlsdu3619 mlsdu4396 mlsfr4937 mlsfr5790 mlsfr6318 mlsit4712 mlsit6698 mlspo5417 mlspo5739 mlspo7775 mlssp2767 mlssp3468 mlssp3503 mlssp3796 mlssp4589 slrirm02484 slrmim03397 slrmim04310 slrscm03397 slrscm05223 slrwem05223 slrwem06136 |
| test | f | 12 | 12 | 17 | 7 | ls2598 ls2790 ls2975 ls2997 ls3400 ls3409 ls3467 ls4009 ls4305 ls4415 ls4427 ls4563 ls4773 ls4841 ls5060 ls5093 ls598 ls6120 ls6167 ls6300 ls6696 ls7297 ls7657 ls7730 mlsdu3245 mlsdu5438 mlsfr5476 mlsfr5830 mlsfr7400 mlsit6121 mlspo11995 mlspo12114 mlspo3050 mlspo4067 mlspo8502 mlspo9860 mlssp3678 mlssp3719 mlssp4747 mlssp6223 mlssp6306 slrmif02484 slrmif03397 slrnof02484 slrnof04310 slrscf03397 slrscf05223 slrwef02484 |
| test | m | 12 | 11 | 16 | 9 | ls3032 ls3072 ls3088 ls3105 ls3490 ls3657 ls3780 ls3783 ls3962 ls4020 ls4379 ls4402 ls4599 ls476 ls5002 ls5092 ls5206 ls5700 ls5765 ls5894 ls5918 ls5940 ls6538 mlsdu11936 mlsdu2825 mlsdu4429 mlsfr4482 mlsfr4724 mlsfr7142 mlsit3129 mlsit7372 mlsit8582 mlspo4405 mlspo5090 mlspo6566 mlspo8655 mlspo8758 mlspo9098 mlssp4096 slrirm03397 slrirm04310 slrmim02484 slrscm02484 slrscm04310 slrscm06136 slrwem02484 slrwem03397 slrwem04310 |

`pool.json` (hash below) holds the exact speakers, groups, splits, drift statistics and ordered file lists.

### 2.5 Expressive readers (replayed from 5 starts, k = 0, 1, 2, 3, 5)

Per split and sex (n = speakers of that sex in that split): the union of the top ceil(n/4) by spread60 = 12·log2(q90/q10) of the posted voiced pitch in the first 60 s (round 1's rule) and the top ceil(n/4) by D, both from the same pitch-only pass, fixed here for both splits.

- dev f (19): ls3003, ls4005, ls4238, ls4703, ls4791, ls4899, ls5036, ls5054, ls5724, ls5968, ls7316, mlsdu3034, mlsdu3798, mlsdu7432, mlsit5537, mlsit7458, slrnof05223, slrwef04310, slrwef05223  (by spread60: slrnof05223, ls5036, mlsit5537, mlsdu3798, ls5054, ls4899, mlsit7458, ls3003, ls7316, ls5968, slrwef05223, ls4703; by D: mlsit7458, ls5054, mlsdu3034, ls5036, ls5724, mlsdu3798, ls4005, mlsdu7432, ls4791, ls4238, slrwef04310, ls7316)
- dev m (15): ls2673, ls3541, ls3618, ls3650, ls4010, ls4059, ls480, ls4854, ls4969, ls559, ls5854, mlsdu4396, mlsit6698, mlspo5739, mlssp2767  (by spread60: ls559, ls4059, ls3541, ls3618, ls3650, mlspo5739, mlssp2767, ls4854, ls5854, ls2673, ls4969, ls480; by D: ls3541, ls4059, ls559, mlssp2767, mlspo5739, ls3618, ls2673, ls5854, ls4010, ls3650, mlsdu4396, mlsit6698)
- test f (20): ls2598, ls2790, ls2975, ls3400, ls3409, ls4427, ls4563, ls5060, ls6167, ls6300, ls6696, mlsdu5438, mlsfr5830, mlsfr7400, mlspo9860, mlssp3678, mlssp3719, mlssp6223, mlssp6306, slrscf03397  (by spread60: ls2790, ls6300, ls3400, ls2598, mlsdu5438, mlssp3719, ls5060, mlsfr5830, ls2975, ls6167, slrscf03397, mlspo9860; by D: ls6300, mlsfr7400, mlssp6306, ls5060, ls4563, ls2598, ls6696, ls3409, mlssp3678, ls4427, ls3400, mlssp6223)
- test m (17): ls3088, ls3490, ls3962, ls4402, ls5206, ls5765, ls5894, ls5918, ls5940, mlsdu11936, mlsdu2825, mlsdu4429, mlsfr4482, mlsfr4724, mlsit7372, mlspo5090, mlspo6566  (by spread60: ls3962, ls4402, ls5894, mlsdu11936, mlsit7372, ls3088, mlspo6566, mlsdu2825, mlsdu4429, mlspo5090, mlsfr4724, mlsfr4482; by D: ls4402, ls5918, ls5894, ls5940, mlsit7372, ls5765, mlspo6566, mlsfr4482, ls3962, ls3088, ls5206, ls3490)


## 3. Sessions (round 1's constructions, `build_jobs.py`; unchanged)

The `nat` / `off` audio is plain utterance concatenation (system Python 3.14); the WORLD / PICKA transforms (`hcs`, `ehcs`,
`picka`) run in `C:/Coding Projects/Syrinx-cache/resonance-lab/venv` (Python 3.14.3, pyworld 0.3.5; read-only use), the
environment with pyworld that round 1's construction needs.

| Set | Construction |
|---|---|
| `nat` | Every reader at offset 0: the first ≥ 180 s of utterances, 0.25 s gaps. |
| `off` | Expressive readers (§2.5) from start offsets k ∈ {1, 2, 3, 5}, then ≥ 180 s. With `nat`, 5 starts per reader. |
| `hcs` | H&C sentence-proxy shift on every reader. Base = ≥ 50 s natural speech (7.2 kHz low-pass); shift = the next ≥ 40 s through WORLD (dio + stonemask) in US (vocoder control), PO (pitch only), PE (pitch + envelope), EO (envelope only); men up, women down (F0 × 1.7041, envelope × 1.168). Rep A from utterance 0; rep B after the `nat` span when ≥ 90 s remain. |
| `picka` | PICKA cells on every woman, rep A: pitch only (−6,0) (−12,0); together (−6,+1.8) (−12,+3.6); resonance only (0,+1.8) (0,+3.6). |
| `ehcs` | Early shift: base = ≥ 36 s natural speech from utterance 0 (7.2 kHz low-pass); shift = the next ≥ 40 s in PO and PE. |

## 4. Rules

Inputs, eligibility and display are S0's as implemented in the real module (at the app cadence: posted pitch frames
on arrival, the resonance state every 0.2 s of audio, panel updates every 2 s plus the 250 ms hide checks and the
switch-on update). Eligible update: the panel shows an estimate (lnF0 known), startU, u and S0's P0 known, fill ≥ 1,
verdict ≠ "sustained", sinceResumeS ≥ 2. Condition: |ΔP| ≥ X AND |Δu| ≤ 0.6 u; shown after K = 2 consecutive shown
eligible updates meeting it; hidden updates neutral, the run dropped after more than 5 hidden updates in a row; a shown
update that is ineligible or fails the condition drops the run. ΔP = 12·(lnF0 − P0)/ln 2; lnF0 = the panel's
`estimate().lnF0` (median of posted pitch over the trailing 8 s).

**S0 (shipped).** P0 = ln median of the posted voiced frames in [t_fill, t_start], frozen; X = 4 st.

**Round-1 candidates** (round 1's PREREG §3, at the app cadence as implemented in the harness's variant module):

| Part | Definition |
|---|---|
| ref A40 | P0(t) = ln median of the posted voiced frames in [t_fill, max(t_start, min(t, t_fill + 40 s))], t = the update's audio clock: grows until t_fill + 40 s, then frozen |
| ref CUMg | a pool starts as S0's start frames; at each update with S0's P0 known, P0 = ln median of the pool; after the decision, when the update is shown, S0-eligible and \|ΔP\| < 4 st, the voiced frames that arrived since the previous such update join the pool (frames of other intervals are dropped; the first interval starts at t_start) |
| KP8-k | X = max(4 st, k × RMS of the history) once the history holds ≥ 5 values, else 4 st. History = ΔP of the earlier shown updates whose \|ΔP\| was below the threshold at the time; shown updates before the reference is known are back-filled against S0's P0. k ∈ {2.5, 3} |
| DS10 | also require \|s − s0\| ≥ 10 points, s = the panel's shown share, s0 = median s over the shown updates in [t_fill, t_start] |

The 17 = {S0, A40, CUMg} × {—, KP8-2.5, KP8-3} × {—, DS10} minus S0 alone, in this listing order: DS10, KP8-2.5,
KP8-2.5+DS10, KP8-3, KP8-3+DS10, A40, A40+DS10, A40+KP8-2.5, A40+KP8-2.5+DS10, A40+KP8-3, A40+KP8-3+DS10, CUMg,
CUMg+DS10, CUMg+KP8-2.5, CUMg+KP8-2.5+DS10, CUMg+KP8-3, CUMg+KP8-3+DS10. (A CUMg reference with a KP8 threshold is
the "session-long reference built from quiet updates with a drift-scaled threshold" family; it stays in the grid.)

**New candidates** (motivated only by the round-1 diagnosis: the start can be unrepresentative of the reader's typical
pitch (cause c) while genuine wide passages are the rest (cause b)); `extra-r2.mjs`:

| Name | Definition |
|---|---|
| `2R` | Two references. L(t) = ln median of ALL posted voiced frames with audio time in [t_fill, t] that have arrived by the update (t = the update's audio clock): the reader's running long-term median, known exactly when S0's P0 is known. Condition = S0's condition (P0, 4 st, \|Δu\| ≤ 0.6 u) AND \|12·(lnF0 − L)/ln 2\| ≥ 4 st AND sign(lnF0 − L) = sign(lnF0 − P0): the pitch has moved at least 4 st against both the start and the long-term median, in the same direction. Everything else (eligibility, K, hidden updates, display) is S0's. |
| `2R+DS10` | 2R and the DS10 gate. |
| `2RV-k` | 2R with a drift-scaled L-side threshold: X_L = max(4 st, k × RMS(H)) once H holds ≥ 5 values, else 4 st; H = (lnF0 − L) in st at the earlier SHOWN updates with L known whose \|lnF0 − L\| was below X_L at that update (the reader's own passage-level spread about the running median). The P0 side keeps 4 st. k ∈ {2.5, 3}. |
| `2RV-k+DS10` | 2RV-k and the DS10 gate. k ∈ {2.5, 3}. |

Listing order of the new candidates (after the 17): 2R, 2R+DS10, 2RV-2.5, 2RV-3, 2RV-2.5+DS10, 2RV-3+DS10. A DS10
candidate also needs a product decision (warn only when the panel itself moved). Note on 2R / 2RV: L moves with a
sustained shift once the shifted speech outweighs everything said since t_fill, so a warning can end after a long
pitch-only stretch; persistence is reported descriptively.

Total: 23 candidates + S0. Round 1's comparison row D2-0.1 is not part of this round (not implemented in the variant
module).

## 5. Outcomes (round 1's §4 definitions, computed by its `evaluate.py`, per panel phase, then averaged)

Per panel phase p ∈ {0, 500, 1000, 1500} ms, each rule's on/off at the regular 2 s updates of that phase (the
`"T"` updates; hide-check and switch-on updates drive the module but are not scored, as in the harness), and the
panel fields of those updates (shown, S0 eligibility, shown share), go through round 1's outcome code unchanged:

- **Failure set / hit.** Pitch-only sessions (`hcs` PO reps A and B; `picka` (−6,0), (−12,0)) whose shown panel
  estimate (median share over visible updates at t ≥ t_shift + 10 s, ≥ 3 updates) differs from the listener two-way
  share by ≥ 20 points (H&C MPO 65.7 / WPO 19.1; PICKA Meyer 2023 6.3 / 54.8 primary; Jebens and Nagels reported). Hit
  = the warning is on at ≥ 1 update in (t_shift, t_shift + 10 s] and was off at the last eligible update at or before
  t_shift. Male base = pitch raised; female base = pitch lowered.
- **Early-shift hit**: the same on `ehcs` PO (H&C references).
- **Natural FA**: per reader, the share of eligible updates with the warning on in `nat` (offset 0).
- **Worst start**: per expressive reader, the maximum over its evaluable starts (k = 0, 1, 2, 3, 5) of the FA share.
- **Together / resonance-only**: mean over sessions of the share of eligible updates with t ≥ t_shift + 10 s with the
  warning on (together = `hcs` PE + `picka` (−6,+1.8), (−12,+3.6); resonance only = `hcs` EO + `picka` (0,+1.8),
  (0,+3.6)), per sex of the base voice.
- Descriptive: hits with the Jebens / Nagels references, hits within 14 s, time to first warning, persistence, vocoder
  control, flash after together shifts, baseline-phase FA, early-shift together.

**Phase averaging** (`study2.py aggregate`):
- Hits, early-shift hits, together, resonance-only and every descriptive rate = the mean over the four phases of the
  phase's value (a phase whose failure set is empty contributes nothing; all four empty → n/a).
- Natural FA per reader = the mean over phases of the reader's share (phases where the session has eligible updates);
  natural FA per sex = the reader-balanced mean of those; **per-reader max** = the largest reader's phase-averaged share.
- Worst start: each start's share is averaged over phases; a reader's worst start = the largest phase-averaged start
  share; per sex, the maximum over its expressive readers.

## 6. Early-stop rule (applied first, on dev)

The **men's false-alarm checks** are: natural FA men ≤ 2 %; per-reader natural-FA maximum men ≤ 15 %; every male
expressive reader's worst start ≤ 15 %; and, when men's natural FA exceeds women's, |men − women| ≤ 1.5 pp. If S0
(phase-averaged, dev) passes **all** of them, the study stops: `EARLYSTOP.md` is written, no candidate is chosen, and
no test session is run.

## 7. The bar, the selection on dev, and the single test evaluation

**Bar** (round 1's 15 checks, per sex; the candidate against S0 on the SAME sessions; phase-averaged values):
1. Natural FA ≤ 2 % for women and for men, **and** |men − women| ≤ 1.5 pp.
2. Per-reader natural-FA maximum ≤ 15 % for each sex.
3. Every expressive reader's worst start ≤ 15 %, each sex.
4. Hits within 10 s (Meyer primary) ≥ S0's hits − 0.03, for each base sex.
5. Early-shift hits ≥ S0's early-shift hits − 0.03, for each base sex.
6. Together FA ≤ S0 + 2 pp and resonance-only FA ≤ S0 + 2 pp, each sex.
Boundaries inclusive (tolerance 1e-12). A hit check whose phase-averaged hit rate is n/a (empty failure set at every
phase) passes vacuously. **PASS** = all 15 hold.

**Selection on dev** (`study2.py dev`, after `run_dev.sh` runs every dev session):
1. Apply the early-stop rule (§6).
2. Among the 23 candidates that pass all 15 checks on dev, order by: (a) the larger of the two sexes' worst-start
   maxima, lower first; (b) the larger of the two sexes' natural FA, lower first; (c) the smaller of the two base
   sexes' hit change vs S0 (an n/a change counts as 0), higher first; (d) fewer parts (`+`-separated); (e) the listing
   order in §4. Take the first. **If none passes**, take the candidate with the most checks passed, ties by the same
   order, and say so in CHOICE.md; it still goes to the single test evaluation, where only the bar decides.
3. CHOICE.md (with the dev table's sha256 and this file's sha256) and CHOICE.sha256 are written, and their hashes
   appended to the hash log outside the scratchpad (§9), **before** any test-split session job or chain output exists.

**Test** (a later step, not part of the dev run): build the test split's `nat` / `off` (its expressive readers, §2.5) /
`hcs` / `ehcs` / `picka` jobs with the same `build_jobs.py`, run every test session once with the same harness
command, replay the four phases with `--variants=S0,<chosen>` (plus `--extra=extra-r2.mjs` if the choice is new), and
run `study2.py test` once: the chosen rule against S0 on the same sessions. PASS → the rule is proposed for
cue-strip (with the DS10 product decision if it contains DS10); FAIL → S0 stays. Nothing is re-tuned on test data;
every other test number is descriptive.

## 8. Notes

- Round 1's diagnosis found that no frozen reference brings its worst reader under 15 %; check 3 may be unreachable;
  the study reports it if so.
- Hit checks have 1/n resolution per phase; phase averaging makes a lost hit cost 0.25/n per phase it is lost in.
- Public data only (LibriSpeech, MLS, OpenSLR 83); no private recordings, no names. Every number is reported per sex.

## 9. Hashes

`study2.py` refuses to run `dev` / `test` if this file or any file below changed. This file's sha256 is written to
`PREREG.sha256` and appended, with a timestamp, to
`C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/12a8f6ba-d49c-4c27-bd93-69314577b2c1/warning-male-fa-r2-hashes.log`
(outside the scratchpad), and reported to the orchestrating workflow, before `run_dev.sh` starts.

- hash ../harness/session_app.mjs 190f021a5d6070b07b4d7ae22e494bc10a27acc3a567a26834dbd69eca45bbb9
- hash ../harness/variants/pitch-only-warning-variants.js 9d29652531e16546885e1f5e3a93268da4785a49a44ee53a1bfe16dbf5a2b4ed
- hash ../harness/evaluate_app.py 41f557047e6f200d2f7afee38de1543f37a8dacf9b0ed1f336a49f564bbf8bdb
- hash ../harness/src-cue/src/ml/pitch-only-warning.js 5a7a5814f827c48d019b8bfe450de85ffb0855220c88e7e57440df4fc6c43a6a
- hash ../harness/replay.mjs 172a7374bf9250e2fb8eb7da5a5bac3dd282c15b933bf5eefe3d02d6ca7bdbcc
- hash ../../warning-male-fa/select/evaluate.py 652dc467314d46a0a201392e77db6b4b8002183f6813334fc337222dde223893
- hash ../../warning-male-fa/select/study.py 38e0e031d884526db4aca3e9c9e754965b7297c034a550a79f3123f2b40f266a
- hash ../../warning-male-fa/select/rules.py 480b17ca42f30db06ee75e6de0fef0a625ba6304c1b8e7a4c88bf68c07a13902
- hash replay2.mjs 2569245ba2ddf163a0d1fc8da11cc0c3e398af589be5b9ab644bfa0bb016f122
- hash extra-r2.mjs bbfecae7bbfe0a7cb14b2864ea3e6c41a87c384f654e124309830886514fe0db
- hash study2.py cd788f23aff64dac650faab6f44450932cbe79cef17f6cbb7fbff55d28b369d4
- hash build_jobs.py 65cbac9b3d3d9801dcead95d95a68c4d3c3aaaaa0f7f89f9f7f5753b5e710dd2
- hash pitch_only.mjs 28ed34cf17016552386bcab6e11b532c08ac1b48471fbd0194f340a2e0aae9f9
- hash run_dev.sh f99c7488c52e29f27a77fb86e73099b1a08924974868f5414177be8ce6eb219a
- hash tools/download.sh 019e46a6d998e6e8e5d36934fc4f346e937ce85be2aca2331bdb6ecf3b7c5519
- hash tools/inventory.py 681f3982c97f39a7c5c61c75434b44a7126f5f20c038fc8d88dafab1d7bb8fc9
- hash tools/slrtrim.py b28f91a9286d2b6386756de8e3210a397f91cf45bd74b0815e1148ae691158c5
- hash tools/used_speakers.py 8afd082bdb14f3695970fefe9ee7f86f397aa97b69c1226a8b11caaf7a27721b
- hash tools/pool.py 8b5fef22f3554ec3664f2081c05358d2044bc68b683e62e16d0337399b55558a
- hash tools/stratify.py d181dc59babf44d71726822a17d0631d01262830e31b501edcfa679d19954ed0
- hash tools/interleave.py 76be61466b7813b119a21936eab9d3546765f1d5cc952bb44d7a4046b934507b
- hash tools/indep2r.py 8d57e8ed74d4c134d0e7fbdee892ede30b4a4276db9b6b7ea08e4558b60e97d3
- hash tools/check_study2.py 688dd8f3f7e0baeca20f03eb8dae21524ac517d84c205a051181f703be17149c
- hash tools/make_prereg.py e064d47c77416fdf0b015b020996d9bfb4b4a80d220c78de315c86a2b18ad445
- hash inventory.json 46de9b3e1d4789c9125a4b88d02bfcff004bde044fb61079e00b4d862a7b6339
- hash used_speakers.json 0f0ba766c6f303f4413d07f87840f9ad149f23063ad6ee4c2f46eb0c89488a73
- hash pool_unsplit.json e1b6721be7fd046bb94a2efe3d28d932ac5493f405df0a8b70b03aa24afe53c3
- hash pool.json 261a747077a4ce8b495417dff64aa560930e91c5007de0ac080232f274bde2a7
- hash strata.json 6c39bb36d7e251aa616f0f031a300ee83566523c5d443328458075710a0f800c
- hash pitch_all.jsonl 328d89a4f11086bf514a5d9d3e539885ffb2e4bba874a2ee0e7fef18c8a2a2ed
- hash eval_dev/expressive.json ccc217345d93fdf206d43b836959b536ebce5df7b48acf7513b0f2e22a4c5e29
- hash eval_test/expressive.json 8f61d5a664231d79374eabff0a6ff1dac20edc500e08bbe6788dfa7d24d30f82
- hash jobs_all_nat.json ef6ca40ed81c3175be4157ab903f997e93546e82c4a77f36813eb789b5a3db1d
- hash jobs_dev_nat.json 0b1ec20ba8dea9bc8123c23d454d1aae13cdd19689d1eaeac1ce107f4dcc5c38
- hash jobs_dev_off.json c83b2097e603c2cd187a2490398326f88370fc064547a3a59c78a92109cd4eaa
- hash jobs_dev_hcs.json 0ad379b1eeeb4b115610ca4bb063a6c7159252008cbd783f0094424d19313dbe
- hash jobs_dev_ehcs.json c9518ccbdac5188835e245e72c2958de066d93da851c51667fdb9b2228e8f10f
- hash jobs_dev_picka.json 6b2e54315c51b679051f5418459653407e5ce809a4a35f978c88676f63a1a6e2
- hash jobs_dev_all.json 56cc779c94903553539dd255378d71bab1c432786812a3d3588537f99056dc39
````

## Appendix F. Men's false-alarm study, round 2: choice (verbatim)

sha256 `d7e2fe93841715953eaf6bd906bd4b4f2ff474d97ea22998fd2a9d2068d3dc24` (of the file below, written by `study2.py dev`
and logged outside the scratch folder at 2026-10-12 03:55:44 −05:00, before any test-split job or chain output
existed). Same CRLF convention as Appendix E.

````markdown
# Choice (male-FA study round 2, dev split)

Written by `study2.py dev` before any test-split session job or chain output exists.

- PREREG.md sha256: `c6fb5e3f908963b91616246439236005ecb68cf38efa02f43eaba3dd936c049a`
- dev_table.csv sha256: `793746dc49c47f6f9037e1a1cc560818ab9983f76143f20ab8254aad2f02e496`
- Early-stop rule: S0's men's false-alarm checks on dev = {"natfa_m": true, "readermax_m": false, "worststart_m": false, "natfa_gap": true} -> at least one fails, the study continues.
- **Chosen: `A40+KP8-3+DS10`**
- How: NO candidate passes every dev check; fallback (PREREG §7): most checks passed (14/15), then the §7 order.
- Candidates passing every dev check: none

Dev checks of the chosen rule (S0 on the same dev sessions as reference, phase-averaged):

```
{
 "natfa_f": true,
 "readermax_f": true,
 "worststart_f": true,
 "hits_female": true,
 "ehits_female": true,
 "together_f": true,
 "resonance_f": true,
 "natfa_m": true,
 "readermax_m": true,
 "worststart_m": true,
 "hits_male": false,
 "ehits_male": true,
 "together_m": true,
 "resonance_m": true,
 "natfa_gap": true,
 "n_pass": 14,
 "all": false
}
```

Dev outcomes of the chosen rule and S0 (phase-averaged):

| field | S0 | chosen |
|---|---|---|
| hit_male | 0.882 | 0.825 |
| hit_female | 0.841 | 0.831 |
| n_male | 57.250 | 57.250 |
| n_female | 106.750 | 106.750 |
| ehit_male | 0.816 | 0.789 |
| ehit_female | 0.949 | 0.926 |
| en_male | 27.250 | 27.250 |
| en_female | 34.000 | 34.000 |
| fa_m | 0.011 | 0.003 |
| fa_f | 0.003 | 0.001 |
| fa_max_m | 0.399 | 0.061 |
| fa_argmax_m | ls3541 | mlsdu4396 |
| fa_max_f | 0.069 | 0.034 |
| fa_argmax_f | ls5054 | ls7717 |
| off_worst_max_m | 0.399 | 0.078 |
| off_worst_max_f | 0.256 | 0.009 |
| off_worst_mean_m | 0.072 | 0.015 |
| off_worst_mean_f | 0.018 | 0.001 |
| together_m | 0.012 | 0.012 |
| together_f | 0.058 | 0.057 |
| resonance_m | 0.000 | 0.000 |
| resonance_f | 0.000 | 0.000 |
| control_m | 0.010 | 0.002 |
| control_f | 0.002 | 0.000 |
| etogether_m | 0.005 | 0.005 |
| etogether_f | 0.041 | 0.041 |
| pers_male | 0.928 | 0.866 |
| pers_female | 0.915 | 0.896 |
| first_med_male | 7.064 | 7.185 |
| first_med_female | 7.951 | 8.053 |
| hit14_male | 0.921 | 0.869 |
| hit14_female | 0.925 | 0.925 |
| hit_male_jebens | 0.882 | 0.825 |
| hit_female_jebens | 0.850 | 0.847 |
| hit_male_nagels | 0.882 | 0.825 |
| hit_female_nagels | 0.854 | 0.845 |
| flash_m | 0.177 | 0.148 |
| flash_f | 0.155 | 0.139 |
| basefa_m | 0.010 | 0.000 |
| basefa_f | 0.001 | 0.000 |

Full dev table: `dev_table.md` / `dev_table.csv`.
````

## Appendix G. Late-panel fallback study: pre-registration (verbatim)

sha256 `9a09b4de49bc5a68081d61f051005f6c0586eba124dcd9a13890d02e4ccf985f` (of the file below, written and hashed in
scratch and logged outside the scratch folder at 2026-10-12 10:38:18 −05:00, before any candidate or the shipped rule
was evaluated on any session of the study; see §8.7). Relative paths in it refer to the study's scratch folder. The
scratch file has LF line endings; the block below, with its lines ended LF (including the last), hashes to this value.

````markdown
# Pre-registration: a fallback for the pitch-only warning when the panel has no start share (late switch-on)

Written 2026-10-12, **before any candidate (or the shipped rule) has been evaluated on any session of this study**.
Hard rule 3 covers `src/ml/pitch-only-warning.js`: a fallback is selected on a dev pool and tested once on a fresh
test pool of public speakers no earlier study used; it is adopted only if it passes (user decision, 2026-10-12).

**State at registration.** The harness is built and validated (§1). The dev sessions (§2.1) are built
(`build_jobs_late.py`; WORLD / PICKA transforms only); **no dev session of this study has been run through the chain**.
The only chain runs so far: (a) the on0-only harness over 21 of round 2's already-evaluated dev sessions (identity
check, §1); (b) the full harness over 17 round-1 sessions (already used and evaluated in round 1; plumbing, parity and
the independent implementation check, on/off strings only — no outcome, no bar, no comparison between rules was
computed). The fresh test pool (§2.2) is not downloaded yet; it is built mechanically by the rule below after the
choice, and no test session runs before CHOICE.md and its hash exist.

## 0. Question and mechanism

The shipped rule A40+KP8-3+DS10 (origin/cue-strip 36202c2, `src/ml/pitch-only-warning.js`) takes its DS10 start share
only from SHOWN panel updates in [t_fill, t_start]. If the "Likely heard as" panel is off, loading its model or hidden
throughout that window (it closes ~30–36 s into a session at the median, up to 100 s), the start share stays empty and
the warning can never appear for the rest of the session (measurement note §8.6 addendum). The panel's on/off setting
persists, so this hits mainly the session in which it is first turned on, or sessions where the model is still
loading. Which fallback, if any, restores the warning for a panel switched on late — without false alarms and without
changing anything when the start share exists?

## 1. Code under test and harness (all in `../harness/`, hashes in §9)

- **Shipped module**: `shipped/pitch-only-warning.js` = `git show 36202c2:src/ml/pitch-only-warning.js`
  (sha256 2a1f4022…; differs from the port-parity-checked 94554a8e… only in comments).
- **Chain**: round 2's clone `../../warning-male-fa-r2/harness/src-cue` (origin/cue-strip cf76c58). `git diff --stat
  cf76c58 36202c2` over src/ml, src/dsp, src/resonance, src/resonance-lab, public/resonance-lab,
  scripts/resonance-lab/candidates/formant-vtl, HeardAsPanel.jsx and useAudioPipeline.js touches only the warning
  module and the panel / hook wiring of it (the wiring is emulated in the harness as at 36202c2).
- **Harness** `session_late.mjs` = round 2's `session_app.mjs` (app cadence: pitch messages, the gender worker on the
  audio clock, resonance posts every 0.2 s of audio, the panel's 2 s interval and 250 ms hide check) extended with
  late switch-on and model loading, emulating useAudioPipeline.js / HeardAsPanel.jsx / gender-worker.js at 36202c2
  (header of the file): switching the panel on at audio time A starts a NEW gender worker (fresh resampler, ring,
  utterance gate, silence tracker, speech framer, classify schedule; `heardAs.reset()`; voice state null) that gets
  capture chunks and relayed pitch hints from then on; while the model loads (until A + L) chunks fill the ring and the
  gate gets its pitch hints but no window is decided or scored, and every panel compute is a hidden "loading" update;
  the speech detector is taken to become ready together with the classifier; the panel computes at once at A, then on
  its 2 s interval from A, plus the 250 ms hide check while shown. The warning object gets every posted pitch frame and
  every resonance post from the start of listening whatever the panel does, with that app's audio clock
  (pitch-only until A). Each condition is its own emulated app sharing the panel-independent parts (capture, pitch
  worker, resonance worker). The real q8-v2 classifier (Syrinx-cue node_modules) is cached per session by the
  sha1 of the window's 12,000 samples (bit-identical windows only).
- **Conditions** (every session runs all of them in one chain pass):
  - `on0`: panel on before listening, model ready — exactly round 2's runs; panel phases 0 / 500 / 1000 / 1500 ms
    (phase index j = 0..3), one gender worker shared by the phases.
  - `on0L`: panel on before listening, model ready at 7.95 s (phases as on0, one worker). Descriptive + identity.
  - `T30`, `T60`, `T120`: panel switched on at A = T + p_j with p_j = 0 / 450 / 1050 / 1500 ms, model ready at
    A + L_j with L_j = 4.05 / 5.40 / 6.60 / 7.95 s (j = 0..3; one worker per (T, j)); switch-on and readiness take
    effect at the first 25 ms chunk end at or after those times. Offsets and delays are multiples of the gender
    worker's 150 ms decision hop, so a late worker's decisions fall on the on0 worker's audio grid and bit-identical
    windows reuse the cached logit (in the app the hop runs on the wall clock and its alignment is arbitrary).
- Live in the loop for every panel: the shipped module (rows: on, held, pitchStart) and round 2's live module (S0).
- **Replay** `replay_late.mjs`: rebuilds each panel's exact call stream (shared pitch / resonance events; the panel's
  own clock for every resonance post; its own updates) and drives the shipped module, `late-variants.js` with
  fallback = null, round 2's S0 module and every candidate. Parity (must be all zero, else `late_eval.py` refuses to
  build features): replayed shipped and fallback-null = live shipped (on, held, pitchStart) and replayed S0 = live S0
  on every update.
- **Candidates** `late-variants.js`, generated by `make_variants.py` from the shipped module by asserted exact
  string replacements (FALLBACK blocks only; with fallback = null it is the shipped code path).
- **Outcomes** `late_eval.py` (definitions §4).

**Validation done before registration** (no outcome of any rule on any study session):
1. *on0 = round 2, tick for tick.* `session_late.mjs --late=` (on0 only) over 21 round-2 dev sessions (nat, off, hcs,
   ehcs, picka, both sexes; 3,091 s of audio): every main-thread event (158,612), every panel row of the 4 phases
   (6,230 updates; round 2's 10 columns), the phase-update streams, posted pitch, classified windows and round-1 ticks
   are identical to round 2's recorded `dev_*.jsonl`, and the live shipped column equals round 2's scored
   `A40+KP8-3+DS10|app` strings on all 6,230 updates (`compare_on0.py`: 0 mismatches).
2. *Parity* on 17 round-1 sessions (1 + 16; 340 panels): 0 mismatches (shipped, fallback-null, S0, held, pitchStart).
3. *Independent implementation* `indep_late.py` (Python, written from the rule text): on the 16 round-1 sessions with
   T = 20 / 30 / 60 s (16,619 updates of 320 panels; the no-start-share path taken on 155 of the 192 late panels), the
   shipped rule and all five candidates equal the JS strings: 0 mismatches each. No candidate differs from the shipped
   rule before its first no-start-share update or on any on0 / on0L panel (`late_eval.py features`).
4. *Outcome code* `late_eval.py verify_r2`: on round 2's recorded dev data (panel on from 0) it reproduces round 2's
   dev table exactly for S0 and A40+KP8-3+DS10 (hits ≤ 10 s per base sex, natural FA and per-reader maximum per sex;
   differences ≤ 4e-18).

## 2. Data (public only)

### 2.1 Dev: round 2's dev pool

The 96 dev speakers of `../../warning-male-fa-r2/select/pool.json` (48 women, 48 men; LibriSpeech train-other-500 /
train-clean-360, MLS fr / es / it / nl / pt / pl dev + test, OpenSLR 83; drift-stratified, PREREG round 2 §2.4).
Sessions (`build_jobs_late.py`; round 2's constructions lengthened, its code otherwise unchanged):

| Set | Construction | Sessions |
|---|---|---|
| `natL` | from utterance 0, the first ≥ 300 s of utterances, 0.25 s gaps (begins with round 2's `nat` audio) | 96 |
| `hcsL` | base ≥ 170 s natural from utterance 0 (7.2 kHz low-pass), shift = the next ≥ 40 s through WORLD (dio + stonemask) in PO (men F0 × 1.7041 up, women down; round 2's shared peak normalisation over US/PO/PE/EO) | 96 |
| `pickaL` | women: base ≥ 170 s natural from utterance 0, shift = the next ≥ 40 s in the PICKA cells (−6, 0) and (−12, 0) | 96 |

So a panel switched on at 120 s (+ ≤ 1.5 s phase + ≤ 7.95 s loading) still has ≥ 170 s of natural reading after it in
`natL` and its shift ≥ ~40 s after its model is ready in `hcsL` / `pickaL`. 288 dev sessions, ~70,000 s of audio.

### 2.2 Fresh test pool (built after the choice by this rule; `fresh/`)

- **Sources** (never used by any Syrinx study): LibriSpeech (openslr/librispeech_asr parquet, CC BY 4.0)
  train-other-500 shards 0018–0025 (`LS-other`) and train-clean-360 shards 0012–0019 (`LS-clean`); MLS
  (facebook/multilingual_librispeech, CC BY 4.0) French, Spanish, Italian, Dutch, Portuguese, Polish **train**
  partition, the first train parquet of each language (`MLS`; MLS speakers are disjoint across partitions; round 2
  used dev + test, round 1 German only); OpenSLR 83 (CC BY-SA 4.0) archives northern_english_male,
  southern_english_female, southern_english_male (`SLR83`; never downloaded before; edge-trimmed and resampled as in
  round 2).
- **Exclusion** (over-inclusive, round 2's `used_speakers.py` scan with this study's folder skipped): a candidate
  is excluded if its numeric id matches any file / directory name or text-file content (< 8 MB) under the scratchpad
  (every earlier study incl. both rounds' pool.json files, the confirmation's 66 readers, round 1's 100 and round 2's
  192 speakers), the voice-detector build manifests, Syrinx-cue's and Syrinx main's measurements/, scripts/, tests/
  (patterns as in round 2: `<id>[-_/]<2–6 digits>[-_/]`, `ls<id>`, `/<id>/`; SLR83 `<code>_<id>`, `slr<code><id>`);
  plus every numeric id of the round-1 and round-2 pool.json files and the confirmation's readers explicitly.
  LibriSpeech test-clean / dev-clean / dev-other / test-other speakers are disjoint from train-* by construction (and
  scanned anyway).
- **Eligible**: not excluded, sex f / m, ≥ 330 s of audio (SLR83 after the trim); D defined (below).
- **Drift D** (round 2's statistic): the REAL pitch worker alone (round 2's `pitch_only.mjs`) over each eligible
  speaker's offset-0 natural audio, first 125 s; D = population SD of the medians of 12·log2 f0 of the posted voiced
  frames in the six 20 s blocks [0, 20) … [100, 120) s (a block counts with ≥ 100 voiced frames; ≥ 4 blocks needed).
- **Stratified selection, per sex**: drift strata by **round 2's pool tercile boundaries** (women: D < 0.35698 /
  < 0.61278 / above; men: D < 0.39655 / < 0.68030 / above — midpoints between round 2's tercile neighbours), **16
  speakers per stratum** (48 per sex, as round 2's 16 per tercile per split): within a stratum, round robin over the
  groups in the order LS-other, LS-clean, MLS, SLR83 (MLS: round robin over fr, es, it, nl, pt, pl; SLR83 over its
  archives; numeric id order within a language / archive / LibriSpeech subset), skipping exhausted groups. If a
  stratum has fewer than 16 eligible speakers, all are taken and the next 8 shards of each LibriSpeech subset
  (other-500 0026–0033, clean-360 0020–0027) are added and the rule re-run, until every stratum is full or those
  shards are used; the pool must hold ≥ 40 per sex (else the test is not run and that is reported).
- **Test sessions**: `natL`, `hcsL`, `pickaL` exactly as §2.1 on the fresh pool; same harness command.

## 3. Candidates (fully specified; `late-variants.js`, listing order F1, F2, F3-5, F3-10, F4-Q5)

**Trigger (all candidates).** A candidate departs from the shipped rule only at an update where ALL hold: (a) t_start
is known and the update's audio time is > t_start (the start window has closed), (b) the start share is empty (no
shown update in [t_fill, t_start]), and (c) **the panel came on late**: the module's first `update()` call (since it
was created or `reset()` — stop / start listening; a resonance-cue restart keeps the flag) arrived when t_fill was
already known. Otherwise every candidate executes the shipped code path, so with a start share, and for any panel on
before listening (its first call is the switch-on compute before any audio), behaviour is the shipped rule's tick
for tick. Condition (c) is this pre-registration's choice: without it a panel on from the start but hidden through
the whole window ("Keep talking"; round 2's test man mlsdu4429) would also take the fallback, which the bar's
"panel on at 0 identical" check forbids. Consequently F2 is "drop the DS10 gate when no start share exists **because
the panel came on late**". A40's reference and KP8's history keep their session-start definitions in every candidate.

| Name | When triggered |
|---|---|
| `F1` | Fallback start share. The window opens at the first SHOWN update after the start window closed (fbT0) and collects the drawn shares of the shown updates with audio time ≤ fbT0 + 20 s; it closes at the first update (shown or hidden) with audio time > fbT0 + 20 s; fallback share = median of the collected shares. While the window is open the DS gate fails (no warning); from the next update on, DS10 compares the drawn share with the fallback share (≥ 10 points), exactly as with a start share. |
| `F2` | No DS gate: the condition is A40 + KP8-3 alone (\|ΔP\| ≥ X and \|Δu\| ≤ 0.6 u), K = 2 etc. unchanged. |
| `F3-5`, `F3-10` | F1, but the window stays open past fbT0 + 20 s until ≥ N shares are collected (N = 5, 10): collection continues (every shown update's share) and the window closes at the first update with audio time > fbT0 + 20 s and ≥ N shares. |
| `F4-Q5` | F3-5 collecting only "quiet" shares: shown updates that are eligible (the shipped eligibility), meet the resonance bound \|u − startU\| ≤ 0.6 u, and do NOT meet the pitch threshold (\|ΔP\| < X, the update's own KP8 threshold): the panel's share while the voice is still like the start. Closes at the first update with audio time > fbT0 + 20 s and ≥ 5 quiet shares. |

Everything else (A40, KP8-3, K = 2, the hold through ≤ 5 hidden updates, eligibility, resets) is the shipped rule.
The fallback state is cleared by every reference reset (cue restart, stop / start).

## 4. Outcomes (round 1's definitions, `late_eval.py`; per phase index j, then averaged over j)

Each rule's on/off at the regular 2 s panel updates ("T" updates; switch-on and hide-check updates drive the module
but are not scored) and the panel fields of those updates (shown, S0 eligibility, shown share):

- **Failure set** (per j, from the **on0** panel of phase j; the same sessions for every condition and rule):
  pitch-only sessions (`hcsL` PO, `pickaL` (−6,0), (−12,0)) whose on0 shown estimate (median share over visible
  updates at t ≥ t_shift + 10 s, ≥ 3 updates) differs from the listener two-way share by ≥ 20 points (H&C MPO 65.7 /
  WPO 19.1; PICKA Meyer 2023 6.3 / 54.8). Base sex = the reader's sex (male base = pitch raised).
- **Hit** (a condition's panel j on a failure-set session): the warning is on at ≥ 1 T update in (t_shift, t_shift +
  10 s] and was off at the last eligible update at or before t_shift. Hit rate per base sex = mean over j of the
  phase's rate (an empty phase set contributes nothing).
- **Natural FA** (`natL`): per reader and condition, the share of eligible T updates with the warning on, averaged over
  the phases with eligible updates; per sex = reader-balanced mean; per-reader max = the largest reader.
- **Pooled** over T30 / T60 / T120: hits = mean of the three conditions' rates; per-reader FA = mean of the reader's
  per-condition values; per sex = reader-balanced mean of those; per-reader max = the largest.
- **Identity**: (i) on every on0 panel of every session, every update (all kinds), candidate on/off = shipped
  on/off; (ii) on every panel of every condition, every update before the first update at which the trigger (§3) holds
  (all updates if never), candidate = shipped.
- Descriptive (not in the bar): hits within 15 s, median time to the first warning after the shift, share of panels on
  the no-start-share path per condition and sex, the shipped rule and S0 at every condition, on0L.

## 5. The bar (all checks; boundaries inclusive, tolerance 1e-12)

For T ∈ {T30, T60, T120, pooled}:
1. Hits within 10 s, per base sex: ≥ the shipped rule's hits with the panel on from 0 (`on0`) on the same sessions − 0.05
   (8 checks; a rate that is n/a passes vacuously).
2. Natural FA ≤ 2 % per sex (8 checks).
3. |men − women| natural FA ≤ 1.5 pp (4 checks).
4. Per-reader natural-FA maximum ≤ 15 % per sex (8 checks).
5. Identity (i) on0: 0 mismatches. 6. Identity (ii) with a start share / before the trigger: 0 mismatches. (2 checks.)

PASS = all 30 hold.

## 6. Selection on dev, the choice, and the single test evaluation

1. `run_dev.sh` runs every dev session once (two shards), the replay (parity must be zero), the on0 prefix identity
   against round 2's recorded dev outputs (the long sessions' on0 events and panel rows up to 1 s before the recorded
   session's shift / end, and the shipped strings, must equal round 2's: reported; a mismatch is reported, not fixed),
   features and `late_eval.py dev`.
2. Order of the candidates: (a) more dev checks passed first; (b) the smaller of the two base sexes' pooled hit rates,
   rounded to 0.01, higher first; (c) the larger of the two sexes' pooled natural FA, rounded to 0.001, lower first;
   (d) the larger of the two sexes' pooled per-reader maximum, lower first; (e) listing order. The first is chosen. If
   none passes all 30, the first by this order still goes to the test (CHOICE.md says so), where only the bar decides.
3. CHOICE.md (with this file's and the dev table's sha256) and CHOICE.sha256 are written and their hashes appended to
   the hash log outside the scratchpad **before** any fresh-pool session is run through the chain.
4. Test (a later step): build the fresh pool (§2.2) and its sessions, run them once with the same harness command,
   replay, `late_eval.py features test` and `late_eval.py test` once: the chosen candidate against the bar. PASS →
   proposed for cue-strip (both hashes in the integrating commit message); FAIL → the shipped rule stays and the
   disclosure line stays. Nothing is re-tuned on test data; every other test number is descriptive.

## 7. Notes and limits

- Hit checks have ~1/n resolution per phase (n = failure-set sessions per base sex and phase, reported); phase
  averaging makes one lost hit cost 0.25/n per phase it is lost in.
- Not covered by design: a panel on from the start but hidden through the whole start window (trigger (c)); a panel
  switched off and on again later in the session; model loads longer than 7.95 s; the speech detector loading
  separately from the classifier; panels switched on before t_fill (they keep the shipped rule).
- Late panels see ≤ 180 s (T120) to 270 s (T30) of natural reading; their KP8 history starts at switch-on.
- Together / resonance-only shifts are not part of this study (the bar is the user's); FA is natural reading only.
- Public data only (LibriSpeech, MLS, OpenSLR 83); no private recordings, no names. Every number is reported per sex.

## 8. Reported to the orchestrating workflow

This file's sha256 (also in PREREG.sha256 and the hash log
`C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/12a8f6ba-d49c-4c27-bd93-69314577b2c1/warning-late-panel-hashes.log`,
outside the scratchpad), the dev table, the choice and its sha256, the fresh pool summary.

## 9. Hashes

`late_eval.py` refuses to run `dev` / `test` if this file or any file below changed (paths relative to this folder).

- hash ../harness/session_late.mjs 14cc38df93aeaf309ff94896f4d5e4a79b8d65b7961f35aba79fe504a5cd9c88
- hash ../harness/shipped/pitch-only-warning.js 2a1f4022db77599731cfcf6de4d42758d531239188bce20ddfdf991a868e658f
- hash ../harness/make_variants.py 67ac155081514b174902311dc27403d496a9bf9ac988189a81dacb78089d5023
- hash ../harness/late-variants.js 8418fdcbdb6c601de750688f36c9e8970eb52765b3f7f1b4635dd5ff4daef351
- hash ../harness/replay_late.mjs c5f4e9face7ca2fe6856eabb4d57c60299e8503666fa5a63a6714bbb7613401e
- hash ../harness/indep_late.py ae054ba7e60d5b1b75d935ea33412e08b55342a7774da97569eb4463c8316adc
- hash ../harness/compare_on0.py 330c3aeb6da12cf93416af5d5ade928c12b85da1ba1d77cf80399f02666e0b6c
- hash ../harness/README.md 7fc097f8a4edbdc5a3cf379a47df54f906a5c007599738b6b110de3d2a39c547
- hash ../../warning-male-fa-r2/harness/src-cue/src/ml/pitch-only-warning.js 5a7a5814f827c48d019b8bfe450de85ffb0855220c88e7e57440df4fc6c43a6a
- hash ../../warning-male-fa-r2/harness/session_app.mjs 190f021a5d6070b07b4d7ae22e494bc10a27acc3a567a26834dbd69eca45bbb9
- hash build_jobs_late.py 2bbbbc02a28c2c245ec3fc1a5693fb19b00e46ed062d0614c36f0416b64c9abd
- hash interleave.py b9eebaf62b13add9ef3533923855f828d77c6b7a7704fe03c970e33fb14f9948
- hash late_eval.py 74b4e221bc106713f13250d9504bb95c18cb007a4573ea3c8fda90f82b9cbb97
- hash run_dev.sh 87b751e0515bebb05ab27fc44ba36dfb11efa75368c112965c84352532083f23
- hash jobs_dev_natL.json b13f8930016cc6ee3b16d59c762d57b22fbc2731e72673048521e3475815c220
- hash jobs_dev_hcsL.json 21d404635a86d8e9e07ff252591e8d179d44eb86ad8c1716b21ffb13cde85ecc
- hash jobs_dev_pickaL.json 535d0040f8c68eeda1b3be87083a87c2febcb14faa0fad1e7d09f0dde4345a18
- hash jobs_dev_all.json a923478021cf4f56f86a90b790691be3169756657a7921100f3c6a6602ee4869
- hash prefix_map_dev.json eea8ff3967805ff841f59e52cd3dbd843dc519c80df4e5a8b225ea3bd8aed46b
- hash ../../warning-male-fa-r2/select/pool.json 261a747077a4ce8b495417dff64aa560930e91c5007de0ac080232f274bde2a7
- hash ../../warning-male-fa-r2/select/pitch_only.mjs 28ed34cf17016552386bcab6e11b532c08ac1b48471fbd0194f340a2e0aae9f9
- hash ../../warning-male-fa-r2/select/tools/used_speakers.py 8afd082bdb14f3695970fefe9ee7f86f397aa97b69c1226a8b11caaf7a27721b
- hash ../../warning-male-fa-r2/select/tools/slrtrim.py b28f91a9286d2b6386756de8e3210a397f91cf45bd74b0815e1148ae691158c5
````

## Appendix H. Late-panel fallback study: choice (verbatim)

sha256 `eb8721cf982844f3aae6509c9673e42438ccda0984ce6fca15cf28fe4300c668` (of the file below, written by
`late_eval.py dev` and logged outside the scratch folder at 2026-10-12 14:18:55 −05:00, before any fresh test-pool
session ran through the chain). The scratch file has CRLF line endings; the block below, with its lines ended CRLF
(including the last), hashes to this value.

````markdown
# Choice (late-panel fallback study, dev split)

Written by `late_eval.py dev` before any fresh test-pool session has been run through the chain.

- PREREG.md sha256: `9a09b4de49bc5a68081d61f051005f6c0586eba124dcd9a13890d02e4ccf985f`
- dev_table.md sha256: `7cc003d3799c780ae06d6569d5e2c727e418d0a92a076130f862d5c9442bbc5a`
- dev_table.csv sha256: `7e1ebfb5dfdc9b52e6ce19ce3e4ab671175395394d28a55d25f461830ee3886e`

- **Chosen: `F4-Q5`** (NO candidate passes every dev check; fallback (PREREG §6): most checks passed, then the §6 order)
- Candidates passing every dev check: none
- Order (PREREG §6): F4-Q5, F1, F3-5, F3-10, F2

Dev checks of the chosen rule:

```
{
 "hits_male_T30": true,
 "hits_female_T30": true,
 "fa_m_T30": true,
 "readermax_m_T30": true,
 "fa_f_T30": true,
 "readermax_f_T30": true,
 "gap_T30": true,
 "hits_male_T60": true,
 "hits_female_T60": true,
 "fa_m_T60": true,
 "readermax_m_T60": true,
 "fa_f_T60": true,
 "readermax_f_T60": true,
 "gap_T60": true,
 "hits_male_T120": false,
 "hits_female_T120": true,
 "fa_m_T120": true,
 "readermax_m_T120": true,
 "fa_f_T120": true,
 "readermax_f_T120": true,
 "gap_T120": true,
 "hits_male_pooled": true,
 "hits_female_pooled": true,
 "fa_m_pooled": true,
 "readermax_m_pooled": true,
 "fa_f_pooled": true,
 "readermax_f_pooled": true,
 "gap_pooled": true,
 "identical_on0": true,
 "identical_with_start_share": true,
 "n_pass": 29,
 "n_checks": 30,
 "all": false
}
```

Pooled (T30/T60/T120) dev outcomes of the chosen rule: hits ≤ 10 s male base 0.829, female base 0.777; natural FA men 0.19 %, women 0.02 %; reader max men 5.35 % (ls3541), women 0.54 % (ls7717).

Full dev table: `dev_table.md` / `dev_table.csv`.
````

## Appendix I. Late-panel study, round 2: pre-registration (verbatim)

sha256 `dd3cf7bc6c211f1bf576e6e27f04d9942826e382f791752c55de77c50d279785` (of the file below, written and hashed in
scratch and logged outside the scratch folder at 2026-10-12 21:14:16 −05:00, before any round-2 candidate was scored on
any session and before any fresh-pool file existed; see §8.8). Relative paths in it refer to the study's scratch
folder. The scratch file has LF line endings; the block below, with its lines ended LF (including the last), hashes
to this value.

````markdown
# Pre-registration: late-panel study, round 2 — a KP8 fallback (with a DS fallback) for a panel switched on late

Written 2026-10-12, **before any round-2 candidate has been scored (hits, false alarms, bar) on any session**.
Hard rule 3 covers `src/ml/pitch-only-warning.js`: a candidate is selected on dev and tested once on a fresh pool of
public speakers no earlier study used; it is adopted only if it passes (user decision 2026-10-12: one more round that
also gives KP8 a late-panel fallback, same bar, brand-new fresh pool).

**State at registration.** The harness is built and checked (§7). The dev pools are round 1's recorded chain outputs
(§2.1): the candidates change only the warning module, which never feeds back into the chain, so dev needs a replay,
not a chain run. On the dev pools only parity, identity and implementation-agreement COUNTS were computed (§7); no
candidate outcome, bar check or comparison between candidates exists. Nothing of the fresh pool exists: no download,
no scan, no session. It is built only after CHOICE.md and its hash exist (`fresh/tools/download.sh` refuses before).

## 0. What feeds the rule, and what the app has before a late switch-on

Read from cue-strip 4c81fea (`src/ml/pitch-only-warning.js` sha256 2a1f4022…, `src/components/HeardAsPanel.jsx`,
`src/audio/useAudioPipeline.js`, `src/ml/heard-as.js`, `src/ml/heardAsCalibration.js`):

- **A40 (pitch reference)**: `addPitch` gets EVERY posted pitch frame (`handlePitchMessage`; f0 = the posted pitch when
  voiced, else null) from the start of listening, whether or not the panel is on; t_fill / t_start come from every
  resonance-cue state post (`noteResonance`, hook audio clock). Same for a late panel.
- **KP8 (threshold)**: the quiet history holds the dP of earlier **shown** panel updates (|dP| below that update's
  threshold); shown updates before t_start pend and are back-filled against S0's P0. Only `update()` feeds it, and
  only `HeardAsPanel` calls `update()`, so for a late panel the history starts at switch-on (round 1's review: this,
  not the DS gate, costs the male-base T120 hits).
- **DS10 (panel-moved gate)**: the start share = median of the drawn shares of shown updates in [t_fill, t_start];
  empty for a panel off / loading / hidden through that window.
- **Panel cadence**: `compute()` once at switch-on, then every 2 s (`setInterval`, from switch-on), plus the 250 ms
  hide check while shown and the voice state is "sustained"; hidden "loading" updates until the model is ready.
- **lnF0 of a shown update** = `heardAs.estimate(now).lnF0`: ln of the median of the posted voiced pitch values of the
  frames inside the gated scored windows' 750 ms spans in the trailing 8 s. The aggregator gets pitch frames only while
  the gender worker exists (it is reset at switch-on) and windows only from it (utterance gate + speech detector +
  classifier). Hidden: voice state "sustained", nothing scored ("listening"), newest window > 5 s old ("stale"),
  < 10 windows or < 3 s voiced ("short"), F0 outside 81–293.1 Hz or meter logit outside the fit range ("outside").
- **Before switch-on the app has**: every posted pitch frame (time, f0 / unvoiced) and every resonance post (u,
  startU, fill, the utterance-gate verdict, sinceResumeS), on the audio clock, already delivered to the warning object.
  It has NO classifier output (the gender worker runs only while the panel is on), so no meter logit and no share.
  Hence a KP8 seed can be built causally from the posted pitch frames (+ the resonance verdict for the "sustained"
  hide); a DS start share cannot be seeded, so DS keeps round 1's post-switch-on fallbacks (or none).

## 1. Code under test and harness (`../harness/`, hashes in §11)

- **Shipped module** `shipped/pitch-only-warning.js` = cue-strip 4c81fea `src/ml/pitch-only-warning.js` (sha256
  2a1f4022…; identical to round 1's copy of 36202c2).
- **Chain harness** `session_late.mjs` = round 1's, byte-identical (sha256 14cc38df…; round 1 PREREG §1): round 2's
  app-cadence harness + late switch-on and model loading; the chain is round 2's clone
  `../../warning-male-fa-r2/harness/src-cue` (origin/cue-strip cf76c58, chain files identical to 36202c2). Used here
  only for the fresh pool (the dev pools were recorded by it in round 1).
- **Candidates** `late-variants-r2.js`, generated by `make_variants_r2.py` from the shipped module by asserted exact
  string replacements (FALLBACK blocks only). With `fallback = null` it is the shipped code path; with a round-1 config
  it is round 1's candidate (checked, §7).
- **Replay** `replay_r2.mjs`: each panel's exact call stream (shared pitch / resonance events, the panel's own clock,
  its own updates) drives the shipped module, the REPO module (Syrinx-cue checkout, sha256 asserted), the variants
  module with fallback = null, round 2's S0 module, the six candidates and round 1's F4-Q5. Parity (shipped, repo,
  fallback-null vs the live shipped column on on / held / pitchStart; S0 vs the live S0 column) must be zero, and all
  rules must agree on the first triggered update, else `late_eval_r2.py features` refuses.
- **Independent implementation** `indep_r2.py`: round 1's `indep_late.py` extended from the rule text of §3 (its
  K-seed shadow keeps its own list of voiced frames for its reference instead of reading the module's state).
- **Outcomes, bar, selection** `../select/late_eval_r2.py`: round 1's `late_eval.py` definitions copied unchanged
  (verified to reproduce round 1's numbers exactly, §7); new: rule list, the repo-module parity assert, two dev pools.
- **Plumbing diagnostic** `seed_diag.mjs` (non-study sessions only; not an outcome).

## 2. Data (public only: LibriSpeech, Multilingual LibriSpeech — CC BY 4.0)

### 2.1 Dev pool A: round 1's dev pool

The 96 speakers (48 women, 48 men) of `../../warning-male-fa-r2/select/pool.json` (split "dev"), round 1's sessions
`natL` / `hcsL` / `pickaL` (288 sessions, 73,827 s; round 1 PREREG §2.1), conditions on0 / on0L / T30 / T60 / T120 ×
4 phases, recorded by round 1's chain run: `../../warning-late-panel/select/out/dev_{0,1}.jsonl`.

### 2.2 Dev pool B: round 1's spent fresh test pool

The 96 speakers (48 / 48) of `../../warning-late-panel/fresh/pool.json`, the same three constructions (288 sessions,
73,561 s), recorded by round 1's single test run: `../../warning-late-panel/fresh/out/test_{0,1}.jsonl`. Pool B was
spent by round 1's test (its F4-Q5 result and the review's post-hoc attribution of the four male-base T120 misses are
known and informed this round's candidate design), so it is a second DEV pool here, never a test pool.

Both pools are used together for the selection (§6). Neither pool's chain output is re-run.

### 2.3 Fresh test pool (built after CHOICE.md by this rule; `../fresh/`, tools hashed in §11)

- **Sources** (no study in this scratchpad downloaded these files; any speaker an earlier study used anywhere is
  removed by the exclusion below): LibriSpeech (openslr/librispeech_asr parquet) train-other-500
  shards 0026–0033 (`LS-other`) and train-clean-360 shards 0020–0027 (`LS-clean`); MLS (facebook/multilingual_
  librispeech) French, Spanish, Italian, Dutch, Portuguese, Polish **train** partition, **second** parquet
  (train-00001-of-N) of each language (`MLS`). OpenSLR 83 is dropped (round 1 found every OpenSLR 83 speaker listed by
  an earlier study). `tools/download.sh 1`.
- **Exclusion** (over-inclusive): `tools/used_speakers.py` = round 1's scan with only this round's `fresh/` folder
  skipped: a candidate is excluded if its numeric id matches (`<id>[-_/]<2–6 digits>[-_/]`, `ls<id>`, `/<id>/`) any
  file / directory name or text-file content (< 8 MB) anywhere under the scratchpad — every earlier study:
  warning-male-fa, warning-male-fa-r2, warning-adopt, mainthread-warning (incl. the confirmation's 66 readers),
  warning-late-panel (both its pools, its fresh inventory, candidates and excluded scan lists), this round's harness and
  select folders — the voice-detector build manifests, and Syrinx-cue's and Syrinx main's measurements/, scripts/,
  tests/. `tools/candidates.py` also excludes every numeric id of: the confirmation's 66 readers and its scan list;
  the men's-FA round-1 and round-2 pool.json files, their inventories and round 2's scan list; the late-panel round-1
  fresh pool.json, candidates.json (eligible and excluded), inventory.json and scan list.
- **Eligible**: not excluded, sex f / m, ≥ 330 s of audio; D defined.
- **Drift D** (round 2's statistic, unchanged): the REAL pitch worker alone (`../../warning-male-fa-r2/select/
  pitch_only.mjs`) over each eligible speaker's first 125 s of natural audio; D = population SD of the medians of
  12·log2 f0 of the posted voiced frames in the six 20 s blocks [0, 20) … [100, 120) s (a block counts with ≥ 100
  voiced frames; ≥ 4 blocks needed).
- **Stratified selection, per sex** (`tools/select.py` = round 1's minus the OpenSLR 83 group): strata by **round 2's
  tercile boundaries** (women D < 0.35698 / < 0.61278 / above; men D < 0.39655 / < 0.68030 / above), **16 per stratum**
  (48 per sex): within a stratum round robin over LS-other, LS-clean, MLS (MLS round robin over fr, es, it, nl, pt, pl;
  numeric id order within a language / LibriSpeech subset), skipping exhausted groups.
- **Reserve**: while any stratum has fewer than 16 eligible speakers, the next shard set is added and the whole rule
  re-run: set 2 = train-other-500 0034–0041 + train-clean-360 0028–0035, then set 3 = 0042–0049 + 0036–0043. After
  set 3 the pool must hold ≥ 40 per sex, else the test is not run and that is reported (`fresh/build_pool.sh`, exit 3).
- **Test sessions**: `natL`, `hcsL`, `pickaL` exactly as round 1 (`../../warning-late-panel/select/build_jobs_late.py`,
  `interleave.py`, unchanged); the same chain command as round 1's test (`fresh/run_test.sh`: `session_late.mjs …
  --classifier=real --on0Load=7950`, 2 shards, conditions on0, on0L, T30, T60, T120 with round 1's phase offsets
  0 / 450 / 1050 / 1500 ms and model-load times 4.05 / 5.40 / 6.60 / 7.95 s; on0 phases 0 / 500 / 1000 / 1500 ms).
- Python that reads downloaded data runs with `-I` through `../harness/iso.py` (it appends only the fixed per-user
  site-packages path, where numpy / pyarrow / soundfile live, and runs the script without its directory or the
  working directory on sys.path); downloads live in `fresh/dl/` only, scripts in `fresh/tools/`. The same launcher
  runs `late_eval_r2.py`.

## 3. Candidates (fully specified in `late-variants-r2.js`; listing order KS-Q5, KS-F1, KH20-Q5, KO-Q5, KO-F1, KS-N)

**Trigger (every candidate; round 1's, unchanged).** A candidate departs from the shipped rule only at an update where
ALL hold: (a) t_start is known and the update's audio time is > t_start; (b) the start share is empty (no shown update
in [t_fill, t_start]); (c) the panel came on late: the module's first `update()` since creation or `reset()` arrived
when t_fill was already known (a cue restart keeps this flag). With the panel on from 0 (on0, on0L) (c) never holds,
so behaviour there is the shipped rule's by construction; before the first triggered update every candidate is the
shipped rule. A40's reference and everything not named below is the shipped rule (K = 2, the ≤ 5 hidden-update hold,
eligibility, resets).

**KP8 options.**

- **K-seed** (`kp8: "seed"`). From creation / `reset()` the module keeps a SHADOW KP8 state built only from data the
  app already has, causally: at every multiple of 2 s of the audio clock, computed when the first posted frame later
  than it arrives (so only frames up to it are used), a pseudo update with lnF0 = ln median of the posted VOICED frames
  in (t − 8 s, t]; it counts as "shown" when those frames' voiced time (each frame's spacing to the previous posted
  frame, capped at 100 ms — heard-as.js's voicedMs) is ≥ 3 s, the newest voiced frame is ≤ 5 s old, lnF0 is inside the
  panel's tested F0 range (ln 81 … ln 293.1) and the latest resonance verdict is not "sustained" (the panel's own
  pooling window and hide rules, without the classifier). Each pseudo update goes through the shipped KP8 bookkeeping:
  before t_start it pends and is back-filled against S0's P0 at the first pseudo update with a reference; later,
  dP = 12·(lnF0 − the A40 reference at t)/ln 2 (the same reference the shipped rule uses at t), kept if |dP| < the
  shadow's own KP8-3 threshold (max(4 st, 3 × RMS) once it holds ≥ 5 values). **At the first triggered update the
  panel's KP8 state (quiet history + pending values; both empty for a late panel) is replaced by the shadow's**; from
  then on the panel's shown updates add to it as shipped. The shadow's history is cleared with the references (cue
  restart); its 8 s frame window only by `reset()`. Constants equal HEARD_AS_CALIBRATION (windowMs 8000, updateMs
  2000, minVoicedMs 3000, freshMs 5000, range.lnF0).
- **K-off** (`kp8: "off"`). At every triggered update the threshold is fixed at 4 st (S0's X; no KP8).
- **K-hold-20** (`kp8: "hold", kp8N: 20`). At a triggered update the threshold is held at 4 st until the panel's own
  quiet history holds ≥ 20 values (≈ 40 s of quiet shown updates, the span A40's reference grows), collected with the
  held 4 st as the quiet filter; then KP8-3 as shipped. ("No KP8 tightening until N values" is the same rule: KP8
  only ever raises X above 4 st. N = 20 is chosen here, not tuned.)

**DS options (round 1's, unchanged).** `Q5` = round 1's F4-Q5: a fallback start share from the first shown update
after the start window closed (fbT0): the median of the "quiet" drawn shares (eligible, |u − startU| ≤ 0.6 u,
|dP| < that update's threshold X) of shown updates up to fbT0 + 20 s and beyond until ≥ 5 are collected; the DS gate
fails while the window is open, then DS10 against the fallback share. `F1` = round 1's F1 (all shown shares in
[fbT0, fbT0 + 20 s], ≥ 1). `N` = no DS gate (round 1's F2).

| Name | KP8 | DS | Why in the family |
|---|---|---|---|
| `KS-Q5` | K-seed | Q5 | restores the on0 panel's KP8 history; keeps round 1's best DS fallback |
| `KS-F1` | K-seed | F1 | same, round 1's simplest DS fallback (equal hits on round 1's dev) |
| `KH20-Q5` | K-hold-20 | Q5 | no seed: 4 st until the late history is long |
| `KO-Q5` | K-off | Q5 | the review's replay (no KP8) recovered every lost T120 phase-hit; DS fallback for false alarms |
| `KO-F1` | K-off | F1 | same with F1 |
| `KS-N` | K-seed | none | whether the seed makes a DS fallback unnecessary |

Round 1's F4-Q5 (`R1-F4-Q5`, KP8 as shipped + Q5) is replayed as a descriptive row only; it is not a candidate.

## 4. Outcomes (round 1's §4 definitions, unchanged; `late_eval_r2.py`, per phase index j, then averaged over j)

On/off at the regular 2 s panel updates ("T" updates; switch-on and hide-check updates drive the module but are not
scored). **Failure set** (per j, from the on0 panel of phase j; the same sessions for every condition and rule):
pitch-only sessions (`hcsL` PO; `pickaL` (−6, 0), (−12, 0)) whose on0 shown estimate (median share over visible
updates at t ≥ t_shift + 10 s, ≥ 3 updates) differs from the listener two-way share by ≥ 20 points (H&C MPO 65.7 /
WPO 19.1; PICKA Meyer 2023 6.3 / 54.8); base sex = the reader's sex. **Hit**: on at ≥ 1 T update in (t_shift,
t_shift + 10 s] and off at the last eligible update at or before t_shift; rate per base sex = mean over j. **Natural
FA** (`natL`): per reader and condition the share of eligible T updates with the warning on, averaged over the phases
with eligible updates; per sex = reader-balanced mean; per-reader max = the largest reader. **Pooled** over T30 / T60 /
T120: hits = mean of the three rates; per-reader FA = mean of the reader's per-condition values; per sex = reader-
balanced mean; max = largest. **Identity**: (i) every update of every on0 panel, candidate = shipped; (ii) every
update of every panel before its first triggered update (all if never), candidate = shipped. Descriptive (not in the
bar): hits within 15 s, median time to the first warning, panels on the trigger path, shipped / S0 / R1-F4-Q5 rows,
on0L.

## 5. The bar (round 1's §5, UNCHANGED; boundaries inclusive, tolerance 1e-12)

For T ∈ {T30, T60, T120, pooled}:
1. Hits within 10 s, per base sex ≥ the shipped rule's hits with the panel on from 0 (`on0`) on the same sessions
   − 0.05 (8 checks; an n/a rate passes vacuously).
2. Natural FA ≤ 2 % per sex (8 checks).
3. |men − women| natural FA ≤ 1.5 pp (4 checks).
4. Per-reader natural-FA maximum ≤ 15 % per sex (8 checks).
5. Identity (i) on0: 0 mismatches. 6. Identity (ii) before the trigger: 0 mismatches (2 checks).

PASS = all 30 hold on the evaluated pool.

## 6. Selection on dev, the choice, the single test, and what follows

1. `select/run_dev.sh` (once): replay both dev pools (parity must be zero), features, `late_eval_r2.py dev`.
2. The 30 checks are computed on pool A and on pool B separately (each against its own shipped-on0 hit reference):
   60 dev checks per candidate. A candidate **passes dev** when all 60 hold. Order (round 1's §6 shape): (a) more dev
   checks passed (of 60); (b) the smallest of the four pooled hit rates (2 base sexes × 2 pools), rounded to 0.01,
   higher first; (c) the largest of the four pooled natural-FA values, rounded to 0.001, lower first; (d) the largest
   of the four pooled per-reader maxima, lower first; (e) listing order. The first is chosen. If none passes all 60,
   the first by this order still goes to the test and CHOICE.md says so; only the test bar decides.
3. `late_eval_r2.py dev` writes dev_table.{md,csv}, dev_bars.json, CHOICE.md (with PREREG's and the dev tables'
   sha256) and CHOICE.sha256, and appends their hashes to the hash log, **before** any fresh-pool file exists (it
   asserts that `fresh/dl` is empty and `fresh/out` holds no session output; `fresh/tools/download.sh` refuses to run
   without CHOICE.md and CHOICE.sha256).
4. Test (a later step): `fresh/build_pool.sh` builds the fresh pool (§2.3) and its sessions; `fresh/run_test.sh` runs
   them once (2 shards), replays, `features test` and `late_eval_r2.py test` once: the chosen candidate against the 30
   checks. Nothing is re-tuned on test data; every other test number is descriptive.
5. **On PASS**: the candidate is proposed for cue-strip: the measurement note section
   (`measurements/heard-as-pitch-only-warning-2026-10-07.md` §8.8: PREREG, CHOICE, dev and test tables, per sex) is
   committed before or with the code; the code is the candidate's FALLBACK blocks ported into
   `src/ml/pitch-only-warning.js` (K-seed constants taken from HEARD_AS_CALIBRATION), with a port-parity replay of the
   repo module against `late-variants-r2.js` on the test sessions (0 mismatches required) and the panel's "More" lines
   (start-window limit, hit and false-alarm figures) updated to the measured numbers. PREREG and CHOICE sha256 go in
   the integrating commit message. Pushed to cue-strip; no PR.
6. **On FAIL**: nothing is adopted. `src/ml/pitch-only-warning.js` (A40+KP8-3+DS10, sha256 2a1f4022…) and the panel's
   start-window "More" line stay unchanged. Only the note §8.8 is written (verdict, the failed checks, dev and test
   tables per sex), and the best candidate — the chosen one, i.e. the first by the §6 order on dev — is reported
   with its test numbers (the other candidates' test rows descriptive) for a user decision.

## 7. Harness checks done before registration (counts only; no outcome)

1. **Replay parity and the repo module, both dev pools** (`check/log_full_dev{A,B}_check.txt`): pool A 288 sessions,
   5,760 panels, 625,687 updates (on0 149,644); pool B 288, 5,760, 621,135 (on0 148,630): shipped copy, REPO module
   (Syrinx-cue 4c81fea, tick for tick) and variants-with-fallback-null vs the live shipped column (on, held,
   pitchStart), and S0 vs the live S0 column: **0 mismatches** each, on0 and all conditions. (Round 1 established that
   the live on0 column equals round 2's recorded dev outputs on the 288 dev prefixes, 59,274 updates, 0 mismatches;
   so the repo module equals them too.)
2. **Identity of every candidate** (same runs): on0 + on0L 299,233 (A) / 297,218 (B) updates, and 308,026 (A) /
   301,168 (B) updates before the first triggered update (all conditions): **0 mismatches** for all six candidates and
   round 1's five. All rules agree on the first triggered update on every panel. Panels on the trigger path: A T30
   1,090 / T60 1,152 / T120 1,152 of 1,152; B 1,134 / 1,144 / 1,152; on0 and on0L 0.
3. **Round-1 regression**: round 1's five candidates rebuilt from `late-variants-r2.js` equal round 1's recorded
   replay strings on every update of both pools (625,687 + 621,135; first triggered update identical): 0 mismatches.
4. **Independent implementation** `indep_r2.py` vs the JS, on/off strings AND per-update state (trigger, DS window
   state, share count, fallback median, seeded, history length, shadow history length, both KP8 thresholds):
   round 1's implementation-check sample (16 men's-FA round-1 sessions, T = 20 / 30 / 60 s; 320 panels, 16,619
   updates; seed taken on 155 panels) and 8 sessions of each dev pool (the first 8 of each pool's shard-0 file; 160 +
   160 panels, 17,478 + 17,248 updates; seed taken on 92 + 96 panels): **0 on/off and 0 state mismatches** for the
   shipped rule, all six candidates and R1-F4-Q5.
5. **Outcome code** `late_eval_r2.py verify_r1`: on both pools (replayed with the round-1 rules only), every outcome
   value of shipped, S0 and F4-Q5 in every condition and pooled equals round 1's `late_eval.py` (`check/log_verify_r1_
   {A,B}.txt`; numbers in §7a).
6. **Seed plumbing** (`seed_diag.mjs`, non-study sample of item 4): with the panel on from 0 the shadow's KP8
   threshold tracks the panel's own: per-session median |difference| 0.00–0.28 st, largest 1.22 st (16 sessions).

§7a — `verify_r1`: pool A against round 1's dev evaluation and pool B against round 1's test evaluation (round 1's
`late_eval.py` on its own feature files): 306 values each (hit rates ≤ 10 / 15 s per base sex, failure-set sizes per
phase, median first-warning times, natural FA per sex, the per-reader values and maxima; shipped, S0 and F4-Q5 in
on0, on0L, T30, T60, T120 and pooled): **0 differ**; the failure sets and conditions are identical. The selection
code path, run with round 1's F4-Q5 as a stand-in (`check/tmp/smoke_select.py`), gives its known 29 / 30 on each
pool with the same failed check (male-base hits at T120).

## 8. Notes and limits

- Not covered (as round 1): a panel switched off and on again later in a session; model loads > 7.95 s; the speech
  detector loading separately; panels switched on before t_fill (shipped rule); together / resonance-only shifts;
  FA from natural reading only.
- The K-seed pseudo updates approximate the panel's shown updates without the utterance gate's scored windows and the
  classifier (all voiced frames of the 8 s window, not only those inside scored windows; no meter-logit hide).
- The candidate family was designed with round 1's dev and test results and the review's attribution in view; that
  is why pool B is dev here and only the brand-new fresh pool decides.
- Hit checks have ~1/n resolution per phase (n = failure-set sessions per base sex and phase, reported); one lost hit
  costs 0.25/n per phase.
- Observation (not a result; nothing here changes it): with the panel never switched on, the shipped module's A40
  frame buffer is never frozen (only `update()` freezes it), so it keeps every voiced frame of the session (~40 per
  s). K-seed reads it (its own A40 value is cached once final) but does not change it.
- Public data only (LibriSpeech, MLS); no private recordings, no names. Every number is reported per sex.

## 9. Expected run time

- Dev (`run_dev.sh`): replay of both pools in parallel ~8 min (measured: the 15-module check replay took 7.5 min),
  features + evaluation ~10 min: **~20 min**.
- Fresh pool (`build_pool.sh`): downloads ~15 GB ~15–25 min, inventory ~10 min, exclusion scan ~60 min (round 1:
  57 min), extraction ~10 min, drift ~10 min, sessions (WORLD / PICKA) ~25 min: **~2–2.5 h** (+ ~1.5 h per reserve set,
  if needed).
- Test (`run_test.sh`): the chain on ~74,000 s of audio, 2 shards at ~3.7× real time each: **~2.8 h**; replay,
  features, evaluation ~15 min.
- Total after registration ≈ **5.5–6 h** of wall time.

## 10. Reported to the orchestrating workflow

This file's sha256 (also in PREREG.sha256 and the hash log
`C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/12a8f6ba-d49c-4c27-bd93-69314577b2c1/warning-late-panel-r2-hashes.log`),
the candidate list, the check numbers, the dev pools, the expected run time.

## 11. Hashes

`late_eval_r2.py` refuses to run `dev` / `test` if this file or any file below changed (paths relative to this folder).

- hash ../harness/session_late.mjs 14cc38df93aeaf309ff94896f4d5e4a79b8d65b7961f35aba79fe504a5cd9c88
- hash ../harness/shipped/pitch-only-warning.js 2a1f4022db77599731cfcf6de4d42758d531239188bce20ddfdf991a868e658f
- hash ../harness/make_variants_r2.py 04d56d0232a8899c45f506baafb84f23c21499d4927f724ad683ea0e5fb2f43d
- hash ../harness/late-variants-r2.js 956061543a15b0372543fc32e797edbf316ac05632129bbf528a501d1d5de241
- hash ../harness/replay_r2.mjs a3ec703cf6cedb12f7c033f700582a5a4a8328d8fef7f98eadeca786da5205e8
- hash ../harness/indep_r2.py a74a936f7d98c0b984b4ab3b7e53547375bdf6e45498b2109cd32cc219a847ce
- hash ../harness/seed_diag.mjs c6d210c632b9c703c77ca514852051c25089c8faee6699b202d1cefb9736ae83
- hash ../harness/iso.py ae260af3d5fbcbe4800690bb00f1e95abdcb62f7af969a7ba6fbf05c3b055d1f
- hash ../harness/replay_late.mjs c5f4e9face7ca2fe6856eabb4d57c60299e8503666fa5a63a6714bbb7613401e
- hash ../harness/indep_late.py ae054ba7e60d5b1b75d935ea33412e08b55342a7774da97569eb4463c8316adc
- hash ../harness/make_variants.py 67ac155081514b174902311dc27403d496a9bf9ac988189a81dacb78089d5023
- hash ../harness/late-variants.js 8418fdcbdb6c601de750688f36c9e8970eb52765b3f7f1b4635dd5ff4daef351
- hash late_eval_r2.py 9b17049d44e9fd1b80902948d2a21a8c21f0fe131f7692570fb99f594db90d6f
- hash run_dev.sh eca92b3151509503c60fc574de17db99aa9d160ae5b7e3b52ac284900fa7e95d
- hash ../fresh/build_pool.sh 3e70ac4ebc775fa883274b5b8dd718e37e699495d5b2b8a4cbcdf9c1910c495b
- hash ../fresh/run_test.sh 6e33e834513a5cfee7dba6ca8cda9ab98f19d69b95c55f10bc00ee8a45a23f72
- hash ../fresh/tools/download.sh 8c5c8af73325e42b4dc42fc0b2ab8e9b36d00d1171b12a0b13da5e1198e73092
- hash ../fresh/tools/inventory.py 7dbb7c868fc994357113b7bda61e09964f605ed5b784cd6106e64df5ea7df0df
- hash ../fresh/tools/used_speakers.py 2a37f945cce4ba432368e49c675759808211b0b5cff1633551f37856f507944e
- hash ../fresh/tools/candidates.py 8af6a8562f2944ea10db10ec7dd10422d0737baefd6e197236dcd3bf6c9013e6
- hash ../fresh/tools/select.py 7bd70bdec4cae00406ddb3f8de13eb86f28fde33d0c3528bf2905b1fa2cbb1d0
- hash ../harness/check/log_full_devA_check.txt 951e5dc4ad20467a0c37724aa9f1f75f1339ad50d046ba6ba756dfeeec3a8965
- hash ../harness/check/log_full_devB_check.txt 0030bb79d8d9dc5436519b1ad451981a942acbe3315a7fd1cb9991d1ab9e25dc
- hash ../harness/check/log_impl_indep.txt c40e812e8d4e75bbac234cb743bd9c1bfa12edef1751af27ecd59ea7ec92ddd5
- hash ../harness/check/log_sampleA_indep.txt 6b0a099da8dd460bcbfcc000b7e8e5509ecd1b98ba98d16e757db7cde0ed4c7f
- hash ../harness/check/log_sampleB_indep.txt 4ba1e86213b7a0afaf35046fd4de6e411f6315c8c15f71f46d6383d974e7c053
- hash ../harness/check/log_verify_r1_A.txt 248e5269762a821dc8200ddb0689ba57798e07cc0d064edbf3f58e98c85dfb99
- hash ../harness/check/log_verify_r1_B.txt 47c4ad6f3e2b4158e50bb2f1e002b6891c884f39df4bcd3858abd1560b8fbb75
- hash ../harness/check/log_seed_diag.txt b6fdc7a417018784ab8e6ec170b8fdbd6039b7ce8fcc9503e0e612fc37d3bc1b
- hash ../../warning-late-panel/select/out/dev_0.jsonl 5af5bafdf1b6897d2d1bc9c60539e49ac2f0aa4442138521dc58ff40ccbb4e76
- hash ../../warning-late-panel/select/out/dev_1.jsonl 3850c8b4f66432120ab0c4468a7d78c9351bcc2bad1502dbb49a69212ce496ed
- hash ../../warning-late-panel/fresh/out/test_0.jsonl da9271d9ffb8be9e2476f7c574fe310a2aa34dd73e2c387ef125851f028939d8
- hash ../../warning-late-panel/fresh/out/test_1.jsonl f4527a789466bf5b309d1e7ac15172c7bf51bdad49e8bdd9fce06d6d0ee7f30f
- hash ../../warning-late-panel/select/out/rep_dev.json 626982a725bea0c30e2d8f3c5734513b97045880a225a284f0ecc32fc81f7d4e
- hash ../../warning-late-panel/fresh/out/rep_test.json 185ad8292bf424593723cc26fca5752992e9e400c4b5ec11e5eaf587961d4697
- hash ../../warning-late-panel/select/late_eval.py 74b4e221bc106713f13250d9504bb95c18cb007a4573ea3c8fda90f82b9cbb97
- hash ../../warning-late-panel/select/build_jobs_late.py 2bbbbc02a28c2c245ec3fc1a5693fb19b00e46ed062d0614c36f0416b64c9abd
- hash ../../warning-late-panel/select/interleave.py b9eebaf62b13add9ef3533923855f828d77c6b7a7704fe03c970e33fb14f9948
- hash ../../warning-late-panel/fresh/pool.json 377bab2ad33b3ab7a656bb63bc9a3fc4d58e7699750c31f77eb818031474a5a2
- hash ../../warning-male-fa-r2/select/pool.json 261a747077a4ce8b495417dff64aa560930e91c5007de0ac080232f274bde2a7
- hash ../../warning-male-fa-r2/select/pitch_only.mjs 28ed34cf17016552386bcab6e11b532c08ac1b48471fbd0194f340a2e0aae9f9
- hash ../../warning-male-fa-r2/select/tools/stratify.py d181dc59babf44d71726822a17d0631d01262830e31b501edcfa679d19954ed0
- hash ../../warning-male-fa-r2/harness/src-cue/src/ml/pitch-only-warning.js 5a7a5814f827c48d019b8bfe450de85ffb0855220c88e7e57440df4fc6c43a6a
- hash ../../warning-male-fa-r2/harness/session_app.mjs 190f021a5d6070b07b4d7ae22e494bc10a27acc3a567a26834dbd69eca45bbb9

Also fixed: the REPO module `C:/Coding Projects/Syrinx-cue/src/ml/pitch-only-warning.js` (cue-strip 4c81fea) sha256
2a1f4022db77599731cfcf6de4d42758d531239188bce20ddfdf991a868e658f (asserted by `replay_r2.mjs`); the chain clone
`../../warning-male-fa-r2/harness/src-cue` at cf76c58ffa21ae3eae3b66a7efa2b8e5a628b4e3 with a clean status.
````

## Appendix J. Late-panel study, round 2: choice (verbatim)

sha256 `17b948d9b2e00665c33b2a7db52a4e22b3031fc825846848b22cc44480816ef9` (of the file below, written by
`late_eval_r2.py dev` and logged outside the scratch folder at 2026-10-12 21:21:13 −05:00, before any fresh test-pool
file existed). The scratch file has CRLF line endings; the block below, with its lines ended CRLF (including the
last), hashes to this value.

````markdown
# Choice (late-panel study round 2, dev pools A and B)

Written by `late_eval_r2.py dev` before any fresh test-pool file (download, scan, pool, session) exists.

- PREREG.md sha256: `dd3cf7bc6c211f1bf576e6e27f04d9942826e382f791752c55de77c50d279785`
- dev_table.md sha256: `1f007c8592e4f2603446386ef39b90f53f0dcae11398e0e15aaf7a2b3f412035`
- dev_table.csv sha256: `9cad1032b7b385c09f6d383739539103faa5e75f773b8a285672303e7858b544`
- dev_bars.json sha256: `7ca2de7e0f5c562bce8506fa3ab3af95dd459089bc315619d2fb3f5ad82e9e46`

- **Chosen: `KS-Q5`** (passes every dev check on both dev pools; first by the PREREG §6 order)
- Candidates passing every dev check on both pools: KS-Q5, KS-F1
- Order (PREREG §6): KS-Q5, KS-F1, KH20-Q5, KO-F1, KO-Q5, KS-N
- Checks passed (of 60): KS-Q5 60, KS-F1 60, KH20-Q5 58, KO-Q5 56, KO-F1 56, KS-N 56

Dev checks of the chosen rule (failed checks listed per pool):

- devA: 30/30 passed; failed: none; pooled hits ≤ 10 s male base 0.846, female base 0.786; natural FA men 0.12 %, women 0.03 %; reader max men 3.06 % (mlsdu4396), women 0.84 % (ls7717).
- devB: 30/30 passed; failed: none; pooled hits ≤ 10 s male base 0.908, female base 0.802; natural FA men 0.37 %, women 0.00 %; reader max men 8.71 % (ls6276), women 0.21 % (mlsit13092).

Full dev tables: `dev_table.md` / `dev_table.csv`; bars: `dev_bars.json`.
````
