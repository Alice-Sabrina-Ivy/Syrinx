# Guided exercises — independent review and fix pass (2026-10-27)

Branch `guided-exercises`, reviewed at 59e4b39 (based on main 9e1696b). A scheduled pass with no one watching live. Five reviewer subagents each read the code or text directly through one lens: correctness, voice-teaching content and safety, accessibility and phone layout, data, and test quality. Two skeptical verifier subagents then tried to refute every code finding from the code. Code fixes were made only for CONFIRMED findings. Content and safety wording was changed where the issue was clearly plausible. No voice teacher or SLP was involved: the content review is a model reading the text as a careful SLP would, not a professional review.

No hard-rule-3 module was touched.

## Commits

| Commit | What |
|---|---|
| b95e3cd | Safer lesson wording (lessons.js) |
| 32a9288 | Voice Shaper: one posted-pitch tap per controller (bridge.js, controller.js, new `tests/voice-preview/pitch-taps-test.js`) |
| 75812a0 | Import cleans exercise rows and keeps links to skipped sessions; Delete all data in one transaction |
| 4b7cb05 | Exercises lifecycle and screen-reader fixes; tests and smoke checks |
| (this commit) | Design §5 / §7 / §12, the CLAUDE.md row, this report |

## Findings

Verdicts come from the verifier pass. "Fixed" means fixed in this pass.

### Correctness and lifecycle

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| C1 | Voice Shaper's posted-pitch tap was a single slot, and every controller's `removeTap()` cleared it unconditionally (also on `dispose()` without ever recording). Closing or reopening R4 while the Voice Shaper tab was recording or analysing cut that recording's pitch off ("no-voice" or a truncated F0 track). The reverse also happened: R4 recording overwrote the tab's tap. | CONFIRMED | Fixed. The bridge keeps a set of taps (`addVoicePreviewPitchTap` returns a remover). Each controller removes only its own. `setVoicePreviewPitchTap` keeps its old meaning (replace all). The new test fails on the old controller (3 checks) and passes now. |
| C2 | P6's result was computed once. After Back → more speech or "Start this step over" → Next, the result card showed and kept the stale result. | CONFIRMED | Fixed. On re-entry, if the logged frame count changed, the result is computed again and the row's `results` / `endedAt` updated. |
| C3 | A feel answered while the row's `add` was still pending was lost if the lesson closed before the add resolved. | CONFIRMED (a window of a few ms) | Fixed. The answer is kept per run (`pendingFeel`) and written once the row has an id, even after the lesson closed. |
| C4 | Leaving R4's "Record your usual voice" card didn't stop its recording: it ran on to 8 s and analysed off screen. | CONFIRMED | Fixed. `session.setCard` stops a "Hear it first" recording, as Stop does. |
| C5 | No `pagehide` cleanup: R4's worker (WebAssembly memory), the takes and the player's AudioContext lived on (Voice Shaper's card does clean up). | CONFIRMED | Fixed. `pagehide` closes the open lesson. |
| C6 | `s.card` is an index into `cardsFor(lesson, direction)`. Changing the goal mid-R3 (androgynous-only "In between" card) jumped to a different card. | CONFIRMED | Fixed. LessonPlayer maps the current card to its new index when the card list changes. |
| C7 | R4's Record button wasn't disabled during the controller's 1 s re-arm; presses were silently ignored. | CONFIRMED | Fixed. `hear.js` passes `rearming` and the button is disabled. |
| C8 | `UI.countMicOff` was never used: P6 with the mic never on said "There wasn't enough voice…". | CONFIRMED | Fixed. Shown when no frame was logged. |

Verified correct (no change):
- **Result row:** saved once, also under StrictMode. The module-level `saving` guard and the `rowId` check cover it.
- **Frame tap:** removed on card, tab and lesson change.
- **Take recorder:** disconnects its port on every end path, including the mic stopping.
- **R4 import race:** handled.
- **App.jsx idle / running branches:** only remount the view; the state lives outside React.

### Voice-teaching content and safety (lessons.js)

All fixed as wording changes:
- **R1 (masculine), Buckley et al. 2020.** The line stated "lowered the voice box … faded three days later … it takes repetition". The paper estimates larynx position from the acoustics, and the follow-up claim couldn't be checked from here. Now: one published case study followed one transmasculine speaker through a voice session; change comes from gentle practice repeated over weeks.
- **R3 (feminine), Carew, Dacakis & Oates 2007.** "Most of them were rated more feminine" was not verified per person. Now: their resonance measured brighter and, on average, listeners heard their voices as more feminine. Design §5 and §7 carry the same correction, and the Kawitzky line in §5 is marked "check against the paper before quoting".
- **W1, Titze 2006.** The citation is now attached to the mechanism, not to "teachers use it".
- **W1, "hum through the straw".** Humming implies a closed mouth and nasal airflow, which contradicted the nose-pinch check. Now: an easy "oo" into the straw, and the lip buzz on "an easy voiced sound".
- **W2.** The sigh fades before it creaks: "You don't need to reach the bottom of your voice." This matters most for masculine users.
- **Resonance safety before the steps.** `RESONANCE_SAFETY` was only on the aim cards. It is now also on R3's and R4's "Get ready" safety box. R2 adds "Let the voice box move on its own: never push it down or squeeze it up." and "Sip some water afterwards" after the panting.
- **R3, Dark step.** "Don't pull it back" (tongue). Pulling the tongue back narrows the throat.
- **R2.** The little-dog whisper "sounds smaller and brighter" (was "higher"). The feminine aim adds: if your throat feels squeezed, or as if you're about to swallow, let it go.
- **S1.** Adds urgent signs: see a doctor soon for sudden voice loss, painful swallowing, coughing up blood or hard breathing. Adds "swallow or sip instead of clearing your throat" and "skip practice with a cold or sore throat".
- **Strained reply.** Now adds "If it hurts, or you're hoarse for weeks, see a doctor."
- **P5, "Land on a word".** Adds "If the note feels like work, land a little short of the band."
- **R1.** "Other lessons work on moving them separately" overpromised. Now: the resonance lessons work on the size of the sound without changing the pitch.
- **P6 (androgynous).** "A result around 60–70 % is normal" read as a pass mark. Now: "so don't expect a high share here". The two-thirds disclosure stays.

Checked and fine:
- None of the masculine text asks for pressing down, vocal fry, chin tucking, or a pitch lower than comfortable.
- Every voice lesson has the standard safety line before its steps.
- No verdict, score, streak or gender-verdict words appear.

### Accessibility and phone layout

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| A1 | Closing a lesson dropped focus to `<body>`. | CONFIRMED | Fixed: focus goes to that lesson's row, once. |
| A2 | R4: the focused Stop button unmounted when analysis began. | CONFIRMED | Fixed: a disabled Record again button stays in its place while analysing. |
| A3 | The recording counters were `aria-live` and announced every second. | CONFIRMED | Fixed: one `role="status"` per recorder, changed once per state ("Recording", "Recorded, 5.2 s", the error or analysing text). |
| A4 | Live regions mounted together with their text may not announce. | PLAUSIBLE | Covered by A3's always-mounted status in R4. HearVersions' "Preparing…" line was left as is. |
| A5 | Two takes' buttons were both named "Record". | CONFIRMED | Fixed: "Record: Big dog" / "Stop recording: …" / "Record again: …" on cards with several takes. |
| A6 | Primary hover `purple-500` with white text is about 4.1:1. | CONFIRMED | Fixed: hover `purple-700`. |
| A7 | The "←" in "← Lessons" was read aloud. | CONFIRMED | Fixed: `aria-hidden`. |
| A8 | The card nav landmark was named with the lesson title. | CONFIRMED (judgement) | Fixed: "Lesson steps". |

Left as is:
- The card position ("2 of 6") is not tied to the heading.
- The feel answers are toggles rather than a radio group (usable as is).
- The tab buttons are about 28 px tall: they pass WCAG 2.5.8 but not the 44 px used elsewhere. Pre-existing, and it would move the header.
- A focused Play button is disabled when a session recording starts (rare).

Checked fine:
- Text contrast is ≥ 4.5:1 everywhere (no neutral-500 text).
- Forced colours: real borders, and the pressed state maps to Highlight.
- Touch targets ≥ 44 px.
- Focus moves to the heading on card change.

### Data

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| D1 | A result whose session was skipped as already present got `sessionId: null` although the local session exists. | CONFIRMED | Fixed: optional `store.localSessionId(startedAt)`; DataManagement looks it up by the `startedAt` index. Frames of skipped sessions are still dropped. |
| D2 | Imported rows were stored without normalisation (e.g. `levelHz: "abc"` showed NaN in "Last time"). | CONFIRMED | Fixed: `cleanImportedResult` keeps only the saved fields, with defaults for malformed values. |
| D3 | `results.js` duplicated the import's key and validator (only tests used the copies). | CONFIRMED | Fixed: it reuses `exportFormat.js`'s. |
| D4 | A session without an id set `idMap[undefined]`, and results or frames without a `sessionId` then attached to it. | CONFIRMED (hand-made files only) | Fixed. |
| D5 | The lesson list's "Last done" didn't refresh after Import or Delete all data. | CONFIRMED | Fixed: it listens to `syrinx:data-changed`. |
| D6 | Delete all data ran four separate clears. | CONFIRMED | Fixed: one `rw` transaction. |
| D7 | Deleting a session in History leaves `exerciseResults.sessionId` pointing at it. | Not verified | Left. IndexedDB never reuses keys, and import nulls the link. |
| D8 | `endedAt` meant "result reached" or "feel answered" depending on timing. | Low | Now both paths set it when the feel is written. |

Checked fine:
- No audio, blobs or typed arrays are stored.
- Older files without `exerciseResults` import unchanged.
- The import transaction includes the table.
- The dedupe key `exerciseId@startedAt` is sound.

### Tests

Confirmed real: the frame-tap hook test (mutations to the bridge's try/catch or the hook's `hasExerciseFrameTap` branch fail it), the safety-line text check, and the import remap.

Vacuous or weak checks, fixed or noted:
- **Safety check gated on `usesVoice`.** Setting P5 `usesVoice: false` hid it from the check. Fixed: a new check that every lesson with a live, record or hear card is marked `usesVoice`.
- **Safety box on screen.** Disabling it in the view passed every test. Fixed: the smoke now requires the safety box on some card of every voice lesson, in every direction and viewport.
- **"Saved." in the smoke** came from page state, not the database. Fixed: the smoke reads IndexedDB. One row with its feel and a numeric level and exactly the saved keys (no audio) after run 1; exactly two rows after run 2, the second strained. This would catch a double save.
- **The tap moving with the card.** Not tested before. Fixed (smoke): "Short phrases" starts its own count at 0 and grows.
- **R4 recording on card change.** New unit test.
- **Two controllers sharing the pitch tap.** New test.
- **Import cases.** New tests for the skipped-session remap, cleaned rows and a session without an id.

Left (noted, not changed):
- `frame-tap-hook-test.js`'s "no tap installed" check is trivially true: the test removes the tap itself. The app's removal is now covered by the smoke.
- `results-test.js` compares `countResult` with the function it calls. Only its 60–68 % range check is independent.
- The smoke's level-line check also accepts "—".
- The "no literal text" scan in `lessons-test.js` misses JSX text that wraps across lines.

## Not fixed, needs the owner or other work

- **Bundle budget.** `scripts/voice-preview/bundle-budget.mjs` fails "entry chunk + static imports + entry stylesheet grow ≤ 1.0 KB". This is pre-existing: at 59e4b39 it is already +5.7 KB against its `UI_BASELINE` base (70bab92, the 2026-10-25 UI), so this budget compares against a base older than the branch. This pass adds +321 B JS and +18 B CSS to the entry (the tap set, the import cleanup and the transaction). Whether to re-base the budget or accept the growth is the owner's call.
- **Tab bar at 320 px.** In this VM the five tabs overflow by 0.8 px (right edge 320.8 vs 320). The check fails identically at 59e4b39, so it comes from this Linux VM's fonts, not from this pass. 320 px is below the portrait targets (360 / 448). A real-phone check would settle it.
- **Citations.** The Buckley follow-up interval and the Carew per-person listener results should be checked against the papers before any line quotes them more specifically.
- **Phone check** of the Exercises tab: still not done.

## Check results (head of this pass)

- `npm run lint`: clean.
- `npm run test:unit`: 81 / 81 scripts passed (incl. the new `pitch-taps-test.js`).
- `npm run build`: OK.
- `node scripts/voice-preview-smoke-wavs.mjs && node scripts/exercises-smoke.mjs --chrome=<Chrome for Testing, chromium-1243, through a `--no-sandbox` wrapper since the VM runs as root>`: 234 passed, 1 failed. The failure is the 320 px tab-bar check above, which fails the same way at 59e4b39. All new smoke checks pass: saved rows read from IndexedDB, the tap moving with the card (0 → 1.4 s), the safety box shown.
