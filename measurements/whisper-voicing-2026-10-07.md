# Perceived Voice meter: no readings on whisper — pre-registration — 2026-10-07

**Status: pre-registration.** This section fixes the design space, the
selection rule, the primary and the guards **before any candidate result is
computed**. No candidate code exists at the time of this commit. Results are
added below it. This is the hard-rule-3 measurement file for the change to
`src/ml/utterance-gate.js` / `src/ml/gender-worker.js`.

Branch `voice-direction`, baseline **5db2663** (the speech-detector gate,
adopted 2026-10-07; [low-voice-noise-2026-10-07.md](low-voice-noise-2026-10-07.md)).
Its `utterance-gate.js` is byte-identical to the evaluated candidate
voice-detector-gate (0528fce), so that candidate's frozen-evaluator results
and the follow-up probes' "cand" arm are the 5db2663 baseline.

## Problem and user decision

The follow-up probes found that the speech-detector gate scores whisper:
real whisper (EARS + Expresso) has a number on **54.1 % of women's and
72.4 % of men's** whispered time (pitch-only gate 852b5cc: 23.2 / 4.2 %).
**User decision (A), 2026-10-07:** the meter scores only stretches with
some voiced (pitched) sound; whisper must not get readings.

## Design space (minimal)

The speech detector still decides when an utterance opens, closes, and
whether a window is recent speech. While speech hints are live, a window
that would score additionally needs **≥ N ms of posted voiced pitch** (the
relayed pitch hints with `voiced: true`, 25 ms each) within a span ending at
the window's newest audio. If it does not have it, the verdict is `pause`
(no new score; the view shows a fresh earlier score as before, otherwise no
number). Nothing else changes: the pitch-only fallback (detector not live)
already needs ≥ 15 % voiced hints in the window, and the held-note tests run
before this check.

Variants (11, every one reported):

- **W** — span = the 750 ms ML window: N ∈ {25, 50, 75, 100, 150, 200} ms.
- **T** — span = the trailing 375 ms: N ∈ {25, 50, 75, 100, 150} ms.

## Sets

- **Real whisper** (the probe set `pwhis`, unchanged): EARS (12 women,
  6 men; one read passage each, whisper + regular) and Expresso (ex02 / ex04
  women, ex01 / ex03 men; 8–11 whisper + regular streams each), the same
  talker and text in both styles, whisper at its natural level relative to
  the regular reading. Whispered time = the probe's energy-activity spans.
- **Dev subset (N is chosen on it only):** alternate talkers in sorted ID
  order per corpus × sex, starting with the first: EARS women p002, p011,
  p033, p061, p064, p084; EARS men p007, p031, p087; Expresso ex02 (women),
  ex01 (men). **Test subset:** the rest (EARS women p003, p027, p058, p062,
  p067, p104; men p023, p081, p101; Expresso ex04, ex03).
- **Noisy dev:** the probe set `pmix`, conditions instrumental 0 dB (`mi0`)
  and full mix 0 dB (`mv0`) under the 38 LibriSpeech talkers. These are the
  frozen evaluator's talkers with different noise, not its streams.

**Disclosed before registration (input inspection, no candidate run):**

- Praat AC (10 ms, 75–600 Hz) on the whisper streams: 5 of the 12 EARS
  women's whisper recordings contain phonation — 33–46 % of their active
  time is voiced at F0 ≤ 350 Hz, median F0 117–201 Hz (p027, p033, p062,
  p064, p104). Every other whisper stream is ≤ 8.1 %. The pitch chain posts
  37–52 % of those five streams voiced, in runs of up to 0.95 s, and they
  are why the pitch-only gate scored 44 % of EARS women's whisper.
- The posted-voicing content of the windows the 5db2663 gate scores was
  tabulated per corpus × style × sex (scratch). Regular speech: 10th
  percentile 150–225 ms voiced per scored window; unphonated whisper: median
  0–25 ms.

**Expected outcome, stated now:** a pitch-voicing requirement scores the
phonated parts of those five recordings, which decision (A) asks for, so
the women's primary is expected to **fail** for every variant. S1 below
reports the unphonated whisper separately; it does not replace the primary.

## Selection rule (dev only)

1. **Cost on dev:** for each sex, coverage of the dev talkers' regular
   streams and of `pmix` mi0 + mv0 must each be ≥ the 5db2663 value
   − 0.5 pp.
2. Among variants meeting (1): the lowest max(women, men) pooled dev
   whisper coverage. Ties within 0.1 pp: smaller N, then family W.
3. If none meets (1): the variant with the smallest worst cost drop.

The selected variant becomes the code default and is the candidate. The
selection is written to scratch before any test-subset or evaluator number
is computed for it.

## Primary (as set in the task)

- **PRIMARY:** real whisper (all EARS + Expresso whisper streams) has a
  number on ≤ **5.0 %** of whispered time, **for women and for men**
  separately (pooled 25 ms hops, the probe convention behind 54.1 / 72.4 %).

Reported, not decisive: the test subset alone; per corpus; per-stream
means; **S1** unphonated whisper (Praat phonation < 20 % of active time)
≤ 5.0 % per sex; **S2** LPC-synthesised whisper (`pmix` wlpc, wlpc15)
≤ 5.0 % per sex; numbers on phonated whisper.

## Guards (each must hold)

- **E1 Frozen low-voice evaluator.** Re-run exactly as the
  voice-detector-gate candidate was (`low-voice/prereg`, sha256 check;
  `replay_voice-detector-gate.mjs` with the recorded Silero hints; frozen
  metrics; `check_rule.py` against the frozen 852b5cc baseline; the
  private session-meter guard G3 through a copy of
  `meter_session_voice-detector-gate.mjs` with parity proven on the
  candidate tree with the requirement disabled). P1, P2a, P2b, P3, H1, H2
  pass, and **no criterion fails that passes at 5db2663** (5db2663 fails
  only H3, women real 10 dB held-out, 93.70 %; its value is reported).
- **E2 Clean speech.** Coverage per sex ≥ 5db2663 − 0.5 pp for: clean-ish
  38-speaker and held-out (evaluator G2 / H3 rows), PVQD speech portions,
  the EARS + Expresso regular streams (all talkers), `pmix` clean.
- **E3 Held notes unchanged.** Every evaluator G4 row: number during holds
  ≤ 5db2663; "needs running speech" from 1.25 s ≥ 5db2663 − 0.5 pp. G5 rows
  ≤ 5db2663 + 0.5 pp.
- **E4 Music / noise-only not worse.** Every `palone` row (chatter, music
  with / without vocals, TV voice, alone) and every `pmix` lead /
  away-from-speech row: time with a number ≤ 5db2663 + 0.1 pp; evaluator G3
  noise-only rows and real-noise leads ≤ 5db2663 + 0.1 pp.
- **E5 CI.** `npm run lint`, `npm run test:unit`, `npm run build`, and the
  voice-direction smoke (phone / desktop / landscape) pass.

**Verdict:** SHIP-ELIGIBLE only if the primary and every guard pass; any
fail is reported as FAIL with the numbers (the user decides, as with H3).
**Validity (R3):** the added work is a count over ≤ 30 hints per 150 ms
decision; no browser timing run is needed.
