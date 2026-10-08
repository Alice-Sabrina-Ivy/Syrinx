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

## Amendment 1 — round 2 (registered after the round-1 dev selection)

**Round 1 outcome (dev, by the rule above).** No variant met the cost
criterion: every W variant lost > 0.5 pp of men's `pmix` mi0 + mv0
coverage, every T variant lost > 0.5 pp of dev regular speech. Step 3
selected **W25** (worst cost drop 0.76 pp). Its dev whisper is still
44.7 % (women) / 39.1 % (men), against 57.6 / 60.7 % at 5db2663. Why: the
pitch chain posts isolated voiced frames in unphonated whisper (2–8 % of
frames, mostly runs of 1–2 frames), so almost every 750 ms window holds a
few, while a larger N removes voiced frames that men's speech in music
also has only sparsely. W25 was then run through the full evaluation as
registered; its results are reported below with the round-1 grid. Seen
before this amendment: the round-1 dev table, W25's full whisper numbers
(primary FAIL) and W25's public evaluator verdict.

**Round 2 design (same principle, a run instead of a count).** Speech
voicing comes in syllable-length runs; the isolated frames in whisper do
not. While speech hints are live, a window scores only if a run of
consecutive posted voiced pitch hints of **≥ R ms** ends within the
trailing span S (a run's length counts in full, also the part before the
span; a hole in the hint stream breaks a run, as for the utterance onset).
Variants (7, every one reported):

- **R** — S = the 750 ms window: R ∈ {50, 75, 100, 125, 150} ms.
- **Q** — S = 1000 ms (the utterance's close gap): R ∈ {100, 150} ms.

Selection: the same dev-only rule (cost step 1, then the lowest
max(women, men) dev whisper, ties → smaller R, then R before Q; step 3 if
none meets step 1), over the round-2 variants only. Primary, secondary
and guards are unchanged. The round-2 selection is the candidate; if it
fails, W25 and the round-2 selection are both reported as FAIL.

## Results (2026-10-07)

**Verdict: FAIL — no setting is ship-eligible.** Both pre-registered
selections (round 1 W25, round 2 R50) fail the primary, and so does every
other variant. The mechanism is in `utterance-gate.js` (options
`speechMinVoicedMs`, `speechMinVoicedRunMs`, `speechVoicedSpanMs`) but
**off by default**; the meter's behaviour is unchanged from 5db2663. The
user decides (R5).

**How it was measured.** Every variant was replayed with the frozen
`replay_voice-detector-gate.mjs` (gate options passed as `--gate`) on the
frozen evaluator's 10 sets and on the probe sets (`pwhis`, `pmix`,
`palone`, `palone2`), with the recorded Silero hints and the deployed
classifier's logits (0 missing logits). Parity: the candidate tree with the
requirement off reproduces the 5db2663 (voice-detector-gate) replays with
0 differing streams on all 14 sets, and the private session-meter replays
byte for byte; the final committed code reproduces the W25, R50 and R150
variant replays with 0 differing streams. The evaluator's sha256 check
passed before every run.

### Real whisper (primary) and the selections

Pooled share of whispered time with a number (%). "Unphonated" = S1
(Praat phonation < 20 %); the five phonated EARS women's recordings get a
number 91.5–91.7 % of the time in every listed variant.

| variant | women | men | test women / men | unphonated women / men | LPC whisper women / men (S2) |
|---|---|---|---|---|---|
| 5db2663 | 54.1 | 72.4 | 50.7 / 88.7 | 44.4 / 72.4 | 93.4 / 94.5 |
| **W25** (round-1 selection) | 39.7 | 50.8 | 34.8 / 67.0 | 26.3 / 50.8 | 41.1 / 48.3 |
| **R50** (round-2 selection) | 35.5 | 40.4 | 31.3 / 55.2 | 21.0 / 40.4 | 26.3 / 39.7 |
| W200 (strongest count) | 22.1 | 2.7 | 22.6 / 3.2 | 4.7 / 2.7 | 1.0 / 4.2 |
| R150 (strongest run) | 22.4 | 4.3 | 22.2 / 4.1 | 5.8 / 4.3 | 0.0 / 1.9 |

- **Women's whisper cannot reach 5 %** with any voicing requirement:
  five of the 12 EARS women phonate through much of their "whisper"
  (Praat 33–46 % voiced at 117–201 Hz), and decision (A) asks for exactly
  those stretches to be scored. They alone hold women's whisper at ≥ 21 %.
- **Unphonated whisper reaches ≤ 5 % only at W200 or T150** (and R150 for
  men); those settings fail the low-voice primaries (below).

### Cost: the low-voice evaluator (vs the frozen 852b5cc baseline)

| variant | P1 gap (≤ 4.97) | P2a (≥ 73.56) | P2b gap (≤ 5.02) | H1 (≤ 3.00) | H2 (≤ 3.00) | criteria failing that pass at 5db2663 |
|---|---|---|---|---|---|---|
| 5db2663 | −1.51 | 95.09 | −1.80 | −1.37 | −1.73 | — (only H3 fails, 93.70) |
| W25 | 0.49 | 80.73 | 3.23 | 0.19 | −0.93 | none |
| W50 | 1.60 | 73.76 | **5.57** | 0.51 | −0.81 | P2b |
| W75 | 2.35 | **70.50** | **6.79** | 0.83 | −0.50 | P2a, P2b |
| W100 | 3.59 | **65.89** | **8.52** | 1.09 | −0.74 | P2a, P2b |
| W150 | **5.25** | **61.14** | **8.73** | 1.57 | −0.88 | P1, P2a, P2b, H3 women real 0 dB, G2 PVQD f / m |
| W200 | **7.83** | **58.13** | **7.90** | **3.21** | 2.48 | P1, P2a, P2b, H1, 5 G1 / H3 cells, G2 PVQD f / m |
| T25 | 1.45 | 75.62 | 5.00 | 0.00 | −1.17 | G2 PVQD f / m |
| T50 | 2.54 | **68.83** | **7.07** | 0.60 | −0.19 | P2a, P2b, G2 PVQD f / m |
| T75 | 3.46 | **66.12** | **8.08** | 1.29 | −0.59 | P2a, P2b, G2 PVQD f / m |
| T100 | **5.01** | **59.91** | **9.59** | 2.15 | 0.42 | P1, P2a, P2b, G2 PVQD f / m |
| T150 | **10.79** | **55.95** | **10.19** | 2.68 | 1.49 | P1, P2a, P2b, 9 G1 / H3 cells, G2 PVQD f / m |
| R50 | 1.54 | 74.11 | **5.54** | 0.75 | 0.05 | P2b |
| R75 | 2.34 | **71.40** | **6.56** | 1.56 | −0.17 | P2a, P2b |
| R100 | 4.70 | **62.51** | **9.02** | 1.72 | −0.29 | P2a, P2b, G2 PVQD m |
| R125 | **7.52** | **62.29** | **8.54** | 2.54 | −0.77 | P1, P2a, P2b, H3 women real 0 dB, G2 PVQD f / m |
| R150 | **11.09** | **60.07** | **8.66** | **3.27** | 1.79 | P1, P2a, P2b, H1, 8 G1 / H3 cells, G2 PVQD f / m |
| Q100 | 3.78 | **64.11** | **8.31** | 1.35 | −0.89 | P2a, P2b |
| Q150 | **10.26** | **61.63** | **8.38** | **3.08** | 1.49 | P1, P2a, P2b, H1, 4 G1 / H3 cells, G2 PVQD f / m |

P3 (men's settle in noise) passes everywhere (0.395–0.515 s ≤ 0.675).

### Other guards

- **E2 clean speech (≥ 5db2663 − 0.5 pp).** W25 and R50 fail one row:
  PVQD speech portions, men, 89.99 → 89.23 (W25) / 88.72 % (R50). All
  others pass for W25 and R50 (clean-ish 38-speaker women / men 93.63 /
  95.03 and 93.63 / 94.99 vs 93.63 / 95.22; real regular speech women /
  men 93.11 / 93.66 for both vs 93.15 / 93.66). Stronger variants fail
  more rows (summary file).
- **E3 held notes:** every variant passes (G4 numbers during holds equal
  or lower, "needs running speech" and G5 unchanged).
- **E4 music / noise-only:** every variant passes (time with a number can
  only fall; e.g. evaluator noise-only 0.132 → 0.127 % for W25 / R50).
- **Dev cost** (the selection criterion): men's coverage of speech under
  0 dB music falls 94.00 → 93.24 (W25), 93.00 (R50), 88.71 (W200),
  86.42 % (R150); women's 93.35 → 93.35, 93.23, 90.98, 91.36 %.
- **Private.** On the private session recordings, the meter's display far
  from any reference voicing is at or below the 5db2663 value for every
  variant and speaker label (session-meter replay, parity proven). Results
  on the private session recordings are kept outside this repository.
- **E5:** lint, unit tests, build and the smoke runs pass with the
  requirement off (the shipped state).

### Why it does not work, and what would

The pitch evidence the requirement needs is the evidence the speech
detector was adopted to do without. In whisper the tracker posts isolated
voiced frames (2–8 % of frames) that a count cannot reject; a run rule
rejects them, but men's speech in loud noise (pink / real 0 dB, music
0 dB) also comes through as short voiced fragments, so each ms of
required run trades whisper coverage for noisy-men coverage about 1 : 1 —
the same trade the 2026-10-07 diagnosis found for pitch-evidence levers.
Options for the user:

1. **Keep 5db2663** (whisper scored; this commit's default).
2. **Accept a cost:** W25 removes about a quarter to a third of whispered
   readings (women 54 → 40 %, men 72 → 51 %) and fails only the E2 PVQD
   men row (−0.76 pp) — no evaluator criterion newly fails. R50 removes
   more (36 / 40 %) and also fails P2b (5.54 vs 5.02).
3. **A whisper detector instead of pitch:** a voiced-vs-unvoiced speech
   classifier on the gender worker's 16 kHz stream (e.g. a periodicity or
   spectral-tilt feature over the speech detector's frames, or the round-2
   voice detector on the `voice-detector` branch), measured against this
   same pre-registered primary.
4. **Label instead of hide:** show whisper readings with a "whisper"
   label (option c of the probes).

Scratch (not committed): `queue-oct7/whisper/` (`run_wv.sh`,
`wv_metrics.py`, `summarize.py`, `summary.txt`, the selection records,
Praat phonation per stream, the session-meter copy under `private/`).
