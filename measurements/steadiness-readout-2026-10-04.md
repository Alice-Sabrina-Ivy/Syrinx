# Steadiness readout — 2026-10-04

**Feature (user-approved):** a live readout of how steadily the voice holds
pitch over the last ~1 s, in semitones — the 1-s pitch SD tracked in the
user's voice training. Shown as "Steadiness ±0.4 st" under F0 on the
dashboard and beside Hz / note on the Pitch tab, "—" when the window holds
too little voiced audio.

Built on the precision pass
([pitch-precision-steadiness-2026-10-04.md](pitch-precision-steadiness-2026-10-04.md)):
compute from the pitch worker's **posted** values (not the smoothed /
painted trace), trim octave-class frames around the window median, gate on
voiced coverage; noise floor ~0.05 st. This file tunes and validates the
exact shipped algorithm. **Pitch detection is unchanged** (worker, tracker,
gates, smoothing, paint gate untouched; `noise-notch.js` untouched); the
hook change is a refactor of the pitch-message handler plus the readout.

## Verdict — what shipped

[src/audio/steadiness.js](../src/audio/steadiness.js) (pure module), wired
through `useAudioPipeline` (`handlePitchMessage` pushes every posted value;
`state.steadiness` / `steadinessHeld` ride the existing ~5 fps throttled
state), UI [src/components/SteadinessReadout.jsx](../src/components/SteadinessReadout.jsx).

| parameter | value | why (sections below) |
|---|---|---|
| source | posted worker pitch, every message (null = unvoiced) on the audio clock (`contextTime`) | painted trace: worse agreement on every set (corpora MAE 0.345 vs 0.246, vocadito 0.168 vs 0.121) and more false readings in silence (§4) |
| window | 1.0 s | the training definition; 0.75 / 1.5 s trade a little either way (§3) |
| coverage gate | ≥ 60 % of the window's expected 40 messages voiced | 0.5: corpora reports 76 → 81 % but more false readings; 0.7: corpora reports 76 → 63 %, little accuracy gain (§3) |
| robust spread | two-stage trim around the window median: **3 st if it drops ≤ 10 %**, else **6 st if it drops ≤ 15 %**, else no reading ("—") | single 3-st trim under-reads real intonation on clean references by 0.5–1.0 st and paints register switches as "steady"; single 6-st trim costs precision on steady windows (private-session result, §2) |
| statistic | population SD of 12·log2 f | unit-free, gender-symmetric |
| update | recomputed on every message (no cadence throttle; the hook samples at 200 ms) | a 100 / 200 ms recompute cadence adds 0.01–0.05 st error from staleness |
| display smoothing | none | EMA costs lag for no measurable stability gain (§5) |
| hold | last reading kept 1.5 s (`HOLD_SEC`) after the window stops qualifying **for lack of voiced coverage** (voice stopped / went sparse), flagged held (rendered dim). A trim refusal with coverage OK (register switch, octave-error run during continuous phonation) shows "—" and ends the hold (§9) | lets a note be read after it ends, at the cost of more readings shown in silence (§9). Length pending the user's decision (since decided: no hold, §10) |
| display | one decimal, "<0.1" below 0.1 st, "—" for no reading; neutral colour | agreement ~0.1 st, floor 0.03–0.05 st (§3) |

**Agreement with the shipped parameters**

- **Sessions** (the private session recordings, Praat AC reference on the
  same audio span, same recipe applied to the reference): in aggregate, MAE
  ~0.1 st on speech-like windows, with a reading on close to 90 % of them.
  Results on the private session recordings are kept outside this repository.
- **Clean references** (laryngograph FDA / PTDB-TUG, annotated vocadito,
  untrimmed): MAE 0.12 (vocadito, r 0.93), 0.20 (PTDB f / m 0.200 / 0.195),
  0.28–0.31 (FDA m / f) — gender-symmetric (max(F, M): PTDB 0.200, FDA 0.306).
  The precision pass's plain 3-st trim scores 0.48 / 0.76–0.81 / 0.50–0.97
  on the same windows: it under-reads every window that genuinely spreads
  > 3 st.
- **Synthetic notes through the real chain**: drift 0.5–4 st/s MAE 0.006–0.027
  (unbiased), vibrato ±25 / 50 / 100 c MAE 0.012 / 0.024 / 0.050 (reads
  ~5 % low — the 80 ms analysis window), jitter-only notes read 0.03
  (F0 ≥ 160) / 0.05 (F0 < 160) st = the floor, notes in pink / white /
  fan-hum noise at 5–20 dB SNR MAE 0.007–0.032.
- **Noise only**: 0.00 % readings for 11 of 13 noise classes (white, pink,
  brown, sleep, sleep-birdies, three resonant-noise variants, crickets,
  cicadas, mains-complex). Fan-hum: readings only during the first ~5.9 s,
  before the notch promotes the hum (the worker posts the hum voiced then and
  the trace paints it too — inherited, not fixable at the readout without
  changing detection). Babble (overlapping talkers — real voices, posted
  voiced 95–98 %): fresh readings on 16–27 % of windows, all large
  (median 2.7–4.2 st, i.e. "not steady"), the rest "—" (before the §9 fix
  the hold carried a stale reading over most of them: 87 % shown).
- **Real hook == pure module**: `hook-check.mjs` over the full private
  session recordings: the hook's `state.steadiness` equals the module's
  reading bit for bit on every DSP frame, the display readout column is
  identical to the session oracle's driver (the handler refactor changes
  nothing on the display path), and the posted values equal the attr dumps
  used for the offline scoring (§7).

## 1. Setup

- **Readout time base.** A message with `contextTime` T describes the frame
  centred at T − 40 ms; the reading at T covers messages with
  `contextTime` in (T − 1 s, T], i.e. audio centres in (T − 1.04, T − 0.04].
  References are evaluated on the same span, on a 0.25 s grid.
- **Inputs.** Posted series of the current `src` from the low-register
  pass's real-chain dumps (`lowband-attr.mjs`, tag `base`; verified equal to a
  fresh real-chain run, §7), the 96 synthetic held notes of the precision
  pass, and 144 new synthetic cases (`scripts/steadiness/synth-cases.mjs`,
  real workers + real hook): flat, vibrato, drift, sirens, ±7 / ±12 st jumps
  (abrupt and 80 ms), short notes, notes in noise, noise only (13 classes ×
  4 seeds × 30 s).
- **References.** The clean corpus references (laryngograph FDA / PTDB-TUG,
  annotated vocadito) are scored **untrimmed** — they arbitrate the trim
  choice; synthetic cases are scored against their truth contour. The
  private session recordings were scored against Praat AC (own-speaker
  windows in categories by AC voiced fraction — held / speech-like / sparse —
  plus reference-silent windows, where every reading is false).
  Results on the private session recordings are kept outside this repository.
- Scripts: [scripts/steadiness/](../scripts/steadiness/README.md).

## 2. Robust spread: trim width and refusal rule

The precision pass's recipe (3-st trim, no refusal) agrees closely with a
3-st-trimmed session reference — but that agreement is partly circular.
Against the clean, untrimmed corpus references it fails on every window
that genuinely spreads more than ~3 st: FDA / PTDB / vocadito MAE 0.50–0.97 / 0.76–0.81 / 0.48, median error
−0.4 to −0.7 st (it cannot express a spread above ~1.7 st: uniform within
±3 st has SD 1.73). On an octave-class 0.15 jump it shows a "steady" value
in 85–100 % of the windows straddling the jump (§6). Wider single trims fix
the corpora but let voicing-boundary scoops and fifth-class frames into
steady windows.

Trim × refusal grid (coverage 0.6 on every row¹; corpora / vocadito vs
clean untrimmed references). The selection also weighed session columns
(report rates, speech / held MAE, false readings in reference-silent
windows). Results on the private session recordings are kept outside
this repository.

| config | corpora MAE (reports) | vocadito MAE, r (reports) |
|---|---|---|
| untrimmed¹ | 0.444 (81 %) | 0.434, 0.41 (99 %) |
| 3 st, no refusal (precision pass) | 0.760 (81 %) | 0.479, 0.76 (98 %) |
| 3 st, refuse > 20 % | 0.426 (51 %) | 0.199, 0.85 (75 %) |
| 6 st, refuse > 10 % | 0.201 (72 %) | 0.111, 0.94 (91 %) |
| 3 → 6 st, 10 % / 10 % | 0.220 (72 %) | 0.114, 0.93 (91 %) |
| **3 → 6 st, 10 % / 15 % (shipped)** | **0.246 (76 %)** | **0.121, 0.93 (93 %)** |
| 3 → 7 st, 10 % / 15 % | 0.237 (78 %) | 0.120, 0.93 (94 %) |
| 3 → 6 st, 15 % / 15 % | 0.288 (76 %) | 0.143, 0.90 (93 %) |

3 → 7 st scores marginally better than the shipped 3 → 6 st on the public
columns; the 6-st outer stage was chosen on the private-session agreement
(kept outside this repository).

¹ The first version of this table showed the untrimmed control run at
coverage 0.5 (`sim.mjs` config `untrimmed`: corpora 0.456 (86 %),
vocadito 0.436 (99 %)). Re-run at 0.6 (`untrimmed06`, 2026-10-04) so every
row shares the caption's coverage; the conclusion is unchanged: untrimmed
is far worse than any trim on the private sessions (kept outside this
repository) and worse than every rule with a wider (6–7 st) stage on the
corpora and vocadito.

(Full grids: 3–9 st × refuse 10 / 20 / 30 / 100 %, outer 5 / 6 / 7 st ×
inner 5 / 10 / 15 % × outer 10 / 15 / 20 % — `sim.mjs` configs `t*m*`,
`a*m*`, `a*i*o*`.) The two-stage rule keeps the 3-st precision on windows
that only carry a few outliers and switches to an octave-class-only trim
for windows that genuinely spread; the 6-st / 15 % refusal catches
register switches and octave-error runs. The inner stage keeps
fifth-class runs (likely creak) and voicing-boundary scoops out of steady
windows (the session inspection behind this is kept outside this
repository).

## 3. Window, coverage, cadence (one factor at a time around the shipped rule)

| variant | corpora MAE (reports) | vocadito MAE (reports) | synth 96-note MAE |
|---|---|---|---|
| **shipped** | 0.246 (76 %) | 0.121 (93 %) | 0.026 |
| coverage 0.5 | 0.255 (81 %) | 0.123 (93 %) | 0.029 |
| coverage 0.7 | 0.241 (63 %) | 0.120 (90 %) | 0.022 |
| window 0.75 s | 0.230 (79 %) | 0.108 (93 %) | 0.023 |
| window 1.5 s | 0.281 (73 %) | 0.143 (90 %) | 0.033 |
| recompute every 100 ms | 0.273 (78 %) | 0.151 (93 %) | 0.035 |
| EMA α 0.5 per message | 0.242 (76 %) | 0.121 (93 %) | 0.027 |

The session columns of this grid (report rates, speech / held MAE, false
readings) are kept outside this repository; a lower coverage gate raised
the false readings there.

(Earlier coarse grid, no refusal: coverage 0.3 / 0.4 reported on more
sparse windows but raised the false readings further; EMA α 0.3 per
100 ms cost +0.05 st MAE; 250 ms cadence +0.08.) The window stays at 1 s —
the training metric — though 0.75 s scores marginally better on the corpora.

## 4. Session detail (shipped parameters); painted trace as the source

The per-speaker, per-category and per-session breakdown (agreement by
voiced-fraction category and reference-SD bin, best windows, false readings
in reference-silent windows) was measured on the private session
recordings. Results on the private session recordings are kept outside
this repository.

**Painted trace as the source (what not to do).** The same rule fed the
painted values (display alignment, `sim.mjs --col=paint`): corpora MAE
0.345, vocadito 0.168 (r 0.88) — vs 0.246 and 0.121 (r 0.93) from the
posted values (§2) — and more false readings in silence (the 400 ms hold
bridge paints constant values through gaps; measured on the private
session recordings, kept outside this repository).

## 5. Display stability

Sampled at the hook's 200 ms state cadence, consecutive fresh readings differ
by a median 0.21–0.22 st on the corpora (p90 0.70–0.83); the one-decimal
string changes on 83–84 % of updates in running speech — the
1-s SD of speech genuinely moves that fast. On held notes the windows
overlap by 80 % and the value moves slowly: on the synthetic held notes the
median 200-ms step is 0.004–0.020 st and the digit changes on 19 % (new
cases) / 42 % (the precision pass's wandering notes) of updates. A per-message EMA (α 0.5–0.7) changes the median step by
< 0.01 st; a slower EMA (α 0.3 per 100 ms) costs +0.05 st MAE. No smoothing
shipped. The dim "held" state after a note keeps the display from
blanking between phrases. Flips between a number (fresh or held) and "—",
per minute of audio at the 200 ms cadence (`stability.py`): vocadito
15.4, FDA 23.8, PTDB 14.7 with the §9 hold rule (5.1 / 18.7 / 12.0 before
it, when refused windows mid-phonation showed the previous reading instead
of "—"; 31.7 / 48.8 / 21.0 with no hold). Session stability figures and
flip rates are kept outside this repository.

## 6. Register switches, sirens, vibrato, drift (synthetic, real chain)

Windows whose truth contains both notes of a jump or a wide sweep
(truth SD > 1 st), classified:

Re-measured after the §9 fix (`jumps.py defaults`, which now splits "—"
from held). Before it, every refused window here showed the OLD note's
reading held dim (0 % "—"; the refusal share below appeared as "held"):

| case | windows | "—" (shipped, §9) | held | large reading (≥ 1 st) | small reading (< 1 st) — shipped | small — precision-pass 3-st recipe |
|---|---|---|---|---|---|---|
| ±12 st jump, abrupt | 120 | 68–70 % | 0 % | 0 % | 30–33 % | 85–98 % |
| ±12 st jump, 80 ms glide | 117 | 68–69 % | 0 % | 0–9 % | 23–31 % | 95 % |
| ±7 st jump, abrupt | 76 | 68 % | 0 % | 3 % | 29 % | 97 % |
| ±7 st jump, 80 ms glide | 74 | 57–62 % | 0 % | 16–19 % | 22–24 % | 97–100 % |
| siren sine ±3 st (3 s) | 216 | 0 % | 0 % | 100 % | 0 % | 0 % |
| siren sine ±6 st (2 s) | 408 | 17 % | 0 % | 83 % | 0 % | 0 % |
| linear 12 st sweep in 1 s | 112 | 0 % | 0 % | 93 % | 7 % | 26 % |

The remaining "small" readings around jumps are windows where the other
note is a minority at the window edge (median 9 % of the window; 61 just
after the jump, 45 as the old note leaves): the reading describes the note
that fills the window, ~0.1–0.25 s late or early. A mid-switch window never
reads small. Sirens read large; the ±6 st siren (truth SD 3.0) reads a
median 2.3 (the outer trim drops its extremes) and is refused on 17 % of
windows.

**Vibrato is reported plainly as movement**, as the 1-s SD used in training does:
±25 / 50 / 100 c at 4.5–6.5 Hz reads 0.16 / 0.33 / 0.66 st (truth 0.18 /
0.35 / 0.71). Separating periodic vibrato from slow drift was not
attempted: it would need a vibrato detector validated on real labelled
vibrato, which none of the available corpora provide; the explainer says
"vibrato and slides count as movement". **Drift** 0.5 / 1 / 2 / 4 st/s reads
0.15 / 0.29 / 0.58 / 1.15 st (truth equal to 0.01). A "stable for N s"
indicator was not built: nothing measured here justifies a threshold for it.

## 7. Real-hook check (`hook-check.mjs`)

The real pitch + DSP workers over each full session, then the REAL hook driven
message by message (`handlePitchMessage` for every pitch message,
`handleAnalysisResult` for every DSP frame):

Run over the four private session recordings (and re-run after the §9
fix): zero mismatches on every check — hook state vs module, readout
column vs the oracle driver, posted values vs the attr dump. Results on
the private session recordings are kept outside this repository. The
refactor that moved the pitch-message handling into `handlePitchMessage`
leaves the display path bit-identical, and the offline scoring used exactly
the values the production chain posts.

## 8. Limitations

- **A steady tonal source is indistinguishable from a steady voice.**
  Fan-hum is read (≈0.07 st) until the notch promotes it (~5.9 s); steady
  room sources the worker posts voiced give readings too (seen on the
  private session recordings). The live trace paints the same audio.
- **Overlapping talkers** (babble) give intermittent large readings.
- **Agreement is ~0.1 st** on real speech (aggregate over the private
  session recordings), not the ~0.02 st the precision pass measured on
  synthetic held notes and on steady vocadito windows (reference SD
  < 0.5 st). That pass attributes the difference to which frames the
  worker voices (onset / offset scoops, creak runs) rather than to the
  estimator; its session check of this is kept outside this repository. The training metric's own
  pipeline (trim, voicing rules) is unknown; the readout tracks Praat AC
  under a stated cleaning rule, and reads high on some best windows of the
  private sessions (per-session detail kept outside this repository).
- **Sparse windows** (20–60 % voiced) get a reading far less often than
  speech-like ones; brief phrases (< ~0.6 s voiced) show "—" or the held
  previous value. Register switches / octave-error runs show "—" while the
  window is mixed (§6, §9), so the display flips to "—" more often in
  running speech than the pre-§9 hold-everything rule did (§5).
- Jump-edge windows can show the dominant note's steadiness for ~0.1–0.25 s (§6).
- **UI at phone height.** The dashboard's F0 column grows by ~14 px (label +
  value, the column's old bottom padding removed). Headless screenshots
  (375 × 760, 390 × 844, fake mic) show the stats row overlapping the bottom
  of the perceived-voice meter at both sizes — present on the unchanged
  baseline at 375 × 760 too (the full dashboard is taller than the viewport);
  not addressed here. This branch is based on a pre-#95 main: #95's bug
  batch makes the tab area scroll on small screens, which resolves the
  overlap once the branch is merged with main (layout deliberately not
  changed on this branch). The explainer popover stays on screen at 375 px; the
  Pitch-tab readout fits on the Hz / note line.
- The FDA laryngograph reference is cycle-rough (precision pass §4), which
  inflates the FDA MAE.

## 9. Review fix: the hold no longer masks trim refusals (2026-10-04, post-review)

**Defect (review of 100c24d, confirmed).** `compute()` sent every window that
did not qualify to the 1.5-s hold — a coverage failure (the voice stopped)
and a two-stage-trim refusal alike. During continuous phonation a register
switch or octave-error run therefore showed the OLD note's (small) reading,
dimmed, and never "—": on the synthetic jump windows 0 % showed "—". The
"refused 57–70 %" of the first version of §6 was the refusal rate *before*
the hold, not what the display showed.

**Fix** ([src/audio/steadiness.js](../src/audio/steadiness.js)):
`trimmedSpread` reports why it returned null (optional `info.reason`:
`ok` / `few` / `refused`). The tracker holds only when the window fails
coverage (or keeps fewer than `minValues` values); a trim refusal with
coverage OK shows "—" **and clears the last reading**, so silence right
after a refused switch does not resurrect the old note's value either.
The hold length is now the named constant `HOLD_SEC` (1.5 s, unchanged,
pending the user's decision); vibrato still counts as movement. The
explainer now says the readout appears after "about half a second of
voiced sound" (it reports at 0.6 s), shows "—" during a jump to a new note
or register, and dims briefly after the voice stops.

**Re-measured with the committed scripts** (`sim.mjs` configs `defaults` /
`rec_hold15` / `rec` / `untrimmed06` → `score.py` both conventions,
`jumps.py`, `stability.py`, `hook-check.mjs`):

- **Fresh readings are bit-identical** before and after on every message
  of every set (sessions, FDA, PTDB, vocadito, 144 synthetic cases,
  96 precision notes); `rec` (no hold) is byte-identical, i.e. the
  allocation-free insertion sort in `trimmedSpread` gives exactly the
  previous values. Every agreement number in §2–§4 and §6 (MAE, r, corpora,
  synthetic; the session bins and best windows are kept outside this
  repository) is therefore unchanged. Messages that showed a held value
  during or right after a trim refusal now show "—".
- **What the display shows** on the private session recordings: part of
  the old "shown" share in continuous speech was a stale held value; those
  windows now show "—". Results on the private session recordings are kept
  outside this repository.
- **Switch windows** (synthetic, truth SD > 1 st): ±7 / ±12 st jumps show
  "—" on 57–70 % (was 0 %) and held on 0 % (was 57–70 %); the small and
  large fresh shares are unchanged (§6 table). The residual held share in
  the synthetic jump family's full-coverage windows (fresh 77.6 %, shown
  80.6 %) comes from the 200 → 400 Hz +12 st glide case, where the worker
  posts intermittent unvoiced frames at the 400 Hz search ceiling: coverage
  fails, and the hold shows the NEW note's last reading — by design.
- **Noise only:** fresh readings unchanged (0 % on 11 of 13 classes).
  Babble: shown 86.7 → 22.3 % (= fresh; the rest "—"). Fan-hum: shown
  22.5 % (fresh 17.5 % before the notch promotes the hum at ~5.9 s, then the
  1.5 s hold as the posted voicing stops — a coverage failure).
- **Display flips** (number ↔ "—", per minute, §5): vocadito 5.1 → 15.4,
  FDA 18.7 → 23.8, PTDB 12.0 → 14.7 — the cost of not showing a stale
  value across a switch.
- **Real hook** (§7, re-run on the private session recordings): hook
  state == module bit for bit and the display readout column identical to
  the oracle driver; the shown / held shares are kept outside this
  repository.

**Not changed here:** layout. The phone-height overlap noted in §8 is the
pre-#95 layout this branch is based on; it resolves when the branch is
merged with main (#95 makes the tab area scroll on small screens).

## Reproduction

[scripts/steadiness/README.md](../scripts/steadiness/README.md). Unit tests:
`node tests/audio/steadiness-test.js` (checks: formatting, trim stages,
coverage, warm-up, vibrato / drift readings, 100 vs 300 Hz symmetry,
register switch → "—" with no hold across it, hold timeline fresh → held → "—" lasting 1.5 s (both bounds), non-finite-timestamp guard on a live reading, clock reset, cadence).

## 10. Decision: live-only readout, no post-voice hold (user, 2026-10-04)

The user chose a readout that only ever shows a live value: `HOLD_SEC` is
now 0 (the hold mechanism stays available as an option and keeps its unit
tests). Effect, from the §9 measurements: what the display shows
is now exactly the **fresh** reading — the `rec` (no hold) configuration,
whose output §9 reports byte-identical to the shipped fresh readings — so
every agreement figure (MAE, r, corpora, synthetic; the session figures
kept outside this repository) is unchanged, the "shown (fresh + held)" share drops to the "fresh" one, and
after the voice stops the reading clears to "—" when the 1 s window falls below
60 % voiced, ~0.4 s after the last voiced frame (not a hold: the window is
still mostly voiced until then). Vibrato keeps counting as movement (user
decision, same day). The explainer no longer mentions a dimmed value.
