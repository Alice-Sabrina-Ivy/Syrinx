# Take checks for the guided exercises: how much voice a real take has (2026-10-27)

Branch `guided-exercises`. The lessons' recordings (R3's bright / dark / in-between takes,
R4's try) get a note when a take is too short or has too little voice in it
(docs/guided-exercises-design.md §2 rule 3). "Too short" is a design choice from the text
the take asks for. "Too little voice" needs a threshold that real spoken takes pass, so it is
measured here first. R4's try also shows its pitch ("about N Hz"); this note fixes how much
voice that needs.

## 1. Pre-registration (written before any result was computed)

**Question.** How many seconds of voiced frames does the exercises frame tap
(`src/exercises/bridge.js`, the frame a session recording stores) receive during a real
spoken take, and during a take with no speech?

**Chain.** The shipped chain in Node: the real pitch worker with the voice gate's detector
(FireRedVAD, as the app runs it; `node scripts/fetch-firered-model.mjs`), the real DSP worker
and the real hook (`useAudioPipeline`), driven as the session oracle drives them
(`scripts/session-oracle/`), at a 48 kHz capture rate. Listening has run for 3 s of the
take's background before the take starts; only frames that arrive inside the take window
are counted. Before any number, the harness is checked against the real hook: the frames it
counts are the frames `exerciseFrameTap` receives (same objects, same order) on one input.

**Counts per take.**
- `a`: 0.025 s × frames with `voiced` true and `f0 > 0` (the frame log's own rule,
  `src/exercises/results.js` `createFrameLog`).
- `b` (primary): as `a`, but frames the voice gate hid (`voiceGate === "hidden"`) do not
  count. With no gate decision (setting off, model not loaded) `b` equals `a`.

**Positive takes (real speech, public).** LibriSpeech. Selection set: dev-clean, 20 men and
20 women. Confirmation set: test-clean, 20 men and 20 women. Readers are taken in sorted
speaker-id order per sex. Utterances are whole LibriSpeech utterances of 1.5–4.0 s.
- *Single* (R3's take: one sentence): one utterance; up to 5 per reader.
- *Double* (R4's try: the sentence twice): two utterances of the same reader with a 0.4 s
  gap, at most 8.0 s of speech (the take cap); up to 3 per reader.
- Each take: 0.8 s before the speech and 0.6 s after it (the press of Record and Stop).
- Conditions: *clean* (the file's own level, pink noise at −60 dBFS under the whole take);
  *quiet* (the speech 20 dB lower, same noise floor); *noisy* (pink noise at +10 dB SNR
  against the speech's RMS over the speech portion).

**Negative takes (no speech).** 30 takes per class, 15 of 2.0 s and 15 of 5.0 s, seeds
varied: (n1) white noise at −70 dBFS; (n2) pink noise at −45 dBFS; (n3) pink noise at
−30 dBFS; (n4) brown noise at −30 dBFS; (n5) a 120 Hz hum with four harmonics at −35 dBFS
over pink noise at −50 dBFS; (n6) whisper-like speech: LibriSpeech utterances of the
selection-set readers re-made with noise excitation through a frame-wise LPC envelope
(25 ms frames, order 2 + rate / 1000), at the source's level.

**Candidates.** T ∈ {0.25, 0.5, 0.75, 1.0} s of voice, on count `b` (count `a` reported
beside it).

**Selection rule (per take type, single and double, separately).** On the selection set,
the largest T at which the share of positive takes with `b ≥ T` is at least 99.0 % in every
sex × condition cell (men / women × clean / quiet / noisy). On the confirmation set: if any
cell falls under 98.0 % at that T, step down one candidate; if T = 0.25 s fails there, STOP —
report the numbers and build no voice check (only "too short").

**Reported, no bar.** The share of negative takes flagged (`b < T`) per class at the chosen
T; a class flagged under 50 % is named in the lesson notes as a known limitation. Count `a`
beside `b` for every number.

**Fixed by design (not tuned here).**
- "Too short": R2 and R3 takes under 1.0 s; R4's try under 3.0 s (it asks for the sentence
  twice, as R4's own recording step, which needs 3 s). Reported: the share of positive takes
  that would trip it (expected none).
- R4's try pitch: shown when count `b` ≥ 1.0 s (Voice Shaper's own minimum for the recording
  it is compared with: ≥ 1 s voiced). Reported on the double takes: the share that reach it
  per cell, and the difference in semitones between the take's median voiced `f0` and the
  median of the same take in the clean condition, for the quiet and noisy conditions.
- R2's takes are whispered by design: no voice check there, only "too short".

## 2. Results

(Filled in after the run.)
