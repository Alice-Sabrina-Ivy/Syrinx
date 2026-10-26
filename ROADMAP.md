# Roadmap

Product ideas that are not built yet. What the app does today is in [CLAUDE.md](CLAUDE.md) ("Current state"). Most of these ideas come from the original plan of March 2026, archived at [docs/archive/ARCHITECTURE-original-plan-2026-03.md](docs/archive/ARCHITECTURE-original-plan-2026-03.md). Nothing here is scheduled unless it says so.

Last reviewed 2026-10-26.

## Next: guided exercises

**Wanted (owner, 2026-10-26).** Short guided exercises that explain what to change (tongue position, mouth shape, larynx height, airflow) and let the user practise it with Syrinx's live cues. The reference for the overall shape is Juni, a voice training app for iOS and Android: a short daily routine, a library grouped by skill, plain-language instructions with a picture of what to do. The design is not started.

What exists to build on:

- the live pitch trace, the pitch level and the steadiness readout. They are fast and accurate, so they suit glides, sirens, following a line and short holds;
- the resonance cue (slow, and it needs running speech; see below);
- Voice Shaper's recorder (record a take, play it back);
- the `exerciseResults` table in [src/db.js](src/db.js), defined but not used yet.

Constraints from earlier measurements:

- **Resonance needs phrases, not held vowels.** The resonance cue drops held vowels (about 96 % of their bins; they never reach "settling", [resonance-cue-production-path-2026-10-07.md](measurements/resonance-cue-production-path-2026-10-07.md)) and takes a few seconds to follow a change. Resonance exercises need phrases or counting and a "speak, then see where it landed" form, not a fast live game on a held vowel.
- **Keep held notes short.** The voice gate can blank parts of long held notes ([noise-detector-tryout-2026-10-20.md](measurements/noise-detector-tryout-2026-10-20.md)), and the tonal-noise notch can notch a note held for 20 s or more ([noise-notch-voice-discrimination-2026-10-05.md](measurements/noise-notch-voice-discrimination-2026-10-05.md)).
- **No meter for weight.** Syrinx has no vocal-weight or clarity measure ([clarity-cue-2026-10-08.md](measurements/clarity-cue-2026-10-08.md)), so weight exercises work by ear, or by recording and comparing takes.
- **No verdicts or gender scores**, as everywhere else in the app.

## Later

### Progress over time

Trends across sessions, and a comparison with where the user started. Sessions already store summary statistics, but nothing shows them over time. Pitch level is safe to chart across sessions. Resonance is not: the resonance cue is not established as comparable across devices and rooms ([resonance-lab-benchmark-2026-10-04.md](measurements/resonance-lab-benchmark-2026-10-04.md)), so it would have to be left out or shown with that caveat. A recorded reading of the same short passage every week, as Juni does, would tie this to the guided exercises.

### Privacy statement in the app

The README's privacy paragraph, shown in the app (for example in Settings or on the welcome screen). Nothing in the app says it today.

### Intonation (pitch movement)

A measure of how much the pitch moves across a phrase, in semitones, compared with the user's own usual speech. Its main value is naturalness and feedback in intonation exercises; it is not suited to be a gender cue on the Dashboard. It needs a measurement pass before anything ships.

What the research says:

- Leung, Oates & Chan 2018 (systematic review and meta-analysis, 38 studies): intonation is associated with perceived speaker gender, but the studies carry a significant risk of bias. Speaking pitch alone accounted for 41.6 % of the variance in gender perception.
- Hancock, Colton & Douglas 2014 (44 speakers): speakers with more upward intonation and a wider semitone range were perceived as female, although the speaker groups did not differ in their actual intonation.
- Henton 1989: measured in semitones, women's pitch range is about the same as men's. The "women are more expressive" difference comes largely from measuring in Hz.

### Android app

The web app is enough for now. If an Android app is wanted later, there are two usual routes: a Trusted Web Activity, which wraps the site and needs a web app manifest and a service worker (which would also make the site installable and usable offline), or Capacitor, a native shell around the same code.

### Smaller ideas

- Tones that follow pitch or resonance, for accessibility.
- Reading-passage breakdown: read a passage aloud, then see where each sentence fell against the target.

## Not planned

- **F1/F2 vowel plot with target zones.** Formants measured frame by frame mostly follow the vowel, not resonance; the resonance cue uses a spectral-warp measure instead.
- **Spectral tilt or CPP as vocal weight.** CPP measures clarity (clear ↔ breathy) and read weight mostly backwards ([clarity-cue-2026-10-08.md](measurements/clarity-cue-2026-10-08.md)).
- **A shareable "voice card" image.** It is a privacy risk, and it reads like a verdict.
- **A scrolling spectrogram.** It adds little for practice.
