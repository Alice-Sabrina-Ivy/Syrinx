# "Likely heard as" panel — review round 2 fixes — 2026-10-07

Two reviews of branch `cue-strip` at e664eb9 (the one-axis panel and the
pitch-only-change warning) found problems in how the warning behaves around
brief panel hides, where it sits on screen, the notes beside it, the unsure
line, the best-guess mark, contrast, the warning's wording, a stale resonance
reading after a worker error, and in several documented figures. This note
records what was measured before each change, what changed, and what was not
changed.

Public data only: LibriSpeech test-clean / dev-clean (CC BY 4.0) and the
study's WORLD resyntheses of it, FDA, PTDB-TUG, the Hillenbrand & Clark 2009
concatenations, RB695 TTS stimuli, PICKA applied to LibriSpeech and the
Palette of Voices (CC BY 4.0) — the sets of `heard-as-pitch-only-warning-2026-10-07.md`
and `heard-as-cpu-2026-10-07.md`. No private recordings.

## 1. Summary

| Finding | Change | Evidence |
|---|---|---|
| Warning reset by every brief panel hide (7–24 % of shown estimates after a pitch-only shift lacked it) | Hidden-panel updates are neutral; > 5 in a row (~10 s) drop the run. **Post hoc, flagged** | §2 replay on the study's 469 sessions |
| Warning below the fold at 402×750, 360×690, 890×360 | Directly under the axis; at most one note | §3 built-app smoke |
| Conflict note stacked on the warning, fires on resonance-only change, asymmetric | Left out while the warning shows; keep / drop is a **user decision** | §3 |
| Unsure line "About 0–5 in 10" on most readings | Share at the best guess, nearest tenth; left out when "can't tell yet" | §4 measured before the change |
| "Middle guess" dot at the band's edge, most prominent mark | Small hollow ring, "single best guess" | §5 |
| Warning while "Can't tell yet" read as a contradiction; direction claim wrong for lowered women's voices 1 in 4 | Pre-registered direction-neutral wording | §6, warning note §4 |
| Live region mounted with its text | Always-mounted polite live region | §3 |
| Stale dimming and dimmed wide band below WCAG contrast | No dimming; "Older reading" text; wide band dashed at full contrast | §5 |
| Resonance worker "error" left a frozen snapshot driving the warning and the conflict note | "error" drops the snapshot like "overloaded" | unit test (wiring) |
| Fresh worst readers (21.4 % man / 10.3 % woman) unreported; run-to-run spread | Reported; start-offset replay | §7 |
| CPU note gave a non-pre-registered reason for rejecting 600 ms; contention figures | Corrected (guard 6); panel cost restated | `heard-as-cpu-2026-10-07.md` status block |
| K = 2 test figures not labelled post-selection; PTDB row on ~14 updates; "outside scope" sentence wrong | Corrected | warning note §3–§5 |

## 2. Warning through brief panel hides (post hoc)

**Problem.** `update()` treated a hidden-panel update (lnF0 null — "Keep
talking", "stale") as ineligible: the run and the warning were reset. With
K = 2 and a 2 s cadence, every time the panel came back it showed the
estimate the warning qualifies for ≥ 2 s without it. Review 1 measured in the
built app: of the shown estimates from shift + 10 s on, the warning was on
77–108 of 101–123 for a man and 102–103 of 110–118 for a woman (7–24 %
without it).

**Change.** A hidden update shows nothing and keeps the run; more than 5
hidden updates in a row (~10 s, `PITCH_ONLY_WARNING.maxHiddenUpdates`) drop
it. A shown update that fails the condition or is ineligible on the resonance
side (sustained, fill < 1, sinceResumeS < 2, no startU) still clears it.

**Replay before the change** on the study's features
(`rules.display(hold=True, max_hidden=5)`, K = 2, X 4 st, Y 0.6 u, P8):

| | Shipped (reset on hide) | Hold, reset after > 5 hidden | Hold, never reset |
|---|---|---|---|
| Shown estimates in failure sessions after shift + 10 s with the warning, male / female base | 0.909 / 0.918 | **0.947 / 0.955** | 0.947 / 0.961 |
| Worst female-base failure session | 0.33 | 0.53 | 0.53 |
| Hits ≤ 10 s, all data, M / F base | 0.89 / 0.85 | 0.89 / 0.85 | 0.89 / 0.85 |
| Natural false alarms W / M (all data; max per reader) | 0.7 / 0.5 % (7.1 / 6.6) | same | same |
| Expressive W / M | 1.9 / 2.1 % | same | same |
| Together from shift + 10 s W / M | 2.4 / 0 % | same | same |
| Resonance-only W / M | 1.1 / 0 % | same | same |
| Together flash in the first 10 s (sessions) | 0.09 | 0.09 | 0.09 |

Dev and test splits each pass all five pre-registered criteria unchanged.
The ~10 s reset was added so that a warning does not carry over a long pause;
it costs 0.006 of coverage on the female base. On the fresh dev-clean set
(§7) one reader changes (3081, a woman: 6 → 8 of 58 eligible updates).

**Tests.** `tests/ml/pitch-only-warning-test.js`: on → hidden → shown keeps
it; on → hidden → shown-but-failing clears it; 5 hidden updates keep the
run, 6 drop it; a resonance-side ineligible update still clears it. The golden
fixture's rule is now the shipped one (`hold: true, maxHidden: 5`) and gained
two pitch-only sessions with hides while the warning is on (hcs_260_PO man,
hcs_2961_PO woman), where the two rules differ; the module reproduces the
Python rule tick for tick on all ten sessions.

## 3. Placement, one note at a time, live region

**Problem.** The warning sat below the range, unsure and conflict lines; at
402×750, 360×690 and 890×360 the axis was on the first screen and the warning
below the fold or behind the bottom bar. The conflict note was on in almost
every warning sample for the man (82–120 of 82–120) and 31–44 of ~100 for the
woman. It also fired on 35–42 % of the woman's resonance-only readings
(17–20 % for the man) and on 15–20 % of an expressive natural man's readings
against 0 % for an expressive natural woman (study: natural false alarms
0.2 % women / 8.9 % men; fires on 64–66 % of resonance-only updates).

**Change.**
- The warning is the first line under the axis
  (`[data-heard-as-note="pitch-only"]`).
- While it shows, the conflict note and any `extraNote` are left out.
- An always-mounted, visually hidden `role="status"` polite, atomic region
  (`[data-heard-as-live]`) carries its text. The visible note has no role.
  The region keeps the text through a brief hide, so screen readers are not
  told again after every "Keep talking".

**Not changed: whether to keep the conflict note** at all. With the warning
carrying the pitch disclosure, the note's remaining effect is mostly the
asymmetric and resonance-only firing above. That is a product decision for
the user: drop it, or reword it so it does not suggest pitch is to blame when
only resonance moved.

**Built-app smoke** (`scripts/cue-strip-smoke.mjs --pitch-only=man,woman`,
LibriSpeech-based pitch-only stimuli; the warning's box at scrollTop 0 above
the fixed bottom bar): see §8.

## 4. The unsure line

**Problem.** The line showed the §1 unsure range [min(u(sLow), u(sHigh)),
u(peak)], where peak = 0.5 whenever the ±2.25-logit range straddles s = 0.5
(almost always), so its upper end was the model's maximum 0.42, rounded out to
5. Review 1: "About 0–5 in 10" on 57–100 % of shown readings for every voice,
including typical natural voices.

**Measured before the change** on the study's shown ticks (old line vs the
share at the best guess s rounded to the nearest tenth, left out while the
axis says "can't tell yet"):

| Shown ticks | Old line (top values) | New line |
|---|---|---|
| Natural readers, women (1 867) | 0–5: 88 %, 0–4: 10 % | about 1: 42 %, about 2: 41 %, left out: 15 %, about 3: 2 % |
| Natural readers, men (1 805) | 0–5: 57 %, 0–4: 35 %, 0–3: 8 % | about 1: 68 %, about 2: 18 %, fewer than 1: 8 %, left out: 6 % |
| Shift sessions, women base (13 268) | 0–5: 74 % | about 1: 41 %, left out: 29 %, about 2: 27 % |
| Shift sessions, men base (6 491) | 0–5: 74 % | about 1: 45 %, left out: 27 %, about 2: 23 % |

Typical voices now read "about 1 in 10" or "fewer than 1 in 10", which is
closer to the 2–5 % unsure shares published for natural voices than "0–5".
Women's natural voices read "about 2" more often than men's (41 % vs 18 %):
the model places typical women's voices nearer the middle than typical men's
(calibration note §6). That is an existing asymmetry of the estimate, not of
the wording, which is the same in every direction. The unsure model (k 0.42,
floor 0.02) is unchanged; only which number the line shows changed.
`tests/ml/heard-as-axis-test.js` checks that a typical voice (eta ±3.5) does
not read "up to 5 in 10" and that the line mirrors.

## 5. Best-guess mark, dimming and contrast

- **Ring.** The range is symmetric in logit, so on the share axis the
  best guess often sits near one end of the band (e.g. a woman's at 0.92–0.93
  in a 0.5–1.0 band). The white filled dot was the most prominent mark. It is
  now a small hollow ring (10 px, 2 px light-neutral border) called "single
  best guess" in the legend and "Best guess" in the screen-reader text.
- **No dimming.** An estimate more than 2 s old dimmed the whole block to
  opacity 0.5: text fell from 7.24:1 to 2.7:1 and the wide band's outline to
  1.47:1. Now nothing is dimmed. The legend line starts "Older reading —
  waiting for more speech ·". The "can't tell yet" band has a dashed outline
  at full contrast instead of opacity 0.45 (2.41:1).
- The smoke measures contrast in the built app: panel text ≥ 4.5:1, range
  outline and ring ≥ 3:1 (§8).

## 6. Wording

The warning now uses the pre-registered direction-neutral sentence:

> Your pitch has moved a lot more than your resonance since you started —
> this guess can be far off, in either direction, when only pitch changes.

There are two reasons:

- The direction claim "listeners usually heard less change" held pooled
  (83 %), but by base sex it held 18 / 18 for raised men's voices and only
  41 / 53 (77 %; Jebens 68 %) for lowered women's voices.
- About 80–90 % of the warning's built-app appearances came while the axis
  said "Can't tell yet", where "less change than this shows" read as a
  contradiction.

Details are in `heard-as-pitch-only-warning-2026-10-07.md` §4.

## 7. False alarms on fresh speech and their spread

Review 2 ran LibriSpeech dev-clean (20 women, 20 men, ~190 s each) and FDA
through the production-chain harness. Replayed through the module
(`scripts/heard-as/pitch-only/replay_module.mjs`):

| | e664eb9 module | With the hold (§2) |
|---|---|---|
| dev-clean women: reader-balanced / pooled / worst reader | 0.77 / 0.63 / 10.3 % | 0.94 / 0.76 / 13.8 % |
| dev-clean men | 1.07 / 1.18 / 21.4 % | 1.07 / 1.18 / 21.4 % |
| FDA rl / sb | 0 / 0 % | 0 / 0 % |

The worst readers are well above the study's worst (7.1 % W / 6.6 % M). The
reason is that P0 comes from one ~15 s start window. To measure the spread,
four expressive readers were run through the production chain
(`session.mjs`, branch head chain) five times. Each run started later by
skipping the reader's first 0, 1, 2, 3 or 5 utterances:

| Reader | Warning share by start (0 / 1 / 2 / 3 / 5 skipped) | P0 vs session median |
|---|---|---|
| test-clean 672 (man) | 6.6 / 9.6 / 23.5 / 61.3 / 45.5 % | −2.8 … +1.8 st |
| dev-clean 251 (man) | 21.4 / 4.9 / 12.5 / 18.2 / 10.3 % | −1.6 … +3.4 st |
| dev-clean 3081 (woman) | 13.8 / 0 / 11.5 / 33.3 / 0 % | −1.7 … +3.5 st |
| test-clean 3575 (woman) | 0 / 0 / 0 / 0 / 0 % | −0.3 st |

For a lively, wide-ranging speaker of either sex, the warning can show on a
large share of ordinary speech. How large depends on where the session
started. The hold (§2) changes none of these figures except reader 3081's
(skip 0: 10.3 → 13.8 %; skip 2: 7.7 → 11.5 %; skip 3: 25.0 → 33.3 %).

A steadier start reference would address this, for example a longer window
or no warning when the start window's own pitch spread is wide. It needs its
own pre-registered study, with a fresh held-out set, because dev-clean has
now been looked at. **That is a decision for the user.** It was not done
here.

## 8. Built-app smoke

`npm run build`, then `node scripts/cue-strip-smoke.mjs --viewport=<vp>
[--pitch-only=man,woman]` at 448×890, 402×750, 360×690, 890×360 and
1280×800.

Pitch-only stimuli (LibriSpeech-based H&C sentence proxies: a man raised,
a woman lowered, ~58 s of natural speech before the shift):

| Viewport | Checks | Warning after the shift (man / woman) | Warning box at scrollTop 0 (top–bottom vs first-screen limit) | Shown samples in the next 20 s carrying it |
|---|---|---|---|---|
| 448×890 | 90 / 90¹ | 6.1 / 7.7 s | 649–679 / 890: on screen | 76 / 76, 77 / 77 |
| 402×750 | 90 / 90 | 6.2 / 7.8 s | 613–658 / 750: on screen (was behind the bottom bar) | 76 / 76 both |
| 360×690 | 90 / 90 | 6.4 / 7.7 s | 641–686 / 690: on screen (was below the fold) | 76 / 76 both |
| 890×360 | 90 / 90 | 6.4 / 7.4 s | 375–390 / 360: below the fold, as is the whole panel and its axis (unchanged; trace and strip fill the first screen) | 76 / 76 both |
| 1280×800 | 90 / 90 | 6.3 / 7.7 s | 532–562 / 800: on screen | 76 / 76 both |

Every run: never shown before the shift; directly under the axis; the only
note while on; the live region carries the same words; no horizontal
overflow; no page errors. All 76–77 shown samples per run came while the axis
said "Can't tell yet" — the case the neutral wording (§6) is for.

Contrast in the built app (every viewport, woman / man / both pitch-only
runs): the lowest panel text 7.26:1, the range outline 7.26:1 (dashed or
solid), the best-guess ring 14.9:1 (was text 2.7:1 and band outline 1.47:1
in the stale state).

¹ The first phone and desktop runs (with two smoke runs loading the machine)
failed one check: "panel off → gender worker gone" read 1 worker 0.5 s after
switching off. Puppeteer drops a terminated worker's target asynchronously,
so the check now waits up to 3 s. It passed on the re-runs at every viewport,
and review 2's 9.3-minute soak saw 6 / 6 workers terminated. The worker
lifecycle code is unchanged.

## 9. Not changed, and why

- **The brief false warning right after a pitch-and-resonance change**
  (review 1: man 260, 1–4 s in 3 of 5 runs). The suggested gate (count an
  update only once the resonance readout has caught up) needs its own check
  on the together set. It was not tried. It is listed as a limit in the
  warning note §7.
- **A steadier start reference** (§7) is a user decision.
- **Shortening the always-visible caveat**, suggested as optional so that
  more fits on the first screen. The user asked to keep the caveat. Putting
  the warning under the axis already brings it onto the first screen.
- **The conflict note's future** (§3) is a user decision.
