# Resonance row: why going up feels slow and coming back feels fast (2026-10-21)

Branch `resonance-asymmetry` (from `cue-strip` 54472d3). Public data only
(LibriSpeech dev-clean for this pass; test-clean is held out for the plan
below). Dev candidate results and the pick: §Dev results (committed before
any held-out run). **Held-out: the pick fails bar 4** (§Held-out result).
**User decision 2026-10-21: shipped anyway** (§User decision).

## Why

User report 2026-10-21 (phone, cue-strip 54472d3, voice gate on): starting
at a low (male) resonance and then switching to a high (female) one, the
Dashboard resonance row takes several seconds of speech to adjust; going
back down, it adjusts quickly.

## Method

**Stimuli** (`scripts/resonance/switch-prep.py`, `switch-streams.mjs`): the
first 54 s of each of 10 dev-clean readers (5 men, 5 women; the first 5 of
each sex by speaker id in the `r1_dev` manifest).

- (a) **Same reader, resonance changed by the Voice Shaper's WORLD engine**
  (`src/voice-preview/engine/preview.js`, the app's own engine; pitch track
  from the real pitch chain). Two versions of the whole 54 s: *dark*
  (formants −8 %) and *bright* (formants +9 %). Two pitch modes: *pitch
  kept* (0 st both) and *pitch moves* (dark −3 st, bright +3 st, as people
  raise pitch with resonance).
- (b) **Different real readers** back to back: man *i* → woman *i* → man *i*
  and the reverse (5 pairs), each segment taken from that reader's own
  recording at that time.

Streams are spliced from these (10 ms crossfades). Join patterns: **18/36**
(three 18 s segments), **30/36** (30 s, then a 6 s excursion, then back),
**30/40** (a 10 s excursion). Both orders (dark first / bright first).
**Controls:** the same audio with no switch (all dark, all bright, or the
reader's own recording). The row has settled when it shows what the control
shows at the same moment, so text and timing are matched chunk for chunk.

**Driver** (`scripts/resonance/switch-asymmetry.mjs`): the REAL pitch worker
with the real FireRedVAD model, the REAL DSP worker, the REAL hook (voice
gate setting on), the REAL resonance worker, and the REAL row logic
(`cueStripModel.js`). Two arms: **off** (hint as posted, row on the raw
flags) and **on** (hint hidden where the detector hears no voice, row on the
gated flags; what cue-strip ships). Next to each resonance worker runs a
replica built from the same modules, with a tap on every vtln bin; its
posts equal the worker's on all 96 000 posts checked.

**Metrics** (s of audio after the join; p = how far the shown value has
moved from the old voice's control to the new one's):

- **T50**: first time p ≥ 0.5.
- **Tdb**: from then on within 0.3 u (the header deadband) of the new
  voice's control.
- **Ttol**: from then on within 0.15 u.
- **drawn**: counting only chunks where the row draws a dot. Censored at
  the segment end.

**Stages** (same events, replayed from the tapped bins on the bins' audio
time):

| stage | what it is |
|---|---|
| **bin** | each vtln bin against the control's bin (vtln's trailing ~1 s of voicing) |
| **all** | a 5 s voiced median of all bins (no gate) |
| **cue** | the admitted bins (utterance gate, and the voice gate in arm on) |
| **posted** | the worker's post every 0.2 s |
| **drawn** | the dot |

## Results (dev: 200 streams, 150 with switches = 300 switch events per arm)

### Settle time per stage, 18/36 (Ttol, median s of audio; arm on = arm off on every row)

| set | dir | n | bin | all | cue | posted | drawn |
|---|---|---|---|---|---|---|---|
| a: pitch kept | up | 20 | 1.2 | 6.8 | 7.1 | 7.3 | **7.3** |
| a: pitch kept | down | 20 | 1.2 | 6.4 | 6.6 | 6.7 | **6.7** |
| a: pitch moves | up | 20 | 1.3 | 6.9 | 7.0 | 7.2 | **7.2** |
| a: pitch moves | down | 20 | 1.2 | 6.7 | 6.9 | 7.2 | **7.2** |
| b: different readers | up | 10 | 1.2 | 7.0 | 7.3 | 7.4 | **7.4** |
| b: different readers | down | 10 | 1.5 | 6.5 | 6.4 | 6.7 | **6.7** |

T50 drawn:

| set | up | down |
|---|---|---|
| a, pitch kept | 5.2 | 5.4 |
| a, pitch moves | 5.0 | 5.4 |
| b | 5.0 | 4.4 |

Up/down ratio of drawn Ttol:

| set | all | original men | original women |
|---|---|---|---|
| a, pitch kept | 1.08 | 0.98 | 1.23 |
| a, pitch moves | 1.00 | 0.98 | 1.06 |
| b | 1.10 | — | — |

**With equal time in each voice, up and down take the same time:** about 7 s
of audio (5 s of the median halfway) in both directions.

### Short excursion: away and back (arm on, drawn, median s of audio)

| set | joins | n (per join) | away: T50 | away: Tdb | back: T50 | back: Tdb | p reached at the end of the excursion | T50 ratio away / back |
|---|---|---|---|---|---|---|---|---|
| a | 18/36 | 40 | 5.2 | 6.1 | 5.4 | 5.8 | — | 0.96 |
| a | **30/36** | 40 | **6.0 (20 of 40 never reach halfway)** | 6.0 | **2.1** | 5.8 | **0.47–0.49** | **2.82** |
| a | 30/40 | 40 | 6.1 | 6.9 | 5.4 | 6.3 | 0.98–0.99 | 1.12 |
| b | 18/36 | 10 | 4.9 | 5.4 | 4.6 | 5.4 | — | 1.07 |
| b | **30/36** | 10 | **6.0 (6 of 10 never)** | 6.0 | **0.0** | 5.4 | **0.29–0.41** | — (back already past halfway) |
| b | 30/40 | 10 | 6.7 | 6.9 | 5.2 | 5.8 | 0.96–0.98 | 1.28 |

It is the same with bright first (a 30/36: away T50 5.9, back 2.1). **The
direction does not matter. What matters is how long the old voice was
held.**

### At the join (arm on, first 3–5 s after it)

- **Utterance gate:** it drops 10–18 of 660 bins after a join, against
  11–18 in the control ("warming" at utterance onsets).
- **Voice gate:** it hid 0 voiced hops on the switch streams in the 5 s
  after a join; arm on equals arm off on every metric.
- **Pitch hints, a (pitch kept / moves):** voicing differs from the control
  on 4–6 of 2 400 hops, and > 1 st off on 1–36.
- **Pitch hints, b:** voicing differs on 48 (up) / 32 (down) of 1 200 hops,
  and > 1 st off on 8 / 8.
- **Row:** it draws a dot 95–97 % of that time (live 73–77 %, holding
  19–22 %). Drawn = posted on every row.
- **Start reference (startU):** not found at the 18 s join in any stream
  (0 of 50 switch streams). It is found at join 2 in all. The header shows "finding your
  start…" until it is found: header first right 11.9–14.4 s after join 1,
  3.6–5.6 s after join 2.

## Attribution

1. **The worker's 5 s voiced median (horizon / statistic): most of the
   delay, in both directions.**
   - A median of the last 5 s of voiced bins moves halfway only after about
     2.5 s of new voiced speech (≈ 5 s of audio at reading voicing). It is
     within 0.15 u of the new voice only when nearly all old bins have left
     (6.4–7.0 s; stage "all").
   - On the user's pattern (a long time in one voice, then a few seconds in
     the other), the median has not reached the new voice when the user
     goes back:
     - after a 6 s excursion the dot got 29–49 % of the way;
     - after a 10 s excursion, 96–99 %.
   - Going back, the window is still mostly the first voice, so the dot is
     back halfway after 0–2.4 s.
   - **This reproduces the report: away slow, back fast.** The same happens
     with the order reversed, so it is a dwell effect, not a direction
     effect.
2. **vtln's trailing ~1 s of voiced frames:** 1.2–1.5 s (stage "bin"),
   nested inside 1. The same both ways.
3. **Utterance gate (held / warming):** −0.1 to +0.3 s (stage cue − all). The new voice is not
   classed as held or warming more than the control.
4. **Voice gate:** 0 on this clean speech (arm on = arm off).
5. **Pitch hints at the register change:** no measurable delay. The bin
   stage is the same up and down, and the readers' hint differences are
   0.2–4 % of hops in the first 3 s.
6. **Posting cadence:** +0.1–0.3 s (posted − cue).
7. **Row settling logic:** 0. Drawn = posted; no "settling" state at the
   joins.
8. **Start-up collection (header only):**
   - The start is the median of the readouts over the first 12 s of voiced
     speech after the readout fills: about 25–30 s of audio at reading
     voicing.
   - A change inside the first ~30 s leaves the header at "finding your
     start…" for ~12–14 s after an 18 s join. The start found then mixes
     both voices.
   - Back at the first voice (join 2), "about where you started" is right
     on 0.49–1.00 of the live time from 8 s after the join (median per
     group).

What this pass cannot see: the user's own voice. Her "female" voice may be
held more steadily (utterance gate), heard less by the voice detector, or
tracked an octave low (vtln reads half pitch darker). On these public
readers each of those adds ≤ 0.3 s, and none of them differs by direction.
A descriptive check on a private recording was not run in this pass.

## Plan (pre-registered, 2026-10-21, before any candidate result)

**Scope.** Candidate fixes touch only `src/resonance/resonanceCue.js` (and,
if needed, `src/components/cueStripModel.js`). The worker, the engine, vtln
and both gates are unchanged.

**Candidates.**

- **C1 `restart` (resonanceCue.js):** follow a sustained change at once.
  - Alongside the 5 s readout, keep a short readout: the median of the
    admitted bins in the last `shortS` s of voiced time.
  - When |short − long| ≥ `jumpU` u on `confirmN` consecutive admitted bins
    with the same sign, the long readout drops its items older than the
    short window. The readout becomes the short median and grows back to
    5 s.
  - It is value-preserving: every value shown is a median of admitted bins.
  - It does not touch `fill`, `voicedS`, `sinceResumeS`, the drop rules,
    narrowband or the start collection, so positions exist exactly when
    they exist now.
  - Dev grid (8 cells): `shortS` ∈ {1.5, 2.0} s, `jumpU` ∈ {0.4, 0.6} u,
    `confirmN` ∈ {4, 7} bins (0.6 / 1.05 s of voicing).
- **C2 `horizon` (resonanceCue.js):** a shorter readout horizon, 3.0 or
  2.5 s voiced (2 cells). The simple comparator; expected to cost jitter.

**Split.**

- **dev** = this pass's 10 dev-clean readers (all tuning; replays of the
  tapped bins, exact for cue-only changes — BASE replay checked equal to
  the posted u first).
- **held-out** = 20 test-clean readers (10 men, 10 women; the first 10 of
  each sex by speaker id in `r1_test`), built and run the same way:
  - (a) both pitch modes;
  - (b) 10 man/woman pairs;
  - patterns 18/36, 30/36, 30/40, both orders, and the controls.

  Run once, through the real workers, for the single dev winner and BASE
  (cue-strip 54472d3).

**Dev selection.** Among the cells that pass (ii)–(iv) on dev, the lowest
dev median away Tdb wins. On a tie (within 0.1 s), the larger `jumpU`, then
the larger `confirmN`, then C2 after C1. If no cell passes on dev, nothing
goes to held-out and the result is "no candidate".

**Bar on held-out (all must hold, arm on, drawn dot):**

1. **Settle.** Both:
   - (a) Over all up events (all patterns, kinds a + b): median Tdb
     improves by ≥ 40 % vs BASE, and median Tdb up / down ≤ 1.5.
   - (b) The reported asymmetry, 30/36, dark first (the user's order):
     median T50 away improves by ≥ 40 % vs BASE, and median T50 away /
     back ≤ 1.5.

   Censored events count at the segment end.
2. **Steady speech jitter.** On the held-out controls (dark, bright, own
   recording; both pitch modes):
   - p90 of |Δu| between consecutive worker posts while a dot is drawn;
   - the median over non-overlapping 5 s windows of the drawn u's
     q90 − q10.

   Each ≤ 1.10 × BASE, pooled and per sex of the reader.
3. **Held vowels, noise only (gate on) and narrowband: no new positions.**
   The chunks with a drawn dot are identical to BASE on:
   - H1, the 24 synthetic holds of `scripts/resonance/gating.mjs` /
     `voice-gate-resonance.mjs`;
   - N2, fresh noise rebuilt with `scripts/resonance/voice-gate-prep.py`
     as in [voice-gate-resonance-row-2026-10-21.md](voice-gate-resonance-row-2026-10-21.md);
   - the narrowband tests `tests/resonance/narrowband-test.js` and
     `tests/resonance/resonance-cue-test.js`, which pass unchanged.
4. **Speech readouts unchanged on steady stretches** (the earlier notes'
   tolerance), on the held-out controls:
   - median |Δu| CAND vs BASE over chunks where both draw ≤ 0.02;
   - "about where you started" share of live time on unchanged voice not
     lower than BASE by more than 2 points.

**Reported, no bar:**

- the header (first right, and right from 8 s on);
- per-sex settle times;
- arm off;
- the 18/36 and 30/40 rows;
- how often C1 restarts on steady speech.

**Not in scope:** the start collection (header), which is a separate
question; this plan only reports it.

## Dev results (2026-10-21, before any held-out run)

`scripts/resonance/switch-candidates.mjs` (the candidates as a display
readout next to the cue's 5 s readout) and `switch-cand.mjs` (scoring).

**How a candidate was run on dev.** Replayed over the tapped vtln bins of
the dev runs (admitted flag and voiced stamps as the cue saw them). Checks:

- the BASE display readout equals `readout.js` on 144 000 / 144 000 bin
  prefixes;
- a bin is in the post of the chunk ending ≥ its te + 0.1 s: this gives
  the worker's posted value on 85 135 of 86 168 posts; 393 more need a
  1–3 bin shift (used for every candidate), 640 (0.7 %) are left unmatched;
- the same candidate run through the real chain on 3 streams (driver
  `--cand`) equals the replay on 99.4 % of chunks (within 0.0006 u, the
  bins' rounding).

**Positions.** A candidate changes only the shown value. fill, voicedS,
the drop rules, narrowband, sinceResumeS and startU stay the 5 s
readout's, so the row draws a dot exactly when BASE does (bar 3 holds by
construction; on held-out it is also checked chunk for chunk).

**Definitions used for the bar** (fixed here, before held-out):

- jitter p90: |Δu| between consecutive posts that both draw a dot;
- 5 s spread: per non-overlapping 5 s window with ≥ 2.5 s drawn, q90 − q10
  of the drawn u; median over windows;
- "about where you started": share of live / holding chunks with a start;
- dev selection "away Tdb": all join-1 events (every pattern, a + b, arm on).

### Candidates on dev (arm on, drawn; medians, s of audio)

| cand | up Tdb | down Tdb | away Tdb | 30/36 dark-first T50 away / back | jitter p90 (all / m / f) | 5 s spread (all / m / f) | med \|Δu\| vs BASE, steady | "about where you started" | restarts / min, steady | (ii) | (iv) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE | 5.9 | 6.0 | 6.0 | 6.0 / 0.0 | 0.029 / 0.028 / 0.031 | 0.102 / 0.083 / 0.120 | — | 0.90 | — | | |
| c1 s1.5 j0.4 n4 | 3.5 | 3.5 | 3.5 | 3.3 / 2.9 | 0.032 / 0.031 / 0.033 | 0.108 / 0.095 / 0.121 | 0.000 | 0.88 | 1.42 | FAIL | FAIL |
| c1 s1.5 j0.4 n7 | 3.6 | 3.6 | 3.8 | 4.0 / 3.6 | 0.031 / 0.030 / 0.032 | 0.111 / 0.091 / 0.124 | 0.000 | 0.89 | 0.78 | pass | pass |
| **c1 s1.5 j0.6 n4** | **3.5** | **3.4** | **3.5** | **3.5 / 3.4** | 0.030 / 0.028 / 0.031 | 0.103 / 0.087 / 0.120 | 0.000 | 0.90 | 0.13 | pass | pass |
| c1 s1.5 j0.6 n7 | 3.9 | 4.0 | 4.0 | 4.2 / 3.6 | 0.030 / 0.028 / 0.031 | 0.102 / 0.085 / 0.120 | 0.000 | 0.90 | 0.11 | pass | pass |
| c1 s2.0 j0.4 n4 | 3.8 | 3.9 | 3.7 | 3.7 / 3.4 | 0.030 / 0.028 / 0.031 | 0.103 / 0.083 / 0.120 | 0.000 | 0.90 | 0.36 | pass | pass |
| c1 s2.0 j0.4 n7 | 4.0 | 4.0 | 4.2 | 4.2 / 4.0 | 0.030 / 0.028 / 0.031 | 0.103 / 0.083 / 0.120 | 0.000 | 0.90 | 0.20 | pass | pass |
| c1 s2.0 j0.6 n4 | 3.9 | 4.0 | 4.0 | 4.0 / 3.6 | 0.029 / 0.028 / 0.031 | 0.102 / 0.083 / 0.120 | 0.000 | 0.90 | 0.04 | pass | pass |
| c1 s2.0 j0.6 n7 | 4.3 | 4.2 | 4.4 | 4.6 / 4.0 | 0.029 / 0.028 / 0.031 | 0.102 / 0.083 / 0.120 | 0.000 | 0.90 | 0.02 | pass | pass |
| c2 3.0 s | 4.3 | 4.2 | 4.2 | 4.0 / 3.6 | 0.043 / 0.041 / 0.046 | 0.160 / 0.151 / 0.167 | 0.054 | 0.87 | — | FAIL | FAIL |
| c2 2.5 s | 3.9 | 3.7 | 3.7 | 3.7 / 3.1 | 0.052 / 0.047 / 0.056 | 0.185 / 0.176 / 0.193 | 0.066 | 0.86 | — | FAIL | FAIL |

BASE's 30/36 "back" T50 is 0.0 because the dot never got halfway away.

**Pick: C1 `shortS` 1.5 s, `jumpU` 0.6 u, `confirmN` 4**
(`c1-s1.5-j0.6-n4`): the lowest away Tdb (3.5 s) among the cells that pass
(ii) and (iv); the only other cell at 3.5 s (j0.4 n4) fails both. C2 fails
the jitter bar as expected (1.5–1.8 × BASE). On dev the pick also meets
bar 1, narrowly on (a): up Tdb 3.5 vs 5.9 s (−41 %, bar −40 %), up/down
1.03; (b) T50 away 3.5 vs 6.0 s, away/back 1.04. Per reader sex and
direction (Tdb up / down): men 3.4 / 3.4, women 3.4 / 3.3, pairs 3.7 / 3.5.

Held-out: run once, `switch-asymmetry.mjs --split=held --patterns=,x6,x10
--cand=c1-s1.5-j0.6-n4` (BASE = the real worker's posts in the same run).

## Held-out result (2026-10-21): FAIL — no change shipped (superseded by the user decision below)

Run once: 20 test-clean readers (10 men, 10 women) + 10 pairs, patterns
18/36, 30/36, 30/40, both orders, and the controls — 400 streams through
the real pitch worker (with the voice detector), DSP worker, hook,
resonance worker (BASE) and the replica with the pick's cue (CAND), both
through the real row logic. Worker = replica on verdict and startU on
192 000 / 192 000 posts. Scored with `switch-cand.mjs --mode=recorded`.

### The bar (arm on, drawn dot)

| bar | BASE | C1 s1.5 j0.6 n4 | needed | result |
|---|---|---|---|---|
| 1a: up Tdb, all patterns, a + b (300 events) | 6.0 s | 3.2 s (−47 %) | ≤ −40 % | pass |
| 1a: up / down Tdb | 0.99 | 0.89 | ≤ 1.5 | pass |
| 1b: 30/36 dark-first, T50 away (50 events) | 5.5 s | 2.8 s (−49 %) | ≤ −40 % | pass |
| 1b: T50 away / back | 1.23 | 0.94 | ≤ 1.5 | pass |
| 2: jitter p90 \|Δu\| (all / men / women) | 0.028 / 0.028 / 0.028 | 0.029 / 0.029 / 0.028 (1.03 / 1.06 / 1.01 ×) | ≤ 1.10 × | pass |
| 2: 5 s spread (all / men / women) | 0.088 / 0.085 / 0.092 | 0.091 / 0.090 / 0.094 (1.03 / 1.06 / 1.03 ×) | ≤ 1.10 × | pass |
| 3: drawn chunks = BASE | — | 1 728 000 / 1 728 000 | identical | pass |
| 4: median \|Δu\| vs BASE, steady | — | 0.000 | ≤ 0.02 | pass |
| **4: "about where you started", unchanged voice** | **85.6 %** | **83.1 % (−2.5 points)** | **≥ −2 points** | **FAIL** |

Bar 4 by reader sex (reported): men 80.8 → 77.3 % (−3.5), women 89.5 →
87.8 % (−1.7). The restart fires on steady speech more often than on dev
(0.54 per minute vs 0.13; men 0.80, women 0.29), and each time the dot
jumps to the last 1.5 s median, which can sit outside the 0.3 u deadband
of the start. H1 / N2 were not run: bar 3 holds by construction (only the
shown value changes; checked on all held-out chunks) and the result was
already a fail.

### Settle per reader sex and direction (arm on, drawn; medians, s of audio)

| set | dir | n | BASE Tdb | CAND Tdb | BASE T50 | CAND T50 | BASE Ttol | CAND Ttol |
|---|---|---|---|---|---|---|---|---|
| a, men readers | up | 120 | 6.3 | 3.1 | 5.5 | 2.8 | 7.1 | 4.4 |
| a, men readers | down | 120 | 6.7 | 3.9 | 5.8 | 3.1 | 7.6 | 6.0 |
| a, women readers | up | 120 | 5.8 | 2.8 | 4.6 | 2.5 | 6.1 | 4.4 |
| a, women readers | down | 120 | 6.0 | 3.1 | 4.7 | 2.7 | 6.5 | 5.0 |
| b, pairs | up | 60 | 6.0 | 3.6 | 5.0 | 3.2 | 6.3 | 4.8 |
| b, pairs | down | 60 | 6.0 | 4.0 | 5.4 | 3.4 | 6.4 | 6.0 |

Away and back (arm on, drawn; medians, s of audio):

| joins | first | BASE away T50 / Tdb | CAND away T50 / Tdb | BASE back T50 / Tdb | CAND back T50 / Tdb |
|---|---|---|---|---|---|
| 18/36 | dark | 5.4 / 6.3 | 3.0 / 4.3 | 5.0 / 5.8 | 2.9 / 3.1 |
| 18/36 | bright | 5.8 / 6.7 | 3.4 / 4.0 | 4.9 / 5.8 | 2.7 / 2.8 |
| 30/36 | dark | 5.5 / 6.0 | 2.8 / 2.8 | 4.5 / 5.8 | 3.0 / 3.4 |
| 30/36 | bright | 5.5 / 6.0 | 2.8 / 3.3 | 3.2 / 5.6 | 2.7 / 3.0 |
| 30/40 | dark | 5.5 / 6.5 | 2.8 / 2.8 | 6.0 / 6.8 | 3.4 / 3.7 |
| 30/40 | bright | 5.5 / 6.8 | 2.8 / 3.8 | 5.0 / 6.0 | 3.2 / 3.4 |

Reported, no bar: header first right after join 1 4.2 s vs 5.2 s (never
in the segment: 78 vs 88 of 300); after join 2 3.2 vs 5.8 s, but never in
the segment 42 vs 21 of 300. Arm off: up / down Tdb 3.2 / 3.6 s vs 6.0 /
6.1 s.

**Verdict.** The restart halves the time to follow a change, the same up
and down and for both sexes, but on unchanged speech it moves the header
off "about where you started" 2.5 points more often (men 3.5), past the
pre-registered 2-point limit. Per the plan nothing is shipped; the cue
stays the plain 5 s median. A next pass would have to keep the start
comparison on the unrestarted readout (or widen the restart's evidence
on steady speech) and be pre-registered again on fresh data; these
held-out readers are now spent.

## User decision 2026-10-21: shipped despite the failed guard

The user chose (2026-10-21, ~16:00) to ship the pick anyway, accepting the
bar-4 cost. Shipped exactly as run on held-out: `RESTART = { shortS: 1.5,
jumpU: 0.6, confirmN: 4 }` in `src/resonance/resonanceCue.js`
(`createRestartReadout`, the same code as `createDisplayReadout` in
`scripts/resonance/switch-candidates.mjs`). Only the shown value (u, raw,
clamp) comes from it; fill, voicedS, n, sinceResumeS and the start
collection (startU) stay on the plain 5 s median, as in the replica.
`createResonanceCue({ restart: null })` gives the readout before this
change.

**Accepted cost** (held-out controls, unchanged voice, arm on):

| | before | shipped | pre-registered limit |
|---|---|---|---|
| "about where you started", share of live time | 85.6 % | 83.1 % (−2.5 points) | ≥ −2 points |
| — men readers | 80.8 % | 77.3 % (−3.5) | |
| — women readers | 89.5 % | 87.8 % (−1.7) | |
| restarts on unchanged speech, per minute | — | 0.54 (men 0.80, women 0.29) | (reported) |
| back at the starting voice (join 2): header never "about where you started" within the segment | 21 / 300 | 42 / 300 | (reported, no bar) |
| after the first change (join 1): header right from 8 s on, median share of the time | 0.76 | 0.71 | (reported, no bar) |

Each restart on steady speech moves the dot to the last 1.5 s median, which
can sit outside the 0.3 u "about where you started" deadband for a few
seconds. The two header rows come from the same held-out run
(`build/resonance-switch/cand-held.md`; §Held-out result "Reported, no
bar"); they had no pre-registered bar. Gained: a change of resonance is
followed in about half the time, the same up and down (up Tdb 6.0 → 3.2 s;
30/36 dark-first T50 away 5.5 → 2.8 s); every other pre-registered bar
passes (§The bar).

**The pitch-only warning is not affected.** It compares the resonance
value with the start (`|u − startU| ≤ 0.6 u`, `src/ml/pitch-only-warning.js`)
and was measured on the plain 5 s median. The worker's state post carries
that plain median as `uPlain` (the cue snapshot's `uPlain`, never
restarted, null exactly when u is) and the warning reads it (`warningU`),
so its input is the same value as before this change
(`tests/resonance/switch-restart-test.js` checks `uPlain` against
`restart: null` at every bin of the fixture).

**Not re-measured with the restart:**
- the voice-gate note's noise-only figures for the resonance row
  ([voice-gate-resonance-row-2026-10-21.md](voice-gate-resonance-row-2026-10-21.md):
  "dot moves", "beyond the scale") were measured on the plain readout.
  When dots are drawn is unchanged (same admitted bins, same nulls), but
  how far a drawn dot moves on noise could rise with restarts;
- the lab tab's vtln readout (`src/resonance-lab/readout.js`, the plain
  median) is unchanged, so after a change it trails the Dashboard row by
  about 3 s.

**Reproduction through the real chain.** `switch-asymmetry.mjs --split=held
--patterns=,x6,x10 --only=<6 ids>` with the shipped module (worker = BASE,
no `--cand`) on 6 held-out streams (a man's 18/36 and 30/36 switch, two
controls with 5 and 3 restarts, a woman's own recording, a man/woman pair
30/36): the worker's posts equal the replica on 240 / 240 posts per arm,
and the posted u, row state, drawn dot, header and startU equal the
held-out run's pick (`.cand`) on 25 920 / 25 920 chunks (both arms; the
old BASE differed from the pick on 6 576 of them).

**Test.** `tests/resonance/switch-restart-test.js` on
`tests/resonance/fixtures/switch-up-bins.json` (dev-clean reader 2078, pitch
kept, darker → brighter at 18 s, and the all-brighter control; written by
`scripts/resonance/switch-fixture.mjs`): settles within 0.3 u of the
control in 2.55 s (≤ 3.5 s required; the plain 5 s median takes 5.70 s, so
the test fails on the old module); positions, fill, voicedS and startU are
unchanged; `restart: null` equals `readout.js` value for value. The
existing resonance tests (cue, narrowband, production parity, worker
recovery, overload guard, CPU exactness) pass unchanged.

## Reproduce

```
python scripts/resonance/switch-prep.py --ls=<resonance-lab cache root>
node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/switch-streams.mjs --split=dev --n=5
node scripts/fetch-firered-model.mjs
SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/switch-asymmetry.mjs \
    --split=dev --shard=i/2                                   # i = 0, 1
SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/switch-asymmetry.mjs \
    --split=dev --patterns=x6,x10 --no-controls --shard=i/2 --out=build/resonance-switch/dwell-dev-<i>of2.jsonl
node scripts/resonance/switch-report.mjs --runs=<the four jsonl files>
node scripts/resonance/switch-cand.mjs --mode=replay --runs=<the four jsonl files>
# held-out (once): both shards, then
SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/switch-asymmetry.mjs \
    --split=held --patterns=,x6,x10 --cand=c1-s1.5-j0.6-n4 --shard=i/2 --out=build/resonance-switch/held-<i>of2.jsonl
node scripts/resonance/switch-cand.mjs --mode=recorded --cand=c1-s1.5-j0.6-n4 --runs=<the two held jsonl files>
node scripts/resonance/switch-fixture.mjs --runs=<the two run-dev jsonl files>   # tests/resonance/fixtures/switch-up-bins.json
```
