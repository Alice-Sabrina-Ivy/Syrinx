# The live HNR readout: voiced frames only, median over 3 s (2026-11-02)

Public data only: two LibriSpeech test-clean readers (CC BY 4.0) through the built app.

## What was wrong

The Dashboard shows "HNR n dB" under the cue strip. The DSP worker computes HNR every 6th analysis frame (~150 ms) on the last 70 ms of audio, whether or not that audio is voiced ([src/dsp/hnr.js](../src/dsp/hnr.js); the method was checked against Praat on voiced sound in [hnr-window-corrected-2026-10-03.md](hnr-window-corrected-2026-10-03.md)). The readout showed the newest value. In running speech many of those windows sit on consonants, voicing edges and gaps between words, so while someone was speaking the readout jumped about 3.5–4 times a second across a ~20 dB range, and about a third of its readings were negative. A polish sweep before a session with a speech-language pathologist found readings of −7, −4 and 0 dB on clean read speech.

The session statistics already counted only voiced frames ([src/utils/sessionStats.js](../src/utils/sessionStats.js): "Avg HNR" in History, e.g. 11.0 dB for an 8 s stretch of the same reader).

## Change (display only)

[src/audio/hnrReadout.js](../src/audio/hnrReadout.js): the readout shows the median of the fresh HNR values computed on voiced frames (posted pitch, not hidden by the voice gate) over the last 3 s. With none in the window it keeps the last value it showed, as before; prolonged silence clears it, as before. Recorded frames keep the measured value, so session statistics and History are unchanged. The DSP worker is unchanged.

## Method

- Input: [scripts/hnr-readout/make-wavs.py](../scripts/hnr-readout/make-wavs.py) builds two 48 kHz fake-mic files from LibriSpeech test-clean reader 121 (a woman, 83 s) and reader 61 (a man, 76 s): utterances with 0.6–3.5 s pauses, −26 dBFS active, a −65 dBFS pink floor.
- Reference: Praat `To Harmonicity (ac)` (parselmouth; 10 ms step, 75 Hz minimum pitch, 4.5 periods), over Praat's voiced frames.
- App: [scripts/hnr-readout/probe.mjs](../scripts/hnr-readout/probe.mjs) serves the build, plays the file as the microphone in headless Chrome (448 × 890, own profile), picks the matching goal, starts listening and samples the readout every 250 ms for 72 s. [stats.cjs](../scripts/hnr-readout/stats.cjs) keeps the samples taken while the pitch row is live (speaking). Base = origin/main 21bc8e5.

## Results (while speaking)

| | Praat, voiced frames: mean (q10–q90) | Readout median (q10–q90) | Negative readings | Changes per second |
|---|---|---|---|---|
| Woman, before | 9.9 dB (2.4–16.9) | 6 dB (−5–16) | 27.0 % | 3.77 |
| Woman, 1.5 s window | | 6 dB (0–12) | 9.6 % | 2.98 |
| Woman, **3 s window** | | 7 dB (2–11) | 4.0 % | 2.59 |
| Man, before | 5.2 dB (−1.3–11.0) | 2 dB (−5–10) | 37.0 % | 3.53 |
| Man, 1.5 s window | | 2 dB (−3–7) | 29.7 % | 2.54 |
| Man, **3 s window** | | 2 dB (−2–5) | 23.0 % | 2.13 |

A repeat run of the woman with the 3 s window: median 6 dB (2–11), 2.2 % negative, 2.63 changes per second.

3 s was chosen over 1.5 s on these numbers: fewer negative readings and a calmer number. HNR changes slowly, so the longer window loses nothing a user would act on.

## Limits

- The readout's level is unchanged: its median stays a few dB below Praat's voiced-frame mean (7 / 2 vs 9.9 / 5.2 dB). The two differ in frame selection (the app's voicing and 150 ms cadence vs Praat's 10 ms frames) and window. This change targets the jumps and the readings taken off the voice, not the level.
- The man's reader stays low and often negative: Praat itself puts about one in ten of his voiced frames below 0 dB (compressed audiobook audio).
- Two readers, one fake-mic path, about 70 s each, in headless Chrome. Not measured on a phone or with a real microphone.

## Checks

`npm run lint`; `npm run test:unit` 77 / 77 (new: [tests/audio/hnr-readout-test.js](../tests/audio/hnr-readout-test.js); [tests/audio/voice-gate-display-test.js](../tests/audio/voice-gate-display-test.js)'s control for hidden unvoiced noise now expects that the gate-off app no longer shows the noise's HNR either); `scripts/cue-strip-smoke.mjs` 97 / 97 at phone and p360.

## Reproduce

```
python -P scripts/hnr-readout/make-wavs.py <LibriSpeech root> build/hnr-readout/wavs
python -P scripts/hnr-readout/make-wavs.py --praat build/hnr-readout/wavs/speech-woman.wav build/hnr-readout/wavs/speech-man.wav
npm run build
node scripts/hnr-readout/probe.mjs --wav=<absolute path to speech-woman.wav> --goal=feminine --out=build/hnr-readout/head
node scripts/hnr-readout/probe.mjs --wav=<absolute path to speech-man.wav> --goal=masculine --out=build/hnr-readout/head --port=4326
node scripts/hnr-readout/stats.cjs build/hnr-readout/head
```

The base numbers come from the same probe on a build of 21bc8e5.
