# Guided exercises: design draft

**Status (2026-10-26): the owner answered the questions (§11), and the first version is built on branch `guided-exercises`: the eight items that need no new measurement (S1, W1 without its live trace, W2, P5, P6, R1–R4) in a new Exercises tab. §12 lists what the build changed from this draft.** The roadmap entry is [ROADMAP.md](../ROADMAP.md) ("Next: guided exercises").

This draft proposes a first version: how a lesson is laid out, which lessons come first, how each training direction is handled, what the app shows during each lesson and what it saves. Two lessons are written out in full (§7) so the tone can be judged before the rest is written.

## 1. What the first version is

Short lessons that explain one physical change (where the tongue sits, the shape of the lips, the height of the voice box, where the pitch sits), then let the user practise it with the cues Syrinx already has. The lessons are grouped by skill, and there is an optional ~10-minute routine for the day.

The first version covers **pitch and resonance only**. Weight, intonation and ear training come later (§10), because Syrinx can't measure weight and intonation needs its own measurement pass first.

## 2. Rules every lesson follows

1. **Comfort first.** Every lesson has a safety line, and the app never asks for more range, length or effort than the user's own comfortable range (§6).
2. **Compared with yourself.** Results describe this try against the user's own earlier tries ("about 1 semitone higher than last time"). There are no pass marks, scores, streaks or gender words.
3. **Say what was measured, and what wasn't.** If a take was too quiet, too noisy, too short or phone-quality, the lesson says so before it shows anything. If something can't be measured (weight, whispering, a held vowel's resonance), the lesson is done by ear and says so.
4. **Short takes.** Holds are at most 8 s and readings at most 30 s. The voice gate can blank parts of long held notes, and the tonal-noise notch can notch notes held for 20 s or more (CLAUDE.md "Current state").
5. **Resonance needs phrases.** The resonance cue drops held vowels and takes a few seconds to follow a change ([resonance-cue-production-path-2026-10-07.md](../measurements/resonance-cue-production-path-2026-10-07.md), [resonance-faster-2026-10-26.md](../measurements/resonance-faster-2026-10-26.md)). Resonance lessons use whole sentences, read and then reviewed ("speak, then see where it landed"), never a live game on a held vowel.
6. **The app doesn't listen while it makes sound.** Echo cancellation is off in the capture path (`useAudioPipeline.js`), so a note played by the app through the speaker would be read as the user's voice. A lesson that plays a note plays it first and only then listens.
7. **Every direction gets its own aim.** Each lesson has one core text plus direction lines wherever the aim differs (§5). "Just exploring" never gets a target.
8. **Our own words.** All lesson text is written for Syrinx. The exercises are well-known, published or widely taught ones, cited where there is a source. The reading passages are written for Syrinx too.

## 3. How a lesson is laid out

A lesson is a short stack of cards, one idea per card, with Back and Next:

1. **What it's for.** One line.
2. **Why it works.** Two to four plain sentences about the mechanism, with a source where there is one.
3. **Get ready.** Posture and body setup, for example a hand on the throat, jaw loose, or the tongue tip behind the bottom teeth.
4. **Steps.** One physical action per card, often as a contrast pair (bright then dark, higher then easy) so the user can feel the difference. Cards that need the microphone show the live view (§8) under the instruction.
5. **What you're aiming for.** How it should feel and sound, and what to do if it isn't working.
6. **Safety.** The standard line ("Stop if it hurts, scratches or makes you want to cough. If it's work, make it smaller.") plus any line specific to the exercise.
7. **Result.** What the app measured, if anything, compared with the user's earlier tries, then one question: "How did that feel? Easy / Some effort / Strained."

A **Strained** answer changes what comes next: the lesson suggests stopping for today and offers only the cool-down. It never says "try harder".

## 4. The lessons

Fifteen items: a safety introduction, a warm-up and a cool-down, six pitch lessons, five resonance lessons and one that combines them. "Needs" lists the measurement or code that has to come first (§9).

| # | Lesson | What you do | What the app shows | Result and what's saved | Needs |
|---|---|---|---|---|---|
| S1 | **How to practise safely** | Read once before the first lesson; reachable at any time | — | Seen (once) | — |
| W1 | **Warm-up: straw or lip buzz** | Hum through a straw, or do lip trills, sliding gently up and down for ~30 s | Pitch trace | Done | M2 |
| W2 | **Cool-down: sighs** | Gentle sighs from high to low, then a minute of quiet | Pitch trace | Done | — |
| P1 | **Find your easy note** | A relaxed "mm-hmm" five times | Trace and Hz / note | Easy note (median Hz), spread of the five tries | M2 |
| P2 | **Explore your range** | Gentle slides on "ng" or "oo", bottom to top and back, three times | Full-height trace | Comfortable low and high (5th / 95th percentile, Hz) | M2 |
| P3 | **Hold one note** | Three 5 s holds on the easy note, then three on a note toward your direction | Trace and steadiness (±st) | Steadiness and pitch per hold | M2 |
| P4 | **Match a note** | The app plays a short note, then you hum it for 3 s; five notes | Trace with the note's line | How far off each note was, in semitones | M2, M3 |
| P5 | **Glide to your target** | Slide on "ng" from the easy note into the target band and back, then the same on "mm-hmm" | Trace with the target band | Done | — |
| P6 | **Count on your target** | Count to ten, then say five short phrases, in the target band | Trace with the band, pitch level | Median pitch level, share of voiced time in the band | — |
| R1 | **Find your voice box** | Fingers lightly on the throat: swallow (it rises), yawn (it drops), then pant slowly | — (body only) | Done | — |
| R2 | **Big dog, little dog** | Pant with the tongue out like a big dog, then a small dog; whisper "ha" in each and hear the difference | — (whispers can't be measured); optional record and play back | Done | — |
| R3 | **Tongue and lips** | The same sentence twice: tongue forward and lips slightly spread, then tongue back and lips slightly rounded; record both | Recorder with A/B playback | Done | — |
| R4 | **Hear it first** | Record a phrase, hear it with only the resonance moved toward your direction (Voice Shaper), then imitate it and compare | Recorder, the shifted version, A/B / C playback | Done, and the shift used | — |
| R5 | **Two readings** | Read a short passage in your usual voice, then again with the change; then keep it for 30 s of counting or talking | Resonance and pitch of each reading, side by side | Each reading's resonance (u) and pitch level (Hz) | M1 |
| T1 | **Together** | Short phrases with both the pitch and the resonance change | Cue strip (both rows), then each phrase against your usual reading | Each take's resonance and pitch level | M1 |

The order is a suggestion, not a lock: S1 first, then any lesson. The pitch lessons suggest P1 before P3–P6, because those lessons pick their notes from the easy note.

### Notes on single lessons

- **W1 (warm-up):** humming through a straw and lip trills are semi-occluded vocal tract exercises, a standard gentle warm-up (Titze 2006). The trace may break up during lip trills; the lesson says that's expected.
- **P1 (easy note):** a relaxed "mm-hmm" is a common way voice teachers find a comfortable starting pitch. The result is the median posted pitch over the five tries, plus the spread between them in semitones. If the spread is more than ~3 semitones, the lesson suggests a few more, lazier tries. Someone on testosterone will see their easy note move over months, so the lesson suggests repeating it now and then.
- **P2 (range):** the trace has no data above 400 Hz (the app treats pitch above 400 Hz as unvoiced), so high slides show a gap there. The lesson says this up front: the top of a higher voice's range is cut off, which is expected. The low and high results are the 5th and 95th percentiles of the voiced pitch, so a single cracked or creaky frame doesn't set them. These results also bound the notes that P3–P6 choose (§6).
- **P3 (hold):** steadiness is the existing readout (1 s standard deviation, in semitones). It is fast and precise on held notes ([steadiness-readout-2026-10-04.md](../measurements/steadiness-readout-2026-10-04.md)). Vibrato counts as movement, and the lesson says so. There is no "steady enough" mark; the result is compared with the user's earlier holds.
- **P4 (match):** the app plays a 1 s tone, waits until it has finished plus the 400 ms pitch hold, then listens. Headphones are optional. Accuracy is the median of the posted pitch over the hum, compared with the note, in semitones; the pitch chain is far more precise than that needs ([pitch-precision-steadiness-2026-10-04.md](../measurements/pitch-precision-steadiness-2026-10-04.md)).
- **P6 (count):** this is the Dashboard's pitch level and target band, so the result uses the same rule as session statistics (only the band counts as on target). For "androgynous" the band is narrow: a speaker centred in it still reads on target only about 69 % of the time (CLAUDE.md "Training direction", open item). The lesson says this, so a reading of 60–70 % in band isn't read as failing.
- **R1–R3 (body and ear):** none of these can be measured. Panting and whispering aren't voiced, and a single short sentence is too short for the resonance cue. They are done by feel and by listening back, and the lesson says so instead of showing a number.
- **R4 (hear it first):** this uses Voice Shaper's existing rendering with "resonance only" (formant scale, pitch unchanged). Suggested defaults are +10 % for more feminine and −10 % for more masculine. For androgynous the user picks, starting from 0. For exploring, it plays both. The lesson notes that the shifted version is a computer approximation: it shows the direction of a change, not exactly what the user's changed voice will sound like.
- **R5 (two readings):** each reading needs a resonance value of its own. The cue's shown value carries the previous ~5 s of voiced speech over, so a reading would start contaminated by the one before. The proposal is a take value: the median of the vtln bins the gate admits between the take's start and end, posted by the resonance worker. Comparisons stay within one visit, because resonance isn't established as comparable across devices and rooms ([resonance-lab-benchmark-2026-10-04.md](../measurements/resonance-lab-benchmark-2026-10-04.md)). The words ("brighter than your first reading", "about the same", "darker") wait for M1. Pitch is shown beside resonance, so a change of pitch alone is visible as one: the vtln readout moves a little with pitch (the lab benchmark's R2 pitch leak), and M1 measures how much on a take. If the phone-quality detector is on, resonance isn't read and the lesson says why.

## 5. Training directions

The direction comes from the question asked on every load. It can be changed in Settings, and lessons pick up the change at once.

| | More feminine | More masculine | Androgynous or in between | Just exploring |
|---|---|---|---|---|
| Pitch target (existing bands) | 165–255 Hz | 85–155 Hz | 145–175 Hz | none |
| Notes chosen in P3 / P4 | steps up from the easy note | steps down from the easy note, never below the comfortable low | steps toward the band's middle (~161 Hz) | anywhere in the comfortable range |
| Resonance aim (R2–R5, T1) | the small / bright side | the large / dark side | find both sides, then the middle | both sides, no aim |
| Pitch safety line | "Higher should feel lighter, not squeezed. If it tightens, come down a note." | "Lower should feel relaxed and full. Don't press down, tuck your chin, or drop into a creaky voice to sound low." | both | "Comfortable range only." |
| Resonance safety line | "Bright, not tight: keep the jaw loose and the smile small." | "Dark, not muffled: let the sound come forward to the lips; don't push the voice box down." | both | both |

Content notes:

- **More feminine:** lip spreading and forward tongue carriage are the published core of oral resonance work. In Carew, Dacakis & Oates 2007, ten trans women practised them for five sessions; their formants rose and, on average, listeners heard them as more feminine afterwards (the review of 2026-10-27 dropped "most were rated more feminine": a per-person majority was not checked against the paper). In Kawitzky & McAllister 2020, F2 biofeedback moved F2 and listeners rated the higher-F2 speech more feminine (not quoted in any lesson; check it against the paper before it is).
- **More masculine:** there is less published voice-training work, and the text needs the most care. Testosterone lowers pitch but doesn't settle everything. Pan et al. 2025 found that F0 and vocal-tract length together explain only part of how masculine 30 transmasculine people on testosterone were rated, and Azul 2015 reviews the wider situation. A lowered voice box and a longer vocal tract do read as more masculine: a single-session case study of one transmasculine speaker (Buckley et al. 2020) reports a lower speaking pitch and a longer estimated vocal tract after laryngeal reposturing (estimated from the acoustics, not measured). The draft's "gone three days later" was not checked against the paper, so R1 no longer states the follow-up result (review 2026-10-27). The lessons stress gentle repetition anyway, and why pushing down or creaking to sound low is called out as a strain risk.
- **Androgynous:** each contrast is practised to both ends first, then the middle is found by ear. The pitch band's narrowness is disclosed (P6).
- **Just exploring:** every lesson runs both sides of each contrast, with no band, no aim and only descriptive results.

## 6. Safety

**S1 text (draft, our own words):**

> **Practise little and often.** 5 to 15 minutes at a time is plenty. Short sessions on most days do more than one long one.
>
> **Stop and rest if you notice:**
> - pain, or a raw or scratchy throat
> - a tickle that makes you cough or clear your throat
> - your voice cracking or cutting out more than usual
> - hoarseness, or a tired voice the next morning
>
> **Rest** means a break from practice and a normal, easy speaking voice. Drink some water.
>
> If you're hoarse for more than a few weeks, or speaking hurts, see a doctor.
>
> Syrinx is not a voice teacher or a speech therapist. If you can, work with one as well, especially if you're changing your voice a lot or it tires easily.
>
> The app compares you with yourself. Its numbers can be off. Trust how your voice feels over any number.

What the app does to back this up:

- Notes in P3 and P4 never go outside the comfortable range from P2 (or, without P2, beyond 4 semitones from the easy note), and never more than 4 semitones past the easy note in one lesson. These limits are a proposal, not a measurement.
- A **Strained** answer ends the lesson with the cool-down (§3).
- An optional throat check opens the day's routine: "How does your voice feel today? Fine / A bit tired / Sore." "Sore" suggests resting today and offers nothing but the cool-down.

## 7. Two lessons in full

Each lesson's text will be kept in one strings file and checked by a wording test, as Voice Shaper's text is (`src/voice-preview/strings.js`).

### P1 — Find your easy note

1. **What it's for.** Find the pitch your voice goes to when it's relaxed. The other pitch lessons start from it.
2. **Why it works.** When you agree with someone without thinking ("mm-hmm"), your voice usually lands on a note that takes no effort. Voice teachers often use it to find a comfortable starting point. Moving away from a relaxed note is easier, and safer, than moving away from a pushed one.
3. **Get ready.** Sit or stand comfortably. Let your shoulders drop and your jaw hang loose, with your lips lightly closed.
4. **Steps.** Say "mm-hmm" as if you're agreeing with a friend. Don't aim for a note. Do it five times, with a breath between each one. *(The live trace shows each one.)*
5. **What you're aiming for.** It should feel like nothing: no reaching, no effort. If one felt pushed, sigh, and do the next one more lazily.
   - *More masculine:* "If you're on testosterone, your easy note can move over weeks and months. Repeat this lesson now and then, so the other lessons start from the right place."
6. **Safety.** Stop if it hurts, scratches or makes you want to cough.
7. **Result.**
   - "Your easy note today: about 160 Hz (E3)."
   - "Your five tries were within 1 semitone of each other." If the spread is wider: "Your tries were spread over 5 semitones. Try a few more, as lazily as you can."
   - "Last time: about 155 Hz (D♯3)."
   - "How did that feel? Easy / Some effort / Strained"

### R3 — Tongue and lips

1. **What it's for.** Learn two resonance controls you can feel directly: where your tongue sits, and the shape of your lips.
2. **Why it works.** The space between your voice box and your lips shapes the sound, a bit like the body of an instrument. Spreading your lips a little and moving your tongue forward make the sound brighter. Rounding your lips and letting your tongue sit back make it darker. In a small study, ten trans women practised the bright version for five sessions. Afterwards their resonance measured brighter, and on average listeners heard their voices as more feminine (Carew, Dacakis & Oates 2007).
3. **Get ready.** Slowly say "ee", then "oo", back and forth. On "ee", feel your tongue move forward and up and your lips spread. On "oo", feel your tongue pull back and your lips round.
4. **Steps.**
   - **Bright:** rest the tip of your tongue behind your bottom front teeth. Let the middle of your tongue rise a little, as for "ee", and smile very slightly at the corners. Record yourself saying: "We were away a year ago."
   - **Dark:** let your tongue relax down and back a little, as for "oh". Round your lips slightly, as if about to say "oo". Record the same sentence.
   - **Compare:** play the two recordings one after the other.
5. **What you're aiming for.**
   - *More feminine:* the first one. It should sound a little smaller and brighter, not squeezed. Keep your pitch where it was; this lesson is only about the mouth.
   - *More masculine:* the second one. It should sound a little fuller and darker, not pushed down or muffled. Keep your pitch where it was.
   - *Androgynous or in between:* do both, then try one in between, with the tongue resting in the middle and the lips relaxed. That middle is your aim.
   - *Just exploring:* do both and listen to the difference. Neither one is right.
   - **If it isn't working:** if you can't hear a difference, exaggerate both a lot, then bring them back halfway. If the bright one sounds tight or nasal, loosen your jaw and keep the smile small. If the dark one sounds muffled, let the sound come forward to your lips.
6. **Safety.** Stop if it hurts, scratches or makes you want to cough. Your jaw and tongue shouldn't ache; if they do, stop and let them relax.
7. **Result.** "This lesson is done by ear. Your two recordings stay on this page and are gone when you leave it." Then "How did that feel? Easy / Some effort / Strained".

## 8. What the app shows and saves

**Where it lives:** a new **Exercises** tab. Opening it lists the lessons grouped as Start here, Warm-up and cool-down, Pitch, Resonance, and Together. Each row shows the lesson's one-line purpose and when it was last done. Above the list is an optional **Today** card: throat check, W1, the next lesson not yet done (or one the user picks), W2. There are no streaks and no reminders.

**Inside a lesson:** cards with Back / Next, with the live view only on the cards that need the microphone. If listening is off, those cards show a "Turn on the mic" button. The practice dock stays at the bottom, as on every tab. Phones in portrait come first: every card, including its live view, has to fit at 360 × 690 and 448 × 890.

**Live views, reusing what exists:**

| View | Built from | New work |
|---|---|---|
| Pitch trace with a band | `PitchTrace` | a single-note line for P4, and a full-height mode |
| Steadiness | `SteadinessReadout` | — |
| Pitch level and resonance row | `CueStrip` | — |
| Recorder with A/B playback | Voice Shaper's controller and playback | recording without the sliders; two or three takes kept side by side |
| Resonance-only "hear it first" | Voice Shaper's render (`formantScale`) | a fixed shift, no sliders |
| Take comparison (R5, T1) | the resonance worker plus pitch level | a take value posted by the worker (after M1) |

**Saved:** one `exerciseResults` row per finished lesson (the table already exists in `src/db.js` and isn't used yet):

```js
{ exerciseId: "P1", startedAt, endedAt, direction, sessionId /* if a session was recording */,
  feel: "easy" | "effort" | "strained" | null,
  results: { easyHz: 161.2, spreadSt: 0.8 }   // per lesson; numbers only, no audio
}
```

- No audio is saved. Recordings stay in memory for the page visit, as in Voice Shaper.
- Export and import have to carry the table, and they don't yet; Delete all data already clears it.
- Each lesson shows the user's last five results. A progress view across days is the separate roadmap item ("Progress over time").

## 9. Measurements needed first

Under hard rule 3, these are pre-registered before any result words or thresholds are built:

- **M1 — a resonance take value (R5, T1).** On public LibriSpeech readers (men and women, held-out), measure:
  - how far apart two readings of different passages by the same reader land: test-retest, which sets "about the same";
  - how reliably a known resonance shift is seen: resynthesised formant-scale shifts, as in the lab benchmark;
  - how much a pitch-only shift moves the take value;
  - the shortest reading that gives a usable value.

  The worker change is in a rule-3 module (`resonance-worker.js`), so it comes with the pre-registration.
- **M2 — the pitch chain on hums, lip trills and slides (W1, P1–P4).** The voice gate (FireRedVAD) was measured on speech, songs and held vowels, not on closed-mouth humming or lip trills. If it hides them, the pitch lessons would show nothing. Measure the share of hum and trill frames the gate hides and the pitch chain voices, on public or synthetic material. If the gate hides too much, decide between pausing the gate on those cards and choosing different exercises.
- **M3 — tone bleed in P4 (engineering check).** Confirm that a tone played by the app never shows up as the user's pitch after the play-then-listen pause, on a laptop speaker and on a phone speaker.

P5, P6, R1–R4, S1 and the warm-up and cool-down need none of these and could be built first.

## 10. Not in the first version

- **Weight** (heavy ↔ light): Syrinx has no measure that passed its test ([clarity-cue-2026-10-08.md](../measurements/clarity-cue-2026-10-08.md)). Lessons by feel and record-and-compare could come later; a hand on the chest ("less buzz in the chest") is a common body cue.
- **Intonation:** it needs its own measurement pass first (ROADMAP).
- **Ear training:** "which of these two is brighter?", using Voice Shaper renders of the user's own voice at known shifts and getting harder as the user gets them right.
- **A weekly reading** of the same passage, tied to "Progress over time".
- **Pictures:** simple diagrams of the tongue, lips and voice box would help R1–R3. The first version is text only unless good diagrams can be made.
- **Real-life scenes** (ordering, phone calls) and **videos**.

## 11. Questions for the owner — answered 2026-10-26

1. **Tab:** "hide the Resonance lab tab and only show it if it's enabled in settings" — it already is (off by default since 2026-10-21). So the default is five tabs (Dashboard, **Exercises**, Pitch, History, Voice Shaper), which fit one row from 320 px up; with the lab on, the six tabs scroll sideways inside the tab bar below ~410 px wide, and the selected tab scrolls into view.
2. **Routine:** the lesson list only (no Today card). The list puts "Start here" and the warm-up and cool-down first, and a Strained answer offers the cool-down.
3. **Review of the text:** no voice teacher or SLP is available. The text is written conservatively (small steps, a safety box before every exercise, nothing that pushes the voice box down or chases height or depth), and S1 still says Syrinx is not a voice teacher or speech therapist.
4. **Order of work:** build the lessons that need no new measurement first; the rest (M1–M3 and the lessons that need them) maybe later.
5. **Limits:** left to Claude. Decision: the first version picks no notes for the user, so no limit is needed yet; the glide lesson says to stop short of the band when it feels like work. The §6 proposal (within the comfortable range from P2, at most 4 semitones from the easy note per lesson) stays the starting point for P3 / P4.

## 12. What the first version changed from this draft

- **W1 is in, without its live trace.** The trace waits for M2 (the voice gate on lip trills and hums); the warm-up itself needs no measurement, so it is done by feel and says so.
- **P5 glides on "oo", not "ng".** "ng" and "mm-hmm" are closed-mouth hums, which M2 has to check first. The second step lands on a word ("one… two… three") instead of "mm-hmm". P5 needs no easy note (P1): it starts from a comfortable note.
- **R4 records its own phrase** ("We were away a year ago", said twice, 3–8 s) through Voice Shaper's controller and worker, and renders resonance-only versions at ±10 % (feminine +10, masculine −10, androgynous and exploring both), then records the user's try.
- **Layout:** a card's tool (the trace, the recorder, the play buttons) sits between the card's text and Back / Next, so it stays on screen while the text scrolls; in short landscape the text and the tool sit side by side. Checked at 360 × 690, 402 × 750, 448 × 890, 890 × 360 and 1280 × 800 for every card in every direction (`scripts/exercises-smoke.mjs`).
- **Measuring (P6)** uses a tap on the hook's per-frame record, the same frame a session recording stores (`src/exercises/bridge.js`), and the session statistics' own rule (`computeSummaryStats`): the result names the median pitch level and the share of voiced time whose level is in the band.
- **Saved rows** are as §8 says. Export and import carry them (the export header's optional `exerciseResults`; an import skips a lesson run already present and remaps its session id).
- **Review of 2026-10-27** ([measurements/guided-exercises-review-2026-10-27.md](../measurements/guided-exercises-review-2026-10-27.md)). Wording: the Buckley and Carew lines claim only what the papers report; W1 phonates "oo" into the straw (no "hum"); W2's sigh fades before it creaks; the resonance safety line comes before R2 / R3 / R4's steps, R2 adds "never push it down or squeeze it up" and R3's dark step says "Don't pull it back"; S1 lists urgent signs (sudden voice loss, painful swallowing, coughing blood, hard breathing) and "sip instead of clearing your throat"; the Strained reply points to a doctor. Behaviour: P6's result is computed again (and the row updated) when its result card is reached again after more speech; a feel answered while the row is being written is kept even if the lesson closes; leaving R4's record card stops its recording; pagehide closes the open lesson; a goal change mid-lesson keeps the card; "Nothing was measured: the mic was off." when no frame was logged. Voice Shaper's posted-pitch tap is a set (one per controller), so R4 and the Voice Shaper tab can't cut each other off. Import cleans exercise rows and links a result to the local twin of a session skipped as already present; Delete all data is one transaction. Screen readers: one status per recorder instead of per-second counters, per-take button names, focus back on the lesson row on close.
- **Fixes from the comparison with Juni (2026-10-27,** a private research note kept outside this repo**).** W2's sigh chart is neutral: no band and no in / out-of-band colour or words (a cool-down is never judged), and with the mic off it says the step works without it. "Next" runs S1 → warm-up → the first practice lesson → each practice lesson in turn (the warm-up no longer leads into the cool-down, nothing follows the cool-down), and every practice lesson's result card also offers the cool-down. No play button works while any take records (echo cancellation is off). S1's stop signs come right under their heading.

## Sources

- Azul D. Transmasculine people's vocal situations: a critical review of gender-related discourses and empirical data. *Int J Lang Commun Disord* 2015;50(1):31–47. doi:10.1111/1460-6984.12121
- Buckley DP, Dahl KL, Cler GJ, Stepp CE. Transmasculine voice modification: a case study. *J Voice* 2020;34(6):903–910. doi:10.1016/j.jvoice.2019.05.003
- Carew L, Dacakis G, Oates J. The effectiveness of oral resonance therapy on the perception of femininity of voice in male-to-female transsexuals. *J Voice* 2007;21(5):591–603. doi:10.1016/j.jvoice.2006.05.005
- Kawitzky D, McAllister T. The effect of formant biofeedback on the feminization of voice in transgender women. *J Voice* 2020;34(1):53–67. doi:10.1016/j.jvoice.2018.07.017
- Pan AY, Grail GPO, Albert G, Groll MD, Stepp CE, Arnocky SA, Hodges-Simeon CR. What contributes to masculine perception of voice among transmasculine people on testosterone therapy? *J Voice* 2025. doi:10.1016/j.jvoice.2024.12.037
- Titze IR. Voice training and therapy with a semi-occluded vocal tract: rationale and scientific underpinnings. *J Speech Lang Hear Res* 2006;49(2):448–459. doi:10.1044/1092-4388(2006/035)
