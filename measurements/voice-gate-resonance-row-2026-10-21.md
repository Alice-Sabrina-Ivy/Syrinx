# Voice gate: the resonance row follows the gate (2026-10-21)

Branch `voice-gate-followup` (from `cue-strip` 1a1713f). Public data and
synthetic stimuli only; the private check is descriptive and its results
are kept outside this repository.

## Why

Review of the merged voice gate (FireRedVAD, setting "Hide pitch when no
voice is heard (experimental)", on by default): the Dashboard resonance
row ("Resonance · approx.") takes its state from the RAW pitch display
flags (`useAudioPipeline`: `voiced: displayPitched`, `holding:
displayHolding` → `cueStripModel.js` `resonanceRowState` / `dotOpacity` /
`resonanceHeader`). The gate only hides the pitch row's own flags
(`pitchVoiced` / `pitchHolding`). So with the gate on, noise that the pitch
chain voices still takes the resonance row out of "idle": "keep talking…"
with nobody speaking (the review estimated 28–54 % of noise-only time), and
a held vowel the detector hides shows "keep talking…" instead of "needs
running speech".

User decision 2026-10-21: make the resonance row not react to noise.

## Plan (pre-registered, 2026-10-21, before any result)

**Candidate (CAND).** While the gate setting is on and the detector is
ready (not missing / slow / loading), the resonance row's `voiced` /
`holding` come from the gated pitch display flags `pitchVoiced` /
`pitchHolding` — the ones that drive the hidden pitch line and the pitch
row. Otherwise exactly as now. **BASE** = `cue-strip` 1a1713f (the row on
the raw flags). The resonance worker and its gated pitch hint are the same
in both, so where both draw a dot it is the same position. The gated flags
are never true where the raw ones are false, so CAND's row state is always
BASE's state or "idle"; the run measures how often, and where.

**Driver.** `scripts/resonance/voice-gate-resonance.mjs --row` (extends the
driver of [noise-detector-tryout-resonance-2026-10-21.md](noise-detector-tryout-resonance-2026-10-21.md)):

- the REAL pitch worker with the real FireRedVAD model (test seam
  `setVadModelLoaderForTests`, ready before the first chunk), 1200-sample
  chunks at 48 kHz;
- the REAL resonance worker, twice: ungated hint and gated hint (as before);
- the REAL DSP worker (intensity for the silence gate);
- the REAL hook (`useAudioPipeline` `handleAnalysisResult`, the session
  oracle's React mock, gate setting on): one DSP frame per chunk, each
  consuming the latest pitch message and its detector decision; per chunk
  the raw `voiced` / `holding` and the gated `pitchVoiced` / `pitchHolding`;
- the REAL row logic (`cueStripModel.js`: `resonanceRowState`, `dotOpacity`,
  `rowValue`, `resonanceClamp`, `axisPos`, `resonanceHeader`) on the latest
  resonance `state` post, every 25 ms chunk, three arms:
  - **PRE**: ungated hint, raw flags (before the merge);
  - **BASE**: gated hint, raw flags (1a1713f);
  - **CAND**: gated hint, gated flags.
- Workers run with a frozen `performance.now` (no overload / "slow"
  switch-off: a device that keeps up); the hook with the session oracle's
  clock (+1 s per call: its 200 ms state throttle never drops a frame).

**Audio.** The same sets as the earlier note, regenerated with
`scripts/resonance/voice-gate-prep.py` (same counts as that note): N1 tuning
noise (166 streams, 14 069 s), N2 fresh noise (103, 6 341 s), S1 LibriSpeech
(40 readers, 20 / 20, 2 637 s), S2 PTDB-TUG (17 streams, 1 219 s), S3 FDA
(5 streams, 332 s), H1 synthetic holds (24, made by the driver), H2 PVQD
held /a/ and /i/ (97 recordings, 2 284 s), D1 speech then noise (10, 600 s).
Full sets: a timing probe (two synthetic holds, timing only) gives ~5×
real time per process; two processes → about 50 minutes. Streams run in a
fixed seeded order (`--shuffle=20261021`, then `--shard=i/2`); if the run
is not finished at 13:45 CDT it is stopped and the streams done by then (a
seeded random subset of every set) are the result, stated with their
counts.

**Metrics** (time = share of 25 ms chunks; per set, and per sex where the
set has one).

- Row states: share of time in each state, per arm.
- Noise only (N1, N2; per class and pooled):
  - row not idle = any state other than "idle" and "starting" ("starting…"
    is the 0.2 s before the worker's first post, the same in every arm);
  - drawn dot = `dotOpacity(state) !== null` and `u !== null` (what the
    CueStrip draws);
  - "keep talking…" = state "warming";
  - beyond the scale = a drawn dot pinned at an end: the vtln clamp OR u off
    the axis (below −1 or above 2.2; `axisPos(...).beyond !== 0`, the dot
    with the chevron); also the header text "beyond the scale" (states live
    / holding only).
  - BASE vs CAND, reduction = 1 − CAND / BASE; PRE shown.
- Speech (S1–S3): share of time CAND's state equals BASE's; the state
  changes where it differs; |Δu| between the drawn positions on chunks
  where both draw (median, p95); drawn-dot share BASE / CAND; time of the
  first drawn dot.
- Held vowels (H1 hold 0.5–4.5 s; H2 annotated holds): state shares inside
  the holds per arm; chunks where CAND draws a dot and BASE does not.
- D1 (information): state shares during the noise part.
- Detector: share of pitch messages with a decision (expected: all).

**GUARDS (must hold to build).**

1. Speech, each sex (S1–S3 pooled): CAND's row state identical to BASE's on
   ≥ 99 % of the time, and median |Δu| ≤ 0.02.
2. Held vowels (H1 + H2): no new drawn positions — no chunk where CAND draws
   a dot and BASE does not.

**REPORTED (no bar; the user already chose to build):** the noise-only
reductions.

**Correction of the earlier note.** The same run gives PRE vs BASE (the
earlier note's two arms) with corrected wording: the worker position (the
stored u, the earlier metric) next to the drawn dot; beyond the scale =
clamp OR off-axis; whether the gated hint was never worse than the ungated
one on any noise stream; and the "dot stays for the rest of the clip"
sentence (the worker keeps its position; the row draws it only while the
pitch display is voiced or holding). Written as a dated correction section
in [noise-detector-tryout-resonance-2026-10-21.md](noise-detector-tryout-resonance-2026-10-21.md).

**Private check.** The user's own room recording (PC fans and coil whine,
60 s, no speech) through the same driver (`--row --wav=`), descriptive;
results kept outside this repository.

## Results (2026-10-21)

**ROW GATE: GUARDS PASS.** On speech CAND's row state equals BASE's on
99.9 % (women) and 100.0 % (men) of the time, the drawn positions are the
same (|Δu| < 0.001), and no held vowel gets a new drawn position. On noise
only, the row leaves "idle" 7.0 % of the time instead of 33.3 % (78.8 %
less), shows "keep talking…" 4.0 % instead of 26.9 %, and draws a dot
3.0 % instead of 6.3 %. On no noise stream does CAND react more than BASE.

Run: all 462 streams (7.67 h; no subset — the run took 21 minutes). Every
pitch message carried a detector decision (1 101 890), none late. The
regenerated audio reproduces the earlier note exactly: its own report on
these rows gives 37.2 % → 10.0 % worker position time (73.2 %) and clamp
5.0 % → 1.2 %, as published. No change from the plan.

### Guard 1: speech (per sex pooled is judged)

| sex · set | streams | audio s | state identical | differing s | where it differs (BASE → CAND) | drawn dot BASE | CAND | median \|Δu\| | p95 \|Δu\| | first dot BASE (median) | CAND − BASE (median) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| women S1 LibriSpeech | 20 | 1340 | 99.9 % | 1.1 | "keep talking…" → idle | 88.9 % | 88.9 % | < 0.001 | < 0.001 | 5.0 s | 0.00 s |
| women S2 PTDB-TUG | 9 | 618 | 100.0 % | 0.0 | — | 80.1 % | 80.1 % | < 0.001 | < 0.001 | 11.9 s | 0.00 s |
| women S3 FDA | 3 | 185 | 100.0 % | 0.0 | — | 82.1 % | 82.1 % | < 0.001 | < 0.001 | 7.9 s | 0.00 s |
| **women** | 32 | 2143 | **99.9 %** | 1.1 | "keep talking…" → idle | 85.8 % | 85.8 % | **< 0.001** | < 0.001 | 5.6 s | 0.00 s |
| men S1 LibriSpeech | 20 | 1296 | 100.0 % | 0.2 | "keep talking…" → idle | 86.1 % | 86.1 % | < 0.001 | < 0.001 | 5.6 s | 0.00 s |
| men S2 PTDB-TUG | 8 | 601 | 100.0 % | 0.0 | — | 75.8 % | 75.8 % | < 0.001 | < 0.001 | 14.7 s | 0.00 s |
| men S3 FDA | 2 | 147 | 100.0 % | 0.0 | — | 86.4 % | 86.4 % | < 0.001 | < 0.001 | 6.1 s | 0.00 s |
| **men** | 30 | 2044 | **100.0 %** | 0.2 | "keep talking…" → idle | 83.1 % | 83.1 % | **< 0.001** | < 0.001 | 6.3 s | 0.00 s |

The only differences: 1.3 s of "keep talking…" (51 chunks) that become
"—" where the gate hid the pitch display. |Δu| is 0 by construction (one
resonance worker run).

### Guard 2: held vowels (state inside the holds)

| set | arm | hold s | "—" (idle) | "keep talking…" | "needs running speech" | phone-quality notice | settling | holding / live | drawn dot |
|---|---|---|---|---|---|---|---|---|---|
| H1 synthetic (24) | PRE | 96 | 2.5 % | 24.4 % | 50.6 % | 22.5 % | 0.0 % | 0.0 % | 0.0 % |
| | BASE | 96 | 2.5 % | 91.4 % | 5.4 % | 0.7 % | 0.0 % | 0.0 % | 0.0 % |
| | CAND | 96 | 90.2 % | 3.8 % | 5.2 % | 0.7 % | 0.0 % | 0.0 % | 0.0 % |
| H2 PVQD (97) | PRE | 579 | 1.7 % | 24.3 % | 63.6 % | 0.4 % | 2.4 % | 7.0 % | 49.5 % |
| | BASE | 579 | 1.7 % | 24.6 % | 63.4 % | 0.4 % | 2.3 % | 7.1 % | 47.1 % |
| | CAND | 579 | 2.1 % | 24.3 % | 63.3 % | 0.4 % | 2.3 % | 7.1 % | 47.0 % |

New drawn positions (a chunk where CAND draws a dot and BASE does not, over
whole streams): **0** on H1, **0** on H2. (The H2 dots are the readout of
the speech before the hold, dimmed under "needs running speech".)

On the synthetic holds the detector hides the voice, so BASE says "keep
talking…" through 91 % of the hold; CAND shows "—" instead. It does not
say "needs running speech": with the gate on, the row cannot tell a hidden
hold from silence. On the PVQD holds the detector mostly hears voice and
nothing changes.

### Noise only (reported; no bar)

| set | streams | audio s | row not idle PRE | BASE | CAND | reduction (CAND vs BASE) | "keep talking…" PRE | BASE | CAND |
|---|---|---|---|---|---|---|---|---|---|
| N1 broadband | 22 | 1810 | 30.6 % | 30.6 % | 7.6 % | 75.2 % | 14.1 % | 20.2 % | 6.5 % |
| N1 intermittent-tonal | 8 | 782 | 22.5 % | 22.5 % | 1.8 % | 92.1 % | 8.2 % | 21.9 % | 1.3 % |
| N1 mixed | 76 | 6912 | 36.6 % | 36.6 % | 7.5 % | 79.5 % | 12.9 % | 29.0 % | 4.2 % |
| N1 stationary-tonal | 60 | 4565 | 37.7 % | 37.7 % | 8.2 % | 78.2 % | 12.0 % | 28.9 % | 3.1 % |
| **N1 pooled** | 166 | 14069 | 35.4 % | 35.4 % | 7.4 % | 79.0 % | 12.5 % | 27.4 % | 4.0 % |
| N2 computer | 10 | 696 | 21.5 % | 21.5 % | 7.2 % | 66.7 % | 18.0 % | 21.5 % | 7.2 % |
| N2 fans | 15 | 901 | 32.2 % | 32.2 % | 15.7 % | 51.4 % | 8.2 % | 19.7 % | 3.5 % |
| N2 fridge | 15 | 1165 | 43.6 % | 43.6 % | 1.7 % | 96.0 % | 15.1 % | 43.6 % | 1.7 % |
| N2 hvac | 9 | 699 | 4.9 % | 4.9 % | 2.7 % | 45.3 % | 4.9 % | 4.9 % | 2.7 % |
| N2 mains | 15 | 856 | 25.8 % | 25.8 % | 5.0 % | 80.8 % | 9.1 % | 21.1 % | 2.2 % |
| N2 traffic | 15 | 1255 | 21.4 % | 21.4 % | 6.3 % | 70.8 % | 15.3 % | 20.7 % | 5.8 % |
| N2 DCASE 2025 machines | 24 | 768 | 43.6 % | 43.6 % | 5.6 % | 87.1 % | 26.6 % | 42.4 % | 5.0 % |
| **N2 pooled** | 103 | 6341 | 28.5 % | 28.5 % | 6.2 % | 78.2 % | 14.0 % | 25.8 % | 4.0 % |
| **N1 + N2 pooled** | 269 | 20410 | **33.3 %** | **33.3 %** | **7.0 %** | **78.8 %** | 13.0 % | **26.9 %** | **4.0 %** |

| set | drawn dot PRE | BASE | CAND | reduction (CAND vs BASE) | beyond the scale (drawn dot pinned) PRE | BASE | CAND | header "beyond the scale" PRE | BASE | CAND |
|---|---|---|---|---|---|---|---|---|---|---|
| **N1 pooled** | 22.7 % | 7.9 % | 3.3 % | 57.6 % | 4.9 % | 1.5 % | 0.6 % | 2.7 % | 0.4 % | 0.3 % |
| **N2 pooled** | 14.4 % | 2.7 % | 2.2 % | 17.0 % | 4.1 % | 0.2 % | 0.2 % | 2.6 % | 0.2 % | 0.2 % |
| **N1 + N2 pooled** | 20.1 % | 6.3 % | 3.0 % | 52.2 % | 4.7 % | 1.1 % | 0.5 % | 2.7 % | 0.3 % | 0.2 % |

Noise-only time per row state (N1 + N2 pooled):

| arm | starting | "—" (idle) | needs running speech | keep talking… | settling | holding | live |
|---|---|---|---|---|---|---|---|
| PRE | 0.3 % | 66.5 % | 2.1 % | 13.0 % | 4.9 % | 4.4 % | 8.9 % |
| BASE | 0.3 % | 66.5 % | 0.6 % | 26.9 % | 2.1 % | 0.8 % | 2.8 % |
| CAND | 0.3 % | 92.7 % | 0.6 % | 4.0 % | 0.7 % | 0.4 % | 1.4 % |

(PRE and BASE share the raw flags, so their "not idle" time is the same;
the gated hint moves time from a dot to "keep talking…".)

- Streams: any "keep talking…" PRE 235, BASE 235, CAND 136 of 269; any
  drawn dot PRE 124, BASE 29, CAND 29. No stream reacts more with CAND
  (not-idle or drawn-dot time).
- What is left with CAND is noise the detector hears as voice. The
  largest "keep talking…" times (809 s in all) are DEMAND outdoor
  recordings (river, field, park), traffic, a transformer and a computer;
  most of the drawn-dot time (611 s over 29 streams) is a metro recording,
  fans, an exhaust fan, a refrigerator, a mains hum, a light ballast, an
  hvac clip and a public square.
- CAND removes less drawn-dot time (52 %) than not-idle time (79 %): the
  gated hint had already kept most positions out (BASE), so what CAND
  removes is mostly "keep talking…".

### Speech, then 30 s of noise (information; the noise part)

| arm | "—" (idle) | holding / live | drawn dot |
|---|---|---|---|
| PRE | 71.3 % | 28.6 % | 28.7 % |
| BASE | 71.3 % | 28.7 % | 28.7 % |
| CAND | 78.8 % | 21.1 % | 21.1 % |

The reader's last position is shown while the computer noise keeps the
raw pitch display voiced; CAND hides it on part of that time.

### Private check

On the user's own room recording (PC fans and coil whine, no speech) BASE
left the row out of "idle" ("keep talking…") nearly all the time and CAND
rarely; results kept outside this repository.

### Reproduce

```
python scripts/resonance/voice-gate-prep.py --vad-build=<voice-detector worktree>/build \
    --ls=<resonance-lab cache root> --corpora=<tests/dsp/data with fda/ ptdb-tug/>
node scripts/fetch-firered-model.mjs                     # the Node copy, build/models/firered/
SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/voice-gate-resonance.mjs \
    --row --shuffle=20261021 --shard=i/2                 # i = 0, 1, in parallel
SO_TAP=0 node scripts/resonance/voice-gate-resonance.mjs --row \
    --report=build/resonance-voicegate/row-0of2.jsonl,build/resonance-voicegate/row-1of2.jsonl
```

The same rows without `--row` print the earlier note's tables
(`--report=` as above).

## Built (2026-10-21)

The candidate as measured, on the same branch (commit f71ddc0): both
cue-strip rows take their state from `pitchVoiced` / `pitchHolding`
(`src/components/cueStripModel.js` `cueRowStates`, used by `CueStrip.jsx`).
Tests: `tests/audio/voice-gate-display-test.js` (the real hook's flags
through `cueRowStates`: the row idle on every hidden noise frame, equal to
the ungated app elsewhere), `tests/audio/cue-strip-model-test.js`;
browser: `scripts/voice-gate-smoke.mjs` (committed air-conditioner clip,
gate on: the row idle on 64 of 64 samples after 3 s, never "keep
talking…"; gate off: not idle on 65.6 %; speech: row-state shares within
10 points of gate off) and `scripts/cue-strip-smoke.mjs` (synthetic held
vowel, gate on: the row idle, no dot).
