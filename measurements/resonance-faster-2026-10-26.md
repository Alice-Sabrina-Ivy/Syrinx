# Resonance cue: can the dot follow a change sooner without losing accuracy? (2026-10-26)

Branch `resonance-faster` (from `beta` 87dc1e2). Public data only
(LibriSpeech dev-clean and test-other, CC BY 4.0). Pre-registration:
[resonance-faster-prereg-2026-10-26.md](resonance-faster-prereg-2026-10-26.md),
committed a366456 (sha256 b3c0040c…) before any candidate result.

**Answer: not with any of the 55 pre-registered candidates.** Every rule
that follows a change sooner also moves the dot more on an unchanged voice
(more jitter, more false "brighter / darker than your start", a larger
error against the reader's long-run value); the pre-registered guards stop
all of them. The cue is unchanged. Where the delay comes from and what is
left to try: §1, §5.

The owner's question (2026-10-26, after testing on a phone): "is there any
way to make the resonance meter more responsive / have less delay without
affecting accuracy?"

## 1. Latency budget (shipped cue, S0)

dev, 1.0 u steps (40 events per row; T50 / T90 = median time, s of audio
after the change, until the shown value is 50 % / 90 % of the way from the
old voice's control to the new one's; [method](#2-method)).

| stage (cumulative) | women up | women down | men up | men down |
|---|---|---|---|---|
| vtln bins (each bin = vtln's trailing ~1 s of voiced frames; shown as a 5-bin running median) | 1.2 / 1.8 | 1.2 / 1.9 | 1.4 / 2.0 | 1.5 / 1.9 |
| + 5 s voiced median of all bins | 4.6 / 6.6 | 4.9 / 7.1 | 4.7 / 7.5 | 5.7 / 7.4 |
| + utterance gate (admitted bins only) = the plain readout | 4.7 / 6.7 | 5.0 / 7.2 | 4.9 / 7.5 | 5.8 / 7.5 |
| + restart rule (shipped shown value) | 3.0 / 3.3 | 3.4 / 4.1 | 3.1 / 3.7 | 3.4 / 3.5 |
| + bin resolve, 0.2 s posts, drawn dot only | 3.2 / 3.6 | 3.6 / 4.5 | 3.4 / 3.9 | 3.6 / 3.6 |

Per stage:

| stage | delay | notes |
|---|---|---|
| vtln analysis | **1.2–1.5 s** T50 | each 150 ms bin sums the last 100 voiced 10 ms frames (~1 s of voicing, ~1.5–2 s of reading) |
| bin resolve | **0.10 s** (every bin, both sexes) | a bin is stamped when the pitch frames covering it arrive (the pitch worker's decode delay) |
| 5 s voiced median | **+3.4 to +4.2 s** T50, **+4.8 to +5.5 s** T90 | the dominant term: halfway needs ~2.5 s of new voiced speech, 90 % nearly all 5 s |
| utterance gate | +0.0 to +0.2 s | onsets watched for held notes ("warming") |
| restart rule | **−1.6 to −2.4 s** T50, −3.1 to −4.0 s T90 (1.0 u) | fires only when the 1.5 s and 5 s medians differ by ≥ 0.6 u: **0.5 u steps barely benefit** (T50 4.1–4.7 s, T90 5.4–7.5 s on dev) |
| worker posts (every 0.2 s of audio) + drawn | +0.1 to +0.4 s | mean wait 0.1 s |
| hook relay | ~0 | the hook stores the post in a ref; no state throttle on this path |
| cue-strip tick (250 ms) | mean 0.125 s, max 0.25 s | the dot and the header are read at 4 Hz |
| thumb transition (200 ms ease-out) | 50 % at 69 ms, 90 % at 148 ms | composited CSS transform |
| start-relative words | first "brighter / darker than your start" a median 2.9–3.6 s after a 1.0 u step for 3 of 4 rows, 8.2 s men down; never within 18 s in 11 of 80 | at an 18 s change the start is still being collected (the provisional start of 2026-10-26 follows the readout and partly absorbs the change) |

**End to end** (1.0 u): halfway in ~3.4–3.8 s, 90 % in ~3.8–4.7 s,
of which ~0.2–0.3 s is UI (tick + transition) and ~0.2–0.3 s posting /
resolve; the rest is the 1 s vtln window and the 5 s median as cut short by
the restart rule. 0.5 u: halfway in ~4.3–4.9 s, 90 % in ~5.6–7.7 s.

On the confirmation readers (test-other, S0 only, same method) the budget
has the same shape: bins 1.4–1.6 s, plain readout 5.3–5.9 s, shipped
posted 3.2–4.3 s T50 at 1.0 u (§3).

## 2. Method

- **Readers.** dev = LibriSpeech dev-clean, the first 10 men and 10 women by
  speaker id (all tuning). Confirmation = test-other, first 10 + 10 (fresh;
  never used by a Syrinx resonance pass). Per reader 54 s of reading
  (switch material) and 150 s with 0.3 s gaps (unchanged-voice guards)
  (`scripts/resonance/faster-prep.py`).
- **Steps.** The same speech re-rendered by the Voice Shaper's WORLD engine
  (`faster-streams.mjs`): N (unchanged), ±6 % formant scale (**0.5 u**:
  calibrated +0.53 / −0.50 u men, +0.51 / −0.46 u women) and ±12 % (**1.0 u**:
  +0.99 / −1.05, +0.95 / −0.99), the 1.0 u steps once with pitch kept and
  once with ±2 st. Switch streams N-X-N change at 18 s and back at 36 s
  (one up and one down event each); the controls are each variant alone.
  240 events per set (0.5 u: 20 per sex and direction; 1.0 u: 40).
- **Chain** (`faster.mjs`): the REAL pitch worker with the real FireRedVAD
  model, the hint relayed as the hook relays it with the voice gate on; the
  resonance worker's chain replayed (lab engine "frames" mode, narrowband
  detector, `resonanceCue.js`) with every vtln bin and every 0.2 s post
  logged. The REAL resonance worker ran beside it on every stream: **all
  151 440 posts equal on every field** (dev 75 720, confirmation 75 720).
- **Candidates** (`faster-candidates.mjs`) replayed over the logged bins
  (`faster-eval.mjs`): S0's replay = the posted u on 75 720 / 75 720 posts,
  `R-s1.5-j0.6-n4` = S0 on all of them. Bin-level candidates re-ran the chain
  with another vtln trail (`faster.mjs bins --trail=N`).
- **Row**: `cueStripModel.js` on each post (voiced = newest hint, holding =
  a voiced hint in the last 5 s, as the 2026-10-26 start study).
- **Targets / guards / selection**: as pre-registered. Score = the mean over
  16 cells (size × direction × sex × T50 / T90) of candidate / S0 median;
  ≤ 0.90 needed. Guards on the 150 s unchanged streams, men and women each:
  G1 SD of shown u ≤ S0 × 1.05; G2 false start words ≤ S0 + 1 point; G3
  |u − long-run| median and q90 ≤ S0 + 0.01 u; G4 first reading ≤ S0 + 0.05 s;
  G5 CPU ≤ S0 × 1.10; G6 `uPlain` identical; G7 drawn posts identical.

## 3. Results (dev)

S0's guard values (the bars): G1 SD 0.170 / 0.137 u (bar 0.178 / 0.144, men
/ women); G2 false words 12.9 / 12.0 % (bar 13.9 / 13.0); G3 median 0.097 /
0.094 u, q90 0.311 / 0.243 u; G4 first reading 5.5 / 5.7 s.

Times: s of audio, medians; "n/l" = not logged.

| cand | score | 0.5 u T50 / T90 (↑m ↑f ↓m ↓f) | 1.0 u T50 / T90 (↑m ↑f ↓m ↓f) | G1 SD m / f | G2 false % m / f | G3 med m / f | G3 q90 m / f | restarts/min m / f | fails |
|---|---|---|---|---|---|---|---|---|---|
| S0 | 1.00 | 4.1/7.3 4.7/7.2 4.7/5.4 4.5/7.5 | 3.4/3.9 3.2/3.6 3.6/3.6 3.6/4.5 | 0.170 / 0.137 | 12.9 / 12.0 | 0.097 / 0.094 | 0.311 / 0.243 | 0.64 / 0.12 | — |
| P | 1.45 | 4.6/7.9 5.0/7.5 5.9/8.1 5.9/8.0 | 5.1/7.7 5.0/6.9 6.1/7.7 5.3/7.4 | 0.151 / 0.137 | 10.9 / 11.6 | 0.094 / 0.094 | 0.282 / 0.236 | 0.00 / 0.00 | — |
| R-s1.0-j0.4-n2 | 0.66 | 2.7/3.6 2.5/2.9 2.9/3.3 2.9/4.4 | 2.3/3.6 2.0/3.0 2.3/3.4 2.1/3.5 | 0.255 / 0.183 | 21.9 / 16.8 | 0.126 / 0.107 | 0.423 / 0.295 | 4.96 / 2.92 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.4-n3 | 0.69 | 3.2/4.2 2.6/2.8 3.0/3.5 2.8/4.6 | 2.3/3.3 2.3/3.2 2.7/3.2 2.3/3.8 | 0.256 / 0.181 | 22.1 / 16.9 | 0.126 / 0.105 | 0.425 / 0.292 | 4.80 / 2.68 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.4-n4 | 0.72 | 3.4/3.5 2.9/3.0 3.6/3.8 3.0/4.7 | 2.7/3.3 2.5/3.2 2.9/3.2 2.5/3.6 | 0.257 / 0.182 | 22.2 / 16.6 | 0.127 / 0.103 | 0.423 / 0.295 | 4.32 / 2.56 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.5-n2 | 0.74 | 3.6/5.2 3.2/3.3 3.5/3.7 3.8/5.3 | 2.6/3.6 2.3/2.9 2.4/2.8 2.1/3.8 | 0.246 / 0.181 | 19.3 / 15.2 | 0.112 / 0.103 | 0.395 / 0.277 | 3.24 / 1.44 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.5-n3 | 0.77 | 3.6/5.3 3.4/3.6 3.6/3.9 4.4/5.5 | 2.7/3.4 2.5/3.2 2.8/3.2 2.3/3.5 | 0.244 / 0.178 | 18.3 / 14.8 | 0.111 / 0.103 | 0.397 / 0.273 | 2.88 / 1.28 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.5-n4 | 0.79 | 3.7/5.4 3.5/3.6 3.8/3.9 4.5/6.3 | 2.7/3.2 2.7/3.0 3.0/3.2 2.5/3.2 | 0.237 / 0.174 | 17.5 / 14.5 | 0.111 / 0.101 | 0.385 / 0.270 | 2.76 / 1.16 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.6-n2 | 0.81 | 3.9/5.9 3.5/4.6 3.9/4.2 4.5/7.5 | 2.7/3.6 2.3/2.9 2.7/2.9 2.3/3.7 | 0.236 / 0.165 | 16.3 / 14.2 | 0.103 / 0.099 | 0.371 / 0.263 | 2.12 / 0.72 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.6-n3 | 0.82 | 4.1/6.3 3.5/4.7 3.9/4.3 4.5/7.5 | 2.7/3.0 2.6/2.7 2.8/3.2 2.5/3.2 | 0.231 / 0.166 | 15.8 / 14.1 | 0.104 / 0.098 | 0.368 / 0.266 | 1.96 / 0.72 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.0-j0.6-n4 | 0.85 | 4.1/6.4 3.7/5.2 4.2/4.4 4.5/7.5 | 2.9/3.2 2.7/3.2 3.0/3.2 2.7/3.2 | 0.223 / 0.162 | 14.7 / 13.6 | 0.101 / 0.098 | 0.358 / 0.259 | 1.72 / 0.60 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.5-j0.4-n2 | 0.80 | 3.7/4.8 3.0/3.6 3.3/3.6 3.5/5.3 | 2.7/3.9 2.5/3.6 2.9/4.2 2.5/4.2 | 0.232 / 0.170 | 16.9 / 14.0 | 0.112 / 0.096 | 0.376 / 0.266 | 3.24 / 1.32 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.5-j0.4-n3 | 0.82 | 3.8/5.0 3.2/3.6 3.6/3.6 3.8/5.5 | 2.9/3.9 2.7/3.6 3.2/3.7 2.7/4.4 | 0.224 / 0.164 | 16.5 / 13.8 | 0.107 / 0.097 | 0.374 / 0.259 | 2.84 / 1.04 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.5-j0.4-n4 | 0.84 | 3.8/5.1 3.3/3.7 3.6/3.6 3.8/6.9 | 3.2/3.8 2.7/3.6 3.4/3.6 2.7/4.2 | 0.215 / 0.165 | 16.8 / 13.7 | 0.106 / 0.097 | 0.363 / 0.258 | 2.56 / 0.92 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| R-s1.5-j0.5-n2 | 0.87 | 4.1/5.9 3.6/3.9 4.1/4.3 4.5/7.3 | 2.7/3.8 2.7/3.6 2.9/3.9 2.5/4.4 | 0.207 / 0.162 | 15.0 / 13.5 | 0.101 / 0.096 | 0.349 / 0.250 | 1.72 / 0.60 | G1-m, G2-m, G3-m, G1-f, G2-f |
| R-s1.5-j0.5-n3 | 0.89 | 4.1/6.0 3.6/4.5 4.2/4.4 4.5/7.3 | 3.0/4.1 2.7/3.6 3.2/3.6 2.7/4.4 | 0.207 / 0.162 | 15.0 / 13.3 | 0.100 / 0.096 | 0.351 / 0.248 | 1.64 / 0.56 | G1-m, G2-m, G3-m, G1-f, G2-f |
| R-s1.5-j0.5-n4 | 0.91 | 4.1/6.3 3.9/5.6 4.4/4.5 4.5/7.3 | 3.2/3.8 3.0/3.4 3.4/3.6 2.7/4.2 | 0.205 / 0.162 | 14.3 / 13.1 | 0.100 / 0.095 | 0.338 / 0.248 | 1.36 / 0.44 | G1-m, G2-m, G3-m, G1-f, G2-f |
| R-s1.5-j0.6-n2 | 0.95 | 4.1/6.5 4.6/7.2 4.6/5.3 4.6/7.5 | 3.0/4.2 2.7/3.6 3.2/3.6 2.7/4.3 | 0.166 / 0.137 | 13.2 / 12.1 | 0.098 / 0.094 | 0.311 / 0.243 | 1.04 / 0.12 | — |
| R-s1.5-j0.6-n3 | 0.97 | 4.1/6.6 4.7/7.2 4.6/5.3 4.8/7.5 | 3.2/4.1 3.0/3.5 3.4/3.6 2.9/4.4 | 0.170 / 0.137 | 13.0 / 12.0 | 0.098 / 0.094 | 0.311 / 0.243 | 0.72 / 0.12 | — |
| R-s1.5-j0.6-n4 | 1.00 | 4.1/7.3 4.7/7.2 4.7/5.4 4.5/7.5 | 3.4/3.9 3.2/3.6 3.6/3.6 3.6/4.5 | 0.170 / 0.137 | 12.9 / 12.0 | 0.097 / 0.094 | 0.311 / 0.243 | 0.64 / 0.12 | — |
| T-s1.0-j0.4-n2 | 0.63 | 2.6/3.0 2.3/2.7 2.7/3.5 2.6/3.6 | 2.4/3.2 2.1/3.2 2.3/3.5 2.3/3.2 | 0.268 / 0.194 | 23.9 / 18.2 | 0.132 / 0.118 | 0.431 / 0.320 | 8.64 / 6.08 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.4-n3 | 0.66 | 2.8/3.5 2.4/2.8 2.9/3.6 2.3/3.8 | 2.5/3.4 2.3/3.2 2.7/3.4 2.3/3.3 | 0.270 / 0.196 | 24.5 / 18.6 | 0.131 / 0.119 | 0.432 / 0.321 | 8.00 / 5.56 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.4-n4 | 0.68 | 3.2/3.4 2.8/3.0 3.2/3.6 2.6/3.4 | 2.6/3.2 2.3/3.2 2.7/3.4 2.5/3.3 | 0.264 / 0.187 | 23.7 / 18.2 | 0.132 / 0.118 | 0.429 / 0.316 | 7.04 / 4.96 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.5-n2 | 0.67 | 3.0/3.6 2.7/2.8 2.6/3.4 3.2/3.8 | 2.5/3.6 2.0/3.0 2.5/3.0 2.1/3.6 | 0.256 / 0.183 | 21.4 / 16.4 | 0.126 / 0.106 | 0.420 / 0.301 | 5.84 / 3.36 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.5-n3 | 0.69 | 3.4/3.6 2.8/2.8 3.2/3.3 3.4/3.9 | 2.4/3.6 2.3/3.0 2.7/3.2 2.3/3.6 | 0.246 / 0.182 | 21.0 / 15.7 | 0.127 / 0.106 | 0.421 / 0.301 | 5.16 / 3.00 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.5-n4 | 0.72 | 3.5/3.8 3.2/3.2 3.4/3.4 3.6/4.2 | 2.7/3.2 2.5/3.0 2.7/3.3 2.5/3.2 | 0.240 / 0.178 | 20.6 / 15.2 | 0.126 / 0.106 | 0.412 / 0.295 | 4.76 / 2.60 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.6-n2 | 0.73 | 3.6/3.7 3.0/3.0 3.6/3.8 4.5/5.4 | 2.7/3.2 2.3/2.7 2.7/3.0 2.1/3.7 | 0.237 / 0.165 | 18.5 / 13.4 | 0.111 / 0.099 | 0.388 / 0.276 | 3.56 / 1.60 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.6-n3 | 0.77 | 3.6/5.0 3.3/3.8 3.7/3.9 4.5/6.3 | 2.7/2.9 2.5/2.8 2.9/3.2 2.3/3.2 | 0.238 / 0.164 | 17.8 / 13.5 | 0.110 / 0.101 | 0.385 / 0.276 | 3.20 / 1.56 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.0-j0.6-n4 | 0.81 | 3.7/5.0 3.6/4.7 3.8/3.9 4.5/7.3 | 2.9/3.0 2.7/2.9 3.2/3.2 2.5/3.2 | 0.233 / 0.163 | 17.6 / 13.4 | 0.110 / 0.100 | 0.377 / 0.270 | 3.04 / 1.48 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.5-j0.4-n2 | 0.73 | 3.6/3.9 2.9/3.3 3.2/3.6 2.7/3.9 | 2.7/3.6 2.5/3.6 2.9/3.6 2.5/3.6 | 0.245 / 0.175 | 19.7 / 16.0 | 0.122 / 0.115 | 0.389 / 0.287 | 6.88 / 4.76 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.5-j0.4-n3 | 0.78 | 3.6/3.9 3.2/3.6 3.4/3.7 2.8/4.2 | 2.8/4.1 2.7/3.8 3.2/3.7 2.6/3.9 | 0.241 / 0.174 | 19.2 / 15.9 | 0.118 / 0.108 | 0.387 / 0.288 | 6.44 / 4.04 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.5-j0.4-n4 | 0.78 | 3.7/4.1 3.2/3.6 3.4/3.8 3.0/4.3 | 3.0/3.6 2.7/3.6 3.4/3.6 2.7/3.9 | 0.235 / 0.174 | 19.0 / 15.6 | 0.115 / 0.108 | 0.387 / 0.289 | 5.64 / 3.72 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.5-j0.5-n2 | 0.78 | 3.7/4.5 3.4/3.6 3.3/3.8 3.5/4.4 | 2.7/3.7 2.5/3.6 2.9/3.7 2.5/3.8 | 0.239 / 0.170 | 18.5 / 14.6 | 0.116 / 0.096 | 0.386 / 0.276 | 4.64 / 2.12 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.5-j0.5-n3 | 0.82 | 4.1/5.4 3.5/3.6 3.5/3.8 3.9/4.4 | 2.9/3.7 2.7/3.6 3.0/3.6 2.7/4.2 | 0.225 / 0.171 | 17.5 / 14.5 | 0.109 / 0.097 | 0.372 / 0.276 | 3.88 / 1.88 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.5-j0.5-n4 | 0.82 | 3.9/5.1 3.5/3.7 3.6/3.6 3.8/5.1 | 3.2/3.6 2.7/3.6 3.4/3.6 2.7/4.1 | 0.223 / 0.172 | 17.7 / 13.9 | 0.110 / 0.095 | 0.371 / 0.276 | 3.68 / 1.80 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| T-s1.5-j0.6-n2 | 0.86 | 3.9/5.3 3.7/4.7 3.7/4.1 4.6/6.8 | 2.9/3.7 2.7/3.4 3.0/3.7 2.6/4.1 | 0.216 / 0.150 | 16.4 / 12.8 | 0.104 / 0.095 | 0.353 / 0.250 | 2.72 / 1.08 | G1-m, G2-m, G3-m, G1-f |
| T-s1.5-j0.6-n3 | 0.90 | 4.1/5.9 4.3/5.4 3.8/4.3 4.8/6.9 | 3.2/3.6 2.9/3.4 3.2/3.6 2.7/4.4 | 0.209 / 0.151 | 16.3 / 12.7 | 0.102 / 0.096 | 0.351 / 0.247 | 2.32 / 0.88 | G1-m, G2-m, G3-m, G1-f |
| T-s1.5-j0.6-n4 | 0.92 | 4.1/6.0 4.3/5.7 3.9/4.6 4.5/7.3 | 3.3/3.6 3.2/3.4 3.5/3.6 3.0/4.4 | 0.205 / 0.149 | 15.5 / 12.7 | 0.101 / 0.094 | 0.342 / 0.245 | 1.88 / 0.72 | G1-m, G2-m, G3-m, G1-f |
| Z-k1.5-n2 | 0.72 | 2.8/3.7 2.5/3.5 3.4/3.4 2.4/4.4 | 2.7/3.6 2.7/3.6 2.8/3.7 2.7/3.6 | 0.247 / 0.187 | 19.9 / 16.7 | 0.135 / 0.122 | 0.388 / 0.295 | 9.80 / 7.56 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| Z-k1.5-n4 | 0.77 | 3.4/3.8 2.8/3.8 3.4/3.9 2.7/4.4 | 2.9/3.6 2.7/3.6 3.2/3.8 2.7/3.8 | 0.238 / 0.183 | 19.9 / 16.5 | 0.133 / 0.120 | 0.386 / 0.297 | 7.48 / 6.00 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| Z-k2.0-n2 | 0.73 | 3.0/4.1 2.6/3.6 3.3/3.6 2.3/4.1 | 2.7/3.6 2.7/3.6 2.8/3.7 2.7/3.6 | 0.243 / 0.173 | 18.5 / 15.7 | 0.130 / 0.117 | 0.390 / 0.288 | 7.60 / 5.84 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| Z-k2.0-n4 | 0.78 | 3.4/3.9 3.2/3.6 3.6/3.8 2.7/4.4 | 3.2/3.6 2.7/3.6 3.2/3.7 2.7/3.8 | 0.230 / 0.176 | 18.7 / 16.6 | 0.127 / 0.116 | 0.389 / 0.294 | 5.96 / 4.88 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| Z-k2.5-n2 | 0.79 | 3.7/4.2 2.9/3.9 3.6/3.6 2.7/4.4 | 3.2/4.1 2.7/3.7 3.0/3.8 2.7/3.6 | 0.225 / 0.173 | 17.0 / 15.1 | 0.122 / 0.111 | 0.376 / 0.282 | 5.72 / 3.72 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| Z-k2.5-n4 | 0.82 | 3.8/5.2 3.2/3.7 3.7/4.1 2.9/4.7 | 3.2/4.1 2.7/3.7 3.4/3.8 2.8/3.8 | 0.208 / 0.175 | 16.8 / 15.3 | 0.114 / 0.110 | 0.369 / 0.277 | 4.20 / 3.20 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| H4.0 | 0.97 | 3.8/6.3 4.1/6.5 4.5/5.9 3.9/6.8 | 3.4/4.1 3.4/3.6 3.6/3.6 3.6/4.6 | 0.180 / 0.149 | 14.2 / 12.8 | 0.103 / 0.100 | 0.327 / 0.253 | 0.68 / 0.16 | G1-m, G2-m, G3-m, G1-f |
| H3.5 | 0.93 | 3.3/6.0 4.1/5.6 4.3/5.2 3.8/6.2 | 3.2/4.3 3.4/3.6 3.6/3.6 3.6/4.6 | 0.192 / 0.155 | 15.3 / 13.6 | 0.112 / 0.106 | 0.339 / 0.265 | 0.72 / 0.12 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| E-tm20 | 1.03 | 4.5/6.9 5.2/7.3 4.6/6.0 5.2/7.4 | 3.4/4.1 3.2/3.6 3.6/3.7 3.6/4.5 | 0.167 / 0.134 | 12.2 / 11.3 | 0.090 / 0.087 | 0.306 / 0.226 | 0.64 / 0.12 | — |
| E-hub | 1.03 | 4.6/7.0 5.1/7.4 4.6/6.1 4.8/7.7 | 3.4/4.1 3.2/3.6 3.6/3.7 3.6/4.5 | 0.165 / 0.133 | 12.5 / 11.4 | 0.090 / 0.085 | 0.305 / 0.223 | 0.64 / 0.12 | — |
| E-ewm2.5 | 0.89 | 3.3/6.3 3.7/6.4 3.8/5.0 3.4/6.1 | 3.2/3.6 3.2/3.5 3.5/3.6 3.5/4.1 | 0.179 / 0.144 | 13.9 / 13.0 | 0.101 / 0.099 | 0.318 / 0.249 | 0.64 / 0.12 | G1-m, G2-m, G1-f |
| E-ewm1.5 | 0.80 | 3.2/5.4 3.0/5.1 3.3/4.4 2.8/4.8 | 3.0/3.4 3.2/3.5 3.2/3.6 2.9/3.6 | 0.198 / 0.156 | 16.0 / 13.8 | 0.110 / 0.106 | 0.338 / 0.265 | 0.64 / 0.12 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| K-q0.02 | 0.70 | 2.3/4.1 2.0/3.9 2.3/4.1 2.0/4.1 | 2.3/4.4 2.0/4.2 2.5/4.3 1.9/4.1 | 0.221 / 0.187 | 21.7 / 17.1 | 0.134 / 0.123 | 0.386 / 0.300 | 0.00 / 0.00 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| K-q0.05 | 0.54 | 1.9/3.2 1.6/3.2 1.8/3.2 1.7/2.9 | 1.8/3.3 1.6/3.2 2.0/3.3 1.6/3.0 | 0.253 / 0.211 | 26.2 / 20.6 | 0.151 / 0.138 | 0.433 / 0.342 | 0.00 / 0.00 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| K-q0.1 | 0.47 | 1.6/2.7 1.4/2.6 1.7/2.6 1.4/2.6 | 1.8/2.8 1.4/2.5 1.8/2.7 1.4/2.6 | 0.268 / 0.226 | 28.2 / 22.8 | 0.162 / 0.147 | 0.459 / 0.368 | 0.00 / 0.00 | G1-m, G2-m, G3-m, G1-f, G2-f, G3-f |
| B-t70 | 0.98 | 4.3/7.2 4.7/7.0 4.3/6.2 5.1/7.2 | 3.3/3.8 3.0/3.6 3.3/3.6 2.8/4.5 | 0.171 / 0.134 | 13.2 / 11.0 | 0.099 / 0.086 | 0.316 / 0.231 | n/l | G6 |
| B-t50 | 0.94 | 3.9/6.5 4.5/6.6 4.4/6.5 4.4/7.1 | 3.2/3.8 3.0/3.4 3.3/3.4 2.7/3.5 | 0.186 / 0.139 | 12.0 / 11.6 | 0.108 / 0.092 | 0.320 / 0.228 | n/l | G1-m, G3-m, G6 |

- **Passing every guard:** S0, P (not selectable), R-s1.5-j0.6-n2 / -n3
  (scores 0.95 / 0.97), E-tm20 and E-hub (1.03: *slower*, but steadier and
  closer to the long-run value — G1 0.165–0.167 / 0.133–0.134, G3 median
  0.090 / 0.085–0.087). None reaches score ≤ 0.90. **Pick: none.**
- Every candidate with score ≤ 0.90 fails G1 (jitter) for men, and almost
  all also G2 and G3 for men; the closest is **E-ewm2.5** (score 0.89):
  G1 0.179 / 0.144 against bars 0.178 / 0.144, G2 men 13.9 % against 13.9.
- **Kalman filters (K)** are the fastest (score 0.47–0.70) and the most
  jittery (SD +30 to +65 %, false words +5 to +15 points).
- **Restart retunes (R / T / Z)**: lowering `jumpU` to 0.4–0.5 or `shortS`
  to 1.0 s makes 0.5 u steps follow in ~2.5–3.5 s, but restarts on an unchanged
  voice rise from 0.6 / 0.1 to 0.4–9.8 per minute (men / women) and each
  restart shows a 1–1.5 s median for a moment.
- **vtln trail (B)**: 70 / 50 voiced frames per bin (score 0.98 / 0.94)
  changes the pitch-only warning's input (G6; uPlain differs on 67 000 posts),
  and B-t50 also fails G1 / G3 for men. CPU: 16.68 / 16.82 vs 16.95 ms per
  audio s (Node, interleaved, 6 readers × 3 reps) — the per-frame scoring
  dominates, not the trailing sum.
- **CPU (G5)**: a cue-only readout costs 0.003–0.10 ms per audio s in Node
  (S0 0.033), against ~17 ms for the chain — every cue-only candidate passes
  G5 (< 1 %). Chrome for Testing was not run: no candidate needed it.
- G4, G6 and G7 hold for every cue-only candidate (by construction; checked
  on all 75 720 posts).

**Exploratory, post-hoc (not pre-registered, not eligible):** 24 cells
combining the steadier statistics (Huber, trimmed mean) with shorter
horizons (4, 3.5 s) and faster restarts. The ones that pass every guard
(Huber / trimmed mean, 5 s, R-s1.5-j0.6-n2) score 1.02–1.03; every faster
cell (0.83–0.96) fails at least two of G1–G3. The same frontier
(`scripts/resonance/faster-explore.mjs`).

**Confirmation set:** per the rule nothing went to it. S0 (and P) were run
for the budget (§1): S0 targets 3.2–5.4 s T50, 4.1–9.3 s T90; P score 1.44
(as on dev, 1.45). Reported, no bar: on this harder, more expressive
reading the shipped restart costs more than on dev — SD 0.232 / 0.206 vs P
0.188 / 0.180 u, false start words 20.0 / 20.7 % vs 18.1 / 18.2 %, restarts
1.5 / 2.0 per minute (men / women).

## 4. Pitch-only warning

Unchanged: no code changed, and every cue-only candidate kept `uPlain`
(the warning's input) identical by construction (checked); its harness was
not re-run.

## 5. Limitations, and what is left

- WORLD-rendered steps of one reader's own speech (with and without a pitch
  change) model a deliberate resonance change; real practice changes are
  slower, partial and come with articulation changes. Reading only; no real
  rooms, phones, the owner's voice or long pauses.
- Guards on 150 s of each reader; the jitter guard (×1.05) is tight and
  decided almost every case, for men's voices.
- **What would cut the delay** — each a product trade-off for the owner,
  not a measured win:
  1. **Accept more movement on an unchanged voice.** E.g. R-s1.0-j0.6-n4
     (score 0.85: 1.0 u steps halfway in 2.7–3.0 s, 0.5 u in 3.7–4.5 s)
     costs SD +31 % (men) / +18 % (women), false start words +1.8 / +1.6
     points, restarts 1.7 / 0.6 per minute. E-ewm2.5 (0.89) is the
     cheapest faster option (+5 % SD, +1.0 / +1.0 points).
  2. **UI only, value unchanged** (reported, not selectable): a 100 ms
     thumb (U1) saves ~35 / 74 ms to 50 / 90 % of a move; a 125 ms tick (U2)
     ~60 ms mean, at main-thread cost on phones; 0.1 s posts (U3) ~50 ms,
     but the pitch-only warning hears every post. Together < 0.2 s of the
     ~3.5 s.
  3. **Show the short-term reading separately** (e.g. a faint second marker
     for the last ~1.5 s), so movement shows at once while the main dot
     stays steady: a design change, not measured here.
  4. A better vtln bin (less than ~1 s of voicing per bin without more
     noise) would move the floor; B-t50 / B-t70 did not.

## Reproduce

```
python -P scripts/resonance/faster-prep.py --libri=<dir with LibriSpeech/> --split=dev-clean --tag=dev
python -P scripts/resonance/faster-prep.py --libri=<...> --split=test-other --tag=conf
node scripts/fetch-firered-model.mjs
V=N:0:0,U05:0:6,D05:0:-6,U10:0:12,D10:0:-12,U10m:2:12,D10m:-2:-12
node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/faster-streams.mjs --tag=dev --variants=$V
node scripts/resonance/faster.mjs pitch --tag=dev --shard=i/4                  # i = 0..3
node scripts/resonance/faster.mjs bins  --tag=dev --worker --shard=i/4
node scripts/resonance/faster.mjs bins  --tag=dev --trail=70 --shard=i/4       # and 50
node scripts/resonance/faster-eval.mjs --runs=<bins-dev-main-*of4.jsonl> [--trail-runs="B-t70:<...>;B-t50:<...>"]
node scripts/resonance/faster-budget.mjs --runs=<...> --size=1.0               # and 0.5
node scripts/resonance/faster-cpu.mjs --tag=dev
# calibration: faster-streams --variants=N:0:0,C-12:0:-12,C-6:0:-6,C+6:0:6,C+12:0:12, then faster.mjs pitch/bins --set=calib
```
