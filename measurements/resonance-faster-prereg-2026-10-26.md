# Resonance cue: a more responsive dot — pre-registration (2026-10-26)

Committed before any candidate result is computed (CLAUDE.md hard rule 3,
cue-strip modules). Study note:
[resonance-faster-2026-10-26.md](resonance-faster-2026-10-26.md). Branch
`resonance-faster` from `beta` 87dc1e2.

## Question

The owner (2026-10-26, after testing on a phone): "is there any way to make
the resonance meter more responsive / have less delay without affecting
accuracy?" The shipped cue (`src/resonance/resonanceCue.js`) shows the
median of admitted vtln bins over the trailing 5 s of voiced time, with the
2026-10-21 restart rule (`RESTART = { shortS 1.5, jumpU 0.6, confirmN 4 }`).

## What was computed before this file was committed

- the stimuli and the step-size calibration below (controls only: no
  candidate, no switch stream, no shipped-cue timing);
- the harness check: the bins replica (`scripts/resonance/faster.mjs bins`)
  equals the REAL resonance worker on every field of all 240 posts of one
  dev control stream.

## Data (public only)

- **dev** (all tuning): LibriSpeech **dev-clean**, the first 10 men and 10
  women by numeric speaker id (174, 251, 422, 652, 777, 1272, 2078, 2086,
  2428, 2803 / 84, 1462, 1673, 1919, 1988, 1993, 2035, 2277, 2412, 3081).
  dev-clean was the dev split of the earlier resonance passes too.
- **confirmation** (run once, for S0 and the single dev pick): LibriSpeech
  **test-other**, the first 10 men and 10 women by numeric speaker id (1688,
  2033, 2414, 2609, 3005, 4198, 4350, 4852, 5764, 6432 / 367, 533, 1998, 3080,
  3331, 3528, 3538, 3764, 3997, 4294). Never used by any earlier Syrinx
  resonance pass (the spent held-out readers were test-clean).
- Per reader (`scripts/resonance/faster-prep.py`): **src** = the first 54 s
  of the reader's utterances in (chapter, utterance) order, concatenated;
  **long** = the first 150 s of utterances with 0.3 s gaps.
- **Variants** (`scripts/resonance/faster-streams.mjs`, the app's Voice
  Shaper WORLD engine, posted pitch track of the real chain, as the
  2026-10-21 study): N (0 st, 0 %), U05 (+6 %), D05 (−6 %), U10 (+12 %),
  D10 (−12 %), U10m (+2 st, +12 %), D10m (−2 st, −12 %) formant scale.
  **Step calibration** (dev controls, median over readers of the change of
  the stream's median admitted bin vs N): ±6 % = +0.53 / −0.50 u (men),
  +0.51 / −0.46 u (women); ±12 % = +0.99 / −1.05 u (men), +0.95 / −0.99 u
  (women). So U05 / D05 are **0.5 u** steps and U10 / D10 **1.0 u** steps.
- **Streams** per reader (`faster.mjs`, set `main`): controls N, U05, D05,
  U10, D10, U10m, D10m (54 s each); switches N-U05-N, N-D05-N, N-U10-N,
  N-D10-N, N-U10m-N, N-D10m-N (segments 0–18 / 18–36 / 36–54 s, 10 ms
  crossfades); the reader's own **long** recording L (150 s, unchanged
  voice). Each switch stream gives one up and one down event (N-U-N: up at
  18 s, down at 36 s; N-D-N: down at 18 s, up at 36 s): per reader 2 up +
  2 down events at 0.5 u and 4 up + 4 down at 1.0 u (pitch kept and pitch
  moves pooled).

## Chain

- `faster.mjs pitch`: the REAL pitch worker with the real FireRedVAD model
  (frozen clock), 1200-sample chunks at 48 kHz.
- `faster.mjs bins`: the resonance worker's chain replayed exactly as
  `resonance-worker.js` runs it (lab engine "frames" mode, narrowband
  detector, `resonanceCue.js`), hints relayed as the hook relays them with
  the voice gate on (the app's default); every vtln bin (stamp, admitted,
  when it was stamped) and every 0.2 s post logged. `--worker` runs the REAL
  resonance worker beside it and checks every state-post field equal; it is
  run on every dev and confirmation stream for S0.
- A cue-only candidate is replayed over the logged bins (admitted flags and
  voiced clock as the cue saw them, the bin count at each post): exact, since
  only the shown value changes. Check: S0's replay equals the posted u
  bit for bit on every post; `R-s1.5-j0.6-n4` equals S0.
- Row model per post (as the 2026-10-26 start study): `cueStripModel.js`
  `resonanceRowState` / `rowValue` / `dotOpacity` / `resonanceHeader` with the
  candidate's u / raw / clamp and the post's other fields; voiced = the newest
  relayed hint, holding = a voiced hint in the last 5 s. A post is **drawn**
  when the row draws a dot.

## Latency budget (reported, no bar)

Per stage, women and men, on the dev 1.0 u events (S0): the bins' own
response (a 5-bin running median of the switch stream's bins against the
controls' — vtln's ~1 s trailing sum), bin resolve delay (stamp time − bin
end), utterance-gate drops (5 s median of all bins vs of admitted bins),
the 5 s voiced median (plain), the restart rule (S0 vs plain), the worker's
0.2 s post cadence, the hook (stores the post; no throttle on this path), the
cue strip's 250 ms tick, its 200 ms ease-out thumb transition, and the
start-relative words (time until the header changes word after a 1.0 u
step).

## Candidates

All in `scripts/resonance/faster-candidates.mjs` (committed with this file).
Cue-only candidates change only the shown value; fill, voicedS, the drop
rules, narrowband, sinceResumeS, `uPlain` and the start collection stay the
plain 5 s readout's.

| id | what |
|---|---|
| S0 | shipped (5 s voiced median + restart s1.5 j0.6 n4) |
| P | plain 5 s median (reported only) |
| R-s{1.0,1.5}-j{0.4,0.5,0.6}-n{2,3,4} | the shipped restart rule retuned (18 cells, incl. S0's) |
| T-s{1.0,1.5}-j{0.4,0.5,0.6}-n{2,3,4} | two-sample restart: short median vs the median of the window's older items (≥ 7 of them) (18) |
| Z-k{1.5,2.0,2.5}-n{2,4} | scale-adaptive two-sample restart, short 1.5 s, threshold max(0.3 u, k × 1.4826 MAD of the older items) (6) |
| H4.0, H3.5 | shipped restart on a 4.0 / 3.5 s voiced horizon (2) |
| E-tm20, E-hub, E-ewm2.5, E-ewm1.5 | shipped restart; shown value = 20 % trimmed mean / Huber M-estimate / exponentially weighted median (half-life 2.5 / 1.5 voiced s) (4) |
| K-q0.02, K-q0.05, K-q0.1 | robust random-walk level filter over admitted bins (measurement SD 0.3 u, innovations clipped at 2 SD), no restart (3) |
| B-t70, B-t50 | bin-level: vtln summed over the trailing 70 / 50 voiced frames per bin (shipped 100), shipped readout; needs a bins re-run (2) |
| U1–U3 | UI-side, value unchanged: thumb transition 200 → 100 ms (U1), cue-strip tick 250 → 125 ms (U2), worker post 0.2 → 0.1 s (U3). **Reported only** (their gain is the latency budget's arithmetic); not selectable — U2 costs main-thread CPU on phones and U3 changes the pitch-only warning's input cadence; adopting any is the owner's call. |

## Targets

Per event: the join time tj; for each post in (tj, tj + 18 s]: p = (u −
u_old) / (u_new − u_old), u = the candidate's shown u on the switch stream,
u_old / u_new = the candidate's shown u on the reader's controls of the old /
new variant at the same post (posts where either control has no u are
skipped). **T50** / **T90** = the first drawn post with p ≥ 0.5 / ≥ 0.9,
minus tj; never = 18 s (censored).

Cells: size {0.5, 1.0 u} × direction {up, down} × sex {men, women} × {T50,
T90} = 16; each cell = the median over its events.

**Score** = the mean over the 16 cells of (candidate's median / S0's
median). A candidate counts as an improvement only with score ≤ 0.90.

## Guards (men and women separately; each must hold for both)

On the long unchanged-voice streams L unless stated:

- **G1 jitter:** median over readers of the SD of the shown u over the
  drawn posts ≤ S0's × 1.05.
- **G2 false start words:** share of word posts (state live / holding,
  header "about where you started" / "brighter than your start" / "darker
  than your start", start = the shipped `shownStartU`) that say brighter /
  darker, pooled over readers ≤ S0's + 1.0 point.
- **G3 agreement:** |shown u − the reader's long-run u| over drawn posts,
  pooled; long-run u = the median of all admitted bins of the L stream.
  Median ≤ S0's + 0.01 u and q90 ≤ S0's + 0.01 u.
- **G4 time to first reading:** median over readers of the time of the
  first drawn post ≤ S0's + 0.05 s.
- **G5 CPU:** the resonance chain's ms per audio second (Node, the bins
  replica without logging, interleaved S0 / candidate runs on the dev L
  streams; for a cue-only candidate its readout's own cost is added to the
  shipped chain's) ≤ S0's × 1.10. Desktop Chrome for Testing
  (`scripts/resonance/chrome-cpu.mjs`) is reported if it can run here.
- **G6 pitch-only warning input:** `uPlain` identical to S0's on every post
  of every stream (cue-only candidates hold by construction; checked).
- **G7 positions:** the drawn posts identical to S0's on every stream
  (cue-only: by construction; checked). Bin-level candidates are exempt
  from G7 and judged on G4.

## Selection rule

Among the candidates (not P, not U) that pass G1–G7 on dev and have a dev
score ≤ 0.90: the lowest dev score; within 0.02 of it, the fewest restarts
per minute on the dev L streams, then the earlier family in the order R, T,
Z, H, E, K, B. Then the **confirmation** set, run once for S0 and that pick:
it must pass G1–G7 there too (G5 is not re-run) and have a confirmation
score ≤ 0.90. If it fails, or no candidate qualifies on dev, **nothing
changes in the cue**; the note reports the best trade-offs (per guard, the
candidates closest to passing). There is no second pick.

## Reported, no bar

T50 / T90 per cell for every candidate; the 1.0 u events split by pitch
kept / pitch moves; post-to-post |Δu| p90; restarts per minute on L;
"about where you started" share; the header's first right word after a step;
U1–U3's arithmetic.

## Out of scope

The pitch-only warning (reads `uPlain`, unchanged by every eligible
candidate); the lab tab's readout; real rooms, phones and the owner's own
voice.
