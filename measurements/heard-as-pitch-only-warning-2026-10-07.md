# "Likely heard as": a live warning when pitch moved without resonance — 2026-10-07

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
- its result (a rule **passes**);
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
  the start reference exists when the panel is turned on later.
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
