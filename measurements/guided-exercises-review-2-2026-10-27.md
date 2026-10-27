# Guided exercises — review of the seven ideas + R4 fix (2026-10-27, second pass)

Scope: branch `guided-exercises`, commits 1dc298a..826cba9 (`git diff 0e1256f..826cba9`): take notes, P5's unjudged glide cards / steadiness / counter, the "Test your ear" cards, R4's try pitch, the line drawings, W1's hold timer and counters, P6's phrases one at a time, and R4's rebuild-vs-version fix. Settled items were not reopened (no time-in-band figure, the take-voice check stays unbuilt, lesson list only, no scores / tallies / streaks).

Method: five independent reviewers, each reading the code directly — (1) correctness and lifecycle, (2) voice-teaching content and safety incl. the rendered drawings, (3) accessibility and phone layout (own Puppeteer probe at 360×690 / 448×890 incl. forced colours), (4) measurement integrity, (5) tests (mutations on a scratch copy). The lifecycle findings went to a separate skeptical verifier, which tried to refute each one from the code; the accessibility findings were confirmed by measurement in the browser (and re-measured after the fix); content findings were judged against the rendered PNGs and the card text. Not reviewed by a voice teacher or SLP (none available).

## Findings and verdicts

### Correctness and lifecycle

| # | Finding | Verdict | Action |
|---|---|---|---|
| C1 | R4's recording pitch was counted by a frame log owned by the record card (`HearRecord`'s effect). A tab switch unmounts the view while Voice Shaper keeps recording, so "Your recording: about N Hz" came from a fragment (or "not enough voice"), and a return mid-recording overwrote it with the remainder. | CONFIRMED (verifier: App.jsx renders the tab only while active; only `setCard` / Stop / mic-off stop the controller) | Fixed: `trackHearVoice(hear)` subscribes when the wrapper is made in `openLesson`, installs the tap on "recording" and stores the stats when the phase leaves it; a tap whose wrapper was disposed removes itself. |
| C2 | R4's ear test after a goal change on that card (feminine ↔ masculine): the new round needs a changed version the wrapper was never asked for (`setShifts` only in `HearVersions`), so "Preparing…" for ever. | CONFIRMED | Fixed: `GuessCard` calls `hear.setShifts(hearShifts(direction))`; dropping a round also stops playback. |
| C3 | A guess round outlived the recordings it was made from: re-recording R3's take or R4's recording kept `played: [true, true]` / the pick, so the answers opened (or the old reveal showed) for audio not yet heard. | CONFIRMED | Fixed: a round carries `src` (R3: the two take objects; R4: the rebuild); a changed recording drops it and a new round starts. |
| C4 | In R3 a goal change to / from androgynous shifts card indexes and `setCard` stops a take being recorded; `ui` keys are index-based. | PLAUSIBLE, pre-existing behaviour, harmless (one key per name per lesson) | Left. |
| — | Hold timer (double count, unmount, tab switch), rep counters / phrase index in `session.ui`, A/B order made outside render, no playback while a take records, take-tap ownership, R4 rebuild / versions after re-recording, PitchTrace `judge` default | Checked, fine | — |

### Content and safety

| # | Finding | Verdict | Action |
|---|---|---|---|
| T1 | The `dark` drawing moved the tongue root ~10 units toward the back wall (a third of the throat), i.e. the pulled-back, constricted "dark" the card warns against ("Don't pull it back"); caption "further back". | CONFIRMED (rendered) | Fixed: root stays where it was, the body and front drop; caption "Dark: tongue lower and relaxed, lips slightly rounded."; alt text says the back of the throat is as open as before. |
| T2 | The `bright` drawing pressed the tongue against the whole hard palate with its tip on the upper teeth; text says "a little" and "behind the lower front teeth". | CONFIRMED (rendered) | Fixed: an air channel under the palate, tip behind the lower tooth; caption "a little higher and forward". |
| T3 | R3's reveal ("A was your bright take") states as fact what was only intended. | CONFIRMED (design §12: intent, not measurement) | Fixed: "A was the take you meant as bright, B the one you meant as dark. The app doesn't measure which one sounds brighter: your ear decides." |
| T4 | Effort: R3 hint "make the difference bigger", troubleshooting "exaggerate both a lot". | Accepted as plausible wording risk | Fixed: "a clearer difference that still feels easy, and keep the pitch the same"; "make both clearer, as far as stays easy". |
| T5 | R4 masculine asked "which sounds brighter" for unchanged vs darker. | Accepted | Fixed: the question asks "darker" when the round's changed version is darker; the answer is always the changed version (`askedWord`, `answerIndex`, `revealLines` in guess.js); the "all" text says "answer the question under them". |
| T6 | P5 steadiness "smaller is steadier" makes a number to beat. | Accepted | Fixed: "It's information, not a goal: a little movement is normal." |
| T7 | W1's timer counted "Hum" though the step is an "oo"; the 5 s ring invites filling it. | Accepted | Fixed: label "Sound"; "3 seconds is plenty. It stops by itself at 5." (The card title "Hum through the straw" predates this round; left.) |
| T8 | Captions vs drawings: lip buzz caption omitted the drawn fingertips; swallow caption showed only the rise; R2 captions named a vocal tract not drawn. | Accepted | Fixed captions. |
| T9 | R4's try pitch in raw Hz has no sense of scale. | PLAUSIBLE | Left: a line on "how many Hz is normal" would be a new, unmeasured claim; for the owner. |
| T10 | Nits: R4 reveal's "10 %" may read as a magnitude to hit; fingertips drawn at the jawline. | Nit | Left. |

### Accessibility and layout

| # | Finding | Verdict | Action |
|---|---|---|---|
| A1 | Forced colours: SVG strokes kept neutral-300 / purple-300 (≈ 1.5:1 on a light high-contrast theme); the comment claimed otherwise. | CONFIRMED (computed style under emulated forced colours) | Fixed: `forced-colors:text-[CanvasText]` (ghost: `GrayText`) on the drawing parts and the timer ring; re-measured: black on white. |
| A2 | Focus lost after picking an answer (the focused button becomes disabled) and after "Mix them up again" (the button goes away). | CONFIRMED (activeElement = BODY) | Fixed: focus moves to "Mix them up again" after a pick, to Play A after a new round; re-measured. |
| A3 | A / B buttons 36 × 44 px. | CONFIRMED | Fixed: `min-w-11` on the exercises' buttons. |
| A4 | "Play both first." not tied to the disabled answers. | Nit | Fixed: `aria-describedby` on the fieldset. |
| A5 | P6 at 360 × 690: the text scroller shows about one line under the phrase box and trace (passes the 120 px floor). | CONFIRMED, low | Left: a layout change on the phone; worth a look in the phone check. |
| A6 | P5's steadiness "i" (the existing inline variant) has a ~30 px hit area. | CONFIRMED, low, existing component | Left (shared with the Pitch tab). |
| A7 | Drawings read twice (alt + caption). | Nit | Left. |
| — | Live regions (one per change, none per tick), accessible names, judge-off neutral colours, no horizontal scroll, contrast | Checked, fine | — |

### Measurement integrity

- Pre-registration hash: sha256 of the note before "## 2. Results" = `b0cd95bcc225d7748ca3f614cb11c29d7ac10a0233c5edf52b88810ea4ffb479` (matches); `git diff 1dc298a 826cba9` on the note touches only the results placeholder.
- STOP applied as written (summarize.mjs encodes the candidates, bars and step-down; the "no candidate passes the selection set" case → STOP is disclosed as D2; the ungated count and the "without one reader" figures stay reported only).
- App constants match §2.12 (`TRY_PITCH_MIN_S` 1.0, `DEFAULT_MIN_S` 1.0, R4 try `minS: 3`, no voice note). The harness drives the real pitch worker + FireRedVAD, DSP worker and hook with the real bridge tap; `createTakeVoiceLog` counts exactly the harness's `b` / median.
- Low: the count window is the recorder's, and the same rule on "Hear it first"'s recording was not part of the measurement — now said in takeChecks.js's comment. No private data found.

### Tests

Mutations that survived and are now caught: the median test (middle values both 202: no-sort and upper-middle survived → an even count with distinct, unsorted middle values and an odd count); `<` → `<=` on the take minimum (boundary cases); ignoring `frame.voiced` (an unvoiced frame with f0); verdict words in UI strings ("correct", "well done", "on target" added to the ban); unresolved `{placeholders}` in UI strings (now checked); the reveal lines (now a pure `revealLines`, tested for both orders and both directions; the smoke checks the reveal against `data-guess-order`); PitchTrace's `judge` default (new `tests/exercises/trace-judge-test.js` — a source check; flipping the default or the line's judged target fails it). Left: hear.js's rebuild-without-analysis guard; injecting `rand` for the order; the drawings test can't tell swapped drawings apart (the preview PNGs do).

## Checks

- `npm run lint`, `npm run test:unit`, `npm run build`: pass.
- Browser: `node scripts/voice-preview-smoke-wavs.mjs && node scripts/exercises-smoke.mjs` with Chromium 1243 (`--no-sandbox` wrapper: the VM runs as root): **258 passed, 1 failed**. The failure is the 320 px tab-bar check (five tabs; right edge 320.8 px, 0.8 px over) — it fails identically on the unchanged base 826cba9 in this VM (font metrics), App.jsx's tab bar is outside this round. The smoke's `taskkill` cleanup does nothing on Linux; `browser.close()` closed its Chrome.
- Accessibility probe (360 / 448): forced-colour stroke colours = system text colour; focus after a pick on "Mix them up again".
